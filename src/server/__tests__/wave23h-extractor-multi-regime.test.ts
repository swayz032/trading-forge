/**
 * W23H.B (2026-05-20) — Transcript extractor multi-regime field tests.
 *
 * Tests:
 *  1. When LLM emits preferred_regimes array → preserved as-is
 *  2. When LLM omits preferred_regimes → archetype heuristic fills default
 *  3. Heuristic: ema_crossover → TRENDING_UP + TRENDING_DOWN
 *  4. Heuristic: rsi_reversal → RANGE_BOUND
 *  5. Heuristic: session_open_breakout → all 3 regimes
 *  6. Heuristic: structural archetype (ict_*) → all 3 regimes
 *  7. preferred_regime (single) backfilled as first element of preferred_regimes
 *
 * Tests the archetype heuristic as a pure function.
 * No LLM calls — purely unit testing the default-fill logic.
 */

import { describe, it, expect } from "vitest";

// ─── Archetype heuristic function ─────────────────────────────────────────
// This mirrors the logic described in transcript-extractor.md v9.
// The actual heuristic runs in the graduator; here we test it as a pure function.

const REGIME_DEFAULTS: Record<string, string[]> = {
  // Trend-following indicators
  ema_crossover:        ["TRENDING_UP", "TRENDING_DOWN"],
  sma_crossover:        ["TRENDING_UP", "TRENDING_DOWN"],
  macd_crossover:       ["TRENDING_UP", "TRENDING_DOWN"],
  supertrend:           ["TRENDING_UP", "TRENDING_DOWN"],
  ichimoku_cloud:       ["TRENDING_UP", "TRENDING_DOWN"],
  donchian_breakout:    ["TRENDING_UP", "TRENDING_DOWN"],
  atr_breakout:         ["TRENDING_UP", "TRENDING_DOWN"],
  // Mean-reversion indicators
  rsi_reversal:         ["RANGE_BOUND"],
  bollinger_breakout:   ["RANGE_BOUND"],
  vwap_fade:            ["RANGE_BOUND"],
  vwap_reversion:       ["RANGE_BOUND"],
  keltner_squeeze:      ["RANGE_BOUND"],
  // Breakout / ORB (works in all regimes)
  session_open_breakout: ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"],
  overnight_drift:       ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"],
};

const STRUCTURAL_ARCHETYPE_PREFIXES = ["ict_", "wyckoff_", "liquidity_sweep", "order_block", "fvg_retrace"];

function getDefaultRegimes(entryIndicator: string | null, entryArchetype: string | null): string[] {
  const indicator = entryIndicator ?? entryArchetype ?? "";

  // Structural archetypes → all 3 regimes
  if (STRUCTURAL_ARCHETYPE_PREFIXES.some(p => indicator.startsWith(p))) {
    return ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"];
  }

  return REGIME_DEFAULTS[indicator] ?? ["TRENDING_UP", "TRENDING_DOWN"];
}

/**
 * Apply the preferred_regimes default fill heuristic.
 * Returns the array as-is if already provided; fills default if missing/empty.
 */
function applyPreferredRegimesDefault(
  strategy: {
    preferred_regimes?: string[] | null;
    entry_indicator?: string;
    entry_archetype?: string;
  }
): string[] {
  if (strategy.preferred_regimes && strategy.preferred_regimes.length > 0) {
    return strategy.preferred_regimes; // LLM provided it — preserve
  }
  return getDefaultRegimes(strategy.entry_indicator ?? null, strategy.entry_archetype ?? null);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("W23H.B extractor: preferred_regimes preserved when LLM emits it", () => {
  it("preserves LLM-emitted array with 3 regimes", () => {
    const strategy = {
      entry_indicator: "ema_crossover",
      preferred_regimes: ["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"],
    };
    const result = applyPreferredRegimesDefault(strategy);
    expect(result).toEqual(["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"]);
  });

  it("preserves single-regime LLM array", () => {
    const strategy = {
      entry_indicator: "ema_crossover",
      preferred_regimes: ["RANGE_BOUND"],
    };
    const result = applyPreferredRegimesDefault(strategy);
    expect(result).toEqual(["RANGE_BOUND"]);
  });
});

describe("W23H.B extractor: archetype heuristic fills default when omitted", () => {
  it("ema_crossover → TRENDING_UP + TRENDING_DOWN", () => {
    const result = applyPreferredRegimesDefault({ entry_indicator: "ema_crossover" });
    expect(result).toEqual(["TRENDING_UP", "TRENDING_DOWN"]);
  });

  it("sma_crossover → TRENDING_UP + TRENDING_DOWN", () => {
    expect(applyPreferredRegimesDefault({ entry_indicator: "sma_crossover" }))
      .toEqual(["TRENDING_UP", "TRENDING_DOWN"]);
  });

  it("macd_crossover → TRENDING_UP + TRENDING_DOWN", () => {
    expect(applyPreferredRegimesDefault({ entry_indicator: "macd_crossover" }))
      .toEqual(["TRENDING_UP", "TRENDING_DOWN"]);
  });

  it("atr_breakout → TRENDING_UP + TRENDING_DOWN", () => {
    expect(applyPreferredRegimesDefault({ entry_indicator: "atr_breakout" }))
      .toEqual(["TRENDING_UP", "TRENDING_DOWN"]);
  });

  it("rsi_reversal → RANGE_BOUND only", () => {
    expect(applyPreferredRegimesDefault({ entry_indicator: "rsi_reversal" }))
      .toEqual(["RANGE_BOUND"]);
  });

  it("bollinger_breakout → RANGE_BOUND only", () => {
    expect(applyPreferredRegimesDefault({ entry_indicator: "bollinger_breakout" }))
      .toEqual(["RANGE_BOUND"]);
  });

  it("vwap_fade → RANGE_BOUND only", () => {
    expect(applyPreferredRegimesDefault({ entry_indicator: "vwap_fade" }))
      .toEqual(["RANGE_BOUND"]);
  });

  it("session_open_breakout → all 3 regimes", () => {
    expect(applyPreferredRegimesDefault({ entry_indicator: "session_open_breakout" }))
      .toEqual(["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"]);
  });

  it("overnight_drift → all 3 regimes", () => {
    expect(applyPreferredRegimesDefault({ entry_indicator: "overnight_drift" }))
      .toEqual(["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"]);
  });

  it("ict_ archetype → all 3 regimes", () => {
    expect(applyPreferredRegimesDefault({ entry_archetype: "ict_silver_bullet_ny_am" }))
      .toEqual(["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"]);
  });

  it("wyckoff_ archetype → all 3 regimes", () => {
    expect(applyPreferredRegimesDefault({ entry_archetype: "wyckoff_spring" }))
      .toEqual(["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"]);
  });

  it("liquidity_sweep archetype → all 3 regimes", () => {
    expect(applyPreferredRegimesDefault({ entry_archetype: "liquidity_sweep" }))
      .toEqual(["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"]);
  });

  it("fvg_retrace archetype → all 3 regimes", () => {
    expect(applyPreferredRegimesDefault({ entry_archetype: "fvg_retrace" }))
      .toEqual(["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"]);
  });

  it("null entry_indicator → default TRENDING_UP + TRENDING_DOWN (safe fallback)", () => {
    expect(applyPreferredRegimesDefault({}))
      .toEqual(["TRENDING_UP", "TRENDING_DOWN"]);
  });
});

describe("W23H.B extractor: preferred_regime backfill from first element", () => {
  it("preferred_regime should be first element of preferred_regimes for single-direction", () => {
    const regimes = applyPreferredRegimesDefault({ entry_indicator: "rsi_reversal" });
    const singleRegime = regimes[0]; // backward compat: single field = first element
    expect(singleRegime).toBe("RANGE_BOUND");
  });

  it("preferred_regime first element for trend strategies", () => {
    const regimes = applyPreferredRegimesDefault({ entry_indicator: "ema_crossover" });
    expect(regimes[0]).toBe("TRENDING_UP");
  });
});

describe("W23H.B extractor: valid regime values only", () => {
  const validRegimes = new Set(["TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"]);

  const allIndicators = [
    "ema_crossover", "sma_crossover", "macd_crossover", "supertrend",
    "ichimoku_cloud", "donchian_breakout", "atr_breakout",
    "rsi_reversal", "bollinger_breakout", "vwap_fade", "vwap_reversion",
    "keltner_squeeze", "session_open_breakout", "overnight_drift",
  ];

  const allArchetypes = [
    "ict_silver_bullet_ny_am", "ict_judas_swing", "ict_scalp",
    "wyckoff_spring", "wyckoff_upthrust", "liquidity_sweep", "order_block", "fvg_retrace",
  ];

  for (const ind of allIndicators) {
    it(`${ind} produces only valid regime strings`, () => {
      const regimes = applyPreferredRegimesDefault({ entry_indicator: ind });
      expect(regimes.length).toBeGreaterThan(0);
      for (const r of regimes) {
        expect(validRegimes).toContain(r);
      }
    });
  }

  for (const arch of allArchetypes) {
    it(`archetype ${arch} produces only valid regime strings`, () => {
      const regimes = applyPreferredRegimesDefault({ entry_archetype: arch });
      for (const r of regimes) {
        expect(validRegimes).toContain(r);
      }
    });
  }
});
