/**
 * W3.1 — Extraction Coverage Gate  (E-FOUNDATION 2026-06-22 — depth-aware + windowed)
 *
 * Two-layer check that the primary extraction captured what the speaker actually taught.
 *
 * Layer 0 (WINDOWED LLM enumeration): Slide ~12K-char windows (2K overlap) across the
 * FULL transcript and ask the model — via model-router local-first — to enumerate EVERY
 * named tool/indicator/zone/level the speaker explicitly teaches in each window, each
 * backed by a verbatim transcript quote. UNION across windows by normalized name keeping
 * the highest emphasis. This is what makes back-of-transcript mechanics (e.g. a Gann box
 * taught 25K chars in) enumerable at all — the old single 14K-char slice was blind to the
 * back two-thirds of a 37K transcript.
 *
 * Layer 2 (DEPTH-AWARE pure-functional comparator): A DETERMINISTIC, NO-I/O function that
 * cross-checks each speaker-named item against the extraction. An item only counts as
 * COVERED when BOTH (a) its name is present AND (b) >= MIN_MECHANIC_TOKENS distinct content
 * tokens from the item's OWN verbatim_quote appear in the extraction. Name-present but
 * mechanic-absent → SHALLOW (a repair target, NOT covered). This makes coverage_pct
 * ungameable by name-dropping — the keystone that lets the 5-URL gate measure real
 * completeness. Returns { covered[], shallow[], missing[], coverage_pct, verdict }.
 *
 * Verdict feeds the repair loop (Layer 3) + W3.2 quarantine.
 *
 * Architecture constraint: this module MUST NOT import from "../index.js". Use the
 * logger leaf module. See feedback_helper_logger_import.md.
 */

import { callScoutExtractLlm } from "../services/model-router.js";
import { logger } from "./logger.js";
import { verifyQuoteInTranscript } from "./transcript-extractor-recall.js";
import { chunkTranscript } from "./transcript-chunker.js";

// ─── Tunables (env-overridable) ───────────────────────────────────────────────

/** Max speaker_items after UNION across windows. windows × ~8 → 24 covers a dense 37K transcript. */
const COVERAGE_ENUM_MAX_ITEMS = Number(process.env.COVERAGE_ENUM_MAX_ITEMS) || 24;
/** Per-window enumeration size. ~12K chars ≈ 3K tokens — fits gemma4:e2b 8GB headroom. */
const COVERAGE_ENUM_WINDOW_CHARS = Number(process.env.COVERAGE_ENUM_WINDOW_CHARS) || 12_000;
/** Cross-window overlap so a mechanic taught across a boundary isn't split. */
const COVERAGE_ENUM_OVERLAP_CHARS = Number(process.env.COVERAGE_ENUM_OVERLAP_CHARS) || 2_000;
/** Per-window item cap before UNION (UNION + global cap handles the total). */
const COVERAGE_ENUM_PER_WINDOW_CAP = Number(process.env.COVERAGE_ENUM_PER_WINDOW_CAP) || 12;
/**
 * How many distinct content tokens from an item's verbatim_quote must appear in the
 * extraction for it to count as mechanic-COVERED (vs name-only SHALLOW). Default 2.
 * Tunable down to 1 if depth proves too strict on terse-but-correct captures.
 */
const MIN_MECHANIC_TOKENS = Number(process.env.COVERAGE_MIN_MECHANIC_TOKENS) || 2;

/** Generic English fillers (len>=4) excluded from mechanic-token counting so they
 *  can't satisfy the depth check. Domain terms (box/zone/optimum/sweep/...) are NOT here. */
const STOPWORDS = new Set<string>([
  "that", "this", "with", "from", "into", "your", "yours", "have", "will", "they", "them",
  "their", "then", "than", "when", "what", "which", "where", "here", "there", "over", "under",
  "about", "just", "like", "been", "does", "your", "gonna", "wanna", "really", "actually",
  "simple", "simply", "because", "these", "those", "such", "each", "every", "also", "very",
  "more", "most", "some", "many", "want", "need", "make", "makes", "made", "going", "look",
  "looking", "would", "could", "should", "still", "even", "only", "always", "never", "after",
  "before", "while", "right", "okay", "guys", "video", "transcript", "speaker",
]);

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
 * "pass"             — every primary + secondary speaker item is mechanic-covered.
 * "coverage_failed"  — at least one PRIMARY speaker item is missing or shallow.
 *
 * covered  — name present AND mechanic-depth met.
 * shallow  — name present but mechanic-depth NOT met (repair target; counts as not-covered).
 * missing  — name absent entirely (repair target).
 */
export interface CoverageVerdict {
  covered: string[];
  shallow: string[];
  missing: string[];
  coverage_pct: number;
  verdict: "pass" | "coverage_failed";
}

// ─── Shared normalization ─────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

function emphasisRank(e: SpeakerItem["emphasis_level"]): number {
  return e === "primary" ? 3 : e === "secondary" ? 2 : 1;
}

/** Distinct content tokens (len>=4, not a stopword) from a string, normalized. */
function contentTokens(s: string): string[] {
  const seen = new Set<string>();
  for (const w of normalize(s).split(" ")) {
    if (w.length >= 4 && !STOPWORDS.has(w)) seen.add(w);
  }
  return [...seen];
}

// ─── Prompt for LLM enumeration ───────────────────────────────────────────────

const COVERAGE_ENUM_PROMPT = `You are a transcript auditor. A trading educator recorded a video and a SEGMENT of their transcript is below. Your ONLY job is to enumerate every NAMED tool, indicator, drawing, zone, or level that the speaker explicitly teaches in THIS segment — regardless of what market they trade. We care about the MECHANIC, not the instrument.

## TRANSCRIPT SEGMENT
\`\`\`
{TRANSCRIPT}
\`\`\`

## YOUR TASK

Enumerate every item the speaker NAMES and TEACHES in this segment. For each:
- name: the speaker's exact term (e.g. "Gann box", "fair value gap", "optimum zone", "VWAP", "order block")
- verbatim_quote: copy ONE exact phrase from the segment that proves the speaker named/taught it (10–120 chars)
- emphasis_level: "primary" if it's the core tool without which the setup cannot be replicated; "secondary" if it's a supporting filter/condition; "mention" if it's just named but not constructed

RULES:
1. Only include items the speaker NAMES. Do not generalize ("support level" is too vague unless the speaker says those exact words).
2. verbatim_quote MUST be a real substring of the segment above (case-insensitive). Do not paraphrase.
3. DO NOT invent items not present in the segment.
4. Empty array is honest — use it when the segment teaches no named tools.
5. Maximum 12 items.

Return ONLY valid JSON in this shape:
{ "speaker_items": [ { "name": "...", "verbatim_quote": "...", "emphasis_level": "primary"|"secondary"|"mention" } ] }`;

// ─── LLM Enumeration (Layer 0 — windowed) ─────────────────────────────────────

/**
 * Parse + validate one window's LLM enumeration response into SpeakerItems.
 * Quotes are verified against the FULL transcript (a window quote is still a real
 * substring of the whole) so hallucinated/example-leaked quotes are discarded.
 */
function parseSpeakerItems(raw: string | null, fullTranscript: string): SpeakerItem[] {
  if (!raw) return [];

  let parsed: { speaker_items?: unknown[] } | null = null;
  try {
    parsed = JSON.parse(raw) as { speaker_items?: unknown[] };
  } catch {
    const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    try {
      parsed = JSON.parse(stripped) as { speaker_items?: unknown[] };
    } catch {
      logger.warn({ raw: raw.slice(0, 200) }, "coverage-gate: enumeration window returned non-JSON");
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
    const emphasis_level =
      typeof item.emphasis_level === "string" && VALID_EMPHASIS.has(item.emphasis_level)
        ? (item.emphasis_level as SpeakerItem["emphasis_level"])
        : null;

    if (!name || !verbatim_quote || !emphasis_level) continue;
    if (name.length < 2 || name.length > 120) continue;

    if (!verifyQuoteInTranscript(verbatim_quote, fullTranscript)) {
      logger.warn(
        { name, verbatim_quote: verbatim_quote.slice(0, 80) },
        "coverage-gate: speaker_item quote not found in transcript — discarded",
      );
      continue;
    }

    results.push({ name, verbatim_quote, emphasis_level });
    if (results.length >= COVERAGE_ENUM_PER_WINDOW_CAP) break;
  }

  return results;
}

/**
 * Enumerate all speaker-named tools/indicators across the FULL transcript via sliding
 * windows, UNIONed by normalized name (highest emphasis wins), capped at
 * COVERAGE_ENUM_MAX_ITEMS. Routes via callScoutExtractLlm (local-first gemma4:e2b).
 *
 * Sequential per window (single GPU, no parallel Ollama). Per-window failures are
 * tolerated (that window contributes nothing). @throws never — returns [] on total failure.
 */
export async function runCoverageEnumeration(transcript: string): Promise<SpeakerItem[]> {
  if (!transcript || transcript.length === 0) return [];

  const windows = chunkTranscript(transcript, {
    chunkChars: COVERAGE_ENUM_WINDOW_CHARS,
    overlapChars: COVERAGE_ENUM_OVERLAP_CHARS,
  });

  // UNION by normalized name, keeping the highest-emphasis instance.
  const byName = new Map<string, SpeakerItem>();

  for (const window of windows) {
    const prompt = COVERAGE_ENUM_PROMPT.replace("{TRANSCRIPT}", window);
    let raw: string | null = null;
    try {
      raw = await callScoutExtractLlm([{ role: "user", content: prompt }]);
    } catch (e) {
      logger.warn(
        { err: (e as Error).message },
        "coverage-gate: enumeration window LLM call threw — skipping window",
      );
      continue;
    }
    const items = parseSpeakerItems(raw, transcript);
    for (const it of items) {
      const key = normalize(it.name);
      const existing = byName.get(key);
      if (!existing || emphasisRank(it.emphasis_level) > emphasisRank(existing.emphasis_level)) {
        byName.set(key, it);
      }
    }
  }

  // Cap by emphasis priority (primary first) so the most important items survive the cap.
  const all = [...byName.values()].sort(
    (a, b) => emphasisRank(b.emphasis_level) - emphasisRank(a.emphasis_level),
  );
  return all.slice(0, COVERAGE_ENUM_MAX_ITEMS);
}

// ─── Pure-Functional Comparator (Layer 2 — depth-aware) ──────────────────────

/**
 * Deterministic, pure-functional comparator. NO I/O. NO Date.now(). NO LLM calls.
 *
 * For each speaker item, classify against the extraction corpus:
 *   - MISSING  — the item name is not present at all.
 *   - SHALLOW  — name present, but < MIN_MECHANIC_TOKENS distinct content tokens from the
 *                item's OWN verbatim_quote are present (name-drop, mechanic not captured).
 *   - COVERED  — name present AND mechanic-depth met (or the quote is too terse to demand
 *                more tokens than it contains — then name-presence is the best signal).
 *
 * Only primary + secondary items count toward coverage_pct (shallow + missing both count as
 * not-covered). "mention" items are reported but never cause coverage_failed.
 * coverage_failed when ANY PRIMARY item is missing OR shallow.
 */
export function computeCoverageVerdict(
  speakerItems: SpeakerItem[],
  extraction: ExtractionSnapshot,
): CoverageVerdict {
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

  if (extraction._recall_primary_tool_note?.value) {
    corpusParts.push(extraction._recall_primary_tool_note.value);
  }

  const corpus = corpusParts.join(" ").toLowerCase().replace(/\s+/g, " ");

  function classify(item: SpeakerItem): "covered" | "shallow" | "missing" {
    const normName = normalize(item.name);
    const nameWords = normName.split(" ").filter((w) => w.length >= 4);
    const namePresent =
      corpus.includes(normName) || (nameWords.length > 0 && nameWords.every((w) => corpus.includes(w)));
    if (!namePresent) return "missing";

    // Depth: mechanic tokens drawn from the item's OWN quote (excluding the name words).
    const nameTokenSet = new Set(normName.split(" "));
    const quoteTokens = contentTokens(item.verbatim_quote).filter((t) => !nameTokenSet.has(t));
    // Terse quote can't be required to yield more tokens than it has — name-present suffices.
    if (quoteTokens.length < MIN_MECHANIC_TOKENS) return "covered";
    const present = quoteTokens.filter((t) => corpus.includes(t)).length;
    return present >= MIN_MECHANIC_TOKENS ? "covered" : "shallow";
  }

  const covered: string[] = [];
  const shallow: string[] = [];
  const missing: string[] = [];

  for (const item of speakerItems) {
    const c = classify(item);
    if (c === "covered") covered.push(item.name);
    else if (c === "shallow") shallow.push(item.name);
    else missing.push(item.name);
  }

  const countable = speakerItems.filter((i) => i.emphasis_level !== "mention");
  const countableNames = new Set(countable.map((i) => i.name));
  const notCoveredCountable = [...shallow, ...missing].filter((n) => countableNames.has(n));

  const coverage_pct =
    countable.length === 0
      ? 1.0
      : (countable.length - notCoveredCountable.length) / countable.length;

  // coverage_failed when ANY primary item is missing OR shallow (mechanic not captured).
  const primaryNotCovered = [...missing, ...shallow].filter(
    (name) => speakerItems.find((i) => i.name === name)?.emphasis_level === "primary",
  );
  const verdict: CoverageVerdict["verdict"] =
    primaryNotCovered.length > 0 ? "coverage_failed" : "pass";

  return { covered, shallow, missing, coverage_pct, verdict };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Full coverage gate: windowed enumerate → depth-aware compare → verdict.
 *
 * @returns { speakerItems, verdict } — always resolves, never throws.
 */
export async function runCoverageGate(
  transcript: string,
  extraction: ExtractionSnapshot,
): Promise<{ speakerItems: SpeakerItem[]; verdict: CoverageVerdict }> {
  const speakerItems = await runCoverageEnumeration(transcript);
  const verdict = computeCoverageVerdict(speakerItems, extraction);
  return { speakerItems, verdict };
}
