/**
 * DSL Translator — Trail Stop W5b Field Mapping (Cleanup Team D / Tier 5.1)
 *
 * Verifies that translateDSLToPaperConfig() now emits the three Tier 5.1
 * trail-stop extensions (`break_even_at_r`, `time_decay_minutes`,
 * `time_decay_multiplier`) instead of silently dropping them. This closes the
 * contract gap between dsl-translator.ts and paper-signal-service.ts
 * `TrailStopConfig` (the latter shipped extended fields in W5b but the
 * translator was never updated).
 *
 * Backwards compat is asserted: legacy fixtures that only declare
 * `take_profit_atr_multiple` (no exit_params trail fields, no trail_config)
 * continue to produce IDENTICAL output to the pre-W5b translator.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { translateDSLToPaperConfig } from "../services/dsl-translator.js";

const BASE = {
  schema_version: "v1",
  name: "Trend MNQ",
  symbol: "MNQ",
  timeframe: "15m",
  direction: "both",
  entry_type: "trend_follow",
  entry_indicator: "ema_crossover",
  entry_params: { fast_period: 9, slow_period: 21 },
  entry_condition: "ema cross",
  exit_type: "trailing_stop",
  stop_loss_atr_multiple: 1.8,
  max_contracts: 10,
  session_filter: "RTH_ONLY",
};

describe("dsl-translator — trail_stop backwards compat", () => {
  it("legacy DSL with only take_profit_atr_multiple emits classic trail_stop", () => {
    const dsl = { ...BASE, take_profit_atr_multiple: 2.0, exit_params: {} };
    const out = translateDSLToPaperConfig(dsl);
    expect(out.trail_stop).toBeDefined();
    expect(out.trail_stop?.type).toBe("atr");
    expect(out.trail_stop?.multiplier).toBe(2.0);
    expect(out.trail_stop?.break_even_at_r).toBeUndefined();
    expect(out.trail_stop?.time_decay_minutes).toBeUndefined();
    expect(out.trail_stop?.time_decay_multiplier).toBeUndefined();
  });

  it("DSL with no trail signals at all emits trail_stop=undefined", () => {
    const dsl = { ...BASE, exit_type: "fixed_target", exit_params: { target: 500 } };
    const out = translateDSLToPaperConfig(dsl);
    expect(out.trail_stop).toBeUndefined();
  });
});

describe("dsl-translator — exit_params trail field mapping (W5b Tier 5.1)", () => {
  it("maps trail_atr from exit_params to trail_stop.multiplier", () => {
    const dsl = {
      ...BASE,
      exit_params: { trail_atr: 2.0 },
    };
    const out = translateDSLToPaperConfig(dsl);
    expect(out.trail_stop?.multiplier).toBe(2.0);
  });

  it("maps break_even_at_r from exit_params", () => {
    const dsl = {
      ...BASE,
      exit_params: { trail_atr: 2.0, break_even_at_r: 1.0 },
    };
    const out = translateDSLToPaperConfig(dsl);
    expect(out.trail_stop?.break_even_at_r).toBe(1.0);
  });

  it("maps time_decay_minutes and time_decay_multiplier from exit_params", () => {
    const dsl = {
      ...BASE,
      exit_params: {
        trail_atr: 2.0,
        time_decay_minutes: 20,
        time_decay_multiplier: 0.75,
      },
    };
    const out = translateDSLToPaperConfig(dsl);
    expect(out.trail_stop?.time_decay_minutes).toBe(20);
    expect(out.trail_stop?.time_decay_multiplier).toBe(0.75);
  });

  it("maps the full trend_mnq fixture exit_params block", () => {
    // Mirrors src/engine/strategies/dsl_fixtures/trend_mnq.json
    const dsl = {
      ...BASE,
      exit_params: {
        trail_atr: 2.0,
        break_even_at_r: 1.0,
        time_decay_minutes: 20,
        time_decay_multiplier: 0.75,
      },
    };
    const out = translateDSLToPaperConfig(dsl);
    expect(out.trail_stop).toEqual({
      type: "atr",
      multiplier: 2.0,
      break_even_at_r: 1.0,
      time_decay_minutes: 20,
      time_decay_multiplier: 0.75,
    });
  });
});

describe("dsl-translator — explicit trail_config block precedence", () => {
  it("prefers dsl.trail_config over exit_params when both are present", () => {
    const dsl = {
      ...BASE,
      exit_params: { trail_atr: 2.0, break_even_at_r: 0.5 },
      trail_config: {
        atr_multiple: 2.5,
        break_even_at_r: 1.0,
        time_decay_minutes: 30,
        time_decay_multiplier: 0.6,
      },
    };
    const out = translateDSLToPaperConfig(dsl);
    expect(out.trail_stop?.multiplier).toBe(2.5);
    expect(out.trail_stop?.break_even_at_r).toBe(1.0);
    expect(out.trail_stop?.time_decay_minutes).toBe(30);
    expect(out.trail_stop?.time_decay_multiplier).toBe(0.6);
  });

  it("supports zero values (e.g. time_decay_multiplier=0 collapses trail to HWM)", () => {
    const dsl = {
      ...BASE,
      exit_params: {
        trail_atr: 2.0,
        time_decay_minutes: 20,
        time_decay_multiplier: 0,
      },
    };
    const out = translateDSLToPaperConfig(dsl);
    expect(out.trail_stop?.time_decay_multiplier).toBe(0);
  });
});
