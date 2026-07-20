// src/server/lib/member-pin.ts — Slumhouse per-member office PIN (Tier-2 item 6, OR-013 §2).
//
// THREAT MODEL — stated because a PIN is the weakest thing in this stack:
// this is a SECOND factor behind Discord OAuth, never a primary credential. The member is
// already authenticated as a Discord identity; the PIN stops a hijacked-but-idle Discord
// session from walking into their office. It protects a VIEW. It gates nothing that moves
// money — the broker-connect card is mock-only until the money path's Phase 5, and a PIN in
// front of a mock is a UI affordance, not a security boundary. Saying so plainly beats
// implying a guarantee that isn't there.
//
// KDF: Node builtin `crypto.scrypt` (RFC 7914, memory-hard). NOT argon2/bcrypt — deliberately
// zero new dependencies. Adding a package to the shared tree is the exact class of action that
// silently broke this machine for 36h on 2026-07-18 (ops-experience OA-013).
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

// Pre-registered cost parameters. They travel INSIDE the stored hash so they can be raised
// later without invalidating existing records.
export const PIN_KDF_V1 = Object.freeze({
  algo: "scrypt" as const,
  N: 2 ** 15,
  r: 8,
  p: 1,
  keyLen: 64,
  saltBytes: 32,
});

export const PIN_POLICY = Object.freeze({
  minLength: 6,
  maxLength: 12,
  maxAttempts: 5,          // then lockout -> Discord re-auth
  lockoutMs: 15 * 60_000,
});

export class PinPolicyError extends Error {}

// scrypt's N is memory-hard; Node's default maxmem (32MB) is too small for N=2^15.
const maxmem = 256 * 1024 * 1024;

function assertPinShape(pin: string): void {
  if (typeof pin !== "string") throw new PinPolicyError("pin must be a string");
  if (!/^\d+$/.test(pin)) throw new PinPolicyError("pin must be digits only");
  if (pin.length < PIN_POLICY.minLength || pin.length > PIN_POLICY.maxLength) {
    throw new PinPolicyError(`pin must be ${PIN_POLICY.minLength}-${PIN_POLICY.maxLength} digits`);
  }
  // Reject the obvious: all-same-digit and simple ascending/descending runs.
  if (/^(\d)\1+$/.test(pin)) throw new PinPolicyError("pin must not be a single repeated digit");
  const asc = "0123456789012345";
  const desc = "9876543210987654";
  if (asc.includes(pin) || desc.includes(pin)) throw new PinPolicyError("pin must not be a sequential run");
}

/** Encoded as `scrypt$N$r$p$<salt-b64>$<hash-b64>` so cost params travel with the record. */
export async function hashPin(pin: string): Promise<string> {
  assertPinShape(pin);
  const salt = randomBytes(PIN_KDF_V1.saltBytes);
  const key = (await scrypt(pin, salt, PIN_KDF_V1.keyLen, {
    N: PIN_KDF_V1.N, r: PIN_KDF_V1.r, p: PIN_KDF_V1.p, maxmem,
  })) as Buffer;
  return `scrypt$${PIN_KDF_V1.N}$${PIN_KDF_V1.r}$${PIN_KDF_V1.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * Constant-time verify. Returns false on ANY malformed/unknown record rather than throwing —
 * a verifier that throws on bad input becomes an oracle and a liveness hazard. FAIL-CLOSED.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (typeof pin !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Refuse absurd params from a tampered record — they are a DoS vector, not a credential.
  if (N < 2 ** 12 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = (await scrypt(pin, salt, expected.length, { N, r, p, maxmem })) as Buffer;
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export interface AttemptState { failures: number; lockedUntilMs: number | null }

/**
 * PURE lockout decision — no clock, no storage. `nowMs` is injected so this is replay-testable.
 * FAIL-CLOSED: an unreadable/absent state denies rather than permits.
 */
export function evaluateAttempt(
  state: AttemptState | null | undefined,
  nowMs: number,
  policy = PIN_POLICY,
): { allowed: boolean; reason: string; retryAfterMs: number } {
  if (!state || typeof state.failures !== "number") {
    return { allowed: false, reason: "attempt_state_unreadable", retryAfterMs: 0 };
  }
  if (state.lockedUntilMs != null && nowMs < state.lockedUntilMs) {
    return { allowed: false, reason: "locked_out", retryAfterMs: state.lockedUntilMs - nowMs };
  }
  if (state.failures >= policy.maxAttempts && state.lockedUntilMs == null) {
    return { allowed: false, reason: "lockout_required", retryAfterMs: policy.lockoutMs };
  }
  return { allowed: true, reason: "ok", retryAfterMs: 0 };
}

/** PURE state transition after an attempt. */
export function nextAttemptState(
  state: AttemptState,
  success: boolean,
  nowMs: number,
  policy = PIN_POLICY,
): AttemptState {
  if (success) return { failures: 0, lockedUntilMs: null };
  const failures = state.failures + 1;
  return failures >= policy.maxAttempts
    ? { failures, lockedUntilMs: nowMs + policy.lockoutMs }
    : { failures, lockedUntilMs: null };
}
