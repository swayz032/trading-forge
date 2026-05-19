/**
 * wave23-inspect-candidates.ts — inspect CANDIDATE strategies and their backtest state
 * Used to plan the Wave 23 Pass 2 graveyard sweep.
 */

import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { strategies, backtests, frankensteinTestRuns } from "../src/server/db/schema.js";
import { eq, desc, and, not, inArray } from "drizzle-orm";

const TERMINAL = ["GRAVEYARD", "RETIRED", "DEPLOYED", "DECLINING"];

async function main(): Promise<void> {
  const rows = await db.select({
    id: strategies.id,
    name: strategies.name,
    lifecycleState: strategies.lifecycleState,
    symbol: strategies.symbol,
    config: strategies.config,
  }).from(strategies).where(not(inArray(strategies.lifecycleState as any, TERMINAL)));

  console.log(`Active strategies: ${rows.length}`);
  for (const s of rows) {
    console.log(`\n  [${s.lifecycleState}] ${s.name} (${s.id}) symbol=${s.symbol}`);

    const [bt] = await db.select({
      id: backtests.id,
      status: backtests.status,
      sharpeRatio: backtests.sharpeRatio,
      profitFactor: backtests.profitFactor,
      gateResult: backtests.gateResult,
      resultExtras: backtests.resultExtras,
      walkForwardResults: backtests.walkForwardResults,
      createdAt: backtests.createdAt,
    }).from(backtests)
      .where(and(eq(backtests.strategyId, s.id), eq(backtests.status, "completed")))
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (bt) {
      const gateResult = bt.gateResult as Record<string, unknown> | null;
      const extras = bt.resultExtras as Record<string, unknown> | null;
      console.log(`    backtest_id=${bt.id} sharpe=${bt.sharpeRatio} pf=${bt.profitFactor}`);
      console.log(`    gateResult_keys=${gateResult ? Object.keys(gateResult).join(",") : "null"}`);
      if (gateResult?.components) {
        console.log(`    components=${JSON.stringify(gateResult.components)}`);
      }
      if (extras) {
        console.log(`    extras.expectancy_r=${(extras as any).expectancy_r ?? "absent"}`);
        console.log(`    extras.deflated_sharpe=${(extras as any).deflated_sharpe ?? "absent"}`);
      }

      const [frank] = await db.select({
        id: frankensteinTestRuns.id,
        passed: frankensteinTestRuns.passed,
        p95Sharpe: frankensteinTestRuns.p95Sharpe,
        medianPf: frankensteinTestRuns.medianPf,
        status: frankensteinTestRuns.status,
      }).from(frankensteinTestRuns)
        .where(eq(frankensteinTestRuns.backtestId, bt.id))
        .orderBy(desc(frankensteinTestRuns.createdAt))
        .limit(1);

      console.log(`    frankenstein=${frank ? JSON.stringify(frank) : "none"}`);
    } else {
      console.log(`    NO completed backtest`);

      // Check for running/pending backtests
      const [pendingBt] = await db.select({
        id: backtests.id,
        status: backtests.status,
        createdAt: backtests.createdAt,
      }).from(backtests)
        .where(eq(backtests.strategyId, s.id))
        .orderBy(desc(backtests.createdAt))
        .limit(1);

      if (pendingBt) {
        console.log(`    pending/running backtest: ${pendingBt.id} status=${pendingBt.status}`);
      }
    }
  }
}

main().catch(console.error).finally(() => process.exit(0));
