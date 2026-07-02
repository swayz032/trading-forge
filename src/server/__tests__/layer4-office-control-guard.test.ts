/**
 * layer4-office-control-guard.test.ts
 *
 * Layer-4 Office P0 follow-up — shared Office control-authority guard
 * (src/server/lib/office-control-guard.ts) protecting:
 *   - POST /api/admin/pipeline/{start,pause,vacation}   (admin.ts)
 *   - POST /api/strategies/:id/deploy + /reject-deploy  (strategies.ts)
 *
 * Covers:
 *   - PASS: valid Office admin session cookie
 *   - PASS: direct loopback (127.0.0.1 / ::1 / ::ffff:127.0.0.1) with NO
 *     x-forwarded-for (operator curl on the tower)
 *   - BLOCK: loopback WITH x-forwarded-for (relay-forwarded public traffic)
 *     → 401 office_only + blocked-attempt audit row under the caller's action
 *   - BLOCK: non-loopback remote without cookie
 *   - source contract: all 5 gated routes actually invoke the guard
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../lib/slumhouse/admin-session.js", () => ({
  adminSessionFromCookie: vi.fn(),
}));

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(async () => true),
}));

import { adminSessionFromCookie } from "../lib/slumhouse/admin-session.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { requireOfficeControlAuthority } from "../lib/office-control-guard.js";

function makeReq(opts: {
  cookie?: string;
  remote?: string;
  forwarded?: string;
  path?: string;
  id?: string;
} = {}): any {
  const headers: Record<string, string> = { cookie: opts.cookie ?? "" };
  if (opts.forwarded) headers["x-forwarded-for"] = opts.forwarded;
  return {
    headers,
    socket: { remoteAddress: opts.remote ?? "203.0.113.7" },
    path: opts.path ?? "/pipeline/pause",
    id: opts.id ?? "corr-1",
  };
}

function makeRes() {
  let capturedStatus = 200;
  let capturedBody: unknown = null;
  const res = {
    status: vi.fn().mockImplementation((code: number) => { capturedStatus = code; return res; }),
    json: vi.fn().mockImplementation((b: unknown) => { capturedBody = b; }),
    getStatus: () => capturedStatus,
    getBody: () => capturedBody as Record<string, unknown>,
  };
  return res;
}

describe("requireOfficeControlAuthority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminSessionFromCookie).mockReturnValue(false);
  });

  it("PASSES with a valid Office admin session cookie (any remote)", () => {
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
    const res = makeRes();
    const ok = requireOfficeControlAuthority(
      makeReq({ cookie: "slumhouse_admin_sid=x", remote: "203.0.113.7" }),
      res as any,
      "test.blocked",
    );
    expect(ok).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
    expect(insertAuditRowSafe).not.toHaveBeenCalled();
  });

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "PASSES on direct loopback %s with no x-forwarded-for (operator curl)",
    (remote) => {
      const res = makeRes();
      const ok = requireOfficeControlAuthority(makeReq({ remote }), res as any, "test.blocked");
      expect(ok).toBe(true);
      expect(res.status).not.toHaveBeenCalled();
    },
  );

  it("BLOCKS loopback WITH x-forwarded-for (relay-forwarded traffic) — 401 office_only + audit", () => {
    const res = makeRes();
    const ok = requireOfficeControlAuthority(
      makeReq({ remote: "127.0.0.1", forwarded: "198.51.100.9", path: "/pipeline/start", id: "corr-7" }),
      res as any,
      "admin.pipeline_mutation_blocked",
    );
    expect(ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.getBody().error).toBe("office_only");
    expect(insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.pipeline_mutation_blocked",
        decisionAuthority: "gate",
        status: "warning",
        correlationId: "corr-7",
        input: expect.objectContaining({
          path: "/pipeline/start",
          remote: "127.0.0.1",
          forwarded: "198.51.100.9",
        }),
      }),
    );
  });

  it("BLOCKS non-loopback remote without cookie — 401 office_only + audit under caller action", () => {
    const res = makeRes();
    const ok = requireOfficeControlAuthority(
      makeReq({ remote: "203.0.113.7", path: "/abc123/deploy" }),
      res as any,
      "strategy.deploy_mutation_blocked",
    );
    expect(ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.getBody().error).toBe("office_only");
    expect(res.getBody().message).toContain("Slumhouse Office");
    expect(insertAuditRowSafe).toHaveBeenCalledWith(
      expect.objectContaining({ action: "strategy.deploy_mutation_blocked" }),
    );
  });

  it("fail-closed: cookie-verification errors read as no session (guard blocks)", () => {
    vi.mocked(adminSessionFromCookie).mockImplementation(() => {
      // adminSessionFromCookie itself never throws (internal try/catch) — this
      // asserts the guard treats a false return as locked, the fail-closed path.
      return false;
    });
    const res = makeRes();
    const ok = requireOfficeControlAuthority(makeReq({ cookie: "slumhouse_admin_sid=tampered" }), res as any, "test.blocked");
    expect(ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("source contract — gated routes invoke the shared guard", () => {
  const read = (p: string) =>
    readFileSync(path.resolve(process.cwd(), p), "utf8");

  it("admin.ts pipeline mutations call requirePipelineControlAuthority (shared guard delegate)", () => {
    const src = read("src/server/routes/admin.ts");
    expect(src).toContain('requireOfficeControlAuthority(req, res, "admin.pipeline_mutation_blocked")');
    // each of the 3 mutation routes guards before work
    const starts = [...src.matchAll(/adminRoutes\.post\("\/pipeline\/(start|pause|vacation)", async \(req, res\) => \{\s*\n\s*if \(!requirePipelineControlAuthority\(req, res\)\) return;/g)];
    expect(starts.map((m) => m[1]).sort()).toEqual(["pause", "start", "vacation"]);
  });

  it("strategies.ts deploy + reject-deploy call the shared guard first", () => {
    const src = read("src/server/routes/strategies.ts");
    const guarded = [...src.matchAll(/strategyRoutes\.post\("\/:id\/(deploy|reject-deploy)", async \(req, res\) => \{\s*\n\s*if \(!requireOfficeControlAuthority\(req, res, "strategy\.deploy_mutation_blocked"\)\) return;/g)];
    expect(guarded.map((m) => m[1]).sort()).toEqual(["deploy", "reject-deploy"]);
  });
});
