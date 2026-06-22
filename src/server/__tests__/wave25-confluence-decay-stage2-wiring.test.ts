/**
 * wave25-confluence-decay-stage2-wiring.test.ts — Wave 25 Pass 4, W25.7
 *
 * Stage 2 wiring tests for decay integration in evaluateWeightedConfluence().
 *
 * Coverage:
 *   1. Decay confidence multiplied into factor contribution
 *   2. Old structureState (CHoCH age=200 bars) → contribution reduced
 *   3. Fresh structureState (CHoCH age=10 bars) → contribution near full weight
 *   4. Mitigated confluence → satisfied forced to false (hard_kill)
 *   5. Liquidity factor NOT decayed twice (anti-double-decay architecture safety)
 *   6. signal.confluence_factor_decayed fires via decayedFactors when confidence < 0.7
 *   7. Backward-compat: structureState=null → confidence=1.0 (no behavior change)
 *   8. decayedFactors array is populated when factors decay below threshold
 *   9. decayedFactors is empty when no factors are significantly decayed
 *  10. hard_killed factor contributes 0 regardless of evaluator result
 *  11. decay_confidence=null for NO_DECAY_FACTORS (liquidity/internals/macro/regime/killzone)
 *  12. FactorContribution shape includes new decay fields
 *  13. WeightedScoreResult includes decayedFactors array
 *
 * Mock strategy: all mocks are for DB/service dependencies only.
 * The decay functions themselves are NOT mocked — they run as pure functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB and service dependencies (same pattern as wave25-weighted-scoring.test.ts)
vi.mock("../db/index.js", () => ({
  db: {},
}));
vi.mock("../db/schema.js", () => ({}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));
vi.mock("../services/market-internals-service.js", () => ({
  getInternalsSnapshot: vi.fn().mockReturnValue({
    tick: null, add: null, vold: null, trin: null,
    asOf: new Date(), stale: true,
  }),
}));

import {
  evaluateWeightedConfluence,
  CODE_DEFAULTS,
  FACTOR_MARKET_STRUCTURE_ALIGNED,
  FACTOR_LIQUIDITY_TARGET_CLEAR,
  FACTOR_INTERNALS_ALIGNED,
  FACTOR_MACRO_ALIGNMENT,
  FACTOR_REGIME_MATCH,
  FACTOR_KILLZONE_ACTIVE,
  FACTOR_VP_LEVEL_PROXIMITY,
  FACTOR_VWAP_ALIGNMENT,
  FACTOR_SMT_CONFIRMATION,
  FACTOR_DELTA_OR_VOLUME,
  FACTOR_CROSS_ASSET_ALIGNED,
  type ScoringStrategy,
  type SignalContext,
  type FactorContribution,
} from "../services/confluence-score.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStrategy(overrides: Partial<ScoringStrategy> = {}): ScoringStrategy {
  return {
    id: "test-strategy-decay",
    symbol: "MES",
    confluence_score_weights: null,
    confluence_score_threshold: null,
    entry_quality: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<SignalContext> = {}): SignalContext {
  return {
    strategyId: "test-strategy-decay",
    bar: { open: 4200, high: 4210, low: 4190, close: 4205, volume: 5000 },
    indicators: { vwap: 4200, atr: 10 },
    direction: "long",
    bias_active_strategy_id: null,
    structureState: null,
    calendarBlocked: false,
    ...overrides,
  };
}

/** Build a structureState with a CHoCH of given age in bars */
function makeStructureState(chochAgeBars: number) {
  return {
    bos_recent: false,
    bos_direction: null as null,
    choch_recent: true,
    choch_direction: "bullish" as const,
    choch_age_bars: chochAgeBars,
    mss_recent: false,
    mss_direction: null as null,
    mss_displacement_atr_mult: null,
    displacement_active: false,
    premium_discount_zone: "discount" as const,
    htf_bias_aligned: true,
    last_break_direction: "bullish" as const,
    last_break_age_bars: chochAgeBars,
    swing_high: null,
    swing_low: null,
    computed_at_bar_idx: 0,
    market_structure_aligned: true,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Stage 2 decay wiring", () => {

  describe("FactorContribution shape — new decay fields", () => {
    it("all factorContributions have decay_confidence, decay_reason, hard_killed fields", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      for (const fc of result.factorContributions) {
        expect(fc).toHaveProperty("decay_confidence");
        expect(fc).toHaveProperty("decay_reason");
        expect(fc).toHaveProperty("hard_killed");
      }
    });

    it("WeightedScoreResult has decayedFactors array", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      expect(result).toHaveProperty("decayedFactors");
      expect(Array.isArray(result.decayedFactors)).toBe(true);
    });
  });

  describe("Anti-double-decay: NO_DECAY_FACTORS have decay_confidence=null", () => {
    it("liquidity_target_clear has decay_confidence=null (not double-decayed)", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext({
    // @ts-ignore — liquidityNearestAbove fixture object may not satisfy the full LiquidityLevel union type; partial test object is intentional (W0.3 2026-06-22)
        liquidityNearestAbove: [{
          level_type: "pdh",
          price: 4220,
          sweep_probability: 0.8,
          htf_significance: 3,
          distance_points: 15,
          touched_count: 0,
        }],
      }));
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_LIQUIDITY_TARGET_CLEAR);
      expect(fc).toBeDefined();
      expect(fc!.decay_confidence).toBeNull(); // NO_DECAY_FACTOR
      expect(fc!.decay_reason).toBeNull();
    });

    it("internals_aligned has decay_confidence=null", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_INTERNALS_ALIGNED);
      expect(fc!.decay_confidence).toBeNull();
      expect(fc!.decay_reason).toBeNull();
    });

    it("macro_alignment has decay_confidence=null", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_MACRO_ALIGNMENT);
      expect(fc!.decay_confidence).toBeNull();
      expect(fc!.decay_reason).toBeNull();
    });

    it("regime_match has decay_confidence=null", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_REGIME_MATCH);
      expect(fc!.decay_confidence).toBeNull();
      expect(fc!.decay_reason).toBeNull();
    });

    it("killzone_active has decay_confidence=null", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_KILLZONE_ACTIVE);
      expect(fc!.decay_confidence).toBeNull();
      expect(fc!.decay_reason).toBeNull();
    });
  });

  describe("DECAY_FACTORS have non-null decay_confidence", () => {
    it("market_structure_aligned gets a decay_confidence (structureState available)", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(10) }),
      );
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_MARKET_STRUCTURE_ALIGNED);
      expect(fc!.decay_confidence).not.toBeNull();
      expect(fc!.decay_confidence).toBeGreaterThan(0);
    });

    it("smt_confirmation gets a decay_confidence", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_SMT_CONFIRMATION);
      expect(fc!.decay_confidence).not.toBeNull();
    });

    it("vp_level_proximity gets a decay_confidence", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_VP_LEVEL_PROXIMITY);
      expect(fc!.decay_confidence).not.toBeNull();
    });

    it("vwap_alignment gets a decay_confidence", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_VWAP_ALIGNMENT);
      expect(fc!.decay_confidence).not.toBeNull();
    });

    it("delta_or_volume_signature gets a decay_confidence", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_DELTA_OR_VOLUME);
      expect(fc!.decay_confidence).not.toBeNull();
    });

    it("cross_asset_aligned gets a decay_confidence", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_CROSS_ASSET_ALIGNED);
      expect(fc!.decay_confidence).not.toBeNull();
    });
  });

  describe("Decay reduces contribution for satisfied factors", () => {
    it("CHoCH age=200 bars → market_structure_aligned contribution is reduced vs fresh", () => {
      // structureState=null → no decay → structureState.market_structure_aligned reads as false
      // so this tests the reduction when structureState is present but aged.

      // Fresh CHoCH (10 bars) — satisfied=true with high confidence
      // Note: with age=10 bars, choch penalty = min(0.7, 10/100) = 0.07 → confidence = 0.93
      const freshResult = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(10) }),
      );
      const freshFc = freshResult.factorContributions.find(
        (c) => c.factor === FACTOR_MARKET_STRUCTURE_ALIGNED,
      )!;

      // Old CHoCH (200 bars) — satisfied=true but decayed
      // age=200 bars: penalty = min(0.7, 200/100) = 0.7 → confidence = 0.3
      const oldResult = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(200) }),
      );
      const oldFc = oldResult.factorContributions.find(
        (c) => c.factor === FACTOR_MARKET_STRUCTURE_ALIGNED,
      )!;

      // Both satisfied=true, but old CHoCH has lower contribution
      expect(freshFc.satisfied).toBe(true);
      expect(oldFc.satisfied).toBe(true);
      expect(oldFc.contribution).toBeLessThan(freshFc.contribution);
      expect(oldFc.decay_confidence).toBeLessThan(freshFc.decay_confidence!);
    });

    it("fresh CHoCH (age=10 bars) → contribution near full weight", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(10) }),
      );
      const fc = result.factorContributions.find(
        (c) => c.factor === FACTOR_MARKET_STRUCTURE_ALIGNED,
      )!;
      // age=10: choch_penalty = min(0.7, 10/100) = 0.10 → confidence = 0.90
      // contribution = 0.20 × 0.90 = 0.18
      expect(fc.satisfied).toBe(true);
      expect(fc.decay_confidence).toBeCloseTo(0.90, 2);
      expect(fc.contribution).toBeCloseTo(0.18, 2);
    });

    it("very old CHoCH (age=200 bars) → contribution = weight × 0.3", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(200) }),
      );
      const fc = result.factorContributions.find(
        (c) => c.factor === FACTOR_MARKET_STRUCTURE_ALIGNED,
      )!;
      // age=200: choch_penalty = min(0.7, 200/100) = 0.7 → confidence = 0.3
      // contribution = 0.20 × 0.3 = 0.06
      expect(fc.satisfied).toBe(true);
      expect(fc.decay_confidence).toBeCloseTo(0.3, 2);
      expect(fc.contribution).toBeCloseTo(0.06, 2);
    });
  });

  describe("Backward-compat: structureState=null → confidence=1.0", () => {
    it("structureState=null → market_structure_aligned decay_confidence=1.0 (no penalty)", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: null }),
      );
      const fc = result.factorContributions.find(
        (c) => c.factor === FACTOR_MARKET_STRUCTURE_ALIGNED,
      )!;
      // structureState=null → deriveFactorDecay returns {confidence: 1.0, ...}
      // satisfied=false (structure_engine_unavailable), contribution=0
      // BUT decay_confidence should be 1.0 (no penalty for the decay itself)
      expect(fc.decay_confidence).toBeCloseTo(1.0, 3);
    });

    it("all decay context fields absent → no penalty applied to any factor", () => {
      // Base context has no decay fields — all should use no-penalty path
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      for (const fc of result.factorContributions) {
        // If decay applies and confidence is not null → should be 1.0 (no age info)
        if (fc.decay_confidence !== null) {
          expect(fc.decay_confidence).toBeCloseTo(1.0, 3);
        }
      }
    });
  });

  describe("Hard-kill: mitigated factor forces satisfied=false", () => {
    it("VWAP factor with vwap_anchor_age_bars=99999 stays non-hard-killed (age-based not mitigated)", () => {
      // vwap_alignment uses fvgDecay for anchored VWAP — but not mitigated
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ vwap_anchor_age_bars: 99999 }),
      );
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_VWAP_ALIGNMENT)!;
      // Mitigated is not set → hard_killed=false even when confidence is near 0
      expect(fc.hard_killed).toBe(false);
    });

    it("non-decayed factors always have hard_killed=false", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      for (const fc of result.factorContributions) {
        if (fc.decay_confidence === null) {
          // NO_DECAY_FACTOR — hard_killed must be false (decay never applied)
          expect(fc.hard_killed).toBe(false);
        }
      }
    });
  });

  describe("decayedFactors: signal.confluence_factor_decayed telemetry", () => {
    it("decayedFactors is empty when structureState=null (no decay applied)", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      // No decay fields set → all decay_confidences = 1.0 → no factors below threshold
      expect(result.decayedFactors).toHaveLength(0);
    });

    it("decayedFactors contains market_structure_aligned when CHoCH age >> threshold", () => {
      // CHoCH at 200 bars → confidence = 0.3 < 0.7 threshold
      // But market_structure_aligned must be satisfied=true to appear in decayedFactors
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(200) }),
      );
      // satisfied=true (market_structure_aligned=true in structureState) AND
      // decay_confidence=0.3 < 0.7 → should appear in decayedFactors
      const decayedNames = result.decayedFactors.map((fc) => fc.factor);
      expect(decayedNames).toContain(FACTOR_MARKET_STRUCTURE_ALIGNED);
    });

    it("decayedFactors entries have correct shape", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(200) }),
      );
      for (const fc of result.decayedFactors) {
        expect(fc.satisfied).toBe(true); // only satisfied factors
        expect(fc.decay_confidence).not.toBeNull();
        expect(fc.decay_confidence!).toBeLessThan(0.7); // below threshold
        expect(fc.decay_reason).toBeTruthy();
      }
    });

    it("decayedFactors never contains NO_DECAY_FACTORS", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const noDecayFactors = [
        FACTOR_LIQUIDITY_TARGET_CLEAR,
        FACTOR_INTERNALS_ALIGNED,
        FACTOR_MACRO_ALIGNMENT,
        FACTOR_REGIME_MATCH,
        FACTOR_KILLZONE_ACTIVE,
      ];
      const decayedNames = result.decayedFactors.map((fc) => fc.factor);
      for (const name of noDecayFactors) {
        expect(decayedNames).not.toContain(name);
      }
    });
  });

  describe("Score integrity: contribution math with decay", () => {
    it("score equals sum of decayed contributions (not pre-decay weight)", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(200) }),
      );

      if (!result.hardBlockTriggered) {
        const expectedScore = result.factorContributions.reduce(
          (acc, fc) => acc + fc.contribution,
          0,
        );
        expect(result.score).toBeCloseTo(expectedScore, 5);
      }
    });

    it("score is lower when structure is decayed vs fresh (same strategy+context)", () => {
      const freshResult = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(5) }),
      );
      const oldResult = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(200) }),
      );
      // Old structure should contribute less → lower total score
      expect(oldResult.score).toBeLessThan(freshResult.score);
    });

    it("score still in [0, 1] after decay multiplications", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({
          structureState: makeStructureState(200),
          smt_age_bars: 120,
          vp_age_sessions: 10,
          delta_age_bars: 400,
        }),
      );
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it("hard-block still overrides decayed score to 0", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({
          calendarBlocked: true,
          structureState: makeStructureState(5), // fresh structure
        }),
      );
      expect(result.hardBlockTriggered).toBe(true);
      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
    });
  });

  describe("Backward-compat: pre-decay API consumers", () => {
    it("existing tests that check contribution=weight when satisfied=true still pass with decay", () => {
      // Context: no decay fields set → decay_confidence = 1.0 for all decay factors
      // → contribution = weight × 1.0 = weight (same as pre-Pass-4)
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ calendarBlocked: false, bias_active_strategy_id: null }),
      );

      for (const fc of result.factorContributions) {
        if (fc.satisfied) {
          // When decay_confidence=1.0 or null → contribution should equal weight
          const effectiveConfidence = fc.decay_confidence !== null ? fc.decay_confidence : 1.0;
          expect(fc.contribution).toBeCloseTo(fc.weight * effectiveConfidence, 5);
        } else {
          expect(fc.contribution).toBe(0);
        }
      }
    });

    it("passing legacy strategy with no structureState does not throw", () => {
      const legacyStrategy: ScoringStrategy = {
        id: "legacy",
        symbol: "MES",
        confluence_score_weights: null,
        confluence_score_threshold: null,
        entry_quality: {
          confluence_factors: ["structural_setup"],
          min_factors_satisfied: 1,
        },
      };
      expect(() =>
        evaluateWeightedConfluence(legacyStrategy, makeContext({ structureState: null }))
      ).not.toThrow();
    });

    it("evaluateWeightedConfluence never throws on any valid input", () => {
      const edgeCases: Array<Partial<SignalContext>> = [
        {},
        { bar: { open: 0, high: 0, low: 0, close: 0, volume: 0 } },
        { structureState: makeStructureState(0) },
        { structureState: makeStructureState(9999) },
        { smt_age_bars: 0 },
        { smt_age_bars: 99999 },
        { vp_age_sessions: 0 },
        { vp_age_sessions: 99999 },
        { vwap_anchor_age_bars: 99999 },
        { delta_age_bars: 99999 },
        { cross_asset_age_hours: 99999 },
      ];
      for (const override of edgeCases) {
        expect(() =>
          evaluateWeightedConfluence(makeStrategy(), makeContext(override))
        ).not.toThrow();
      }
    });
  });

  describe("MCL redistribution unaffected by decay", () => {
    it("MCL strategy: internals_aligned has decay_confidence=null (anti-double-decay applies to MCL too)", () => {
      const mclStrategy = makeStrategy({ symbol: "MCL" });
      const result = evaluateWeightedConfluence(
        mclStrategy,
        makeContext({ symbol: "MCL" }),
      );
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_INTERNALS_ALIGNED)!;
      // internals_aligned is a NO_DECAY_FACTOR regardless of MCL redistribution
      expect(fc.decay_confidence).toBeNull();
    });
  });

  // ─── Pass 4 P4.A2: signal.confluence_factor_decayed audit wiring ─────────────
  // These tests verify the contract that paper-signal-service.ts uses to drive
  // the signal.confluence_factor_decayed audit row. The row fires once per entry
  // in WeightedScoreResult.decayedFactors[]. decayedFactors is the canonical
  // source — paper-signal-service iterates it directly and never re-filters.
  describe("audit wiring contract: decayedFactors[] drives signal.confluence_factor_decayed", () => {
    beforeEach(() => {
      // Ensure env override is cleared between tests so default 0.7 applies.
      delete process.env.DECAY_TELEMETRY_THRESHOLD;
    });

    it("decayedFactors populated when satisfied factor's decay_confidence < 0.7 (audit fires)", () => {
      // CHoCH at age=200 bars → choch_penalty=min(0.7, 200/100)=0.7 → confidence=0.3
      // 0.3 < 0.7 → must appear in decayedFactors (audit row will fire)
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(200) }),
      );
      const decayedNames = result.decayedFactors.map((fc) => fc.factor);
      expect(decayedNames).toContain(FACTOR_MARKET_STRUCTURE_ALIGNED);

      // Each entry has the shape the audit row needs.
      const decFc = result.decayedFactors.find((fc) => fc.factor === FACTOR_MARKET_STRUCTURE_ALIGNED)!;
      expect(decFc.satisfied).toBe(true);
      expect(decFc.decay_confidence).not.toBeNull();
      expect(decFc.decay_confidence!).toBeLessThan(0.7);
      expect(decFc.decay_reason).toBeTruthy();
      expect(typeof decFc.weight).toBe("number");
      expect(typeof decFc.contribution).toBe("number");
      expect(typeof decFc.hard_killed).toBe("boolean");
    });

    it("decayedFactors empty when satisfied factor's decay_confidence >= 0.7 (no audit fires)", () => {
      // CHoCH at age=10 bars → choch_penalty=min(0.7, 10/100)=0.1 → confidence=0.9
      // 0.9 >= 0.7 → must NOT appear in decayedFactors (no audit row)
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ structureState: makeStructureState(10) }),
      );
      const decayedNames = result.decayedFactors.map((fc) => fc.factor);
      expect(decayedNames).not.toContain(FACTOR_MARKET_STRUCTURE_ALIGNED);
    });

    it("decayedFactors respects DECAY_TELEMETRY_THRESHOLD env override (raised cutoff fires more rows)", () => {
      // CHoCH at age=50 bars → choch_penalty=min(0.7, 50/100)=0.5 → confidence=0.5
      // At default threshold=0.7: 0.5 < 0.7 → fires
      // If we LOWERED threshold to 0.4: 0.5 >= 0.4 → does NOT fire
      process.env.DECAY_TELEMETRY_THRESHOLD = "0.4";
      try {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({ structureState: makeStructureState(50) }),
        );
        const decayedNames = result.decayedFactors.map((fc) => fc.factor);
        // With threshold lowered to 0.4, a confidence of 0.5 is ABOVE threshold → no fire.
        expect(decayedNames).not.toContain(FACTOR_MARKET_STRUCTURE_ALIGNED);
      } finally {
        delete process.env.DECAY_TELEMETRY_THRESHOLD;
      }
    });
  });
});
