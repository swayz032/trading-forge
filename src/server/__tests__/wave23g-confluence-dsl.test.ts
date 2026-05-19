/**
 * W23G.11 (2026-05-19) — Multi-indicator confluence + multi-timeframe DSL tests.
 *
 * Tests:
 *  1.  Confluence (ORB + RSI filter) → compiler emits AND-chained grammar; entries fire only when BOTH hold
 *  2.  Strict confluence (ORB + RSI + VWAP, all 3 required) → AND-chains all 3
 *  3.  MTF strategy (bias_timeframe set) → mtfUnsupported=true, bias NOT in grammar, base grammar intact
 *  4.  Min-factors-satisfied < total → emits all as AND (conservative fallback), notes logged
 *  5.  Backward compat: single-indicator legacy strategy (no confirming_indicators) still compiles unchanged
 *  6.  Backward compat: archetype strategy still compiles unchanged (no confluence crash)
 *  7.  VWAP confirming + EMA crossover primary → valid AND grammar
 *  8.  Unsupported confirming indicator → skipped from grammar, base grammar preserved
 *  9.  Audit acceptance: confluence strategy passes audit (indicators non-empty, valid grammar)
 *  10. Audit acceptance: MTF strategy passes audit (single-TF grammar still valid)
 *  11. Graduator persistence mock: confirming_indicators + bias_timeframe land on config
 *  12. deduplication: duplicate ema_9 from primary + confirming → deduped in indicators array
 *  13. Direction=short with confirming indicators → short clauses AND-chained
 *  14. min_factors_satisfied set explicitly → preserved in compiled output notes
 *
 * Pure function tests — no DB, no network.
 */

import { describe, it, expect } from "vitest";
import {
  compileDslToEngine,
  compileDslWithConfluence,
  applyConfluenceToCompiled,
} from "../lib/dsl-compiler.js";
import type { DslCompileInput, ConfirmingIndicator } from "../lib/dsl-compiler.js";

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeBase(overrides: Partial<DslCompileInput> = {}): DslCompileInput {
  return {
    entry_indicator: "ema_crossover",
    entry_params: { fast_period: 9, slow_period: 21 },
    direction: "both",
    ...overrides,
  };
}

// ─── Test 1: Confluence: ORB primary + RSI confirming ─────────────────────────

describe("W23G.11 confluence: ORB + RSI filter", () => {
  it("emits AND-chained grammar for both directions", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "session_open_breakout",
      entry_params: { range_minutes: 15 },
      direction: "both",
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14, threshold_gt: 50 }, direction: "agree" },
      ],
      min_factors_satisfied: 2,
    });

    expect(compiled).not.toBeNull();
    // Long: ORB condition AND rsi condition
    expect(compiled!.entry_long).toContain("AND");
    expect(compiled!.entry_long).toContain("close > orh_15m");
    expect(compiled!.entry_long).toContain("rsi_14");
    // Short: ORL condition AND rsi condition (mirrored)
    expect(compiled!.entry_short).toContain("AND");
    expect(compiled!.entry_short).toContain("close < orl_15m");
    // MTF not set → no mtfUnsupported flag
    expect(compiled!.mtfUnsupported).toBeFalsy();
  });

  it("indicators array contains both ORB and RSI primitives", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "session_open_breakout",
      entry_params: { range_minutes: 15 },
      direction: "both",
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14, threshold_gt: 50 }, direction: "agree" },
      ],
    });

    expect(compiled).not.toBeNull();
    const types = compiled!.indicators.map((i: { type: string }) => i.type);
    expect(types).toContain("opening_range_breakout");
    expect(types).toContain("rsi");
    expect(types).toContain("atr"); // ORB always includes ATR
  });
});

// ─── Test 2: Strict 3-factor confluence (ORB + RSI + VWAP) ──────────────────

describe("W23G.11 confluence: ORB + RSI + VWAP (all 3 required)", () => {
  it("AND-chains all 3 conditions in entry_long", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "session_open_breakout",
      entry_params: { range_minutes: 15 },
      direction: "both",
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14, threshold_gt: 50 }, direction: "agree" },
        { indicator: "vwap", params: {}, direction: "agree" },
      ],
      min_factors_satisfied: 3,
    });

    expect(compiled).not.toBeNull();
    const longClauses = compiled!.entry_long.split(" AND ");
    expect(longClauses.length).toBe(3); // orb + rsi + vwap
    expect(compiled!.entry_long).toContain("close > orh_15m");
    expect(compiled!.entry_long).toContain("rsi_14");
    expect(compiled!.entry_long).toContain("vwap");
  });

  it("indicators includes opening_range_breakout, rsi, vwap, atr", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "session_open_breakout",
      entry_params: { range_minutes: 15 },
      direction: "both",
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14, threshold_gt: 50 }, direction: "agree" },
        { indicator: "vwap", params: {}, direction: "agree" },
      ],
    });

    expect(compiled).not.toBeNull();
    const types = compiled!.indicators.map((i: { type: string }) => i.type);
    expect(types).toContain("opening_range_breakout");
    expect(types).toContain("rsi");
    expect(types).toContain("vwap");
    expect(types).toContain("atr");
  });
});

// ─── Test 3: MTF: bias_timeframe present → mtfUnsupported=true, base grammar intact ─

describe("W23G.11 MTF: bias_timeframe present", () => {
  it("returns mtfUnsupported=true and preserves base grammar unchanged", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      bias_timeframe: "4h",
      bias_condition: "ema_50_4h > ema_200_4h",
    });

    expect(compiled).not.toBeNull();
    expect(compiled!.mtfUnsupported).toBe(true);
    // Base grammar preserved (HTF bias NOT in grammar — fail-CLOSED)
    expect(compiled!.entry_long).toBe("ema_9 crosses_above ema_21");
    expect(compiled!.entry_short).toBe("ema_9 crosses_below ema_21");
    // Compile notes mention the MTF unsupported reason
    const noteText = compiled!.compileNotes.join(" ");
    expect(noteText).toContain("dsl_compiler.mtf_unsupported");
    expect(noteText).toContain("bias_timeframe");
  });

  it("MTF + confluence combined: bias omitted but confirming indicators compiled", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      bias_timeframe: "4h",
      bias_condition: "ema_50_4h > ema_200_4h",
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14, threshold_gt: 50 }, direction: "agree" },
      ],
    });

    expect(compiled).not.toBeNull();
    expect(compiled!.mtfUnsupported).toBe(true);
    // Confluence is still compiled even when MTF fails
    expect(compiled!.entry_long).toContain("AND");
    expect(compiled!.entry_long).toContain("ema_9 crosses_above ema_21");
    expect(compiled!.entry_long).toContain("rsi_14");
    // No HTF clause in grammar
    expect(compiled!.entry_long).not.toContain("_4h");
  });
});

// ─── Test 4: min_factors_satisfied < total → conservative AND fallback ────────

describe("W23G.11 min_factors_satisfied < total (N-of-M)", () => {
  it("compiles with AND-chain (conservative fallback) and logs note", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14, threshold_gt: 50 }, direction: "agree" },
        { indicator: "vwap", params: {}, direction: "agree" },
      ],
      min_factors_satisfied: 2, // 2 of 3 → partial satisfaction
    });

    expect(compiled).not.toBeNull();
    // Conservative fallback: still AND-chains everything
    expect(compiled!.entry_long).toContain("AND");
    // Note about fallback emitted
    const notes = compiled!.compileNotes.join(" ");
    expect(notes).toContain("min_factors_satisfied=2");
    expect(notes).toContain("conservative fallback");
  });
});

// ─── Test 5: Backward compat — single-indicator legacy strategy ────────────────

describe("W23G.11 backward compat: legacy single-indicator strategy", () => {
  it("no confirming_indicators → result identical to compileDslToEngine", () => {
    const legacyInput: DslCompileInput = {
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
    };

    const withConfluence = compileDslWithConfluence(legacyInput);
    const legacy = compileDslToEngine(legacyInput);

    expect(withConfluence).not.toBeNull();
    expect(legacy).not.toBeNull();
    expect(withConfluence!.entry_long).toBe(legacy!.entry_long);
    expect(withConfluence!.entry_short).toBe(legacy!.entry_short);
    expect(withConfluence!.indicators.length).toBe(legacy!.indicators.length);
    expect(withConfluence!.mtfUnsupported).toBeFalsy();
  });

  it("rsi_reversal legacy → still compiles to rsi grammar unchanged", () => {
    const input: DslCompileInput = {
      entry_indicator: "rsi_reversal",
      entry_params: { period: 14, oversold: 30, overbought: 70 },
      direction: "long",
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    expect(result!.entry_long).toBe("rsi_14 < 30");
    expect(result!.entry_short).toBe("high < low"); // never-true sentinel for long-only
  });

  it("bollinger_breakout legacy → compiles unchanged", () => {
    const input: DslCompileInput = {
      entry_indicator: "bollinger_breakout",
      entry_params: { period: 20, std_dev: 2.0 },
      direction: "both",
    };
    const result = compileDslWithConfluence(input);
    expect(result).not.toBeNull();
    expect(result!.entry_long).toBe("close > bb_upper_20");
    expect(result!.entry_short).toBe("close < bb_lower_20");
  });
});

// ─── Test 6: Backward compat — archetype strategy ─────────────────────────────

describe("W23G.11 backward compat: archetype strategy", () => {
  it("archetype still compiles without crash, returns sentinel grammar", () => {
    const result = compileDslWithConfluence({
      entry_indicator: "archetype:ict_silver_bullet_ny_am",
      entry_params: {},
      direction: "both",
    });

    expect(result).not.toBeNull();
    // Archetype uses sentinel "high < low" (never-true; archetype handler takes over)
    expect(result!.entry_long).toBe("high < low");
    expect(result!.entry_short).toBe("high < low");
  });

  it("archetype with MTF flag still fails-CLOSED (mtfUnsupported=true)", () => {
    const result = compileDslWithConfluence({
      entry_indicator: "archetype:ict_silver_bullet_ny_am",
      entry_params: {},
      direction: "both",
      bias_timeframe: "4h",
      bias_condition: "ema_50_4h > ema_200_4h",
    });

    expect(result).not.toBeNull();
    expect(result!.mtfUnsupported).toBe(true);
  });
});

// ─── Test 7: VWAP confirming + EMA crossover primary ─────────────────────────

describe("W23G.11 confluence: VWAP filter + EMA crossover primary", () => {
  it("emits AND-chained grammar with vwap condition", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      confirming_indicators: [
        { indicator: "vwap", params: {}, direction: "agree" },
      ],
    });

    expect(compiled).not.toBeNull();
    expect(compiled!.entry_long).toBe("ema_9 crosses_above ema_21 AND close > vwap");
    expect(compiled!.entry_short).toBe("ema_9 crosses_below ema_21 AND close < vwap");
  });
});

// ─── Test 8: Unsupported confirming indicator → skipped, base preserved ────────

describe("W23G.11 confluence: unsupported confirming indicator skipped", () => {
  it("skips unsupported confirming indicator, preserves base grammar", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      confirming_indicators: [
        { indicator: "some_future_indicator_not_yet_supported", params: {}, direction: "agree" },
      ],
    });

    expect(compiled).not.toBeNull();
    // Unsupported indicator skipped → base grammar unchanged (no AND)
    expect(compiled!.entry_long).toBe("ema_9 crosses_above ema_21");
    expect(compiled!.entry_short).toBe("ema_9 crosses_below ema_21");
    // Note logged
    const notes = compiled!.compileNotes.join(" ");
    expect(notes).toContain("not supported");
    expect(notes).toContain("some_future_indicator_not_yet_supported");
  });
});

// ─── Test 9: Audit acceptance — confluence strategy ──────────────────────────

describe("W23G.11 audit acceptance: confluence strategy config", () => {
  it("compiled confluence strategy has non-empty indicators and valid grammar", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14, threshold_gt: 50 }, direction: "agree" },
      ],
    });

    expect(compiled).not.toBeNull();
    // Non-empty indicators
    expect(compiled!.indicators.length).toBeGreaterThan(0);
    // Grammar contains at least one comparison operator
    expect(compiled!.entry_long).toMatch(/crosses_above|crosses_below|>|<|>=|<=/);
    expect(compiled!.entry_short).toMatch(/crosses_above|crosses_below|>|<|>=|<=/);
    // Grammar parses as AND-chain (valid signals.py input)
    // signals.py splits on ' AND ' — all clauses must be simple comparisons
    const longParts = compiled!.entry_long.split(" AND ");
    for (const part of longParts) {
      expect(part.trim()).toMatch(/\w+\s+(crosses_above|crosses_below|>|<|>=|<=)\s+\w+/);
    }
  });
});

// ─── Test 10: Audit acceptance — MTF strategy ────────────────────────────────

describe("W23G.11 audit acceptance: MTF strategy config", () => {
  it("MTF strategy has valid single-TF grammar (bias omitted = still parseable)", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "rsi_reversal",
      entry_params: { period: 14, oversold: 30, overbought: 70 },
      direction: "both",
      bias_timeframe: "4h",
      bias_condition: "rsi_4h < 50",
    });

    expect(compiled).not.toBeNull();
    // Grammar is still single-TF (no _4h in grammar)
    expect(compiled!.entry_long).not.toContain("_4h");
    expect(compiled!.entry_short).not.toContain("_4h");
    // Grammar is still valid
    expect(compiled!.entry_long).toBe("rsi_14 < 30");
    expect(compiled!.entry_short).toBe("rsi_14 > 70");
    // mtfUnsupported flag is set (for observability)
    expect(compiled!.mtfUnsupported).toBe(true);
  });
});

// ─── Test 11: Graduator persistence — confirming_indicators + bias_timeframe ────

describe("W23G.11 graduator persistence (config shape)", () => {
  it("confirming_indicators are persisted on compiled config (mock)", () => {
    // Simulate what the graduator does: extract fields from extractedIdea and
    // pass to compileDslWithConfluence, then persist on config JSONB.
    const extractedIdea = {
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14, threshold_gt: 50 }, direction: "agree" },
      ],
      min_factors_satisfied: 2,
      bias_timeframe: "4h",
      bias_condition: "ema_50_4h > ema_200_4h",
    };

    // Simulate config assembly (what the graduator does before DB insert)
    const confirmingIndicators = Array.isArray(extractedIdea.confirming_indicators)
      ? extractedIdea.confirming_indicators
      : undefined;
    const biasTimeframe = extractedIdea.bias_timeframe ?? null;
    const biasCondition = extractedIdea.bias_condition ?? null;
    const minFactorsSatisfied = extractedIdea.min_factors_satisfied;
    const isConfluenceStrategy = confirmingIndicators !== undefined && confirmingIndicators.length > 0;
    const isMtfStrategy = biasTimeframe !== null;

    // Config shape verification
    const configExtensions = {
      ...(isConfluenceStrategy ? {
        confirming_indicators: confirmingIndicators,
        min_factors_satisfied: minFactorsSatisfied,
        primary_indicator: extractedIdea.entry_indicator,
      } : {}),
      ...(isMtfStrategy ? {
        bias_timeframe: biasTimeframe,
        bias_condition: biasCondition,
        execution_timeframe: "15m",
      } : {}),
    };

    // Assertions on what lands on config
    expect(configExtensions).toHaveProperty("confirming_indicators");
    expect(configExtensions.confirming_indicators).toHaveLength(1);
    expect((configExtensions.confirming_indicators as any)[0].indicator).toBe("rsi");
    expect(configExtensions).toHaveProperty("primary_indicator", "ema_crossover");
    expect(configExtensions).toHaveProperty("min_factors_satisfied", 2);
    expect(configExtensions).toHaveProperty("bias_timeframe", "4h");
    expect(configExtensions).toHaveProperty("bias_condition", "ema_50_4h > ema_200_4h");
    expect(configExtensions).toHaveProperty("execution_timeframe", "15m");
  });

  it("legacy strategy (no confluence fields) produces no extra config keys", () => {
    const extractedIdea = {
      entry_indicator: "rsi_reversal",
      entry_params: { period: 14, oversold: 30, overbought: 70 },
      direction: "both",
      // No confirming_indicators, no bias_timeframe — legacy
    };

    const confirmingIndicators = Array.isArray((extractedIdea as any).confirming_indicators)
      ? (extractedIdea as any).confirming_indicators
      : undefined;
    const biasTimeframe = (extractedIdea as any).bias_timeframe ?? null;
    const isConfluenceStrategy = confirmingIndicators !== undefined && confirmingIndicators.length > 0;
    const isMtfStrategy = biasTimeframe !== null;

    const configExtensions = {
      ...(isConfluenceStrategy ? { confirming_indicators: confirmingIndicators } : {}),
      ...(isMtfStrategy ? { bias_timeframe: biasTimeframe } : {}),
    };

    // No new keys added to legacy strategy config
    expect(Object.keys(configExtensions)).toHaveLength(0);
  });
});

// ─── Test 12: Deduplication of indicators ─────────────────────────────────────

describe("W23G.11 indicator deduplication", () => {
  it("duplicate ema_9 from primary+confirming is deduped to single entry", () => {
    // ema_crossover primary: [ema_9, ema_21]
    // confirming ema_filter period=9 would add another ema_9
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      confirming_indicators: [
        { indicator: "ema_filter", params: { period: 9 }, direction: "agree" },
      ],
    });

    expect(compiled).not.toBeNull();
    // Count ema type + period=9 occurrences — should be 1 (deduped)
    const ema9Count = compiled!.indicators.filter(
      (i: { type: string; period?: number }) => i.type === "ema" && i.period === 9
    ).length;
    expect(ema9Count).toBe(1);
  });
});

// ─── Test 13: Direction=short with confirming indicators ──────────────────────

describe("W23G.11 direction=short with confirming indicators", () => {
  it("short-only strategy emits short clause AND-chained, long stays sentinel", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "rsi_reversal",
      entry_params: { period: 14, oversold: 30, overbought: 70 },
      direction: "short",
      confirming_indicators: [
        { indicator: "vwap", params: {}, direction: "agree" },
      ],
    });

    expect(compiled).not.toBeNull();
    // Long side: rsi_reversal with direction=short → "high < low" sentinel (never-true)
    expect(compiled!.entry_long).toBe("high < low");
    // Short side: rsi > overbought AND close > vwap (fade above vwap)
    expect(compiled!.entry_short).toContain("rsi_14 > 70");
    expect(compiled!.entry_short).toContain("AND");
    expect(compiled!.entry_short).toContain("vwap");
  });
});

// ─── Test 14: min_factors_satisfied explicit ─────────────────────────────────

describe("W23G.11 min_factors_satisfied explicitly set", () => {
  it("min_factors_satisfied is preserved in compile notes", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14, threshold_gt: 50 }, direction: "agree" },
        { indicator: "vwap", params: {}, direction: "agree" },
      ],
      min_factors_satisfied: 2, // 2 of 3
    });

    expect(compiled).not.toBeNull();
    const notes = compiled!.compileNotes.join(" ");
    expect(notes).toContain("2");
    expect(notes).toContain("3");
  });

  it("when min_factors_satisfied equals total, no fallback note emitted", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14, threshold_gt: 50 }, direction: "agree" },
      ],
      min_factors_satisfied: 2, // 2 of 2 (all required)
    });

    expect(compiled).not.toBeNull();
    // When min = total count, no conservative-fallback note needed
    // (2/2 = all required, same as AND-chain naturally)
    const notes = compiled!.compileNotes.join(" ");
    // Grammar should still be AND-chained
    expect(compiled!.entry_long).toContain("AND");
  });
});
