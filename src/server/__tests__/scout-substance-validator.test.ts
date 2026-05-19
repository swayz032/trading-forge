/**
 * Scout Substance Validator Tests — Pass 4
 *
 * Covers:
 *   - Tier-1 regex pre-filter accept/reject decisions
 *   - stripMarkdown handles 5+ markdown patterns
 *   - generateOneSentenceLead edge cases (no period, very short, very long)
 *   - smartTruncate stops at word boundary
 *   - Tier-2 auditor: accept ≥5, reject <5, fail-open on null/parse error
 *   - Tier-2 budget cap: 200 calls/day → fail-open at 201st
 *   - signal_type defaults to 'strategy_candidate' when missing
 *   - drainScoutedIdeas SELECT skips market_news_intel rows (SQL inspection)
 *
 * No DB connection required — pure unit tests + mocked callOpenAI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../db/index.js", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ catch: vi.fn() })) })),
    select: vi.fn(),
    update: vi.fn(),
  },
}));

import {
  tier1RegexFilter,
  stripMarkdown,
  generateOneSentenceLead,
  smartTruncate,
} from "../services/scout-formatter.js";

// ─── Tier-1 regex pre-filter ───────────────────────────────────────────────

describe("tier1RegexFilter", () => {
  const goodDescription =
    "A".repeat(80) +
    " — long enough to pass Tier-1 minimum length gate. Strategy: MES opening range breakout with ATR stop.";

  it("accepts a fully-formed idea", () => {
    const result = tier1RegexFilter({
      title: "VWAP fade on MNQ during opening drive",
      description: goodDescription,
    });
    expect(result.accept).toBe(true);
    expect(result.reason).toBe("passed");
  });

  it("rejects description shorter than 80 chars", () => {
    const result = tier1RegexFilter({
      title: "Real strategy",
      description: "too short",
    });
    expect(result.accept).toBe(false);
    expect(result.reason).toBe("description_too_short");
  });

  it.each([
    "Generic strategy idea",
    "Untitled",
    "test setup",
    "PLACEHOLDER",
    "TODO: write thesis",
    "TBD",
  ])("rejects placeholder title: %s", (title) => {
    const result = tier1RegexFilter({ title, description: goodDescription });
    expect(result.accept).toBe(false);
    expect(result.reason).toBe("placeholder_title");
  });

  it("accepts title that merely contains placeholder substring", () => {
    const result = tier1RegexFilter({
      title: "Untestable hypothesis on momentum",
      description: goodDescription,
    });
    // "Untestable" doesn't match /^(generic|untitled|...)\b/ — \b requires word boundary
    expect(result.accept).toBe(true);
  });

  it("rejects entry_rules='see source for details'", () => {
    const result = tier1RegexFilter({
      title: "Real strategy",
      description: goodDescription,
      entry_rules: "See source for full setup",
    });
    expect(result.accept).toBe(false);
    expect(result.reason).toBe("placeholder_entry_rules");
  });

  it("rejects entry_rules='placeholder'", () => {
    const result = tier1RegexFilter({
      title: "Real strategy",
      description: goodDescription,
      entry_rules: "placeholder",
    });
    expect(result.accept).toBe(false);
    expect(result.reason).toBe("placeholder_entry_rules");
  });

  it("rejects entry_rules='tbd'", () => {
    const result = tier1RegexFilter({
      title: "Real strategy",
      description: goodDescription,
      entry_rules: "TBD",
    });
    expect(result.accept).toBe(false);
    expect(result.reason).toBe("placeholder_entry_rules");
  });

  it("rejects auto-slug concept_name with 4+ underscores", () => {
    const result = tier1RegexFilter({
      title: "Real strategy",
      description: goodDescription,
      concept_name: "vwap____fade",
    });
    expect(result.accept).toBe(false);
    expect(result.reason).toBe("auto_slug_concept_name");
  });

  it("accepts concept_name with 3 underscores in a row", () => {
    const result = tier1RegexFilter({
      title: "Real strategy",
      description: goodDescription,
      concept_name: "vwap___fade",
    });
    expect(result.accept).toBe(true);
  });

  it("ignores entry_rules when not provided", () => {
    const result = tier1RegexFilter({
      title: "Real strategy",
      description: goodDescription,
    });
    expect(result.accept).toBe(true);
  });

  // ─── mission-alignment substance gate ────────────────────────────────────

  it("rejects strategy_candidate with no futures or strategy substance", () => {
    const offTopicDesc =
      "An overview of cloud cost optimization for AWS Batch workloads using spot instances. " +
      "Covers IAM, S3, and autoscaling configuration patterns for analytics pipelines.";
    const result = tier1RegexFilter({
      title: "How to optimize AWS Batch cost",
      description: offTopicDesc,
      signal_type: "strategy_candidate",
    });
    expect(result.accept).toBe(false);
    expect(result.reason).toBe("no_futures_or_strategy_substance");
  });

  it("allows market_news_intel to bypass substance gate", () => {
    const newsDesc =
      "Quarterly earnings season kicks off next week with major banks reporting. " +
      "Analysts expect mixed results given the rate-cut backdrop and consumer spending weakness.";
    const result = tier1RegexFilter({
      title: "Earnings season preview",
      description: newsDesc,
      signal_type: "market_news_intel",
    });
    expect(result.accept).toBe(true);
  });

  it("accepts strategy_candidate that mentions MES + ATR + breakout", () => {
    const onTopicDesc =
      "Trade the MES opening range breakout (first 30 minutes high/low) with an ATR-based stop. " +
      "Documented hit rate ~70% on RTH sessions in trending regimes.";
    const result = tier1RegexFilter({
      title: "MES opening range breakout",
      description: onTopicDesc,
      signal_type: "strategy_candidate",
    });
    expect(result.accept).toBe(true);
  });
});

// ─── stripMarkdown ─────────────────────────────────────────────────────────

describe("stripMarkdown", () => {
  it("strips ATX headings", () => {
    expect(stripMarkdown("# Heading")).toBe("Heading");
    expect(stripMarkdown("### Sub")).toBe("Sub");
  });

  it("strips bold markers", () => {
    expect(stripMarkdown("**bold text**")).toBe("bold text");
  });

  it("strips italic markers", () => {
    expect(stripMarkdown("a *italic* word")).toBe("a italic word");
  });

  it("strips inline code", () => {
    expect(stripMarkdown("use the `RSI` indicator")).toBe("use the RSI indicator");
  });

  it("strips link syntax", () => {
    expect(stripMarkdown("see [the docs](https://x.com)")).toBe("see the docs");
  });

  it("returns empty string for empty input", () => {
    expect(stripMarkdown("")).toBe("");
  });

  it("handles all 5 patterns combined", () => {
    const out = stripMarkdown("# Title\n**Bold** and *italic* with `code` and [link](url)");
    expect(out).toContain("Title");
    expect(out).toContain("Bold");
    expect(out).toContain("italic");
    expect(out).toContain("code");
    expect(out).toContain("link");
    expect(out).not.toContain("**");
    expect(out).not.toContain("`");
    expect(out).not.toContain("](");
  });
});

// ─── smartTruncate ────────────────────────────────────────────────────────

describe("smartTruncate", () => {
  it("returns input unchanged when shorter than n", () => {
    expect(smartTruncate("short", 100)).toBe("short");
  });

  it("cuts at last space before n", () => {
    expect(smartTruncate("the quick brown fox jumped", 12)).toBe("the quick");
  });

  it("hard cuts when no whitespace", () => {
    expect(smartTruncate("supercalifragilisticexpialidocious", 10)).toBe("supercalif");
  });

  it("returns empty for empty input", () => {
    expect(smartTruncate("", 10)).toBe("");
  });
});

// ─── generateOneSentenceLead ──────────────────────────────────────────────

describe("generateOneSentenceLead", () => {
  it("returns first sentence terminated by period", () => {
    expect(generateOneSentenceLead("First sentence. Second sentence.")).toBe("First sentence.");
  });

  it("handles ! and ? terminators", () => {
    expect(generateOneSentenceLead("What now? More text.")).toBe("What now?");
    expect(generateOneSentenceLead("Big news! More text.")).toBe("Big news!");
  });

  it("falls back to whole input when no terminator", () => {
    expect(generateOneSentenceLead("no terminator here")).toBe("no terminator here");
  });

  it("returns empty for empty input", () => {
    expect(generateOneSentenceLead("")).toBe("");
  });

  it("truncates very long sentence on word boundary", () => {
    const long = "x".repeat(50) + " " + "y".repeat(200) + ".";
    const out = generateOneSentenceLead(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith(" ")).toBe(false);
  });

  it("strips markdown before extracting", () => {
    const out = generateOneSentenceLead("**Bold lead**. Rest of text.");
    expect(out).toBe("Bold lead.");
  });
});

// ─── Tier-2 auditor (mocked callOpenAI) ───────────────────────────────────

describe("tier2AuditorFilter", () => {
  beforeEach(async () => {
    const mod = await import("../services/agent-service.js");
    mod.__resetScoutAuditorBudgetForTests();
  });

  const baseIdea = {
    title: "MNQ VWAP fade RTH",
    description: "Fade extreme deviations from VWAP during the first 30 minutes of RTH on MNQ.",
    url: "https://example.com",
    source: "reddit",
    signal_type: "strategy_candidate",
  };

  it("accepts when score >= 5", async () => {
    const fakeCall = vi.fn().mockResolvedValue(JSON.stringify({ score: 7, reason: "looks fine" }));
    const { tier2AuditorFilter } = await import("../services/agent-service.js");
    const r = await tier2AuditorFilter(baseIdea, fakeCall as any);
    expect(r.accept).toBe(true);
    expect(r.score).toBe(7);
    expect(r.source).toBe("auditor");
  });

  it("rejects when score < 5", async () => {
    const fakeCall = vi.fn().mockResolvedValue(JSON.stringify({ score: 2, reason: "too vague" }));
    const { tier2AuditorFilter } = await import("../services/agent-service.js");
    const r = await tier2AuditorFilter(baseIdea, fakeCall as any);
    expect(r.accept).toBe(false);
    expect(r.score).toBe(2);
  });

  it("respects explicit accept boolean over score heuristic", async () => {
    const fakeCall = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ score: 2, accept: true, reason: "override" }));
    const { tier2AuditorFilter } = await import("../services/agent-service.js");
    const r = await tier2AuditorFilter(baseIdea, fakeCall as any);
    expect(r.accept).toBe(true);
  });

  it("fail-open on null LLM response", async () => {
    const fakeCall = vi.fn().mockResolvedValue(null);
    const { tier2AuditorFilter } = await import("../services/agent-service.js");
    const r = await tier2AuditorFilter(baseIdea, fakeCall as any);
    expect(r.accept).toBe(true);
    expect(r.source).toBe("fail_open");
  });

  it("fail-open on parse error", async () => {
    const fakeCall = vi.fn().mockResolvedValue("not json {{");
    const { tier2AuditorFilter } = await import("../services/agent-service.js");
    const r = await tier2AuditorFilter(baseIdea, fakeCall as any);
    expect(r.accept).toBe(true);
    expect(r.source).toBe("fail_open");
  });

  it("fail-open on LLM throw", async () => {
    const fakeCall = vi.fn().mockRejectedValue(new Error("network"));
    const { tier2AuditorFilter } = await import("../services/agent-service.js");
    const r = await tier2AuditorFilter(baseIdea, fakeCall as any);
    expect(r.accept).toBe(true);
    expect(r.source).toBe("fail_open");
  });

  it("budget exhausted at 201st call → fail-open with budget_exhausted source", async () => {
    const fakeCall = vi.fn().mockResolvedValue(JSON.stringify({ score: 9 }));
    const { tier2AuditorFilter } = await import("../services/agent-service.js");
    for (let i = 0; i < 200; i++) {
      const r = await tier2AuditorFilter(baseIdea, fakeCall as any);
      expect(r.source).toBe("auditor");
    }
    const r201 = await tier2AuditorFilter(baseIdea, fakeCall as any);
    expect(r201.accept).toBe(true);
    expect(r201.source).toBe("budget_exhausted");
    expect(fakeCall).toHaveBeenCalledTimes(200);
  });

  it("passes signal_type through taskContext to callOpenAI", async () => {
    const fakeCall = vi.fn().mockResolvedValue(JSON.stringify({ score: 8 }));
    const { tier2AuditorFilter } = await import("../services/agent-service.js");
    await tier2AuditorFilter(baseIdea, fakeCall as any);
    expect(fakeCall).toHaveBeenCalledWith(
      "scout_auditor",
      expect.any(Array),
      expect.objectContaining({ signalType: "strategy_candidate" }),
    );
  });

  it("defaults signal_type to strategy_candidate when missing", async () => {
    const fakeCall = vi.fn().mockResolvedValue(JSON.stringify({ score: 8 }));
    const { tier2AuditorFilter } = await import("../services/agent-service.js");
    await tier2AuditorFilter({ ...baseIdea, signal_type: undefined } as any, fakeCall as any);
    expect(fakeCall).toHaveBeenCalledWith(
      "scout_auditor",
      expect.any(Array),
      expect.objectContaining({ signalType: "strategy_candidate" }),
    );
  });
});

// ─── drainScoutedIdeas SELECT shape (signal_type filter) ──────────────────

describe("drainScoutedIdeas signal_type filter", () => {
  it("agent-service.ts source includes the strategy_candidate / NULL OR clause", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/services/agent-service.ts"),
      "utf-8",
    );
    expect(src).toMatch(/strategyParams.*->>.*'signal_type'.*=.*'strategy_candidate'/s);
    expect(src).toMatch(/strategyParams.*->>.*'signal_type'.*IS NULL/s);
  });

  it("synthesizer routing uses callOpenAI strategy_proposer (not direct ollama trading-quant)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/services/agent-service.ts"),
      "utf-8",
    );
    // Drain path now uses callOpenAI("strategy_proposer", ...)
    expect(src).toMatch(/callOpenAI\(\s*"strategy_proposer"/);
    // The old "trading-quant" Ollama direct call is gone from drain path
    // (we still tolerate it in other code paths)
    const drainSection = src.slice(src.indexOf("async drainScoutedIdeas"));
    expect(drainSection).not.toMatch(/this\.ollama\.generate\("trading-quant"/);
  });

  it("refusal {reject:true} handler exists and writes status='failed'", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "src/server/services/agent-service.ts"),
      "utf-8",
    );
    expect(src).toMatch(/dsl\.reject\s*===\s*true/);
    expect(src).toMatch(/status:\s*"failed"/);
    expect(src).toMatch(/Synthesizer refused/);
  });
});
