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
        { step: 1, action: "mention the gann box for bias", rationale: null }, // gann = shallow (name only)
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
    const mention: SpeakerItem = {
      name: "Elliott wave",
      verbatim_quote: "some people use elliott wave but we do not",
      emphasis_level: "mention",
    };
    const extraction: ExtractionSnapshot = { entry_sequence: [], confluences: [] };
    const v = computeCoverageVerdict([mention], extraction);
    expect(v.missing).toContain("Elliott wave");
    expect(v.verdict).toBe("pass"); // mention missing is fine
    expect(v.coverage_pct).toBe(1); // no countable items
  });
});
