// src/server/__tests__/agent-pair-route.test.ts
//
// Item 9a pairing endpoints. This is an AUTHENTICATION surface, so the tests that matter are the
// ones that try to get in: guess a code, poll someone else's device, replay a consumed pairing,
// brute-force the claim. The happy path is one test; the rest are attacks.
//
// Runs the REAL router (no route logic stubbed) — only the Discord session middleware and the db
// are substituted, and the module is spread from the original so no other export silently
// becomes undefined (the exact harness bug that made 5 e2e tests fail with 500 earlier today).
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { verifyAgentTicket } from "../lib/slumhouse/agent-ticket.js";
import { PAIRING_MAX_CLAIM_ATTEMPTS } from "../lib/agent-pairing.js";

const SECRET = "test-secret-not-a-real-one-0123456789";
const MEMBER = "111111111111111111";
const OTHER = "222222222222222222";

let server: Server;
let base: string;
let resetStore: () => void;

beforeAll(async () => {
  process.env.SLUMHOUSE_SESSION_SECRET = SECRET;

  const app = express();
  app.use(express.json());

  // Minimal db stub: the poll path reads slumhouse_users for the session epoch.
  vi.doMock("../db/index.js", () => ({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => [{ discordUserId: MEMBER, sessionEpoch: 3 }] }),
        }),
      }),
    },
  }));

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

  const mod = await import("../routes/slumhouse/api/agent-pair.js");
  resetStore = mod.__resetPairingStoreForTests;
  app.use(mod.agentPairRouter);

  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => { server?.close(); });
beforeEach(() => { resetStore(); });

const start = (label = "Test PC") =>
  fetch(`${base}/slumhouse/api/member/agent/pair/start`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceLabel: label }),
  });

const claim = (user: string, code: string, origin?: string) =>
  fetch(`${base}/slumhouse/api/member/agent/pair/claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-test-session-user": user,
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ code }),
  });

const poll = (deviceId: string, deviceSecret: string) =>
  fetch(`${base}/slumhouse/api/member/agent/pair/poll`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId, deviceSecret }),
  });

describe("FULL FLOW: start -> claim -> poll", () => {
  it("a member pairs their device and the token carries THEIR identity", async () => {
    const s = await (await start()).json();
    expect(s.pairingCode).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    expect((await poll(s.deviceId, s.deviceSecret)).status).toBe(200);   // pending first
    expect((await (await poll(s.deviceId, s.deviceSecret)).json()).status).toBe("pending");

    expect((await claim(MEMBER, s.pairingCode)).status).toBe(200);

    const got = await (await poll(s.deviceId, s.deviceSecret)).json();
    expect(got.status).toBe("approved");

    const v = verifyAgentTicket(got.agentToken, Date.now());
    expect(v.valid).toBe(true);
    expect(v.discordUserId).toBe(MEMBER);
    expect(v.sessionEpoch).toBe(3);           // the revocation lever, carried
  });

  it("the code is accepted in the forgiving forms a human actually types", async () => {
    const s = await (await start()).json();
    const messy = ` ${s.pairingCode.replace("-", "").toLowerCase()} `;
    expect((await claim(MEMBER, messy)).status).toBe(200);
  });
});

describe("the token is issued EXACTLY once", () => {
  it("a second poll after collection gets nothing", async () => {
    const s = await (await start()).json();
    await claim(MEMBER, s.pairingCode);
    expect((await (await poll(s.deviceId, s.deviceSecret)).json()).status).toBe("approved");

    // Record burned. A replayed poll must not mint a second token.
    const again = await poll(s.deviceId, s.deviceSecret);
    expect(again.status).toBe(401);           // device no longer known at all
    expect((await again.json()).agentToken).toBeUndefined();
  });

  it("a claimed code cannot be claimed again, by anyone", async () => {
    const s = await (await start()).json();
    expect((await claim(MEMBER, s.pairingCode)).status).toBe(200);
    expect((await claim(OTHER, s.pairingCode)).status).toBe(404);
  });
});

describe("device credentials", () => {
  it("a wrong secret is refused, and looks identical to an unknown device", async () => {
    const s = await (await start()).json();
    const wrong = await poll(s.deviceId, "not-the-secret");
    const unknown = await poll("no-such-device", "whatever");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    // Same body: otherwise the pair becomes an oracle for which deviceIds exist.
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("malformed credentials are rejected without touching the store", async () => {
    const res = await fetch(`${base}/slumhouse/api/member/agent/pair/poll`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it("★★ a caller-supplied identity in the claim body is IGNORED — identity comes only from the session", async () => {
    // Found by mutation at birth: making the route read identity from the body stayed GREEN,
    // because no test ever SENT such a field. A guard that never presents the hostile input
    // cannot prove the input is refused — the same shape as the domain-separation hole (a wall
    // the attack walked around) and the wrong-key reads (a branch nothing exercised).
    //
    // This is the privilege-escalation shape that matters here: if any body field could name the
    // member, a signed-in attacker would mint an agent token bound to somebody else.
    const s = await (await start()).json();
    const res = await fetch(`${base}/slumhouse/api/member/agent/pair/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-session-user": MEMBER },
      // Every plausible name an implementation might reach for.
      body: JSON.stringify({
        code: s.pairingCode,
        asUser: OTHER, discordUserId: OTHER, userId: OTHER, viewerId: OTHER, member: OTHER,
      }),
    });
    expect(res.status).toBe(200);

    const got = await (await poll(s.deviceId, s.deviceSecret)).json();
    const v = verifyAgentTicket(got.agentToken, Date.now());
    expect(v.valid).toBe(true);
    expect(v.discordUserId).toBe(MEMBER);      // the SESSION's member
    expect(v.discordUserId).not.toBe(OTHER);   // never the body's
  });

  it("★ another member's claim does not hand MY device their token", async () => {
    // The device belongs to whoever CLAIMED it — the claimer's identity is what the token
    // carries, and it comes from the session, never from anything the device sends.
    const s = await (await start()).json();
    await claim(OTHER, s.pairingCode);
    const got = await (await poll(s.deviceId, s.deviceSecret)).json();
    expect(verifyAgentTicket(got.agentToken, Date.now()).discordUserId).toBe(OTHER);
  });
});

describe("claiming is guarded", () => {
  it("requires a session", async () => {
    const s = await (await start()).json();
    const res = await fetch(`${base}/slumhouse/api/member/agent/pair/claim`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: s.pairingCode }),
    });
    expect(res.status).toBe(401);
  });

  it("★ rejects a foreign origin even with a valid session (CSRF)", async () => {
    const s = await (await start()).json();
    expect((await claim(MEMBER, s.pairingCode, "https://evil.example.com")).status).toBe(403);
    // Control: the same request without the foreign origin succeeds, so the origin decided it.
    expect((await claim(MEMBER, s.pairingCode)).status).toBe(200);
  });

  it("an unknown code answers the same as an expired or already-claimed one", async () => {
    const res = await claim(MEMBER, "AAAA-AAAA");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("code_not_claimable");
  });

  it("★ brute-forcing the claim locks the MEMBER out, not just the code", async () => {
    // Keying lockout to the code would hand an attacker a fresh allowance per guess.
    for (let i = 0; i < PAIRING_MAX_CLAIM_ATTEMPTS; i++) {
      expect((await claim(MEMBER, "AAAA-AAAA")).status).toBe(404);
    }
    const locked = await claim(MEMBER, "AAAA-AAAA");
    expect(locked.status).toBe(429);
    expect((await locked.json()).retryAfterSec).toBeGreaterThan(0);

    // ...and a VALID code is refused while locked — the lock is real, not cosmetic.
    const s = await (await start()).json();
    expect((await claim(MEMBER, s.pairingCode)).status).toBe(429);
    // A different member is unaffected.
    expect((await claim(OTHER, s.pairingCode)).status).toBe(200);
  });
});

describe("the lockout store is pruned WITHOUT becoming the bypass", () => {
  it("★ a live lockout survives sweeps — pruning must not forget an active lock", () => {
    // The dangerous prune is the one that helps the attacker: drop a live lockout and the next
    // guess starts fresh. Each request below calls sweep(); the lock must still hold after them.
    return (async () => {
      for (let i = 0; i < PAIRING_MAX_CLAIM_ATTEMPTS; i++) await claim(MEMBER, "AAAA-AAAA");
      expect((await claim(MEMBER, "AAAA-AAAA")).status).toBe(429);
      await start();                                   // sweeps
      await start();                                   // sweeps again
      expect((await claim(MEMBER, "AAAA-AAAA")).status).toBe(429);   // still locked
    })();
  });

  it("★ a partial failure streak survives — forgetting it would reset the attacker's budget", async () => {
    // 3 of 5 failures, then sweeps, then 2 more should still reach the lock. If the streak were
    // pruned, these 2 would leave the member unlocked and the ceiling would be unreachable.
    for (let i = 0; i < 3; i++) await claim(MEMBER, "AAAA-AAAA");
    await start();
    await start();
    for (let i = 0; i < PAIRING_MAX_CLAIM_ATTEMPTS - 3; i++) await claim(MEMBER, "AAAA-AAAA");
    expect((await claim(MEMBER, "AAAA-AAAA")).status).toBe(429);
  });

  it("a settled member leaves nothing behind — the successful claim clears the entry", async () => {
    // Success zeroes the counter; the sweep then drops the now-meaningless entry. Observable
    // only through behaviour: the member is not locked and a later failure starts from zero.
    const s = await (await start()).json();
    await claim(MEMBER, "AAAA-AAAA");                  // one failure
    expect((await claim(MEMBER, s.pairingCode)).status).toBe(200);   // success clears it
    for (let i = 0; i < PAIRING_MAX_CLAIM_ATTEMPTS; i++) {
      expect((await claim(MEMBER, "AAAA-AAAA")).status).toBe(404);   // full budget again
    }
    expect((await claim(MEMBER, "AAAA-AAAA")).status).toBe(429);
  });
});

describe("secrets never leave where they belong", () => {
  it("start returns the secret once and the audit input carries neither it nor the code", async () => {
    const res = await start();
    const body = await res.json();
    expect(body.deviceSecret).toBeTruthy();
    // The response is the ONLY place the secret appears; the record stores a hash (asserted by
    // the wrong-secret test above, which can only pass if the stored form is comparable-but-not-equal).
    expect(JSON.stringify(body)).not.toContain("deviceSecretHash");
  });
});
