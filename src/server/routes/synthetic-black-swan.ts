/**
 * Synthetic Black Swan Routes — A14 (W19, Pass 3)
 *
 * POST /api/synthetic-black-swan/run
 *   Trigger Synthetic Black Swan evaluation for a completed backtest.
 *   Returns 423 when pipeline is paused (universal Pass 5 requirement).
 *
 * GET /api/synthetic-black-swan/:backtestId
 *   Fetch latest completed Synthetic Black Swan run for a backtest.
 *
 * AUTHORITY BOUNDARY (Phase 0):
 *   These routes ONLY trigger / read evaluation results. They do NOT
 *   participate in lifecycle promotion gating. Phase 1 (advisory →
 *   hard gate) is wired in Pass 4 inside lifecycle-service.ts. Until
 *   then, survival_rate < 0.60 is challenger-only evidence.
 *
 * Pattern source: `frankenstein.ts` — same pipelinePauseGate, same Zod
 * validation shape, same status-code policy (200 success, 500 failed,
 * 400 invalid body, 423 paused).
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import {
  runBlackSwanTest,
  getLatestBlackSwanRun,
} from "../services/synthetic-black-swan-service.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { logger } from "../index.js";

export const syntheticBlackSwanRoutes = Router();

// ─── Pipeline pause gate ──────────────────────────────────────────────────────

async function pipelinePauseGate(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!(await isPipelineActive())) {
    res.status(423).json({ error: "pipeline_paused" });
    return;
  }
  next();
}

// ─── Request schema ──────────────────────────────────────────────────────────

const runRequestSchema = z.object({
  backtestId: z.string().uuid(),
  strategyId: z.string().uuid(),
  regimeCount: z.number().int().min(10).max(5000).optional().default(1000),
  propFirmCapDollars: z.number().positive().optional(),
});

// ─── POST /api/synthetic-black-swan/run ──────────────────────────────────────

syntheticBlackSwanRoutes.post("/run", pipelinePauseGate, async (req, res) => {
  const parsed = runRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { backtestId, strategyId, regimeCount, propFirmCapDollars } =
    parsed.data;

  logger.info(
    { backtestId, strategyId, regimeCount },
    "synthetic_black_swan: POST /run received",
  );

  try {
    const result = await runBlackSwanTest(backtestId, strategyId, {
      regimeCount,
      propFirmCapDollars,
      // Express request id (when present via correlation middleware) should
      // propagate through to Python via _metadata. The runner attaches
      // correlationId from options, falling back to request-context if any.
      correlationId: (req as Request & { id?: string }).id,
    });

    const statusCode = result.status === "failed" ? 500 : 200;
    res.status(statusCode).json(result);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { backtestId, strategyId, err: errMsg },
      "synthetic_black_swan: unhandled error in POST /run",
    );
    res.status(500).json({ error: errMsg });
  }
});

// ─── GET /api/synthetic-black-swan/:backtestId ──────────────────────────────

syntheticBlackSwanRoutes.get("/:backtestId", async (req, res) => {
  const { backtestId } = req.params;
  if (!backtestId.match(/^[0-9a-f-]{36}$/i)) {
    res.status(400).json({ error: "Invalid backtestId" });
    return;
  }

  try {
    const run = await getLatestBlackSwanRun(backtestId);
    if (!run) {
      res.status(404).json({
        error:
          "No completed Synthetic Black Swan run found for this backtest",
      });
      return;
    }
    res.json(run);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { backtestId, err: errMsg },
      "synthetic_black_swan: GET /:backtestId failed",
    );
    res.status(500).json({ error: errMsg });
  }
});
