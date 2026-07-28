import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  officeUsers: vi.fn(),
}));

vi.mock("../../lib/slumhouse/session.js", () => ({
  verifySession: mocks.verifySession,
}));
vi.mock("../../db/index.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => mocks.officeUsers() }) }) }),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock("../../lib/slumhouse/discord-oauth.js", () => ({
  exchangeCodeForToken: vi.fn(),
  fetchDiscordUser: vi.fn(),
}));
vi.mock("../../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: vi.fn(),
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function mockRes() {
  const res: any = {
    statusCode: 200,
    redirectTo: null as string | null,
    redirect(code: number, url?: string) {
      this.statusCode = code;
      this.redirectTo = url ?? String(code);
      return this;
    },
  };
  return res;
}

describe("slumhouse router fallback", () => {
  beforeEach(() => {
    process.env.SLUMHOUSE_SESSION_SECRET = "test-secret-32-chars-min-xxxxxxxxxx";
    mocks.verifySession.mockReset();
    mocks.officeUsers.mockReset();
  });

  it("sends signed-in users to crib when an unknown html route is hit", async () => {
    mocks.verifySession.mockReturnValue({ ok: true, discordUserId: "111" });
    const { handleSlumhouseFallback } = await import("../../routes/slumhouse/index.js");
    const req: any = {
      method: "GET",
      path: "/old-stale-path",
      originalUrl: "/slumhouse/old-stale-path",
      headers: { accept: "text/html", cookie: "slumhouse_sid=good" },
    };
    const res = mockRes();
    let nextCalled = false;
    handleSlumhouseFallback(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toBe("/slumhouse/crib.html");
  });

  it("sends anonymous users to login when an unknown html route is hit", async () => {
    const { handleSlumhouseFallback } = await import("../../routes/slumhouse/index.js");
    const req: any = {
      method: "GET",
      path: "/old-stale-path",
      originalUrl: "/slumhouse/old-stale-path",
      headers: { accept: "text/html" },
    };
    const res = mockRes();
    let nextCalled = false;
    handleSlumhouseFallback(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(302);
    expect(res.redirectTo).toBe("/slumhouse/login.html");
  });

  it("redirects a signed-in member away from the operator Office shell", async () => {
    mocks.verifySession.mockReturnValue({ ok: true, discordUserId: "111", epoch: 2 });
    mocks.officeUsers.mockResolvedValue([{ jerseyNumber: 25, sessionEpoch: 2 }]);
    const { redirectMemberFromOperatorOffice } = await import("../../routes/slumhouse/index.js");
    const req: any = { headers: { cookie: "slumhouse_sid=good" } };
    const res = mockRes();
    let nextCalled = false;
    await redirectMemberFromOperatorOffice(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.redirectTo).toBe("/slumhouse/member-office.html");
  });

  it("leaves jersey zero on the passcode-gated operator Office", async () => {
    mocks.verifySession.mockReturnValue({ ok: true, discordUserId: "111", epoch: 0 });
    mocks.officeUsers.mockResolvedValue([{ jerseyNumber: 0, sessionEpoch: 0 }]);
    const { redirectMemberFromOperatorOffice } = await import("../../routes/slumhouse/index.js");
    const req: any = { headers: { cookie: "slumhouse_sid=good" } };
    const res = mockRes();
    let nextCalled = false;
    await redirectMemberFromOperatorOffice(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.redirectTo).toBeNull();
  });

  it("lets an Office admin session open the shared evidence-vault shell", async () => {
    const { signAdminSession } = await import("../../lib/slumhouse/admin-session.js");
    const { gateEvidenceVaultHtml } = await import("../../routes/slumhouse/index.js");
    const token = signAdminSession(60);
    const req: any = { headers: { cookie: `slumhouse_admin_sid=${token}` } };
    const res = mockRes();
    let nextCalled = false;
    gateEvidenceVaultHtml(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.redirectTo).toBeNull();
  });

  it("still redirects an anonymous evidence-vault request to login", async () => {
    const { gateEvidenceVaultHtml } = await import("../../routes/slumhouse/index.js");
    const req: any = { headers: {} };
    const res = mockRes();
    let nextCalled = false;
    gateEvidenceVaultHtml(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.redirectTo).toBe("/slumhouse/login.html");
  });
});
