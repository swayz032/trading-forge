/**
 * Wave 26 Pass D (2026-05-25) — graduator vocabulary expansion tests.
 *
 * Closes 8 graduation rejections observed on operator's 29-URL ingest
 * (2026-05-25, 06:00-06:15 UTC) by adding 6 new concept-name regex routes,
 * an LLM `entry_indicator` whitelist passthrough fallback, a per-symbol
 * `buffer_ticks` default-fill for session_open_breakout, and a widened
 * `ict_ote` archetype-mechanic regex.
 *
 * Static source inspection (pattern matches sibling wave23f-graduator-entry-quality.test.ts)
 * — avoids the DB-import chain that direct-bucket-graduator.ts triggers.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const GRADUATOR_SRC = fs.readFileSync(
  path.resolve(__dirname, "../services/direct-bucket-graduator.ts"),
  "utf-8",
);

describe("Wave 26 Pass D — graduator vocabulary expansion", () => {
  describe("New concept-name regex aliases ship in source", () => {
    it("ships extreme_band / N-sigma → bollinger_breakout regex", () => {
      expect(GRADUATOR_SRC).toMatch(/extreme\.band\|.*sigma\|outlier\.band\|band\.reversal.*bollinger_breakout/s);
    });

    it("ships one_candle / first_candle / opening_candle → session_open_breakout regex", () => {
      expect(GRADUATOR_SRC).toMatch(/\(one\|first\|opening\)\.\{0,4\}\(candle\|bar\).*session_open_breakout/s);
    });

    it("ships ma_trend_following / trend.following.ma → ema_crossover regex", () => {
      expect(GRADUATOR_SRC).toMatch(/ma\.trend\.follow\|moving\.average\.trend.*ema_crossover/s);
    });

    it("ships multi_confluence / stacked_confluence → fallback-or-default route", () => {
      expect(GRADUATOR_SRC).toMatch(/multi\.confluence\|stacked\.confluence\|confluence\.setup/);
    });

    it("ships market_structure → archetype:break_of_structure with shift-exclusion lookahead", () => {
      expect(GRADUATOR_SRC).toMatch(/market\.structure\(\?!\.shift\)/);
      expect(GRADUATOR_SRC).toMatch(/archetype:break_of_structure/);
    });
  });

  describe("LLM entry_indicator whitelist passthrough", () => {
    it("ENGINE_INDICATOR_WHITELIST constant is exported with engine-supported names", () => {
      expect(GRADUATOR_SRC).toContain("ENGINE_INDICATOR_WHITELIST");
      // Sample required entries — full engine vocabulary mirrors REQUIRED_PARAMS_BY_INDICATOR_FULL
      expect(GRADUATOR_SRC).toMatch(/ENGINE_INDICATOR_WHITELIST.*"session_open_breakout"/s);
      expect(GRADUATOR_SRC).toMatch(/ENGINE_INDICATOR_WHITELIST.*"ema_crossover"/s);
      expect(GRADUATOR_SRC).toMatch(/ENGINE_INDICATOR_WHITELIST.*"bollinger_breakout"/s);
      expect(GRADUATOR_SRC).toMatch(/ENGINE_INDICATOR_WHITELIST.*"rsi_reversal"/s);
    });

    it("deriveEntryIndicator accepts llmEntryIndicator parameter", () => {
      expect(GRADUATOR_SRC).toMatch(/deriveEntryIndicator\(\s*conceptName: string,\s*fallback: string \| null,\s*llmEntryIndicator\?: string \| null,(?:\s*_derivePathOut\?: \{ path\?: string \},)?\s*\): string \| null/);
    });

    it("LLM passthrough maps fair_value_gap → archetype:fvg_retrace", () => {
      expect(GRADUATOR_SRC).toMatch(/llm === "fair_value_gap".*archetype:fvg_retrace/s);
    });

    it("LLM passthrough maps order_block / supply_demand_zone → archetype:order_block", () => {
      expect(GRADUATOR_SRC).toMatch(/order_block.*supply_demand_zone.*demand_supply_zone.*archetype:order_block/s);
    });

    it("LLM passthrough maps fibonacci_retracement → archetype:ict_ote", () => {
      expect(GRADUATOR_SRC).toMatch(/fibonacci_retracement.*archetype:ict_ote/s);
    });

    it("LLM passthrough maps simple/exponential_moving_average → ema_crossover", () => {
      expect(GRADUATOR_SRC).toMatch(/simple_moving_average.*exponential_moving_average.*ema_crossover/s);
    });

    it("LLM passthrough fires BEFORE the existing archetype-map fallback", () => {
      // Order matters: whitelist check must precede ENTRY_INDICATOR_MAP fallback
      // so the LLM's concrete indicator wins over the bucket's vague archetype tag.
      const whitelistIdx = GRADUATOR_SRC.indexOf("ENGINE_INDICATOR_WHITELIST.has(llm)");
      const archetypeMapIdx = GRADUATOR_SRC.lastIndexOf("if (fallback && ENTRY_INDICATOR_MAP[fallback])");
      expect(whitelistIdx).toBeGreaterThan(0);
      expect(archetypeMapIdx).toBeGreaterThan(whitelistIdx);
    });
  });

  describe("Per-symbol buffer_ticks default fill (session_open_breakout)", () => {
    it("ships SWEEP_BUFFER_DEFAULTS table with MES=3, MNQ=5, MCL=2", () => {
      expect(GRADUATOR_SRC).toMatch(/SWEEP_BUFFER_DEFAULTS.*MES:\s*3.*MNQ:\s*5.*MCL:\s*2/s);
    });

    it("default-fill triggers when earlyIndicator === session_open_breakout AND buffer_ticks null/undefined", () => {
      expect(GRADUATOR_SRC).toMatch(/earlyIndicator === "session_open_breakout"\s*\n\s*&&\s*\(effectiveEntryParams\.buffer_ticks === null \|\| effectiveEntryParams\.buffer_ticks === undefined\)/);
    });

    it("default-fill respects STOP_BUFFER_TICKS_{symbol} env override", () => {
      expect(GRADUATOR_SRC).toMatch(/STOP_BUFFER_TICKS_\$\{market\}/);
    });

    it("default-fill stays inside PARAM_RANGES [1, 10] guard", () => {
      expect(GRADUATOR_SRC).toMatch(/fallbackTicks >= 1 && fallbackTicks <= 10/);
    });

    it("default-fill runs BEFORE validateParamRanges (otherwise null fails the gate)", () => {
      const defaultFillIdx = GRADUATOR_SRC.indexOf("SWEEP_BUFFER_DEFAULTS");
      const validateIdx = GRADUATOR_SRC.lastIndexOf("validateParamRanges(entryIndicator");
      expect(defaultFillIdx).toBeGreaterThan(0);
      expect(validateIdx).toBeGreaterThan(defaultFillIdx);
    });
  });

  describe("ict_ote archetype mechanic regex widened for fib-percentage vocabulary", () => {
    // Find the MECHANIC_KEYWORDS ict_ote entry specifically (the file also has
    // an earlier ict_ote in ARCHETYPE_REGISTRY with engineSpec). Anchor on the
    // mechanic-keyword table header to skip past the registry entry.
    const tableHeader = GRADUATOR_SRC.indexOf("ARCHETYPE_MECHANIC_KEYWORDS");
    const oteStart = tableHeader >= 0 ? GRADUATOR_SRC.indexOf("ict_ote: {", tableHeader) : -1;
    // Read until the next mechanic-keyword entry begins (e.g. "ict_power_of_3:")
    const oteEnd = oteStart >= 0 ? GRADUATOR_SRC.indexOf("ict_power_of_3:", oteStart) : -1;
    const oteLine = oteStart >= 0 && oteEnd > oteStart ? GRADUATOR_SRC.slice(oteStart, oteEnd) : "";

    it("oteLine extracted successfully (sanity)", () => {
      expect(oteLine).toContain("ict_ote: {");
      expect(oteLine).toContain("identifier:");
    });

    it("accepts 0.71 / 71% / 70.5% as alternatives to literal 'OTE' keyword", () => {
      // Source has regex-escaped dots (0\.71); the file string contains a
      // literal backslash followed by a period, hence "0\\.71" in JS strings.
      expect(oteLine).toContain("0\\.71");
      expect(oteLine).toContain("71%");
    });

    it("preserves the original 'ote' / 'optimal trade entry' keyword path", () => {
      expect(oteLine).toContain("ote|optimal.trade.entry|optimal.entry");
    });

    it("requires fib + level/zone/retrace anchor (not just bare percentage)", () => {
      // Without the fib anchor, the regex would over-match on stop-loss % expressions
      // ("close 2% stop") — keep the percentage tied to fib context.
      expect(oteLine).toContain("fib.{0,3}(level|zone|retrace)");
    });
  });

  describe("Backward compatibility — existing routes preserved", () => {
    it("existing macd / keltner / supertrend regexes unchanged", () => {
      expect(GRADUATOR_SRC).toMatch(/if \(\/macd.*return "macd_crossover"/s);
      expect(GRADUATOR_SRC).toMatch(/keltner.*return "keltner_squeeze"/);
      expect(GRADUATOR_SRC).toMatch(/supertrend.*return "supertrend"/);
    });

    it("Connors RSI-2 special-case still routes correctly", () => {
      expect(GRADUATOR_SRC).toMatch(/connors\.\*rsi\.\?2.*return "connors_rsi2"/s);
    });

    it("Pivot points still rejected (no engine spec)", () => {
      expect(GRADUATOR_SRC).toMatch(/pivot\.point\|floor\.pivot\|camarilla\|woodie.*return null/s);
    });

    it("subreddit-name reject still in place", () => {
      expect(GRADUATOR_SRC).toMatch(/\^r_\(daytrading\|futurestrading\|algotrading.*return null/s);
    });
  });
});
