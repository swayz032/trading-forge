/**
 * W23G.1 — Audit logic spec tests.
 *
 * Verifies the audit() function from scripts/audit-graduated-strategy-dsls.ts
 * correctly accepts Wave 23 (Style C + risk_derived_pyramid + direction='both')
 * and Wave 22 legacy (Style D + profit_tier_pyramid + single-direction) strategies,
 * and correctly flags actual defects.
 *
 * Pure function tests — no DB, no network.
 *
 * Test cases:
 *  1.  Wave 23 strategy: risk_derived_pyramid + direction='both' + Style C → 0 defects
 *  2.  Wave 22 legacy: profit_tier_pyramid + direction='long' + Style D → 0 defects
 *  3.  direction='both' but entry_short empty → flags defect
 *  4.  direction='both' but entry_long empty → flags defect
 *  5.  risk_derived_pyramid with baked max_contracts → flagged as defect
 *  6.  profit_tier_pyramid without max_contracts → flagged as defect
 *  7.  Unknown position_size.type → flagged
 *  8.  Unknown direction value → flagged
 *  9.  exit_params with neither Style C nor Style D shape → flagged
 *  10. metadata.source !== 'graduated_bucket' → flagged
 *  11. stop_loss not atr → flagged
 *  12. stop_loss.multiplier out of range → flagged
 *  13. time_stop incorrect → flagged
 *  14. regime_gate disabled → flagged
 *  15. session_filter not RTH_ONLY → flagged
 *  16. strategy.exit contains template hole → flagged
 *  17. empty indicators array → flagged
 *  18. Wave 23 direction='long' (single) + risk_derived_pyramid + Style C → 0 defects
 *  19. Wave 23 direction='short' (single) + risk_derived_pyramid + Style C → 0 defects
 *  20. direction='long' with non-empty entry_short → warning (not defect)
 */

import { describe, it, expect } from "vitest";
    // @ts-ignore — W0.3 mock cast; vitest mock object does not structurally match Drizzle builder return type
import { audit } from "../../../scripts/audit-graduated-strategy-dsls.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal valid Wave 23 config (Style C + risk_derived_pyramid + direction='both') */
function makeWave23Config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metadata: { source: "graduated_bucket" },
    direction: "both",
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
      partial_at_r: 1.0,
      move_stop_to: "BE+1tick",
      trail: { type: "chandelier", atr_period: 14, multiplier: 2.0 },
      tp1_at_r: 1.0,
      tp2_at_r: 2.0,
    },
    time_stop: { type: "hard_flatten", flat_at: "15:55 ET" },
    regime_gate: { enabled: true },
    session_filter: { enabled: true, session: "RTH_ONLY" },
    entry_type: "ema_crossover",
    strategy: {
      exit: "high < low",
      entry_long: "ema_9 crosses_above ema_21",
      entry_short: "ema_9 crosses_below ema_21",
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
    ...overrides,
  };
}

/** Minimal valid Wave 22 legacy config (Style D + profit_tier_pyramid + direction='long') */
function makeWave22Config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metadata: { source: "graduated_bucket" },
    direction: "long",
    exit_type: "trailing_stop",
    exit_params: {
      partial_at_r: 1,
      move_stop_to: "BE+1tick",
      trail: { type: "chandelier", atr_period: 14, multiplier: 2 },
    },
    time_stop: { type: "hard_flatten", flat_at: "15:55 ET" },
    regime_gate: { enabled: true },
    session_filter: { enabled: true, session: "RTH_ONLY" },
    entry_type: "rsi_reversal",
    strategy: {
      exit: "high < low",
      entry_long: "rsi_14 < 30",
      entry_short: "",
      indicators: [{ type: "rsi", period: 14 }],
      stop_loss: { type: "atr", multiplier: 1.5 },
      position_size: {
        type: "profit_tier_pyramid",
        base_contracts: 6,
        tier_increment: 3,
        tier_threshold_dollars: 3000,
        max_contracts: 12,
        personal_dll_pct: 0.67,
      },
    },
    ...overrides,
  };
}

function makeRow(config: Record<string, unknown>) {
  return { name: "test_strategy", symbol: "MES", config };
}

// ─── Test 1: Wave 23 canonical — risk_derived_pyramid + direction='both' + Style C ──

describe("Wave 23 canonical strategy (risk_derived_pyramid + both + Style C)", () => {
  it("produces 0 defects", () => {
    const result = audit(makeRow(makeWave23Config()));
    expect(result.defects).toHaveLength(0);
  });

  it("may have zero or non-zero warnings (warnings don't block)", () => {
    const result = audit(makeRow(makeWave23Config()));
    // Warnings are acceptable — only defects are blocking
    expect(result.defects).toHaveLength(0);
  });
});

// ─── Test 2: Wave 22 legacy — profit_tier_pyramid + direction='long' + Style D ──

describe("Wave 22 legacy strategy (profit_tier_pyramid + long + Style D)", () => {
  it("produces 0 defects", () => {
    const result = audit(makeRow(makeWave22Config()));
    expect(result.defects).toHaveLength(0);
  });
});

// ─── Test 3: direction='both' entry_short empty ───────────────────────────────

describe("direction='both' with missing entry_short", () => {
  it("flags entry_short empty when direction='both'", () => {
    const cfg = makeWave23Config();
    (cfg.strategy as any).entry_short = "";
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("entry_short") && d.includes("empty"))).toBe(true);
  });
});

// ─── Test 4: direction='both' entry_long empty ───────────────────────────────

describe("direction='both' with missing entry_long", () => {
  it("flags entry_long empty when direction='both'", () => {
    const cfg = makeWave23Config();
    (cfg.strategy as any).entry_long = "";
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("entry_long") && d.includes("empty"))).toBe(true);
  });
});

// ─── Test 5: risk_derived_pyramid with baked max_contracts ────────────────────

describe("risk_derived_pyramid with baked max_contracts", () => {
  it("flags max_contracts as defect (must be absent, computed at signal-time)", () => {
    const cfg = makeWave23Config();
    (cfg.strategy as any).position_size.max_contracts = 20;
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("max_contracts"))).toBe(true);
  });
});

// ─── Test 6: profit_tier_pyramid without max_contracts ───────────────────────

describe("profit_tier_pyramid without max_contracts", () => {
  it("flags missing max_contracts as defect (required for legacy type)", () => {
    const cfg = makeWave22Config();
    delete (cfg.strategy as any).position_size.max_contracts;
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("max_contracts"))).toBe(true);
  });
});

// ─── Test 7: Unknown position_size type ──────────────────────────────────────

describe("unknown position_size.type", () => {
  it("flags unrecognized type", () => {
    const cfg = makeWave23Config();
    (cfg.strategy as any).position_size.type = "fixed_contracts";
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("position_size.type"))).toBe(true);
  });
});

// ─── Test 8: Unknown direction ────────────────────────────────────────────────

describe("invalid direction value", () => {
  it("flags direction not in {long, short, both}", () => {
    const cfg = makeWave23Config({ direction: "unknown" });
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("direction"))).toBe(true);
  });

  it("does NOT flag valid direction='both'", () => {
    const cfg = makeWave23Config({ direction: "both" });
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("direction =") && d.includes("both"))).toBe(false);
  });
});

// ─── Test 9: exit_params with unrecognized shape ─────────────────────────────

describe("exit_params with neither Style C nor Style D", () => {
  it("flags unrecognized exit_params shape", () => {
    const cfg = makeWave23Config({ exit_params: { some_random_field: true } });
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("exit_params not recognized"))).toBe(true);
  });
});

// ─── Test 10: wrong metadata.source ──────────────────────────────────────────

describe("metadata.source !== 'graduated_bucket'", () => {
  it("flags wrong source", () => {
    const cfg = makeWave23Config({ metadata: { source: "openclaw" } });
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("metadata.source"))).toBe(true);
  });
});

// ─── Test 11: stop_loss not atr ───────────────────────────────────────────────

describe("stop_loss.type is not atr", () => {
  it("flags fixed-point stop", () => {
    const cfg = makeWave23Config();
    (cfg.strategy as any).stop_loss = { type: "fixed", distance: 10 };
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("stop_loss.type"))).toBe(true);
  });
});

// ─── Test 12: stop_loss.multiplier out of range ───────────────────────────────

describe("stop_loss.multiplier out of range", () => {
  it("flags multiplier > 5", () => {
    const cfg = makeWave23Config();
    (cfg.strategy as any).stop_loss = { type: "atr", multiplier: 7 };
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("stop_loss.multiplier"))).toBe(true);
  });

  it("flags multiplier < 0.5", () => {
    const cfg = makeWave23Config();
    (cfg.strategy as any).stop_loss = { type: "atr", multiplier: 0.1 };
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("stop_loss.multiplier"))).toBe(true);
  });

  it("accepts multiplier at boundary values 0.5 and 5.0", () => {
    const cfg05 = makeWave23Config();
    (cfg05.strategy as any).stop_loss = { type: "atr", multiplier: 0.5 };
    expect(audit(makeRow(cfg05)).defects.some(d => d.includes("stop_loss.multiplier"))).toBe(false);

    const cfg5 = makeWave23Config();
    (cfg5.strategy as any).stop_loss = { type: "atr", multiplier: 5.0 };
    expect(audit(makeRow(cfg5)).defects.some(d => d.includes("stop_loss.multiplier"))).toBe(false);
  });
});

// ─── Test 13: time_stop incorrect ─────────────────────────────────────────────

describe("time_stop shape", () => {
  it("flags wrong time_stop.type", () => {
    const cfg = makeWave23Config({ time_stop: { type: "soft_close", flat_at: "15:55 ET" } });
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("time_stop.type"))).toBe(true);
  });

  it("flags wrong flat_at time", () => {
    const cfg = makeWave23Config({ time_stop: { type: "hard_flatten", flat_at: "16:00 ET" } });
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("time_stop.flat_at"))).toBe(true);
  });
});

// ─── Test 14: regime_gate disabled ───────────────────────────────────────────

describe("regime_gate disabled", () => {
  it("flags regime_gate.enabled=false", () => {
    const cfg = makeWave23Config({ regime_gate: { enabled: false } });
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("regime_gate.enabled"))).toBe(true);
  });
});

// ─── Test 15: session_filter not RTH_ONLY ────────────────────────────────────

describe("session_filter not RTH_ONLY", () => {
  it("flags wrong session", () => {
    const cfg = makeWave23Config({ session_filter: { enabled: true, session: "ETH_ONLY" } });
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("session_filter"))).toBe(true);
  });

  it("flags disabled session_filter", () => {
    const cfg = makeWave23Config({ session_filter: { enabled: false, session: "RTH_ONLY" } });
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("session_filter"))).toBe(true);
  });
});

// ─── Test 16: template hole in strategy.exit ─────────────────────────────────

describe("strategy.exit template holes", () => {
  it("flags N/A in exit prose", () => {
    const cfg = makeWave23Config();
    (cfg.strategy as any).exit = "N/A";
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("template hole"))).toBe(true);
  });

  it("flags {{placeholder}} in exit prose", () => {
    const cfg = makeWave23Config();
    (cfg.strategy as any).exit = "{{EXIT_RULE}}";
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("template hole"))).toBe(true);
  });

  it("flags <PLACEHOLDER> in exit prose", () => {
    const cfg = makeWave23Config();
    (cfg.strategy as any).exit = "<EXIT_RULE>";
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("template hole"))).toBe(true);
  });
});

// ─── Test 17: empty indicators ───────────────────────────────────────────────

describe("empty indicators array", () => {
  it("flags empty indicators", () => {
    const cfg = makeWave23Config();
    (cfg.strategy as any).indicators = [];
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("indicators"))).toBe(true);
  });
});

// ─── Test 18: Wave 23 direction='long' single + risk_derived_pyramid + Style C ─

describe("Wave 23 direction='long' (single-direction) + risk_derived_pyramid + Style C", () => {
  it("produces 0 defects", () => {
    const cfg = makeWave23Config({ direction: "long" });
    const result = audit(makeRow(cfg));
    expect(result.defects).toHaveLength(0);
  });
});

// ─── Test 19: Wave 23 direction='short' (single) + risk_derived_pyramid + Style C ─

describe("Wave 23 direction='short' (single-direction) + risk_derived_pyramid + Style C", () => {
  it("produces 0 defects", () => {
    const cfg = makeWave23Config({ direction: "short" });
    // ensure entry_short is present, entry_long can be empty for short-only
    (cfg.strategy as any).entry_long = "high < low"; // never-true sentinel is non-empty
    const result = audit(makeRow(cfg));
    expect(result.defects).toHaveLength(0);
  });
});

// ─── Test 20: direction='long' with non-empty entry_short → warning, not defect ─

describe("direction='long' with non-empty entry_short", () => {
  it("issues warning (not defect) for extra entry_short text", () => {
    const cfg = makeWave22Config();
    (cfg.strategy as any).entry_short = "rsi_14 > 70";
    const result = audit(makeRow(cfg));
    // Must be a warning, not a defect
    expect(result.warnings.some(w => w.includes("entry_short"))).toBe(true);
    expect(result.defects.some(d => d.includes("entry_short") && d.includes("empty"))).toBe(false);
  });
});

// ─── Style C — additional coverage ───────────────────────────────────────────

describe("Style C exit_params — runner trail_fallback validation", () => {
  it("flags wrong chandelier atr_period", () => {
    const cfg = makeWave23Config();
    (cfg.exit_params as any).runner.trail_fallback.atr_period = 20;
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("atr_period"))).toBe(true);
  });

  it("flags wrong chandelier multiplier", () => {
    const cfg = makeWave23Config();
    (cfg.exit_params as any).runner.trail_fallback.multiplier = 3;
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("multiplier"))).toBe(true);
  });

  it("flags wrong tp1_at_r", () => {
    const cfg = makeWave23Config();
    (cfg.exit_params as any).tp1_at_r = 2;
    delete (cfg.exit_params as any).partial_at_r;
    delete (cfg.exit_params as any).partials;
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("tp1_at_r"))).toBe(true);
  });

  it("flags wrong tp2_at_r", () => {
    const cfg = makeWave23Config();
    (cfg.exit_params as any).tp2_at_r = 3;
    delete (cfg.exit_params as any).partials;
    const result = audit(makeRow(cfg));
    expect(result.defects.some(d => d.includes("tp2_at_r"))).toBe(true);
  });
});
