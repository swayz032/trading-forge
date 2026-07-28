import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/pglite-db.js";
import { slumhouseMemberPins, slumhouseUsers } from "../db/schema.js";
import { hashPin } from "../lib/member-pin.js";
import { evaluateOfficeScope, visibleSurfaces } from "../lib/member-office-scope.js";
import { signPinTicket, verifyPinTicket } from "../lib/slumhouse/pin-ticket.js";

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
  await h.db.delete(slumhouseMemberPins);
  await h.db.delete(slumhouseUsers);
  await h.db.insert(slumhouseUsers).values([
    { discordUserId: M1, displayName: "Member One" },
    { discordUserId: M2, displayName: "Member Two" },
  ]);
});

describe("member Office authorization seams", () => {
  it("requires a PIN ticket before exposing any surface", () => {
    expect(visibleSurfaces("member", M1, false)).toEqual([]);
    expect(evaluateOfficeScope({ role: "member", viewerId: M1, surface: "connect_card", targetMemberId: M1, pinSatisfied: false }).reason).toBe("pin_required");
  });

  it("rejects expired and cross-member tickets", () => {
    expect(verifyPinTicket(signPinTicket(M1, NOW, 60)!, NOW + 61_000).valid).toBe(false);
    const other = verifyPinTicket(signPinTicket(M2, NOW)!, NOW);
    expect(other.valid).toBe(true);
    expect(other.discordUserId).not.toBe(M1);
    expect(evaluateOfficeScope({ role: "member", viewerId: M1, surface: "my_room", targetMemberId: M2, pinSatisfied: true }).reason).toBe("cross_member_denied");
  });

  it("round-trips only a one-way PIN hash through the real schema", async () => {
    const stored = await hashPin("902184");
    await h.db.insert(slumhouseMemberPins).values({ discordUserId: M1, pinHash: stored });
    const [row] = await h.db.select().from(slumhouseMemberPins).where(eq(slumhouseMemberPins.discordUserId, M1));
    expect(row.pinHash).toBe(stored);
    expect(row.pinHash).not.toContain("902184");
  });
});
