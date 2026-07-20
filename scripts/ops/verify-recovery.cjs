// scripts/ops/verify-recovery.cjs — cold-recovery TIER VERIFIER (leg 2).
//
// Turns the recovery runsheet from a checklist into something that can FAIL. Each tier is a
// per-capability check — "does this box actually have this capability" — not a
// config-presence check, because "it booted" was never the question.
//
// ★ THIS IS WHAT WIRES THE LEG-5 PROBE. Until now that probe had zero callers: correct,
// live-PASSing, and gating nothing. A capability check nobody invokes is a capability
// nobody has.
//
// THREE-STATE PER TIER, and the distinction is load-bearing everywhere:
//   PASS     the capability is present, proven by exercising it
//   FAIL     the capability is genuinely absent -> recovery is not complete
//   UNKNOWN  we could not determine it (tool missing, probe could not run)
// UNKNOWN is NOT FAIL. A checker that cannot run must never report the box as broken —
// that is a true alarm pointed at the wrong thing, and it is how an operator learns to
// distrust the whole runsheet.
//
// EVIDENCE LEVELS ARE PART OF THE OUTPUT. Some tiers are drilled, some are merely built,
// some are only designed. Printing a uniform green across all of them would make this the
// false-green it exists to prevent, so every tier states what its evidence actually is.
"use strict";
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

// ── Tier A — services. The API answering is the capability; a running process is not. ──
async function tierServices() {
  const url = process.env.TF_HEALTH_URL || "http://127.0.0.1:4000/api/health";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    // A non-200 still proves the service is UP and serving — the 07-11 false-positive
    // fix: auth-gated/slow is not "down". Only an unanswered request is a real FAIL.
    return { verdict: V.PASS, reason: `http_${res.status}`, detail: "service answered" };
  } catch (e) {
    return { verdict: V.FAIL, reason: "unreachable", detail: (e && e.name) || "fetch_failed" };
  }
}

// ── Tier B — scheduled tasks. Registered is necessary; it is NOT sufficient. ──
function tierTasks() {
  if (process.platform !== "win32") {
    return { verdict: V.UNKNOWN, reason: "not_windows", detail: "schtasks unavailable" };
  }
  const expected = ["TF-Rails-Full-Lane", "TF-Rails-Cert-Rig", "TF-Tower-Soak"];
  const r = spawnSync("schtasks", ["/query", "/fo", "csv"], { encoding: "utf-8", timeout: 20000, windowsHide: true });
  if (r.error || r.status !== 0) {
    return { verdict: V.UNKNOWN, reason: "schtasks_failed", detail: (r.error && r.error.code) || `exit_${r.status}` };
  }
  const missing = expected.filter((t) => !r.stdout.includes(t));
  if (missing.length) return { verdict: V.FAIL, reason: "tasks_absent", detail: missing.join(",") };
  return { verdict: V.PASS, reason: "all_registered", detail: `${expected.length} tasks` };
}

// ── Tier C — WSL. ★ The prerequisite no existing recovery note lists. ──
function tierWsl() {
  if (process.platform !== "win32") {
    return { verdict: V.UNKNOWN, reason: "not_windows", detail: "wsl unavailable" };
  }
  const r = spawnSync("wsl", ["-l", "-q"], { encoding: "utf-8", timeout: 20000, windowsHide: true });
  if (r.error) return { verdict: V.UNKNOWN, reason: "wsl_not_installed", detail: r.error.code || "spawn_failed" };
  // wsl -l -q emits UTF-16LE; strip NULs before judging emptiness.
  const distros = String(r.stdout).replace(/\0/g, "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (r.status !== 0 || distros.length === 0) {
    // A rebuilt box has no distro until someone installs one. The GitHub Actions runner
    // task registers fine and then does nothing — a task that looks healthy and is inert.
    return { verdict: V.FAIL, reason: "no_wsl_distro", detail: "the runner task cannot execute" };
  }
  return { verdict: V.PASS, reason: "distro_present", detail: `${distros.length} distro(s)` };
}

// ── Leg 5 — the S3 capability probe. Wired here, at last. ──
function legS3() {
  const driver = path.join(__dirname, "verify-s3-capability.cjs");
  const r = spawnSync(process.execPath, [driver], { encoding: "utf-8", timeout: 90000, windowsHide: true });
  if (r.error) return { verdict: V.UNKNOWN, reason: "probe_unlaunchable", detail: r.error.code || "spawn_failed" };
  if (r.status === PASS) return { verdict: V.PASS, reason: "lake_readable", detail: "data decoded, not just footer" };
  if (r.status === FAIL) return { verdict: V.FAIL, reason: "lake_unreadable", detail: "probe reached the lake and could not read it" };
  return { verdict: V.UNKNOWN, reason: "probe_inconclusive", detail: `exit_${r.status}` };
}

// ── Leg 1 — database. Reaching it is the capability; a URL in .env is not. ──
async function legDb() {
  if (!process.env.DATABASE_URL) {
    return { verdict: V.UNKNOWN, reason: "database_url_absent", detail: "DATABASE_URL" };
  }
  let postgres;
  try { postgres = require("postgres"); }
  catch { return { verdict: V.UNKNOWN, reason: "pg_driver_unavailable", detail: "postgres" }; }
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    await sql`SELECT 1`;
    return { verdict: V.PASS, reason: "reachable", detail: "SELECT 1 succeeded" };
  } catch (e) {
    // Scrub: a connection error can echo the full DSN, credentials included.
    return { verdict: V.FAIL, reason: "unreachable", detail: (e && e.code) || "query_failed" };
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* closing must not change the verdict */ }
  }
}

const CHECKS = [
  { leg: "db", tier: "—", label: "database reachable", run: legDb },
  { leg: "services", tier: "A", label: "API serving", run: tierServices },
  { leg: "tasks", tier: "B", label: "scheduled tasks registered", run: tierTasks },
  { leg: "wsl", tier: "C", label: "WSL distro present", run: tierWsl },
  { leg: "s3", tier: "—", label: "data lake readable", run: legS3 },
];

async function main() {
  const env = loadEnvFile({ cwd: process.cwd(), moduleDir: __dirname, preferVar: "RAILS_ENV_PATH" });
  emit(env.loaded ? { stage: "env", loadedFrom: env.path } : { stage: "env", loaded: false, reason: env.reason });

  const results = [];
  for (const c of CHECKS) {
    let r;
    try { r = await c.run(); }
    catch (e) { r = { verdict: V.UNKNOWN, reason: "check_threw", detail: (e && e.name) || "error" }; }
    results.push({ leg: c.leg, tier: c.tier, label: c.label, evidence: EVIDENCE[c.leg], ...r });
    emit(results[results.length - 1]);
  }

  const failed = results.filter((r) => r.verdict === V.FAIL);
  const unknown = results.filter((r) => r.verdict === V.UNKNOWN);
  emit({
    stage: "summary",
    pass: results.filter((r) => r.verdict === V.PASS).length,
    fail: failed.length,
    unknown: unknown.length,
    failing: failed.map((r) => r.leg),
    inconclusive: unknown.map((r) => r.leg),
    // Stated so a green summary can never be read as "recovery is proven": most tiers are
    // DESIGNED, not drilled, and only a real rebuild-the-box drill changes that.
    note: "verdicts are per-capability; evidence levels are per-leg and NOT uniform",
  });

  // FAIL dominates UNKNOWN dominates PASS.
  return failed.length ? FAIL : unknown.length ? UNKNOWN : PASS;
}

if (require.main === module) main().then((c) => { process.exitCode = c; });
module.exports = { PASS, UNKNOWN, FAIL, V, EVIDENCE, CHECKS, tierTasks, tierWsl, legS3 };
