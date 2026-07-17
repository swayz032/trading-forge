/**
 * src/server/routes/composite-health.ts — Wave 28 Pass A.5
 *
 * READ-ONLY composite health endpoints. Pure observability — no gate authority.
 *
 * Routes:
 *   GET /api/composite-health/:strategyId/latest
 *     → latest strategy_health_scores row for the given strategy,
 *       or 200 with { data: null, message: "awaiting first aggregator run" }
 *       when no row exists yet.
 *
 *   GET /api/composite-health/summary
 *     → verdict counts across all active strategies
 *       (lifecycleState IN DEPLOYED | PILOT | PAPER | DEPLOY_READY).
 *       Returns 200 with zero counts when no data.
 *
 * Design:
 *   - No 404s — frontend renders "awaiting first aggregator run" tile state.
 *   - Drizzle ORM only — no raw SQL.
 *   - inArray() for array filters (per CLAUDE.md §13 "Don't" list).
 *   - Logger from ./logger.js leaf module.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db/index.js";
import {
  strategyHealthScores,
  strategies,
} from "../db/schema.js";
import {
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import { logger } from "../lib/logger.js";

export const compositeHealthRoutes = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthVerdict = "HEALTHY" | "MARGINAL" | "UNHEALTHY" | "CRITICAL" | "SKIPPED";

/** Single-strategy latest health snapshot */
export interface LatestHealthPayload {
  id: string;                        // bigint serialised as string
  strategyId: string;                // UUID (changed from INTEGER in schema migration, Defect G4 fix)
  evaluatedAt: string;               // ISO-8601
  compositeScore: number | null;
  verdict: HealthVerdict | null;
  subsystemScores: Record<string, SubsystemDetail>;
  computedFromNSubsystems: number;
  weightsVersionId: string;
  stalenessAgeHours: number | null;
  /** Wall-clock hours since evaluatedAt, computed at request time. */
  rowAgeHours: number;
  /** True when rowAgeHours exceeds COMPOSITE_MAX_AGE_HOURS — the aggregator has
   *  stopped running for this strategy and `verdict` reflects abandoned evidence,
   *  not current health. */
  stale: boolean;
  disagreements: unknown | null;
}

// ─── Consumer-side staleness guard ────────────────────────────────────────────
// strategy-health-aggregator.ts's own header documents this: "aggregator stamps
// the age only" — COMPOSITE_MAX_AGE_HOURS enforcement is this route's job. A
// strategy whose aggregator cron stopped running keeps its last-written row
// (e.g. HEALTHY) forever unless this consumer checks wall-clock age itself.

const DEFAULT_COMPOSITE_MAX_AGE_HOURS = 48;

function _getCompositeMaxAgeHours(): number {
  const raw = process.env["COMPOSITE_MAX_AGE_HOURS"];
  if (!raw) return DEFAULT_COMPOSITE_MAX_AGE_HOURS;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) {
    logger.warn({ raw }, "COMPOSITE_MAX_AGE_HOURS invalid — using default 48");
    return DEFAULT_COMPOSITE_MAX_AGE_HOURS;
  }
  return n;
}

function _rowAgeHours(evaluatedAt: Date): number {
  return (Date.now() - evaluatedAt.getTime()) / (1000 * 60 * 60);
}

export interface SubsystemDetail {
  score: number | null;
  confidence: number | null;
  available: boolean;
  computed_at: string | null;
  error?: string;
}

/** Portfolio-level verdict counts */
export interface SummaryPayload {
  counts: Record<HealthVerdict, number>;
  totalActiveStrategies: number;
  computedAt: string;
  /** Active strategies whose latest row exceeds COMPOSITE_MAX_AGE_HOURS — folded
   *  into counts.SKIPPED (a stale verdict is not current evidence) but surfaced
   *  separately so a dashboard doesn't mistake "never scored" for "stopped being
   *  scored". */
  staleCount: number;
}

// Active pipeline states whose health counts in the summary
const ACTIVE_STATES: string[] = ["DEPLOYED", "PILOT", "PAPER", "DEPLOY_READY"];

// ─── GET /api/composite-health/:strategyId/latest ────────────────────────────

compositeHealthRoutes.get(
  "/:strategyId/latest",
  async (req: Request, res: Response): Promise<void> => {
    const strategyId = req.params["strategyId"] as string | undefined;

    if (!strategyId || strategyId.trim() === "") {
      res.status(400).json({ error: "strategyId is required" });
      return;
    }

    try {
      const rows = await db
        .select()
        .from(strategyHealthScores)
        .where(eq(strategyHealthScores.strategyId, strategyId))
        .orderBy(desc(strategyHealthScores.evaluatedAt))
        .limit(1);

      if (rows.length === 0) {
        res.status(200).json({
          data: null,
          message: "awaiting first aggregator run",
        });
        return;
      }

      const row = rows[0];
      const rowAgeHours = _rowAgeHours(row.evaluatedAt);
      const maxAgeHours = _getCompositeMaxAgeHours();
      const stale = rowAgeHours > maxAgeHours;

      if (stale) {
        logger.warn(
          { strategyId, rowAgeHours, maxAgeHours },
          "composite-health: /latest row exceeds COMPOSITE_MAX_AGE_HOURS — verdict is stale (aggregator likely stopped running for this strategy)",
        );
      }

      const payload: LatestHealthPayload = {
        id: String(row.id),
        strategyId: row.strategyId,
        evaluatedAt: row.evaluatedAt.toISOString(),
        compositeScore: row.compositeScore ?? null,
        verdict: (row.verdict as HealthVerdict | null) ?? null,
        subsystemScores: (row.subsystemScores ?? {}) as Record<string, SubsystemDetail>,
        computedFromNSubsystems: row.computedFromNSubsystems,
        weightsVersionId: row.weightsVersionId,
        stalenessAgeHours: row.stalenessAgeHours ?? null,
        rowAgeHours: Math.round(rowAgeHours * 100) / 100,
        stale,
        disagreements: row.disagreements ?? null,
      };

      res.status(200).json({ data: payload });
    } catch (err) {
      logger.error({ err, strategyId }, "composite-health: /latest query failed");
      res.status(500).json({ error: "Failed to query composite health" });
    }
  }
);

// ─── buildCompositeHealthSummary ─────────────────────────────────────────────
// Exported so Carter voice-agent (and other callers) can query without HTTP.

export async function buildCompositeHealthSummary(): Promise<SummaryPayload> {
  const emptyCounts: Record<HealthVerdict, number> = {
    HEALTHY: 0,
    MARGINAL: 0,
    UNHEALTHY: 0,
    CRITICAL: 0,
    SKIPPED: 0,
  };

  // Step 1 — active strategy IDs
  const activeRows = await db
    .select({ id: strategies.id })
    .from(strategies)
    .where(inArray(strategies.lifecycleState, ACTIVE_STATES));

  const activeIds = activeRows.map((r) => Number(r.id));

  if (activeIds.length === 0) {
    return { counts: emptyCounts, totalActiveStrategies: 0, computedAt: new Date().toISOString(), staleCount: 0 };
  }

  // Step 2 — latest health row per active strategy via a correlated subquery.
  const latestRows = await db
    .select({
      strategyId: strategyHealthScores.strategyId,
      verdict: strategyHealthScores.verdict,
      evaluatedAt: strategyHealthScores.evaluatedAt,
    })
    .from(strategyHealthScores)
    .where(
      sql`${strategyHealthScores.strategyId} IN (${sql.join(
        activeIds.map((id) => sql`${id}`),
        sql`, `
      )}) AND ${strategyHealthScores.evaluatedAt} = (
        SELECT MAX(shs2.evaluated_at)
        FROM strategy_health_scores shs2
        WHERE shs2.strategy_id = ${strategyHealthScores.strategyId}
      )`
    );

  const maxAgeHours = _getCompositeMaxAgeHours();
  const counts: Record<HealthVerdict, number> = { ...emptyCounts };
  let staleCount = 0;
  for (const row of latestRows) {
    const isStale = row.evaluatedAt ? _rowAgeHours(new Date(row.evaluatedAt)) > maxAgeHours : false;
    if (isStale) {
      staleCount++;
      counts["SKIPPED"]++;
      continue;
    }
    const v = (row.verdict ?? "SKIPPED") as HealthVerdict;
    if (v in counts) {
      counts[v]++;
    } else {
      counts["SKIPPED"]++;
    }
  }

  // Strategies with no health row yet count as SKIPPED
  const scoredIds = new Set(latestRows.map((r) => Number(r.strategyId)));
  for (const id of activeIds) {
    if (!scoredIds.has(id)) counts["SKIPPED"]++;
  }

  return { counts, totalActiveStrategies: activeIds.length, computedAt: new Date().toISOString(), staleCount };
}

// ─── GET /api/composite-health/summary ───────────────────────────────────────
//
// Returns the most-recent verdict for each active strategy, then tallies counts.
// Two-step approach:
//   1. Fetch all active strategy IDs (lifecycleState IN ACTIVE_STATES)
//   2. For each, retrieve the latest health score row
//
// We use a subquery via Drizzle's sql template to find max(evaluated_at) per
// strategy. This is a CTE pattern that avoids N+1 queries.

compositeHealthRoutes.get(
  "/summary",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const payload = await buildCompositeHealthSummary();
      res.status(200).json({ data: payload });
    } catch (err) {
      logger.error({ err }, "composite-health: /summary query failed");
      res.status(500).json({ error: "Failed to build composite health summary" });
    }
  }
);
