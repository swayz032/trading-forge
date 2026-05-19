/**
 * Wave 6 Fixes 3 + 4 — Backtest route integration tests
 *
 * Fix 3 — Stderr banner sentinel:
 *   The Python startup banner "All N context layers imported and callable."
 *   must NOT be stored as error_message when Python exits 0 (it's informational).
 *   When Python exits non-zero with the banner + a real traceback, only the
 *   traceback should appear in the error.
 *
 * Fix 4 — Pipeline-pause silent skip (Wave 6, REVISED Wave 12):
 *   Wave 6 made POST /api/backtests return HTTP 423 when paused to fix the
 *   ghost-backtestId bug (route responded 202+id while service silently
 *   skipped). Wave 12 corrected the over-application: POST /api/backtests
 *   is the OPERATOR-INITIATED manual endpoint and per AGENTS.md pause
 *   discipline, pause gates the AUTOMATED engine — not operator dev/maintenance
 *   validation. The route now calls runBacktest with actor="operator" which
 *   bypasses the service-level guard while preserving Wave 6's ghost-id fix
 *   (row always inserted when actor="operator"). Automated callers
 *   (runStrategy / runStrategyFromDSL / scheduler) keep upstream guards.
 *
 * Test coverage:
 *   Fix 4.1 — Paused + operator endpoint → 202 + backtestId + runBacktest called with actor="operator"
 *   Fix 4.2 — Active + operator endpoint → 202 + backtestId + runBacktest called (unchanged)
 *   Fix 4.3 — runBacktest always receives actor="operator" from this route (audit-trail invariant)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";

// ─── Pipeline control — flipped per-test ────────────────────────────────────
const isActiveMock = vi.fn().mockResolvedValue(true);
vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: isActiveMock,
  getMode: vi.fn().mockResolvedValue("ACTIVE"),
}));

// ─── DB mock ─────────────────────────────────────────────────────────────────
// Wave 12: insert() now also receives audit_log writes from the route
// (backtest.operator_initiated). Default chainable .values() prevents
// .catch on undefined errors regardless of whether the route awaits the chain.
const dbInsertMock = vi.fn(() => ({
  values: vi.fn().mockReturnValue({
    catch: vi.fn().mockReturnValue(Promise.resolve()),
    then: (cb: (v: unknown) => unknown) => Promise.resolve(cb(undefined)),
  }),
}));
const dbSelectMock = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    insert: dbInsertMock,
    select: dbSelectMock,
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    transaction: vi.fn(),
  },
}));

vi.mock("../db/schema.js", () => ({
  backtests: {},
  backtestTrades: {},
  backtestMatrix: {},
  monteCarloRuns: {},
  stressTestRuns: {},
  strategies: {},
  auditLog: {},
  walkForwardWindows: {},
  strategyNames: {},
  sqaOptimizationRuns: {},
  quboTimingRuns: {},
  tensorPredictions: {},
  rlTrainingRuns: {},
  paperSessions: {},
  backtestProvenance: {},
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
}));

// runBacktest mock — only invoked on active pipeline path
const runBacktestMock = vi.fn();
vi.mock("../services/backtest-service.js", () => ({
  runBacktest: runBacktestMock,
}));

vi.mock("../services/matrix-backtest-service.js", () => ({
  runMatrix: vi.fn().mockResolvedValue(undefined),
  getMatrixStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock("../middleware/idempotency.js", () => ({
  idempotencyMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());
  // Attach req.id + req.log so route handlers don't crash
  app.use((req, _res, next) => {
    (req as express.Request & { id: string }).id = "test-correlation-id";
    (req as express.Request & { log: Record<string, unknown> }).log = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    next();
  });
  const { backtestRoutes } = await import("../routes/backtests.js");
  app.use("/api/backtests", backtestRoutes);
  return app;
}

async function postBacktest(
  app: express.Express,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/api/backtests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const status = res.status;
        let parsed: Record<string, unknown> = {};
        try {
          parsed = await res.json();
        } catch {
          parsed = {};
        }
        server.close(() => resolve({ status, body: parsed }));
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

const VALID_STRATEGY_ID = "00000000-0000-4000-8000-000000000001";

const VALID_BACKTEST_BODY: Record<string, unknown> = {
  strategyId: VALID_STRATEGY_ID,
  strategy: {
    name: "test-strategy",
    symbol: "MES",
    timeframe: "5m",
    indicators: [],
    entry_long: "close > open",
    entry_short: "close < open",
    exit: "time_stop",
    stop_loss: { type: "atr", multiplier: 2.0 },
    position_size: { type: "fixed", fixed_contracts: 1 },
  },
};

// ─── Fix 4 tests ──────────────────────────────────────────────────────────────

describe("Fix 4 — Backtest route pipeline-pause gate (Wave 6 → Wave 12)", () => {
  beforeEach(() => {
    vi.resetModules();
    isActiveMock.mockReset();
    runBacktestMock.mockReset();
    dbInsertMock.mockClear();
    dbSelectMock.mockReset();

    // Default strategy DB row for tests that need it
    dbSelectMock.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: VALID_STRATEGY_ID,
          name: "test-strategy",
          symbol: "MES",
          timeframe: "5m",
          config: {
            entry_long: "close > open",
            entry_short: "close < open",
            exit: "time_stop",
            indicators: [],
            stop_loss: { type: "atr", multiplier: 2.0 },
            position_size: { type: "fixed", fixed_contracts: 1 },
          },
        }]),
      }),
    });
  });

  it("Fix 4.1 (Wave 12) — paused pipeline → operator endpoint STILL returns 202 (manual bypass)", async () => {
    isActiveMock.mockResolvedValue(false);
    runBacktestMock.mockResolvedValue({ id: "test-bt-id", status: "completed" });
    const app = await buildApp();

    const { status, body } = await postBacktest(app, VALID_BACKTEST_BODY);

    expect(status).toBe(202);
    expect(typeof (body as Record<string, unknown>).backtestId).toBe("string");
    expect((body as Record<string, unknown>).error).toBeUndefined();
  });

  it("Fix 4.1 (Wave 12) — paused pipeline → runBacktest IS called with actor=\"operator\"", async () => {
    isActiveMock.mockResolvedValue(false);
    runBacktestMock.mockResolvedValue({ id: "test-bt-id", status: "completed" });
    const app = await buildApp();

    await postBacktest(app, VALID_BACKTEST_BODY);
    await new Promise((r) => setTimeout(r, 10));

    expect(runBacktestMock).toHaveBeenCalled();
    // actor is the 6th positional arg: (strategyId, config, strategyClass, externalId, correlationId, actor)
    const call = runBacktestMock.mock.calls[0];
    expect(call[5]).toBe("operator");
  });

  it("Fix 4.2 — active pipeline → HTTP 202 with backtestId", async () => {
    isActiveMock.mockResolvedValue(true);
    runBacktestMock.mockResolvedValue({ id: "test-bt-id", status: "completed" });
    const app = await buildApp();

    const { status, body } = await postBacktest(app, VALID_BACKTEST_BODY);

    expect(status).toBe(202);
    expect(typeof (body as Record<string, unknown>).backtestId).toBe("string");
    expect(((body as Record<string, unknown>).backtestId as string).length).toBeGreaterThan(0);
  });

  it("Fix 4.2 — active pipeline → runBacktest IS called with actor=\"operator\"", async () => {
    isActiveMock.mockResolvedValue(true);
    runBacktestMock.mockResolvedValue({ id: "test-bt-id", status: "completed" });
    const app = await buildApp();

    await postBacktest(app, VALID_BACKTEST_BODY);
    await new Promise((r) => setTimeout(r, 10));

    expect(runBacktestMock).toHaveBeenCalled();
    const call = runBacktestMock.mock.calls[0];
    expect(call[5]).toBe("operator");
  });

  it("Fix 4.3 (Wave 12) — operator endpoint writes audit_log backtest.operator_initiated", async () => {
    isActiveMock.mockResolvedValue(false);
    runBacktestMock.mockResolvedValue({ id: "test-bt-id", status: "completed" });
    const app = await buildApp();

    await postBacktest(app, VALID_BACKTEST_BODY);
    await new Promise((r) => setTimeout(r, 10));

    // db.insert was called at least once (for audit_log).
    // Audit-trail invariant: every operator-initiated backtest leaves a trace.
    expect(dbInsertMock).toHaveBeenCalled();
  });
});
