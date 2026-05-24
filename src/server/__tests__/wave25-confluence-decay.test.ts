/**
 * wave25-confluence-decay.test.ts — Wave 25 Pass 4, W25.7
 *
 * Pure function tests for confluence-decay.ts.
 *
 * Coverage:
 *   1. fvgDecay — age decay, touch decay, mitigated hard-kill
 *   2. obDecay — age decay, touch decay, mitigated hard-kill
 *   3. chochDecay — age decay, no touch concept
 *   4. mssDecay — more aggressive than choch
 *   5. smtDecay — shortest half-life
 *   6. vpLevelDecay — session-based age, touch decay
 *   7. genericDecay — fallback, age + hours conversion
 *   8. deriveFactorDecay — null for NO_DECAY_FACTORS, valid for decay factors
 *   9. Backward-compat: ageBars=undefined → confidence=1.0 (no penalty)
 *  10. Hard-kill propagation: mitigated=true → confidence=0, hard_killed=true
 *  11. Half-life arithmetic: at half-life bars → ~0.5 age penalty applied
 *  12. Floor enforcement: way past half-life → clamped to 0, never negative
 *
 * All tests are PURE — no I/O, no Date.now(), no mocks needed.
 */

import { describe, it, expect } from "vitest";
import {
  fvgDecay,
  obDecay,
  chochDecay,
  mssDecay,
  smtDecay,
  vpLevelDecay,
  genericDecay,
  deriveFactorDecay,
  DECAY_TELEMETRY_THRESHOLD_DEFAULT,
} from "../lib/confluence-decay.js";

// ─── fvgDecay ─────────────────────────────────────────────────────────────────

describe("fvgDecay", () => {
  describe("age=0, touched=0 → confidence=1.0", () => {
    it("fresh FVG has full confidence", () => {
      const result = fvgDecay({ ageBars: 0, touchedCount: 0 });
      expect(result.confidence).toBeCloseTo(1.0, 3);
      expect(result.hard_killed).toBe(false);
    });
  });

  describe("age decay — half-life ~200 bars", () => {
    it("at 200 bars → age penalty = 0.5 (no touches)", () => {
      const result = fvgDecay({ ageBars: 200, touchedCount: 0 });
      // age_penalty = min(0.5, 200/200) = 0.5; confidence = 1 - 0.5 = 0.5
      expect(result.confidence).toBeCloseTo(0.5, 3);
    });

    it("at 100 bars → age penalty = 0.5 (100/200 hits the 0.5 cap)", () => {
      const result = fvgDecay({ ageBars: 100, touchedCount: 0 });
      // age_penalty = min(0.5, 100/200) = min(0.5, 0.5) = 0.5; confidence = 0.5
      expect(result.confidence).toBeCloseTo(0.5, 3);
    });

    it("at 50 bars → age penalty = 0.25 (quarter of half-life cap)", () => {
      const result = fvgDecay({ ageBars: 50, touchedCount: 0 });
      // age_penalty = min(0.5, 50/200) = min(0.5, 0.25) = 0.25; confidence = 0.75
      expect(result.confidence).toBeCloseTo(0.75, 3);
    });

    it("age penalty is capped at 0.5 (400 bars, beyond half-life)", () => {
      const result = fvgDecay({ ageBars: 400, touchedCount: 0 });
      // age_penalty = min(0.5, 400/200) = min(0.5, 2.0) = 0.5; confidence = 0.5
      expect(result.confidence).toBeCloseTo(0.5, 3);
    });
  });

  describe("touch decay — -0.25 per touch", () => {
    it("1 touch → -0.25 touch penalty (age=0)", () => {
      const result = fvgDecay({ ageBars: 0, touchedCount: 1 });
      expect(result.confidence).toBeCloseTo(0.75, 3);
    });

    it("2 touches → -0.5 touch penalty (age=0)", () => {
      const result = fvgDecay({ ageBars: 0, touchedCount: 2 });
      expect(result.confidence).toBeCloseTo(0.5, 3);
    });

    it("4 touches → confidence <= 0 → clamped to 0", () => {
      // 4 × 0.25 = 1.0 penalty → 0 (or below → clamped to 0)
      const result = fvgDecay({ ageBars: 0, touchedCount: 4 });
      expect(result.confidence).toBe(0);
      expect(result.hard_killed).toBe(false); // clamp-to-0, not mitigated
    });

    it("touches + age compound correctly", () => {
      // 1 touch (0.25) + 50 bars (0.25 age penalty) = 0.5 total; confidence = 0.5
      const result = fvgDecay({ ageBars: 50, touchedCount: 1 });
      expect(result.confidence).toBeCloseTo(0.5, 3);
    });
  });

  describe("mitigated=true → hard_killed", () => {
    it("mitigated FVG → confidence=0, hard_killed=true", () => {
      const result = fvgDecay({ ageBars: 0, touchedCount: 0, mitigated: true });
      expect(result.confidence).toBe(0);
      expect(result.hard_killed).toBe(true);
    });

    it("mitigated=true overrides age and touch (even if age=0, touched=0)", () => {
      const result = fvgDecay({ ageBars: 5, touchedCount: 1, mitigated: true });
      expect(result.confidence).toBe(0);
      expect(result.hard_killed).toBe(true);
    });
  });

  describe("backward-compat: ageBars=undefined → no penalty", () => {
    it("ageBars=undefined → no age penalty applied", () => {
      const result = fvgDecay({ touchedCount: 0 });
      expect(result.confidence).toBeCloseTo(1.0, 3);
      expect(result.hard_killed).toBe(false);
    });

    it("empty input → confidence=1.0", () => {
      const result = fvgDecay({});
      expect(result.confidence).toBeCloseTo(1.0, 3);
    });
  });

  describe("reason string", () => {
    it("includes age_bars and touch info", () => {
      const result = fvgDecay({ ageBars: 100, touchedCount: 2 });
      expect(result.reason).toContain("age_bars=100");
      expect(result.reason).toContain("touched=2");
      expect(result.reason).toContain("confidence=");
    });
  });
});

// ─── obDecay ─────────────────────────────────────────────────────────────────

describe("obDecay", () => {
  it("age=0, touched=0 → confidence=1.0", () => {
    const result = obDecay({ ageBars: 0, touchedCount: 0 });
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });

  it("at 150 bars (half-life) → age penalty = 0.6 (max)", () => {
    // min(0.6, 150/150) = 0.6; confidence = 1 - 0.6 = 0.4
    const result = obDecay({ ageBars: 150, touchedCount: 0 });
    expect(result.confidence).toBeCloseTo(0.4, 3);
  });

  it("at 75 bars → age penalty = 0.3 (min(0.6, 75/150) = 0.3)", () => {
    // min(0.6, 75/150) = min(0.6, 0.5) = 0.5; confidence = 0.5
    const result = obDecay({ ageBars: 75, touchedCount: 0 });
    expect(result.confidence).toBeCloseTo(0.5, 3);
  });

  it("at 50 bars → age penalty = 0.333 (50/150)", () => {
    // min(0.6, 50/150) = 0.333; confidence = 0.667
    const result = obDecay({ ageBars: 50, touchedCount: 0 });
    expect(result.confidence).toBeCloseTo(0.667, 2);
  });

  it("1 touch → -0.3 penalty (age=0)", () => {
    const result = obDecay({ ageBars: 0, touchedCount: 1 });
    expect(result.confidence).toBeCloseTo(0.7, 3);
  });

  it("2 touches → -0.6 touch penalty (age=0) → confidence = 0.4", () => {
    const result = obDecay({ ageBars: 0, touchedCount: 2 });
    expect(result.confidence).toBeCloseTo(0.4, 3);
  });

  it("2 touches + 75 bars compounds correctly", () => {
    // 2×0.3 (touch) + min(0.6, 75/150) (age) = 0.6 + 0.5 = 1.1 → clamped to 0
    const result = obDecay({ ageBars: 75, touchedCount: 2 });
    expect(result.confidence).toBe(0);
  });

  it("mitigated → confidence=0, hard_killed=true", () => {
    const result = obDecay({ ageBars: 10, touchedCount: 0, mitigated: true });
    expect(result.confidence).toBe(0);
    expect(result.hard_killed).toBe(true);
  });

  it("ageBars=undefined → no age penalty", () => {
    const result = obDecay({ touchedCount: 0 });
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });

  it("OB has shorter half-life than FVG (same age → OB more decayed)", () => {
    // At 100 bars: OB age_penalty = min(0.6, 100/150) = 0.667 → capped at 0.6
    // FVG age_penalty = min(0.5, 100/200) = 0.25
    // OB confidence < FVG confidence at same age
    const obResult = obDecay({ ageBars: 100, touchedCount: 0 });
    const fvgResult = fvgDecay({ ageBars: 100, touchedCount: 0 });
    expect(obResult.confidence).toBeLessThan(fvgResult.confidence);
  });
});

// ─── chochDecay ───────────────────────────────────────────────────────────────

describe("chochDecay", () => {
  it("age=0 → confidence=1.0", () => {
    const result = chochDecay({ ageBars: 0 });
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });

  it("at 100 bars (half-life) → age penalty = 0.7 (max)", () => {
    // min(0.7, 100/100) = 0.7; confidence = 0.3
    const result = chochDecay({ ageBars: 100 });
    expect(result.confidence).toBeCloseTo(0.3, 3);
  });

  it("at 50 bars → age penalty = 0.35 → confidence = 0.65... wait: min(0.7, 50/100)=0.5", () => {
    // min(0.7, 50/100) = min(0.7, 0.5) = 0.5; confidence = 0.5
    const result = chochDecay({ ageBars: 50 });
    expect(result.confidence).toBeCloseTo(0.5, 3);
  });

  it("at 200 bars → age penalty capped at 0.7", () => {
    const result = chochDecay({ ageBars: 200 });
    expect(result.confidence).toBeCloseTo(0.3, 3); // same as at 100 bars
  });

  it("hard_killed is always false (no mitigated concept)", () => {
    const result = chochDecay({ ageBars: 500 });
    expect(result.hard_killed).toBe(false);
  });

  it("ageBars=undefined → confidence=1.0 (backward-compat)", () => {
    const result = chochDecay({});
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });
});

// ─── mssDecay ────────────────────────────────────────────────────────────────

describe("mssDecay", () => {
  it("age=0 → confidence=1.0", () => {
    const result = mssDecay({ ageBars: 0 });
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });

  it("at 80 bars (half-life) → age penalty = 0.7 (max)", () => {
    // min(0.7, 80/80) = 0.7; confidence = 0.3
    const result = mssDecay({ ageBars: 80 });
    expect(result.confidence).toBeCloseTo(0.3, 3);
  });

  it("at 40 bars → age penalty = 0.5 (min(0.7, 40/80)=0.5)", () => {
    // min(0.7, 40/80) = min(0.7, 0.5) = 0.5; confidence = 0.5
    const result = mssDecay({ ageBars: 40 });
    expect(result.confidence).toBeCloseTo(0.5, 3);
  });

  it("MSS decays faster than CHoCH (same age → MSS more decayed)", () => {
    // At 60 bars: MSS = min(0.7, 60/80) = 0.525 penalty → confidence = 0.475
    // CHoCH = min(0.7, 60/100) = 0.42 penalty → confidence = 0.58
    const mssResult = mssDecay({ ageBars: 60 });
    const chochResult = chochDecay({ ageBars: 60 });
    expect(mssResult.confidence).toBeLessThan(chochResult.confidence);
  });

  it("ageBars=undefined → no penalty (backward-compat)", () => {
    const result = mssDecay({});
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });
});

// ─── smtDecay ────────────────────────────────────────────────────────────────

describe("smtDecay", () => {
  it("age=0 → confidence=1.0", () => {
    const result = smtDecay({ ageBars: 0 });
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });

  it("at 60 bars (half-life) → age penalty = 0.8 (max)", () => {
    // min(0.8, 60/60) = 0.8; confidence = 0.2
    const result = smtDecay({ ageBars: 60 });
    expect(result.confidence).toBeCloseTo(0.2, 3);
  });

  it("at 30 bars → age penalty = 0.5 (min(0.8, 30/60)=0.5)", () => {
    // min(0.8, 30/60) = min(0.8, 0.5) = 0.5; confidence = 0.5
    const result = smtDecay({ ageBars: 30 });
    expect(result.confidence).toBeCloseTo(0.5, 3);
  });

  it("SMT decays faster than MSS (same age → SMT more decayed)", () => {
    const smtResult = smtDecay({ ageBars: 50 });
    const mssResult = mssDecay({ ageBars: 50 });
    expect(smtResult.confidence).toBeLessThan(mssResult.confidence);
  });

  it("confidence never goes below 0 (floor enforcement)", () => {
    const result = smtDecay({ ageBars: 10000 });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    // clamped at 1 - 0.8 = 0.2 (max penalty cap) — use toBeCloseTo for float safety
    expect(result.confidence).toBeCloseTo(0.2, 5);
  });

  it("ageBars=undefined → confidence=1.0", () => {
    const result = smtDecay({});
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });
});

// ─── vpLevelDecay ─────────────────────────────────────────────────────────────

describe("vpLevelDecay", () => {
  it("age=0 sessions, 0 touches → confidence=1.0", () => {
    const result = vpLevelDecay({ ageSessions: 0, touchedCount: 0 });
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });

  it("at 5 sessions (half-life) → age penalty = 0.7 (max)", () => {
    // min(0.7, 5/5) = 0.7; confidence = 0.3
    const result = vpLevelDecay({ ageSessions: 5, touchedCount: 0 });
    expect(result.confidence).toBeCloseTo(0.3, 3);
  });

  it("1 touch → -0.2 penalty (age=0 sessions)", () => {
    const result = vpLevelDecay({ ageSessions: 0, touchedCount: 1 });
    expect(result.confidence).toBeCloseTo(0.8, 3);
  });

  it("3 touches → -0.6 touch penalty (age=0 sessions)", () => {
    const result = vpLevelDecay({ ageSessions: 0, touchedCount: 3 });
    expect(result.confidence).toBeCloseTo(0.4, 3);
  });

  it("5 touches → confidence <= 0 → clamped to 0", () => {
    // 5 × 0.2 = 1.0 → confidence = 0
    const result = vpLevelDecay({ ageSessions: 0, touchedCount: 5 });
    expect(result.confidence).toBe(0);
  });

  it("age + touches compound", () => {
    // 2 sessions: min(0.7, 2/5) = min(0.7, 0.4) = 0.4 + 1 touch 0.2 = 0.6; confidence = 0.4
    const result = vpLevelDecay({ ageSessions: 2, touchedCount: 1 });
    expect(result.confidence).toBeCloseTo(0.4, 3);
  });

  it("ageSessions=undefined → no age penalty", () => {
    const result = vpLevelDecay({ touchedCount: 0 });
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });

  it("empty input → confidence=1.0", () => {
    const result = vpLevelDecay({});
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });

  it("hard_killed is always false (no mitigated concept)", () => {
    const result = vpLevelDecay({ ageSessions: 100, touchedCount: 100 });
    expect(result.hard_killed).toBe(false);
  });
});

// ─── genericDecay ─────────────────────────────────────────────────────────────

describe("genericDecay", () => {
  it("ageBars=0 → confidence=1.0", () => {
    const result = genericDecay({ ageBars: 0 });
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });

  it("at 200 bars (half-life) → age penalty = 0.5 (max)", () => {
    const result = genericDecay({ ageBars: 200 });
    expect(result.confidence).toBeCloseTo(0.5, 3);
  });

  it("ageHours converts to approximate bars (12 bars/hour)", () => {
    // 17 hours × 12 bars/hour ≈ 204 bars → penalty ≈ min(0.5, 204/200) = 0.5
    const result = genericDecay({ ageHours: 17 });
    expect(result.confidence).toBeCloseTo(0.5, 1); // loose tolerance for conversion
  });

  it("mitigated=true → hard_killed", () => {
    const result = genericDecay({ ageBars: 0, mitigated: true });
    expect(result.confidence).toBe(0);
    expect(result.hard_killed).toBe(true);
  });

  it("empty input → confidence=1.0", () => {
    const result = genericDecay({});
    expect(result.confidence).toBeCloseTo(1.0, 3);
  });

  it("confidence never goes negative (floor = 0)", () => {
    const result = genericDecay({ ageBars: 99999 });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });
});

// ─── deriveFactorDecay ────────────────────────────────────────────────────────

describe("deriveFactorDecay", () => {
  const emptyCtx = { signalContext: {} };

  describe("NO_DECAY_FACTORS — returns null (anti-double-decay guard)", () => {
    it("liquidity_target_clear → null (decayed in liquidity-map-service)", () => {
      expect(deriveFactorDecay("liquidity_target_clear", emptyCtx)).toBeNull();
    });

    it("internals_aligned → null (stale-gated in market-internals-service)", () => {
      expect(deriveFactorDecay("internals_aligned", emptyCtx)).toBeNull();
    });

    it("macro_alignment → null (hard-block binary, no decay concept)", () => {
      expect(deriveFactorDecay("macro_alignment", emptyCtx)).toBeNull();
    });

    it("regime_match → null (binary state)", () => {
      expect(deriveFactorDecay("regime_match", emptyCtx)).toBeNull();
    });

    it("killzone_active → null (binary time window)", () => {
      expect(deriveFactorDecay("killzone_active", emptyCtx)).toBeNull();
    });
  });

  describe("DECAY_FACTORS — returns valid DecayResult", () => {
    it("market_structure_aligned → returns DecayResult (structureState=null → confidence=1.0)", () => {
      const result = deriveFactorDecay("market_structure_aligned", {
        structureState: null,
        signalContext: {},
      });
      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(1.0);
      expect(result!.hard_killed).toBe(false);
    });

    it("market_structure_aligned with choch_recent and age → decays", () => {
      const result = deriveFactorDecay("market_structure_aligned", {
        structureState: {
          choch_recent: true,
          choch_age_bars: 100, // at half-life → 0.7 penalty → confidence = 0.3
        },
        signalContext: {},
      });
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(0.3, 3);
    });

    it("market_structure_aligned with mss_recent and age → decays via mssDecay", () => {
      const result = deriveFactorDecay("market_structure_aligned", {
        structureState: {
          choch_recent: false,
          mss_recent: true,
          mss_age_bars: 80, // MSS at half-life → penalty 0.7 → confidence = 0.3
        },
        signalContext: {},
      });
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(0.3, 3);
    });

    it("market_structure_aligned uses last_break_age_bars when no specific age available", () => {
      const result = deriveFactorDecay("market_structure_aligned", {
        structureState: {
          choch_recent: false,
          mss_recent: false,
          bos_recent: false,
          last_break_age_bars: 50, // chochDecay: min(0.7, 50/100) = 0.5 penalty → 0.5
        },
        signalContext: {},
      });
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(0.5, 3);
    });

    it("smt_confirmation → returns DecayResult", () => {
      const result = deriveFactorDecay("smt_confirmation", emptyCtx);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeGreaterThanOrEqual(0);
      expect(result!.confidence).toBeLessThanOrEqual(1);
    });

    it("smt_confirmation uses smt_age_bars from signalContext", () => {
      const result = deriveFactorDecay("smt_confirmation", {
        signalContext: { smt_age_bars: 60 }, // at SMT half-life → 0.8 penalty → 0.2
      });
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(0.2, 3);
    });

    it("vp_level_proximity → returns DecayResult", () => {
      const result = deriveFactorDecay("vp_level_proximity", emptyCtx);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeGreaterThanOrEqual(0);
    });

    it("vp_level_proximity uses vp_age_sessions and vp_touched_count", () => {
      const result = deriveFactorDecay("vp_level_proximity", {
        signalContext: { vp_age_sessions: 5, vp_touched_count: 0 },
      });
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(0.3, 3); // 5 sessions = full age penalty 0.7
    });

    it("vwap_alignment → returns DecayResult", () => {
      const result = deriveFactorDecay("vwap_alignment", emptyCtx);
      expect(result).not.toBeNull();
      // No anchor age → no penalty → 1.0
      expect(result!.confidence).toBeCloseTo(1.0, 3);
    });

    it("vwap_alignment uses vwap_anchor_age_bars when present", () => {
      const result = deriveFactorDecay("vwap_alignment", {
        signalContext: { vwap_anchor_age_bars: 200 }, // FVG half-life: 0.5 penalty → 0.5
      });
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(0.5, 3);
    });

    it("delta_or_volume_signature → returns DecayResult", () => {
      const result = deriveFactorDecay("delta_or_volume_signature", emptyCtx);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(1.0, 3); // no age → no penalty
    });

    it("cross_asset_aligned → returns DecayResult", () => {
      const result = deriveFactorDecay("cross_asset_aligned", emptyCtx);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(1.0, 3); // no age → no penalty
    });

    it("cross_asset_aligned uses cross_asset_age_hours when present", () => {
      const result = deriveFactorDecay("cross_asset_aligned", {
        signalContext: { cross_asset_age_hours: 17 }, // ~204 bars → ~0.5 generic penalty
      });
      expect(result).not.toBeNull();
      expect(result!.confidence).toBeLessThan(0.6); // significant decay
    });
  });

  describe("unknown factor name", () => {
    it("returns null for completely unknown factor", () => {
      const result = deriveFactorDecay("nonexistent_factor_xyz", emptyCtx);
      expect(result).toBeNull();
    });
  });

  describe("decay telemetry threshold constant", () => {
    it("DECAY_TELEMETRY_THRESHOLD_DEFAULT is 0.7", () => {
      expect(DECAY_TELEMETRY_THRESHOLD_DEFAULT).toBe(0.7);
    });
  });

  describe("confidence bounds", () => {
    it("confidence never exceeds 1.0 for any decay function", () => {
      const functions = [
        () => fvgDecay({ ageBars: 0 }),
        () => obDecay({ ageBars: 0 }),
        () => chochDecay({ ageBars: 0 }),
        () => mssDecay({ ageBars: 0 }),
        () => smtDecay({ ageBars: 0 }),
        () => genericDecay({ ageBars: 0 }),
      ];
      for (const fn of functions) {
        expect(fn().confidence).toBeLessThanOrEqual(1.0);
      }
    });

    it("confidence never goes below 0.0 for any decay function", () => {
      const functions = [
        () => fvgDecay({ ageBars: 99999, touchedCount: 999 }),
        () => obDecay({ ageBars: 99999, touchedCount: 999 }),
        () => chochDecay({ ageBars: 99999 }),
        () => mssDecay({ ageBars: 99999 }),
        () => smtDecay({ ageBars: 99999 }),
        () => vpLevelDecay({ ageSessions: 99999, touchedCount: 999 }),
        () => genericDecay({ ageBars: 99999 }),
      ];
      for (const fn of functions) {
        expect(fn().confidence).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
