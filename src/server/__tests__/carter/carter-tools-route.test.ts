/**
 * carter-tools-route.test.ts
 *
 * Integration-style tests for POST /api/carter/:tool.
 * Calls the router handler directly (no HTTP) using mock req/res.
 *
 * Test cases:
 *   1. Missing Bearer header → 401.
 *   2. Wrong Bearer token → 401.
 *   3. Unknown tool name → 404.
 *   4. Correct auth + known tool → 200 with result + audit written.
 *   5. Handler throws → 500 + carter.tool_failed audit.
 */

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async () => true),
}));

vi.mock("../../lib/carter/carter-auth.js", () => ({
  verifyCarterToolAuth: vi.fn(),
}));

vi.mock("../../lib/carter/tool-registry.js", () => ({
  getCarterTool: vi.fn(),
}));

vi.mock("../../lib/carter/carter-reads.js", () => ({
  CARTER_READ_HANDLERS: {
    report_system_health: vi.fn(async () => ({ status: "ok" })),
  },
}));

// Prevent carter-actions.ts (and its transitive db/index.js import) from
// loading in the route test — the route only exercises auth + registry + audit.
vi.mock("../../lib/carter/carter-actions.js", () => ({
  CARTER_ACTION_HANDLERS: {},
  CARTER_CONFIRM_HANDLERS: {},
}));

// Prevent carter-issues-store.ts from importing db/index.js in the route test.
vi.mock("../../lib/carter/carter-issues-store.js", () => ({
  listOpenIssues:  vi.fn(() => []),
  hydrateFromDb:   vi.fn(async () => {}),
  upsertIssue:     vi.fn(),
  resolveIssue:    vi.fn(),
  _resetForTest:   vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { insertAuditRowSafe } from "../../lib/audit-log-helper.js";
import { verifyCarterToolAuth } from "../../lib/carter/carter-auth.js";
import { getCarterTool } from "../../lib/carter/tool-registry.js";
import { CARTER_READ_HANDLERS } from "../../lib/carter/carter-reads.js";

// Import after mocks are hoisted
import { carterToolsRouter } from "../../routes/carter-tools.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(tool: string, opts: { authHeader?: string; body?: unknown } = {}): Request {
  return {
    params: { tool },
    headers: { authorization: opts.authHeader ?? "" },
    body: opts.body ?? {},
    id: "test-correlation-id",
  } as unknown as Request;
}

function makeRes() {
  let _status = 200;
  let _body: unknown = undefined;
  const res = {
    status: vi.fn().mockImplementation((code: number) => { _status = code; return res; }),
    json:   vi.fn().mockImplementation((body: unknown) => { _body = body; }),
    getStatus: () => _status,
    getBody:   () => _body,
  };
  return res as unknown as Response & { getStatus: () => number; getBody: () => unknown };
}

/** Fire the route for the given POST /:tool request. */
async function callRoute(req: Request, res: Response): Promise<void> {
  // The router has one route: POST /:tool. Find and call its handler.
  const layer = (carterToolsRouter as unknown as { stack: Array<{ route: { path: string; stack: Array<{ handle: (r: Request, rs: Response) => Promise<void> }> } }> }).stack.find(
    (l) => l.route?.path === "/:tool"
  );
  if (!layer) throw new Error("Route /:tool not registered on carterToolsRouter");
  await layer.route.stack[0].handle(req, res);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/carter/:tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: auth passes, tool known and green, handler succeeds
    vi.mocked(verifyCarterToolAuth).mockReturnValue({ ok: true });
    vi.mocked(getCarterTool).mockReturnValue({
      name: "report_system_health",
      description: "test",
      tier: "green",
      handler: "report_system_health",
    });
    vi.mocked(CARTER_READ_HANDLERS["report_system_health"]).mockResolvedValue({ status: "ok" });
  });

  it("returns 401 when Authorization header is missing", async () => {
    vi.mocked(verifyCarterToolAuth).mockReturnValue({ ok: false, reason: "missing_bearer_header" });
    const req = makeReq("report_system_health", { authHeader: undefined });
    const res = makeRes();
    await callRoute(req, res as unknown as Response);
    expect(res.getStatus()).toBe(401);
    expect((res.getBody() as { error: string }).error).toBe("unauthorized");
  });

  it("returns 401 when Bearer token is wrong", async () => {
    vi.mocked(verifyCarterToolAuth).mockReturnValue({ ok: false, reason: "token_mismatch" });
    const req = makeReq("report_system_health", { authHeader: "Bearer wrong-token" });
    const res = makeRes();
    await callRoute(req, res as unknown as Response);
    expect(res.getStatus()).toBe(401);
    expect((res.getBody() as { reason: string }).reason).toBe("token_mismatch");
  });

  it("returns 404 when tool name is unknown", async () => {
    vi.mocked(getCarterTool).mockReturnValue(undefined);
    const req = makeReq("nonexistent_tool", { authHeader: "Bearer correct-token" });
    const res = makeRes();
    await callRoute(req, res as unknown as Response);
    expect(res.getStatus()).toBe(404);
    expect((res.getBody() as { error: string }).error).toBe("tool_not_found");
  });

  it("returns 200 with result and writes carter.tool_invoked audit on success", async () => {
    const req = makeReq("report_system_health", {
      authHeader: "Bearer correct-token",
      body: {},
    });
    const res = makeRes();
    await callRoute(req, res as unknown as Response);

    expect(res.getStatus()).toBe(200);
    const body = res.getBody() as { tool: string; result: { status: string }; durationMs: number };
    expect(body.tool).toBe("report_system_health");
    expect(body.result).toEqual({ status: "ok" });
    expect(typeof body.durationMs).toBe("number");

    expect(vi.mocked(insertAuditRowSafe)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "carter.tool_invoked",
        status: "success",
        decisionAuthority: "voice_agent",
      })
    );
  });

  it("returns 500 and writes carter.tool_failed audit when handler throws", async () => {
    vi.mocked(CARTER_READ_HANDLERS["report_system_health"]).mockRejectedValue(
      new Error("simulated_handler_failure")
    );
    const req = makeReq("report_system_health", { authHeader: "Bearer correct-token" });
    const res = makeRes();
    await callRoute(req, res as unknown as Response);

    expect(res.getStatus()).toBe(500);
    const body = res.getBody() as { error: string; message: string };
    expect(body.error).toBe("tool_execution_failed");
    expect(body.message).toBe("simulated_handler_failure");

    expect(vi.mocked(insertAuditRowSafe)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "carter.tool_failed",
        status: "failure",
        errorMessage: "simulated_handler_failure",
        decisionAuthority: "voice_agent",
      })
    );
  });
});
