/**
 * Fresh-scan HIGH#5 (2026-07-12) — Style C 33/33/34 scale-out off the ORIGINAL entry size.
 * Pre-fix paper cascaded 33% of a shrinking remainder → ~22/22/56 for N=9 vs the backtester's
 * 33/33/34. This pins the corrected split (cumulative rounding of the original).
 */
import { describe, it, expect } from "vitest";
import { styleCScaleOut } from "../lib/style-c-scaleout.js";

describe("fresh-scan HIGH#5 — styleCScaleOut", () => {
  it("N=9 → 3/3/3 (was 2/2/5 with the remainder cascade)", () => {
    expect(styleCScaleOut(9)).toEqual({ tp1: 3, tp2: 3, runner: 3 });
  });

  it("legs always sum to the original and the runner is ~34% (never the ~56% leftover)", () => {
    for (let n = 1; n <= 60; n++) {
      const s = styleCScaleOut(n);
      expect(s.tp1 + s.tp2 + s.runner).toBe(n); // exact conservation
      expect(s.tp1).toBeGreaterThanOrEqual(1);  // TP1 fires first, closes >= 1
      expect(s.tp2).toBeGreaterThanOrEqual(0);
      expect(s.runner).toBeGreaterThanOrEqual(0);
      if (n >= 6) {
        // runner must be near 34%, and crucially NOT the pre-fix ~56% remainder
        expect(s.runner).toBeLessThanOrEqual(Math.ceil(n * 0.40));
      }
    }
  });

  it("canonical framework sizes split cleanly", () => {
    expect(styleCScaleOut(6)).toEqual({ tp1: 2, tp2: 2, runner: 2 });   // MES/MNQ base 6-era
    expect(styleCScaleOut(3)).toEqual({ tp1: 1, tp2: 1, runner: 1 });
    expect(styleCScaleOut(18)).toEqual({ tp1: 6, tp2: 6, runner: 6 });  // MCL base
  });

  it("tiny positions degrade sanely (caller's full-close guard handles N=1)", () => {
    expect(styleCScaleOut(1)).toEqual({ tp1: 1, tp2: 0, runner: 0 });
    expect(styleCScaleOut(0)).toEqual({ tp1: 0, tp2: 0, runner: 0 });
  });
});
