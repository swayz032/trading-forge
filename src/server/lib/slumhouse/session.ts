/**
 * HMAC-signed session cookie helpers for the Slumhouse portal.
 *
 * Token format (v2, 4-part): `<discordUserId>:<epoch>:<expUnixSec>:<sigBase64Url>`
 *   sig = HMAC-SHA256(SLUMHOUSE_SESSION_SECRET, `<discordUserId>:<epoch>:<expUnixSec>`)
 *
 * Token format (v1, 3-part, legacy): `<discordUserId>:<expUnixSec>:<sigBase64Url>`
 *   sig = HMAC-SHA256(SLUMHOUSE_SESSION_SECRET, `<discordUserId>:<expUnixSec>`)
 *   epoch is assumed to be 0 for all v1 tokens.
 *
 * FIX 4 (deep-scan #12): The epoch field enables server-side revocation.
 * requireSlumhouseUser compares the token's epoch against slumhouse_users.session_epoch
 * in the DB. A revoke call (POST /slumhouse/admin/revoke-sessions) increments the DB
 * epoch, making all tokens signed under the old epoch invalid. Legacy v1 tokens carry
 * implicit epoch=0 and are rejected once a revoke bumps the user's DB epoch to ≥1.
 *
 * No DB lookup happens inside verifySession — the caller (requireSlumhouseUser)
 * performs the epoch comparison after fetching the slumhouse_users row.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "slumhouse_sid";

interface SignArgs {
  discordUserId: string;
  ttlSec: number;
  /** Current revocation epoch from slumhouse_users.session_epoch (default 0). */
  epoch?: number;
}

export type VerifyResult =
  | { ok: true; discordUserId: string; epoch: number }
  | { ok: false; reason: string };

function secret(): string {
  const s = process.env.SLUMHOUSE_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("missing_env:SLUMHOUSE_SESSION_SECRET (must be ≥32 chars)");
  }
  return s;
}

/**
 * Sign a new 4-part session token embedding the revocation epoch.
 */
export function signSession({ discordUserId, ttlSec, epoch = 0 }: SignArgs): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${discordUserId}:${epoch}:${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}:${sig}`;
}

/**
 * Verify a session token.  Accepts both the v2 4-part format (with epoch) and
 * the v1 3-part legacy format (epoch assumed 0).  Returns epoch in the ok result
 * so the caller can compare it against the DB without a second parse.
 */
export function verifySession(token: string): VerifyResult {
  if (!token) return { ok: false, reason: "empty" };
  const parts = token.split(":");
  // base64url and numeric fields contain no colons — split length is deterministic.
  if (parts.length !== 3 && parts.length !== 4) {
    return { ok: false, reason: "malformed" };
  }

  let discordUserId: string;
  let epoch: number;
  let expStr: string;
  let sig: string;

  if (parts.length === 4) {
    // v2 format: discordUserId:epoch:exp:sig
    [discordUserId, , expStr, sig] = parts as [string, string, string, string];
    const epochStr = parts[1];
    epoch = Number(epochStr);
    if (!Number.isFinite(epoch) || epoch < 0 || !Number.isInteger(epoch)) {
      return { ok: false, reason: "malformed_epoch" };
    }
  } else {
    // v1 legacy format: discordUserId:exp:sig
    [discordUserId, expStr, sig] = parts as [string, string, string];
    epoch = 0;
  }

  if (!discordUserId || !expStr || !sig) {
    return { ok: false, reason: "malformed" };
  }

  // Reconstruct the signed payload (must match exactly what signSession wrote).
  const payload =
    parts.length === 4
      ? `${discordUserId}:${epoch}:${expStr}`
      : `${discordUserId}:${expStr}`;

  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");

  if (sig.length !== expected.length) return { ok: false, reason: "sig_length" };
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, reason: "sig_mismatch" };
  }

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, discordUserId, epoch };
}
