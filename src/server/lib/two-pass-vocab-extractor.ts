/**
 * Wave 26 Pass I v13 (2026-05-26) — Two-pass vocabulary-first extraction.
 *
 * RESEARCH BASIS (institutional-edge-researcher, 2026-05-26):
 * - arXiv 2604.05158 (April 2026): 2-pass NER outperforms 1-pass generative by
 *   +7.9 F1 on novel-vocab domains. Mechanism: Pass 2 works from extracted
 *   structured tokens, not raw text, so the model has far less to hold in WM.
 * - MasterPrompting 2026-05-12 benchmark: SLMs (2B-7B) "lose coherence on
 *   multi-step chains longer than 3 steps and partially ignore system prompts
 *   over 2000 tokens." Our v11 prompt is >6000 tokens.
 * - Passive.cloud institutional blueprint (2026-05-14, 20K+ earnings calls):
 *   "open extraction first, canonicalization second" is the institutional
 *   pattern. Server-side NLP belongs in canonicalization, not as primary gate.
 *
 * ARCHITECTURE:
 * - Pass 1: TINY Gemma call. Input = transcript chunk. Output = ONLY
 *   {speaker_concepts: [...], instrument: string, has_strategy: bool}.
 *   Tiny schema = high compliance even on gemma4:e2b's 2B-effective brain.
 * - Pass 2: existing full v11 schema call, but augmented with Pass 1's
 *   speaker_concepts as scaffolding context.
 *
 * This module owns Pass 1 only — the existing model-router.ts call is Pass 2.
 */

import { OllamaClient } from "../services/ollama-client.js";
import { logger } from "./logger.js";

type SpeakerConcept = {
  term: string;
  role: "indicator" | "zone" | "filter" | "entry_step" | "stop_anchor" | "target" | "model" | "phase";
  verbatim_description: string;
  transcript_quote?: string;
};

type Pass1Result = {
  speaker_concepts: SpeakerConcept[];
  instrument: string | null;
  has_strategy: boolean;
  empty_reason?: string;
};

const PASS1_PROMPT = `You read trading-strategy YouTube transcripts and extract ONLY the speaker's proprietary vocabulary. You do NOT extract entry rules, exit rules, or any schema. Just the speaker's named concepts.

YOUR TASK:
1. Read the transcript.
2. Find every proprietary term the speaker introduces or repeatedly references. Use the speaker's exact words.
3. For each term, classify its role and copy the speaker's own description.
4. Decide if the transcript actually contains a trading strategy (vs interview, news, market recap).

LOOK FOR (use speaker's verbatim words):
- Named tools/indicators (e.g. "Volume Profile", "Gann Box", "Hidden Level", "VWAP")
- Named zones/levels (e.g. "Value Area High", "Point of Control", "Premium Zone", "Hidden Level", "Optimum Zone")
- Named models/frameworks (e.g. "Vacuum Method", "IRS Model", "Power of 3", "CRT", "ICT", "Wyckoff Spring")
- Named entry steps (e.g. "Change of State", "Liquidity Raid", "Sweep", "Rebalance", "Displacement")
- Named filters/avoid conditions (e.g. "skinny candle", "equal liquidity", "neutral market", "news day")
- Named stop placements (e.g. "below the swing", "below FVG", "structural low")
- Named targets (e.g. "Value Area Low", "equal highs", "previous day high", "naked POC")
- Named phases (e.g. "accumulation", "manipulation", "distribution", "impulse", "range")

DO NOT make up terms. DO NOT use generic ICT vocabulary unless the speaker explicitly used it. If the speaker calls something "the X model" or "I call this Y" or "what I call Z" — that's a term. Capture it.

OUTPUT FORMAT — return ONLY this JSON shape, nothing else:

{
  "has_strategy": true | false,
  "instrument": "futures" | "forex" | "crypto" | "stocks" | "options" | "mixed" | "unknown",
  "speaker_concepts": [
    {
      "term": "<speaker's exact words, capitalized as they used>",
      "role": "indicator" | "zone" | "filter" | "entry_step" | "stop_anchor" | "target" | "model" | "phase",
      "verbatim_description": "<1-2 sentences in the speaker's framing, taken from transcript>"
    }
  ],
  "empty_reason": "<only if has_strategy=false, one of: no_strategy_content | wrong_instrument | interview | market_commentary | other>"
}

Minimum 4 speaker_concepts for any strategy video. Maximum 25.

TRANSCRIPT:
`;

const PASS1_SCHEMA = {
  type: "object",
  required: ["has_strategy", "instrument", "speaker_concepts"],
  properties: {
    has_strategy: { type: "boolean" },
    instrument: { type: "string" },
    speaker_concepts: {
      type: "array",
      maxItems: 25,
      items: {
        type: "object",
        required: ["term", "role", "verbatim_description"],
        properties: {
          term: { type: "string", maxLength: 100 },
          role: { type: "string", enum: ["indicator", "zone", "filter", "entry_step", "stop_anchor", "target", "model", "phase"] },
          verbatim_description: { type: "string", maxLength: 500 },
        },
      },
    },
    empty_reason: { type: "string" },
  },
};

const CHUNK_CHAR_LIMIT = 12000; // ~3000 tokens per chunk — fits Pass 1 window comfortably

function chunkTranscript(transcript: string): string[] {
  if (transcript.length <= CHUNK_CHAR_LIMIT) return [transcript];
  const chunks: string[] = [];
  let pos = 0;
  while (pos < transcript.length) {
    const end = Math.min(pos + CHUNK_CHAR_LIMIT, transcript.length);
    // Try to break at a sentence boundary near `end`
    let breakAt = end;
    if (end < transcript.length) {
      const slice = transcript.slice(pos, end + 200);
      const sentenceEnd = slice.lastIndexOf(". ");
      if (sentenceEnd > CHUNK_CHAR_LIMIT * 0.5) breakAt = pos + sentenceEnd + 2;
    }
    chunks.push(transcript.slice(pos, breakAt).trim());
    pos = breakAt;
  }
  return chunks;
}

async function callPass1Chunk(transcript: string, model: string): Promise<Pass1Result | null> {
  const ollama = new OllamaClient(undefined, 180_000);
  const messages = [{ role: "user" as const, content: PASS1_PROMPT + transcript }];
  const samplingOptions = {
    num_ctx: 16384,
    temperature: 0.1,
    top_p: 0.95,
    top_k: 64,
    num_predict: 2048,
    seed: 42,
  };
  // Use string "json" format (basic coercion only) — NOT GBNF schema object.
  // Per institutional research: GBNF crashes on long context + open-vocab arrays.
  // Validate-and-retry handles the residual ~5-11% non-compliance.
  // format=true → Ollama JSON enforcement (body.format="json"); not GBNF schema
  try {
    const res = await ollama.chat(model, messages, samplingOptions, true, "30m");
    const raw = res?.message?.content ?? "";
    if (!raw || raw.trim().length === 0) return null;
    // Extract JSON from raw response — handle fences and balanced substrings
    const json = extractJsonFromResponse(raw);
    if (!json) return null;
    if (!Array.isArray(json.speaker_concepts)) return null;
    // Filter invalid entries
    const valid = (json.speaker_concepts as unknown[]).filter((c): c is SpeakerConcept => {
      if (typeof c !== "object" || c === null) return false;
      const cc = c as Record<string, unknown>;
      return typeof cc.term === "string" && typeof cc.role === "string" && typeof cc.verbatim_description === "string";
    });
    return {
      has_strategy: Boolean(json.has_strategy),
      instrument: typeof json.instrument === "string" ? json.instrument : null,
      speaker_concepts: valid.slice(0, 25),
      empty_reason: typeof json.empty_reason === "string" ? json.empty_reason : undefined,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Pass 1 vocab extractor: Ollama call failed (chunk skipped)");
    return null;
  }
}

function extractJsonFromResponse(raw: string): Record<string, unknown> | null {
  // Strategy 1: direct parse
  try { return JSON.parse(raw); } catch {}
  // Strategy 2: strip markdown code fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  // Strategy 3: extract largest balanced {...} substring
  let depth = 0, start = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (raw[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        const candidate = raw.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch { /* try next */ }
        start = -1;
      }
    }
  }
  return null;
}

/**
 * Run Pass 1 vocabulary extraction on a transcript. Chunks long transcripts,
 * runs Pass 1 per chunk, merges + deduplicates speaker_concepts.
 *
 * Returns null on total failure (caller should fall back to server-side NLP).
 */
export async function runPass1VocabularyExtraction(
  transcript: string,
  model: string = "gemma4:e2b",
): Promise<Pass1Result | null> {
  if (!transcript || transcript.length < 300) return null;
  const startedAt = Date.now();
  const chunks = chunkTranscript(transcript);
  logger.info({ chunk_count: chunks.length, transcript_chars: transcript.length, model }, "Pass 1 vocab extractor: starting");

  const allConcepts: SpeakerConcept[] = [];
  let hasStrategy = false;
  let instrument: string | null = null;
  const seenTerms = new Set<string>();

  for (const chunk of chunks) {
    const r = await callPass1Chunk(chunk, model);
    if (!r) continue;
    if (r.has_strategy) hasStrategy = true;
    if (r.instrument && !instrument) instrument = r.instrument;
    for (const c of r.speaker_concepts) {
      const key = c.term.toLowerCase().trim();
      if (seenTerms.has(key)) continue;
      seenTerms.add(key);
      allConcepts.push(c);
      if (allConcepts.length >= 25) break;
    }
    if (allConcepts.length >= 25) break;
  }

  const durationMs = Date.now() - startedAt;
  logger.info({
    chunks_processed: chunks.length,
    concepts_extracted: allConcepts.length,
    has_strategy: hasStrategy,
    instrument,
    duration_ms: durationMs,
  }, "Pass 1 vocab extractor: complete");

  return {
    has_strategy: hasStrategy,
    instrument,
    speaker_concepts: allConcepts,
  };
}
