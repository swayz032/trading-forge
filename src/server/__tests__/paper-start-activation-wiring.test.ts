/**
 * paper-start-activation-wiring.test.ts — AR-1155 (2026-08-19, per AR-1342A S5B/S6)
 *
 * Real POST /api/paper/start route wiring — direct handler invocation via
 * router.stack extraction + mocked req/res (matches this repo's established
 * convention, see backtests-cascade-delete.test.ts). This is NOT a copied
 * reference implementation of the route: the REAL exported handler function
 * from `../routes/paper.ts` is imported and invoked; only its dependencies
 * (db, verifyPaperActivation, startStream, notification/SSE/metrics) are
 * mocked, so the route's own branching (F-4/F-9) actually executes.
 *
 * Proves both AR-1341A F-9 cases with real control flow:
 *   1. Activation refusal: verifyPaperActivation returns ok:false -> startStream
 *      is never called, no success audit/SSE, non-2xx (409) response.
 *   2. Genuine startStream() throw: verifyPaperActivation returns ok:true,
 *      the mocked startStream throws -> markFailedToStream path runs, no
 *      success audit/SSE, non-2xx (503) response.
 *
 * A RED->GREEN control for case 2 is performed live in this session (not
 * committed as a mutation): temporarily commenting out the early `return;`
 * after the 409 response reproduces the exact false-success bug F-4/F-9 fixed
 * — see the worker report for the transcript. Production code here is
 * untouched; F1-F10 are frozen per AR-1342A S1/S8.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const STRAT_ID = "11111111-0000-0000-0000-000000000001";
const SESSION_ID = "22222222-0000-0000-0000-000000000001";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../middleware/idempotency.js", () => ({
  idempotencyMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const verifyPaperActivationMock = vi.fn();
vi.mock("../services/paper-qualification-activation-service.js", () => ({
  verifyPaperActivation: (...args: unknown[]) => verifyPaperActivationMock(...args),
}));

const startStreamMock = vi.fn();
vi.mock("../services/paper-trading-stream.js", () => ({
  startStream: (...args: unknown[]) => startStreamMock(...args),
  stopStream: vi.fn(),
  stopAllStreams: vi.fn(),
  getActiveStreams: vi.fn(() => new Map()),
  isStreaming: vi.fn(() => false),
  getBarBuffer: vi.fn(() => []),
  runSerializedPerSession: vi.fn((_id: string, fn: () => unknown) => fn()),
}));

vi.mock("../services/paper-execution-service.js", () => ({
  openPosition: vi.fn(),
  closePosition: vi.fn(),
  updatePositionPrices: vi.fn(),
  getExecutionQuality: vi.fn(),
  getTcaReport: vi.fn(),
  getRollingMetrics: vi.fn(),
}));
vi.mock("../services/paper-session-feedback-service.js", () => ({ computeAndPersistSessionFeedback: vi.fn() }));
vi.mock("../services/drift-detection-service.js", () => ({ detectDrift: vi.fn() }));
vi.mock("../services/correlation-service.js", () => ({ calculateCorrelation: vi.fn(), portfolioCorrelationMatrix: vi.fn() }));
vi.mock("../services/shadow-service.js", () => ({ logShadowSignal: vi.fn() }));
vi.mock("../services/paper-signal-service.js", () => ({ cleanupSession: vi.fn() }));
const notifyWarningMock = vi.fn();
vi.mock("../services/notification-service.js", () => ({ notifyWarning: (...args: unknown[]) => notifyWarningMock(...args) }));
vi.mock("../lib/notification-helpers.js", () => ({ appendFamilyGradePostscript: (msg: string) => msg }));
vi.mock("../lib/metrics-registry.js", () => ({ trackG2SilentFailuresTotal: { labels: () => ({ inc: vi.fn() }) } }));
vi.mock("../lib/paper-evidence-labels.js", () => ({ buildPaperEvidenceLabels: () => ({ feed_mode: "delayed", nominal_delay_seconds: null, claims: { certified: [], not_certified: [] } }) }));
vi.mock("../lib/paper-authority-states.js", () => ({ BROKER_AUTHORITATIVE_STATES: ["DEPLOY_READY", "PILOT", "DEPLOYED"] }));
const broadcastSSEMock = vi.fn();
vi.mock("../routes/sse.js", () => ({ broadcastSSE: (...args: unknown[]) => broadcastSSEMock(...args) }));

// ─── db mock — records every insert/update call for assertion ─────────────

const auditInserts: Array<Record<string, unknown>> = [];
const updateCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];

function resolvableChain(rows: unknown) {
  const p = Promise.resolve(rows);
  return Object.assign(Object.create(null), {
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
    returning: () => p,
  });
}

const dbMock = {
  select: vi.fn((_fields?: unknown) => ({
    from: vi.fn((_table: unknown) => ({
      where: vi.fn(() => resolvableChain([{ lifecycleState: "TESTING" }])),
    })),
  })),
  insert: vi.fn((table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      if (table && (table as { __table?: string }).__table !== "paperSessions") {
        auditInserts.push(values);
      }
      return resolvableChain(undefined);
    },
  })),
  update: vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        updateCalls.push({ table, values });
        return resolvableChain(undefined);
      },
    }),
  })),
  transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn(() => Promise.resolve(undefined)),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => resolvableChain([])), // no pre-existing active session
        })),
      })),
      insert: vi.fn(() => ({
        values: (values: Record<string, unknown>) =>
          resolvableChain([
            {
              id: SESSION_ID,
              strategyId: STRAT_ID,
              mode: values.mode ?? "paper",
              firmId: values.firmId ?? null,
              config: values.config ?? {},
              startingCapital: values.startingCapital ?? "50000",
              currentEquity: values.startingCapital ?? "50000",
              status: "active",
            },
          ]),
      })),
    };
    return cb(tx);
  }),
};
vi.mock("../db/index.js", () => ({ db: dbMock }));
vi.mock("../db/schema.js", () => {
  const T = (name: string) => ({ __table: name });
  return {
    paperSessions: T("paperSessions"),
    paperPositions: T("paperPositions"),
    paperTrades: T("paperTrades"),
    paperSignalLogs: T("paperSignalLogs"),
    paperSessionFeedback: T("paperSessionFeedback"),
    strategies: T("strategies"),
    backtests: T("backtests"),
    monteCarloRuns: T("monteCarloRuns"),
    auditLog: T("auditLog"),
  };
});

// ─── req/res helpers ────────────────────────────────────────────────────────

function mockRes() {
  const obj = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      obj.statusCode = code;
      return obj;
    },
    json(b: unknown) {
      obj.body = b;
      return obj;
    },
  };
  return obj;
}

function mockReq(body: Record<string, unknown>) {
  return {
    body,
    id: "test-corr-id",
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as any;
}

const VALID_BODY = {
  strategyId: STRAT_ID,
  startingCapital: 50000,
  config: { daily_loss_limit: 500 },
  mode: "paper",
};

async function getStartHandler() {
  const { paperRoutes } = await import("../routes/paper.js");
  const layer = (paperRoutes as any).stack.find((l: any) => {
    const route = l.route;
    return route && route.path === "/start" && route.methods.post;
  });
  if (!layer) throw new Error("Handler not found for POST /start");
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/paper/start — real route wiring (AR-1155 F-4/F-9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditInserts.length = 0;
    updateCalls.length = 0;
  });

  it("activation refusal: startStream never called, no success audit/SSE, HTTP 409", async () => {
    verifyPaperActivationMock.mockResolvedValue({ ok: false, reason: "runtime_revision_missing: test" });

    const handler = await getStartHandler();
    const req = mockReq(VALID_BODY);
    const res = mockRes();
    await handler(req, res);

    expect(verifyPaperActivationMock).toHaveBeenCalledWith(SESSION_ID, { correlationId: "test-corr-id" });
    expect(startStreamMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(409);
    expect((res.body as { error: string }).error).toBe("paper_activation_blocked");
    expect(broadcastSSEMock).not.toHaveBeenCalledWith("paper:session_start", expect.anything());
    expect(auditInserts.some((a) => a.action === "paper.session_start" && a.status === "success")).toBe(false);
    expect(updateCalls.some((u) => u.values.status === "failed_to_stream")).toBe(true);
  });

  it("real startStream() throw: markFailedToStream runs, no success audit/SSE, HTTP 503", async () => {
    verifyPaperActivationMock.mockResolvedValue({ ok: true, symbols: ["MES"], stamped: true, identity: {} });
    startStreamMock.mockImplementation(() => {
      throw new Error("simulated WS connect failure");
    });

    const handler = await getStartHandler();
    const req = mockReq(VALID_BODY);
    const res = mockRes();
    await handler(req, res);

    expect(startStreamMock).toHaveBeenCalledWith(SESSION_ID, ["MES"]);
    expect(res.statusCode).toBe(503);
    expect((res.body as { error: string }).error).toBe("paper_stream_start_failed");
    expect(broadcastSSEMock).not.toHaveBeenCalledWith("paper:session_start", expect.anything());
    expect(auditInserts.some((a) => a.action === "paper.session_start" && a.status === "success")).toBe(false);
    expect(auditInserts.some((a) => a.action === "paper.session_stream_failed")).toBe(true);
    expect(updateCalls.some((u) => u.values.status === "failed_to_stream")).toBe(true);
  });

  it("valid activation reaches the real startStream() path and returns 201 success", async () => {
    verifyPaperActivationMock.mockResolvedValue({ ok: true, symbols: ["MES", "MNQ"], stamped: true, identity: {} });
    startStreamMock.mockImplementation(() => undefined);

    const handler = await getStartHandler();
    const req = mockReq(VALID_BODY);
    const res = mockRes();
    await handler(req, res);

    expect(startStreamMock).toHaveBeenCalledWith(SESSION_ID, ["MES", "MNQ"]);
    expect(res.statusCode).toBe(201);
    expect(broadcastSSEMock).toHaveBeenCalledWith("paper:session_start", expect.objectContaining({ sessionId: SESSION_ID }));
    expect(auditInserts.some((a) => a.action === "paper.session_start" && a.status === "success")).toBe(true);
  });
});
