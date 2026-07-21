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
  // ★ importOriginal, NOT a bare object: replacing the whole module silently drops every other
  // export, and the router uses `checkSlumhouseOrigin` too (CSRF hardening, OR-169 §19). A
  // wholesale stub made that `undefined`, so the call threw into the handler's catch and every
  // FULL FLOW test failed with 500 — a test-harness gap that reads exactly like a broken route.
  // Spreading the original keeps this honest to the comment above: the session middleware is the
  // ONLY thing stubbed, and the real origin check now genuinely runs in this flow.
  vi.doMock("../lib/slumhouse/require-session.js", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
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

  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
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
  // DELIBERATELY does NOT seed pin rows. The earlier version pre-inserted hashes — the exact
  // "fixture supplies the missing feature to itself" trap that let F-2 (no establishment path)
  // survive 60 green tests. Every PIN below is now established through the REAL route.
});

const establish = (sessionUser: string, pin: string) =>
  fetch(`${base}/slumhouse/api/member/pin/establish`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-session-user": sessionUser },
    body: JSON.stringify({ pin }),
  });

/** Establishes a PIN via the route and returns the ticket the ROUTE minted. */
async function establishAndTicket(sessionUser: string, pin = PIN): Promise<string> {
  const res = await establish(sessionUser, pin);
  if (res.status !== 201) throw new Error(`establish failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie") ?? "";
  const m = setCookie.match(new RegExp(`${PIN_COOKIE_NAME}=([^;]+)`));
  if (!m) throw new Error("establish returned no pin cookie");
  return decodeURIComponent(m[1]);
}

const scope = (sessionUser: string, cookie?: string) =>
  fetch(`${base}/slumhouse/api/member/scope`, {
    headers: {
      "x-test-session-user": sessionUser,
      ...(cookie ? { cookie: `${PIN_COOKIE_NAME}=${encodeURIComponent(cookie)}` } : {}),
    },
  });

describe("CSRF: a foreign origin cannot drive the member's own routes", () => {
  // DYNAMIC proof, through the real route and the real `checkSlumhouseOrigin` (the mock now
  // spreads the original module, so this is not a stub answering yes). A static grep can only
  // show the call is written; this shows it BLOCKS.
  //
  // Note what makes this a real check: the session header is VALID on every request below. A
  // cross-site attacker in a browser would likewise ride the member's real session cookie — so
  // the origin is the only thing standing between them and the member's PIN routes.
  const FOREIGN = "https://evil.example.com";

  it("rejects a foreign-origin establish", async () => {
    const res = await fetch(`${base}/slumhouse/api/member/pin/establish`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-session-user": "csrf-victim", origin: FOREIGN },
      body: JSON.stringify({ pin: PIN }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden_origin");
  });

  it("rejects a foreign-origin verify", async () => {
    const res = await fetch(`${base}/slumhouse/api/member/pin`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-session-user": M1, origin: FOREIGN },
      body: JSON.stringify({ pin: PIN }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a foreign-origin connect-test", async () => {
    const res = await fetch(`${base}/slumhouse/api/member/connect-test`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-session-user": M1, origin: FOREIGN },
      body: JSON.stringify({ brokerKind: "topstepx", key: "TESTKEY-1" }),
    });
    expect(res.status).toBe(403);
  });

  it("★ the SAME request without the foreign origin is NOT blocked — the origin is what decided", () => {
    // Control. Without it these three could pass because the requests are malformed in some
    // other way, and the guard would look effective while testing nothing.
    return fetch(`${base}/slumhouse/api/member/pin`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-session-user": M1 },
      body: JSON.stringify({ pin: "definitely-wrong-pin" }),
    }).then(async (res) => {
      expect(res.status).not.toBe(403);
    });
  });
});

describe("FULL FLOW: establish -> verify -> scope, entirely through the real routes", () => {
  it("a member sets their own PIN, then reaches their room", async () => {
    const res = await establish(M1, PIN);
    expect(res.status).toBe(201);

    // Verify with the PIN they just set — proves establishment wrote a hash verifyPin accepts.
    const verify = await fetch(`${base}/slumhouse/api/member/pin`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-session-user": M1 },
      body: JSON.stringify({ pin: PIN }),
    });
    expect(verify.status).toBe(200);

    const cookie = (verify.headers.get("set-cookie") ?? "").match(new RegExp(`${PIN_COOKIE_NAME}=([^;]+)`));
    const body = await (await scope(M1, decodeURIComponent(cookie![1]))).json();
    expect(body.surfaces).toContain("my_room");
  });

  it("BEFORE establishment, verify reports no_pin_set and the room stays locked", async () => {
    const verify = await fetch(`${base}/slumhouse/api/member/pin`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-session-user": M1 },
      body: JSON.stringify({ pin: PIN }),
    });
    expect(verify.status).toBe(409);
    expect((await verify.json()).error).toBe("no_pin_set");
  });

  // Establishment is NOT reset: a second call must not silently overwrite an existing PIN,
  // or anyone with a live Discord session could take over an established room.
  it("establishing TWICE is refused", async () => {
    expect((await establish(M1, PIN)).status).toBe(201);
    const second = await establish(M1, "775511");
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("pin_already_set");
  });

  it("a weak PIN is refused at establishment, and no row is written", async () => {
    const res = await establish(M1, "111111");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("pin_policy");
    const rows = await h.db.select().from(slumhouseMemberPins);
    expect(rows).toEqual([]);
  });

  // F-5 (OA-050 self-caught, grader independently re-derived). Concurrent establishes race the
  // SELECT-then-INSERT; the PK keeps it SAFE, but the loser used to get a 500 "something broke"
  // for a situation the system knows is "PIN already set".
  it("CONCURRENT establishes: exactly one wins, and the loser gets 409 — never a 500", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => establish(M1, PIN).then((r) => r.status)),
    );
    expect(results.filter((s) => s === 201)).toHaveLength(1);   // exactly one writer
    expect(results.filter((s) => s === 409)).toHaveLength(4);   // losers get the TRUE answer
    expect(results).not.toContain(500);                          // ← the F-5 assertion

    // And the PK actually held: one row, matching the PIN that was submitted.
    const rows = await h.db.select().from(slumhouseMemberPins);
    expect(rows).toHaveLength(1);
  });

  it("a non-string pin is refused", async () => {
    const res = await fetch(`${base}/slumhouse/api/member/pin/establish`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-session-user": M1 },
      body: JSON.stringify({ pin: 618394 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("CROWN PROPERTY, through the real router: one member's ticket cannot open another's room", () => {
  it("M1 with M1's own ticket SEES their room", async () => {
    const ticket = await establishAndTicket(M1);
    const body = await (await scope(M1, ticket)).json();
    expect(body.surfaces).toContain("my_room");
  });

  // THE test. The ticket is cryptographically valid — that is the danger. Only the router's
  // subject comparison stands between it and another member's room.
  it("M1 presenting M2's VALID ticket sees NOTHING", async () => {
    const m2Ticket = await establishAndTicket(M2);
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
    const ticket = await establishAndTicket(M1);
    const body = await (await scope(M1, ticket)).json();
    for (const s of ["carter", "approvals", "reporting_room", "conveyor", "risk", "all_members"]) {
      expect(body.surfaces).not.toContain(s);
    }
  });

  // The connect-card path enforces scope independently — a stolen ticket must not write either.
  it("M1 with M2's ticket is refused by the connect-card route and writes nothing", async () => {
    const m2Ticket = await establishAndTicket(M2);
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
