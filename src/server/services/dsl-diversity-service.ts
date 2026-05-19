/**
 * DSL Diversity Service — C9 (W17 Team B)
 *
 * Pre-backtest DSL template similarity check. Catches mode-collapse in LLM
 * strategy generation before it wastes backtest compute.
 *
 * Defense-in-depth relationship with A7 (signal-correlation-service.ts):
 *   A7: POST-backtest — catches different code that produces identical signals.
 *   C9: PRE-backtest  — catches identical DSL templates given different names.
 *
 * Background: "I asked an LLM to generate 20 strategies. 14 were the same thing."
 * StockBench 2025: LLM agents fail to outperform passive benchmarks without
 * explicit diversity enforcement. Without this check, LLM-generated strategies
 * repeat templates — wasting backtest compute and creating false portfolio diversity.
 *
 * Feature vector contract (13 float32 dimensions):
 *   [0]  entry_indicator bucket (0.0–1.0 normalized index into INDICATOR_BUCKETS)
 *   [1]  exit_type bucket       (0.0–1.0 normalized index into EXIT_TYPE_BUCKETS)
 *   [2]  direction bucket       (long=0.0, short=0.5, both=1.0)
 *   [3]  symbol bucket          (MES=0.0, MNQ=0.5, MCL=1.0, other=0.75)
 *   [4]  timeframe bucket       (1m=0.0 → 1d=1.0, log-scaled)
 *   [5]  regime bucket          (0.0–1.0 normalized index into REGIME_BUCKETS)
 *   [6]  stop_loss_atr_multiple (clamped to [0.5, 5.0], normalized to [0,1])
 *   [7]  take_profit_atr_multiple (clamped [1.0, 10.0], normalized [0,1], 0 if absent)
 *   [8–12] entry_params values  (up to 5 numeric values, sorted by key, normalized
 *          to [0,1] via log1p/1000, padded with 0.0 if fewer than 5 params)
 *
 * Cosine similarity formula: Σ(aᵢ·bᵢ) / (√Σaᵢ² · √Σbᵢ²)
 * Threshold: 0.85 (env STRATEGY_DSL_SIMILARITY_THRESHOLD)
 * Lookback: last 50 strategies (env STRATEGY_DSL_LOOKBACK, max 200)
 *
 * Compression: gzip via Node built-in zlib (same pattern as A7 signal vectors).
 * Fingerprint: sha256(canonical DSL JSON) for fast exact-match before vector load.
 *
 * Authority:
 *   - Hard gate PRE-backtest: reject if similarity > threshold.
 *   - Challenger/advisory: does NOT have promotion authority.
 *   - Pipeline pause guard: bypasses check when pipeline is paused.
 *
 * Persistence:
 *   strategy_dsl_features table (migration 0082). UNIQUE(strategy_id) — one row
 *   per strategy. Written AFTER backtest completes (not before — this avoids
 *   polluting the feature table with candidates that failed later gates).
 *
 * Candidate contract compliance:
 *   Every rejection writes an audit_log row with:
 *     parent_strategy_version, child_generation_version (n/a pre-DB, so "pre-persist"),
 *     old_params (most similar existing DSL fingerprint), new_params (candidate DSL),
 *     reason_for_change, evidence_sources, expected_uplift (blocked=0),
 *     risk_penalties, replay_priority, acceptance_rejection_result, timestamps,
 *     run_identifiers.
 */

import { createHash } from "crypto";
import { gzipSync, gunzipSync } from "zlib";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, strategyDslFeatures, auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";

// ─── Threshold + Lookback (tunable via env) ─────────────────────────────────

export const DSL_SIMILARITY_THRESHOLD = parseFloat(
  process.env.STRATEGY_DSL_SIMILARITY_THRESHOLD ?? "0.85"
);

const DSL_LOOKBACK = Math.min(
  parseInt(process.env.STRATEGY_DSL_LOOKBACK ?? "50", 10),
  200
);

// ─── Categorical buckets ─────────────────────────────────────────────────────

// Supported entry indicators (order is the bucket index — do NOT reorder)
const INDICATOR_BUCKETS = [
  "sma_crossover",
  "ema_crossover",
  "rsi_reversal",
  "bollinger_breakout",
  "atr_breakout",
  "vwap_reversion",
  "donchian_breakout",
  "keltner_squeeze",
  "session_open_breakout",
  "macd_crossover",
  "vwap_fade",
  "event_driven_fade",
  "overnight_drift",
] as const;

const EXIT_TYPE_BUCKETS = [
  "fixed_target",
  "trailing_stop",
  "time_exit",
  "indicator_signal",
  "atr_multiple",
] as const;

const REGIME_BUCKETS = [
  "TRENDING_UP",
  "TRENDING_DOWN",
  "RANGE_BOUND",
  "HIGH_VOL",
  "LOW_VOL",
  "OPENING_RANGE",
  "NEWS_DRIVEN",
  "OVERNIGHT_DRIFT",
] as const;

const TIMEFRAME_LOG_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
};

const SYMBOL_BUCKETS: Record<string, number> = {
  MES: 0.0,
  MNQ: 0.33,
  MCL: 0.67,
};

// ─── Feature extraction ──────────────────────────────────────────────────────

export type DslRecord = Record<string, unknown>;

/**
 * Extract a 13-dimension float32 feature vector from a DSL JSON record.
 * Deterministic: identical DSL → identical vector.
 *
 * Returns a number[] (float64 in JS, but values are all in [0,1]).
 */
export function extractDslFeatureVector(dsl: DslRecord): number[] {
  const vec: number[] = new Array(13).fill(0.0);

  // [0] entry_indicator bucket
  const indicator = String(dsl.entry_indicator ?? "").toLowerCase();
  const indicatorIdx = INDICATOR_BUCKETS.indexOf(indicator as any);
  vec[0] = indicatorIdx >= 0
    ? indicatorIdx / Math.max(INDICATOR_BUCKETS.length - 1, 1)
    : 0.5; // unknown indicator → mid-bucket (non-zero, not misleadingly similar)

  // [1] exit_type bucket
  const exitType = String(dsl.exit_type ?? "").toLowerCase();
  const exitIdx = EXIT_TYPE_BUCKETS.indexOf(exitType as any);
  vec[1] = exitIdx >= 0
    ? exitIdx / Math.max(EXIT_TYPE_BUCKETS.length - 1, 1)
    : 0.5;

  // [2] direction bucket
  const direction = String(dsl.direction ?? "").toLowerCase();
  vec[2] = direction === "long" ? 0.0 : direction === "short" ? 0.5 : 1.0;

  // [3] symbol bucket
  const symbol = String(dsl.symbol ?? "").toUpperCase();
  vec[3] = SYMBOL_BUCKETS[symbol] ?? 0.75; // unknown → non-zero

  // [4] timeframe bucket (log-scaled, normalized to [0,1])
  const tf = String(dsl.timeframe ?? "").toLowerCase();
  const tfSecs = TIMEFRAME_LOG_SECONDS[tf] ?? 300; // default 5m
  const logMin = Math.log(60);     // 1m
  const logMax = Math.log(86400);  // 1d
  vec[4] = (Math.log(tfSecs) - logMin) / (logMax - logMin);

  // [5] regime bucket
  const regime = String(dsl.preferred_regime ?? "").toUpperCase();
  const regimeIdx = REGIME_BUCKETS.indexOf(regime as any);
  vec[5] = regimeIdx >= 0
    ? regimeIdx / Math.max(REGIME_BUCKETS.length - 1, 1)
    : 0.5;

  // [6] stop_loss_atr_multiple (clamped [0.5, 5.0] → normalized [0,1])
  const sl = Math.max(0.5, Math.min(5.0, Number(dsl.stop_loss_atr_multiple ?? 2.0)));
  vec[6] = (sl - 0.5) / (5.0 - 0.5);

  // [7] take_profit_atr_multiple (clamped [1.0, 10.0] → normalized [0,1], 0 if absent)
  const tp = dsl.take_profit_atr_multiple != null
    ? Math.max(1.0, Math.min(10.0, Number(dsl.take_profit_atr_multiple)))
    : null;
  vec[7] = tp != null ? (tp - 1.0) / (10.0 - 1.0) : 0.0;

  // [8–12] entry_params values (up to 5 numeric values, sorted by key, normalized)
  const entryParams = (dsl.entry_params && typeof dsl.entry_params === "object")
    ? dsl.entry_params as Record<string, unknown>
    : {};
  const sortedParamValues = Object.keys(entryParams)
    .sort() // deterministic key order
    .map((k) => Number(entryParams[k]))
    .filter((v) => Number.isFinite(v))
    .slice(0, 5);

  for (let i = 0; i < 5; i++) {
    if (i < sortedParamValues.length) {
      // log1p(v) / log1p(1000): maps [0, 1000] to [0, 1] with log compression.
      // Handles typical indicator periods (14, 20, 50, 200) and multipliers (1.5, 2.0, 2.5).
      const raw = Math.abs(sortedParamValues[i]);
      vec[8 + i] = Math.log1p(raw) / Math.log1p(1000);
    } else {
      vec[8 + i] = 0.0; // padding
    }
  }

  return vec;
}

/**
 * Compute SHA-256 fingerprint of a canonical DSL JSON representation.
 * Canonical = JSON with keys sorted recursively, so payload variations
 * (extra whitespace, different key order) don't fragment the fingerprint.
 */
export function computeDslFingerprint(dsl: DslRecord): string {
  const canonical = stableStringify(dsl);
  return createHash("sha256").update(canonical).digest("hex");
}

function stableStringify(val: unknown): string {
  if (val === null || typeof val !== "object" || Array.isArray(val)) {
    return JSON.stringify(val);
  }
  const sorted = Object.keys(val as object).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = stableStringify((val as Record<string, unknown>)[k]);
    return acc;
  }, {});
  return JSON.stringify(sorted);
}

// ─── Compression helpers (same pattern as A7 signal-correlation-service) ────

/**
 * Compress a float32 feature vector to a Buffer for DB storage.
 * Encodes as IEEE 754 float32 (4 bytes/element) then gzip.
 */
export function compressFeatureVector(vector: number[]): Buffer {
  const buf = Buffer.alloc(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    buf.writeFloatLE(vector[i], i * 4);
  }
  return gzipSync(buf);
}

/**
 * Decompress a stored feature vector back to number[].
 */
export function decompressFeatureVector(compressed: Buffer): number[] {
  const raw = gunzipSync(compressed);
  const result: number[] = [];
  for (let i = 0; i < raw.length; i += 4) {
    result.push(raw.readFloatLE(i));
  }
  return result;
}

// ─── Cosine similarity (inline — same formula as A7, no paid deps) ──────────

/**
 * Compute cosine similarity between two float vectors.
 * Returns 0 if either vector is all-zeros.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─── Diversity check result ──────────────────────────────────────────────────

export interface DslDiversityCheckResult {
  /** Whether the candidate DSL is sufficiently diverse (passed = accept). */
  passed: boolean;
  /** Human-readable reason for rejection, or confirmation of acceptance. */
  reason: string;
  /** Cosine similarity to the most similar existing DSL (null if no prior strategies). */
  maxSimilarity: number | null;
  /** Strategy ID that is most similar to the candidate (null if none). */
  mostSimilarStrategyId: string | null;
  /** DSL fingerprint of the candidate (for audit log). */
  candidateFingerprint: string;
  /** Similarity threshold that was applied. */
  threshold: number;
  /** Number of existing strategies checked. */
  strategiesChecked: number;
}

// ─── Primary gate ────────────────────────────────────────────────────────────

/**
 * Check whether a candidate DSL is sufficiently different from recently-generated
 * strategies. Hard gate: returns passed=false if any existing strategy has
 * cosine similarity > DSL_SIMILARITY_THRESHOLD.
 *
 * Fail-open on pipeline pause. Fail-open on DB error (non-blocking to main flow).
 *
 * Does NOT persist a feature vector. Persistence happens via persistDslFeatureVector()
 * AFTER the strategy is accepted and inserted into DB (not here — avoids polluting
 * the feature table with candidates that were rejected or failed later gates).
 *
 * @param dsl - Raw DSL JSON object from LLM output (pre-backtest)
 * @returns DslDiversityCheckResult
 */
export async function checkDslDiversity(
  dsl: DslRecord,
): Promise<DslDiversityCheckResult> {
  const threshold = DSL_SIMILARITY_THRESHOLD;
  const fingerprint = computeDslFingerprint(dsl);

  // Pipeline pause guard — pass-through when paused
  if (!(await isPipelineActive())) {
    return {
      passed: true,
      reason: "C9: diversity check skipped — pipeline paused",
      maxSimilarity: null,
      mostSimilarStrategyId: null,
      candidateFingerprint: fingerprint,
      threshold,
      strategiesChecked: 0,
    };
  }

  try {
    // Fast path: exact fingerprint match → immediate reject (identical DSL)
    const exactMatch = await db
      .select({ strategyId: strategyDslFeatures.strategyId })
      .from(strategyDslFeatures)
      .where(eq(strategyDslFeatures.dslFingerprint, fingerprint))
      .limit(1);

    if (exactMatch.length > 0) {
      logger.warn(
        { fingerprint, matchingStrategyId: exactMatch[0].strategyId },
        "C9: DSL exact fingerprint match — identical DSL already exists",
      );
      return {
        passed: false,
        reason:
          `C9 DSL diversity gate: BLOCKED — exact fingerprint match with strategy ${exactMatch[0].strategyId}. ` +
          `This DSL is a duplicate. Vary entry_indicator, exit_type, or key parameters.`,
        maxSimilarity: 1.0,
        mostSimilarStrategyId: exactMatch[0].strategyId,
        candidateFingerprint: fingerprint,
        threshold,
        strategiesChecked: 1,
      };
    }

    // Load last DSL_LOOKBACK feature vectors
    const rows = await db
      .select({
        strategyId: strategyDslFeatures.strategyId,
        featureVectorCompressed: strategyDslFeatures.featureVectorCompressed,
        featureDim: strategyDslFeatures.featureDim,
      })
      .from(strategyDslFeatures)
      .orderBy(desc(strategyDslFeatures.createdAt))
      .limit(DSL_LOOKBACK);

    if (rows.length === 0) {
      return {
        passed: true,
        reason: "C9 DSL diversity gate: PASSED — no prior strategies to compare against",
        maxSimilarity: null,
        mostSimilarStrategyId: null,
        candidateFingerprint: fingerprint,
        threshold,
        strategiesChecked: 0,
      };
    }

    // Extract candidate vector
    const candidateVec = extractDslFeatureVector(dsl);

    // Compute similarities
    let maxSim = -1;
    let mostSimilarId: string | null = null;

    for (const row of rows) {
      try {
        const refVec = decompressFeatureVector(row.featureVectorCompressed as Buffer);
        const sim = cosineSimilarity(candidateVec, refVec);
        if (sim > maxSim) {
          maxSim = sim;
          mostSimilarId = row.strategyId;
        }
      } catch (decompErr) {
        logger.warn(
          { strategyId: row.strategyId, err: decompErr },
          "C9: failed to decompress feature vector for comparison",
        );
      }
    }

    const roundedMax = maxSim >= 0 ? Math.round(maxSim * 10000) / 10000 : null;
    const exceeds = maxSim > threshold;

    if (exceeds) {
      logger.warn(
        {
          fingerprint,
          maxSimilarity: roundedMax,
          mostSimilarStrategyId: mostSimilarId,
          threshold,
          strategiesChecked: rows.length,
        },
        "C9: DSL similarity EXCEEDS threshold — candidate rejected pre-backtest",
      );
      return {
        passed: false,
        reason:
          `C9 DSL diversity gate: BLOCKED — cosine similarity ${roundedMax?.toFixed(3) ?? "?"} ` +
          `with existing strategy ${mostSimilarId} exceeds threshold ${threshold}. ` +
          `LLM mode-collapse detected. Vary entry_indicator, entry_params, exit_type, or regime to differentiate.`,
        maxSimilarity: roundedMax,
        mostSimilarStrategyId: mostSimilarId,
        candidateFingerprint: fingerprint,
        threshold,
        strategiesChecked: rows.length,
      };
    }

    logger.debug(
      {
        fingerprint,
        maxSimilarity: roundedMax,
        threshold,
        strategiesChecked: rows.length,
      },
      "C9: DSL diversity gate PASSED",
    );

    return {
      passed: true,
      reason:
        `C9 DSL diversity gate: PASSED — max similarity ${roundedMax?.toFixed(3) ?? "none"} ` +
        `(threshold: ${threshold}) across ${rows.length} recent strategies.`,
      maxSimilarity: roundedMax,
      mostSimilarStrategyId: mostSimilarId,
      candidateFingerprint: fingerprint,
      threshold,
      strategiesChecked: rows.length,
    };
  } catch (err) {
    // Fail-open: DB error doesn't block the pipeline
    logger.warn({ err, fingerprint }, "C9: diversity check threw — failing open (non-blocking)");
    return {
      passed: true,
      reason: "C9 DSL diversity gate: SKIPPED — DB error (fail-open, check logs)",
      maxSimilarity: null,
      mostSimilarStrategyId: null,
      candidateFingerprint: fingerprint,
      threshold,
      strategiesChecked: 0,
    };
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

/**
 * Persist a DSL feature vector after a strategy is accepted and inserted into DB.
 * Called fire-and-forget by agent-service after strategy DB insert succeeds.
 *
 * The UNIQUE(strategy_id) constraint means repeat calls are idempotent (onConflictDoNothing).
 *
 * @param strategyId - UUID of the persisted strategy
 * @param dsl        - DSL JSON record used to generate the strategy
 * @returns true on success, false on error (non-blocking)
 */
export async function persistDslFeatureVector(
  strategyId: string,
  dsl: DslRecord,
): Promise<boolean> {
  try {
    const vec = extractDslFeatureVector(dsl);
    const compressed = compressFeatureVector(vec);
    const fingerprint = computeDslFingerprint(dsl);

    await db
      .insert(strategyDslFeatures)
      .values({
        strategyId,
        featureVectorCompressed: compressed,
        featureDim: vec.length,
        dslFingerprint: fingerprint,
      })
      .onConflictDoNothing(); // UNIQUE(strategy_id) — idempotent

    logger.debug(
      {
        strategyId,
        fingerprint,
        featureDim: vec.length,
        compressedBytes: compressed.length,
      },
      "C9: DSL feature vector persisted",
    );
    return true;
  } catch (err) {
    logger.warn({ strategyId, err }, "C9: DSL feature vector persist failed (non-blocking)");
    return false;
  }
}

// ─── Audit log helper ────────────────────────────────────────────────────────

/**
 * Write a structured audit log entry for a DSL diversity rejection.
 * Complies with the Critic Optimizer candidate contract:
 *   parent_strategy_version, child_generation_version, old_params, new_params,
 *   reason_for_change, evidence_sources, expected_uplift, risk_penalties,
 *   replay_priority, acceptance_rejection_result, timestamps, run_identifiers.
 *
 * Non-blocking: any DB error is swallowed (fire-and-forget).
 */
export async function auditDslDiversityRejection(opts: {
  dsl: DslRecord;
  checkResult: DslDiversityCheckResult;
  source: string;
  correlationId?: string | null;
}): Promise<void> {
  try {
    await db
      .insert(auditLog)
      .values({
        action: "dsl_diversity.rejected",
        entityType: "strategy",
        entityId: null, // pre-persist — no strategy ID yet
        input: {
          dsl_name: String(opts.dsl.name ?? "unknown"),
          dsl_fingerprint: opts.checkResult.candidateFingerprint,
          source: opts.source,
        },
        result: {
          // Critic Optimizer candidate contract fields
          parent_strategy_version: opts.checkResult.mostSimilarStrategyId ?? "none",
          child_generation_version: "pre-persist",
          old_params: { most_similar_strategy_id: opts.checkResult.mostSimilarStrategyId },
          new_params: {
            entry_indicator: opts.dsl.entry_indicator,
            exit_type: opts.dsl.exit_type,
            direction: opts.dsl.direction,
            symbol: opts.dsl.symbol,
            timeframe: opts.dsl.timeframe,
            preferred_regime: opts.dsl.preferred_regime,
            stop_loss_atr_multiple: opts.dsl.stop_loss_atr_multiple,
          },
          reason_for_change: "C9 DSL diversity rejection — LLM mode collapse detected",
          evidence_sources: ["dsl_feature_vector_cosine_similarity"],
          expected_uplift: 0, // blocked — no uplift
          risk_penalties: [
            `cosine_similarity:${opts.checkResult.maxSimilarity?.toFixed(3) ?? "1.0"}`,
            `threshold:${opts.checkResult.threshold}`,
          ],
          replay_priority: 0, // blocked candidates are not queued for replay
          acceptance_rejection_result: "rejected",
          max_similarity: opts.checkResult.maxSimilarity,
          most_similar_strategy_id: opts.checkResult.mostSimilarStrategyId,
          strategies_checked: opts.checkResult.strategiesChecked,
          reason: opts.checkResult.reason,
        },
        status: "failure",
        decisionAuthority: "gate",
        correlationId: opts.correlationId ?? null,
      })
      .catch((auditErr) => {
        logger.warn({ auditErr }, "C9: audit log insert failed (non-blocking)");
      });
  } catch (err) {
    logger.warn({ err }, "C9: auditDslDiversityRejection threw (non-blocking)");
  }
}

// ─── Validation report surface ───────────────────────────────────────────────

/**
 * Return a diversity report entry suitable for inclusion in the strategy-prevalidator
 * validation report. Runs a similarity check and returns a structured result.
 *
 * Returns a lightweight report object — does NOT persist anything. The prevalidator
 * calls this before backtest to surface the diversity score in validation output.
 */
export async function getDslDiversityReport(dsl: DslRecord): Promise<{
  checked: boolean;
  passed: boolean;
  maxSimilarity: number | null;
  mostSimilarStrategyId: string | null;
  threshold: number;
  strategiesChecked: number;
  summary: string;
}> {
  const result = await checkDslDiversity(dsl);
  return {
    checked: true,
    passed: result.passed,
    maxSimilarity: result.maxSimilarity,
    mostSimilarStrategyId: result.mostSimilarStrategyId,
    threshold: result.threshold,
    strategiesChecked: result.strategiesChecked,
    summary: result.reason,
  };
}
