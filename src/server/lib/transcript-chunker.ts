/**
 * Wave 26 Pass L (2026-05-27) — Chunked transcript extraction for gemma4:e4b-it-qat.
 *
 * PROBLEM
 *   RTX 5060 8 GB VRAM hosts gemma4:e4b-it-qat (~5.5-7 GB resident). At
 *   TRANSCRIPT_EXTRACTOR_NUM_CTX=32768 the KV cache + activations push past
 *   the ~1 GB headroom on 24K-37K-char transcripts. Failure mode:
 *     `GGML_ASSERT(ctx->mem_buffer != NULL) failed`
 *   (genuine VRAM OOM at the GGML layer, not a prompt or schema issue).
 *
 *   Known failing fixture: video gddYspvW0_w
 *   ("The ONLY 2 indicators I use to make $2,134/Day Trading", 24,720 chars).
 *
 * SOLUTION
 *   1. Split long transcripts into 2-3 overlapping ~10K-char chunks
 *      (overlap ~1K to preserve cross-chunk context for the LLM).
 *   2. Run each chunk through gemma4:e4b-it-qat SEPARATELY at a SAFE per-chunk ctx
 *      (default 12288 = ~3K tokens chunk input + ~3K prompt + 4K output;
 *      fits comfortably in the ~1 GB VRAM headroom).
 *   3. Sequential, never parallel — single Ollama instance per GPU.
 *   4. Merge per-chunk results by concept_name/name with field-level preference:
 *        - longer entry_sequence wins
 *        - non-null direction wins (preferring "both")
 *        - non-null source_claim_* wins
 *        - confluences UNION-deduplicated by name
 *        - rejected_strategies UNION across all chunks
 *        - instrument_classification: first non-null wins
 *
 * RESEARCH (2026-05 best-practice for gemma3-class on 8 GB VRAM)
 *   - Ollama issue #9890 + multiple community reports: 8K-16K ctx is the safe
 *     stable range on 8 GB cards for 4B-class gemma; 32K "fits but is tight"
 *     (matches the existing comment in model-router.ts:95).
 *   - Ollama issue #12247 / #10410 / #9863: GGML_ASSERT mem_buffer failures
 *     trace to KV-cache + activation overflow when ctx pushed near ceiling.
 *   - WillItRunAI 2026 Gemma 3 guide: 12B at Q4_K_M (~6.7 GB) + 8-16K ctx is
 *     the institutional sweet spot on 8 GB cards. For 4B (e2b) the same ctx
 *     ceiling applies because KV cache scales linearly with ctx, not weights.
 *
 *   Chosen per-chunk ctx: 12288 (12K). Headroom calc on the failing fixture:
 *     10K-char chunk ≈ 2.5K input tokens
 *     + ~3.0K prompt overhead (KB cards + few-shot + schema preamble)
 *     + 4096 num_predict ceiling
 *     ≈ 9.6K tokens → fits in 12288 with ~25% margin.
 *
 * CONTRACT
 *   This module is PURE-FUNCTIONAL for chunkTranscript() + mergeChunkResults().
 *   extractTranscriptChunked() is the orchestrator (impure — calls Ollama).
 *
 *   The chunked path uses setChunkedNumCtxOverride() to transiently swap
 *   num_ctx for the duration of each per-chunk call. The global
 *   TRANSCRIPT_EXTRACTOR_NUM_CTX=32768 remains the default for callers that
 *   bypass the chunker (5 long-form videos depend on the full 32K ctx and
 *   must not regress).
 */

import { callScoutExtractLlm, setChunkedNumCtxOverride } from "../services/model-router.js";

/** Default per-chunk character budget. ~2.5K tokens → fits 12K ctx with margin. */
export const DEFAULT_CHUNK_CHARS = 10_000;
/** Default cross-chunk overlap. Preserves mid-strategy phrasing across boundaries. */
export const DEFAULT_OVERLAP_CHARS = 1_000;
/** Default per-chunk num_ctx for gemma4:e4b-it-qat on 8 GB VRAM. */
export const DEFAULT_CHUNK_NUM_CTX = 12_288;
/** Transcripts shorter than this skip chunking entirely (use full window).
 *  Wave 26 Pass L (2026-05-27): lowered 14_000 → 12_000 after FqxEKDxemtI
 *  (14,000 chars exact — sat right at the boundary) hit OOM on single-pass.
 *  Videos in the 12-14K band sit on the VRAM edge for gemma4:e4b-it-qat on 8GB. */
export const CHUNKING_THRESHOLD_CHARS = 12_000;

export interface ChunkerOptions {
  chunkChars?: number;
  overlapChars?: number;
}

export interface ChunkedExtractOptions extends ChunkerOptions {
  /** Per-chunk Ollama num_ctx. Default 12288. Lower further if OOM persists. */
  numCtx?: number;
  /** Optional payload metadata included in each per-chunk LLM prompt. */
  sourceUrl?: string;
  title?: string;
  channel?: string;
}

export interface RawChunkResult {
  /** Whatever the LLM returned, JSON.parsed. null if call/parse failed. */
  parsed: unknown | null;
  chunkIndex: number;
  chunkChars: number;
  durationMs: number;
  errorReason?: string;
}

/**
 * Split a transcript into overlapping character-windowed chunks.
 *
 * Pure function. Deterministic. No side effects.
 *
 * Behavior:
 *   - transcript.length <= chunkChars → returns [transcript] (single chunk)
 *   - otherwise → tile windows of size `chunkChars` advancing by
 *     (chunkChars - overlapChars). Last chunk is anchored to end-of-text
 *     so the tail is always covered (never truncated mid-sentence by tiling).
 *
 * Guarantees:
 *   - First chunk starts at index 0
 *   - Last chunk ends at transcript.length
 *   - All chunks are non-empty
 *   - Adjacent chunks share exactly `overlapChars` characters of context
 *     (except potentially the final pair, which may share more if the
 *     last-chunk-anchor reaches back further)
 */
export function chunkTranscript(
  transcript: string,
  opts: ChunkerOptions = {},
): string[] {
  const chunkChars = opts.chunkChars ?? DEFAULT_CHUNK_CHARS;
  const overlapChars = opts.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  if (!transcript || transcript.length === 0) return [];
  if (chunkChars <= 0) throw new Error("chunkChars must be > 0");
  if (overlapChars < 0 || overlapChars >= chunkChars) {
    throw new Error("overlapChars must be in [0, chunkChars)");
  }
  if (transcript.length <= chunkChars) return [transcript];

  const stride = chunkChars - overlapChars;
  const chunks: string[] = [];
  let start = 0;
  while (start < transcript.length) {
    const end = Math.min(start + chunkChars, transcript.length);
    chunks.push(transcript.slice(start, end));
    if (end >= transcript.length) break;
    start += stride;
  }

  // Ensure the very tail is anchored. If tiling stopped short (shouldn't with
  // the loop above but be defensive), append an end-anchored chunk.
  const lastEnd = chunks.length > 0 ? transcript.length : 0;
  if (lastEnd < transcript.length) {
    chunks.push(transcript.slice(Math.max(0, transcript.length - chunkChars)));
  }

  return chunks;
}

/**
 * Shape produced by the transcript_extractor LLM (minimal flat schema).
 * Defined loosely here because per-chunk responses may be partial / malformed
 * and the merger handles missing fields gracefully.
 */
interface StrategyShape {
  name?: string;
  concept_name?: string;
  higher_timeframe?: string | null;
  lower_timeframe?: string | null;
  direction?: string | null;
  entry_sequence?: Array<{ step?: number; action?: string; rationale?: string | null }>;
  preferred_regime?: string | null;
  stop?: { anchor?: string; buffer_atr?: number | null; atr_multiplier?: number | null; rationale?: string | null } | null;
  stop_management?: string | null;
  targets?: Array<{ priority?: number; type?: string; r_multiple?: number | null; rationale?: string | null }>;
  confluences?: Array<{ name?: string; description?: string | null; canonical_match?: string | null }>;
  source_claim_win_rate?: number | null;
  source_claim_avg_r?: number | null;
  // Allow arbitrary extra fields without losing them
  [k: string]: unknown;
}

interface ExtractionResultShape {
  strategies: StrategyShape[];
  rejected_strategies: unknown[];
  instrument_classification: string | null;
  empty_reason?: string | null;
  empty_reason_detail?: string | null;
}

function keyOf(s: StrategyShape): string {
  const raw = (s.concept_name ?? s.name ?? "").toString().trim().toLowerCase();
  if (raw.length > 0) return raw;
  // Stable fallback for nameless strategies — hash the entry_sequence text.
  const seqText = JSON.stringify(s.entry_sequence ?? []);
  return `__anon_${seqText.length}_${seqText.slice(0, 40)}`;
}

function preferNonNull<T>(a: T | null | undefined, b: T | null | undefined): T | null {
  if (a !== null && a !== undefined && a !== "") return a;
  if (b !== null && b !== undefined && b !== "") return b;
  return null;
}

function mergeDirection(a?: string | null, b?: string | null): string | null {
  // Prefer "both" over single-side. Otherwise first non-null wins.
  if (a === "both" || b === "both") return "both";
  return preferNonNull(a, b);
}

function mergeStrategies(a: StrategyShape, b: StrategyShape): StrategyShape {
  const aSeq = Array.isArray(a.entry_sequence) ? a.entry_sequence : [];
  const bSeq = Array.isArray(b.entry_sequence) ? b.entry_sequence : [];
  const entry_sequence = bSeq.length > aSeq.length ? bSeq : aSeq;

  const aConf = Array.isArray(a.confluences) ? a.confluences : [];
  const bConf = Array.isArray(b.confluences) ? b.confluences : [];
  const confluencesByName = new Map<string, StrategyShape["confluences"] extends Array<infer U> | undefined ? U : never>();
  for (const c of [...aConf, ...bConf]) {
    const name = (c?.name ?? "").toString().trim().toLowerCase();
    if (!name) continue;
    if (!confluencesByName.has(name)) confluencesByName.set(name, c);
  }
  const confluences = [...confluencesByName.values()];

  const aTargets = Array.isArray(a.targets) ? a.targets : [];
  const bTargets = Array.isArray(b.targets) ? b.targets : [];
  const targets = bTargets.length > aTargets.length ? bTargets : aTargets;

  return {
    ...a,
    ...b,
    name: preferNonNull(a.name, b.name) ?? undefined,
    concept_name: preferNonNull(a.concept_name, b.concept_name) ?? undefined,
    higher_timeframe: preferNonNull(a.higher_timeframe, b.higher_timeframe),
    lower_timeframe: preferNonNull(a.lower_timeframe, b.lower_timeframe),
    direction: mergeDirection(a.direction, b.direction),
    entry_sequence,
    preferred_regime: preferNonNull(a.preferred_regime, b.preferred_regime),
    stop: a.stop ?? b.stop ?? null,
    stop_management: preferNonNull(a.stop_management, b.stop_management),
    targets,
    confluences,
    source_claim_win_rate: preferNonNull(a.source_claim_win_rate, b.source_claim_win_rate),
    source_claim_avg_r: preferNonNull(a.source_claim_avg_r, b.source_claim_avg_r),
  };
}

/**
 * Merge per-chunk extraction results into a single canonical result.
 *
 * Pure function. Order of inputs matters only for tie-breaks (first chunk
 * wins on equally-valued fields like instrument_classification).
 *
 * Same-key strategies (by concept_name/name lowercased) are merged
 * field-by-field per the per-field rules described in mergeStrategies().
 *
 * rejected_strategies is unioned (no dedup — preserves chunk-level audit).
 *
 * Empty inputs and null parsed results are tolerated and skipped.
 */
export function mergeChunkResults(perChunk: Array<unknown | null>): ExtractionResultShape {
  const byKey = new Map<string, StrategyShape>();
  const rejected: unknown[] = [];
  let instrumentClassification: string | null = null;
  let lastEmptyReason: string | null = null;
  let lastEmptyReasonDetail: string | null = null;
  let nonEmptyChunkSeen = false;

  for (const parsed of perChunk) {
    if (parsed === null || parsed === undefined || typeof parsed !== "object") continue;
    const obj = parsed as Partial<ExtractionResultShape>;

    const strategies = Array.isArray(obj.strategies) ? (obj.strategies as StrategyShape[]) : [];
    if (strategies.length > 0) nonEmptyChunkSeen = true;
    for (const s of strategies) {
      if (!s || typeof s !== "object") continue;
      const k = keyOf(s);
      const existing = byKey.get(k);
      byKey.set(k, existing ? mergeStrategies(existing, s) : { ...s });
    }

    if (Array.isArray(obj.rejected_strategies)) {
      rejected.push(...obj.rejected_strategies);
    }

    if (instrumentClassification === null && typeof obj.instrument_classification === "string") {
      instrumentClassification = obj.instrument_classification;
    }

    if (strategies.length === 0) {
      if (typeof obj.empty_reason === "string" && lastEmptyReason === null) {
        lastEmptyReason = obj.empty_reason;
      }
      if (typeof obj.empty_reason_detail === "string" && lastEmptyReasonDetail === null) {
        lastEmptyReasonDetail = obj.empty_reason_detail;
      }
    }
  }

  const merged: ExtractionResultShape = {
    strategies: [...byKey.values()],
    rejected_strategies: rejected,
    instrument_classification: instrumentClassification,
  };
  // Only surface empty_reason if NO chunk yielded strategies (matches the
  // route-side single-pass contract). If any chunk yielded a strategy, the
  // whole extraction is considered non-empty.
  if (!nonEmptyChunkSeen) {
    if (lastEmptyReason !== null) merged.empty_reason = lastEmptyReason;
    if (lastEmptyReasonDetail !== null) merged.empty_reason_detail = lastEmptyReasonDetail;
  }
  return merged;
}

/**
 * Orchestrator: split → for-each-chunk(call LLM) → merge.
 *
 * Sequential by design (single GPU, no parallel Ollama). Uses
 * setChunkedNumCtxOverride() to swap num_ctx around each per-chunk call so
 * the global 32K default for non-chunked callers is never disturbed.
 *
 * Returns a tuple of (merged result, per-chunk raw diagnostics) so callers
 * can log per-chunk durations / failure reasons without re-running.
 *
 * Per-chunk LLM failures are tolerated — the chunk's result is null and
 * the merger skips it. As long as ≥1 chunk yields a parseable response,
 * the merged result is meaningful. If ALL chunks fail, merged.strategies
 * will be [] and the caller should treat it as an extraction failure
 * (same contract as single-pass returning null).
 */
export async function extractTranscriptChunked(
  transcript: string,
  opts: ChunkedExtractOptions = {},
): Promise<{ merged: ExtractionResultShape; rawChunks: RawChunkResult[] }> {
  const chunkChars = opts.chunkChars ?? DEFAULT_CHUNK_CHARS;
  const overlapChars = opts.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const numCtx = opts.numCtx ?? DEFAULT_CHUNK_NUM_CTX;
  const sourceUrl = opts.sourceUrl ?? "";
  const title = opts.title ?? sourceUrl;
  const channel = opts.channel ?? "youtube";

  const chunks = chunkTranscript(transcript, { chunkChars, overlapChars });
  const rawChunks: RawChunkResult[] = [];
  const perChunkParsed: Array<unknown | null> = [];

  setChunkedNumCtxOverride(numCtx);
  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const startedAt = Date.now();
      const payload = JSON.stringify({
        youtube_url: sourceUrl,
        title,
        channel,
        transcript_text: chunk,
      });
      let parsed: unknown | null = null;
      let errorReason: string | undefined;
      try {
        const raw = await callScoutExtractLlm([{ role: "user", content: payload }]);
        if (!raw) {
          errorReason = "llm_unavailable";
        } else {
          try {
            parsed = JSON.parse(raw);
          } catch {
            errorReason = "non_json";
          }
        }
      } catch (e) {
        errorReason = (e as Error)?.message ?? "llm_threw";
      }
      const durationMs = Date.now() - startedAt;
      rawChunks.push({ parsed, chunkIndex: i, chunkChars: chunk.length, durationMs, errorReason });
      perChunkParsed.push(parsed);
    }
  } finally {
    setChunkedNumCtxOverride(null);
  }

  const merged = mergeChunkResults(perChunkParsed);
  return { merged, rawChunks };
}

/**
 * Convenience: decide whether to chunk based on transcript length.
 * Use this from callers that want a single-call interface with auto-chunking.
 */
export function shouldChunk(transcriptLength: number, threshold = CHUNKING_THRESHOLD_CHARS): boolean {
  return transcriptLength > threshold;
}
