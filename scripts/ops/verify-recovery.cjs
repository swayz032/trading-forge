// scripts/ops/verify-recovery.cjs — cold-recovery TIER VERIFIER (leg 2).
//
// Turns the recovery story from a checklist into something that can FAIL. Each tier is a
// per-capability check — "does this box actually have this capability" — because "it booted"
// was never the question.
//
// ★ THIS WIRES THE LEG-5 PROBE. Until leg 2 it had zero callers: correct, live-PASSing, and
// gating nothing. A capability check nobody invokes is a capability nobody has.
//
// ★★ WHAT THE FIRST VERSION GOT WRONG, because it is the reason for every design choice here:
// it HARDCODED three expected task names while the runsheet named five register scripts, so
// it printed `all_registered` on a box where THREE tasks were missing — including
// `TF-CI-Runner`, the Tier-C runner task whose inertness is this document's headline finding.
// Tier C passed green while the task it protects did not exist. A false green of exactly the
// shape this verifier was written to catch, on the author's own machine.
//   -> expected tasks are now DERIVED from the register scripts, never hand-listed.
//   -> registration is parsed by FIELD with a state check, not String.includes.
//   -> every check takes injected I/O so its verdicts can be exercised by tests. The first
//      version's tests never called main(), legS3 or tierServices at all: 10 of 12 mutants
//      survived, and the commit claimed "a test row cannot drift without going red".
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadEnvFile } = require("../lib/env-resolve.cjs");

const PASS = 0, UNKNOWN = 2, FAIL = 3;
const V = { PASS: "PASS", FAIL: "FAIL", UNKNOWN: "UNKNOWN" };

/** Evidence level per leg — an honest map, never a blanket "drilled" (OR-091). */
const EVIDENCE = {
  db: "drilled+receipted 2026-07-02",
  services: "designed — not drilled",
  tasks: "designed — not drilled",
  wsl: "designed — not drilled",
  s3: "built + witnessed live PASS",
};

const emit = (o) => console.log(JSON.stringify({ check: "cold-recovery", ...o }));

const REGISTER_SCRIPTS = [
  "scripts/rails/register-cert-rig-task.ps1",
  "scripts/rails/register-divergence-task.ps1",
  "scripts/rails/register-full-lane-task.ps1",
  "scripts/rails/register-runner-task.ps1",
  "scripts/rails/register-worktree-ttl-task.ps1",
  "scripts/soak/register-soak-task.ps1",
];

/**
 * DERIVE the expected task names from the register scripts' own `$TaskName` defaults.
 *
 * Hand-listing them is what produced the false green: the list said 3, the scripts create 6,
 * and the gap was invisible. Deriving means the check cannot drift from the thing it checks —
 * the same reason the roll-up guard parses `worstOf(...)` instead of naming its sources.
 */
function expectedTaskNames(root = process.cwd(), readFileFn = fs.readFileSync, existsFn = fs.existsSync) {
  const names = [];
  for (const rel of REGISTER_SCRIPTS) {
    const p = path.resolve(root, rel);
    if (!existsFn(p)) continue;
    const m = String(readFileFn(p, "utf-8")).match(/\$TaskName\s*=\s*"([^"]+)"/);
    if (m) names.push(m[1]);
  }
  return names;
}

// ── Tier A — services. The API ANSWERING is the capability; a running process is not. ──
async function tierServices({ fetchFn = fetch, url = process.env.TF_HEALTH_URL || "http://127.0.0.1:4000/api/health" } = {}) {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(8000) });
    // A non-200 still proves the service is UP and serving — auth-gated/slow is not "down"
    // (the 07-11 false-positive fix). Only an unanswered request is a real FAIL.
    return { verdict: V.PASS, reason: `http_${res.status}`, detail: "service answered" };
  } catch (e) {
    // Preserve the underlying cause code: ECONNREFUSED vs DNS vs TLS are different recoveries.
    const code = (e && e.cause && e.cause.code) || (e && e.name) || "fetch_failed";
    return { verdict: V.FAIL, reason: "unreachable", detail: code };
  }
}

// ── Tier B — scheduled tasks. Registered is necessary; it is NOT sufficient. ──
function tierTasks({ spawnFn = spawnSync, platform = process.platform, expected = expectedTaskNames() } = {}) {
  if (platform !== "win32") {
    return { verdict: V.UNKNOWN, reason: "not_windows", detail: "schtasks unavailable" };
  }
  if (expected.length === 0) {
    // A derivation that found nothing must not read as "nothing missing".
    return { verdict: V.UNKNOWN, reason: "no_expected_derived", detail: "register scripts unreadable" };
  }
  const r = spawnFn("schtasks", ["/query", "/fo", "csv"], { encoding: "utf-8", timeout: 20000, windowsHide: true });
  if (r.error || r.status !== 0) {
    return { verdict: V.UNKNOWN, reason: "schtasks_failed", detail: (r.error && r.error.code) || `exit_${r.status}` };
  }
  // Parse by FIELD. `String.includes` PASSed when an unrelated task merely contained the
  // name as a substring, and could not see a Disabled task at all.
  const rows = new Map();
  for (const line of String(r.stdout).split(/\r?\n/)) {
    const m = line.match(/^"\\?([^"]+)","([^"]*)","([^"]*)"/);
    if (m) rows.set(m[1].replace(/^.*\\/, ""), m[3]);
  }
  const missing = expected.filter((t) => !rows.has(t));
  // Disabled is registered-but-cannot-run. The whole Tier-C lesson is that registration is
  // not execution, so a Disabled task is a FAIL, not a pass with an asterisk.
  const disabled = expected.filter((t) => rows.has(t) && /disabled/i.test(rows.get(t) || ""));
  if (missing.length || disabled.length) {
    return {
      verdict: V.FAIL,
      reason: missing.length ? "tasks_absent" : "tasks_disabled",
      detail: [...missing.map((t) => `${t}:absent`), ...disabled.map((t) => `${t}:disabled`)].join(","),
    };
  }
  return { verdict: V.PASS, reason: "all_registered_and_enabled", detail: `${expected.length} tasks` };
}

// ── Tier C — WSL. The distro AND the runner task that needs it. ──
function tierWsl({ spawnFn = spawnSync, platform = process.platform } = {}) {
  if (platform !== "win32") {
    return { verdict: V.UNKNOWN, reason: "not_windows", detail: "wsl unavailable" };
  }
  const r = spawnFn("wsl", ["-l", "-q"], { encoding: "utf-8", timeout: 20000, windowsHide: true });
  if (r.error) return { verdict: V.UNKNOWN, reason: "wsl_not_installed", detail: r.error.code || "spawn_failed" };
  // `wsl -l -q` emits UTF-16LE; strip NULs, then require a distro-SHAPED token so an update
  // banner or a nag line cannot be counted as a distro.
  const distros = String(r.stdout)
    .replace(/\0/g, "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && /^[A-Za-z][\w.\-]*$/.test(s));
  if (r.status !== 0 || distros.length === 0) {
    return { verdict: V.FAIL, reason: "no_wsl_distro", detail: "the runner task cannot execute" };
  }
  return { verdict: V.PASS, reason: "distro_present", detail: `${distros.length} distro(s)` };
}

// ── Leg 5 — the S3 capability probe. Wired here. ──
function legS3({ spawnFn = spawnSync, driver = path.join(__dirname, "verify-s3-capability.cjs") } = {}) {
  const r = spawnFn(process.execPath, [driver], { encoding: "utf-8", timeout: 90000, windowsHide: true });
  if (r.error) return { verdict: V.UNKNOWN, reason: "probe_unlaunchable", detail: r.error.code || "spawn_failed" };
  if (r.status === PASS) return { verdict: V.PASS, reason: "lake_readable", detail: "data decoded, not just footer" };
  if (r.status === FAIL) return { verdict: V.FAIL, reason: "lake_unreadable", detail: "probe reached the lake and could not read it" };
  return { verdict: V.UNKNOWN, reason: "probe_inconclusive", detail: `exit_${r.status}` };
}

// ── Leg 1 — database. Reaching it is the capability; a URL in .env is not. ──
async function legDb({ connectFn } = {}) {
  if (!process.env.DATABASE_URL) {
    return { verdict: V.UNKNOWN, reason: "database_url_absent", detail: "DATABASE_URL" };
  }
  let sql;
  try {
    const postgres = connectFn || require("postgres");
    // Construction is INSIDE the try: a malformed DSN threw past the handler before, and
    // surfaced as check_threw rather than a diagnosable verdict.
    sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  } catch (e) {
    return { verdict: V.UNKNOWN, reason: "pg_driver_unavailable", detail: (e && e.code) || "require_failed" };
  }
  try {
    await sql`SELECT 1`;
    return { verdict: V.PASS, reason: "reachable", detail: "SELECT 1 succeeded" };
  } catch (e) {
    // Scrub: a connection error can echo the full DSN, credentials included. Code only.
    return { verdict: V.FAIL, reason: "unreachable", detail: (e && e.code) || "query_failed" };
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* closing must not change the verdict */ }
  }
}

const CHECKS = [
  { leg: "db", tier: "—", label: "database reachable", run: legDb },
  { leg: "services", tier: "A", label: "API serving", run: tierServices },
  { leg: "tasks", tier: "B", label: "scheduled tasks registered + enabled", run: tierTasks },
  { leg: "wsl", tier: "C", label: "WSL distro present", run: tierWsl },
  { leg: "s3", tier: "—", label: "data lake readable", run: legS3 },
];

/** Pure aggregation: FAIL dominates UNKNOWN dominates PASS. Exported so it is testable. */
function aggregate(results) {
  if (results.some((r) => r.verdict === V.FAIL)) return FAIL;
  if (results.some((r) => r.verdict === V.UNKNOWN)) return UNKNOWN;
  return PASS;
}

async function runChecks(checks = CHECKS) {
  const results = [];
  for (const c of checks) {
    let r;
    try { r = await c.run(); }
    catch (e) { r = { verdict: V.UNKNOWN, reason: "check_threw", detail: (e && e.name) || "error" }; }
    results.push({ leg: c.leg, tier: c.tier, label: c.label, evidence: EVIDENCE[c.leg], ...r });
  }
  return results;
}

async function main() {
  const env = loadEnvFile({ cwd: process.cwd(), moduleDir: __dirname, preferVar: "RAILS_ENV_PATH" });
  emit(env.loaded ? { stage: "env", loadedFrom: env.path } : { stage: "env", loaded: false, reason: env.reason });

  const results = await runChecks();
  for (const r of results) emit(r);

  const failed = results.filter((r) => r.verdict === V.FAIL);
  const unknown = results.filter((r) => r.verdict === V.UNKNOWN);
  emit({
    stage: "summary",
    pass: results.filter((r) => r.verdict === V.PASS).length,
    fail: failed.length,
    unknown: unknown.length,
    failing: failed.map((r) => r.leg),
    inconclusive: unknown.map((r) => r.leg),
    note: "verdicts are per-capability; evidence levels are per-leg and NOT uniform",
  });
  return aggregate(results);
}

if (require.main === module) main().then((c) => { process.exitCode = c; });
module.exports = {
  PASS, UNKNOWN, FAIL, V, EVIDENCE, CHECKS, REGISTER_SCRIPTS,
  expectedTaskNames, tierServices, tierTasks, tierWsl, legS3, legDb, aggregate, runChecks,
};
