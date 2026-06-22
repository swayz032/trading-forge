/**
 * w1-live-order-gateway.test.ts — Workstream W1 CORE
 *
 * Make-or-break tests for the TF Order Gateway (POST /api/live-order).
 *
 * Three mandatory coverage items:
 *  1. HALT blocks live fill: kill-switch in HALT → POST valid-HMAC alert →
 *     response 423 blocked, submitWebhookOrder NEVER called, audit row written.
 *  2. Happy path: no halt → routeOrder runs → forwards once.
 *  3. Bad HMAC → 401, routeOrder never called.
 *
 * Pattern: real Express app + native fetch over an ephemeral port.
 * No supertest dependency — matches codebase convention documented in
 * prop-firm-route-survival.test.ts and quantum-pre-flight.test.ts.
 *
 * These tests confirm routeOrder() now has a real production caller.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createHmac } from "crypto";
import type { Server } from "http";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-live-order-hmac-secret-must-be-32-chars-long!!";
const TEST_ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const TEST_TICKER = "MES1!";
const TEST_ACTION = "enter_long";

// ─── Hoisted mock state ───────────────────────────────────────────────────────
// vi.hoisted() is guaranteed to run before any module imports.

const mocks = vi.hoisted(() => ({
  routeOrder: vi.fn(),
  submitWebhookOrder: vi.fn(),
  dbInsert: vi.fn(),
}));

// ─── Module mocks (hoisted by vitest, executed before imports) ────────────────

vi.mock("../services/broker-router.js", () => ({
  routeOrder: mocks.routeOrder,
}));

vi.mock("../integrations/traderspost/client.js", () => ({
  submitWebhookOrder: mocks.submitWebhookOrder,
}));

// db mock: capture insert().values() calls without touching a real DB.
vi.mock("../db/index.js", () => ({
  db: {
    insert: () => ({ values: mocks.dbInsert }),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: Symbol("auditLog_mock"),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Lazy route import (after mocks are wired) ────────────────────────────────

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

function makePayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
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

describe("POST /api/live-order — W1 CORE gateway", () => {
  let server: Server | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbInsert.mockResolvedValue(undefined);
    process.env.LIVE_ORDER_HMAC_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.LIVE_ORDER_HMAC_SECRET;
    if (server) {
      server.close();
      server = null;
    }
  });

  // ── Test 1: HALT blocks live fill ─────────────────────────────────────────

  it("HALT state → 423 blocked, submitWebhookOrder never called, audit row written", async () => {
    // routeOrder returns a production_halt result (kill-switch FIRST gate fired).
    mocks.routeOrder.mockResolvedValueOnce({
      success: false,
      reason: "production_halt",
      accountId: TEST_ACCOUNT_ID,
      error: "killswitch_halt",
    });

    const app = buildApp();
    const res = await call(app, makePayload());
    server = res.server;

    // Response must be 423 (unavailable due to policy — HALT).
    expect(res.status).toBe(423);
    expect(res.body).toMatchObject({
      blocked: true,
      reason: "production_halt",
    });

    // routeOrder IS called — this is the W1 CORE invariant:
    // routeOrder now has a real production caller via this gateway.
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
    expect(mocks.routeOrder).toHaveBeenCalledWith(
      TEST_ACCOUNT_ID,
      expect.objectContaining({ ticker: TEST_TICKER, action: TEST_ACTION }),
      expect.any(String),   // correlationId
      expect.any(Number),   // timestamp_ms passed as webhookFiredAt
    );

    // submitWebhookOrder MUST NOT be called.
    // routeOrder's mock returned halt before reaching the broker dispatch path.
    // The gateway itself never calls submitWebhookOrder — no double-forward.
    expect(mocks.submitWebhookOrder).not.toHaveBeenCalled();

    // Audit row must be written with the blocked action name.
    expect(mocks.dbInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "live_order.blocked_production_halt",
        status: "blocked",
      }),
    );
  });

  // ── Test 2: Happy path — no halt → forwards once ──────────────────────────

  it("No halt → routeOrder runs → 200 forwarded", async () => {
    mocks.routeOrder.mockResolvedValueOnce({
      success: true,
      reason: "routed",
      accountId: TEST_ACCOUNT_ID,
      brokerType: "traderspost",
      firmId: "topstep",
      statusCode: 200,
    });

    const app = buildApp();
    const res = await call(app, makePayload());
    server = res.server;

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      forwarded: true,
      reason: "routed",
      brokerType: "traderspost",
    });

    // routeOrder is the production caller — called exactly once.
    expect(mocks.routeOrder).toHaveBeenCalledOnce();

    // submitWebhookOrder is called by routeOrder internally, not by this gateway.
    // Since routeOrder is mocked, submitWebhookOrder is never invoked here —
    // confirming the gateway does NOT double-forward.
    expect(mocks.submitWebhookOrder).not.toHaveBeenCalled();
  });

  // ── Test 3: Bad HMAC → 401, routeOrder never called ──────────────────────

  it("Bad HMAC → 401, routeOrder never called", async () => {
    const badHmac = "badhex" + "0".repeat(58); // wrong length and content
    const app = buildApp();
    const res = await call(app, makePayload({ live_order_hmac: badHmac }));
    server = res.server;

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "hmac_invalid" });

    // routeOrder must not be reached when HMAC fails.
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  // ── Test 4: Missing HMAC secret → 503 ────────────────────────────────────

  it("Missing LIVE_ORDER_HMAC_SECRET → 503 gateway_not_configured", async () => {
    delete process.env.LIVE_ORDER_HMAC_SECRET;

    const app = buildApp();
    const res = await call(app, makePayload());
    server = res.server;

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "gateway_not_configured" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  // ── Test 5: Stale timestamp → 401 stale_payload ─────────────────────────

  it("Stale timestamp (>2 min ago) → 401 stale_payload, routeOrder never called", async () => {
    const staleMs = Date.now() - 3 * 60 * 1000; // 3 minutes ago
    const staleHmac = signPayload(TEST_ACCOUNT_ID, TEST_TICKER, TEST_ACTION, staleMs, TEST_SECRET);

    const app = buildApp();
    const res = await call(app, makePayload({ timestamp_ms: staleMs, live_order_hmac: staleHmac }));
    server = res.server;

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "stale_payload" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  // ── Test 6: Invalid payload → 400 ────────────────────────────────────────

  it("Invalid payload (missing required fields) → 400 invalid_payload", async () => {
    const app = buildApp();
    const res = await call(app, { ticker: "MES1!" }); // missing required fields
    server = res.server;

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_payload" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  // ── Test 7: Compliance block → 403 ───────────────────────────────────────

  it("Compliance violation from routeOrder → 403 blocked", async () => {
    mocks.routeOrder.mockResolvedValueOnce({
      success: false,
      reason: "compliance_violation",
      accountId: TEST_ACCOUNT_ID,
      firmId: "mffu",
      error: "MFFU 2% rule violation",
    });

    const app = buildApp();
    const res = await call(app, makePayload());
    server = res.server;

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      blocked: true,
      reason: "compliance_violation",
    });
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
    expect(mocks.submitWebhookOrder).not.toHaveBeenCalled();
  });

  // ── Test 8: routeOrder is the production caller (import + call assertion) ──

  it("routeOrder is imported and called from the gateway (W1 production caller proof)", async () => {
    // This test documents and asserts the W1 CORE invariant:
    // routeOrder now has a real production caller via the live-order gateway.
    mocks.routeOrder.mockResolvedValueOnce({
      success: true,
      reason: "routed",
      accountId: TEST_ACCOUNT_ID,
    });

    const app = buildApp();
    const res = await call(app, makePayload());
    server = res.server;

    // routeOrder was called → the gateway imports and invokes it.
    // Without this wiring, routeOrder would have zero production callers.
    expect(mocks.routeOrder).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});
