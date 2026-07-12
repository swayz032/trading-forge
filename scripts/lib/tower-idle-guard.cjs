// scripts/lib/tower-idle-guard.cjs — rails idle guard. REUSES the landed soak decision +
// sensors; adds only the rails switch + a CLI verdict→exit-code so schtasks/full-lane can branch.
"use strict";
const { decide } = require("../soak/soak-guard.cjs");
const { takeSample } = require("../soak/soak-sensors.cjs");
const { readRailsSwitch } = require("./rails-switch.cjs");

function exitCodeFor(action) {
  return action === "RUN" ? 0 : action === "ABORT" ? 20 : 10;
}

async function guardOnce({ takeSampleFn, readSwitchFn, gpuBusyPct, nowMs, phase, forceRun }) {
  const sample = await takeSampleFn();
  if (forceRun) return { action: "RUN", reason: "forced", sample };
  const sw = await readSwitchFn();
  const g = decide({ sample, sw, gpuBusyPct, nowMs, phase });
  return { ...g, sample };
}

// CLI: node scripts/lib/tower-idle-guard.cjs  → prints verdict JSON, exits per exitCodeFor.
async function main() {
  const dotenv = require("dotenv"); const path = require("path");
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
  const postgres = require("postgres");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5 });
  const forceRun = process.argv.includes("--force-run");
  try {
    const r = await guardOnce({
      takeSampleFn: () => takeSample({ healthUrl: process.env.TF_HEALTH_URL || "http://127.0.0.1:4000/api/health", port: 4000 }),
      readSwitchFn: () => readRailsSwitch((names) => sql`SELECT param_name, current_value FROM system_parameters WHERE param_name IN ${sql(names)}`),
      gpuBusyPct: Number(process.env.RAILS_GPU_BUSY_PCT || 25),
      nowMs: Date.now(), phase: "startup", forceRun,
    });
    console.log(JSON.stringify({ action: r.action, reason: r.reason }));
    process.exitCode = exitCodeFor(r.action);
  } finally { await sql.end({ timeout: 5 }); }
}

if (require.main === module) main();
module.exports = { exitCodeFor, guardOnce, decide };
