import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the slumhouse session helpers BEFORE importing the middleware.
vi.mock("../lib/slumhouse/session.js", () => ({
  COOKIE_NAME: "slumhouse_sid",
  verifySession: vi.fn(),
}));
vi.mock("../lib/slumhouse/admin-session.js", () => ({
  adminSessionFromCookie: vi.fn(),
}));
vi.mock("../db/index.js", () => ({ db: {} }));

import { authMiddleware, _clearEpochCacheForTests } from "../middleware/auth.js";
import { verifySession } from "../lib/slumhouse/session.js";
import { adminSessionFromCookie } from "../lib/slumhouse/admin-session.js";

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn().mockImplementation((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function mockReq(over: Record<string, unknown> = {}) {
  return { method: "GET", headers: {}, ...over } as any;
}

describe("authMiddleware (deep-scan #13 Track A)", () => {
  const ORIG = { ...process.env };
  beforeEach(() => {
    vi.mocked(verifySession).mockReturnValue({ ok: false, reason: "none" } as any);
    vi.mocked(adminSessionFromCookie).mockReturnValue(false);
    delete process.env.API_KEY;
    delete process.env.AUTH_DEV_BYPASS;
    process.env.NODE_ENV = "production";
    _clearEpochCacheForTests();
  });
  afterEach(() => { process.env = { ...ORIG }; });

  it("503 auth_not_configured when no API_KEY, no cookie, no bypass", async () => {
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq(), res, next);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("does NOT bypass on NODE_ENV=development alone (relay exposes localhost publicly)", async () => {
    process.env.NODE_ENV = "development";
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });

  it("allows valid Bearer API_KEY", async () => {
    process.env.API_KEY = "secret-key-123";
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq({ headers: { authorization: "Bearer secret-key-123" } }), res, next);
    expect(next).toHaveBeenCalled();
  });

  it("403 on wrong Bearer token", async () => {
    process.env.API_KEY = "secret-key-123";
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq({ headers: { authorization: "Bearer wrong" } }), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows Office admin cookie for POST", async () => {
    process.env.API_KEY = "secret-key-123";
    vi.mocked(adminSessionFromCookie).mockReturnValue(true);
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq({ method: "POST", headers: { cookie: "slumhouse_admin_sid=x" } }), res, next);
    expect(next).toHaveBeenCalled();
  });

  it("allows valid Discord cookie for GET but rejects POST", async () => {
    process.env.API_KEY = "secret-key-123";
    vi.mocked(verifySession).mockReturnValue({ ok: true, discordUserId: "u1", epoch: 0 } as any);
    const resGet = mockRes(); const nextGet = vi.fn();
    await authMiddleware(mockReq({ headers: { cookie: "slumhouse_sid=tok" } }), resGet, nextGet);
    expect(nextGet).toHaveBeenCalled();

    const resPost = mockRes(); const nextPost = vi.fn();
    await authMiddleware(mockReq({ method: "POST", headers: { cookie: "slumhouse_sid=tok" } }), resPost, nextPost);
    expect(nextPost).not.toHaveBeenCalled();
    expect(resPost.statusCode).toBe(401);
  });

  it("AUTH_DEV_BYPASS=true allows (explicit dev only)", async () => {
    process.env.AUTH_DEV_BYPASS = "true";
    const res = mockRes(); const next = vi.fn();
    await authMiddleware(mockReq(), res, next);
    expect(next).toHaveBeenCalled();
  });
});
