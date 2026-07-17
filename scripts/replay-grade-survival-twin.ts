/**
 * Wave 27 Pass 4 — B14 Survival Twin Disagreement Signal Test
 *
 * Statistical analysis layer (P4 — quantum-challenger sub-track).
 *
 * Joins quantum_mc_runs (survival_twin replay rows) × walk_forward_windows ×
 * backtests × backtest_trades (OOS slice only) to answer:
 *
 *   1. Does survival_twin breach probability predict OOS Sharpe degradation?
 *   2. Do Survival Twin and Pass A ruin_CI ci_high AGREE?
 *   3. Do Topstep-graded strategies fail differently than MFFU-graded ones?
 *
 * Emits a markdown report with:
 *   - Spearman ρ: survival_twin breach prob → OOS Sharpe degradation
 *   - Pearson r: cross-method agreement (survival_twin vs Pass A ci_high)
 *   - Mean absolute disagreement + better predictor on disagreement
 *   - Per-firm Mann-Whitney U test (Topstep vs MFFU)
 *   - Decision rule applied (SIGNAL / INCONCLUSIVE / NO_SIGNAL / PRELIMINARY)
 *
 * CLI:
 *   npx tsx scripts/replay-grade-survival-twin.ts            # dry-run (stdout only)
 *   npx tsx scripts/replay-grade-survival-twin.ts --apply    # writes markdown
 *   npx tsx scripts/replay-grade-survival-twin.ts --limit N  # analyze only N folds
 *
 * Pure-function library: src/server/lib/replay/survival-twin-disagreement.ts
 * Governance: does NOT write to quantum_mc_runs or any production table.
 * Exit 1 ONLY on purge violation or DB error.
 * Exit 0 on successful analysis regardless of verdict.
 *
 * Read-only by construction: this harness imports NO production service (see
 * imports below — only the pure-function
 * src/server/lib/replay/survival-twin-disagreement.ts library, plus
 * logger/fs/postgres). It reads PERSISTED `quantum_mc_runs` (survival_twin
 * replay rows) / `walk_forward_windows` / `backtest_trades` columns and
 * correlates historical OOS outcomes; it does NOT invoke or re-execute the
 * B14 Survival Twin service's CURRENT breach-probability logic. (deep-scan
 * Replay-F3, 2026-07-17 — clarifying scope after a sibling harness's
 * docstring was found overstating a "reanalyze via dryRun" behavior;
 * corrected across all 4 non-service-invoking harnesses for consistency.)
 * Practical effect: if the live survival-twin model changed after a graded
 * MC run executed, this harness's history reflects the OLD model, not
 * today's — it cannot detect that kind of logic-vs-history drift.
 *
 * Wave 27 Pass 4 — parallel-safe with Pass 2.F1/F2/F3 (zero file overlap).
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { logger } from "../src/server/lib/logger.js";
import {
  computeSpearman,
  applyDecisionRule,
  applyEmbargo,
  computeSharpeFromTrades,
  computeProfitFactor,
  checkPurgeViolation,
  SHARPE_DEGRADATION_FLOOR,
  EMBARGO_TRADING_DAYS,
  MIN_FOLDS_FOR_FULL_ANALYSIS,
  applySurvivalDecisionRule,
  computeCrossMethodAgreement,
  computePerFirmMannWhitney,
  buildSurvivalTwinReport,
  type SurvivalFoldMetrics,
  type SurvivalTwinAnalysisResult,
} from "../src/server/lib/replay/survival-twin-disagreement.js";

// Re-export for test files
export {
  computeSpearman,
  applySurvivalDecisionRule,
  computeCrossMethodAgreement,
  computePerFirmMannWhitney,
  buildSurvivalTwinReport,
  type SurvivalFoldMetrics,
  type SurvivalTwinAnalysisResult,
};

// ─── DB analysis pipeline ─────────────────────────────────────────────────────

/**
 * Core analysis function. Accepts a raw postgres SQL client.
 * Exported for integration testing.
 *
 * Governance: Read-only. Does NOT write to any table.
 */
export async function runSurvivalTwinAnalysis(
  sql: ReturnType<typeof postgres>,
  limitFolds?: number,
): Promise<SurvivalTwinAnalysisResult> {
  // Step 1: load survival_twin replay rows from quantum_mc_runs
  const replayRows = await sql<Array<{
    id: string;
    backtest_id: string;
    governance_labels: Record<string, unknown>;
    estimated_value: string | null;
    classical_value: string | null;
    tolerance_delta: string | null;
    reproducibility_hash: string | null;
    raw_result: Record<string, unknown> | null;
  }>>`
    SELECT
      id,
      backtest_id,
      governance_labels,
      estimated_value,
      classical_value,
      tolerance_delta,
      reproducibility_hash,
      raw_result
    FROM quantum_mc_runs
    WHERE governance_labels->>'survival_twin' = 'true'
      AND governance_labels->>'replay_mode' = 'true'
    ORDER BY created_at ASC
  `;

  logger.info(
    { count: replayRows.length },
    "replay-grade-survival-twin: replay rows loaded",
  );

  if (replayRows.length === 0) {
    logger.warn("replay-grade-survival-twin: no survival_twin replay rows found");
    return emptyAnalysis(0);
  }

  // Step 2: collect backtest IDs and build row map
  const backtestIds = [...new Set(replayRows.map(r => r.backtest_id))];

  // Build per-backtest replay row map (firm → row)
  const rowsByBacktest = new Map<string, typeof replayRows[0][]>();
  for (const row of replayRows) {
    if (!rowsByBacktest.has(row.backtest_id)) {
      rowsByBacktest.set(row.backtest_id, []);
    }
    rowsByBacktest.get(row.backtest_id)!.push(row);
  }

  // Step 3: load backtests for metadata
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

  // Step 4: load walk_forward_windows for these backtests
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
    WHERE backtest_id = ANY(${backtestIds})
  `;

  // Group WF rows by backtest
  const wfByBacktest = new Map<string, typeof wfRows[0][]>();
  for (const wf of wfRows) {
    if (!wfByBacktest.has(wf.backtest_id)) {
      wfByBacktest.set(wf.backtest_id, []);
    }
    wfByBacktest.get(wf.backtest_id)!.push(wf);
  }

  // Step 5: build survival fold metrics
  const folds: SurvivalFoldMetrics[] = [];
  let purgeViolationFound = false;
  let purgeViolationDetails = "";

  const allRows = limitFolds != null ? replayRows.slice(0, limitFolds * 2) : replayRows;

  for (const replayRow of allRows) {
    const backtest = backtestMap.get(replayRow.backtest_id);
    if (!backtest) {
      logger.debug(
        { backtestId: replayRow.backtest_id },
        "replay-grade-survival-twin: no backtest row for replay row — skipping",
      );
      continue;
    }

    const gov = replayRow.governance_labels;
    const firm = typeof gov.firm === "string" ? gov.firm : null;
    if (!firm) {
      logger.debug("replay-grade-survival-twin: replay row missing firm label — skipping");
      continue;
    }

    const rawResult = replayRow.raw_result;
    if (!rawResult) {
      logger.debug(
        { backtestId: replayRow.backtest_id },
        "replay-grade-survival-twin: no raw_result on replay row — skipping",
      );
      continue;
    }

    const metrics = rawResult.metrics as Record<string, unknown> | undefined;
    const survivalScore =
      typeof rawResult.survival_score === "number"
        ? rawResult.survival_score
        : null;
    const grade =
      typeof rawResult.grade === "string" ? rawResult.grade : "F";

    // Breach probability: estimated_value is mc_dd_breach_probability
    const survivalBreachProb =
      replayRow.estimated_value !== null
        ? parseFloat(replayRow.estimated_value)
        : null;

    if (survivalBreachProb === null || isNaN(survivalBreachProb)) {
      logger.debug(
        { backtestId: replayRow.backtest_id },
        "replay-grade-survival-twin: no breach probability — skipping",
      );
      continue;
    }

    // Pass A ruin_CI ci_high is stored as classical_value
    const passARuinCiHigh =
      replayRow.classical_value !== null
        ? parseFloat(replayRow.classical_value)
        : null;

    const crossMethodDisagreement =
      replayRow.tolerance_delta !== null
        ? parseFloat(replayRow.tolerance_delta)
        : null;

    // OOS Sharpe: find best WF window for this backtest
    const wfWindows = wfByBacktest.get(replayRow.backtest_id) ?? [];
    let bestWf: typeof wfRows[0] | null = null;
    for (const wf of wfWindows) {
      if (!wf.oos_start || !wf.oos_end || !wf.is_end || !wf.is_start) continue;

      const purgeViolation = checkPurgeViolation(wf.id, wf.is_end, wf.oos_start);
      if (purgeViolation) {
        purgeViolationFound = true;
        purgeViolationDetails = purgeViolation;
        break;
      }
      bestWf = wf;
      break;  // Use first valid fold per backtest
    }

    if (purgeViolationFound) break;

    let oosSharpe: number | null = null;
    let isSharpe: number | null = null;
    let sharpeDegradation: number | null = null;

    if (bestWf) {
      // IS Sharpe
      const isMetrics = bestWf.is_metrics;
      if (isMetrics && typeof isMetrics === "object" && "sharpe" in isMetrics
          && typeof isMetrics.sharpe === "number") {
        isSharpe = isMetrics.sharpe;
      } else if (backtest.sharpe_ratio !== null && backtest.sharpe_ratio !== undefined) {
        isSharpe = parseFloat(backtest.sharpe_ratio);
      }

      // Load OOS trades for this fold
      if (bestWf.oos_start && bestWf.oos_end) {
        const oosTrades = await sql<Array<{
          pnl: string | null;
          net_pnl: string | null;
          entry_time: Date;
        }>>`
          SELECT pnl, net_pnl, entry_time
          FROM backtest_trades
          WHERE backtest_id = ${replayRow.backtest_id}
            AND entry_time >= ${new Date(bestWf.oos_start)}::timestamp
            AND entry_time <= ${new Date(bestWf.oos_end)}::timestamp
          ORDER BY entry_time ASC
        `;

        const tradeList = oosTrades.map(t => ({
          entryTime: t.entry_time,
          pnl: t.pnl !== null
            ? parseFloat(t.pnl)
            : (t.net_pnl !== null ? parseFloat(t.net_pnl) : 0),
        }));

        const embargoedTrades = applyEmbargo(
          tradeList, bestWf.oos_start, EMBARGO_TRADING_DAYS,
        );

        if (embargoedTrades.length >= 2) {
          const pnls = embargoedTrades.map(t => t.pnl);
          oosSharpe = computeSharpeFromTrades(pnls);
        }
      }

      if (oosSharpe !== null && isSharpe !== null) {
        sharpeDegradation = oosSharpe - isSharpe;
      }
    }

    // Normalize firm to Title Case for consistency
    const firmNormalized =
      firm === "topstep" ? "Topstep"
      : firm === "mffu" ? "MFFU"
      : firm;

    folds.push({
      replayRowId: replayRow.id,
      backtest_id: replayRow.backtest_id,
      strategyId: backtest.strategy_id,
      firm: firmNormalized,
      survivalBreachProb,
      survivalScore: survivalScore ?? 0,
      grade,
      passARuinCiHigh: (passARuinCiHigh !== null && !isNaN(passARuinCiHigh))
        ? passARuinCiHigh
        : null,
      crossMethodDisagreement: (crossMethodDisagreement !== null && !isNaN(crossMethodDisagreement))
        ? crossMethodDisagreement
        : null,
      oosSharpe,
      isSharpe,
      sharpeDegradation,
    });
  }

  if (purgeViolationFound) {
    logger.error(
      { details: purgeViolationDetails },
      "replay-grade-survival-twin: PURGE VIOLATION — exiting with code 1",
    );
    console.error(`\n[FATAL] ${purgeViolationDetails}`);
    console.error("[FATAL] Purge violation detected — oos_start must be strictly after is_end.");
    process.exit(1);
  }

  const n = folds.length;
  const isPreliminary = n < MIN_FOLDS_FOR_FULL_ANALYSIS;

  // Spearman: survival_breach_prob → OOS Sharpe degradation
  const foldsWithOos = folds.filter(f => f.sharpeDegradation !== null);
  const breachProbs = foldsWithOos.map(f => f.survivalBreachProb);
  const degradations = foldsWithOos.map(f => f.sharpeDegradation as number);

  const { rho: spearmanRho, pValue: spearmanPValue } = computeSpearman(
    breachProbs,
    degradations,
  );

  // Cross-method agreement
  const crossMethodAgreement = computeCrossMethodAgreement(
    folds, SHARPE_DEGRADATION_FLOOR,
  );

  // Per-firm Mann-Whitney
  const mannWhitney = computePerFirmMannWhitney(folds);

  // Firm distributions
  const firmDistributions = ["Topstep", "MFFU"].map(firm => ({
    firm,
    survivingScores: folds
      .filter(f => f.firm === firm)
      .map(f => f.survivalScore),
    oosSharpes: folds
      .filter(f => f.firm === firm && f.oosSharpe !== null)
      .map(f => f.oosSharpe as number),
    n: folds.filter(f => f.firm === firm).length,
  }));

  const verdict = applySurvivalDecisionRule(spearmanRho, spearmanPValue, foldsWithOos.length);

  // Scorer git SHA range from raw_result
  const shaValues = replayRows
    .map(r => {
      const raw = r.raw_result;
      if (!raw) return null;
      const sha = raw.scorer_git_sha;
      return typeof sha === "string" && sha.length > 0 ? sha : null;
    })
    .filter((s): s is string => s !== null)
    .sort();

  const scorerGitShaRange = {
    min: shaValues[0] ?? "unavailable",
    max: shaValues[shaValues.length - 1] ?? "unavailable",
  };

  return {
    replayRowsQueried: replayRows.length,
    validFolds: foldsWithOos.length,
    isPreliminary,
    spearmanRho,
    spearmanPValue,
    crossMethodAgreement,
    mannWhitney,
    firmDistributions,
    verdict,
    scorerGitShaRange,
    folds,
  };
}

function emptyAnalysis(replayRowsQueried: number): SurvivalTwinAnalysisResult {
  return {
    replayRowsQueried,
    validFolds: 0,
    isPreliminary: true,
    spearmanRho: 0,
    spearmanPValue: 1.0,
    crossMethodAgreement: {
      pearsonR: 0,
      meanAbsDisagreement: 0,
      n: 0,
      betterPredictorOnDisagreement: "insufficient_data",
    },
    mannWhitney: null,
    firmDistributions: [
      { firm: "Topstep", survivingScores: [], oosSharpes: [], n: 0 },
      { firm: "MFFU", survivingScores: [], oosSharpes: [], n: 0 },
    ],
    verdict: "PRELIMINARY",
    scorerGitShaRange: { min: "unavailable", max: "unavailable" },
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

  console.log("=== REPLAY-GRADE-SURVIVAL-TWIN — Wave 27 Pass 4 Analysis ===");
  if (!applyMode) {
    console.log("(Dry-run mode: no markdown file written. Pass --apply to write report.)");
  }
  if (limitFolds !== undefined) {
    console.log(`(Limit mode: analyzing at most ${limitFolds} strategy-folds)`);
  }
  console.log();

  const sql = postgres(process.env.DATABASE_URL);

  let analysis: SurvivalTwinAnalysisResult;
  try {
    analysis = await runSurvivalTwinAnalysis(sql, limitFolds);
  } catch (err) {
    logger.error({ err }, "replay-grade-survival-twin: DB error during analysis");
    console.error("[ERROR] DB error during analysis:", err);
    await sql.end();
    process.exit(1);
  }

  await sql.end();

  const report = buildSurvivalTwinReport(analysis, isoDate);

  // Always print to stdout
  console.log(report);

  console.log("\n=== Summary ===");
  console.log(`Replay rows analyzed      : ${analysis.replayRowsQueried}`);
  console.log(`Strategy-folds valid      : ${analysis.validFolds}`);
  console.log(`Spearman rho              : ${analysis.spearmanRho.toFixed(4)}`);
  console.log(`Spearman p-value          : ${analysis.spearmanPValue.toFixed(4)}`);
  console.log(`Cross-method Pearson r    : ${analysis.crossMethodAgreement.pearsonR.toFixed(4)}`);
  console.log(`Mean abs disagreement     : ${analysis.crossMethodAgreement.meanAbsDisagreement.toFixed(4)}`);
  if (analysis.mannWhitney) {
    console.log(
      `Mann-Whitney p-value      : ${analysis.mannWhitney.pValue.toFixed(4)} (Topstep vs MFFU)`,
    );
  }
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
      outputPath = path.join(
        repoRoot, "docs", "replay-results",
        `${isoDate}-survival-twin-disagreement.md`,
      );
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
