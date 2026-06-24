/**
 * Deterministic placeability scorer unit tests (2026-06-24 Layer 2).
 * Locks the operator's weighted formula + trigger hard-fail + failure-reason enums.
 */
import { describe, it, expect } from "vitest";
import { scorePlaceability, PLACEABILITY_WEIGHTS, type PlaceabilityInput } from "../placeability-score.js";

const FULL: PlaceabilityInput = {
  direction: "long",
  entry_indicator: "order_block",
  resolved_entry_indicator: "archetype:order_block",
  entry_type: "limit",
  entry_sequence: [{ action: "wait for OB retest" }, { action: "enter on rejection" }],
  confluences: [{ name: "fvg_present" }],
  session_filter: "NY 09:30-11:30 ET",
  risk_rules: "stop below the order block",
};

describe("scorePlaceability", () => {
  it("a fully-specified structural extraction is placeable with score 100", () => {
    const v = scorePlaceability({ ...FULL });
    expect(v.placeable).toBe(true);
    expect(v.placeability_score).toBe(100);
    expect(v.failure_reasons).toHaveLength(0);
  });

  it("HARD-FAILS when the trigger is absent even if every other field is present", () => {
    // concept-echo entry_indicator resolving to uncatalogued, no params/condition → no trigger.
    const v = scorePlaceability({
      ...FULL,
      entry_indicator: "impulse_range_sweep_4h_5m",
      resolved_entry_indicator: "uncatalogued:impulse_range_sweep_4h_5m",
    });
    expect(v.placeable).toBe(false); // hard-fail regardless of score
    expect(v.field_scores.trigger).toBe(0);
    expect(v.failure_reasons).toContain("UNCATALOGUED_INDICATOR");
    // score still reflects the other present fields (stop+dir+setup+entry+session = 70), but
    // placeable is false because the dominant trigger field is missing.
    expect(v.placeability_score).toBe(100 - PLACEABILITY_WEIGHTS.trigger);
  });

  it("parametric indicator without params → PARAMS_REQUIRED + not placeable", () => {
    const v = scorePlaceability({
      ...FULL,
      entry_indicator: "macd_200d_support_entry",
      resolved_entry_indicator: "macd_crossover",
      entry_params: {},
    });
    expect(v.placeable).toBe(false);
    expect(v.failure_reasons).toContain("PARAMS_REQUIRED");
  });

  it("parametric indicator WITH params → trigger present", () => {
    const v = scorePlaceability({
      ...FULL,
      entry_indicator: "ema_crossover",
      resolved_entry_indicator: "ema_crossover",
      entry_params: { fast: 9, slow: 21 },
    });
    expect(v.field_scores.trigger).toBe(PLACEABILITY_WEIGHTS.trigger);
    expect(v.placeable).toBe(true);
  });

  it("explicit entry_condition alone satisfies the trigger", () => {
    const v = scorePlaceability({
      ...FULL,
      entry_indicator: "overnight_high_low_retest_5m",
      resolved_entry_indicator: "uncatalogued:overnight_high_low_retest_5m",
      entry_condition: "close > overnight_high AND retest_holds",
    });
    expect(v.field_scores.trigger).toBe(PLACEABILITY_WEIGHTS.trigger);
    expect(v.placeable).toBe(true);
  });

  it("missing session → SESSION_MISSING and -10 score", () => {
    const v = scorePlaceability({ ...FULL, session_filter: null });
    expect(v.failure_reasons).toContain("SESSION_MISSING");
    expect(v.placeability_score).toBe(100 - PLACEABILITY_WEIGHTS.session);
    expect(v.missing_fields).toContain("session_filter");
  });

  it("fallback (no evidence): direction:both flags INSUFFICIENT_DIRECTIONAL_PARITY", () => {
    const v = scorePlaceability({ ...FULL, direction: "both" });
    expect(v.direction_label).toBe("BIDIRECTIONAL_OR_IMPLIED");
    expect(v.failure_reasons).toContain("INSUFFICIENT_DIRECTIONAL_PARITY");
    // flag, not a hard-fail — direction field still scores its weight
    expect(v.field_scores.direction).toBe(PLACEABILITY_WEIGHTS.direction);
  });

  it("fallback: missing direction → NO_DIRECTION_EVIDENCE + UNSPECIFIED label", () => {
    const v = scorePlaceability({ ...FULL, direction: null });
    expect(v.direction_label).toBe("UNSPECIFIED");
    expect(v.failure_reasons).toContain("NO_DIRECTION_EVIDENCE");
  });

  // ─── Layer 3B evidence-based direction ───────────────────────────────────────
  it("evidence BIDIRECTIONAL_EXPLICIT + claims both → RESOLVED (no direction failure)", () => {
    const v = scorePlaceability({
      ...FULL,
      direction: "both",
      direction_evidence: { class: "BIDIRECTIONAL_EXPLICIT", confidence: 0.95, evidence: [] },
    });
    expect(v.direction_class).toBe("BIDIRECTIONAL_EXPLICIT");
    expect(v.failure_reasons).not.toContain("INSUFFICIENT_DIRECTIONAL_PARITY");
    expect(v.failure_reasons).not.toContain("NO_DIRECTION_EVIDENCE");
  });

  it("evidence LONG_WITH_IMPLIED_MIRROR + claims both → INSUFFICIENT_DIRECTIONAL_PARITY (W7nln class)", () => {
    const v = scorePlaceability({
      ...FULL,
      direction: "both",
      direction_evidence: { class: "LONG_WITH_IMPLIED_MIRROR", confidence: 0.6, evidence: [] },
    });
    expect(v.failure_reasons).toContain("INSUFFICIENT_DIRECTIONAL_PARITY");
    expect(v.field_scores.direction).toBe(PLACEABILITY_WEIGHTS.direction); // still scored
  });

  it("evidence NO_DIRECTION_EVIDENCE → NO_DIRECTION_EVIDENCE + no direction score (symmetric-indicator video)", () => {
    const v = scorePlaceability({
      ...FULL,
      direction: "both",
      direction_evidence: { class: "NO_DIRECTION_EVIDENCE", confidence: 0.3, evidence: [] },
    });
    expect(v.failure_reasons).toContain("NO_DIRECTION_EVIDENCE");
    expect(v.field_scores.direction).toBe(0);
  });

  it("evidence LONG_ONLY + extraction direction long → RESOLVED", () => {
    const v = scorePlaceability({
      ...FULL,
      direction: "long",
      direction_evidence: { class: "LONG_ONLY", confidence: 0.85, evidence: [] },
    });
    expect(v.direction_class).toBe("LONG_ONLY");
    expect(v.failure_reasons).not.toContain("INSUFFICIENT_DIRECTIONAL_PARITY");
  });

  it("trigger weight dominates (30) per operator spec", () => {
    expect(PLACEABILITY_WEIGHTS.trigger).toBe(30);
    expect(PLACEABILITY_WEIGHTS.stop).toBe(20);
    const total = Object.values(PLACEABILITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
});
