/**
 * learning-loop-mode.ts — 3-MODE autonomous-loop control plane.
 *
 * SAFETY-CRITICAL. This module is the single source of truth for interpreting
 * `system_parameters.auto_patch_loop_enabled` (NUMERIC current_value). It gates
 * the autonomous LLM mutation loops (Wave 26 pattern-aggregator, Wave 27
 * quantum-replay-weekly). Getting the gate wrong could enable autonomous
 * mutations at the wrong level.
 *
 * THREE MODES (numeric current_value):
 *   0 = OFF        — nothing autonomous, no nightly advisory intelligence.
 *   1 = OBSERVE    — nightly ADVISORY intelligence runs; NO autonomous changes.
 *   2 = AUTOPILOT  — advisory + autonomous mutation loops.
 *
 * Derived flags:
 *   advisoryOn   = mode >= 1   (OBSERVE or AUTOPILOT)
 *   autonomousOn = mode >= 2   (AUTOPILOT only)
 *
 * FAIL-CLOSED INVARIANT:
 *   Any absent row, non-numeric value, or DB error → mode 0 (OFF), both flags
 *   false. We never assume autonomy when we cannot positively confirm it.
 *
 * BACKWARD-COMPAT NOTE (binary → 3-mode):
 *   The pre-3-mode world treated `>= 1` as "autonomous loop ON". Under 3-mode,
 *   a stored "1" now means OBSERVE (advisory only) — autonomousOn=false. This is
 *   the SAFE direction: a value that previously enabled autonomy now downgrades
 *   to advisory rather than escalating. In production the row is ABSENT by
 *   default (migration 0175) so the loops are OFF regardless. The slumhouse
 *   legacy `{on:true}` POST maps to mode 2 (AUTOPILOT) so the old "Learning Loop
 *   ON = full autonomous" meaning is preserved for any legacy caller.
 *
 * Import logger from ./logger.js (not ../index.js) per CLAUDE.md feedback rule.
 */

import { db } from "../db/index.js";
import { systemParameters } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Well-known system_parameters key. Shared by every autonomous loop. */
export const LEARNING_LOOP_MODE_PARAM = "auto_patch_loop_enabled";

export const MODE_OFF = 0 as const;
export const MODE_OBSERVE = 1 as const;
export const MODE_AUTOPILOT = 2 as const;

export type LearningLoopMode = 0 | 1 | 2;

export interface LearningLoopModeState {
  mode: LearningLoopMode;
  /** mode >= 1 — nightly advisory intelligence may run. */
  advisoryOn: boolean;
  /** mode >= 2 — autonomous mutation loops may run. */
  autonomousOn: boolean;
}

// ─── parseLearningLoopMode ────────────────────────────────────────────────────

/**
 * Pure clamp/validate of a raw stored value to a 0|1|2 mode.
 *
 * Rules (fail-CLOSED):
 *   - null / undefined / non-finite / non-numeric ("true", "yes", "") → 0 (OFF)
 *   - <= 0 → 0 (OFF)
 *   - exactly 1 → 1 (OBSERVE)
 *   - >= 2 (incl. fractional like 2.7, and out-of-range like 5) → 2 (AUTOPILOT)
 *
 * Fractional values floor toward the lower mode (1.9 → OBSERVE) so a partial
 * write can never silently escalate to AUTOPILOT.
 */
export function parseLearningLoopMode(raw: unknown): LearningLoopMode {
  if (raw === null || raw === undefined) return MODE_OFF;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return MODE_OFF; // "true"/"yes"/"" → NaN → OFF
  const floored = Math.floor(n);
  if (floored <= MODE_OFF) return MODE_OFF;
  if (floored === MODE_OBSERVE) return MODE_OBSERVE;
  return MODE_AUTOPILOT; // clamp 2..N → AUTOPILOT
}

/** Human-facing label for the operator UI dial. */
export function learningLoopModeLabel(
  mode: LearningLoopMode,
): "OFF" | "OBSERVE" | "AUTOPILOT" {
  if (mode === MODE_AUTOPILOT) return "AUTOPILOT";
  if (mode === MODE_OBSERVE) return "OBSERVE";
  return "OFF";
}

// ─── readLearningLoopMode ─────────────────────────────────────────────────────

/**
 * Read the current mode from system_parameters. NEVER throws — fails CLOSED to
 * mode 0 (OFF, both flags false) on absent row or DB error.
 *
 * Autonomous-loop readers MUST gate on `autonomousOn` (mode >= 2). Gating on
 * `advisoryOn` (mode >= 1) would wake the loop at OBSERVE — a safety violation.
 *
 * NOTE on observability: this helper swallows DB errors (returns OFF). A caller
 * that needs a louder fail-closed audit on DB-read failure (e.g. the
 * quantum-replay weekly cron) should read the row itself and derive the mode via
 * parseLearningLoopMode(), so it can emit its own *_read_failed audit row.
 */
export async function readLearningLoopMode(): Promise<LearningLoopModeState> {
  try {
    const rows = await db
      .select({ currentValue: systemParameters.currentValue })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, LEARNING_LOOP_MODE_PARAM))
      .limit(1);
    const raw = rows.length > 0 ? rows[0].currentValue : null;
    const mode = parseLearningLoopMode(raw);
    return {
      mode,
      advisoryOn: mode >= MODE_OBSERVE,
      autonomousOn: mode >= MODE_AUTOPILOT,
    };
  } catch (err) {
    logger.warn(
      { err },
      "learning-loop-mode: failed to read auto_patch_loop_enabled — failing CLOSED (mode 0 / OFF)",
    );
    return { mode: MODE_OFF, advisoryOn: false, autonomousOn: false };
  }
}
