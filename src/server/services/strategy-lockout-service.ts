/**
 * Strategy Lockout Service — Tier 5.3 (W5b)
 *
 * Implements the 24-hour lockout state machine on top of the existing
 * compliance_gate.py:check_daily_loss_kill() kill switch.
 *
 * Responsibilities:
 *   - writeLockoutFromKillEvent(): persist a lockout row when a daily_loss_kill
 *     compliance audit event fires. Called synchronously from the kill event handler.
 *   - getActiveLockout(): query the most recent active lockout for a strategy.
 *     Called by paper-signal-service.ts before emitting any new entry signal.
 *
 * Design notes:
 *   - Fail-OPEN on DB errors: if the lockout query fails, we do NOT block trading.
 *     An isolated DB outage should not prevent paper trading when the strategy
 *     is healthy. The error is logged as WARN for investigation.
 *   - Fail-SAFE on write errors: if the lockout write fails, we log ERROR but do
 *     not throw. The kill switch already blocks the current session. The lockout
 *     row is belt-and-suspenders for the NEXT session.
 *   - Multiple lockout rows per strategy are preserved (history). The active query
 *     returns only rows where locked_until > now(), ordered by locked_until DESC,
 *     taking the first (latest expiry).
 */

import { db } from "../db/index.js";
import { strategyLockouts } from "../db/schema.js";
import { eq, and, gt, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// ─── Constants ───────────────────────────────────────────────────────────────

export const LOCKOUT_DURATION_HOURS = 24;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LockoutRow {
  id: string;
  strategyId: string;
  lockedUntil: Date;
  reason: string;
  triggeredByKillId: string | null;
  createdAt: Date;
}

export interface WriteLockoutParams {
  strategyId: string;
  killAuditId: string | null;  // audit_log.id — null for manual lockouts
  reason: string;               // daily_loss_kill | manual | etc
}

// ─── Write lockout on kill event ─────────────────────────────────────────────

/**
 * Persist a strategy lockout row when a compliance kill fires.
 *
 * Caller: paper-signal-service.ts closePosition() path, after
 * compliance_gate.py:check_daily_loss_kill() returns tripped=true.
 *
 * Writes are synchronous (awaited) but failures are swallowed — the kill switch
 * already stops the current session. The lockout row gates the NEXT session.
 */
export async function writeLockoutFromKillEvent(params: WriteLockoutParams): Promise<void> {
  const { strategyId, killAuditId, reason } = params;
  const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_HOURS * 60 * 60 * 1000);

  try {
    await db.insert(strategyLockouts).values({
      strategyId,
      lockedUntil,
      reason,
      triggeredByKillId: killAuditId,
    });

    logger.info(
      { strategyId, lockedUntil: lockedUntil.toISOString(), reason, killAuditId },
      "Tier 5.3: strategy lockout written — 24h trading pause after compliance kill",
    );
  } catch (err) {
    // Non-fatal: kill switch is already active. Log error for investigation.
    logger.error(
      { err, strategyId, reason, killAuditId },
      "Tier 5.3: failed to write strategy lockout row — current kill switch still active",
    );
  }
}

// ─── Query active lockout ─────────────────────────────────────────────────────

/**
 * Return the most recent active lockout for a strategy, or null if none.
 *
 * "Active" means locked_until > now(). Expired rows are ignored.
 * If multiple rows are active (rare — e.g., manual + automatic), the one with
 * the latest locked_until is returned.
 *
 * Fail-OPEN: if the DB query errors, returns null so trading is not blocked
 * by an infrastructure outage.
 */
export async function getActiveLockout(strategyId: string): Promise<LockoutRow | null> {
  try {
    const now = new Date();
    const rows = await db
      .select()
      .from(strategyLockouts)
      .where(
        and(
          eq(strategyLockouts.strategyId, strategyId),
          gt(strategyLockouts.lockedUntil, now),
        )
      )
      .orderBy(desc(strategyLockouts.lockedUntil))
      .limit(1);

    if (rows.length === 0) return null;
    return rows[0] as LockoutRow;
  } catch (err) {
    logger.warn(
      { err, strategyId },
      "Tier 5.3: lockout query failed — fail-open (not blocking entry signal)",
    );
    return null;
  }
}
