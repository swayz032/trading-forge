/**
 * Web Discovery Route Tests — Pass 20 Track H
 *
 * Tests the POST /api/agent/web-discovery route handler logic:
 *   - All 3 brokers mocked; route merges + dedupes results
 *   - Counts object returned correctly
 *   - Dedupe by source_url preserves first-occurrence (exa) provider attribution
 *   - One broker rejects (Promise.allSettled) — other two providers still returned
 *   - All 3 brokers return [] — response is valid empty shape
 *   - Schema validation: missing query → 400
 *
 * Uses in-process express server + Node global fetch (same pattern as
 * cross-validator-route.test.ts). No supertest dependency.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ─── Module mocks (must be before any import that transitively loads them) ────

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Broker mocks — the three under test ──────────────────────────────────────
const runExaDiscoveryMock    = vi.fn().mockResolvedValue([]);
const runBraveDiscoveryMock  = vi.fn().mockResolvedValue([]);
const runParallelDiscoveryMock = vi.fn().mockResolvedValue([]);

vi.mock("../services/exa-broker.js", () => ({
  runExaDiscovery: (...args: unknown[]) => runExaDiscoveryMock(...args),
}));
vi.mock("../services/brave-search-broker.js", () => ({
  runBraveDiscovery: (...args: unknown[]) => runBraveDiscoveryMock(...args),
}));
vi.mock("../services/parallel-broker.js", () => ({
  runParallelDiscovery: (...args: unknown[]) => runParallelDiscoveryMock(...args),
}));

// ── Heavy infrastructure mocks ────────────────────────────────────────────────
vi.mock("../services/model-router.js", () => ({
  callOpenAI:           vi.fn(),
  callOpenAIOrFallback: vi.fn(),
  selectModel:          vi.fn(),
}));

vi.mock("../middleware/idempotency.js", () => ({
  idempotencyMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middleware/require-live-n8n.js", () => ({
  requireLiveN8n: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/agent-service.js", () => ({
  AgentService: class {
    scoutIdeas         = vi.fn().mockResolvedValue({ count: 0 });
    drainScoutedIdeas  = vi.fn().mockResolvedValue(undefined);
    runStrategyFromDSL = vi.fn().mockResolvedValue({ status: "pending" });
    getFailurePatterns = vi.fn().mockResolvedValue({ avoidPatterns: [] });
    runStrategy        = vi.fn().mockResolvedValue({ status: "submitted" });
    runClassStrategy   = vi.fn().mockResolvedValue({ status: "submitted" });
    batchSubmit        = vi.fn().mockResolvedValue(undefined);
    critiqueResults    = vi.fn().mockResolvedValue({ critique: "ok" });
  },
}));

vi.mock("../services/regime-service.js",    () => ({ analyzeMarket:    vi.fn() }));
vi.mock("../services/robustness-service.js", () => ({ runRobustnessTest: vi.fn() }));
vi.mock("../services/ollama-client.js",      () => ({ OllamaClient: class {} }));
vi.mock("../lib/python-runner.js",           () => ({ runPythonModule: vi.fn() }));

vi.mock("../db/index.js", () => ({
  db: {
    execute:  vi.fn().mockResolvedValue([]),
    insert:   vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        onConflictDoNothing: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: "a1" }]),
        catch: vi.fn(),
      }),
    }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]), returning: vi.fn().mockResolvedValue([]) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]), limit: vi.fn().mockResolvedValue([]) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog:                Symbol("auditLog"),
  strategyPendingBuckets:  Symbol("strategyPendingBuckets"),
  strategyPendingMentions: Symbol("strategyPendingMentions"),
  systemJournal:           Symbol("systemJournal"),
  strategies:              Symbol("strategies"),
  idempotencyKeys:         Symbol("idempotencyKeys"),
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE:       vi.fn(),
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

vi.mock("../lib/metrics-registry.js", () => {
  const mkCounter = () => ({ labels: vi.fn().mockReturnValue({ inc: vi.fn() }), inc: vi.fn() });
  const mkGauge   = () => ({ labels: vi.fn().mockReturnValue({ set: vi.fn() }), set: vi.fn() });
  const mkHisto   = () => ({ labels: vi.fn().mockReturnValue({ observe: vi.fn() }), observe: vi.fn() });
  return {
    crossValidatorCallsTotal:          mkCounter(),
    crossValidatorLatencySeconds:      mkHisto(),
    pendingBucketsGraduatedTotal:      mkCounter(),
    pendingBucketsTotal:               mkGauge(),
    pendingBucketExpiredMentionsTotal: mkCounter(),
    httpRequestDurationMs:             mkHisto(),
    strategyPromotions:                mkCounter(),
    backtestRuns:                      mkCounter(),
    paperTrades:                       mkCounter(),
    circuitBreakerState:               mkGauge(),
    circuitBreakerFailures:            mkGauge(),
    pythonSubprocessActive:            mkGauge(),
    pythonSubprocessQueued:            mkGauge(),
    promRegistry: { contentType: "text/plain", metrics: vi.fn().mockResolvedValue("") },
  };
});

vi.mock("../services/strategy-fingerprint.js", () => ({
  computeFingerprintHash:        vi.fn(),
  computeConceptFingerprintHash: vi.fn(),
  normalizeConceptName:          vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "")),
  extractEntryArchetype:         vi.fn(),
  normalizeExitType:             vi.fn(),
}));

// ─── Import route AFTER mocks ─────────────────────────────────────────────────

import { agentRoutes } from "../routes/agent.js";

// ─── Server setup ─────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExaStrategy(overrides: Partial<{
  name: string; concept_archetype: string; brief_concept: string;
  source_url: string; source_provider: "exa"
}> = {}) {
  return {
    name:              "Exa Strategy A",
    concept_archetype: "breakout",
    brief_concept:     "Exa breakout concept",
    source_url:        "https://exa-source.com/orb",
    source_provider:   "exa" as const,
    ...overrides,
  };
}

function makeBraveStrategy(overrides: Partial<{
  name: string; concept_archetype: string; brief_concept: string;
  source_url: string; source_provider: "brave"
}> = {}) {
  return {
    name:              "Brave Strategy B",
    concept_archetype: "mean_reversion",
    brief_concept:     "Brave mean reversion",
    source_url:        "https://brave-source.com/vwap",
    source_provider:   "brave" as const,
    ...overrides,
  };
}

function makeParallelStrategy(overrides: Partial<{
  name: string; concept: string; entry_rule: string;
  exit_rule: string; source_url: string; timeframe: string
}> = {}) {
  return {
    name:       "Parallel Strategy C",
    concept:    "Momentum breakout approach",
    entry_rule: "Enter on bar close above resistance",
    exit_rule:  "Exit at target or stop",
    source_url: "https://parallel-source.com/momentum",
    timeframe:  "15m",
    ...overrides,
  };
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/agent/web-discovery", () => {
  it("all 3 brokers return results: merged + deduped + counts correct", async () => {
    runExaDiscoveryMock.mockResolvedValue([makeExaStrategy()]);
    runBraveDiscoveryMock.mockResolvedValue([makeBraveStrategy()]);
    runParallelDiscoveryMock.mockResolvedValue([makeParallelStrategy()]);

    const { status, body } = await post("/api/agent/web-discovery", {
      query: "opening range breakout futures strategy",
    });

    expect(status).toBe(200);
    expect(body.counts.exa).toBe(1);
    expect(body.counts.brave).toBe(1);
    expect(body.counts.parallel).toBe(1);
    expect(body.counts.total_after_dedupe).toBe(3);
    expect(body.strategies).toHaveLength(3);

    const providers = body.strategies.map((s: { source_provider: string }) => s.source_provider);
    expect(providers).toContain("exa");
    expect(providers).toContain("brave");
    expect(providers).toContain("parallel");
  });

  it("dedupe preserves exa attribution when exa and brave share same source_url", async () => {
    const sharedUrl = "https://shared-source.com/strategy";
    runExaDiscoveryMock.mockResolvedValue([
      makeExaStrategy({ source_url: sharedUrl, name: "Shared Strategy (Exa)" }),
    ]);
    runBraveDiscoveryMock.mockResolvedValue([
      makeBraveStrategy({ source_url: sharedUrl, name: "Shared Strategy (Brave)" }),
    ]);
    runParallelDiscoveryMock.mockResolvedValue([]);

    const { status, body } = await post("/api/agent/web-discovery", { query: "shared source test" });

    expect(status).toBe(200);
    // exa + brave both returned same URL — only 1 item after dedupe
    expect(body.counts.total_after_dedupe).toBe(1);
    const surviving = body.strategies[0];
    // exa was first in merge order — its attribution survives
    expect(surviving.source_provider).toBe("exa");
    expect(surviving.name).toBe("Shared Strategy (Exa)");
  });

  it("one broker rejects (allSettled absorbs): other two providers still returned", async () => {
    runExaDiscoveryMock.mockResolvedValue([makeExaStrategy()]);
    // Brave broker throws — Promise.allSettled must absorb this
    runBraveDiscoveryMock.mockRejectedValue(new Error("Brave network timeout"));
    runParallelDiscoveryMock.mockResolvedValue([makeParallelStrategy()]);

    const { status, body } = await post("/api/agent/web-discovery", {
      query: "test with one failing broker",
    });

    expect(status).toBe(200);
    expect(body.counts.exa).toBe(1);
    expect(body.counts.brave).toBe(0);
    expect(body.counts.parallel).toBe(1);
    expect(body.counts.total_after_dedupe).toBe(2);

    const providers = body.strategies.map((s: { source_provider: string }) => s.source_provider);
    expect(providers).toContain("exa");
    expect(providers).toContain("parallel");
    expect(providers).not.toContain("brave");
  });

  it("all 3 brokers return []: valid empty response shape", async () => {
    runExaDiscoveryMock.mockResolvedValue([]);
    runBraveDiscoveryMock.mockResolvedValue([]);
    runParallelDiscoveryMock.mockResolvedValue([]);

    const { status, body } = await post("/api/agent/web-discovery", { query: "obscure query" });

    expect(status).toBe(200);
    expect(body.strategies).toEqual([]);
    expect(body.counts).toEqual({ exa: 0, brave: 0, parallel: 0, total_after_dedupe: 0 });
  });

  it("missing query: returns 400 with validation detail", async () => {
    const { status, body } = await post("/api/agent/web-discovery", {});

    expect(status).toBe(400);
    expect(body.error).toContain("web-discovery schema not satisfied");
  });
});
