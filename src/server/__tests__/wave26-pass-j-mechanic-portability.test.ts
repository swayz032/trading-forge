/**
 * wave26-pass-j-mechanic-portability.test.ts — Wave 26 Pass J Phase 2 (2026-05-26)
 *
 * Tests the pure-function classifyMechanicPortability helper.
 *
 * Covers all 5 hard-reject mechanic classes (options / swing / forex /
 * stock / crypto) PLUS the critical positive cases — cross-market
 * mechanics that MUST keep extracting even when the speaker demos on a
 * non-futures chart.
 *
 * The whole point of this module is "speaker chart is not the strategy's
 * market" — so the positive-case tests carry as much weight as the
 * negative-case tests.
 */

import { describe, it, expect } from "vitest";
import {
  classifyMechanicPortability,
  explainRejectClass,
  type MechanicRejectClass,
} from "../lib/mechanic-portability.js";

describe("classifyMechanicPortability — positive cases (must PORT)", () => {
  it("portable: generic EMA crossover on any chart", () => {
    const r = classifyMechanicPortability(
      "I use a 9 EMA and 21 EMA crossover. When the 9 crosses above the 21 I buy, when it crosses below I sell. I'm showing this on EURUSD but it works on anything."
    );
    expect(r.portable).toBe(true);
    expect(r.reject_class).toBeNull();
  });

  it("portable: supply/demand zone trading on EURUSD (forex chart, futures-portable mechanic)", () => {
    const r = classifyMechanicPortability(
      "On this EURUSD chart, I find the supply zone where price consolidated before dropping. I wait for price to retest that zone, then I short with my stop above the zone. Targeting the previous low."
    );
    expect(r.portable).toBe(true);
    expect(r.reject_class).toBeNull();
  });

  it("portable: SMC market structure on AAPL (stock chart, futures-portable mechanic)", () => {
    const r = classifyMechanicPortability(
      "On AAPL we have a BOS to the upside, then a CHoCH back down. I'm looking for a return to the order block at 175 for my long entry."
    );
    expect(r.portable).toBe(true);
  });

  it("portable: ICT bias-aligned continuation on BTC (crypto chart, futures-portable mechanic)", () => {
    const r = classifyMechanicPortability(
      "On Bitcoin I look at the 4-hour for bias, then drop to 15 minute for the MSS, then 5 minute for the FVG retrace during the New York AM session."
    );
    expect(r.portable).toBe(true);
  });

  it("portable: pure price action with no instrument mentioned", () => {
    const r = classifyMechanicPortability(
      "I have a 3 step formula. Step 1 is market structure - higher highs and higher lows means uptrend. Step 2 is supply demand zones. Step 3 is risk reward minimum 2.5 to 1."
    );
    expect(r.portable).toBe(true);
  });

  it("portable: VWAP fade strategy demonstrated on SPY (SPY without 'options' = index proxy, mechanic-portable)", () => {
    const r = classifyMechanicPortability(
      "When price is 2 standard deviations above VWAP on SPY, I fade it back to VWAP. Stop above the high of the deviation candle."
    );
    expect(r.portable).toBe(true);
  });

  it("portable: ORB on QQQ (no options framing)", () => {
    const r = classifyMechanicPortability(
      "I trade the opening range breakout on QQQ. Mark the first 15 minutes, buy a break above, stop below the range low."
    );
    expect(r.portable).toBe(true);
  });

  it("portable: bare 'currency' / 'forex' mention without specific mechanic reject", () => {
    // Speaker demonstrating on forex but teaching universal price action
    const r = classifyMechanicPortability(
      "Today I'll show you on a forex pair. The mechanic is simple: wait for liquidity sweep then enter on the reversal candle close."
    );
    expect(r.portable).toBe(true);
  });

  it("portable: empty/whitespace transcript → false but not a reject class (treated as non-extractable)", () => {
    const r = classifyMechanicPortability("");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBeNull();
    expect(r.evidence).toEqual(["empty_transcript"]);
  });

  it("portable: handles non-string input gracefully", () => {
    // @ts-expect-error — runtime guard test
    const r = classifyMechanicPortability(null);
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBeNull();
  });
});

describe("classifyMechanicPortability — options_derivative rejects", () => {
  it("rejects iron condor", () => {
    const r = classifyMechanicPortability("Sell an iron condor on SPX weeklies with delta 16 wings.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("options_derivative");
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  it("rejects credit spread", () => {
    const r = classifyMechanicPortability("I sell credit spreads on SPY with 7 DTE.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("options_derivative");
  });

  it("rejects theta-decay strategy", () => {
    const r = classifyMechanicPortability("This strategy harvests theta decay by selling premium 45 days out.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("options_derivative");
  });

  it("rejects wheel strategy", () => {
    const r = classifyMechanicPortability("The wheel strategy: sell cash-secured puts until assigned, then sell covered calls.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("options_derivative");
  });

  it("rejects 0DTE", () => {
    const r = classifyMechanicPortability("I trade 0-DTE on SPX every morning at the open.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("options_derivative");
  });

  it("rejects SPY options chain mention", () => {
    const r = classifyMechanicPortability("I scan the SPY options chain for unusual activity, then enter the calls.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("options_derivative");
  });

  it("does NOT reject bare 'SPY' without options context (SPY is index-futures-portable)", () => {
    const r = classifyMechanicPortability("On SPY I look at the daily trend, then drop to 5-minute for entries.");
    expect(r.portable).toBe(true);
  });
});

describe("classifyMechanicPortability — swing_multi_day rejects (self-attribution required)", () => {
  it("rejects first-person 'I'm a swing trader'", () => {
    const r = classifyMechanicPortability("I'm a swing trader. I hold positions for weeks at a time.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("swing_multi_day");
  });

  it("rejects 'I hold for days'", () => {
    const r = classifyMechanicPortability("I enter on the daily breakout and I hold for days until the trend reverses.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("swing_multi_day");
  });

  it("rejects 'I hold overnight'", () => {
    const r = classifyMechanicPortability("I hold overnight when the setup is strong enough.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("swing_multi_day");
  });

  it("rejects 'I'm a position trader' explicit", () => {
    const r = classifyMechanicPortability("I'm a position trader who looks at the weekly chart for trend, daily for entry.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("swing_multi_day");
  });

  it("rejects first-person 'I buy and hold' (soft signal)", () => {
    const r = classifyMechanicPortability("My approach is simple: I buy and hold the index for years.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("swing_multi_day");
  });

  it("rejects 'we'll carry overnight' (we-attribution)", () => {
    const r = classifyMechanicPortability("If the trend is strong we'll carry overnight to capture the gap.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("swing_multi_day");
  });

  it("does NOT reject 'hold' in unrelated context", () => {
    const r = classifyMechanicPortability("I hold my stop just below the swing low and wait for the trade to play out.");
    expect(r.portable).toBe(true);
  });

  it("does NOT reject intraday strategy using daily-chart context", () => {
    const r = classifyMechanicPortability("I look at the daily chart for bias, then drop to 5-minute for my entry and exit same day.");
    expect(r.portable).toBe(true);
  });

  // 2026-05-26 false-positive fix: speaker DISMISSES swing trading
  it("does NOT reject scalper who dismisses swing trading", () => {
    const r = classifyMechanicPortability(
      "We're scalping all year. I don't care what anybody says about swing trading. " +
      "Find a trend, find a breakout, get in, and get out within 15 minutes — " +
      "made more than one of them silly old swing traders."
    );
    expect(r.portable).toBe(true);
  });

  // Speaker MENTIONS but doesn't DO swing
  it("does NOT reject when speaker contrasts vs swing without doing it", () => {
    const r = classifyMechanicPortability(
      "Unlike swing traders who hold for weeks, our setup closes by 3:55 ET every day."
    );
    expect(r.portable).toBe(true);
  });

  it("does NOT reject bare 'position trader' mention without first-person attribution", () => {
    const r = classifyMechanicPortability("Position traders look at the weekly chart for trend, daily for entry.");
    expect(r.portable).toBe(true);
  });
});

describe("classifyMechanicPortability — forex_specific_mechanics rejects", () => {
  it("rejects carry trade", () => {
    const r = classifyMechanicPortability("The carry trade exploits interest rate differentials between AUD and JPY.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("forex_specific_mechanics");
  });

  it("rejects swap rate harvest", () => {
    const r = classifyMechanicPortability("I collect the swap rate by holding long AUDJPY overnight.");
    // Could match either swap rate OR overnight — both are valid rejects
    expect(r.portable).toBe(false);
    expect(["forex_specific_mechanics", "swing_multi_day"]).toContain(r.reject_class);
  });

  it("rejects central bank intervention play", () => {
    const r = classifyMechanicPortability("This strategy front-runs BoJ intervention when USDJPY hits key levels.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("forex_specific_mechanics");
  });

  it("does NOT reject bare 'EURUSD' demonstration", () => {
    const r = classifyMechanicPortability("On EURUSD I use a 50 EMA bounce off support.");
    expect(r.portable).toBe(true);
  });
});

describe("classifyMechanicPortability — stock_specific_mechanics rejects", () => {
  it("rejects dividend capture", () => {
    const r = classifyMechanicPortability("Buy the stock the day before ex-dividend, sell after, collect the dividend.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("stock_specific_mechanics");
  });

  it("rejects earnings play", () => {
    const r = classifyMechanicPortability("My earnings play: buy 2 days before announcement, sell into the post-earnings gap.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("stock_specific_mechanics");
  });

  it("rejects sector rotation", () => {
    const r = classifyMechanicPortability("Sector rotation strategy: long the GICS sector with highest relative strength.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("stock_specific_mechanics");
  });

  it("rejects short-squeeze play", () => {
    const r = classifyMechanicPortability("Short-squeeze setup: high short interest + low float runner + retail catalyst.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("stock_specific_mechanics");
  });

  it("rejects merger arbitrage", () => {
    const r = classifyMechanicPortability("Merger arb opportunity when the spread between target and acquirer widens.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("stock_specific_mechanics");
  });

  it("does NOT reject bare 'AAPL' demonstration of generic mechanic", () => {
    const r = classifyMechanicPortability("On AAPL the 200 EMA acted as support, then we got a breakout.");
    expect(r.portable).toBe(true);
  });
});

describe("classifyMechanicPortability — crypto_specific_mechanics rejects", () => {
  it("rejects on-chain metric trigger", () => {
    const r = classifyMechanicPortability("When MVRV drops below 1 I accumulate Bitcoin — historical on-chain signal.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("crypto_specific_mechanics");
  });

  it("rejects funding rate arbitrage", () => {
    const r = classifyMechanicPortability("The funding rate arb: long spot, short perp, harvest the funding payment.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("crypto_specific_mechanics");
  });

  it("rejects halving cycle narrative", () => {
    const r = classifyMechanicPortability("The bitcoin halving cycle is your roadmap — accumulate 6 months before, distribute 12 months after.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("crypto_specific_mechanics");
  });

  it("rejects DeFi yield farming", () => {
    const r = classifyMechanicPortability("DeFi yield strategies: provide liquidity to the pool, harvest staking rewards.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("crypto_specific_mechanics");
  });

  it("does NOT reject bare 'BTC' or 'Bitcoin' demonstration", () => {
    const r = classifyMechanicPortability("On BTC I use a Bollinger Band squeeze setup with momentum confirmation.");
    expect(r.portable).toBe(true);
  });
});

describe("classifyMechanicPortability — priority + evidence shape", () => {
  it("options reject takes priority over swing reject when both match", () => {
    const r = classifyMechanicPortability("Iron condor with weekly options that I sometimes hold overnight.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("options_derivative");
  });

  it("hard signal beats soft signal in same class", () => {
    // "buy and hold" is soft swing; "swing trader" is hard swing
    const r = classifyMechanicPortability("I'm a swing trader. Some call this buy and hold.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("swing_multi_day");
    expect(r.confidence).toBe(1.0);
  });

  it("soft-only signal returns confidence 0.7 (first-person 'I buy and hold')", () => {
    // Post-2026-05-26 regex tightening: soft pattern also requires first-person attribution
    const r = classifyMechanicPortability("My retirement approach is simple: I buy and hold the index.");
    expect(r.portable).toBe(false);
    expect(r.reject_class).toBe("swing_multi_day");
    expect(r.confidence).toBe(0.7);
  });

  it("evidence array caps at 5 items per class", () => {
    // Stuff a transcript with many options keywords
    const transcript = [
      "iron condor", "iron butterfly", "credit spread", "debit spread",
      "vertical spread", "calendar spread", "straddle", "strangle",
    ].join(" then ");
    const r = classifyMechanicPortability(transcript);
    expect(r.portable).toBe(false);
    expect(r.evidence.length).toBeLessThanOrEqual(5);
  });

  it("portable result has empty evidence", () => {
    const r = classifyMechanicPortability("Simple EMA crossover on the 5-minute chart.");
    expect(r.portable).toBe(true);
    expect(r.evidence).toEqual([]);
  });
});

describe("explainRejectClass", () => {
  const allClasses: MechanicRejectClass[] = [
    "options_derivative",
    "swing_multi_day",
    "forex_specific_mechanics",
    "stock_specific_mechanics",
    "crypto_specific_mechanics",
  ];

  it.each(allClasses)("returns a non-empty human-readable string for %s", (cls) => {
    const text = explainRejectClass(cls);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(20);
  });

  it("swing explanation references Topstep EOD trailing DD", () => {
    expect(explainRejectClass("swing_multi_day")).toMatch(/Topstep|trailing|day[- ]trader/i);
  });
});
