#!/usr/bin/env node
/**
 * B1 — Databento Weekly Refresh (W9 Team B)
 *
 * Refreshes data_cache/<SYMBOL>/<timeframe>.parquet files with the latest
 * Databento bars. Fetches only the incremental date range (last cached bar
 * + 1 day → today). Atomic writes; never leaves half-written parquet files.
 *
 * Usage:
 *   node scripts/refresh-databento.mjs                     # Dry run (default)
 *   node scripts/refresh-databento.mjs --dry-run           # Dry run (explicit)
 *   node scripts/refresh-databento.mjs --execute           # Live download
 *   node scripts/refresh-databento.mjs --symbols ES,NQ     # Subset of symbols
 *   node scripts/refresh-databento.mjs --timeframes 15min  # Subset of timeframes
 *
 * Requires: DATABENTO_API_KEY env var (loaded from .env automatically)
 *
 * Auto-loads .env from project root (same pattern as w7a-qae-graduation.mjs).
 */

import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { spawn } from "child_process";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const SHOULD_EXECUTE = args.includes("--execute");
const IS_DRY_RUN = !SHOULD_EXECUTE || args.includes("--dry-run");

const symbolArg = args.find((a) => a.startsWith("--symbols="))?.split("=")[1]
  ?? args[args.indexOf("--symbols") + 1];
const timeframeArg = args.find((a) => a.startsWith("--timeframes="))?.split("=")[1]
  ?? args[args.indexOf("--timeframes") + 1];

const DEFAULT_SYMBOLS = "ES,NQ,MES,MNQ,CL";
const DEFAULT_TIMEFRAMES = "5min,15min,1hour,daily";

const SYMBOLS = symbolArg && !symbolArg.startsWith("--") ? symbolArg : DEFAULT_SYMBOLS;
const TIMEFRAMES = timeframeArg && !timeframeArg.startsWith("--") ? timeframeArg : DEFAULT_TIMEFRAMES;

// ---------------------------------------------------------------------------
// Python script path
// ---------------------------------------------------------------------------
const PYTHON_SCRIPT = resolve(
  __dirname,
  "../src/data/scripts/refresh_local_cache.py"
);

// ---------------------------------------------------------------------------
// Python subprocess runner (same pattern as databento.ts fetcher)
// ---------------------------------------------------------------------------
function runPython(scriptArgs) {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    function spawnPython(cmd) {
      const proc = spawn(cmd, [PYTHON_SCRIPT, ...scriptArgs], {
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));

      proc.on("close", (code) => {
        if (stderr.trim()) {
          // Non-fatal: Python warnings/progress go to stderr
          process.stderr.write(stderr);
        }
        if (code === 0) {
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch {
            reject(new Error(`Failed to parse Python output: ${stdout.slice(0, 500)}`));
          }
        } else {
          reject(new Error(`Python script exited ${code}: ${stderr.slice(0, 500)}`));
        }
      });

      proc.on("error", (err) => {
        if (cmd === "python") {
          spawnPython("python3");
        } else {
          reject(err);
        }
      });
    }

    spawnPython(pythonCmd);
  });
}

// ---------------------------------------------------------------------------
// Validation: check that each verified symbol/timeframe has a recent bar
// ---------------------------------------------------------------------------
function validateResults(results) {
  const STALE_THRESHOLD_HOURS = 36; // Allow up to 36h for weekend gaps
  const now = Date.now();
  const issues = [];

  for (const r of results) {
    if (r.status === "error") {
      issues.push(`  ERROR ${r.symbol}/${r.timeframe}: ${r.message}`);
      continue;
    }
    if (r.status === "skipped" || r.status === "dry_run") {
      continue;
    }
    if (r.status === "up_to_date" || r.status === "ok") {
      const latestTs = r.latest_ts;
      if (!latestTs || latestTs === "none") {
        issues.push(`  WARN  ${r.symbol}/${r.timeframe}: No latest_ts after refresh`);
        continue;
      }
      const latestMs = new Date(latestTs).getTime();
      const ageHours = (now - latestMs) / (1000 * 60 * 60);
      if (ageHours > STALE_THRESHOLD_HOURS) {
        issues.push(
          `  STALE ${r.symbol}/${r.timeframe}: latest bar is ${ageHours.toFixed(1)}h ago (threshold: ${STALE_THRESHOLD_HOURS}h) — ${latestTs}`
        );
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=".repeat(70));
  console.log("B1 — Databento Weekly Refresh (W9 Team B)");
  console.log("=".repeat(70));
  console.log(`  Mode:       ${IS_DRY_RUN ? "DRY RUN (no download)" : "EXECUTE (live download)"}`);
  console.log(`  Symbols:    ${SYMBOLS}`);
  console.log(`  Timeframes: ${TIMEFRAMES}`);
  console.log();

  // Verify API key is set (don't print value)
  const apiKey = process.env.DATABENTO_API_KEY || "";
  if (!apiKey || apiKey === "your-databento-api-key") {
    if (!IS_DRY_RUN) {
      console.error("ERROR: DATABENTO_API_KEY is not set or is still the placeholder value.");
      console.error("       Set a real key in .env before running --execute.");
      process.exit(1);
    } else {
      console.warn("WARN: DATABENTO_API_KEY is placeholder — dry-run proceeds, execute will fail.");
    }
  } else {
    console.log(`  API key:    set (length=${apiKey.length})`);
  }
  console.log();

  // Build Python args
  const pythonArgs = [
    "--symbols", SYMBOLS,
    "--timeframes", TIMEFRAMES,
    "--output-json",
  ];
  if (IS_DRY_RUN) {
    pythonArgs.push("--dry-run");
  }

  console.log(`  Running Python: ${PYTHON_SCRIPT}`);
  console.log(`  Args: ${pythonArgs.join(" ")}`);
  console.log();

  let result;
  try {
    result = await runPython(pythonArgs);
  } catch (err) {
    console.error("FATAL: Python subprocess failed:", err.message);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Print results table
  // ---------------------------------------------------------------------------
  console.log("--- Results ---");
  const results = result.results || [];
  const rows = results.map((r) => {
    const sym = String(r.symbol || "?").padEnd(6);
    const tf = String(r.timeframe || "?").padEnd(8);
    const status = String(r.status || "?").padEnd(12);
    const newRows = r.new_rows !== undefined ? `+${r.new_rows}` : "";
    const latestTs = r.latest_ts || "";
    const msg = r.message || "";
    return `  ${sym} ${tf} ${status} ${newRows.padEnd(8)} ${latestTs.slice(0, 25).padEnd(26)} ${msg}`;
  });

  const header = `  ${"Symbol".padEnd(6)} ${"TF".padEnd(8)} ${"Status".padEnd(12)} ${"NewRows".padEnd(8)} ${"LatestTS".padEnd(26)} Message`;
  console.log(header);
  console.log("  " + "-".repeat(90));
  rows.forEach((r) => console.log(r));
  console.log();

  // ---------------------------------------------------------------------------
  // Validation gate (execute mode only)
  // ---------------------------------------------------------------------------
  if (!IS_DRY_RUN) {
    console.log("--- Validation ---");
    const issues = validateResults(results);
    if (issues.length > 0) {
      console.warn("VALIDATION WARNINGS:");
      issues.forEach((i) => console.warn(i));
    } else {
      const okCount = results.filter((r) => ["ok", "up_to_date"].includes(r.status)).length;
      console.log(`  All ${okCount} refreshed files pass staleness check (< 36h).`);
    }
    console.log();
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const okCount = results.filter((r) => r.status === "ok").length;
  const upToDateCount = results.filter((r) => r.status === "up_to_date").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;

  console.log("--- Summary ---");
  console.log(`  Updated:    ${okCount}`);
  console.log(`  Up-to-date: ${upToDateCount}`);
  console.log(`  Skipped:    ${skippedCount}`);
  console.log(`  Errors:     ${errorCount}`);

  if (IS_DRY_RUN) {
    console.log("\n[DRY RUN] No files written. Re-run with --execute to download.");
  } else if (errorCount === 0) {
    console.log("\n[EXECUTE] Refresh complete. All parquet files are current.");
  } else {
    console.log(`\n[EXECUTE] Refresh completed with ${errorCount} error(s). Check output above.`);
  }

  if (errorCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
