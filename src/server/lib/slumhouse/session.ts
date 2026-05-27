/**
 * HMAC-signed session cookie helpers for the Slumhouse portal.
 *
 * Token format: `<discordUserId>:<expUnixSec>:<sigBase64Url>`
 *   sig = HMAC-SHA256(SLUMHOUSE_SESSION_SECRET, `<discordUserId>:<expUnixSec>`)
 *
 * No DB lookup happens in verifySession — the caller is responsible for
 * fetching the slumhouse_users row after verifying the signature + expiry.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "slumhouse_sid";

interface SignArgs {
  discordUserId: string;
  ttlSec: number;
}

type VerifyResult = { ok: true; discordUserId: string } | { ok: false; reason: string };

function secret(): string {
  const s = process.env.SLUMHOUSE_SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error("missing_env:SLUMHOUSE_SESSION_SECRET (must be ≥32 chars)");
  }
  return s;
}

export function signSession({ discordUserId, ttlSec }: SignArgs): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${discordUserId}:${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}:${sig}`;
}

export function verifySession(token: string): VerifyResult {
  if (!token) return { ok: false, reason: "empty" };
  const parts = token.split(":");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [discordUserId, expStr, sig] = parts;
  if (!discordUserId || !expStr || !sig) return { ok: false, reason: "malformed" };

  const payload = `${discordUserId}:${expStr}`;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");

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
