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
  disagreements: unknown | null;
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
        disagreements: row.disagreements ?? null,
      };

      res.status(200).json({ data: payload });
    } catch (err) {
      logger.error({ err, strategyId }, "composite-health: /latest query failed");
      res.status(500).json({ error: "Failed to query composite health" });
    }
  }
);

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
      // Step 1 — active strategy IDs
      const activeRows = await db
        .select({ id: strategies.id })
        .from(strategies)
        .where(inArray(strategies.lifecycleState, ACTIVE_STATES));

      const activeIds = activeRows.map((r) => Number(r.id));

      const emptyCounts: Record<HealthVerdict, number> = {
        HEALTHY: 0,
        MARGINAL: 0,
        UNHEALTHY: 0,
        CRITICAL: 0,
        SKIPPED: 0,
      };

      if (activeIds.length === 0) {
        res.status(200).json({
          data: {
            counts: emptyCounts,
            totalActiveStrategies: 0,
            computedAt: new Date().toISOString(),
          },
        });
        return;
      }

      // Step 2 — latest health row per active strategy via a correlated subquery.
      // Drizzle does not expose DISTINCT ON natively; we use a lateral-style
      // subquery with sql`` template for the correlated eq — safe because the
      // value is a validated integer array from the DB, not user input.
      const latestRows = await db
        .select({
          strategyId: strategyHealthScores.strategyId,
          verdict: strategyHealthScores.verdict,
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

      const counts: Record<HealthVerdict, number> = { ...emptyCounts };
      for (const row of latestRows) {
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

      const payload: SummaryPayload = {
        counts,
        totalActiveStrategies: activeIds.length,
        computedAt: new Date().toISOString(),
      };

      res.status(200).json({ data: payload });
    } catch (err) {
      logger.error({ err }, "composite-health: /summary query failed");
      res.status(500).json({ error: "Failed to build composite health summary" });
    }
  }
);
