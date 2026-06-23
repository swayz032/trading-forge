/**
 * Vitest tests for server-mediated-executor.ts (Phase 0 scaffold).
 *
 * Coverage:
 *  1.  Flag OFF → routeOrder never called (no-op proof for entry)
 *  2.  Flag OFF (explicit "false") → no routeOrder
 *  3.  Flag ON + DEPLOYED → routeOrder called with enter_long signal
 *  4.  Flag ON + PILOT → routeOrder called with enter_long signal
 *  5.  Flag ON + enter_short → action = enter_short
 *  6.  SHADOW state → routeOrder NEVER called (invariant)
 *  7.  PAPER state → routeOrder never called (not_live_state)
 *  8.  TESTING state → routeOrder never called
 *  9.  routeOrder failure → fail-CLOSED: audit row with needs_reconcile, routed=false
 * 10.  routeOrder success → audit row with success status, routed=true
 * 11.  routeOrder throws unexpectedly → treated as failure (fail-CLOSED)
 * 12.  Flag OFF → routeOrder not called for TP1 partial exit
 * 13.  Flag ON + DEPLOYED → routeOrder called for TP1 (exit_long, correct qty)
 * 14.  Flag ON → routeOrder called for TP2 (exit_short for short position)
 * 15.  SHADOW on TP1 exit → never routes
 * 16.  Flag OFF → no routeOrder for BE_MOVE
 * 17.  Flag ON + DEPLOYED → routeOrder called with stopPrice for BE_MOVE
 * 18.  SHADOW on BE_MOVE → never routes
 * 19.  Flag OFF → no routeOrder on flatten
 * 20.  Flag ON + DEPLOYED → routeOrder called on flatten (exit_long)
 * 21.  Flag ON + PILOT → routeOrder called on flatten (exit_short)
 * 22.  SHADOW on flatten → never routes
 * 23.  routeOrder failure on flatten → fail-CLOSED (audit row exit_routing_failed)
 * 24.  isServerMediatedExecutionEnabled — false when not set
 * 25.  isServerMediatedExecutionEnabled — true only for exact string "true"
 * 26.  isServerMediatedExecutionEnabled — false for "TRUE"
 * 27.  isServerMediatedExecutionEnabled — false for "1"
 * 28.  LIVE_EXECUTION_STATES includes DEPLOYED and PILOT
 * 29.  LIVE_EXECUTION_STATES excludes SHADOW, PAPER, TESTING, CANDIDATE
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks — use hoistable vi.hoisted() to avoid temporal dead zone issues ────
// vitest hoists vi.mock() calls above const declarations; factory closures over
// const variables hit TDZ errors. Use vi.hoisted() to pre-declare mock fns.

const { mockRouteOrder, mockDbInsert, mockDbInsertValues } = vi.hoisted(() => {
  const mockDbInsertValues = vi.fn(() => Promise.resolve());
  const mockDbInsert = vi.fn(() => ({ values: mockDbInsertValues }));
  const mockRouteOrder = vi.fn();
  return { mockRouteOrder, mockDbInsert, mockDbInsertValues };
});

vi.mock("../db/index.js", () => ({
  db: {
    insert: mockDbInsert,
    select: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
  },
}));

// Break the sse.ts → ../index.js (bootstrap) cascade. sse.ts imports logger from
// ../index.js which triggers the full Express app + boot-migration-runner to load.
vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn(),
  PAPER_EXIT_EVENTS: {},
}));

// Break other chains that transitively load ../index.js
vi.mock("../services/alert-service.js", () => ({
  AlertFactory: { create: vi.fn() },
  sendAlert: vi.fn(),
}));

vi.mock("../lib/boot-migration-runner.js", () => ({
  runPendingMigrations: vi.fn().mockResolvedValue({ applied: 0, skipped: 0 }),
}));

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("./strategy-assignment-service.js", () => ({
  getEnabledFirms: vi.fn().mockResolvedValue([]),
}));

vi.mock("../production/kill-switch.js", () => ({
  killSwitch: vi.fn().mockResolvedValue({ halted: false }),
}));

vi.mock("../lib/credential-loader.js", () => ({
  loadBrokerCredentials: vi.fn().mockResolvedValue(null),
}));

vi.mock("../integrations/traderspost/client.js", () => ({
  submitWebhookOrder: vi.fn(),
}));

vi.mock("../integrations/traderspost/webhook-builder.js", () => ({
  buildWebhookPayload: vi.fn(),
}));

vi.mock("../lib/circuit-breaker.js", () => ({
  CircuitBreakerRegistry: {
    get: vi.fn(),
    setOnStateChange: vi.fn(),
    register: vi.fn(),
  },
  CircuitOpenError: class CircuitOpenError extends Error {},
}));

vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn(),
}));

vi.mock("../../shared/firm-config.js", () => ({
  getFirmLimit: vi.fn().mockReturnValue({ maxContracts: 50 }),
  CONTRACT_CAP_MAX: 20,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return actual;
});

// Use importOriginal to pass through real schema exports, so all named exports
// (complianceRulesets, etc.) are defined — prevents vitest named-export validation
// errors from transitive imports (compliance.ts via index.ts via sse.ts).
vi.mock("../db/schema.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/schema.js")>();
  return {
    ...actual,
    auditLog: actual.auditLog, // pass-through; Drizzle insert uses it as table handle
  };
});

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Path relative to this test file: test is in __tests__/, module is in services/
vi.mock("../services/broker-router.js", () => ({
  routeOrder: mockRouteOrder,
}));

// ─── Import AFTER all mocks are declared ──────────────────────────────────────

import {
  routeLiveEntry,
  routeLiveExitPartial,
  routeLiveExitModify,
  routeLiveFlatten,
  isServerMediatedExecutionEnabled,
  LIVE_EXECUTION_STATES,
} from "../services/server-mediated-executor.js";

// ─── Helper builders ──────────────────────────────────────────────────────────

function makeLiveContext(overrides: Partial<{
  accountId: string;
  lifecycleState: string;
  sessionId: string;
  strategyId: string;
  correlationId: string | null;
}> = {}) {
  return {
    accountId: "acct-001",
    lifecycleState: "DEPLOYED",
    sessionId: "sess-001",
    strategyId: "strat-001",
    correlationId: "corr-001",
    ...overrides,
  };
}

function makeSuccessBrokerResult() {
  return {
    success: true,
    reason: "routed" as const,
    accountId: "acct-001",
    brokerType: "traderspost",
    statusCode: 200,
  };
}

function makeFailBrokerResult() {
  return {
    success: false,
    reason: "traderspost_circuit_open" as const,
    accountId: "acct-001",
    error: "circuit open",
  };
}

// ─── Lifecycle management ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.SERVER_MEDIATED_EXECUTION_ENABLED;
});

// ─── Test block 1: routeLiveEntry — flag OFF ──────────────────────────────────

describe("routeLiveEntry — flag OFF (no-op proof)", () => {
  it("1. should NOT call routeOrder when flag env var is absent", async () => {
    delete process.env.SERVER_MEDIATED_EXECUTION_ENABLED;
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveEntry({ ctx, symbol: "MES", side: "long", quantity: 6 });
    expect(mockRouteOrder).not.toHaveBeenCalled();
    expect(result.routed).toBe(false);
    expect(result.reason).toBe("flag_disabled");
  });

  it("2. should NOT call routeOrder when flag is explicitly 'false'", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "false";
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveEntry({ ctx, symbol: "MNQ", side: "short", quantity: 1 });
    expect(mockRouteOrder).not.toHaveBeenCalled();
    expect(result.routed).toBe(false);
  });
});

// ─── Test block 2: routeLiveEntry — flag ON + LIVE states ────────────────────

describe("routeLiveEntry — flag ON + LIVE states", () => {
  beforeEach(() => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    mockRouteOrder.mockResolvedValue(makeSuccessBrokerResult());
  });

  it("3. should call routeOrder for DEPLOYED with enter_long", async () => {
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveEntry({ ctx, symbol: "MES", side: "long", quantity: 6 });
    expect(mockRouteOrder).toHaveBeenCalledOnce();
    const [accountId, signal] = mockRouteOrder.mock.calls[0] as [string, { action: string; ticker: string; quantity: number }];
    expect(accountId).toBe("acct-001");
    expect(signal.action).toBe("enter_long");
    expect(signal.ticker).toBe("MES");
    expect(signal.quantity).toBe(6);
    expect(result.routed).toBe(true);
  });

  it("4. should call routeOrder for PILOT with enter_long", async () => {
    const ctx = makeLiveContext({ lifecycleState: "PILOT" });
    const result = await routeLiveEntry({ ctx, symbol: "MNQ", side: "long", quantity: 1 });
    expect(mockRouteOrder).toHaveBeenCalledOnce();
    const [, signal] = mockRouteOrder.mock.calls[0] as [string, { action: string; ticker: string }];
    expect(signal.action).toBe("enter_long");
    expect(signal.ticker).toBe("MNQ");
    expect(result.routed).toBe(true);
  });

  it("5. should use enter_short for short side", async () => {
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    await routeLiveEntry({ ctx, symbol: "MES", side: "short", quantity: 3 });
    const [, signal] = mockRouteOrder.mock.calls[0] as [string, { action: string }];
    expect(signal.action).toBe("enter_short");
  });
});

// ─── Test block 3: routeLiveEntry — SHADOW invariant ─────────────────────────

describe("routeLiveEntry — SHADOW + non-live state guards", () => {
  beforeEach(() => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
  });

  it("6. should NEVER call routeOrder for SHADOW state", async () => {
    const ctx = makeLiveContext({ lifecycleState: "SHADOW" });
    const result = await routeLiveEntry({ ctx, symbol: "MES", side: "long", quantity: 6 });
    expect(mockRouteOrder).not.toHaveBeenCalled();
    expect(result.routed).toBe(false);
    expect(result.reason).toBe("shadow_state_blocked");
  });

  it("7. should NOT call routeOrder for PAPER state", async () => {
    const ctx = makeLiveContext({ lifecycleState: "PAPER" });
    const result = await routeLiveEntry({ ctx, symbol: "MES", side: "long", quantity: 6 });
    expect(mockRouteOrder).not.toHaveBeenCalled();
    expect(result.routed).toBe(false);
    expect(result.reason).toBe("not_live_state");
  });

  it("8. should NOT call routeOrder for TESTING state", async () => {
    const ctx = makeLiveContext({ lifecycleState: "TESTING" });
    const result = await routeLiveEntry({ ctx, symbol: "MES", side: "long", quantity: 6 });
    expect(mockRouteOrder).not.toHaveBeenCalled();
    expect(result.routed).toBe(false);
  });
});

// ─── Test block 4: routeLiveEntry — fail-CLOSED on routeOrder failure ─────────

describe("routeLiveEntry — fail-CLOSED", () => {
  beforeEach(() => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
  });

  it("9. should write needs_reconcile audit row and return routed=false when routeOrder fails", async () => {
    mockRouteOrder.mockResolvedValue(makeFailBrokerResult());
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveEntry({ ctx, symbol: "MES", side: "long", quantity: 6 });
    expect(mockRouteOrder).toHaveBeenCalledOnce();
    expect(result.routed).toBe(false);
    expect(result.needsReconcile).toBe(true);
    expect(mockDbInsert).toHaveBeenCalled();
    const insertArg = mockDbInsertValues.mock.calls[0]?.[0] as { action: string; status: string };
    expect(insertArg.action).toBe("server_mediated.order_routing_failed");
    expect(insertArg.status).toBe("needs_reconcile");
  });

  it("10. should write success audit row and return routed=true on routeOrder success", async () => {
    mockRouteOrder.mockResolvedValue(makeSuccessBrokerResult());
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveEntry({ ctx, symbol: "MES", side: "long", quantity: 6 });
    expect(result.routed).toBe(true);
    expect(result.needsReconcile).toBe(false);
    const insertArg = mockDbInsertValues.mock.calls[0]?.[0] as { action: string; status: string };
    expect(insertArg.action).toBe("server_mediated.order_routed");
    expect(insertArg.status).toBe("success");
  });

  it("11. should fail-CLOSED and write audit row when routeOrder throws unexpectedly", async () => {
    mockRouteOrder.mockRejectedValue(new Error("unexpected network error"));
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveEntry({ ctx, symbol: "MES", side: "long", quantity: 6 });
    expect(result.routed).toBe(false);
    expect(result.needsReconcile).toBe(true);
    expect(mockDbInsert).toHaveBeenCalled();
    const insertArg = mockDbInsertValues.mock.calls[0]?.[0] as { action: string; status: string };
    expect(insertArg.action).toBe("server_mediated.order_routing_failed");
    expect(insertArg.status).toBe("needs_reconcile");
  });
});

// ─── Test block 5: routeLiveExitPartial — TP1 + TP2 ─────────────────────────

describe("routeLiveExitPartial — TP1/TP2", () => {
  it("12. should NOT call routeOrder when flag OFF (TP1)", async () => {
    delete process.env.SERVER_MEDIATED_EXECUTION_ENABLED;
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveExitPartial({
      ctx, symbol: "MES", side: "long", quantity: 2, exitType: "TP1",
    });
    expect(mockRouteOrder).not.toHaveBeenCalled();
    expect(result.routed).toBe(false);
  });

  it("13. should call routeOrder with exit_long for TP1 when flag ON + DEPLOYED", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    mockRouteOrder.mockResolvedValue(makeSuccessBrokerResult());
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveExitPartial({
      ctx, symbol: "MES", side: "long", quantity: 2, exitType: "TP1",
    });
    expect(mockRouteOrder).toHaveBeenCalledOnce();
    const [accountId, signal] = mockRouteOrder.mock.calls[0] as [string, { action: string; quantity: number }];
    expect(accountId).toBe("acct-001");
    expect(signal.action).toBe("exit_long");
    expect(signal.quantity).toBe(2);
    expect(result.routed).toBe(true);
  });

  it("14. should call routeOrder with exit_short for TP2 on short position", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    mockRouteOrder.mockResolvedValue(makeSuccessBrokerResult());
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    await routeLiveExitPartial({
      ctx, symbol: "MNQ", side: "short", quantity: 1, exitType: "TP2",
    });
    const [, signal] = mockRouteOrder.mock.calls[0] as [string, { action: string }];
    expect(signal.action).toBe("exit_short");
  });

  it("15. should NOT call routeOrder for SHADOW state on TP1 exit", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    const ctx = makeLiveContext({ lifecycleState: "SHADOW" });
    const result = await routeLiveExitPartial({
      ctx, symbol: "MES", side: "long", quantity: 2, exitType: "TP1",
    });
    expect(mockRouteOrder).not.toHaveBeenCalled();
    expect(result.reason).toBe("shadow_state_blocked");
  });
});

// ─── Test block 6: routeLiveExitModify — BE_MOVE + TRAIL ─────────────────────

describe("routeLiveExitModify — BE_MOVE + TRAIL", () => {
  it("16. should NOT call routeOrder when flag OFF (BE_MOVE)", async () => {
    delete process.env.SERVER_MEDIATED_EXECUTION_ENABLED;
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveExitModify({
      ctx, symbol: "MES", side: "long", newStopPrice: 4490, modifyType: "BE_MOVE",
    });
    expect(mockRouteOrder).not.toHaveBeenCalled();
    expect(result.routed).toBe(false);
  });

  it("17. should call routeOrder with stopPrice when flag ON + DEPLOYED + BE_MOVE", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    mockRouteOrder.mockResolvedValue(makeSuccessBrokerResult());
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveExitModify({
      ctx, symbol: "MES", side: "long", newStopPrice: 4490, modifyType: "BE_MOVE",
    });
    expect(mockRouteOrder).toHaveBeenCalledOnce();
    const [, signal] = mockRouteOrder.mock.calls[0] as [string, { stopPrice: number; orderType: string }];
    expect(signal.stopPrice).toBe(4490);
    expect(signal.orderType).toBe("stop");
    expect(result.routed).toBe(true);
  });

  it("18. should NOT call routeOrder for SHADOW state on BE_MOVE", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    const ctx = makeLiveContext({ lifecycleState: "SHADOW" });
    const result = await routeLiveExitModify({
      ctx, symbol: "MES", side: "long", newStopPrice: 4490, modifyType: "TRAIL",
    });
    expect(mockRouteOrder).not.toHaveBeenCalled();
    expect(result.reason).toBe("shadow_state_blocked");
  });
});

// ─── Test block 7: routeLiveFlatten — time-stop + force-close ─────────────────

describe("routeLiveFlatten — time-stop + force-close", () => {
  it("19. should NOT call routeOrder when flag OFF", async () => {
    delete process.env.SERVER_MEDIATED_EXECUTION_ENABLED;
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveFlatten({
      ctx, symbol: "MES", side: "long", quantity: 4, flattenReason: "TIME_STOP_1555",
    });
    expect(mockRouteOrder).not.toHaveBeenCalled();
    expect(result.routed).toBe(false);
  });

  it("20. should call routeOrder with exit_long for DEPLOYED on flatten", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    mockRouteOrder.mockResolvedValue(makeSuccessBrokerResult());
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveFlatten({
      ctx, symbol: "MES", side: "long", quantity: 4, flattenReason: "TIME_STOP_1555",
    });
    expect(mockRouteOrder).toHaveBeenCalledOnce();
    const [, signal] = mockRouteOrder.mock.calls[0] as [string, { action: string; quantity: number }];
    expect(signal.action).toBe("exit_long");
    expect(signal.quantity).toBe(4);
    expect(result.routed).toBe(true);
  });

  it("21. should call routeOrder with exit_short for PILOT on flatten", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    mockRouteOrder.mockResolvedValue(makeSuccessBrokerResult());
    const ctx = makeLiveContext({ lifecycleState: "PILOT" });
    const result = await routeLiveFlatten({
      ctx, symbol: "MES", side: "short", quantity: 1, flattenReason: "TIME_STOP_1555",
    });
    expect(mockRouteOrder).toHaveBeenCalledOnce();
    const [, signal] = mockRouteOrder.mock.calls[0] as [string, { action: string }];
    expect(signal.action).toBe("exit_short");
    expect(result.routed).toBe(true);
  });

  it("22. should NOT call routeOrder for SHADOW state on flatten", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    const ctx = makeLiveContext({ lifecycleState: "SHADOW" });
    const result = await routeLiveFlatten({
      ctx, symbol: "MES", side: "long", quantity: 4, flattenReason: "TIME_STOP_1555",
    });
    expect(mockRouteOrder).not.toHaveBeenCalled();
    expect(result.reason).toBe("shadow_state_blocked");
  });

  it("23. should fail-CLOSED and write exit_routing_failed audit row when routeOrder fails on flatten", async () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    mockRouteOrder.mockResolvedValue(makeFailBrokerResult());
    const ctx = makeLiveContext({ lifecycleState: "DEPLOYED" });
    const result = await routeLiveFlatten({
      ctx, symbol: "MES", side: "long", quantity: 4, flattenReason: "TIME_STOP_1555",
    });
    expect(result.routed).toBe(false);
    expect(result.needsReconcile).toBe(true);
    expect(mockDbInsert).toHaveBeenCalled();
    const insertArg = mockDbInsertValues.mock.calls[0]?.[0] as { action: string; status: string };
    expect(insertArg.action).toBe("server_mediated.exit_routing_failed");
    expect(insertArg.status).toBe("needs_reconcile");
  });
});

// ─── Test block 8: isServerMediatedExecutionEnabled ──────────────────────────

describe("isServerMediatedExecutionEnabled", () => {
  it("24. returns false when env var not set", () => {
    delete process.env.SERVER_MEDIATED_EXECUTION_ENABLED;
    expect(isServerMediatedExecutionEnabled()).toBe(false);
  });

  it("25. returns true only for exact string 'true'", () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "true";
    expect(isServerMediatedExecutionEnabled()).toBe(true);
  });

  it("26. returns false for 'TRUE' (case sensitive)", () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "TRUE";
    expect(isServerMediatedExecutionEnabled()).toBe(false);
  });

  it("27. returns false for '1'", () => {
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED = "1";
    expect(isServerMediatedExecutionEnabled()).toBe(false);
  });
});

// ─── Test block 9: LIVE_EXECUTION_STATES ─────────────────────────────────────

describe("LIVE_EXECUTION_STATES", () => {
  it("28. includes DEPLOYED and PILOT", () => {
    expect(LIVE_EXECUTION_STATES.has("DEPLOYED")).toBe(true);
    expect(LIVE_EXECUTION_STATES.has("PILOT")).toBe(true);
  });

  it("29. does NOT include SHADOW, PAPER, TESTING, CANDIDATE", () => {
    expect(LIVE_EXECUTION_STATES.has("SHADOW")).toBe(false);
    expect(LIVE_EXECUTION_STATES.has("PAPER")).toBe(false);
    expect(LIVE_EXECUTION_STATES.has("TESTING")).toBe(false);
    expect(LIVE_EXECUTION_STATES.has("CANDIDATE")).toBe(false);
  });
});
