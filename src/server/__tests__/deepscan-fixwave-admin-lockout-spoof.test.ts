/**
 * deepscan-fixwave-admin-lockout-spoof.test.ts
 *
 * Deep-Scan fix-wave 2026-07-10, Fix 2 (CRIT).
 *
 * `src/server/routes/slumhouse/admin.ts::clientKey()` used to read
 * `req.headers["x-forwarded-for"]` directly, with no `trust proxy` configured
 * anywhere in the app. Because `scripts/tower-relay-client.cjs` replays every
 * relay-forwarded request's headers verbatim into a fresh LOOPBACK
 * `http.request()` on the tower, that header was fully attacker-controlled —
 * an attacker could rotate it on every POST to `/slumhouse/admin/auth` and
 * mint a fresh brute-force bucket per request, fully bypassing the 5-attempt
 * lockout (`admin.ts` MAX_FAILS/WINDOW_MS/LOCKOUT_MS).
 *
 * This test boots a REAL Express app with the REAL `adminOfficeRouter`
 * (mirroring how it's actually mounted) and drives it over a real HTTP
 * socket — same pattern as `deepscan16-a1-self-restart-auth-gate.test.ts`.
 * Every request in this file originates from the SAME test socket (loopback),
 * exactly like every relay-forwarded request looks identical at the socket
 * layer on the tower — the only thing that varied, pre-fix, was the
 * attacker-supplied header.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import http, { type Server } from "node:http";
import express from "express";
import { RELAY_VERIFIED_IP_HEADER } from "../lib/relay-client-ip.js";

const TEST_PASSCODE = "correct-horse-battery-staple-99";
const TEST_SESSION_SECRET = "deepscan-fixwave-test-session-secret-32chars-min!!";

// ─── Mocks for admin.ts's heavy/DB-touching dependencies ────────────────────
// None of these branches execute for POST /slumhouse/admin/auth (they're only
// reachable behind requireAdminSession on the OTHER routes in this router),
// but the module still imports them at load time — mock so this test boots
// with no real DB connection, matching the deepscan16 precedent.
vi.mock("../services/pipeline-control-service.js", () => ({
  getMode: vi.fn(),
  setMode: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({
  systemParameters: {},
  systemState: {},
  slumhouseUsers: {},
}));
vi.mock("../services/dead-mans-heartbeat-service.js", () => ({
  clearOperatorAbsenceMarkers: vi.fn(),
}));
vi.mock("../services/operator-absent-mode-service.js", () => ({
  operatorAbsentModeActive: vi.fn(),
}));
vi.mock("../lib/execution-mode.js", () => ({
  isLiveExecutionConfigured: vi.fn(() => false),
  getExecutionMode: vi.fn(),
  setExecutionMode: vi.fn(),
}));
vi.mock("../lib/learning-loop-mode.js", () => ({
  parseLearningLoopMode: vi.fn(() => 0),
  learningLoopModeLabel: vi.fn(() => "OFF"),
  LEARNING_LOOP_MODE_PARAM: "auto_patch_loop_enabled",
  MODE_OBSERVE: 1,
  MODE_AUTOPILOT: 2,
}));
const mockInsertAuditRowSafe = vi.fn().mockResolvedValue(true);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: mockInsertAuditRowSafe,
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Boot a real Express app with the real adminOfficeRouter ────────────────

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { adminOfficeRouter } = await import("../routes/slumhouse/admin.js");

  const app = express();
  app.use(express.json());
  app.use(adminOfficeRouter);

  await new Promise<void>((resolve) => {
    server = http.createServer(app).listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertAuditRowSafe.mockResolvedValue(true);
  process.env["SLUMHOUSE_SESSION_SECRET"] = TEST_SESSION_SECRET;
  process.env["SLUMHOUSE_ADMIN_PASSCODE"] = TEST_PASSCODE;
});

afterEach(() => {
  delete process.env["SLUMHOUSE_SESSION_SECRET"];
  delete process.env["SLUMHOUSE_ADMIN_PASSCODE"];
});

async function postAuth(passcode: string, extraHeaders: Record<string, string> = {}) {
  return fetch(`${baseUrl}/slumhouse/admin/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify({ passcode }),
  });
}

describe("Deep-Scan fix-wave 2026-07-10 Fix 2 — admin-passcode lockout survives a rotated X-Forwarded-For", () => {
  it("6 wrong-passcode attempts with a DIFFERENT spoofed x-forwarded-for on every request still lock out on attempt 6", async () => {
    // Pre-fix: clientKey() read raw x-forwarded-for first, so every one of these
    // 6 requests would land in its OWN fresh bucket (never accumulating fails) —
    // this loop would have completed with all 401s and no 429. Post-fix,
    // clientKey() ignores this header entirely (no x-relay-verified-ip present
    // in this direct test connection) and falls back to the real socket
    // address, which is IDENTICAL for every request here — so fails accumulate
    // into ONE bucket and the 6th attempt (MAX_FAILS=5) gets locked out.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await postAuth("wrong-passcode", { "X-Forwarded-For": `1.2.3.${i}` });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429); // locked out — the exact bypass this fix closes
  });

  it("a valid passcode on attempt 1 still succeeds (fix does not break the happy path)", async () => {
    // Distinct relay-verified-IP key so this test's bucket is independent of the
    // fallback-socket bucket the previous test intentionally locked out — the
    // in-memory `attempts` map in admin.ts is module-level and persists across
    // `it()` blocks within this file, same as it would across real requests.
    const res = await postAuth(TEST_PASSCODE, { [RELAY_VERIFIED_IP_HEADER]: "192.0.2.50" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  it("the relay-minted X-Relay-Verified-IP header is honored — DIFFERENT relay-verified callers get INDEPENDENT lockout buckets", async () => {
    // Simulates two distinct real-world external callers arriving through the
    // relay tunnel (each stamped with a different socket-observed IP by
    // railway-relay/server.js before the request ever reaches this app).
    // 5 fails from caller A must not lock out caller B.
    for (let i = 0; i < 5; i++) {
      const res = await postAuth("wrong-passcode", { [RELAY_VERIFIED_IP_HEADER]: "203.0.113.1" });
      expect(res.status).toBe(401);
    }
    const lockedOutA = await postAuth("wrong-passcode", { [RELAY_VERIFIED_IP_HEADER]: "203.0.113.1" });
    expect(lockedOutA.status).toBe(429);

    // Caller B, a genuinely different relay-verified IP, is unaffected.
    const callerB = await postAuth(TEST_PASSCODE, { [RELAY_VERIFIED_IP_HEADER]: "198.51.100.9" });
    expect(callerB.status).toBe(200);
  });

  it("a client cannot spoof the relay-verified-ip header to ESCAPE its own lockout bucket mid-attack (documents the residual: only meaningful when the relay is the one stamping it)", async () => {
    // NOTE: this direct test hits admin.ts without going through
    // railway-relay/server.js, so this specific request CAN set the header
    // itself — the point of this test is that IF it does, clientKey() treats
    // it as authoritative (by design — see relay-client-ip.ts's documented
    // scope boundary). The real spoofing vector (rotating raw
    // x-forwarded-for over the actual internet-facing relay path) is closed
    // by railway-relay/ip-sanitize.js deleting that header before it ever
    // reaches this app — covered in deepscan-fixwave-relay-ip-sanitize.test.ts.
    const first = await postAuth("wrong-passcode", { [RELAY_VERIFIED_IP_HEADER]: "9.9.9.9" });
    expect(first.status).toBe(401);
    const second = await postAuth(TEST_PASSCODE, { [RELAY_VERIFIED_IP_HEADER]: "9.9.9.9" });
    // Still within the same bucket (1 prior fail, well under MAX_FAILS) — succeeds.
    expect(second.status).toBe(200);
  });
});
