/**
 * wave23g-reddit-cross-extract.test.ts — W23G.8 Reddit cross-extract enrichment
 *
 * Tests fetchRedditEnrichment in isolation with an injected fetchFn mock.
 * The helper is pure (no DB, no audit, no logger) so we don't need to mock
 * the Express bootstrap graph.
 *
 * Coverage:
 *   1. Single post with upvotes >= 50 → returns combined markdown
 *   2. All posts < 50 upvotes → null
 *   3. Post in non-whitelisted sub → filtered, null
 *   4. 429 from Reddit search → null (no throw)
 *   5. Markdown contains post body + 5 comments in expected format
 *   6. Subreddit whitelist enforced via opts override
 *   7. Synthetic concept appears only in Reddit (search hit + comments) — full happy path
 */

import { describe, it, expect } from "vitest";
import { fetchRedditEnrichment } from "../services/reddit-cross-extract.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build a Reddit search.json response with N child posts. */
function searchResponse(posts: Array<{
  id: string;
  title: string;
  selftext: string;
  ups: number;
  subreddit: string;
}>): any {
  return {
    data: {
      children: posts.map((p) => ({
        kind: "t3",
        data: {
          id: p.id,
          title: p.title,
          selftext: p.selftext,
          ups: p.ups,
          score: p.ups,
          subreddit: p.subreddit,
          permalink: `/r/${p.subreddit}/comments/${p.id}/`,
        },
      })),
    },
  };
}

/** Build a comment listing — second element of the comments.json array. */
function commentsResponse(comments: Array<{ body: string; score: number; author: string }>): any {
  return [
    { data: { children: [] } }, // post listing (ignored by helper)
    {
      data: {
        children: comments.map((c) => ({
          kind: "t1",
          data: {
            body: c.body,
            score: c.score,
            author: c.author,
          },
        })),
      },
    },
  ];
}

/** Tiny in-test mock implementation of fetch (URL-routed). */
function makeFetchMock(routes: Array<{ match: (url: string) => boolean; status: number; body: any }>): typeof fetch {
  return (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    for (const r of routes) {
      if (r.match(url)) {
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async () => r.body,
        } as Response;
      }
    }
    // Default — empty search
    return {
      ok: true,
      status: 200,
      json: async () => searchResponse([]),
    } as Response;
  }) as typeof fetch;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("fetchRedditEnrichment", () => {
  it("test 1: finds 1 post with upvotes=80 → returns combined markdown", async () => {
    const fetchFn = makeFetchMock([
      {
        match: (u) => u.includes("/search.json") && u.includes("/r/futurestrading/"),
        status: 200,
        body: searchResponse([
          {
            id: "abc123",
            title: "ORB MES 5min — exact rules I use",
            selftext: "I enter on 15-minute opening range break, stop at swing low, target 2R.",
            ups: 80,
            subreddit: "futurestrading",
          },
        ]),
      },
      {
        match: (u) => u.includes("/comments/abc123.json"),
        status: 200,
        body: commentsResponse([
          { body: "I add a VWAP filter and skip if NR4", score: 25, author: "alice" },
          { body: "Use 9 EMA for confirmation", score: 18, author: "bob" },
        ]),
      },
    ]);

    const result = await fetchRedditEnrichment("opening_range_breakout", { fetchFn });

    expect(result).not.toBeNull();
    expect(result!.source).toBe("reddit");
    expect(result!.conceptName).toBe("opening_range_breakout");
    expect(result!.upvoteScore).toBe(80);
    expect(result!.subreddit).toBe("futurestrading");
    expect(result!.postUrl).toContain("reddit.com");
    expect(result!.rawMarkdown).toContain("ORB MES 5min");
    expect(result!.rawMarkdown).toContain("opening range break");
  });

  it("test 2: all posts < 50 upvotes → returns null", async () => {
    const fetchFn = makeFetchMock([
      {
        match: (u) => u.includes("/search.json"),
        status: 200,
        body: searchResponse([
          { id: "low1", title: "low post", selftext: "x".repeat(300), ups: 10, subreddit: "futurestrading" },
          { id: "low2", title: "another", selftext: "y".repeat(300), ups: 45, subreddit: "daytrading" },
        ]),
      },
    ]);

    const result = await fetchRedditEnrichment("rsi_2_reversal", { fetchFn });
    expect(result).toBeNull();
  });

  it("test 3: post in non-whitelisted sub → filtered out, null", async () => {
    // Reddit's search.json is restricted to the sub we query, but a malicious or
    // misconfigured result could echo a different subreddit field. The helper
    // re-checks the whitelist on the result side. Simulate that here.
    const fetchFn = makeFetchMock([
      {
        match: (u) => u.includes("/search.json"),
        status: 200,
        body: searchResponse([
          {
            id: "x1",
            title: "stocks post",
            selftext: "z".repeat(300),
            ups: 200,
            subreddit: "wallstreetbets",  // NOT whitelisted
          },
        ]),
      },
    ]);

    const result = await fetchRedditEnrichment("trend_pullback", { fetchFn });
    expect(result).toBeNull();
  });

  it("test 4: 429 from Reddit → returns null (no throw)", async () => {
    const fetchFn = makeFetchMock([
      {
        match: (u) => u.includes("/search.json"),
        status: 429,
        body: { error: "rate limited" },
      },
    ]);

    let threw = false;
    let result: unknown = "unset";
    try {
      result = await fetchRedditEnrichment("ema_crossover", { fetchFn });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toBeNull();
  });

  it("test 5: markdown has post body + 5 comments in expected format", async () => {
    const fetchFn = makeFetchMock([
      {
        match: (u) => u.includes("/search.json"),
        status: 200,
        body: searchResponse([
          {
            id: "p9",
            title: "Liquidity sweep entry",
            selftext: "Wait for sweep of swing high, then short on FVG retrace.",
            ups: 120,
            subreddit: "algotrading",
          },
        ]),
      },
      {
        match: (u) => u.includes("/comments/p9.json"),
        status: 200,
        body: commentsResponse([
          { body: "Use the 1m FVG, not 5m", score: 50, author: "c1" },
          { body: "I add session filter — kill zones only", score: 40, author: "c2" },
          { body: "Risk 0.5R stop above sweep wick", score: 30, author: "c3" },
          { body: "Target 2R or daily PD array", score: 20, author: "c4" },
          { body: "Skip if NFP/CPI week", score: 15, author: "c5" },
          { body: "Avoid Monday open", score: 10, author: "c6" }, // 6th — should NOT appear
        ]),
      },
    ]);

    const result = await fetchRedditEnrichment("liquidity_sweep", { fetchFn });
    expect(result).not.toBeNull();
    const md = result!.rawMarkdown;
    expect(md.startsWith("# Liquidity sweep entry")).toBe(true);
    expect(md).toContain("## Comments");
    // Top 5 by score should appear; 6th should not
    expect(md).toContain("c1");
    expect(md).toContain("c2");
    expect(md).toContain("c3");
    expect(md).toContain("c4");
    expect(md).toContain("c5");
    expect(md).not.toContain("c6");
    // Author + score formatting
    expect(md).toContain("**u/c1 (50 points)**");
  });

  it("test 6: subreddit whitelist enforced via opts override", async () => {
    // Override whitelist to ONLY include `algotrading`. A post in `futurestrading`
    // (default whitelisted) should be rejected by the override.
    const fetchFn = makeFetchMock([
      {
        match: (u) => u.includes("/search.json"),
        status: 200,
        body: searchResponse([
          {
            id: "q1",
            title: "rsi2 setup",
            selftext: "x".repeat(300),
            ups: 200,
            subreddit: "futurestrading",
          },
        ]),
      },
    ]);

    const result = await fetchRedditEnrichment("rsi_2_reversal", {
      fetchFn,
      allowedSubreddits: ["algotrading"],
    });
    expect(result).toBeNull();
  });

  it("test 7: synthetic concept found only in Reddit — end-to-end happy path with comments", async () => {
    // Concept "wyckoff_spring_continuation" — only the Reddit layer returns a
    // post + comments rich enough to drive a scout-extract. The helper builds
    // the markdown; the runner is responsible for feeding that markdown to
    // /scout-extract (tested separately in the runner integration suite).
    const fetchFn = makeFetchMock([
      {
        match: (u) => u.includes("/r/futurestrading/search.json"),
        status: 200,
        body: searchResponse([
          {
            id: "wy1",
            title: "Wyckoff spring continuation — my exact MNQ rules",
            selftext:
              "I trade Wyckoff spring on MNQ 5m. Entry: spring + secondary test + SOS bar close above last LPS. " +
              "Stop: 1pt below spring low. Target 1: prior swing high (TP1 33% off). " +
              "Target 2: 2R. Runner trails developing POC.",
            ups: 145,
            subreddit: "futurestrading",
          },
        ]),
      },
      {
        match: (u) => u.includes("/comments/wy1.json"),
        status: 200,
        body: commentsResponse([
          { body: "I use 15m for accumulation, 5m for trigger", score: 60, author: "u1" },
          { body: "Volume must dry up on test bar", score: 45, author: "u2" },
          { body: "Skip if HTF trend is down", score: 33, author: "u3" },
        ]),
      },
    ]);

    const result = await fetchRedditEnrichment("wyckoff_spring_continuation", { fetchFn });
    expect(result).not.toBeNull();
    expect(result!.upvoteScore).toBe(145);
    expect(result!.subreddit).toBe("futurestrading");
    expect(result!.rawMarkdown).toContain("Wyckoff spring");
    expect(result!.rawMarkdown).toContain("Stop: 1pt below spring low");
    expect(result!.rawMarkdown).toContain("u/u1 (60 points)");
    // Suitable for re-feeding into scout-extract
    expect(result!.rawMarkdown.length).toBeGreaterThan(200);
  });

  it("returns null cleanly when concept string is empty/whitespace", async () => {
    const fetchFn = makeFetchMock([]);
    const result = await fetchRedditEnrichment("   ", { fetchFn });
    expect(result).toBeNull();
  });

  it("post-only enrichment when comments endpoint 429s", async () => {
    // Search succeeds, comments endpoint returns 429 — helper should still return
    // the post body (no comments section) rather than throwing or nulling.
    const fetchFn = makeFetchMock([
      {
        match: (u) => u.includes("/search.json"),
        status: 200,
        body: searchResponse([
          {
            id: "po1",
            title: "VWAP fade rules",
            selftext: "Enter on 2nd touch of VWAP standard band, stop 1ATR away, target VWAP.",
            ups: 75,
            subreddit: "daytrading",
          },
        ]),
      },
      {
        match: (u) => u.includes("/comments/po1.json"),
        status: 429,
        body: {},
      },
    ]);

    const result = await fetchRedditEnrichment("vwap_fade", { fetchFn });
    expect(result).not.toBeNull();
    expect(result!.rawMarkdown).toContain("# VWAP fade rules");
    expect(result!.rawMarkdown).toContain("Enter on 2nd touch");
    // No comments section when comments fetch failed
    expect(result!.rawMarkdown).not.toContain("## Comments");
  });
});
