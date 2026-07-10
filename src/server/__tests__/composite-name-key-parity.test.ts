/**
 * composite-name-key-parity.test.ts
 *
 * CRIT (deep-scan 2026-07-09, operator-ratified): the strategy-health aggregator
 * emitted subsystem names "compliance_block_rate" / "deepar_forecast" that did NOT
 * match the EQUAL_WEIGHTS keys "compliance" / "deepar". computeComposite() keys the
 * score map by subsystem name, so those 2 of 13 subsystems were SILENTLY dropped from
 * the weighted composite (a strategy with a terrible compliance block rate or a bad
 * DeepAR forecast never lowered the composite) while still counted toward
 * computed_from_n_subsystems and the MIN_COMPOSITE_SUBSYSTEMS floor. This corrupts the
 * evidence Wave 28 Pass C's activation gate depends on.
 *
 * The fix renamed the two aggregator names to match the weight keys. These tests lock
 * the name↔weight-key contract via the "does removing subsystem X change the composite"
 * property (the structural test the observability scan recommended), and DOCUMENT the
 * bug: a mismatched name is silently dropped.
 */

import { describe, it, expect } from "vitest";
import { computeComposite, EQUAL_WEIGHTS } from "../lib/score-normalization.js";

function allOnesExcept(key: string, value: number): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const k of Object.keys(EQUAL_WEIGHTS)) scores[k] = 1.0;
  if (key in scores) scores[key] = value;
  return scores;
}

describe("CRIT — composite name↔weight-key parity", () => {
  it("all 13 EQUAL_WEIGHTS keys are counted when scored under their correct names", () => {
    const scores: Record<string, number> = {};
    for (const k of Object.keys(EQUAL_WEIGHTS)) scores[k] = 0.9;
    const r = computeComposite(scores, EQUAL_WEIGHTS);
    expect(r.availableCount).toBe(Object.keys(EQUAL_WEIGHTS).length); // 13, not 11
    expect(r.score).toBeCloseTo(0.9, 6);
  });

  it("compliance CONTRIBUTES to the composite (a 0.0 compliance score drags it down)", () => {
    const r = computeComposite(allOnesExcept("compliance", 0.0), EQUAL_WEIGHTS);
    expect(r.availableCount).toBe(13);
    // 12 at 1.0 + compliance at 0.0 over 13 equal weights ≈ 0.923
    expect(r.score).toBeLessThan(1.0);
    expect(r.score).toBeCloseTo(12 / 13, 6);
  });

  it("deepar CONTRIBUTES to the composite (a 0.0 deepar score drags it down)", () => {
    const r = computeComposite(allOnesExcept("deepar", 0.0), EQUAL_WEIGHTS);
    expect(r.availableCount).toBe(13);
    expect(r.score).toBeCloseTo(12 / 13, 6);
  });

  it("REGRESSION guard: a name that does NOT match a weight key is SILENTLY dropped (the bug)", () => {
    // Simulate the pre-fix aggregator: score compliance under its OLD, mismatched name.
    const scores: Record<string, number> = {};
    for (const k of Object.keys(EQUAL_WEIGHTS)) scores[k] = 1.0;
    delete scores["compliance"];
    scores["compliance_block_rate"] = 0.0; // the old emitted name
    const r = computeComposite(scores, EQUAL_WEIGHTS);
    // The mismatched name matches no weight → dropped: only 12 counted, and its 0.0
    // has ZERO effect on the composite. This is exactly the false-green the fix closes.
    expect(r.availableCount).toBe(12);
    expect(r.score).toBe(1.0);
  });
});
