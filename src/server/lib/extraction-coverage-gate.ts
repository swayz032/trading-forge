/**
 * W3.1 — Extraction Coverage Gate
 *
 * Two-layer check that the primary extraction captured what the speaker actually taught.
 *
 * Layer 1 (LLM enumeration): Ask the model — via model-router local-first — to enumerate
 * EVERY named tool, indicator, zone, or level the speaker explicitly taught, each backed
 * by a verbatim transcript quote.
 *
 * Layer 2 (pure-functional comparator): A DETERMINISTIC, NO-I/O function that cross-checks
 * each speaker-named item against the extraction's entry_sequence + confluences. Returns a
 * structured verdict: { covered[], missing[], coverage_pct, verdict }.
 *
 * Verdict is advisory only in W3.1 — no hard-drop, no quarantine. W3.2 wires
 * coverage_failed → quarantine.
 *
 * Why two layers:
 *   - The LLM enumeration is dynamic: it finds whatever the speaker named without requiring
 *     a hardcoded catalog. "Gann box" and "Silver Bullet" are equally discoverable.
 *   - The pure comparator is deterministic and unit-testable with no mocking of side effects.
 *     It can be replayed exactly given the same inputs.
 *
 * Architecture constraint: this module MUST NOT import from "../index.js". Use the
 * logger leaf module. See feedback_helper_logger_import.md.
 */

import { callScoutExtractLlm } from "../services/model-router.js";
import { logger } from "./logger.js";
import { verifyQuoteInTranscript } from "./transcript-extractor-recall.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A single named item the speaker taught, with grounded verbatim quote.
 * Produced by the LLM enumeration call.
 */
export interface SpeakerItem {
  /** The speaker's exact name for the tool/indicator/zone/level (e.g. "Gann box", "optimum zone"). */
  name: string;
  /** Verbatim quote from the transcript that establishes the speaker taught this item. */
  verbatim_quote: string;
  /**
   * How prominently the speaker taught it.
   * "primary"   — the speaker's main tool; the setup cannot be replicated without it.
   * "secondary" — a supporting condition or filter; strategy works without it but is incomplete.
   * "mention"   — speaker names it but doesn't teach its construction or use in the setup.
   */
  emphasis_level: "primary" | "secondary" | "mention";
}

/**
 * The extraction shape the comparator reads.
 * Uses the minimal 8-field schema fields that contain named tool content.
 */
export interface ExtractionSnapshot {
  entry_sequence?: Array<{ step?: number; action?: string; rationale?: string | null }> | null;
  confluences?: Array<{ name: string; description: string }> | null;
  /** Annotation injected by recall pass when primary_tool_setup is recovered. */
  _recall_primary_tool_note?: { value: string; quote: string | null } | null;
  [k: string]: unknown;
}

/**
 * The output of the pure-functional comparator.
 * "pass"             — every primary + secondary speaker item is covered.
 * "coverage_failed"  — at least one primary speaker item is missing from the extraction.
 */
export interface CoverageVerdict {
  covered: string[];
  missing: string[];
  coverage_pct: number;
  verdict: "pass" | "coverage_failed";
}

// ─── Prompt for LLM enumeration ───────────────────────────────────────────────

const COVERAGE_ENUM_PROMPT = `You are a transcript auditor. A trading educator recorded a video and their transcript is below. Your ONLY job is to enumerate every NAMED tool, indicator, drawing, zone, or level that the speaker explicitly teaches in the transcript — regardless of what market they trade. We care about the MECHANIC, not the instrument.

## TRANSCRIPT
\`\`\`
{TRANSCRIPT}
\`\`\`

## YOUR TASK

Enumerate every item the speaker NAMES and TEACHES. For each:
- name: the speaker's exact term (e.g. "Gann box", "fair value gap", "optimum zone", "VWAP", "order block")
- verbatim_quote: copy ONE exact phrase from the transcript that proves the speaker named/taught it (10–120 chars)
- emphasis_level: "primary" if it's the core tool without which the setup cannot be replicated; "secondary" if it's a supporting filter/condition; "mention" if it's just named but not constructed

RULES:
1. Only include items the speaker NAMES. Do not generalize ("support level" is too vague unless the speaker says those exact words).
2. verbatim_quote MUST be a real substring of the transcript above (case-insensitive). Do not paraphrase.
3. DO NOT invent items not present in the transcript.
4. Empty array is honest — use it when the speaker teaches no named tools.
5. Maximum 10 items.

Return ONLY valid JSON in this shape:
{ "speaker_items": [ { "name": "...", "verbatim_quote": "...", "emphasis_level": "primary"|"secondary"|"mention" } ] }`;

// ─── LLM Enumeration (Layer 1) ────────────────────────────────────────────────

/**
 * Ask the model to enumerate all speaker-named tools/indicators from the transcript.
 * Routes via callScoutExtractLlm (local-first gemma4:e2b → cloud fallback).
 *
 * Filters out any items whose verbatim_quote cannot be verified in the transcript
 * (prevents hallucination / prompt-example leakage).
 *
 * @throws never — returns [] on any failure so the caller always gets a safe result.
 */
export async function runCoverageEnumeration(transcript: string): Promise<SpeakerItem[]> {
  const prompt = COVERAGE_ENUM_PROMPT.replace("{TRANSCRIPT}", transcript.slice(0, 14_000));

  let raw: string | null = null;
  try {
    raw = await callScoutExtractLlm([{ role: "user", content: prompt }]);
  } catch (e) {
    logger.warn(
      { err: (e as Error).message },
      "coverage-gate: enumeration LLM call threw — returning empty speaker_items",
    );
    return [];
  }

  if (!raw) {
    logger.warn("coverage-gate: enumeration LLM returned null — returning empty speaker_items");
    return [];
  }

  let parsed: { speaker_items?: unknown[] } | null = null;
  try {
    parsed = JSON.parse(raw) as { speaker_items?: unknown[] };
  } catch {
    // Try stripping markdown fences
    const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    try {
      parsed = JSON.parse(stripped) as { speaker_items?: unknown[] };
    } catch {
      logger.warn({ raw: raw.slice(0, 200) }, "coverage-gate: enumeration LLM returned non-JSON");
      return [];
    }
  }

  if (!Array.isArray(parsed?.speaker_items)) return [];

  const VALID_EMPHASIS = new Set<string>(["primary", "secondary", "mention"]);
  const results: SpeakerItem[] = [];

  for (const raw_item of parsed.speaker_items) {
    if (!raw_item || typeof raw_item !== "object") continue;
    const item = raw_item as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : null;
    const verbatim_quote = typeof item.verbatim_quote === "string" ? item.verbatim_quote.trim() : null;
    const emphasis_level = typeof item.emphasis_level === "string" && VALID_EMPHASIS.has(item.emphasis_level)
      ? (item.emphasis_level as SpeakerItem["emphasis_level"])
      : null;

    if (!name || !verbatim_quote || !emphasis_level) continue;
    if (name.length < 2 || name.length > 120) continue;

    // Quote grounding check — discard hallucinated quotes
    if (!verifyQuoteInTranscript(verbatim_quote, transcript)) {
      logger.warn(
        { name, verbatim_quote: verbatim_quote.slice(0, 80) },
        "coverage-gate: speaker_item quote not found in transcript — discarded",
      );
      continue;
    }

    results.push({ name, verbatim_quote, emphasis_level });
    if (results.length >= 10) break;
  }

  return results;
}

// ─── Pure-Functional Comparator (Layer 2) ────────────────────────────────────

/**
 * Deterministic, pure-functional comparator.
 * NO I/O. NO Date.now(). NO LLM calls.
 * Safe to unit-test without mocks.
 *
 * For each speaker-named item, checks whether the item name (or a close synonym)
 * appears anywhere in the extraction's entry_sequence actions, rationales,
 * confluence descriptions, or the recall's _recall_primary_tool_note annotation.
 *
 * Matching strategy (in order of strength):
 *   1. Exact substring match (case-insensitive, normalized whitespace)
 *   2. Each significant word in the item name (len >= 4) found in the extraction text
 *      → item is "covered" if ALL significant words match
 *
 * Only primary + secondary items count toward coverage_pct and coverage_failed verdict.
 * "mention" items are reported for observability but do not cause coverage_failed.
 */
export function computeCoverageVerdict(
  speakerItems: SpeakerItem[],
  extraction: ExtractionSnapshot,
): CoverageVerdict {
  // Build a single lowercase search corpus from the extraction
  const corpusParts: string[] = [];

  const entrySeq = Array.isArray(extraction.entry_sequence) ? extraction.entry_sequence : [];
  for (const step of entrySeq) {
    if (typeof step.action === "string") corpusParts.push(step.action);
    if (typeof step.rationale === "string" && step.rationale) corpusParts.push(step.rationale);
  }

  const confluences = Array.isArray(extraction.confluences) ? extraction.confluences : [];
  for (const c of confluences) {
    if (typeof c.name === "string") corpusParts.push(c.name);
    if (typeof c.description === "string") corpusParts.push(c.description);
  }

  // Include recall annotation if present
  if (extraction._recall_primary_tool_note?.value) {
    corpusParts.push(extraction._recall_primary_tool_note.value);
  }

  const corpus = corpusParts.join(" ").toLowerCase().replace(/\s+/g, " ");

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();

  function isItemCovered(itemName: string): boolean {
    const normName = normalize(itemName);
    // Exact substring
    if (corpus.includes(normName)) return true;

    // All-significant-words match (each word >= 4 chars must appear)
    const words = normName.split(" ").filter((w) => w.length >= 4);
    if (words.length > 0 && words.every((w) => corpus.includes(w))) return true;

    return false;
  }

  const covered: string[] = [];
  const missing: string[] = [];

  // Only primary + secondary count toward verdict
  const countable = speakerItems.filter((i) => i.emphasis_level !== "mention");

  for (const item of speakerItems) {
    if (isItemCovered(item.name)) {
      covered.push(item.name);
    } else {
      missing.push(item.name);
    }
  }

  const countableMissing = missing.filter(
    (name) => countable.some((i) => i.name === name),
  );

  const coverage_pct =
    countable.length === 0
      ? 1.0
      : (countable.length - countableMissing.length) / countable.length;

  // coverage_failed when ANY primary item is missing from the extraction
  const primaryMissing = missing.filter(
    (name) => speakerItems.find((i) => i.name === name)?.emphasis_level === "primary",
  );
  const verdict: CoverageVerdict["verdict"] =
    primaryMissing.length > 0 ? "coverage_failed" : "pass";

  return { covered, missing, coverage_pct, verdict };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Full coverage gate: enumerate → compare → verdict.
 *
 * @returns { speakerItems, verdict } — always resolves, never throws.
 *   speakerItems: what the LLM found the speaker taught
 *   verdict: coverage comparison result
 */
export async function runCoverageGate(
  transcript: string,
  extraction: ExtractionSnapshot,
): Promise<{ speakerItems: SpeakerItem[]; verdict: CoverageVerdict }> {
  const speakerItems = await runCoverageEnumeration(transcript);
  const verdict = computeCoverageVerdict(speakerItems, extraction);
  return { speakerItems, verdict };
}
