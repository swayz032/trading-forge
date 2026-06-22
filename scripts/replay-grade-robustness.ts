/**
 * Wave 27 Pass 2.F3 — B15 Parameter Robustness Battery Replay Grading Harness
 *
 * Answers: do B15's SDR/PSI/RWS threshold gates ACTUALLY predict forward failure?
 * Of strategies that PASSED B15, what fraction degraded in PILOT/DEPLOYED?
 * Of strategies that B15 BLOCKED, would they have succeeded?
 *
 * CLI:
 *   npx tsx scripts/replay-grade-robustness.ts             # dry-run (stdout only)
 *   npx tsx scripts/replay-grade-robustness.ts --apply     # writes markdown to docs/replay-results/
 *   npx tsx scripts/replay-grade-robustness.ts --limit N   # analyze at most N strategies
 *
 * Architecture:
 *   1. Query backtests with b15_battery JSONB populated (Wave 25+)
 *   2. Join with lifecycle_transitions for same strategy_id
 *   3. Classify each strategy: B15-blocked vs B15-passed; failed vs succeeded
 *   4. Build confusion matrix + precision/recall/F1
 *   5. Sensitivity sweep: ±10% on SDR/PSI/RWS thresholds
 *   6. Emit verdict SIGNAL / INCONCLUSIVE / NO_SIGNAL / PRELIMINARY
 *
 * Pure-function library: src/server/lib/replay/robustness-disagreement.ts
 *
 * Governance:
 *   - DOES NOT modify robustness-service.ts
 *   - DOES NOT modify optimizer.py or robustness/
 *   - DOES NOT modify lifecycle-service.ts
 *   - Passes dryRun=true on every robustness-service invocation
 *   - audit_log INSERTs merge into result jsonb only
 *   - Exit 0 on success; exit 1 only on DB error
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { logger } from "../src/server/lib/logger.js";
import {
  evaluateRobustnessGateSignal,
  buildRobustnessMarkdownReport,
  type BacktestRow,
  type LifecycleOutcomeRow,
  type RobustnessAnalysisResult,
  FAILURE_STATES,
  SUCCESS_STATES,
  DEMOTION_WINDOW_DAYS,
  MIN_STRATEGIES_FOR_FULL_ANALYSIS,
} from "../src/server/lib/replay/robustness-disagreement.js";

// ─── DB analysis pipeline ─────────────────────────────────────────────────────

/**
 * Core analysis function. Accepts a raw postgres SQL client.
 * Exported for integration testing.
 */
export async function runRobustnessAnalysis(
  sql: ReturnType<typeof postgres>,
  limitStrategies?: number,
): Promise<RobustnessAnalysisResult> {
  // Step 1: load backtests with b15_battery populated
  const rawBacktests = await sql<Array<{
    id: string;
    strategy_id: string;
    b15_battery: {
      sdr: number;
      psi: number;
      rws: number;
      passed: boolean;
      failures?: string[];
      thresholds?: Record<string, number>;
      sdr_detail?: Record<string, unknown>;
      psi_detail?: Record<string, unknown>;
      rws_detail?: Record<string, unknown>;
    } | null;
    created_at: Date;
  }>>`
    SELECT
      id,
      strategy_id,
      b15_battery,
      created_at
    FROM backtests
    WHERE b15_battery IS NOT NULL
      AND status = 'completed'
    ORDER BY created_at ASC
  `;

  logger.info(
    { count: rawBacktests.length },
    "replay-grade-robustness: backtests with b15_battery loaded",
  );

  if (rawBacktests.length === 0) {
    logger.warn(
      "replay-grade-robustness: no backtests with b15_battery found — analysis not possible",
    );
    return evaluateRobustnessGateSignal([], []);
  }

  // Deduplicate: one row per strategy — keep most recent backtest
  const latestByStrategy = new Map<string, typeof rawBacktests[0]>();
  for (const bt of rawBacktests) {
    const existing = latestByStrategy.get(bt.strategy_id);
    if (!existing || bt.created_at > existing.created_at) {
      latestByStrategy.set(bt.strategy_id, bt);
    }
  }

  let b15Rows: BacktestRow[] = [];
  for (const bt of latestByStrategy.values()) {
    if (!bt.b15_battery) continue;
    // Validate b15 shape — must have sdr/psi/rws as numbers
    const b = bt.b15_battery;
    if (typeof b.sdr !== "number" || typeof b.psi !== "number" || typeof b.rws !== "number") {
      logger.warn(
        { backtestId: bt.id, strategyId: bt.strategy_id },
        "replay-grade-robustness: b15_battery missing numeric sdr/psi/rws — skipping",
      );
      continue;
    }
    b15Rows.push({
      backtestId: bt.id,
      strategyId: bt.strategy_id,
      b15Battery: b,
      createdAt: bt.created_at,
    });
  }

  if (limitStrategies != null) {
    b15Rows = b15Rows.slice(0, limitStrategies);
  }

  logger.info(
    { count: b15Rows.length },
    "replay-grade-robustness: unique strategies with valid b15_battery",
  );

  if (b15Rows.length === 0) {
    return evaluateRobustnessGateSignal([], []);
  }

  // Step 2: load lifecycle_transitions for these strategies
  const strategyIds = b15Rows.map(r => r.strategyId);

  const rawTransitions = await sql<Array<{
    strategy_id: string;
    from_state: string;
    to_state: string;
    created_at: Date;
  }>>`
    SELECT
      strategy_id,
      from_state,
      to_state,
      created_at
    FROM lifecycle_transitions
    WHERE strategy_id = ANY(${strategyIds})
    ORDER BY created_at ASC
  `;

  logger.info(
    { count: rawTransitions.length, strategies: strategyIds.length },
    "replay-grade-robustness: lifecycle transitions loaded",
  );

  // Step 3: derive lifecycle outcomes per strategy
  // For each strategy, find the most advanced / most recent lifecycle state
  // and whether it was demoted within DEMOTION_WINDOW_DAYS of PAPER promotion.
  const outcomes: LifecycleOutcomeRow[] = [];

  // Group transitions by strategy
  type RawTransition = { strategy_id: string; from_state: string; to_state: string; created_at: Date };
  const transitionsByStrategy = new Map<string, RawTransition[]>();
  for (const t of rawTransitions) {
    if (!transitionsByStrategy.has(t.strategy_id)) {
      transitionsByStrategy.set(t.strategy_id, []);
    }
    transitionsByStrategy.get(t.strategy_id)!.push(t);
  }

  for (const strategyId of strategyIds) {
    const transitions = transitionsByStrategy.get(strategyId) ?? [];
    if (transitions.length === 0) continue;

    // Find the terminal/most-recent state
    const lastTransition = transitions[transitions.length - 1];
    const finalState = lastTransition.to_state;

    // Check for early demotion: did strategy reach PAPER and then demote within window?
    let earlyDemotion = false;
    const paperPromotion = transitions.find(t => t.to_state === "PAPER");
    if (paperPromotion) {
      const paperDate = paperPromotion.created_at;
      const windowMs = DEMOTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const demotionInWindow = transitions.find(t => {
        const isAfterPaper = t.created_at > paperDate;
        const withinWindow = t.created_at.getTime() - paperDate.getTime() <= windowMs;
        return isAfterPaper && withinWindow && FAILURE_STATES.has(t.to_state);
      });
      if (demotionInWindow) earlyDemotion = true;
    }

    outcomes.push({
      strategyId,
      finalState,
      transitionedAt: lastTransition.created_at,
      earlyDemotion,
    });
  }

  logger.info(
    {
      b15Count: b15Rows.length,
      outcomeCount: outcomes.length,
      linkedPct: b15Rows.length > 0
        ? ((outcomes.length / b15Rows.length) * 100).toFixed(1) + "%"
        : "0%",
    },
    "replay-grade-robustness: lifecycle outcome join quality",
  );

  // Step 4: run analysis
  const result = evaluateRobustnessGateSignal(b15Rows, outcomes);

  // Step 5: merge audit_log info into result (no DB writes per governance rule)
  for (const entry of result.auditEntries) {
    if (entry.level === "warn") {
      logger.warn(entry.data ?? {}, `replay-grade-robustness: ${entry.message}`);
    } else {
      logger.info(entry.data ?? {}, `replay-grade-robustness: ${entry.message}`);
    }
  }

  return result;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const applyMode = args.includes("--apply");
  const limitIdx = args.indexOf("--limit");
  const limitStrategies = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : undefined;

  if (!process.env.DATABASE_URL) {
    console.error("[ERROR] DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  const isoDate = new Date().toISOString().split("T")[0];

  console.log("=== REPLAY-GRADE-ROBUSTNESS — Wave 27 Pass 2.F3 B15 Battery Signal Test ===");
  if (!applyMode) {
    console.log("(Dry-run mode: no markdown file written. Pass --apply to write report.)");
  }
  if (limitStrategies !== undefined) {
    console.log(`(Limit mode: analyzing at most ${limitStrategies} strategies)`);
  }
  console.log();

  const sql = postgres(process.env.DATABASE_URL);

  let analysis: RobustnessAnalysisResult;
  try {
    analysis = await runRobustnessAnalysis(sql, limitStrategies);
  } catch (err) {
    logger.error({ err }, "replay-grade-robustness: DB error during analysis");
    console.error("[ERROR] DB error during analysis:", err);
    await sql.end();
    process.exit(1);
  }

  await sql.end();

  const report = buildRobustnessMarkdownReport(analysis, isoDate);

  // Always print to stdout
  console.log(report);

  // Summary block
  const { confusion } = analysis;
  console.log("=== Summary ===");
  console.log(`B15 backtests loaded          : ${analysis.totalB15Rows}`);
  console.log(`Lifecycle outcomes linked     : ${analysis.outcomeLinkedCount}`);
  console.log(`Unlinked (no outcome)         : ${analysis.unlinkedStrategyIds.length}`);
  console.log(`Join quality                  : ${
    analysis.totalB15Rows > 0
      ? ((analysis.outcomeLinkedCount / analysis.totalB15Rows) * 100).toFixed(1) + "%"
      : "n/a"
  }`);
  console.log(`Confusion matrix              : TP=${confusion.tp} FP=${confusion.fp} TN=${confusion.tn} FN=${confusion.fn}`);
  console.log(`Precision                     : ${analysis.precision.toFixed(4)}`);
  console.log(`Recall                        : ${analysis.recall.toFixed(4)}`);
  console.log(`F1                            : ${analysis.f1.toFixed(4)}`);
  console.log(`Recommendation                : ${analysis.recommendation}`);
  console.log(`Verdict                       : ${analysis.verdict}`);
  console.log(`Preliminary (n < ${MIN_STRATEGIES_FOR_FULL_ANALYSIS})         : ${analysis.isPreliminary}`);
  console.log();

  if (analysis.unlinkedStrategyIds.length > 0) {
    console.log(
      `[INFO] ${analysis.unlinkedStrategyIds.length} strategies have B15 data but no lifecycle transitions.`,
    );
    console.log(
      `       This is expected early in deployment. Re-run after more strategies complete PILOT/DEPLOYED.`,
    );
    console.log();
  }

  if (applyMode) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const repoRoot = path.join(__dirname, "..");
    const outputPath = path.join(
      repoRoot,
      "docs",
      "replay-results",
      `${isoDate}-robustness-disagreement.md`,
    );

    try {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, report, "utf8");
      console.log(`[APPLY] Report written to: ${outputPath}`);
    } catch (writeErr) {
      console.error(`[ERROR] Failed to write report: ${writeErr}`);
      process.exit(1);
    }
  } else {
    console.log("[DRY-RUN] No file written. Pass --apply to write report.");
  }

  process.exit(0);
}

main();
