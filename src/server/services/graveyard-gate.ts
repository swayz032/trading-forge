import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategyGraveyard, auditLog } from "../db/schema.js";
import { OllamaClient } from "./ollama-client.js";
// Band B (spec-onboarding-bridge, 2026-07-02) — was `from "../index.js"`. That
// pulled in the full Express app bootstrap (routes/agent.ts -> agent-service.ts,
// which imports THIS file) purely to get a `logger` object. Confirmed circular
// dependency: any standalone entry point that imports agent-service.ts (not
// going through src/server/index.ts as the true root) hit a Node ESM TDZ
// ReferenceError ("Cannot access 'AgentService' before initialization") at
// routes/agent.ts:102. `../lib/logger.js` is the same pino config (LOG_LEVEL,
// dev pino-pretty transport) plus a test-runtime silence guard — behaviorally
// equivalent, zero functional change, severs the edge.
import { logger } from "../lib/logger.js";

const SIMILARITY_THRESHOLD = 0.85;

/**
 * Category-match cosine boost factor.
 * When the candidate strategy's failure category matches a graveyard entry's
 * failure category, the raw cosine score is multiplied by this factor before
 * threshold comparison. Capped at 1.0 so a near-miss in a matching category
 * never exceeds a confirmed identical match.
 */
const CATEGORY_MATCH_BOOST = 1.05;

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

export interface GraveyardCheckResult {
  blocked: boolean;
  similarity: number;
  matchedGraveyardId: string | null;
  matchedName: string | null;
  reason: string;
  /**
   * deepscan14 D3: true when the check could not meaningfully evaluate ANY graveyard
   * entry because every stored embedding has a different dimensionality than the
   * candidate's (e.g. current embedder is gemma-dim, stored entries are nomic-768).
   * `blocked=false` in this state means "gate INACTIVE" — NOT "checked, no match".
   * Absent/false = the gate ran a real comparison.
   */
  inactive?: boolean;
}

export interface RelevantFailure {
  id: string;
  name: string;
  failureCategory: string | null;
  failureSeverity: string | null;
  deathReason: string | null;
  searchableMetrics: unknown;
}

export class GraveyardGate {
  private ollama: OllamaClient;

  constructor(ollamaClient?: OllamaClient) {
    this.ollama = ollamaClient ?? new OllamaClient();
  }

  /**
   * Fetch dead strategies from the graveyard filtered by failure category.
   * Returns the top N entries ordered by death date descending (most recent first).
   * Used by the critic and scout to pre-load relevant failure context before
   * evaluating a candidate with a known failure archetype.
   *
   * @param archetype - failure_category value to filter on (e.g. "robustness", "regime")
   * @param limit     - max rows to return (default 10)
   */
  async getRelevantFailures(archetype: string, limit = 10): Promise<RelevantFailure[]> {
    const rows = await db
      .select({
        id: strategyGraveyard.id,
        name: strategyGraveyard.name,
        failureCategory: strategyGraveyard.failureCategory,
        failureSeverity: strategyGraveyard.failureSeverity,
        deathReason: strategyGraveyard.deathReason,
        searchableMetrics: strategyGraveyard.searchableMetrics,
      })
      .from(strategyGraveyard)
      .where(eq(strategyGraveyard.failureCategory, archetype))
      .orderBy(desc(strategyGraveyard.deathDate))
      .limit(limit);

    return rows;
  }

  /**
   * Fetch dead strategies by failure category, returning failure modes and death reasons.
   * Unlike getRelevantFailures which filters by archetype for a single strategy,
   * this method provides a broader view — useful for system-wide failure dashboards
   * and for injecting "lessons learned" into strategy generation prompts.
   *
   * @param category - failure_category value (e.g. "robustness", "regime", "execution")
   * @param limit    - max rows to return (default 20)
   */
  async getFailuresByCategory(category: string, limit = 20): Promise<Array<{
    id: string;
    name: string;
    failureModes: string[];
    deathReason: string | null;
    failureSeverity: string | null;
    deathDate: Date;
  }>> {
    const rows = await db
      .select({
        id: strategyGraveyard.id,
        name: strategyGraveyard.name,
        failureModes: strategyGraveyard.failureModes,
        deathReason: strategyGraveyard.deathReason,
        failureSeverity: strategyGraveyard.failureSeverity,
        deathDate: strategyGraveyard.deathDate,
      })
      .from(strategyGraveyard)
      .where(eq(strategyGraveyard.failureCategory, category))
      .orderBy(desc(strategyGraveyard.deathDate))
      .limit(limit);

    return rows.map((r) => ({
      ...r,
      failureSeverity: r.failureSeverity != null ? String(r.failureSeverity) : null,
    }));
  }

  /**
   * Check if a strategy description is too similar to any dead strategy in the graveyard.
   * Returns blocked=true if similarity > threshold (default 0.85).
   *
   * @param strategyDescription - natural-language description of the candidate strategy
   * @param threshold           - cosine similarity threshold (default 0.85)
   * @param candidateCategory   - optional failure_category hint for the candidate.
   *   When provided and a graveyard entry shares the same category, the raw cosine
   *   score receives a 1.05x boost (capped at 1.0) before threshold comparison.
   *   This prevents a near-miss in a known bad category from slipping through.
   */
  async check(
    strategyDescription: string,
    threshold = SIMILARITY_THRESHOLD,
    candidateCategory?: string,
  ): Promise<GraveyardCheckResult> {
    // 1. Embed the candidate strategy
    let candidateEmbedding: number[];
    try {
      const embeddings = await this.ollama.embed(strategyDescription);
      candidateEmbedding = embeddings[0];
    } catch (err) {
      logger.warn({ err }, "Graveyard gate BYPASSED — Ollama embedding unavailable");
      return {
        blocked: false,
        similarity: 0,
        matchedGraveyardId: null,
        matchedName: null,
        reason: "Embedding service unavailable — gate bypassed",
        inactive: true,
      };
    }

    // 2. Fetch graveyard entries with embeddings (capped to prevent memory pressure)
    const graveyardEntries = await db
      .select({
        id: strategyGraveyard.id,
        name: strategyGraveyard.name,
        embedding: strategyGraveyard.embedding,
        failureCategory: strategyGraveyard.failureCategory,
      })
      .from(strategyGraveyard)
      .limit(500);

    // 3. Compare against each graveyard entry.
    // When candidateCategory is provided, apply a 1.05x boost to cosine scores
    // for entries whose failureCategory matches — capped at 1.0. This makes the
    // gate slightly more aggressive for candidates that share a known bad category.
    let maxSimilarity = 0;
    let matchedId: string | null = null;
    let matchedName: string | null = null;
    // deepscan14 D3: track dimension mismatches separately from "no embedding at
    // all" so we can tell "compared every entry, none matched" apart from
    // "compared nothing because every embedding is the wrong shape."
    let entriesWithEmbedding = 0;
    let dimMismatchCount = 0;

    for (const entry of graveyardEntries) {
      if (!entry.embedding) continue;

      const graveyardEmbedding = entry.embedding as number[];
      if (!Array.isArray(graveyardEmbedding) || graveyardEmbedding.length === 0) continue;
      entriesWithEmbedding++;

      if (graveyardEmbedding.length !== candidateEmbedding.length) {
        // cosineSimilarity() would silently return 0 for this pair — that's
        // indistinguishable from "genuinely dissimilar." Count it explicitly
        // instead so a system-wide embedder swap surfaces as gate-inactive
        // rather than as a clean "no match" pass.
        dimMismatchCount++;
        continue;
      }

      let similarity = cosineSimilarity(candidateEmbedding, graveyardEmbedding);

      // Category-match boost: if the candidate has a known failure category and this
      // graveyard entry shares that category, nudge the score up slightly. Capped at
      // 1.0 so an identical match never scores above 1.0 after boosting.
      if (
        candidateCategory &&
        entry.failureCategory &&
        candidateCategory === entry.failureCategory
      ) {
        similarity = Math.min(1.0, similarity * CATEGORY_MATCH_BOOST);
      }

      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        matchedId = entry.id;
        matchedName = entry.name;
      }
    }

    // deepscan14 D3: if every entry that HAD an embedding was skipped for a
    // dimension mismatch, the gate compared nothing at all — that is gate-INACTIVE,
    // not "checked, no match." (e.g. a candidate embedded with gemma against a
    // graveyard whose embeddings are all nomic-768.) Distinguish it loudly.
    const allMismatched = entriesWithEmbedding > 0 && dimMismatchCount === entriesWithEmbedding;

    if (allMismatched) {
      logger.warn(
        { candidateDim: candidateEmbedding.length, entriesWithEmbedding, dimMismatchCount },
        "Graveyard gate INACTIVE — every stored embedding has a different dimensionality than the candidate; nothing was compared",
      );
      db.insert(auditLog).values({
        action: "graveyard.similarity_gate_inactive_dim_mismatch",
        entityType: "strategy_graveyard",
        entityId: null,
        decisionAuthority: "system",
        input: { candidateEmbeddingDim: candidateEmbedding.length } as Record<string, unknown>,
        result: { entriesWithEmbedding, dimMismatchCount } as Record<string, unknown>,
        status: "success",
        correlationId: null,
      }).catch((err: unknown) => {
        logger.warn({ err }, "graveyard-gate: audit write failed for dim-mismatch telemetry — non-blocking");
      });

      return {
        blocked: false,
        similarity: 0,
        matchedGraveyardId: null,
        matchedName: null,
        reason: `Gate INACTIVE: all ${entriesWithEmbedding} graveyard embedding(s) have a different dimensionality ` +
          `than the candidate (candidate dim=${candidateEmbedding.length}) — embedder mismatch, nothing was compared`,
        inactive: true,
      };
    }

    const blocked = maxSimilarity > threshold;

    if (blocked) {
      logger.info(
        { similarity: maxSimilarity, matchedName, threshold, candidateCategory },
        "Graveyard gate BLOCKED strategy — too similar to dead strategy",
      );
    }

    return {
      blocked,
      similarity: Math.round(maxSimilarity * 1000) / 1000,
      matchedGraveyardId: maxSimilarity > 0.5 ? matchedId : null,
      matchedName: maxSimilarity > 0.5 ? matchedName : null,
      reason: blocked
        ? `Blocked: ${(maxSimilarity * 100).toFixed(1)}% similar to dead strategy "${matchedName}"`
        : `Passed: max similarity ${(maxSimilarity * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(0)}%)`,
      inactive: false,
    };
  }
}
