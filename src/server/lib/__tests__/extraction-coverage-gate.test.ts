/**
 * W3.1 — Extraction Coverage Gate tests.
 *
 * ALL tests are deterministic. No live Ollama calls.
 * The LLM enumeration (runCoverageEnumeration) is mocked at the model-router
 * boundary. Only the pure-functional comparator (computeCoverageVerdict) and
 * the orchestrator (runCoverageGate) are exercised in meaningful paths.
 *
 * Fixture: Gann-box transcript (SY2jXlW9bt4 — "4H candle" strategy).
 * Speaker-named items that gemma silently dropped:
 *   - "Gann box"               [primary]
 *   - "4 zones / premature-optimum-overextended"  [primary]
 *   - "0.25/0.5/0.75 Fib levels" [primary]
 *   - "impulse candle"         [secondary]
 *   - "fair value gap"         [secondary]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeCoverageVerdict,
  runCoverageGate,
  runCoverageEnumeration,
  type SpeakerItem,
  type ExtractionSnapshot,
  type CoverageVerdict,
} from "../extraction-coverage-gate.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GANN_TRANSCRIPT = `
So what you want to do is take the four hour candle - the 6am candle if we're talking US session
- and you draw a Gann box from the low to the high of that candle.
Then you divide that box into four equal zones using the 25%, 50%, and 75% Fibonacci levels.
The bottom zone is what I call premature, the middle is optimum, and the top is overextended.
When price comes back into the optimum zone with a retracement wick, that's your entry signal.
You also want to see a fair value gap on the lower timeframe as confluence before you pull the trigger.
What you're really waiting for is that impulse candle on the 4H - a big bodied candle - because
that tells you there's real momentum behind the move.
`.trim();

/** WEAK extraction — gemma flattened "Gann box" to a generic "box" and dropped zone construction */
// WEAK relative to the Gann benchmark (misses Gann box / Fib / FVG) but RICH + NAMED in its own
// right (3 entry steps + 1 confluence + a non-generic concept_name). Per the FIX 13 contract, the
// 0-enumerated-items fail-safe passes ONLY for a rich+named extraction — so this fixture carries a
// concept_name to exercise that path. (An unnamed/generic 0-item extraction correctly coverage_fails;
// see the N7uP real-world case.)
const WEAK_EXTRACTION: ExtractionSnapshot = {
  concept_name: "candle_box_retracement",
  entry_sequence: [
    { step: 1, action: "Wait for the 6am 4H candle to form a big bodied candle.", rationale: null },
    { step: 2, action: "Draw a box over the candle and wait for price to re-enter.", rationale: null },
    { step: 3, action: "Enter on a retracement wick back into the box.", rationale: null },
  ],
  confluences: [
    { name: "candle_quality_filter", description: "big body required; no small indecision candles" },
  ],
};

/** GOOD extraction — captures Gann box, zone construction, Fib levels, FVG */
const GOOD_EXTRACTION: ExtractionSnapshot = {
  entry_sequence: [
    {
      step: 1,
      action: "Identify the 6am 4H candle (impulse candle — big body required). Draw a Gann box from the low to the high of that candle and divide it at 25%, 50%, and 75% Fibonacci levels into premature, optimum, and overextended zones.",
      rationale: "The Gann box creates the trade framework for the entire setup.",
    },
    {
      step: 2,
      action: "Wait for price to retrace into the optimum zone (25–50% band of the Gann box).",
      rationale: null,
    },
    {
      step: 3,
      action: "Enter on a retracement wick into the optimum zone with a fair value gap as confluence.",
      rationale: null,
    },
  ],
  confluences: [
    { name: "fair_value_gap", description: "fair value gap required on lower timeframe as confluence" },
    { name: "candle_quality_filter", description: "impulse candle: big body; no indecision candles" },
  ],
};

/** Speaker items the LLM enumeration would return for the Gann-box transcript */
const GANN_SPEAKER_ITEMS: SpeakerItem[] = [
  { name: "Gann box", verbatim_quote: "draw a Gann box from the low to the high of that candle", emphasis_level: "primary" },
  { name: "optimum zone", verbatim_quote: "the middle is optimum", emphasis_level: "primary" },
  { name: "25% 50% 75% Fibonacci levels", verbatim_quote: "divide that box into four equal zones using the 25%, 50%, and 75% Fibonacci levels", emphasis_level: "primary" },
  { name: "impulse candle", verbatim_quote: "What you're really waiting for is that impulse candle on the 4H", emphasis_level: "secondary" },
  { name: "fair value gap", verbatim_quote: "you also want to see a fair value gap on the lower timeframe", emphasis_level: "secondary" },
];

// ─── Mock model-router ─────────────────────────────────────────────────────────

// We mock the entire model-router module so no Ollama calls fire.
vi.mock("../../services/model-router.js", () => ({
  callScoutExtractLlm: vi.fn(),
}));

// Also mock the logger leaf so no import-graph explosion
vi.mock("../logger.js", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { callScoutExtractLlm } from "../../services/model-router.js";
const mockCall = callScoutExtractLlm as ReturnType<typeof vi.fn>;

// ─── computeCoverageVerdict (pure-functional, no mocks needed) ────────────────

describe("computeCoverageVerdict — pure-functional", () => {
  it("returns coverage_failed when Gann box is missing from weak extraction", () => {
    const verdict: CoverageVerdict = computeCoverageVerdict(GANN_SPEAKER_ITEMS, WEAK_EXTRACTION);
    expect(verdict.verdict).toBe("coverage_failed");
    expect(verdict.missing).toContain("Gann box");
  });

  it("reports missing primary items in missing[]", () => {
    const verdict = computeCoverageVerdict(GANN_SPEAKER_ITEMS, WEAK_EXTRACTION);
    // Gann box and its zone construction should both be missing
    const primaryMissing = verdict.missing.filter(
      (name) => GANN_SPEAKER_ITEMS.find((i) => i.name === name)?.emphasis_level === "primary",
    );
    expect(primaryMissing.length).toBeGreaterThan(0);
  });

  it("returns pass when good extraction covers all primary items", () => {
    const verdict = computeCoverageVerdict(GANN_SPEAKER_ITEMS, GOOD_EXTRACTION);
    expect(verdict.verdict).toBe("pass");
  });

  it("covered[] includes items present in the good extraction", () => {
    const verdict = computeCoverageVerdict(GANN_SPEAKER_ITEMS, GOOD_EXTRACTION);
    expect(verdict.covered).toContain("Gann box");
    expect(verdict.covered).toContain("fair value gap");
    expect(verdict.covered).toContain("impulse candle");
  });

  it("coverage_pct is 1.0 when no primary/secondary items are missing", () => {
    const verdict = computeCoverageVerdict(GANN_SPEAKER_ITEMS, GOOD_EXTRACTION);
    expect(verdict.coverage_pct).toBe(1.0);
  });

  it("coverage_pct is less than 1.0 when primary items are missing", () => {
    const verdict = computeCoverageVerdict(GANN_SPEAKER_ITEMS, WEAK_EXTRACTION);
    expect(verdict.coverage_pct).toBeLessThan(1.0);
  });

  it("returns pass with coverage_pct=1.0 when speaker_items is empty", () => {
    const verdict = computeCoverageVerdict([], WEAK_EXTRACTION);
    expect(verdict.verdict).toBe("pass");
    expect(verdict.coverage_pct).toBe(1.0);
    expect(verdict.missing).toHaveLength(0);
  });

  it("mention-level items do not cause coverage_failed even when missing", () => {
    const mentionOnlyItems: SpeakerItem[] = [
      { name: "some_obscure_mention", verbatim_quote: "I also mention this briefly", emphasis_level: "mention" },
    ];
    const verdict = computeCoverageVerdict(mentionOnlyItems, WEAK_EXTRACTION);
    // "some_obscure_mention" is not in the weak extraction but it's only a mention
    expect(verdict.verdict).toBe("pass");
  });

  it("FIX 13 contract: 0 countable items + UNNAMED extraction → coverage_failed (N7uP class)", () => {
    // The 0-item fail-safe is NOT a blanket pass — an unnamed/generic extraction with no
    // enumerated items is a real miss, not a benevolent gap. Locks the rich+named requirement.
    const unnamed: ExtractionSnapshot = {
      entry_sequence: [{ step: 1, action: "do a thing", rationale: null }],
      confluences: [],
    };
    const verdict = computeCoverageVerdict([], unnamed);
    expect(verdict.verdict).toBe("coverage_failed");
    expect(verdict.coverage_pct).toBe(0);
  });

  it("coverage uses recall annotation _recall_primary_tool_note as additional corpus", () => {
    const extractionWithAnnotation: ExtractionSnapshot = {
      entry_sequence: [
        { step: 1, action: "Wait for a candle and enter.", rationale: null },
      ],
      confluences: [],
      _recall_primary_tool_note: {
        value: "Gann box drawn low to high of 4H candle; divided at 25/50/75 Fibonacci levels into premature optimum overextended zones",
        quote: "draw a Gann box from the low to the high of that candle",
      },
    };
    const gannItems: SpeakerItem[] = [
      { name: "Gann box", verbatim_quote: "draw a Gann box from the low to the high", emphasis_level: "primary" },
      { name: "optimum zone", verbatim_quote: "the middle is optimum", emphasis_level: "primary" },
    ];
    const verdict = computeCoverageVerdict(gannItems, extractionWithAnnotation);
    // Annotation contains "Gann box" and "optimum" so should cover both
    expect(verdict.verdict).toBe("pass");
    expect(verdict.covered).toContain("Gann box");
  });

  it("is deterministic — same inputs always produce same output", () => {
    const v1 = computeCoverageVerdict(GANN_SPEAKER_ITEMS, WEAK_EXTRACTION);
    const v2 = computeCoverageVerdict(GANN_SPEAKER_ITEMS, WEAK_EXTRACTION);
    expect(v1.verdict).toBe(v2.verdict);
    expect(v1.covered).toEqual(v2.covered);
    expect(v1.missing).toEqual(v2.missing);
    expect(v1.coverage_pct).toBe(v2.coverage_pct);
  });
});

// ─── runCoverageEnumeration (mocked LLM) ─────────────────────────────────────

describe("runCoverageEnumeration — mocked LLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed speaker items when LLM returns valid JSON", async () => {
    mockCall.mockResolvedValueOnce(
      JSON.stringify({
        speaker_items: [
          {
            name: "Gann box",
            verbatim_quote: "draw a Gann box from the low to the high of that candle",
            emphasis_level: "primary",
          },
          {
            name: "fair value gap",
            verbatim_quote: "you also want to see a fair value gap on the lower timeframe",
            emphasis_level: "secondary",
          },
        ],
      }),
    );

    const items = await runCoverageEnumeration(GANN_TRANSCRIPT);
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Gann box");
    expect(items[0].emphasis_level).toBe("primary");
    expect(items[1].name).toBe("fair value gap");
  });

  it("discards items whose verbatim_quote is not in the transcript", async () => {
    mockCall.mockResolvedValueOnce(
      JSON.stringify({
        speaker_items: [
          {
            name: "Gann box",
            // Real quote — should survive
            verbatim_quote: "draw a Gann box from the low to the high of that candle",
            emphasis_level: "primary",
          },
          {
            name: "hallucinated tool",
            // Not in transcript — should be discarded
            verbatim_quote: "this phrase never appears in the transcript at all whatsoever",
            emphasis_level: "primary",
          },
        ],
      }),
    );

    const items = await runCoverageEnumeration(GANN_TRANSCRIPT);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Gann box");
  });

  it("returns [] when LLM returns null (model unavailable)", async () => {
    mockCall.mockResolvedValueOnce(null);
    const items = await runCoverageEnumeration(GANN_TRANSCRIPT);
    expect(items).toEqual([]);
  });

  it("returns [] when LLM throws", async () => {
    mockCall.mockRejectedValueOnce(new Error("Ollama timeout"));
    const items = await runCoverageEnumeration(GANN_TRANSCRIPT);
    expect(items).toEqual([]);
  });

  it("returns [] when LLM returns non-JSON", async () => {
    mockCall.mockResolvedValueOnce("I cannot help with that.");
    const items = await runCoverageEnumeration(GANN_TRANSCRIPT);
    expect(items).toEqual([]);
  });

  it("strips markdown fences from LLM response before parsing", async () => {
    mockCall.mockResolvedValueOnce(
      "```json\n" +
        JSON.stringify({
          speaker_items: [
            {
              name: "Gann box",
              verbatim_quote: "draw a Gann box from the low to the high of that candle",
              emphasis_level: "primary",
            },
          ],
        }) +
        "\n```",
    );
    const items = await runCoverageEnumeration(GANN_TRANSCRIPT);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Gann box");
  });

  it("ignores items with invalid emphasis_level", async () => {
    mockCall.mockResolvedValueOnce(
      JSON.stringify({
        speaker_items: [
          {
            name: "Gann box",
            verbatim_quote: "draw a Gann box from the low to the high of that candle",
            emphasis_level: "INVALID_LEVEL",
          },
        ],
      }),
    );
    const items = await runCoverageEnumeration(GANN_TRANSCRIPT);
    expect(items).toHaveLength(0);
  });
});

// ─── runCoverageGate (orchestrator, mocked LLM) ───────────────────────────────

describe("runCoverageGate — orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Gann-box-missing scenario: returns coverage_failed with Gann box in missing[]", async () => {
    // LLM enumerates the items the speaker taught
    mockCall.mockResolvedValueOnce(
      JSON.stringify({
        speaker_items: GANN_SPEAKER_ITEMS.map((i) => ({
          name: i.name,
          verbatim_quote: i.verbatim_quote,
          emphasis_level: i.emphasis_level,
        })),
      }),
    );

    const { verdict, speakerItems } = await runCoverageGate(GANN_TRANSCRIPT, WEAK_EXTRACTION);

    expect(verdict.verdict).toBe("coverage_failed");
    expect(verdict.missing).toContain("Gann box");
    expect(speakerItems.length).toBeGreaterThan(0);
  });

  it("good extraction scenario: returns pass", async () => {
    mockCall.mockResolvedValueOnce(
      JSON.stringify({
        speaker_items: GANN_SPEAKER_ITEMS.map((i) => ({
          name: i.name,
          verbatim_quote: i.verbatim_quote,
          emphasis_level: i.emphasis_level,
        })),
      }),
    );

    const { verdict } = await runCoverageGate(GANN_TRANSCRIPT, GOOD_EXTRACTION);
    expect(verdict.verdict).toBe("pass");
  });

  it("returns pass (not throw) when LLM is unavailable", async () => {
    mockCall.mockResolvedValueOnce(null);
    // With no speaker items, comparator returns pass by contract
    const { verdict, speakerItems } = await runCoverageGate(GANN_TRANSCRIPT, WEAK_EXTRACTION);
    expect(speakerItems).toHaveLength(0);
    expect(verdict.verdict).toBe("pass");
    expect(verdict.coverage_pct).toBe(1.0);
  });
});

// ─── Recall-pass Q6 wiring (import-level test) ───────────────────────────────
// Verify that the recall module exports primary_tool_setup in RecallAnswer and
// that emptyRecall() includes the field. This test imports from the actual
// recall module (no LLM calls — we only test shape/interface compliance).

describe("recall pass — primary_tool_setup wiring", () => {
  it("RecallAnswer type includes primary_tool_setup field", () => {
    // The import will fail to compile if the field doesn't exist on the type.
    // We also exercise emptyRecall via the exported runRecallPass failure path.
    // This is a shape-compliance test only.
    const fieldNames: Array<keyof import("../transcript-extractor-recall.js").RecallAnswer> = [
      "win_rate",
      "avg_r",
      "time_filter",
      "candle_filter",
      "instrument_lock",
      "primary_tool_setup",
    ];
    expect(fieldNames).toContain("primary_tool_setup");
  });

  it("runRecallPass returns primary_tool_setup in recall object on parse failure", async () => {
    // Mock the LLM to return garbage so we hit the parse-failure path
    // which returns emptyRecall(). emptyRecall() must include primary_tool_setup.
    mockCall.mockResolvedValueOnce("not json at all");

    const { runRecallPass } = await import("../transcript-extractor-recall.js");
    const result = await runRecallPass("dummy transcript text", { name: "test_strategy" });

    // failed path returns emptyRecall() which must have primary_tool_setup
    expect(result.recall).toHaveProperty("primary_tool_setup");
    expect(result.recall.primary_tool_setup).toEqual({ value: null, quote: null });
    expect(result.failed).toBe(true);
  });

  it("runRecallPass patches entry_sequence when primary_tool_setup recall fills in a thin step 1", async () => {
    mockCall.mockResolvedValueOnce(
      JSON.stringify({
        win_rate: { value: null, quote: null },
        avg_r: { value: null, quote: null },
        time_filter: { value: null, quote: null },
        candle_filter: { value: null, quote: null },
        instrument_lock: { value: null, quote: null },
        primary_tool_setup: {
          value: "Gann box drawn low to high of the 4H candle; divided at 25/50/75 Fibonacci levels into premature/optimum/overextended zones",
          // This quote IS in the Gann transcript so it will pass verifyQuoteInTranscript
          quote: "draw a Gann box from the low to the high of that candle",
        },
      }),
    );

    const { runRecallPass } = await import("../transcript-extractor-recall.js");
    // Provide a primary with a thin step 1 (< 30 chars) so patch fires
    const primary: import("../transcript-extractor-recall.js").PrimaryStrategyShape = {
      name: "gann_box_strategy",
      entry_sequence: [
        { step: 1, action: "Enter.", rationale: null }, // thin — 6 chars
      ],
    };

    const result = await runRecallPass(GANN_TRANSCRIPT, primary);

    // Q6 patch: step 1 should now be the Gann box description
    expect(result.failed).toBe(false);
    expect(result.recall.primary_tool_setup.value).toContain("Gann box");
    // patched entry_sequence step 1 should have the recovered tool
    const step1 = result.patched.entry_sequence?.[0];
    expect(step1?.action).toContain("Gann box");
    expect(result.appliedChanges.some((c) => c.includes("primary_tool_setup recall"))).toBe(true);
  });

  it("runRecallPass does NOT overwrite a rich step 1 (>= 30 chars) when recall fills primary_tool_setup", async () => {
    mockCall.mockResolvedValueOnce(
      JSON.stringify({
        win_rate: { value: null, quote: null },
        avg_r: { value: null, quote: null },
        time_filter: { value: null, quote: null },
        candle_filter: { value: null, quote: null },
        instrument_lock: { value: null, quote: null },
        primary_tool_setup: {
          value: "Gann box drawn low to high",
          quote: "draw a Gann box from the low to the high of that candle",
        },
      }),
    );

    const { runRecallPass } = await import("../transcript-extractor-recall.js");
    const richStep1Action = "Wait for the 6am 4H candle to form a big bodied candle (already rich enough)";
    const primary: import("../transcript-extractor-recall.js").PrimaryStrategyShape = {
      name: "gann_box_strategy",
      entry_sequence: [
        { step: 1, action: richStep1Action, rationale: null }, // >= 30 chars
      ],
    };

    const result = await runRecallPass(GANN_TRANSCRIPT, primary);

    expect(result.failed).toBe(false);
    // Step 1 should NOT be replaced
    expect(result.patched.entry_sequence?.[0]?.action).toBe(richStep1Action);
    // But annotation should exist
    expect((result.patched as Record<string, unknown>)._recall_primary_tool_note).toBeDefined();
    // appliedChanges should mention annotation, not step 1 replacement
    expect(result.appliedChanges.some((c) => c.includes("_recall_primary_tool_note"))).toBe(true);
  });
});
