import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
}));

vi.mock("../../lib/slumhouse/session.js", () => ({
  verifySession: mocks.verifySession,
}));
vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(),
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
});
