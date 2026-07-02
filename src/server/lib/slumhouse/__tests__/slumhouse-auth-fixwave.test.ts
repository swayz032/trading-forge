/**
 * deep-scan #12 FIX TRACK S — Slumhouse auth/session/admin-mapping/carter-session
 *
 * Tests for all 6 security fixes. Pure-function coverage does not require a DB;
 * middleware and route tests mock the DB and Express req/res.
 *
 * FIX 1: Carter session mint is admin-only
 * FIX 2: Discord identity threaded into admin audit trail
 * FIX 3: Session cookies are host-only (no domain attribute)
 * FIX 4: Session revocation via epoch field
 * FIX 5: CSRF/Origin allowlist check
 * FIX 6: admin-mapping dev-bypass hardening
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── shared test secret (≥32 chars required by session.ts / admin-session.ts) ──
const TEST_SECRET = "test-slumhouse-secret-at-least-32-chars!!";
const TEST_PASSCODE = "letmein";

// ─── helpers ─────────────────────────────────────────────────────────────────
type MockRes = {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  cookie: ReturnType<typeof vi.fn>;
  redirect?: ReturnType<typeof vi.fn>;
  _status: number | undefined;
  _json: unknown;
  _cookies: Array<{ name: string; value: string; opts: Record<string, unknown> }>;
};

function mockRes(): MockRes {
  const r: MockRes = {
    _status: undefined,
    _json: undefined,
    _cookies: [],
    status: vi.fn(),
    json: vi.fn(),
    cookie: vi.fn(),
  };
  r.status.mockImplementation((code: number) => {
    r._status = code;
    return r;
  });
  r.json.mockImplementation((body: unknown) => {
    r._json = body;
    return r;
  });
  r.cookie.mockImplementation(
    (name: string, value: string, opts: Record<string, unknown> = {}) => {
      r._cookies.push({ name, value, opts });
      return r;
    },
  );
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 4: session.ts — epoch support (pure function tests)
// ─────────────────────────────────────────────────────────────────────────────
describe("FIX 4 — session.ts epoch round-trip", () => {
  beforeEach(() => {
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.SLUMHOUSE_SESSION_SECRET;
  });

  it("signSession emits 4-part token when epoch provided", async () => {
    const { signSession } = await import("../session.js");
    const token = signSession({ discordUserId: "123456789", ttlSec: 3600, epoch: 0 });
    const parts = token.split(":");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("123456789");
    expect(parts[1]).toBe("0"); // epoch
  });

  it("verifySession returns ok=true with correct epoch for v2 token", async () => {
    const { signSession, verifySession } = await import("../session.js");
    const token = signSession({ discordUserId: "abc123", ttlSec: 3600, epoch: 2 });
    const result = verifySession(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discordUserId).toBe("abc123");
      expect(result.epoch).toBe(2);
    }
  });

  it("verifySession accepts legacy 3-part token with epoch=0", async () => {
    const { verifySession } = await import("../session.js");
    // Manually craft a v1 token (discordUserId:exp:sig)
    const discordUserId = "legacy_user";
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = `${discordUserId}:${exp}`;
    const sig = createHmac("sha256", TEST_SECRET).update(payload).digest("base64url");
    const token = `${payload}:${sig}`;
    expect(token.split(":").length).toBe(3);

    const result = verifySession(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discordUserId).toBe("legacy_user");
      expect(result.epoch).toBe(0);
    }
  });

  it("verifySession rejects tampered token", async () => {
    const { signSession, verifySession } = await import("../session.js");
    const token = signSession({ discordUserId: "user1", ttlSec: 3600, epoch: 0 });
    const parts = token.split(":");
    parts[1] = "1"; // tamper epoch
    const tampered = parts.join(":");
    const result = verifySession(tampered);
    expect(result.ok).toBe(false);
  });

  it("verifySession rejects expired token", async () => {
    const { signSession, verifySession } = await import("../session.js");
    const token = signSession({ discordUserId: "user1", ttlSec: -1, epoch: 0 });
    const result = verifySession(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("expired");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2: admin-session.ts — Discord identity threading (pure function tests)
// ─────────────────────────────────────────────────────────────────────────────
describe("FIX 2 — admin-session.ts Discord identity threading", () => {
  beforeEach(() => {
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    process.env.SLUMHOUSE_ADMIN_PASSCODE = TEST_PASSCODE;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.SLUMHOUSE_SESSION_SECRET;
    delete process.env.SLUMHOUSE_ADMIN_PASSCODE;
  });

  it("signAdminSession without discordUserId emits 3-part token (backward compat)", async () => {
    const { signAdminSession } = await import("../admin-session.js");
    const token = signAdminSession(3600);
    const parts = token.split(":");
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe("admin");
  });

  it("signAdminSession with discordUserId emits 4-part token", async () => {
    const { signAdminSession } = await import("../admin-session.js");
    const token = signAdminSession(3600, "987654321");
    const parts = token.split(":");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("admin");
    expect(parts[1]).toBe("987654321");
  });

  it("verifyAdminSession correctly verifies 4-part token and returns discordUserId", async () => {
    const { signAdminSession, verifyAdminSession } = await import("../admin-session.js");
    const token = signAdminSession(3600, "discord_user_abc");
    const result = verifyAdminSession(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discordUserId).toBe("discord_user_abc");
    }
  });

  it("verifyAdminSession correctly verifies 3-part token (backward compat) with no discordUserId", async () => {
    const { signAdminSession, verifyAdminSession } = await import("../admin-session.js");
    const token = signAdminSession(3600); // no discord user
    const result = verifyAdminSession(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.discordUserId).toBeUndefined();
    }
  });

  it("adminDiscordUserIdFromCookie returns discordUserId from 4-part admin cookie", async () => {
    const { signAdminSession, adminDiscordUserIdFromCookie } = await import("../admin-session.js");
    const token = encodeURIComponent(signAdminSession(3600, "user_xyz"));
    const cookie = `slumhouse_admin_sid=${token}`;
    expect(adminDiscordUserIdFromCookie(cookie)).toBe("user_xyz");
  });

  it("adminDiscordUserIdFromCookie returns undefined from 3-part admin cookie", async () => {
    const { signAdminSession, adminDiscordUserIdFromCookie } = await import("../admin-session.js");
    const token = encodeURIComponent(signAdminSession(3600));
    const cookie = `slumhouse_admin_sid=${token}`;
    expect(adminDiscordUserIdFromCookie(cookie)).toBeUndefined();
  });

  it("adminSessionFromCookie returns true for valid 3-part and 4-part tokens", async () => {
    const { signAdminSession, adminSessionFromCookie } = await import("../admin-session.js");
    const t3 = encodeURIComponent(signAdminSession(3600));
    const t4 = encodeURIComponent(signAdminSession(3600, "user123"));
    expect(adminSessionFromCookie(`slumhouse_admin_sid=${t3}`)).toBe(true);
    expect(adminSessionFromCookie(`slumhouse_admin_sid=${t4}`)).toBe(true);
  });

  it("adminSessionFromCookie returns false for invalid/absent cookie", async () => {
    const { adminSessionFromCookie } = await import("../admin-session.js");
    expect(adminSessionFromCookie(undefined)).toBe(false);
    expect(adminSessionFromCookie("")).toBe(false);
    expect(adminSessionFromCookie("slumhouse_admin_sid=bogus")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1: requireAdminSession middleware (exported from require-session.ts)
// ─────────────────────────────────────────────────────────────────────────────
describe("FIX 1 — requireAdminSession Express middleware", () => {
  beforeEach(() => {
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    process.env.SLUMHOUSE_ADMIN_PASSCODE = TEST_PASSCODE;
    vi.resetModules();
    // require-session.ts top-level imports db — mock it so the module loads cleanly.
    vi.doMock("../../../db/index.js", () => ({
      db: {
        select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      },
    }));
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));
  });
  afterEach(() => {
    delete process.env.SLUMHOUSE_SESSION_SECRET;
    delete process.env.SLUMHOUSE_ADMIN_PASSCODE;
    vi.restoreAllMocks();
  });

  it("calls next() when a valid admin cookie is present", async () => {
    const { signAdminSession } = await import("../admin-session.js");
    const token = encodeURIComponent(signAdminSession(3600));
    const req = { headers: { cookie: `slumhouse_admin_sid=${token}` } };
    const res = mockRes();
    const next = vi.fn();

    const { requireAdminSession } = await import("../require-session.js");
    await requireAdminSession(req as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when admin cookie is absent", async () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = vi.fn();

    const { requireAdminSession } = await import("../require-session.js");
    await requireAdminSession(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when admin cookie is expired", async () => {
    const { signAdminSession } = await import("../admin-session.js");
    const token = encodeURIComponent(signAdminSession(-1)); // already expired
    const req = { headers: { cookie: `slumhouse_admin_sid=${token}` } };
    const res = mockRes();
    const next = vi.fn();

    const { requireAdminSession } = await import("../require-session.js");
    await requireAdminSession(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("plain Discord session cookie alone does NOT satisfy requireAdminSession", async () => {
    const { signSession } = await import("../session.js");
    const discordToken = encodeURIComponent(
      signSession({ discordUserId: "friend123", ttlSec: 3600, epoch: 0 }),
    );
    const req = { headers: { cookie: `slumhouse_sid=${discordToken}` } };
    const res = mockRes();
    const next = vi.fn();

    const { requireAdminSession } = await import("../require-session.js");
    await requireAdminSession(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 4: requireSlumhouseUser — epoch revocation check (uses vi.doMock + import)
// ─────────────────────────────────────────────────────────────────────────────
describe("FIX 4 — requireSlumhouseUser epoch revocation", () => {
  beforeEach(() => {
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.SLUMHOUSE_SESSION_SECRET;
    vi.restoreAllMocks();
  });

  it("rejects session when token epoch < DB session_epoch (revoked)", async () => {
    const { signSession } = await import("../session.js");
    // Sign with epoch=0 (old token)
    const token = encodeURIComponent(
      signSession({ discordUserId: "user_abc", ttlSec: 3600, epoch: 0 }),
    );

    vi.resetModules();
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    // DB returns user with sessionEpoch=1 (revoked since signing)
    vi.doMock("../../../db/index.js", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([
              {
                discordUserId: "user_abc",
                displayName: "Test",
                sessionEpoch: 1, // bumped by revoke
              },
            ]),
          }),
        }),
      },
    }));

    const { requireSlumhouseUser } = await import("../require-session.js");

    const req = { headers: { cookie: `slumhouse_sid=${token}` } };
    const res = mockRes();
    const next = vi.fn();

    await requireSlumhouseUser(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect((res._json as Record<string, unknown>)?.error).toBe("session_revoked");
  });

  it("accepts session when token epoch matches DB session_epoch", async () => {
    const { signSession } = await import("../session.js");
    const token = encodeURIComponent(
      signSession({ discordUserId: "user_abc", ttlSec: 3600, epoch: 1 }),
    );

    vi.resetModules();
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    vi.doMock("../../../db/index.js", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([
              {
                discordUserId: "user_abc",
                displayName: "Test",
                sessionEpoch: 1, // matches
              },
            ]),
          }),
        }),
      },
    }));

    const { requireSlumhouseUser } = await import("../require-session.js");

    const req = { headers: { cookie: `slumhouse_sid=${token}` } };
    const res = mockRes();
    const next = vi.fn();

    await requireSlumhouseUser(req as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("accepts legacy 3-part token (epoch=0) when DB session_epoch is 0 (not revoked)", async () => {
    const discordUserId = "legacy";
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = `${discordUserId}:${exp}`;
    const sig = createHmac("sha256", TEST_SECRET).update(payload).digest("base64url");
    const token = encodeURIComponent(`${payload}:${sig}`);

    vi.resetModules();
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    vi.doMock("../../../db/index.js", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([
              {
                discordUserId: "legacy",
                displayName: "Legacy User",
                sessionEpoch: 0,
              },
            ]),
          }),
        }),
      },
    }));

    const { requireSlumhouseUser } = await import("../require-session.js");

    const req = { headers: { cookie: `slumhouse_sid=${token}` } };
    const res = mockRes();
    const next = vi.fn();

    await requireSlumhouseUser(req as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3: auth.ts — host-only cookies (no domain attribute)
// ─────────────────────────────────────────────────────────────────────────────
describe("FIX 3 — handleCallback emits host-only cookies (no domain attr)", () => {
  beforeEach(() => {
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.SLUMHOUSE_SESSION_SECRET;
    vi.restoreAllMocks();
  });

  it("slumhouse_sid cookie has no domain attribute on Railway host", async () => {
    vi.doMock("../discord-oauth.js", () => ({
      exchangeCodeForToken: vi.fn().mockResolvedValue("access_token"),
      fetchDiscordUser: vi.fn().mockResolvedValue({ id: "user1", displayName: "Alice" }),
    }));
    vi.doMock("../../../db/index.js", () => ({
      db: {
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ discordUserId: "user1", sessionEpoch: 0 }]) }) }),
        insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      },
    }));
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));

    const { handleCallback } = await import("../../../routes/slumhouse/auth.js");

    const req = {
      query: { code: "authcode123" },
      headers: { host: "my-app.up.railway.app" },
    };
    const res = mockRes();
    (res as MockRes & { redirect: ReturnType<typeof vi.fn> }).redirect = vi.fn();

    await handleCallback(req as never, res as never);

    const sidCookie = res._cookies.find((c) => c.name === "slumhouse_sid");
    expect(sidCookie).toBeDefined();
    // FIX 3: domain must be absent or undefined (host-only)
    expect(sidCookie?.opts?.domain).toBeUndefined();
  });

  it("slumhouse_welcome cookie has no domain attribute", async () => {
    vi.doMock("../discord-oauth.js", () => ({
      exchangeCodeForToken: vi.fn().mockResolvedValue("tok"),
      fetchDiscordUser: vi.fn().mockResolvedValue({ id: "u2", displayName: "Bob" }),
    }));
    vi.doMock("../../../db/index.js", () => ({
      db: {
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ discordUserId: "u2", sessionEpoch: 0 }]) }) }),
        insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      },
    }));
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));

    const { handleCallback } = await import("../../../routes/slumhouse/auth.js");
    const req = { query: { code: "code2" }, headers: { host: "myapp.up.railway.app" } };
    const res = mockRes();
    (res as MockRes & { redirect: ReturnType<typeof vi.fn> }).redirect = vi.fn();

    await handleCallback(req as never, res as never);

    const welcome = res._cookies.find((c) => c.name === "slumhouse_welcome");
    expect(welcome).toBeDefined();
    expect(welcome?.opts?.domain).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 5: checkSlumhouseOrigin helper
// ─────────────────────────────────────────────────────────────────────────────
describe("FIX 5 — checkSlumhouseOrigin CSRF defense", () => {
  beforeEach(() => {
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    vi.resetModules();
    delete process.env.SLUMHOUSE_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    delete process.env.SLUMHOUSE_SESSION_SECRET;
    delete process.env.SLUMHOUSE_ALLOWED_ORIGINS;
    vi.restoreAllMocks();
  });

  it("returns true (allow) when no Origin header is present", async () => {
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));
    const { checkSlumhouseOrigin } = await import("../require-session.js");

    const req = { headers: { host: "myapp.example.com" } };
    const res = mockRes();
    expect(checkSlumhouseOrigin(req as never, res as never)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns true when Origin matches SLUMHOUSE_ALLOWED_ORIGINS", async () => {
    process.env.SLUMHOUSE_ALLOWED_ORIGINS = "https://relay.myapp.com,https://myapp.local";
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));
    const { checkSlumhouseOrigin } = await import("../require-session.js");

    const req = { headers: { host: "relay.myapp.com", origin: "https://relay.myapp.com" } };
    const res = mockRes();
    expect(checkSlumhouseOrigin(req as never, res as never)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns false (403) when Origin does not match allowlist", async () => {
    process.env.SLUMHOUSE_ALLOWED_ORIGINS = "https://myapp.example.com";
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));
    const { checkSlumhouseOrigin } = await import("../require-session.js");

    const req = { headers: { host: "myapp.example.com", origin: "https://evil.attacker.com" } };
    const res = mockRes();
    expect(checkSlumhouseOrigin(req as never, res as never)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("uses request host as fallback allowlist when SLUMHOUSE_ALLOWED_ORIGINS is unset", async () => {
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));
    const { checkSlumhouseOrigin } = await import("../require-session.js");

    const req = { headers: { host: "myrelay.up.railway.app", origin: "https://myrelay.up.railway.app" } };
    const res = mockRes();
    expect(checkSlumhouseOrigin(req as never, res as never)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects cross-origin even with fallback host", async () => {
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));
    const { checkSlumhouseOrigin } = await import("../require-session.js");

    const req = {
      headers: { host: "myrelay.up.railway.app", origin: "https://other-app.up.railway.app" },
    };
    const res = mockRes();
    expect(checkSlumhouseOrigin(req as never, res as never)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 6: admin-mapping.ts — dev-bypass hardening
// ─────────────────────────────────────────────────────────────────────────────
describe("FIX 6 — admin-mapping requireKeyOrAdminSession", () => {
  beforeEach(() => {
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    process.env.SLUMHOUSE_ADMIN_PASSCODE = TEST_PASSCODE;
    vi.resetModules();
    delete process.env.API_KEY;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    delete process.env.SLUMHOUSE_SESSION_SECRET;
    delete process.env.SLUMHOUSE_ADMIN_PASSCODE;
    delete process.env.API_KEY;
    vi.restoreAllMocks();
  });

  it("blocks postSlumhouseUser with no API_KEY and no admin session (dev bypass scenario)", async () => {
    vi.doMock("../../../db/index.js", () => ({ db: {} }));
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));

    const { postSlumhouseUser } = await import("../../../routes/slumhouse/admin-mapping.js");

    const req = {
      headers: {},
      body: { discord_user_id: "u1", display_name: "Alice" },
    };
    const res = mockRes();

    await postSlumhouseUser(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows postSlumhouseUser with valid API key", async () => {
    process.env.API_KEY = "test-api-key";
    vi.doMock("../../../db/index.js", () => ({
      db: {
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: () => Promise.resolve(),
          }),
        }),
      },
    }));
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));

    const { postSlumhouseUser } = await import("../../../routes/slumhouse/admin-mapping.js");

    const req = {
      headers: { authorization: "Bearer test-api-key" },
      body: { discord_user_id: "u1", display_name: "Alice" },
    };
    const res = mockRes();

    await postSlumhouseUser(req as never, res as never);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it("allows postSlumhouseUser with valid admin session (no API_KEY)", async () => {
    const { signAdminSession } = await import("../admin-session.js");
    const adminToken = encodeURIComponent(signAdminSession(3600));

    vi.resetModules();
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    process.env.SLUMHOUSE_ADMIN_PASSCODE = TEST_PASSCODE;
    vi.doMock("../../../db/index.js", () => ({
      db: {
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: () => Promise.resolve(),
          }),
        }),
      },
    }));
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));

    const { postSlumhouseUser } = await import("../../../routes/slumhouse/admin-mapping.js");

    const req = {
      headers: { cookie: `slumhouse_admin_sid=${adminToken}` },
      body: { discord_user_id: "u2", display_name: "Bob" },
    };
    const res = mockRes();

    await postSlumhouseUser(req as never, res as never);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it("blocks listSlumhouseUsers with no credentials", async () => {
    vi.doMock("../../../db/index.js", () => ({ db: {} }));
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));

    const { listSlumhouseUsers } = await import("../../../routes/slumhouse/admin-mapping.js");
    const req = { headers: {} };
    const res = mockRes();

    await listSlumhouseUsers(req as never, res as never);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1: carter-session.ts — admin-only guard (structural + behavioral check)
// ─────────────────────────────────────────────────────────────────────────────
describe("FIX 1 — carter-session uses requireAdminSession not requireSlumhouseUserOrAdmin", () => {
  it("carter-session.ts does not import requireSlumhouseUserOrAdmin (only in comment)", () => {
    const filePath = path.resolve(
      "src/server/routes/slumhouse/api/carter-session.ts",
    );
    const content = fs.readFileSync(filePath, "utf-8");
    // The word should appear at most in a comment explaining what was REPLACED.
    // It must NOT appear in an import statement or as a middleware argument.
    const importLine = content.split("\n").find(
      (line) => line.includes("requireSlumhouseUserOrAdmin") && !line.trim().startsWith("*") && !line.trim().startsWith("//"),
    );
    expect(importLine).toBeUndefined();
    expect(content).toContain("requireAdminSession");
  });

  it("plain Discord session is rejected by carter-session requireAdminSession", async () => {
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
    vi.resetModules();
    // require-session.ts top-level imports db — mock it.
    vi.doMock("../../../db/index.js", () => ({
      db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
    }));
    vi.doMock("../../audit-log-helper.js", () => ({
      insertAuditRowSafe: vi.fn().mockResolvedValue(true),
    }));

    const { signSession } = await import("../session.js");
    const discordToken = encodeURIComponent(
      signSession({ discordUserId: "friend1", ttlSec: 3600, epoch: 0 }),
    );
    const req = { headers: { cookie: `slumhouse_sid=${discordToken}` } };
    const res = mockRes();
    const next = vi.fn();

    // requireAdminSession checks only admin_sid — discord_sid alone fails
    const { requireAdminSession } = await import("../require-session.js");
    await requireAdminSession(req as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);

    delete process.env.SLUMHOUSE_SESSION_SECRET;
  });
});
