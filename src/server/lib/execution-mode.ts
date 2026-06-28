/**
 * Execution-mode helper — paper vs live gating.
 *
 * FAIL-CLOSED INVARIANT:
 *   getExecutionMode() returns "paper" on ANY error, missing env, unconfigured
 *   state, or DB failure. The homepage can therefore NEVER claim "live" unless
 *   live execution is genuinely set up and the operator has explicitly toggled it.
 *
 * NUMERIC STORAGE:
 *   system_parameters.current_value is a NUMERIC column.
 *   Store 1 (live) or 0 (paper) — NEVER the strings "true" / "false".
 *   Storing "true" in a NUMERIC column caused a prior prod outage.
 *
 * GO-LIVE PREREQUISITES (both must be true before effective mode can be "live"):
 *   1. SERVER_MEDIATED_EXECUTION_ENABLED === "true"  (exact string, not "1"/"yes")
 *   2. BROKER_FILL_HMAC_SECRET length >= 32 chars    (fill reconciliation configured)
 *
 *   These mirror the exact checks in server-mediated-executor.ts checkRoutingGuard().
 *   If you change one, change the other.
 */

import { db } from "../db/index.js";
import { systemParameters } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Key used in system_parameters table for the live-execution toggle. */
export const EXECUTION_MODE_PARAM = "execution_mode_live";

// ─── isLiveExecutionConfigured ─────────────────────────────────────────────────

/**
 * Returns true ONLY when the go-live prerequisites are in place:
 *   - SERVER_MEDIATED_EXECUTION_ENABLED is the exact string "true"
 *   - BROKER_FILL_HMAC_SECRET is present and at least 32 characters long
 *
 * Until both conditions are met the UI switch stays locked ("NEEDS SETUP"),
 * and any stored "live" value in the DB is ignored by getExecutionMode().
 */
export function isLiveExecutionConfigured(): boolean {
  return (
    process.env.SERVER_MEDIATED_EXECUTION_ENABLED === "true" &&
    typeof process.env.BROKER_FILL_HMAC_SECRET === "string" &&
    process.env.BROKER_FILL_HMAC_SECRET.length >= 32
  );
}

// ─── getExecutionMode ──────────────────────────────────────────────────────────

/**
 * Returns the EFFECTIVE execution mode for the current runtime.
 *
 * "live" requires:
 *   1. isLiveExecutionConfigured() === true   (env prereqs — checked first, no DB)
 *   2. system_parameters.execution_mode_live >= 1   (operator toggled it on)
 *
 * Any other condition → "paper" (fail-closed).
 *
 * No migration needed — the row is created on first write by setExecutionMode().
 * An absent row (before first write) is treated as 0 / paper.
 */
export async function getExecutionMode(): Promise<"paper" | "live"> {
  // Hard gate first — skip the DB call entirely if not configured.
  if (!isLiveExecutionConfigured()) return "paper";

  try {
    const rows = await db
      .select({ val: systemParameters.currentValue })
      .from(systemParameters)
      .where(eq(systemParameters.paramName, EXECUTION_MODE_PARAM))
      .limit(1);

    const isLive = rows.length > 0 && Number(rows[0].val) >= 1;
    return isLive ? "live" : "paper";
  } catch (err) {
    logger.error(
      { err },
      "execution-mode: DB error reading execution_mode_live — failing closed to paper",
    );
    return "paper";
  }
}

// ─── setExecutionMode ──────────────────────────────────────────────────────────

/**
 * Persists the operator's execution-mode choice to system_parameters.
 *
 * Uses the select-then-update-or-insert pattern (same as admin.ts learning_loop)
 * because param_name has a unique index — no ON CONFLICT clause needed in Drizzle.
 *
 * Stores NUMERIC "1" (live) or "0" (paper) — never strings "true"/"false".
 */
export async function setExecutionMode(live: boolean): Promise<void> {
  const newVal = live ? "1" : "0";

  const existing = await db
    .select({ id: systemParameters.id })
    .from(systemParameters)
    .where(eq(systemParameters.paramName, EXECUTION_MODE_PARAM))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(systemParameters)
      .set({ currentValue: newVal, updatedAt: new Date() })
      .where(eq(systemParameters.paramName, EXECUTION_MODE_PARAM));
  } else {
    await db.insert(systemParameters).values({
      paramName: EXECUTION_MODE_PARAM,
      currentValue: newVal,
      domain: "paper",
      description:
        "Live execution mode flag (1=live, 0=paper). " +
        "Effective only when SERVER_MEDIATED_EXECUTION_ENABLED=true AND " +
        "BROKER_FILL_HMAC_SECRET>=32 chars. Governs Crib homepage stats " +
        "display and execution audit trail.",
    });
  }
}
