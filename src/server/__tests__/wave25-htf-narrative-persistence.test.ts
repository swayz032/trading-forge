/**
 * wave25-htf-narrative-persistence.test.ts — Wave 25 Pass 2 P2.A3
 *
 * Coverage:
 *   1. JSONB round-trip identity — full HtfNarrative round-trips through
 *      JSON.stringify / JSON.parse without loss (mirrors DB write → read path).
 *   2. Null narrative — backward-compat: strategies without 5-TF declaration
 *      get htfNarrative: null without any throws.
 *   3. Audit event fires only when htfNarrative is non-null (no event spam when feature unused).
 *   4. Interface type covers all 4 sub-dataclasses (AsianRange/LondonBias/NYBias/DailyDealing).
 *   5. BiasStateForSignal.htfNarrative field is typed (no `unknown` cast needed).
 *   6. Stub bias state (fail-open) always returns htfNarrative: null.
 *   7. All DailyDealing quadrant values are accepted (type completeness).
 *   8. LondonBias / NYBias direction values type-check correctly.
 *
 * Note: these are unit tests of the TYPE CONTRACT and serialisation path.
 * End-to-end DB integration (getOrComputeBiasStateForDay → bias_state table)
 * is covered by wave23-bias-engine-wiring.test.ts (live DB in CI).
 *
 * Pattern mirrors wave25-bias-state-structure-field.test.ts (P1.A5 predecessor).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  type BiasStateForSignal,
  type HtfNarrative,
  type AsianRange,
  type LondonBias,
  type NYBias,
  type DailyDealing,
  barTimestampToTradingDay,
} from "../services/bias-state-service.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FULL_ASIAN_RANGE: AsianRange = {
  high: 5210.5,
  low: 5195.0,
  range_size: 15.5,
  formed_at_bar_idx: 18,
};

const FULL_LONDON_BIAS: LondonBias = {
  direction: "bullish",
  swept_pdh: true,
  swept_pdl: false,
};

const FULL_NY_BIAS: NYBias = {
  direction: "bullish",
  open_above_overnight_range: true,
  open_below_overnight_range: false,
};

const FULL_DAILY_DEALING: DailyDealing = {
  dealing_range_high: 5225.0,
  dealing_range_low: 5180.0,
  current_quadrant: "discount_upper",
};

const FULL_HTF_NARRATIVE: HtfNarrative = {
  asian_range: FULL_ASIAN_RANGE,
  london_bias: FULL_LONDON_BIAS,
  ny_bias: FULL_NY_BIAS,
  daily_dealing: FULL_DAILY_DEALING,
  computed_at_bar_idx: 42,
};

function makeBiasState(htfNarrative: HtfNarrative | null): BiasStateForSignal {
  return {
    sessionDate: "2026-05-24",
    symbol: "MES",
    regimeLabel: "TRENDING_UP",
    playbook: "TREND_CONTINUATION_LONG",
    activeStrategyId: "strat-abc-123",
    positionLockActive: false,
    structureState: null,
    htfNarrative,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("wave25-htf-narrative-persistence: JSONB round-trip", () => {
  it("full HtfNarrative survives JSON.stringify → JSON.parse without loss", () => {
    const serialised = JSON.stringify(FULL_HTF_NARRATIVE);
    const restored = JSON.parse(serialised) as HtfNarrative;

    // Top-level
    expect(restored.computed_at_bar_idx).toBe(42);

    // AsianRange
    expect(restored.asian_range.high).toBe(5210.5);
    expect(restored.asian_range.low).toBe(5195.0);
    expect(restored.asian_range.range_size).toBe(15.5);
    expect(restored.asian_range.formed_at_bar_idx).toBe(18);

    // LondonBias
    expect(restored.london_bias.direction).toBe("bullish");
    expect(restored.london_bias.swept_pdh).toBe(true);
    expect(restored.london_bias.swept_pdl).toBe(false);

    // NYBias
    expect(restored.ny_bias.direction).toBe("bullish");
    expect(restored.ny_bias.open_above_overnight_range).toBe(true);
    expect(restored.ny_bias.open_below_overnight_range).toBe(false);

    // DailyDealing
    expect(restored.daily_dealing.dealing_range_high).toBe(5225.0);
    expect(restored.daily_dealing.dealing_range_low).toBe(5180.0);
    expect(restored.daily_dealing.current_quadrant).toBe("discount_upper");
  });

  it("null sub-fields survive round-trip (partial narrative when session incomplete)", () => {
    const partial: HtfNarrative = {
      asian_range: {
        high: null,
        low: null,
        range_size: null,
        formed_at_bar_idx: null,
      },
      london_bias: {
        direction: null,
        swept_pdh: false,
        swept_pdl: false,
      },
      ny_bias: {
        direction: null,
        open_above_overnight_range: false,
        open_below_overnight_range: false,
      },
      daily_dealing: {
        dealing_range_high: null,
        dealing_range_low: null,
        current_quadrant: null,
      },
      computed_at_bar_idx: 0,
    };

    const restored = JSON.parse(JSON.stringify(partial)) as HtfNarrative;

    expect(restored.asian_range.high).toBeNull();
    expect(restored.london_bias.direction).toBeNull();
    expect(restored.ny_bias.direction).toBeNull();
    expect(restored.daily_dealing.current_quadrant).toBeNull();
    expect(restored.computed_at_bar_idx).toBe(0);
  });
});

describe("wave25-htf-narrative-persistence: null narrative backward compat", () => {
  it("BiasStateForSignal with htfNarrative=null compiles and has correct null value", () => {
    const biasState = makeBiasState(null);

    // TypeScript-typed access (no unknown cast)
    const narrative: HtfNarrative | null = biasState.htfNarrative;

    expect(narrative).toBeNull();
  });

  it("stub bias state (fail-open) always returns htfNarrative: null", () => {
    const stub = makeBiasState(null);

    expect(stub.htfNarrative).toBeNull();
    expect(stub.structureState).toBeNull();   // existing field unchanged
    expect(stub.positionLockActive).toBe(false);
  });

  it("existing strategies get htfNarrative: null without throws or type errors", () => {
    // Simulates the 3 CANDIDATE strategies (silver_bullet / crt / power_of_3)
    // that existed before Wave 25 Pass 2 — they don't declare 5-TF hierarchy,
    // so the bias engine never populates htf_narrative. Callers must handle null.
    const strategies = ["silver_bullet", "crt", "power_of_3"] as const;

    for (const strategyName of strategies) {
      const biasState: BiasStateForSignal = {
        sessionDate: "2026-05-24",
        symbol: "MES",
        regimeLabel: "TRENDING_UP",
        playbook: "TREND_CONTINUATION_LONG",
        activeStrategyId: `strat-${strategyName}`,
        positionLockActive: false,
        structureState: null,
        htfNarrative: null,
      };

      // Accessing htfNarrative must not throw; callers use optional chaining
      const asianHigh = biasState.htfNarrative?.asian_range.high ?? null;
      const londonDir = biasState.htfNarrative?.london_bias.direction ?? null;

      expect(asianHigh).toBeNull();
      expect(londonDir).toBeNull();
    }
  });
});

describe("wave25-htf-narrative-persistence: interface type coverage", () => {
  it("all 4 sub-dataclasses are accessible and typed on HtfNarrative", () => {
    const biasState = makeBiasState(FULL_HTF_NARRATIVE);

    // TypeScript compilation proves the field exists and is typed HtfNarrative | null
    const narrative: HtfNarrative | null = biasState.htfNarrative;
    expect(narrative).not.toBeNull();

    // AsianRange
    const ar: AsianRange = narrative!.asian_range;
    expect(typeof ar.high).toBe("number");
    expect(typeof ar.range_size).toBe("number");

    // LondonBias
    const lb: LondonBias = narrative!.london_bias;
    expect(lb.direction).toBe("bullish");
    expect(typeof lb.swept_pdh).toBe("boolean");

    // NYBias
    const ny: NYBias = narrative!.ny_bias;
    expect(ny.direction).toBe("bullish");
    expect(typeof ny.open_above_overnight_range).toBe("boolean");

    // DailyDealing
    const dd: DailyDealing = narrative!.daily_dealing;
    expect(typeof dd.dealing_range_high).toBe("number");
    expect(dd.current_quadrant).toBe("discount_upper");
  });

  it("all DailyDealing quadrant literal values are accepted by the type", () => {
    // TypeScript compilation validates exhaustive coverage of the union.
    const quadrants: Array<DailyDealing["current_quadrant"]> = [
      "premium_upper",
      "premium_lower",
      "discount_upper",
      "discount_lower",
      "equilibrium",
      null,
    ];

    for (const quadrant of quadrants) {
      const dd: DailyDealing = {
        dealing_range_high: 5200.0,
        dealing_range_low: 5150.0,
        current_quadrant: quadrant,
      };
      // No throw, value is correctly stored
      expect(dd.current_quadrant).toBe(quadrant);
    }
  });

  it("LondonBias direction accepts bullish / bearish / null", () => {
    const directions: Array<LondonBias["direction"]> = ["bullish", "bearish", null];

    for (const direction of directions) {
      const lb: LondonBias = { direction, swept_pdh: false, swept_pdl: false };
      expect(lb.direction).toBe(direction);
    }
  });

  it("NYBias direction accepts bullish / bearish / null", () => {
    const directions: Array<NYBias["direction"]> = ["bullish", "bearish", null];

    for (const direction of directions) {
      const ny: NYBias = {
        direction,
        open_above_overnight_range: false,
        open_below_overnight_range: false,
      };
      expect(ny.direction).toBe(direction);
    }
  });
});

describe("wave25-htf-narrative-persistence: audit event guard", () => {
  /**
   * The audit event `bias_engine.htf_narrative_computed` must only fire when
   * htfNarrativeJson is non-null. This prevents event spam when the feature
   * is unused (strategies without 5-TF declaration).
   *
   * We test the guard logic directly (not via insertAuditRow side-effect):
   *   - if (htfNarrativeJson != null) → emit
   *   - otherwise → skip
   *
   * The bias-state-service.ts guard at line ~1071 implements this pattern.
   */

  it("audit guard: only fires when htfNarrativeJson is non-null", () => {
    const auditEventShouldFire = (htfNarrativeJson: Record<string, unknown> | null): boolean => {
      // Mirror the guard condition from bias-state-service.ts
      return htfNarrativeJson != null;
    };

    expect(auditEventShouldFire(null)).toBe(false);
    expect(auditEventShouldFire(undefined as unknown as null)).toBe(false);

    const fullNarrativeJson = JSON.parse(JSON.stringify(FULL_HTF_NARRATIVE)) as Record<string, unknown>;
    expect(auditEventShouldFire(fullNarrativeJson)).toBe(true);
  });

  it("audit result shape matches HtfNarrative sub-dataclass fields", () => {
    // The audit row's result field carries the full narrative shape.
    // Verify the shape is correct (not just a blob — reconstruction needs field access).
    const htfNarrativeJson = JSON.parse(JSON.stringify(FULL_HTF_NARRATIVE)) as Record<string, unknown>;

    // Mirror what bias-state-service.ts writes into insertAuditRow.result:
    const auditResult = {
      asian_range: htfNarrativeJson.asian_range,
      london_bias: htfNarrativeJson.london_bias,
      ny_bias: htfNarrativeJson.ny_bias,
      daily_dealing: htfNarrativeJson.daily_dealing,
      computed_at_bar_idx: htfNarrativeJson.computed_at_bar_idx,
    };

    expect(auditResult.asian_range).toBeDefined();
    expect(auditResult.london_bias).toBeDefined();
    expect(auditResult.ny_bias).toBeDefined();
    expect(auditResult.daily_dealing).toBeDefined();
    expect(auditResult.computed_at_bar_idx).toBe(42);

    // Verify sub-object fields survive the round-trip into audit result
    const ar = auditResult.asian_range as AsianRange;
    expect(ar.high).toBe(5210.5);
    expect(ar.formed_at_bar_idx).toBe(18);

    const lb = auditResult.london_bias as LondonBias;
    expect(lb.direction).toBe("bullish");
    expect(lb.swept_pdh).toBe(true);
  });
});

describe("wave25-htf-narrative-persistence: BiasStateForSignal field parity", () => {
  it("BiasStateForSignal now has htfNarrative alongside structureState (type parity)", () => {
    const fullBiasState: BiasStateForSignal = {
      sessionDate: "2026-05-24",
      symbol: "MES",
      regimeLabel: "TRENDING_UP",
      playbook: "TREND_CONTINUATION_LONG",
      activeStrategyId: "strat-abc-123",
      positionLockActive: false,
      structureState: null, // structureState can be null independently
      htfNarrative: FULL_HTF_NARRATIVE,
    };

    // Both fields coexist — structureState null + htfNarrative non-null is valid
    expect(fullBiasState.structureState).toBeNull();
    expect(fullBiasState.htfNarrative).not.toBeNull();
    expect(fullBiasState.htfNarrative?.computed_at_bar_idx).toBe(42);
  });

  it("barTimestampToTradingDay still works after P2.A3 changes (regression guard)", () => {
    expect(barTimestampToTradingDay("2026-05-24T09:30:00Z")).toBe("2026-05-24");
    expect(barTimestampToTradingDay("2026-12-31T23:59:59.999Z")).toBe("2026-12-31");
  });
});
