/**
 * Shadow Re-Run Routes — A11 (W12 Team A)
 *
 * POST /api/shadow-rerun/trigger
 *   Trigger a shadow re-run session for all PAPER+ strategies (or a specified subset).
 *   Returns 423 when pipeline is paused.
 *   Returns the full ShadowRerunReport on completion.
 *
 * GET /api/shadow-rerun/findings
 *   List recent shadow_rerun_findings rows (all strategies).
 *
 * GET /api/shadow-rerun/findings/:strategyId
 *   List recent shadow_rerun_findings rows for a specific strategy.
 *
 * AUTHORITY BOUNDARY:
 *   Observation-only. Shadow re-run findings do NOT gate any lifecycle decision.
 *   They surface information to operators so manual review can follow a bug fix.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { runShadowRerun, getShadowRerunFindings } from "../services/shadow-rerun-service.js";
import { logger } from "../index.js";

export const shadowRerunRoutes = Router();

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

// ─── POST /api/shadow-rerun/trigger ──────────────────────────────────────────

const triggerSchema = z.object({
  reason: z.string().min(1).max(500),
  strategyIds: z.array(z.string().uuid()).optional(),
});

shadowRerunRoutes.post("/trigger", pipelinePauseGate, async (req, res) => {
  const parsed = triggerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { reason, strategyIds } = parsed.data;

  logger.info(
    { reason, strategyCount: strategyIds?.length ?? "all_paper_plus" },
    "shadow-rerun: POST /trigger received",
  );

  try {
    const report = await runShadowRerun(reason, strategyIds);
    const statusCode = report.errors > 0 && report.processed === 0 ? 500 : 200;
    res.status(statusCode).json(report);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ reason, err }, "shadow-rerun: unhandled error in POST /trigger");
    res.status(500).json({ error: errMsg });
  }
});

// ─── GET /api/shadow-rerun/findings ──────────────────────────────────────────

shadowRerunRoutes.get("/findings", async (req, res) => {
  const limitRaw = Number.parseInt(String(req.query["limit"] ?? "50"), 10);
  const limit = Number.isNaN(limitRaw) || limitRaw <= 0 ? 50 : Math.min(limitRaw, 200);

  try {
    const findings = await getShadowRerunFindings(undefined, limit);
    res.json({ findings, total: findings.length });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "shadow-rerun: GET /findings failed");
    res.status(500).json({ error: errMsg });
  }
});

// ─── GET /api/shadow-rerun/findings/:strategyId ───────────────────────────────

shadowRerunRoutes.get("/findings/:strategyId", async (req, res) => {
  const { strategyId } = req.params;
  if (!strategyId.match(/^[0-9a-f-]{36}$/i)) {
    res.status(400).json({ error: "Invalid strategyId" });
    return;
  }

  const limitRaw = Number.parseInt(String(req.query["limit"] ?? "50"), 10);
  const limit = Number.isNaN(limitRaw) || limitRaw <= 0 ? 50 : Math.min(limitRaw, 200);

  try {
    const findings = await getShadowRerunFindings(strategyId, limit);
    res.json({ strategyId, findings, total: findings.length });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ strategyId, err }, "shadow-rerun: GET /findings/:strategyId failed");
    res.status(500).json({ error: errMsg });
  }
});
