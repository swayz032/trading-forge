/**
 * Wave 26 Pass E — tests for src/server/lib/wave25-strategy-defaults.ts
 */
import { describe, it, expect } from "vitest";
import {
  applyWave25Defaults,
  buildDefaultConfluenceWeights,
  inferMtfHierarchy,
  inferSymbolSet,
  deriveBiasTimeframe,
  buildDefaultExitPlanConfig,
} from "../lib/wave25-strategy-defaults.js";

describe("Wave 26 Pass E — Wave 25 institutional defaults", () => {
  describe("buildDefaultConfluenceWeights", () => {
    it("returns 11-factor map summing to 1.00", () => {
      const w = buildDefaultConfluenceWeights();
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      expect(Object.keys(w).length).toBe(11);
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
    });

    it("includes all 11 canonical factors per CLAUDE.md §2b", () => {
      const w = buildDefaultConfluenceWeights();
      expect(w.market_structure_aligned).toBe(0.20);
      expect(w.liquidity_target_clear).toBe(0.13);
      expect(w.smt_confirmation).toBe(0.10);
      expect(w.vwap_alignment).toBe(0.10);
      expect(w.macro_alignment).toBe(0.08);
      expect(w.regime_match).toBe(0.05);
    });
  });

  describe("inferMtfHierarchy", () => {
    it("1m exec → daily/1h/15m/1m hierarchy", () => {
      expect(inferMtfHierarchy("1m")).toEqual({ daily_tf: "1d", htf_tf: "1h", itf_tf: "15m", trigger_tf: "1m" });
    });
    it("5m exec → daily/4h/1h/5m", () => {
      expect(inferMtfHierarchy("5m")).toEqual({ daily_tf: "1d", htf_tf: "4h", itf_tf: "1h", trigger_tf: "5m" });
    });
    it("15m exec → daily/4h/1h/5m", () => {
      expect(inferMtfHierarchy("15m")).toEqual({ daily_tf: "1d", htf_tf: "4h", itf_tf: "1h", trigger_tf: "5m" });
    });
    it("1h exec → daily/1d/4h/15m", () => {
      expect(inferMtfHierarchy("1h")).toEqual({ daily_tf: "1d", htf_tf: "1d", itf_tf: "4h", trigger_tf: "15m" });
    });
    it("4h exec → daily/1d/4h/1h", () => {
      expect(inferMtfHierarchy("4h")).toEqual({ daily_tf: "1d", htf_tf: "1d", itf_tf: "4h", trigger_tf: "1h" });
    });
    it("daily_tf is always 1d regardless of exec", () => {
      expect(inferMtfHierarchy("1m").daily_tf).toBe("1d");
      expect(inferMtfHierarchy("4h").daily_tf).toBe("1d");
      expect(inferMtfHierarchy("unknown").daily_tf).toBe("1d");
    });
  });

  describe("inferSymbolSet — multi-symbol fan-out", () => {
    it("symbol-agnostic strategy → [MES, MNQ, MCL]", () => {
      const s = inferSymbolSet("orb_mes_15m", "orb_breakout", "MES");
      expect(s).toEqual(expect.arrayContaining(["MES", "MNQ", "MCL"]));
      expect(s.length).toBe(3);
    });

    // Wave 26 Pass F.2 (2026-05-25) — universal fan-out. Operator mandate:
    // test EVERY concept on all 3 markets, separate at DEPLOY-stage based on
    // backtest verdict. Previous behavior (route oil→MCL, nasdaq→MNQ, sp→MES
    // exclusively) was removed because the LLM-derived concept name shouldn't
    // pre-decide which markets are tradable — backtest does.
    it("oil-name concept STILL fans out to all 3 (Pass F.2)", () => {
      expect(inferSymbolSet("top_down_bias_oil_short", "top_down_bias_oil_short", "MCL").length).toBe(3);
      expect(inferSymbolSet("crude_oil_pullback", "crude_oil_pullback", "MCL").length).toBe(3);
    });

    it("nasdaq-name concept STILL fans out to all 3 (Pass F.2)", () => {
      expect(inferSymbolSet("first_candle_rule_nasdaq", "first_candle_rule_nasdaq", "MES").length).toBe(3);
      expect(inferSymbolSet("one_candle_setup_nasdaq_5m", "one_candle_setup_nasdaq_5m", "MES").length).toBe(3);
    });

    it("S&P-name concept STILL fans out to all 3 (Pass F.2)", () => {
      expect(inferSymbolSet("sp500_breakout", "sp500_breakout", "MES").length).toBe(3);
    });

    it("EMA crossover (agnostic) → all 3", () => {
      const s = inferSymbolSet("ema_crossover_4h_retrace", "ema_crossover_4h_retrace", "MES");
      expect(s.length).toBe(3);
    });

    it("FVG retrace (agnostic) → all 3", () => {
      const s = inferSymbolSet("4h_pattern_entry_model", "4h_pattern_entry_model", "MES");
      expect(s.length).toBe(3);
    });

    it("preserves original market as leader slot", () => {
      const s = inferSymbolSet("orb_mnq_5m", "orb_breakout", "MNQ");
      expect(s[0]).toBe("MNQ");
    });
  });

  describe("deriveBiasTimeframe", () => {
    it("5m exec → bias 4h", () => {
      expect(deriveBiasTimeframe("5m")).toBe("4h");
    });
    it("1h exec → bias 1d", () => {
      expect(deriveBiasTimeframe("1h")).toBe("1d");
    });
  });

  describe("buildDefaultExitPlanConfig", () => {
    it("returns adaptive style by default", () => {
      expect(buildDefaultExitPlanConfig()).toEqual({ exit_style: "adaptive" });
    });
  });

  describe("applyWave25Defaults — full bundle", () => {
    it("returns all Wave 25 columns + config additions", () => {
      const r = applyWave25Defaults({
        strategyName: "ema_crossover_4h_retrace_mes_4h",
        conceptName: "ema_crossover_4h_retrace",
        execTimeframe: "4h",
        originalMarket: "MES",
        confluenceFactors: ["structural_setup", "volume_confirmation"],
      });
      expect(r.useWeightedScoring).toBe(true);
      expect(r.confluenceScoreThreshold).toBe(0.72);
      expect(Object.keys(r.confluenceScoreWeights).length).toBe(11);
      expect(r.dailyTf).toBe("1d");
      expect(r.htfTf).toBe("1d");
      expect(r.itfTf).toBe("4h");
      expect(r.triggerTf).toBe("1h");
      expect(r.exitPlanConfig).toEqual({ exit_style: "adaptive" });
      expect(r.symbols.length).toBe(3);
      expect(r.configAdditions.bias_timeframe).toBe("1d");
      expect(r.configAdditions.confirming_indicators).toEqual(["structural_setup", "volume_confirmation"]);
    });

    it("oil-name concept fans out to all 3 (Pass F.2 universal-fanout)", () => {
      const r = applyWave25Defaults({
        strategyName: "top_down_bias_oil_short_mcl_1h",
        conceptName: "top_down_bias_oil_short",
        execTimeframe: "1h",
        originalMarket: "MCL",
        confluenceFactors: [],
      });
      expect(r.symbols.length).toBe(3);
    });
  });
});
