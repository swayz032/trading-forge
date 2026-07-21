/**
 * Slumhouse Agent pairing (charter item 9a) — how a member's edge client gets an identity.
 *
 * Discord has NO device authorization grant (RFC 8628) — verified against Discord's live docs
 * 2026-07-21 (OA-138), mechanism substitution ruled in OR-158. So OUR server is the
 * authorization server and Discord stays the identity provider it already is:
 *
 *   1. agent  → POST /agent/pair/start   (no member auth — the device has no identity yet)
 *              ← { deviceId, deviceSecret, pairingCode, expiresAt, pollIntervalSec }
 *   2. member → POST /agent/pair/claim   (Discord session + PIN ticket + origin check)
 *              binds the code to THIS member
 *   3. agent  → POST /agent/pair/poll    (deviceId + deviceSecret)
 *              ← { status: "approved", agentToken } exactly once, then the record is consumed
 *
 * ★ STORAGE IS DELIBERATELY IN-MEMORY, AND THE LIMITS ARE STATED RATHER THAN DISCOVERED:
 *   - Pairing state is ephemeral BY NATURE (10-minute TTL), so a table would persist something
 *     whose whole purpose is to expire. No migration is the right answer, not the lazy one.
 *   - A restart mid-pair loses pending codes; the member re-pairs. Acceptable and visible.
 *   - MULTI-INSTANCE WOULD BREAK THIS — start and poll must hit the same process. The tower is
 *     single-instance (NSSM), which is why this is safe TODAY. If the backend is ever
 *     horizontally scaled, this store must move to Postgres or Redis FIRST. Declared here
 *     because "it worked on one box" is exactly the assumption that rots silently.
 *   - The issued token needs no storage at all: `agent-ticket.ts` is a signed HMAC carrying the
 *     member's `session_epoch`, so revocation rides the existing `revoke-sessions` lever.
 *
 * TEST-MODE / pre-Phase-5: the token authenticates a member's agent to our own endpoints. It
 * carries no broker authority — `broker_accounts` is never written from any member surface.
 */
import { Router, type Response } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { slumhouseUsers } from "../../../db/schema.js";
import {
  requireSlumhouseUser,
  checkSlumhouseOrigin,
  type SlumhouseRequest,
} from "../../../lib/slumhouse/require-session.js";
import {
  generatePairingCode,
  formatPairingCode,
  normalizePairingCode,
  effectiveStatus,
  evaluateClaimAttempt,
  nextClaimState,
  PAIRING_CODE_LEN,
  PAIRING_TTL_SEC,
  PAIRING_POLL_INTERVAL_SEC,
  type PairingRecord,
  type ClaimAttemptState,
} from "../../../lib/agent-pairing.js";
import { signAgentTicket } from "../../../lib/slumhouse/agent-ticket.js";
import { insertAuditRowSafe } from "../../../lib/audit-log-helper.js";

export const agentPairRouter = Router();

/** Bounded so a flood of unauthenticated /start calls cannot exhaust memory. */
const MAX_PENDING = 200;

const byCode = new Map<string, PairingRecord>();
const byDevice = new Map<string, string>();          // deviceId -> code
const claimAttempts = new Map<string, ClaimAttemptState>();

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("base64url");
}

/** Constant-time compare that cannot throw on length mismatch. */
function secretMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(sha256(presented));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Drop expired/consumed records. Called on every mutating request — no timer to die silently. */
function sweep(nowMs: number): void {
  for (const [code, rec] of byCode) {
    const st = effectiveStatus(rec, nowMs);
    if (st === "expired" || st === "consumed") {
      byCode.delete(code);
      byDevice.delete(rec.deviceId);
    }
  }
}

/** TEST-ONLY reset so suites do not leak state between cases. Never called by a route. */
export function __resetPairingStoreForTests(): void {
  byCode.clear();
  byDevice.clear();
  claimAttempts.clear();
}

// ── POST /agent/pair/start — the device asks for a code. NO member auth by design. ───────────
agentPairRouter.post("/slumhouse/api/member/agent/pair/start", (req, res) => {
  const nowMs = Date.now();
  sweep(nowMs);

  // Fail-CLOSED on saturation rather than evicting someone else's in-flight pairing.
  if (byCode.size >= MAX_PENDING) {
    res.status(503).json({ error: "pairing_capacity" });
    return;
  }

  const code = generatePairingCode(randomBytes(PAIRING_CODE_LEN));
  if (!code || byCode.has(code)) {
    // A collision or a short-entropy return is a refusal, never a weaker code.
    res.status(503).json({ error: "pairing_unavailable" });
    return;
  }

  const deviceId = randomBytes(16).toString("base64url");
  const deviceSecret = randomBytes(32).toString("base64url");
  const rawLabel = (req.body ?? {}).deviceLabel;
  const deviceLabel = typeof rawLabel === "string" ? rawLabel.slice(0, 60) : "Unknown device";

  byCode.set(code, {
    deviceId,
    deviceSecretHash: sha256(deviceSecret),   // the secret itself is never stored
    code,
    status: "pending",
    createdAtMs: nowMs,
    expiresAtMs: nowMs + PAIRING_TTL_SEC * 1000,
    discordUserId: null,
    deviceLabel,
  });
  byDevice.set(deviceId, code);

  void insertAuditRowSafe({
    action: "agent_pairing.started",
    status: "success",
    input: { deviceId, deviceLabel } as Record<string, unknown>,   // never the code or the secret
    correlationId: null,
  });

  res.status(201).json({
    deviceId,
    deviceSecret,
    pairingCode: formatPairingCode(code),
    expiresAtMs: nowMs + PAIRING_TTL_SEC * 1000,
    pollIntervalSec: PAIRING_POLL_INTERVAL_SEC,
  });
});

// ── POST /agent/pair/claim — the MEMBER binds the code to themselves, in the browser. ────────
agentPairRouter.post(
  "/slumhouse/api/member/agent/pair/claim",
  requireSlumhouseUser,
  (req: SlumhouseRequest, res: Response) => {
    if (!checkSlumhouseOrigin(req, res)) return;

    const viewerId = req.slumhouseUser!.discordUserId;
    const nowMs = Date.now();
    sweep(nowMs);

    // Lockout is keyed to the MEMBER, not the code: otherwise an attacker gets a fresh
    // allowance per guess simply by trying a different code.
    const state = claimAttempts.get(viewerId) ?? { failures: 0, lockedUntilMs: null };
    const gate = evaluateClaimAttempt(state, nowMs);
    if (!gate.allowed) {
      res.status(429).json({ error: "too_many_attempts", retryAfterSec: gate.retryAfterSec });
      return;
    }

    const code = normalizePairingCode((req.body ?? {}).code);
    const rec = code ? byCode.get(code) : undefined;
    const st = rec ? effectiveStatus(rec, nowMs) : null;

    if (!rec || st !== "pending") {
      claimAttempts.set(viewerId, nextClaimState(state, false, nowMs));
      // One answer for unknown / expired / already-claimed: a distinct message would let a
      // caller probe which codes exist.
      res.status(404).json({ error: "code_not_claimable" });
      return;
    }

    rec.status = "approved";
    rec.discordUserId = viewerId;
    claimAttempts.set(viewerId, nextClaimState(state, true, nowMs));

    void insertAuditRowSafe({
      action: "agent_pairing.claimed",
      status: "success",
      entityId: viewerId,
      input: { deviceId: rec.deviceId, deviceLabel: rec.deviceLabel } as Record<string, unknown>,
      correlationId: null,
    });

    res.json({ ok: true, deviceLabel: rec.deviceLabel });
  },
);

// ── POST /agent/pair/poll — the device collects its token, exactly once. ─────────────────────
agentPairRouter.post("/slumhouse/api/member/agent/pair/poll", async (req, res) => {
  const nowMs = Date.now();
  const body = (req.body ?? {}) as { deviceId?: unknown; deviceSecret?: unknown };

  if (typeof body.deviceId !== "string" || typeof body.deviceSecret !== "string") {
    res.status(400).json({ error: "device_credentials_required" });
    return;
  }

  const code = byDevice.get(body.deviceId);
  const rec = code ? byCode.get(code) : undefined;

  // Unknown device and wrong secret get the SAME answer — no oracle for valid deviceIds.
  if (!rec || !secretMatches(body.deviceSecret, rec.deviceSecretHash)) {
    res.status(401).json({ error: "device_unrecognised" });
    return;
  }

  const st = effectiveStatus(rec, nowMs);
  if (st === "expired" || st === "consumed") {
    byCode.delete(rec.code);
    byDevice.delete(rec.deviceId);
    res.status(410).json({ status: "expired" });
    return;
  }
  if (st === "pending") {
    res.json({ status: "pending", pollIntervalSec: PAIRING_POLL_INTERVAL_SEC });
    return;
  }

  // approved → mint once, then burn the record. Consumed BEFORE the token is emitted so a
  // concurrent second poll cannot also be served.
  rec.status = "consumed";
  byCode.delete(rec.code);
  byDevice.delete(rec.deviceId);

  const memberId = rec.discordUserId;
  if (!memberId) {
    res.status(500).json({ error: "pairing_state_invalid" });   // approved without a member: refuse
    return;
  }

  let epoch = 0;
  try {
    const rows = await db.select().from(slumhouseUsers)
      .where(eq(slumhouseUsers.discordUserId, memberId)).limit(1);
    if (!rows[0]) { res.status(403).json({ error: "member_not_found" }); return; }
    epoch = Number((rows[0] as { sessionEpoch?: number }).sessionEpoch ?? 0);
  } catch {
    res.status(503).json({ error: "pairing_unavailable" });     // fail-CLOSED, no token
    return;
  }

  const token = signAgentTicket(memberId, epoch, nowMs);
  if (!token) { res.status(503).json({ error: "pairing_unavailable" }); return; }

  void insertAuditRowSafe({
    action: "agent_pairing.token_issued",
    status: "success",
    entityId: memberId,
    input: { deviceId: rec.deviceId } as Record<string, unknown>,   // never the token
    correlationId: null,
  });

  res.json({ status: "approved", agentToken: token });
});
