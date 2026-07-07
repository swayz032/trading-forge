/**
 * Wave 27 Pass 1 — Quantum Disagreement Signal Test
 *
 * Statistical analysis layer (P1.A3 — critic-optimizer sub-track).
 *
 * Joins quantum_mc_runs replay rows × walk_forward_windows × backtests ×
 * backtest_trades (OOS slice only) to answer:
 *
 *   Does IAE-vs-classical disagreement at IS folds predict OOS Sharpe degradation?
 *
 * Emits a markdown report with:
 *   - Spearman rank correlation: IS disagreement vs OOS Sharpe degradation
 *   - Binomial test at IS-selected threshold
 *   - Threshold robustness table (all 5 candidates)
 *   - Decision rule applied
 *
 * CLI:
 *   npx tsx scripts/replay-grade-quantum.ts            # dry-run (stdout only)
 *   npx tsx scripts/replay-grade-quantum.ts --apply    # writes markdown to docs/replay-results/
 *   npx tsx scripts/replay-grade-quantum.ts --limit N  # analyze only N strategy-folds
 *   npx tsx scripts/replay-grade-quantum.ts --output <path>   # custom output path
 *
 * Pure-function library:  src/server/lib/replay/quantum-disagreement.ts
 * Governance: does NOT write to quantum_mc_runs or any production table.
 * Exit 1 ONLY on purge violation (oos_start <= is_end) or DB error.
 * Exit 0 on successful analysis regardless of verdict.
 *
 * Source commits: A1=5b42697, A2=e94fc3d
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { logger } from "../src/server/lib/logger.js";
import {
  THRESHOLD_CANDIDATES,
  EMBARGO_TRADING_DAYS,
  SHARPE_DEGRADATION_FLOOR,
  applyDecisionRule,
  applyEmbargo,
  binomialTestPValue,
  buildMarkdownReport,
  checkPurgeViolation,
  computeProfitFactor,
  computeReplayDisagreement,
  computeSharpeFromTrades,
  computeSpearman,
  selectThresholdFromIS,
  type AnalysisResult,
  type FoldMetrics,
  type ThresholdResult,
} from "../src/server/lib/replay/quantum-disagreement.js";

// Re-export for test files that import from this script (legacy compat)
export {
  applyDecisionRule,
  applyEmbargo,
  binomialTestPValue,
  buildMarkdownReport,
  checkPurgeViolation,
  computeProfitFactor,
  computeReplayDisagreement,
  computeSharpeFromTrades,
  computeSpearman,
  selectThresholdFromIS,
  type AnalysisResult,
  type FoldMetrics,
  type ThresholdResult,
};

// ─── DB analysis pipeline ─────────────────────────────────────────────────────

/**
 * Core analysis function. Accepts a raw postgres SQL client.
 * Exported for integration testing with a real or mock DB.
 */
export async function runAnalysis(
  sql: ReturnType<typeof postgres>,
  limitFolds?: number,
): Promise<AnalysisResult> {
  // Step 1: load replay rows from quantum_mc_runs WHERE replay_mode = true
  const replayRows = await sql<Array<{
    id: string;
    backtest_id: string;
    governance_labels: Record<string, unknown>;
    estimated_value: string | null;
    classical_value: string | null;
    tolerance_delta: string | null;
    reproducibility_hash: string | null;
  }>>`
    SELECT
      id,
      backtest_id,
      governance_labels,
      estimated_value,
      classical_value,
      tolerance_delta,
      reproducibility_hash
    FROM quantum_mc_runs
    WHERE governance_labels->>'replay_mode' = 'true'
    ORDER BY created_at ASC
  `;

  logger.info({ count: replayRows.length }, "replay-grade-quantum: replay rows loaded");

  if (replayRows.length === 0) {
    logger.warn("replay-grade-quantum: no replay rows found — analysis not possible");
    return emptyAnalysis(0);
  }

  // Step 2: extract fold IDs from governance_labels.cpcv_fold
  const foldIds = replayRows
    .map(r => {
      const gov = r.governance_labels;
      return typeof gov.cpcv_fold === "string" ? gov.cpcv_fold : null;
    })
    .filter((id): id is string => id !== null);

  if (foldIds.length === 0) {
    logger.warn("replay-grade-quantum: no replay rows with cpcv_fold — cannot join to walk_forward_windows");
    return emptyAnalysis(replayRows.length);
  }

  // Build replay-by-fold map
  const replayByFold = new Map<string, typeof replayRows[0][]>();
  for (const row of replayRows) {
    const gov = row.governance_labels;
    const foldId = typeof gov.cpcv_fold === "string" ? gov.cpcv_fold : null;
    if (!foldId) continue;
    if (!replayByFold.has(foldId)) replayByFold.set(foldId, []);
    replayByFold.get(foldId)!.push(row);
  }

  // Step 3: load walk_forward_windows for these fold IDs
  const wfRows = await sql<Array<{
    id: string;
    backtest_id: string;
    is_start: string | null;
    is_end: string | null;
    oos_start: string | null;
    oos_end: string | null;
    is_metrics: Record<string, unknown> | null;
  }>>`
    SELECT
      id,
      backtest_id,
      is_start,
      is_end,
      oos_start,
      oos_end,
      is_metrics
    FROM walk_forward_windows
    WHERE id = ANY(${foldIds})
  `;

  // Step 4: load backtests for the relevant backtest IDs
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

  // Step 5: build fold metrics
  const folds: FoldMetrics[] = [];
  let purgeViolationFound = false;
  let purgeViolationDetails = "";

  const wfToProcess = limitFolds != null ? wfRows.slice(0, limitFolds) : wfRows;

  for (const wf of wfToProcess) {
    if (!wf.oos_start || !wf.oos_end || !wf.is_end || !wf.is_start) {
      logger.debug({ foldId: wf.id }, "replay-grade-quantum: skipping fold with null date bounds");
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
      logger.debug({ foldId: wf.id, backtestId: wf.backtest_id }, "replay-grade-quantum: no backtest row for fold");
      continue;
    }

    // IS Sharpe: prefer is_metrics.sharpe, else backtest.sharpe_ratio
    const isMetrics = wf.is_metrics;
    let isSharpe: number;
    if (isMetrics && typeof isMetrics === "object" && "sharpe" in isMetrics && typeof isMetrics.sharpe === "number") {
      isSharpe = isMetrics.sharpe;
    } else if (backtest.sharpe_ratio !== null && backtest.sharpe_ratio !== undefined) {
      isSharpe = parseFloat(backtest.sharpe_ratio);
    } else {
      logger.debug({ foldId: wf.id }, "replay-grade-quantum: no IS sharpe for fold — skipping");
      continue;
    }

    // Disagreement metric for this fold (mean across breach+ruin event types)
    const foldReplayRows = replayByFold.get(wf.id) ?? [];
    if (foldReplayRows.length === 0) {
      logger.debug({ foldId: wf.id }, "replay-grade-quantum: no replay rows for fold — skipping");
      continue;
    }

    const disagreements = foldReplayRows
      .map(r => {
        const q = r.estimated_value !== null ? parseFloat(r.estimated_value) : null;
        const c = r.classical_value !== null ? parseFloat(r.classical_value) : null;
        if (q === null || c === null) return null;
        // Gap 2 fix (2026-07-06): was `Math.abs(q - c) / Math.max(c, 1e-6)` —
        // drifted from Python's `abs(q - c) / max(abs(c), 1e-6)` (quantum_replay.py:374-376)
        // by omitting abs() on the denominator. Now delegates to the shared,
        // parity-pinned computeReplayDisagreement() helper.
        return computeReplayDisagreement(q, c);
      })
      .filter((d): d is number => d !== null);

    if (disagreements.length === 0) {
      logger.debug({ foldId: wf.id }, "replay-grade-quantum: no valid disagreement values for fold");
      continue;
    }

    const disagreement = disagreements.reduce((a, b) => a + b, 0) / disagreements.length;

    // Load OOS trades
    const oosTrades = await sql<Array<{
      pnl: string | null;
      net_pnl: string | null;
      entry_time: Date;
    }>>`
      SELECT pnl, net_pnl, entry_time
      FROM backtest_trades
      WHERE backtest_id = ${wf.backtest_id}
        AND entry_time >= ${new Date(wf.oos_start)}::timestamp
        AND entry_time <= ${new Date(wf.oos_end)}::timestamp
      ORDER BY entry_time ASC
    `;

    // Apply embargo (first 1 trading day of OOS window)
    const tradeList = oosTrades.map(t => ({
      entryTime: t.entry_time,
      pnl: t.pnl !== null ? parseFloat(t.pnl) : (t.net_pnl !== null ? parseFloat(t.net_pnl) : 0),
    }));

    const embargoedTrades = applyEmbargo(tradeList, wf.oos_start, EMBARGO_TRADING_DAYS);

    if (embargoedTrades.length < 2) {
      logger.debug({ foldId: wf.id }, "replay-grade-quantum: insufficient OOS trades after embargo");
      continue;
    }

    const pnls = embargoedTrades.map(t => t.pnl);
    const oosSharpe = computeSharpeFromTrades(pnls);
    const oosProfitFactor = computeProfitFactor(pnls);
    const oosAvgR = pnls.reduce((a, b) => a + b, 0) / pnls.length;

    folds.push({
      foldId: wf.id,
      backtestId: wf.backtest_id,
      strategyId: backtest.strategy_id,
      isStart: wf.is_start,
      isEnd: wf.is_end,
      oosStart: wf.oos_start,
      oosEnd: wf.oos_end,
      isSharpe,
      disagreement,
      oosSharpe,
      oosProfitFactor,
      oosAvgR,
      sharpeDegradation: oosSharpe - isSharpe,
    });
  }

  if (purgeViolationFound) {
    logger.error({ details: purgeViolationDetails }, "replay-grade-quantum: PURGE VIOLATION — exiting with code 1");
    console.error(`\n[FATAL] ${purgeViolationDetails}`);
    console.error("[FATAL] Purge violation detected — oos_start must be strictly after is_end.");
    console.error("[FATAL] This violates the CPCV contract. Fix the data before re-running.");
    process.exit(1);
  }

  // Step 6: statistical tests
  const n = folds.length;
  const isPreliminary = n < 50; // MIN_FOLDS_FOR_FULL_ANALYSIS
  const disagreementValues = folds.map(f => f.disagreement);
  const sharpeDegradations = folds.map(f => f.sharpeDegradation);

  const { rho: spearmanRho, pValue: spearmanPValue } = computeSpearman(
    disagreementValues,
    sharpeDegradations,
  );

  // IS-only threshold selection (uses only IS disagreement values)
  const selectedThreshold = selectThresholdFromIS(disagreementValues, THRESHOLD_CANDIDATES);

  // Binomial test at IS-selected threshold (evaluated on OOS)
  const firingFolds = folds.filter(f => f.disagreement > selectedThreshold);
  const degradedFolds = firingFolds.filter(
    f => f.oosSharpe - f.isSharpe <= -SHARPE_DEGRADATION_FLOOR,
  );
  const binomialN = firingFolds.length;
  const binomialObservedRate = binomialN > 0 ? degradedFolds.length / binomialN : 0;
  const binomialPValue = binomialN > 0
    ? binomialTestPValue(degradedFolds.length, binomialN, 0.5)
    : 1.0;

  // Threshold robustness table
  const thresholdResults: ThresholdResult[] = THRESHOLD_CANDIDATES.map(threshold => {
    const firing = folds.filter(f => f.disagreement > threshold);
    const degraded = firing.filter(
      f => f.oosSharpe - f.isSharpe <= -SHARPE_DEGRADATION_FLOOR,
    );
    const rate = firing.length > 0 ? degraded.length / firing.length : 0;
    const pv = firing.length > 0
      ? binomialTestPValue(degraded.length, firing.length, 0.5)
      : 1.0;
    return { threshold, isFoldsFiring: firing.length, oosDegradationRate: rate, binomialPValue: pv };
  });

  const verdict = applyDecisionRule(
    spearmanRho,
    spearmanPValue,
    n,
    binomialObservedRate,
    binomialPValue,
  );

  const hashes = replayRows
    .map(r => r.reproducibility_hash)
    .filter((h): h is string => h !== null && h.length > 0)
    .sort();
  const hashRange = {
    min: hashes[0] ?? "none",
    max: hashes[hashes.length - 1] ?? "none",
  };

  return {
    replayRowsQueried: replayRows.length,
    validFolds: n,
    spearmanRho,
    spearmanPValue,
    selectedThreshold,
    binomialObservedRate,
    binomialPValue,
    binomialN,
    thresholdResults,
    verdict,
    isPreliminary,
    reproducibilityHashRange: hashRange,
    folds,
  };
}

function emptyAnalysis(replayRowsQueried: number): AnalysisResult {
  return {
    replayRowsQueried,
    validFolds: 0,
    spearmanRho: 0,
    spearmanPValue: 1.0,
    selectedThreshold: 0.10,
    binomialObservedRate: 0,
    binomialPValue: 1.0,
    binomialN: 0,
    thresholdResults: THRESHOLD_CANDIDATES.map(t => ({
      threshold: t,
      isFoldsFiring: 0,
      oosDegradationRate: 0,
      binomialPValue: 1.0,
    })),
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
    process.exit(1);
  }

  const isoDate = new Date().toISOString().split("T")[0];

  console.log("=== REPLAY-GRADE-QUANTUM — Wave 27 Pass 1 Statistical Analysis ===");
  if (!applyMode) {
    console.log("(Dry-run mode: no markdown file written. Pass --apply to write report.)");
  }
  if (limitFolds !== undefined) {
    console.log(`(Limit mode: analyzing at most ${limitFolds} strategy-folds)`);
  }
  console.log();

  const sql = postgres(process.env.DATABASE_URL);

  let analysis: AnalysisResult;
  try {
    analysis = await runAnalysis(sql, limitFolds);
  } catch (err) {
    logger.error({ err }, "replay-grade-quantum: DB error during analysis");
    console.error("[ERROR] DB error during analysis:", err);
    await sql.end();
    process.exit(1);
  }

  await sql.end();

  const report = buildMarkdownReport(analysis, isoDate);

  // Always print to stdout
  console.log(report);

  console.log("=== Summary ===");
  console.log(`Replay rows analyzed      : ${analysis.replayRowsQueried}`);
  console.log(`Strategy-folds valid      : ${analysis.validFolds}`);
  console.log(`Spearman rho              : ${analysis.spearmanRho.toFixed(4)}`);
  console.log(`Spearman p-value          : ${analysis.spearmanPValue.toFixed(4)}`);
  console.log(`Selected threshold (IS)   : ${analysis.selectedThreshold.toFixed(2)}`);
  console.log(`Binomial rate (OOS)       : ${(analysis.binomialObservedRate * 100).toFixed(1)}%`);
  console.log(`Verdict                   : ${analysis.verdict}`);
  console.log();

  if (applyMode) {
    let outputPath: string;
    if (customOutput) {
      outputPath = customOutput;
    } else {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const repoRoot = path.join(__dirname, "..");
      outputPath = path.join(repoRoot, "docs", "replay-results", `${isoDate}-quantum-disagreement.md`);
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
