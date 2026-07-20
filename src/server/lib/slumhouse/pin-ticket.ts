// src/server/lib/slumhouse/pin-ticket.ts — short-lived "PIN satisfied" marker.
//
// The member's office PIN is a SECOND factor behind the Discord session. Once cleared, the
// browser needs to carry that fact for a while — hence a ticket.
//
// ★ DOMAIN SEPARATION IS THE POINT OF THIS FILE.
// The obvious implementation is to reuse signSession() with a different cookie name. That would
// be a TOKEN-CONFUSION hazard: the resulting token is, byte for byte, a valid session token, so
// moving it from the pin cookie into the session cookie would yield a full session. Same secret,
// same payload shape, different intent — and intent is not something HMAC can see.
//
// So every ticket is signed over a payload that carries an explicit purpose tag, and
// verification REQUIRES that tag. A session token cannot verify as a pin ticket and a pin ticket
// cannot verify as a session, even though both are HMAC-SHA256 over the same secret.
import { createHmac, timingSafeEqual } from "node:crypto";

const PURPOSE = "slumhouse.pin.v1";
export const PIN_COOKIE_NAME = "slumhouse_pin";
export const PIN_TTL_SEC = 12 * 60 * 60;

function secret(): string | null {
  const s = process.env.SLUMHOUSE_SESSION_SECRET;
  return typeof s === "string" && s.length > 0 ? s : null;
}

function mac(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** payload = `<purpose>:<discordUserId>:<expEpochSec>` — the purpose tag is INSIDE the MAC. */
export function signPinTicket(discordUserId: string, nowMs: number, ttlSec = PIN_TTL_SEC): string | null {
  const key = secret();
  if (!key) return null;                       // fail-closed: no secret, no ticket
  if (typeof discordUserId !== "string" || discordUserId.length === 0) return null;
  if (discordUserId.includes(":")) return null; // no separator injection into the payload
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const payload = `${PURPOSE}:${discordUserId}:${exp}`;
  return `${payload}:${mac(payload, key)}`;
}

export interface PinTicketResult { valid: boolean; discordUserId: string | null; reason: string }

const BAD = (reason: string): PinTicketResult => ({ valid: false, discordUserId: null, reason });

/** FAIL-CLOSED on every malformed/expired/foreign-purpose token. Never throws. */
export function verifyPinTicket(token: unknown, nowMs: number): PinTicketResult {
  const key = secret();
  if (!key) return BAD("no_secret");
  if (typeof token !== "string" || token.length === 0) return BAD("no_token");

  const parts = token.split(":");
  if (parts.length !== 4) return BAD("malformed");
  const [purpose, userId, expRaw, sig] = parts;

  // The purpose check is the domain separation. A session token fails here.
  if (purpose !== PURPOSE) return BAD("wrong_purpose");
  if (!userId) return BAD("malformed");

  const exp = Number(expRaw);
  if (!Number.isInteger(exp)) return BAD("malformed");
  if (Math.floor(nowMs / 1000) >= exp) return BAD("expired");

  const expected = mac(`${purpose}:${userId}:${exp}`, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return BAD("bad_signature");

  return { valid: true, discordUserId: userId, reason: "ok" };
}
