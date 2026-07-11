/**
 * Confirmation-strength scorer tests — Fidelity Phase 3B (the HOW axis).
 * Continuous quality scoring (not binary). Distinguishes the educator's TRADE tap (strong CHoCH) from
 * the NO-TRADE tap (weak CHoCH) — the 2u9 residual. Guard: improve 2u9 without overfitting to one example.
 */
import { describe, it, expect } from "vitest";
import { scoreConfirmationStrength, detectStrengthRequirement, meetsStrengthRequirement } from "../confirmation-strength.js";

describe("scoreConfirmationStrength — Layer A/B/C", () => {
  it("★ strong confirmation: decisive break + full body + impulse + follow-through → strong", () => {
    const r = scoreConfirmationStrength({ range_atr_ratio: 1.8, body_ratio: 0.85, break_distance_atr: 1.2, follow_through: 2 });
    expect(r.classification).toBe("strong");
    expect(r.score).toBeGreaterThanOrEqual(0.75);
  });

  it("★ weak confirmation: barely-clears + wicky + no follow-through → weak (the no-trade tap)", () => {
    const r = scoreConfirmationStrength({ range_atr_ratio: 0.3, body_ratio: 0.15, break_distance_atr: 0.1, follow_through: 0 });
    expect(r.classification).toBe("weak");
    expect(r.score).toBeLessThan(0.45);
    expect(r.rationale).toContain("barely cleared the level");
  });

  it("medium confirmation between the thresholds", () => {
    const r = scoreConfirmationStrength({ range_atr_ratio: 1.0, body_ratio: 0.55, break_distance_atr: 0.5, follow_through: 1 });
    expect(r.classification).toBe("medium");
  });
});

describe("detectStrengthRequirement — extraction", () => {
  it("'clean change of character' / 'with displacement' → required strong", () => {
    expect(detectStrengthRequirement("we need a clean change of character with displacement").min).toBe("strong");
  });
  it("★ rejecting a weak tap ('slight reaction... not the confirmation we wanted') → required strong (2u9)", () => {
    const r = detectStrengthRequirement("there was a slight reaction but we did not get the confirmation we wanted so we have no trade");
    expect(r.required).toBe(true);
    expect(r.min).toBe("strong");
  });
  it("a plain stated confirmation → required medium", () => {
    expect(detectStrengthRequirement("wait for confirmation then enter")).toMatchObject({ required: true, min: "medium" });
  });
  it("no strength language → not required", () => {
    expect(detectStrengthRequirement("enter on the retest of the level").required).toBe(false);
  });
});

describe("meetsStrengthRequirement — signal-time discrimination (the 2u9 fix)", () => {
  const strongReq = detectStrengthRequirement("we need a clean change of character, no weak reactions");
  it("★ strong-required + WEAK features → NOT met (rejects the no-trade tap)", () => {
    expect(meetsStrengthRequirement(strongReq, { range_atr_ratio: 0.3, body_ratio: 0.15, break_distance_atr: 0.1, follow_through: 0 })).toBe(false);
  });
  it("★ strong-required + STRONG features → met (fires the trade tap)", () => {
    expect(meetsStrengthRequirement(strongReq, { range_atr_ratio: 1.8, body_ratio: 0.85, break_distance_atr: 1.2, follow_through: 2 })).toBe(true);
  });
  it("no requirement → always met (no gate)", () => {
    expect(meetsStrengthRequirement({ required: false, min: "weak", evidence: "" }, {})).toBe(true);
  });
});
