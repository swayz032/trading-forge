/**
 * Passcode-gated admin session for the Slumhouse "Office" page (operator-only).
 *
 * This is SEPARATE from the friend-facing Discord session (session.ts). Friends
 * authenticate with Discord OAuth and see The Crib/Kitchen/Recipe. The Office is
 * operator-only and gated by a PASSCODE the operator sets in `.env`
 * (SLUMHOUSE_ADMIN_PASSCODE) — never by Discord identity. A friend signed into
 * Discord still cannot reach the Office without the passcode.
 *
 * Token format v1 (no Discord, 3-part): `admin:<expUnixSec>:<sigBase64Url>`
 *   sig = HMAC-SHA256(SLUMHOUSE_SESSION_SECRET, `admin:<expUnixSec>`)
 *
 * Token format v2 (with Discord, 4-part): `admin:<discordUserId>:<expUnixSec>:<sigBase64Url>`
 *   sig = HMAC-SHA256(SLUMHOUSE_SESSION_SECRET, `admin:<discordUserId>:<expUnixSec>`)
 *
 * FIX 2 (deep-scan #12): When the browser that enters the admin passcode ALSO holds
 * a valid friend Discord session (slumhouse_sid), the Discord user ID is encoded in
 * the admin token. Every control mutation audit row subsequently carries
 * actor_discord_id so the audit trail shows WHO made the change, not just that an
 * admin did. Tokens without Discord identity continue to work (backward-compat).
 *
 * FAIL-CLOSED: if SLUMHOUSE_ADMIN_PASSCODE is unset (or <4 chars), the Office is
 * permanently locked — checkPasscode() always returns false. There is no default
 * passcode and no bypass. Set a strong value in `.env` to enable the Office.
 */
import { createHmac, timingSafeEqual, createHash } from "node:crypto";

export const ADMIN_COOKIE_NAME = "slumhouse_admin_sid";

/** Default admin session lifetime — short, re-enter the passcode after it lapses. */
export const ADMIN_SESSION_TTL_SEC = 60 * 60 * 4; // 4 hours

type VerifyResult =
  | { ok: true; discordUserId?: string }
  | { ok: false; reason: string };

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
  // Min 4 chars supports a numeric PIN (operator's choice). Brute-force is bounded
  // by the 5-attempt / 15-min lockout in admin.ts, so a short PIN stays safe enough
  // for this personal, passcode-gated operator page.
  return typeof p === "string" && p.length >= 4;
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

/**
 * Sign an admin session token.
 *
 * @param ttlSec     Session lifetime in seconds (defaults to ADMIN_SESSION_TTL_SEC).
 * @param discordUserId  Optional Discord user ID to embed for audit trail (FIX 2).
 *   When provided, emits 4-part token `admin:<discordUserId>:<exp>:<sig>`.
 *   When omitted, emits 3-part token `admin:<exp>:<sig>` (backward-compat).
 */
export function signAdminSession(
  ttlSec: number = ADMIN_SESSION_TTL_SEC,
  discordUserId?: string,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = discordUserId
    ? `admin:${discordUserId}:${exp}`
    : `admin:${exp}`;
  const sig = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}:${sig}`;
}

export function verifyAdminSession(token: string): VerifyResult {
  if (!token) return { ok: false, reason: "empty" };
  const parts = token.split(":");
  // base64url and numeric fields contain no colons — length is deterministic.
  if (parts.length !== 3 && parts.length !== 4) {
    return { ok: false, reason: "malformed" };
  }

  const scope = parts[0];
  if (scope !== "admin") return { ok: false, reason: "malformed" };

  let discordUserId: string | undefined;
  let expStr: string;
  let sig: string;

  if (parts.length === 4) {
    // v2 format: admin:<discordUserId>:<exp>:<sig>
    discordUserId = parts[1];
    expStr = parts[2];
    sig = parts[3];
  } else {
    // v1 format: admin:<exp>:<sig>
    discordUserId = undefined;
    expStr = parts[1];
    sig = parts[2];
  }

  if (!expStr || !sig) return { ok: false, reason: "malformed" };

  const payload = discordUserId
    ? `admin:${discordUserId}:${expStr}`
    : `admin:${expStr}`;
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");

  if (sig.length !== expected.length) return { ok: false, reason: "sig_length" };
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, reason: "sig_mismatch" };
  }

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, discordUserId };
}

/** Extract + verify the admin session from a raw Cookie header. Returns true/false. */
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

/**
 * Extract the Discord user ID threaded into the admin session cookie (FIX 2).
 * Returns undefined when the cookie is absent, invalid, or was minted without a
 * Discord identity (admin unlocked without an active friend session).
 */
export function adminDiscordUserIdFromCookie(
  cookieHeader: string | undefined,
): string | undefined {
  const raw = cookieHeader ?? "";
  const match = raw.match(/(?:^|;\s*)slumhouse_admin_sid=([^;]+)/);
  if (!match) return undefined;
  try {
    const result = verifyAdminSession(decodeURIComponent(match[1]));
    if (result.ok) return result.discordUserId;
    return undefined;
  } catch {
    return undefined;
  }
}
