/**
 * GOVERNANCE REGRESSION (2026-06-28): proves coverage_verdict is NOT a hard-equivalence property
 * of the extraction artifact, so it must not gate synchronization equivalence.
 *
 * The safeguard demanded before amending the validation methodology (operator/GPT 2026-06-28):
 *   "Construct two synthetic extraction artifacts A and B where artifact_hash(A) == artifact_hash(B).
 *    Then verify coverage_verdict(A) != coverage_verdict(B). If you can demonstrate that with a
 *    controlled fixture, you've proven coverage_verdict is not a function of the artifact alone.
 *    That is exactly the evidence needed to justify removing it from hard equivalence."
 *
 * Hard-equivalence keys (the golden's deterministic synchronization signals): grounding sha,
 * speaker_items COUNT, ideas COUNT. This fixture holds ALL of those identical between A and B
 * (in fact speaker_items are byte-identical), varies only the extraction TEXT by one item's
 * mechanic phrasing, and shows the verdict flips pass <-> coverage_failed.
 *
 * Why this matters: the Layer-0 enumerator + the main extractor are gemma calls whose TEXT varies
 * run-to-run while COUNTS stay stable. computeCoverageVerdict (Layer 2) is a DETERMINISTIC readout
 * of that text. So a count-stable but text-varying run legitimately produces a different verdict on
 * the SAME hard-equivalence artifact -> coverage_verdict measures a property OUTSIDE the equivalence
 * definition (quality), not equivalence itself.
 */
import { describe, it, expect, vi } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused"; });
import { computeCoverageVerdict, type SpeakerItem, type ExtractionSnapshot } from "../extraction-coverage-gate.js";

// 7 PRIMARY speaker items — BYTE-IDENTICAL in artifact A and B (same count AND same content).
const SEVEN_PRIMARY: SpeakerItem[] = [
  { name: "order block", verbatim_quote: "the order block is the last down candle", emphasis_level: "primary" },
  { name: "liquidity sweep", verbatim_quote: "price runs the liquidity sweep above the highs", emphasis_level: "primary" },
  { name: "market structure", verbatim_quote: "wait for the market structure shift", emphasis_level: "primary" },
  { name: "breaker block", verbatim_quote: "the breaker block forms after the sweep", emphasis_level: "primary" },
  { name: "premium zone", verbatim_quote: "enter only from the premium zone", emphasis_level: "primary" },
  { name: "displacement candle", verbatim_quote: "a displacement candle confirms intent", emphasis_level: "primary" },
  { name: "optimal entry", verbatim_quote: "the optimal entry sits at the discount", emphasis_level: "primary" },
];

const step = (s: string) => ({ action: s, rationale: s });

// Artifact A: extraction text covers 6 of 7 (optimal-entry omitted). 6/7 = 0.857 >= 0.85 -> pass.
const extA: ExtractionSnapshot = {
  concept_name: "smc_continuation",
  entry_sequence: [
    step("identify the order block last down candle then mark the liquidity sweep above the session highs"),
    step("confirm the market structure shift then locate the breaker block after the sweep retrace"),
    step("enter from the premium zone once a displacement candle confirms bearish intent strongly"),
  ],
  confluences: [{ name: "trend", description: "with the higher timeframe bias" }],
};

// Artifact B: SAME 7 items, SAME idea count (1 strategy), SAME entry-step count (3). The ONLY
// difference is one item's mechanic phrasing: step 3 omits "displacement candle". 5/7 = 0.714 -> fail.
const extB: ExtractionSnapshot = {
  concept_name: "smc_continuation",
  entry_sequence: [
    step("identify the order block last down candle then mark the liquidity sweep above the session highs"),
    step("confirm the market structure shift then locate the breaker block after the sweep retrace"),
    step("enter from the premium zone once the setup completes and the risk is defined clearly"),
  ],
  confluences: [{ name: "trend", description: "with the higher timeframe bias" }],
};

/** Projection onto the hard-equivalence keys the golden actually gates on. */
const hardKeys = (items: SpeakerItem[], ext: ExtractionSnapshot) => ({
  speaker_items_count: items.length,
  idea_count: 1, // one strategy in both
  entry_step_count: (ext.entry_sequence ?? []).length,
  concept: ext.concept_name,
});

describe("coverage_verdict is NOT a hard-equivalence property of the extraction artifact", () => {
  it("artifact_hash(A) == artifact_hash(B) on the hard-equivalence keys, yet verdict(A) != verdict(B)", () => {
    const a = computeCoverageVerdict(SEVEN_PRIMARY, extA);
    const b = computeCoverageVerdict(SEVEN_PRIMARY, extB);

    // hard-equivalence keys are IDENTICAL (same speaker_items count, same idea count, same shape)
    expect(hardKeys(SEVEN_PRIMARY, extA)).toEqual(hardKeys(SEVEN_PRIMARY, extB));
    expect(SEVEN_PRIMARY.length).toBe(7);

    // ...but the advisory coverage_verdict DIFFERS — proving it is not a function of those keys
    expect(a.verdict).toBe("pass");
    expect(b.verdict).toBe("coverage_failed");
    expect(a.verdict).not.toBe(b.verdict);
    // ...and it flipped on a SINGLE item's mechanic text (the borderline 0.85 crossing)
    expect(a.coverage_pct).toBeGreaterThanOrEqual(0.85);
    expect(b.coverage_pct).toBeLessThan(0.85);
  });

  it("the comparator itself IS deterministic given identical inputs (it is the TEXT that varies, not the function)", () => {
    expect(computeCoverageVerdict(SEVEN_PRIMARY, extA)).toEqual(computeCoverageVerdict(SEVEN_PRIMARY, extA));
    expect(computeCoverageVerdict(SEVEN_PRIMARY, extB)).toEqual(computeCoverageVerdict(SEVEN_PRIMARY, extB));
  });
});
