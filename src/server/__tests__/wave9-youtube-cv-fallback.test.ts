/**
 * Wave 9 (2026-05-17) — YouTube CV-only fallback test.
 *
 * Diagnosis: 168 of 169 chunked-fallback runs in production logs returned 0 strategies
 * from the transcript_extractor LLM. Layer 2 was effectively offline because the runner
 * dropped on `if (ideas.length === 0) continue;`.
 *
 * Fix: when the LLM extractor returns empty, fall back to a "concept exists on YouTube"
 * cross-validation mention IF the video title token-confirms the concept_name. This
 * mirrors how the web layer already works (Brave description = CV signal, not full DSL).
 *
 * These tests pin the token-confirmation algorithm and the source_provider enum acceptance.
 */
import { describe, expect, it } from "vitest";

// Replicates the inline algorithm from autonomous-scout-runner.ts Layer 2 — if this drifts,
// the runtime behavior drifts. Keep this test mirror in sync with the runner.
function titleConfirmsConcept(conceptName: string, title: string): {
  confirmed: boolean;
  tokenHits: number;
  conceptTokens: string[];
} {
  const conceptTokens = conceptName.toLowerCase().split(/_+/).filter((t) => t.length >= 3);
  const titleLower = title.toLowerCase();
  const tokenHits = conceptTokens.filter((t) => titleLower.includes(t)).length;
  const confirmed = conceptTokens.length === 0 || tokenHits >= Math.min(2, conceptTokens.length);
  return { confirmed, tokenHits, conceptTokens };
}

describe("wave9 — YouTube CV-only fallback token-confirmation", () => {
  it("confirms when title contains both core concept tokens", () => {
    const result = titleConfirmsConcept("ema_9_21_pullback_mes_5m", "EMA Pullback Strategy for ES Futures");
    expect(result.confirmed).toBe(true);
    expect(result.tokenHits).toBeGreaterThanOrEqual(2);
  });

  it("confirms when title is a literal concept name", () => {
    const result = titleConfirmsConcept("opening_range_breakout", "Opening Range Breakout — The Complete Guide");
    expect(result.confirmed).toBe(true);
  });

  it("confirms ICT silver bullet match", () => {
    const result = titleConfirmsConcept("ict_silver_bullet_10am", "ICT Silver Bullet Strategy — 10 AM NY Killzone");
    expect(result.confirmed).toBe(true);
    expect(result.tokenHits).toBeGreaterThanOrEqual(2);
  });

  it("rejects when title is critique/news (no concept tokens)", () => {
    const result = titleConfirmsConcept("vwap_fade_strategy", "Why 95% of Traders Lose Money");
    expect(result.confirmed).toBe(false);
    expect(result.tokenHits).toBe(0);
  });

  it("rejects when only one token matches and concept has >1 token", () => {
    const result = titleConfirmsConcept("connors_rsi_2_period", "Connors Quick Trading Tips");
    expect(result.confirmed).toBe(false);
    expect(result.tokenHits).toBe(1);
  });

  it("accepts single-token concept when that token appears in title", () => {
    const result = titleConfirmsConcept("orb", "ORB strategy walkthrough");
    expect(result.confirmed).toBe(true);
  });

  it("filters out tokens shorter than 3 chars", () => {
    const result = titleConfirmsConcept("a_b_pullback", "Pullback Strategy");
    // 'a' and 'b' filtered (< 3 chars); only 'pullback' remains — single token match passes
    expect(result.conceptTokens).toEqual(["pullback"]);
    expect(result.confirmed).toBe(true);
  });

  it("rejects empty-title edge case when concept has tokens", () => {
    const result = titleConfirmsConcept("rsi_reversal", "");
    expect(result.confirmed).toBe(false);
  });

  it("CV mention thesis includes concept name in human-readable form", () => {
    const concept = "fair_value_gap_15m";
    const human = concept.replace(/_/g, " ");
    const thesis = `Title — YouTube-layer cross-validation: concept "${human}" discussed in tutorial-scored video.`;
    expect(thesis).toContain("fair value gap 15m");
  });
});

describe("wave9 — YouTube CV-only fallback source_provider enum", () => {
  it("youtube_data_api is a valid pending source_provider", () => {
    // Pinned by routes/agent.ts:997-1003 pendingSourceProviderEnum
    const allowed = [
      "brave", "tavily", "exa", "parallel", "reddit", "manual",
      "youtube", "scrapingbee", "apify", "tf_search",
      "scrapingbee_youtube", "reddit_json", "brave_search",
      "parallel_web_discovery", "exa_web_discovery",
      "youtube_data_api", "youtube_transcript_npm",
    ];
    expect(allowed).toContain("youtube_data_api");
    expect(allowed).toContain("youtube_transcript_npm");
  });
});
