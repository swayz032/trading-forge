/**
 * Wave 9 — Graduator smoke test: 5 canonical cases
 *
 * Pins the Pass 21 v3 corrected³ gate behavior for the 5 cases that define
 * the graduation logic contract. Each case reproduces the exact gate predicate
 * from direct-bucket-graduator.ts without importing the module (avoids DB/LLM deps).
 *
 * Extracted logic:
 *   - validateParamRanges()   — PARAM_RANGES table
 *   - hasRealRules check      — ≥40 chars + structural/indicator keyword regex
 *   - mechanicKeywordCheck    — ARCHETYPE_MECHANIC_KEYWORDS per-archetype
 *   - thin_dsl gate           — both paramsHasRequired AND hasRealRules for parametric
 */

import { describe, it, expect } from "vitest";

// ─── Inline reproduction of PARAM_RANGES (mirrors TS source) ─────────────────
const PARAM_RANGES: Record<string, Record<string, [number, number]>> = {
  sma_crossover: { fast_period: [5, 50], slow_period: [20, 200], confirmation_bars: [1, 5] },
  ema_crossover: { fast_period: [5, 50], slow_period: [20, 200], confirmation_bars: [1, 5] },
  rsi_reversal: { period: [7, 21], oversold: [20, 40], overbought: [60, 80] },
  bollinger_breakout: { period: [10, 30], std_dev: [1.5, 3.0], confirmation_bars: [1, 3] },
  atr_breakout: { period: [10, 30], multiplier: [1.0, 3.0] },
  vwap_reversion: { deviation_threshold: [0.5, 3.0], confirmation_bars: [1, 5] },
  donchian_breakout: { period: [10, 55] },
  keltner_squeeze: { bb_period: [15, 25], kc_period: [15, 25], kc_multiplier: [1.0, 2.0] },
  session_open_breakout: { range_minutes: [5, 60], buffer_ticks: [1, 10] },
  macd_crossover: { fast_period: [8, 16], slow_period: [20, 30], signal_period: [7, 12] },
  vwap_fade: { atr_extension_threshold: [1.0, 3.0], confirmation_bars: [1, 5], vwap_touch_exit: [0, 1] },
  event_driven_fade: { atr_move_threshold: [1.5, 4.0], event_window_minutes: [5, 30], confirmation_bars: [1, 3] },
  overnight_drift: { drift_atr_threshold: [0.5, 2.0], asia_lookback_bars: [4, 24], min_drift_bars: [2, 12] },
};

function validateParamRanges(indicator: string, params: Record<string, unknown>): string[] {
  const ranges = PARAM_RANGES[indicator];
  if (!ranges) return [];
  const errors: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    const range = ranges[k];
    if (!range) continue;
    if (typeof v !== "number" || Number.isNaN(v)) {
      errors.push(`${indicator}.${k}: value '${v}' is not numeric`);
      continue;
    }
    if (v < range[0] || v > range[1]) {
      errors.push(`${indicator}.${k}: ${v} out of range [${range[0]}, ${range[1]}]`);
    }
  }
  return errors;
}

// ─── Inline reproduction of hasRealRules (mirrors TS source) ─────────────────
function hasRealRules(entryCondition: string): boolean {
  const e = entryCondition.toLowerCase();
  return e.length > 40 &&
    /(close|cross|break|above|below|enter|trigger|when|rsi\s*[<>]|ema\(|sma\(|sweep|displacement|mss|(^|\W)fvg(\W|$)|retrace|(^|\W)ote(\W|$)|breaker|choch|(^|\W)bos(\W|$)|cisd|killzone|manipulation|order.block|fair.value.gap|liquidity|raid|accumulation|distribution|spring|upthrust|poc|vah|val|imbalance|absorption)/.test(e);
}

// ─── Inline reproduction of ARCHETYPE_MECHANIC_KEYWORDS for silver_bullet ───
const SILVER_BULLET_NY_AM_KEYWORDS = [
  /(10|11)[:\s]?am|10[:.]00|ny am|ny.am|new york am/i,
  /sweep|liquidity/i,
  /fvg|fair.value.gap/i,
];

// ─── REQUIRED_PARAMS_BY_INDICATOR_FULL (relevant subset) ─────────────────────
const REQUIRED_PARAMS: Record<string, string[]> = {
  rsi_reversal: ["period", "oversold", "overbought"],
};

function paramsHasAllRequired(indicator: string, params: Record<string, unknown>): boolean {
  const required = REQUIRED_PARAMS[indicator] ?? [];
  return required.every((k) => k in params);
}

// ─── Gate decision helpers ────────────────────────────────────────────────────

interface GateInput {
  indicator: string;
  params: Record<string, unknown>;
  entryCondition: string;
  isArchetype: boolean;
  archetypeKeywords?: RegExp[];
}

type GateResult =
  | { accepted: true }
  | { accepted: false; reason: string };

function runGate(input: GateInput): GateResult {
  const { indicator, params, entryCondition, isArchetype, archetypeKeywords } = input;

  // 1. Param range check (parametric only)
  if (!isArchetype) {
    const rangeErrors = validateParamRanges(indicator, params);
    if (rangeErrors.length > 0) {
      return { accepted: false, reason: `param_range_violation: ${rangeErrors.join("; ")}` };
    }
  }

  // 2. Archetype: prose + mechanic keywords required
  if (isArchetype) {
    if (!hasRealRules(entryCondition)) {
      return { accepted: false, reason: "thin_archetype_dsl: requires real entry_condition prose" };
    }
    if (archetypeKeywords) {
      const missing = archetypeKeywords.filter((re) => !re.test(entryCondition));
      if (missing.length > 0) {
        return {
          accepted: false,
          reason: `archetype_mechanic_mismatch: missing keywords [${missing.map((r) => r.source).join("; ")}]`,
        };
      }
    }
    return { accepted: true };
  }

  // 3. Parametric: both paramsHasRequired AND hasRealRules
  const hasRequired = paramsHasAllRequired(indicator, params);
  const hasRules = hasRealRules(entryCondition);
  if (!hasRequired || !hasRules) {
    const reasons = [];
    if (!hasRequired) reasons.push(`missing required ${indicator} params [${REQUIRED_PARAMS[indicator]?.join(", ")}]`);
    if (!hasRules) reasons.push("placeholder/missing entry_condition prose");
    return { accepted: false, reason: `thin_dsl: ${reasons.join(" AND ")}` };
  }

  return { accepted: true };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 9 — Graduator smoke test: 5 canonical cases", () => {
  it("Case 1: Connors RSI-2 with period=2 (out of [7,21] range) → REJECTED param_range_violation", () => {
    const result = runGate({
      indicator: "rsi_reversal",
      params: { period: 2, oversold: 5, overbought: 95 },
      entryCondition: "Enter long when the 2-period Connors RSI closes below 5 after being above 90 yesterday, confirming the mean reversion setup.",
      isArchetype: false,
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toMatch(/param_range_violation/);
      expect(result.reason).toMatch(/period.*2.*out of range/);
    }
  });

  it("Case 2: Silver Bullet without mechanic keywords → REJECTED archetype_mechanic_mismatch", () => {
    const result = runGate({
      indicator: "ict_silver_bullet_ny_am",
      params: {},
      entryCondition: "Wait for a high-probability setup during the AM session and enter long when price shows bullish reversal candle with confirmation from the prior structure. Risk 1R, target 2R.",
      isArchetype: true,
      archetypeKeywords: SILVER_BULLET_NY_AM_KEYWORDS,
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toMatch(/archetype_mechanic_mismatch/);
    }
  });

  it("Case 3: Empty entry_rules / default template → REJECTED thin_dsl", () => {
    // Simulate the template fallback: short, no structural keywords
    const templateEntry = "Entry on rsi_reversal signal per ema_pullback setup; framework overlay applies risk management.";
    const result = runGate({
      indicator: "rsi_reversal",
      params: { period: 14, oversold: 30, overbought: 70 },
      entryCondition: templateEntry,
      isArchetype: false,
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toMatch(/thin_dsl/);
    }
  });

  it("Case 4: Reddit-prose with no entry-condition structure → REJECTED thin_dsl (missing real rules)", () => {
    // Reddit-thread discussion with zero entry-condition keywords — nothing like
    // "close", "cross", "break", "above", "below", "enter", "trigger", etc.
    // Valid params present, but hasRealRules is false because the prose has
    // no structural trading language — only frustration text.
    const prose = "I have lost money three months straight. My funded account just failed again. My stop was too tight. My sister also had a bad month trading. I need advice.";
    const result = runGate({
      indicator: "rsi_reversal",
      params: { period: 14, oversold: 30, overbought: 70 },
      entryCondition: prose,
      isArchetype: false,
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toMatch(/thin_dsl/);
    }
  });

  it("Case 5: Full Silver Bullet prose with all 4 mechanic keywords → ACCEPTED", () => {
    const prose = [
      "During the 10 AM NY AM killzone window (10:00-11:00 ET), wait for a sweep of liquidity",
      "below the prior session low or equal lows. After the sweep, look for a displacement candle",
      "creating a fair value gap FVG. Enter long on the retrace into the FVG targeting 2-3R.",
      "Time-stop at 11:00 ET. Stop below the swept low.",
    ].join(" ");

    const result = runGate({
      indicator: "ict_silver_bullet_ny_am",
      params: {},
      entryCondition: prose,
      isArchetype: true,
      archetypeKeywords: SILVER_BULLET_NY_AM_KEYWORDS,
    });
    expect(result.accepted).toBe(true);
  });
});
