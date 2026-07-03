/**
 * fade-inverter.test.ts — Wave B "Fade-the-Losers" (2026-07-03)
 *
 * Pure unit tests for invertStrategyConfig. No DB, no I/O.
 * Covers: long-only->short-only + reverse, entry swap + sentinel placement,
 * `both`->skip, non-directional->skip, provenance stamped, stops/exits UNTOUCHED,
 * regime flip, name canonicalization, and already-faded idempotency (loop guard).
 */
import { describe, it, expect } from "vitest";
import {
  invertStrategyConfig,
  BIDIR_SENTINEL,
  FADE_SOURCE,
  type FadeInverterInput,
} from "../fade-inverter.js";

type Dict = Record<string, unknown>;

function longOnlyConfig(): Dict {
  return {
    direction: "long",
    entry_type: "breakout",
    entry_indicator: "session_open_breakout",
    entry_long_prose: "buy when price breaks the opening range high",
    regime_gate: { enabled: true, preferred_regime: "TRENDING_UP" },
    // Structural — must NOT be inverted (flips with direction automatically).
    take_profit: { type: "atr_multiple", multiplier: 3 },
    exit_type: "trailing_stop",
    exit_params: { style: "c", partials: [{ at_r: 1.0, size_pct: 0.33 }] },
    time_stop: { type: "hard_flatten", flat_at: "15:55 ET" },
    entry_quality: { confluence_factors: ["structural_setup", "vp_shape"], use_weighted_scoring: false },
    strategy: {
      name: "orb_long_loser_mes_5m",
      symbol: "MES",
      timeframe: "5m",
      entry_long: "close > orh_15m",
      entry_short: BIDIR_SENTINEL,
      stop_loss: { type: "atr", multiplier: 1.5 },
      position_size: { type: "risk_derived_pyramid", personal_dll_pct: 0.67 },
    },
  };
}

function shortOnlyConfig(): Dict {
  const c = longOnlyConfig();
  c.direction = "short";
  c.regime_gate = { enabled: true, preferred_regime: "TRENDING_DOWN" };
  delete c.entry_long_prose;
  (c as Dict).entry_short_prose = "sell when price breaks the opening range low";
  (c.strategy as Dict).name = "orb_short_loser_mnq_5m";
  (c.strategy as Dict).symbol = "MNQ";
  (c.strategy as Dict).entry_long = BIDIR_SENTINEL;
  (c.strategy as Dict).entry_short = "close < orl_15m";
  return c;
}

const meta = (config: Dict, id = "orig-uuid-1", name = "orb_long_loser_mes_5m"): FadeInverterInput => ({
  config,
  originalId: id,
  originalName: name,
});

describe("fade-inverter — long-only -> short-only", () => {
  it("flips direction long -> short", () => {
    const res = invertStrategyConfig(meta(longOnlyConfig()));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.originalDirection).toBe("long");
    expect(res.invertedDirection).toBe("short");
    expect(res.config.direction).toBe("short");
  });

  it("moves the losing long-entry condition onto the short side; long side becomes the sentinel", () => {
    const res = invertStrategyConfig(meta(longOnlyConfig()));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const strat = res.config.strategy as Dict;
    expect(strat.entry_short).toBe("close > orh_15m"); // the losing long condition, now shorted
    expect(strat.entry_long).toBe(BIDIR_SENTINEL); // now-untraded side
  });

  it("does NOT mutate the caller's input (pure)", () => {
    const input = longOnlyConfig();
    invertStrategyConfig(meta(input));
    expect(input.direction).toBe("long");
    expect((input.strategy as Dict).entry_long).toBe("close > orh_15m");
    expect((input.strategy as Dict).entry_short).toBe(BIDIR_SENTINEL);
  });

  it("leaves stops / take-profit / Style-C exits / sizing / confluence UNTOUCHED", () => {
    const res = invertStrategyConfig(meta(longOnlyConfig()));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const strat = res.config.strategy as Dict;
    expect(strat.stop_loss).toEqual({ type: "atr", multiplier: 1.5 });
    expect(strat.position_size).toEqual({ type: "risk_derived_pyramid", personal_dll_pct: 0.67 });
    expect(res.config.take_profit).toEqual({ type: "atr_multiple", multiplier: 3 });
    expect(res.config.exit_type).toBe("trailing_stop");
    expect(res.config.exit_params).toEqual({ style: "c", partials: [{ at_r: 1.0, size_pct: 0.33 }] });
    expect((res.config.entry_quality as Dict).confluence_factors).toEqual(["structural_setup", "vp_shape"]);
  });

  it("PRESERVES the regime (does NOT flip it) — fade fires on the same regime bar set as the loser", () => {
    const res = invertStrategyConfig(meta(longOnlyConfig()));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((res.config.regime_gate as Dict).preferred_regime).toBe("TRENDING_UP");
  });

  it("stamps provenance (faded_from + source) and a canonicalized _fade name", () => {
    const res = invertStrategyConfig(meta(longOnlyConfig(), "orig-uuid-42", "ORB Long Loser MES 5m"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.faded_from).toBe("orig-uuid-42");
    expect(res.config.source).toBe(FADE_SOURCE);
    expect((res.config.metadata as Dict).source).toBe(FADE_SOURCE);
    expect((res.config.metadata as Dict).faded_from).toBe("orig-uuid-42");
    expect(res.fadedFrom).toBe("orig-uuid-42");
    // canonicalized (lowercase, non-alnum -> _) + _fade suffix
    expect(res.name).toBe("orb_long_loser_mes_5m_fade");
  });

  it("DROPS entry prose on inversion (a flipped 'buy when…' would be misleading)", () => {
    const res = invertStrategyConfig(meta(longOnlyConfig()));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect("entry_long_prose" in res.config).toBe(false);
    expect("entry_short_prose" in res.config).toBe(false);
  });
});

describe("fade-inverter — short-only -> long-only (reverse)", () => {
  it("flips direction short -> long and moves the losing short condition onto the long side", () => {
    const res = invertStrategyConfig(meta(shortOnlyConfig(), "orig-uuid-2", "orb_short_loser_mnq_5m"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.originalDirection).toBe("short");
    expect(res.invertedDirection).toBe("long");
    const strat = res.config.strategy as Dict;
    expect(strat.entry_long).toBe("close < orl_15m"); // losing short condition, now longed
    expect(strat.entry_short).toBe(BIDIR_SENTINEL);
    // Regime PRESERVED — the short-only original was TRENDING_DOWN; stays so.
    expect((res.config.regime_gate as Dict).preferred_regime).toBe("TRENDING_DOWN");
    expect(res.name).toBe("orb_short_loser_mnq_5m_fade");
  });
});

describe("fade-inverter — refusals (discriminated result, never fabricates)", () => {
  it("refuses direction: both", () => {
    const c = longOnlyConfig();
    c.direction = "both";
    (c.strategy as Dict).entry_short = "close < orl_15m"; // make it genuinely bidirectional
    const res = invertStrategyConfig(meta(c));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("direction_both");
  });

  it("refuses a non-directional config (both entry sides disabled)", () => {
    const c = longOnlyConfig();
    (c.strategy as Dict).entry_long = BIDIR_SENTINEL;
    (c.strategy as Dict).entry_short = BIDIR_SENTINEL;
    const res = invertStrategyConfig(meta(c));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not_directional");
  });

  it("refuses a contradictory config (direction=long but only entry_short active)", () => {
    const c = longOnlyConfig();
    c.direction = "long";
    (c.strategy as Dict).entry_long = BIDIR_SENTINEL; // long side disabled
    (c.strategy as Dict).entry_short = "close < orl_15m"; // but SHORT side is active
    const res = invertStrategyConfig(meta(c));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not_directional");
  });

  it("refuses a config missing a direction", () => {
    const c = longOnlyConfig();
    delete c.direction;
    delete (c.strategy as Dict).direction;
    const res = invertStrategyConfig(meta(c));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("missing_direction");
  });

  it("detects an already-faded config (no fade-of-fade loop) via config.faded_from", () => {
    const res1 = invertStrategyConfig(meta(longOnlyConfig()));
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;
    // Feeding the fade back in must be refused.
    const res2 = invertStrategyConfig(meta(res1.config, "fade-uuid", res1.name));
    expect(res2.ok).toBe(false);
    if (res2.ok) return;
    expect(res2.reason).toBe("already_faded");
  });

  it("detects already-faded via source tag alone", () => {
    const c = longOnlyConfig();
    c.source = FADE_SOURCE;
    const res = invertStrategyConfig(meta(c));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("already_faded");
  });
});
