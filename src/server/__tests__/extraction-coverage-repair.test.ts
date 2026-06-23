/**
 * E-RECALL+REPAIR (2026-06-22) — bounded quote-grounded repair loop (pure parts).
 *
 * Tests the pure merge + target-selection. The merge is gap-fill-only and anti-fabrication:
 * a recovered field is kept ONLY if its evidence_quote verifies in the transcript.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../services/model-router.js", () => ({
  callScoutExtractLlm: vi.fn(),
  setChunkedNumCtxOverride: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ db: {} }));

import {
  selectRepairTargets,
  mergeRepairResult,
} from "../lib/extraction-coverage-repair.js";
import {
  computeCoverageVerdict,
  type SpeakerItem,
  type CoverageVerdict,
  type ExtractionSnapshot,
} from "../lib/extraction-coverage-gate.js";

const TRANSCRIPT =
  "draw the gann box from the high to the low and divide it into four quarters " +
  "the optimum zone is 25 to 50 percent retracement where we look to enter";

describe("selectRepairTargets", () => {
  it("returns missing + shallow, PRIMARY first, capped", () => {
    const items: SpeakerItem[] = [
      { name: "optimum zone", verbatim_quote: "the optimum zone is 25 to 50", emphasis_level: "secondary" },
      { name: "Gann box", verbatim_quote: "draw the gann box from the high", emphasis_level: "primary" },
      { name: "covered thing", verbatim_quote: "x", emphasis_level: "primary" },
    ];
    const verdict: CoverageVerdict = {
      covered: ["covered thing"],
      shallow: ["optimum zone"],
      missing: ["Gann box"],
      coverage_pct: 0.33,
      verdict: "coverage_failed",
    };
    const targets = selectRepairTargets(verdict, items, 6);
    expect(targets.map((t) => t.name)).toEqual(["Gann box", "optimum zone"]); // primary first
    expect(targets).toHaveLength(2); // "covered thing" excluded
  });

  it("respects the cap", () => {
    const items: SpeakerItem[] = Array.from({ length: 5 }, (_, i) => ({
      name: `item${i}`,
      verbatim_quote: "q",
      emphasis_level: "primary" as const,
    }));
    const verdict: CoverageVerdict = {
      covered: [], shallow: [], missing: items.map((i) => i.name), coverage_pct: 0, verdict: "coverage_failed",
    };
    expect(selectRepairTargets(verdict, items, 2)).toHaveLength(2);
  });
});

describe("mergeRepairResult (pure, anti-fabrication)", () => {
  const base: ExtractionSnapshot = {
    entry_sequence: [{ step: 1, action: "price breaks the prior high", rationale: null }],
    confluences: [],
  };

  it("appends a recovered step whose evidence_quote verifies", () => {
    const merged = mergeRepairResult(
      base,
      [
        {
          action: "draw the gann box from high to low into four quarters",
          evidence_quote: "draw the gann box from the high to the low and divide it into four quarters",
        },
      ],
      [],
      TRANSCRIPT,
    );
    expect(merged.entry_sequence).toHaveLength(2);
    expect(merged.entry_sequence?.[1].action).toContain("gann box");
  });

  it("DROPS a recovered step whose quote is NOT in the transcript (fabrication guard)", () => {
    const merged = mergeRepairResult(
      base,
      [{ action: "use a secret indicator", evidence_quote: "this phrase is not in the transcript at all" }],
      [],
      TRANSCRIPT,
    );
    expect(merged.entry_sequence).toHaveLength(1); // nothing appended
  });

  it("UNIONs a recovered confluence by name when the quote verifies", () => {
    const merged = mergeRepairResult(
      base,
      [],
      [
        {
          name: "optimum zone",
          description: "25-50% retracement entry",
          evidence_quote: "the optimum zone is 25 to 50 percent retracement",
        },
      ],
      TRANSCRIPT,
    );
    expect(merged.confluences).toHaveLength(1);
    expect(merged.confluences?.[0].name).toBe("optimum zone");
  });

  it("does not mutate the input extraction", () => {
    const before = JSON.parse(JSON.stringify(base));
    mergeRepairResult(
      base,
      [{ action: "draw the gann box", evidence_quote: "draw the gann box from the high to the low" }],
      [],
      TRANSCRIPT,
    );
    expect(base).toEqual(before);
  });

  it("end-to-end: a SHALLOW Gann box becomes COVERED after a quote-grounded merge", () => {
    const items: SpeakerItem[] = [
      {
        name: "Gann box",
        verbatim_quote: "draw the gann box from the high to the low and divide it into four quarters",
        emphasis_level: "primary",
      },
    ];
    const shallowExtraction: ExtractionSnapshot = {
      entry_sequence: [{ step: 1, action: "use the gann box", rationale: null }], // name only → SHALLOW
      confluences: [],
    };
    expect(computeCoverageVerdict(items, shallowExtraction).shallow).toContain("Gann box");

    const repaired = mergeRepairResult(
      shallowExtraction,
      [
        {
          action: "draw the gann box from the high to the low and divide it into four quarters",
          evidence_quote: "draw the gann box from the high to the low and divide it into four quarters",
        },
      ],
      [],
      TRANSCRIPT,
    );
    const v = computeCoverageVerdict(items, repaired);
    expect(v.covered).toContain("Gann box");
    expect(v.verdict).toBe("pass");
  });
});
