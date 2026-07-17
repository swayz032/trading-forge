/**
 * Firm Priors Fitter — B14 / W20 Pass 2B
 *
 * Monthly recalibration logic. Reads prop_firm_health_checks history and derives
 * empirical P_suspension_30d per firm. Where health-check-derived rate differs
 * from the current prior by > 10% (relative), upserts with fit_method='health_check_history'.
 *
 * Other event_types (fund_freeze, profitable_trader_ban, payout_denial, vpn_detection)
 * cannot be fit from prop_firm_health_checks alone — those need future integration with
 * dashboard-snapshot-service.ts keyword signals. Seed-driven values are left intact for
 * those types until Phase 1.5 build (NOT in this scope per plan).
 *
 * PIPELINE PAUSE NOTE:
 *   refitPriorsForAllFirms() itself does NOT check isPipelineActive() — the cron
 *   wrapper in scheduler.ts handles that via pipelineGate(). Direct callers
 *   (e.g. POST /api/prop-firm/refit-priors admin route) are responsible for their
 *   own pipeline check. Do not add an internal pause check here without updating
 *   the comment in scheduler.ts.
 *
 * PER-FIRM INDEPENDENCE:
 *   Each firm is wrapped in its own try/catch so one firm's failure does not block
 *   the other. The returned errors array surfaces per-firm failures to the caller.
 *   Mirrors the pattern from multi-firm-promotion-service.ts:286.
 *
 * AUTHORITY HIERARCHY:
 *   manual_seed (lowest) < health_check_history < dashboard_anomaly (future, highest)
 *   The seed is LOWEST authority. Health-check-derived priors override it when the
 *   observed rate differs by > 10%. Dashboard_anomaly entries (future) override both.
 */

import { eq, and, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { propFirmHealthChecks } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { upsertPrior, getCurrentPriors } from "./firm-adversarial-event-service.js";

// ─── Configuration ────────────────────────────────────────────────────────────
// SUPPORTED FIRMS: MFFU + Topstep ONLY. Legacy firms removed 2026-05-10 (migration 0097).
const ALL_FIRM_IDS = [
  "topstep",
  "mffu",
] as const;

const HEALTH_CHECK_LOOKBACK_DAYS = 90;
const SUSPENSION_STATUSES = ["suspended", "auth_failure"] as const;
const RELATIVE_CHANGE_THRESHOLD = 0.10; // 10% relative difference triggers a refit

// ─── refitPriorsForAllFirms ───────────────────────────────────────────────────
/**
 * Run monthly recalibration across all configured firms (currently 2: Topstep + MFFU).
 *
 * For each firm:
 *   1. Read last 90 days of prop_firm_health_checks
 *   2. Compute observed P_suspension_30d = suspension_count / 90 * 30
 *   3. If observed rate differs from current seed rate by > 10% (relative),
 *      upsert with fit_method='health_check_history'
 *   4. Other event_types left intact (Phase 1.5 follow-up)
 *
 * Returns: { firmsProcessed, priorsUpdated, errors[] }
 * Consumed by n8n / cron.
 */
export async function refitPriorsForAllFirms(): Promise<{
  firmsProcessed: number;
  priorsUpdated: number;
  errors: Array<{ firmId: string; error: string }>;
}> {
  logger.info(
    { firms: ALL_FIRM_IDS, lookbackDays: HEALTH_CHECK_LOOKBACK_DAYS },
    "firm-priors-fitter: refitPriorsForAllFirms start",
  );

  const startTime = Date.now();
  let firmsProcessed = 0;
  let priorsUpdated = 0;
  const errors: Array<{ firmId: string; error: string }> = [];

  const lookbackCutoff = new Date(
    Date.now() - HEALTH_CHECK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );

  for (const firmId of ALL_FIRM_IDS) {
    // Per-firm independence: one firm failing must NOT block the others
    try {
      const updated = await refitFirmSuspensionRate(firmId, lookbackCutoff);
      firmsProcessed++;
      priorsUpdated += updated;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { firmId, err },
        "firm-priors-fitter: per-firm refit failed — continuing with next firm",
      );
      errors.push({ firmId, error: errorMsg });
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    {
      firmsProcessed,
      priorsUpdated,
      errorCount: errors.length,
      durationMs,
    },
    "firm-priors-fitter: refitPriorsForAllFirms complete",
  );

  return { firmsProcessed, priorsUpdated, errors };
}

// ─── refitFirmSuspensionRate (internal) ──────────────────────────────────────
/**
 * Compute observed P_suspension_30d from health-check history for a single firm.
 * Returns 1 if a prior was updated, 0 if no update needed.
 */
async function refitFirmSuspensionRate(
  firmId: string,
  lookbackCutoff: Date,
): Promise<number> {
  // Count total check rows in the lookback window
  const allChecks = await db
    .select({ checkedAt: propFirmHealthChecks.checkedAt, status: propFirmHealthChecks.status })
    .from(propFirmHealthChecks)
    .where(
      and(
        eq(propFirmHealthChecks.firmId, firmId),
        gte(propFirmHealthChecks.checkedAt, lookbackCutoff),
      ),
    );

  const totalChecks = allChecks.length;
  const suspensionChecks = allChecks.filter((row) =>
    (SUSPENSION_STATUSES as readonly string[]).includes(row.status),
  ).length;

  if (totalChecks === 0) {
    logger.debug(
      { firmId },
      "firm-priors-fitter: no health checks found in lookback window — skipping firm",
    );
    return 0;
  }

  // P_suspension_30d = (suspension_count / lookback_days) * 30
  const observedRate = (suspensionChecks / HEALTH_CHECK_LOOKBACK_DAYS) * 30;

  // Read current prior for this firm + event_type
  const currentPriors = await getCurrentPriors(firmId);
  const currentRate = currentPriors.P_suspension_30d;

  logger.debug(
    { firmId, observedRate, currentRate, totalChecks, suspensionChecks },
    "firm-priors-fitter: computed observed suspension rate",
  );

  // Check relative difference: |(observed - current)| / max(current, 0.0001) > threshold
  const denominator = Math.max(currentRate, 0.0001);
  const relativeDiff = Math.abs(observedRate - currentRate) / denominator;

  if (relativeDiff <= RELATIVE_CHANGE_THRESHOLD) {
    logger.debug(
      { firmId, observedRate, currentRate, relativeDiff, threshold: RELATIVE_CHANGE_THRESHOLD },
      "firm-priors-fitter: suspension rate within threshold — no update needed",
    );
    return 0;
  }

  // Rate differs by > 10% — upsert
  logger.info(
    {
      firmId,
      observedRate,
      currentRate,
      relativeDiff,
      suspensionChecks,
      totalChecks,
    },
    "firm-priors-fitter: suspension rate drift detected — upserting prior",
  );

  await upsertPrior({
    firmId,
    eventType: "account_suspension",
    baseRate: observedRate,
    evidenceWeight: suspensionChecks,
    fitMethod: "health_check_history",
    evidenceSources: [
      {
        source: "prop_firm_health_checks (automated)",
        url: "",
        observedAt: new Date().toISOString().split("T")[0],
        severity: suspensionChecks > 5 ? "high" : suspensionChecks > 2 ? "medium" : "low",
      },
    ],
  });

  return 1;
}
