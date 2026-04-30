/**
 * Regime State Service (C1) — bridges DeepAR predictions into the
 * Skip Engine and any other classifier that wants regime-aware weighting.
 *
 * DeepAR runs daily at 6 AM ET (predictRegime), writes one row per
 * symbol into deepar_forecasts.  This service exposes those probabilities
 * via an in-memory singleton AND falls back to a DB read so the values
 * are durable across server restarts.
 *
 * The Skip Engine reads regime weights at evaluation time (not at signal
 * generation time) so the Pre-Session Skip Check n8n workflow gets fresh
 * values even if it fires before DeepAR predict completes.
 *
 * Authority boundary:
 *   - DeepAR is challenger_only (weight starts at 0.0).
 *   - This service exposes probabilities AND DeepAR's effective weight.
 *   - Downstream classifiers (skip_classifier) MUST multiply DeepAR's
 *     contribution by effectiveWeight before adjusting their score —
 *     never override TRADE/REDUCE/SKIP based on DeepAR alone.
 */

import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { deeparForecasts } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { broadcastSSE } from "../routes/sse.js";
import { getDeepARWeight, getDeepARRuntimeStatus } from "./deepar-service.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface RegimeWeights {
  /** P(market is in a high-vol regime) — 0..1 */
  high_vol: number;
  /** P(market is trending) — 0..1 */
  trending: number;
  /** P(market is mean-reverting) — 0..1 */
  mean_revert: number;
  /** Optional: P(correlation stress event) — 0..1 */
  correlation_stress?: number;
}

export interface RegimeState {
  symbol: string;
  forecastDate: string;
  weights: RegimeWeights;
  /** DeepAR's effective weight (0 when stale or in shadow mode) */
  effectiveWeight: number;
  /** DeepAR's confidence in the top regime — 0..1 */
  forecastConfidence: number;
  /** Top regime by probability (purely informational; classifiers
   *  should still consider the full distribution) */
  topRegime: keyof RegimeWeights;
  /** When was this state generated */
  generatedAt: string;
  /** Source — "deepar" today, room for ensemble later */
  source: "deepar" | "fallback_uniform";
}

// ─── In-memory singleton ────────────────────────────────────────────
// Keyed by symbol so we can hold per-symbol state simultaneously.

const regimeStateBySymbol = new Map<string, RegimeState>();

function uniformFallback(symbol: string): RegimeState {
  return {
    symbol,
    forecastDate: new Date().toISOString().slice(0, 10),
    weights: { high_vol: 1 / 3, trending: 1 / 3, mean_revert: 1 / 3 },
    effectiveWeight: 0,
    forecastConfidence: 0,
    topRegime: "mean_revert",
    generatedAt: new Date().toISOString(),
    source: "fallback_uniform",
  };
}

function pickTopRegime(weights: RegimeWeights): keyof RegimeWeights {
  let top: keyof RegimeWeights = "mean_revert";
  let max = -Infinity;
  for (const k of ["high_vol", "trending", "mean_revert"] as const) {
    if (weights[k] > max) {
      max = weights[k];
      top = k;
    }
  }
  return top;
}

// ─── Setter (called by scheduler after DeepAR predict) ──────────────

export async function setRegimeWeights(
  symbol: string,
  weights: RegimeWeights,
  meta?: { forecastDate?: string; forecastConfidence?: number },
): Promise<RegimeState> {
  const status = await getDeepARRuntimeStatus().catch(() => null);
  const effectiveWeight = status?.effectiveWeight ?? getDeepARWeight();

  const state: RegimeState = {
    symbol,
    forecastDate: meta?.forecastDate ?? new Date().toISOString().slice(0, 10),
    weights,
    effectiveWeight,
    forecastConfidence: meta?.forecastConfidence ?? 0,
    topRegime: pickTopRegime(weights),
    generatedAt: new Date().toISOString(),
    source: "deepar",
  };
  regimeStateBySymbol.set(symbol, state);

  logger.info(
    { symbol, topRegime: state.topRegime, weights, effectiveWeight },
    "Regime state updated from DeepAR",
  );

  broadcastSSE("regime:state_updated", {
    symbol,
    topRegime: state.topRegime,
    weights,
    effectiveWeight,
    forecastDate: state.forecastDate,
  });

  return state;
}

// ─── Getter (called by skip classifier route) ──────────────────────

/**
 * Get current regime state for a symbol.  Order of resolution:
 *   1. In-memory map (set by scheduler after predictRegime)
 *   2. Latest deepar_forecasts row in DB (durable across restarts)
 *   3. Uniform fallback (1/3 each, effectiveWeight=0)
 *
 * The third tier is intentionally permissive: a skip classifier that
 * receives uniform weights with effectiveWeight=0 will fall back to its
 * pre-DeepAR behaviour (DeepAR contributes 0 to the score).
 */
export async function getRegimeState(symbol: string): Promise<RegimeState> {
  // 1. In-memory hit
  const inMem = regimeStateBySymbol.get(symbol);
  if (inMem) return inMem;

  // 2. DB fallback
  try {
    const [row] = await db
      .select({
        symbol: deeparForecasts.symbol,
        forecastDate: deeparForecasts.forecastDate,
        pHighVol: deeparForecasts.pHighVol,
        pTrending: deeparForecasts.pTrending,
        pMeanRevert: deeparForecasts.pMeanRevert,
        pCorrelationStress: deeparForecasts.pCorrelationStress,
        forecastConfidence: deeparForecasts.forecastConfidence,
        generatedAt: deeparForecasts.generatedAt,
      })
      .from(deeparForecasts)
      .where(eq(deeparForecasts.symbol, symbol))
      .orderBy(desc(deeparForecasts.forecastDate))
      .limit(1);

    if (row) {
      const status = await getDeepARRuntimeStatus().catch(() => null);
      const effectiveWeight = status?.effectiveWeight ?? getDeepARWeight();
      const weights: RegimeWeights = {
        high_vol: Number(row.pHighVol ?? 1 / 3),
        trending: Number(row.pTrending ?? 1 / 3),
        mean_revert: Number(row.pMeanRevert ?? 1 / 3),
        correlation_stress:
          row.pCorrelationStress === null || row.pCorrelationStress === undefined
            ? undefined
            : Number(row.pCorrelationStress),
      };
      const state: RegimeState = {
        symbol,
        forecastDate:
          typeof row.forecastDate === "string"
            ? row.forecastDate
            : (row.forecastDate as Date).toISOString().slice(0, 10),
        weights,
        effectiveWeight,
        forecastConfidence: Number(row.forecastConfidence ?? 0),
        topRegime: pickTopRegime(weights),
        generatedAt:
          row.generatedAt instanceof Date
            ? row.generatedAt.toISOString()
            : new Date().toISOString(),
        source: "deepar",
      };
      // Warm in-memory for next caller
      regimeStateBySymbol.set(symbol, state);
      return state;
    }
  } catch (err) {
    logger.warn({ err, symbol }, "Regime state DB fallback failed — returning uniform");
  }

  // 3. Uniform fallback
  return uniformFallback(symbol);
}

/**
 * Hydrate the in-memory map from the latest DeepAR forecast for each
 * symbol.  Called by the scheduler step that follows deepar-predict so
 * the Skip Engine sees fresh values immediately, without a DB roundtrip
 * on every classify call.
 */
export async function hydrateRegimeStateFromLatestForecasts(symbols: string[]): Promise<RegimeState[]> {
  const out: RegimeState[] = [];
  for (const sym of symbols) {
    const state = await getRegimeState(sym);
    out.push(state);
  }
  return out;
}

/** Test/admin hook — clear the in-memory map. */
export function clearRegimeState(): void {
  regimeStateBySymbol.clear();
}

/** Inspector for /api/health and admin dashboards. */
export function getAllRegimeState(): Record<string, RegimeState> {
  const snapshot: Record<string, RegimeState> = {};
  for (const [sym, state] of regimeStateBySymbol) snapshot[sym] = state;
  return snapshot;
}
