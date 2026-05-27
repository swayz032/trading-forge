import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  exchangeCodeForToken: vi.fn().mockResolvedValue("tok_123"),
  fetchDiscordUser: vi.fn().mockResolvedValue({ id: "111", username: "kee", displayName: "Kee" }),
  insertAuditRowSafe: vi.fn().mockResolvedValue(true),
  selectFn: vi.fn(),
  updateFn: vi.fn().mockReturnValue({ set: () => ({ where: () => ({ then: (fn: any) => { fn(); return { catch: () => {} }; } }) }) }),
}));

vi.mock("../../lib/slumhouse/discord-oauth.js", () => ({
  exchangeCodeForToken: mocks.exchangeCodeForToken,
  fetchDiscordUser: mocks.fetchDiscordUser,
}));

vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: mocks.insertAuditRowSafe,
}));

vi.mock("../../db/index.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: mocks.selectFn }) }),
    update: () => mocks.updateFn(),
  },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Mock req/res helpers ──────────────────────────────────────────────────
function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    redirectTo: null as string | null,
    cookies: [] as Array<{ name: string; value: string; opts: any }>,
    status(code: number) { this.statusCode = code; return this; },
    send(b: any) { this.body = b; return this; },
    json(b: any) { this.body = b; return this; },
    redirect(code: number, url?: string) {
      this.statusCode = url ? code : 302;
      this.redirectTo = url ?? String(code);
    },
    cookie(name: string, value: string, opts: any = {}) { this.cookies.push({ name, value, opts }); return this; },
  };
  return res;
}

function mockReq(query: any = {}) {
  return { query, headers: {}, body: {} } as any;
}

describe("slumhouse auth routes", () => {
  beforeEach(() => {
    process.env.DISCORD_CLIENT_ID = "cid";
    process.env.DISCORD_CLIENT_SECRET = "secret";
    process.env.DISCORD_REDIRECT_URI = "https://example/cb";
    process.env.SLUMHOUSE_SESSION_SECRET = "test-secret-32-chars-min-xxxxxxxxxx";
    mocks.selectFn.mockReset();
    mocks.insertAuditRowSafe.mockClear();
  });

  it("handleLogin redirects 302 to discord authorize URL", async () => {
    const { handleLogin } = await import("../../routes/slumhouse/auth.js");
    const req = mockReq(); const res = mockRes();
    await handleLogin(req, res);
    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toContain("discord.com/api/oauth2/authorize");
    expect(res.redirectTo).toContain("client_id=cid");
    expect(res.redirectTo).toContain("response_type=code");
    expect(res.redirectTo).toContain("scope=identify");
  });

  it("handleLogin returns 500 when DISCORD_CLIENT_ID is missing", async () => {
    delete process.env.DISCORD_CLIENT_ID;
    const { handleLogin } = await import("../../routes/slumhouse/auth.js");
    const req = mockReq(); const res = mockRes();
    await handleLogin(req, res);
    expect(res.statusCode).toBe(500);
  });

  it("handleCallback with mapped user sets cookie + redirects to /slumhouse + writes login_success audit", async () => {
    mocks.selectFn.mockResolvedValueOnce([{ discordUserId: "111", brokerAccountId: "acct-1", displayName: "Kee" }]);
    const { handleCallback } = await import("../../routes/slumhouse/auth.js");
    const req = mockReq({ code: "abc" }); const res = mockRes();
    await handleCallback(req, res);
    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toBe("/slumhouse");
    expect(res.cookies).toHaveLength(1);
    expect(res.cookies[0].name).toBe("slumhouse_sid");
    expect(res.cookies[0].opts.httpOnly).toBe(true);
    expect(mocks.insertAuditRowSafe).toHaveBeenCalledWith(expect.objectContaining({ action: "slumhouse.login_success" }));
  });

  it("handleCallback with unmapped user redirects to /not-mapped + writes audit", async () => {
    mocks.selectFn.mockResolvedValueOnce([]); // no mapping
    const { handleCallback } = await import("../../routes/slumhouse/auth.js");
    const req = mockReq({ code: "abc" }); const res = mockRes();
    await handleCallback(req, res);
    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toBe("/slumhouse/not-mapped.html");
    expect(res.cookies).toHaveLength(0); // no session for unmapped
    expect(mocks.insertAuditRowSafe).toHaveBeenCalledWith(expect.objectContaining({ action: "slumhouse.login_unmapped_user" }));
  });

  it("handleCallback returns 400 when code missing", async () => {
    const { handleCallback } = await import("../../routes/slumhouse/auth.js");
    const req = mockReq({}); const res = mockRes();
    await handleCallback(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toBe("missing_code");
  });

  it("handleCallback returns 500 when discord token exchange fails", async () => {
    mocks.exchangeCodeForToken.mockRejectedValueOnce(new Error("discord_oauth_token_exchange_failed: 401"));
    const { handleCallback } = await import("../../routes/slumhouse/auth.js");
    const req = mockReq({ code: "bad" }); const res = mockRes();
    await handleCallback(req, res);
    expect(res.statusCode).toBe(500);
    expect(mocks.insertAuditRowSafe).toHaveBeenCalledWith(expect.objectContaining({ action: "slumhouse.login_failed" }));
  });

  it("handleLogout clears cookie + redirects to /login.html", async () => {
    const { handleLogout } = await import("../../routes/slumhouse/auth.js");
    const req = mockReq(); const res = mockRes();
    handleLogout(req, res);
    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toBe("/slumhouse/login.html");
    expect(res.cookies[0].name).toBe("slumhouse_sid");
    expect(res.cookies[0].value).toBe("");
    expect(res.cookies[0].opts.expires).toEqual(new Date(0));
  });
});
