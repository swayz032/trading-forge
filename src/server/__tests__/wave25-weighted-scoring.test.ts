/**
 * wave25-weighted-scoring.test.ts — Wave 25 Pass 1, W25.1
 *
 * Coverage:
 *   1. Weight override hierarchy (strategy > env > code default)
 *   2. Threshold tuning (strategy column override vs default 0.72)
 *   3. Hard-block: macro_alignment failure forces score=0 regardless of other factors
 *   4. Stub factors return satisfied=false with descriptive "pending_passX" reasons
 *   5. Backward-compat: strategies without use_weighted_scoring use Path A/B (not Path C)
 *   6. weightsSource reflects the resolved tier
 *   7. factorContributions has exactly 9 entries (all canonical factors)
 *   8. Hard-block flag propagates correctly to result.hardBlockTriggered
 *   9. Score clamped to [0,1]
 *  10. All stub factors never throw
 */

import { describe, it, expect, vi } from "vitest";

// Mock DB and audit-log-helper to avoid DATABASE_URL requirement in unit tests.
// confluence-score.ts now imports market-internals-service which imports audit-log-helper.
vi.mock("../db/index.js", () => ({
  db: {},
}));
vi.mock("../db/schema.js", () => ({}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
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
  DEFAULT_CONFLUENCE_THRESHOLD,
  FACTOR_MACRO_ALIGNMENT,
  FACTOR_MARKET_STRUCTURE_ALIGNED,
  FACTOR_VWAP_ALIGNMENT,
  FACTOR_REGIME_MATCH,
  FACTOR_LIQUIDITY_TARGET_CLEAR,
  FACTOR_SMT_CONFIRMATION,
  FACTOR_KILLZONE_ACTIVE,
  FACTOR_DELTA_OR_VOLUME,
  FACTOR_VP_LEVEL_PROXIMITY,
  type ScoringStrategy,
  type SignalContext,
} from "../services/confluence-score.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStrategy(overrides: Partial<ScoringStrategy> = {}): ScoringStrategy {
  return {
    id: "test-strategy-id",
    symbol: "MES",
    confluence_score_weights: null,
    confluence_score_threshold: null,
    entry_quality: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<SignalContext> = {}): SignalContext {
  return {
    strategyId: "test-strategy-id",
    bar: { open: 4200, high: 4210, low: 4190, close: 4205, volume: 5000 },
    indicators: {},
    direction: "long",
    bias_active_strategy_id: null,
    structureState: null,
    calendarBlocked: false,
    ...overrides,
  };
}

const ALL_FACTOR_NAMES = Object.keys(CODE_DEFAULTS);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("evaluateWeightedConfluence", () => {
  describe("result shape", () => {
    it("returns all 11 canonical factors in factorContributions", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      expect(result.factorContributions).toHaveLength(11);
      const names = result.factorContributions.map((fc) => fc.factor);
      for (const f of ALL_FACTOR_NAMES) {
        expect(names).toContain(f);
      }
    });

    it("score is in [0, 1]", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it("passed === (score >= threshold) when no hard-block triggered", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      if (!result.hardBlockTriggered) {
        expect(result.passed).toBe(result.score >= result.threshold);
      }
    });

    it("factorContributions.contribution = weight when satisfied, 0 when not", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      for (const fc of result.factorContributions) {
        if (fc.satisfied) {
          expect(fc.contribution).toBeCloseTo(fc.weight);
        } else {
          expect(fc.contribution).toBe(0);
        }
      }
    });
  });

  describe("stub factors", () => {
    it("liquidity_target_clear returns satisfied=false when levels not pre-populated (Pass 3 wired)", () => {
      // Pass 3 shipped: the stub is replaced by the real evaluator.
      // When ctx.liquidityNearestAbove/Below are not set, the evaluator returns
      // "liquidity_map_unavailable" (conservative fail-open) instead of the old
      // "pending_pass3" stub reason. This is the expected post-Pass-3 behavior.
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_LIQUIDITY_TARGET_CLEAR);
      expect(fc).toBeDefined();
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toBe("liquidity_map_unavailable");
    });

    it("smt_confirmation returns satisfied=false with pending_pass5 reason", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_SMT_CONFIRMATION);
      expect(fc).toBeDefined();
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toContain("pass5");
    });

    it("stub factors never throw", () => {
      // Call with edge-case context — should not throw
      expect(() =>
        evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({ bar: { open: 0, high: 0, low: 0, close: 0, volume: 0 } }),
        )
      ).not.toThrow();
    });

    it("killzone_active returns satisfied=false when bar.timestamp is outside all killzones", () => {
      // W25.3 is now shipped — killzone_active uses the real killzone.ts helper.
      // Pick a UTC timestamp that maps to 12:00 ET (midday) — outside all 5 killzones.
      // 12:00 ET EDT (UTC-4) = 16:00 UTC. Use a date clearly in EDT (August 2026).
      const outsideAllKillzones = new Date("2026-08-15T16:00:00.000Z"); // 12:00 ET EDT
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ timestampUTC: outsideAllKillzones }),
      );
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_KILLZONE_ACTIVE);
      expect(fc).toBeDefined();
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toBe("no_killzone_active");
    });

    it("killzone_active returns satisfied=true with zone names in reason when inside ny_am", () => {
      // 09:00 ET EDT (UTC-4) = 13:00 UTC — inside ny_am (07:00–10:00 ET)
      const insideNyAm = new Date("2026-08-15T13:00:00.000Z"); // 09:00 ET EDT
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ timestampUTC: insideNyAm }),
      );
      const fc = result.factorContributions.find((c) => c.factor === FACTOR_KILLZONE_ACTIVE);
      expect(fc).toBeDefined();
      expect(fc!.satisfied).toBe(true);
      expect(fc!.reason).toContain("ny_am");
    });
  });

  describe("hard-block: macro_alignment", () => {
    it("calendarBlocked=true forces score=0 and hardBlockTriggered=true", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ calendarBlocked: true }),
      );
      expect(result.hardBlockTriggered).toBe(true);
      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
    });

    it("hard-block overrides a score that would otherwise pass", () => {
      // Give strategy a 0-threshold so score would pass without hard-block
      const strategy = makeStrategy({ confluence_score_threshold: 0.0 });
      const result = evaluateWeightedConfluence(
        strategy,
        makeContext({ calendarBlocked: true }),
      );
      // Even with 0.0 threshold, hard-block forces pass=false
      expect(result.passed).toBe(false);
      expect(result.hardBlockTriggered).toBe(true);
      expect(result.score).toBe(0);
    });

    it("calendarBlocked=false does not trigger hard-block from macro_alignment", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy(),
        makeContext({ calendarBlocked: false }),
      );
      // macro_alignment factor should be satisfied=true
      const macroFc = result.factorContributions.find((fc) => fc.factor === FACTOR_MACRO_ALIGNMENT);
      expect(macroFc!.satisfied).toBe(true);
      expect(result.hardBlockTriggered).toBe(false);
    });

    it("macro_alignment factor is marked is_hard_block=true", () => {
      const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
      const macroFc = result.factorContributions.find((fc) => fc.factor === FACTOR_MACRO_ALIGNMENT);
      expect(macroFc!.is_hard_block).toBe(true);
    });
  });

  describe("weight override hierarchy", () => {
    it("weightsSource=code_default when no strategy or env overrides", () => {
      const origEnv = process.env.CONFLUENCE_SCORE_WEIGHTS;
      delete process.env.CONFLUENCE_SCORE_WEIGHTS;
      try {
        const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
        expect(result.weightsSource).toBe("code_default");
      } finally {
        if (origEnv !== undefined) process.env.CONFLUENCE_SCORE_WEIGHTS = origEnv;
      }
    });

    it("weightsSource=env_default when env var is set", () => {
      const origEnv = process.env.CONFLUENCE_SCORE_WEIGHTS;
      process.env.CONFLUENCE_SCORE_WEIGHTS = JSON.stringify({
        [FACTOR_VWAP_ALIGNMENT]: 0.20,
      });
      try {
        const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
        expect(result.weightsSource).toBe("env_default");
      } finally {
        if (origEnv !== undefined) {
          process.env.CONFLUENCE_SCORE_WEIGHTS = origEnv;
        } else {
          delete process.env.CONFLUENCE_SCORE_WEIGHTS;
        }
      }
    });

    it("weightsSource=strategy_override when strategy has non-empty weights", () => {
      const strategy = makeStrategy({
        confluence_score_weights: { [FACTOR_VWAP_ALIGNMENT]: 0.30 },
      });
      const result = evaluateWeightedConfluence(strategy, makeContext());
      expect(result.weightsSource).toBe("strategy_override");
    });

    it("strategy override takes priority over env override", () => {
      process.env.CONFLUENCE_SCORE_WEIGHTS = JSON.stringify({ [FACTOR_VWAP_ALIGNMENT]: 0.10 });
      const strategy = makeStrategy({
        confluence_score_weights: { [FACTOR_VWAP_ALIGNMENT]: 0.40 },
      });
      try {
        const result = evaluateWeightedConfluence(strategy, makeContext());
        expect(result.weightsSource).toBe("strategy_override");
        const vwapFc = result.factorContributions.find((fc) => fc.factor === FACTOR_VWAP_ALIGNMENT);
        // Strategy override should win: weight = 0.40 (not 0.10 from env)
        expect(vwapFc!.weight).toBeCloseTo(0.40);
      } finally {
        delete process.env.CONFLUENCE_SCORE_WEIGHTS;
      }
    });

    it("partial strategy override merges with code defaults for unspecified factors", () => {
      const strategy = makeStrategy({
        confluence_score_weights: { [FACTOR_REGIME_MATCH]: 0.20 },
      });
      const result = evaluateWeightedConfluence(strategy, makeContext());
      const regimeFc = result.factorContributions.find((fc) => fc.factor === FACTOR_REGIME_MATCH);
      expect(regimeFc!.weight).toBeCloseTo(0.20);
      // Other factors retain code defaults
      const macroFc = result.factorContributions.find((fc) => fc.factor === FACTOR_MACRO_ALIGNMENT);
      expect(macroFc!.weight).toBeCloseTo(CODE_DEFAULTS[FACTOR_MACRO_ALIGNMENT].weight);
    });

    it("malformed env JSON falls back to code_default gracefully", () => {
      process.env.CONFLUENCE_SCORE_WEIGHTS = "{not valid json}";
      try {
        const result = evaluateWeightedConfluence(makeStrategy(), makeContext());
        expect(result.weightsSource).toBe("code_default");
      } finally {
        delete process.env.CONFLUENCE_SCORE_WEIGHTS;
      }
    });
  });

  describe("threshold tuning", () => {
    it("uses DEFAULT_CONFLUENCE_THRESHOLD (0.72) when strategy column is null", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy({ confluence_score_threshold: null }),
        makeContext(),
      );
      expect(result.threshold).toBe(DEFAULT_CONFLUENCE_THRESHOLD);
    });

    it("uses strategy column value when provided", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy({ confluence_score_threshold: 0.50 }),
        makeContext(),
      );
      expect(result.threshold).toBeCloseTo(0.50);
    });

    it("low threshold (0.0) passes when no hard-block triggered", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy({ confluence_score_threshold: 0.0 }),
        makeContext({ calendarBlocked: false }),
      );
      // Score will be > 0 (macro_alignment satisfied + regime_match + vwap if applicable)
      // passed should be true with threshold=0.0 and no hard-block
      if (!result.hardBlockTriggered) {
        expect(result.passed).toBe(true);
      }
    });

    it("very high threshold (0.99) rejects except for near-perfect alignment", () => {
      const result = evaluateWeightedConfluence(
        makeStrategy({ confluence_score_threshold: 0.99 }),
        makeContext({ calendarBlocked: false }),
      );
      // With stubs for 3 factors and structureState=null, score will be well below 0.99
      expect(result.passed).toBe(false);
    });
  });

  describe("factor evaluator correctness", () => {
    describe("market_structure_aligned", () => {
      it("returns satisfied=false with reason structure_engine_unavailable when structureState is null", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({ structureState: null }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_MARKET_STRUCTURE_ALIGNED);
        expect(fc!.satisfied).toBe(false);
        expect(fc!.reason).toContain("structure_engine_unavailable");
      });

      it("returns satisfied=true when structureState.market_structure_aligned=true", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({
            structureState: {
              market_structure_aligned: true,
              bos_recent: true,
              bos_direction: "bullish",
              choch_recent: false,
              choch_direction: null,
              mss_recent: false,
              mss_direction: null,
              mss_displacement_atr_mult: null,
              displacement_active: false,
              premium_discount_zone: "discount",
              htf_bias_aligned: true,
              last_break_direction: "bullish",
              last_break_age_bars: 3,
              swing_high: null,
              swing_low: null,
              computed_at_bar_idx: 0,
            },
          }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_MARKET_STRUCTURE_ALIGNED);
        expect(fc!.satisfied).toBe(true);
      });

      it("returns satisfied=false when structureState.market_structure_aligned=false", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({
            structureState: {
              market_structure_aligned: false,
              bos_recent: false,
              bos_direction: null,
              choch_recent: false,
              choch_direction: null,
              mss_recent: false,
              mss_direction: null,
              mss_displacement_atr_mult: null,
              displacement_active: false,
              premium_discount_zone: "premium",
              htf_bias_aligned: false,
              last_break_direction: null,
              last_break_age_bars: 10,
              swing_high: null,
              swing_low: null,
              computed_at_bar_idx: 0,
            },
          }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_MARKET_STRUCTURE_ALIGNED);
        expect(fc!.satisfied).toBe(false);
      });
    });

    describe("vwap_alignment", () => {
      it("satisfied=true for long signal when close > vwap", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({
            direction: "long",
            bar: { open: 4200, high: 4210, low: 4190, close: 4205, volume: 5000 },
            indicators: { vwap: 4200 },
          }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_VWAP_ALIGNMENT);
        expect(fc!.satisfied).toBe(true);
      });

      it("satisfied=false for long signal when close < vwap", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({
            direction: "long",
            bar: { open: 4200, high: 4210, low: 4190, close: 4195, volume: 5000 },
            indicators: { vwap: 4200 },
          }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_VWAP_ALIGNMENT);
        expect(fc!.satisfied).toBe(false);
      });

      it("satisfied=true for short signal when close < vwap", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({
            direction: "short",
            bar: { open: 4200, high: 4210, low: 4190, close: 4195, volume: 5000 },
            indicators: { vwap: 4200 },
          }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_VWAP_ALIGNMENT);
        expect(fc!.satisfied).toBe(true);
      });

      it("satisfied=false when vwap indicator is absent", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({ indicators: {} }), // no vwap key
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_VWAP_ALIGNMENT);
        expect(fc!.satisfied).toBe(false);
        expect(fc!.reason).toContain("absent");
      });
    });

    describe("regime_match", () => {
      it("satisfied=true when bias_active_strategy_id=null (no preference)", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({ bias_active_strategy_id: null }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_REGIME_MATCH);
        expect(fc!.satisfied).toBe(true);
        expect(fc!.reason).toContain("no_preference");
      });

      it("satisfied=true when bias_active_strategy_id matches strategy.id", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy({ id: "my-strategy" }),
          makeContext({ bias_active_strategy_id: "my-strategy" }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_REGIME_MATCH);
        expect(fc!.satisfied).toBe(true);
      });

      it("satisfied=false when bias_active_strategy_id is different strategy", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy({ id: "my-strategy" }),
          makeContext({ bias_active_strategy_id: "other-strategy" }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_REGIME_MATCH);
        expect(fc!.satisfied).toBe(false);
        expect(fc!.reason).toContain("mismatch");
      });
    });

    describe("delta_or_volume_signature", () => {
      it("satisfied=true when volume > rolling_mean × 1.2", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({
            bar: { open: 4200, high: 4210, low: 4190, close: 4205, volume: 1500 },
            indicators: { volume_rolling_mean_20: 1000 }, // 1500 > 1000×1.2 = 1200 ✓
          }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_DELTA_OR_VOLUME);
        expect(fc!.satisfied).toBe(true);
      });

      it("satisfied=false when volume <= rolling_mean × 1.2", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({
            bar: { open: 4200, high: 4210, low: 4190, close: 4205, volume: 1000 },
            indicators: { volume_rolling_mean_20: 1000 }, // 1000 == 1000×1.0, not > 1200
          }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_DELTA_OR_VOLUME);
        expect(fc!.satisfied).toBe(false);
      });

      it("satisfied=false when rolling_mean not available", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({
            bar: { open: 4200, high: 4210, low: 4190, close: 4205, volume: 5000 },
            indicators: {}, // no rolling mean
          }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_DELTA_OR_VOLUME);
        expect(fc!.satisfied).toBe(false);
      });
    });

    describe("vp_level_proximity", () => {
      it("satisfied=true when close within 1×ATR of vp_poc", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({
            bar: { open: 4200, high: 4210, low: 4190, close: 4205, volume: 5000 },
            // ATR=10, vp_poc=4200, distance=5, 5 <= 10*1.0 = 10 ✓
            indicators: { atr: 10, vp_poc: 4200 },
          }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_VP_LEVEL_PROXIMITY);
        expect(fc!.satisfied).toBe(true);
      });

      it("satisfied=false when close more than 1×ATR from all VP levels", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({
            bar: { open: 4200, high: 4210, low: 4190, close: 4250, volume: 5000 },
            // ATR=5, vp_poc=4200, distance=50, 50 > 5*1.0 = 5 ✗
            indicators: { atr: 5, vp_poc: 4200 },
          }),
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_VP_LEVEL_PROXIMITY);
        expect(fc!.satisfied).toBe(false);
      });

      it("satisfied=false when VP indicators absent", () => {
        const result = evaluateWeightedConfluence(
          makeStrategy(),
          makeContext({ indicators: { atr: 10 } }), // no vp keys
        );
        const fc = result.factorContributions.find((c) => c.factor === FACTOR_VP_LEVEL_PROXIMITY);
        expect(fc!.satisfied).toBe(false);
        expect(fc!.reason).toContain("absent");
      });
    });
  });

  describe("backward-compat: Path A/B strategies unaffected", () => {
    // The confluence-score module itself is side-effect-free (pure function).
    // Backward compat is enforced in paper-signal-service.ts:
    //   use_weighted_scoring flag gate MUST be checked before Path C is taken.
    // This test verifies the module correctly evaluates a "no weighted scoring" context
    // in isolation — the dispatcher guard in paper-signal-service.ts is the actual gate.

    it("evaluateWeightedConfluence called with a legacy strategy shape returns valid result (no throw)", () => {
      // Simulate what happens if it were called on a legacy strategy (should not be,
      // but must not throw if it is).
      const legacyStrategy: ScoringStrategy = {
        id: "legacy-strategy",
        symbol: "MES",
        confluence_score_weights: null,
        confluence_score_threshold: null,
        entry_quality: {
          confluence_factors: ["structural_setup", "volume_confirmation"],
          min_factors_satisfied: 1,
          extraction_provenance: "youtube",
        },
      };
      expect(() =>
        evaluateWeightedConfluence(legacyStrategy, makeContext())
      ).not.toThrow();
    });
  });

  describe("CODE_DEFAULTS validation", () => {
    it("all 11 canonical factors are present in CODE_DEFAULTS", () => {
      const expectedFactors = [
        FACTOR_MARKET_STRUCTURE_ALIGNED,
        FACTOR_LIQUIDITY_TARGET_CLEAR,
        FACTOR_SMT_CONFIRMATION,
        FACTOR_VWAP_ALIGNMENT,
        FACTOR_KILLZONE_ACTIVE,
        FACTOR_DELTA_OR_VOLUME,
        FACTOR_VP_LEVEL_PROXIMITY,
        FACTOR_MACRO_ALIGNMENT,
        FACTOR_REGIME_MATCH,
        // W25.5c additions
        "internals_aligned",
        "cross_asset_aligned",
      ];
      for (const f of expectedFactors) {
        expect(CODE_DEFAULTS).toHaveProperty(f);
      }
    });

    it("code default weights sum to 1.00 (within floating point tolerance)", () => {
      const sum = Object.values(CODE_DEFAULTS).reduce((acc, cfg) => acc + cfg.weight, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it("only macro_alignment has isHardBlock=true", () => {
      const hardBlocks = Object.entries(CODE_DEFAULTS)
        .filter(([, cfg]) => cfg.isHardBlock)
        .map(([name]) => name);
      expect(hardBlocks).toEqual([FACTOR_MACRO_ALIGNMENT]);
    });

    it("DEFAULT_CONFLUENCE_THRESHOLD is 0.72", () => {
      expect(DEFAULT_CONFLUENCE_THRESHOLD).toBe(0.72);
    });
  });
});
