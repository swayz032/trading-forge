/**
 * Quantum Cost Tracker — Tier 1.4 (Gemini Quantum Blueprint)
 *
 * Pure helper that writes to the `quantum_run_costs` table using the
 * pending-row contract:
 *
 *   1. Call recordCost() BEFORE spawning the quantum subprocess.
 *      Returns a row id (or STALE_PENDING_SENTINEL_ID on failure / paused pipeline).
 *   2. Call completeCost(id, ...) in both the success and error branches.
 *
 * Safety properties:
 *   - recordCost never throws — any DB failure returns STALE_PENDING_SENTINEL_ID
 *   - completeCost never throws — update failures are logged and swallowed
 *   - Both return immediately when id === STALE_PENDING_SENTINEL_ID (no-op)
 *   - Pipeline pause guard: if isPipelineActive() returns false, no row is
 *     written (cost rows for paused-pipeline runs are noise at Tier 7 graduation)
 *
 * Pruning:
 *   - pruneStalePendingCosts() marks pending rows older than 1 hour as
 *     status="failed", errorMessage="stale_pending_pruned"
 *   - Called at server start and on an hourly cron in scheduler.ts
 *
 * Module names (enumerated here for queryability):
 *   quantum_mc | sqa | rl_agent | entropy_filter | adversarial_stress | cloud_qmc | ising_decoder
 */

import { eq, and, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { quantumRunCosts } from "../db/schema.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { logger } from "./logger.js";

// ─── Sentinel ID ─────────────────────────────────────────────────────────────
// Returned by recordCost when no real row was created (pipeline paused or DB
// error). completeCost is a no-op when it receives this value.
export const STALE_PENDING_SENTINEL_ID = "__no_cost_row__";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CostOpts {
  /** Enumerated module name — must match quantum_run_costs.module_name values */
  moduleName: string;
  backtestId?: string | null;
  strategyId?: string | null;
  /** QPU seconds — only nonzero for cloud QPU runs */
  qpuSeconds?: number | null;
  /** Cost in dollars — only nonzero for paid cloud runs */
  costDollars?: number | null;
  /** Whether the result came from a local simulation cache */
  cacheHit?: boolean;
}

export interface CompleteOpts {
  wallClockMs: number;
  status: "completed" | "failed";
  errorMessage?: string | null;
  /** Actual QPU seconds if known only after completion */
  qpuSeconds?: number | null;
  /** Actual cost dollars if known only after completion */
  costDollars?: number | null;
  cacheHit?: boolean | null;
}

// ─── recordCost ──────────────────────────────────────────────────────────────

/**
 * Insert a pending cost row before spawning a quantum subprocess.
 *
 * Returns { id } where id is either the real UUID from the DB or
 * STALE_PENDING_SENTINEL_ID (no row created — call to completeCost is a no-op).
 *
 * Never throws.
 */
export async function recordCost(opts: CostOpts): Promise<{ id: string }> {
  try {
    // Pipeline-pause guard: don't pollute cost telemetry with paused-run noise.
    const active = await isPipelineActive();
    if (!active) {
      logger.debug(
        { moduleName: opts.moduleName },
        "quantum-cost-tracker: pipeline paused — skipping cost row",
      );
      return { id: STALE_PENDING_SENTINEL_ID };
    }

    const [row] = await db
      .insert(quantumRunCosts)
      .values({
        moduleName: opts.moduleName,
        backtestId: opts.backtestId ?? null,
        strategyId: opts.strategyId ?? null,
        wallClockMs: 0,           // placeholder — updated by completeCost
        qpuSeconds: String(opts.qpuSeconds ?? 0),
        costDollars: String(opts.costDollars ?? 0),
        cacheHit: opts.cacheHit ?? false,
        status: "pending",
        errorMessage: null,
      })
      .returning();

    logger.debug(
      { costRowId: row.id, moduleName: opts.moduleName, backtestId: opts.backtestId ?? null },
      "quantum-cost-tracker: pending cost row created",
    );

    return { id: row.id };
  } catch (err) {
    logger.warn(
      { err, moduleName: opts.moduleName },
      "quantum-cost-tracker: recordCost DB insert failed — quantum run will proceed without cost row",
    );
    return { id: STALE_PENDING_SENTINEL_ID };
  }
}

// ─── completeCost ─────────────────────────────────────────────────────────────

/**
 * Update a pending cost row to completed or failed.
 *
 * No-op when id === STALE_PENDING_SENTINEL_ID. Never throws.
 */
export async function completeCost(
  id: string,
  opts: CompleteOpts,
): Promise<void> {
  if (id === STALE_PENDING_SENTINEL_ID) return;

  try {
    const setValues: Record<string, unknown> = {
      wallClockMs: opts.wallClockMs,
      status: opts.status,
    };

    if (opts.errorMessage !== undefined && opts.errorMessage !== null) {
      setValues.errorMessage = opts.errorMessage;
    }

    if (opts.qpuSeconds != null) {
      setValues.qpuSeconds = String(opts.qpuSeconds);
    }

    if (opts.costDollars != null) {
      setValues.costDollars = String(opts.costDollars);
    }

    if (opts.cacheHit != null) {
      setValues.cacheHit = opts.cacheHit;
    }

    await db
      .update(quantumRunCosts)
      .set(setValues)
      .where(eq(quantumRunCosts.id, id));

    logger.debug(
      { costRowId: id, status: opts.status, wallClockMs: opts.wallClockMs },
      "quantum-cost-tracker: cost row updated",
    );
  } catch (err) {
    logger.warn(
      { err, costRowId: id },
      "quantum-cost-tracker: completeCost DB update failed — cost row left pending (will be pruned)",
    );
  }
}

// ─── pruneStalePendingCosts ───────────────────────────────────────────────────

/**
 * Mark pending rows older than 1 hour as failed with a sentinel error message.
 *
 * Called at server startup and on an hourly cron. Returns the count of rows
 * pruned. Never throws.
 */
export async function pruneStalePendingCosts(): Promise<number> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const pruned = await db
      .update(quantumRunCosts)
      .set({
        status: "failed",
        errorMessage: "stale_pending_pruned",
      })
      .where(
        and(
          eq(quantumRunCosts.status, "pending"),
          lt(quantumRunCosts.createdAt, oneHourAgo),
        ),
      );

    // Drizzle returns affected rows as an array (or count depending on driver).
    // We normalise: if it's an array, use length; if it has rowCount, use that.
    const count =
      Array.isArray(pruned) ? pruned.length :
      (pruned as unknown as { rowCount?: number }).rowCount ?? 0;

    if (count > 0) {
      logger.info(
        { prunedCount: count, olderThan: oneHourAgo.toISOString() },
        "quantum-cost-tracker: stale pending cost rows pruned",
      );
    }

    return count;
  } catch (err) {
    logger.warn({ err }, "quantum-cost-tracker: pruneStalePendingCosts failed");
    return 0;
  }
}

// ─── Wrap helper (convenience for the wrapping pattern) ──────────────────────

/**
 * Convenience wrapper that handles the full pending→completed/failed lifecycle.
 * Use this to wrap a quantum async call when you don't need the intermediate id.
 *
 * Usage:
 *   const result = await withCostTracking({ moduleName: "sqa", backtestId }, () => runSQA(...));
 */
export async function withCostTracking<T>(
  opts: CostOpts,
  fn: () => Promise<T>,
): Promise<T> {
  const startTime = Date.now();
  const { id } = await recordCost(opts);
  try {
    const result = await fn();
    await completeCost(id, {
      wallClockMs: Date.now() - startTime,
      status: "completed",
    });
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await completeCost(id, {
      wallClockMs: Date.now() - startTime,
      status: "failed",
      errorMessage,
    });
    throw err;
  }
}
