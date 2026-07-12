// scripts/rails/full-lane.cjs — nightly FULL test lane (soak mold). Pure core (runFullLane)
// + the real subprocess runners + JSONL/audit persistence in main(). REUSES the landed soak
// idle-guard so the lane yields to live trading / the agent campaign. Zero instrument code.
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Pure core: guard → (run both) → verdict. Skip path never invokes the runners. ──
async function runFullLane({ guardFn, runPytestFn, runReplayFn, nowMs }) {
  const g = await guardFn();
  if (g.action !== "RUN") {
    return { action: g.action, reason: g.reason, verdict: "skipped", tMs: nowMs };
  }
  const pytest = await runPytestFn();
  const replay = await runReplayFn();
  const verdict = pytest.ok && replay.ok ? "green" : "red";
  return { action: "RUN", reason: g.reason, pytest, replay, verdict, tMs: nowMs };
}

// ── I/O layer (pure command shapes are unit-tested; the spawns are RED-proofed via the core) ──
function pytestCmd() { return { cmd: process.platform === "win32" ? "python" : "python3", args: ["-m", "pytest", "src/engine", "-q", "-m", "not gpu"] }; }
function replayCmd() { return { cmd: "npx", args: ["vitest", "run", "src/server/__tests__/fresh-bootstrap-migration-replay.test.ts"] }; }
function exitToResult(code, durationMs) { return { ok: code === 0, exitCode: code, durationMs }; }

function runCmd({ cmd, args }) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { encoding: "utf-8", timeout: 60 * 60 * 1000, windowsHide: true });
  return exitToResult(r.status ?? 1, Date.now() - t0);
}

function writeJsonl(result) {
  const dir = path.resolve(process.cwd(), "data", "rails");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `full-lane-${new Date().toISOString().slice(0, 10)}.jsonl`), JSON.stringify(result) + "\n");
}

async function writeAudit(sql, action, payload) {
  try {
    await sql`INSERT INTO audit_log (action, status, decision_authority, metadata)
              VALUES (${action}, ${payload.verdict === "red" ? "warning" : "success"}, 'scheduler', ${sql.json(payload)})`;
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
    const result = await runFullLane({
      guardFn: () => guardOnce({
        takeSampleFn: () => takeSample({ healthUrl: process.env.TF_HEALTH_URL || "http://127.0.0.1:4000/api/health", port: 4000 }),
        readSwitchFn: () => readRailsSwitch((names) => sql`SELECT param_name, current_value FROM system_parameters WHERE param_name IN ${sql(names)}`),
        gpuBusyPct: Number(process.env.RAILS_GPU_BUSY_PCT || 25), nowMs: Date.now(), phase: "startup", forceRun,
      }),
      runPytestFn: async () => runCmd(pytestCmd()),
      runReplayFn: async () => runCmd(replayCmd()),
      nowMs: Date.now(),
    });
    writeJsonl(result);
    await writeAudit(sql, dryRun ? "rails.full_lane_dryrun" : "rails.full_lane_completed", result);
    console.log(JSON.stringify({ verdict: result.verdict, reason: result.reason }));
    process.exitCode = result.verdict === "red" ? 1 : 0;
  } finally { await sql.end({ timeout: 5 }); }
}

if (require.main === module) main();
module.exports = { runFullLane, pytestCmd, replayCmd, exitToResult };
