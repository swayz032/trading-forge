/**
 * Scout Pending Endpoint Tests — Pass 18
 *
 * Covers POST /api/agent/scout-ideas/pending:
 *  1.  Valid pending insert → 201, bucket created, mention inserted
 *  2.  Bucket upsert on new fingerprint → new bucket created
 *  3.  Bucket upsert on existing fingerprint → last_seen bumped (same bucket_id)
 *  4.  Mention idempotency — duplicate source_url for same bucket → rejected silently
 *  5.  is_cross_validation_result=true skips CV1 webhook
 *  6.  Market validation — rejects ES (not MES/MNQ/MCL)
 *  7.  Market validation — rejects NQ (not MES/MNQ/MCL)
 *  8.  Market validation — rejects CL (not MES/MNQ/MCL)
 *  9.  Missing required fields → 400
 * 10.  Thesis too short (<20 chars) → 400
 * 11.  Graduation fires at distinct_providers ≥ 3 AND source_count ≥ 3
 * 12.  Graduation does NOT fire at 2 distinct providers
 * 13.  Response includes bucket_id, fingerprint_hash, source_count, distinct_providers, status
 * 14.  source_provider extended enum accepts 'youtube', 'apify', 'tf_search'
 *      (Wave 9: scrapingbee variants retained in enum for back-compat with
 *       pre-Wave-9 DB rows; the active scout pipeline no longer emits them)
 *
 * DB is fully mocked — no real Postgres. CV1 fetch mocked via global fetch mock.
 * No network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ─── Module mocks (must be declared before any import that uses them) ───────

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// DB mock — returns controllable responses
const dbExecuteMock  = vi.fn();
const dbInsertMock   = vi.fn();
const dbUpdateMock   = vi.fn();
const dbSelectMock   = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    execute:  (...args: unknown[]) => dbExecuteMock(...args),
    insert:   (...args: unknown[]) => dbInsertMock(...args),
    update:   (...args: unknown[]) => dbUpdateMock(...args),
    select:   (...args: unknown[]) => dbSelectMock(...args),
    delete:   vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog:                  Symbol("auditLog"),
  strategyPendingBuckets:    Symbol("strategyPendingBuckets"),
  strategyPendingMentions:   Symbol("strategyPendingMentions"),
  idempotencyKeys:           Symbol("idempotencyKeys"),
  systemJournal:             Symbol("systemJournal"),
  strategies:                Symbol("strategies"),
}));

vi.mock("../middleware/idempotency.js", () => ({
  idempotencyMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middleware/require-live-n8n.js", () => ({
  requireLiveN8n: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Pass 19 Track E: the pending route calls verifySourceUrl() via a dynamic
// import. Test fixtures use example.com URLs which are explicitly blocked by
// the verifier's test-pattern guard. Mock the whole module so tests bypass
// real HTTP calls and the fixture-URL rejection gate.
vi.mock("../services/source-url-verifier.js", () => ({
  verifySourceUrl: vi.fn().mockResolvedValue({ verified: true, fetchedBytes: 512 }),
}));

vi.mock("../services/agent-service.js", () => ({
  AgentService: class {
    scoutIdeas       = vi.fn().mockResolvedValue({ count: 0 });
    drainScoutedIdeas = vi.fn().mockResolvedValue(undefined);
    runStrategyFromDSL = vi.fn().mockResolvedValue({ status: "pending" });
    getFailurePatterns = vi.fn().mockResolvedValue({ avoidPatterns: [] });
    runStrategy        = vi.fn().mockResolvedValue({ status: "submitted" });
    runClassStrategy   = vi.fn().mockResolvedValue({ status: "submitted" });
    batchSubmit        = vi.fn().mockResolvedValue(undefined);
    critiqueResults    = vi.fn().mockResolvedValue({ critique: "ok" });
  },
}));

vi.mock("../services/regime-service.js",    () => ({ analyzeMarket:   vi.fn() }));
vi.mock("../services/robustness-service.js", () => ({ runRobustnessTest: vi.fn() }));
vi.mock("../services/ollama-client.js",      () => ({ OllamaClient: class {} }));
vi.mock("../lib/python-runner.js",           () => ({ runPythonModule: vi.fn() }));

// Pass 18 observability: mock SSE broadcast and notification service so tests
// don't try to fan out to real connected clients or Discord webhooks.
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
  PAPER_EXIT_EVENTS:  {},
  COMPLIANCE_EVENTS:  {},
  KILL_SWITCH_EVENTS: {},
}));

vi.mock("../services/notification-service.js", () => ({
  notify:           vi.fn(),
  notifyCritical:   vi.fn(),
  notifyWarning:    vi.fn(),
  notifyInfo:       vi.fn(),
  flushNotifications: vi.fn().mockResolvedValue(undefined),
  getNotificationServiceStatus: vi.fn().mockReturnValue({
    configured: false, warningQueueDepth: 0, recentCallCount: 0, rateLimitBudgetRemaining: 5,
  }),
  _resetForTests: vi.fn(),
}));

vi.mock("../lib/metrics-registry.js", () => ({
  crossValidatorCallsTotal:          { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  crossValidatorLatencySeconds:      { observe: vi.fn() },
  pendingBucketsGraduatedTotal:      { inc: vi.fn() },
  pendingBucketsTotal:               { labels: vi.fn().mockReturnValue({ set: vi.fn() }) },
  pendingBucketExpiredMentionsTotal: { inc: vi.fn() },
  httpRequestDurationMs:             { labels: vi.fn().mockReturnValue({ observe: vi.fn() }) },
  strategyPromotions:                { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  backtestRuns:                      { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  paperTrades:                       { labels: vi.fn().mockReturnValue({ inc: vi.fn() }) },
  circuitBreakerState:               { labels: vi.fn().mockReturnValue({ set: vi.fn() }) },
  circuitBreakerFailures:            { labels: vi.fn().mockReturnValue({ set: vi.fn() }) },
  pythonSubprocessActive:            { set: vi.fn() },
  pythonSubprocessQueued:            { set: vi.fn() },
  promRegistry:                      { contentType: "text/plain", metrics: vi.fn().mockResolvedValue("") },
}));

const callOpenAIOrFallbackMock = vi.fn();
vi.mock("../services/model-router.js", () => ({
  callOpenAI:             vi.fn(),
  callOpenAIOrFallback:   (...args: unknown[]) => callOpenAIOrFallbackMock(...args),
  selectModel:            vi.fn(),
}));

// We do NOT stub global fetch at module level because the test helper (postPending)
// also uses fetch to call the endpoint over localhost. Instead we capture the
// original fetch and restore after each test that needs to intercept CV1 calls.

import { agentRoutes } from "../routes/agent.js";

// ─── Test server setup ───────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/agent", agentRoutes);
  server = app.listen(0);
  await new Promise<void>((r) => server.on("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const VALID_IDEA = {
  thesis:          "MES opening range breakout strategy: enter long when price breaks above the 30-minute ORB with volume confirmation",
  market:          "MES",
  timeframe:       "5m",
  entry_rules:     "Enter long on breakout above the 30-minute opening range high with volume > average",
  exit_rules:      "Take profit at 2x ATR multiple; trail behind last swing low",
  risk_rules:      "ATR stop 1.5x; max 4 MES contracts; structural stop ceiling 14pt",
  source_url:      "https://example.com/mes-orb-strategy",
  regime:          "TRENDING_UP",
  concept_name:    "orb_breakout",
  source_provider: "tavily",
  confidence_score: 0.75,
};

async function postPending(body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/api/agent/scout-ideas/pending`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// Build the default DB mock chain for a successful insert
function setupDefaultDbMocks(overrides: {
  bucketId?: string;
  sourceCount?: number;
  distinctProviders?: number;
  bucketStatus?: string;
} = {}) {
  const bucketId         = overrides.bucketId        ?? "bucket-uuid-1234";
  const sourceCount      = overrides.sourceCount      ?? 1;
  const distinctProviders = overrides.distinctProviders ?? 1;
  const bucketStatus     = overrides.bucketStatus     ?? "pending";

  // db.insert(strategyPendingBuckets).values(...).onConflictDoUpdate(...).returning()
  const bucketInsertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{
      id:            bucketId,
      fingerprintHash: "abc123",
      market:        "MES",
      entryArchetype: "breakout",
      exitType:      "atr_multiple",
      sourceCount:   0,
      distinctProviders: 0,
      status:        bucketStatus,
    }]),
  };

  // db.insert(strategyPendingMentions).values(...).onConflictDoNothing().returning()
  const mentionInsertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{
      id:       "mention-uuid-5678",
      bucketId,
      sourceUrl: VALID_IDEA.source_url,
    }]),
  };

  // db.insert(auditLog).values(...).catch(...)
  // The route awaits / chains .catch() on the resulting promise — values() must
  // therefore return a real promise-like object whose .catch is a no-op.
  const auditInsertChain = {
    values: vi.fn().mockReturnValue({
      catch: vi.fn().mockResolvedValue(undefined),
    }),
  };

  // db.execute for COUNT query
  dbExecuteMock.mockResolvedValue([{
    source_count:       sourceCount,
    distinct_providers: distinctProviders,
  }]);

  // db.insert dispatcher — the route inserts in this order on a fresh bucket:
  //   1. bucket   (strategyPendingBuckets, returning)
  //   2. audit    (pending_bucket.created — only when isBucketNew)
  //   3. mention  (strategyPendingMentions, returning)
  //   4. audit    (pending_bucket.mention_added)
  //   5+. audit   (graduation audit on threshold cross)
  // The schema mock turns the table symbols into Symbols; we can dispatch on
  // identity by inspecting the first argument.
  let bucketCalls = 0;
  let mentionCalls = 0;
  dbInsertMock.mockImplementation((table: unknown) => {
    const tag = String(typeof table === "symbol" ? table.toString() : table);
    if (tag.includes("strategyPendingBuckets")) {
      bucketCalls++;
      return bucketInsertChain;
    }
    if (tag.includes("strategyPendingMentions")) {
      mentionCalls++;
      return mentionInsertChain;
    }
    return auditInsertChain;
  });

  // db.update for bucket count update + graduation check (both return empty unless told otherwise)
  dbUpdateMock.mockReturnValue({
    set:     vi.fn().mockReturnThis(),
    where:   vi.fn().mockResolvedValue([]),
    returning: vi.fn().mockResolvedValue([]),
  });

  return { bucketId, sourceCount, distinctProviders };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// Track whether we've stubbed fetch so we can restore it
let originalFetch: typeof fetch;

describe("POST /api/agent/scout-ideas/pending", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    dbExecuteMock.mockReset();
    dbInsertMock.mockReset();
    dbUpdateMock.mockReset();
    dbSelectMock.mockReset();
    callOpenAIOrFallbackMock.mockReset();
    // Ensure N8N env vars are unset by default (prevents CV1 webhook from firing)
    delete process.env.N8N_BASE_URL;
    delete process.env.N8N_CV1_BEARER;
  });

  afterEach(() => {
    // Restore original fetch if it was replaced
    globalThis.fetch = originalFetch;
    delete process.env.N8N_BASE_URL;
    delete process.env.N8N_CV1_BEARER;
  });

  // ─── 1. Valid pending insert returns 201 ──────────────────────────────
  it("returns 201 with expected shape for a valid pending insert", async () => {
    setupDefaultDbMocks();
    const r = await postPending(VALID_IDEA);
    expect(r.status).toBe(201);
    expect(r.json.accepted).toBe(true);
    expect(typeof r.json.bucket_id).toBe("string");
    expect(typeof r.json.fingerprint_hash).toBe("string");
    expect(typeof r.json.source_count).toBe("number");
    expect(typeof r.json.distinct_providers).toBe("number");
    expect(typeof r.json.status).toBe("string");
  });

  // ─── 2. Bucket upsert on new fingerprint ─────────────────────────────
  it("creates a new bucket when fingerprint is first seen", async () => {
    const { bucketId } = setupDefaultDbMocks({ bucketId: "new-bucket-999" });
    const r = await postPending(VALID_IDEA);
    expect(r.status).toBe(201);
    expect(r.json.bucket_id).toBe(bucketId);
    // Confirm bucket insert was called
    expect(dbInsertMock).toHaveBeenCalled();
  });

  // ─── 3. Upsert on existing fingerprint returns same bucket_id ────────
  it("returns same bucket_id when fingerprint already exists (upsert)", async () => {
    const existingBucketId = "existing-bucket-aaa";
    setupDefaultDbMocks({ bucketId: existingBucketId, sourceCount: 2, distinctProviders: 2 });
    const r = await postPending({ ...VALID_IDEA, source_url: "https://example.com/second-source" });
    expect(r.status).toBe(201);
    expect(r.json.bucket_id).toBe(existingBucketId);
    expect(r.json.source_count).toBe(2);
  });

  // ─── 4. Mention idempotency — duplicate source_url → mention_was_new=false ──
  it("does not count the same source_url twice (mention idempotency)", async () => {
    setupDefaultDbMocks();
    // Override mention insert to return empty (conflict — duplicate URL).
    // Dispatch by table identity so the audit-log inserts don't mis-route.
    dbInsertMock.mockImplementation((table: unknown) => {
      const tag = String(typeof table === "symbol" ? table.toString() : table);
      if (tag.includes("strategyPendingBuckets")) {
        return {
          values: vi.fn().mockReturnThis(),
          onConflictDoUpdate: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{
            id: "bucket-aaa", fingerprintHash: "abc", market: "MES",
            entryArchetype: "breakout", exitType: "atr_multiple",
            sourceCount: 0, distinctProviders: 0, status: "pending",
          }]),
        };
      }
      if (tag.includes("strategyPendingMentions")) {
        return {
          values: vi.fn().mockReturnThis(),
          onConflictDoNothing: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([]),  // empty = conflict
        };
      }
      // auditLog
      return {
        values: vi.fn().mockReturnValue({ catch: vi.fn().mockResolvedValue(undefined) }),
      };
    });
    dbExecuteMock.mockResolvedValue([{ source_count: 1, distinct_providers: 1 }]);
    dbUpdateMock.mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]), returning: vi.fn().mockResolvedValue([]) });

    const r = await postPending(VALID_IDEA);
    expect(r.status).toBe(201);
    expect(r.json.mention_was_new).toBe(false);
  });

  // ─── 5. is_cross_validation_result=true skips CV1 webhook ────────────
  it("does NOT fire CV1 webhook when is_cross_validation_result=true", async () => {
    // Set up CV1 env vars so the route WOULD fire if it was organic
    process.env.N8N_BASE_URL = "http://n8n.test:5678";
    process.env.N8N_CV1_BEARER = "test-bearer";
    setupDefaultDbMocks();

    // Track CV1 calls via a fetch spy — we only intercept n8n calls
    const cv1Calls: string[] = [];
    const realFetch = originalFetch;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
      if (url.includes("cv1-validate")) {
        cv1Calls.push(url);
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      }
      return realFetch(...args);
    }) as typeof fetch;

    const r = await postPending({ ...VALID_IDEA, is_cross_validation_result: true });
    expect(r.status).toBe(201);
    // Allow event loop to flush fire-and-forget promises
    await new Promise((r) => setTimeout(r, 20));
    expect(cv1Calls.length).toBe(0);
  });

  // ─── 6–8. Market validation — ES/NQ/CL rejected ──────────────────────
  it.each([
    ["ES",  "big-contract ES rejected"],
    ["NQ",  "big-contract NQ rejected"],
    ["CL",  "big-contract CL rejected"],
  ])("rejects market=%s (%s)", async (market) => {
    const r = await postPending({ ...VALID_IDEA, market });
    expect(r.status).toBe(400);
  });

  // ─── 9. Missing required fields → 400 ────────────────────────────────
  it("rejects empty body with 400", async () => {
    const r = await postPending({});
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/pending scout schema/);
  });

  // ─── 10. Thesis too short → 400 ──────────────────────────────────────
  it("rejects thesis shorter than 20 chars with 400", async () => {
    const r = await postPending({ ...VALID_IDEA, thesis: "Too short" });
    expect(r.status).toBe(400);
  });

  // ─── 11. Graduation fires at ≥3 distinct providers + ≥3 source_count ──
  it("initiates graduation when distinct_providers >= 3 AND source_count >= 3", async () => {
    setupDefaultDbMocks({ sourceCount: 3, distinctProviders: 3 });

    // Override bucket update to simulate graduation lock success
    let updateCallCount = 0;
    dbUpdateMock.mockImplementation(() => {
      updateCallCount++;
      if (updateCallCount === 1) {
        // First update: count update — just resolves
        return {
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([]),
          returning: vi.fn().mockResolvedValue([]),
        };
      }
      if (updateCallCount === 2) {
        // Second update: graduation lock — returns a row (we won the race)
        return {
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{
            id: "bucket-uuid-1234", status: "graduating",
          }]),
        };
      }
      return {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
        returning: vi.fn().mockResolvedValue([]),
      };
    });

    // Mock select for graduation mention read
    dbSelectMock.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        id: "mention-1", bucketId: "bucket-uuid-1234",
        sourceProvider: "tavily", sourceUrl: "https://example.com/1",
        extractedIdea: VALID_IDEA, isCrossValidationResult: false,
        crossValidatorConfidence: null,
      }]),
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });

    // Mock the internal /scout-ideas/strict fetch (graduation step)
    // Use a per-test fetch override that intercepts only the strict route call
    const realFetch = originalFetch;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
      if (url.includes("scout-ideas/strict")) {
        return Promise.resolve(new Response(
          JSON.stringify({ id: "strategy-xyz", schema: "strict" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ));
      }
      return realFetch(...args);
    }) as typeof fetch;

    const r = await postPending({ ...VALID_IDEA, is_cross_validation_result: true });
    expect(r.status).toBe(201);
    // Status should be 'graduating' since the graduation lock succeeded
    expect(["graduating", "graduated"]).toContain(r.json.status);
  });

  // ─── 12. Graduation NOT fired at 2 distinct providers ────────────────
  it("does NOT initiate graduation when distinct_providers < 3", async () => {
    setupDefaultDbMocks({ sourceCount: 2, distinctProviders: 2 });
    const r = await postPending(VALID_IDEA);
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("pending");
    // Graduation update should not have been called with graduating status
    const graduationCalls = dbUpdateMock.mock.calls.filter((args: unknown[]) => {
      try {
        return JSON.stringify(args).includes("graduating");
      } catch { return false; }
    });
    expect(graduationCalls.length).toBe(0);
  });

  // ─── 13. Response includes all required fields ────────────────────────
  it("response includes bucket_id, fingerprint_hash, entry_archetype, exit_type, source_count, distinct_providers, status", async () => {
    setupDefaultDbMocks();
    const r = await postPending(VALID_IDEA);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      accepted:           true,
      bucket_id:          expect.any(String),
      fingerprint_hash:   expect.any(String),
      entry_archetype:    expect.any(String),
      exit_type:          expect.any(String),
      source_count:       expect.any(Number),
      distinct_providers: expect.any(Number),
      status:             expect.any(String),
    });
  });

  // ─── 14. Extended source_provider enum accepts youtube/apify/tf_search ───
  // Wave 9 (2026-05-17): scrapingbee fixture removed. The enum keeps the value
  // for back-compat with existing DB rows; the active pipeline emits
  // youtube_data_api / reddit_json / brave_search / exa instead.
  it.each([
    ["youtube"],
    ["apify"],
    ["tf_search"],
  ])("accepts source_provider=%s", async (provider) => {
    setupDefaultDbMocks();
    const r = await postPending({
      ...VALID_IDEA,
      source_url:      `https://example.com/${provider}-source`,
      source_provider: provider,
    });
    expect(r.status).toBe(201);
  });

  // ─── 15. Pass 19: graduation with paused pipeline still fires ────────────
  // When runGraduation triggers → posts to /scout-ideas/strict with
  // source_provider='graduated_bucket', the strict route should not 423-block
  // the call (because graduated_bucket IS the canonical path). The pending
  // endpoint itself doesn't check pipeline pause — that's handled downstream.
  it("graduation mechanism fires even when pipeline is paused (pending endpoint accepts all ideas)", async () => {
    // The pending endpoint itself has no pipeline pause gate — it always accepts
    // mentions. The pause discipline lives in runStrategyFromDSL.
    setupDefaultDbMocks({ sourceCount: 3, distinctProviders: 3 });

    let updateCallCount = 0;
    dbUpdateMock.mockImplementation(() => {
      updateCallCount++;
      if (updateCallCount === 2) {
        return {
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ id: "bucket-uuid-1234", status: "graduating" }]),
        };
      }
      return {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
        returning: vi.fn().mockResolvedValue([]),
      };
    });

    dbSelectMock.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        id: "mention-1", bucketId: "bucket-uuid-1234",
        sourceProvider: "tavily", sourceUrl: "https://example.com/1",
        extractedIdea: VALID_IDEA, isCrossValidationResult: false,
        crossValidatorConfidence: null,
      }]),
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });

    const realFetch = originalFetch;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
      if (url.includes("scout-ideas/strict")) {
        // Strict endpoint should accept graduated_bucket source_provider
        const body = (args[1] as RequestInit)?.body;
        let strictBody: any;
        try { strictBody = body ? JSON.parse(body as string) : {}; } catch { strictBody = {}; }
        const sourceProvider = strictBody?.ideas?.[0]?.source_provider;
        if (sourceProvider === "graduated_bucket") {
          // Correct: graduation tagged the idea correctly
          return Promise.resolve(new Response(
            JSON.stringify({ id: "strategy-xyz", schema: "strict" }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          ));
        }
        // Should NOT happen after Pass 19 — graduation always uses graduated_bucket
        return Promise.resolve(new Response(
          JSON.stringify({ error: "pass19_violation: non-graduated_bucket reached /strict" }),
          { status: 423 },
        ));
      }
      return realFetch(...args);
    }) as typeof fetch;

    const r = await postPending({ ...VALID_IDEA, is_cross_validation_result: true });
    expect(r.status).toBe(201);
    expect(["graduating", "graduated"]).toContain(r.json.status);
  });
});
