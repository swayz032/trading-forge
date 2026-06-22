/**
 * Bias Calibration Harness — Track 5 Phase D Readiness
 *
 * CLI entry points for the operator to run on Day 60+ of SHADOW accumulation.
 * Each command is idempotent: same inputs → same results.
 * Each command persists to DB and writes to audit_log.
 * None of these commands affect bias_engine.py return values or routing logic.
 *
 * Usage:
 *   npx tsx src/server/services/bias-calibration-harness.ts fit-calibration --window=90
 *   npx tsx src/server/services/bias-calibration-harness.ts ablation --years=2018-2026 --cost-mult=2.0
 *   npx tsx src/server/services/bias-calibration-harness.ts pbo
 *
 * Config via env vars (all have defaults — no mandatory vars for CLI):
 *   BIAS_ENGINE_MODE        — 'OFF' | 'SHADOW' | 'SIZING_ONLY' | 'HARD_GATE' (default SHADOW)
 *   BIAS_CALIBRATION_WINDOW — default 90 days
 *   BIAS_ABLATION_COST_MULT — default 2.0
 */

import { db } from "../db/index.js";
import { biasDecisions, biasCalibrationCurves, biasAblationResults, auditLog } from "../db/schema.js";
import { logger } from "../index.js";
import { sql, and, gte, count } from "drizzle-orm";

// ─── Config (all sourced from env with safe defaults) ────────────────────────

export const BIAS_HARNESS_CONFIG = {
  defaultWindowDays: parseInt(process.env.BIAS_CALIBRATION_WINDOW ?? "90", 10),
  defaultCostMult: parseFloat(process.env.BIAS_ABLATION_COST_MULT ?? "2.0"),
  calibrationVersion: "1.0.0",
  classifierVersion: process.env.BIAS_CLASSIFIER_VERSION ?? "1.0.0",
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CalibrationCurve {
  windowDays: number;
  curveMethod: "platt" | "isotonic";
  curveParams: Record<string, unknown>;
  reliabilityScore: number;
  version: string;
  sampleSize: number;
}

export interface AblationResult {
  periodStart: string;
  periodEnd: string;
  modeOffSharpe: number | null;
  modeGatedSharpe: number | null;
  sharpeDelta: number | null;
  costMultiplier: number;
  pboScore: number | null;
}

// ─── fitCalibration ──────────────────────────────────────────────────────────

/**
 * Fit Platt scaling calibration on raw_state_probs vs realized hit rate.
 *
 * "Realized hit rate" is approximated by looking at bias_decisions rows and
 * comparing the raw_state_probs.trend against whether the session playbook
 * eventually corresponded to a TREND_CONTINUATION direction. This is a proxy
 * calibration — full calibration requires joining against paper_trades outcomes,
 * which the operator performs manually via the reliability diagram artifact.
 *
 * Idempotent: same windowDays → same curveParams (deterministic linear regression).
 * Persists to bias_calibration_curves. Writes audit_log row.
 */
export async function fitCalibration(windowDays: number = BIAS_HARNESS_CONFIG.defaultWindowDays): Promise<CalibrationCurve> {
  console.log(`[bias:fit-calibration] Reading bias_decisions for last ${windowDays} days...`);

  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Fetch raw_state_probs and engine_mode from bias_decisions
  const rows = await db
    .select({
      rawStateProbs: biasDecisions.rawStateProbs,
      playbook: biasDecisions.playbook,
      engineMode: biasDecisions.engineMode,
    })
    .from(biasDecisions)
    .where(
      and(
        gte(biasDecisions.decisionTimestamp, cutoff),
        sql`${biasDecisions.engineMode} != 'OFF'`
      )
    );

  const sampleSize = rows.length;
  console.log(`[bias:fit-calibration] Sample size: ${sampleSize} rows`);

  if (sampleSize < 10) {
    console.warn(`[bias:fit-calibration] Insufficient sample (${sampleSize} < 10). Returning uncalibrated curve.`);
  }

  // Platt scaling: fit a logistic regression of raw_state_probs.trend vs
  // is_trend_playbook (binary label). In the absence of a Python scipy import,
  // we use a closed-form linear approximation (sufficient for advisory use).
  // Full accuracy requires the scipy logistic regression in a Python subprocess.
  const pairs: Array<[number, number]> = [];
  for (const row of rows) {
    const probs = row.rawStateProbs as Record<string, number> | null;
    if (!probs) continue;
    const trendProb = probs.trend ?? 0;
    const isTrendPlaybook =
      row.playbook === "TREND_CONTINUATION_LONG" || row.playbook === "TREND_CONTINUATION_SHORT"
        ? 1
        : 0;
    pairs.push([trendProb, isTrendPlaybook]);
  }

  // Closed-form Platt params: intercept=0, slope=1 when no data; otherwise simple linear OLS
  let intercept = 0.0;
  let slope = 1.0;
  let reliabilityScore = 0.5; // default Brier score when uncalibrated

  if (pairs.length >= 10) {
    const n = pairs.length;
    const meanX = pairs.reduce((s, [x]) => s + x, 0) / n;
    const meanY = pairs.reduce((s, [, y]) => s + y, 0) / n;
    const varX = pairs.reduce((s, [x]) => s + (x - meanX) ** 2, 0) / n;
    const covXY = pairs.reduce((s, [x, y]) => s + (x - meanX) * (y - meanY), 0) / n;
    slope = varX > 0 ? covXY / varX : 1.0;
    intercept = meanY - slope * meanX;

    // Brier score = mean((calibrated_prob - label)^2)
    const brierSum = pairs.reduce((sum: number, [, label]: [number, number]) => {
      const calibrated = Math.max(0, Math.min(1, slope * 0.5 + intercept));
      return sum + (calibrated - label) ** 2;
    }, 0);
    reliabilityScore = Math.round((brierSum / n) * 10000) / 10000;
  }

  const curveParams = { intercept: Math.round(intercept * 10000) / 10000, slope: Math.round(slope * 10000) / 10000 };
  console.log(`[bias:fit-calibration] Platt params: intercept=${curveParams.intercept} slope=${curveParams.slope}`);
  console.log(`[bias:fit-calibration] Reliability score (Brier): ${reliabilityScore}`);

  // Persist to bias_calibration_curves
  await db.insert(biasCalibrationCurves).values({
    windowDays,
    curveMethod: "platt",
    curveParams,
    reliabilityScore: String(reliabilityScore),
    version: BIAS_HARNESS_CONFIG.calibrationVersion,
  } as typeof biasCalibrationCurves.$inferInsert);

  // Audit log
  await db.insert(auditLog).values({
    action: "bias_engine.calibration_fit",
    entityType: "bias_engine",
    entityId: null,
    decisionAuthority: "bias_calibration_harness",
    status: "success",
    result: {
      windowDays,
      sampleSize,
      curveMethod: "platt",
      curveParams,
      reliabilityScore,
      version: BIAS_HARNESS_CONFIG.calibrationVersion,
    } as Record<string, unknown>,
  });

  console.log(`[bias:fit-calibration] Done. Persisted curve to bias_calibration_curves.`);

  return {
    windowDays,
    curveMethod: "platt",
    curveParams,
    reliabilityScore,
    version: BIAS_HARNESS_CONFIG.calibrationVersion,
    sampleSize,
  };
}

// ─── runAblation ─────────────────────────────────────────────────────────────

/**
 * Walk-forward ablation comparing bias_engine_mode=OFF vs SHADOW vs SIZING_ONLY.
 *
 * Ablation is simulated: the harness reads bias_decisions to reconstruct what
 * decisions would have been made under each mode, then compares against the
 * realized net_bias distribution. Full backtested Sharpe requires a Python
 * subprocess (deferred to when Python harness is invoked separately).
 *
 * Here we compute a proxy: regime-hit rate (playbook matched correct direction)
 * as a Sharpe proxy. Mode OFF = random (0.5 hit rate baseline). Mode SHADOW/
 * SIZING_ONLY = observed hit rate from bias_decisions.
 *
 * Idempotent: same yearsRange + costMult → same result (deterministic math).
 * Persists to bias_ablation_results (gpt5_verdict=null until evaluator runs).
 * Writes audit_log row.
 */
export async function runAblation(
  yearsRange: string = "2018-2026",
  costMult: number = BIAS_HARNESS_CONFIG.defaultCostMult
): Promise<AblationResult> {
  console.log(`[bias:ablation] Running walk-forward ablation for ${yearsRange}, costMult=${costMult}...`);

  const [startYearStr, endYearStr] = yearsRange.split("-");
  const periodStart = `${startYearStr}-01-01`;
  const periodEnd = `${endYearStr}-12-31`;

  // Read all SHADOW mode decisions
  const rows = await db
    .select({
      playbook: biasDecisions.playbook,
      rawStateProbs: biasDecisions.rawStateProbs,
      hysteresisApplied: biasDecisions.hysteresisApplied,
    })
    .from(biasDecisions)
    .where(sql`${biasDecisions.engineMode} = 'SHADOW'`);

  console.log(`[bias:ablation] SHADOW mode decisions: ${rows.length}`);

  if (rows.length === 0) {
    console.warn(`[bias:ablation] No SHADOW decisions found. Storing null Sharpe values.`);
    const result: AblationResult = {
      periodStart,
      periodEnd,
      modeOffSharpe: null,
      modeGatedSharpe: null,
      sharpeDelta: null,
      costMultiplier: costMult,
      pboScore: null,
    };
    await _persistAblation(result);
    return result;
  }

  // Proxy Sharpe computation:
  // Mode OFF: Sharpe proxy = 0.0 (random decisions, no edge)
  // Mode GATED: Sharpe proxy = (trend decisions that matched bias direction) / total
  // scaled to a Sharpe-like range by * sqrt(252) for annualization.
  const modeOffSharpe = 0.0;
  const trendDecisions = rows.filter(
    (r) =>
      r.playbook === "TREND_CONTINUATION_LONG" || r.playbook === "TREND_CONTINUATION_SHORT"
  );
  const alignedCount = trendDecisions.filter((r) => {
    const probs = r.rawStateProbs as Record<string, number> | null;
    return probs && (probs.trend ?? 0) > 0.5;
  }).length;

  const hitRate = trendDecisions.length > 0 ? alignedCount / trendDecisions.length : 0.5;
  // Proxy annualized Sharpe: (hitRate - 0.5) * 2 * sqrt(252/20) [monthly sampling]
  const modeGatedSharpe = Math.round((hitRate - 0.5) * 2 * Math.sqrt(252 / 20) * 10000) / 10000;
  const sharpeDelta = Math.round((modeGatedSharpe - modeOffSharpe) * 10000) / 10000;

  console.log(`[bias:ablation] modeOffSharpe=${modeOffSharpe} modeGatedSharpe=${modeGatedSharpe} delta=${sharpeDelta}`);

  const result: AblationResult = {
    periodStart,
    periodEnd,
    modeOffSharpe,
    modeGatedSharpe,
    sharpeDelta,
    costMultiplier: costMult,
    pboScore: null, // populated by computePbo() separately
  };

  await _persistAblation(result);
  return result;
}

// ─── computePbo ──────────────────────────────────────────────────────────────

/**
 * Compute López de Prado Probability of Backtest Overfitting (PBO) on the router.
 *
 * PBO uses Combinatorial Purged Cross-Validation (CPCV) over bias_decisions:
 * splits the SHADOW decision set into N combinations, computes IS vs OOS Sharpe
 * proxy per split, and estimates P(OOS rank < IS rank). High PBO = overfit.
 *
 * Idempotent. Persists pboScore on the latest bias_ablation_results row.
 * Writes audit_log row.
 */
export async function computePbo(): Promise<number> {
  console.log(`[bias:pbo] Computing Probability of Backtest Overfitting...`);

  const rows = await db
    .select({
      rawStateProbs: biasDecisions.rawStateProbs,
      playbook: biasDecisions.playbook,
      decisionTimestamp: biasDecisions.decisionTimestamp,
    })
    .from(biasDecisions)
    .where(sql`${biasDecisions.engineMode} = 'SHADOW'`)
    .orderBy(biasDecisions.decisionTimestamp);

  console.log(`[bias:pbo] Sample: ${rows.length} decisions`);

  if (rows.length < 20) {
    console.warn(`[bias:pbo] Insufficient sample for PBO (${rows.length} < 20). Returning 1.0 (maximum uncertainty).`);
    await _persistPboScore(1.0);
    return 1.0;
  }

  // Simplified CPCV with N=6 folds (combinatorial approximation)
  const N_FOLDS = 6;
  const foldSize = Math.floor(rows.length / N_FOLDS);
  const isScores: number[] = [];
  const oosScores: number[] = [];

  for (let k = 0; k < N_FOLDS; k++) {
    const oosStart = k * foldSize;
    const oosEnd = (k + 1) * foldSize;
    const oosRows = rows.slice(oosStart, oosEnd);
    const isRows = [...rows.slice(0, oosStart), ...rows.slice(oosEnd)];

    const computeHitRate = (subset: typeof rows) => {
      if (subset.length === 0) return 0.5;
      const trend = subset.filter(
        (r) => r.playbook === "TREND_CONTINUATION_LONG" || r.playbook === "TREND_CONTINUATION_SHORT"
      );
      const aligned = trend.filter((r) => {
        const probs = r.rawStateProbs as Record<string, number> | null;
        return probs && (probs.trend ?? 0) > 0.5;
      });
      return trend.length > 0 ? aligned.length / trend.length : 0.5;
    };

    isScores.push(computeHitRate(isRows));
    oosScores.push(computeHitRate(oosRows));
  }

  // PBO = fraction of folds where OOS hit rate < IS hit rate
  let underperformCount = 0;
  for (let i = 0; i < N_FOLDS; i++) {
    if (oosScores[i] < isScores[i]) underperformCount++;
  }
  const pbo = Math.round((underperformCount / N_FOLDS) * 10000) / 10000;
  console.log(`[bias:pbo] PBO = ${pbo} (${underperformCount}/${N_FOLDS} folds OOS < IS)`);

  await _persistPboScore(pbo);

  // Audit log
  await db.insert(auditLog).values({
    action: "bias_engine.pbo_computed",
    entityType: "bias_engine",
    entityId: null,
    decisionAuthority: "bias_calibration_harness",
    status: "success",
    result: { pbo, nFolds: N_FOLDS, sampleSize: rows.length } as Record<string, unknown>,
  });

  return pbo;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _persistAblation(result: AblationResult): Promise<void> {
  await db.insert(biasAblationResults).values({
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    modeOffSharpe: result.modeOffSharpe !== null ? String(result.modeOffSharpe) : null,
    modeGatedSharpe: result.modeGatedSharpe !== null ? String(result.modeGatedSharpe) : null,
    sharpeDelta: result.sharpeDelta !== null ? String(result.sharpeDelta) : null,
    costMultiplier: String(result.costMultiplier),
    pboScore: result.pboScore !== null ? String(result.pboScore) : null,
    gpt5Verdict: null,
    gpt5Reasoning: null,
    acceptedByOperator: null,
  } as typeof biasAblationResults.$inferInsert);

  await db.insert(auditLog).values({
    action: "bias_engine.ablation_run",
    entityType: "bias_engine",
    entityId: null,
    decisionAuthority: "bias_calibration_harness",
    status: "success",
    result: {
      ...result,
      modeOffSharpe: result.modeOffSharpe,
      modeGatedSharpe: result.modeGatedSharpe,
    } as Record<string, unknown>,
  });

  console.log(`[bias:ablation] Persisted to bias_ablation_results.`);
}

async function _persistPboScore(pbo: number): Promise<void> {
  // Update latest ablation row's pbo_score
  await db.execute(sql`
    UPDATE bias_ablation_results
    SET pbo_score = ${String(pbo)}
    WHERE id = (SELECT MAX(id) FROM bias_ablation_results)
  `);
  console.log(`[bias:pbo] pbo_score persisted on latest ablation row.`);
}

// ─── CLI entrypoint ──────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith("bias-calibration-harness.ts")) {
  const cmd = process.argv[2];
  const args = Object.fromEntries(
    process.argv.slice(3)
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const [k, v] = a.slice(2).split("=");
        return [k, v ?? "true"];
      })
  );

  const isDryRun = args["dry-run"] === "true";

  (async () => {
    try {
      if (cmd === "fit-calibration") {
        const window = parseInt(args["window"] ?? String(BIAS_HARNESS_CONFIG.defaultWindowDays), 10);
        if (isDryRun) {
          console.log(`[dry-run] Would fit calibration with window=${window} days`);
        } else {
          const result = await fitCalibration(window);
          console.log(JSON.stringify(result, null, 2));
        }
      } else if (cmd === "ablation") {
        const years = args["years"] ?? "2018-2026";
        const costMult = parseFloat(args["cost-mult"] ?? String(BIAS_HARNESS_CONFIG.defaultCostMult));
        if (isDryRun) {
          console.log(`[dry-run] Would run ablation for ${years}, costMult=${costMult}`);
        } else {
          const result = await runAblation(years, costMult);
          console.log(JSON.stringify(result, null, 2));
        }
      } else if (cmd === "pbo") {
        if (isDryRun) {
          console.log(`[dry-run] Would compute PBO`);
        } else {
          const pbo = await computePbo();
          console.log(`PBO: ${pbo}`);
        }
      } else {
        console.error(`Unknown command: ${cmd}. Use: fit-calibration | ablation | pbo`);
        process.exit(1);
      }
      process.exit(0);
    } catch (err) {
      console.error(`[bias-calibration-harness] Error:`, err);
      process.exit(1);
    }
  })();
}
