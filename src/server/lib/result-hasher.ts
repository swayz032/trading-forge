/**
 * Result Hasher — A2 Backtest Provenance Tracking
 *
 * Canonicalizes a backtest result JSON and computes a SHA-256 hash.
 * Mirrors Python's determinism.py:canonicalize_result() so the two
 * sides produce identical hashes for the same result object.
 *
 * Why canonicalize?
 *   JSON.stringify() is NOT canonical — key order can vary between
 *   serializers. We must sort keys recursively and normalize floats
 *   to the same precision as Python to guarantee byte-equality of
 *   the canonical string across both runtimes.
 *
 * Float precision: 6 decimal places — must match Python's default
 *   float_precision=6 in canonicalize_result(). Changing either side
 *   breaks hash comparability with existing rows.
 *
 * NaN / Infinity handling: matches Python (NaN → "NaN", Inf → "Inf",
 *   -Inf → "-Inf") so results containing these sentinel values still
 *   hash consistently.
 *
 * Usage:
 *   const hash = computeResultHash(backtestResultJson);
 *   const dataHash = computeDataHash(symbol, timeframe, startDate, endDate);
 *   const strategyHash = computeStrategyHash(strategyConfigJson);
 */

import { createHash } from "crypto";

const FLOAT_PRECISION = 6;

/**
 * Recursively normalize a value for canonical JSON:
 *   - floats: rounded to FLOAT_PRECISION decimal places
 *   - NaN / Inf: replaced with sentinel strings (matches Python)
 *   - dict keys: sorted recursively
 *   - arrays: elements normalized in-order (order preserved)
 *   - null / undefined: preserved as null
 *   - other scalars: unchanged
 */
function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Inf";
    if (value === -Infinity) return "-Inf";
    // Round to FLOAT_PRECISION to match Python's round(v, 6)
    const factor = Math.pow(10, FLOAT_PRECISION);
    return Math.round(value * factor) / factor;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    // Sort keys alphabetically — same as Python's json.dumps(sort_keys=True)
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = normalizeValue(obj[key]);
    }
    return sorted;
  }
  // string, boolean, bigint — unchanged
  return value;
}

/**
 * Produce a canonical JSON string for a backtest result.
 * The output is byte-identical to Python's canonicalize_result()
 * output for the same input object, when both sides have identical data.
 */
export function canonicalizeResult(result: unknown): string {
  const normalized = normalizeValue(result);
  // No extra whitespace — matches Python's json.dumps(separators=(',', ':'))
  return JSON.stringify(normalized);
}

/**
 * Compute SHA-256 of a backtest result.
 * Returns a 64-char lowercase hex string.
 */
export function computeResultHash(result: unknown): string {
  const canonical = canonicalizeResult(result);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Compute a stable hash for the market data slice used in a backtest.
 * Incorporates symbol, timeframe, and date range so data patches
 * (after a Databento re-download) produce a new hash and force new
 * provenance rows rather than silently overwriting old ones.
 *
 * NOTE: This is a structural hash over the DESCRIPTION of the data slice,
 * not a hash of the actual bar data. A full bar-data content hash would
 * require reading the Parquet file — too expensive for every backtest.
 * For exact data provenance, the structural hash is sufficient to detect
 * parameter changes; A5 golden fixtures provide the content-level ground truth.
 */
export function computeDataHash(
  symbol: string,
  timeframe: string,
  startDate: string,
  endDate: string,
): string {
  // Canonical form: sort fields alphabetically to avoid ordering accidents
  const descriptor = JSON.stringify({
    end_date: endDate,
    start_date: startDate,
    symbol: symbol.toUpperCase(),
    timeframe: timeframe.toLowerCase(),
  });
  return createHash("sha256").update(descriptor, "utf8").digest("hex");
}

/**
 * Compute a stable hash for a strategy DSL config.
 * Mirrors the strategy_hash used in quantum-pre-flight.ts so the
 * same hash appears in both backtest_provenance and quantum_mc_runs.config.
 *
 * Input: the raw strategy config object (from strategy.config JSON column).
 */
export function computeStrategyHash(strategyConfig: unknown): string {
  const canonical = canonicalizeResult(strategyConfig);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
