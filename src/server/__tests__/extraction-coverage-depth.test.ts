/**
 * E-FOUNDATION (2026-06-22) — depth-aware coverage comparator.
 *
 * The keystone test: coverage_pct must be UNGAMEABLE by name-dropping. A step that merely
 * says "gann box" is SHALLOW (not covered); a step that quotes the construction mechanic is
 * COVERED. This is what makes the 5-URL validation gate measure real completeness.
 */
import { describe, it, expect, vi } from "vitest";

// Isolate the pure comparator from the Express/DB bootstrap graph (vi.mock is hoisted).
// computeCoverageVerdict is pure; we only need to stop model-router → db/index from loading.
vi.mock("../services/model-router.js", () => ({
  callScoutExtractLlm: vi.fn(),
  setChunkedNumCtxOverride: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ db: {} }));

import {
  computeCoverageVerdict,
  type SpeakerItem,
  type ExtractionSnapshot,
} from "../lib/extraction-coverage-gate.js";

const GANN: SpeakerItem = {
  name: "Gann box",
  verbatim_quote: "draw the box from the high to the low and divide it into the optimum zone",
  emphasis_level: "primary",
};

describe("computeCoverageVerdict — depth-aware (E-FOUNDATION)", () => {
  it("name-only mention is SHALLOW, not covered → coverage_failed (the gameability fix)", () => {
    const extraction: ExtractionSnapshot = {
      entry_sequence: [{ step: 1, action: "use the gann box for bias", rationale: null }],
      confluences: [],
    };
    const v = computeCoverageVerdict([GANN], extraction);
    expect(v.shallow).toContain("Gann box");
    expect(v.covered).not.toContain("Gann box");
    expect(v.verdict).toBe("coverage_failed");
    expect(v.coverage_pct).toBe(0); // 1 countable, 0 covered
  });

  it("mechanic-quoted capture is COVERED → pass", () => {
    const extraction: ExtractionSnapshot = {
      entry_sequence: [
        {
          step: 1,
          action: "draw the gann box from the candle high to the low, divide into the optimum zone 25-50%",
          rationale: "retrace into optimum then continue",
        },
      ],
      confluences: [],
    };
    const v = computeCoverageVerdict([GANN], extraction);
    expect(v.covered).toContain("Gann box");
    expect(v.shallow).not.toContain("Gann box");
    expect(v.verdict).toBe("pass");
    expect(v.coverage_pct).toBe(1);
  });

  it("absent name is MISSING → coverage_failed when primary", () => {
    const extraction: ExtractionSnapshot = {
      entry_sequence: [{ step: 1, action: "buy when price breaks the high", rationale: null }],
      confluences: [],
    };
    const v = computeCoverageVerdict([GANN], extraction);
    expect(v.missing).toContain("Gann box");
    expect(v.verdict).toBe("coverage_failed");
  });

  it("terse quote (fewer than MIN_MECHANIC_TOKENS distinct tokens) — name-presence suffices (no false SHALLOW)", () => {
    const terse: SpeakerItem = {
      name: "VWAP",
      verbatim_quote: "use the VWAP", // no extra content tokens beyond the name
      emphasis_level: "secondary",
    };
    const extraction: ExtractionSnapshot = {
      confluences: [{ name: "vwap", description: "price above vwap" }],
      entry_sequence: [],
    };
    const v = computeCoverageVerdict([terse], extraction);
    expect(v.covered).toContain("VWAP");
  });

  it("coverage_pct counts SHALLOW as not-covered (2 primary, 1 mechanic-covered)", () => {
    const items: SpeakerItem[] = [
      // gann quote uses mechanic tokens (draw/candle) absent from the corpus → SHALLOW
      {
        name: "Gann box",
        verbatim_quote: "draw the box from the candle high to the candle low",
        emphasis_level: "primary",
      },
      {
        name: "optimum zone",
        verbatim_quote: "the optimum zone is the 25 to 50 percent retracement area",
        emphasis_level: "primary",
      },
    ];
    const extraction: ExtractionSnapshot = {
      entry_sequence: [
        { step: 1, action: "use the gann box", rationale: null }, // gann = shallow (name only, no mechanic)
        {
          step: 2,
          action: "wait for retracement into the optimum zone between 25 and 50 percent",
          rationale: null,
        }, // optimum zone = covered (retracement + percent tokens present)
      ],
      confluences: [],
    };
    const v = computeCoverageVerdict(items, extraction);
    expect(v.covered).toContain("optimum zone");
    expect(v.shallow).toContain("Gann box");
    expect(v.coverage_pct).toBe(0.5); // 1 of 2 countable covered
    expect(v.verdict).toBe("coverage_failed"); // a primary is shallow
  });

  it("'mention' emphasis items never cause coverage_failed", () => {
    const items: SpeakerItem[] = [
      { name: "VWAP", verbatim_quote: "price above the vwap with momentum", emphasis_level: "primary" },
      { name: "Elliott wave", verbatim_quote: "some people use elliott wave but we do not", emphasis_level: "mention" },
    ];
    const extraction: ExtractionSnapshot = {
      entry_sequence: [{ step: 1, action: "enter when price holds above the vwap with momentum", rationale: null }],
      confluences: [],
    };
    const v = computeCoverageVerdict(items, extraction);
    expect(v.covered).toContain("VWAP"); // the only countable item is covered
    expect(v.missing).toContain("Elliott wave");
    expect(v.verdict).toBe("pass"); // mention missing is fine
  });
});

describe("5-URL audit fixes (2026-06-22)", () => {
  it("FIX 1: numeric Fib levels (25/50/75) count as mechanic tokens → COVERED not SHALLOW", () => {
    const item: SpeakerItem = {
      name: "Fibonacci levels",
      verbatim_quote: "draw the 25 50 and 75 levels on the box",
      emphasis_level: "primary",
    };
    const extraction: ExtractionSnapshot = {
      entry_sequence: [
        { step: 1, action: "draw the Fibonacci levels at 25 50 75 percent of the box", rationale: null },
      ],
      confluences: [],
    };
    const v = computeCoverageVerdict([item], extraction);
    expect(v.covered).toContain("Fibonacci levels"); // 25/50/75 numeric tokens now satisfy depth
    expect(v.verdict).toBe("pass");
  });

  it("FIX 4: threshold pass — 6/7 covered (one mention mis-labeled primary) → pass at >=85%", () => {
    const items: SpeakerItem[] = [];
    // 6 covered primaries
    for (let i = 0; i < 6; i++) {
      items.push({ name: `tool${i}`, verbatim_quote: `the tool${i} mechanic alpha bravo`, emphasis_level: "primary" });
    }
    // 1 mis-labeled mention that's absent
    items.push({ name: "fair value gaps", verbatim_quote: "price also seeks fair value gaps", emphasis_level: "primary" });
    const corpus = items.slice(0, 6).map((it, i) => `step: use tool${i} mechanic alpha bravo`).join(" ");
    const extraction: ExtractionSnapshot = {
      entry_sequence: corpus.split("step:").filter(Boolean).map((a, i) => ({ step: i + 1, action: a, rationale: null })),
      confluences: [{ name: "c", description: "x" }],
    };
    const v = computeCoverageVerdict(items, extraction);
    expect(v.coverage_pct).toBeGreaterThanOrEqual(0.85);
    expect(v.missing).toContain("fair value gaps");
    expect(v.verdict).toBe("pass"); // threshold path tolerates the 1 mis-labeled mention
  });

  it("FIX 5: vacuous-pass floor — 0 items + THIN extraction → coverage_failed (not free pass)", () => {
    const thin: ExtractionSnapshot = {
      entry_sequence: [{ step: 1, action: "buy", rationale: null }, { step: 2, action: "sell", rationale: null }],
      confluences: [],
    };
    const v = computeCoverageVerdict([], thin);
    expect(v.verdict).toBe("coverage_failed");
    expect(v.coverage_pct).toBe(0);
  });

  it("FIX 13: 0 items + UNNAMED/thin extraction → coverage_failed (no self-evidence)", () => {
    const rich: ExtractionSnapshot = {
      entry_sequence: [1, 2, 3, 4].map((s) => ({ step: s, action: `step ${s} action`, rationale: null })),
      confluences: [{ name: "a", description: "x" }, { name: "b", description: "y" }],
    }; // no concept_name/name → not self-evidently named
    expect(computeCoverageVerdict([], rich).verdict).toBe("coverage_failed");
  });

  it("FIX 13: 0 items + NAMED + rich extraction → pass (enum flaked; per-field quotes ground it)", () => {
    const named: ExtractionSnapshot = {
      concept_name: "candle_range_theory_1h_1m",
      entry_sequence: [1, 2, 3].map((s) => ({ step: s, action: `step ${s} of the CRT setup`, rationale: null })),
      confluences: [{ name: "time_window", description: "trade the killzone" }],
    } as ExtractionSnapshot;
    expect(computeCoverageVerdict([], named).verdict).toBe("pass");
  });
});
