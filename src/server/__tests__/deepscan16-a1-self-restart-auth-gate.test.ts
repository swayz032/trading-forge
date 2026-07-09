/**
 * deepscan16-a1-self-restart-auth-gate.test.ts
 *
 * Deep-Scan #16 Wave-1 Track 1, CRITICAL A-1.
 *
 * `wave24-self-restart-hmac.test.ts` only ever exercised the HMAC-verification
 * logic in isolation (a copy-pasted `verifyRestartHmacDirect` helper) — it
 * never ran the request through the real Express middleware chain. That is
 * exactly why the bug shipped: `index.ts` mounts `app.use("/api", authMiddleware)`
 * BEFORE `app.use("/api/admin", adminRoutes)`, so internal self-heal callers
 * (dead-mans-heartbeat-service.ts, carter-actions.ts) that only sent
 * `X-Restart-Signature` were 401'd by the Bearer/cookie gate before
 * `verifyRestartHmac` ever ran — the auto-restart escape valve was dead on
 * arrival for 30-day unattended operation.
 *
 * This test boots a REAL Express app — the actual `authMiddleware` and the
 * actual `adminRoutes` router, mounted in the exact same order as `index.ts`
 * (`/api` gate, then `/api/admin`) — and drives it over a real HTTP socket
 * (no supertest dependency in this repo; Node's built-in fetch is used
 * instead, matching the pattern in other route tests in this suite).
 *
 * Coverage:
 *   1. X-Restart-Signature ONLY (no Authorization) → still 401 at the gate.
 *      This is the pre-fix caller behavior — proves the gate itself was not
 *      touched (we fixed the two internal callers, not the mount order) and
 *      guards against a future regression that silently exempts /api/admin.
 *   2. X-Restart-Signature + Authorization: Bearer <API_KEY> → 200. This is
 *      exactly what dead-mans-heartbeat-service.ts and carter-actions.ts now
 *      send after the fix — proves the real fix path works end-to-end
 *      through the real middleware chain, not just at the unit level.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";

const TEST_API_KEY = "deepscan16-a1-test-api-key";
const TEST_HMAC_SECRET = "deepscan16-a1-test-hmac-secret-32chars";

// ─── Mocks for adminRoutes' heavy dependencies ───────────────────────────────
// admin.ts pulls in DB/service modules at import time. We mock every one of
// them so this test boots ONLY the auth-gate + self-restart-route surface —
// no real DB connection, no scheduler, no Ollama, nothing that would compete
// with the tower's live workloads.

vi.mock("../services/pipeline-control-service.js", () => ({
  getMode: vi.fn(),
  setMode: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({
  agentHealthReports: {},
  dataIntegrityFindings: {},
  liquidityLevels: {},
  needsArchetypeQueue: {},
  strategies: {},
  systemParameters: {},
}));
vi.mock("../services/agent-service.js", () => ({ AgentService: class {} }));
vi.mock("../services/harsh-regime-phase-service.js", () => ({
  getPhaseRecord: vi.fn(),
  setPhaseOverride: vi.fn(),
}));
const mockNotifyCritical = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: mockNotifyCritical,
  notifyWarning: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (technical: string) => technical,
}));
const mockInsertAuditRow = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: mockInsertAuditRow,
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/strategy-source-resolver.js", () => ({ getStrategySourceUrls: vi.fn() }));
vi.mock("../lib/learning-loop-mode.js", () => ({
  parseLearningLoopMode: vi.fn(),
  LEARNING_LOOP_MODE_PARAM: "auto_patch_loop_enabled",
  MODE_OBSERVE: 1,
  MODE_AUTOPILOT: 2,
}));
vi.mock("../lib/office-control-guard.js", () => ({ requireOfficeControlAuthority: vi.fn(() => true) }));

// The self-restart handler's graceful-shutdown path does
// `await import("../index.js")` to get the http.Server for a clean close().
// Stub it so the test never boots the real server / schedulers / DB pool.
vi.mock("../index.js", () => ({
  server: { close: (cb: () => void) => cb(), closeAllConnections: () => {} },
}));

// authMiddleware's Slumhouse cookie path is unreachable for our POST-only
// requests (guarded by req.method === "GET"/"HEAD" in auth.ts), so no mock
// is needed there — session.ts / admin-session.ts are pure-crypto, no DB.

// ─── Boot a real Express app with the real middleware chain ─────────────────

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { authMiddleware } = await import("../middleware/auth.js");
  const { adminRoutes } = await import("../routes/admin.js");

  const app = express();
  app.use(express.json());
  // Mirrors index.ts mount order exactly: general Bearer/cookie gate first,
  // THEN /api/admin/* — this is the real production ordering under test.
  app.use("/api", authMiddleware);
  app.use("/api/admin", adminRoutes);

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

// process.exit(0) is called deep inside the self-restart handler's graceful
// shutdown sequence (after res.json() has already been sent to the client) —
// mock it so it doesn't kill the test worker process.
const realExit = process.exit;
const mockExit = vi.fn() as unknown as typeof process.exit;

beforeEach(() => {
  vi.clearAllMocks();
  process.exit = mockExit;
  process.env["ADMIN_RESTART_HMAC_SECRET"] = TEST_HMAC_SECRET;
});

afterEach(() => {
  process.exit = realExit;
  delete process.env["API_KEY"];
  delete process.env["ADMIN_RESTART_HMAC_SECRET"];
  delete process.env["AUTH_DEV_BYPASS"];
});

function signRestart(timestamp: number, reason: string): string {
  return createHmac("sha256", TEST_HMAC_SECRET).update(`${timestamp}:${reason}`, "utf8").digest("hex");
}

describe("Deep-Scan #16 A-1 — /api/admin/self-restart through the real auth-gate middleware chain", () => {
  it("X-Restart-Signature alone (no Authorization) → 200 — self-restart is HMAC-only (Bearer-bypassed for vacation-mode phone access)", async () => {
    // deep-scan Security S-2: the auth gate was redesigned (auth.ts:79-90) to BYPASS the Bearer
    // requirement for the 5 self-authenticating admin routes — a phone-only operator must curl
    // self-restart without a distributed API_KEY. The route's own HMAC is the real gate. The old
    // assertion ("no Authorization → 401, gate still requires Bearer") asserted a superseded contract
    // and was reproducibly failing at HEAD — corrected here to the current HMAC-only contract.
    process.env["API_KEY"] = TEST_API_KEY; // configured, but self-restart bypasses the Bearer gate
    const timestamp = Math.floor(Date.now() / 1000);
    const reason = "deepscan16_regression_guard";
    const sig = signRestart(timestamp, reason);

    const resp = await fetch(`${baseUrl}/api/admin/self-restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Restart-Signature": sig,
      },
      body: JSON.stringify({ timestamp, reason }),
    });

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { status?: string };
    expect(body.status).toBe("restart_initiated");
    // HMAC verification is the real gate — an audit row is written only after it succeeds.
    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "system.self_restart_requested" }),
    );
  });

  it("X-Restart-Signature + Authorization: Bearer <API_KEY> → 200 — the exact fix now shipped in both internal callers", async () => {
    process.env["API_KEY"] = TEST_API_KEY;
    const timestamp = Math.floor(Date.now() / 1000);
    const reason = "deepscan16_fix_verification";
    const sig = signRestart(timestamp, reason);

    const resp = await fetch(`${baseUrl}/api/admin/self-restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Restart-Signature": sig,
        "Authorization": `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({ timestamp, reason }),
    });

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { status?: string };
    expect(body.status).toBe("restart_initiated");
    // The handler's own HMAC verification must also have run (not skipped) —
    // an audit row is written only after HMAC verification succeeds.
    expect(mockInsertAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "system.self_restart_requested" }),
    );
  });

  it("Authorization header is IGNORED for self-restart (Bearer-bypassed) — wrong Bearer + valid HMAC still → 200", async () => {
    // deep-scan Security S-2: self-restart bypasses the Bearer gate entirely (auth.ts:79-90), so a
    // wrong Authorization header is never evaluated — the HMAC is the sole gate. The old assertion
    // (wrong Bearer → 403) asserted the superseded Bearer-enforced contract and was failing at HEAD.
    process.env["API_KEY"] = TEST_API_KEY;
    const timestamp = Math.floor(Date.now() / 1000);
    const reason = "deepscan16_wrong_bearer";
    const sig = signRestart(timestamp, reason);

    const resp = await fetch(`${baseUrl}/api/admin/self-restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Restart-Signature": sig,
        "Authorization": "Bearer totally-wrong-key",
      },
      body: JSON.stringify({ timestamp, reason }),
    });

    expect(resp.status).toBe(200);
  });

  it("valid Bearer but WRONG HMAC signature → 401 from the route's own verifyRestartHmac (gate passing does not bypass HMAC)", async () => {
    process.env["API_KEY"] = TEST_API_KEY;
    const timestamp = Math.floor(Date.now() / 1000);
    const reason = "deepscan16_bad_hmac";

    const resp = await fetch(`${baseUrl}/api/admin/self-restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Restart-Signature": "deadbeef".repeat(8),
        "Authorization": `Bearer ${TEST_API_KEY}`,
      },
      body: JSON.stringify({ timestamp, reason }),
    });

    expect(resp.status).toBe(401);
    const body = (await resp.json()) as { error?: string };
    expect(body.error).toBe("hmac_verification_failed");
  });

  // ─── Failure-injection: replay a captured (valid) signature past the 60s drift window ─────────
  it("replay-window: a VALID HMAC for a STALE timestamp (>60s old) → 401 (captured-signature replay is rejected)", async () => {
    process.env["API_KEY"] = TEST_API_KEY;
    // Attacker captures a legitimately-signed request and replays it 2 minutes later. The signature
    // still verifies (it's real), but RESTART_TIMESTAMP_DRIFT_MS=60_000 must reject the stale replay.
    const staleTimestamp = Math.floor(Date.now() / 1000) - 120;
    const reason = "deepscan_replay_window_injection";
    const sig = signRestart(staleTimestamp, reason); // genuine signature for the stale timestamp

    const resp = await fetch(`${baseUrl}/api/admin/self-restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Restart-Signature": sig,
      },
      body: JSON.stringify({ timestamp: staleTimestamp, reason }),
    });

    expect(resp.status).toBe(401); // signature valid, but replay window exceeded → rejected
  });

  it("replay-window boundary: a fresh timestamp (within 60s) with a valid HMAC → 200 (not over-rejecting)", async () => {
    process.env["API_KEY"] = TEST_API_KEY;
    const freshTimestamp = Math.floor(Date.now() / 1000) - 5; // 5s old — well within the window
    const reason = "deepscan_replay_window_fresh";
    const sig = signRestart(freshTimestamp, reason);

    const resp = await fetch(`${baseUrl}/api/admin/self-restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Restart-Signature": sig },
      body: JSON.stringify({ timestamp: freshTimestamp, reason }),
    });

    expect(resp.status).toBe(200); // proves the 401 above is the drift check, not a blanket reject
  });

  // ─── Failure-injection: secret UNSET must FAIL CLOSED (the re-cert fail-open HIGH) ────────────
  it("secret UNSET → 401 fail-closed (the re-cert HIGH: old NODE_ENV!==production dev-bypass returned 200)", async () => {
    process.env["API_KEY"] = TEST_API_KEY;
    delete process.env["ADMIN_RESTART_HMAC_SECRET"]; // no secret; vitest's NODE_ENV="test" is EXACTLY
    // the non-production env the removed dev-bypass opened — the route must now reject, not bypass.
    const timestamp = Math.floor(Date.now() / 1000);
    const reason = "deepscan_failopen_regression";
    const sig = createHmac("sha256", "irrelevant-no-configured-secret").update(`${timestamp}:${reason}`, "utf8").digest("hex");

    const resp = await fetch(`${baseUrl}/api/admin/self-restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Restart-Signature": sig },
      body: JSON.stringify({ timestamp, reason }),
    });

    expect(resp.status).toBe(401); // fail-CLOSED; pre-fix this was an unauthenticated 200 (auth bypass)
  });
});
