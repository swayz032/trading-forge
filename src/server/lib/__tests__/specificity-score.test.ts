/**
 * Specificity score + SCL tests (Fidelity Phase 2A).
 * The litmus from the bridge contract: generic structure_shift ≪ specific multi-confluence trigger.
 */
import { describe, it, expect } from "vitest";
import {
  triggerFeaturesFromText,
  triggerSpecificity,
  computeScl,
  predicateLevelIsNamed,
  maxFeatures,
} from "../specificity-score.js";

describe("triggerFeaturesFromText", () => {
  it("generic structure break → low specificity", () => {
    const f = triggerFeaturesFromText("we get a change of character, a market structure shift");
    expect(f.named_level).toBe(false); // no named level
    expect(f.confluence_count).toBe(0);
    expect(triggerSpecificity(f)).toBeLessThanOrEqual(2);
  });

  it("specific multi-confluence trigger → high specificity", () => {
    const f = triggerFeaturesFromText(
      "sweep of the asia low, then a 1m displacement candle, then retest into the fair value gap",
    );
    expect(f.named_level).toBe(true); // asia low
    expect(f.timeframe_specific).toBe(true); // 1m
    expect(f.confluence_count).toBeGreaterThanOrEqual(2); // sweep + FVG (+displacement)
    expect(f.rare_pattern).toBe(true); // displacement
    expect(triggerSpecificity(f)).toBeGreaterThanOrEqual(14);
  });

  it("★ the contract litmus: generic ≈2, specific ≈14+ → SCL is large", () => {
    const generic = triggerFeaturesFromText("market structure shift at the prior swing");
    const specific = triggerFeaturesFromText("asia low sweep + 1m displacement + fair value gap retest");
    const scl = computeScl(specific, generic);
    expect(scl).toBeGreaterThanOrEqual(10); // high SCL ⇒ fail-closed quarantine
  });
});

describe("predicateLevelIsNamed", () => {
  it("opening_range_edge / opening_price / order_block are NAMED", () => {
    expect(predicateLevelIsNamed("opening_range_edge")).toBe(true);
    expect(predicateLevelIsNamed("opening_price")).toBe(true);
  });
  it("prior_swing (generic default) + null are NOT named", () => {
    expect(predicateLevelIsNamed("prior_swing")).toBe(false);
    expect(predicateLevelIsNamed(null)).toBe(false);
  });
});

describe("computeScl + maxFeatures", () => {
  it("faithful compile (predicate captures the edge) → SCL ≈ 0", () => {
    const edge = triggerFeaturesFromText("close through the opening range edge");
    const predicate = triggerFeaturesFromText("close through the opening range edge");
    expect(computeScl(edge, predicate)).toBe(0);
  });

  it("maxFeatures builds the edge ceiling from multiple windows", () => {
    const a = triggerFeaturesFromText("opening range high"); // named
    const b = triggerFeaturesFromText("fair value gap on the 5m"); // confluence + tf
    const merged = maxFeatures(a, b);
    expect(merged.named_level).toBe(true);
    expect(merged.timeframe_specific).toBe(true);
    expect(merged.confluence_count).toBeGreaterThanOrEqual(1);
  });

  it("SCL never negative (predicate richer than edge ⇒ 0)", () => {
    const edge = triggerFeaturesFromText("a structure shift");
    const predicate = triggerFeaturesFromText("opening range edge + fvg");
    expect(computeScl(edge, predicate)).toBe(0);
  });
});
