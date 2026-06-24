/**
 * live-order-lifecycle-gate.test.ts — F-1 (2026-06-23)
 *
 * Capital-safety gate: POST /api/live-order must verify the strategy's lifecycle
 * state BEFORE calling routeOrder(). Strategies in CANDIDATE/TESTING/PAPER/etc.
 * are NOT live-eligible; only DEPLOYED and PILOT are in LIVE_EXECUTION_STATES.
 *
 * Fail-CLOSED semantics:
 *   - Non-live-state strategy → 409 + audit live_order.rejected_non_live_state
 *   - Lifecycle lookup returns no row → reject (no routeOrder call)
 *   - Lifecycle lookup throws an error → reject (no routeOrder call)
 *
 * Pattern: real Express app + native fetch over an ephemeral port.
 * Matches the convention in w1-live-order-gateway.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createHmac } from "crypto";
import type { Server } from "http";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-live-order-hmac-secret-must-be-32-chars-long!!";
const TEST_ACCOUNT_ID = "aaaa0000-0000-0000-0000-000000000001";
const TEST_STRATEGY_ID = "bbbb0000-0000-0000-0000-000000000001";
const TEST_TICKER = "MES1!";
const TEST_ACTION = "enter_long";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  routeOrder: vi.fn(),
  submitWebhookOrder: vi.fn(),
  dbInsert: vi.fn(),
  dbExecute: vi.fn(),
  lookupHmacSecret: vi.fn(),
  // dbSelect is used by the NEW lifecycle gate to query strategies.lifecycleState.
  // It represents the .limit() call at the end of the Drizzle chain:
  //   db.select().from(strategies).where(eq(...)).limit(1)
  dbSelect: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../services/broker-router.js", () => ({
  routeOrder: mocks.routeOrder,
}));

vi.mock("../integrations/traderspost/client.js", () => ({
  submitWebhookOrder: mocks.submitWebhookOrder,
}));

vi.mock("../services/tradingview-marker-service.js", () => ({
  lookupHmacSecret: mocks.lookupHmacSecret,
}));

vi.mock("../db/index.js", () => ({
  db: {
    insert: () => ({ values: mocks.dbInsert }),
    execute: mocks.dbExecute,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.dbSelect,
        }),
      }),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: Symbol("auditLog_mock"),
  strategies: Symbol("strategies_mock"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../lib/archetype-routing-observability.js", () => ({
  emitArchetypeSignalReceived: vi.fn(),
  emitArchetypeSignalResolved: vi.fn(),
  emitArchetypeEvaluatorFailed: vi.fn(),
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: vi.fn(),
}));

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: vi.fn(),
}));

// server-mediated-executor imports db/index.js directly; mock it so
// LIVE_EXECUTION_STATES is available without a real DB connection.
vi.mock("../services/server-mediated-executor.js", () => ({
  LIVE_EXECUTION_STATES: new Set(["DEPLOYED", "PILOT"]),
}));

// ─── Lazy imports (after mocks are wired) ────────────────────────────────────

const { liveOrderRoutes } = await import("../routes/live-order.js");

// ─── Test helpers ─────────────────────────────────────────────────────────────

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/live-order", liveOrderRoutes);
  return app;
}

async function call(
  app: express.Express,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown>; server: Server }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/api/live-order`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(body),
        });
        const responseBody = await res.json() as Record<string, unknown>;
        resolve({ status: res.status, body: responseBody, server });
      } catch (err) {
        reject(err);
      }
    });
    server.on("error", reject);
  });
}

function signPayload(
  accountId: string,
  ticker: string,
  action: string,
  timestampMs: number,
  secret: string,
): string {
  const message = `${accountId}|${ticker}|${action}|${timestampMs}`;
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function makeHmacPayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const timestampMs = Date.now();
  const hmac = signPayload(TEST_ACCOUNT_ID, TEST_TICKER, TEST_ACTION, timestampMs, TEST_SECRET);
  return {
    account_id: TEST_ACCOUNT_ID,
    strategy_id: TEST_STRATEGY_ID,
    ticker: TEST_TICKER,
    action: TEST_ACTION,
    timestamp_ms: timestampMs,
    live_order_hmac: hmac,
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("F-1 — /api/live-order lifecycle gate (DEPLOYED/PILOT only)", () => {
  let server: Server | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbInsert.mockResolvedValue(undefined);
    mocks.dbExecute.mockResolvedValue({ rows: [{ id: 1 }] });
    process.env.LIVE_ORDER_HMAC_SECRET = TEST_SECRET;
    mocks.lookupHmacSecret.mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.LIVE_ORDER_HMAC_SECRET;
    if (server) {
      server.close();
      server = null;
    }
  });

  // ── F-1.1: Non-live states → 409, routeOrder NOT called ──────────────────

  it("F-1.1a: CANDIDATE strategy → 409 non_live_state, routeOrder NOT called", async () => {
    mocks.dbSelect.mockResolvedValueOnce([{ lifecycleState: "CANDIDATE" }]);

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "non_live_state" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  it("F-1.1b: TESTING strategy → 409 non_live_state, routeOrder NOT called", async () => {
    mocks.dbSelect.mockResolvedValueOnce([{ lifecycleState: "TESTING" }]);

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "non_live_state" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  it("F-1.1c: PAPER strategy → 409 non_live_state, routeOrder NOT called", async () => {
    mocks.dbSelect.mockResolvedValueOnce([{ lifecycleState: "PAPER" }]);

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "non_live_state" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  // ── F-1.2: DEPLOYED and PILOT → routeOrder IS called ─────────────────────

  it("F-1.2a: DEPLOYED strategy → routeOrder called (allowed through gate)", async () => {
    mocks.dbSelect.mockResolvedValueOnce([{ lifecycleState: "DEPLOYED" }]);
    mocks.routeOrder.mockResolvedValueOnce({
      success: true,
      reason: "routed",
      brokerType: "traderspost",
      firmId: "topstep",
      statusCode: 200,
    });

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(200);
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
  });

  it("F-1.2b: PILOT strategy → routeOrder called (allowed through gate)", async () => {
    mocks.dbSelect.mockResolvedValueOnce([{ lifecycleState: "PILOT" }]);
    mocks.routeOrder.mockResolvedValueOnce({
      success: true,
      reason: "routed",
      brokerType: "traderspost",
      firmId: "topstep",
      statusCode: 200,
    });

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(200);
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
  });

  // ── F-1.3: Fail-CLOSED — no row returned ─────────────────────────────────

  it("F-1.3: Lifecycle lookup returns no row → 409 fail-closed, routeOrder NOT called", async () => {
    mocks.dbSelect.mockResolvedValueOnce([]);

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "non_live_state" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  // ── F-1.4: Fail-CLOSED — lookup throws DB error ───────────────────────────

  it("F-1.4: Lifecycle lookup throws DB error → 409 fail-closed, routeOrder NOT called", async () => {
    mocks.dbSelect.mockRejectedValueOnce(new Error("DB connection timeout"));

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "non_live_state" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  // ── F-1.5: audit row written on rejection ─────────────────────────────────

  it("F-1.5: Rejected non-live-state writes live_order.rejected_non_live_state audit row", async () => {
    mocks.dbSelect.mockResolvedValueOnce([{ lifecycleState: "CANDIDATE" }]);

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(409);
    expect(mocks.dbInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "live_order.rejected_non_live_state" }),
    );
  });

  // ── F-1.6: No strategy_id → gate skipped (backward-compat for HMAC mode) ──

  it("F-1.6: No strategy_id in HMAC payload → gate skipped, routeOrder called", async () => {
    // No strategy_id = nothing to look up; gate must not block
    mocks.routeOrder.mockResolvedValueOnce({
      success: true,
      reason: "routed",
      brokerType: "traderspost",
      firmId: "topstep",
      statusCode: 200,
    });

    const timestampMs = Date.now();
    const hmac = signPayload(TEST_ACCOUNT_ID, TEST_TICKER, TEST_ACTION, timestampMs, TEST_SECRET);
    const app = buildApp();
    const res = await call(app, {
      account_id: TEST_ACCOUNT_ID,
      ticker: TEST_TICKER,
      action: TEST_ACTION,
      timestamp_ms: timestampMs,
      live_order_hmac: hmac,
      // strategy_id intentionally omitted
    });
    server = res.server;

    expect(res.status).toBe(200);
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
    // No DB lookup when strategy_id is absent
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });
});
