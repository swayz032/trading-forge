/**
 * carter-apify-research.test.ts — Apify-backed ASYNC research (Reddit + Instagram).
 *
 * Covers (NO network — fetch + memory store + audit are all mocked):
 *   - startAndStoreResearch fires the run, returns { started:true }, and writes a
 *     PENDING 'running' marker synchronously; the poller is fired (mocked).
 *   - start FAILURE → { started:false, error } and NO running marker.
 *   - missing token → { started:false, error:'apify_token_missing' }.
 *   - pollRunAndStore SUCCEEDED → writes a 'completed' marker (headline + items)
 *     + completed audit; FAILED → writes a 'failed' marker.
 *   - get_research_result returns running vs completed vs none.
 *   - the registry wiring handlers validate topic + delegate.
 */

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockInsertMemory = vi.fn(async (..._args: unknown[]) => 1);
const mockQueryMemories = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
vi.mock("../../lib/carter/carter-memory-store.js", () => ({
  insertMemory: (...args: unknown[]) => mockInsertMemory(...args),
  queryMemories: (...args: unknown[]) => mockQueryMemories(...args),
}));

const mockAudit = vi.fn(async (..._args: unknown[]) => true);
vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: (...args: unknown[]) => mockAudit(...args),
}));

vi.mock("../../lib/carter/carter-research.js", () => ({
  ollamaSynthesize: vi.fn(async () => null),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startAndStoreResearch,
  pollRunAndStore,
  getLatestResearch,
  buildActorInput,
  instagramDirectUrl,
  normalizeItems,
  CARTER_APIFY_RESEARCH_ACTION_HANDLERS,
  CARTER_APIFY_RESEARCH_READ_HANDLERS,
} from "../../services/apify-research-service.js";

const ORIG_ENV = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  mockInsertMemory.mockResolvedValue(1);
  mockQueryMemories.mockResolvedValue([]);
  process.env.APIFY_REDDIT_TOKEN = "apify_test_token";
});
afterEach(() => {
  process.env = { ...ORIG_ENV };
});

// ── fetch mock: routes by Apify URL segment ───────────────────────────────────
function makeFetch(opts: {
  startStatus?: number;
  runStatus?: string;
  datasetItems?: unknown[];
} = {}) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/acts/") && u.includes("/runs")) {
      if (opts.startStatus && opts.startStatus >= 400) {
        return { ok: false, status: opts.startStatus, json: async () => ({}) } as unknown as Response;
      }
      return {
        ok: true,
        json: async () => ({ data: { id: "run-123", defaultDatasetId: "ds-123", status: "READY" } }),
      } as unknown as Response;
    }
    if (u.includes("/actor-runs/")) {
      return {
        ok: true,
        json: async () => ({ data: { status: opts.runStatus ?? "SUCCEEDED", defaultDatasetId: "ds-123" } }),
      } as unknown as Response;
    }
    if (u.includes("/datasets/")) {
      return { ok: true, json: async () => opts.datasetItems ?? [] } as unknown as Response;
    }
    throw new Error(`unexpected fetch URL: ${u}`);
  });
}

const instantSleep = async () => {};

// ════════════════════════════════════════════════════════════════════════════

describe("buildActorInput / instagramDirectUrl — input shape (verified live)", () => {
  it("reddit input matches the trudax actor contract", () => {
    const { actorId, input } = buildActorInput("reddit", "scalping");
    expect(actorId).toBe("trudax~reddit-scraper-lite");
    expect(input.searches).toEqual(["scalping"]);
    expect(input.sort).toBe("relevance");
    expect(input.skipComments).toBe(true);
  });

  it("instagram uses directUrls to the hashtag page (NOT search mode)", () => {
    const { actorId, input } = buildActorInput("instagram", "daytrading", "hashtag");
    expect(actorId).toBe("apify~instagram-scraper");
    expect(input.directUrls).toEqual(["https://www.instagram.com/explore/tags/daytrading/"]);
    expect(input.resultsType).toBe("posts");
  });

  it("instagram user searchType resolves to a profile URL + sanitizes input", () => {
    expect(instagramDirectUrl("@Some.Trader!", "user")).toBe("https://www.instagram.com/some.trader/");
    expect(instagramDirectUrl("#Day Trading", "hashtag")).toBe("https://www.instagram.com/explore/tags/daytrading/");
  });
});

describe("normalizeItems — bounded, platform-aware", () => {
  it("maps reddit items and skips error sentinels", () => {
    const items = normalizeItems("reddit", [
      { title: "Does scalping work?", url: "https://reddit.com/r/x/1", upVotes: 298, body: "long body", username: "u1", dataType: "post" },
      { error: "no_items", errorDescription: "empty" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Does scalping work?", score: 298, author: "u1" });
  });

  it("maps instagram items via caption + likesCount", () => {
    const items = normalizeItems("instagram", [
      { caption: "Big move today", url: "https://instagram.com/p/abc/", likesCount: 42, ownerUsername: "trader" },
    ]);
    expect(items[0]).toMatchObject({ title: "Big move today", score: 42, author: "trader" });
  });
});

describe("startAndStoreResearch — fire + pending marker", () => {
  it("returns started=true, writes a 'running' marker, and fires the poller", async () => {
    const runPoll = vi.fn(async () => {});
    const result = await startAndStoreResearch(
      { platform: "reddit", topic: "scalping" },
      { fetchImpl: makeFetch() as unknown as typeof fetch, runPoll, nowIso: () => "2026-06-29T00:00:00.000Z" },
    );
    expect(result.started).toBe(true);
    expect(result.runId).toBe("run-123");
    expect(result.note).toMatch(/Scan started/i);

    // PENDING marker written synchronously.
    expect(mockInsertMemory).toHaveBeenCalledTimes(1);
    const memArg = mockInsertMemory.mock.calls[0][0] as { kind: string; source: string; content: string; topic: string };
    expect(memArg.kind).toBe("research");
    expect(memArg.source).toBe("apify");
    expect(memArg.topic).toBe("scalping");
    const parsed = JSON.parse(memArg.content);
    expect(parsed.status).toBe("running");
    expect(parsed.runId).toBe("run-123");

    // Poller fired (not awaited) — using the injected spy so no real timers.
    expect(runPoll).toHaveBeenCalledTimes(1);
    // 'started' audit written.
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "carter_research.started" }));
  });

  it("instagram defaults searchType to hashtag and fires", async () => {
    const runPoll = vi.fn(async () => {});
    const result = await startAndStoreResearch(
      { platform: "instagram", topic: "daytrading" },
      { fetchImpl: makeFetch() as unknown as typeof fetch, runPoll },
    );
    expect(result.started).toBe(true);
    expect(result.platform).toBe("instagram");
  });

  it("start FAILURE is fail-soft → { started:false } and NO running marker", async () => {
    const runPoll = vi.fn(async () => {});
    const result = await startAndStoreResearch(
      { platform: "reddit", topic: "scalping" },
      { fetchImpl: makeFetch({ startStatus: 500 }) as unknown as typeof fetch, runPoll },
    );
    expect(result.started).toBe(false);
    expect(result.error).toContain("apify_start_http_500");
    expect(mockInsertMemory).not.toHaveBeenCalled();
    expect(runPoll).not.toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "carter_research.failed" }));
  });

  it("missing token → { started:false, error:'apify_token_missing' }", async () => {
    delete process.env.APIFY_REDDIT_TOKEN;
    delete process.env.APIFY_API_KEY;
    const runPoll = vi.fn(async () => {});
    const result = await startAndStoreResearch(
      { platform: "reddit", topic: "scalping" },
      { fetchImpl: makeFetch() as unknown as typeof fetch, runPoll },
    );
    expect(result.started).toBe(false);
    expect(result.error).toBe("apify_token_missing");
    expect(runPoll).not.toHaveBeenCalled();
  });

  it("empty topic → { started:false, error:'topic_required' }", async () => {
    const result = await startAndStoreResearch(
      { platform: "reddit", topic: "   " },
      { fetchImpl: makeFetch() as unknown as typeof fetch, runPoll: vi.fn(async () => {}) },
    );
    expect(result.started).toBe(false);
    expect(result.error).toBe("topic_required");
  });
});

describe("pollRunAndStore — store completed / failed (NEVER throws)", () => {
  it("SUCCEEDED → writes a 'completed' marker with headline + items + audit", async () => {
    await pollRunAndStore({
      runId: "run-123",
      datasetId: "ds-123",
      platform: "reddit",
      topic: "scalping",
      fetchImpl: makeFetch({
        runStatus: "SUCCEEDED",
        datasetItems: [{ title: "Does scalping work?", url: "https://reddit.com/r/x/1", upVotes: 298, body: "b", username: "u" }],
      }) as unknown as typeof fetch,
      sleepFn: instantSleep,
      nowIso: () => "2026-06-29T00:01:00.000Z",
    });
    expect(mockInsertMemory).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse((mockInsertMemory.mock.calls[0][0] as { content: string }).content);
    expect(parsed.status).toBe("completed");
    expect(parsed.headline).toMatch(/scalping/);
    expect(parsed.items).toHaveLength(1);
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "carter_research.completed" }));
  });

  it("FAILED → writes a 'failed' marker (does not throw)", async () => {
    await expect(
      pollRunAndStore({
        runId: "run-123",
        datasetId: "ds-123",
        platform: "instagram",
        topic: "daytrading",
        fetchImpl: makeFetch({ runStatus: "FAILED" }) as unknown as typeof fetch,
        sleepFn: instantSleep,
      }),
    ).resolves.toBeUndefined();
    const parsed = JSON.parse((mockInsertMemory.mock.calls[0][0] as { content: string }).content);
    expect(parsed.status).toBe("failed");
    expect(parsed.reason).toBe("run_failed");
  });
});

describe("getLatestResearch — latest per topic", () => {
  it("returns 'no research yet' when nothing stored", async () => {
    mockQueryMemories.mockResolvedValue([]);
    const out = await getLatestResearch({ topic: "scalping" });
    expect(out.count).toBe(0);
    expect(out.note).toBe("no research yet");
  });

  it("surfaces a 'running' status with a still-scraping note", async () => {
    mockQueryMemories.mockResolvedValue([
      {
        id: 1,
        kind: "research",
        topic: "scalping",
        content: JSON.stringify({ platform: "reddit", topic: "scalping", status: "running", runId: "r1" }),
        createdAt: new Date(),
      },
    ]);
    const out = await getLatestResearch({ topic: "scalping" });
    expect(out.results[0].status).toBe("running");
    expect(out.results[0].note).toMatch(/scraping/i);
  });

  it("surfaces a 'completed' status with headline + items", async () => {
    mockQueryMemories.mockResolvedValue([
      {
        id: 2,
        kind: "research",
        topic: "scalping",
        content: JSON.stringify({
          platform: "reddit",
          topic: "scalping",
          status: "completed",
          headline: "3 Reddit posts on scalping",
          items: [{ title: "t", url: "https://reddit.com/1", score: 5, snippet: "s" }],
        }),
        createdAt: new Date(),
      },
    ]);
    const out = await getLatestResearch({ topic: "scalping" });
    expect(out.results[0].status).toBe("completed");
    expect(out.results[0].headline).toMatch(/scalping/);
    expect(out.results[0].items).toHaveLength(1);
  });

  it("keeps only the LATEST row per topic (rows are newest-first)", async () => {
    mockQueryMemories.mockResolvedValue([
      { id: 3, kind: "research", topic: "scalping", content: JSON.stringify({ platform: "reddit", topic: "scalping", status: "completed", headline: "new" }), createdAt: new Date() },
      { id: 2, kind: "research", topic: "scalping", content: JSON.stringify({ platform: "reddit", topic: "scalping", status: "running" }), createdAt: new Date() },
    ]);
    const out = await getLatestResearch({});
    expect(out.count).toBe(1);
    expect(out.results[0].status).toBe("completed");
  });
});

describe("handler wiring — registry maps", () => {
  it("research_reddit handler validates topic + delegates to a started run", async () => {
    const missing = await CARTER_APIFY_RESEARCH_ACTION_HANDLERS.research_reddit({}) as Record<string, unknown>;
    expect(missing.error).toBe("topic is required");
    expect(mockInsertMemory).not.toHaveBeenCalled();
  });

  it("research_instagram handler validates topic", async () => {
    const missing = await CARTER_APIFY_RESEARCH_ACTION_HANDLERS.research_instagram({}) as Record<string, unknown>;
    expect(missing.error).toBe("topic is required");
  });

  it("get_research_result handler returns the latest store read", async () => {
    mockQueryMemories.mockResolvedValue([]);
    const out = await CARTER_APIFY_RESEARCH_READ_HANDLERS.get_research_result({ topic: "scalping" }) as Record<string, unknown>;
    expect(out.note).toBe("no research yet");
  });
});
