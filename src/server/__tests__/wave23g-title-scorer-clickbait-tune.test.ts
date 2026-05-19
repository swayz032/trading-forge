/**
 * W23G.10 — title scorer clickbait-tune: indicator+clickbait combo softening.
 *
 * When BOTH indicator name AND clickbait regex fire, the clickbait penalty
 * drops from -3 to -1. Standalone clickbait (no indicator) stays at -3.
 *
 * Rationale: an explicit indicator term in a clickbait title signals genuine
 * parametric content. INDICATOR(+3) + CLICKBAIT(-1) = +2 net-positive, allowing
 * downstream extraction to proceed.
 *
 * CLICKBAIT regex requires \b before the pattern group. "$500/day" standalone
 * (no preceding word char) does NOT trigger the regex. Use "make $" / "made $" /
 * "earn $" / "secret strategy" / "easy money" / "prints money" forms that DO
 * have a word-boundary anchor.
 */
import { describe, it, expect } from "vitest";
import { scoreVideoTitle } from "../services/autonomous-scout-runner";

describe("W23G.10 — indicator+clickbait combo title scoring", () => {

  it("indicator+clickbait combo — each case fires both flags and scores >= 0", () => {
    // These titles pair an explicit indicator term with a clickbait phrase that
    // satisfies the \b word-boundary requirement in CLICKBAIT_TITLE.
    const comboCases: Array<{ title: string; note: string }> = [
      {
        title: "VWAP Strategy — Easy Money Day Trading",
        note: "VWAP=indicator, easy money=clickbait",
      },
      {
        title: "RSI Secret Strategy That Prints Money",
        note: "RSI=indicator, secret strategy + prints money=clickbait",
      },
      {
        title: "MACD Strategy — Secret Method Make $500 a Day",
        note: "MACD=indicator, make $500 a day=clickbait",
      },
      {
        title: "Bollinger Bands Easy Money Strategy",
        note: "Bollinger Bands=indicator, easy money=clickbait",
      },
      {
        title: "ICT Silver Bullet — Make $500 a Day Trading",
        note: "ICT + silver bullet=indicator, make $500 a day=clickbait",
      },
    ];

    for (const { title, note } of comboCases) {
      const result = scoreVideoTitle(title);
      expect(result.indicatorHit, `"${title}" (${note}) — expected indicatorHit`).toBe(true);
      expect(result.clickbaitHit, `"${title}" (${note}) — expected clickbaitHit`).toBe(true);
      // W23G.10: INDICATOR(+3) + CLICKBAIT(-1) = +2 minimum (no positive/numeric bonus assumed)
      expect(result.score, `"${title}" (${note}) — expected score >= 0`).toBeGreaterThanOrEqual(0);
    }
  });

  it("standalone clickbait (no indicator) still scores < -2", () => {
    const pureClickbait = [
      "Make $500 a Day Trading Futures",
      "Easy Money Day Trading Secret",
      "Get Rich Day Trading — Secret Method",
      "Secret Strategy Prints Money Every Day",
    ];
    for (const title of pureClickbait) {
      const result = scoreVideoTitle(title);
      expect(result.clickbaitHit, `"${title}" — expected clickbaitHit`).toBe(true);
      expect(result.indicatorHit, `"${title}" — expected no indicatorHit`).toBe(false);
      expect(result.score, `"${title}" — expected score < -2`).toBeLessThan(-2);
    }
  });

  it("indicator + tutorial (no clickbait) scores >= 5", () => {
    // VWAP + indicator + positive (tutorial) = +3 + +2 = +5 minimum.
    // Use a title that clearly hits both INDICATOR_NAME_TITLE and POSITIVE_TITLE.
    const result = scoreVideoTitle("VWAP Strategy Tutorial — Exact Entry Rules");
    expect(result.indicatorHit, "expected indicatorHit").toBe(true);
    expect(result.positiveHit, "expected positiveHit").toBe(true);
    expect(result.clickbaitHit, "expected no clickbaitHit").toBe(false);
    // INDICATOR(+3) + POSITIVE(+2) = +5
    expect(result.score).toBeGreaterThanOrEqual(5);
  });

  it("NEGATIVE_TITLE hammer is unchanged — critique titles still floor at -2 or lower", () => {
    // negativeHit path: score = Math.min(score - 5, -2) — unchanged by W23G.10
    const { score, negativeHit } = scoreVideoTitle("Why This Strategy Doesn't Work — Exposed");
    expect(negativeHit).toBe(true);
    expect(score).toBeLessThanOrEqual(-2);
  });

  it("clickbait + no indicator — 'secret strategy' still scores < -2", () => {
    // "Secret strategy" in a title with no indicator name → pure clickbait → -3
    const result = scoreVideoTitle("Secret Strategy For Futures Trading Every Day");
    expect(result.clickbaitHit).toBe(true);
    expect(result.indicatorHit).toBe(false);
    expect(result.score).toBeLessThan(-2);
  });

  it("combo penalty delta: indicator present saves exactly 2 points vs pure-clickbait baseline", () => {
    // Isolate the W23G.10 delta by constructing minimal titles that differ by
    // only the indicator term. Use "Easy money" as the clickbait anchor (word-boundary
    // safe — starts with a word char). No other scoring terms in either title.
    //
    // pure:  "Easy money futures"           → clickbait(-3), no indicator, no positive = -3
    // combo: "VWAP Easy money futures"      → indicator(+3) + clickbait(-1) = +2
    // delta = combo - pure = +2 - (-3) = +5  ... but VWAP also adds +3 indicator bonus.
    // The correct isolated delta between same clickbait penalty applied differently:
    //   pure  = 0 + (-3) = -3
    //   combo = 3 + (-1) = +2   (indicator bonus + reduced penalty)
    //   delta = +5 (indicator bonus +3 AND reduced penalty saving +2)
    //
    // The meaningful production assertion is: combo >= 0 and pure < 0 and combo > pure.
    const pure = scoreVideoTitle("Easy money futures day trading");
    const combo = scoreVideoTitle("VWAP easy money futures day trading");

    expect(pure.clickbaitHit, "pure: clickbaitHit").toBe(true);
    expect(pure.indicatorHit, "pure: no indicatorHit").toBe(false);
    expect(pure.score, "pure: score < 0").toBeLessThan(0);

    expect(combo.clickbaitHit, "combo: clickbaitHit").toBe(true);
    expect(combo.indicatorHit, "combo: indicatorHit").toBe(true);
    expect(combo.score, "combo: score >= 0").toBeGreaterThanOrEqual(0);

    // W23G.10 structural guarantee: adding an indicator term to a clickbait title
    // raises the score by at least the saved penalty (2pts) + indicator bonus (3pts) = 5pts
    expect(combo.score - pure.score).toBeGreaterThanOrEqual(5);
  });

});
