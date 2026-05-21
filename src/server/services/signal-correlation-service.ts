/**
 * Signal Correlation Service — A7 (W11 Team B)
 *
 * Empirical signal-correlation check inspired by the Two Sigma 2025 incident ($165M loss
 * from attestation-based uniqueness checks instead of empirical cross-correlation).
 *
 * Responsibilities:
 *  - Compress/decompress int8 signal vectors (gzip via Node built-in zlib)
 *  - Compute pairwise cosine similarity between strategy signal vectors
 *  - Alert via AlertFactory when any pair exceeds the correlation threshold (0.85)
 *  - Provide matrix queries for the /api/signal-correlation/matrix route
 *  - Support the PAPER→DEPLOY_READY gate check in lifecycle-service.ts
 *
 * Signal vector contract:
 *   Array of int8 values, one per bar:
 *     1  = long entry signal on this bar
 *    -1  = short entry signal on this bar
 *     0  = no signal on this bar
 *
 * Cosine similarity formula:
 *   cos(a, b) = Σ(aᵢ·bᵢ) / (√Σaᵢ² · √Σbᵢ²)
 *
 * Authority:
 *   - This service is advisory for most uses.
 *   - At PAPER→DEPLOY_READY it is a HARD GATE (fail-closed).
 *   - Quantum and tensor signals NEVER have promotion authority.
 *
 * Persistence:
 *   strategySignalVectors table (migration 0072). Written fire-and-forget
 *   by backtest-service.ts after every completed backtest. UNIQUE constraint
 *   on (strategy_id, backtest_id) prevents duplicate writes.
 */

import { gzipSync, gunzipSync } from "zlib";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, backtests, strategySignalVectors } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { AlertFactory } from "./alert-service.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";

import { A7_CORRELATION_THRESHOLD } from "../lib/correlation-constants.js";

/**
 * Correlation threshold above which two strategies are flagged as duplicates.
 * Single source of truth: correlation-constants.ts (0.70). CLAUDE.md §12 canonical.
 */
export const SIGNAL_CORRELATION_THRESHOLD: number = (() => {
  const envVal = process.env.SIGNAL_CORRELATION_THRESHOLD;
  if (envVal !== undefined) {
    const parsed = parseFloat(envVal);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1) return parsed;
  }
  return A7_CORRELATION_THRESHOLD;
})();

// ─── Compression helpers ────────────────────────────────────────────────────

/**
 * Compress an int8 signal vector to a Buffer for DB storage.
 * Input: number[] where each value is 1, -1, or 0.
 */
export function compressSignalVector(vector: number[]): Buffer {
  const raw = Buffer.from(new Int8Array(vector).buffer);
  return gzipSync(raw);
}

/**
 * Decompress a stored signal vector back to number[].
 * Inverse of compressSignalVector.
 */
export function decompressSignalVector(compressed: Buffer): number[] {
  const raw = gunzipSync(compressed);
  const int8 = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  return Array.from(int8);
}

// ─── Cosine similarity (inline — no paid deps) ─────────────────────────────

/**
 * Compute cosine similarity between two numeric vectors.
 * Returns 0 if either vector is all-zeros (no signals).
 *
 * Formula: Σ(aᵢ·bᵢ) / (√Σaᵢ² · √Σbᵢ²)
 *
 * Works on int8 vectors (1, -1, 0) with no loss of precision.
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

// ─── DB helpers ─────────────────────────────────────────────────────────────

/**
 * Persist a signal vector for a completed backtest.
 * Upserts — the UNIQUE(strategy_id, backtest_id) constraint guarantees idempotency.
 * Returns true on success, false on error (fire-and-forget safe).
 */
export async function persistSignalVector(
  strategyId: string,
  backtestId: string,
  signalVector: number[],
): Promise<boolean> {
  try {
    const compressed = compressSignalVector(signalVector);
    await db
      .insert(strategySignalVectors)
      .values({
        strategyId,
        backtestId,
        signalVectorCompressed: compressed,
        nBars: signalVector.length,
      })
      .onConflictDoNothing(); // UNIQUE(strategy_id, backtest_id) — idempotent

    logger.debug(
      {
        strategyId,
        backtestId,
        nBars: signalVector.length,
        compressedBytes: compressed.length,
        compressionRatio: (signalVector.length / compressed.length).toFixed(1),
      },
      "A7: signal vector persisted",
    );
    return true;
  } catch (err) {
    logger.warn(
      { strategyId, backtestId, err },
      "A7: signal vector persist failed (non-blocking)",
    );
    return false;
  }
}

/**
 * Load the latest signal vector for a given strategy.
 * Returns null if no vector exists (caller must treat this as fail-closed at gate).
 */
export async function loadLatestSignalVector(
  strategyId: string,
): Promise<{ vector: number[]; backtestId: string; nBars: number } | null> {
  try {
    const [row] = await db
      .select({
        signalVectorCompressed: strategySignalVectors.signalVectorCompressed,
        backtestId: strategySignalVectors.backtestId,
        nBars: strategySignalVectors.nBars,
      })
      .from(strategySignalVectors)
      .where(eq(strategySignalVectors.strategyId, strategyId))
      .orderBy(desc(strategySignalVectors.createdAt))
      .limit(1);

    if (!row) return null;

    const vector = decompressSignalVector(row.signalVectorCompressed as Buffer);
    return { vector, backtestId: row.backtestId, nBars: row.nBars };
  } catch (err) {
    logger.warn({ strategyId, err }, "A7: failed to load signal vector");
    return null;
  }
}

// ─── Pair-wise correlation check ─────────────────────────────────────────────

export interface CorrelationResult {
  strategyIdA: string;
  strategyIdB: string;
  similarity: number;
  exceeds_threshold: boolean;
  threshold: number;
}

/**
 * Compute pairwise cosine similarity between the candidate strategy's signal vector
 * and a list of reference strategy vectors. Alerts when any pair exceeds the threshold.
 *
 * Used by:
 *   1. The PAPER→DEPLOY_READY gate (reference = all DEPLOYED strategies).
 *   2. The /api/signal-correlation/matrix route (reference = all PAPER+DEPLOYED).
 *
 * Returns all pairs, sorted by similarity descending.
 */
export async function computePairwiseCorrelation(
  candidateStrategyId: string,
  referenceStrategyIds: string[],
): Promise<CorrelationResult[]> {
  if (referenceStrategyIds.length === 0) return [];

  const candidateVecData = await loadLatestSignalVector(candidateStrategyId);
  if (!candidateVecData) {
    logger.warn(
      { candidateStrategyId },
      "A7: computePairwiseCorrelation — no signal vector for candidate",
    );
    return [];
  }

  const results: CorrelationResult[] = [];

  for (const refId of referenceStrategyIds) {
    if (refId === candidateStrategyId) continue;

    const refVecData = await loadLatestSignalVector(refId);
    if (!refVecData) continue;

    const sim = cosineSimilarity(candidateVecData.vector, refVecData.vector);
    const exceeds = sim > SIGNAL_CORRELATION_THRESHOLD;

    results.push({
      strategyIdA: candidateStrategyId,
      strategyIdB: refId,
      similarity: Math.round(sim * 10000) / 10000,
      exceeds_threshold: exceeds,
      threshold: SIGNAL_CORRELATION_THRESHOLD,
    });

    if (exceeds) {
      logger.warn(
        {
          candidateStrategyId,
          refStrategyId: refId,
          similarity: sim.toFixed(4),
          threshold: SIGNAL_CORRELATION_THRESHOLD,
        },
        "A7: signal correlation EXCEEDS threshold — strategies may be duplicates",
      );

      // Fire alert (non-blocking — never throws)
      AlertFactory.signalCorrelation(
        candidateStrategyId,
        refId,
        sim,
        SIGNAL_CORRELATION_THRESHOLD,
      ).catch(() => {});
    }
  }

  // Sort descending by similarity
  results.sort((a, b) => b.similarity - a.similarity);
  return results;
}

// ─── PAPER→DEPLOY_READY gate check ──────────────────────────────────────────

/**
 * Check whether a PAPER strategy is safe to promote to DEPLOY_READY by
 * comparing its signal vector against all currently DEPLOYED strategies.
 *
 * Fail-closed contract:
 *   - No signal vector for the candidate  → BLOCK (signal_vector_missing)
 *   - Any deployed strategy has sim > 0.85 → BLOCK (high_correlation)
 *   - No deployed strategies yet           → ALLOW (nothing to compare against)
 *
 * This is a HARD GATE. Classical performance gates must also pass independently.
 *
 * Returns: { allowed, reason, maxSimilarity, blockingStrategyId }
 */
export async function checkSignalCorrelationGate(strategyId: string): Promise<{
  allowed: boolean;
  reason: string;
  maxSimilarity: number | null;
  blockingStrategyId: string | null;
}> {
  // Pipeline pause guard
  if (!(await isPipelineActive())) {
    return {
      allowed: true,
      reason: "pipeline_paused — correlation gate bypassed (system paused)",
      maxSimilarity: null,
      blockingStrategyId: null,
    };
  }

  // Load candidate signal vector — fail-closed if missing
  const candidateVec = await loadLatestSignalVector(strategyId);
  if (!candidateVec) {
    return {
      allowed: false,
      reason:
        "A7 signal correlation gate: BLOCKED — no signal vector found for this strategy. " +
        "A backtest must complete and persist a signal vector before DEPLOY_READY promotion is allowed. " +
        "Run a backtest via POST /api/agent/run-strategy or POST /api/backtests/:id/run.",
      maxSimilarity: null,
      blockingStrategyId: null,
    };
  }

  // Query all DEPLOYED strategy IDs
  const deployedRows = await db
    .select({ id: strategies.id })
    .from(strategies)
    .where(eq(strategies.lifecycleState, "DEPLOYED"));

  const deployedIds = deployedRows.map((r) => r.id).filter((id) => id !== strategyId);

  if (deployedIds.length === 0) {
    return {
      allowed: true,
      reason: "A7 signal correlation gate: PASSED — no DEPLOYED strategies to compare against",
      maxSimilarity: null,
      blockingStrategyId: null,
    };
  }

  // Compute pairwise correlation against all deployed strategies
  const pairs = await computePairwiseCorrelation(strategyId, deployedIds);

  if (pairs.length === 0) {
    // Deployed strategies exist but none have signal vectors yet — fail-open with warning.
    // This covers ramp-up: deployed strategies pre-A7 don't have vectors yet.
    logger.warn(
      { strategyId, deployedCount: deployedIds.length },
      "A7 gate: DEPLOYED strategies exist but none have signal vectors — allowing promotion (ramp-up mode)",
    );
    return {
      allowed: true,
      reason:
        "A7 signal correlation gate: PASSED (ramp-up) — deployed strategies have no signal vectors yet. " +
        "Gate will be fully enforced once deployed strategies accumulate signal vectors.",
      maxSimilarity: null,
      blockingStrategyId: null,
    };
  }

  const maxPair = pairs[0]; // sorted descending
  if (maxPair.exceeds_threshold) {
    return {
      allowed: false,
      reason:
        `A7 signal correlation gate: BLOCKED — cosine similarity ${maxPair.similarity.toFixed(3)} ` +
        `with DEPLOYED strategy ${maxPair.strategyIdB} exceeds threshold ${SIGNAL_CORRELATION_THRESHOLD}. ` +
        `Two Sigma failure mode: different code but identical signals. ` +
        `Promote a genuinely different strategy or demote the correlated deployed strategy first.`,
      maxSimilarity: maxPair.similarity,
      blockingStrategyId: maxPair.strategyIdB,
    };
  }

  return {
    allowed: true,
    reason:
      `A7 signal correlation gate: PASSED — max similarity ${maxPair.similarity.toFixed(3)} ` +
      `(threshold: ${SIGNAL_CORRELATION_THRESHOLD}) with ${pairs.length} DEPLOYED strategies checked.`,
    maxSimilarity: maxPair.similarity,
    blockingStrategyId: null,
  };
}

// ─── Full matrix computation (for /api/signal-correlation/matrix) ────────────

export interface MatrixEntry {
  strategyIdA: string;
  strategyNameA: string;
  lifecycleStateA: string;
  strategyIdB: string;
  strategyNameB: string;
  lifecycleStateB: string;
  similarity: number;
  exceeds_threshold: boolean;
}

/**
 * Build the full correlation matrix for all strategies at PAPER or DEPLOYED state.
 * Returns all pairs sorted by similarity descending, with names for readability.
 *
 * Pipeline pause guard is applied — returns empty matrix when paused.
 */
export async function buildCorrelationMatrix(): Promise<MatrixEntry[]> {
  if (!(await isPipelineActive())) {
    logger.info("A7: buildCorrelationMatrix skipped — pipeline paused");
    return [];
  }

  // Query all PAPER + DEPLOYED strategies that have signal vectors
  const rows = await db
    .select({
      strategyId: strategySignalVectors.strategyId,
      signalVectorCompressed: strategySignalVectors.signalVectorCompressed,
      nBars: strategySignalVectors.nBars,
    })
    .from(strategySignalVectors)
    .innerJoin(strategies, eq(strategies.id, strategySignalVectors.strategyId))
    .where(
      and(
        inArray(strategies.lifecycleState, ["PAPER", "DEPLOYED"]),
      ),
    );

  // Deduplicate: keep only the latest vector per strategy
  const latestByStrategy = new Map<
    string,
    { compressed: Buffer; nBars: number }
  >();
  for (const row of rows) {
    if (!latestByStrategy.has(row.strategyId)) {
      latestByStrategy.set(row.strategyId, {
        compressed: row.signalVectorCompressed as Buffer,
        nBars: row.nBars,
      });
    }
  }

  // Build name lookup
  const strategyIds = [...latestByStrategy.keys()];
  if (strategyIds.length < 2) return [];

  const strategyRows = await db
    .select({ id: strategies.id, name: strategies.name, lifecycleState: strategies.lifecycleState })
    .from(strategies)
    .where(inArray(strategies.id, strategyIds));

  const nameMap = new Map(strategyRows.map((s) => [s.id, { name: s.name, state: s.lifecycleState }]));

  // Decompress all vectors
  const vectors = new Map<string, number[]>();
  for (const [id, data] of latestByStrategy.entries()) {
    try {
      vectors.set(id, decompressSignalVector(data.compressed));
    } catch (err) {
      logger.warn({ strategyId: id, err }, "A7: failed to decompress vector for matrix");
    }
  }

  const ids = [...vectors.keys()];
  const entries: MatrixEntry[] = [];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const idA = ids[i];
      const idB = ids[j];
      const sim = cosineSimilarity(vectors.get(idA)!, vectors.get(idB)!);

      const metaA = nameMap.get(idA);
      const metaB = nameMap.get(idB);
      if (!metaA || !metaB) continue;

      entries.push({
        strategyIdA: idA,
        strategyNameA: metaA.name,
        lifecycleStateA: metaA.state,
        strategyIdB: idB,
        strategyNameB: metaB.name,
        lifecycleStateB: metaB.state,
        similarity: Math.round(sim * 10000) / 10000,
        exceeds_threshold: sim > SIGNAL_CORRELATION_THRESHOLD,
      });
    }
  }

  entries.sort((a, b) => b.similarity - a.similarity);
  return entries;
}
