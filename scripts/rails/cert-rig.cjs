// scripts/rails/cert-rig.cjs — nightly certification rig (Rail 3, soak mold, schtasks @23:30
// after the 22:00 full-lane). Runs the frozen invariant battery, builds tonight's certificate,
// diffs it against last night's (from rails_nightly_reports), and persists JSONL + DB (append-only,
// migration 0202) fail-soft. Yields to a busy tower via the SAME landed soak idle-guard the
// full-lane uses. Read-only invariant checks — zero instrument code, zero engine invocation.
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { buildCertificate, INVARIANT_CHECKS } = require("./cert-schema.cjs");
const { diffCertificates } = require("./cert-diff.cjs");

// ── Pure assembly: prev cert + tonight's check results → cert + diff + the DB row shape.
// Unit-tested; the runner wraps this with spawn/DB/JSONL I/O. ──
function assembleNightly({ prev, reportDate, buildSha, checkResults }) {
  const cert = buildCertificate({ reportDate, buildSha, checkResults });
  const diff = diffCertificates(prev, cert);
  const row = { report_date: cert.reportDate, build_sha: cert.buildSha, verdict: diff.verdict, certificate: cert };
  return { cert, diff, row };
}

// ── I/O layer ──
function runCheck(name) {
  // npm scripts each exit 0 (pass) / nonzero (fail). shell:true so npm resolves on Windows.
  const r = spawnSync("npm", ["run", name], { encoding: "utf-8", timeout: 5 * 60 * 1000, windowsHide: true, shell: true });
  return r.status === 0 ? "pass" : "fail";
}

function gitHeadSha() {
  try { return spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout.trim() || null; } catch { return null; }
}

function collectCheckResults() {
  const results = {};
  for (const name of INVARIANT_CHECKS) results[name] = runCheck(name);
  return results;
}

function writeJsonl(payload) {
  const dir = path.resolve(process.cwd(), "data", "rails");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `cert-${new Date().toISOString().slice(0, 10)}.jsonl`), JSON.stringify(payload) + "\n");
}

async function loadPrevCertificate(sql) {
  try {
    const rows = await sql`SELECT certificate FROM rails_nightly_reports ORDER BY report_date DESC, id DESC LIMIT 1`;
    return rows.length ? rows[0].certificate : null;
  } catch { return null; } // fail-soft: first run / table absent → no prior → baseline
}

async function writeAudit(sql, action, payload) {
  try {
    await sql`INSERT INTO audit_log (action, status, decision_authority, result)
              VALUES (${action}, ${payload.verdict === "drift" ? "warning" : "success"}, 'scheduler', ${sql.json(payload)})`;
  } catch (e) { console.error("audit write failed (non-fatal):", e.message); }
}

async function main() {
  const dotenv = require("dotenv");
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
  const postgres = require("postgres");
  const { takeSample } = require("../soak/soak-sensors.cjs");
  const { guardOnce } = require("../lib/tower-idle-guard.cjs");
  const { readRailsSwitch } = require("../lib/rails-switch.cjs");
  const dryRun = process.argv.includes("--dry-run");
  const forceRun = process.argv.includes("--force-run");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5 });
  try {
    const g = await guardOnce({
      takeSampleFn: () => takeSample({ healthUrl: process.env.TF_HEALTH_URL || "http://127.0.0.1:4000/api/health", port: 4000 }),
      readSwitchFn: () => readRailsSwitch((names) => sql`SELECT param_name, current_value FROM system_parameters WHERE param_name IN ${sql(names)}`),
      gpuBusyPct: Number(process.env.RAILS_GPU_BUSY_PCT || 25), nowMs: Date.now(), phase: "startup", forceRun,
    });
    if (g.action !== "RUN") {
      writeJsonl({ skipped: true, reason: g.reason, tMs: Date.now() });
      await writeAudit(sql, "rails.cert_rig_skipped", { verdict: "skipped", reason: g.reason });
      console.log(JSON.stringify({ verdict: "skipped", reason: g.reason }));
      return;
    }
    const prev = await loadPrevCertificate(sql);
    const { cert, diff, row } = assembleNightly({
      prev, reportDate: new Date().toISOString().slice(0, 10), buildSha: gitHeadSha(), checkResults: collectCheckResults(),
    });
    writeJsonl({ cert, diff });
    if (!dryRun) {
      try {
        await sql`INSERT INTO rails_nightly_reports (report_date, build_sha, verdict, certificate)
                  VALUES (${row.report_date}, ${row.build_sha}, ${row.verdict}, ${sql.json(row.certificate)})`;
      } catch (e) { console.error("cert DB write failed (JSONL retained):", e.message); }
    }
    await writeAudit(sql, dryRun ? "rails.cert_rig_dryrun" : "rails.cert_rig_completed",
      { verdict: diff.verdict, changes: diff.changes, buildSha: cert.buildSha });
    console.log(JSON.stringify({ verdict: diff.verdict, changes: diff.changes.length }));
    process.exitCode = diff.verdict === "drift" ? 1 : 0;
  } finally { await sql.end({ timeout: 5 }); }
}

if (require.main === module) main();
module.exports = { assembleNightly, runCheck, collectCheckResults };
