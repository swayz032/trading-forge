import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategyGraveyard } from "../db/schema.js";
import { OllamaClient } from "./ollama-client.js";
import { logger } from "../index.js";

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

    for (const entry of graveyardEntries) {
      if (!entry.embedding) continue;

      const graveyardEmbedding = entry.embedding as number[];
      if (!Array.isArray(graveyardEmbedding) || graveyardEmbedding.length === 0) continue;

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
    };
  }
}
