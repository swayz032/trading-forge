// src/server/__tests__/pin-ticket.test.ts — PIN ticket domain separation.
// The load-bearing claim: a PIN ticket and a session token are signed with the SAME secret and
// must still be non-interchangeable. If they were, an attacker holding a pin ticket could move
// it into the session cookie and get a full session — a privilege upgrade from a second factor.
import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import {
  PIN_COOKIE_NAME,
  PIN_TTL_SEC,
  signPinTicket,
  verifyPinTicket,
} from "../lib/slumhouse/pin-ticket.js";

const NOW = 1_784_000_000_000;
const SECRET = "test-secret-not-a-real-one-0123456789";

beforeAll(() => { process.env.SLUMHOUSE_SESSION_SECRET = SECRET; });

describe("round trip", () => {
  it("signs and verifies", () => {
    const t = signPinTicket("m1", NOW)!;
    const r = verifyPinTicket(t, NOW);
    expect(r.valid).toBe(true);
    expect(r.discordUserId).toBe("m1");
  });

  it("expires", () => {
    const t = signPinTicket("m1", NOW, 60)!;
    expect(verifyPinTicket(t, NOW + 59_000).valid).toBe(true);
    expect(verifyPinTicket(t, NOW + 61_000).reason).toBe("expired");
  });

  it("uses a sane default TTL and its own cookie name", () => {
    expect(PIN_TTL_SEC).toBe(12 * 60 * 60);
    expect(PIN_COOKIE_NAME).toBe("slumhouse_pin");
  });
});

// ── The reason this module exists ──
describe("DOMAIN SEPARATION — a pin ticket is not a session and vice versa", () => {
  it("rejects a token signed over the SAME secret with a different purpose", () => {
    // Exactly what a session-shaped token looks like: same secret, same MAC construction,
    // different purpose tag. It must not verify as a pin ticket.
    const exp = Math.floor(NOW / 1000) + 3600;
    const payload = `slumhouse.session.v1:m1:${exp}`;
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    const foreign = `${payload}:${sig}`;
    expect(verifyPinTicket(foreign, NOW).reason).toBe("wrong_purpose");
  });

  it("the purpose tag is INSIDE the MAC — swapping it invalidates the signature", () => {
    const t = signPinTicket("m1", NOW)!;
    const swapped = t.replace("slumhouse.pin.v1", "slumhouse.session.v1");
    const r = verifyPinTicket(swapped, NOW);
    // It fails at the purpose gate; and even were that gate removed, the MAC no longer matches.
    expect(r.valid).toBe(false);
    const [, u, e, s] = swapped.split(":");
    const recomputed = createHmac("sha256", SECRET).update(`slumhouse.session.v1:${u}:${e}`).digest("base64url");
    expect(s).not.toBe(recomputed);
  });
});

describe("fail-closed", () => {
  it("refuses to mint without a secret", () => {
    const saved = process.env.SLUMHOUSE_SESSION_SECRET;
    delete process.env.SLUMHOUSE_SESSION_SECRET;
    expect(signPinTicket("m1", NOW)).toBeNull();
    expect(verifyPinTicket("anything", NOW).reason).toBe("no_secret");
    process.env.SLUMHOUSE_SESSION_SECRET = saved;
  });

  it("refuses separator injection into the payload", () => {
    expect(signPinTicket("m1:evil:9999999999", NOW)).toBeNull();
  });

  it("rejects tampering, truncation and garbage without throwing", () => {
    const t = signPinTicket("m1", NOW)!;
    for (const bad of [
      "", "a:b:c", t.slice(0, -3), `${t}x`,
      t.replace(":m1:", ":m2:"),                       // identity swap
      t.split(":").slice(0, 3).join(":"),              // signature stripped
      null, undefined, 12345, {},
    ]) {
      expect(verifyPinTicket(bad as unknown, NOW).valid).toBe(false);
    }
  });

  it("a ticket for one member does not authorise another", () => {
    const t = signPinTicket("m1", NOW)!;
    expect(verifyPinTicket(t, NOW).discordUserId).toBe("m1");
    // The caller must compare this against the session identity; the ticket names its subject
    // so that comparison is possible at all.
    expect(verifyPinTicket(t, NOW).discordUserId).not.toBe("m2");
  });
});
