/**
 * pine-export-shadow-guard.ts — Pass 3 Track C (2026-06-22)
 *
 * Enforces the Wave 29 Pass A.1 SHADOW-stage invariant on every Pine export
 * entry point.  A strategy in SHADOW state MUST NOT produce Pine artifacts
 * because:
 *
 *   1. SHADOW strategies have `traderspost_webhook_called=false` enforced at the
 *      lifecycle_shadow_signals table level.  Loading a SHADOW strategy's .pine
 *      into TradingView and firing alerts VIOLATES this invariant.
 *
 *   2. The shadow-signal divergence gate (SHADOW → PAPER) measures deviation
 *      between paper-signal-service.ts logged signals and backtest expectations.
 *      Operator-loaded Pine alerts introduce unsimulated broker contact that
 *      corrupts the divergence measurement.
 *
 * Guard contract:
 *   - SELECT lifecycle_state + shadow_mode_enabled from strategies
 *   - Throw PineExportShadowError when lifecycleState === 'SHADOW' OR shadowModeEnabled === true
 *   - Missing strategy → PineExportShadowError (fail-CLOSED — better to block than leak)
 *   - Error message includes strategyId + current state for audit chain
 *
 * Callers must:
 *   1. Call assertNotShadow() as the FIRST gate
 *   2. Catch PineExportShadowError
 *   3. Write pine_export.refused_shadow_strategy audit row
 *   4. Fire Discord WARN via notifyWarning + appendFamilyGradePostscript
 *   5. Return appropriate failure shape (HTTP 403 for routes; {ok: false, reason} for services)
 */

import { eq } from "drizzle-orm";
import { strategies } from "../db/schema.js";
import { logger } from "../lib/logger.js";

// ─── Error class ──────────────────────────────────────────────────────────────

export class PineExportShadowError extends Error {
  public readonly strategyId: string;
  public readonly lifecycleState: string | null;
  public readonly shadowModeEnabled: boolean;

  constructor(
    strategyId: string,
    lifecycleState: string | null,
    shadowModeEnabled: boolean,
    reason: "shadow_state" | "shadow_mode_enabled" | "strategy_not_found",
  ) {
    const stateDesc =
      reason === "strategy_not_found"
        ? "not found (fail-CLOSED)"
        : `lifecycleState=${lifecycleState} shadowModeEnabled=${shadowModeEnabled}`;

    super(
      `Pine export blocked for SHADOW strategy ${strategyId}: ${stateDesc}`,
    );

    this.name = "PineExportShadowError";
    this.strategyId = strategyId;
    this.lifecycleState = lifecycleState;
    this.shadowModeEnabled = shadowModeEnabled;

    // Preserve prototype chain in transpiled environments
    Object.setPrototypeOf(this, PineExportShadowError.prototype);
  }
}

// ─── Guard function ───────────────────────────────────────────────────────────

/**
 * Assert that a strategy is NOT in SHADOW state and does NOT have
 * shadow_mode_enabled=true.  Throws PineExportShadowError on violation.
 *
 * @param strategyId  UUID of the strategy to check
 * @param db          Optional DrizzleDB instance (defaults to production db).
 *                    Pass a test DB in unit/integration tests.
 *                    Lazy-loaded from ../db/index.js when not provided, so
 *                    unit tests can pass a mock without hitting DATABASE_URL.
 */
export async function assertNotShadow(
  strategyId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any,
): Promise<void> {
  // Lazy-load production DB only when no injected DB is provided.
  // This prevents module-load-time DATABASE_URL errors in tests.
  if (!db) {
    const { db: prodDb } = await import("../db/index.js");
    db = prodDb;
  }
  let lifecycleState: string | null = null;
  let shadowModeEnabled = false;

  try {
    const rows = await db
      .select({
        lifecycleState: strategies.lifecycleState,
        shadowModeEnabled: strategies.shadowModeEnabled,
      })
      .from(strategies)
      .where(eq(strategies.id, strategyId));

    const row = rows[0];

    if (!row) {
      // Strategy not found — fail-CLOSED per spec.
      logger.warn(
        { strategyId },
        "pine-export-shadow-guard: strategy not found, blocking as fail-CLOSED",
      );
      throw new PineExportShadowError(strategyId, null, false, "strategy_not_found");
    }

    lifecycleState = row.lifecycleState;
    shadowModeEnabled = row.shadowModeEnabled;
  } catch (err) {
    if (err instanceof PineExportShadowError) throw err;
    // DB lookup failed — fail-CLOSED
    logger.error(
      { strategyId, err },
      "pine-export-shadow-guard: DB lookup failed, blocking as fail-CLOSED",
    );
    throw new PineExportShadowError(strategyId, null, false, "strategy_not_found");
  }

  if (lifecycleState === "SHADOW") {
    throw new PineExportShadowError(
      strategyId,
      lifecycleState,
      shadowModeEnabled,
      "shadow_state",
    );
  }

  if (shadowModeEnabled) {
    throw new PineExportShadowError(
      strategyId,
      lifecycleState,
      shadowModeEnabled,
      "shadow_mode_enabled",
    );
  }
}
