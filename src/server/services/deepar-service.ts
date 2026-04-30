/**
 * DeepAR Service Layer — regime forecasting via probabilistic deep learning.
 *
 * Governance: challenger_only. Weight starts at 0.0 and automatically
 * falls back to zero if forecast or training freshness drifts.
 *
 * Graduation ladder:
 *   60+ days tracked AND hit_rate > 0.55 → weight 0.0 → 0.05
 *   120+ days AND sustained → weight 0.05 → 0.10
 *   hit_rate < 0.50 for 30 days → demote to 0.0
 *
 * Persistence: currentDeeparWeight is mirrored into system_parameters
 * (paramName="deepar_weight") on every graduation/demotion. On module
 * import, loadInitialDeeparWeight() reads from system_parameters so a
 * server restart never silently demotes a graduated DeepAR back to 0.0.
 */

import { eq, desc, sql } from "drizzle-orm";
import { queryOhlcv, type OhlcvBar } from "../../data/loaders/duckdb-service.js";
import { db } from "../db/index.js";
import { deeparForecasts, deeparTrainingRuns, auditLog, systemParameters } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { runPythonModule } from "../lib/python-runner.js";
import { CircuitBreakerRegistry, CircuitOpenError } from "../lib/circuit-breaker.js";
import { captureToDLQ } from "../lib/dlq-service.js";
import { logger } from "../index.js";

// ─── Types ───────────────────────────────────────────────────────────

interface RegimeForecast {
  symbol: string;
  forecast_date: string;
  p_high_vol: number;
  p_trending: number;
  p_mean_revert: number;
  p_correlation_stress: number;
  forecast_confidence: number;
  quantile_p10: number;
  quantile_p50: number;
  quantile_p90: number;
  model_version: string;
  prediction_horizon: number;
}

interface TrainingResult {
  status: "completed" | "failed";
  runId: string;
  epochs?: number;
  training_loss?: number;
  validation_loss?: number;
  model_path?: string;
  data_range_start?: string;
  data_range_end?: string;
  duration_ms?: number;
  error?: string;
}

interface PythonTrainingOutput {
  status: string;
  epochs?: number;
  training_loss?: number;
  validation_loss?: number;
  model_path?: string;
  data_range_start?: string;
  data_range_end?: string;
  duration_ms?: number;
  error?: string;
}

interface PythonPredictOutput {
  forecasts: Record<string, RegimeForecast>;
  model_version?: string;
  error?: string;
}

// Caveat 1 hardening: predictRegime returns this sentinel when the python-deepar
// circuit is open, so callers can branch on the result instead of wrapping every
// call in try/catch. Other failure modes (CLI errors, prediction errors) still
// throw to preserve existing semantics — only the circuit-open path is deferred.
export interface DeepARDeferredResponse {
  status: "deferred";
  reason: "circuit_open";
  symbols: string[];
  endpoint?: string;
  reopensAt?: string;
  timestamp: string;
}

export function isDeepARDeferred(
  value: Record<string, RegimeForecast> | DeepARDeferredResponse,
): value is DeepARDeferredResponse {
  return typeof value === "object" && value !== null && "status" in value && (value as { status?: unknown }).status === "deferred";
}

interface ValidationResult {
  validated: number;
  weightChanged: boolean;
  previousWeight: number;
  currentWeight: number;
  rollingHitRate: number | null;
  daysTracked: number;
}

export interface DeepARRuntimeStatus {
  currentWeight: number;
  effectiveWeight: number;
  forecastFresh: boolean;
  trainingFresh: boolean;
  daysTracked: number;
  rollingHitRate: number | null;
  latestForecastAt: string | null;
  latestTrainingAt: string | null;
  latestTrainingStatus: string | null;
  authorityBoundary: "challenger_only";
  fallbackMode: "zero_weight_on_staleness";
}

type RegimeLabel = "high_vol" | "trending" | "mean_revert";

interface RegimeAssessment {
  actualRegime: RegimeLabel;
  actualProbabilities: Record<RegimeLabel, number>;
}

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_SYMBOLS = ["NQ", "ES", "CL"];
const DEEPAR_MODULE = "src.engine.deepar_forecaster";
const FORECAST_FRESHNESS_MS = 36 * 60 * 60 * 1000;
const TRAINING_FRESHNESS_MS = 8 * 24 * 60 * 60 * 1000;
const VALIDATION_LOOKBACK_BARS = 20;
const VALIDATION_LOOKAHEAD_BUFFER_DAYS = 14;

// ─── DeepAR Weight State ─────────────────────────────────────────────
// In-memory weight (hot-path read), mirrored into system_parameters
// (paramName="deepar_weight") so a server restart cannot silently demote
// a graduated DeepAR back to 0.0. The system_parameters row is the durable
// source of truth; this module variable is the cache.
//
// Read flow:  loadInitialDeeparWeight() (module init) → currentDeeparWeight
// Write flow: validatePastForecasts() mutates currentDeeparWeight + calls
//             persistDeeparWeight() to mirror the new value into the DB.
//
// `weightInitPromise` is awaited by every public consumer (getDeepARWeight,
// validatePastForecasts, getDeepARRuntimeStatus) so callers never observe
// the default 0.0 before the persisted value is loaded.

let currentDeeparWeight = 0.0;

const DEEPAR_WEIGHT_PARAM = "deepar_weight";

async function loadInitialDeeparWeight(): Promise<void> {
  try {
    const [row] = await db
      .select({ currentValue: systemParameters.currentValue })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, DEEPAR_WEIGHT_PARAM));
    if (row && row.currentValue != null) {
      const parsed = Number(row.currentValue);
      if (Number.isFinite(parsed)) {
        currentDeeparWeight = parsed;
        logger?.info?.({ currentWeight: currentDeeparWeight }, "DeepAR weight restored from system_parameters");
        return;
      }
    }
    logger?.info?.({ currentWeight: currentDeeparWeight }, "DeepAR weight initialized to default (no persisted row)");
  } catch (err) {
    // Fail open: leave weight at 0.0 (safe default — DeepAR stays in shadow).
    // Use optional chaining on logger because this can run at module-load time
    // before the logger is fully initialized (test contexts, circular imports).
    logger?.warn?.({ err }, "DeepAR weight load from system_parameters failed; using default 0.0");
  }
}

// Lazy initialization: do NOT trigger DB read at module import time. Trigger
// only on first await. This prevents test environments without a DB from
// crashing on import, and avoids the logger-undefined race during boot.
let weightInitPromise: Promise<void> | null = null;
function ensureWeightLoaded(): Promise<void> {
  if (weightInitPromise === null) {
    weightInitPromise = loadInitialDeeparWeight();
  }
  return weightInitPromise;
}

async function persistDeeparWeight(weight: number): Promise<void> {
  try {
    const [existing] = await db
      .select({ id: systemParameters.id })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, DEEPAR_WEIGHT_PARAM));

    if (existing) {
      await db
        .update(systemParameters)
        .set({ currentValue: weight.toString(), updatedAt: new Date() })
        .where(eq(systemParameters.paramName, DEEPAR_WEIGHT_PARAM));
    } else {
      await db.insert(systemParameters).values({
        paramName: DEEPAR_WEIGHT_PARAM,
        currentValue: weight.toString(),
        minValue: "0",
        maxValue: "0.10",
        domain: "scheduler",
        description: "DeepAR challenger weight (auto-graduated 0.0 → 0.05 → 0.10; demoted on hit_rate < 0.50)",
        autoTunable: false,
      });
    }
  } catch (err) {
    // Persistence failure must not abort the in-memory transition; just log.
    logger.error({ err, weight }, "DeepAR weight persist to system_parameters failed");
  }
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number): string {
  const shifted = parseDateOnly(value);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return toDateOnly(shifted);
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(value, 0);
}

function normalizeProbabilities(probabilities: Record<RegimeLabel, number>): Record<RegimeLabel, number> {
  const normalized = {
    high_vol: clampProbability(probabilities.high_vol),
    trending: clampProbability(probabilities.trending),
    mean_revert: clampProbability(probabilities.mean_revert),
  };
  const total = normalized.high_vol + normalized.trending + normalized.mean_revert;
  if (total <= 0) {
    return {
      high_vol: 1 / 3,
      trending: 1 / 3,
      mean_revert: 1 / 3,
    };
  }
  return {
    high_vol: normalized.high_vol / total,
    trending: normalized.trending / total,
    mean_revert: normalized.mean_revert / total,
  };
}

export function inferPredictedRegime(probabilities: Record<RegimeLabel, number>): {
  predictedRegime: RegimeLabel;
  predictedProbability: number;
  normalizedProbabilities: Record<RegimeLabel, number>;
} {
  const normalizedProbabilities = normalizeProbabilities(probabilities);
  const ranked = Object.entries(normalizedProbabilities)
    .sort(([, left], [, right]) => right - left) as Array<[RegimeLabel, number]>;
  const [predictedRegime, predictedProbability] = ranked[0] ?? ["mean_revert", 1 / 3];

  return {
    predictedRegime,
    predictedProbability,
    normalizedProbabilities,
  };
}

function computeReturns(bars: OhlcvBar[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < bars.length; index++) {
    const previousClose = bars[index - 1]?.close ?? 0;
    const currentClose = bars[index]?.close ?? 0;
    if (!Number.isFinite(previousClose) || previousClose <= 0 || !Number.isFinite(currentClose)) {
      continue;
    }
    returns.push((currentClose - previousClose) / previousClose);
  }
  return returns;
}

function computeStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function computeRangePct(bars: OhlcvBar[]): number {
  if (bars.length === 0) return 0;
  const startClose = bars[0]?.close ?? 0;
  if (!Number.isFinite(startClose) || startClose <= 0) return 0;
  const highestHigh = Math.max(...bars.map((bar) => Number(bar.high ?? bar.close ?? 0)));
  const lowestLow = Math.min(...bars.map((bar) => Number(bar.low ?? bar.close ?? 0)));
  return (highestHigh - lowestLow) / startClose;
}

function computeSignChangeRate(values: number[]): number {
  const epsilon = 1e-6;
  const signs = values
    .map((value) => {
      if (value > epsilon) return 1;
      if (value < -epsilon) return -1;
      return 0;
    })
    .filter((value) => value !== 0);

  if (signs.length <= 1) return 0;
  let signChanges = 0;
  for (let index = 1; index < signs.length; index++) {
    if (signs[index] !== signs[index - 1]) signChanges++;
  }
  return signChanges / (signs.length - 1);
}

export function inferRealizedRegimeFromBars(
  bars: OhlcvBar[],
  forecastDate: string,
  predictionHorizon: number,
): RegimeAssessment | null {
  const lookbackBars = Math.max(VALIDATION_LOOKBACK_BARS, predictionHorizon * 2);
  const historyBars = bars.filter((bar) => bar.ts_event.slice(0, 10) <= forecastDate);
  const futureBars = bars.filter((bar) => bar.ts_event.slice(0, 10) > forecastDate);

  if (historyBars.length < lookbackBars + 1 || futureBars.length < predictionHorizon) {
    return null;
  }

  const baselineBars = historyBars.slice(-(lookbackBars + 1));
  const realizedBars = [historyBars[historyBars.length - 1], ...futureBars.slice(0, predictionHorizon)];
  const baselineReturns = computeReturns(baselineBars);
  const realizedReturns = computeReturns(realizedBars);

  if (baselineReturns.length === 0 || realizedReturns.length === 0) {
    return null;
  }

  const epsilon = 1e-6;
  const baselineVol = Math.max(computeStdDev(baselineReturns), epsilon);
  const realizedVol = computeStdDev(realizedReturns);
  const baselineRange = Math.max(computeRangePct(baselineBars), epsilon);
  const realizedRange = computeRangePct(realizedBars);
  const startClose = realizedBars[0]?.close ?? 0;
  const endClose = realizedBars[realizedBars.length - 1]?.close ?? 0;
  const cumulativeReturn = startClose > 0 ? (endClose - startClose) / startClose : 0;
  const pathLength = Math.max(realizedReturns.reduce((sum, value) => sum + Math.abs(value), 0), epsilon);
  const efficiency = Math.abs(cumulativeReturn) / pathLength;
  const signChangeRate = computeSignChangeRate(realizedReturns);
  const volRatio = realizedVol / baselineVol;
  const rangeRatio = realizedRange / baselineRange;
  const trendScale = Math.abs(cumulativeReturn) / Math.max(realizedVol, epsilon);
  const directionalRangeShare = Math.abs(cumulativeReturn) / Math.max(realizedRange, epsilon);

  const scoreVector = normalizeProbabilities({
    high_vol: Math.max(volRatio - 1.2, 0) + Math.max(rangeRatio - 1.25, 0),
    trending: Math.max(efficiency - 0.45, 0) * 2 + Math.max(trendScale - 1, 0) + directionalRangeShare * 2,
    mean_revert: Math.max(signChangeRate - 0.4, 0) * 2 + Math.max(0.75 - efficiency, 0) + Math.max(1 - trendScale, 0),
  });
  const ranked = Object.entries(scoreVector)
    .sort(([, left], [, right]) => right - left) as Array<[RegimeLabel, number]>;
  const actualRegime = ranked[0]?.[0] ?? "mean_revert";

  return {
    actualRegime,
    actualProbabilities: scoreVector,
  };
}

export function calculateRollingHitRate(
  forecasts: Array<{
    actualRegime: string | null;
    pHighVol: string | number | null;
    pTrending: string | number | null;
    pMeanRevert: string | number | null;
  }>,
): number | null {
  const validatedForecasts = forecasts.filter((forecast) =>
    forecast.actualRegime === "high_vol"
    || forecast.actualRegime === "trending"
    || forecast.actualRegime === "mean_revert");

  if (validatedForecasts.length === 0) return null;

  const hits = validatedForecasts.reduce((count, forecast) => {
    const { predictedRegime } = inferPredictedRegime({
      high_vol: Number(forecast.pHighVol ?? 0),
      trending: Number(forecast.pTrending ?? 0),
      mean_revert: Number(forecast.pMeanRevert ?? 0),
    });
    return count + (predictedRegime === forecast.actualRegime ? 1 : 0);
  }, 0);

  return hits / validatedForecasts.length;
}

// ─── Service Functions ───────────────────────────────────────────────

/**
 * Train the DeepAR model on historical regime data.
 */
export async function trainDeepAR(symbols?: string[], correlationId?: string): Promise<TrainingResult> {
  const targetSymbols = symbols ?? DEFAULT_SYMBOLS;

  // Insert training run row with status "running"
  // Governance per CLAUDE.md: DeepAR starts in shadow mode (weight 0.0) and auto-graduates.
  // Output must NEVER be authoritative until weight > 0 — keep challenger_only at write time.
  const [run] = await db.insert(deeparTrainingRuns).values({
    symbols: targetSymbols,
    status: "running",
    governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
  }).returning({ id: deeparTrainingRuns.id });

  const runId = run.id;

  try {
    const result = await CircuitBreakerRegistry.get("python-deepar").call(() =>
      runPythonModule<PythonTrainingOutput>({
        module: DEEPAR_MODULE,
        config: {
          mode: "train",
          symbols: targetSymbols,
          run_id: runId,
        },
        componentName: "deepar-train",
        timeoutMs: 600_000, // 10 min — training can be slow
        correlationId,
      }),
    );

    // Update to completed
    await db.update(deeparTrainingRuns)
      .set({
        status: "completed",
        epochs: result.epochs ?? null,
        trainingLoss: result.training_loss?.toString() ?? null,
        validationLoss: result.validation_loss?.toString() ?? null,
        modelPath: result.model_path ?? null,
        dataRangeStart: result.data_range_start ?? null,
        dataRangeEnd: result.data_range_end ?? null,
        durationMs: result.duration_ms ?? null,
      })
      .where(eq(deeparTrainingRuns.id, runId));

    // Audit log
    await db.insert(auditLog).values({
      action: "deepar.train",
      entityType: "deepar_training_run",
      entityId: runId,
      input: { symbols: targetSymbols },
      result: { status: "completed", epochs: result.epochs, training_loss: result.training_loss },
      status: "success",
      durationMs: result.duration_ms ?? null,
      decisionAuthority: "scheduler",
      correlationId: correlationId ?? null,
    });

    broadcastSSE("deepar:training_complete", {
      runId,
      status: "completed",
      symbols: targetSymbols,
      epochs: result.epochs,
      timestamp: new Date().toISOString(),
    });

    logger.info({ runId, symbols: targetSymbols, epochs: result.epochs }, "DeepAR training completed");

    return {
      status: "completed",
      runId,
      epochs: result.epochs,
      training_loss: result.training_loss,
      validation_loss: result.validation_loss,
      model_path: result.model_path,
      data_range_start: result.data_range_start,
      data_range_end: result.data_range_end,
      duration_ms: result.duration_ms,
    };
  } catch (err) {
    // Update to failed
    await db.update(deeparTrainingRuns)
      .set({ status: "failed" })
      .where(eq(deeparTrainingRuns.id, runId));

    await db.insert(auditLog).values({
      action: "deepar.train",
      entityType: "deepar_training_run",
      entityId: runId,
      input: { symbols: targetSymbols },
      result: { error: err instanceof Error ? err.message : String(err) },
      status: "failure",
      decisionAuthority: "scheduler",
      errorMessage: err instanceof Error ? err.message : String(err),
      correlationId: correlationId ?? null,
    });

    // Capture to DLQ so training failures are not silent
    await captureToDLQ({
      operationType: "deepar:training_failure",
      entityType: "deepar_training_run",
      entityId: runId,
      errorMessage: err instanceof Error ? err.message : String(err),
      metadata: {
        symbols: targetSymbols,
        circuitOpen: err instanceof CircuitOpenError,
        correlationId: correlationId ?? null,
      },
    });

    // Circuit breaker open — mark DB row as failed, return gracefully
    if (err instanceof CircuitOpenError) {
      logger.warn({ runId, endpoint: err.endpoint, reopensAt: err.reopensAt.toISOString() }, "DeepAR training skipped — circuit open");
    } else {
      logger.error({ err, runId }, "DeepAR training failed");
    }

    return {
      status: "failed",
      runId,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Generate regime predictions for the given symbols.
 *
 * Returns either the forecast map (success) or a DeepARDeferredResponse sentinel
 * when the python-deepar circuit is open. Callers should use isDeepARDeferred()
 * to branch. Non-circuit failures still throw.
 */
export async function predictRegime(
  symbols?: string[],
  correlationId?: string,
): Promise<Record<string, RegimeForecast> | DeepARDeferredResponse> {
  const targetSymbols = symbols ?? DEFAULT_SYMBOLS;

  let result: PythonPredictOutput;
  try {
    result = await CircuitBreakerRegistry.get("python-deepar").call(() =>
      runPythonModule<PythonPredictOutput>({
        module: DEEPAR_MODULE,
        config: {
          mode: "predict",
          symbols: targetSymbols,
        },
        componentName: "deepar-predict",
        timeoutMs: 120_000,
        correlationId,
      }),
    );
  } catch (err) {
    const isOpen = err instanceof CircuitOpenError;
    const errorMsg = err instanceof Error ? err.message : String(err);
    await captureToDLQ({
      operationType: "deepar:prediction_failure",
      entityType: "deepar_forecast",
      errorMessage: errorMsg,
      metadata: {
        symbols: targetSymbols,
        circuitOpen: isOpen,
        correlationId: correlationId ?? null,
      },
    });
    if (isOpen) {
      logger.warn(
        { endpoint: err.endpoint, reopensAt: err.reopensAt.toISOString() },
        "DeepAR predict skipped — circuit open; returning deferred sentinel",
      );
      // Caveat 1: return deferred sentinel instead of throwing so callers can
      // branch explicitly. Scheduler still treats it gracefully (sentinel has
      // no enumerable forecast entries → loop body simply skips).
      return {
        status: "deferred",
        reason: "circuit_open",
        symbols: targetSymbols,
        endpoint: err.endpoint,
        reopensAt: err.reopensAt.toISOString(),
        timestamp: new Date().toISOString(),
      };
    }
    logger.error({ err }, "DeepAR prediction failed");
    throw err;
  }

  if (result.error) {
    logger.error({ error: result.error }, "DeepAR prediction returned error");
    throw new Error(`DeepAR prediction failed: ${result.error}`);
  }

  const forecasts = result.forecasts ?? {};
  const today = new Date().toISOString().slice(0, 10);

  // Persist each forecast
  for (const [symbol, forecast] of Object.entries(forecasts)) {
    await db.insert(deeparForecasts).values({
      forecastDate: forecast.forecast_date ?? today,
      symbol,
      predictionHorizon: forecast.prediction_horizon ?? 5,
      pHighVol: forecast.p_high_vol?.toString() ?? null,
      pTrending: forecast.p_trending?.toString() ?? null,
      pMeanRevert: forecast.p_mean_revert?.toString() ?? null,
      pCorrelationStress: forecast.p_correlation_stress?.toString() ?? null,
      forecastConfidence: forecast.forecast_confidence?.toString() ?? null,
      quantileP10: forecast.quantile_p10?.toString() ?? null,
      quantileP50: forecast.quantile_p50?.toString() ?? null,
      quantileP90: forecast.quantile_p90?.toString() ?? null,
      modelVersion: forecast.model_version ?? result.model_version ?? null,
      governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
    });
  }

  broadcastSSE("deepar:forecast_ready", {
    symbols: Object.keys(forecasts),
    forecastDate: today,
    timestamp: new Date().toISOString(),
  });

  logger.info({ symbols: Object.keys(forecasts), forecastDate: today }, "DeepAR forecasts generated and persisted");

  return forecasts;
}

/**
 * Validate yesterday's forecasts against actual realized regimes.
 * Updates hit rates and checks auto-graduation conditions.
 */
export async function validatePastForecasts(context?: { correlationId?: string }): Promise<ValidationResult> {
  const correlationId = context?.correlationId ?? null;
  // Wait for the persisted weight to load before reading currentDeeparWeight
  // for graduation comparisons. Without this, a server restart followed by an
  // immediate validate tick could compare against the default 0.0 instead of
  // the last persisted weight, silently demoting an already-graduated DeepAR.
  await ensureWeightLoaded();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const yesterdayForecasts = await db
    .select()
    .from(deeparForecasts)
    .where(eq(deeparForecasts.forecastDate, yesterdayStr));

  if (yesterdayForecasts.length === 0) {
    logger.info("No yesterday forecasts to validate");
    return {
      validated: 0,
      weightChanged: false,
      previousWeight: currentDeeparWeight,
      currentWeight: currentDeeparWeight,
      rollingHitRate: null,
      daysTracked: 0,
    };
  }

  let validated = 0;

  for (const forecast of yesterdayForecasts) {
    const { predictedRegime, predictedProbability } = inferPredictedRegime({
      high_vol: Number(forecast.pHighVol ?? 0),
      trending: Number(forecast.pTrending ?? 0),
      mean_revert: Number(forecast.pMeanRevert ?? 0),
    });
    const predictionHorizon = Number(forecast.predictionHorizon ?? 5);
    const queryFrom = shiftDate(yesterdayStr, -(Math.max(VALIDATION_LOOKBACK_BARS, predictionHorizon * 2) + 10));
    const queryTo = shiftDate(
      yesterdayStr,
      Math.max(predictionHorizon + VALIDATION_LOOKAHEAD_BUFFER_DAYS, VALIDATION_LOOKAHEAD_BUFFER_DAYS),
    );

    let assessment: RegimeAssessment | null;
    try {
      const bars = await queryOhlcv({
        symbol: forecast.symbol,
        timeframe: "daily",
        from: queryFrom,
        to: queryTo,
        adjusted: true,
      });
      assessment = inferRealizedRegimeFromBars(bars, yesterdayStr, predictionHorizon);
    } catch (err) {
      logger.warn(
        { err, symbol: forecast.symbol, forecastDate: yesterdayStr },
        "DeepAR validation skipped because realized daily bars were unavailable",
      );
      continue;
    }

    if (!assessment) {
      logger.warn(
        { symbol: forecast.symbol, forecastDate: yesterdayStr, predictionHorizon },
        "DeepAR validation skipped because realized regime could not be inferred",
      );
      continue;
    }

    const forecastCorrect = assessment.actualRegime === predictedRegime;
    const actualProbabilityForPrediction = assessment.actualProbabilities[predictedRegime];
    const regretScore = forecastCorrect ? 0 : predictedProbability;
    const magnitudeError = Math.abs(predictedProbability - actualProbabilityForPrediction);

    await db.update(deeparForecasts)
      .set({
        actualRegime: assessment.actualRegime,
        regretScore: regretScore.toFixed(4),
        magnitudeError: magnitudeError.toFixed(4),
      })
      .where(eq(deeparForecasts.id, forecast.id));

    validated++;
  }

  const allValidated = await db
    .select({
      actualRegime: deeparForecasts.actualRegime,
      pHighVol: deeparForecasts.pHighVol,
      pTrending: deeparForecasts.pTrending,
      pMeanRevert: deeparForecasts.pMeanRevert,
    })
    .from(deeparForecasts)
    .where(sql`actual_regime is not null`);

  const daysResult = await db
    .select({
      days: sql<number>`count(distinct forecast_date)`,
    })
    .from(deeparForecasts)
    .where(sql`actual_regime is not null`);

  const daysTracked = Number(daysResult[0]?.days ?? 0);
  const rollingHitRate = calculateRollingHitRate(allValidated);

  if (rollingHitRate !== null) {
    for (const forecast of yesterdayForecasts) {
      await db.update(deeparForecasts)
        .set({ hitRate: rollingHitRate.toString() })
        .where(eq(deeparForecasts.id, forecast.id));
    }
  }

  const previousWeight = currentDeeparWeight;
  let weightChanged = false;

  if (daysTracked >= 120 && rollingHitRate !== null && rollingHitRate > 0.55 && currentDeeparWeight < 0.10) {
    currentDeeparWeight = 0.10;
    weightChanged = true;
  } else if (daysTracked >= 60 && rollingHitRate !== null && rollingHitRate > 0.55 && currentDeeparWeight < 0.05) {
    currentDeeparWeight = 0.05;
    weightChanged = true;
  }

  if (daysTracked >= 30 && rollingHitRate !== null && rollingHitRate < 0.50 && currentDeeparWeight > 0.0) {
    currentDeeparWeight = 0.0;
    weightChanged = true;
  }

  if (weightChanged) {
    // Persist the new weight to system_parameters BEFORE broadcasting/auditing
    // so a crash between SSE emission and DB write cannot lose the change.
    await persistDeeparWeight(currentDeeparWeight);

    broadcastSSE("deepar:weight_changed", {
      previousWeight,
      currentWeight: currentDeeparWeight,
      rollingHitRate,
      daysTracked,
      timestamp: new Date().toISOString(),
    });

    await db.insert(auditLog).values({
      action: "deepar.weight_change",
      entityType: "deepar_config",
      input: { previousWeight, daysTracked, rollingHitRate },
      result: { newWeight: currentDeeparWeight },
      status: "success",
      decisionAuthority: "scheduler",
      correlationId,
    });

    logger.info(
      { previousWeight, currentWeight: currentDeeparWeight, rollingHitRate, daysTracked },
      "DeepAR weight changed via auto-graduation",
    );
  }

  return {
    validated,
    weightChanged,
    previousWeight,
    currentWeight: currentDeeparWeight,
    rollingHitRate,
    daysTracked,
  };
}

/**
 * Get the latest forecast for a symbol.
 */
export async function getLatestForecast(symbol: string) {
  const [forecast] = await db
    .select()
    .from(deeparForecasts)
    .where(eq(deeparForecasts.symbol, symbol))
    .orderBy(desc(deeparForecasts.forecastDate))
    .limit(1);

  return forecast ?? null;
}

/**
 * Get the current DeepAR weight (0.0, 0.05, or 0.10).
 *
 * Sync read of the in-memory cache. The persisted value is loaded at module
 * import via loadInitialDeeparWeight(); during the brief async load window
 * (typically <100ms after process start) callers may observe the default 0.0.
 * Consumers that must not see the default during cold-start (validatePastForecasts,
 * getDeepARRuntimeStatus) await `weightInitPromise` explicitly. Use
 * getDeepARWeightAsync() if you need the same guarantee for new call sites.
 */
export function getDeepARWeight(): number {
  return currentDeeparWeight;
}

/**
 * Async variant of getDeepARWeight() — awaits the persisted-value load before
 * returning. Prefer this over getDeepARWeight() in any path that runs at
 * server start (scheduler ticks, eager warm-ups) so a graduated DeepAR is
 * never silently demoted to 0.0 during the load window.
 */
export async function getDeepARWeightAsync(): Promise<number> {
  await ensureWeightLoaded();
  return currentDeeparWeight;
}

export async function getDeepARRuntimeStatus(): Promise<DeepARRuntimeStatus> {
  // Make sure the persisted weight has been read before exposing currentWeight
  // through the runtime status API; otherwise the dashboard could see 0.0 in
  // the seconds following a server restart.
  await ensureWeightLoaded();

  const [latestForecast, latestTraining, daysResult, hitRateResult] = await Promise.all([
    db
      .select({
        forecastDate: deeparForecasts.forecastDate,
        generatedAt: deeparForecasts.generatedAt,
      })
      .from(deeparForecasts)
      .orderBy(desc(deeparForecasts.generatedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        trainedAt: deeparTrainingRuns.trainedAt,
        status: deeparTrainingRuns.status,
      })
      .from(deeparTrainingRuns)
      .orderBy(desc(deeparTrainingRuns.trainedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        days: sql<number>`count(distinct forecast_date)`,
      })
      .from(deeparForecasts)
      .where(sql`actual_regime is not null`)
      .then((rows) => Number(rows[0]?.days ?? 0)),
    db
      .select({
        avgHitRate: sql<string | null>`avg(hit_rate::numeric)`,
      })
      .from(deeparForecasts)
      .where(sql`actual_regime is not null and hit_rate is not null`)
      .then((rows) => rows[0]?.avgHitRate ?? null),
  ]);

  const now = Date.now();
  const latestForecastAt = latestForecast?.generatedAt?.toISOString() ?? null;
  const latestTrainingAt = latestTraining?.trainedAt?.toISOString() ?? null;
  const forecastFresh = latestForecast?.generatedAt
    ? now - latestForecast.generatedAt.getTime() <= FORECAST_FRESHNESS_MS
    : false;
  const trainingFresh = latestTraining?.trainedAt
    ? now - latestTraining.trainedAt.getTime() <= TRAINING_FRESHNESS_MS
    : false;
  const effectiveWeight = forecastFresh && trainingFresh ? currentDeeparWeight : 0;

  return {
    currentWeight: currentDeeparWeight,
    effectiveWeight,
    forecastFresh,
    trainingFresh,
    daysTracked: daysResult,
    rollingHitRate: hitRateResult === null ? null : Number(hitRateResult),
    latestForecastAt,
    latestTrainingAt,
    latestTrainingStatus: latestTraining?.status ?? null,
    authorityBoundary: "challenger_only",
    fallbackMode: "zero_weight_on_staleness",
  };
}
