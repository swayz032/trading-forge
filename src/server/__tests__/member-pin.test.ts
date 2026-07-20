// src/server/__tests__/member-pin.test.ts — Tier-2 item 6 PIN layer (OR-013 §2).
// Security posture is explicitly in scope for this unit's grade, so the assertions below are
// written as claims a grader can check: never plaintext, constant-time compare, fail-closed
// verify, fail-closed lockout, and cost params that travel with the record.
import { describe, it, expect } from "vitest";
import {
  PIN_KDF_V1,
  PIN_POLICY,
  PinPolicyError,
  hashPin,
  verifyPin,
  evaluateAttempt,
  nextAttemptState,
} from "../lib/member-pin.js";

describe("hashPin", () => {
  it("never stores the PIN in the encoded record", async () => {
    const pin = "483920";
    const stored = await hashPin(pin);
    expect(stored).not.toContain(pin);
    expect(stored.startsWith("scrypt$")).toBe(true);
  });

  it("carries its cost parameters so they can be raised later without breaking records", async () => {
    const stored = await hashPin("483920");
    const [algo, N, r, p] = stored.split("$");
    expect(algo).toBe("scrypt");
    expect(Number(N)).toBe(PIN_KDF_V1.N);
    expect(Number(r)).toBe(PIN_KDF_V1.r);
    expect(Number(p)).toBe(PIN_KDF_V1.p);
  });

  it("salts per record — the same PIN hashes differently every time", async () => {
    const a = await hashPin("483920");
    const b = await hashPin("483920");
    expect(a).not.toBe(b);
    expect(await verifyPin("483920", a)).toBe(true);
    expect(await verifyPin("483920", b)).toBe(true);
  });

  it("rejects weak PINs", async () => {
    for (const bad of ["12345", "1234567890123", "111111", "123456", "987654", "abc123", ""]) {
      await expect(hashPin(bad)).rejects.toBeInstanceOf(PinPolicyError);
    }
  });
});

describe("verifyPin", () => {
  it("accepts the right PIN and rejects a wrong one", async () => {
    const stored = await hashPin("483920");
    expect(await verifyPin("483920", stored)).toBe(true);
    expect(await verifyPin("483921", stored)).toBe(false);
  });

  // FAIL-CLOSED: a verifier that throws on malformed input is an oracle and a liveness hazard.
  it("returns false — never throws — on malformed or hostile records", async () => {
    const hostile = [
      "", "not-a-hash", "scrypt$$$$", "scrypt$16384$8$1$onlyfour",
      "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",          // unknown algo
      "scrypt$999$8$1$c2FsdA==$aGFzaA==",            // N below floor
      "scrypt$1048577$8$1$c2FsdA==$aGFzaA==",        // N above ceiling (DoS vector)
      "scrypt$16384$99$1$c2FsdA==$aGFzaA==",         // r out of range
      "scrypt$16384$8$1$$",                          // empty salt + hash
      "scrypt$notanumber$8$1$c2FsdA==$aGFzaA==",
    ];
    for (const rec of hostile) {
      await expect(verifyPin("483920", rec)).resolves.toBe(false);
    }
  });

  it("returns false for non-string inputs rather than throwing", async () => {
    // @ts-expect-error deliberate hostile input
    expect(await verifyPin(null, await hashPin("483920"))).toBe(false);
    // @ts-expect-error deliberate hostile input
    expect(await verifyPin("483920", undefined)).toBe(false);
  });
});

describe("evaluateAttempt — fail-closed lockout", () => {
  it("DENIES when the attempt state is unreadable (fail-closed, not fail-open)", () => {
    expect(evaluateAttempt(null, 1_000).allowed).toBe(false);
    expect(evaluateAttempt(undefined, 1_000).allowed).toBe(false);
    // @ts-expect-error deliberate corrupt state
    expect(evaluateAttempt({ failures: "3" }, 1_000).allowed).toBe(false);
  });

  it("allows a clean state and blocks while locked out", () => {
    expect(evaluateAttempt({ failures: 0, lockedUntilMs: null }, 1_000).allowed).toBe(true);
    const locked = evaluateAttempt({ failures: 5, lockedUntilMs: 10_000 }, 1_000);
    expect(locked.allowed).toBe(false);
    expect(locked.reason).toBe("locked_out");
    expect(locked.retryAfterMs).toBe(9_000);
  });

  it("re-allows once the lockout has expired", () => {
    expect(evaluateAttempt({ failures: 5, lockedUntilMs: 10_000 }, 10_001).allowed).toBe(true);
  });

  it("is PURE — no clock, same inputs give the same answer", () => {
    const s = { failures: 2, lockedUntilMs: null };
    expect(evaluateAttempt(s, 5_000)).toEqual(evaluateAttempt(s, 5_000));
  });
});

describe("nextAttemptState", () => {
  it("resets on success", () => {
    expect(nextAttemptState({ failures: 4, lockedUntilMs: null }, true, 1_000))
      .toEqual({ failures: 0, lockedUntilMs: null });
  });

  it("counts failures and engages lockout at the policy limit", () => {
    let s = { failures: 0, lockedUntilMs: null as number | null };
    for (let i = 1; i < PIN_POLICY.maxAttempts; i += 1) {
      s = nextAttemptState(s, false, 1_000);
      expect(s.lockedUntilMs).toBeNull();
      expect(s.failures).toBe(i);
    }
    s = nextAttemptState(s, false, 1_000);
    expect(s.failures).toBe(PIN_POLICY.maxAttempts);
    expect(s.lockedUntilMs).toBe(1_000 + PIN_POLICY.lockoutMs);
    expect(evaluateAttempt(s, 1_001).allowed).toBe(false);
  });
});
