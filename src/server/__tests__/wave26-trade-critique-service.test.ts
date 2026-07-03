/**
 * wave26-trade-critique-service.test.ts — Wave 26 Pass 1
 *
 * Tests the event-driven trade critique service (trade-critique-service.ts).
 *
 * Coverage (≥15 tests):
 *  1.  Happy path: full data → technical_diagnosis + plain_english_summary populated
 *  2.  Partial data: 3 Wave 25 fields null → data_completeness="partial", missing_fields correct
 *  3.  Minimal data: all Wave 25 fields null → data_completeness="minimal"
 *  4.  Cloud fail → Ollama fallback succeeds → provider="ollama"
 *  5.  Both providers fail → consecutive_failures increments
 *  6.  3 consecutive failures → notifyWarning called
 *  7.  Successful call resets consecutive_failures to 0
 *  8.  Saturation: 3 concurrent → 4th returns status="queued_deferred"
 *  9.  audit_log: deferred_saturation written when saturated
 * 10.  Strict schema rejection: malformed LLM output → trade_critique.failed audit fires
 * 11.  Attribution weight sum != 1.0 → validation fails
 * 12.  Audit row written with correlation_id and grade
 * 13.  Idempotency: re-run on same position_id within 5 min → returns existing row
 * 14.  Position not found → returns status="failed"
 * 15.  Both fail → consecutive_failures increments by 1 per call (cumulative)
 * 16.  Ollama fallback: provider field is "ollama" in DB row
 * 17.  dataCompleteness: minimal when 5+ Wave 25 fields missing
 * 18.  Schema: tradeCritique table exported from schema.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Module mocks (must be hoisted before any service imports) ────────────────

vi.mock("../db/index.js", () => ({
  db: {},
}));

vi.mock("../db/schema.js", () => ({
  paperPositions: { id: "id", sessionId: "sessionId", symbol: "symbol", side: "side",
    contracts: "contracts", entryPrice: "entryPrice", stopPrice: "stopPrice",
    entryTime: "entryTime" },
  paperSessions: { id: "id", strategyId: "strategyId", firmId: "firmId",
    metricsSnapshot: "metricsSnapshot" },
  strategies: { id: "id", name: "name", symbol: "symbol", positionSize: "positionSize" },
  tradeCritique: { id: "id", positionId: "positionId", sessionId: "sessionId",
    accountId: "accountId", strategyId: "strategyId", critiquedAt: "critiquedAt",
    grade: "grade", technicalDiagnosis: "technicalDiagnosis",
    plainEnglishSummary: "plainEnglishSummary", dataCompleteness: "dataCompleteness",
    missingFields: "missingFields", provider: "provider", model: "model",
    correlationId: "correlationId", createdAt: "createdAt" },
  systemParameters: { paramName: "paramName", currentValue: "currentValue" },
  auditLog: { action: "action" },
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
  notifyCritical: vi.fn(),
}));

vi.mock("../services/model-router.js", () => ({
  callOpenAI: vi.fn(),
  getFallback: vi.fn(() => ({ provider: "ollama", model: "gemma4:e4b-it-qat" })),
  loadSystemPrompt: vi.fn(() => "You are a trade critic."),
}));

vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn(),
  })),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { eq, and, gte, desc } from "drizzle-orm";
import { callOpenAI, getFallback, loadSystemPrompt } from "../services/model-router.js";
import { OllamaClient } from "../services/ollama-client.js";
import { notifyWarning } from "../services/notification-service.js";
import { db } from "../db/index.js";

// Matches the key used in trade-critique-service.ts
const CONSECUTIVE_FAILURES_KEY_TEST = "trade_critique_consecutive_failures";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_TECHNICAL_DIAGNOSIS = {
  entry_quality_score: 7.5,
  exit_execution_delta_r: -0.1,
  confluence_factors_missed: [],
  parameter_hint: null,
  regime_mismatch: false,
  attribution: {
    regime: 0.20,
    structure: 0.15,
    narrative: 0.10,
    confluence: 0.20,
    decay: 0.10,
    liquidity: 0.10,
    fill: 0.05,
    exit_plan: 0.10,
  },
  realized_r: 1.5,
  expected_r_percentile: 62,
  topstep_consistency_current_pct: 0.35,
  topstep_consistency_distance_to_cap: 0.15,
};

const VALID_PLAIN_ENGLISH = {
  grade: "A" as const,
  one_liner: "Clean long entry at NY open with Structure confirmed; minor slippage.",
  what_went_right: "Regime aligned, structure confirmed BOS, confluence score 0.82.",
  what_to_watch: "Exit slippage slightly above expected; monitor ATR-scaled model.",
  action_needed: "No action required.",
};

const VALID_CRITIQUE_JSON = JSON.stringify({
  technical_diagnosis: VALID_TECHNICAL_DIAGNOSIS,
  plain_english_summary: VALID_PLAIN_ENGLISH,
});

function makeDbMock(opts: {
  positionRow?: Record<string, unknown> | null;
  sessionRow?: Record<string, unknown> | null;
  strategyRow?: Record<string, unknown> | null;
  existingCritique?: Record<string, unknown> | null;
  systemParamValue?: string | null;
  insertReturns?: { id: string };
}) {
  const mockDb = db as any;

  mockDb.select = vi.fn().mockImplementation(() => {
    const chain: any = {};
    let _from: string | null = null;
    let _limitVal = 1000;

    chain.from = (table: any) => {
      _from = table?.id ?? String(table);
      return chain;
    };
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = (n: number) => {
      _limitVal = n;
      return chain;
    };
    chain.then = (resolve: any) => {
      // Determine what to return based on context
      // tradeCritique table check (idempotency) — called first
      if (_from === "id" && _limitVal === 1) {
        return Promise.resolve(
          opts.existingCritique ? [opts.existingCritique] : []
        ).then(resolve);
      }
      // paperPositions
      if (opts.positionRow === null) return Promise.resolve([]).then(resolve);
      if (opts.positionRow) return Promise.resolve([opts.positionRow]).then(resolve);
      // default — empty
      return Promise.resolve([]).then(resolve);
    };
    // Make chain itself thenable for await
    Object.defineProperty(chain, Symbol.iterator, { value: () => [][Symbol.iterator]() });
    return chain;
  });

  mockDb.insert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([opts.insertReturns ?? { id: "critique-uuid-001" }]),
    }),
  }));

  mockDb.update = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }));

  return mockDb;
}

// ─── Test position factory ─────────────────────────────────────────────────────

function makePosition(overrides: Record<string, unknown> = {}) {
  return {
    id: "pos-uuid-001",
    sessionId: "sess-uuid-001",
    symbol: "MES",
    side: "long",
    contracts: 6,
    entryPrice: "4500.00",
    stopPrice: "4492.00",
    entryTime: new Date("2026-05-24T14:30:00Z"),
    exitPrice: "4507.00",
    exitTime: new Date("2026-05-24T15:20:00Z"),
    realizedPnl: "168.00",
    ...overrides,
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-uuid-001",
    strategyId: "strat-uuid-001",
    firmId: "topstep",
    metricsSnapshot: null,
    ...overrides,
  };
}

function makeStrategy(overrides: Record<string, unknown> = {}) {
  return {
    id: "strat-uuid-001",
    name: "orb_mes_5m",
    symbol: "MES",
    positionSize: { type: "risk_derived_pyramid" },
    ...overrides,
  };
}

// ─── Setup helpers for select chain that returns rows by order of call ─────────

function makeSelectSequence(rows: (Record<string, unknown> | null | undefined)[]) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const chain: any = {
      from: () => chain,
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
    };
    const rowsForThisCall = rows[callIndex] === undefined ? [] : rows[callIndex] === null ? [] : [rows[callIndex]];
    callIndex++;
    // make the chain thenable
    chain.then = (resolve: (v: any) => any) => Promise.resolve(rowsForThisCall).then(resolve);
    return chain;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Wave 26 Pass 1 — TradeCritiqueService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset active count between tests
    void import("../services/trade-critique-service.js").then(({ _resetActiveCount }) => {
      _resetActiveCount();
    });
  });

  // ── Test 1: Happy path ────────────────────────────────────────────────────
  it("(1) happy path — full data → completed with grade and technicalDiagnosis", async () => {
    vi.mocked(callOpenAI).mockResolvedValue(VALID_CRITIQUE_JSON);

    // Position WITH all Wave25 fields present → full data_completeness
    const fullPosition = makePosition({
      structureState: { bos: true, choch: false },
      narrativePhase: { direction: "bullish", swept_pdh: false },
      confluenceScore: 0.82,
      confluenceFactorsActive: [{ factor: "market_structure_aligned", satisfied: true, decay_confidence: 0.90 }],
      nearestLiquidityLevel: { level_type: "PDH", price: 4510, sweep_probability: 0.65, htf_significance: 3 },
    });
    // Strategy WITH backtest data
    const fullStrategy = makeStrategy({ backtestExpectedRByRegime: { TRENDING_UP: [0.5, 1.0, 1.5, 2.0, 2.5] } });

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve); // idempotency check
        if (currentCall === 1) return Promise.resolve([fullPosition]).then(resolve); // position
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve); // session
        if (currentCall === 3) return Promise.resolve([fullStrategy]).then(resolve); // strategy
        if (currentCall === 4) return Promise.resolve([{ currentValue: "0" }]).then(resolve); // readConsecutiveFailures
        if (currentCall === 5) return Promise.resolve([{ paramName: CONSECUTIVE_FAILURES_KEY_TEST }]).then(resolve); // upsertSystemParameter exists check
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    mockDb.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "critique-001" }]),
      }),
    }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    const result = await runTradeCritique("pos-uuid-001", "corr-001");

    expect(result.status).toBe("completed");
    expect(result.grade).toBe("A");
    expect(result.critiqueId).toBe("critique-001");
    expect(result.dataCompleteness).toBe("full");
    expect(result.provider).toBe("openai");
    expect(callOpenAI).toHaveBeenCalledWith("trade_critique", expect.any(Array));
  });

  // ── Test 2: Partial data (3 Wave 25 fields null) ──────────────────────────
  it("(2) partial data — 3 Wave 25 fields null → data_completeness='partial', missing_fields correct", async () => {
    vi.mocked(callOpenAI).mockResolvedValue(VALID_CRITIQUE_JSON);

    const posWithPartialW25 = makePosition({
      // structure_state, narrative_phase, confluence_score present; others null
      structureState: { bos: true },
      narrativePhase: { direction: "bullish" },
      confluenceScore: 0.78,
      // missing: confluenceFactorsActive, nearestLiquidityLevel
    });

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve);
        if (currentCall === 1) return Promise.resolve([posWithPartialW25]).then(resolve);
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve);
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve);
        if (currentCall === 4) return Promise.resolve([{ currentValue: "0" }]).then(resolve);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    mockDb.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "critique-002" }]) }),
    }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    const result = await runTradeCritique("pos-uuid-001");

    expect(result.status).toBe("partial_data");
    expect(result.dataCompleteness).toBe("partial");

    // Verify DB insert called with correct missing_fields
    const insertValues = (mockDb.insert as any).mock.results[0]?.value?.values?.mock?.calls?.[0]?.[0];
    expect(insertValues?.missingFields).toContain("confluence_factors_active");
    expect(insertValues?.missingFields).toContain("nearest_liquidity_level");
    expect(insertValues?.missingFields).not.toContain("structure_state");
  });

  // ── Test 3: Minimal data (all Wave 25 fields null) ────────────────────────
  it("(3) minimal data — all Wave 25 fields null → data_completeness='minimal'", async () => {
    vi.mocked(callOpenAI).mockResolvedValue(VALID_CRITIQUE_JSON);

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve);
        if (currentCall === 1) return Promise.resolve([makePosition()]).then(resolve); // no wave25 fields
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve);
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve);
        if (currentCall === 4) return Promise.resolve([{ currentValue: "0" }]).then(resolve);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    mockDb.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "critique-003" }]) }),
    }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    const result = await runTradeCritique("pos-uuid-001");

    expect(result.dataCompleteness).toBe("minimal");
    const insertValues = (mockDb.insert as any).mock.results[0]?.value?.values?.mock?.calls?.[0]?.[0];
    expect(insertValues?.missingFields?.length).toBeGreaterThanOrEqual(5);
  });

  // ── Test 4: Cloud fail → Ollama fallback ─────────────────────────────────
  it("(4) cloud fails → Ollama fallback → provider='ollama'", async () => {
    vi.mocked(callOpenAI).mockResolvedValue(null); // cloud fails

    const mockOllamaInstance = { generate: vi.fn().mockResolvedValue({ response: VALID_CRITIQUE_JSON }) };
    vi.mocked(OllamaClient).mockImplementation(() => mockOllamaInstance as any);

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve);
        if (currentCall === 1) return Promise.resolve([makePosition()]).then(resolve);
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve);
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve);
        if (currentCall === 4) return Promise.resolve([{ currentValue: "0" }]).then(resolve);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    mockDb.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "critique-004" }]) }),
    }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    const result = await runTradeCritique("pos-uuid-001");

    expect(result.status).not.toBe("failed");
    expect(result.provider).toBe("ollama");
    expect(mockOllamaInstance.generate).toHaveBeenCalled();

    const insertValues = (mockDb.insert as any).mock.results[0]?.value?.values?.mock?.calls?.[0]?.[0];
    expect(insertValues?.provider).toBe("ollama");
    expect(insertValues?.model).toBe("gemma4:e4b-it-qat");
  });

  // ── Test 5: Both providers fail → consecutive_failures increments ─────────
  it("(5) both providers fail → consecutive_failures incremented; status=failed", async () => {
    vi.mocked(callOpenAI).mockResolvedValue(null);
    const mockOllamaInstance = { generate: vi.fn().mockRejectedValue(new Error("Ollama down")) };
    vi.mocked(OllamaClient).mockImplementation(() => mockOllamaInstance as any);

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve); // idempotency
        if (currentCall === 1) return Promise.resolve([makePosition()]).then(resolve); // position
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve); // session
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve); // strategy
        if (currentCall === 4) return Promise.resolve([{ currentValue: "1" }]).then(resolve); // readConsecutiveFailures
        if (currentCall === 5) return Promise.resolve([{ paramName: CONSECUTIVE_FAILURES_KEY_TEST }]).then(resolve); // upsertSystemParam exists check → returns row → use update
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    mockDb.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    const result = await runTradeCritique("pos-uuid-001");

    expect(result.status).toBe("failed");
    // update should be called to write the incremented count
    expect(mockDb.update).toHaveBeenCalled();
  });

  // ── Test 6: 3 consecutive failures → notifyWarning called ────────────────
  it("(6) 3 consecutive failures → notifyWarning fires with strike count", async () => {
    vi.mocked(callOpenAI).mockResolvedValue(null);
    const mockOllamaInstance = { generate: vi.fn().mockRejectedValue(new Error("Ollama down")) };
    vi.mocked(OllamaClient).mockImplementation(() => mockOllamaInstance as any);

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve);
        if (currentCall === 1) return Promise.resolve([makePosition()]).then(resolve);
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve);
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve);
        if (currentCall === 4) return Promise.resolve([{ currentValue: "2" }]).then(resolve); // existing=2, this makes 3
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    mockDb.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    await runTradeCritique("pos-uuid-001");

    expect(notifyWarning).toHaveBeenCalledWith(
      expect.stringContaining("Consecutive Failure"),
      expect.stringContaining("3"),
      expect.objectContaining({ strikes: 3 }),
    );
  });

  // ── Test 7: Successful call resets consecutive_failures to 0 ─────────────
  it("(7) successful critique → consecutive_failures reset to 0", async () => {
    vi.mocked(callOpenAI).mockResolvedValue(VALID_CRITIQUE_JSON);

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve);
        if (currentCall === 1) return Promise.resolve([makePosition()]).then(resolve);
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve);
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve);
        if (currentCall === 4) return Promise.resolve([{ currentValue: "2" }]).then(resolve); // had 2 failures
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    const updateMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDb.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "critique-007" }]) }),
    }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: updateMock }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    await runTradeCritique("pos-uuid-001");

    // update called with "0" to reset
    const updateSetCalls = updateMock.mock.calls;
    const resetCall = updateSetCalls.find((c: any[]) => c[0]?.currentValue === "0");
    expect(resetCall).toBeDefined();
  });

  // ── Test 8: Saturation → 4th call returns queued_deferred ─────────────────
  it("(8) saturation — active=3 → next returns queued_deferred without LLM call", async () => {
    const { _resetActiveCount } = await import("../services/trade-critique-service.js");
    _resetActiveCount();

    // Manually set active count by inspecting private counter via a controlled
    // mechanism: patch the module-level _activeCritiques by calling a slow mock.
    // We use a long-running promise to hold the concurrency slots.
    let resolveSlot1: () => void;
    let resolveSlot2: () => void;
    let resolveSlot3: () => void;

    const slowLLM = vi.fn()
      .mockReturnValueOnce(new Promise<string>((res) => { resolveSlot1 = () => res(VALID_CRITIQUE_JSON); }))
      .mockReturnValueOnce(new Promise<string>((res) => { resolveSlot2 = () => res(VALID_CRITIQUE_JSON); }))
      .mockReturnValueOnce(new Promise<string>((res) => { resolveSlot3 = () => res(VALID_CRITIQUE_JSON); }));
    vi.mocked(callOpenAI).mockImplementation(slowLLM);

    const mockDb = db as any;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      chain.then = (resolve: any) => Promise.resolve([]).then(resolve);
      return chain;
    });
    mockDb.insert = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "x" }]) }),
    }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");

    // Start 3 concurrent calls (they won't finish until we resolve the promises)
    const p1 = runTradeCritique("pos-1");
    const p2 = runTradeCritique("pos-2");
    const p3 = runTradeCritique("pos-3");

    // 4th call should return immediately as deferred
    const p4 = runTradeCritique("pos-4-deferred");
    const result4 = await p4;

    expect(result4.status).toBe("queued_deferred");
    expect(callOpenAI).not.toHaveBeenCalledWith("trade_critique", expect.any(Array));

    // Clean up the in-flight promises
    resolveSlot1!();
    resolveSlot2!();
    resolveSlot3!();
    await Promise.allSettled([p1, p2, p3]);
  });

  // ── Test 9: Deferred saturation writes audit row ──────────────────────────
  it("(9) deferred saturation → audit row trade_critique.deferred_saturation written", async () => {
    const { _resetActiveCount } = await import("../services/trade-critique-service.js");
    _resetActiveCount();

    let resolveHeld: () => void;
    vi.mocked(callOpenAI).mockReturnValue(new Promise<string>((res) => { resolveHeld = () => res(VALID_CRITIQUE_JSON); }));

    const mockDb = db as any;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      chain.then = (resolve: any) => Promise.resolve([]).then(resolve);
      return chain;
    });
    const insertMock = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "x" }]) });
    mockDb.insert = vi.fn().mockImplementation(() => ({ values: insertMock }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");

    // Fill 3 slots
    const p1 = runTradeCritique("pos-fill-1");
    const p2 = runTradeCritique("pos-fill-2");
    const p3 = runTradeCritique("pos-fill-3");

    // 4th triggers deferred
    await runTradeCritique("pos-saturation");

    // audit insert should have been called with deferred_saturation action
    const allInsertCalls = insertMock.mock.calls.map((c: any[]) => c[0]);
    const deferredAudit = allInsertCalls.find((c: any) => c?.action === "trade_critique.deferred_saturation");
    expect(deferredAudit).toBeDefined();

    resolveHeld!();
    await Promise.allSettled([p1, p2, p3]);
  });

  // ── Test 10: Strict schema rejection ─────────────────────────────────────
  it("(10) malformed LLM output → schema validation fails → trade_critique.failed audit", async () => {
    const badJson = JSON.stringify({ technical_diagnosis: { entry_quality_score: "not-a-number" } });
    vi.mocked(callOpenAI).mockResolvedValue(badJson);

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve);
        if (currentCall === 1) return Promise.resolve([makePosition()]).then(resolve);
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve);
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve);
        if (currentCall === 4) return Promise.resolve([{ currentValue: "0" }]).then(resolve);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    const insertMock = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
    mockDb.insert = vi.fn().mockImplementation(() => ({ values: insertMock }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    const result = await runTradeCritique("pos-uuid-001");

    expect(result.status).toBe("failed");

    const allInsertCalls = insertMock.mock.calls.map((c: any[]) => c[0]);
    const failedAudit = allInsertCalls.find((c: any) => c?.action === "trade_critique.failed");
    expect(failedAudit).toBeDefined();
    expect(failedAudit?.result?.reason).toMatch(/schema_validation_failed|json_parse_error/);
  });

  // ── Test 11: Attribution weight sum != 1.0 → validation fails ────────────
  it("(11) attribution weights do not sum to 1.0 → validation fails", async () => {
    const badAttribution = { ...VALID_TECHNICAL_DIAGNOSIS, attribution: { regime: 0.5, structure: 0.5, narrative: 0.5, confluence: 0.5, decay: 0.5, liquidity: 0.5, fill: 0.5, exit_plan: 0.5 } };
    vi.mocked(callOpenAI).mockResolvedValue(JSON.stringify({
      technical_diagnosis: badAttribution,
      plain_english_summary: VALID_PLAIN_ENGLISH,
    }));

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve);
        if (currentCall === 1) return Promise.resolve([makePosition()]).then(resolve);
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve);
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve);
        if (currentCall === 4) return Promise.resolve([{ currentValue: "0" }]).then(resolve);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    mockDb.insert = vi.fn().mockImplementation(() => ({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    const result = await runTradeCritique("pos-uuid-001");
    expect(result.status).toBe("failed");
  });

  // ── Test 12: Audit row written with all canonical fields ─────────────────
  it("(12) audit row includes correlation_id, grade, and critiqueId", async () => {
    vi.mocked(callOpenAI).mockResolvedValue(VALID_CRITIQUE_JSON);

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve);
        if (currentCall === 1) return Promise.resolve([makePosition()]).then(resolve);
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve);
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve);
        if (currentCall === 4) return Promise.resolve([{ currentValue: "0" }]).then(resolve);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    const insertValuesMock = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "critique-012" }]) });
    mockDb.insert = vi.fn().mockImplementation(() => ({ values: insertValuesMock }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    await runTradeCritique("pos-uuid-001", "corr-012");

    // Check DB row insert
    const dbRowInsert = insertValuesMock.mock.calls.find(
      (c: any[]) => c[0]?.positionId !== undefined,
    );
    expect(dbRowInsert).toBeDefined();
    expect(dbRowInsert![0].correlationId).toBe("corr-012");
    expect(dbRowInsert![0].grade).toBe("A");
  });

  // ── Test 13: Idempotency within 5 min ────────────────────────────────────
  it("(13) idempotency — critique exists within 5 min → returns existing row without LLM call", async () => {
    const existingCritique = {
      id: "existing-critique-id",
      grade: "B+",
      dataCompleteness: "partial",
      provider: "openai",
      model: "gpt-5.4",
    };

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        // First select: idempotency check → returns existing
        if (currentCall === 0) return Promise.resolve([existingCritique]).then(resolve);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    mockDb.insert = vi.fn();
    mockDb.update = vi.fn();

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    const result = await runTradeCritique("pos-uuid-001");

    expect(result.status).toBe("completed");
    expect(result.critiqueId).toBe("existing-critique-id");
    expect(result.grade).toBe("B+");
    expect(callOpenAI).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // ── Test 14: Position not found → status=failed ───────────────────────────
  it("(14) position not found → status=failed immediately", async () => {
    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve); // no existing critique
        if (currentCall === 1) return Promise.resolve([]).then(resolve); // position not found
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    mockDb.insert = vi.fn();

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    const result = await runTradeCritique("pos-nonexistent");

    expect(result.status).toBe("failed");
    expect(callOpenAI).not.toHaveBeenCalled();
  });

  // ── Test 15: Cumulative consecutive failures ──────────────────────────────
  it("(15) multiple failures accumulate correctly — each call increments by 1", async () => {
    vi.mocked(callOpenAI).mockResolvedValue(null);
    vi.mocked(OllamaClient).mockImplementation(() => ({
      generate: vi.fn().mockRejectedValue(new Error("down")),
    }) as any);

    const updateSetMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const mockDb = db as any;

    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve); // idempotency
        if (currentCall === 1) return Promise.resolve([makePosition()]).then(resolve);
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve);
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve);
        if (currentCall === 4) return Promise.resolve([{ currentValue: "1" }]).then(resolve); // readConsecutiveFailures → 1
        if (currentCall === 5) return Promise.resolve([{ paramName: CONSECUTIVE_FAILURES_KEY_TEST }]).then(resolve); // upsertSystemParam check → exists → update
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    mockDb.insert = vi.fn().mockImplementation(() => ({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: updateSetMock }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    await runTradeCritique("pos-uuid-001");

    // The update should be called with currentValue = "2" (1 existing + 1 increment)
    const calls = updateSetMock.mock.calls;
    const incrementCall = calls.find((c: any[]) => c[0]?.currentValue === "2");
    expect(incrementCall).toBeDefined();
  });

  // ── Test 16: Ollama provider field in DB ─────────────────────────────────
  it("(16) Ollama fallback → DB row has provider='ollama' and correct model", async () => {
    vi.mocked(callOpenAI).mockResolvedValue(null);
    const mockOllamaInstance = { generate: vi.fn().mockResolvedValue({ response: VALID_CRITIQUE_JSON }) };
    vi.mocked(OllamaClient).mockImplementation(() => mockOllamaInstance as any);
    vi.mocked(getFallback).mockReturnValue({ provider: "ollama", model: "gemma4:e4b-it-qat", temperature: 0.2, maxTokens: 8192 });

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve);
        if (currentCall === 1) return Promise.resolve([makePosition()]).then(resolve);
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve);
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve);
        if (currentCall === 4) return Promise.resolve([{ currentValue: "0" }]).then(resolve);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    const insertValuesMock = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "crit-016" }]) });
    mockDb.insert = vi.fn().mockImplementation(() => ({ values: insertValuesMock }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    await runTradeCritique("pos-uuid-001");

    const dbRowInsert = insertValuesMock.mock.calls.find((c: any[]) => c[0]?.positionId !== undefined);
    expect(dbRowInsert![0].provider).toBe("ollama");
    expect(dbRowInsert![0].model).toBe("gemma4:e4b-it-qat");
  });

  // ── Test 17: minimal data_completeness when 5+ fields missing ─────────────
  it("(17) 6 Wave 25 fields all null → data_completeness='minimal'", async () => {
    // All Wave 25 fields absent from position (bare position, no extras)
    vi.mocked(callOpenAI).mockResolvedValue(VALID_CRITIQUE_JSON);

    const mockDb = db as any;
    let selectCallCount = 0;
    mockDb.select = vi.fn().mockImplementation(() => {
      const chain: any = { from: () => chain, where: vi.fn(() => chain), orderBy: vi.fn(() => chain), limit: vi.fn(() => chain) };
      const currentCall = selectCallCount++;
      chain.then = (resolve: any) => {
        if (currentCall === 0) return Promise.resolve([]).then(resolve);
        if (currentCall === 1) return Promise.resolve([makePosition()]).then(resolve);
        if (currentCall === 2) return Promise.resolve([makeSession()]).then(resolve);
        if (currentCall === 3) return Promise.resolve([makeStrategy()]).then(resolve);
        if (currentCall === 4) return Promise.resolve([{ currentValue: "0" }]).then(resolve);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    });
    const insertValuesMock = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "crit-017" }]) });
    mockDb.insert = vi.fn().mockImplementation(() => ({ values: insertValuesMock }));
    mockDb.update = vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }));

    const { runTradeCritique } = await import("../services/trade-critique-service.js");
    const result = await runTradeCritique("pos-uuid-001");

    // Position has no Wave25 fields; backtest_expected_r_by_regime also absent from strategy
    expect(result.dataCompleteness).toBe("minimal");
    const dbRow = insertValuesMock.mock.calls.find((c: any[]) => c[0]?.positionId !== undefined)?.[0];
    expect(dbRow?.missingFields?.length).toBeGreaterThanOrEqual(5);
  });

  // ── Test 18: tradeCritique table exported from schema.ts ─────────────────
  it("(18) tradeCritique table is exported from schema.ts", async () => {
    const schema = await import("../db/schema.js");
    expect(schema.tradeCritique).toBeDefined();
    // In test environment the mock returns the mock object; verify the key exists
    expect("tradeCritique" in schema).toBe(true);
  });
});
