/**
 * Strategy Fingerprint Tests — Pass 18
 *
 * Covers computeFingerprintHash, extractEntryArchetype, normalizeExitType.
 * Pure functions — no DB, no network, no mocks needed.
 *
 * 8+ tests:
 *  1. Hash determinism for same input
 *  2. Hash uniqueness for different markets
 *  3. Hash uniqueness for different archetypes
 *  4. Hash uniqueness for different exit types
 *  5. Archetype: breakout keywords
 *  6. Archetype: mean_reversion keywords
 *  7. Archetype: trend_follow keywords
 *  8. Archetype: momentum keywords
 *  9. Archetype: volatility_expansion keywords
 * 10. Archetype: session_pattern keywords
 * 11. Archetype: event_driven keywords
 * 12. Archetype: unknown fallback
 * 13. Exit: atr_multiple keywords
 * 14. Exit: trailing_stop keywords
 * 15. Exit: fixed_target keywords
 * 16. Exit: time_exit keywords
 * 17. Exit: indicator_signal keywords
 * 18. Exit: unknown fallback
 * 19. Hash is exactly 32 hex chars
 * 20. Case-insensitive archetype matching
 */

import { describe, it, expect } from "vitest";
import {
  computeFingerprintHash,
  extractEntryArchetype,
  normalizeExitType,
} from "../services/strategy-fingerprint.js";

// ─── computeFingerprintHash ────────────────────────────────────────────────

describe("computeFingerprintHash", () => {
  it("returns the same hash for identical inputs (determinism)", () => {
    const a = computeFingerprintHash({ market: "MES", entry_archetype: "breakout", exit_type: "atr_multiple" });
    const b = computeFingerprintHash({ market: "MES", entry_archetype: "breakout", exit_type: "atr_multiple" });
    expect(a).toBe(b);
  });

  it("returns a different hash for different markets", () => {
    const mes = computeFingerprintHash({ market: "MES", entry_archetype: "breakout", exit_type: "atr_multiple" });
    const mnq = computeFingerprintHash({ market: "MNQ", entry_archetype: "breakout", exit_type: "atr_multiple" });
    expect(mes).not.toBe(mnq);
  });

  it("returns a different hash for different archetypes", () => {
    const a = computeFingerprintHash({ market: "MES", entry_archetype: "breakout",       exit_type: "atr_multiple" });
    const b = computeFingerprintHash({ market: "MES", entry_archetype: "mean_reversion", exit_type: "atr_multiple" });
    expect(a).not.toBe(b);
  });

  it("returns a different hash for different exit types", () => {
    const a = computeFingerprintHash({ market: "MES", entry_archetype: "breakout", exit_type: "atr_multiple" });
    const b = computeFingerprintHash({ market: "MES", entry_archetype: "breakout", exit_type: "trailing_stop" });
    expect(a).not.toBe(b);
  });

  it("returns exactly 32 hex characters", () => {
    const h = computeFingerprintHash({ market: "MCL", entry_archetype: "momentum", exit_type: "fixed_target" });
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });

  it("handles all three markets without collision", () => {
    const hashes = ["MES", "MNQ", "MCL"].map((m) =>
      computeFingerprintHash({ market: m, entry_archetype: "trend_follow", exit_type: "trailing_stop" })
    );
    const unique = new Set(hashes);
    expect(unique.size).toBe(3);
  });
});

// ─── extractEntryArchetype ─────────────────────────────────────────────────

describe("extractEntryArchetype", () => {
  it("classifies breakout", () => {
    expect(extractEntryArchetype("Enter long on breakout above the opening range high")).toBe("breakout");
    expect(extractEntryArchetype("ORB strategy: wait for 30-min ORB then trade the break")).toBe("breakout");
    expect(extractEntryArchetype("Price breaks above resistance level with volume confirmation")).toBe("breakout");
  });

  it("classifies mean_reversion", () => {
    expect(extractEntryArchetype("Enter when price touches VWAP and shows reversal candle")).toBe("mean_reversion");
    expect(extractEntryArchetype("Fade the overextended move; enter when RSI > 80 on MES")).toBe("mean_reversion");
    expect(extractEntryArchetype("Bollinger band squeeze mean reversion entry")).toBe("mean_reversion");
  });

  it("classifies trend_follow", () => {
    expect(extractEntryArchetype("Enter long on EMA cross above 200 EMA in uptrend")).toBe("trend_follow");
    expect(extractEntryArchetype("Golden cross 50/200 MA crossover with ADX filter")).toBe("trend_follow");
    expect(extractEntryArchetype("Trend continuation: wait for pullback to 20 EMA in trending market")).toBe("trend_follow");
  });

  it("classifies momentum", () => {
    expect(extractEntryArchetype("Enter when RSI crosses above 50 with strong momentum")).toBe("momentum");
    expect(extractEntryArchetype("Rate of change turns positive after pullback")).toBe("momentum");
    expect(extractEntryArchetype("Stochastic momentum entry on MNQ 5m")).toBe("momentum");
  });

  it("classifies volatility_expansion", () => {
    expect(extractEntryArchetype("Enter on volatility expansion when ATR expands above 20-period average")).toBe("volatility_expansion");
    expect(extractEntryArchetype("Keltner break signals volatility expansion entry")).toBe("volatility_expansion");
    expect(extractEntryArchetype("Vol spike entry: enter on VIX spike and MES range expansion")).toBe("volatility_expansion");
  });

  it("classifies session_pattern", () => {
    expect(extractEntryArchetype("Enter at market open on opening auction imbalance")).toBe("session_pattern");
    expect(extractEntryArchetype("Initial balance breakout: enter after 9:30-10:00 IB forms")).toBe("session_pattern");
    expect(extractEntryArchetype("London session open drive continuation entry")).toBe("session_pattern");
  });

  it("classifies event_driven", () => {
    expect(extractEntryArchetype("Enter after FOMC announcement on initial directional move")).toBe("event_driven");
    expect(extractEntryArchetype("NFP jobs report catalyst trade on MES 5m")).toBe("event_driven");
    expect(extractEntryArchetype("CPI data release economic event-driven entry")).toBe("event_driven");
  });

  it("returns unknown for unrecognized entry descriptions", () => {
    expect(extractEntryArchetype("Enter when the planets align and the operator feels good")).toBe("unknown");
    expect(extractEntryArchetype("Buy when price goes up")).toBe("unknown");
    expect(extractEntryArchetype("Complex proprietary system signal")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(extractEntryArchetype("BREAKOUT ABOVE RESISTANCE LEVEL")).toBe("breakout");
    expect(extractEntryArchetype("VWAP TOUCH MEAN REVERSION ENTRY")).toBe("mean_reversion");
    expect(extractEntryArchetype("EMA CROSS GOLDEN CROSS 50/200")).toBe("trend_follow");
  });
});

// ─── normalizeExitType ─────────────────────────────────────────────────────

describe("normalizeExitType", () => {
  it("classifies atr_multiple", () => {
    expect(normalizeExitType("Take profit at 2x ATR; stop at 1x ATR")).toBe("atr_multiple");
    expect(normalizeExitType("ATR multiple exit: 3.0R take profit target")).toBe("atr_multiple");
    expect(normalizeExitType("atr_multiple exit; take profit at 2.5xATR")).toBe("atr_multiple");
  });

  it("classifies trailing_stop", () => {
    expect(normalizeExitType("Use Chandelier trailing stop with period 14, multiplier 2.0")).toBe("trailing_stop");
    expect(normalizeExitType("Trail behind last 2-bar swing low as the market moves in our favour")).toBe("trailing_stop");
    expect(normalizeExitType("Parabolic SAR trailing exit on 5m MES")).toBe("trailing_stop");
  });

  it("classifies fixed_target", () => {
    expect(normalizeExitType("Fixed target: 8 point target on MES")).toBe("fixed_target");
    expect(normalizeExitType("Set hard TP at $200 dollar target per contract")).toBe("fixed_target");
    expect(normalizeExitType("Hard fixed take profit at 6 tick target")).toBe("fixed_target");
  });

  it("classifies time_exit", () => {
    expect(normalizeExitType("Flatten at 15:55 ET regardless of position")).toBe("time_exit");
    expect(normalizeExitType("Time-based exit: close all positions at end of day EOD")).toBe("time_exit");
    expect(normalizeExitType("Session close exit at market close 16:00")).toBe("time_exit");
  });

  it("classifies indicator_signal", () => {
    expect(normalizeExitType("Exit when EMA crosses back below — indicator signal exit")).toBe("indicator_signal");
    expect(normalizeExitType("Close on opposite signal from MACD exit cross")).toBe("indicator_signal");
    expect(normalizeExitType("RSI exit signal: close when RSI hits 70")).toBe("indicator_signal");
  });

  it("returns unknown for unrecognized exit descriptions", () => {
    expect(normalizeExitType("Exit when you feel like it")).toBe("unknown");
    expect(normalizeExitType("Close position manually")).toBe("unknown");
    expect(normalizeExitType("Proprietary exit signal")).toBe("unknown");
  });
});
