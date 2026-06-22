/**
 * W23G.12 — Bidirectional strategy backfill tests.
 *
 * Pure-function tests against computePromotion() and classifyIndicator()
 * from scripts/backfill-bidirectional-strategies.ts.
 * No DB, no network, no subprocess.
 *
 * Test cases:
 *  1.  ORB (session_open_breakout) long-only → promoted to 'both', mirror_inferred=true
 *  2.  ema_crossover long-only → promoted to 'both'
 *  3.  bollinger_breakout long-only → promoted, entry_short != sentinel
 *  4.  connors_rsi2 long-only → NOT promoted (hard asymmetric)
 *  5.  raschke_holy_grail long-only → NOT promoted (hard asymmetric)
 *  6.  direction='both' already → idempotent skip
 *  7.  Wyckoff spring (long-only, symmetric archetype) → promoted to 'both'
 *  8.  archetype:fvg long-only → promoted to 'both'
 *  9.  Unknown indicator → skipped_unknown (manual review required)
 * 10.  buildPromotedConfig sets direction='both', mirror_inferred=true, updates entry_short
 * 11.  Audit produces 0 defects after promotion (strategy config shape stays valid)
 * 12.  classifyIndicator returns correct classification for all canonical indicators
 */

import { describe, it, expect } from "vitest";
import {
  computePromotion,
  buildPromotedConfig,
  classifyIndicator,
  SYMMETRIC_INDICATORS,
  ASYMMETRIC_INDICATORS,
  type BackfillRow,
} from "../../../scripts/backfill-bidirectional-strategies.js";
import { audit } from "../../../scripts/audit-graduated-strategy-dsls.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(
  overrides: Partial<{
    id: string;
    name: string;
    direction: string;
    entry_indicator: string;
    entry_params: Record<string, unknown>;
    entry_short: string;
  }> = {},
): BackfillRow {
  const {
    id = "aaaaaaaa-0000-0000-0000-000000000001",
    name = "test_strategy_mes_5m",
    direction = "long",
    entry_indicator = "ema_crossover",
    entry_params = { fast_period: 9, slow_period: 21 },
    entry_short = "high < low",
  } = overrides;

  return {
    id,
    name,
    config: {
      metadata: { source: "graduated_bucket" },
      direction,
      entry_indicator,
      entry_params,
      exit_type: "trailing_stop",
      exit_params: {
        style: "c",
        partials: [
          { at_r: 1.0, size_pct: 0.33 },
          { at_r: 2.0, size_pct: 0.33 },
        ],
        runner: {
          size_pct: 0.34,
          trail_primary: "developing_session_poc",
          trail_fallback: { type: "chandelier", atr_period: 14, multiplier: 2.0 },
        },
        tp1_at_r: 1.0,
        tp2_at_r: 2.0,
        partial_at_r: 1.0,
        move_stop_to: "BE+1tick",
        trail: { type: "chandelier", atr_period: 14, multiplier: 2.0 },
      },
      time_stop: { type: "hard_flatten", flat_at: "15:55 ET" },
      regime_gate: { enabled: true },
      session_filter: { enabled: true, session: "RTH_ONLY" },
      entry_type: entry_indicator,
      strategy: {
        name,
        symbol: "MES",
        timeframe: "5m",
        exit: "high < low",
        entry_long: "ema_9 crosses_above ema_21",
        entry_short,
        indicators: [{ type: "ema", period: 9 }, { type: "ema", period: 21 }],
        stop_loss: { type: "atr", multiplier: 1.5 },
        position_size: {
          type: "risk_derived_pyramid",
          base_contracts: 6,
          tier_increment: 3,
          tier_threshold_dollars: 3000,
          personal_dll_pct: 0.67,
          max_risk_pct_per_trade: 0.02,
          liquidity_comfort_cap: 100,
          computed_at_signal_time: true,
        },
      },
    } as Record<string, unknown>,
  };
}

// ─── Test 1: ORB long-only → promoted ─────────────────────────────────────────

describe("ORB (session_open_breakout) long-only strategy", () => {
  it("is promoted to direction='both' with mirror_inferred=true", () => {
    const row = makeRow({
      direction: "long",
      entry_indicator: "session_open_breakout",
      entry_params: { range_minutes: 15 },
      entry_short: "high < low",
    });
    const result = computePromotion(row);
    expect(result.outcome).toBe("promoted");
    expect(result.prior_direction).toBe("long");
    expect(result.archetype).toBe("session_open_breakout");
  });

  it("recompiled entry_short is NOT the never-true sentinel after promotion", () => {
    const row = makeRow({
      direction: "long",
      entry_indicator: "session_open_breakout",
      entry_params: { range_minutes: 15 },
    });
    const result = computePromotion(row);
    expect(result.outcome).toBe("promoted");
    // For ORB, entry_short should reference orl_15m (below OR low = short)
    expect(result.entry_short_grammar).not.toBe("high < low");
    expect(result.entry_short_grammar).toContain("orl_");
  });

  it("buildPromotedConfig sets direction='both' and mirror_inferred=true", () => {
    const row = makeRow({ direction: "long", entry_indicator: "session_open_breakout" });
    const result = computePromotion(row);
    expect(result.outcome).toBe("promoted");
    const newConfig = buildPromotedConfig(row.config, result.entry_short_grammar!);
    expect(newConfig.direction).toBe("both");
    expect(newConfig.mirror_inferred).toBe(true);
    expect((newConfig.strategy as any).entry_short).toBe(result.entry_short_grammar);
  });
});

// ─── Test 2: ema_crossover long-only → promoted ───────────────────────────────

describe("ema_crossover long-only strategy", () => {
  it("is promoted to direction='both'", () => {
    const row = makeRow({ direction: "long", entry_indicator: "ema_crossover" });
    const result = computePromotion(row);
    expect(result.outcome).toBe("promoted");
  });

  it("entry_short grammar contains 'crosses_below'", () => {
    const row = makeRow({
      direction: "long",
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
    });
    const result = computePromotion(row);
    expect(result.entry_short_grammar).toContain("crosses_below");
  });
});

// ─── Test 3: bollinger_breakout long-only → promoted, meaningful entry_short ──

describe("bollinger_breakout long-only strategy", () => {
  it("is promoted", () => {
    const row = makeRow({ direction: "long", entry_indicator: "bollinger_breakout" });
    const result = computePromotion(row);
    expect(result.outcome).toBe("promoted");
  });

  it("entry_short references bb_lower (close < bb_lower_N)", () => {
    const row = makeRow({
      direction: "long",
      entry_indicator: "bollinger_breakout",
      entry_params: { period: 20, std_dev: 2 },
    });
    const result = computePromotion(row);
    expect(result.entry_short_grammar).toContain("bb_lower");
    expect(result.entry_short_grammar).not.toBe("high < low");
  });
});

// ─── Test 4: connors_rsi2 → hard asymmetric, never promoted ──────────────────

describe("connors_rsi2 long-only strategy (hard asymmetric)", () => {
  it("is NOT promoted — skipped_asymmetric", () => {
    const row = makeRow({ direction: "long", entry_indicator: "connors_rsi2" });
    const result = computePromotion(row);
    expect(result.outcome).toBe("skipped_asymmetric");
  });

  it("classifyIndicator returns 'asymmetric' for connors_rsi2", () => {
    expect(classifyIndicator("connors_rsi2")).toBe("asymmetric");
  });
});

// ─── Test 5: raschke_holy_grail → hard asymmetric, never promoted ─────────────

describe("raschke_holy_grail long-only strategy (hard asymmetric)", () => {
  it("is NOT promoted — skipped_asymmetric", () => {
    const row = makeRow({ direction: "long", entry_indicator: "raschke_holy_grail" });
    const result = computePromotion(row);
    expect(result.outcome).toBe("skipped_asymmetric");
  });

  it("classifyIndicator returns 'asymmetric' for raschke_holy_grail", () => {
    expect(classifyIndicator("raschke_holy_grail")).toBe("asymmetric");
  });
});

// ─── Test 6: direction='both' already → idempotent skip ───────────────────────

describe("strategy already at direction='both'", () => {
  it("returns skipped_already_both — no double-promotion", () => {
    const row = makeRow({ direction: "both" });
    const result = computePromotion(row);
    expect(result.outcome).toBe("skipped_already_both");
  });

  it("running twice yields same skipped_already_both outcome", () => {
    const row = makeRow({ direction: "both" });
    // First call
    expect(computePromotion(row).outcome).toBe("skipped_already_both");
    // Simulate second call after config was updated (direction='both' set)
    const promoted = { ...row, config: { ...row.config, direction: "both" } };
    expect(computePromotion(promoted).outcome).toBe("skipped_already_both");
  });
});

// ─── Test 7: wyckoff_spring (long-only symmetric archetype) → promoted ────────

describe("wyckoff_spring long-only (symmetric archetype)", () => {
  it("is promoted to direction='both'", () => {
    const row = makeRow({ direction: "long", entry_indicator: "wyckoff_spring" });
    const result = computePromotion(row);
    expect(result.outcome).toBe("promoted");
  });

  it("classifyIndicator returns 'symmetric' for wyckoff_spring", () => {
    expect(classifyIndicator("wyckoff_spring")).toBe("symmetric");
  });

  it("classifyIndicator returns 'symmetric' for wyckoff_upthrust", () => {
    expect(classifyIndicator("wyckoff_upthrust")).toBe("symmetric");
  });
});

// ─── Test 8: archetype:fvg long-only → promoted ───────────────────────────────

describe("archetype:fvg long-only strategy", () => {
  it("is promoted (archetype prefix is handled)", () => {
    const row = makeRow({
      direction: "long",
      entry_indicator: "archetype:fvg",
      entry_params: {},
    });
    const result = computePromotion(row);
    // archetype:fvg compiles to structural sentinel — still a valid promotion
    expect(result.outcome).toBe("promoted");
  });

  it("classifyIndicator returns 'symmetric' for archetype:fvg", () => {
    expect(classifyIndicator("archetype:fvg")).toBe("symmetric");
  });

  it("classifyIndicator returns 'symmetric' for archetype:liquidity_sweep", () => {
    expect(classifyIndicator("archetype:liquidity_sweep")).toBe("symmetric");
  });
});

// ─── Test 9: unknown indicator → skipped_unknown (manual review) ──────────────

describe("unknown entry_indicator", () => {
  it("returns skipped_unknown for an unrecognized indicator", () => {
    const row = makeRow({
      direction: "long",
      entry_indicator: "some_proprietary_indicator_xyz",
    });
    const result = computePromotion(row);
    expect(result.outcome).toBe("skipped_unknown");
    expect(result.error).toContain("manual review required");
  });

  it("classifyIndicator returns 'unknown' for unrecognized names", () => {
    expect(classifyIndicator("some_unknown_ind")).toBe("unknown");
    expect(classifyIndicator("archetype:unknown_archetype")).toBe("unknown");
  });
});

// ─── Test 10: buildPromotedConfig correct field mutations ─────────────────────

describe("buildPromotedConfig", () => {
  it("sets direction='both', mirror_inferred=true, updates entry_short", () => {
    const row = makeRow({ direction: "long", entry_indicator: "macd_crossover" });
    const result = computePromotion(row);
    expect(result.outcome).toBe("promoted");
    const newConfig = buildPromotedConfig(row.config, result.entry_short_grammar!);
    expect(newConfig.direction).toBe("both");
    expect(newConfig.mirror_inferred).toBe(true);
    expect((newConfig.strategy as any).entry_short).toBe(result.entry_short_grammar);
  });

  it("preserves all other fields unchanged", () => {
    const row = makeRow({ direction: "long", entry_indicator: "vwap_reversion" });
    const result = computePromotion(row);
    const newConfig = buildPromotedConfig(row.config, result.entry_short_grammar!);
    // These must be unchanged
    expect(newConfig.exit_type).toBe(row.config.exit_type);
    expect(newConfig.time_stop).toEqual(row.config.time_stop);
    expect(newConfig.regime_gate).toEqual(row.config.regime_gate);
    expect(newConfig.session_filter).toEqual(row.config.session_filter);
  });
});

// ─── Test 11: audit passes on promoted config ─────────────────────────────────

describe("audit() on promoted config", () => {
  it("ORB strategy promoted to both → 0 audit defects", () => {
    const row = makeRow({
      direction: "long",
      entry_indicator: "session_open_breakout",
      entry_params: { range_minutes: 15 },
    });
    const result = computePromotion(row);
    expect(result.outcome).toBe("promoted");
    const newConfig = buildPromotedConfig(row.config, result.entry_short_grammar!);
    // Update entry_long to make it realistic for ORB
    (newConfig.strategy as any).entry_long = "close > orh_15m";
    const auditResult = audit({ name: row.name, symbol: "MES", config: newConfig });
    expect(auditResult.defects).toHaveLength(0);
  });

  it("ema_crossover promoted to both → 0 audit defects", () => {
    const row = makeRow({
      direction: "long",
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
    });
    const result = computePromotion(row);
    const newConfig = buildPromotedConfig(row.config, result.entry_short_grammar!);
    const auditResult = audit({ name: row.name, symbol: "MES", config: newConfig });
    expect(auditResult.defects).toHaveLength(0);
  });
});

// ─── Test 12: classifyIndicator coverage ─────────────────────────────────────

describe("classifyIndicator — canonical coverage", () => {
  const symmetricCases = [
    "ema_crossover", "sma_crossover", "dema_crossover", "macd_crossover",
    "atr_breakout", "bollinger_breakout", "donchian_breakout",
    "rsi_reversal", "rsi_divergence",
    "vwap_fade", "vwap_reversion", "mean_reversion",
    "session_open_breakout",
    "supertrend", "ichimoku_cloud", "cumulative_delta",
    "liquidity_sweep", "order_block", "fvg", "fvg_retrace",
    "breaker_block", "ict_silver_bullet_ny_am", "judas_swing",
    "wyckoff_spring", "wyckoff_upthrust",
  ];

  for (const ind of symmetricCases) {
    it(`classifies '${ind}' as symmetric`, () => {
      expect(classifyIndicator(ind)).toBe("symmetric");
    });
  }

  const asymmetricCases = ["connors_rsi2", "raschke_holy_grail"];
  for (const ind of asymmetricCases) {
    it(`classifies '${ind}' as asymmetric`, () => {
      expect(classifyIndicator(ind)).toBe("asymmetric");
    });
  }

  it("classifies archetype:order_block as symmetric", () => {
    expect(classifyIndicator("archetype:order_block")).toBe("symmetric");
  });

  it("classifies archetype:unknown_concept as unknown", () => {
    expect(classifyIndicator("archetype:unknown_concept")).toBe("unknown");
  });
});
