/**
 * deepscan-fixwave-live-order-mount-order.test.ts
 *
 * Deep-Scan fix-wave 2026-07-10, Fix 1 (CRIT).
 *
 * `src/server/index.ts` used to mount `app.use("/api/live-order", liveOrderRoutes)`
 * AFTER `app.use("/api", authMiddleware)`. Every Pine-alert-originated live order
 * (which carries ONLY its own HMAC / static token — never the general API_KEY
 * Bearer) was 401'd by the general auth gate before `live-order.ts`'s own auth
 * check ever ran. `w1-live-order-gateway.test.ts` never caught this because its
 * `buildApp()` mounts `liveOrderRoutes` alone, with NO `authMiddleware` in the
 * chain at all — it could not have detected a mount-order regression.
 *
 * This test boots TWO real Express apps with the REAL `authMiddleware` and the
 * REAL `liveOrderRoutes`, differing ONLY in mount order:
 *   - `appFixed`  mirrors the CURRENT `index.ts` order (live-order mounted
 *     BEFORE the gate) — the request must reach `live-order.ts`'s own auth.
 *   - `appBuggy`  mirrors the PRE-FIX order (gate mounted BEFORE live-order) —
 *     the exact same request must be 401'd by the general gate and never reach
 *     `live-order.ts` at all.
 * Running both against the identical request proves this test discriminates
 * the bug — it is not merely asserting today's behavior in isolation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http, { type Server } from "node:http";
import express from "express";

const TEST_ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const TEST_STRATEGY_ID = "22222222-2222-2222-2222-222222222222";
const TEST_TICKER = "MES1!";
const TEST_ACTION = "enter_long";
const TEST_STATIC_TOKEN = "static-pine-token-per-account-strategy-at-least-32c";
const TEST_API_KEY = "deepscan-fixwave-test-bearer-key";

// ─── Mocks for live-order.ts's heavy dependencies (same as w1-live-order-gateway.test.ts) ──
const mocks = vi.hoisted(() => ({
  routeOrder: vi.fn(),
  submitWebhookOrder: vi.fn(),
  dbInsert: vi.fn(),
  lookupHmacSecret: vi.fn(),
  dbExecute: vi.fn(),
  // F-1 lifecycle gate (db.select(...).from(strategies).where(...).limit(1)) —
  // resolves the strategy's lifecycleState so the gate passes by default.
  dbSelectLimit: vi.fn(),
}));

vi.mock("../services/broker-router.js", () => ({ routeOrder: mocks.routeOrder }));
vi.mock("../integrations/traderspost/client.js", () => ({ submitWebhookOrder: mocks.submitWebhookOrder }));
vi.mock("../services/tradingview-marker-service.js", () => ({ lookupHmacSecret: mocks.lookupHmacSecret }));
vi.mock("../db/index.js", () => ({
  db: {
    insert: () => ({ values: mocks.dbInsert }),
    execute: mocks.dbExecute,
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.dbSelectLimit }) }) }),
  },
}));
vi.mock("../db/schema.js", () => ({
  auditLog: Symbol("auditLog_mock"),
  strategies: { id: Symbol("strategies.id"), lifecycleState: Symbol("strategies.lifecycleState") },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// authMiddleware's Discord-cookie path is unreachable for our no-cookie POSTs
// (guarded by req.method === GET/HEAD), and its DB lookup is lazy-imported —
// no mock needed there, matching auth-middleware.test.ts's own note.

async function buildApp(order: "fixed" | "buggy"): Promise<express.Express> {
  const { authMiddleware } = await import("../middleware/auth.js");
  const { liveOrderRoutes } = await import("../routes/live-order.js");

  const app = express();
  app.use(express.json());

  if (order === "fixed") {
    // Mirrors index.ts POST-fix: external-auth routes mounted BEFORE the gate.
    app.use("/api/live-order", liveOrderRoutes);
    app.use("/api", authMiddleware);
  } else {
    // Mirrors index.ts PRE-fix: the exact bug this wave closes.
    app.use("/api", authMiddleware);
    app.use("/api/live-order", liveOrderRoutes);
  }
  return app;
}

async function withServer<T>(app: express.Express, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function makeTokenPayload(): Record<string, unknown> {
  const timestampMs = Date.now();
  return {
    account_id: TEST_ACCOUNT_ID,
    strategy_id: TEST_STRATEGY_ID,
    ticker: TEST_TICKER,
    action: TEST_ACTION,
    timestamp_ms: timestampMs,
    bar_timestamp: new Date(timestampMs).toISOString(),
    live_order_token: TEST_STATIC_TOKEN,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbInsert.mockResolvedValue(undefined);
  mocks.lookupHmacSecret.mockResolvedValue(TEST_STATIC_TOKEN);
  mocks.dbExecute.mockResolvedValue({ rows: [{ id: 1 }] });
  // F-1 lifecycle gate: strategy is DEPLOYED (a LIVE_EXECUTION_STATES member) by default.
  mocks.dbSelectLimit.mockResolvedValue([{ lifecycleState: "DEPLOYED" }]);
  // API_KEY IS configured — proves the fixed app's 200 is because live-order is
  // mounted before the gate, not because the gate fail-opens with no API_KEY.
  process.env["API_KEY"] = TEST_API_KEY;
  delete process.env["AUTH_DEV_BYPASS"];
});

afterEach(() => {
  delete process.env["API_KEY"];
});

describe("Deep-Scan fix-wave 2026-07-10 Fix 1 — /api/live-order mount order relative to authMiddleware", () => {
  it("FIXED order: a Pine-alert request with ONLY its own static token (no Bearer, no cookie) reaches live-order.ts and succeeds", async () => {
    mocks.routeOrder.mockResolvedValueOnce({
      success: true,
      reason: "routed",
      accountId: TEST_ACCOUNT_ID,
      brokerType: "traderspost",
      firmId: "topstep",
      statusCode: 200,
    });

    const app = await buildApp("fixed");
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/live-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // NO Authorization header
        body: JSON.stringify(makeTokenPayload()),
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ forwarded: true, reason: "routed" });
    });
    expect(mocks.routeOrder).toHaveBeenCalledOnce();
  });

  it("BUGGY order (pre-fix): the IDENTICAL request is 401'd by the general auth gate and NEVER reaches live-order.ts", async () => {
    const app = await buildApp("buggy");
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/live-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeTokenPayload()),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ error: "Missing authorization" });
    });
    // The gate rejected before live-order.ts's handler ever ran.
    expect(mocks.routeOrder).not.toHaveBeenCalled();
    expect(mocks.lookupHmacSecret).not.toHaveBeenCalled();
  });

  it("FIXED order: a bad static token still gets live-order.ts's OWN 401 (not the gate's) — proves the route's internal auth is untouched", async () => {
    const app = await buildApp("fixed");
    await withServer(app, async (baseUrl) => {
      const payload = { ...makeTokenPayload(), live_order_token: "wrong-token" };
      const res = await fetch(`${baseUrl}/api/live-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(401);
      expect(body).toMatchObject({ error: "token_invalid" }); // live-order.ts's own error, not the gate's
    });
  });

  it("FIXED order: an unrelated route mounted after the gate still requires the Bearer (gate is not globally disabled)", async () => {
    const { authMiddleware } = await import("../middleware/auth.js");
    const { liveOrderRoutes } = await import("../routes/live-order.js");
    const app = express();
    app.use(express.json());
    app.use("/api/live-order", liveOrderRoutes);
    app.use("/api", authMiddleware);
    app.get("/api/some-protected-route", (_req, res) => res.json({ secret: true }));

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/some-protected-route`);
      expect(res.status).toBe(401);
    });
  });
});
