/**
 * carter-research.test.ts — Wave 7 RESEARCH lane (NON-strategy).
 *
 * Covers:
 *   - institutional_research provider FAN-OUT across Brave/Exa/Tavily/Reddit.
 *   - GRACEFUL per-provider degradation: one provider failing still returns,
 *     with that provider listed in providers_failed and the rest in providers_ok.
 *   - missing API key → provider lands in providers_failed (visible, not silent).
 *   - research_reddit returns top posts + a summary (Reddit fetch mocked).
 *   - the governance boundary note ("NOT a strategy source") is present.
 */

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { institutionalResearch, researchReddit } from "../../lib/carter/carter-research.js";

// ── Provider key env (so providers don't short-circuit on no_api_key) ─────────
const ORIG_ENV = { ...process.env };
beforeEach(() => {
  process.env.BRAVE_SEARCH_API_KEY = "brave-test-key";
  process.env.EXA_API_KEY = "exa-test-key";
  process.env.TAVILY_API_KEY = "tavily-test-key";
});
afterEach(() => {
  process.env = { ...ORIG_ENV };
});

// ── fetch mock factory keyed by URL ───────────────────────────────────────────
function makeFetch(opts: { tavilyFails?: boolean; braveFails?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("api.search.brave.com")) {
      if (opts.braveFails) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      return { ok: true, json: async () => ({ web: { results: [{ title: "Brave Result", url: "https://b.com/1", description: "brave snippet" }] } }) } as unknown as Response;
    }
    if (u.includes("api.exa.ai/search")) {
      return { ok: true, json: async () => ({ results: [{ title: "Exa Paper", url: "https://exa.com/p1", text: "exa snippet", publishedDate: "2025-06-01" }] }) } as unknown as Response;
    }
    if (u.includes("api.tavily.com/search")) {
      if (opts.tavilyFails) return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
      return { ok: true, json: async () => ({ results: [{ title: "Tavily Result", url: "https://t.com/1", content: "tavily snippet", published_date: "2025-05-01" }] }) } as unknown as Response;
    }
    throw new Error(`unexpected fetch URL: ${u}`);
  });
}

const fixedSynth = vi.fn(async () => "Synthesized brief [1][2].");
const redditOk = vi.fn(async () => ({
  source: "reddit" as const,
  conceptName: "q",
  rawMarkdown: "Top reddit post body and comments",
  upvoteScore: 120,
  postUrl: "https://www.reddit.com/r/algotrading/comments/x/abc/",
  subreddit: "algotrading",
}));

describe("institutional_research — fan-out + graceful degradation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates sources across all providers when all succeed", async () => {
    const result = await institutionalResearch(
      { question: "How do desks size kill switches?" },
      { fetchImpl: makeFetch() as unknown as typeof fetch, synthFn: fixedSynth, redditFn: redditOk as never },
    );
    expect(result.providers_ok).toEqual(expect.arrayContaining(["brave", "exa", "tavily", "reddit"]));
    expect(result.providers_failed).toHaveLength(0);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.brief).toContain("Synthesized");
    expect(result.synthesized_by).toBe("ollama");
  });

  it("GRACEFUL: one provider failing still returns; failed provider listed, others ok", async () => {
    const result = await institutionalResearch(
      { question: "institutional latency budgets" },
      { fetchImpl: makeFetch({ tavilyFails: true }) as unknown as typeof fetch, synthFn: fixedSynth, redditFn: redditOk as never },
    );
    expect(result.providers_failed.map((p) => p.provider)).toContain("tavily");
    expect(result.providers_ok).toEqual(expect.arrayContaining(["brave", "exa", "reddit"]));
    // The tool still produced a brief + sources despite the failure.
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.brief.length).toBeGreaterThan(0);
  });

  it("missing API key lands the provider in providers_failed (visible, not silent)", async () => {
    delete process.env.EXA_API_KEY;
    const result = await institutionalResearch(
      { question: "whitepaper on overfitting" },
      { fetchImpl: makeFetch() as unknown as typeof fetch, synthFn: fixedSynth, redditFn: redditOk as never },
    );
    const exaFail = result.providers_failed.find((p) => p.provider === "exa");
    expect(exaFail).toBeDefined();
    expect(exaFail!.reason).toBe("no_api_key");
  });

  it("falls back to an extractive brief when the LLM synthesizer is unavailable", async () => {
    const result = await institutionalResearch(
      { question: "market microstructure 2025" },
      { fetchImpl: makeFetch() as unknown as typeof fetch, synthFn: async () => null, redditFn: redditOk as never },
    );
    expect(result.synthesized_by).toBe("extractive_fallback");
    expect(result.brief).toContain("market microstructure 2025");
  });

  it("does NOT call Parallel.ai by default (bounded sync path)", async () => {
    const fetchImpl = makeFetch();
    await institutionalResearch(
      { question: "q" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, synthFn: fixedSynth, redditFn: redditOk as never },
    );
    const hitParallel = fetchImpl.mock.calls.some((c) => String(c[0]).includes("parallel.ai"));
    expect(hitParallel).toBe(false);
  });
});

describe("research_reddit — general Reddit research (NON-strategy)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns top posts + a summary, and is flagged NOT a strategy source", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("reddit.com")) {
        return {
          ok: true,
          json: async () => ({
            data: { children: [
              { data: { title: "FOMC reaction thread", permalink: "/r/daytrading/comments/x/fomc/", subreddit: "daytrading", selftext: "discussion", created_utc: 1735689600 } },
            ] },
          }),
        } as unknown as Response;
      }
      throw new Error("unexpected");
    });
    const result = await researchReddit(
      { topic: "FOMC reaction" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, synthFn: fixedSynth },
    );
    expect(result.count).toBeGreaterThan(0);
    expect(result.posts[0].url).toContain("reddit.com");
    expect(result.summary).toBeTruthy();
    expect(result.note).toMatch(/NOT a strategy source/i);
  });

  it("returns empty with a clear message when no discussion is found", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: { children: [] } }) }) as unknown as Response);
    const result = await researchReddit(
      { topic: "obscure topic" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, synthFn: fixedSynth },
    );
    expect(result.count).toBe(0);
    expect(result.summary).toContain("No Reddit discussion");
  });

  it("survives a sub returning 429 (graceful — keeps going)", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response);
    const result = await researchReddit(
      { topic: "x" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, synthFn: fixedSynth },
    );
    expect(result.count).toBe(0);
    expect(result.posts).toEqual([]);
  });
});
