/**
 * NeMo Scenario Routes — Track 1 (Challenger-Only, Phase 0)
 *
 * POST /api/nemo-scenarios/generate
 *   Manual trigger for NeMo scenario batch generation.
 *   Rate-limited via strictRateLimit. Returns 423 when pipeline paused.
 *
 * GET /api/nemo-scenarios/recent?limit=10
 *   Read recent scenarios from nemo_scenario_bank (read-only, no pause gate).
 *
 * AUTHORITY BOUNDARY:
 *   These routes generate and read challenger evidence ONLY.
 *   They do NOT trigger lifecycle promotion, entry, exit, or sizing decisions.
 *   All outputs carry decision_role="challenger_only", authoritative=false.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { generateNeMoBatch, getRecentNeMoScenarios } from "../services/nemo-scenario-service.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { logger } from "../index.js";

export const nemoScenarioRoutes = Router();

// ─── Pipeline pause gate ──────────────────────────────────────────────────────

async function pipelinePauseGate(_req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await isPipelineActive())) {
    res.status(423).json({
      error: "pipeline_paused",
      governance: { authoritative: false, decision_role: "challenger_only" },
    });
    return;
  }
  next();
}

// ─── Request schemas ──────────────────────────────────────────────────────────

const generateSchema = z.object({
  count: z.number().int().min(1).max(10000).optional().default(500),
  seed: z.number().int().optional(),
});

const recentQuerySchema = z.object({
  limit: z
    .string()
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional()
    .default("10"),
});

// ─── POST /api/nemo-scenarios/generate ───────────────────────────────────────

nemoScenarioRoutes.post("/generate", pipelinePauseGate, async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { count, seed } = parsed.data;

  try {
    logger.info({ count, seed }, "nemo-scenarios: generate batch requested");
    const result = await generateNeMoBatch(count, seed);

    if (result.skipped) {
      res.status(200).json({
        status: "skipped",
        reason: result.skipped,
        governance: result.governance,
      });
      return;
    }

    if (result.error) {
      res.status(500).json({
        status: "failed",
        error: result.error,
        batchId: result.batchId,
        governance: result.governance,
      });
      return;
    }

    res.status(200).json({
      status: "success",
      batchId: result.batchId,
      scenariosGenerated: result.scenariosGenerated,
      scenariosInserted: result.scenariosInserted,
      generatorVersion: result.generatorVersion,
      elapsedMs: result.elapsedMs,
      device: result.device,
      governance: result.governance,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "nemo-scenarios: generate route error");
    res.status(500).json({
      error: errMsg,
      governance: { authoritative: false, decision_role: "challenger_only" },
    });
  }
});

// ─── GET /api/nemo-scenarios/recent ──────────────────────────────────────────

nemoScenarioRoutes.get("/recent", async (req, res) => {
  const parsed = recentQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params", details: parsed.error.issues });
    return;
  }

  const limit = Number(parsed.data.limit);

  try {
    const scenarios = await getRecentNeMoScenarios(limit);
    res.status(200).json({
      scenarios,
      count: scenarios.length,
      governance: { authoritative: false, decision_role: "challenger_only" },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "nemo-scenarios: recent route error");
    res.status(500).json({ error: errMsg });
  }
});
