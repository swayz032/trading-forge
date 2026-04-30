/**
 * Adversarial Stress Routes — Tier 3.4 (Gemini Quantum Blueprint)
 *
 * POST /api/adversarial-stress/run
 *   Trigger Grover worst-case sequencer for a completed backtest.
 *   TIER_1 / TIER_2 strategies only. Challenger-only evidence.
 *   Phase 0 shadow: result is persisted but lifecycle gate is 100% classical.
 *
 * GET /api/adversarial-stress/:backtestId
 *   Fetch latest adversarial stress run for a backtest.
 *
 * GET /api/adversarial-stress/strategy/:strategyId
 *   Fetch all adversarial stress runs for a strategy (Tier 7 graduation queries).
 *
 * AUTHORITY BOUNDARY: These routes are read/write for challenger evidence.
 * They MUST NOT trigger lifecycle decisions or strategy promotions.
 *
 * isActive() guard: POST route returns 423 when pipeline is paused.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { adversarialStressRuns } from "../db/schema.js";
import {
  runAdversarialStress,
  getLatestAdversarialStressRun,
} from "../services/adversarial-stress-service.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { logger } from "../index.js";

export const adversarialStressRoutes = Router();

// ─── Pipeline pause gate ──────────────────────────────────────────────────────

async function pipelinePauseGate(_req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await isPipelineActive())) {
    res.status(423).json({ error: "pipeline_paused" });
    return;
  }
  next();
}

// ─── Request schema ────────────────────────────────────────────────────────────

const runRequestSchema = z.object({
  backtestId: z.string().uuid(),
  strategyId: z.string().uuid(),
  dailyLossLimit: z.number().positive().optional(),
  seed: z.number().int().optional(),
});

// ─── POST /api/adversarial-stress/run ─────────────────────────────────────────

adversarialStressRoutes.post("/run", pipelinePauseGate, async (req, res) => {
  const parsed = runRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { backtestId, strategyId, dailyLossLimit, seed } = parsed.data;

  try {
    const result = await runAdversarialStress(backtestId, strategyId, {
      dailyLossLimit,
      seed,
      correlationId: (req as Record<string, unknown>).id as string | undefined,
    });

    if (!result) {
      // Returned null: pipeline paused, tier gate, or no trades
      res.status(200).json({
        status: "skipped",
        reason: "pipeline_paused_or_tier_gate_or_no_trades",
        authorityBoundary: "challenger_only",
      });
      return;
    }

    res.json({
      ...result,
      authorityBoundary: "challenger_only",
      phase: "0_shadow",
      note: "Adversarial stress evidence is advisory only. Lifecycle gate is 100% classical in Phase 0.",
    });
  } catch (err) {
    logger.error({ err, backtestId, strategyId }, "adversarial-stress: POST /run error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/adversarial-stress/:backtestId ──────────────────────────────────

adversarialStressRoutes.get("/:backtestId", async (req, res) => {
  const { backtestId } = req.params;

  try {
    const result = await getLatestAdversarialStressRun(backtestId);
    if (!result) {
      res.status(404).json({ error: "No adversarial stress run found for this backtest" });
      return;
    }
    res.json({
      ...result,
      authorityBoundary: "challenger_only",
      phase: "0_shadow",
    });
  } catch (err) {
    logger.error({ err, backtestId }, "adversarial-stress: GET /:backtestId error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/adversarial-stress/strategy/:strategyId ────────────────────────

adversarialStressRoutes.get("/strategy/:strategyId", async (req, res) => {
  const { strategyId } = req.params;
  const limitRaw = parseInt(String(req.query.limit ?? "20"), 10);
  const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 20 : limitRaw), 100);

  try {
    const rows = await db
      .select({
        id: adversarialStressRuns.id,
        backtestId: adversarialStressRuns.backtestId,
        worstCaseBreachProb: adversarialStressRuns.worstCaseBreachProb,
        breachMinimalNTrades: adversarialStressRuns.breachMinimalNTrades,
        method: adversarialStressRuns.method,
        status: adversarialStressRuns.status,
        wallClockMs: adversarialStressRuns.wallClockMs,
        nQubits: adversarialStressRuns.nQubits,
        nTrades: adversarialStressRuns.nTrades,
        createdAt: adversarialStressRuns.createdAt,
        governanceLabels: adversarialStressRuns.governanceLabels,
      })
      .from(adversarialStressRuns)
      .where(eq(adversarialStressRuns.strategyId, strategyId))
      .orderBy(desc(adversarialStressRuns.createdAt))
      .limit(limit);

    res.json({
      strategyId,
      runs: rows,
      authorityBoundary: "challenger_only",
      phase: "0_shadow",
      count: rows.length,
    });
  } catch (err) {
    logger.error({ err, strategyId }, "adversarial-stress: GET /strategy/:strategyId error");
    res.status(500).json({ error: "Internal server error" });
  }
});
