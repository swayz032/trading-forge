import { describe, it, expect, beforeEach } from "vitest";
import { signSession, verifySession, COOKIE_NAME } from "../../lib/slumhouse/session.js";

describe("slumhouse session", () => {
  beforeEach(() => { process.env.SLUMHOUSE_SESSION_SECRET = "test-secret-32-chars-min-xxxxxxxxxx"; });

  it("signs and verifies a session cookie roundtrip", () => {
    const token = signSession({ discordUserId: "111", ttlSec: 60 });
    const parsed = verifySession(token);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.discordUserId).toBe("111");
  });

  it("rejects tampered tokens", () => {
    const token = signSession({ discordUserId: "111", ttlSec: 60 });
    const tampered = token.slice(0, -3) + "XYZ";
    expect(verifySession(tampered).ok).toBe(false);
  });

  it("rejects expired tokens", () => {
    const token = signSession({ discordUserId: "111", ttlSec: -1 });
    expect(verifySession(token).ok).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifySession("garbage").ok).toBe(false);
    expect(verifySession("foo:bar").ok).toBe(false);
    expect(verifySession("").ok).toBe(false);
  });

  it("rejects when secret missing", () => {
    delete process.env.SLUMHOUSE_SESSION_SECRET;
    expect(() => signSession({ discordUserId: "111", ttlSec: 60 })).toThrow(/SLUMHOUSE_SESSION_SECRET/);
  });

  it("rejects when secret too short", () => {
    process.env.SLUMHOUSE_SESSION_SECRET = "tooshort";
    expect(() => signSession({ discordUserId: "111", ttlSec: 60 })).toThrow(/SLUMHOUSE_SESSION_SECRET/);
  });

  it("COOKIE_NAME is stable", () => {
    expect(COOKIE_NAME).toBe("slumhouse_sid");
  });

  it("two different secrets produce two different signatures", () => {
    process.env.SLUMHOUSE_SESSION_SECRET = "secret-a-32-chars-minimum-xxxxxxxx";
    const a = signSession({ discordUserId: "111", ttlSec: 60 });
    process.env.SLUMHOUSE_SESSION_SECRET = "secret-b-32-chars-minimum-yyyyyyyy";
    expect(verifySession(a).ok).toBe(false);
  });
});
