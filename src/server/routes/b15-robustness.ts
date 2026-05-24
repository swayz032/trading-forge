/**
 * B15 Parameter Robustness Battery routes (Wave 25 Item 5)
 *
 * GET /api/b15-robustness/:strategyId/latest
 *   Returns the latest b15_battery JSONB result for a strategy.
 *   Returns 404 if no completed backtest exists, or if none ran the battery.
 *
 * GET /api/b15-robustness/coverage
 *   Returns count of deployed strategies with passing b15 vs missing/failed.
 *   Used by the dashboard to show institutional robustness coverage.
 */

import { Router } from "express";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { backtests, strategies } from "../db/schema.js";
import { logger } from "../lib/logger.js";

export const b15RobustnessRoutes = Router();

b15RobustnessRoutes.get("/coverage", async (req, res) => {
  try {
    // All strategies in DEPLOYED or PILOT state
    const deployedStrategies = await db
      .select({ id: strategies.id })
      .from(strategies)
      .where(inArray(strategies.lifecycleState, ["DEPLOYED", "PILOT"]));

    if (deployedStrategies.length === 0) {
      return res.json({
        deployed_count: 0,
        with_passing_b15: 0,
        with_failing_b15: 0,
        missing_b15: 0,
        coverage_pct: null,
      });
    }

    const strategyIds = deployedStrategies.map((s) => s.id);

    // Latest completed backtest per strategy
    const latestBacktests = await Promise.all(
      strategyIds.map(async (strategyId) => {
        const [bt] = await db
          .select({ b15Battery: backtests.b15Battery })
          .from(backtests)
          .where(
            and(
              eq(backtests.strategyId, strategyId),
              eq(backtests.status, "completed"),
            ),
          )
          .orderBy(desc(backtests.createdAt))
          .limit(1);
        return { strategyId, b15Battery: bt?.b15Battery ?? null };
      }),
    );

    let withPassing = 0;
    let withFailing = 0;
    let missing = 0;

    for (const { b15Battery } of latestBacktests) {
      if (b15Battery == null) {
        missing++;
      } else {
        const b15 = b15Battery as Record<string, unknown>;
        if (b15.passed === true) {
          withPassing++;
        } else {
          withFailing++;
        }
      }
    }

    const total = deployedStrategies.length;
    const coveragePct = total > 0 ? Math.round((withPassing / total) * 100) : null;

    return res.json({
      deployed_count: total,
      with_passing_b15: withPassing,
      with_failing_b15: withFailing,
      missing_b15: missing,
      coverage_pct: coveragePct,
    });
  } catch (err) {
    logger.error({ err }, "b15-robustness: coverage query failed");
    return res.status(500).json({ error: "b15_coverage_query_failed" });
  }
});

b15RobustnessRoutes.get("/:strategyId/latest", async (req, res) => {
  const { strategyId } = req.params;

  try {
    const [bt] = await db
      .select({
        b15Battery: backtests.b15Battery,
        id: backtests.id,
        createdAt: backtests.createdAt,
        status: backtests.status,
      })
      .from(backtests)
      .where(
        and(
          eq(backtests.strategyId, strategyId),
          eq(backtests.status, "completed"),
          isNotNull(backtests.b15Battery),
        ),
      )
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!bt) {
      return res.status(404).json({
        error: "no_b15_battery_result",
        message: "No completed backtest with b15_battery data found for this strategy. Run with --b15-battery flag to populate.",
      });
    }

    return res.json({
      strategyId,
      backtestId: bt.id,
      backtestCreatedAt: bt.createdAt,
      b15Battery: bt.b15Battery,
    });
  } catch (err) {
    logger.error({ err, strategyId }, "b15-robustness: latest query failed");
    return res.status(500).json({ error: "b15_latest_query_failed" });
  }
});
