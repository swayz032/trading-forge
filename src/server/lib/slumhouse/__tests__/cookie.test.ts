/**
 * Duplicate-cookie hardening — OPS-experience campaign (OR-190, 4 OPS sites).
 *
 * The defect class: the historical idiom `header.match(/(?:^|;\s*)NAME=([^;]+)/)`
 * is NON-GLOBAL and returns the FIRST match, so `Cookie: NAME=FORGED; NAME=LEGIT`
 * makes the call site read FORGED. `readSlumhouseCookie` rejects on duplicate
 * (fail closed) and is routed through at the 4 OPS sites.
 *
 * These tests PRESENT THE HOSTILE INPUT (a duplicate-name Cookie header) — a
 * happy-path test that only ever sends one cookie proves nothing about this bug.
 * The bite is mutation-proven: reverting cookie.ts to first-match turns the
 * `toBeNull()` / "redirects to login" assertions RED.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readSlumhouseCookie } from "../cookie.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// 1. Unit — the guard logic bites on the hostile input
// ─────────────────────────────────────────────────────────────────────────────
describe("readSlumhouseCookie — duplicate-aware parse", () => {
  it("★ BITE: forged-first-then-legit is REJECTED (not the forged value)", () => {
    // The whole bug: first-match returned "FORGED". Reject-on-duplicate -> null.
    expect(
      readSlumhouseCookie("slumhouse_sid=FORGED; slumhouse_sid=LEGIT", "slumhouse_sid"),
    ).toBeNull();
  });

  it("★ BITE: duplicate is rejected regardless of order (legit-first too)", () => {
    expect(
      readSlumhouseCookie("slumhouse_sid=LEGIT; slumhouse_sid=FORGED", "slumhouse_sid"),
    ).toBeNull();
  });

  it("rejects a duplicate even when other cookies sit between the two", () => {
    expect(
      readSlumhouseCookie("slumhouse_sid=A; foo=1; slumhouse_sid=B", "slumhouse_sid"),
    ).toBeNull();
  });

  it("rejects a duplicate where the first value is empty (NAME=; NAME=x)", () => {
    // Any same-name pair counts toward the duplicate check.
    expect(readSlumhouseCookie("slumhouse_sid=; slumhouse_sid=LEGIT", "slumhouse_sid")).toBeNull();
  });

  it("CONTROL: a single legitimate cookie still works (guard discriminates)", () => {
    // If this returned null too, the guard would be a useless deny-all.
    expect(readSlumhouseCookie("slumhouse_sid=LEGIT", "slumhouse_sid")).toBe("LEGIT");
  });

  it("CONTROL: a single cookie surrounded by unrelated cookies works", () => {
    expect(
      readSlumhouseCookie("a=1; slumhouse_sid=LEGIT; b=2", "slumhouse_sid"),
    ).toBe("LEGIT");
  });

  it("tolerates whitespace after ';' (RFC cookie-pair separator)", () => {
    expect(readSlumhouseCookie("a=1;slumhouse_sid=X", "slumhouse_sid")).toBe("X");
    expect(readSlumhouseCookie("a=1;   slumhouse_sid=X", "slumhouse_sid")).toBe("X");
  });

  it("returns null when the name is absent", () => {
    expect(readSlumhouseCookie("other=1; another=2", "slumhouse_sid")).toBeNull();
    expect(readSlumhouseCookie("", "slumhouse_sid")).toBeNull();
    expect(readSlumhouseCookie(undefined, "slumhouse_sid")).toBeNull();
    expect(readSlumhouseCookie(null, "slumhouse_sid")).toBeNull();
  });

  it("does not confuse a name that is a prefix/suffix of another", () => {
    // xslumhouse_sid / slumhouse_sidX must not match slumhouse_sid.
    expect(readSlumhouseCookie("xslumhouse_sid=A", "slumhouse_sid")).toBeNull();
    expect(readSlumhouseCookie("slumhouse_sidX=A", "slumhouse_sid")).toBeNull();
    // ...and the real one still resolves next to the decoys, not as a duplicate.
    expect(
      readSlumhouseCookie("slumhouse_sidX=A; slumhouse_sid=REAL", "slumhouse_sid"),
    ).toBe("REAL");
  });

  it("preserves values containing '=' (splits on the FIRST '=' only)", () => {
    // Signed/base64 tokens can carry '='. Greedy split would corrupt them.
    expect(readSlumhouseCookie("slumhouse_sid=a:b=c=d", "slumhouse_sid")).toBe("a:b=c=d");
  });

  it("decodes percent-encoding, matching the old per-site decodeURIComponent", () => {
    expect(readSlumhouseCookie("slumhouse_sid=a%20b", "slumhouse_sid")).toBe("a b");
  });

  it("fails closed on malformed percent-encoding (garbage header cannot throw)", () => {
    expect(readSlumhouseCookie("slumhouse_sid=%ZZ", "slumhouse_sid")).toBeNull();
  });

  it("parameterized name works (member-office PIN cookie path)", () => {
    expect(readSlumhouseCookie("slumhouse_pin=T", "slumhouse_pin")).toBe("T");
    expect(readSlumhouseCookie("slumhouse_pin=A; slumhouse_pin=B", "slumhouse_pin")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Wiring — every OPS site actually routes through the helper (no raw idiom)
//    If any of the 4 sites regresses to the first-match regex, `(?:^|;` reappears
//    and this test goes RED.
// ─────────────────────────────────────────────────────────────────────────────
describe("OPS call-site wiring", () => {
  const opsFiles: Array<[string, string]> = [
    ["auth.ts", "../../../routes/slumhouse/auth.ts"],
    ["index.ts", "../../../routes/slumhouse/index.ts"],
    ["member-office.ts", "../../../routes/slumhouse/api/member-office.ts"],
  ];

  for (const [label, rel] of opsFiles) {
    it(`${label} routes cookie reads through readSlumhouseCookie`, () => {
      const src = fs.readFileSync(path.resolve(here, rel), "utf8");
      expect(src).toContain("readSlumhouseCookie");
      // The vulnerable non-global boundary idiom must be gone from this file.
      expect(src.includes("(?:^|;")).toBe(false);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. End-to-end BITE at a real call site — handleLaunch (auth.ts:172).
//    Presents `Cookie: slumhouse_sid=FORGED; slumhouse_sid=LEGIT` to the actual
//    exported handler and asserts it does NOT authenticate the forged session.
//    (DATABASE_URL is a dummy — handleLaunch runs no query; the postgres pool is
//    lazy, so importing auth.js never connects.)
// ─────────────────────────────────────────────────────────────────────────────
describe("handleLaunch — real call site rejects duplicate session cookie", () => {
  const TEST_SECRET = "test-slumhouse-secret-at-least-32-chars!!";
  const savedDb = process.env.DATABASE_URL;
  const savedSecret = process.env.SLUMHOUSE_SESSION_SECRET;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://u:p@127.0.0.1:5432/dummy";
    process.env.SLUMHOUSE_SESSION_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    if (savedDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDb;
    if (savedSecret === undefined) delete process.env.SLUMHOUSE_SESSION_SECRET;
    else process.env.SLUMHOUSE_SESSION_SECRET = savedSecret;
  });

  function mockRes() {
    const redirects: Array<{ status: number; url: string }> = [];
    return {
      redirects,
      redirect(status: number, url: string) {
        redirects.push({ status, url });
      },
    };
  }

  it("★ BITE: two distinct VALID sessions (forged-first) → login, not crib", async () => {
    const { handleLaunch } = await import("../../../routes/slumhouse/auth.js");
    const { signSession } = await import("../session.js");
    const forged = signSession({ discordUserId: "attacker-111", ttlSec: 3600, epoch: 0 });
    const legit = signSession({ discordUserId: "victim-222", ttlSec: 3600, epoch: 0 });
    const req = { headers: { cookie: `slumhouse_sid=${forged}; slumhouse_sid=${legit}` } };
    const res = mockRes();

    handleLaunch(req as never, res as never);

    // Rejected: bounced to login. Under first-match it would land on the crib
    // authenticated as the forged (attacker) session.
    expect(res.redirects).toEqual([{ status: 302, url: "/slumhouse/login.html" }]);
    expect(res.redirects.some((r) => r.url === "/slumhouse/crib.html")).toBe(false);
  });

  it("CONTROL: a single valid session authenticates (→ crib)", async () => {
    const { handleLaunch } = await import("../../../routes/slumhouse/auth.js");
    const { signSession } = await import("../session.js");
    const legit = signSession({ discordUserId: "member-333", ttlSec: 3600, epoch: 0 });
    const req = { headers: { cookie: `slumhouse_sid=${legit}` } };
    const res = mockRes();

    handleLaunch(req as never, res as never);

    expect(res.redirects).toEqual([{ status: 302, url: "/slumhouse/crib.html" }]);
  });
});
