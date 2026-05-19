/**
 * Harsh-Regime Phase Service — Wave 23D Carry-Forward
 *
 * Owns reading and writing the singleton `harsh_regime_phase` row (migration 0115).
 * The phase starts "advisory" (never blocks) and flips to "hard" once 90 days of
 * PAPER activation data have accumulated. After that flip the harsh-regime survival
 * gate at TESTING→PAPER becomes a HARD block.
 *
 * The flip is IRREVERSIBLE under normal operation. Manual override requires an
 * explicit reason and writes an audit_log row for attribution.
 *
 * FAIL-CLOSED contract:
 *   - getPhase() returns "advisory" on any DB error (fail-open is safe here:
 *     a transient DB error must never silently harden the gate to "hard").
 *   - flipPhaseToHard() is idempotent: if phase is already "hard", no-op.
 *   - setPhaseOverride() always writes audit_log regardless of direction.
 *
 * Used by:
 *   - scheduler.ts harsh-regime-phase-activation-check cron (daily 03:00 UTC)
 *   - lifecycle-service.ts TESTING→PAPER gate (reads phase, passes to Python)
 *   - admin.ts POST /api/admin/harsh-regime-phase (operator override)
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { harshRegimePhase, auditLog } from "../db/schema.js";
import { logger } from "../lib/logger.js";

export type PhaseValue = "advisory" | "hard";

export interface HarshRegimePhaseRecord {
  phase: PhaseValue;
  activatedAt: Date | null;
  firstStrategyId: string | null;
  activatedBy: string;
  updatedAt: Date;
}

export interface PhaseFlipResult {
  flipped: boolean;
  previousPhase: PhaseValue;
  currentPhase: PhaseValue;
  reason: string;
}

// ─── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read current phase from DB. Returns "advisory" on any error (fail-open
 * for reads — transient DB issues must not silently harden the gate).
 */
export async function getPhase(): Promise<PhaseValue> {
  try {
    const [row] = await db
      .select()
      .from(harshRegimePhase)
      .where(eq(harshRegimePhase.id, 1))
      .limit(1);

    if (!row) {
      logger.warn("harsh-regime-phase: no row found — defaulting to advisory (DB may need migration 0115)");
      return "advisory";
    }

    const phase = row.phase as PhaseValue;
    if (phase !== "advisory" && phase !== "hard") {
      logger.warn({ rawPhase: row.phase }, "harsh-regime-phase: unexpected phase value — defaulting to advisory");
      return "advisory";
    }

    return phase;
  } catch (err) {
    logger.warn({ err }, "harsh-regime-phase: DB read failed — defaulting to advisory");
    return "advisory";
  }
}

/**
 * Read the full phase record, including activation evidence.
 * Returns null on DB error (callers check and handle gracefully).
 */
export async function getPhaseRecord(): Promise<HarshRegimePhaseRecord | null> {
  try {
    const [row] = await db
      .select()
      .from(harshRegimePhase)
      .where(eq(harshRegimePhase.id, 1))
      .limit(1);

    if (!row) return null;

    return {
      phase:           (row.phase ?? "advisory") as PhaseValue,
      activatedAt:     row.activatedAt ?? null,
      firstStrategyId: row.firstStrategyId ?? null,
      activatedBy:     row.activatedBy ?? "system",
      updatedAt:       row.updatedAt,
    };
  } catch (err) {
    logger.warn({ err }, "harsh-regime-phase: getPhaseRecord DB error");
    return null;
  }
}

// ─── Write — cron-triggered automatic flip ────────────────────────────────────

/**
 * Flip phase from "advisory" to "hard" (cron-triggered).
 * Idempotent: if already "hard", returns flipped=false without modifying.
 *
 * @param firstStrategyId - UUID of the oldest PAPER-activation strategy that
 *   triggered this flip (for audit trail).
 * @param correlationId - Cron correlationId for full audit chain.
 */
export async function flipPhaseToHard(
  firstStrategyId: string,
  correlationId: string,
): Promise<PhaseFlipResult> {
  const current = await getPhase();

  if (current === "hard") {
    logger.debug({ correlationId }, "harsh-regime-phase: already hard — no-op");
    return {
      flipped: false,
      previousPhase: "hard",
      currentPhase: "hard",
      reason: "already_hard",
    };
  }

  const now = new Date();

  try {
    await db
      .update(harshRegimePhase)
      .set({
        phase:           "hard",
        activatedAt:     now,
        firstStrategyId: firstStrategyId,
        activatedBy:     "cron_auto",
        updatedAt:       now,
      })
      .where(eq(harshRegimePhase.id, 1));
  } catch (err) {
    logger.error(
      { err, correlationId },
      "harsh-regime-phase: flipPhaseToHard DB update failed",
    );
    throw err; // Let cron catch and alert
  }

  // Mandatory audit_log row — the phase flip must always be attributable
  await db.insert(auditLog).values({
    action: "harsh_regime_phase.activated",
    entityType: "system",
    entityId: null,
    input: {
      previousPhase: "advisory",
      triggeringStrategyId: firstStrategyId,
    },
    result: {
      newPhase: "hard",
      activatedAt: now.toISOString(),
      activatedBy: "cron_auto",
      note: "Automatic activation: 90 days of PAPER activation data accumulated.",
    },
    status: "success",
    decisionAuthority: "scheduler",
    correlationId,
  }).catch((auditErr) => {
    // Log but don't fail the flip — the DB row IS the authoritative record.
    logger.error(
      { err: auditErr, correlationId },
      "harsh-regime-phase: audit_log insert failed after successful phase flip (non-critical — DB row updated)",
    );
  });

  logger.info(
    { correlationId, firstStrategyId, activatedAt: now.toISOString() },
    "harsh-regime-phase: FLIPPED TO HARD — harsh-regime gate is now blocking",
  );

  return {
    flipped: true,
    previousPhase: "advisory",
    currentPhase: "hard",
    reason: "90_days_activation_threshold_met",
  };
}

// ─── Write — operator manual override ─────────────────────────────────────────

/**
 * Operator-initiated phase override (admin route).
 * Any direction is allowed but ALWAYS writes an audit_log row with the reason.
 *
 * @param newPhase - "advisory" or "hard"
 * @param reason   - Required human-readable reason (stored in audit_log)
 * @param operator - Who performed the override (defaults to "operator")
 * @param correlationId - Request correlation ID
 */
export async function setPhaseOverride(
  newPhase: PhaseValue,
  reason: string,
  operator: string,
  correlationId: string,
): Promise<PhaseFlipResult> {
  const current = await getPhase();
  const now = new Date();

  const updatePayload: Record<string, unknown> = {
    phase:       newPhase,
    activatedBy: "operator_override_admin",
    updatedAt:   now,
  };

  // Only set activatedAt when flipping TO hard (preserves original activation
  // timestamp when a back-and-forth override happens)
  if (newPhase === "hard" && current !== "hard") {
    updatePayload.activatedAt = now;
  } else if (newPhase === "advisory") {
    // Rolling back — clear activation timestamps so the cron can re-trigger
    // cleanly if the operator later wants the auto-activation to resume.
    updatePayload.activatedAt      = null;
    updatePayload.firstStrategyId  = null;
  }

  await db
    .update(harshRegimePhase)
    .set(updatePayload)
    .where(eq(harshRegimePhase.id, 1));

  // Mandatory audit row — every operator override must be attributable
  await db.insert(auditLog).values({
    action: "harsh_regime_phase.manual_override",
    entityType: "system",
    entityId: null,
    input: {
      previousPhase: current,
      newPhase,
      operator,
      reason,
    },
    result: {
      updatedAt: now.toISOString(),
      activatedBy: "operator_override_admin",
    },
    status: "success",
    decisionAuthority: "human",
    correlationId,
  }).catch((auditErr) => {
    logger.error(
      { err: auditErr, correlationId },
      "harsh-regime-phase: audit_log insert failed after operator override (non-critical — DB row updated)",
    );
  });

  logger.info(
    {
      correlationId,
      operator,
      previousPhase: current,
      newPhase,
      reason,
    },
    "harsh-regime-phase: manual operator override applied",
  );

  return {
    flipped:       current !== newPhase,
    previousPhase: current,
    currentPhase:  newPhase,
    reason:        `operator_override: ${reason}`,
  };
}
