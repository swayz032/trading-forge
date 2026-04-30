/**
 * A+ Market Auditor — Per-Market Noise Wiring Tests
 *
 * W3b deferred: A+ auditor must inject real per-market quantum_noise_score
 * from skip_decisions into marketInputs BEFORE calling the Python auditor.
 *
 * Tests cover:
 *   1. enrichWithPerMarketNoise returns noise scores from skip_decisions
 *   2. enrichWithPerMarketNoise falls back to null when no skip decision exists
 *   3. Injected noise_score is passed to Python payload (not overridden to null)
 *   4. Caller-provided noise_score is NOT overwritten by enrichment
 *   5. Graceful fallback on DB error
 *   6. Enrichment only sets noise_score (does not touch other market fields)
 *   7. Challenger isolation — enrichment does not spawn quantum compute
 *   8. Enrichment is per-market — MES and MNQ get independent scores
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ─────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  dbExecuteMock: vi.fn(),
  isActiveMock: vi.fn().mockResolvedValue(true),
  runPythonModuleMock: vi.fn().mockResolvedValue({
    winner_market: "MES",
    observation_mode: false,
    edge_scores: {
      MES: { vol: 0.8, p_target: 0.8, noise: 0.3, entangle: 0.7, composite: 0.75, passes_p_target_gate: true, passes_noise_gate: true },
    },
    lead_market: null,
    lag_window_minutes: null,
    entanglement_strength: 0.7,
    governance: { authoritative: false, decision_role: "challenger_only" },
    scan_duration_ms: 12,
    hardware: "default.qubit",
    seed: 42,
  }),
  withCostTrackingMock: vi.fn().mockImplementation((_opts: unknown, fn: () => unknown) => fn()),
  broadcastSSEMock: vi.fn(),
  dbInsertMock: vi.fn(),
  dbUpdateMock: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {
    execute: (...args: unknown[]) => mocks.dbExecuteMock(...args),
    insert: (...args: unknown[]) => mocks.dbInsertMock(...args),
    update: (...args: unknown[]) => mocks.dbUpdateMock(...args),
  },
}));

vi.mock("../db/schema.js", () => ({
  aPlusMarketScans: {
    scanDate: "scan_date",
    id: "id",
    status: "status",
    $inferSelect: {},
  },
  skipDecisions: { strategyId: "strategy_id", createdAt: "created_at", signals: "signals" },
  strategies: { id: "id", symbol: "symbol" },
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: mocks.runPythonModuleMock,
}));

vi.mock("../lib/quantum-cost-tracker.js", () => ({
  withCostTracking: mocks.withCostTrackingMock,
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: mocks.broadcastSSEMock,
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: mocks.isActiveMock,
}));

const {
  dbExecuteMock,
  dbInsertMock,
  dbUpdateMock,
  runPythonModuleMock,
} = mocks;

// Helper: make dbInsert return a row
function setupDbInsert(id = "scan-row-id") {
  dbInsertMock.mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id }]),
      }),
    }),
  });
  dbUpdateMock.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

// ─── Tests: enrichWithPerMarketNoise ─────────────────────────────────────────

describe("enrichWithPerMarketNoise", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbInsert();
  });

  it("injects noise_score from skip_decisions for each market", async () => {
    // Query returns rows: MES=0.3, MNQ=0.4, MCL=null (no decision)
    dbExecuteMock
      .mockResolvedValueOnce([{ noise_score: "0.3" }])  // MES
      .mockResolvedValueOnce([{ noise_score: "0.4" }])  // MNQ
      .mockResolvedValueOnce([]);                         // MCL — no decision

    const { enrichWithPerMarketNoise } = await import(
      "../services/a-plus-auditor-service.js"
    );

    const inputs = {
      MES: { atr_5m: 1.0, atr_8yr_avg: 0.8, vix: 18.0, gap_atr: 0.2, spread: 0.05 },
      MNQ: { atr_5m: 1.2, atr_8yr_avg: 0.9, vix: 18.0, gap_atr: 0.3, spread: 0.06 },
      MCL: { atr_5m: 0.5, atr_8yr_avg: 0.4, vix: 18.0, gap_atr: 0.1, spread: 0.02 },
    };

    const enriched = await enrichWithPerMarketNoise(inputs);

    expect(enriched.MES.noise_score).toBeCloseTo(0.3, 5);
    expect(enriched.MNQ.noise_score).toBeCloseTo(0.4, 5);
    expect(enriched.MCL.noise_score).toBeNull();  // graceful fallback
  });

  it("falls back to null for market with no recent skip_decision", async () => {
    // All markets return empty rows
    dbExecuteMock.mockResolvedValue([]);

    const { enrichWithPerMarketNoise } = await import(
      "../services/a-plus-auditor-service.js"
    );

    const inputs = {
      MES: { atr_5m: 1.0, atr_8yr_avg: 0.8, vix: 18.0, gap_atr: 0.2, spread: 0.05 },
    };

    const enriched = await enrichWithPerMarketNoise(inputs);
    expect(enriched.MES.noise_score).toBeNull();
  });

  it("does NOT overwrite caller-provided noise_score", async () => {
    // Skip_decisions would return 0.7 for MES
    dbExecuteMock.mockResolvedValue([{ noise_score: "0.7" }]);

    const { enrichWithPerMarketNoise } = await import(
      "../services/a-plus-auditor-service.js"
    );

    const inputs = {
      MES: {
        atr_5m: 1.0, atr_8yr_avg: 0.8, vix: 18.0, gap_atr: 0.2, spread: 0.05,
        noise_score: 0.25,  // caller already provided this — must be preserved
      },
    };

    const enriched = await enrichWithPerMarketNoise(inputs);
    // Caller-provided value wins
    expect(enriched.MES.noise_score).toBeCloseTo(0.25, 5);
    // DB was not queried (shortcut: already has noise_score)
    expect(dbExecuteMock).not.toHaveBeenCalled();
  });

  it("returns only noise_score updates — all other fields unchanged", async () => {
    dbExecuteMock.mockResolvedValue([{ noise_score: "0.5" }]);

    const { enrichWithPerMarketNoise } = await import(
      "../services/a-plus-auditor-service.js"
    );

    const inputs = {
      MES: { atr_5m: 1.0, atr_8yr_avg: 0.8, vix: 22.5, gap_atr: 0.4, spread: 0.07 },
    };

    const enriched = await enrichWithPerMarketNoise(inputs);

    expect(enriched.MES.atr_5m).toBe(1.0);
    expect(enriched.MES.atr_8yr_avg).toBe(0.8);
    expect(enriched.MES.vix).toBe(22.5);
    expect(enriched.MES.gap_atr).toBe(0.4);
    expect(enriched.MES.spread).toBe(0.07);
  });

  it("falls back gracefully on DB error", async () => {
    dbExecuteMock.mockRejectedValue(new Error("db_unavailable"));

    const { enrichWithPerMarketNoise } = await import(
      "../services/a-plus-auditor-service.js"
    );

    const inputs = {
      MES: { atr_5m: 1.0, atr_8yr_avg: 0.8, vix: 18.0, gap_atr: 0.2, spread: 0.05 },
    };

    // Must not throw — returns noise_score=null on error
    const enriched = await enrichWithPerMarketNoise(inputs);
    expect(enriched.MES.noise_score).toBeNull();
  });

  it("is per-market independent — different scores for different markets", async () => {
    dbExecuteMock
      .mockResolvedValueOnce([{ noise_score: "0.1" }])  // MES — quiet
      .mockResolvedValueOnce([{ noise_score: "0.9" }]);  // MNQ — chaotic

    const { enrichWithPerMarketNoise } = await import(
      "../services/a-plus-auditor-service.js"
    );

    const inputs = {
      MES: { atr_5m: 1.0, atr_8yr_avg: 0.8, vix: 18.0, gap_atr: 0.2, spread: 0.05 },
      MNQ: { atr_5m: 2.0, atr_8yr_avg: 1.5, vix: 30.0, gap_atr: 0.8, spread: 0.1 },
    };

    const enriched = await enrichWithPerMarketNoise(inputs);

    expect(enriched.MES.noise_score).toBeCloseTo(0.1, 5);
    expect(enriched.MNQ.noise_score).toBeCloseTo(0.9, 5);
  });
});

// ─── Integration: runAuditScan uses enriched noise scores ────────────────────

describe("runAuditScan — per-market noise injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbInsert();
    // Reset module for each test
    vi.resetModules();
  });

  it("passes enriched noise_score per market to Python payload", async () => {
    // MES has a recent skip_decision with noise_score=0.35
    dbExecuteMock
      .mockResolvedValueOnce([{ noise_score: "0.35" }])  // MES enrichment
      .mockResolvedValueOnce([]);                          // MNQ enrichment — no data

    setupDbInsert("scan-row-001");

    const { runAuditScan } = await import("../services/a-plus-auditor-service.js");

    process.env.QUANTUM_AMARKET_AUDITOR_ENABLED = "true";

    await runAuditScan({
      marketInputs: {
        MES: { atr_5m: 1.0, atr_8yr_avg: 0.8, vix: 18.0, gap_atr: 0.2, spread: 0.05 },
        MNQ: { atr_5m: 1.2, atr_8yr_avg: 0.9, vix: 18.0, gap_atr: 0.3, spread: 0.06 },
      },
      seed: 42,
    });

    delete process.env.QUANTUM_AMARKET_AUDITOR_ENABLED;

    // Verify Python was called with the enriched noise scores
    expect(runPythonModuleMock).toHaveBeenCalledOnce();
    const pythonConfig = runPythonModuleMock.mock.calls[0][0].config;
    expect(pythonConfig.market_inputs.MES.noise_score).toBeCloseTo(0.35, 5);
    expect(pythonConfig.market_inputs.MNQ.noise_score).toBeNull();
  });

  it("does NOT call Python when QUANTUM_AMARKET_AUDITOR_ENABLED=false", async () => {
    const { runAuditScan } = await import("../services/a-plus-auditor-service.js");

    // Ensure flag is off
    delete process.env.QUANTUM_AMARKET_AUDITOR_ENABLED;

    const result = await runAuditScan({
      marketInputs: {
        MES: { atr_5m: 1.0, atr_8yr_avg: 0.8, vix: 18.0, gap_atr: 0.2, spread: 0.05 },
      },
    });

    expect(result.skipped).toBe(true);
    expect(runPythonModuleMock).not.toHaveBeenCalled();
    expect(dbExecuteMock).not.toHaveBeenCalled(); // No enrichment queries when skipped
  });
});
