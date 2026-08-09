/**
 * Critic Optimizer API Routes
 *
 * POST /api/critic-optimizer/analyze     — Trigger analysis for a strategy
 * GET  /api/critic-optimizer/candidates/:strategyId — List candidates
 * POST /api/critic-optimizer/replay      — Manual replay trigger
 * GET  /api/critic-optimizer/history     — Runs list
 * GET  /api/critic-optimizer/run/:runId  — Full run detail with candidates
 */

import { Router } from "express";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { backtests, criticOptimizationRuns, BACKTEST_STATUS_REFUSED } from "../db/schema.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { broadcastSSE } from "./sse.js";
import { logger } from "../index.js";
import {
  triggerCriticOptimizer,
  getCriticRun,
  getCriticHistory,
  getCriticCandidates,
  manualReplayCandidates,
} from "../services/critic-optimizer-service.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";

export const criticOptimizerRoutes = Router();

// ─── POST /analyze ──────────────────────────────────────────────

const analyzeSchema = z.object({
  strategy_id: z.string().uuid(),
  backtest_id: z.string().uuid().optional(),
  pennylane_enabled: z.boolean().default(true),
});

criticOptimizerRoutes.post("/analyze", idempotencyMiddleware, async (req, res) => {
  // FIX 5 — pipeline pause gate. triggerCriticOptimizer spawns Python critic
  // analysis and writes critic_optimization_runs + critic_candidates rows.
  // Block side-effects when pipeline is paused.
  if (!(await isPipelineActive())) {
    return res.status(423).json({ error: "pipeline_paused" });
  }
  try {
    const body = analyzeSchema.parse(req.body);

    // ─── D-10 F-9 (R-754 §3): a REFUSED backtest is not critic evidence ───────
    //
    // Both resolution paths previously admitted a refusal:
    //   implicit — "latest backtest" had NO status predicate, so the most recent
    //              row won even when the engine refused to execute it;
    //   explicit — `backtest_id` was passed straight through with no lookup.
    //
    // A refusal's metric columns are NULL by construction (R-751 §8-5), so the
    // critic would read absent measurements as a measured flat result. That is the
    // "manufactures evidence" class, and it is why this finding is on the wave.
    //
    // The guard is deliberately in TWO layers: the query narrows to `completed`,
    // AND the resolved row's status is validated for BOTH paths at a single point
    // below. The second layer is the load-bearing one — a future edit to the query
    // cannot silently re-admit a refusal past it.
    let backtestId = body.backtest_id ?? null;
    let resolvedStatus: string | null = null;
    if (!backtestId) {
      const [latest] = await db
        .select({ id: backtests.id, status: backtests.status })
        .from(backtests)
        .where(and(eq(backtests.strategyId, body.strategy_id), eq(backtests.status, "completed")))
        .orderBy(desc(backtests.createdAt))
        .limit(1);
      if (!latest) {
        return res.status(400).json({
          error: "no_completed_backtest_evidence",
          message: "No COMPLETED backtest found for this strategy. Provide backtest_id or run a backtest first.",
        });
      }
      backtestId = latest.id;
      resolvedStatus = latest.status;
    } else {
      // ─── R-756 §3: THE OWNERSHIP JOIN. This is NOT a refusal defect ──────────
      //
      // This lookup previously matched `backtests.id` ALONE, and the two identifiers
      // were then never compared anywhere on the path:
      //   here                        triggerCriticOptimizer(backtestId, strategy_id)
      //   critic-optimizer-service.ts :1305 loads the BACKTEST  by one id
      //   critic-optimizer-service.ts :1316 loads the STRATEGY  by the other
      //
      // ⇒ a caller supplying strategy A's COMPLETED backtest_id together with
      // strategy B's strategy_id produced an evidence packet holding A's
      // MEASUREMENTS under B's IDENTITY AND CONFIG, and the critic ranked on it.
      // It fires on the fully completed path and needs no refusal to exist.
      //
      // Joining inside the WHERE clause rather than fetching-then-comparing also
      // means the response cannot distinguish "no such backtest" from "not yours".
      const [row] = await db
        .select({ id: backtests.id, status: backtests.status })
        .from(backtests)
        .where(and(eq(backtests.id, backtestId), eq(backtests.strategyId, body.strategy_id)))
        .limit(1);
      if (!row) {
        return res.status(404).json({
          error: "backtest_not_found_for_strategy",
          backtest_id: backtestId,
          strategy_id: body.strategy_id,
        });
      }
      resolvedStatus = row.status;
    }

    // SINGLE validation point for both paths. A refusal gets its OWN named outcome
    // rather than being folded into a generic failure — a deliberate refusal and a
    // crashed run are different events and downstream must be able to tell them
    // apart (the same separation R-754 §3 requires of F-7).
    if (resolvedStatus === BACKTEST_STATUS_REFUSED) {
      return res.status(422).json({
        error: "refused_backtest_no_evidence",
        backtest_id: backtestId,
        message:
          "This backtest was REFUSED before execution: it carries no metrics, so there is nothing for the critic to analyse. Re-extract the strategy rather than re-running it.",
      });
    }
    if (resolvedStatus !== "completed") {
      return res.status(422).json({
        error: "backtest_not_completed",
        backtest_id: backtestId,
        status: resolvedStatus,
      });
    }

    const result = await triggerCriticOptimizer(
      backtestId,
      body.strategy_id,
      { pennylane_enabled: body.pennylane_enabled },
    );

    if (result.status === "rate_limited") {
      return res.status(429).json({
        error: "Rate limited",
        message: "Max 1 critic run per strategy per 24 hours",
      });
    }

    return res.status(202).json({
      message: "Critic optimization started",
      runId: result.runId,
      status: result.status,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: err.errors });
    }
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /candidates/:strategyId ────────────────────────────────

criticOptimizerRoutes.get("/candidates/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;
    const status = req.query.status as string | undefined;

    const candidates = await getCriticCandidates(strategyId, status);
    return res.json({ candidates, total: candidates.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /replay ───────────────────────────────────────────────

const replaySchema = z.object({
  run_id: z.string().uuid(),
  candidate_ids: z.array(z.string().uuid()).optional(),
  max_replays: z.number().int().min(1).max(5).default(3),
});

criticOptimizerRoutes.post("/replay", idempotencyMiddleware, async (req, res) => {
  // FIX 5 — pipeline pause gate. manualReplayCandidates re-runs backtests as
  // critic-replay backtests (Python spawns + DB writes). Block when paused.
  if (!(await isPipelineActive())) {
    return res.status(423).json({ error: "pipeline_paused" });
  }
  try {
    const body = replaySchema.parse(req.body);

    // Validate run exists and has candidates
    const run = await getCriticRun(body.run_id);
    if (!run) {
      return res.status(404).json({ error: "Critic run not found" });
    }

    // Filter to requested candidates if specified, otherwise use all from the run
    const candidateIds = body.candidate_ids
      ? body.candidate_ids
      : run.candidates.map((c: any) => c.id);

    if (candidateIds.length === 0) {
      return res.status(400).json({ error: "No candidates to replay" });
    }

    // Fire and forget — return 202 immediately, replay runs async
    const runId = body.run_id;
    manualReplayCandidates(
      runId,
      run.strategyId,
      candidateIds.slice(0, body.max_replays),
    ).catch(async (err) => {
      logger.error({ err, runId }, "manualReplayCandidates failed");
      try {
        await db
          .update(criticOptimizationRuns)
          .set({ status: "failed", completedAt: new Date() })
          .where(eq(criticOptimizationRuns.id, runId));
        broadcastSSE("critic:completed", { runId, status: "failed" });
      } catch (updateErr) {
        logger.error({ updateErr }, "Failed to mark critic run as failed in catch");
      }
    });

    return res.status(202).json({
      message: "Replay queued",
      runId: body.run_id,
      candidateCount: Math.min(candidateIds.length, body.max_replays),
      maxReplays: body.max_replays,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: err.errors });
    }
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /history ───────────────────────────────────────────────

criticOptimizerRoutes.get("/history", async (req, res) => {
  try {
    const strategyId = req.query.strategy_id as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const runs = await getCriticHistory(strategyId, limit, offset);
    return res.json({ runs, total: runs.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /run/:runId ────────────────────────────────────────────

criticOptimizerRoutes.get("/run/:runId", async (req, res) => {
  try {
    const { runId } = req.params;
    const run = await getCriticRun(runId);

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    return res.json(run);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
