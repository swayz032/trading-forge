/**
 * Cloud QMC Routes — Tier 4.5 (Gemini Quantum Blueprint, W4)
 *
 * POST /api/cloud-qmc/trigger
 *   Manually trigger an Ising-encoded IBM QPU enrichment run for a strategy.
 *   AUTHORITY BOUNDARY: challenger-only evidence. Never a promotion gate.
 *   isActive() guard: returns 423 when pipeline is paused.
 *
 * GET /api/cloud-qmc/status/:strategyId
 *   Get recent cloud_qmc_runs for a strategy (for dashboard and Tier 7 queries).
 *
 * GET /api/cloud-qmc/budget
 *   Return current IBM QPU budget status (used / remaining / reset month).
 *
 * POST /api/cloud-qmc/poll
 *   Manually trigger poll cycle (for testing; normally run by scheduler cron).
 *
 * GOVERNANCE: All routes are read/write for challenger evidence only.
 * These routes MUST NOT trigger lifecycle decisions or strategy promotions.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db } from "../db/index.js";
import { cloudQmcRuns } from "../db/schema.js";
import {
  enqueueCloudQmcRun,
  listCloudQmcRunsForStrategy,
  pollPendingJobs,
} from "../services/cloud-qmc-service.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
import { logger } from "../index.js";
import { spawnSync } from "child_process";
import { resolve as pathResolve } from "path";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

export const cloudQmcRoutes = Router();

// ─── Pipeline pause gate ──────────────────────────────────────────────────────

async function pipelinePauseGate(_req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await isPipelineActive())) {
    res.status(423).json({ error: "pipeline_paused" });
    return;
  }
  next();
}

// ─── Request schemas ──────────────────────────────────────────────────────────

const triggerSchema = z.object({
  strategyId: z.string().uuid(),
  backtestId: z.string().uuid(),
  classicalRuinProb: z.number().min(0).max(1).optional(),
  localIaeEstimate: z.number().min(0).max(1).optional(),
});

// ─── POST /api/cloud-qmc/trigger ─────────────────────────────────────────────

cloudQmcRoutes.post("/trigger", pipelinePauseGate, async (req, res) => {
  const parsed = triggerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { strategyId, backtestId, classicalRuinProb, localIaeEstimate } = parsed.data;

  logger.info(
    { strategyId, backtestId },
    "cloud-qmc/trigger: manual trigger requested (challenger-only, never gates promotion)",
  );

  // Fire-and-forget — respond immediately, enqueue happens async
  res.status(202).json({
    message: "Cloud QMC run enqueued (challenger-only, shadow evidence — does not affect promotion)",
    strategyId,
    backtestId,
    governanceLabels: {
      experimental: true,
      authoritative: false,
      decision_role: "challenger_only",
    },
    cloudEnabled: (process.env.QUANTUM_CLOUD_ENABLED ?? "").toLowerCase() === "true",
    ibmTokenPresent: !!(process.env.IBM_QUANTUM_TOKEN ?? ""),
  });

  // Enqueue async (non-blocking — never awaited before response)
  enqueueCloudQmcRun({ strategyId, backtestId, classicalRuinProb, localIaeEstimate }).catch(
    (err) => logger.warn({ strategyId, err }, "cloud-qmc/trigger: enqueue error (non-blocking)"),
  );
});

// ─── GET /api/cloud-qmc/status/:strategyId ───────────────────────────────────

cloudQmcRoutes.get("/status/:strategyId", async (req, res) => {
  const strategyId = req.params.strategyId;
  if (!strategyId || strategyId.length < 10) {
    res.status(400).json({ error: "Invalid strategyId" });
    return;
  }

  try {
    const runs = await listCloudQmcRunsForStrategy(strategyId, 10);
    res.json({
      strategyId,
      runs,
      count: runs.length,
      governanceNote:
        "cloud_qmc_runs is challenger-only evidence (Phase 0 shadow). Decision authority: classical gates only.",
      authorityBoundary: "challenger_only",
    });
  } catch (err) {
    logger.warn({ strategyId, err }, "cloud-qmc/status: query failed");
    res.status(500).json({ error: "Failed to fetch cloud QMC runs" });
  }
});

// ─── GET /api/cloud-qmc/budget ───────────────────────────────────────────────

cloudQmcRoutes.get("/budget", async (_req, res) => {
  try {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const result = spawnSync(
      pythonCmd,
      ["-c", `
import json, sys
sys.path.insert(0, '${PROJECT_ROOT.replace(/\\/g, "/")}')
from src.engine.cloud_backend import CloudBudgetTracker
t = CloudBudgetTracker()
print(json.dumps(t.get_remaining()))
`],
      { cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 5000 },
    );

    if (result.status === 0 && result.stdout) {
      const budget = JSON.parse(result.stdout.trim());
      res.json({
        ...budget,
        cloudEnabled: (process.env.QUANTUM_CLOUD_ENABLED ?? "").toLowerCase() === "true",
        ibmTokenPresent: !!(process.env.IBM_QUANTUM_TOKEN ?? ""),
        budgetAllocation: "All 600s/month reserved for Ising-encoded IAE runs (Tier 4.5)",
        pessimismFactor: 2,
        estimatedRunsRemaining: Math.floor((budget.ibm_seconds_remaining ?? 0) / 120),
      });
    } else {
      res.json({
        error: "budget_check_failed",
        stderr: result.stderr?.slice(0, 200),
        cloudEnabled: (process.env.QUANTUM_CLOUD_ENABLED ?? "").toLowerCase() === "true",
        ibmTokenPresent: !!(process.env.IBM_QUANTUM_TOKEN ?? ""),
      });
    }
  } catch (err) {
    logger.warn({ err }, "cloud-qmc/budget: failed");
    res.status(500).json({ error: "Failed to check budget" });
  }
});

// ─── POST /api/cloud-qmc/poll ────────────────────────────────────────────────
// Manual poll trigger (for testing — normally called by cloud-qmc-poll cron)

cloudQmcRoutes.post("/poll", pipelinePauseGate, async (_req, res) => {
  logger.info("cloud-qmc/poll: manual poll triggered");
  try {
    const result = await pollPendingJobs();
    res.json({
      message: "Poll cycle complete",
      result,
      governanceNote: "cloud_qmc_runs is challenger-only evidence (Phase 0 shadow)",
    });
  } catch (err) {
    logger.warn({ err }, "cloud-qmc/poll: failed");
    res.status(500).json({ error: "Poll cycle failed" });
  }
});
