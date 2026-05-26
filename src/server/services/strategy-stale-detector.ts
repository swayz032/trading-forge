/**
 * strategy-stale-detector.ts — Daily STALE cron for strategy library self-maintenance.
 *
 * Wave 26 Pass G Pass D (2026-05-26).
 *
 * WHAT IT DOES
 * ─────────────
 * Fires daily at 04:00 ET (off-hours) for each ACTIVE strategy
 * (status ∈ CANDIDATE / PAPER / DEPLOY_READY / PILOT):
 *
 *   1. Look up last paper_trades.created_at AND last backtests.created_at.
 *   2. If both > 30 days ago  → set lifecycle_metadata.stale_since = NOW() +
 *      audit lifecycle.strategy_marked_stale.
 *   3. If stale_since > 60 days → demote status to NEEDS_REVISION +
 *      audit lifecycle.strategy_demoted_to_needs_revision.
 *   4. If stale_since is set AND activity resumed → clear stale_since +
 *      audit lifecycle.strategy_stale_cleared.
 *
 * PROTECTED STATES
 * ─────────────────
 * DEPLOYED and PILOT are NEVER demoted — they have real capital and require
 * a human review path. The cron skips both.
 *
 * PIPELINE-PAUSED AWARENESS
 * ──────────────────────────
 * If pipeline_mode !== ACTIVE the cron logs "paused, no demotions performed"
 * and exits immediately (per operator mandate — paused mode should not
 * penalize strategies for not trading).
 *
 * GRAVEYARD INVARIANT
 * ────────────────────
 * GRAVEYARD is NEVER written from this module. Maximum demotion = NEEDS_REVISION.
 *
 * IDEMPOTENCY
 * ────────────
 * - Marking stale when already marked → no-op (idempotent).
 * - Demoting NEEDS_REVISION when already NEEDS_REVISION → no-op.
 * - Clearing stale when stale_since is absent → no-op.
 *
 * LIFECYCLE METADATA
 * ───────────────────
 * All metadata writes target config.lifecycle_metadata JSONB sub-key using
 * Postgres jsonb_set + coalesce pattern to avoid clobbering other keys.
 * No migration needed — JSONB sub-key additions are additive.
 *
 * SUPPORTED lifecycle_metadata FIELDS
 * ─────────────────────────────────────
 *   stale_since                  : ISO timestamp | null
 *   last_extraction_attempted_at : ISO timestamp
 *   last_extraction_outcome      : success | regression_skipped | gemma_failed |
 *                                  source_url_unreachable | no_archetype_match
 *   extraction_attempt_count     : int (capped at 5)
 *   last_graduation_attempted_at : ISO timestamp
 *   last_graduation_outcome      : graduated | bidirectional_incomplete |
 *                                  source_fidelity_failed | engine_incompatible_indicator
 *
 * The last_extraction_* and last_graduation_* fields are written by the
 * graduator/extractor, NOT by this cron. This cron only manages stale_since.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { getMode } from "./pipeline-control-service.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Strategies inactive for longer than this threshold get stale_since stamped. */
export const STALE_THRESHOLD_DAYS = 30;

/** Strategies stale for longer than this threshold get demoted to NEEDS_REVISION. */
export const DEMOTION_THRESHOLD_DAYS = 60;

/**
 * ACTIVE states: only these are eligible for stale tracking.
 * DEPLOYED and PILOT are explicitly excluded — they have real capital.
 */
export const STALE_ELIGIBLE_STATES = ["CANDIDATE", "PAPER", "DEPLOY_READY", "PILOT"] as const;

/**
 * States that are NEVER demoted by the STALE cron.
 * DEPLOYED has real capital → human review path only.
 * PILOT is in canary window → demotion there would be catastrophic.
 * GRAVEYARD is NEVER the target (operator mandate).
 */
export const DEMOTION_EXEMPT_STATES = ["DEPLOYED", "PILOT"] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StrategyStaleRow {
  id: string;
  name: string;
  lifecycleState: string;
  staleSince: string | null;
}

export interface StaleDetectorResult {
  strategiesScanned: number;
  newlyMarkedStale: number;
  demoted: number;
  staleCleared: number;
  skippedPaused: boolean;
  errors: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the most recent activity timestamp (paper trade OR backtest) for a strategy.
 * Returns null when no activity exists at all.
 */
async function getLastActivityDate(strategyId: string): Promise<Date | null> {
  try {
    const rows = await db.execute(sql`
      SELECT GREATEST(
        (SELECT MAX(pt.created_at)
         FROM paper_trades pt
         JOIN paper_sessions ps ON ps.id = pt.session_id
         WHERE ps.strategy_id = ${strategyId}::uuid),
        (SELECT MAX(b.created_at)
         FROM backtests b
         WHERE b.strategy_id = ${strategyId}::uuid
           AND b.status = 'completed')
      ) AS last_active_at
    `);
    const row = ((rows as unknown) as Array<{ last_active_at: string | null }>)[0];
    if (!row || row.last_active_at == null) return null;
    return new Date(row.last_active_at);
  } catch (err) {
    logger.warn({ err, strategyId }, "strategy-stale-detector: getLastActivityDate failed");
    return null;
  }
}

/**
 * Reads the current stale_since from config.lifecycle_metadata.stale_since.
 * Returns null if not set or metadata absent.
 */
async function getStaleSince(strategyId: string): Promise<Date | null> {
  try {
    const rows = await db.execute(sql`
      SELECT config->'lifecycle_metadata'->>'stale_since' AS stale_since
      FROM strategies
      WHERE id = ${strategyId}::uuid
    `);
    const row = ((rows as unknown) as Array<{ stale_since: string | null }>)[0];
    if (!row || row.stale_since == null) return null;
    return new Date(row.stale_since);
  } catch (err) {
    logger.warn({ err, strategyId }, "strategy-stale-detector: getStaleSince failed");
    return null;
  }
}

/**
 * Writes stale_since into config.lifecycle_metadata JSONB (additive — never
 * clobbers other JSONB keys).
 */
async function setLifecycleMetadataField(
  strategyId: string,
  field: string,
  value: string | null,
): Promise<void> {
  if (value === null) {
    // Remove the field by setting it to SQL NULL via jsonb removal operator
    await db.execute(sql`
      UPDATE strategies
      SET config = jsonb_set(
            COALESCE(config, '{}'::jsonb),
            '{lifecycle_metadata}',
            (COALESCE(config->'lifecycle_metadata', '{}'::jsonb) - ${field}::text)
          ),
          updated_at = NOW()
      WHERE id = ${strategyId}::uuid
    `);
  } else {
    await db.execute(sql`
      UPDATE strategies
      SET config = jsonb_set(
            COALESCE(config, '{}'::jsonb),
            '{lifecycle_metadata}',
            jsonb_set(
              COALESCE(config->'lifecycle_metadata', '{}'::jsonb),
              ${("{" + field + "}")}::text[],
              ${JSON.stringify(value)}::jsonb
            )
          ),
          updated_at = NOW()
      WHERE id = ${strategyId}::uuid
    `);
  }
}

/**
 * Demotes a strategy to NEEDS_REVISION (never GRAVEYARD per operator mandate).
 * No-op if already NEEDS_REVISION.
 */
async function demoteToNeedsRevision(
  strategyId: string,
  strategyName: string,
  staleSince: Date,
  correlationId: string,
): Promise<boolean> {
  try {
    // Idempotency check — skip if already NEEDS_REVISION
    const rows = await db.execute(sql`
      SELECT lifecycle_state FROM strategies WHERE id = ${strategyId}::uuid
    `);
    const row = ((rows as unknown) as Array<{ lifecycle_state: string }>)[0];
    if (!row || row.lifecycle_state === "NEEDS_REVISION") {
      return false; // already there — idempotent no-op
    }
    // NEVER demote DEPLOYED or PILOT (belt-and-suspenders — caller also checks)
    if ((DEMOTION_EXEMPT_STATES as ReadonlyArray<string>).includes(row.lifecycle_state)) {
      logger.warn(
        { strategyId, strategyName, lifecycleState: row.lifecycle_state },
        "strategy-stale-detector: demoteToNeedsRevision called on protected state — skipped",
      );
      return false;
    }

    await db.execute(sql`
      UPDATE strategies
      SET lifecycle_state = 'NEEDS_REVISION',
          lifecycle_changed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${strategyId}::uuid
    `);

    await insertAuditRowSafe({
      action: "lifecycle.strategy_demoted_to_needs_revision",
      entityType: "strategy",
      entityId: strategyId,
      decisionAuthority: "scheduler",
      result: {
        strategyName,
        staleSinceDays: Math.floor((Date.now() - staleSince.getTime()) / 86_400_000),
        staleSince: staleSince.toISOString(),
        demotionThresholdDays: DEMOTION_THRESHOLD_DAYS,
        note: "GRAVEYARD never written; NEEDS_REVISION is max demotion (operator mandate)",
      } as Record<string, unknown>,
      status: "success",
      correlationId,
    });

    logger.info(
      { strategyId, strategyName, staleSince: staleSince.toISOString() },
      "strategy-stale-detector: strategy demoted to NEEDS_REVISION",
    );
    return true;
  } catch (err) {
    logger.error({ err, strategyId, strategyName }, "strategy-stale-detector: demoteToNeedsRevision failed");
    return false;
  }
}

// ─── Per-strategy processing ──────────────────────────────────────────────────

interface ProcessResult {
  markedStale: boolean;
  demoted: boolean;
  staleCleared: boolean;
  error: boolean;
}

async function processStrategy(
  strategy: StrategyStaleRow,
  correlationId: string,
): Promise<ProcessResult> {
  const { id: strategyId, name: strategyName, lifecycleState, staleSince: staleSinceRaw } = strategy;
  const result: ProcessResult = { markedStale: false, demoted: false, staleCleared: false, error: false };

  try {
    const now = new Date();
    const staleSince = staleSinceRaw ? new Date(staleSinceRaw) : null;
    const lastActivity = await getLastActivityDate(strategyId);

    // ─── Determine staleness ──────────────────────────────────────────────────
    const lastActivityDaysAgo = lastActivity
      ? (now.getTime() - lastActivity.getTime()) / 86_400_000
      : Infinity; // no activity ever = always stale

    const isInactive = lastActivityDaysAgo > STALE_THRESHOLD_DAYS;

    // ─── Case A: Clear stale_since if activity resumed ────────────────────────
    if (staleSince !== null && !isInactive) {
      // Activity resumed — clear the stale marker
      await setLifecycleMetadataField(strategyId, "stale_since", null);
      await insertAuditRowSafe({
        action: "lifecycle.strategy_stale_cleared",
        entityType: "strategy",
        entityId: strategyId,
        decisionAuthority: "scheduler",
        result: {
          strategyName,
          lifecycleState,
          lastActivityDaysAgo: Math.floor(lastActivityDaysAgo),
          previousStaleSince: staleSince.toISOString(),
        } as Record<string, unknown>,
        status: "success",
        correlationId,
      });
      logger.info(
        { strategyId, strategyName, lastActivityDaysAgo: Math.floor(lastActivityDaysAgo) },
        "strategy-stale-detector: stale cleared — activity resumed",
      );
      result.staleCleared = true;
      return result;
    }

    // ─── Case B: Still inactive ───────────────────────────────────────────────
    if (isInactive) {
      // ── B1: Set stale_since if not yet set ──────────────────────────────────
      if (staleSince === null) {
        const nowIso = now.toISOString();
        await setLifecycleMetadataField(strategyId, "stale_since", nowIso);
        await insertAuditRowSafe({
          action: "lifecycle.strategy_marked_stale",
          entityType: "strategy",
          entityId: strategyId,
          decisionAuthority: "scheduler",
          result: {
            strategyName,
            lifecycleState,
            lastActivityDaysAgo: lastActivity ? Math.floor(lastActivityDaysAgo) : null,
            staleSince: nowIso,
            staleThresholdDays: STALE_THRESHOLD_DAYS,
          } as Record<string, unknown>,
          status: "success",
          correlationId,
        });
        logger.info(
          { strategyId, strategyName, lastActivityDaysAgo: Math.floor(lastActivityDaysAgo) },
          "strategy-stale-detector: strategy marked stale",
        );
        result.markedStale = true;
        return result;
      }

      // ── B2: Check demotion threshold ─────────────────────────────────────────
      const staleDaysElapsed = (now.getTime() - staleSince.getTime()) / 86_400_000;
      if (staleDaysElapsed > DEMOTION_THRESHOLD_DAYS) {
        // DEPLOYED and PILOT are exempt from demotion
        if ((DEMOTION_EXEMPT_STATES as ReadonlyArray<string>).includes(lifecycleState)) {
          logger.info(
            { strategyId, strategyName, lifecycleState, staleDaysElapsed: Math.floor(staleDaysElapsed) },
            "strategy-stale-detector: demotion threshold exceeded but state is exempt (DEPLOYED/PILOT) — no demotion",
          );
          return result; // never demote DEPLOYED/PILOT
        }
        const demoted = await demoteToNeedsRevision(strategyId, strategyName, staleSince, correlationId);
        result.demoted = demoted;
      }
    }

    return result;
  } catch (err) {
    logger.error({ err, strategyId, strategyName }, "strategy-stale-detector: processStrategy failed");
    result.error = true;
    return result;
  }
}

// ─── Main cron entry point ────────────────────────────────────────────────────

/**
 * runStrategyStaleDetector
 *
 * Main entry point. Called by the scheduler at 04:00 ET daily.
 *
 * Pipeline-paused-aware: if pipeline is not ACTIVE, logs and returns without
 * performing any demotions (paused mode should not penalize strategies).
 */
export async function runStrategyStaleDetector(): Promise<StaleDetectorResult> {
  const correlationId = crypto.randomUUID();
  const t0 = Date.now();

  // ─── Pipeline-paused guard ────────────────────────────────────────────────
  let pipelineMode: string;
  try {
    pipelineMode = await getMode();
  } catch (err) {
    logger.warn({ err }, "strategy-stale-detector: getMode failed — fail-open, assuming ACTIVE");
    pipelineMode = "ACTIVE";
  }

  if (pipelineMode !== "ACTIVE") {
    logger.info(
      { pipelineMode, correlationId },
      "strategy-stale-detector: pipeline not ACTIVE — paused, no demotions performed",
    );
    return {
      strategiesScanned: 0,
      newlyMarkedStale: 0,
      demoted: 0,
      staleCleared: 0,
      skippedPaused: true,
      errors: 0,
    };
  }

  // ─── Fetch active strategies ──────────────────────────────────────────────
  let activeStrategies: StrategyStaleRow[] = [];
  try {
    const rows = await db.execute(sql`
      SELECT
        id::text,
        name,
        lifecycle_state,
        config->'lifecycle_metadata'->>'stale_since' AS stale_since
      FROM strategies
      WHERE lifecycle_state = ANY(ARRAY['CANDIDATE','PAPER','DEPLOY_READY','PILOT'])
      ORDER BY created_at ASC
    `);
    activeStrategies = ((rows as unknown) as Array<{
      id: string;
      name: string;
      lifecycle_state: string;
      stale_since: string | null;
    }>).map((r) => ({
      id: r.id,
      name: r.name,
      lifecycleState: r.lifecycle_state,
      staleSince: r.stale_since,
    }));
  } catch (err) {
    logger.error({ err, correlationId }, "strategy-stale-detector: fetch active strategies failed");
    return {
      strategiesScanned: 0,
      newlyMarkedStale: 0,
      demoted: 0,
      staleCleared: 0,
      skippedPaused: false,
      errors: 1,
    };
  }

  if (activeStrategies.length === 0) {
    logger.debug({ correlationId }, "strategy-stale-detector: no active strategies — no-op");
    return {
      strategiesScanned: 0,
      newlyMarkedStale: 0,
      demoted: 0,
      staleCleared: 0,
      skippedPaused: false,
      errors: 0,
    };
  }

  // ─── Process each strategy ────────────────────────────────────────────────
  let newlyMarkedStale = 0;
  let demoted = 0;
  let staleCleared = 0;
  let errors = 0;

  for (const strategy of activeStrategies) {
    const r = await processStrategy(strategy, correlationId);
    if (r.markedStale) newlyMarkedStale++;
    if (r.demoted) demoted++;
    if (r.staleCleared) staleCleared++;
    if (r.error) errors++;
  }

  const durationMs = Date.now() - t0;
  logger.info(
    {
      correlationId,
      durationMs,
      strategiesScanned: activeStrategies.length,
      newlyMarkedStale,
      demoted,
      staleCleared,
      errors,
    },
    "strategy-stale-detector: run complete",
  );

  return {
    strategiesScanned: activeStrategies.length,
    newlyMarkedStale,
    demoted,
    staleCleared,
    skippedPaused: false,
    errors,
  };
}

// ─── Lifecycle event hooks (called from graduator / paper-signal runtime) ─────

/**
 * setNeedsArchetype — called by graduator when no archetype matched in registry.
 *
 * Sets strategy status to NEEDS_ARCHETYPE and writes audit row.
 * This is a terminal graduator state — strategy is in library but not
 * eligible for backtest/paper until an archetype is added + re-extracted.
 *
 * GRAVEYARD invariant: never writes GRAVEYARD.
 * Fire-and-forget: callers should .catch() independently.
 */
export async function setNeedsArchetype(
  strategyId: string,
  strategyName: string,
  missingArchetype: string,
  correlationId?: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE strategies
    SET lifecycle_state = 'NEEDS_ARCHETYPE',
        lifecycle_changed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${strategyId}::uuid
      AND lifecycle_state NOT IN ('DEPLOYED', 'PILOT')
  `);

  await insertAuditRowSafe({
    action: "lifecycle.needs_archetype_set",
    entityType: "strategy",
    entityId: strategyId,
    decisionAuthority: "scheduler",
    result: {
      strategyName,
      missingArchetype,
      note: "Strategy in library; not eligible for backtest/paper until archetype registered",
    } as Record<string, unknown>,
    status: "success",
    correlationId: correlationId ?? null,
  });

  logger.info(
    { strategyId, strategyName, missingArchetype },
    "strategy-stale-detector: NEEDS_ARCHETYPE set",
  );
}

/**
 * setNeedsRevision — called when a graduated strategy fails a later gate
 * (e.g. paper-signal runtime archetype detector failure, source URL unreachable).
 *
 * GRAVEYARD invariant: never writes GRAVEYARD.
 * Fire-and-forget: callers should .catch() independently.
 */
export async function setNeedsRevision(
  strategyId: string,
  strategyName: string,
  reason: string,
  correlationId?: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE strategies
    SET lifecycle_state = 'NEEDS_REVISION',
        lifecycle_changed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${strategyId}::uuid
      AND lifecycle_state NOT IN ('DEPLOYED', 'PILOT')
  `);

  await insertAuditRowSafe({
    action: "lifecycle.needs_revision_set",
    entityType: "strategy",
    entityId: strategyId,
    decisionAuthority: "scheduler",
    result: {
      strategyName,
      reason,
      note: "Strategy in library; not eligible for backtest/paper until revised",
    } as Record<string, unknown>,
    status: "success",
    correlationId: correlationId ?? null,
  });

  logger.info(
    { strategyId, strategyName, reason },
    "strategy-stale-detector: NEEDS_REVISION set",
  );
}
