// src/server/__tests__/agent-pairing-and-ticket.test.ts
//
// Charter item 9a — the member edge client's pairing code + identity token.
//
// This is an AUTHENTICATION surface, so the tests that matter are the ones that try to get in,
// not the ones that confirm the happy path works. In particular: a round-trip test
// (sign → verify → true) is structurally BLIND to token confusion, because both sides use the
// same code path. The cross-type probes below are the point of this file.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  PAIRING_ALPHABET,
  PAIRING_CODE_LEN,
  PAIRING_MAX_CLAIM_ATTEMPTS,
  PAIRING_LOCKOUT_SEC,
  generatePairingCode,
  formatPairingCode,
  normalizePairingCode,
  effectiveStatus,
  isExpired,
  evaluateClaimAttempt,
  nextClaimState,
  type PairingRecord,
} from "../lib/agent-pairing.js";
import {
  signAgentTicket,
  verifyAgentTicket,
  AGENT_TICKET_TTL_SEC,
} from "../lib/slumhouse/agent-ticket.js";
import { signPinTicket, verifyPinTicket } from "../lib/slumhouse/pin-ticket.js";

const SECRET = "test-secret-not-a-real-one-0123456789";
const NOW = 1_770_000_000_000; // fixed clock; nothing here reads the wall clock
const USER = "123456789012345678";

let savedSecret: string | undefined;
beforeEach(() => {
  savedSecret = process.env.SLUMHOUSE_SESSION_SECRET;
  process.env.SLUMHOUSE_SESSION_SECRET = SECRET;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.SLUMHOUSE_SESSION_SECRET;
  else process.env.SLUMHOUSE_SESSION_SECRET = savedSecret;
});

describe("agent ticket — domain separation (the token-confusion wall)", () => {
  it("a PIN ticket does NOT verify as an agent ticket", () => {
    // Real-world shape: rejected on part count (4 vs 5) BEFORE the purpose check runs.
    // ★ Which means this test does NOT cover the purpose check — mutation-testing at birth
    // proved it: deleting `if (purpose !== PURPOSE)` left this green. The forged-vector test
    // below is the one that actually guards the wall. Kept because the real-world token shape
    // is still worth pinning, but it is NOT the domain-separation guard.
    const pin = signPinTicket(USER, NOW);
    expect(pin).not.toBeNull();
    const r = verifyAgentTicket(pin, NOW);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("malformed");
  });

  it("★★ a VALIDLY-SIGNED token whose only defect is the purpose is rejected as wrong_purpose", () => {
    // The asymmetric known-vector probe. Everything is correct — 5 parts, our secret, a genuine
    // MAC over the exact bytes — except the purpose tag. Nothing but the purpose check can
    // reject this, so it is the only assertion that actually holds the domain-separation wall.
    //
    // A same-code-path round trip could never produce this token; it has to be forged by hand.
    const exp = Math.floor(NOW / 1000) + 3600;
    const payload = `slumhouse.pin.v1:${USER}:1:${exp}`;
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");

    const r = verifyAgentTicket(`${payload}:${sig}`, NOW);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("wrong_purpose");
    expect(r.discordUserId).toBeNull();
  });

  it("★ the control: the SAME construction with the right purpose DOES verify", () => {
    // Without this, the test above could pass for the wrong reason (e.g. a broken MAC helper
    // rejecting everything). This proves the forgery is well-formed and the purpose is the
    // single variable under test.
    const exp = Math.floor(NOW / 1000) + 3600;
    const payload = `slumhouse.agent.v1:${USER}:1:${exp}`;
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(verifyAgentTicket(`${payload}:${sig}`, NOW).valid).toBe(true);
  });

  it("★ an agent ticket does NOT verify as a PIN ticket", () => {
    // The other direction, which is the one that actually escalates: an agent token lives on a
    // family member's PC — the weakest of the three locations — and must never become a
    // browser credential.
    const agent = signAgentTicket(USER, 1, NOW);
    expect(agent).not.toBeNull();
    expect(verifyPinTicket(agent, NOW).valid).toBe(false);
  });

  it("a token with the purpose tag swapped fails the signature check", () => {
    // Proves the purpose is INSIDE the MAC rather than merely inspected afterwards: rewriting it
    // invalidates the signature instead of quietly passing.
    const agent = signAgentTicket(USER, 1, NOW)!;
    const forged = agent.replace("slumhouse.agent.v1", "slumhouse.pin.v1");
    const r = verifyPinTicket(forged, NOW);
    expect(r.valid).toBe(false);
    expect(r.reason).not.toBe("ok");
  });
});

describe("agent ticket — mint and verify", () => {
  it("round-trips and returns the identity and epoch", () => {
    const t = signAgentTicket(USER, 7, NOW)!;
    const r = verifyAgentTicket(t, NOW);
    expect(r.valid).toBe(true);
    expect(r.discordUserId).toBe(USER);
    expect(r.sessionEpoch).toBe(7);
  });

  it("★ the session epoch is inside the MAC — tampering with it is rejected", () => {
    // This is the revocation lever. If the epoch were editable, a holder of a revoked token
    // could simply rewrite it and keep going, and `revoke-sessions` would not reach agents.
    const t = signAgentTicket(USER, 7, NOW)!;
    const parts = t.split(":");
    parts[2] = "8";
    expect(verifyAgentTicket(parts.join(":"), NOW).reason).toBe("bad_signature");
  });

  it("expires", () => {
    const t = signAgentTicket(USER, 1, NOW, 60)!;
    expect(verifyAgentTicket(t, NOW + 59_000).valid).toBe(true);
    expect(verifyAgentTicket(t, NOW + 60_000).reason).toBe("expired");
  });

  it("rejects a tampered signature", () => {
    const t = signAgentTicket(USER, 1, NOW)!;
    expect(verifyAgentTicket(t.slice(0, -1) + "X", NOW).reason).toBe("bad_signature");
  });

  it("rejects an identity forged onto a valid signature", () => {
    const t = signAgentTicket(USER, 1, NOW)!;
    const parts = t.split(":");
    parts[1] = "999999999999999999";
    expect(verifyAgentTicket(parts.join(":"), NOW).reason).toBe("bad_signature");
  });

  it("fails CLOSED with no secret configured — on both sign and verify", () => {
    const t = signAgentTicket(USER, 1, NOW)!;
    delete process.env.SLUMHOUSE_SESSION_SECRET;
    expect(signAgentTicket(USER, 1, NOW)).toBeNull();
    expect(verifyAgentTicket(t, NOW).reason).toBe("no_secret");
  });

  it("refuses separator injection in the identity", () => {
    // A `:` in the id would let a caller forge extra payload fields.
    expect(signAgentTicket("123:456", 1, NOW)).toBeNull();
  });

  it("refuses a non-integer or negative epoch, and a non-positive ttl", () => {
    expect(signAgentTicket(USER, 1.5, NOW)).toBeNull();
    expect(signAgentTicket(USER, -1, NOW)).toBeNull();
    expect(signAgentTicket(USER, 1, NOW, 0)).toBeNull();
  });

  it("never throws on hostile input", () => {
    for (const bad of [null, undefined, 42, {}, [], "", "a:b:c", "a:b:c:d:e:f"]) {
      expect(() => verifyAgentTicket(bad, NOW)).not.toThrow();
      expect(verifyAgentTicket(bad, NOW).valid).toBe(false);
    }
  });

  it("the default TTL is the documented 30 days", () => {
    expect(AGENT_TICKET_TTL_SEC).toBe(30 * 24 * 60 * 60);
  });
});

describe("pairing code — generation", () => {
  it("is deterministic given bytes, and every symbol is in the alphabet", () => {
    const bytes = new Uint8Array([0, 1, 31, 32, 63, 200, 255, 128]);
    const code = generatePairingCode(bytes)!;
    expect(code).toHaveLength(PAIRING_CODE_LEN);
    for (const ch of code) expect(PAIRING_ALPHABET).toContain(ch);
    expect(generatePairingCode(bytes)).toBe(code); // pure
  });

  it("★ masking is unbiased — all 32 symbols are reachable", () => {
    // The alphabet is a power of two so `& 31` is uniform. If someone swaps in a `% 26`-style
    // alphabet, some symbols become unreachable and the code space silently shrinks.
    const all = new Uint8Array(256).map((_, i) => i);
    const seen = new Set<string>();
    for (let i = 0; i < 256; i++) seen.add(generatePairingCode(all.slice(i, i + 1), 1)!);
    expect(seen.size).toBe(PAIRING_ALPHABET.length);
  });

  it("fails CLOSED on too few random bytes rather than making a short code", () => {
    expect(generatePairingCode(new Uint8Array(PAIRING_CODE_LEN - 1))).toBeNull();
    expect(generatePairingCode(new Uint8Array(0))).toBeNull();
  });

  it("excludes the misread symbols I, L, O and U", () => {
    for (const ch of ["I", "L", "O", "U"]) expect(PAIRING_ALPHABET).not.toContain(ch);
  });
});

describe("pairing code — normalising what a human actually types", () => {
  const CODE = "2ABC3DEF";

  it("accepts the displayed hyphenated form", () => {
    expect(formatPairingCode(CODE)).toBe("2ABC-3DEF");
    expect(normalizePairingCode("2ABC-3DEF")).toBe(CODE);
  });

  it("accepts lowercase and stray whitespace", () => {
    expect(normalizePairingCode(" 2abc 3def ")).toBe(CODE);
  });

  it("★ maps the Crockford lookalikes rather than rejecting them", () => {
    // A member reading O/0 or I/1 off a screen must not be told their correct code is wrong.
    expect(normalizePairingCode("O1234567")).toBe("01234567");
    expect(normalizePairingCode("I1234567")).toBe("11234567");
    expect(normalizePairingCode("L1234567")).toBe("11234567");
  });

  it("rejects wrong length and out-of-alphabet input, and never half-parses", () => {
    expect(normalizePairingCode("2ABC3DE")).toBeNull();
    expect(normalizePairingCode("2ABC3DEFG")).toBeNull();
    expect(normalizePairingCode("2ABC3DE!")).toBeNull();
    expect(normalizePairingCode("U2345678")).toBeNull(); // U is not in the alphabet
    for (const bad of [null, undefined, 42, {}, []]) expect(normalizePairingCode(bad)).toBeNull();
  });
});

describe("pairing record — status is derived from the clock, not trusted from the flag", () => {
  const rec = (over: Partial<PairingRecord> = {}): PairingRecord => ({
    deviceId: "dev-1",
    deviceSecretHash: "hash",
    code: "2ABC3DEF",
    status: "pending",
    createdAtMs: NOW,
    expiresAtMs: NOW + 600_000,
    discordUserId: null,
    deviceLabel: "Test PC",
    ...over,
  });

  it("a pending record past its expiry reads as expired, not pending", () => {
    // Nothing sweeps the store on a timer, so a stored flag goes stale. The clock cannot.
    const r = rec();
    expect(effectiveStatus(r, NOW)).toBe("pending");
    expect(effectiveStatus(r, NOW + 600_000)).toBe("expired");
    expect(isExpired(r, NOW + 600_000)).toBe(true);
  });

  it("an APPROVED record still expires — approval does not grant immortality", () => {
    expect(effectiveStatus(rec({ status: "approved" }), NOW + 600_000)).toBe("expired");
  });

  it("consumed is terminal and outranks expiry — single use is never re-openable", () => {
    expect(effectiveStatus(rec({ status: "consumed" }), NOW)).toBe("consumed");
    expect(effectiveStatus(rec({ status: "consumed" }), NOW + 999_999_999)).toBe("consumed");
  });
});

describe("claim attempts — lockout policy", () => {
  it("allows attempts until the threshold, then locks", () => {
    let s = { failures: 0, lockedUntilMs: null as number | null };
    for (let i = 0; i < PAIRING_MAX_CLAIM_ATTEMPTS - 1; i++) {
      expect(evaluateClaimAttempt(s, NOW).allowed).toBe(true);
      s = nextClaimState(s, false, NOW);
    }
    expect(evaluateClaimAttempt(s, NOW).allowed).toBe(true); // last attempt still permitted
    s = nextClaimState(s, false, NOW);

    const d = evaluateClaimAttempt(s, NOW);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("locked");
    expect(d.retryAfterSec).toBe(PAIRING_LOCKOUT_SEC);
  });

  it("the lock lifts on its own", () => {
    const locked = { failures: 0, lockedUntilMs: NOW + PAIRING_LOCKOUT_SEC * 1000 };
    expect(evaluateClaimAttempt(locked, NOW + PAIRING_LOCKOUT_SEC * 1000 - 1).allowed).toBe(false);
    expect(evaluateClaimAttempt(locked, NOW + PAIRING_LOCKOUT_SEC * 1000).allowed).toBe(true);
  });

  it("success clears the counter", () => {
    expect(nextClaimState({ failures: 3, lockedUntilMs: null }, true, NOW))
      .toEqual({ failures: 0, lockedUntilMs: null });
  });

  it("a fresh run of failures is required for the next lockout", () => {
    // Counter resets when the cooldown starts, so one past lockout does not make every
    // subsequent single mistake re-lock the member out.
    const afterLock = nextClaimState({ failures: PAIRING_MAX_CLAIM_ATTEMPTS - 1, lockedUntilMs: null }, false, NOW);
    expect(afterLock.failures).toBe(0);
    expect(afterLock.lockedUntilMs).toBe(NOW + PAIRING_LOCKOUT_SEC * 1000);
  });
});
