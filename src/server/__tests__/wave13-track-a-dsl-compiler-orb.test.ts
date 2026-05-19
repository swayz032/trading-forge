/**
 * Wave 13 Track A — Tests for dsl-compiler.ts ORB + signals.py empty-exit guard.
 *
 * A.1: verify dsl-compiler now emits correct opening_range_breakout indicator
 *      with proper grammar (close > orh_15m) instead of SMA proxy.
 *
 * A.2 (proxy): verify the compiled entry_long refers to orh_15m column
 *      and the indicator type is opening_range_breakout.
 */

import { describe, it, expect } from "vitest";
import { compileDslToEngine } from "../../server/lib/dsl-compiler.js";

describe("Wave 13 Track A — dsl-compiler ORB support", () => {
  describe("session_open_breakout compilation", () => {
    it("emits opening_range_breakout indicator type (not SMA proxy)", () => {
      const result = compileDslToEngine({
        entry_indicator: "session_open_breakout",
        entry_params: { range_minutes: 15 },
        direction: "long",
      });
      expect(result).not.toBeNull();
      const orbIndicator = result!.indicators.find((i) => i.type === "opening_range_breakout");
      expect(orbIndicator).toBeDefined();
      expect(orbIndicator?.range_minutes).toBe(15);
      expect(orbIndicator?.session_start_et).toBe("09:30");
    });

    it("entry_long uses close > orh_{N}m grammar", () => {
      const result = compileDslToEngine({
        entry_indicator: "session_open_breakout",
        entry_params: { range_minutes: 15 },
        direction: "long",
      });
      expect(result).not.toBeNull();
      expect(result!.entry_long).toBe("close > orh_15m");
    });

    it("entry_short uses close < orl_{N}m grammar for bidirectional", () => {
      const result = compileDslToEngine({
        entry_indicator: "session_open_breakout",
        entry_params: { range_minutes: 15 },
        direction: "both",
      });
      expect(result).not.toBeNull();
      expect(result!.entry_long).toBe("close > orh_15m");
      expect(result!.entry_short).toBe("close < orl_15m");
    });

    it("long-only strategy has never-true sentinel for entry_short", () => {
      const result = compileDslToEngine({
        entry_indicator: "session_open_breakout",
        entry_params: { range_minutes: 15 },
        direction: "long",
      });
      expect(result).not.toBeNull();
      expect(result!.entry_short).toBe("high < low");
    });

    it("custom range_minutes=30 emits orh_30m grammar", () => {
      const result = compileDslToEngine({
        entry_indicator: "session_open_breakout",
        entry_params: { range_minutes: 30 },
        direction: "long",
      });
      expect(result).not.toBeNull();
      expect(result!.entry_long).toBe("close > orh_30m");
      const orbInd = result!.indicators.find((i) => i.type === "opening_range_breakout");
      expect(orbInd?.range_minutes).toBe(30);
    });

    it("custom session_start_et is preserved in indicator config", () => {
      const result = compileDslToEngine({
        entry_indicator: "session_open_breakout",
        entry_params: { range_minutes: 15, session_start_et: "10:00" },
        direction: "long",
      });
      expect(result).not.toBeNull();
      const orbInd = result!.indicators.find((i) => i.type === "opening_range_breakout");
      expect(orbInd?.session_start_et).toBe("10:00");
    });

    it("ATR_14 is always appended for sizing regardless of ORB", () => {
      const result = compileDslToEngine({
        entry_indicator: "session_open_breakout",
        entry_params: { range_minutes: 15 },
        direction: "long",
      });
      expect(result).not.toBeNull();
      const atrInd = result!.indicators.find((i) => i.type === "atr" && i.period === 14);
      expect(atrInd).toBeDefined();
    });

    it("compile notes mention Wave 13 ORB indicator landing", () => {
      const result = compileDslToEngine({
        entry_indicator: "session_open_breakout",
        entry_params: { range_minutes: 15 },
        direction: "long",
      });
      expect(result).not.toBeNull();
      const hasOrbNote = result!.compileNotes.some((n) => n.includes("opening_range_breakout") || n.includes("orh_15m"));
      expect(hasOrbNote).toBe(true);
    });

    it("does NOT reference sma proxy in entry_long anymore", () => {
      const result = compileDslToEngine({
        entry_indicator: "session_open_breakout",
        entry_params: { range_minutes: 15 },
        direction: "long",
      });
      expect(result).not.toBeNull();
      // Wave 15.0 used 'close > sma_3' or 'close > sma_N' as a proxy — this must be gone
      expect(result!.entry_long).not.toMatch(/sma_\d+/);
    });
  });

  describe("EMA crossover compilation (regression)", () => {
    it("still compiles ema_crossover correctly after ORB changes", () => {
      const result = compileDslToEngine({
        entry_indicator: "ema_crossover",
        entry_params: { fast_period: 9, slow_period: 21 },
        direction: "long",
      });
      expect(result).not.toBeNull();
      expect(result!.entry_long).toBe("ema_9 crosses_above ema_21");
      expect(result!.indicators).toContainEqual({ type: "ema", period: 9 });
      expect(result!.indicators).toContainEqual({ type: "ema", period: 21 });
    });
  });
});
