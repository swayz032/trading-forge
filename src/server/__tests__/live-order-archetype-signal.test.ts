/**
 * live-order-archetype-signal.test.ts — Pass 4.5 Track B (hardening/phase-0)
 *
 * Tests for the archetype_signal action dispatch added to POST /api/live-order.
 *
 * NEW BEHAVIOR (Pass 4.5 Track B):
 *   action="archetype_signal" → validate archetype field → invoke Python
 *   archetype_evaluator → on hold: return 200 status:held (no routeOrder call)
 *                       → on directional: call routeOrder with resolved direction
 *                       → on evaluator error/timeout: 503 + audit
 *
 * The full safety stack (kill-switch, compliance, firm-cap) is preserved because
 * the resolved direction is passed to routeOrder() exactly like any other action.
 *
 * PARITY CONSTRAINTS:
 *   - HMAC validation runs BEFORE archetype dispatch (auth is always first gate)
 *   - routeOrder() is NOT called when evaluator returns "hold"
 *   - routeOrder() IS called when evaluator returns a directional action
 *   - Evaluator timeout → 503 (fail-CLOSED, not silent pass-through)
 *
 * PATTERN: real Express app + native fetch over ephemeral port.
 * No supertest — matches codebase convention in w1-live-order-gateway.test.ts.
 *
 * VITEST STATUS: All 6 cases GREEN (pure unit test, no real DB or Python).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { createHmac } from "node:crypto";
import type { Server } from "http";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  runPythonModule: vi.fn(),
  routeOrder: vi.fn(),
  notifyWarning: vi.fn(),
  lookupHmacSecret: vi.fn(),
  dbInsert: vi.fn(),
  dbExecute: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../lib/python-runner.js", () => ({
  runPythonModule: mocks.runPythonModule,
  getPythonSubprocessStats: vi.fn().mockReturnValue({ active: 0, queued: 0 }),
}));

vi.mock("../services/broker-router.js", () => ({
  routeOrder: mocks.routeOrder,
}));

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: mocks.notifyWarning,
}));

vi.mock("../services/tradingview-marker-service.js", () => ({
  lookupHmacSecret: mocks.lookupHmacSecret,
}));

vi.mock("../db/index.js", () => ({
  db: {
    insert: () => ({ values: mocks.dbInsert }),
    execute: mocks.dbExecute,
  },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: Symbol("auditLog_mock"),
}));

// Pass 4.5 architect close: stub the archetype-routing observability emit helpers
// so the test does not transitively load sse.ts → index.ts → boot-migration-runner.
vi.mock("../lib/archetype-routing-observability.js", () => ({
  emitArchetypeSignalReceived: vi.fn(),
  emitArchetypeSignalResolved: vi.fn(),
  emitArchetypeEvaluatorFailed: vi.fn(),
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

// ─── Test helpers ─────────────────────────────────────────────────────────────

const HMAC_SECRET = "test-archetype-secret-must-be-at-least-32-chars-long";
const ACCOUNT_ID = "aaaaaaaa-0000-4000-a000-000000000001";
const TICKER = "MES";
const STRATEGY_ID = "bbbbbbbb-0000-4000-b000-000000000001";
const ARCHETYPE_KEY = "bounce_off_level";

function buildApp() {
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
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/api/live-order`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
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

function signPayload(action: string, timestampMs: number): string {
  return createHmac("sha256", HMAC_SECRET)
    .update(`${ACCOUNT_ID}|${TICKER}|${action}|${timestampMs}`)
    .digest("hex");
}

function archetypePayload(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const ts = Date.now();
  return {
    account_id: ACCOUNT_ID,
    ticker: TICKER,
    action: "archetype_signal",
    archetype: ARCHETYPE_KEY,
    strategy_id: STRATEGY_ID,
    bar_timestamp: new Date().toISOString(),
    timestamp_ms: ts,
    live_order_hmac: signPayload("archetype_signal", ts),
    ...overrides,
  };
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

const servers: Server[] = [];

afterEach(() => {
  for (const s of servers.splice(0)) {
    s.close();
  }
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Pass 4.5 Track B — /api/live-order archetype_signal dispatch", () => {
  beforeEach(() => {
    process.env.LIVE_ORDER_HMAC_SECRET = HMAC_SECRET;
    mocks.dbInsert.mockResolvedValue(undefined);
    mocks.dbExecute.mockResolvedValue({ rows: [{ id: 1 }] });
    mocks.lookupHmacSecret.mockResolvedValue(null);
    mocks.notifyWarning.mockResolvedValue(undefined);
  });

  // ─── CASE 1: archetype_signal + evaluator returns hold ────────────────────
  describe("CASE 1: valid archetype_signal + evaluator hold → 200 status:held, no routeOrder", () => {
    it("returns 200 with status:held when evaluator returns action:hold", async () => {
      mocks.runPythonModule.mockResolvedValueOnce({ action: "hold", reason: "no_session_confluence" });

      const app = buildApp();
      const { status, body, server } = await call(app, archetypePayload());
      servers.push(server);

      expect(status).toBe(200);
      expect(body.status).toBe("held");
      expect(body.reason).toBe("no_session_confluence");
      expect(body.correlationId).toBeDefined();
    });

    it("does NOT call routeOrder when evaluator returns hold", async () => {
      mocks.runPythonModule.mockResolvedValueOnce({ action: "hold", reason: "outside_killzone" });

      const app = buildApp();
      const { server } = await call(app, archetypePayload());
      servers.push(server);

      expect(mocks.routeOrder).not.toHaveBeenCalled();
    });

    it("invokes runPythonModule with correct module and archetype args", async () => {
      mocks.runPythonModule.mockResolvedValueOnce({ action: "hold", reason: "test" });

      const app = buildApp();
      const { server } = await call(app, archetypePayload());
      servers.push(server);

      expect(mocks.runPythonModule).toHaveBeenCalledOnce();
      const callArg = mocks.runPythonModule.mock.calls[0][0] as { module: string; args: string[] };
      expect(callArg.module).toBe("src.engine.archetype_evaluator");
      expect(callArg.args).toContain("--archetype");
      expect(callArg.args).toContain(ARCHETYPE_KEY);
    });
  });

  // ─── CASE 2: evaluator returns directional action → routeOrder called ─────
  describe("CASE 2: evaluator returns enter_long → routeOrder called, 200 forwarded", () => {
    it("returns 200 forwarded with archetypeKey and resolvedAction", async () => {
      mocks.runPythonModule.mockResolvedValueOnce({ action: "enter_long", reason: "ma_reject_bullish" });
      mocks.routeOrder.mockResolvedValueOnce({
        success: true,
        reason: "forwarded",
        brokerType: "traderspost",
        firmId: "topstep",
        statusCode: 200,
      });

      const app = buildApp();
      const { status, body, server } = await call(app, archetypePayload());
      servers.push(server);

      expect(status).toBe(200);
      expect(body.forwarded).toBe(true);
      expect(body.archetypeKey).toBe(ARCHETYPE_KEY);
      expect(body.resolvedAction).toBe("enter_long");
    });

    it("routeOrder receives enter_long as the signal.action (not archetype_signal)", async () => {
      mocks.runPythonModule.mockResolvedValueOnce({ action: "enter_long", reason: "test" });
      mocks.routeOrder.mockResolvedValueOnce({
        success: true,
        reason: "forwarded",
        brokerType: "traderspost",
        firmId: "topstep",
        statusCode: 200,
      });

      const app = buildApp();
      const { server } = await call(app, archetypePayload());
      servers.push(server);

      expect(mocks.routeOrder).toHaveBeenCalledOnce();
      const [, signal] = mocks.routeOrder.mock.calls[0] as [string, { action: string }];
      expect(signal.action).toBe("enter_long");
    });
  });

  // ─── CASE 3: evaluator timeout → 503 + no routeOrder ─────────────────────
  describe("CASE 3: evaluator timeout → 503, audit live_order.archetype_evaluator_failed", () => {
    it("returns 503 when runPythonModule throws timeout error", async () => {
      mocks.runPythonModule.mockRejectedValueOnce(
        new Error("archetype-evaluator timed out after 10000ms"),
      );

      const app = buildApp();
      const { status, body, server } = await call(app, archetypePayload());
      servers.push(server);

      expect(status).toBe(503);
      expect(body.error).toBe("archetype_evaluator_failed");
    });

    it("does NOT call routeOrder when evaluator times out", async () => {
      mocks.runPythonModule.mockRejectedValueOnce(new Error("timeout"));

      const app = buildApp();
      const { server } = await call(app, archetypePayload());
      servers.push(server);

      expect(mocks.routeOrder).not.toHaveBeenCalled();
    });

    it("503 response includes correlationId", async () => {
      mocks.runPythonModule.mockRejectedValueOnce(new Error("connection refused"));

      const app = buildApp();
      const { body, server } = await call(app, archetypePayload());
      servers.push(server);

      expect(body.correlationId).toBeDefined();
    });
  });

  // ─── CASE 4: missing archetype field → 400 ────────────────────────────────
  describe("CASE 4: missing archetype field with action:archetype_signal → 400", () => {
    it("returns 400 when archetype field is absent", async () => {
      const payload = archetypePayload();
      delete (payload as Record<string, unknown>).archetype;

      const app = buildApp();
      const { status, body, server } = await call(app, payload);
      servers.push(server);

      expect(status).toBe(400);
      expect(body.error).toBe("invalid_payload");
    });

    it("returns 400 when archetype is empty string", async () => {
      const payload = archetypePayload({ archetype: "" });

      const app = buildApp();
      const { status, server } = await call(app, payload);
      servers.push(server);

      expect(status).toBe(400);
    });

    it("does not call runPythonModule when archetype is missing", async () => {
      const payload = archetypePayload();
      delete (payload as Record<string, unknown>).archetype;

      const app = buildApp();
      const { server } = await call(app, payload);
      servers.push(server);

      expect(mocks.runPythonModule).not.toHaveBeenCalled();
    });
  });

  // ─── CASE 5: unknown archetype key → 400 ─────────────────────────────────
  describe("CASE 5: unknown archetype key → 400", () => {
    it("returns 400 when archetype is not in ARCHETYPE_REGISTRY_KEYS", async () => {
      const payload = archetypePayload({ archetype: "definitely_not_a_real_archetype_key_xyz" });

      const app = buildApp();
      const { status, body, server } = await call(app, payload);
      servers.push(server);

      expect(status).toBe(400);
      expect(body.error).toBe("invalid_payload");
    });

    it("does not call runPythonModule for unknown archetype", async () => {
      const payload = archetypePayload({ archetype: "fake_archetype_xyz_999" });

      const app = buildApp();
      const { server } = await call(app, payload);
      servers.push(server);

      expect(mocks.runPythonModule).not.toHaveBeenCalled();
    });
  });

  // ─── CASE 6: invalid HMAC → 401 (existing flow unchanged) ────────────────
  describe("CASE 6: invalid HMAC → 401 (existing auth flow unchanged)", () => {
    it("returns 401 when HMAC is wrong even with valid archetype payload", async () => {
      const payload = archetypePayload({ live_order_hmac: "deadbeef_invalid_hmac_wrong" });

      const app = buildApp();
      const { status, body, server } = await call(app, payload);
      servers.push(server);

      expect(status).toBe(401);
      expect(body.error).toBe("hmac_invalid");
    });

    it("does not call runPythonModule when HMAC fails", async () => {
      const payload = archetypePayload({ live_order_hmac: "bad_hmac_value" });

      const app = buildApp();
      const { server } = await call(app, payload);
      servers.push(server);

      expect(mocks.runPythonModule).not.toHaveBeenCalled();
    });

    it("non-archetype_signal actions still work (schema backward compat)", async () => {
      // Verify existing enter_long action still validates through Zod
      const ts = Date.now();
      const nonArchetypePayload: Record<string, unknown> = {
        account_id: ACCOUNT_ID,
        ticker: TICKER,
        action: "enter_long",
        strategy_id: STRATEGY_ID,
        timestamp_ms: ts,
        live_order_hmac: signPayload("enter_long", ts),
        // NO archetype field
      };

      mocks.routeOrder.mockResolvedValueOnce({
        success: true,
        reason: "forwarded",
        brokerType: "traderspost",
        firmId: "topstep",
        statusCode: 200,
      });

      const app = buildApp();
      const { status, server } = await call(app, nonArchetypePayload);
      servers.push(server);

      // Should pass Zod schema and reach routeOrder (200 — not 400/401)
      expect(status).not.toBe(400);
      expect(status).not.toBe(401);
    });
  });
});
