/**
 * Frankenstein Routes — A4 (W10 Team C)
 *
 * POST /api/frankenstein/run
 *   Trigger Frankenstein randomization detection test for a completed backtest.
 *   Returns 423 when pipeline is paused (universal Pass 5 requirement).
 *
 * GET /api/frankenstein/:backtestId
 *   Fetch latest completed Frankenstein run for a backtest.
 *
 * GET /api/frankenstein/strategy/:strategyId
 *   Fetch all Frankenstein runs for a strategy.
 *
 * AUTHORITY BOUNDARY:
 *   This is a HARD gate — not shadow-only. passed=false blocks TESTING→PAPER.
 *   These routes trigger and read that evidence.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { frankensteinTestRuns } from "../db/schema.js";
import {
  runFrankensteinTest,
  getLatestFrankensteinRun,
} from "../services/frankenstein-service.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { logger } from "../index.js";

export const frankensteinRoutes = Router();

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
  strategyConfig: z.record(z.unknown()).optional().default({}),
  testMode: z
    .enum(["full_shuffle", "benchmark_relative", "calendar_preserving", "synthetic_gbm"])
    .optional()
    .default("full_shuffle"),
  nShuffles: z.number().int().min(10).max(500).optional().default(100),
  seed: z.number().int().optional().default(42),
});

// ─── POST /api/frankenstein/run ───────────────────────────────────────────────

frankensteinRoutes.post("/run", pipelinePauseGate, async (req, res) => {
  const parsed = runRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { backtestId, strategyId, strategyConfig, testMode, nShuffles, seed } = parsed.data;

  logger.info(
    { backtestId, strategyId, testMode, nShuffles },
    "frankenstein: POST /run received",
  );

  try {
    const result = await runFrankensteinTest(
      backtestId,
      strategyId,
      strategyConfig as Record<string, unknown>,
      testMode,
      nShuffles,
      seed,
    );

    const statusCode = result.status === "failed" ? 500 : 200;
    res.status(statusCode).json(result);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ backtestId, strategyId, err }, "frankenstein: unhandled error in POST /run");
    res.status(500).json({ error: errMsg });
  }
});

// ─── GET /api/frankenstein/:backtestId ────────────────────────────────────────

frankensteinRoutes.get("/:backtestId", async (req, res) => {
  const { backtestId } = req.params;
  if (!backtestId.match(/^[0-9a-f-]{36}$/i)) {
    res.status(400).json({ error: "Invalid backtestId" });
    return;
  }

  try {
    const run = await getLatestFrankensteinRun(backtestId);
    if (!run) {
      res.status(404).json({ error: "No completed Frankenstein run found for this backtest" });
      return;
    }
    res.json(run);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ backtestId, err }, "frankenstein: GET /:backtestId failed");
    res.status(500).json({ error: errMsg });
  }
});

// ─── GET /api/frankenstein/strategy/:strategyId ───────────────────────────────

frankensteinRoutes.get("/strategy/:strategyId", async (req, res) => {
  const { strategyId } = req.params;
  if (!strategyId.match(/^[0-9a-f-]{36}$/i)) {
    res.status(400).json({ error: "Invalid strategyId" });
    return;
  }

  try {
    const runs = await db
      .select()
      .from(frankensteinTestRuns)
      .where(eq(frankensteinTestRuns.strategyId, strategyId))
      .orderBy(desc(frankensteinTestRuns.createdAt))
      .limit(50);

    res.json({ runs, total: runs.length });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ strategyId, err }, "frankenstein: GET /strategy/:strategyId failed");
    res.status(500).json({ error: errMsg });
  }
});
