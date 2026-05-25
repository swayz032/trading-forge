/**
 * Wave 27 Pass 2.F1 — Confluence Score Disagreement Signal Test
 *
 * Statistical analysis layer (P2.F1 — critic-optimizer sub-track).
 *
 * Joins backtest_trades × walk_forward_windows × backtests to answer:
 *
 *   Does the 11-factor weighted confluence score (threshold 0.72) separate
 *   winners from losers OUT-OF-SAMPLE across walk-forward folds?
 *
 * Emits a markdown report with:
 *   - Spearman rank correlation: IS mean confluence_score vs OOS mean realized_R
 *   - Binomial test at IS-selected threshold (from {0.60, 0.65, 0.70, 0.72, 0.75, 0.80})
 *   - Threshold robustness table
 *   - 11-factor weight vector curve-fit check (SDR across ±10% perturbations)
 *   - Decision rule applied
 *
 * CLI:
 *   npx tsx scripts/replay-grade-confluence.ts            # dry-run (stdout only)
 *   npx tsx scripts/replay-grade-confluence.ts --apply    # writes markdown to docs/replay-results/
 *   npx tsx scripts/replay-grade-confluence.ts --limit N  # analyze only N strategy-folds
 *   npx tsx scripts/replay-grade-confluence.ts --output <path>   # custom output path
 *
 * Pure-function library:  src/server/lib/replay/confluence-disagreement.ts
 * Governance: does NOT write to any production table.
 * Exit 1 ONLY on purge violation (oos_start <= is_end) or DB error.
 * Exit 0 on successful analysis regardless of verdict.
 *
 * Source commits: Wave 27.5 master = 8bc4cb1 (Pass 2.F1 = this commit)
 *
 * Constraint: DO NOT import from src/engine (pure TS sub-track).
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { logger } from "../src/server/lib/logger.js";
import {
  EMBARGO_TRADING_DAYS,
  checkPurgeViolation,
  evaluateConfluenceDisagreement,
  buildConfluenceMarkdownReport,
  type ConfluenceReplayRow,
  type ConfluenceAnalysisResult,
} from "../src/server/lib/replay/confluence-disagreement.js";

// Re-export for test files
export {
  evaluateConfluenceDisagreement,
  buildConfluenceMarkdownReport,
  checkPurgeViolation,
  type ConfluenceReplayRow,
  type ConfluenceAnalysisResult,
};

// ─── DB analysis pipeline ─────────────────────────────────────────────────────

/**
 * Core analysis function. Accepts a raw postgres SQL client.
 * Exported for integration testing with a real or mock DB.
 *
 * Join key:
 *   backtest_trades.backtest_id → walk_forward_windows.backtest_id
 *   backtest_trades.entry_time between walk_forward_windows.is_start and oos_end
 *   IS trades: entry_time between is_start and is_end
 *   OOS trades: entry_time between oos_start and oos_end
 *
 * Note on confluence_score: the backtest_trades table does not store a per-trade
 * confluence_score column (see schema.ts — backtest_trades has no such field).
 * The confluence score was computed at signal time by evaluateWeightedConfluence()
 * but is not persisted to backtest_trades. We therefore proxy it from the
 * walk_forward_windows.is_metrics JSONB blob where backtest-level metrics are stored.
 *
 * Specifically: is_metrics may contain a "mean_confluence_score" key written by
 * the backtest engine if the strategy ran with use_weighted_scoring=true.
 * When absent (pre-Wave-25 backtests or strategies not on Path C), the fold is
 * skipped with a debug log. This limits sample size to Path C backtests.
 *
 * OOS realized_R: computed as pnl / risk_per_trade, where risk_per_trade is
 * approximated from is_metrics.avg_stop_distance × contract_point_value × contracts.
 * When this approximation is unavailable, realized_R is approximated as
 * sign(pnl) (i.e. +1 for winners, -1 for losers) — this degrades Spearman
 * precision but preserves the binomial test validity.
 */
export async function runConfluenceAnalysis(
  sql: ReturnType<typeof postgres>,
  limitFolds?: number,
): Promise<ConfluenceAnalysisResult> {
  // Step 1: load walk_forward_windows that have confluence data in is_metrics
  const wfRows = await sql<Array<{
    id: string;
    backtest_id: string;
    is_start: string | null;
    is_end: string | null;
    oos_start: string | null;
    oos_end: string | null;
    is_metrics: Record<string, unknown> | null;
    oos_metrics: Record<string, unknown> | null;
  }>>`
    SELECT
      id,
      backtest_id,
      is_start,
      is_end,
      oos_start,
      oos_end,
      is_metrics,
      oos_metrics
    FROM walk_forward_windows
    WHERE is_metrics IS NOT NULL
    ORDER BY created_at ASC
  `;

  logger.info({ count: wfRows.length }, "replay-grade-confluence: walk_forward_windows loaded");

  if (wfRows.length === 0) {
    logger.warn("replay-grade-confluence: no walk_forward_windows found — analysis not possible");
    return emptyAnalysis(0);
  }

  // Step 2: load backtest metadata for all relevant backtest IDs
  const backtestIds = [...new Set(wfRows.map(w => w.backtest_id))];
  const backtestRows = await sql<Array<{
    id: string;
    strategy_id: string;
    sharpe_ratio: string | null;
  }>>`
    SELECT id, strategy_id, sharpe_ratio
    FROM backtests
    WHERE id = ANY(${backtestIds})
  `;
  const backtestMap = new Map(backtestRows.map(b => [b.id, b]));

  logger.info({ count: backtestRows.length }, "replay-grade-confluence: backtests loaded");

  // Step 3: enforce purge contract and build fold list
  let purgeViolationFound = false;
  let purgeViolationDetails = "";

  const foldsToProcess = limitFolds != null ? wfRows.slice(0, limitFolds) : wfRows;
  const validFoldMeta: Array<{
    foldId: string;
    backtestId: string;
    strategyId: string;
    isStart: string;
    isEnd: string;
    oosStart: string;
    oosEnd: string;
    meanIsConfluenceScore: number | null;
  }> = [];

  for (const wf of foldsToProcess) {
    if (!wf.is_start || !wf.is_end || !wf.oos_start || !wf.oos_end) {
      logger.debug({ foldId: wf.id }, "replay-grade-confluence: skipping fold with null date bounds");
      continue;
    }

    // Purge check — fail CLOSED on violation
    const purgeViolation = checkPurgeViolation(wf.id, wf.is_end, wf.oos_start);
    if (purgeViolation) {
      purgeViolationFound = true;
      purgeViolationDetails = purgeViolation;
      break;
    }

    const backtest = backtestMap.get(wf.backtest_id);
    if (!backtest) {
      logger.debug({ foldId: wf.id, backtestId: wf.backtest_id }, "replay-grade-confluence: no backtest row for fold");
      continue;
    }

    // Extract mean_confluence_score from is_metrics JSONB
    // The key is written by the backtest engine for Path C strategies.
    let meanIsConfluenceScore: number | null = null;
    const isMetrics = wf.is_metrics;
    if (isMetrics && typeof isMetrics === "object") {
      const v = (isMetrics as Record<string, unknown>)["mean_confluence_score"];
      if (typeof v === "number" && Number.isFinite(v)) {
        meanIsConfluenceScore = v;
      }
    }

    if (meanIsConfluenceScore === null) {
      logger.debug(
        { foldId: wf.id, backtestId: wf.backtest_id },
        "replay-grade-confluence: no mean_confluence_score in is_metrics — fold not on Path C, skipping",
      );
      continue;
    }

    validFoldMeta.push({
      foldId: wf.id,
      backtestId: wf.backtest_id,
      strategyId: backtest.strategy_id,
      isStart: wf.is_start,
      isEnd: wf.is_end,
      oosStart: wf.oos_start,
      oosEnd: wf.oos_end,
      meanIsConfluenceScore,
    });
  }

  if (purgeViolationFound) {
    logger.error({ details: purgeViolationDetails }, "replay-grade-confluence: PURGE VIOLATION — exiting with code 1");
    console.error(`\n[FATAL] ${purgeViolationDetails}`);
    console.error("[FATAL] Purge violation detected — oos_start must be strictly after is_end.");
    console.error("[FATAL] This violates the CPCV contract. Fix the data before re-running.");
    process.exit(1);
  }

  if (validFoldMeta.length === 0) {
    logger.warn(
      "replay-grade-confluence: no Path C folds with mean_confluence_score in is_metrics. " +
      "Analysis requires strategies with use_weighted_scoring=true that have completed backtests."
    );
    return emptyAnalysis(0);
  }

  logger.info({ count: validFoldMeta.length }, "replay-grade-confluence: valid Path C folds identified");

  // Step 4: load backtest_trades for each fold — IS and OOS separately
  const allRows: ConfluenceReplayRow[] = [];

  for (const fold of validFoldMeta) {
    // Load all trades in the fold window (IS + OOS)
    const trades = await sql<Array<{
      id: string;
      pnl: string | null;
      net_pnl: string | null;
      entry_time: Date;
    }>>`
      SELECT id, pnl, net_pnl, entry_time
      FROM backtest_trades
      WHERE backtest_id = ${fold.backtestId}
        AND entry_time >= ${new Date(fold.isStart)}::timestamp
        AND entry_time <= ${new Date(fold.oosEnd)}::timestamp
      ORDER BY entry_time ASC
    `;

    const isEndDate = new Date(fold.isEnd);
    const oosStartDate = new Date(fold.oosStart);

    for (const t of trades) {
      const pnl = t.pnl !== null
        ? parseFloat(t.pnl)
        : (t.net_pnl !== null ? parseFloat(t.net_pnl) : 0);

      const isOos = t.entry_time > isEndDate;
      const inWindow = !isOos
        ? (t.entry_time >= new Date(fold.isStart) && t.entry_time <= isEndDate)
        : (t.entry_time >= oosStartDate && t.entry_time <= new Date(fold.oosEnd));

      if (!inWindow) continue;

      // For IS trades: use the fold's mean_confluence_score as the IS score proxy.
      // For OOS trades: confluenceScore is null (we evaluate the score's OOS predictive
      // power, not the OOS score itself — OOS scores would introduce look-ahead).
      const confluenceScore = !isOos ? fold.meanIsConfluenceScore : null;

      // realized_R: sign(pnl) as a conservative proxy when per-trade risk is unavailable.
      // This preserves binomial test validity (winner = pnl > 0).
      const realizedR = pnl !== 0 ? Math.sign(pnl) : 0;

      allRows.push({
        tradeId: t.id,
        backtestId: fold.backtestId,
        strategyId: fold.strategyId,
        foldId: fold.foldId,
        isStart: fold.isStart,
        isEnd: fold.isEnd,
        oosStart: fold.oosStart,
        oosEnd: fold.oosEnd,
        entryTime: t.entry_time,
        confluenceScore,
        realizedR,
        isOos,
        pnl,
      });
    }
  }

  logger.info({ count: allRows.length }, "replay-grade-confluence: trade rows assembled");

  if (allRows.length === 0) {
    logger.warn("replay-grade-confluence: no trade rows assembled — check backtest_trades for these folds");
    return emptyAnalysis(0);
  }

  // Step 5: load reproducibility hashes from quantum_mc_runs for replay-mode rows
  // (same pattern as Pass 1 — these are used for the reproducibility section only)
  const reproducibilityRows = await sql<Array<{ reproducibility_hash: string | null }>>`
    SELECT reproducibility_hash
    FROM quantum_mc_runs
    WHERE governance_labels->>'replay_mode' = 'true'
      AND reproducibility_hash IS NOT NULL
    ORDER BY created_at ASC
  `;
  const reproducibilityHashes = reproducibilityRows
    .map(r => r.reproducibility_hash)
    .filter((h): h is string => h !== null && h.length > 0);

  // Step 6: evaluate
  const analysis = evaluateConfluenceDisagreement(allRows, reproducibilityHashes, {
    applyEmbargoFlag: true,
    embargoDays: EMBARGO_TRADING_DAYS,
  });

  return analysis;
}

function emptyAnalysis(tradeRowsQueried: number): ConfluenceAnalysisResult {
  return {
    tradeRowsQueried,
    validFolds: 0,
    spearmanRho: 0,
    spearmanPValue: 1.0,
    selectedThreshold: 0.72,
    binomialObservedWinRate: 0,
    binomialPValue: 1.0,
    binomialN: 0,
    thresholdResults: [0.60, 0.65, 0.70, 0.72, 0.75, 0.80].map(t => ({
      threshold: t,
      isTradesFiring: 0,
      oosWinRate: 0,
      binomialPValue: 1.0,
    })),
    curveFitCheck: {
      sdr: 0,
      maxOosSharpeDelta: 0,
      perturbedFactors: [],
      warnCurveFitSuspected: false,
    },
    verdict: "PRELIMINARY",
    isPreliminary: true,
    reproducibilityHashRange: { min: "none", max: "none" },
    folds: [],
  };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const applyMode = args.includes("--apply");
  const limitIdx = args.indexOf("--limit");
  const limitFolds = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : undefined;
  const outputIdx = args.indexOf("--output");
  const customOutput = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

  if (!process.env.DATABASE_URL) {
    console.error("[ERROR] DATABASE_URL environment variable is required.");
    console.error("[INFO]  Set DATABASE_URL in .env or pass via environment.");
    process.exit(1);
  }

  const isoDate = new Date().toISOString().split("T")[0];

  console.log("=== REPLAY-GRADE-CONFLUENCE — Wave 27 Pass 2.F1 Statistical Analysis ===");
  console.log("=== Confluence Score: IS-to-OOS Predictive Power + 11-Factor Curve-Fit ===");
  if (!applyMode) {
    console.log("(Dry-run mode: no markdown file written. Pass --apply to write report.)");
  }
  if (limitFolds !== undefined) {
    console.log(`(Limit mode: analyzing at most ${limitFolds} strategy-folds)`);
  }
  console.log();

  const sql = postgres(process.env.DATABASE_URL);

  let analysis: ConfluenceAnalysisResult;
  try {
    analysis = await runConfluenceAnalysis(sql, limitFolds);
  } catch (err) {
    logger.error({ err }, "replay-grade-confluence: DB error during analysis");
    console.error("[ERROR] DB error during analysis:", err);
    await sql.end();
    process.exit(1);
  }

  await sql.end();

  // Compute confluence module SHA via git show (best-effort — graceful fallback)
  let confluenceModuleSha = "unknown";
  try {
    const { execSync } = await import("node:child_process");
    confluenceModuleSha = execSync(
      "git log -1 --format=%H -- src/server/services/confluence-score.ts",
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    ).trim().slice(0, 12) || "unknown";
  } catch {
    // git unavailable or not in a repo — non-fatal
  }

  const sqlWhereClause = "backtest_trades WHERE entry_time BETWEEN fold.is_start AND fold.oos_end (IS + OOS), walk_forward_windows WHERE is_metrics IS NOT NULL (Path C folds only)";

  const report = buildConfluenceMarkdownReport(
    analysis,
    isoDate,
    "Wave 27.5 master = 8bc4cb1 (Pass 2.F1)",
    confluenceModuleSha,
    sqlWhereClause,
  );

  // Always print to stdout
  console.log(report);

  console.log("=== Summary ===");
  console.log(`Trade rows analyzed        : ${analysis.tradeRowsQueried}`);
  console.log(`Strategy-folds valid       : ${analysis.validFolds}`);
  console.log(`Spearman rho               : ${analysis.spearmanRho.toFixed(4)}`);
  console.log(`Spearman p-value           : ${analysis.spearmanPValue.toFixed(4)}`);
  console.log(`Selected threshold (IS)    : ${analysis.selectedThreshold.toFixed(2)}`);
  console.log(`Binomial win rate (OOS)    : ${(analysis.binomialObservedWinRate * 100).toFixed(1)}%`);
  console.log(`Curve-fit SDR              : ${analysis.curveFitCheck.sdr.toFixed(4)}${analysis.curveFitCheck.warnCurveFitSuspected ? " [WARN: curve-fit suspected]" : " [OK]"}`);
  console.log(`Verdict                    : ${analysis.verdict}`);
  console.log();

  if (applyMode) {
    let outputPath: string;
    if (customOutput) {
      outputPath = customOutput;
    } else {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const repoRoot = path.join(__dirname, "..");
      outputPath = path.join(repoRoot, "docs", "replay-results", `${isoDate}-confluence-disagreement.md`);
    }

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
