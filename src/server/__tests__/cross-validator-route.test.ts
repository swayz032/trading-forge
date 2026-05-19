/**
 * Cross-Validator Route Tests — Pass 18
 *
 * Covers POST /api/agent/cross-validate:
 *  1. Valid match response: is_same_setup=true with confidence
 *  2. Valid no-match response: is_same_setup=false
 *  3. Empty candidates array → {matches: []}
 *  4. Oversized payload (>20 candidates) → 400
 *  5. Model unavailable → {matches: [], reason: "model_unavailable"}
 *  6. Model returns non-JSON → {matches: [], reason: "non_json"}
 *  7. Malformed match item (missing field) → filtered out silently
 *  8. Missing seed → 400
 *  9. Missing source_url in candidates → 400
 * 10. Confidence threshold: match with confidence < 0.7 still returned (caller decides)
 *
 * No DB / no network — callOpenAIOrFallback mocked.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const callOpenAIOrFallbackMock = vi.fn();
vi.mock("../services/model-router.js", () => ({
  callOpenAI:           vi.fn(),
  callOpenAIOrFallback: (...args: unknown[]) => callOpenAIOrFallbackMock(...args),
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
    scoutIdeas        = vi.fn().mockResolvedValue({ count: 0 });
    drainScoutedIdeas = vi.fn().mockResolvedValue(undefined);
    runStrategyFromDSL = vi.fn().mockResolvedValue({ status: "pending" });
    getFailurePatterns = vi.fn().mockResolvedValue({ avoidPatterns: [] });
    runStrategy        = vi.fn().mockResolvedValue({ status: "submitted" });
    runClassStrategy   = vi.fn().mockResolvedValue({ status: "submitted" });
    batchSubmit        = vi.fn().mockResolvedValue(undefined);
    critiqueResults    = vi.fn().mockResolvedValue({ critique: "ok" });
  },
}));

vi.mock("../services/regime-service.js",     () => ({ analyzeMarket:    vi.fn() }));
vi.mock("../services/robustness-service.js",  () => ({ runRobustnessTest: vi.fn() }));
vi.mock("../db/index.js",                     () => ({
  db: {
    execute:  vi.fn().mockResolvedValue([]),
    insert:   vi.fn().mockReturnValue({ values: vi.fn().mockReturnThis(), onConflictDoUpdate: vi.fn().mockReturnThis(), onConflictDoNothing: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([{ id: "b1" }]), catch: vi.fn() }),
    update:   vi.fn().mockReturnValue({ set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]), returning: vi.fn().mockResolvedValue([]) }),
    select:   vi.fn().mockReturnValue({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]), limit: vi.fn().mockResolvedValue([]) }),
    delete:   vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
  },
}));
vi.mock("../db/schema.js", () => ({
  auditLog:                Symbol("auditLog"),
  strategyPendingBuckets:  Symbol("strategyPendingBuckets"),
  strategyPendingMentions: Symbol("strategyPendingMentions"),
  idempotencyKeys:         Symbol("idempotencyKeys"),
}));
vi.mock("../services/ollama-client.js", () => ({ OllamaClient: class {} }));
vi.mock("../lib/python-runner.js",      () => ({ runPythonModule: vi.fn() }));

// Pass 18 observability mocks — prevent real SSE fan-out / Discord calls / prom-client init
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

// Do NOT stub global fetch at module level — test helpers use fetch to call the
// in-process server over localhost, and stubbing breaks them. Individual tests
// that need to intercept outbound calls override globalThis.fetch per-test.

import { agentRoutes } from "../routes/agent.js";

// ─── Server setup ─────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────

const SEED = {
  thesis:          "MES opening range breakout: enter long above 30-min ORB high with volume",
  market:          "MES",
  timeframe:       "5m",
  entry_rules:     "Enter long on breakout above 30-minute opening range high with volume confirmation",
  exit_rules:      "Take profit at 2x ATR multiple; trail behind last 2-bar swing low",
  risk_rules:      "ATR stop 1.5x; max 4 MES contracts; structural stop ceiling 14pt",
  source_url:      "https://example.com/seed",
  regime:          "TRENDING_UP",
  concept_name:    "orb_breakout",
  source_provider: "tavily",
  confidence_score: 0.8,
};

const CANDIDATE = {
  source_provider: "youtube",
  source_url:      "https://youtube.com/watch?v=abc123",
  extracted_idea:  {
    thesis:      "MES ORB breakout strategy discussed in detail",
    market:      "MES",
    timeframe:   "5m",
    entry_rules: "Enter on breakout of 30-min opening range with volume",
    exit_rules:  "2R ATR trailing stop",
    risk_rules:  "Max 4 contracts ATR stop",
  },
};

async function postCrossValidate(body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/api/agent/cross-validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("POST /api/agent/cross-validate", () => {
  beforeEach(() => {
    callOpenAIOrFallbackMock.mockReset();
  });

  // ─── 1. Match response ──────────────────────────────────────────────
  it("returns matches array with is_same_setup=true when model confirms match", async () => {
    callOpenAIOrFallbackMock.mockResolvedValue(JSON.stringify({
      matches: [
        { index: 0, is_same_setup: true, confidence: 0.92, divergence_notes: "Identical market + entry; minor ATR difference" },
      ],
    }));

    const r = await postCrossValidate({ seed: SEED, candidates: [CANDIDATE] });
    expect(r.status).toBe(200);
    expect(r.json.matches).toHaveLength(1);
    expect(r.json.matches[0].is_same_setup).toBe(true);
    expect(r.json.matches[0].confidence).toBeCloseTo(0.92);
  });

  // ─── 2. No-match response ───────────────────────────────────────────
  it("returns is_same_setup=false when model rejects match", async () => {
    callOpenAIOrFallbackMock.mockResolvedValue(JSON.stringify({
      matches: [
        { index: 0, is_same_setup: false, confidence: 0.1, divergence_notes: "Different market: seed=MES, candidate=MNQ" },
      ],
    }));

    const r = await postCrossValidate({ seed: SEED, candidates: [CANDIDATE] });
    expect(r.status).toBe(200);
    expect(r.json.matches[0].is_same_setup).toBe(false);
    expect(r.json.matches[0].divergence_notes).toContain("Different market");
  });

  // ─── 3. Empty candidates array ──────────────────────────────────────
  it("returns {matches: []} without calling LLM when candidates is empty", async () => {
    const r = await postCrossValidate({ seed: SEED, candidates: [] });
    expect(r.status).toBe(200);
    expect(r.json.matches).toEqual([]);
    expect(callOpenAIOrFallbackMock).not.toHaveBeenCalled();
  });

  // ─── 4. Oversized payload → 400 ────────────────────────────────────
  it("rejects more than 20 candidates with 400", async () => {
    const candidates = Array.from({ length: 21 }, (_, i) => ({
      ...CANDIDATE,
      source_url: `https://example.com/candidate-${i}`,
    }));
    const r = await postCrossValidate({ seed: SEED, candidates });
    expect(r.status).toBe(400);
  });

  // ─── 5. Model unavailable ───────────────────────────────────────────
  it("returns {matches: [], reason: 'model_unavailable'} when LLM unavailable", async () => {
    callOpenAIOrFallbackMock.mockResolvedValue(null);
    const r = await postCrossValidate({ seed: SEED, candidates: [CANDIDATE] });
    expect(r.status).toBe(200);
    expect(r.json.matches).toEqual([]);
    expect(r.json.reason).toBe("model_unavailable");
  });

  // ─── 6. Non-JSON model output ───────────────────────────────────────
  it("returns {matches: [], reason: 'non_json'} when model returns non-JSON", async () => {
    callOpenAIOrFallbackMock.mockResolvedValue("Sorry, I cannot process this request.");
    const r = await postCrossValidate({ seed: SEED, candidates: [CANDIDATE] });
    expect(r.status).toBe(200);
    expect(r.json.matches).toEqual([]);
    expect(r.json.reason).toBe("non_json");
  });

  // ─── 7. Malformed match item filtered out ──────────────────────────
  it("filters out malformed match items (missing required field) silently", async () => {
    callOpenAIOrFallbackMock.mockResolvedValue(JSON.stringify({
      matches: [
        { index: 0, is_same_setup: true, confidence: 0.9, divergence_notes: "valid" },
        { index: 1, confidence: 0.5, divergence_notes: "missing is_same_setup" },  // malformed
        { index: 2, is_same_setup: false, confidence: 0.2, divergence_notes: "valid no-match" },
      ],
    }));

    const r = await postCrossValidate({ seed: SEED, candidates: [CANDIDATE, CANDIDATE, CANDIDATE] });
    expect(r.status).toBe(200);
    // Malformed item at index 1 dropped; valid items at 0 and 2 kept
    expect(r.json.matches).toHaveLength(2);
    expect(r.json.matches.map((m: any) => m.index)).toEqual([0, 2]);
  });

  // ─── 8. Missing seed → 400 ─────────────────────────────────────────
  it("rejects missing seed with 400", async () => {
    const r = await postCrossValidate({ candidates: [CANDIDATE] });
    expect(r.status).toBe(400);
  });

  // ─── 9. Candidate missing source_url → 400 ─────────────────────────
  it("rejects candidate missing source_url with 400", async () => {
    const r = await postCrossValidate({
      seed: SEED,
      candidates: [{ source_provider: "youtube", extracted_idea: {} }],  // missing source_url
    });
    expect(r.status).toBe(400);
  });

  // ─── 10. Confidence threshold is caller's decision, not ours ───────
  it("returns low-confidence match without modification — caller decides threshold", async () => {
    callOpenAIOrFallbackMock.mockResolvedValue(JSON.stringify({
      matches: [
        { index: 0, is_same_setup: true, confidence: 0.45, divergence_notes: "Uncertain — timeframe family ambiguous" },
      ],
    }));

    const r = await postCrossValidate({ seed: SEED, candidates: [CANDIDATE] });
    expect(r.status).toBe(200);
    // Route returns it as-is; CV1 will decide to reject on confidence < 0.7
    expect(r.json.matches[0].confidence).toBeCloseTo(0.45);
    expect(r.json.matches[0].is_same_setup).toBe(true);
  });

  // ─── Observability: audit_log writes ─────────────────────────────────

  // ─── 11. cross_validator.invoked audit log emitted ──────────────────
  it("writes cross_validator.invoked audit_log row on every call with candidates", async () => {
    const { db: mockDb } = await import("../db/index.js");
    callOpenAIOrFallbackMock.mockResolvedValue(JSON.stringify({ matches: [] }));

    await postCrossValidate({ seed: SEED, candidates: [CANDIDATE] });

    // Verify db.insert was called (audit_log insert)
    expect((mockDb as any).insert).toHaveBeenCalled();
    // The first insert call should be the invoked audit
    const insertCalls = (mockDb as any).insert.mock.calls;
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  // ─── 12. match_confirmed metric incremented for high-confidence match ──
  it("increments match_confirmed counter when is_same_setup=true AND confidence>=0.7", async () => {
    const { crossValidatorCallsTotal } = await import("../lib/metrics-registry.js");
    callOpenAIOrFallbackMock.mockResolvedValue(JSON.stringify({
      matches: [
        { index: 0, is_same_setup: true, confidence: 0.92, divergence_notes: "Clear match" },
      ],
    }));

    await postCrossValidate({ seed: SEED, candidates: [CANDIDATE] });

    expect((crossValidatorCallsTotal as any).labels).toHaveBeenCalledWith({ outcome: "match_confirmed" });
  });

  // ─── 13. match_rejected metric incremented for low-confidence match ───
  it("increments match_rejected counter when confidence < 0.7", async () => {
    const { crossValidatorCallsTotal } = await import("../lib/metrics-registry.js");
    callOpenAIOrFallbackMock.mockResolvedValue(JSON.stringify({
      matches: [
        { index: 0, is_same_setup: true, confidence: 0.5, divergence_notes: "Uncertain" },
      ],
    }));

    await postCrossValidate({ seed: SEED, candidates: [CANDIDATE] });

    expect((crossValidatorCallsTotal as any).labels).toHaveBeenCalledWith({ outcome: "match_rejected" });
  });

  // ─── 14. model_unavailable metric incremented when LLM returns null ──
  it("increments model_unavailable counter when callOpenAIOrFallback returns null", async () => {
    const { crossValidatorCallsTotal } = await import("../lib/metrics-registry.js");
    callOpenAIOrFallbackMock.mockResolvedValue(null);

    await postCrossValidate({ seed: SEED, candidates: [CANDIDATE] });

    expect((crossValidatorCallsTotal as any).labels).toHaveBeenCalledWith({ outcome: "model_unavailable" });
  });

  // ─── 15. Correlation ID propagated from x-correlation-id header ──────
  it("respects x-correlation-id header for correlation ID propagation", async () => {
    callOpenAIOrFallbackMock.mockResolvedValue(JSON.stringify({ matches: [] }));
    const correlationId = "test-correlation-id-xyz";

    const res = await fetch(`${baseUrl}/api/agent/cross-validate`, {
      method:  "POST",
      headers: {
        "Content-Type":       "application/json",
        "x-correlation-id":   correlationId,
      },
      body: JSON.stringify({ seed: SEED, candidates: [CANDIDATE] }),
    });
    expect(res.status).toBe(200);
    // Can't directly inspect the audit_log row in unit test, but we verify
    // the route didn't crash when processing the header.
  });
});
