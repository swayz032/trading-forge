// src/server/lib/agent-pairing.ts — pure pairing-code logic for the member edge client.
//
// Charter item 9a. Discord has no device authorization grant (OA-138, verified against Discord's
// live docs), so we implement the ERGONOMICS of RFC 8628 with our own server as the
// authorization server: the agent displays a short code, the member types it into the Office in
// a browser where they are already Discord-authenticated, and the server binds the two.
//
// Everything here is PURE: randomness and the clock are injected. That is not ceremony — it is
// what lets the expiry, lockout and single-use branches be tested by value instead of by
// sleeping, and it keeps the security policy reviewable in one file with no I/O in the way.
//
// STORAGE IS NOT HERE. The route owns the store. See the route's header for the deliberate
// in-memory choice and its declared limits.

/**
 * Crockford Base32. Excludes I, L, O and U — I/L/1 and O/0 are the classic misreads, and U is
 * dropped so the code cannot spell an obscenity. 32 symbols is a power of two, so a byte can be
 * masked (`& 31`) with ZERO modulo bias; `% 26`-style alphabets silently skew toward early
 * letters and weaken the code.
 */
export const PAIRING_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 8 symbols × 32 = 2^40 ≈ 1.1e12 codes. With a 10-minute TTL and claim lockout, guessing is not a path. */
export const PAIRING_CODE_LEN = 8;

/** Short on purpose: a pairing code is a bearer secret sitting on a screen. */
export const PAIRING_TTL_SEC = 10 * 60;

/** How often the agent should poll. Returned to the client so the cadence is server-controlled. */
export const PAIRING_POLL_INTERVAL_SEC = 5;

/** Wrong-code attempts allowed per member before a cooldown. Mirrors the member-PIN posture. */
export const PAIRING_MAX_CLAIM_ATTEMPTS = 5;
export const PAIRING_LOCKOUT_SEC = 15 * 60;

export type PairingStatus = "pending" | "approved" | "expired" | "consumed";

export interface PairingRecord {
  /** Opaque device handle; safe to log. */
  deviceId: string;
  /** Hash of the device's bearer secret — never the secret itself (mirrors pin_hash). */
  deviceSecretHash: string;
  /** Normalized pairing code. */
  code: string;
  status: PairingStatus;
  createdAtMs: number;
  expiresAtMs: number;
  /** Set only once a member claims it. */
  discordUserId: string | null;
  /** Free-text device label shown to the member before they approve. */
  deviceLabel: string;
}

/**
 * Build a code from caller-supplied random bytes.
 *
 * Requires at least PAIRING_CODE_LEN bytes and returns null otherwise — a short buffer would
 * otherwise silently produce a short, weak code. Fail-closed beats a quietly degraded secret.
 */
export function generatePairingCode(randomBytes: Uint8Array, len: number = PAIRING_CODE_LEN): string | null {
  if (!Number.isInteger(len) || len <= 0) return null;
  if (!randomBytes || randomBytes.length < len) return null;
  let out = "";
  for (let i = 0; i < len; i++) {
    out += PAIRING_ALPHABET[randomBytes[i] & 31]; // 31 = alphabet length - 1; power-of-two ⇒ unbiased
  }
  return out;
}

/** Display form: `ABCD-EFGH`. Presentation only — never the stored/compared form. */
export function formatPairingCode(code: string): string {
  if (typeof code !== "string" || code.length !== PAIRING_CODE_LEN) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Canonicalise member input before comparison.
 *
 * Forgiving about the things humans actually get wrong — case, spaces, hyphens, and the
 * Crockford lookalikes (I/L→1, O→0) — and strict about everything else. Returns null when the
 * result is not a well-formed code, so a caller can never compare against a half-parsed string.
 */
export function normalizePairingCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .toUpperCase()
    .replace(/[\s\-_]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (cleaned.length !== PAIRING_CODE_LEN) return null;
  for (const ch of cleaned) {
    if (!PAIRING_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}

export function isExpired(record: Pick<PairingRecord, "expiresAtMs">, nowMs: number): boolean {
  return nowMs >= record.expiresAtMs;
}

/**
 * Effective status: expiry is derived from the clock, never from a stored flag alone.
 *
 * A stored status can go stale (nothing sweeps memory on a timer); the clock cannot. Deriving it
 * means an expired-but-unswept record can never read as `pending`.
 */
export function effectiveStatus(record: PairingRecord, nowMs: number): PairingStatus {
  if (record.status === "consumed") return "consumed";
  if (isExpired(record, nowMs)) return "expired";
  return record.status;
}

export interface ClaimAttemptState {
  failures: number;
  lockedUntilMs: number | null;
}

export interface ClaimDecision {
  allowed: boolean;
  reason: "ok" | "locked";
  retryAfterSec: number;
}

/** Is this member allowed to attempt a claim right now? */
export function evaluateClaimAttempt(state: ClaimAttemptState, nowMs: number): ClaimDecision {
  if (state.lockedUntilMs != null && nowMs < state.lockedUntilMs) {
    return { allowed: false, reason: "locked", retryAfterSec: Math.ceil((state.lockedUntilMs - nowMs) / 1000) };
  }
  return { allowed: true, reason: "ok", retryAfterSec: 0 };
}

/**
 * Next lockout state after an attempt.
 *
 * A SUCCESS clears the counter. A failure increments and, at the threshold, starts a cooldown —
 * and the counter resets at that point so the next lockout requires a fresh run of failures
 * rather than one-strike-forever.
 */
export function nextClaimState(
  state: ClaimAttemptState,
  success: boolean,
  nowMs: number,
): ClaimAttemptState {
  if (success) return { failures: 0, lockedUntilMs: null };
  const failures = state.failures + 1;
  if (failures >= PAIRING_MAX_CLAIM_ATTEMPTS) {
    return { failures: 0, lockedUntilMs: nowMs + PAIRING_LOCKOUT_SEC * 1000 };
  }
  return { failures, lockedUntilMs: state.lockedUntilMs ?? null };
}
