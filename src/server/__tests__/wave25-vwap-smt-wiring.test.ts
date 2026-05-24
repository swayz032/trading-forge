/**
 * wave25-vwap-smt-wiring.test.ts — Wave 25 Pass 5, P5.A3
 *
 * Tests for the wiring of P5.A1 (VWAP bands) and P5.A2 (SMT divergence) outputs
 * into the Stage 2 weighted confluence scoring factors:
 *   - evalVwapAlignment() — vwap_alignment factor
 *   - evalSmtConfirmation() — smt_confirmation factor
 *
 * Coverage:
 *   evalVwapAlignment:
 *    1. Long + close < vwap → satisfied (discount bias)
 *    2. Short + close > vwap → satisfied (premium bias)
 *    3. Long + close >= vwap → NOT satisfied
 *    4. Short + close <= vwap → NOT satisfied
 *    5. Band 1σ reject: long + close <= band_1s_lower → satisfied, reason="band_1s_reject"
 *    6. Band 1σ reject: short + close >= band_1s_upper → satisfied, reason="band_1s_reject"
 *    7. Anchored VWAP retest: anchored_vwap_<iso> in indicators, within 0.5×ATR → satisfied
 *    8. Anchored VWAP NOT within 0.5×ATR → does not trigger anchored retest
 *    9. Missing VWAP → fail-open (satisfied=false, reason="vwap_unavailable")
 *   10. Bands absent but session VWAP present → falls back to VWAP position check
 *
 *   evalSmtConfirmation:
 *   11. Long + bullish_es_low_nq_higher + score 0.7 → satisfied
 *   12. Short + bearish_es_high_nq_lower + score 0.7 → satisfied
 *   13. Wrong direction: long + bearish SMT → NOT satisfied, reason="smt_wrong_direction_*"
 *   14. Wrong direction: short + bullish SMT → NOT satisfied
 *   15. Score below threshold (0.5): direction matches but score=0.4 → NOT satisfied
 *   16. Score exactly at threshold (0.5): → satisfied
 *   17. Missing smt_score → fail-open (satisfied=false, reason="smt_unavailable")
 *   18. Missing smt_direction → fail-open
 *   19. null smt_score → fail-open
 *
 *   Integration (factor in full evaluateWeightedConfluence):
 *   20. VWAP satisfied + SMT satisfied contribute correct weights to score
 *   21. Both factors unsatisfied → score does not include their weights
 *   22. smt_age_bars on ctx → decay engine receives it (decay_confidence < 1.0 for old SMT)
 *
 * Mock strategy: DB / audit-log / market-internals are mocked (same pattern as
 * wave25-confluence-decay-stage2-wiring.test.ts). Decay functions run as pure functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (same pattern as existing wave25 tests) ────────────────────────────
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
  FACTOR_VWAP_ALIGNMENT,
  FACTOR_SMT_CONFIRMATION,
  W_VWAP_ALIGNMENT,
  W_SMT_CONFIRMATION,
  type ScoringStrategy,
  type SignalContext,
} from "../services/confluence-score.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStrategy(overrides: Partial<ScoringStrategy> = {}): ScoringStrategy {
  return {
    id: "test-strategy-vwap-smt",
    symbol: "MES",
    confluence_score_weights: null,
    confluence_score_threshold: null,
    entry_quality: null,
    ...overrides,
  };
}

/**
 * Base context: calendar not blocked, killzone active (10am ET),
 * structureState null (factor fails — not relevant to these tests),
 * indicators contain only what the specific test injects.
 */
function makeCtx(overrides: Partial<SignalContext> = {}): SignalContext {
  return {
    strategyId: "test-strategy-vwap-smt",
    bar: { open: 5300, high: 5310, low: 5290, close: 5305, volume: 5000 },
    indicators: {
      vwap: 5310,      // close (5305) is below vwap (5310) → long discount by default
      atr: 10,
    },
    direction: "long",
    symbol: "MES",
    bias_active_strategy_id: null,
    structureState: null,
    calendarBlocked: false,
    timestampUTC: new Date("2026-05-24T14:00:00Z"), // 10am ET — in NYO killzone
    ...overrides,
  };
}

/** Extract a single factor contribution by name */
function getFactor(ctx: SignalContext, factorName: string) {
  const result = evaluateWeightedConfluence(makeStrategy(), ctx);
  return result.factorContributions.find((fc) => fc.factor === factorName);
}

// ─── evalVwapAlignment tests ──────────────────────────────────────────────────

describe("evalVwapAlignment (W25.8 VWAP bands)", () => {

  describe("Basic session VWAP position checks", () => {
    it("long + close < vwap → satisfied (discount bias)", () => {
      // close=5305 < vwap=5310 → discount → satisfied
      const fc = getFactor(makeCtx({
        direction: "long",
        bar: { open: 5300, high: 5310, low: 5290, close: 5305, volume: 5000 },
        indicators: { vwap: 5310, atr: 10 },
      }), FACTOR_VWAP_ALIGNMENT);
      expect(fc).toBeDefined();
      expect(fc!.satisfied).toBe(true);
      expect(fc!.reason).toContain("close_below_vwap");
    });

    it("short + close > vwap → satisfied (premium bias)", () => {
      // close=5320 > vwap=5310 → premium → satisfied for short
      const fc = getFactor(makeCtx({
        direction: "short",
        bar: { open: 5300, high: 5325, low: 5290, close: 5320, volume: 5000 },
        indicators: { vwap: 5310, atr: 10 },
      }), FACTOR_VWAP_ALIGNMENT);
      expect(fc!.satisfied).toBe(true);
      expect(fc!.reason).toContain("close_above_vwap");
    });

    it("long + close > vwap (in premium) → NOT satisfied", () => {
      // close=5315 > vwap=5310 → premium → not discount for long
      const fc = getFactor(makeCtx({
        direction: "long",
        bar: { open: 5300, high: 5320, low: 5290, close: 5315, volume: 5000 },
        indicators: { vwap: 5310, atr: 10 },
      }), FACTOR_VWAP_ALIGNMENT);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toContain("close_above_vwap_long_not_discount");
    });

    it("short + close < vwap (in discount) → NOT satisfied", () => {
      // close=5305 < vwap=5310 → discount → not premium for short
      const fc = getFactor(makeCtx({
        direction: "short",
        bar: { open: 5300, high: 5315, low: 5290, close: 5305, volume: 5000 },
        indicators: { vwap: 5310, atr: 10 },
      }), FACTOR_VWAP_ALIGNMENT);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toContain("close_below_vwap_short_not_premium");
    });
  });

  describe("Band 1σ rejection (P5.A1 bands)", () => {
    it("long + close <= vwap_band_1s_lower → satisfied with reason band_1s_reject", () => {
      // close=5290, band_1s_lower=5295 → below lower band → bounce setup
      const fc = getFactor(makeCtx({
        direction: "long",
        bar: { open: 5295, high: 5300, low: 5285, close: 5290, volume: 6000 },
        indicators: {
          vwap: 5310,
          vwap_band_1s_upper: 5325,
          vwap_band_1s_lower: 5295,
          vwap_band_2s_upper: 5340,
          vwap_band_2s_lower: 5280,
          atr: 10,
        },
      }), FACTOR_VWAP_ALIGNMENT);
      expect(fc!.satisfied).toBe(true);
      expect(fc!.reason).toBe("band_1s_reject");
    });

    it("short + close >= vwap_band_1s_upper → satisfied with reason band_1s_reject", () => {
      // close=5327, band_1s_upper=5325 → above upper band → rejection setup
      const fc = getFactor(makeCtx({
        direction: "short",
        bar: { open: 5320, high: 5330, low: 5315, close: 5327, volume: 6000 },
        indicators: {
          vwap: 5310,
          vwap_band_1s_upper: 5325,
          vwap_band_1s_lower: 5295,
          vwap_band_2s_upper: 5340,
          vwap_band_2s_lower: 5280,
          atr: 10,
        },
      }), FACTOR_VWAP_ALIGNMENT);
      expect(fc!.satisfied).toBe(true);
      expect(fc!.reason).toBe("band_1s_reject");
    });

    it("band present but close between band and VWAP → falls through to VWAP check", () => {
      // close=5300: below vwap=5310, above band_1s_lower=5295 → not a band reject
      // but is in discount → satisfied via standard check
      const fc = getFactor(makeCtx({
        direction: "long",
        bar: { open: 5300, high: 5308, low: 5295, close: 5300, volume: 5000 },
        indicators: {
          vwap: 5310,
          vwap_band_1s_upper: 5325,
          vwap_band_1s_lower: 5295,
          atr: 10,
        },
      }), FACTOR_VWAP_ALIGNMENT);
      expect(fc!.satisfied).toBe(true);
      expect(fc!.reason).toContain("close_below_vwap");
    });
  });

  describe("Anchored VWAP retest (Path C bonus)", () => {
    it("anchored_vwap_<iso> within 0.5×ATR → satisfied with reason anchored_vwap_retest", () => {
      // close=5303, anchored_vwap=5305, atr=10 → |5303-5305|=2 <= 5.0 → retest
      const fc = getFactor(makeCtx({
        direction: "long",
        bar: { open: 5300, high: 5308, low: 5298, close: 5303, volume: 5000 },
        indicators: {
          vwap: 5310,
          atr: 10,
          "anchored_vwap_2026-05-23T00:00:00": 5305, // P5.A1 anchored VWAP column
        },
      }), FACTOR_VWAP_ALIGNMENT);
      expect(fc!.satisfied).toBe(true);
      expect(fc!.reason).toBe("anchored_vwap_retest");
    });

    it("anchored_vwap far from close (>0.5×ATR) → no anchored retest boost, falls to VWAP check", () => {
      // close=5303, anchored_vwap=5350, atr=10 → |5303-5350|=47 >> 5.0 → no retest
      // close < vwap=5310 → satisfied via standard discount
      const fc = getFactor(makeCtx({
        direction: "long",
        bar: { open: 5300, high: 5308, low: 5298, close: 5303, volume: 5000 },
        indicators: {
          vwap: 5310,
          atr: 10,
          "anchored_vwap_2026-05-23T00:00:00": 5350,
        },
      }), FACTOR_VWAP_ALIGNMENT);
      expect(fc!.satisfied).toBe(true);
      // Should be the standard reason, not anchored_vwap_retest
      expect(fc!.reason).not.toBe("anchored_vwap_retest");
      expect(fc!.reason).toContain("close_below_vwap");
    });
  });

  describe("Fail-open: missing VWAP data", () => {
    it("no vwap in indicators → satisfied=false, reason=vwap_unavailable", () => {
      const fc = getFactor(makeCtx({
        indicators: {}, // no vwap
      }), FACTOR_VWAP_ALIGNMENT);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toBe("vwap_unavailable");
    });

    it("bands absent but session vwap present → falls back to session VWAP check (backward-compat)", () => {
      // close=5305 < vwap=5310 → satisfied without bands
      const fc = getFactor(makeCtx({
        direction: "long",
        bar: { open: 5300, high: 5310, low: 5295, close: 5305, volume: 5000 },
        indicators: { vwap: 5310, atr: 10 },  // no band columns
      }), FACTOR_VWAP_ALIGNMENT);
      expect(fc!.satisfied).toBe(true);
      expect(fc!.reason).toContain("close_below_vwap");
    });
  });
});

// ─── evalSmtConfirmation tests ────────────────────────────────────────────────

describe("evalSmtConfirmation (W25.9 SMT divergence)", () => {

  describe("Satisfied cases", () => {
    it("long + bullish_es_low_nq_higher + score 0.7 → satisfied", () => {
      const fc = getFactor(makeCtx({
        direction: "long",
        smt_score: 0.7,
        smt_direction: "bullish_es_low_nq_higher",
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(true);
      expect(fc!.reason).toContain("smt_confirmed");
      expect(fc!.reason).toContain("bullish_es_low_nq_higher");
    });

    it("short + bearish_es_high_nq_lower + score 0.7 → satisfied", () => {
      const fc = getFactor(makeCtx({
        direction: "short",
        smt_score: 0.7,
        smt_direction: "bearish_es_high_nq_lower",
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(true);
      expect(fc!.reason).toContain("smt_confirmed");
      expect(fc!.reason).toContain("bearish_es_high_nq_lower");
    });

    it("score exactly at threshold 0.5 → satisfied", () => {
      const fc = getFactor(makeCtx({
        direction: "long",
        smt_score: 0.5,
        smt_direction: "bullish_es_low_nq_higher",
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(true);
    });
  });

  describe("Wrong direction", () => {
    it("long + bearish SMT → NOT satisfied, reason contains smt_wrong_direction", () => {
      const fc = getFactor(makeCtx({
        direction: "long",
        smt_score: 0.8,
        smt_direction: "bearish_es_high_nq_lower",
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toContain("smt_wrong_direction");
      expect(fc!.reason).toContain("long");
    });

    it("short + bullish SMT → NOT satisfied", () => {
      const fc = getFactor(makeCtx({
        direction: "short",
        smt_score: 0.8,
        smt_direction: "bullish_es_low_nq_higher",
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toContain("smt_wrong_direction");
    });
  });

  describe("Score below threshold", () => {
    it("direction matches but score=0.4 (<0.5) → NOT satisfied, reason=smt_below_threshold", () => {
      const fc = getFactor(makeCtx({
        direction: "long",
        smt_score: 0.4,
        smt_direction: "bullish_es_low_nq_higher",
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toContain("smt_below_threshold");
      expect(fc!.reason).toContain("0.400");
    });

    it("score=0.0 → NOT satisfied", () => {
      const fc = getFactor(makeCtx({
        direction: "short",
        smt_score: 0.0,
        smt_direction: "bearish_es_high_nq_lower",
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toContain("smt_below_threshold");
    });
  });

  describe("Fail-open: missing SMT data", () => {
    it("no smt_score in ctx → satisfied=false, reason=smt_unavailable", () => {
      const fc = getFactor(makeCtx({
        direction: "long",
        smt_direction: "bullish_es_low_nq_higher",
        // smt_score not set → undefined
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toBe("smt_unavailable");
    });

    it("smt_score=null → satisfied=false, reason=smt_unavailable", () => {
      const fc = getFactor(makeCtx({
        direction: "long",
        smt_score: null,
        smt_direction: "bullish_es_low_nq_higher",
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toBe("smt_unavailable");
    });

    it("no smt_direction in ctx → satisfied=false, reason=smt_unavailable", () => {
      const fc = getFactor(makeCtx({
        direction: "long",
        smt_score: 0.7,
        // smt_direction not set → undefined
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toBe("smt_unavailable");
    });

    it("smt_direction=null → satisfied=false, reason=smt_unavailable", () => {
      const fc = getFactor(makeCtx({
        direction: "long",
        smt_score: 0.7,
        smt_direction: null,
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toBe("smt_unavailable");
    });

    it("no smt data at all (pre-P5.A5 call site) → fail-open", () => {
      // ctx has no smt_score or smt_direction set — pre-Pass-5 call site
      const fc = getFactor(makeCtx({
        direction: "long",
      }), FACTOR_SMT_CONFIRMATION);
      expect(fc!.satisfied).toBe(false);
      expect(fc!.reason).toBe("smt_unavailable");
    });
  });
});

// ─── Integration: full evaluateWeightedConfluence scoring ────────────────────

describe("Integration — VWAP + SMT in full evaluateWeightedConfluence", () => {

  it("both vwap + smt satisfied → contribute their weights to score", () => {
    // vwap_alignment: close=5305 < vwap=5310 → satisfied
    // smt_confirmation: bullish + score=0.75 → satisfied
    // macro_alignment: not blocked → satisfied
    // other factors: mostly fail-open (structureState null, liquidity absent, etc.)
    const ctx = makeCtx({
      direction: "long",
      bar: { open: 5300, high: 5310, low: 5290, close: 5305, volume: 5000 },
      calendarBlocked: false,
      indicators: { vwap: 5310, atr: 10 },
      smt_score: 0.75,
      smt_direction: "bullish_es_low_nq_higher",
    });
    const result = evaluateWeightedConfluence(makeStrategy(), ctx);

    const vwapFc  = result.factorContributions.find((fc) => fc.factor === FACTOR_VWAP_ALIGNMENT);
    const smtFc   = result.factorContributions.find((fc) => fc.factor === FACTOR_SMT_CONFIRMATION);

    expect(vwapFc!.satisfied).toBe(true);
    expect(vwapFc!.contribution).toBeCloseTo(W_VWAP_ALIGNMENT, 5);

    expect(smtFc!.satisfied).toBe(true);
    // SMT contribution = W_SMT_CONFIRMATION × decay_confidence × 1.0 (no age decay if smt_age_bars absent)
    // Without smt_age_bars, decay returns 1.0
    expect(smtFc!.contribution).toBeCloseTo(W_SMT_CONFIRMATION, 5);
  });

  it("both vwap + smt unsatisfied → zero contribution for both factors", () => {
    // vwap: close=5315 > vwap=5310 → long in premium → not satisfied
    // smt: no data → not satisfied
    const ctx = makeCtx({
      direction: "long",
      bar: { open: 5310, high: 5320, low: 5305, close: 5315, volume: 5000 },
      indicators: { vwap: 5310, atr: 10 },
      // no smt_score / smt_direction
    });
    const result = evaluateWeightedConfluence(makeStrategy(), ctx);

    const vwapFc = result.factorContributions.find((fc) => fc.factor === FACTOR_VWAP_ALIGNMENT);
    const smtFc  = result.factorContributions.find((fc) => fc.factor === FACTOR_SMT_CONFIRMATION);

    expect(vwapFc!.satisfied).toBe(false);
    expect(vwapFc!.contribution).toBe(0);

    expect(smtFc!.satisfied).toBe(false);
    expect(smtFc!.contribution).toBe(0);
  });

  it("smt_age_bars populated → decay engine receives it and reduces SMT contribution", () => {
    // Very old SMT signal (300 bars >> 60-bar half-life) → decay reduces confidence
    const ctx = makeCtx({
      direction: "long",
      bar: { open: 5300, high: 5310, low: 5290, close: 5305, volume: 5000 },
      indicators: { vwap: 5310, atr: 10 },
      smt_score: 0.8,
      smt_direction: "bullish_es_low_nq_higher",
      smt_age_bars: 300,  // stale SMT signal
    });
    const result = evaluateWeightedConfluence(makeStrategy(), ctx);
    const smtFc = result.factorContributions.find((fc) => fc.factor === FACTOR_SMT_CONFIRMATION);

    expect(smtFc!.satisfied).toBe(true);
    // Decay should have reduced confidence below 1.0
    expect(smtFc!.decay_confidence).not.toBeNull();
    expect(smtFc!.decay_confidence!).toBeLessThan(1.0);
    // Contribution should be less than full weight
    expect(smtFc!.contribution).toBeLessThan(W_SMT_CONFIRMATION);
  });

  it("fresh smt_age_bars (5 bars) → SMT contribution near full weight", () => {
    const ctx = makeCtx({
      direction: "long",
      bar: { open: 5300, high: 5310, low: 5290, close: 5305, volume: 5000 },
      indicators: { vwap: 5310, atr: 10 },
      smt_score: 0.8,
      smt_direction: "bullish_es_low_nq_higher",
      smt_age_bars: 5,  // fresh SMT signal
    });
    const result = evaluateWeightedConfluence(makeStrategy(), ctx);
    const smtFc = result.factorContributions.find((fc) => fc.factor === FACTOR_SMT_CONFIRMATION);

    expect(smtFc!.satisfied).toBe(true);
    // Fresh signal: decay_confidence should be high (> 0.9)
    expect(smtFc!.decay_confidence).not.toBeNull();
    expect(smtFc!.decay_confidence!).toBeGreaterThan(0.9);
  });

  it("sample factor contribution output for audit trail — live-VWAP + live-SMT signal", () => {
    // Representative "live" scenario: all P5 data populated
    const ctx = makeCtx({
      direction: "long",
      bar: { open: 5292, high: 5305, low: 5288, close: 5295, volume: 7500 },
      calendarBlocked: false,
      indicators: {
        vwap: 5305,              // close=5295 < vwap=5305 → discount → satisfied
        vwap_band_1s_upper: 5318,
        vwap_band_1s_lower: 5292,
        vwap_band_2s_upper: 5331,
        vwap_band_2s_lower: 5279,
        atr: 8,
      },
      smt_score: 0.72,
      smt_direction: "bullish_es_low_nq_higher",
      smt_age_bars: 12,
    });
    const result = evaluateWeightedConfluence(makeStrategy(), ctx);

    const vwapFc = result.factorContributions.find((fc) => fc.factor === FACTOR_VWAP_ALIGNMENT)!;
    const smtFc  = result.factorContributions.find((fc) => fc.factor === FACTOR_SMT_CONFIRMATION)!;

    // Verify the factor contribution fields are auditable
    expect(vwapFc.factor).toBe(FACTOR_VWAP_ALIGNMENT);
    expect(vwapFc.satisfied).toBe(true);
    expect(vwapFc.weight).toBe(W_VWAP_ALIGNMENT);
    expect(vwapFc.contribution).toBeGreaterThan(0);
    expect(typeof vwapFc.reason).toBe("string");
    expect(vwapFc.reason.length).toBeGreaterThan(0);

    expect(smtFc.factor).toBe(FACTOR_SMT_CONFIRMATION);
    expect(smtFc.satisfied).toBe(true);
    expect(smtFc.weight).toBe(W_SMT_CONFIRMATION);
    expect(smtFc.contribution).toBeGreaterThan(0);
    expect(smtFc.reason).toContain("smt_confirmed");
    expect(smtFc.decay_confidence).not.toBeNull();
  });
});
