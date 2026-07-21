// src/server/lib/slumhouse/agent-ticket.ts — the member edge-client's identity token.
//
// Charter item 9a. Discord has NO device authorization grant (RFC 8628) — verified against
// Discord's live docs 2026-07-21, OA-138 — so the edge client cannot obtain a Discord token of
// its own. Instead OUR server is the authorization server and Discord stays the identity
// provider it already is: the member pairs the agent in a browser where they are already
// Discord-authenticated, and we mint THIS token.
//
// ★ DOMAIN SEPARATION, same law as pin-ticket.ts. Session, PIN ticket and agent token are all
// HMAC-SHA256 over the SAME secret. Without a purpose tag inside the MAC, an agent token would
// be byte-for-byte a valid session token — and an agent token is long-lived and lives on a
// family member's PC, which is by far the weakest of the three locations. So the purpose tag is
// signed, and verification REQUIRES it. A session token cannot verify as an agent token and an
// agent token cannot verify as a session.
//
// ★ REVOCATION IS BORROWED, NOT INVENTED. The payload carries the member's
// `slumhouse_users.session_epoch`. `POST /slumhouse/admin/revoke-sessions` already bumps that
// epoch to kill browser sessions; because the epoch is inside the MAC and re-checked against the
// DB at verify time, the SAME lever also kills every agent token that member holds. A stateless
// token with no revocation path would have been the easy build and the wrong one.
//
// TEST-MODE / pre-Phase-5: this token authenticates a member's agent to OUR mock endpoints. It
// carries no broker authority and never will — broker credentials are item 8's vault, and
// `broker_accounts` is never written from the member surface (member-office.ts INVARIANTS).
import { createHmac, timingSafeEqual } from "node:crypto";

const PURPOSE = "slumhouse.agent.v1";

/** 30 days: the agent runs unattended for long stretches; re-pairing is a manual act. */
export const AGENT_TICKET_TTL_SEC = 30 * 24 * 60 * 60;

function secret(): string | null {
  const s = process.env.SLUMHOUSE_SESSION_SECRET;
  return typeof s === "string" && s.length > 0 ? s : null;
}

function mac(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/**
 * payload = `<purpose>:<discordUserId>:<sessionEpoch>:<expEpochSec>`
 *
 * Every field is INSIDE the MAC. `sessionEpoch` is what makes revocation work.
 */
export function signAgentTicket(
  discordUserId: string,
  sessionEpoch: number,
  nowMs: number,
  ttlSec: number = AGENT_TICKET_TTL_SEC,
): string | null {
  const key = secret();
  if (!key) return null;                        // fail-closed: no secret, no token
  if (typeof discordUserId !== "string" || discordUserId.length === 0) return null;
  if (discordUserId.includes(":")) return null; // no separator injection into the payload
  if (!Number.isInteger(sessionEpoch) || sessionEpoch < 0) return null;
  if (!Number.isInteger(ttlSec) || ttlSec <= 0) return null;

  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const payload = `${PURPOSE}:${discordUserId}:${sessionEpoch}:${exp}`;
  return `${payload}:${mac(payload, key)}`;
}

export interface AgentTicketResult {
  valid: boolean;
  discordUserId: string | null;
  sessionEpoch: number | null;
  reason: string;
}

const BAD = (reason: string): AgentTicketResult => ({
  valid: false, discordUserId: null, sessionEpoch: null, reason,
});

/**
 * FAIL-CLOSED on every malformed / expired / foreign-purpose token. Never throws.
 *
 * NOTE: this proves the token was minted by us and is unexpired. The CALLER must still compare
 * the returned `sessionEpoch` against the member's current `slumhouse_users.session_epoch` —
 * that DB read is the revocation check and cannot happen in a pure function.
 */
export function verifyAgentTicket(token: unknown, nowMs: number): AgentTicketResult {
  const key = secret();
  if (!key) return BAD("no_secret");
  if (typeof token !== "string" || token.length === 0) return BAD("no_token");

  const parts = token.split(":");
  if (parts.length !== 5) return BAD("malformed");
  const [purpose, userId, epochRaw, expRaw, sig] = parts;

  // The purpose check IS the domain separation. A session or PIN token fails here.
  if (purpose !== PURPOSE) return BAD("wrong_purpose");
  if (!userId) return BAD("malformed");

  const epoch = Number(epochRaw);
  const exp = Number(expRaw);
  if (!Number.isInteger(epoch) || !Number.isInteger(exp)) return BAD("malformed");
  if (Math.floor(nowMs / 1000) >= exp) return BAD("expired");

  const expected = mac(`${purpose}:${userId}:${epoch}:${exp}`, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return BAD("bad_signature");

  return { valid: true, discordUserId: userId, sessionEpoch: epoch, reason: "ok" };
}
