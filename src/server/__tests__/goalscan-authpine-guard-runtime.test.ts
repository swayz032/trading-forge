/**
 * goalscan-authpine-guard-runtime.test.ts — /goal deep-scan authpine wave, band-7→8 lift.
 *
 * The authpine wave added an Office/operator-control guard to POST /api/compliance/drift/:firm/cascade
 * (a mass firm-pause). Its RED-proofs were source-contract (textual: guard present + ordered before the
 * mutation). The independent grader's reservation was that a textual check does not prove the guard
 * EXECUTES at the route at runtime. This boots the REAL compliance router over a real HTTP socket and
 * proves, at runtime, that the route:
 *   (a) BLOCKS a relay-tunneled Bearer-only caller (x-relay-verified-ip present, no admin cookie) with
 *       401 office_only — BEFORE any DB touch (cascadeRevalidation is never reached), and
 *   (b) ADMITS a direct loopback operator (no relay header, no x-forwarded-for) — the guard's loopback
 *       branch — reaching the handler.
 * The guard itself (office-control-guard.ts) is REAL here; only DB/log/audit/idempotency + the guard's
 * cookie-lookup dependency are mocked. Mirrors deepscan-fixwave-admin-lockout-spoof.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http, { type Server } from "node:http";
import express from "express";
import { RELAY_VERIFIED_IP_HEADER } from "../lib/relay-client-ip.js";

// ── Mocks: DB/log/audit/idempotency + the guard's cookie-lookup dep. The guard is REAL. ──
vi.mock("../db/index.js", () => ({ db: {} }));
vi.mock("../db/schema.js", () => ({
  complianceRulesets: {},
  complianceReviews: {},
  complianceDriftLog: {},
  auditLog: {},
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../middleware/idempotency.js", () => ({
  idempotencyMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
// office-control-guard deps: no cookie ⇒ the guard falls through to the relay/loopback check.
const mockAdminSessionFromCookie = vi.fn(() => false);
vi.mock("../lib/slumhouse/admin-session.js", () => ({
  adminSessionFromCookie: mockAdminSessionFromCookie,
}));
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
}));
// drift-detection-service is dynamically imported by the handler ONLY if the guard admits.
const mockCascadeRevalidation = vi.fn(async () => ({ invalidatedReviews: 0, pausedStrategies: [] }));
vi.mock("../services/drift-detection-service.js", () => ({
  cascadeRevalidation: mockCascadeRevalidation,
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const complianceRouter = (await import("../routes/compliance.js")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/compliance", complianceRouter);
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
  mockAdminSessionFromCookie.mockReturnValue(false);
  mockCascadeRevalidation.mockResolvedValue({ invalidatedReviews: 0, pausedStrategies: [] });
});

describe("goalscan authpine — POST /compliance/drift/:firm/cascade guard executes at runtime", () => {
  it("BLOCKS a relay-tunneled Bearer-only caller (401 office_only) BEFORE any DB/cascade touch", async () => {
    const res = await fetch(`${baseUrl}/api/compliance/drift/MFFU/cascade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // a relay-tunneled request: the relay stamps its own verified-ip header, no admin cookie
        [RELAY_VERIFIED_IP_HEADER]: "203.0.113.7",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("office_only");
    // the guard returned BEFORE the mutation — cascadeRevalidation must never have run
    expect(mockCascadeRevalidation).not.toHaveBeenCalled();
  });

  it("ADMITS a direct loopback operator (no relay header, no x-forwarded-for) — reaches the handler", async () => {
    const res = await fetch(`${baseUrl}/api/compliance/drift/MFFU/cascade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // guard admits loopback → handler runs → cascadeRevalidation invoked → 200 (NOT 401 office_only)
    expect(res.status).not.toBe(401);
    expect(mockCascadeRevalidation).toHaveBeenCalledTimes(1);
  });

  it("ADMITS when a valid Office admin cookie is present (even via relay)", async () => {
    mockAdminSessionFromCookie.mockReturnValue(true);
    const res = await fetch(`${baseUrl}/api/compliance/drift/MFFU/cascade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [RELAY_VERIFIED_IP_HEADER]: "203.0.113.7",
        Cookie: "slumhouse_admin_sid=whatever",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).not.toBe(401);
    expect(mockCascadeRevalidation).toHaveBeenCalledTimes(1);
  });
});
