// src/server/__tests__/member-office-crown-e2e.test.ts
//
// F-1 closure (OR-052 §2). The charter's single most critical property — a member can never
// reach another member's room — was proved in `member-office-integration.test.ts` by calling
// `evaluateOfficeScope()` DIRECTLY. That tests the decision function, not the PATH: the glue in
// `member-office.ts::pinSatisfied()` (which compares the ticket's subject against the SESSION's
// subject, and is the only thing standing between a stolen ticket and someone else's room) was
// never executed by a test.
//
// Same vacuity shape as the green-board starve-proofs: I verified the component and called it
// coverage of the behaviour. This exercises the REAL router with a REAL cookie over REAL HTTP.
//
// D-LAW ACCEPTANCE (OR-052 §2): this must go RED if `pinSatisfied()`'s
// `t.discordUserId !== viewerId` comparison is inverted or removed.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createTestDb, type TestDb } from "./helpers/pglite-db.js";
import { slumhouseUsers, slumhouseMemberPins } from "../db/schema.js";
import { hashPin } from "../lib/member-pin.js";
import { signPinTicket, PIN_COOKIE_NAME } from "../lib/slumhouse/pin-ticket.js";

const M1 = "crown-member-one";
const M2 = "crown-member-two";
const PIN = "618394";

let h: TestDb;
let server: Server;
let base: string;

beforeAll(async () => {
  process.env.SLUMHOUSE_SESSION_SECRET = "crown-e2e-secret-0123456789abcdef";
  h = await createTestDb();

  const app = express();
  app.use(express.json());

  // Stand in for requireSlumhouseUser: the session identity arrives via a header so the test
  // can assert the ROUTER's own subject comparison rather than re-testing Discord auth.
  app.use((req, _res, next) => {
    const id = req.header("x-test-session-user");
    if (id) (req as express.Request & { slumhouseUser?: unknown }).slumhouseUser =
      { discordUserId: id, displayName: id, jerseyNumber: 7 };
    next();
  });

  // The router imports the real `db` module, which THROWS without DATABASE_URL and would
  // otherwise talk to production. Point it at the PGlite instance before the dynamic import —
  // `doMock` (not `mock`) because this must run AFTER `h` exists, so it cannot be hoisted.
  vi.doMock("../db/index.js", () => ({ db: h.db }));

  // Stub ONLY the Discord-session middleware — the thing under test is the router's OWN
  // subject comparison (`pinSatisfied`), not Discord auth. Everything downstream of this
  // (ticket verification, scope evaluation, the connect-card guard) stays REAL.
  vi.doMock("../lib/slumhouse/require-session.js", () => ({
    requireSlumhouseUser: (
      req: express.Request & { slumhouseUser?: unknown },
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const id = req.header("x-test-session-user");
      if (!id) { res.status(401).json({ error: "no_session" }); return; }
      req.slumhouseUser = { discordUserId: id, displayName: id, jerseyNumber: 7 };
      next();
    },
  }));

  const { memberOfficeRouter } = await import("../routes/slumhouse/api/member-office.js");
  app.use(memberOfficeRouter);

  await new Promise<void>((r) => { server = app.listen(0, r); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await h?.close();
});

beforeEach(async () => {
  await h.db.delete(slumhouseMemberPins);
  await h.db.delete(slumhouseUsers);
  await h.db.insert(slumhouseUsers).values([
    { discordUserId: M1, displayName: "Crown One" },
    { discordUserId: M2, displayName: "Crown Two" },
  ]);
  await h.db.insert(slumhouseMemberPins).values([
    { discordUserId: M1, pinHash: await hashPin(PIN) },
    { discordUserId: M2, pinHash: await hashPin(PIN) },
  ]);
});

const scope = (sessionUser: string, cookie?: string) =>
  fetch(`${base}/slumhouse/api/member/scope`, {
    headers: {
      "x-test-session-user": sessionUser,
      ...(cookie ? { cookie: `${PIN_COOKIE_NAME}=${encodeURIComponent(cookie)}` } : {}),
    },
  });

describe("CROWN PROPERTY, through the real router: one member's ticket cannot open another's room", () => {
  it("M1 with M1's own ticket SEES their room", async () => {
    const ticket = signPinTicket(M1, Date.now())!;
    const body = await (await scope(M1, ticket)).json();
    expect(body.surfaces).toContain("my_room");
  });

  // THE test. The ticket is cryptographically valid — that is the danger. Only the router's
  // subject comparison stands between it and another member's room.
  it("M1 presenting M2's VALID ticket sees NOTHING", async () => {
    const m2Ticket = signPinTicket(M2, Date.now())!;
    const body = await (await scope(M1, m2Ticket)).json();
    expect(body.surfaces).toEqual([]);
    expect(body.surfaces).not.toContain("my_room");
    expect(body.surfaces).not.toContain("connect_card");
  });

  it("no ticket at all sees NOTHING", async () => {
    const body = await (await scope(M1)).json();
    expect(body.surfaces).toEqual([]);
  });

  it("a member never receives an operator-only surface, ticket or not", async () => {
    const ticket = signPinTicket(M1, Date.now())!;
    const body = await (await scope(M1, ticket)).json();
    for (const s of ["carter", "approvals", "reporting_room", "conveyor", "risk", "all_members"]) {
      expect(body.surfaces).not.toContain(s);
    }
  });

  // The connect-card path enforces scope independently — a stolen ticket must not write either.
  it("M1 with M2's ticket is refused by the connect-card route and writes nothing", async () => {
    const m2Ticket = signPinTicket(M2, Date.now())!;
    const res = await fetch(`${base}/slumhouse/api/member/connect-test`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-session-user": M1,
        cookie: `${PIN_COOKIE_NAME}=${encodeURIComponent(m2Ticket)}`,
      },
      body: JSON.stringify({ brokerKind: "topstepx", key: "TESTKEY-abcd1234" }),
    });
    expect(res.status).toBe(403);
  });
});
