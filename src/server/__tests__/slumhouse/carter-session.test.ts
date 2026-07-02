import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// require-session.ts (transitively imported by the route) pulls in db/index.js,
// which throws at import time if DATABASE_URL is unset. Mock it — these tests
// call postCarterSession directly and never exercise the DB.
vi.mock("../../db/index.js", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
}));

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
  };
  return res;
}

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = "sk_test_key";
  process.env.CARTER_AGENT_ID = "agent_test123";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("carter-session token-mint route", () => {
  it("returns 503 elevenlabs_api_key_missing when ELEVENLABS_API_KEY unset", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const { postCarterSession } = await import("../../routes/slumhouse/api/carter-session.js");
    const req: any = { headers: {}, slumhouseUser: { discordUserId: "111" } };
    const res = mockRes();
    await postCarterSession(req, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe("elevenlabs_api_key_missing");
  });

  it("returns { conversationToken } when ElevenLabs resolves a token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: "x" }) }));
    const { postCarterSession } = await import("../../routes/slumhouse/api/carter-session.js");
    const req: any = { headers: {}, slumhouseUser: { discordUserId: "111" } };
    const res = mockRes();
    await postCarterSession(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ conversationToken: "x" });
  });

  it("returns 502 elevenlabs_upstream_failed when ElevenLabs responds !ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    }));
    const { postCarterSession } = await import("../../routes/slumhouse/api/carter-session.js");
    const req: any = { headers: {}, slumhouseUser: { discordUserId: "111" } };
    const res = mockRes();
    await postCarterSession(req, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe("elevenlabs_upstream_failed");
    expect(res.body.status).toBe(429);
  });

  it("returns 502 elevenlabs_no_token when response JSON has no token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    const { postCarterSession } = await import("../../routes/slumhouse/api/carter-session.js");
    const req: any = { headers: {}, slumhouseUser: { discordUserId: "111" } };
    const res = mockRes();
    await postCarterSession(req, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe("elevenlabs_no_token");
  });

  it("wires requireAdminSession middleware on the POST route (FIX 1)", async () => {
    const { carterSessionRouter } = await import("../../routes/slumhouse/api/carter-session.js");
    const layer = (carterSessionRouter as any).stack.find(
      (l: any) => l.route?.path === "/slumhouse/api/carter-session",
    );
    expect(layer).toBeTruthy();
    const handlerNames: string[] = layer.route.stack.map((s: any) => s.handle.name);
    expect(handlerNames).toContain("requireAdminSession");
    expect(handlerNames).toContain("postCarterSession");
  });
});

describe("requireSlumhouseUserOrAdmin auth-OR behavior", () => {
  const SECRET = "x".repeat(40); // ≥32 chars for both session secrets

  beforeEach(() => {
    process.env.SLUMHOUSE_SESSION_SECRET = SECRET;
    process.env.SLUMHOUSE_ADMIN_PASSCODE = "1974";
  });

  function mockNext() {
    const fn: any = vi.fn();
    return fn;
  }

  it("passes through when ONLY the admin (Office passcode) session is present", async () => {
    const { signAdminSession } = await import("../../lib/slumhouse/admin-session.js");
    const { requireSlumhouseUserOrAdmin } = await import("../../lib/slumhouse/require-session.js");
    const token = signAdminSession();
    const req: any = { headers: { cookie: `slumhouse_admin_sid=${encodeURIComponent(token)}` } };
    const res = mockRes();
    const next = mockNext();
    await requireSlumhouseUserOrAdmin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200); // never wrote an error status
  });

  it("falls back to the Discord session path and 401s when NEITHER session is present", async () => {
    const { requireSlumhouseUserOrAdmin } = await import("../../lib/slumhouse/require-session.js");
    const req: any = { headers: {} };
    const res = mockRes();
    const next = mockNext();
    await requireSlumhouseUserOrAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("no_session");
  });

  it("rejects a forged/invalid admin cookie (fail-closed) and falls back to 401", async () => {
    const { requireSlumhouseUserOrAdmin } = await import("../../lib/slumhouse/require-session.js");
    const req: any = { headers: { cookie: "slumhouse_admin_sid=admin:9999999999:not-a-real-sig" } };
    const res = mockRes();
    const next = mockNext();
    await requireSlumhouseUserOrAdmin(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
