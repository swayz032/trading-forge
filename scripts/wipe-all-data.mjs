#!/usr/bin/env node
/**
 * Total Trading Forge data wipe: remove all strategies, backtests, journals,
 * paper trades, audit logs, and telemetry. Preserves seeded reference data.
 *
 * Backup is taken via scripts/backup-db.sh or pg_dump BEFORE running this.
 *
 * Usage:
 *   node scripts/wipe-all-data.mjs           # report-only (default)
 *   node scripts/wipe-all-data.mjs --execute # apply deletes
 *
 * Refuses to run if NODE_ENV=production unless --i-know-what-im-doing is set.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const execute = process.argv.includes("--execute");
const overrideProd = process.argv.includes("--i-know-what-im-doing");

const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => {
    const eq = l.indexOf("=");
    return [l.slice(0, eq).trim(), l.slice(eq + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);

if (env.NODE_ENV === "production" && !overrideProd) {
  console.error("REFUSING to run in production without --i-know-what-im-doing flag");
  process.exit(1);
}

const url = env.DATABASE_URL || env.PG_URL || env.POSTGRES_URL;
if (!url) {
  console.error("No DATABASE_URL in .env");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

// Tables to wipe — grouped logically. TRUNCATE ... CASCADE handles FK chains.
// Strategies are the root: cascading TRUNCATE removes all dependent rows.
const STRATEGY_ROOT_CASCADE = [
  "strategies", // cascades: backtests, paper_sessions, strategy_exports, strategy_graveyard,
                //           system_journal (set null), audit_log (set null), skip_decisions,
                //           mutation_outcomes, strategy_names, compliance_reviews,
                //           rl_training_runs, critic_optimization_runs, sqa_optimization_runs,
                //           qubo_timing_runs, tensor_predictions, backtest_matrix
];

// Standalone tables not FK-linked to strategies but still user-generated/stale:
const STANDALONE_USER_DATA = [
  "audit_log",
  "agent_health_reports",
  "subsystem_metrics",
  "alerts",
  "dead_letter_queue",
  "deepar_forecasts",
  "deepar_training_runs",
  "deepar_model_registry",
  "macro_snapshots",
  "day_archetypes",
  "compliance_drift_log",
  "scheduler_job_runs",
  "ai_inference_log",
  "circuit_breaker_events",
  "n8n_execution_log",
  "data_quality_checks",
  "market_data_meta",
  "python_execution_log",
  "idempotency_keys",
  "data_sync_jobs",
  "contract_rolls",
  "system_journal",
];

// Preserve list (for documentation; we DON'T touch these):
const PRESERVE = [
  "compliance_rulesets",      // 8 prop firm rules — seeded reference
  "system_parameters",        // system config — seeded
  "system_parameter_history", // history of system_parameters
  "prompt_versions",          // AI prompt templates — seeded
  "prompt_ab_tests",          // prompt experiment data
  "watchlist",                // empty
  "__drizzle_migrations",     // NEVER TOUCH
];

console.log(`\n=== Trading Forge Data Wipe ===`);
console.log(`Mode: ${execute ? "EXECUTE" : "REPORT-ONLY (re-run with --execute)"}`);
console.log(`DB: ${url.replace(/:[^:@]+@/, ":****@")}\n`);

try {
  // ─── 1. Get current counts for everything ───────────────────────
  console.log("=== Current row counts (before wipe) ===");
  const allTablesQ = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  const allTables = allTablesQ.map((r) => r.table_name);

  const counts = {};
  for (const t of allTables) {
    try {
      const r = await sql.unsafe(`SELECT count(*)::int AS c FROM "${t}"`);
      counts[t] = r[0].c;
    } catch (e) {
      counts[t] = `ERROR: ${e.message.slice(0, 60)}`;
    }
  }

  let toWipeCount = 0;
  let toPreserveCount = 0;
  console.log("\n--- TO WIPE ---");
  for (const t of [...STRATEGY_ROOT_CASCADE, ...STANDALONE_USER_DATA].sort()) {
    if (counts[t] !== undefined) {
      console.log(`  ${t.padEnd(35)} ${counts[t]}`);
      if (typeof counts[t] === "number") toWipeCount += counts[t];
    }
  }
  console.log(`  ${"".padEnd(35)} -----`);
  console.log(`  ${"TOTAL ROWS WIPED".padEnd(35)} ${toWipeCount}`);

  console.log("\n--- TO PRESERVE ---");
  for (const t of PRESERVE.sort()) {
    if (counts[t] !== undefined) {
      console.log(`  ${t.padEnd(35)} ${counts[t]}`);
      if (typeof counts[t] === "number") toPreserveCount += counts[t];
    }
  }
  console.log(`  ${"".padEnd(35)} -----`);
  console.log(`  ${"TOTAL PRESERVED".padEnd(35)} ${toPreserveCount}`);

  console.log("\n--- UNCATEGORIZED (will be left alone) ---");
  const known = new Set([...STRATEGY_ROOT_CASCADE, ...STANDALONE_USER_DATA, ...PRESERVE]);
  for (const t of allTables) {
    if (!known.has(t)) {
      console.log(`  ${t.padEnd(35)} ${counts[t]}`);
    }
  }

  if (!execute) {
    console.log("\nREPORT COMPLETE. Re-run with --execute to apply.");
    process.exit(0);
  }

  // ─── 2. EXECUTE WIPE ────────────────────────────────────────────
  console.log("\n=== EXECUTING WIPE ===");
  const start = Date.now();

  await sql.begin(async (trx) => {
    // 2a. Cascade-truncate strategies — removes all FK-dependent rows in one shot
    console.log(`  TRUNCATE strategies CASCADE...`);
    await trx.unsafe(`TRUNCATE TABLE strategies RESTART IDENTITY CASCADE`);

    // 2b. Truncate standalone user-data tables
    for (const t of STANDALONE_USER_DATA) {
      try {
        await trx.unsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
        console.log(`  TRUNCATE ${t} CASCADE — ok`);
      } catch (e) {
        console.log(`  TRUNCATE ${t} — skipped (${e.message.slice(0, 60)})`);
      }
    }
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\nWipe transaction committed in ${elapsed}s`);

  // ─── 3. Verify post-wipe counts ─────────────────────────────────
  console.log("\n=== Post-wipe verification ===");
  let leftoverCount = 0;
  for (const t of [...STRATEGY_ROOT_CASCADE, ...STANDALONE_USER_DATA]) {
    if (counts[t] === undefined) continue;
    try {
      const r = await sql.unsafe(`SELECT count(*)::int AS c FROM "${t}"`);
      const c = r[0].c;
      if (c > 0) {
        console.log(`  WARN  ${t}: still has ${c} rows`);
        leftoverCount += c;
      } else {
        console.log(`  OK    ${t}: 0 rows`);
      }
    } catch (e) {
      console.log(`  ?     ${t}: ${e.message.slice(0, 60)}`);
    }
  }

  console.log("\n=== Preserved tables (should be unchanged) ===");
  for (const t of PRESERVE) {
    if (counts[t] === undefined) continue;
    try {
      const r = await sql.unsafe(`SELECT count(*)::int AS c FROM "${t}"`);
      const c = r[0].c;
      const wasC = counts[t];
      const status = c === wasC ? "OK" : "WARN";
      console.log(`  ${status}    ${t}: ${c} rows (was ${wasC})`);
    } catch (e) {
      console.log(`  ?     ${t}: ${e.message.slice(0, 60)}`);
    }
  }

  if (leftoverCount === 0) {
    console.log("\nALL TARGETED TABLES WIPED CLEAN.");
  } else {
    console.log(`\nWARN: ${leftoverCount} rows remain in target tables — investigate.`);
  }
} catch (e) {
  console.error("\nFATAL:", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
