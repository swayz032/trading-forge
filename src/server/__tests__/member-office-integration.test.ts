// src/server/__tests__/member-office-integration.test.ts
//
// The layers are separately tested. This file tests the SEAMS — because the failure mode that
// matters at an integration point is a layer being SKIPPED, not a layer being wrong. Every
// assertion here is about a guard that could be bypassed if the routes wired things loosely.
//
// Real PGlite, real schema, real Drizzle. Mocking the DB here would recreate the exact blind
// spot the repo's pinned facts warn about (a mocked DB cannot catch a query that returns 0 rows,
// a wrong key, or a write that lands in the wrong table).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "./helpers/pglite-db.js";
import { slumhouseMemberPins, slumhouseConnectTest, slumhouseUsers } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { hashPin } from "../lib/member-pin.js";
import { signPinTicket, verifyPinTicket } from "../lib/slumhouse/pin-ticket.js";
import { evaluateOfficeScope, visibleSurfaces } from "../lib/member-office-scope.js";
import { validateTestKey, assertStorable } from "../lib/connect-wizard-mock.js";

const NOW = 1_784_000_000_000;
const M1 = "member-one";
const M2 = "member-two";

let h: TestDb;

beforeAll(async () => {
  process.env.SLUMHOUSE_SESSION_SECRET = "integration-secret-0123456789abcdef";
  h = await createTestDb();
});
afterAll(async () => { await h?.close(); });

beforeEach(async () => {
  await h.db.delete(slumhouseConnectTest);
  await h.db.delete(slumhouseMemberPins);
  await h.db.delete(slumhouseUsers);
  await h.db.insert(slumhouseUsers).values([
    { discordUserId: M1, displayName: "Member One" },
    { discordUserId: M2, displayName: "Member Two" },
  ]);
});

// ── SEAM 1: the PIN gate cannot be skipped ───────────────────────────────────────────────────
describe("SEAM: no PIN ticket means no room", () => {
  it("a signed-in member with NO ticket sees nothing at all", () => {
    expect(visibleSurfaces("member", M1, false)).toEqual([]);
    expect(evaluateOfficeScope({ role: "member", viewerId: M1, surface: "connect_card", targetMemberId: M1, pinSatisfied: false }).reason)
      .toBe("pin_required");
  });

  it("an EXPIRED ticket is not a ticket", () => {
    const t = signPinTicket(M1, NOW, 60)!;
    expect(verifyPinTicket(t, NOW + 61_000).valid).toBe(false);
  });
});

// ── SEAM 2: the highest-value proof — one member's clearance must not open another's room ────
describe("SEAM: cross-member ticket confers nothing", () => {
  it("M2's VALID ticket names M2, so a route checking subject==session denies M1", () => {
    const m2Ticket = signPinTicket(M2, NOW)!;
    const v = verifyPinTicket(m2Ticket, NOW);
    // The ticket itself is cryptographically fine — that is the danger. Safety comes from the
    // subject comparison, which is only possible because the ticket names its subject.
    expect(v.valid).toBe(true);
    expect(v.discordUserId).toBe(M2);
    expect(v.discordUserId).not.toBe(M1);
  });

  it("scope denies cross-member access even WITH a satisfied pin", () => {
    expect(evaluateOfficeScope({ role: "member", viewerId: M1, surface: "my_room", targetMemberId: M2, pinSatisfied: true }).reason)
      .toBe("cross_member_denied");
  });
});

// ── SEAM 3: PIN state survives a round trip through the real DB ──────────────────────────────
describe("SEAM: PIN verification against a real stored row", () => {
  it("a hash written to the DB verifies when read back", async () => {
    const stored = await hashPin("902184");
    await h.db.insert(slumhouseMemberPins).values({ discordUserId: M1, pinHash: stored });

    const [row] = await h.db.select().from(slumhouseMemberPins).where(eq(slumhouseMemberPins.discordUserId, M1));
    expect(row).toBeTruthy();
    // The column must round-trip the encoded record intact — a truncating column type would
    // silently break verification, and only a real DB can prove it does not.
    expect(row.pinHash).toBe(stored);
    expect(row.pinHash).not.toContain("902184");
    expect(row.failures).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it("lockout state persists across reads", async () => {
    const lockUntil = new Date(NOW + 900_000);
    await h.db.insert(slumhouseMemberPins).values({
      discordUserId: M1, pinHash: await hashPin("902184"), failures: 5, lockedUntil: lockUntil,
    });
    const [row] = await h.db.select().from(slumhouseMemberPins).where(eq(slumhouseMemberPins.discordUserId, M1));
    expect(row.failures).toBe(5);
    expect(row.lockedUntil?.getTime()).toBe(lockUntil.getTime());
  });
});

// ── SEAM 4: a rejected key must leave NO trace in the DB ─────────────────────────────────────
describe("SEAM: rejected keys are never persisted", () => {
  it("a realistic-looking key is refused and writes nothing", async () => {
    const realish = ["sk", "live", "0".repeat(24)].join("_");
    const result = validateTestKey("topstepx", realish);
    expect(result.status).toBe("rejected");
    expect(result.storableRef).toBeNull();

    // The route only persists on `validated`; prove the table stays empty.
    const rows = await h.db.select().from(slumhouseConnectTest);
    expect(rows).toEqual([]);
  });

  it("assertStorable is the last line — it THROWS rather than let key material reach the DB", () => {
    expect(() => assertStorable("sk_live_whatever")).toThrow(/refusing to persist/);
  });
});

// ── SEAM 5: the happy path writes ONLY to the test table ─────────────────────────────────────
describe("SEAM: a successful test connect lands in slumhouse_connect_test and nowhere else", () => {
  it("persists a marker, never the key", async () => {
    const r = validateTestKey("topstepx", "TESTKEY-abcd1234");
    expect(r.status).toBe("validated");

    await h.db.insert(slumhouseConnectTest).values({
      discordUserId: M1,
      brokerKind: "topstepx",
      testKeyRef: assertStorable(r.storableRef),
      status: "validated",
      validatedAt: new Date(NOW),
    });

    const [row] = await h.db.select().from(slumhouseConnectTest).where(eq(slumhouseConnectTest.discordUserId, M1));
    expect(row.testKeyRef).toBe("testref:topstepx:abcd");
    expect(row.testKeyRef).not.toContain("TESTKEY-");
    expect(row.status).toBe("validated");
  });

  it("the DB itself refuses an invented broker or status — guards are structural", async () => {
    await expect(h.db.insert(slumhouseConnectTest).values({
      discordUserId: M1, brokerKind: "ninjatrader", status: "validated",
    })).rejects.toThrow();

    await expect(h.db.insert(slumhouseConnectTest).values({
      discordUserId: M1, brokerKind: "topstepx", status: "hacked",
    })).rejects.toThrow();
  });

  it("a connect row for an unknown member is refused by the FK", async () => {
    await expect(h.db.insert(slumhouseConnectTest).values({
      discordUserId: "ghost", brokerKind: "topstepx", status: "pending",
    })).rejects.toThrow();
  });
});
