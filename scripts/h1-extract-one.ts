/**
 * h1-extract-one.ts — H1 Wave-4 pilot-conveyor rework (Addendum 2, 2026-07-12).
 *
 * THIN, SIDE-EFFECT-FREE CLI wrapper around the production gemma
 * transcript_extractor call. Purpose: give the Python pilot-conveyor runner
 * (src/engine/extraction/extractor_bridge.py) a subprocess seam into the
 * REAL extractor without importing the full `/scout-extract` Express route
 * (which is 2000+ lines of DB writes, graduation wiring, chunked-fallback
 * orchestration, and quarantine logic — none of which belongs in a pilot
 * fidelity measurement).
 *
 * WHAT THIS CALLS (exactly the production single-pass path, mirrored from
 * `agentRoutes.post("/scout-extract", ...)`'s `extractFromChunk` helper in
 * src/server/routes/agent.ts:852-865, plus the speaker_concepts two-tier
 * attach at agent.ts:1719-1755):
 *   1. `callScoutExtractLlm([{role:"user", content: userPayload}])` —
 *      src/server/services/model-router.ts. Same routing the production
 *      route uses: Ollama gemma4:e4b-it-qat primary (local-first), cloud
 *      gpt-5-mini fallback only if Ollama fails. Schema/prompt selection is
 *      whatever TRANSCRIPT_EXTRACTOR_USE_LEGACY resolves to at call time
 *      (default: minimal 8-field schema, Wave 26 Pass L) — NOT hardcoded
 *      here, so this wrapper always tracks the live production default.
 *   2. `runPass1VocabularyExtraction` (Pass-1 LLM, tiny schema) +
 *      `extractSpeakerConceptsFromTranscript` (deterministic server-side
 *      NLP, ALWAYS populates `transcript_quote`) — merged and attached to
 *      every strategy's `speaker_concepts[]`, exactly as the production
 *      route does. This is the ONLY per-condition-shaped field the CURRENT
 *      production extraction pipeline emits with a `transcript_quote`
 *      anchor (see the Wave-4 rework's blocker note: `entry_sequence` /
 *      `confluences` / `stop` / `targets` — the actual trade-rule fields —
 *      carry NO anchor field in the default minimal-schema path).
 *
 * DOCUMENTED SIDE EFFECT (the ONE this wrapper cannot avoid without
 * reimplementing retry/fallback from scratch): `callScoutExtractLlm`
 * internally fires a non-blocking `writeTranscriptExtractorAudit()` call
 * (model-router.ts ~2229) that INSERTs one row into `audit_log` — pure
 * telemetry (model/provider/duration), wrapped in try/catch, never throws.
 * This is NOT a strategy write and NOT a graduation-state write; no row in
 * any strategy/candidate/graduation table is ever touched by this script.
 * If a DB connection is unavailable the insert silently no-ops (model-
 * router.ts logs at debug level) — this script still succeeds.
 *
 * INPUT (stdin, JSON): {"video_id": string, "transcript_text": string}
 * OUTPUT (stdout, JSON): the parsed extractor response object, e.g.
 *   {"video_id": ..., "instrument_classification": ..., "strategies": [...]}
 *   Each strategy in `strategies[]` carries `speaker_concepts[]` (merged,
 *   as described above). On total failure, prints {"error": "..."} to
 *   stdout and exits 1 — never prints a fabricated/partial extraction.
 *
 * Usage: npx tsx scripts/h1-extract-one.ts < payload.json
 */

// Env bootstrap (matches scripts/deep-scan.ts's own top-of-file dotenv load):
// this wrapper is invoked as a bare subprocess (extractor_bridge.py's
// `invoke_real_extractor`), not through a launcher that pre-loads .env, so
// without this the very first import below throws ("DATABASE_URL
// environment variable is required", src/server/db/index.ts) before this
// script gets a chance to run at all. Side-effect import, must run first.
import "dotenv/config";

import { callScoutExtractLlm } from "../src/server/services/model-router.js";
import { runPass1VocabularyExtraction } from "../src/server/lib/two-pass-vocab-extractor.js";
import { extractSpeakerConceptsFromTranscript } from "../src/server/lib/transcript-speaker-concepts.js";

interface ScopeVariant {
  variant_label: string;
  timeframe_note?: string | null;
  confirmation_mechanic_note?: string | null;
  target_note?: string | null;
}

interface ExtractionScope {
  entry_summary: string;
  exit_summary: string;
  variants?: ScopeVariant[];
}

interface InputPayload {
  video_id: string;
  transcript_text: string;
  title?: string;
  channel?: string;
  /**
   * H1 Wave-6 Pass-2 (2026-07-13) — optional Phase-A -> Phase-B handoff scope.
   * When present, this call is SCOPED to exactly one Phase-A-enumerated
   * strategy per docs/designs/h1-wave6-pass2-two-phase-PACKET-2026-07-13.md
   * §2. Injected as prompt assembly only (no schema change) — the raw
   * `transcript_text` field is left untouched so the mechanical
   * quote-substring check downstream still validates against the true,
   * unmodified transcript.
   */
  scope?: ExtractionScope;
}

/**
 * Builds the §2 scoping instruction + per-variant checklist string. Returns
 * "" when no scope is present (unscoped call — existing single-phase
 * behavior, byte-identical to pre-pass-2 h1-extract-one.ts output).
 */
function buildScopeBlock(scope: ExtractionScope | undefined): string {
  if (!scope) return "";
  const lines: string[] = [];
  lines.push(
    `SCOPE (Phase A -> Phase B handoff): This call is scoped to ONE strategy: ${scope.entry_summary} / ${scope.exit_summary}. If the transcript teaches other strategies elsewhere, do NOT extract conditions for them -- another call handles each of those separately.`,
  );
  const variants = Array.isArray(scope.variants) ? scope.variants : [];
  if (variants.length > 0) {
    lines.push("VARIANT CHECKLIST -- attempt to quote-ground each item as its own entry_sequence step / confluence / target; use the no-quote sentinel (transcript_quote: null) rather than dropping or inventing a quote:");
    for (const v of variants) {
      lines.push(
        `- Variant '${v.variant_label}' -- timeframe: ${v.timeframe_note ?? "n/a"}, confirmation: ${v.confirmation_mechanic_note ?? "n/a"}, target: ${v.target_note ?? "n/a"}.`,
      );
    }
  }
  return lines.join("\n");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Mirrors agent.ts:1719-1755 EXACTLY — both tiers always run and merge
 * (Pass-1 LLM first, server-side NLP second as augmentation, deduped by
 * lowercased term, capped at 25). Never throws; a tier failure is logged
 * to stderr and treated as 0 concepts from that tier (non-blocking, same
 * as production).
 */
async function attachSpeakerConcepts(transcript: string): Promise<Array<Record<string, unknown>>> {
  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  try {
    const pass1 = await runPass1VocabularyExtraction(transcript);
    if (pass1 && pass1.speaker_concepts.length > 0) {
      for (const c of pass1.speaker_concepts) {
        const k = c.term.toLowerCase().trim();
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push({ ...c, source: "pass1_llm_extraction" });
      }
    }
  } catch (err) {
    console.error("[h1-extract-one] Pass 1 vocab extraction failed (non-blocking):", (err as Error).message ?? err);
  }

  try {
    const nlpConcepts = extractSpeakerConceptsFromTranscript(transcript);
    for (const c of nlpConcepts) {
      const k = c.term.toLowerCase().trim();
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push({ ...c, source: "server_side_nlp" });
      if (merged.length >= 25) break;
    }
  } catch (err) {
    console.error("[h1-extract-one] server-side NLP vocab extraction failed (non-blocking):", (err as Error).message ?? err);
  }

  return merged;
}

async function main(): Promise<void> {
  let input: InputPayload;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw) as InputPayload;
  } catch (err) {
    console.log(JSON.stringify({ error: `invalid stdin JSON: ${(err as Error).message}` }));
    process.exitCode = 1;
    return;
  }

  if (!input.transcript_text || typeof input.transcript_text !== "string" || input.transcript_text.length === 0) {
    console.log(JSON.stringify({ error: "transcript_text is required and must be a non-empty string" }));
    process.exitCode = 1;
    return;
  }
  const videoId = input.video_id ?? "unknown";

  // Same userPayload shape + same single-pass call as agent.ts's extractFromChunk
  // (src/server/routes/agent.ts:852-865) — this wrapper intentionally does NOT
  // reimplement the chunked-fallback path (OOM-safe long-transcript handling);
  // clause 2's "one extraction pass per video" is the pilot's own contract, and
  // chunking is an orthogonal production-robustness feature out of scope here.
  const scopeBlock = buildScopeBlock(input.scope);
  const basePayload = JSON.stringify({
    youtube_url: `h1-pilot://${videoId}`,
    title: input.title ?? videoId,
    channel: input.channel ?? "h1-pilot",
    transcript_text: input.transcript_text,
  });
  // H1 Wave-6 Pass-2 (2026-07-13) fix: a scope reminder embedded EARLY inside
  // the JSON payload (before the long transcript_text field) was observed to
  // be ignored by gemma4:e4b-it-qat in a live birth-fixture run -- a scoped
  // call re-extracted the SAME variant as its sibling unscoped call instead
  // of honoring its checklist. Root cause (diagnosed, not guessed): the
  // instruction sat far from the model's final generation point, buried
  // inside a JSON string value ahead of a much longer transcript. Fix: the
  // scope reminder is now a SEPARATE, plainly-delimited block appended AFTER
  // the whole transcript payload -- the LAST text the model reads before
  // generating (maximal recency), not nested inside JSON escaping.
  const userPayload = scopeBlock
    ? `${basePayload}\n\n=== SCOPE REMINDER (read this before extracting -- it overrides anything that looks like a different strategy in the transcript above) ===\n${scopeBlock}`
    : basePayload;

  let raw: string | null = null;
  try {
    raw = await callScoutExtractLlm([{ role: "user", content: userPayload }]);
  } catch (err) {
    console.log(JSON.stringify({ error: `callScoutExtractLlm threw: ${(err as Error).message ?? err}` }));
    process.exitCode = 1;
    return;
  }

  if (raw === null) {
    console.log(JSON.stringify({ error: "callScoutExtractLlm returned null (both Ollama and cloud fallback exhausted or unavailable)" }));
    process.exitCode = 1;
    return;
  }

  let parsed: { strategies?: unknown[]; instrument_classification?: unknown; rejected_strategies?: unknown[]; empty_reason?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch (err) {
    console.log(JSON.stringify({ error: `extractor response was not valid JSON: ${(err as Error).message}`, raw_head: raw.slice(0, 500) }));
    process.exitCode = 1;
    return;
  }

  const strategies = Array.isArray(parsed.strategies) ? (parsed.strategies as Array<Record<string, unknown>>) : [];

  // Speaker-vocabulary attach — ONE merged pass over the whole transcript,
  // attached identically to every strategy (matches agent.ts's per-strategy
  // loop semantics: the vocabulary is transcript-wide, not per-strategy).
  const speakerConcepts = strategies.length > 0 ? await attachSpeakerConcepts(input.transcript_text) : [];
  const strategiesWithConcepts = strategies.map((s) => ({ ...s, speaker_concepts: speakerConcepts }));

  const output = {
    video_id: videoId,
    instrument_classification: parsed.instrument_classification ?? null,
    strategies: strategiesWithConcepts,
    rejected_strategies: parsed.rejected_strategies ?? [],
    empty_reason: parsed.empty_reason ?? null,
  };

  console.log(JSON.stringify(output));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: `unhandled: ${(err as Error).message ?? String(err)}` }));
  process.exitCode = 1;
});
