/**
 * Passcode-gated admin session for the Slumhouse "Office" page (operator-only).
 *
 * This is SEPARATE from the friend-facing Discord session (session.ts). Friends
 * authenticate with Discord OAuth and see The Crib/Kitchen/Recipe. The Office is
 * operator-only and gated by a PASSCODE the operator sets in `.env`
 * (SLUMHOUSE_ADMIN_PASSCODE) — never by Discord identity. A friend signed into
 * Discord still cannot reach the Office without the passcode.
 *
 * Token format: `admin:<expUnixSec>:<sigBase64Url>`
 *   sig = HMAC-SHA256(SLUMHOUSE_SESSION_SECRET, `admin:<expUnixSec>`)
 *
 * FAIL-CLOSED: if SLUMHOUSE_ADMIN_PASSCODE is unset (or <6 chars), the Office is
 * permanently locked — checkPasscode() always returns false. There is no default
 * passcode and no bypass. Set a strong value in `.env` to enable the Office.
 */
import { createHmac, timingSafeEqual, createHash } from "node:crypto";

export const ADMIN_COOKIE_NAME = "slumhouse_admin_sid";

/** Default admin session lifetime — short, re-enter the passcode after it lapses. */
export const ADMIN_SESSION_TTL_SEC = 60 * 60 * 4; // 4 hours

type VerifyResult = { ok: true } | { ok: false; reason: string };

function sessionSecret(): string {
  const s = process.env.SLUMHOUSE_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("missing_env:SLUMHOUSE_SESSION_SECRET (must be ≥32 chars)");
  }
  return s;
}

/**
 * Whether the Office is configured (a usable passcode is set). When false the
 * page should render a "not configured" state and the auth endpoint refuses.
 */
export function isAdminConfigured(): boolean {
  const p = process.env.SLUMHOUSE_ADMIN_PASSCODE;
  return typeof p === "string" && p.length >= 6;
}

/**
 * Timing-safe passcode comparison. Returns false when the Office is not
 * configured (fail-closed) or the input does not match. Compares SHA-256
 * digests so inputs of differing length don't leak via timing/length.
 */
export function checkPasscode(input: string): boolean {
  if (!isAdminConfigured()) return false;
  if (typeof input !== "string" || input.length === 0) return false;
  const expected = process.env.SLUMHOUSE_ADMIN_PASSCODE as string;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function signAdminSession(ttlSec: number = ADMIN_SESSION_TTL_SEC): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `admin:${exp}`;
  const sig = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}:${sig}`;
}

export function verifyAdminSession(token: string): VerifyResult {
  if (!token) return { ok: false, reason: "empty" };
  const parts = token.split(":");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [scope, expStr, sig] = parts;
  if (scope !== "admin" || !expStr || !sig) return { ok: false, reason: "malformed" };

  const payload = `admin:${expStr}`;
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");

  if (sig.length !== expected.length) return { ok: false, reason: "sig_length" };
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, reason: "sig_mismatch" };
  }

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true };
}

/** Extract + verify the admin session from a raw Cookie header. */
export function adminSessionFromCookie(cookieHeader: string | undefined): boolean {
  const raw = cookieHeader ?? "";
  const match = raw.match(/(?:^|;\s*)slumhouse_admin_sid=([^;]+)/);
  if (!match) return false;
  try {
    return verifyAdminSession(decodeURIComponent(match[1])).ok;
  } catch {
    return false;
  }
}
