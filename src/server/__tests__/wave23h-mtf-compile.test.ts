/**
 * W23H.1 (2026-05-20) — DSL compiler MTF gate tests.
 *
 * Tests:
 *  1. bias_timeframe present + bias_condition → entry_long contains AND-gated grammar
 *  2. bias_timeframe present + bias_condition → entry_short also AND-gated
 *  3. Without bias_timeframe → original LTF-only grammar (backward compat)
 *  4. bias_timeframe but no bias_condition → base grammar unchanged, advisory note
 *  5. MTF + confluence: all three conditions in grammar (bias + primary + confirming)
 *  6. Direction=long sentinel preserves never-true entry_short even with MTF gate
 *  7. Exact grammar string test (load-bearing contract with engine signals.py)
 *
 * Must NOT regress wave23g-confluence-dsl.test.ts tests.
 *
 * Pure function tests — no DB, no network.
 */

import { describe, it, expect } from "vitest";
import {
  compileDslWithConfluence,
  applyConfluenceToCompiled,
  compileDslToEngine,
} from "../lib/dsl-compiler.js";
import type { DslCompileInput } from "../lib/dsl-compiler.js";

// ─── Test 1: bias_timeframe + bias_condition → entry_long AND-gated ──────────

describe("W23H.1 MTF: entry_long AND-gate with bias_condition", () => {
  it("emits AND-gated grammar for entry_long when bias_timeframe + bias_condition present", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      bias_timeframe: "4h",
      bias_condition: "ema_50_4h > ema_200_4h",
    });

    expect(compiled).not.toBeNull();
    // Must contain primary signal
    expect(compiled!.entry_long).toContain("ema_9 crosses_above ema_21");
    // Must contain bias condition
    expect(compiled!.entry_long).toContain("ema_50_4h > ema_200_4h");
    // Must be AND-chained
    expect(compiled!.entry_long).toContain("AND");
    // Must NOT be flagged as unsupported
    expect(compiled!.mtfUnsupported).toBeFalsy();
  });
});

// ─── Test 2: entry_short also AND-gated ───────────────────────────────────────

describe("W23H.1 MTF: entry_short AND-gate with bias_condition", () => {
  it("emits AND-gated grammar for entry_short too", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      bias_timeframe: "4h",
      bias_condition: "ema_50_4h > ema_200_4h",
    });

    expect(compiled).not.toBeNull();
    expect(compiled!.entry_short).toContain("ema_9 crosses_below ema_21");
    expect(compiled!.entry_short).toContain("ema_50_4h > ema_200_4h");
    expect(compiled!.entry_short).toContain("AND");
  });
});

// ─── Test 3: without bias_timeframe → LTF-only grammar (backward compat) ─────

describe("W23H.1 MTF: no bias_timeframe → original grammar unchanged", () => {
  it("emits LTF-only grammar when bias_timeframe is absent", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
    });

    expect(compiled).not.toBeNull();
    expect(compiled!.entry_long).toBe("ema_9 crosses_above ema_21");
    expect(compiled!.entry_short).toBe("ema_9 crosses_below ema_21");
    // No HTF references
    expect(compiled!.entry_long).not.toContain("_4h");
    expect(compiled!.entry_short).not.toContain("_4h");
  });
});

// ─── Test 4: bias_timeframe set but null bias_condition → advisory note ───────

describe("W23H.1 MTF: bias_timeframe set but null bias_condition", () => {
  it("preserves base grammar and adds advisory note", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
      bias_timeframe: "4h",
      bias_condition: null,
    });

    expect(compiled).not.toBeNull();
    // Grammar unchanged
    expect(compiled!.entry_long).toBe("ema_9 crosses_above ema_21");
    expect(compiled!.entry_short).toBe("ema_9 crosses_below ema_21");
    // Note must mention the advisory
    const noteText = compiled!.compileNotes.join(" ");
    expect(noteText).toContain("mtf.bias_timeframe_no_condition");
  });
});

// ─── Test 5: MTF + confluence: all three conditions in entry_long ─────────────

describe("W23H.1 MTF + confluence: bias + primary + confirming in grammar", () => {
  it("grammar contains bias_condition AND primary AND confirming indicators", () => {
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
    // All three conditions must appear
    expect(compiled!.entry_long).toContain("ema_9 crosses_above ema_21");
    expect(compiled!.entry_long).toContain("rsi_14");
    expect(compiled!.entry_long).toContain("ema_50_4h > ema_200_4h");
    // Multiple ANDs
    const andCount = (compiled!.entry_long.match(/ AND /g) ?? []).length;
    expect(andCount).toBeGreaterThanOrEqual(2);
  });
});

// ─── Test 6: Direction=long sentinel: entry_short stays "high < low" ─────────

describe("W23H.1 MTF: direction sentinel preserved with MTF gate", () => {
  it("entry_short remains never-true sentinel when direction=long + MTF gate", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "long",  // single direction — short gets never-true sentinel
      bias_timeframe: "4h",
      bias_condition: "ema_50_4h > ema_200_4h",
    });

    expect(compiled).not.toBeNull();
    // entry_long: primary AND bias
    expect(compiled!.entry_long).toContain("ema_9 crosses_above ema_21");
    expect(compiled!.entry_long).toContain("ema_50_4h > ema_200_4h");
    // entry_short: must remain sentinel (never-true) — bias gate must NOT re-enable it
    expect(compiled!.entry_short).toBe("high < low");
  });
});

// ─── Test 7: Exact grammar string contract ────────────────────────────────────

describe("W23H.1 MTF: exact entry_long grammar string (signals.py contract)", () => {
  it("emits exact parenthesized AND-gate format for signals.py evaluate_expression()", () => {
    // This is a LOAD-BEARING test: signals.py evaluate_expression() must be able to
    // parse the exact string format emitted here. The format is:
    //   (<primary_signal>) AND (<bias_condition>)
    // The parser splits on ' AND ' (space-padded), so the parentheses are important
    // only for correctness in complex cases (they are preserved verbatim in parse).
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "long",
      bias_timeframe: "4h",
      bias_condition: "ema_50_4h > ema_200_4h",
    });

    expect(compiled).not.toBeNull();
    // Exact expected grammar format
    expect(compiled!.entry_long).toBe(
      "(ema_9 crosses_above ema_21) AND (ema_50_4h > ema_200_4h)"
    );
  });

  it("emits exact grammar for ORB + 4H bias gate", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "session_open_breakout",
      entry_params: { range_minutes: 15 },
      direction: "long",
      bias_timeframe: "4h",
      bias_condition: "rsi_14_4h > 50",
    });

    expect(compiled).not.toBeNull();
    expect(compiled!.entry_long).toBe(
      "(close > orh_15m) AND (rsi_14_4h > 50)"
    );
  });
});

// ─── Backward compat: existing tests must still pass ─────────────────────────

describe("W23H.1 backward compat: non-MTF strategies compile identically to W23G.11", () => {
  it("EMA crossover without MTF: unchanged grammar", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      direction: "both",
    });
    expect(compiled!.entry_long).toBe("ema_9 crosses_above ema_21");
    expect(compiled!.entry_short).toBe("ema_9 crosses_below ema_21");
  });

  it("ORB with RSI confluence without MTF: AND-chained grammar unchanged", () => {
    const compiled = compileDslWithConfluence({
      entry_indicator: "session_open_breakout",
      entry_params: { range_minutes: 15 },
      direction: "both",
      confirming_indicators: [
        { indicator: "rsi", params: { period: 14, threshold_gt: 50 }, direction: "agree" },
      ],
    });
    expect(compiled!.entry_long).toContain("close > orh_15m");
    expect(compiled!.entry_long).toContain("AND");
    expect(compiled!.entry_long).toContain("rsi_14");
    expect(compiled!.mtfUnsupported).toBeFalsy();
  });
});
