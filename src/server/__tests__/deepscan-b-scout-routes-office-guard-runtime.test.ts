/**
 * deepscan-b-scout-routes-office-guard-runtime.test.ts
 *
 * FILE: src/server/routes/admin.ts (MED, confirmed) — POST /api/admin/scout/operator-ingest
 * and POST /api/admin/scout/run-autonomous-cycle were the only pipeline-mutating routes in
 * admin.ts that did NOT call requirePipelineControlAuthority (the shared office-control-guard
 * delegate every sibling pipeline-mutating route uses: /pipeline/start, /pipeline/pause,
 * /pipeline/vacation, /scheduler/jobs/:name/{enable,disable}, POST /harsh-regime-phase). They
 * sat only behind the outer Bearer/cookie authMiddleware, so any caller holding the shared
 * Bearer API_KEY (distributed to n8n workflows/scripts, not the Office operator) could invoke
 * them — exactly the non-operator actor class office-control-guard.ts exists to exclude.
 *
 * `layer4-office-control-guard.test.ts` proves the guard call is present in the source text.
 * This test proves the guard actually EXECUTES at runtime for these two routes: it boots the
 * REAL adminRoutes router (mounted the same way index.ts mounts it) with the REAL
 * office-control-guard.ts (only its cookie-lookup dependency is mocked), and drives a
 * relay-tunneled Bearer-only request (x-relay-verified-ip present, no admin cookie — the exact
 * non-operator actor class the guard exists to exclude) against both routes over a real HTTP
 * socket. Against the pre-fix code (no guard call), both requests would reach the route's own
 * try-block and either 400 (operator-ingest: no urls) or 200 "started" (run-autonomous-cycle) —
 * never 401 office_only. This is the RED-proof: reverting the two `if (!requirePipelineControlAuthority(...))
 * return;` lines makes this test fail.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http, { type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { RELAY_VERIFIED_IP_HEADER } from "../lib/relay-client-ip.js";

// ── Mocks: admin.ts's heavy module-scope dependencies (DB/services/log/audit). The
// office-control-guard itself is REAL — only its cookie-lookup dependency is mocked. ──
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
vi.mock("../services/notification-service.js", () => ({
  notifyCritical: vi.fn().mockResolvedValue(undefined),
  notifyWarning: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (technical: string) => technical,
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
// office-control-guard's own dependencies: no cookie ⇒ the REAL guard falls through to the
// relay/loopback check (same pattern as goalscan-authpine-guard-runtime.test.ts).
const mockAdminSessionFromCookie = vi.fn(() => false);
vi.mock("../lib/slumhouse/admin-session.js", () => ({
  adminSessionFromCookie: mockAdminSessionFromCookie,
}));
const mockInsertAuditRowSafe = vi.fn().mockResolvedValue(true);
vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRow: vi.fn().mockResolvedValue(undefined),
  insertAuditRowSafe: mockInsertAuditRowSafe,
}));
// run-autonomous-cycle dynamically imports this ONLY after the guard admits — mocked so the
// ADMIT-path test never boots the real scout pipeline (DB/Ollama/external APIs).
const mockRunAutonomousScoutCycle = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/autonomous-scout-runner.js", () => ({
  runAutonomousScoutCycle: mockRunAutonomousScoutCycle,
}));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { adminRoutes } = await import("../routes/admin.js");
  const app = express();
  app.use(express.json());
  // Minimal stand-in for the real correlationMiddleware (index.ts) — attaches req.id/req.log
  // without importing the full index.ts module graph (DB pool, schedulers, etc.).
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.id = randomUUID();
    req.log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Request["log"];
    next();
  });
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

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminSessionFromCookie.mockReturnValue(false);
  mockRunAutonomousScoutCycle.mockResolvedValue(undefined);
});

describe("admin.ts /scout/operator-ingest and /scout/run-autonomous-cycle now guard at runtime (parity with /pipeline/start|pause|vacation)", () => {
  it("POST /scout/operator-ingest BLOCKS a relay-tunneled Bearer-only caller — 401 office_only, same shape as the already-guarded siblings", async () => {
    const res = await fetch(`${baseUrl}/api/admin/scout/operator-ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [RELAY_VERIFIED_IP_HEADER]: "203.0.113.7",
      },
      body: JSON.stringify({ url: "https://youtube.com/watch?v=dQw4w9WgXcQ" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("office_only");
    expect(body.message).toContain("Slumhouse Office");
    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.pipeline_mutation_blocked", status: "warning" }),
    );
  });

  it("POST /scout/run-autonomous-cycle BLOCKS a relay-tunneled Bearer-only caller — 401 office_only, and the scout cycle is never started", async () => {
    const res = await fetch(`${baseUrl}/api/admin/scout/run-autonomous-cycle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [RELAY_VERIFIED_IP_HEADER]: "203.0.113.7",
      },
      body: "{}",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("office_only");
    expect(mockRunAutonomousScoutCycle).not.toHaveBeenCalled();
    expect(mockInsertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "admin.pipeline_mutation_blocked", status: "warning" }),
    );
  });

  it("POST /scout/run-autonomous-cycle ADMITS a direct loopback operator (no relay header, no x-forwarded-for) — reaches the handler and starts the cycle", async () => {
    const res = await fetch(`${baseUrl}/api/admin/scout/run-autonomous-cycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).not.toBe(401);
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("started");
  });

  it("POST /scout/operator-ingest ADMITS a valid Office admin cookie (even via relay) — reaches past the guard to body validation", async () => {
    mockAdminSessionFromCookie.mockReturnValue(true);
    const res = await fetch(`${baseUrl}/api/admin/scout/operator-ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [RELAY_VERIFIED_IP_HEADER]: "203.0.113.7",
        Cookie: "slumhouse_admin_sid=whatever",
      },
      // no url/urls — proves we reached the route's own validation, not the guard's 401
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("Provide { url");
  });
});
