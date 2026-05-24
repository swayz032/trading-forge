/**
 * wave25-confluence-11-factor.test.ts — Wave 25 Pass 2.5, W25.5c
 *
 * Tests for the 11-factor weighted confluence model:
 *  - 11 weights sum to exactly 1.00
 *  - MCL redistribution: internals weight=0, cross_asset=0.10, total still 1.00
 *  - internals_aligned: long signal + TICK +800 → satisfied
 *  - cross_asset_aligned: long ES + DXY down → satisfied
 *  - Backward compat: 9-factor strategies still evaluated (new factors at code defaults)
 *  - Hard-block (macro_alignment) still works
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock DB and audit-log-helper to avoid DATABASE_URL requirement in unit tests
vi.mock("../db/index.js", () => ({
  db: {},
}));
vi.mock("../db/schema.js", () => ({}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
}));
import {
  CODE_DEFAULTS,
  W_MARKET_STRUCTURE_ALIGNED,
  W_LIQUIDITY_TARGET_CLEAR,
  W_SMT_CONFIRMATION,
  W_VWAP_ALIGNMENT,
  W_KILLZONE_ACTIVE,
  W_DELTA_OR_VOLUME,
  W_VP_LEVEL_PROXIMITY,
  W_MACRO_ALIGNMENT,
  W_INTERNALS_ALIGNED,
  W_INTERNALS_ALIGNED_MCL,
  W_CROSS_ASSET_ALIGNED,
  W_CROSS_ASSET_ALIGNED_MCL,
  W_REGIME_MATCH,
  FACTOR_INTERNALS_ALIGNED,
  FACTOR_CROSS_ASSET_ALIGNED,
  FACTOR_MACRO_ALIGNMENT,
  DEFAULT_CONFLUENCE_THRESHOLD,
  evaluateWeightedConfluence,
  type SignalContext,
  type ScoringStrategy,
} from "../services/confluence-score.js";
import {
  __resetInternalsForTests,
  __injectInternalsReading,
} from "../services/market-internals-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStrategy(overrides?: Partial<ScoringStrategy>): ScoringStrategy {
  return {
    id: "test-strategy-id",
    symbol: "MES",
    confluence_score_weights: null,
    confluence_score_threshold: null,
    ...overrides,
  };
}

function makeCtx(overrides?: Partial<SignalContext>): SignalContext {
  return {
    strategyId: "test-strategy-id",
    bar: { open: 5300, high: 5310, low: 5290, close: 5305, volume: 5000 },
    indicators: {},
    direction: "long",
    symbol: "MES",
    bias_active_strategy_id: null,
    structureState: null,
    calendarBlocked: false,
    timestampUTC: new Date("2026-05-24T14:00:00Z"), // 10am ET — in NYO killzone
    ...overrides,
  };
}

beforeEach(() => {
  __resetInternalsForTests();
});

// ─── Weight sum verification ──────────────────────────────────────────────────

describe("11-factor weight model correctness", () => {
  it("all 11 CODE_DEFAULTS weights sum to exactly 1.00", () => {
    const factors = Object.keys(CODE_DEFAULTS);
    expect(factors).toHaveLength(11);

    const sum = Object.values(CODE_DEFAULTS).reduce((acc, cfg) => acc + cfg.weight, 0);
    // Use toBeCloseTo with precision 10 to catch FP drift
    expect(sum).toBeCloseTo(1.00, 10);
  });

  it("explicit named weight constants sum to 1.00", () => {
    const sum =
      W_MARKET_STRUCTURE_ALIGNED +
      W_LIQUIDITY_TARGET_CLEAR +
      W_SMT_CONFIRMATION +
      W_VWAP_ALIGNMENT +
      W_KILLZONE_ACTIVE +
      W_DELTA_OR_VOLUME +
      W_VP_LEVEL_PROXIMITY +
      W_MACRO_ALIGNMENT +
      W_INTERNALS_ALIGNED +
      W_CROSS_ASSET_ALIGNED +
      W_REGIME_MATCH;
    expect(sum).toBeCloseTo(1.00, 10);
  });

  it("MCL redistribution: internals 0 + cross_asset 0.10 still sums to 1.00", () => {
    const baseSum = Object.values(CODE_DEFAULTS).reduce((acc, cfg) => acc + cfg.weight, 0);
    const mclSum = baseSum
      - W_INTERNALS_ALIGNED      // remove original internals weight
      + W_INTERNALS_ALIGNED_MCL  // add 0
      - W_CROSS_ASSET_ALIGNED    // remove original cross_asset weight
      + W_CROSS_ASSET_ALIGNED_MCL; // add redistributed
    expect(mclSum).toBeCloseTo(1.00, 10);
  });

  it("W_INTERNALS_ALIGNED_MCL is exactly 0", () => {
    expect(W_INTERNALS_ALIGNED_MCL).toBe(0);
  });

  it("W_CROSS_ASSET_ALIGNED_MCL equals W_CROSS_ASSET_ALIGNED + W_INTERNALS_ALIGNED", () => {
    expect(W_CROSS_ASSET_ALIGNED_MCL).toBeCloseTo(
      W_CROSS_ASSET_ALIGNED + W_INTERNALS_ALIGNED,
      10,
    );
  });
});

// ─── MCL redistribution in evaluateWeightedConfluence ─────────────────────────

describe("MCL weight redistribution in evaluateWeightedConfluence", () => {
  it("internals_aligned weight is 0 for MCL signal", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MCL" }),
      makeCtx({ symbol: "MCL", direction: "long" }),
    );
    const internals = result.factorContributions.find(
      (f) => f.factor === FACTOR_INTERNALS_ALIGNED,
    );
    expect(internals!.weight).toBe(0);
  });

  it("cross_asset_aligned weight is 0.10 for MCL signal", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MCL" }),
      makeCtx({ symbol: "MCL", direction: "long" }),
    );
    const crossAsset = result.factorContributions.find(
      (f) => f.factor === FACTOR_CROSS_ASSET_ALIGNED,
    );
    expect(crossAsset!.weight).toBeCloseTo(0.10, 10);
  });

  it("MCL factorContributions weights sum to 1.00", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MCL" }),
      makeCtx({ symbol: "MCL", direction: "long" }),
    );
    const sum = result.factorContributions.reduce((acc, f) => acc + f.weight, 0);
    expect(sum).toBeCloseTo(1.00, 10);
  });

  it("internals_aligned factor has reason mcl_skip_stock_breadth_irrelevant for MCL", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MCL" }),
      makeCtx({ symbol: "MCL", direction: "long" }),
    );
    const internals = result.factorContributions.find(
      (f) => f.factor === FACTOR_INTERNALS_ALIGNED,
    );
    expect(internals!.reason).toBe("mcl_skip_stock_breadth_irrelevant");
    expect(internals!.satisfied).toBe(false);
    expect(internals!.contribution).toBe(0);
  });
});

// ─── internals_aligned evaluator ─────────────────────────────────────────────

describe("internals_aligned factor evaluation", () => {
  it("satisfied=false with reason internals_stale when no readings injected", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MES" }),
      makeCtx({ symbol: "MES", direction: "long" }),
    );
    const internals = result.factorContributions.find(
      (f) => f.factor === FACTOR_INTERNALS_ALIGNED,
    );
    // No readings → stale or all_null
    expect(internals!.satisfied).toBe(false);
    expect(["internals_stale", "internals_all_null"]).toContain(internals!.reason);
  });

  it("long signal + TICK >500 → satisfied", () => {
    const now = new Date();
    __injectInternalsReading("tick", 800, now);
    __injectInternalsReading("add",  200, now);
    __injectInternalsReading("vold", 100, now);
    __injectInternalsReading("trin", 0.8, now);

    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MES" }),
      makeCtx({ symbol: "MES", direction: "long" }),
    );
    const internals = result.factorContributions.find(
      (f) => f.factor === FACTOR_INTERNALS_ALIGNED,
    );
    expect(internals!.satisfied).toBe(true);
    expect(internals!.reason).toContain("tick=800");
  });

  it("long signal + TICK negative + ADD negative → not satisfied", () => {
    const now = new Date();
    __injectInternalsReading("tick", -300, now); // <500 threshold
    __injectInternalsReading("add",  -50,  now);
    __injectInternalsReading("vold", -20,  now);
    __injectInternalsReading("trin", 1.5,  now);

    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MES" }),
      makeCtx({ symbol: "MES", direction: "long" }),
    );
    const internals = result.factorContributions.find(
      (f) => f.factor === FACTOR_INTERNALS_ALIGNED,
    );
    expect(internals!.satisfied).toBe(false);
  });

  it("short signal + TICK <-500 → satisfied", () => {
    const now = new Date();
    __injectInternalsReading("tick", -800, now);
    __injectInternalsReading("add",  -300, now);
    __injectInternalsReading("vold", -150, now);
    __injectInternalsReading("trin", 1.8,  now);

    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MNQ" }),
      makeCtx({ symbol: "MNQ", direction: "short" }),
    );
    const internals = result.factorContributions.find(
      (f) => f.factor === FACTOR_INTERNALS_ALIGNED,
    );
    expect(internals!.satisfied).toBe(true);
  });

  it("short signal + TICK +800 (bullish) → not satisfied", () => {
    const now = new Date();
    __injectInternalsReading("tick", 800, now);
    __injectInternalsReading("add",  400, now);
    __injectInternalsReading("vold", 200, now);
    __injectInternalsReading("trin", 0.7, now);

    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MNQ" }),
      makeCtx({ symbol: "MNQ", direction: "short" }),
    );
    const internals = result.factorContributions.find(
      (f) => f.factor === FACTOR_INTERNALS_ALIGNED,
    );
    expect(internals!.satisfied).toBe(false);
  });
});

// ─── cross_asset_aligned evaluator ───────────────────────────────────────────

describe("cross_asset_aligned factor evaluation", () => {
  it("satisfied=false with reason cross_asset_data_unavailable when no direction in context", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MES" }),
      makeCtx({ symbol: "MES", direction: "long", dxyDirection: null, us10yDirection: null }),
    );
    const crossAsset = result.factorContributions.find(
      (f) => f.factor === FACTOR_CROSS_ASSET_ALIGNED,
    );
    expect(crossAsset!.satisfied).toBe(false);
    expect(crossAsset!.reason).toBe("cross_asset_data_unavailable");
  });

  it("long ES + DXY down → satisfied", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MES" }),
      makeCtx({ symbol: "MES", direction: "long", dxyDirection: "down", us10yDirection: "flat" }),
    );
    const crossAsset = result.factorContributions.find(
      (f) => f.factor === FACTOR_CROSS_ASSET_ALIGNED,
    );
    expect(crossAsset!.satisfied).toBe(true);
    expect(crossAsset!.reason).toContain("risk_on");
  });

  it("long ES + DXY up + 10Y up → not satisfied", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MNQ" }),
      makeCtx({ symbol: "MNQ", direction: "long", dxyDirection: "up", us10yDirection: "up" }),
    );
    const crossAsset = result.factorContributions.find(
      (f) => f.factor === FACTOR_CROSS_ASSET_ALIGNED,
    );
    expect(crossAsset!.satisfied).toBe(false);
  });

  it("short ES + DXY up → satisfied", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MES" }),
      makeCtx({ symbol: "MES", direction: "short", dxyDirection: "up", us10yDirection: "flat" }),
    );
    const crossAsset = result.factorContributions.find(
      (f) => f.factor === FACTOR_CROSS_ASSET_ALIGNED,
    );
    expect(crossAsset!.satisfied).toBe(true);
  });
});

// ─── Hard block still works ───────────────────────────────────────────────────

describe("macro_alignment hard block preserved in 11-factor model", () => {
  it("score=0 and passed=false when calendarBlocked=true", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MES" }),
      makeCtx({ calendarBlocked: true }),
    );
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.hardBlockTriggered).toBe(true);

    const macroFactor = result.factorContributions.find(
      (f) => f.factor === FACTOR_MACRO_ALIGNMENT,
    );
    expect(macroFactor!.is_hard_block).toBe(true);
    expect(macroFactor!.satisfied).toBe(false);
  });
});

// ─── Backward compat: 9-factor strategy weight override ───────────────────────

describe("backward compat — 9-factor strategies still evaluated", () => {
  it("strategy with old 9-factor confluence_score_weights evaluates without error", () => {
    // Simulate a strategy that was configured before W25.5c (no internals/cross_asset keys)
    const nineFactorWeights: Record<string, number> = {
      market_structure_aligned: 0.20,
      liquidity_target_clear:   0.15,
      smt_confirmation:         0.12,
      vwap_alignment:           0.12,
      killzone_active:          0.10,
      delta_or_volume_signature: 0.10,
      vp_level_proximity:       0.08,
      macro_alignment:          0.08,
      regime_match:             0.05,
      // NO internals_aligned or cross_asset_aligned keys
    };

    const strategy = makeStrategy({
      symbol: "MES",
      confluence_score_weights: nineFactorWeights,
    });

    // Should not throw — new factors get code-default weights
    expect(() =>
      evaluateWeightedConfluence(strategy, makeCtx({ symbol: "MES" }))
    ).not.toThrow();

    const result = evaluateWeightedConfluence(strategy, makeCtx({ symbol: "MES" }));
    expect(result.factorContributions).toHaveLength(11);

    // New factors should be at code-default weights (0.05 each)
    const internals = result.factorContributions.find(
      (f) => f.factor === FACTOR_INTERNALS_ALIGNED,
    );
    const crossAsset = result.factorContributions.find(
      (f) => f.factor === FACTOR_CROSS_ASSET_ALIGNED,
    );
    expect(internals!.weight).toBe(0.05);
    expect(crossAsset!.weight).toBe(0.05);
  });

  it("result.weightsSource is strategy_override for 9-factor DB weights", () => {
    const nineFactorWeights: Record<string, number> = {
      market_structure_aligned: 0.20,
      liquidity_target_clear:   0.15,
      smt_confirmation:         0.12,
      vwap_alignment:           0.12,
      killzone_active:          0.10,
      delta_or_volume_signature: 0.10,
      vp_level_proximity:       0.08,
      macro_alignment:          0.08,
      regime_match:             0.05,
    };
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MES", confluence_score_weights: nineFactorWeights }),
      makeCtx({ symbol: "MES" }),
    );
    expect(result.weightsSource).toBe("strategy_override");
  });
});

// ─── Score structure sanity ───────────────────────────────────────────────────

describe("score structure sanity", () => {
  it("result has 11 factorContributions", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MES" }),
      makeCtx({ symbol: "MES" }),
    );
    expect(result.factorContributions).toHaveLength(11);
  });

  it("score is in [0, 1]", () => {
    const result = evaluateWeightedConfluence(
      makeStrategy({ symbol: "MES" }),
      makeCtx({ symbol: "MES" }),
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("DEFAULT_CONFLUENCE_THRESHOLD remains 0.72", () => {
    expect(DEFAULT_CONFLUENCE_THRESHOLD).toBe(0.72);
  });
});
