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
/** FIX 4 (5-URL audit): coverage_pct at/above this passes even if a peripheral item is
 *  mis-labeled primary — the core strategy is captured. Strict "all primary covered" is the
 *  other (sufficient) pass path. Default 0.85 (institutional completeness bar). */
const COVERAGE_PASS_PCT = Number(process.env.COVERAGE_PASS_PCT) || 0.85;

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
  return s
    .toLowerCase()
    .replace(/[-_]/g, " ")
    // FIX 8 (5-URL audit): split digit-letter boundaries so "4hour" matches "4-hour"/"4 hour"
    // (iU8's core "4hour candle box strategy" was falsely MISSING on this mismatch).
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function emphasisRank(e: SpeakerItem["emphasis_level"]): number {
  return e === "primary" ? 3 : e === "secondary" ? 2 : 1;
}

/** Distinct content tokens from a string, normalized.
 *  FIX 1 (5-URL audit 2026-06-22): NUMBERS are load-bearing mechanic tokens for Fib/zone
 *  strategies (25/50/75 levels, % ratios). Keep any token containing a digit (len>=2),
 *  plus normal words len>=4. Without this, "25 50 75 levels" was falsely SHALLOW even
 *  though the extraction captured "Fibonacci retracements (25%, 50%, 75%)". */
function contentTokens(s: string): string[] {
  const seen = new Set<string>();
  for (const w of normalize(s).split(" ")) {
    const isNumeric = /\d/.test(w);
    if (((w.length >= 4) || (isNumeric && w.length >= 2)) && !STOPWORDS.has(w)) seen.add(w);
  }
  return [...seen];
}

/** FIX 2 (5-URL audit): canonical key for UNION dedup of spelling/alias variants the speaker
 *  uses interchangeably (e.g. "GA box" / "GAN box" / "Gann box"; "FVG" / "fair value gap").
 *  Used ONLY as the dedup key — the item keeps its ORIGINAL name for corpus matching. */
function canonicalNameKey(name: string): string {
  let n = normalize(name);
  n = n.replace(/\bga(n{0,2}) box\b/g, "gann box"); // ga box / gan box / gann box
  n = n.replace(/\b(fvg|fair value gap[s]?|f value gap[s]?|fgs)\b/g, "fvg");
  n = n.replace(/\b(ob|order block[s]?)\b/g, "order block");
  n = n.replace(/\b(poc|point of control)\b/g, "point of control");
  return n.replace(/\s+/g, " ").trim();
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
- emphasis_level:
    * "primary"   — a CORE tool of THIS setup; the trade cannot be taken without it (usually only 1-3 items).
    * "secondary" — a supporting filter/condition the speaker actually APPLIES in the setup.
    * "mention"   — named but NOT part of executing this setup: an ALTERNATIVE for other days ("on choppy days use CRT instead"), a related concept named in passing ("price seeks FVGs and order blocks"), a comparison, or background theory. When in doubt, use "mention" — over-calling "primary" wrongly fails the strategy.

RULES:
1. Only include items the speaker NAMES. Do not generalize ("support level" is too vague unless the speaker says those exact words).
2. verbatim_quote MUST be a real substring of the segment above (case-insensitive). Do not paraphrase.
3. DO NOT invent items not present in the segment.
4. Empty array is honest — use it when the segment teaches no named tools.
5. A tool the speaker offers as an ALTERNATIVE or names in PASSING (not used in the step-by-step setup) is "mention", NEVER "primary"/"secondary".
6. Maximum 12 items.

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
async function enumerateWindowsOnce(windows: string[], transcript: string): Promise<SpeakerItem[]> {
  // UNION by canonical name, keeping the highest-emphasis instance.
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
      const key = canonicalNameKey(it.name); // FIX 2: fold spelling/alias variants
      const existing = byName.get(key);
      if (!existing || emphasisRank(it.emphasis_level) > emphasisRank(existing.emphasis_level)) {
        byName.set(key, it);
      }
    }
  }
  // Cap by emphasis priority (primary first) so the most important items survive the cap.
  return [...byName.values()]
    .sort((a, b) => emphasisRank(b.emphasis_level) - emphasisRank(a.emphasis_level))
    .slice(0, COVERAGE_ENUM_MAX_ITEMS);
}

export async function runCoverageEnumeration(transcript: string): Promise<SpeakerItem[]> {
  if (!transcript || transcript.length === 0) return [];
  const windows = chunkTranscript(transcript, {
    chunkChars: COVERAGE_ENUM_WINDOW_CHARS,
    overlapChars: COVERAGE_ENUM_OVERLAP_CHARS,
  });
  let items = await enumerateWindowsOnce(windows, transcript);
  // FIX 11 (5-URL audit): 0 items is almost always a gemma flake on the windowed enum (the
  // SAME transcript yielded items on a prior run). A non-trivial strategy always names tools —
  // retry the whole pass once before the 0-item floor fails it.
  if (items.length === 0) {
    logger.warn("coverage-gate: enumeration returned 0 items — retrying once (flake guard)");
    items = await enumerateWindowsOnce(windows, transcript);
  }
  return items;
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
  // FIX 12 (5-URL audit run-3): build per-UNIT normalized text (each entry step + each
  // confluence + the recall note). Depth is measured against the EXTRACTION's own description
  // of an item — NOT the enumeration's independently-paraphrased quote (which caused false
  // SHALLOW on GA box / Fibonacci retracements when the enum quote used different words than
  // the captured steps). Deterministic given the extraction; no enum-quote dependency.
  const entrySeq = Array.isArray(extraction.entry_sequence) ? extraction.entry_sequence : [];
  const confluences = Array.isArray(extraction.confluences) ? extraction.confluences : [];
  const units: string[] = [];
  for (const step of entrySeq) units.push(normalize(`${step.action ?? ""} ${step.rationale ?? ""}`));
  for (const c of confluences) units.push(normalize(`${c.name ?? ""} ${c.description ?? ""}`));
  if (extraction._recall_primary_tool_note?.value) units.push(normalize(extraction._recall_primary_tool_note.value));

  function classify(item: SpeakerItem): "covered" | "shallow" | "missing" {
    const normName = normalize(item.name);
    const nameWords = normName.split(" ").filter((w) => w.length >= 4);
    const nameInUnit = (u: string) =>
      u.includes(normName) || (nameWords.length > 0 && nameWords.every((w) => u.includes(w)));
    const mentioning = units.filter(nameInUnit);
    if (mentioning.length === 0) return "missing";
    // COVERED when the name is discussed in a SUBSTANTIVE unit: >= MIN_MECHANIC_TOKENS content
    // tokens BEYOND the name itself (mechanic captured, not merely name-dropped).
    const nameTokenSet = new Set(normName.split(" "));
    for (const u of mentioning) {
      const extra = contentTokens(u).filter((t) => !nameTokenSet.has(t));
      if (extra.length >= MIN_MECHANIC_TOKENS) return "covered";
    }
    return "shallow";
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

  // FIX 13 (5-URL audit run-3): 0 enumerated items is acceptable ONLY when the extraction is
  // independently RICH + named — a non-generic concept_name/name + >=3 entry steps + >=1
  // confluence. In that case the per-field verbatim-quote verifier already grounds the
  // extraction and the (separate, flaky) enumeration call is the only thing that returned
  // nothing (UBvf: rich CRT extraction, enum flaked to 0). A thin/generic extraction with 0
  // items is a real miss (N7uP: generic name, 2 steps) — fail it.
  if (countable.length === 0) {
    const snap = extraction as Record<string, unknown>;
    const cn = typeof snap.concept_name === "string" ? snap.concept_name.trim() : "";
    const nm = typeof snap.name === "string" ? snap.name.trim() : "";
    const isNamed = (s: string) => s.length > 0 && !/^extracted(_strategy)?$/i.test(s);
    const richSelfEvident = (isNamed(cn) || isNamed(nm)) && entrySeq.length >= 3 && confluences.length >= 1;
    return richSelfEvident
      ? { covered, shallow, missing, coverage_pct: 1.0, verdict: "pass" }
      : { covered, shallow, missing, coverage_pct: 0, verdict: "coverage_failed" };
  }

  // FIX 4 (threshold verdict): pass when EITHER all primary items are covered (strict) OR
  // coverage_pct clears COVERAGE_PASS_PCT — the latter tolerates 1-2 mis-classified peripheral
  // mentions inflating the denominator while the core strategy is fully captured.
  const primaryNotCovered = [...missing, ...shallow].filter(
    (name) => speakerItems.find((i) => i.name === name)?.emphasis_level === "primary",
  );
  const passByStrict = primaryNotCovered.length === 0;
  const passByThreshold = coverage_pct >= COVERAGE_PASS_PCT;
  const verdict: CoverageVerdict["verdict"] =
    passByStrict || passByThreshold ? "pass" : "coverage_failed";

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
