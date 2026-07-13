/**
 * extraction-result-cache.ts — H1 conveyor caching (2026-07-13).
 *
 * LAYER 1 — content-addressed RESULT cache: never re-buy the same work. Keyed by
 * (model, videoId, promptHash) where promptHash is a content hash of the EXACT
 * frozen instrument. A re-run / resume / re-measurement of the same video through
 * the same prompt+model reads off disk for ZERO tokens. This is the rule tonight
 * proved twice (locator crash-resume; the ~3,500-call graduation-storm retry-
 * without-memory). Rule: every retry checks the cache FIRST; every result lands
 * in the cache immediately.
 *
 * LAYER 2 (OpenAI prompt cache) is prompt DISCIPLINE, not code: shape calls
 * static-prefix-first (instructions + transcript first, per-strategy question
 * last) and run a video's calls back-to-back while the prefix is warm. This module
 * records the `cached_tokens` the API reports (the day-one empirical unknown:
 * whether cached tokens count full or discounted against the free allowance —
 * budgeted at FULL weight until measured, so surprises can only favor the wallet).
 *
 * LAYER 3 (transcripts hashed on disk, local-gemma locator, Claude grading) is
 * already done and lives elsewhere. Deliberately NOT built: semantic/embedding/
 * distributed caches — over-engineering for a one-tower pipeline.
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

/** Stable content hash of a frozen instrument's text (first 16 hex of sha256).
 *  ANY edit to the prompt changes the hash → cache miss → correct re-run. */
export function promptHash(instrumentText: string): string {
  return createHash("sha256").update(instrumentText).digest("hex").slice(0, 16);
}

export function cacheKey(model: string, videoId: string, hash: string): string {
  // filesystem-safe
  return `${model.replace(/[^\w.-]/g, "_")}__${videoId.replace(/[^\w.-]/g, "_")}__${hash}`;
}

export interface CachedResult<T = unknown> {
  key: string;
  model: string;
  videoId: string;
  promptHash: string;
  result: T;
  /** Tokens the ORIGINAL (uncached) call spent — recorded for honesty, but a
   *  cache HIT spends ZERO now. */
  originalTokens: number;
  /** cached_tokens the API reported on the original call (Layer-2 telemetry). */
  cachedTokensReported: number;
}

export class ExtractionResultCache {
  constructor(private dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  private path(key: string): string {
    return join(this.dir, `${key}.json`);
  }
  /** Layer-1 lookup. Returns the cached result (ZERO tokens) or null. */
  get<T>(model: string, videoId: string, hash: string): CachedResult<T> | null {
    const p = this.path(cacheKey(model, videoId, hash));
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as CachedResult<T>;
    } catch {
      return null; // corrupt entry → treat as miss (safe; re-buys once)
    }
  }
  /** Write a result immediately after a real call (before anything can crash). */
  put<T>(entry: CachedResult<T>): void {
    writeFileSync(this.path(entry.key), JSON.stringify(entry, null, 1));
  }
}
