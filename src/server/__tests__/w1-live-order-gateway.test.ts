/**
 * w1-live-order-gateway.test.ts — Workstream W1 CORE + W1 Follow-Up (Pine Static-Token)
 *
 * Coverage:
 *  HMAC mode (original W1 core):
 *    1. HALT blocks live fill: routeOrder → 423, submitWebhookOrder never called
 *    2. Happy path: valid HMAC → 200 forwarded
 *    3. Bad HMAC → 401, routeOrder never called
 *    4. Missing LIVE_ORDER_HMAC_SECRET → 503
 *    5. Stale timestamp → 401 stale_payload
 *    6. Invalid payload → 400
 *    7. Compliance block → 403
 *    8. routeOrder is the production caller (W1 core invariant)
 *
 *  Static-token mode (W1 follow-up — Pine cannot compute HMAC):
 *    9.  Valid static token (in body) → 200 forwarded, routeOrder called once
 *    10. Valid static token (in Authorization: Bearer header) → 200 forwarded
 *    11. Bad static token → 401 token_invalid, routeOrder never called
 *    12. Missing strategy_id with static token → 400
 *    13. Static token with stale timestamp → 401 stale_payload
 *    14. Duplicate bar_timestamp (same bar_timestamp+action) → 409
 *    15. HALT still blocks in static-token mode → 423
 *    16. No auth at all (neither hmac nor token) → 401 no_auth_credential
 *
 *  Round-trip:
 *    17. Token embedded by buildPineAlertTemplate round-trips to gateway acceptance
 *
 *  Pine export:
 *    18. buildPineAlertTemplate with gatewayOptions emits TF gateway URL payload
 *    19. buildPineAlertTemplate without gatewayOptions emits TradersPost payload (unchanged)
 *
 * Pattern: real Express app + native fetch over an ephemeral port.
 * No supertest — matches codebase convention in prop-firm-route-survival.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createHmac } from "crypto";
import type { Server } from "http";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-live-order-hmac-secret-must-be-32-chars-long!!";
const TEST_ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const TEST_STRATEGY_ID = "22222222-2222-2222-2222-222222222222";
const TEST_TICKER = "MES1!";
const TEST_ACTION = "enter_long";
// Static token: reuses hmac_secret from account_strategy_assignments
const TEST_STATIC_TOKEN = "static-pine-token-per-account-strategy-at-least-32c";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  routeOrder: vi.fn(),
  submitWebhookOrder: vi.fn(),
  dbInsert: vi.fn(),
  // deep-scan execution F-1: rows the F-1 lifecycle gate's select returns. Default DEPLOYED (live-eligible);
  // override to e.g. [{ lifecycleState: "CANDIDATE" }] or [] to exercise the 409 non_live_state path.
  dbSelectRows: [{ lifecycleState: "DEPLOYED" }] as Array<{ lifecycleState: string }>,
  // lookupHmacSecret returns the stored per-(account,strategy) secret for token mode.
  lookupHmacSecret: vi.fn(),
  // dbExecute handles the dedup INSERT ON CONFLICT DO NOTHING.
  dbExecute: vi.fn(),
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
    // deep-scan execution F-1 (2026-07-06): the live-order F-1 lifecycle gate (live-order.ts:552-560) does
    // db.select({...}).from(strategies).where(...).limit(1). The old mock stubbed only insert/execute, so this
    // select threw → the gate's own fail-closed catch returned 409 for EVERY static-token test (strategy_id
    // required in that mode) — silently masking the actual Pine→broker forward path AND the HALT→423 path.
    // Default to DEPLOYED so tests exercise the REAL path; per-test override via mocks.dbSelectRows.
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(mocks.dbSelectRows) }) }),
    }),
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: Symbol("auditLog_mock"),
  strategies: { id: Symbol("strategies_id"), lifecycleState: Symbol("strategies_lifecycleState") },
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Lazy imports (after mocks are wired) ────────────────────────────────────

const { liveOrderRoutes } = await import("../routes/live-order.js");
const { buildPineAlertTemplate } = await import("../integrations/traderspost/webhook-builder.js");

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

/** Build a valid HMAC-mode payload */
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

/** Build a valid static-token-mode payload (Pine path) */
function makeTokenPayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const timestampMs = Date.now();
  return {
    account_id: TEST_ACCOUNT_ID,
    strategy_id: TEST_STRATEGY_ID,
    ticker: TEST_TICKER,
    action: TEST_ACTION,
    timestamp_ms: timestampMs,
    bar_timestamp: new Date(timestampMs).toISOString(),
    live_order_token: TEST_STATIC_TOKEN,
    ...overrides,
  };
}

/** Dedup INSERT result: first insert (not a dup) — returns one row */
function dedupFirstInsert() {
  mocks.dbExecute.mockResolvedValueOnce({ rows: [{ id: 1 }] });
}

/** Dedup INSERT result: conflict (dup) — ON CONFLICT DO NOTHING, empty rows */
function dedupDuplicate() {
  mocks.dbExecute.mockResolvedValueOnce({ rows: [] });
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("POST /api/live-order — W1 CORE + Pine static-token", () => {
  let server: Server | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbInsert.mockResolvedValue(undefined);
    process.env.LIVE_ORDER_HMAC_SECRET = TEST_SECRET;
    // Default: lookupHmacSecret returns the test static token
    mocks.lookupHmacSecret.mockResolvedValue(TEST_STATIC_TOKEN);
    // Default: dedup INSERT is first (not a dup)
    mocks.dbExecute.mockResolvedValue({ rows: [{ id: 1 }] });
  });

  afterEach(() => {
    delete process.env.LIVE_ORDER_HMAC_SECRET;
    delete process.env.LIVE_ORDER_GATEWAY_URL;
    if (server) {
      server.close();
      server = null;
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HMAC MODE — original W1 core tests
  // ═══════════════════════════════════════════════════════════════════════════

  it("Test 1: HALT → 423 blocked, submitWebhookOrder never called, audit row written", async () => {
    mocks.routeOrder.mockResolvedValueOnce({
      success: false,
      reason: "production_halt",
      accountId: TEST_ACCOUNT_ID,
      error: "killswitch_halt",
    });

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(423);
    expect(res.body).toMatchObject({ blocked: true, reason: "production_halt" });

    expect(mocks.routeOrder).toHaveBeenCalledOnce();
    expect(mocks.routeOrder).toHaveBeenCalledWith(
      TEST_ACCOUNT_ID,
      expect.objectContaining({ ticker: TEST_TICKER, action: TEST_ACTION }),
      expect.any(String),
      expect.any(Number),
    );
    expect(mocks.submitWebhookOrder).not.toHaveBeenCalled();
    expect(mocks.dbInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "live_order.blocked_production_halt", status: "blocked" }),
    );
  });

  it("Test 2: No halt (HMAC mode) → routeOrder runs → 200 forwarded", async () => {
    mocks.routeOrder.mockResolvedValueOnce({
      success: true,
      reason: "routed",
      accountId: TEST_ACCOUNT_ID,
      brokerType: "traderspost",
      firmId: "topstep",
      statusCode: 200,
    });

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ forwarded: true, reason: "routed", brokerType: "traderspost" });
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
    expect(mocks.submitWebhookOrder).not.toHaveBeenCalled();
  });

  it("Test 3: Bad HMAC → 401, routeOrder never called", async () => {
    const badHmac = "badhex" + "0".repeat(58);
    const app = buildApp();
    const res = await call(app, makeHmacPayload({ live_order_hmac: badHmac }));
    server = res.server;

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "hmac_invalid" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  it("Test 4: Missing LIVE_ORDER_HMAC_SECRET → 503 gateway_not_configured", async () => {
    delete process.env.LIVE_ORDER_HMAC_SECRET;

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: "gateway_not_configured" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  it("Test 5: Stale timestamp (>2 min ago, HMAC mode) → 401 stale_payload", async () => {
    const staleMs = Date.now() - 3 * 60 * 1000;
    const staleHmac = signPayload(TEST_ACCOUNT_ID, TEST_TICKER, TEST_ACTION, staleMs, TEST_SECRET);

    const app = buildApp();
    const res = await call(app, makeHmacPayload({ timestamp_ms: staleMs, live_order_hmac: staleHmac }));
    server = res.server;

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "stale_payload" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  it("Test 6: Invalid payload (missing required fields) → 400", async () => {
    const app = buildApp();
    const res = await call(app, { ticker: "MES1!" });
    server = res.server;

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_payload" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  it("Test 7: Compliance violation → 403 blocked", async () => {
    mocks.routeOrder.mockResolvedValueOnce({
      success: false,
      reason: "compliance_violation",
      accountId: TEST_ACCOUNT_ID,
      firmId: "mffu",
      error: "MFFU 2% rule violation",
    });

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ blocked: true, reason: "compliance_violation" });
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
    expect(mocks.submitWebhookOrder).not.toHaveBeenCalled();
  });

  it("Test 8: routeOrder is imported and called (W1 production caller proof)", async () => {
    mocks.routeOrder.mockResolvedValueOnce({ success: true, reason: "routed", accountId: TEST_ACCOUNT_ID });

    const app = buildApp();
    const res = await call(app, makeHmacPayload());
    server = res.server;

    expect(mocks.routeOrder).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STATIC-TOKEN MODE — W1 follow-up (Pine cannot compute HMAC)
  // ═══════════════════════════════════════════════════════════════════════════

  it("Test 9: Valid static token (body field) → 200 forwarded, routeOrder called once", async () => {
    dedupFirstInsert();
    mocks.routeOrder.mockResolvedValueOnce({
      success: true,
      reason: "routed",
      accountId: TEST_ACCOUNT_ID,
      brokerType: "traderspost",
      firmId: "topstep",
      statusCode: 200,
    });

    const app = buildApp();
    const res = await call(app, makeTokenPayload());
    server = res.server;

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ forwarded: true, reason: "routed" });
    expect(mocks.lookupHmacSecret).toHaveBeenCalledWith(TEST_ACCOUNT_ID, TEST_STRATEGY_ID);
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
    expect(mocks.routeOrder).toHaveBeenCalledWith(
      TEST_ACCOUNT_ID,
      expect.objectContaining({ ticker: TEST_TICKER, action: TEST_ACTION }),
      expect.any(String),
      expect.any(Number),
    );
    expect(mocks.submitWebhookOrder).not.toHaveBeenCalled();
  });

  it("Test 10: Valid static token (Authorization: Bearer header) → 200 forwarded", async () => {
    dedupFirstInsert();
    mocks.routeOrder.mockResolvedValueOnce({
      success: true,
      reason: "routed",
      accountId: TEST_ACCOUNT_ID,
      brokerType: "traderspost",
      firmId: "topstep",
      statusCode: 200,
    });

    // Token in header, NOT in body
    const bodyWithoutToken = {
      account_id: TEST_ACCOUNT_ID,
      strategy_id: TEST_STRATEGY_ID,
      ticker: TEST_TICKER,
      action: TEST_ACTION,
      timestamp_ms: Date.now(),
      bar_timestamp: new Date().toISOString(),
    };

    const app = buildApp();
    const res = await call(app, bodyWithoutToken, {
      "Authorization": `Bearer ${TEST_STATIC_TOKEN}`,
    });
    server = res.server;

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ forwarded: true });
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
    expect(mocks.submitWebhookOrder).not.toHaveBeenCalled();
  });

  it("Test 11: Bad static token → 401 token_invalid, routeOrder never called", async () => {
    const app = buildApp();
    const res = await call(app, makeTokenPayload({ live_order_token: "wrong-token-that-does-not-match" }));
    server = res.server;

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "token_invalid" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  it("Test 12: Static token without strategy_id → 400 (strategy_id required)", async () => {
    const payload = makeTokenPayload({ strategy_id: undefined });
    const app = buildApp();
    const res = await call(app, payload);
    server = res.server;

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalid_payload" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  it("Test 13: Static token with stale timestamp → 401 stale_payload", async () => {
    // Token is valid but timestamp is 3 minutes ago
    const staleMs = Date.now() - 3 * 60 * 1000;
    const payload = makeTokenPayload({ timestamp_ms: staleMs });

    const app = buildApp();
    const res = await call(app, payload);
    server = res.server;

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "stale_payload" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  it("Test 14: Duplicate bar_timestamp (same bar close, same action) → 409 absorbed", async () => {
    // Simulate ON CONFLICT DO NOTHING — no rows returned
    dedupDuplicate();

    const app = buildApp();
    const res = await call(app, makeTokenPayload());
    server = res.server;

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "duplicate_pine_alert" });
    // routeOrder must NOT be called — alert was already processed
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  it("Test 15: HALT still blocks in static-token mode → 423", async () => {
    dedupFirstInsert();
    mocks.routeOrder.mockResolvedValueOnce({
      success: false,
      reason: "production_halt",
      accountId: TEST_ACCOUNT_ID,
      error: "killswitch_halt",
    });

    const app = buildApp();
    const res = await call(app, makeTokenPayload());
    server = res.server;

    expect(res.status).toBe(423);
    expect(res.body).toMatchObject({ blocked: true, reason: "production_halt" });
    // routeOrder IS called (reaches the gate) but returns halt
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
    expect(mocks.submitWebhookOrder).not.toHaveBeenCalled();
  });

  it("Test 16: No auth at all (neither hmac nor token) → 401 no_auth_credential", async () => {
    const barePayload = {
      account_id: TEST_ACCOUNT_ID,
      ticker: TEST_TICKER,
      action: TEST_ACTION,
      timestamp_ms: Date.now(),
      // no live_order_hmac, no live_order_token, no Authorization header
    };

    const app = buildApp();
    const res = await call(app, barePayload);
    server = res.server;

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "no_auth_credential" });
    expect(mocks.routeOrder).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUND-TRIP: token embedded by buildPineAlertTemplate is accepted by gateway
  // ═══════════════════════════════════════════════════════════════════════════

  it("Test 17: Round-trip — token from buildPineAlertTemplate is accepted by gateway", async () => {
    // Build the Pine alert JSON template (as the exporter would produce it)
    const alertTemplate = buildPineAlertTemplate(
      TEST_TICKER,
      TEST_STRATEGY_ID,
      "traderspost",
      {
        accountId: TEST_ACCOUNT_ID,
        strategyId: TEST_STRATEGY_ID,
        staticToken: TEST_STATIC_TOKEN,
        gatewayUrl: "https://tower.example.com/api/live-order",
      },
    );

    // Verify the template contains the token
    expect(alertTemplate).toContain(`"live_order_token": "${TEST_STATIC_TOKEN}"`);
    expect(alertTemplate).toContain(`"account_id": "${TEST_ACCOUNT_ID}"`);
    expect(alertTemplate).toContain(`"strategy_id": "${TEST_STRATEGY_ID}"`);

    // Simulate what TradingView does at alert-fire time:
    // substitute Pine variables with actual values
    const now = Date.now();
    const barTimestampIso = new Date(now).toISOString();
    const alertJson = alertTemplate
      .replace(/\{\{strategy\.order\.action\}\}/g, TEST_ACTION)
      .replace(/\{\{strategy\.order\.contracts\}\}/g, "6")
      .replace(/"\{\{time\}\}"/g, `"${barTimestampIso}"`)
      .replace(/\{\{time\}\}/g, String(now));

    const parsedAlert = JSON.parse(alertJson) as Record<string, unknown>;

    // The gateway must accept this exact payload
    dedupFirstInsert();
    mocks.routeOrder.mockResolvedValueOnce({
      success: true,
      reason: "routed",
      accountId: TEST_ACCOUNT_ID,
      brokerType: "traderspost",
      firmId: "topstep",
      statusCode: 200,
    });

    const app = buildApp();
    const res = await call(app, parsedAlert);
    server = res.server;

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ forwarded: true });
    expect(mocks.lookupHmacSecret).toHaveBeenCalledWith(TEST_ACCOUNT_ID, TEST_STRATEGY_ID);
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PINE EXPORT — buildPineAlertTemplate gateway vs legacy paths
  // ═══════════════════════════════════════════════════════════════════════════

  it("Test 18: buildPineAlertTemplate with gatewayOptions + LIVE_ORDER_GATEWAY_URL emits TF gateway payload", () => {
    process.env.LIVE_ORDER_GATEWAY_URL = "https://tower.example.com/api/live-order";

    const result = buildPineAlertTemplate(
      TEST_TICKER,
      TEST_STRATEGY_ID,
      "traderspost",
      {
        accountId: TEST_ACCOUNT_ID,
        strategyId: TEST_STRATEGY_ID,
        staticToken: TEST_STATIC_TOKEN,
      },
    );

    // Must contain gateway-format fields
    expect(result).toContain(`"account_id": "${TEST_ACCOUNT_ID}"`);
    expect(result).toContain(`"strategy_id": "${TEST_STRATEGY_ID}"`);
    expect(result).toContain(`"live_order_token": "${TEST_STATIC_TOKEN}"`);
    expect(result).toContain(`"timestamp_ms": {{time}}`);
    expect(result).toContain(`"bar_timestamp": "{{time}}"`);
    expect(result).toContain(`"action": "{{strategy.order.action}}"`);
    expect(result).toContain(`"quantity": {{strategy.order.contracts}}`);
    // Must NOT contain TradersPost-only fields
    expect(result).not.toContain("apiKey");
    expect(result).not.toContain("passthrough");
    expect(result).not.toContain("orderType");
  });

  it("Test 19: buildPineAlertTemplate without gatewayOptions emits TradersPost payload (unchanged)", () => {
    const result = buildPineAlertTemplate(TEST_TICKER, TEST_STRATEGY_ID, "traderspost");

    expect(result).toContain(`"action": "{{strategy.order.action}}"`);
    expect(result).toContain(`"ticker": "${TEST_TICKER}"`);
    expect(result).toContain(`"quantity": "{{strategy.order.contracts}}"`);
    expect(result).toContain(`"orderType": "market"`);
    expect(result).toContain(`"trading_forge_strategy_id": "${TEST_STRATEGY_ID}"`);
    // Must NOT contain gateway fields
    expect(result).not.toContain("account_id");
    expect(result).not.toContain("live_order_token");
    expect(result).not.toContain("timestamp_ms");
  });

  it("Test 20: buildPineAlertTemplate with gatewayOptions.gatewayUrl overrides env var", () => {
    // env var not set
    delete process.env.LIVE_ORDER_GATEWAY_URL;

    const result = buildPineAlertTemplate(
      TEST_TICKER,
      TEST_STRATEGY_ID,
      "traderspost",
      {
        accountId: TEST_ACCOUNT_ID,
        strategyId: TEST_STRATEGY_ID,
        staticToken: TEST_STATIC_TOKEN,
        gatewayUrl: "https://custom-gateway.example.com/api/live-order",
      },
    );

    // gatewayUrl override should activate the gateway path
    expect(result).toContain(`"live_order_token": "${TEST_STATIC_TOKEN}"`);
    expect(result).toContain(`"account_id": "${TEST_ACCOUNT_ID}"`);
  });

  it("Test 21: buildPineAlertTemplate with gatewayOptions but no URL falls back to TradersPost", () => {
    delete process.env.LIVE_ORDER_GATEWAY_URL;

    const result = buildPineAlertTemplate(
      TEST_TICKER,
      TEST_STRATEGY_ID,
      "traderspost",
      {
        accountId: TEST_ACCOUNT_ID,
        strategyId: TEST_STRATEGY_ID,
        staticToken: TEST_STATIC_TOKEN,
        // no gatewayUrl, env var also unset
      },
    );

    // Falls back to TradersPost path (gateway URL is required to activate gateway path)
    expect(result).toContain(`"orderType": "market"`);
    expect(result).not.toContain("live_order_token");
  });
});
