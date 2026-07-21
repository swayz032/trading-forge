/**
 * Anam greeting — PRIVACY SCOPING tests (charter Tier-2 item 7).
 *
 * ★ The greeting text is cosmetic; the scoping is the property that must never regress.
 * "One Office page, different offices" — a member sees THEIR room, never another member's and
 * never the aggregate. These tests RED-proof the fail-closed rule in the direction the defect
 * would actually travel: an unmapped member must receive ZERO trade content, and the critique
 * reader must never be reached without a real account id.
 *
 * A leak here would look like a *feature* — a friendly greeting mentioning "recent activity" —
 * which is exactly why it is asserted mechanically rather than trusted to the comment.
 */
import { describe, it, expect, vi } from "vitest";

// The route's middleware import chain reaches `db/index.ts`, which THROWS on a missing
// DATABASE_URL at module load. `vi.hoisted` runs before the imports below, so the fake value is
// in place by then — a `beforeEach` would be too late, because collection has already failed.
// The value is never connected to: every test injects its own readers.
vi.hoisted(() => {
  process.env["DATABASE_URL"] ??= "postgresql://fake-user:fake-pass@localhost:5432/fake_db";
});

import { getAnamGreeting, type GreetingDeps } from "../routes/slumhouse/api/anam-greeting.js";

function mockRes() {
  const res: Record<string, unknown> = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res as { statusCode: number; body: any; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

const req = (discordUserId?: string) => ({ slumhouseUser: discordUserId ? { discordUserId } : undefined }) as any;

const OTHER_MEMBERS_CRITIQUE = [
  { grade: "A+", pes: { one_liner: "SOMEONE ELSE'S TRADE", action_needed: "LEAKED" } },
];

describe("anam-greeting privacy scoping", () => {
  it("★ UNMAPPED member gets ZERO trade content — and the critique reader is NEVER called", async () => {
    const readCritiques = vi.fn(async () => OTHER_MEMBERS_CRITIQUE);
    const deps: GreetingDeps = {
      readUser: async () => ({ displayName: "Ana", brokerAccountId: null }),
      readCritiques,
    };
    const res = mockRes();
    await getAnamGreeting(req("discord-1"), res as any, deps);

    expect(res.body.talkingPoints).toEqual([]);
    expect(res.body.receiptCount).toBe(0);
    expect(res.body.emptyReason).toBe("not_mapped");
    // The strongest assertion: we did not merely filter the other member's rows out — we never
    // fetched them. A filter can be got wrong; a call that never happens cannot leak.
    expect(readCritiques).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain("SOMEONE ELSE");
  });

  it("★ UNKNOWN identity (no row at all) also gets zero, and never reads critiques", async () => {
    const readCritiques = vi.fn(async () => OTHER_MEMBERS_CRITIQUE);
    const deps: GreetingDeps = { readUser: async () => null, readCritiques };
    const res = mockRes();
    await getAnamGreeting(req("ghost"), res as any, deps);

    expect(res.body.emptyReason).toBe("not_mapped");
    expect(res.body.talkingPoints).toEqual([]);
    expect(readCritiques).not.toHaveBeenCalled();
  });

  it("a MAPPED member's critiques are read with THEIR account id, and no other", async () => {
    const readCritiques = vi.fn(async (accountId: string) => {
      expect(accountId).toBe("acct-mine");
      return [{ grade: "B+", pes: { one_liner: "Entry was late.", action_needed: "Wait for the retest." } }];
    });
    const deps: GreetingDeps = {
      readUser: async () => ({ displayName: "Ana", brokerAccountId: "acct-mine" }),
      readCritiques,
    };
    const res = mockRes();
    await getAnamGreeting(req("discord-1"), res as any, deps);

    expect(readCritiques).toHaveBeenCalledWith("acct-mine");
    expect(res.body.receiptCount).toBe(1);
    expect(res.body.greeting).toContain("Ana");
    expect(res.body.greeting).toContain("Entry was late.");
    expect(res.body.talkingPoints).toContain("What to do: Wait for the retest.");
    expect(res.body.emptyReason).toBeNull();
  });

  it("POSITIVE CONTROL — receipts DO surface when present (else the zero-tests prove nothing)", async () => {
    // Without this, a route that always returned an empty greeting would pass every test above.
    const deps: GreetingDeps = {
      readUser: async () => ({ displayName: "Ana", brokerAccountId: "acct-mine" }),
      readCritiques: async () => [{ grade: "A", pes: { one_liner: "Clean execution." } }],
    };
    const res = mockRes();
    await getAnamGreeting(req("discord-1"), res as any, deps);
    expect(res.body.talkingPoints.length).toBeGreaterThan(0);
    expect(res.body.receiptCount).toBe(1);
  });

  it("a mapped member with no critiques yet gets an honest empty reason, not a fabricated line", async () => {
    const deps: GreetingDeps = {
      readUser: async () => ({ displayName: "Ana", brokerAccountId: "acct-mine" }),
      readCritiques: async () => [],
    };
    const res = mockRes();
    await getAnamGreeting(req("discord-1"), res as any, deps);
    expect(res.body.emptyReason).toBe("no_critiques_yet");
    expect(res.body.talkingPoints).toEqual([]);
  });

  it("a reader failure fails CLOSED — no trade content, never another member's data", async () => {
    const deps: GreetingDeps = {
      readUser: async () => { throw new Error("db down"); },
      readCritiques: async () => OTHER_MEMBERS_CRITIQUE,
    };
    const res = mockRes();
    await getAnamGreeting(req("discord-1"), res as any, deps);
    expect(res.body.talkingPoints).toEqual([]);
    expect(res.body.receiptCount).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain("SOMEONE ELSE");
  });

  it("an unauthenticated request is rejected, not greeted", async () => {
    const deps: GreetingDeps = {
      readUser: async () => ({ displayName: "Ana", brokerAccountId: "acct-mine" }),
      readCritiques: async () => OTHER_MEMBERS_CRITIQUE,
    };
    const res = mockRes();
    await getAnamGreeting(req(undefined), res as any, deps);
    expect(res.statusCode).toBe(401);
  });
});
