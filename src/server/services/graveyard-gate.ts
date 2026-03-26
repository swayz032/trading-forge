import { db } from "../db/index.js";
import { strategyGraveyard } from "../db/schema.js";
import { OllamaClient } from "./ollama-client.js";
import { logger } from "../index.js";

const SIMILARITY_THRESHOLD = 0.85;

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

export class GraveyardGate {
  private ollama: OllamaClient;

  constructor(ollamaClient?: OllamaClient) {
    this.ollama = ollamaClient ?? new OllamaClient();
  }

  /**
   * Check if a strategy description is too similar to any dead strategy in the graveyard.
   * Returns blocked=true if similarity > threshold (default 0.85).
   */
  async check(
    strategyDescription: string,
    threshold = SIMILARITY_THRESHOLD,
  ): Promise<GraveyardCheckResult> {
    // 1. Embed the candidate strategy
    let candidateEmbedding: number[];
    try {
      const embeddings = await this.ollama.embed(strategyDescription);
      candidateEmbedding = embeddings[0];
    } catch (err) {
      logger.warn({ err }, "Graveyard gate: embedding failed, allowing strategy through");
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
      })
      .from(strategyGraveyard)
      .limit(500);

    // 3. Compare against each graveyard entry
    let maxSimilarity = 0;
    let matchedId: string | null = null;
    let matchedName: string | null = null;

    for (const entry of graveyardEntries) {
      if (!entry.embedding) continue;

      const graveyardEmbedding = entry.embedding as number[];
      if (!Array.isArray(graveyardEmbedding) || graveyardEmbedding.length === 0) continue;

      const similarity = cosineSimilarity(candidateEmbedding, graveyardEmbedding);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        matchedId = entry.id;
        matchedName = entry.name;
      }
    }

    const blocked = maxSimilarity > threshold;

    if (blocked) {
      logger.info(
        { similarity: maxSimilarity, matchedName, threshold },
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
