/**
 * admin-recovery.ts — Vacation-Survival Finding A-5
 *
 * HMAC-authenticated admin endpoints for no-code recovery of stuck states
 * that would otherwise require the operator to execute code directly.
 *
 * Both endpoints use the SAME HMAC pattern as POST /api/admin/self-restart
 * (admin.ts), using ADMIN_RESTART_HMAC_SECRET and a 60-second timestamp
 * replay-protection window.
 *
 * Routes:
 *   POST /api/admin/clear-kill-switch-cache
 *     Calls clearKillSwitchCache() to force-expire the per-session
 *     Python compliance-subprocess result cache. Use when a Python subprocess
 *     failure has blocked all entries (fail-closed) and the operator needs to
 *     resume trading without restarting the process.
 *     Recovery path: python_subprocess_failed → call this → cache cleared →
 *       next signal triggers fresh Python evaluation.
 *
 *   POST /api/admin/clear-stuck-session
 *     Calls clearStuckSessionId(sessionId) to remove a session from the
 *     stuckSessionIds registry (set when forceCloseAllPositions cannot find
 *     a price for a position). The operator must first manually resolve the
 *     stuck position in the broker UI, then call this endpoint.
 *     Body: { timestamp, reason, session_id }
 *
 * Both are fire-and-forget for NSSM-managed Tower; curl-able from any phone.
 *
 * Curl example (clear-kill-switch-cache):
 *   TIMESTAMP=$(date +%s)
 *   REASON="python_stuck_vacation_day3"
 *   SIG=$(echo -n "${TIMESTAMP}:${REASON}" | openssl dgst -sha256 \
 *         -hmac "$ADMIN_RESTART_HMAC_SECRET" | awk '{print $2}')
 *   curl -X POST https://<relay>/api/admin/clear-kill-switch-cache \
 *     -H "Content-Type: application/json" \
 *     -H "X-Restart-Signature: $SIG" \
 *     -d "{\"timestamp\": $TIMESTAMP, \"reason\": \"$REASON\"}"
 *
 * Curl example (clear-stuck-session):
 *   TIMESTAMP=$(date +%s)
 *   REASON="force_flatten_stuck_pos_manually_closed"
 *   SIG=$(echo -n "${TIMESTAMP}:${REASON}" | openssl dgst -sha256 \
 *         -hmac "$ADMIN_RESTART_HMAC_SECRET" | awk '{print $2}')
 *   curl -X POST https://<relay>/api/admin/clear-stuck-session \
 *     -H "Content-Type: application/json" \
 *     -H "X-Restart-Signature: $SIG" \
 *     -d "{\"timestamp\": $TIMESTAMP, \"reason\": \"$REASON\", \
 *          \"session_id\": \"<session-uuid>\"}"
 *
 * HMAC: HMAC-SHA256(ADMIN_RESTART_HMAC_SECRET, "${timestamp}:${reason}")
 * Replay protection: timestamp drift > 60s → 401.
 * Dev/test bypass: when ADMIN_RESTART_HMAC_SECRET is unset and NODE_ENV != "production".
 *
 * Import logger from ./logger.js (not ../index.js) per CLAUDE.md §13 feedback rule.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { notifyWarning } from "../services/notification-service.js";
import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";

export const adminRecoveryRoutes = Router();

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum allowed timestamp drift for HMAC replay protection (matches self-restart). */
const HMAC_TIMESTAMP_DRIFT_MS = 60_000;

// ─── HMAC helper ──────────────────────────────────────────────────────────────

/**
 * Verify X-Restart-Signature header using the same algorithm as self-restart.
 * Payload: "${timestamp}:${reason}"
 * Algorithm: HMAC-SHA256 with ADMIN_RESTART_HMAC_SECRET.
 *
 * Dev/test bypass when secret unset and NODE_ENV !== "production".
 */
function verifyRestartHmac(
  headerValue: string | undefined,
  timestamp: number,
  reason: string,
): { ok: true } | { ok: false; reason_code: string } {
  const secret = process.env.ADMIN_RESTART_HMAC_SECRET;

  if (!secret || secret.length === 0) {
    // deep-scan Security re-cert HIGH: fail CLOSED when the secret is unset — in EVERY environment
    // (was a NODE_ENV !== "production" dev-bypass = full auth bypass on these Bearer-exempt recovery
    // routes in staging/test/unset). Mirrors admin-frozen-policy-override's unconditional fail-closed.
    return { ok: false, reason_code: "secret_not_configured" };
  }

  if (!headerValue || typeof headerValue !== "string" || headerValue.length === 0) {
    return { ok: false, reason_code: "missing_header" };
  }

  const payload = `${timestamp}:${reason}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");

  if (headerValue.length !== expected.length) {
    return { ok: false, reason_code: "signature_mismatch" };
  }

  try {
    const ok = timingSafeEqual(
      Buffer.from(headerValue, "hex"),
      Buffer.from(expected, "hex"),
    );
    return ok ? { ok: true } : { ok: false, reason_code: "signature_mismatch" };
  } catch {
    return { ok: false, reason_code: "signature_mismatch" };
  }
}

/**
 * Shared body + HMAC validation for both recovery routes.
 * Returns { ok: true, timestamp, reason, correlationId } or sends the error response.
 */
function validateHmacRequest(
  req: Request,
  res: Response,
): { ok: true; timestamp: number; reason: string; correlationId: string } | { ok: false } {
  // Honor an inbound x-correlation-id header so operator-initiated recovery preserves
  // end-to-end trace continuity; generate a fresh UUID only when absent/empty.
  const inboundCorrelationId = req.headers["x-correlation-id"];
  const headerCorrelationId =
    typeof inboundCorrelationId === "string" && inboundCorrelationId.trim().length > 0
      ? inboundCorrelationId.trim()
      : Array.isArray(inboundCorrelationId) && typeof inboundCorrelationId[0] === "string" && inboundCorrelationId[0].trim().length > 0
        ? inboundCorrelationId[0].trim()
        : null;
  const correlationId = headerCorrelationId ?? randomUUID();
  const body = (req.body ?? {}) as { timestamp?: unknown; reason?: unknown };

  if (typeof body.timestamp !== "number") {
    res.status(400).json({ error: "missing_body_field", field: "timestamp", correlationId });
    return { ok: false };
  }

  if (typeof body.reason !== "string" || (body.reason as string).trim().length === 0) {
    res.status(400).json({ error: "missing_body_field", field: "reason", correlationId });
    return { ok: false };
  }

  const timestamp = body.timestamp as number;
  const reason = (body.reason as string).trim();

  // Replay protection
  const drift = Math.abs(Date.now() - timestamp * 1000);
  if (drift > HMAC_TIMESTAMP_DRIFT_MS) {
    logger.warn({ drift, correlationId }, "admin-recovery: timestamp drift exceeded — replay protection");
    res.status(401).json({ error: "timestamp_drift_exceeded", drift_ms: drift, max_ms: HMAC_TIMESTAMP_DRIFT_MS, correlationId });
    return { ok: false };
  }

  // HMAC verification
  const sig = req.header("x-restart-signature");
  const verified = verifyRestartHmac(sig, timestamp, reason);
  if (!verified.ok) {
    logger.warn({ reason_code: verified.reason_code, correlationId }, "admin-recovery: HMAC verification failed");
    res.status(401).json({ error: "hmac_verification_failed", reason_code: verified.reason_code, correlationId });
    return { ok: false };
  }

  return { ok: true, timestamp, reason, correlationId };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/clear-kill-switch-cache
// ─────────────────────────────────────────────────────────────────────────────

adminRecoveryRoutes.post("/clear-kill-switch-cache", async (req, res) => {
  const validated = validateHmacRequest(req, res);
  if (!validated.ok) return;
  const { reason, correlationId } = validated;

  logger.info({ correlationId, reason }, "admin-recovery: clearing kill-switch cache (compliance subprocess recovery)");

  // Dynamic import to avoid circular dependency: admin-recovery → paper-execution-service → kill-switch
  try {
    const { clearKillSwitchCache } = await import("../services/paper-execution-service.js");
    clearKillSwitchCache();
  } catch (importErr) {
    logger.error({ err: importErr, correlationId }, "admin-recovery: clearKillSwitchCache import failed");
    res.status(500).json({ error: "clear_cache_failed", correlationId });
    return;
  }

  // Audit + Discord (non-blocking)
  await insertAuditRow({
    action: "admin.clear_kill_switch_cache",
    entityType: "system",
    entityId: null,
    decisionAuthority: "human",
    input: { reason } as Record<string, unknown>,
    result: { cleared: true } as Record<string, unknown>,
    status: "success",
    correlationId,
  }).catch((err) => logger.error({ err }, "admin-recovery: audit row write failed (non-blocking)"));

  notifyWarning(
    "Kill-Switch Cache Cleared",
    appendFamilyGradePostscript(
      `Operator cleared the compliance kill-switch cache via HMAC-authenticated endpoint. Reason: ${reason}. ` +
      "Next signal will trigger a fresh Python subprocess evaluation. " +
      "If the Python subprocess was the root cause, verify it has recovered before the next entry.",
      "Tony cleared a trading safety cache.",
      "No action needed — Tony is managing the bot's safety systems.",
    ),
    { correlationId, reason },
  );

  res.json({
    status: "kill_switch_cache_cleared",
    message: "Per-session Python kill-switch cache cleared. Next signal will re-evaluate via Python subprocess.",
    correlationId,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/clear-stuck-session
// ─────────────────────────────────────────────────────────────────────────────

adminRecoveryRoutes.post("/clear-stuck-session", async (req, res) => {
  const validated = validateHmacRequest(req, res);
  if (!validated.ok) return;
  const { reason, correlationId } = validated;

  const body = (req.body ?? {}) as { session_id?: unknown };

  if (typeof body.session_id !== "string" || (body.session_id as string).trim().length === 0) {
    res.status(400).json({ error: "missing_body_field", field: "session_id", correlationId });
    return;
  }

  const sessionId = (body.session_id as string).trim();

  logger.info({ correlationId, reason, sessionId }, "admin-recovery: clearing stuck session entry block");

  // Dynamic import to avoid potential circular deps
  try {
    const { clearStuckSessionId } = await import("../services/paper-execution-service.js");
    clearStuckSessionId(sessionId);
  } catch (importErr) {
    logger.error({ err: importErr, correlationId, sessionId }, "admin-recovery: clearStuckSessionId import failed");
    res.status(500).json({ error: "clear_stuck_failed", correlationId });
    return;
  }

  // Audit + Discord (non-blocking)
  await insertAuditRow({
    action: "admin.clear_stuck_session",
    entityType: "paper_session",
    entityId: sessionId,
    decisionAuthority: "human",
    input: { reason, sessionId } as Record<string, unknown>,
    result: { cleared: true } as Record<string, unknown>,
    status: "success",
    correlationId,
  }).catch((err) => logger.error({ err }, "admin-recovery: audit row write failed (non-blocking)"));

  notifyWarning(
    "Stuck Session Cleared",
    appendFamilyGradePostscript(
      `Operator cleared stuck-session entry block for session ${sessionId} via HMAC-authenticated endpoint. Reason: ${reason}. ` +
      "Ensure the stuck position has been manually closed in the broker UI before resuming entries. " +
      "Failure to do so may result in duplicate positions.",
      "Tony cleared a stuck trading session.",
      "No action needed — Tony is managing a minor position issue.",
    ),
    { correlationId, reason, sessionId },
  );

  res.json({
    status: "stuck_session_cleared",
    session_id: sessionId,
    message: "Stuck-session entry block cleared. Verify position is closed in broker UI before resuming.",
    correlationId,
  });
});
