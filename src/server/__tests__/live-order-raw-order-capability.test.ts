/**
 * live-order-raw-order-capability.test.ts — F-2 (2026-06-29)
 *
 * Sunsets the strategy_id-omission exemption. A POST /api/live-order must carry
 * EITHER a strategy_id (subject to the F-1 lifecycle gate) OR an explicit
 * raw_order:true capability acknowledgement. Neither → 409 missing_lifecycle_context.
 *
 * Cases:
 *   1. No strategy_id AND no raw_order → 409 missing_lifecycle_context +
 *      audit live_order.rejected_missing_lifecycle_context (status "rejected");
 *      routeOrder NOT called.
 *   2. raw_order:true (no strategy_id) → proceeds to routeOrder() +
 *      audit live_order.raw_order_accepted (status "accepted").
 *   3. Valid strategy_id in a non-LIVE state → 409 non_live_state (F-1 unchanged);
 *      routeOrder NOT called.
 *
 * Pattern: real Express app + native fetch over an ephemeral port.
 * Matches the convention in live-order-lifecycle-gate.test.ts.
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
): Promise<{ status: number; body: Record<string, unknown>; server: Server }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/api/live-order`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const responseBody = (await res.json()) as Record<string, unknown>;
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

/** Valid HMAC-authenticated payload; overrides control strategy_id / raw_order. */
function makeHmacPayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const timestampMs = Date.now();
  const hmac = signPayload(TEST_ACCOUNT_ID, TEST_TICKER, TEST_ACTION, timestampMs, TEST_SECRET);
  return {
    account_id: TEST_ACCOUNT_ID,
    ticker: TEST_TICKER,
    action: TEST_ACTION,
    timestamp_ms: timestampMs,
    live_order_hmac: hmac,
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("F-2 — /api/live-order requires strategy_id OR explicit raw_order", () => {
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

  // ── F-2.1: neither strategy_id nor raw_order → 409 + audit, no routeOrder ──

  it("F-2.1: no strategy_id and no raw_order → 409 missing_lifecycle_context, routeOrder NOT called", async () => {
    const app = buildApp();
    // No strategy_id, no raw_order
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "missing_lifecycle_context" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
    // Lifecycle DB lookup is NOT performed when strategy_id is absent
    expect(mocks.dbSelect).not.toHaveBeenCalled();
    // Awaited audit row written with status "rejected"
    expect(mocks.dbInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "live_order.rejected_missing_lifecycle_context",
        status: "rejected",
      }),
    );
  });

  // ── F-2.2: raw_order:true (no strategy_id) → proceeds + accepted audit ─────

  it("F-2.2: raw_order:true with no strategy_id → routeOrder called + raw_order_accepted audit", async () => {
    mocks.routeOrder.mockResolvedValueOnce({
      success: true,
      reason: "routed",
      brokerType: "traderspost",
      firmId: "topstep",
      statusCode: 200,
    });

    const app = buildApp();
    const res = await call(app, makeHmacPayload({ raw_order: true }));
    server = res.server;

    expect(res.status).toBe(200);
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
    // No lifecycle lookup on the raw-order path
    expect(mocks.dbSelect).not.toHaveBeenCalled();
    // Awaited audit row written with status "accepted" (raw orders are traceable)
    expect(mocks.dbInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "live_order.raw_order_accepted",
        status: "accepted",
      }),
    );
  });

  // ── F-2.3: strategy_id in non-LIVE state still → 409 non_live_state (F-1) ──

  it("F-2.3: strategy_id in CANDIDATE state → 409 non_live_state (F-1 gate unchanged), routeOrder NOT called", async () => {
    mocks.dbSelect.mockResolvedValueOnce([{ lifecycleState: "CANDIDATE" }]);

    const app = buildApp();
    const res = await call(app, makeHmacPayload({ strategy_id: TEST_STRATEGY_ID }));
    server = res.server;

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "non_live_state" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
    expect(mocks.dbInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "live_order.rejected_non_live_state" }),
    );
  });

  // ── F-2.4: raw_order:false is NOT an opt-in → 409 (must be explicit true) ──

  it("F-2.4: raw_order:false with no strategy_id → 409 missing_lifecycle_context", async () => {
    const app = buildApp();
    const res = await call(app, makeHmacPayload({ raw_order: false }));
    server = res.server;

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "missing_lifecycle_context" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });
});
