/**
 * apply-pending-migrations.ts
 * Wave 26 Group B — applies pending SQL migrations directly when drizzle-kit
 * has already tracked them but the DB column is still missing.
 *
 * All migration SQLs are idempotent (IF NOT EXISTS / CREATE TABLE IF NOT EXISTS)
 * so running multiple times is safe.
 */
import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "..");
const migrationsDir = resolve(PROJECT_ROOT, "src/server/db/migrations");

const toApply = [
  "0135_strategies_confluence_scoring.sql",
  "0136_b15_parameter_robustness.sql",
  "0137_bias_state_htf_narrative.sql",
  "0138_strategies_5tf_hierarchy.sql",
  "0139_pre_market_institutional_expansion.sql",
  "0140_liquidity_levels.sql",
  "0141_trade_critique.sql",
  "0142_regime_expansion.sql",
  "0143_bias_state_narrative.sql",
  "0144_strategies_adaptive_exits.sql",
  "0145_paper_positions_exit_plan.sql",
];

async function main(): Promise<void> {
  for (const file of toApply) {
    let content: string;
    try {
      content = readFileSync(resolve(migrationsDir, file), "utf-8");
    } catch (e) {
      console.error(`Cannot read ${file}: ${(e as Error).message}`);
      continue;
    }

    // Strip comments, split on semicolons, filter empty
    const stmts = content
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 2);

    console.log(`Applying ${file} (${stmts.length} statements)...`);
    for (const stmt of stmts) {
      try {
        await db.execute(sql.raw(stmt + ";"));
      } catch (e: unknown) {
        const msg = (e as Error).message ?? String(e);
        if (msg.includes("already exists")) {
          console.log(`  already exists — OK`);
        } else if (msg.includes("does not exist")) {
          console.log(`  does not exist — skip: ${msg.slice(0, 120)}`);
        } else {
          console.error(`  ERROR in stmt: ${stmt.slice(0, 60)}...`);
          console.error(`  ${msg.slice(0, 200)}`);
        }
      }
    }
    console.log(`  ${file} done.`);
  }

  // Verify key columns
  const ec = await db.execute(
    sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'strategies' AND column_name = 'exit_plan_config'`
  );
  const exitPlanColPresent = Array.isArray(ec) ? ec.length > 0 : ((ec as Record<string, unknown[]>).rows ?? []).length > 0;
  console.log(`\nexit_plan_config column present: ${exitPlanColPresent ? "YES" : "NO"}`);

  await db.execute(sql`SELECT 1`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration runner failed:", err);
  process.exit(1);
});
