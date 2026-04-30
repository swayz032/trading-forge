#!/usr/bin/env node
/**
 * Clean DB dead data: stale 'running' rows older than sweep age + orphan FK references.
 * SAFE: read-only first to report counts; pass --execute to delete.
 *
 * Usage:
 *   node scripts/clean-dead-data.mjs           # report only
 *   node scripts/clean-dead-data.mjs --execute # apply deletes
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const execute = process.argv.includes("--execute");

const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => {
    const eq = l.indexOf("=");
    return [l.slice(0, eq).trim(), l.slice(eq + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);

const url = env.DATABASE_URL || env.PG_URL || env.POSTGRES_URL;
const sql = postgres(url, { max: 1, onnotice: () => {} });

console.log(`Mode: ${execute ? "EXECUTE" : "REPORT-ONLY"}\n`);

try {
  // ─── 1. Stale 'running' rows on fire-and-forget tables ────────
  // Anything still 'running' after 1h is dead (sweeper marks at 30min).
  const ASYNC_TABLES = [
    { table: "monte_carlo_runs", statusCol: "status" },
    { table: "sqa_optimization_runs", statusCol: "status" },
    { table: "qubo_timing_runs", statusCol: "status" },
    { table: "tensor_predictions", statusCol: "status" },
    { table: "rl_training_runs", statusCol: "status" },
    { table: "quantum_mc_runs", statusCol: "status" },
    { table: "deepar_training_runs", statusCol: "status" },
    { table: "critic_optimization_runs", statusCol: "status" },
  ];

  console.log("=== STALE 'running' rows (> 1h old) ===");
  let totalStale = 0;
  for (const { table, statusCol } of ASYNC_TABLES) {
    try {
      const rows = await sql.unsafe(
        `SELECT count(*)::int AS c FROM "${table}" WHERE "${statusCol}" IN ('running','analyzing','replaying') AND created_at < NOW() - INTERVAL '1 hour'`,
      );
      const c = rows[0]?.c ?? 0;
      if (c > 0) {
        console.log(`  ${table}: ${c} stale rows`);
        totalStale += c;
        if (execute) {
          await sql.unsafe(
            `UPDATE "${table}" SET "${statusCol}" = 'failed' WHERE "${statusCol}" IN ('running','analyzing','replaying') AND created_at < NOW() - INTERVAL '1 hour'`,
          );
        }
      }
    } catch (e) {
      console.log(`  ${table}: skipped (${e.message.split("\n")[0].slice(0, 80)})`);
    }
  }
  if (totalStale === 0) console.log("  (none)");
  else if (execute) console.log(`  >> Marked ${totalStale} rows as 'failed'`);

  // ─── 2. Idempotency keys older than 24h ────────────────────────
  console.log("\n=== STALE idempotency_keys (> 24h old) ===");
  try {
    const r = await sql`SELECT count(*)::int AS c FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours'`;
    const c = r[0]?.c ?? 0;
    if (c > 0) {
      console.log(`  ${c} stale keys`);
      if (execute) {
        await sql`DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours'`;
        console.log(`  >> Deleted ${c} keys`);
      }
    } else console.log("  (none)");
  } catch (e) { console.log(`  skipped: ${e.message.slice(0, 80)}`); }

  // ─── 3. Resolved DLQ entries older than 7 days ─────────────────
  console.log("\n=== RESOLVED dead_letter_queue (> 7d old) ===");
  try {
    const r = await sql`SELECT count(*)::int AS c FROM dead_letter_queue WHERE resolved = true AND resolved_at < NOW() - INTERVAL '7 days'`;
    const c = r[0]?.c ?? 0;
    if (c > 0) {
      console.log(`  ${c} resolved DLQ rows to delete`);
      if (execute) {
        await sql`DELETE FROM dead_letter_queue WHERE resolved = true AND resolved_at < NOW() - INTERVAL '7 days'`;
        console.log(`  >> Deleted ${c} rows`);
      }
    } else console.log("  (none)");
  } catch (e) { console.log(`  skipped: ${e.message.slice(0, 80)}`); }

  // ─── 4. Orphan rows (FK targets gone) ─────────────────────────
  // Per audit Wave 4 #17 — many FKs were missing CASCADE before 0038a.
  // Check for any orphans that survived the migration.
  const ORPHAN_CHECKS = [
    { table: "backtests", fk: "strategy_id", parent: "strategies", parentPk: "id" },
    { table: "monte_carlo_runs", fk: "backtest_id", parent: "backtests", parentPk: "id" },
    { table: "walk_forward_windows", fk: "backtest_id", parent: "backtests", parentPk: "id" },
    { table: "stress_test_runs", fk: "backtest_id", parent: "backtests", parentPk: "id" },
    { table: "paper_sessions", fk: "strategy_id", parent: "strategies", parentPk: "id" },
    { table: "system_journal", fk: "strategy_id", parent: "strategies", parentPk: "id" },
    { table: "compliance_reviews", fk: "strategy_id", parent: "strategies", parentPk: "id" },
    { table: "skip_decisions", fk: "strategy_id", parent: "strategies", parentPk: "id" },
    { table: "tournament_results", fk: "backtest_id", parent: "backtests", parentPk: "id" },
    { table: "sqa_optimization_runs", fk: "backtest_id", parent: "backtests", parentPk: "id" },
    { table: "qubo_timing_runs", fk: "backtest_id", parent: "backtests", parentPk: "id" },
    { table: "tensor_predictions", fk: "backtest_id", parent: "backtests", parentPk: "id" },
    { table: "rl_training_runs", fk: "strategy_id", parent: "strategies", parentPk: "id" },
    { table: "critic_optimization_runs", fk: "strategy_id", parent: "strategies", parentPk: "id" },
    { table: "quantum_mc_runs", fk: "backtest_id", parent: "backtests", parentPk: "id" },
  ];

  console.log("\n=== ORPHAN FK rows ===");
  let totalOrphans = 0;
  for (const { table, fk, parent, parentPk } of ORPHAN_CHECKS) {
    try {
      const r = await sql.unsafe(
        `SELECT count(*)::int AS c FROM "${table}" t WHERE t."${fk}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${parent}" p WHERE p."${parentPk}" = t."${fk}")`,
      );
      const c = r[0]?.c ?? 0;
      if (c > 0) {
        console.log(`  ${table}.${fk} -> ${parent}: ${c} orphans`);
        totalOrphans += c;
        if (execute) {
          await sql.unsafe(
            `DELETE FROM "${table}" WHERE "${fk}" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "${parent}" p WHERE p."${parentPk}" = "${table}"."${fk}")`,
          );
          console.log(`    >> Deleted ${c} orphans`);
        }
      }
    } catch (e) { console.log(`  ${table}.${fk}: skipped (${e.message.split("\n")[0].slice(0, 80)})`); }
  }
  if (totalOrphans === 0) console.log("  (no orphans found — FK CASCADE from 0038a is working)");

  // ─── 5. Audit log archive (older than 90 days) ───────────────
  console.log("\n=== OLD audit_log entries (> 90 days) ===");
  try {
    const r = await sql`SELECT count(*)::int AS c FROM audit_log WHERE created_at < NOW() - INTERVAL '90 days'`;
    const c = r[0]?.c ?? 0;
    if (c > 0) {
      console.log(`  ${c} old audit rows (NOT deleting — audit is durable)`);
    } else console.log("  (none)");
  } catch (e) { console.log(`  skipped: ${e.message.slice(0, 80)}`); }

  console.log("\n" + (execute ? "EXECUTE COMPLETE" : "REPORT COMPLETE — re-run with --execute to apply deletes"));
} finally {
  await sql.end({ timeout: 5 });
}
