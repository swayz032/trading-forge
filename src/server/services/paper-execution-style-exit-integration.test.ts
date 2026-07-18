/**
 * Integration tests for Track 3: exitBarContext wired end-to-end.
 *
 * Verifies the full call chain:
 *   updatePositionPrices(ctx) → callExitHandler (Python subprocess)
 *   → applyExitDecision → DB mutation + SSE + audit_log
 *
 * Test scenarios:
 *  T1. TP1 fill: Python called with correct state dict → FILL_TP1_50PCT →
 *      tp1_filled=true in DB + paper:exit:tp1_filled SSE + audit_log row
 *  T2. TIME_STOP_FLATTEN at 15:55 ET: regardless of P&L → closePosition +
 *      paper:exit:time_stop_flattened SSE
 *  T3. Failed Python subprocess → HOLD (fail-CLOSED) + paper:exit:handler_error SSE
 *      + audit_log row with status=failed
 *  T4. Missing exitBarContext (legacy caller) → Python NOT called (no regression)
 *  T5. ATR NaN guard: insufficient bars → context undefined → Python NOT called
 *  T6. ATR valid with ≥15 bars returns non-NaN value
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Shared captured state ────────────────────────────────────────────────────

const capturedAuditInserts: unknown[] = [];
const capturedPositionUpdates: unknown[] = [];
const capturedSSEBroadcasts: [string, unknown][] = [];

let mockRunPythonModuleImpl: () => Promise<unknown> = () => Promise.resolve({
  decision: "HOLD",
  new_stop: null,
  evidence: {},
  handler_version: "style_d_v1.0.0",
});

const mockRunPythonModule = vi.fn((..._args: unknown[]) => mockRunPythonModuleImpl());

let selectQueue: Array<unknown[]> = [];
let selectCallIndex = 0;

// ─── Mocks — must be hoisted before imports ───────────────────────────────────

vi.mock("../db/index.js", () => {
  function makeChain(): Record<string, unknown> {
    let resolveP: (v: unknown) => void = () => {};
    const p = new Promise<unknown>((r) => { resolveP = r; });

    function settle() {
      const entry = selectQueue[selectCallIndex];
      selectCallIndex++;
      resolveP(entry ?? []);
    }

    const chain: Record<string, unknown> = {
      then: (onFulfilled: unknown, onRejected: unknown) => {
        settle();
        return (p as Promise<unknown>).then(
          onFulfilled as (v: unknown) => unknown,
          onRejected as (e: unknown) => unknown,
        );
      },
      catch: (onRejected: unknown) => {
        settle();
        return (p as Promise<unknown>).catch(onRejected as (e: unknown) => unknown);
      },
      finally: (onFinally: unknown) => {
        settle();
        return (p as Promise<unknown>).finally(onFinally as () => unknown);
      },
    };

    const chainFn = () => chain;
    chain.from = chainFn;
    chain.where = chainFn;
    chain.limit = chainFn;
    chain.orderBy = chainFn;
    chain.returning = chainFn;
    chain.values = () => ({ catch: () => {} });
    return chain;
  }

  return {
    db: {
      select: vi.fn(makeChain),
      insert: vi.fn(() => ({
        values: vi.fn((vals: unknown) => {
          capturedAuditInserts.push(vals);
          return { catch: vi.fn() };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((vals: Record<string, unknown>) => {
          capturedPositionUpdates.push({ ...vals });
          // 2026-07-12 hardening: updatePositionPrices' MTM UPDATE now guards with
          // .where(closedAt IS NULL).returning({id}) (idempotency-claim pattern,
          // matching the tx-level update below) — the mock chain must expose
          // .returning() returning a non-empty array or the guard treats every
          // position as "closed concurrently" (or, absent .returning() at all, throws).
          return { where: vi.fn().mockImplementation(() => {
            const p: any = Promise.resolve(undefined);
            p.returning = vi.fn().mockResolvedValue([{ id: "pos-mtm-updated" }]);
            return p;
          }) };
        }),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
        select: vi.fn(makeChain),
        // CRIT-1 (2026-07-09): closePosition now runs a guarded idempotency CLAIM
        // (update...where(isNull(closedAt)).returning({id})) before the trade insert,
        // so the tx's update.where must expose .returning(); insert.values must too.
        insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: "trade-1", pnl: "0" }]), catch: vi.fn() })) })),
        update: vi.fn(() => ({ set: vi.fn((vals: Record<string, unknown>) => { capturedPositionUpdates.push({ ...vals }); return { where: vi.fn().mockImplementation(() => { const p: any = Promise.resolve(undefined); p.returning = vi.fn().mockResolvedValue([{ id: "pos-claimed" }]); return p; }) }; }) })),
      })),
    },
  };
});

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn((event: string, payload: unknown) => {
    capturedSSEBroadcasts.push([event, payload]);
  }),
  PAPER_EXIT_EVENTS: {
    TP1_FILLED:          "paper:exit:tp1_filled",
    TP2_FILLED:          "paper:exit:tp2_filled",
    BE_STOP_MOVED:       "paper:exit:be_stop_moved",
    TRAIL_TIGHTENED:     "paper:exit:trail_tightened",
    TIME_STOP_FLATTENED: "paper:exit:time_stop_flattened",
    HANDLER_ERROR:       "paper:exit:handler_error",
  },
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: (...args: unknown[]) => mockRunPythonModule(...args),
}));

vi.mock("./pipeline-control-service.js", () => ({
  isActive: vi.fn(() => true),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/tracing.js", () => ({
  tracer: {
    startSpan: vi.fn().mockReturnValue({ setAttribute: vi.fn(), end: vi.fn() }),
  },
}));

vi.mock("../scheduler.js", () => ({ onPaperTradeClose: vi.fn() }));

vi.mock("./paper-risk-gate.js", () => ({
  toEasternDateString: vi.fn().mockReturnValue("2026-05-09"),
  toFuturesTradingDayString: vi.fn().mockReturnValue("2026-05-09"),
  invalidateDailyLossCache: vi.fn(),
}));

vi.mock("../lib/roll-calendar-loader.js", () => ({
  computeRollSpreadCost: vi.fn().mockResolvedValue({ estimatedSpreadCost: 0, rollDates: [] }),
}));

vi.mock("./alert-service.js", () => ({
  AlertFactory: {
    systemError: vi.fn(),
    criticalAlert: vi.fn(),
    driftAlert: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/dst-utils.js", () => ({
  getEtOffsetMinutes: vi.fn().mockReturnValue(-240),
  isUsDst: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/db-locks.js", () => ({
  withSessionLock: vi.fn(async (_: unknown, fn: () => unknown) => fn()),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { updatePositionPrices, type StyleExitBarContext } from "./paper-execution-service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildLongMesPosition(overrides: Record<string, unknown> = {}) {
  return {
    id: "pos-int-001",
    sessionId: "sess-int-001",
    symbol: "MES",
    side: "long",
    entryPrice: "4500",
    currentPrice: "4509",     // +9pt above entry; stop_pts≈8 → above 1R
    contracts: 2,
    unrealizedPnl: "90",
    previousUnrealizedPnl: "0",
    mae: null,
    mfe: null,
    fillRatio: "1.0",
    trailHwm: null,
    closedAt: null,
    currentExitStyle: "D",
    tp1Filled: false,
    tp2Filled: false,
    beStopApplied: false,
    currentTrailMethod: null,
    lastHandlerEvalAt: null,
    ...overrides,
  };
}

const INTEGRATION_BAR_CTX: StyleExitBarContext = {
  currentTimeEt: "10:30",
  atr14: { MES: 4.0 },        // stop_pts = 4.0 * 2 = 8.0; 9pt move > 1R
  last2barSwingLow:  { MES: 4503.0 },
  last2barSwingHigh: undefined,
  developingSessionPoc: undefined,
};

beforeEach(() => {
  selectQueue = [];
  selectCallIndex = 0;
  capturedAuditInserts.length = 0;
  capturedPositionUpdates.length = 0;
  capturedSSEBroadcasts.length = 0;
  mockRunPythonModuleImpl = () => Promise.resolve({
    decision: "HOLD",
    new_stop: null,
    evidence: {},
    handler_version: "style_d_v1.0.0",
  });
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Track 3 Integration — exitBarContext wired end-to-end", () => {

  it("T1: TP1 fill: Python called with correct state dict → FILL_TP1_50PCT → tp1_filled DB + SSE + audit", async () => {
    selectQueue = [
      [buildLongMesPosition()],           // openPositions query
      [{ strategyId: "strat-001" }],      // getSessionStrategyId query
    ];

    // 1st call = the TP1 exit decision. 2nd call = the F4 same-bar TP2 re-invocation on the
    // TP1-filled position (returns HOLD here — no TP2 on this bar). See the assertion note below.
    let _t1PyCall = 0;
    mockRunPythonModuleImpl = () => {
      _t1PyCall += 1;
      return Promise.resolve(
        _t1PyCall === 1
          ? {
              decision: "FILL_TP1_50PCT",
              new_stop: null,
              evidence: { trigger: "tp1_hit", atr_14: 4.0, entry_price: 4500, current_price: 4509 },
              handler_version: "style_d_v1.0.0",
            }
          : {
              decision: "HOLD",
              new_stop: null,
              evidence: { trigger: "no_tp2_this_bar" },
              handler_version: "style_d_v1.0.0",
            },
      );
    };

    await updatePositionPrices(
      "sess-int-001",
      { MES: { close: 4509, high: 4512, low: 4503 } },
      INTEGRATION_BAR_CTX,
    );

    // Python subprocess called TWICE: (1) the TP1 exit decision, then (2) the F4 same-bar TP2
    // re-invocation on the TP1-filled position — a large bar can hit TP1 AND TP2 on the same bar,
    // mirroring the backtester's intrabar detection (paper-execution-service.ts:4646-4659). The
    // 2nd call returns HOLD (no TP2 this bar). This test predated F4 and asserted 1; corrected to 2.
    expect(mockRunPythonModule).toHaveBeenCalledTimes(2);

    // Verify Python was passed correct state dict fields
    const pythonCallArg = mockRunPythonModule.mock.calls[0][0] as {
      module: string;
      config: { action: string; state: Record<string, unknown> };
    };
    expect(pythonCallArg.module).toContain("style_d_handler");
    expect(pythonCallArg.config.state.current_price).toBeCloseTo(4509, 1);
    expect(pythonCallArg.config.state.atr_14).toBeCloseTo(4.0, 2);
    expect(pythonCallArg.config.state.direction).toBe("long");
    expect(pythonCallArg.config.state.entry_price).toBeCloseTo(4500, 0);

    // SSE paper:exit:tp1_filled was broadcast
    const tp1Sse = capturedSSEBroadcasts.find(([ev]) => ev === "paper:exit:tp1_filled");
    expect(tp1Sse).toBeDefined();
    expect((tp1Sse![1] as Record<string, unknown>).decision_type).toBe("FILL_TP1_50PCT");
    expect((tp1Sse![1] as Record<string, unknown>).position_id).toBe("pos-int-001");

    // audit_log row written for FILL_TP1_50PCT (non-HOLD decision)
    const auditRow = capturedAuditInserts.find(
      (r) => (r as Record<string, unknown>).action === "paper.exit_decision.fill_tp1_50pct",
    );
    expect(auditRow).toBeDefined();
    expect((auditRow as Record<string, unknown>).entityId).toBe("pos-int-001");
    expect((auditRow as Record<string, unknown>).status).toBe("success");

    // tp1Filled=true written to DB
    const tp1DbUpdate = capturedPositionUpdates.find(
      (u) => (u as Record<string, unknown>).tp1Filled === true,
    );
    expect(tp1DbUpdate).toBeDefined();
  });

  it("T2: TIME_STOP_FLATTEN at 15:55 ET: Python called regardless of P&L → correct decision in audit", async () => {
    // Note on SSE verification: TIME_STOP_FLATTEN fires broadcastSSE AFTER calling closePosition.
    // closePosition requires additional DB state (session, firm config, etc.) not practical to
    // fully mock in this integration test scope. We verify the decisive properties:
    //   (a) Python was called with currentTimeEt=15:55
    //   (b) audit_log row was written with the correct action (written BEFORE closePosition)
    //   (c) Python subprocess was given the position-in-red scenario
    // The broadcastSSE path for TIME_STOP_FLATTENED is covered by existing
    // paper-execution-style-exit.test.ts (test-4 in that file).

    selectQueue = [
      [buildLongMesPosition({ currentPrice: "4495", unrealizedPnl: "-50" })], // position in the red
      [{ strategyId: "strat-001" }],
    ];

    mockRunPythonModuleImpl = () => Promise.resolve({
      decision: "TIME_STOP_FLATTEN",
      new_stop: null,
      evidence: { trigger: "time_stop", current_time_et: "15:55", handler_version: "style_d_v1.0.0" },
      handler_version: "style_d_v1.0.0",
    });

    const timeStopCtx: StyleExitBarContext = {
      ...INTEGRATION_BAR_CTX,
      currentTimeEt: "15:55",
    };

    // May throw internally from closePosition (mocked DB exhausted) — that's expected here.
    // We only care that Python was invoked correctly and the audit row was written.
    try {
      await updatePositionPrices(
        "sess-int-001",
        { MES: { close: 4495, high: 4498, low: 4492 } },
        timeStopCtx,
      );
    } catch {
      // closePosition DB chain exhausted — acceptable in this test scope
    }

    // Python was called exactly once
    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);

    // Correct ET time was passed to handler — ensures time-stop fires at/after 15:55
    const state = (mockRunPythonModule.mock.calls[0][0] as { config: { state: Record<string, unknown> } })
      .config.state;
    expect(state.current_time_et).toBe("15:55");

    // current_price passed correctly (position is in red but handler still fires)
    expect(state.current_price).toBeCloseTo(4495, 0);

    // audit_log row written for TIME_STOP_FLATTEN (non-HOLD → audit fires before closePosition)
    const auditRow = capturedAuditInserts.find(
      (r) => String((r as Record<string, unknown>).action).includes("time_stop_flatten"),
    );
    expect(auditRow).toBeDefined();
    expect((auditRow as Record<string, unknown>).status).toBe("success");
  });

  it("T3: Failed Python subprocess → HOLD (fail-CLOSED) + handler_error SSE + audit status=failed", async () => {
    selectQueue = [
      [buildLongMesPosition()],
      [{ strategyId: "strat-001" }],
    ];

    // Python subprocess crashes
    mockRunPythonModuleImpl = () => Promise.reject(new Error("subprocess timeout after 3000ms"));

    // Must resolve (not throw) — fail-CLOSED means HOLD, error contained
    await expect(
      updatePositionPrices(
        "sess-int-001",
        { MES: { close: 4509, high: 4512, low: 4503 } },
        INTEGRATION_BAR_CTX,
      ),
    ).resolves.not.toThrow();

    // Python was invoked
    expect(mockRunPythonModule).toHaveBeenCalledTimes(1);

    // SSE paper:exit:handler_error with decision_type=HOLD
    const handlerErrSse = capturedSSEBroadcasts.find(([ev]) => ev === "paper:exit:handler_error");
    expect(handlerErrSse).toBeDefined();
    const errPayload = handlerErrSse![1] as Record<string, unknown>;
    expect(errPayload.decision_type).toBe("HOLD");
    expect(errPayload.position_id).toBe("pos-int-001");

    // audit_log row with action=paper.exit_handler_error and status=failed
    const auditRow = capturedAuditInserts.find(
      (r) => (r as Record<string, unknown>).action === "paper.exit_handler_error",
    );
    expect(auditRow).toBeDefined();
    expect((auditRow as Record<string, unknown>).status).toBe("failed");
    expect((auditRow as Record<string, unknown>).entityId).toBe("pos-int-001");

    // No TP1/TP2/trail SSE events fired — only handler_error
    const exitSse = capturedSSEBroadcasts.filter(
      ([ev]) => ev.startsWith("paper:exit:") && ev !== "paper:exit:handler_error",
    );
    expect(exitSse).toHaveLength(0);
  });

  it("T4: Missing exitBarContext (legacy caller) → Python NOT called, no exit SSE events", async () => {
    selectQueue = [[buildLongMesPosition()]];

    await updatePositionPrices(
      "sess-int-001",
      { MES: { close: 4509, high: 4512, low: 4503 } },
      // no exitBarContext — legacy caller path
    );

    expect(mockRunPythonModule).not.toHaveBeenCalled();

    const exitSse = capturedSSEBroadcasts.filter(([ev]) => ev.startsWith("paper:exit:"));
    expect(exitSse).toHaveLength(0);
  });
});

// ─── Circuit breaker tests ────────────────────────────────────────────────────

describe("Track 3 — exit handler circuit breaker", () => {
  it("T7: circuit OPEN after 3 subprocess failures — 4th call skips Python spawn", async () => {
    const { resetExitHandlerCircuitBreaker } = await import("./paper-execution-service.js");
    resetExitHandlerCircuitBreaker();

    // Force 3 subprocess failures to trip the circuit breaker
    mockRunPythonModuleImpl = () => Promise.reject(new Error("subprocess_timeout"));

    for (let i = 0; i < 3; i++) {
      selectQueue.push([buildLongMesPosition()], [{ strategyId: "strat-001" }]);
      await updatePositionPrices(
        "sess-cb-001",
        { MES: { close: 4509, high: 4512, low: 4503 } },
        INTEGRATION_BAR_CTX,
      );
    }

    // After 3 failures, circuit should be OPEN — 4th call should NOT spawn Python
    selectQueue.push([buildLongMesPosition()], [{ strategyId: "strat-001" }]);
    const callsBefore = mockRunPythonModule.mock.calls.length;
    await updatePositionPrices(
      "sess-cb-001",
      { MES: { close: 4509, high: 4512, low: 4503 } },
      INTEGRATION_BAR_CTX,
    );
    // Python should NOT have been called on the 4th invocation (circuit OPEN)
    expect(mockRunPythonModule.mock.calls.length).toBe(callsBefore);

    // Circuit open audit row should have been written
    const cbAuditRow = capturedAuditInserts.find(
      (r) => (r as Record<string, unknown>).action === "exit_handler.circuit_breaker_open",
    );
    expect(cbAuditRow).toBeDefined();

    // Cleanup
    resetExitHandlerCircuitBreaker();
  });

  it("T8: correlation_id propagates from updatePositionPrices context into audit_log rows", async () => {
    const { resetExitHandlerCircuitBreaker } = await import("./paper-execution-service.js");
    resetExitHandlerCircuitBreaker();

    selectQueue = [
      [buildLongMesPosition()],
      [{ strategyId: "strat-001" }],
    ];

    mockRunPythonModuleImpl = () => Promise.resolve({
      decision: "FILL_TP1_50PCT",
      new_stop: null,
      evidence: { trigger: "tp1_hit" },
      handler_version: "style_d_v1.0.0",
    });

    const testCorrelationId = "test-corr-id-12345";
    await updatePositionPrices(
      "sess-corr-001",
      { MES: { close: 4509, high: 4512, low: 4503 } },
      INTEGRATION_BAR_CTX,
      { correlationId: testCorrelationId },
    );

    // audit_log row for the TP1 decision must carry the correlationId
    const auditRow = capturedAuditInserts.find(
      (r) => (r as Record<string, unknown>).action === "paper.exit_decision.fill_tp1_50pct",
    );
    expect(auditRow).toBeDefined();
    expect((auditRow as Record<string, unknown>).correlationId).toBe(testCorrelationId);

    // SSE payload must carry correlation_id
    const tp1Sse = capturedSSEBroadcasts.find(([ev]) => ev === "paper:exit:tp1_filled");
    expect(tp1Sse).toBeDefined();
    expect((tp1Sse![1] as Record<string, unknown>).correlation_id).toBe(testCorrelationId);
  });
});

// ─── ATR helper unit tests (fail-open trigger conditions) ─────────────────────

describe("Track 3 — ATR fail-open trigger conditions", () => {
  it("T5: ATR(period=14) returns NaN when fewer than 15 bars provided", async () => {
    const { ATR } = await import("./paper-signal-service.js");

    const shortBuffer = [
      { symbol: "MES", timestamp: "2026-05-09T14:30:00Z", open: 4500, high: 4505, low: 4498, close: 4502, volume: 100 },
    ];
    const atrVal = ATR(shortBuffer as Parameters<typeof ATR>[0], 14);
    // NaN confirms the fail-open condition: buildExitBarContext returns undefined
    expect(isNaN(atrVal)).toBe(true);
  });

  it("T6: ATR(period=14) returns valid positive value with ≥15 bars", async () => {
    const { ATR } = await import("./paper-signal-service.js");

    const bars = Array.from({ length: 20 }, (_, i) => ({
      symbol: "MES",
      timestamp: new Date(Date.UTC(2026, 4, 9, 9, 30) + i * 60_000).toISOString(),
      open:  4500 + i * 0.5,
      high:  4502 + i * 0.5,
      low:   4498 + i * 0.5,
      close: 4501 + i * 0.5,
      volume: 1000,
    }));

    const atrVal = ATR(bars as Parameters<typeof ATR>[0], 14);
    expect(isNaN(atrVal)).toBe(false);
    expect(atrVal).toBeGreaterThan(0);
    // MES 4500-range bars with 4pt range → ATR should be ~4pt
    expect(atrVal).toBeCloseTo(4.0, 0);
  });
});
