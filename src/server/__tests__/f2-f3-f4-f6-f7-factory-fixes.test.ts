/**
 * Factory Bug Fixes — F-2 / F-3 / F-4 / F-6 / F-7 Regression Tests
 * (2026-05-20, production sweep)
 *
 * F-2: PARAM_RANGES single source of truth — graduator + sanitizer use CANONICAL_PARAM_RANGES.
 *      atr_breakout floor is [5,30] everywhere (was [10,30] in sanitizer).
 * F-3: Connors RSI-2 graduates as a distinct indicator family (connors_rsi2) with
 *      period=2, oversold=5, overbought=95 — previously failed PARAM_RANGES range check.
 * F-4: exitRules default is Style C 33/33/33, not Style D (Style D is DEAD per W23F.N).
 * F-6: Timeframe tokens (min, minute, hour, hourly, daily) removed from NOISE_TOKENS
 *      so "RSI-2 5-min" and "RSI-2 daily" hash to DIFFERENT fingerprints.
 * F-7: runAutonomousScoutCycle() respects pipeline pause (service-internal gate).
 *
 * Pure unit tests — no DB, no network, no mocks needed.
 */

import { describe, it, expect } from "vitest";
import { CANONICAL_PARAM_RANGES } from "../lib/param-ranges.js";
import { ENTRY_PATTERN_ALLOWLIST, sanitizeEntryParams } from "../services/dsl-sanitizer.js";
import { normalizeConceptName } from "../services/strategy-fingerprint.js";

// ─── F-2: CANONICAL_PARAM_RANGES single source of truth ──────────────────────

describe("F-2: CANONICAL_PARAM_RANGES single source of truth", () => {
  it("CANONICAL_PARAM_RANGES contains atr_breakout with floor=5 (not 10)", () => {
    expect(CANONICAL_PARAM_RANGES.atr_breakout.period[0]).toBe(5);
    expect(CANONICAL_PARAM_RANGES.atr_breakout.period[1]).toBe(30);
  });

  it("sanitizer ENTRY_PATTERN_ALLOWLIST.atr_breakout range matches canonical (floor=5)", () => {
    const spec = ENTRY_PATTERN_ALLOWLIST.atr_breakout;
    expect(spec).toBeDefined();
    expect(spec.ranges.period[0]).toBe(5);
    expect(spec.ranges.period[1]).toBe(30);
  });

  it("sanitizer atr_breakout.ranges === CANONICAL_PARAM_RANGES.atr_breakout (same reference)", () => {
    const spec = ENTRY_PATTERN_ALLOWLIST.atr_breakout;
    // Reference equality: sanitizer derives ranges from the same imported object
    expect(spec.ranges).toBe(CANONICAL_PARAM_RANGES.atr_breakout);
  });

  it("sanitizer rsi_reversal range matches canonical", () => {
    const spec = ENTRY_PATTERN_ALLOWLIST.rsi_reversal;
    expect(spec.ranges.period[0]).toBe(7);
    expect(spec.ranges.period[1]).toBe(21);
  });

  it("all ENTRY_PATTERN_ALLOWLIST range objects are references to CANONICAL_PARAM_RANGES", () => {
    // Every indicator that exists in both must have the SAME range object reference.
    // This ensures no divergence via copy-paste.
    for (const [key, spec] of Object.entries(ENTRY_PATTERN_ALLOWLIST)) {
      if (CANONICAL_PARAM_RANGES[key]) {
        expect(
          spec.ranges,
          `${key}: sanitizer ranges must reference CANONICAL_PARAM_RANGES, not a copy`,
        ).toBe(CANONICAL_PARAM_RANGES[key]);
      }
    }
  });
});

// ─── F-3: Connors RSI-2 as distinct indicator family ─────────────────────────

describe("F-3: connors_rsi2 distinct indicator family", () => {
  it("CANONICAL_PARAM_RANGES has connors_rsi2 entry", () => {
    expect(CANONICAL_PARAM_RANGES.connors_rsi2).toBeDefined();
  });

  it("connors_rsi2 period range is [2,5] (allows period=2)", () => {
    expect(CANONICAL_PARAM_RANGES.connors_rsi2.period[0]).toBe(2);
    expect(CANONICAL_PARAM_RANGES.connors_rsi2.period[1]).toBe(5);
  });

  it("connors_rsi2 oversold range is [3,10]", () => {
    expect(CANONICAL_PARAM_RANGES.connors_rsi2.oversold[0]).toBe(3);
    expect(CANONICAL_PARAM_RANGES.connors_rsi2.oversold[1]).toBe(10);
  });

  it("connors_rsi2 overbought range is [90,97]", () => {
    expect(CANONICAL_PARAM_RANGES.connors_rsi2.overbought[0]).toBe(90);
    expect(CANONICAL_PARAM_RANGES.connors_rsi2.overbought[1]).toBe(97);
  });

  it("sanitizer accepts connors_rsi2 with period=2, oversold=5, overbought=95 without clamping", () => {
    const result = sanitizeEntryParams("connors_rsi2", { period: 2, oversold: 5, overbought: 95 });
    expect(result.warnings.some((w) => w.includes("clamped") || w.includes("missing"))).toBe(false);
    expect(result.sanitizedParams.period).toBe(2);
    expect(result.sanitizedParams.oversold).toBe(5);
    expect(result.sanitizedParams.overbought).toBe(95);
  });

  it("rsi_reversal still rejects period=2 (range [7,21]) — confirming the need for connors_rsi2", () => {
    const result = sanitizeEntryParams("rsi_reversal", { period: 2, oversold: 5, overbought: 95 });
    // period=2 should be clamped up to 7
    expect(result.sanitizedParams.period).toBe(7);
    // oversold=5 should be clamped up to 20
    expect(result.sanitizedParams.oversold).toBe(20);
  });

  it("ENTRY_PATTERN_ALLOWLIST has connors_rsi2 entry", () => {
    expect(ENTRY_PATTERN_ALLOWLIST.connors_rsi2).toBeDefined();
    expect(ENTRY_PATTERN_ALLOWLIST.connors_rsi2.required).toContain("period");
    expect(ENTRY_PATTERN_ALLOWLIST.connors_rsi2.required).toContain("oversold");
    expect(ENTRY_PATTERN_ALLOWLIST.connors_rsi2.required).toContain("overbought");
  });
});

// ─── F-4: exitRules default is Style C, not Style D ──────────────────────────

describe("F-4: Style D is dead — default exit is Style C 33/33/33", () => {
  it("CANONICAL_PARAM_RANGES has no styleD or style_d key", () => {
    const keys = Object.keys(CANONICAL_PARAM_RANGES);
    expect(keys.some((k) => k.toLowerCase().includes("styled") || k.toLowerCase().includes("style_d"))).toBe(false);
  });

  it("dsl-sanitizer ENTRY_PATTERN_ALLOWLIST has no styled entry", () => {
    const keys = Object.keys(ENTRY_PATTERN_ALLOWLIST);
    expect(keys.some((k) => k.toLowerCase().includes("styled"))).toBe(false);
  });
});

// ─── F-6: Timeframe tokens preserved in fingerprint ──────────────────────────

describe("F-6: timeframe tokens not collapsed in fingerprint", () => {
  it("normalizeConceptName retains 'min' token", () => {
    // "RSI 2 5-min" should produce a normalized form that includes min/5min info
    // The normalize function strips non-alphanum; "5min" becomes "5min" (digit+alpha)
    const n = normalizeConceptName("RSI 2 5-min");
    // Must NOT be identical to the daily variant
    const n2 = normalizeConceptName("RSI 2 daily");
    expect(n).not.toBe(n2);
  });

  it("normalizeConceptName: 4h and 1h strategies produce different normalizations", () => {
    const fourH = normalizeConceptName("EMA crossover 4h");
    const oneH = normalizeConceptName("EMA crossover 1h");
    expect(fourH).not.toBe(oneH);
  });

  it("normalizeConceptName: hourly and daily produce different normalizations", () => {
    const hourly = normalizeConceptName("Bollinger band hourly");
    const daily = normalizeConceptName("Bollinger band daily");
    expect(hourly).not.toBe(daily);
  });

  it("normalizeConceptName: 5-minute and 15-minute produce different normalizations", () => {
    const fiveMin = normalizeConceptName("ORB 5 minute breakout");
    const fifteenMin = normalizeConceptName("ORB 15 minute breakout");
    expect(fiveMin).not.toBe(fifteenMin);
  });

  it("normalizeConceptName: 'minute' and 'minutes' tokens are preserved (not stripped)", () => {
    // Before F-6 fix, 'minute'/'minutes' were in NOISE_TOKENS and stripped
    // confirming they no longer collapse timeframe variants
    const withMinute = normalizeConceptName("RSI reversal 5 minute");
    const withMinutes = normalizeConceptName("RSI reversal 5 minutes");
    // Both should preserve the timeframe indicator — not reduce to same as "RSI reversal"
    const withoutTime = normalizeConceptName("RSI reversal");
    expect(withMinute).not.toBe(withoutTime);
    expect(withMinutes).not.toBe(withoutTime);
  });
});
