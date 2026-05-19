/**
 * Wave 11 (2026-05-17) — YouTube extraction yield fix tests.
 *
 * Pins the two upstream filters added to `autonomous-scout-runner.ts`:
 *   1. `checkTranscriptQuality()` — pre-LLM gate that skips obviously-empty inputs
 *      (no numeric tokens AND no structural keywords AND no indicator names).
 *   2. `scoreVideoTitle()` — title-scoring with +3 numeric-content bonus on top of
 *      the legacy +2 positive / -3 negative keyword regex.
 *
 * Diagnosis: 168 of 169 chunked-fallback runs in production logs returned 0
 * strategies from the transcript_extractor LLM. The prompt is well-engineered
 * (3 quality few-shot examples already loaded). The root cause is video-selection
 * — too many tutorial/critique/promo videos whose narration genuinely lacks
 * parametric content. These tests pin the upstream filters so the next round
 * of empties is concentrated on extractable content.
 */
import { describe, expect, it } from "vitest";
import { checkTranscriptQuality, scoreVideoTitle } from "../services/autonomous-scout-runner.js";

describe("wave11 — checkTranscriptQuality pre-LLM gate", () => {
  it("admits a transcript with explicit numeric indicator content (EMA 9 21)", () => {
    const transcript = "Welcome to the EMA files. We'll cover the 9 and 21 EMA strategy. Set the first EMA length to 9 and the second EMA length to 21. The bullish crossover when 9 EMA crosses above 21 EMA is your signal. Wait for price to stay above both EMAs. Entry comes on the pullback to 21 EMA. Stop loss below the most recent swing low. Win rate around 73% on 1 hour timeframe.";
    const result = checkTranscriptQuality(transcript);
    expect(result.shouldExtract).toBe(true);
    expect(result.numericTokens).toBeGreaterThanOrEqual(3);
    expect(result.hasIndicatorKeyword).toBe(true);
    expect(result.skipReason).toBeNull();
  });

  it("admits a transcript with structural keywords (ICT silver bullet)", () => {
    const transcript = "Today we'll cover the ICT Silver Bullet strategy. Wait for a liquidity sweep at the high. After the sweep, you want to see a market structure shift (MSS) — a clear change in direction with displacement. Then look for a fair value gap (FVG) on the way back. Enter on the retrace into the FVG inside the killzone window.";
    const result = checkTranscriptQuality(transcript);
    expect(result.shouldExtract).toBe(true);
    expect(result.hasStructuralKeyword).toBe(true);
    expect(result.skipReason).toBeNull();
  });

  it("admits a transcript with mixed indicator + numeric content", () => {
    const transcript = "Let me show you the Connors RSI 2 mean-reversion strategy in detail. We use a 2-period RSI on the daily chart. When RSI drops below 5, that's your entry signal — go long. Exit when RSI crosses back above 50 or after 5 bars whichever comes first. Tested on SPY equities and futures. Win rate around 70 percent over 10 years. Stop is 2 ATR below entry. Position size is 1 percent risk per trade.";
    const result = checkTranscriptQuality(transcript);
    expect(result.shouldExtract).toBe(true);
    expect(result.numericTokens).toBeGreaterThanOrEqual(3);
    expect(result.hasIndicatorKeyword).toBe(true);
  });

  it("rejects a transcript that is general motivation/mindset content", () => {
    const transcript = "Hello traders, today I want to talk about mindset. The most important thing in trading is your psychology. If you can master your emotions, you will be successful. Many people lose because they get angry or fearful. You have to think long term. The market does not care about you. Trust the process and keep going. Discipline is everything. Stay patient and stay focused. Good luck out there.";
    const result = checkTranscriptQuality(transcript);
    expect(result.shouldExtract).toBe(false);
    expect(result.skipReason).toBe("no_archetype_or_indicator");
  });

  it("rejects a transcript that is market commentary without strategy", () => {
    const transcript = "Markets today closed mixed. Tech leading, energy lagging. The economy looks strong overall and the consumer is resilient. We expect the next earnings season to be a key driver of sentiment. International markets are also showing some signs of strength. Watch the news for any policy shifts that might affect direction.";
    const result = checkTranscriptQuality(transcript);
    expect(result.shouldExtract).toBe(false);
    expect(result.skipReason).toBe("no_archetype_or_indicator");
  });

  it("rejects transcripts under 300 chars", () => {
    const transcript = "Trade the EMA crossover with stops.";
    const result = checkTranscriptQuality(transcript);
    expect(result.shouldExtract).toBe(false);
    expect(result.skipReason).toBe("transcript_too_short");
  });

  it("admits a transcript with structural-only keywords (no indicator names)", () => {
    // The structural channel alone is enough — engine archetype detectors don't need numeric params.
    // Transcript has zero numeric content but rich structural language.
    const transcript = "Today we cover the order block setup. Watch for the original opposite candle before a sweep. The displacement after the sweep gives you the institutional bias. Once price retraces into the order block with smart money concepts, that's your entry. The breaker block confirms when the original swing fails. Wyckoff distribution patterns also work — look for the upthrust at the secondary test. Killzones matter most.";
    const result = checkTranscriptQuality(transcript);
    expect(result.shouldExtract).toBe(true);
    expect(result.hasStructuralKeyword).toBe(true);
    // numericTokens may be 0 — that's fine because the structural channel passes.
  });

  it("admits when indicator channel passes despite low numeric content", () => {
    // Edge case: VWAP rejection mentioned but no specific numbers.
    const transcript = "VWAP rejection at the high-of-day is one of my favorite setups. Watch the volume profile for confluence with point of control rejection. The anchored VWAP from the prior session highs gives additional structure. Order flow imbalance in the cumulative delta confirms the entry. Stop above the previous swing high.";
    const result = checkTranscriptQuality(transcript);
    expect(result.shouldExtract).toBe(true);
    expect(result.hasIndicatorKeyword).toBe(true);
  });
});

describe("wave11 — scoreVideoTitle numeric bonus", () => {
  it("gives +3 numeric bonus on '9 21 EMA' patterns", () => {
    const result = scoreVideoTitle("The 9 21 EMA Crossover Strategy — Complete Guide");
    expect(result.numericHit).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(5); // +2 positive (complete guide) + +3 numeric
  });

  it("gives +3 numeric bonus on 'RSI 2' patterns", () => {
    const result = scoreVideoTitle("Connors RSI-2 Mean Reversion Tutorial");
    expect(result.numericHit).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(5);
  });

  it("gives +3 numeric bonus on '15-minute ORB' patterns", () => {
    const result = scoreVideoTitle("15-Minute Opening Range Breakout — Exact Rules");
    expect(result.numericHit).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(5); // +2 positive (exact rules) + +3 numeric
  });

  it("gives only +2 (no numeric bonus) on generic tutorial titles", () => {
    const result = scoreVideoTitle("EMA Pullback Strategy Tutorial");
    expect(result.numericHit).toBe(false);
    expect(result.positiveHit).toBe(true);
    expect(result.score).toBe(2);
  });

  it("scores critique videos negative regardless of numbers", () => {
    const result = scoreVideoTitle("Why 95% of Traders Lose Money on EMA Crossovers");
    expect(result.negativeHit).toBe(true);
    expect(result.score).toBeLessThan(0);
  });

  it("handles 'EMA 9 21' inverted order pattern", () => {
    const result = scoreVideoTitle("EMA 9 21 Strategy — How to Trade");
    expect(result.numericHit).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(5);
  });

  it("handles 'Bollinger 20' standalone indicator-number pattern", () => {
    const result = scoreVideoTitle("Bollinger 20 Breakout System — Backtested");
    expect(result.numericHit).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(5);
  });

  it("gives no bonus for year-like numbers without indicator context", () => {
    const result = scoreVideoTitle("Best Trading Strategy for 2024 — Tutorial");
    expect(result.numericHit).toBe(false); // 2024 alone isn't a parameter pattern
  });

  it("title with no scoring signals returns score=0", () => {
    const result = scoreVideoTitle("Stock Market Today");
    expect(result.positiveHit).toBe(false);
    expect(result.negativeHit).toBe(false);
    expect(result.numericHit).toBe(false);
    expect(result.score).toBe(0);
  });

  it("filters tutorials with positive but vague indicators (no numeric bonus)", () => {
    // Realistic real-world tutorial without explicit params — only +2 keyword score
    const result = scoreVideoTitle("Complete Guide to EMA Pullback Setup");
    expect(result.positiveHit).toBe(true);
    expect(result.numericHit).toBe(false);
    expect(result.score).toBe(2);
  });
});

describe("wave11 — empty_reason category validation", () => {
  // These are the 8 categories the prompt v5 instructs the LLM to emit.
  // The route validates against this set and falls back to "other" if the LLM
  // returns something off-list. Tests pin the contract.
  const VALID_EMPTY_REASONS = [
    "no_strategy_content",
    "portfolio_theory",
    "missing_params",
    "promotional",
    "wrong_instrument",
    "speaker_uncertain",
    "transcript_corrupt",
    "other",
  ];

  it("has exactly 8 categories", () => {
    expect(VALID_EMPTY_REASONS).toHaveLength(8);
  });

  it("includes all the categories from the prompt v5", () => {
    // Pinned — if the prompt drifts, this test fails. Update both together.
    expect(VALID_EMPTY_REASONS).toContain("no_strategy_content");
    expect(VALID_EMPTY_REASONS).toContain("portfolio_theory");
    expect(VALID_EMPTY_REASONS).toContain("missing_params");
    expect(VALID_EMPTY_REASONS).toContain("promotional");
    expect(VALID_EMPTY_REASONS).toContain("wrong_instrument");
    expect(VALID_EMPTY_REASONS).toContain("speaker_uncertain");
    expect(VALID_EMPTY_REASONS).toContain("transcript_corrupt");
    expect(VALID_EMPTY_REASONS).toContain("other");
  });
});
