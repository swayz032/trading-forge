/**
 * W23F.S — title scorer clickbait/indicator fixes.
 * Pins the regex updates that broke ORB-clickbait monoculture in discovery.
 */
import { describe, it, expect } from "vitest";
import { scoreVideoTitle } from "../services/autonomous-scout-runner";

describe("W23F.S title scorer — clickbait downweight + indicator upweight", () => {
  it("downweights clickbait $$$ titles below acceptance threshold", () => {
    const titles = [
      "How to Make $500 a Day with Futures Trading",
      "I Made $1,000 Trading Trendlines",
      "Easy Money Futures Trading Strategy",
      "Secret Strategy That Prints Money",
      "Holy Grail Indicator — Get Rich Trading",
    ];
    for (const t of titles) {
      const { score, clickbaitHit } = scoreVideoTitle(t);
      expect(clickbaitHit).toBe(true);
      expect(score).toBeLessThan(0);
    }
  });

  it("upweights indicator-named titles above acceptance threshold", () => {
    const titles = [
      "My Favorite Futures Trading Strategy (Liquidity Sweeps)",
      "Bollinger Bands Mean Reversion Strategy",
      "RSI Reversal Setup for Futures",
      "ICT Order Block Tutorial — Step by Step",
      "Wyckoff Spring Pattern Day Trading",
      "Cumulative Delta Divergence Strategy",
      "MACD Crossover Strategy Explained",
    ];
    for (const t of titles) {
      const { score, indicatorHit } = scoreVideoTitle(t);
      expect(indicatorHit).toBe(true);
      expect(score).toBeGreaterThan(0);
    }
  });

  it("preserves Wave 11 numeric bonus", () => {
    const { score, numericHit } = scoreVideoTitle("9/21 EMA Pullback Strategy");
    expect(numericHit).toBe(true);
    expect(score).toBeGreaterThanOrEqual(3);
  });

  it("preserves Pass 21 negative scoring for critique/podcast", () => {
    const { score, negativeHit } = scoreVideoTitle("Why ORB Traders Lose Money — Exposed");
    expect(negativeHit).toBe(true);
    expect(score).toBeLessThan(0);
  });

  it("regression — the exact W23F.S-test user-experience case", () => {
    // From the actual E2E test (Bash output b2joy5b7q): titles that wrongly scored well
    const clickbait1 = scoreVideoTitle("How to Make $500 a Day with Futures Trading (Easy Strategy)");
    expect(clickbait1.clickbaitHit).toBe(true);
    expect(clickbait1.score).toBeLessThan(0);

    // The video we WANTED to surface: liquidity sweeps
    const lqsweep = scoreVideoTitle("My Favorite Futures Trading Strategy (Liquidity Sweeps)");
    expect(lqsweep.indicatorHit).toBe(true);
    expect(lqsweep.score).toBeGreaterThan(0);

    // Trendlines — should now also score well via indicator pattern
    const trendlines = scoreVideoTitle("How To Make $1,000 Trading Trendlines (trade example)");
    // Clickbait dominant — still rejected
    expect(trendlines.clickbaitHit).toBe(true);
    expect(trendlines.score).toBeLessThan(0);
  });

  it("ranks INDICATOR-NAMED above CLICKBAIT when both present", () => {
    const ranked = [
      "My Favorite Strategy (Liquidity Sweeps)",       // indicator only → +3
      "How to Make $500 a Day Trading Futures",        // clickbait + positive → -5+2 = -3
      "Wyckoff Spring Pattern Explained",              // indicator + positive → +3+2 = +5
      "Easy Money Day Trading",                        // clickbait → -5
    ].map(t => ({ t, ...scoreVideoTitle(t) }));
    const sorted = [...ranked].sort((a,b) => b.score - a.score);
    // Top entry should be indicator-positive (Wyckoff)
    expect(sorted[0].t).toContain("Wyckoff");
    // Bottom should be pure clickbait
    expect(sorted[sorted.length - 1].t).toContain("Easy Money");
  });
});
