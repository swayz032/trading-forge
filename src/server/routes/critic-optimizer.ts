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
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { backtests } from "../db/schema.js";
import {
  triggerCriticOptimizer,
  getCriticRun,
  getCriticHistory,
  getCriticCandidates,
  manualReplayCandidates,
} from "../services/critic-optimizer-service.js";

export const criticOptimizerRoutes = Router();

// ─── POST /analyze ──────────────────────────────────────────────

const analyzeSchema = z.object({
  strategy_id: z.string().uuid(),
  backtest_id: z.string().uuid().optional(),
  pennylane_enabled: z.boolean().default(true),
});

criticOptimizerRoutes.post("/analyze", async (req, res) => {
  try {
    const body = analyzeSchema.parse(req.body);

    // Resolve backtest_id: use provided value or fetch latest for the strategy
    let backtestId = body.backtest_id ?? null;
    if (!backtestId) {
      const [latest] = await db
        .select({ id: backtests.id })
        .from(backtests)
        .where(eq(backtests.strategyId, body.strategy_id))
        .orderBy(desc(backtests.createdAt))
        .limit(1);
      if (!latest) {
        return res.status(400).json({
          error: "No backtest found for this strategy. Provide backtest_id or run a backtest first.",
        });
      }
      backtestId = latest.id;
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

criticOptimizerRoutes.post("/replay", async (req, res) => {
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
    manualReplayCandidates(
      body.run_id,
      run.strategyId,
      candidateIds.slice(0, body.max_replays),
    ).catch(() => {
      // Logged inside the service; nothing to do here
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
