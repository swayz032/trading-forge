/**
 * tradingview-webhook.test.ts — Track 8 / Pass 3
 *
 * Tests the POST /api/tradingview/marker route handler directly (no HTTP layer).
 * Pattern matches existing test suite style (no supertest dependency).
 *
 * Tests:
 *  1.  Marker insert happy path (valid HMAC, valid account, valid strategy)
 *  2.  HMAC validation rejects invalid signature with 401
 *  3.  HMAC validation rejects missing signature (Zod) with 400
 *  4.  Rate-limit enforcement (>10 req per account_id rejects with 429)
 *  5.  SSE event tradingview:marker-received broadcast on success
 *  6.  Legacy-firm-account rejection (account with firm NOT IN mffu/topstep) → 403
 *  7.  Pause-guard inheritance (returns 423 during pipeline pause)
 *  8.  Audit_log row written per marker insert
 *  9.  Idempotency: DO NOTHING returns empty rows → idempotent=true in response
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import type { Request, Response } from "express";

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mockState = vi.hoisted(() => ({
  isPipelineActive: true,
  firmId: "mffu" as string | null,
  hmacSecret: "a".repeat(64) as string | null,
  markerInsertResult: [{ id: 42 }] as Array<{ id: number }>,
  auditLogRows: [] as Array<Record<string, unknown>>,
  sseBroadcasts: [] as Array<{ event: string; data: unknown }>,
  // _nextExecuteCall intentionally unused — use sequential mockImplementationOnce
  _nextExecuteCall: "broker" as "broker" | "insert",
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../services/pipeline-control-service.js", () => ({
  isActive: vi.fn(() => Promise.resolve(mockState.isPipelineActive)),
}));

vi.mock("../services/tradingview-marker-service.js", () => ({
  validateHmac: vi.fn(
    (payload: Record<string, unknown>, providedHmac: string, secret: string) => {
      const { createHmac: ch, timingSafeEqual } = require("crypto");
      // Wave hardening 2026-06-22: production validateHmac uses the F-7 V2 fixed-field
      // canonical (buildWebhookCanonical) — strategy|account|bar_ts|signal — not sorted JSON.
      const serialized = `${String(payload["strategy_id"] ?? "")}|${String(payload["account_id"] ?? "")}|${String(payload["bar_timestamp"] ?? "")}|${Number(payload["signal"] ?? 0)}`;
      const expected = ch("sha256", secret).update(serialized, "utf8").digest("hex");
      const expBuf = Buffer.from(expected, "utf8");
      const provBuf = Buffer.from(providedHmac, "utf8");
      if (expBuf.length !== provBuf.length) return false;
      return timingSafeEqual(expBuf, provBuf);
    }
  ),
  lookupHmacSecret: vi.fn(
    async (_accountId: string, _strategyId: string) => mockState.hmacSecret
  ),
}));

// executeMock is a reference we can call mockImplementationOnce on per-test
const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({
  db: {
    execute: executeMock,
    insert: vi.fn((_table: unknown) => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        mockState.auditLogRows.push(vals);
        return Promise.resolve();
      }),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  tradingviewMarkers: { tableName: "tradingview_markers" },
  auditLog: { tableName: "audit_log" },
}));

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: vi.fn((event: string, data: unknown) => {
    mockState.sseBroadcasts.push({ event, data });
  }),
}));

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../middleware/rate-limit.js", () => ({
  strictRateLimit: vi.fn(
    (_req: unknown, _res: unknown, next: () => void) => next()
  ),
}));

// ─── Helper: build payload with valid HMAC ─────────────────────────────────

function buildPayload(
  overrides: Record<string, unknown> = {},
  secret: string = "a".repeat(64)
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    strategy_id: "00000000-0000-0000-0000-000000000001",
    account_id: "00000000-0000-0000-0000-000000000002",
    // Wave hardening 2026-06-22: fresh bar_timestamp so the F-2 replay window (10 min)
    // doesn't reject it as stale_payload — the old hardcoded 2026-05-10 broke once real
    // time advanced past it. Override per-test for explicit stale-payload cases.
    bar_timestamp: new Date().toISOString(),
    signal: 1,
    ...overrides,
  };
  // Wave hardening 2026-06-22: sign with the F-7 V2 fixed-field canonical that production
  // validateHmac expects (strategy|account|bar_ts|signal), not legacy sorted-JSON.
  const serialized = `${String(base["strategy_id"])}|${String(base["account_id"])}|${String(base["bar_timestamp"])}|${Number(base["signal"])}`;
  const hmac = createHmac("sha256", secret).update(serialized, "utf8").digest("hex");
  return { ...base, hmac };
}

// ─── Helper: call the route handler directly ───────────────────────────────

async function callMarkerRoute(body: unknown): Promise<{
  statusCode: number;
  body: Record<string, unknown>;
}> {
  const { tradingViewWebhookRoutes } = await import(
    "../routes/tradingview-webhook.js"
  );

  const res = {
    statusCode: 200,
    body: {} as Record<string, unknown>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: unknown) {
      this.body = b as Record<string, unknown>;
      return this;
    },
  };

  const req = { body } as unknown as Request;

  // Find the POST /marker handler on the router stack
  const stack = (
    tradingViewWebhookRoutes as unknown as {
      stack: Array<{
        route?: {
          path: string;
          stack: Array<{ handle: (...args: unknown[]) => unknown }>;
        };
      }>;
    }
  ).stack;

  const layer = stack.find((l) => l.route?.path === "/marker");
  if (!layer?.route) throw new Error("POST /marker route not found");

  // The route has: [strictRateLimit middleware, handler]
  // We skip the rate-limit middleware (it's mocked as passthrough globally)
  // and call the last handler (the actual async handler)
  const handlers = layer.route.stack;
  for (const h of handlers) {
    await h.handle(req, res as unknown as Response, () => {
      /* next — not used */
    });
    // Stop if response has been set (statusCode changed from default or body set)
    if (res.statusCode !== 200 || Object.keys(res.body).length > 0) {
      break;
    }
  }

  return res;
}

// ─── Reset modules between tests to clear per-account rate-limit buckets ───

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/tradingview/marker — route handler", () => {
  /**
   * Set up execute mock to return broker result first, then marker insert result.
   * The route calls db.execute twice per happy-path request:
   *   1. broker_accounts lookup → { rows: [{firm_id}] }
   *   2. INSERT tradingview_markers → { rows: [{id: 42}] }
   */
  function setupExecuteMocks(opts: {
    firmId?: string | null;
    insertRows?: Array<{ id: number }>;
  } = {}) {
    const firmId = opts.firmId ?? mockState.firmId;
    const insertRows = opts.insertRows ?? [{ id: 42 }];
    executeMock.mockReset();
    // Call 1: broker lookup
    executeMock.mockResolvedValueOnce({
      rows: firmId ? [{ firm_id: firmId }] : [],
    });
    // Call 2: INSERT (used in happy path; may not be reached in error cases)
    executeMock.mockResolvedValueOnce({ rows: insertRows });
    // Fallback for any additional calls
    executeMock.mockResolvedValue({ rows: [] });
  }

  beforeEach(() => {
    mockState.isPipelineActive = true;
    mockState.firmId = "mffu";
    mockState.hmacSecret = "a".repeat(64);
    mockState.markerInsertResult = [{ id: 42 }];
    mockState.auditLogRows = [];
    mockState.sseBroadcasts = [];
    vi.clearAllMocks();
    vi.resetModules(); // clears per-account rate-limit bucket state between tests
    setupExecuteMocks();
  });

  // ── Test 1: Happy path ───────────────────────────────────────────────────

  it("1. inserts marker and returns 200 on valid HMAC + valid account", async () => {
    const payload = buildPayload();
    const res = await callMarkerRoute(payload);

    expect(res.statusCode).toBe(200);
    expect(res.body["ok"]).toBe(true);
    expect(res.body["markerId"]).toBe(42);
    expect(res.body["correlationId"]).toBeTruthy();
  });

  // ── Test 2: HMAC mismatch → 401 ─────────────────────────────────────────

  it("2. rejects invalid HMAC signature with 401", async () => {
    const payload = buildPayload();
    // Corrupt the HMAC field (same length to avoid length mismatch short-circuit)
    const badHmac = "0".repeat(64);
    payload["hmac"] = badHmac;

    const res = await callMarkerRoute(payload);

    expect(res.statusCode).toBe(401);
    expect(res.body["error"]).toBe("hmac_invalid");
  });

  // ── Test 3: Missing HMAC → 400 ──────────────────────────────────────────

  // Wave hardening 2026-06-22: F-1 dual-proof — hmac + secret_check both Zod-optional, but
  // the auth layer requires AT LEAST ONE valid proof. Neither present => 401 hmac_invalid
  // (fail-closed), not 400 Zod. Encodes the dual-proof contract row "neither present".
  it("3. rejects payload with neither hmac nor secret_check with 401 (fail-closed)", async () => {
    const payload = {
      strategy_id: "00000000-0000-0000-0000-000000000001",
      account_id: "00000000-0000-0000-0000-000000000002",
      bar_timestamp: "2026-05-10T14:00:00.000Z",
      signal: 1,
      // neither hmac nor secret_check provided
    };

    const res = await callMarkerRoute(payload);

    expect(res.statusCode).toBe(401);
    expect(res.body["error"]).toBe("hmac_invalid");
  });

  // ── Test 4: Per-account rate limit ──────────────────────────────────────

  it("4. enforces per-account rate limit, returns 429 after threshold", async () => {
    // Use a unique account_id so this test's bucket is isolated
    const accountId = "00000000-ffff-0000-0000-000000000099";
    let lastStatus = 200;

    for (let i = 0; i <= 11; i++) {
      const payload = buildPayload({ account_id: accountId });
      const res = await callMarkerRoute(payload);
      lastStatus = res.statusCode;
      if (lastStatus === 429) break;
    }

    expect(lastStatus).toBe(429);
  });

  // ── Test 5: SSE broadcast ────────────────────────────────────────────────

  it("5. broadcasts tradingview:marker-received SSE event on success", async () => {
    const payload = buildPayload();
    await callMarkerRoute(payload);

    const markerEvents = mockState.sseBroadcasts.filter(
      (b) => b.event === "tradingview:marker-received"
    );
    expect(markerEvents.length).toBeGreaterThanOrEqual(1);
    const eventData = markerEvents[0]?.data as Record<string, unknown>;
    expect(eventData?.["signal"]).toBe(1);
    expect(eventData?.["firmId"]).toBe("mffu");
  });

  // ── Test 6: Legacy firm rejection → 403 ─────────────────────────────────

  it("6. rejects account with firm not in (mffu, topstep) with 403", async () => {
    setupExecuteMocks({ firmId: "apex" }); // legacy firm — removed in Pass 1 Track 2

    const payload = buildPayload();
    const res = await callMarkerRoute(payload);

    expect(res.statusCode).toBe(403);
    expect(res.body["error"]).toBe("firm_not_allowed");
    expect(res.body["allowed"]).toEqual(["mffu", "topstep"]);
  });

  // ── Test 7: Pipeline pause guard → 423 ──────────────────────────────────

  it("7. returns 423 when pipeline is paused", async () => {
    mockState.isPipelineActive = false;

    const payload = buildPayload();
    const res = await callMarkerRoute(payload);

    expect(res.statusCode).toBe(423);
    expect(res.body["error"]).toBe("pipeline_paused");
  });

  // ── Test 8: Audit log row written on success ─────────────────────────────

  it("8. writes an audit_log row with action=tradingview_marker.received on success", async () => {
    const payload = buildPayload();
    await callMarkerRoute(payload);

    expect(mockState.auditLogRows.length).toBeGreaterThanOrEqual(1);
    const successRow = mockState.auditLogRows.find(
      (r) => r["action"] === "tradingview_marker.received"
    );
    expect(successRow).toBeDefined();
    expect(successRow?.["status"]).toBe("success");
  });

  // ── Test 9: Idempotency (DO NOTHING → empty rows) ────────────────────────

  it("9. duplicate marker returns 200 with idempotent=true when DO NOTHING fires", async () => {
    // Simulate DO NOTHING — INSERT returns no rows (duplicate conflict)
    setupExecuteMocks({ insertRows: [] });

    const payload = buildPayload();
    const res = await callMarkerRoute(payload);

    expect(res.statusCode).toBe(200);
    expect(res.body["ok"]).toBe(true);
    expect(res.body["idempotent"]).toBe(true);
    expect(res.body["markerId"]).toBeNull();
  });
});
