/**
 * Decay Detection Routes — Half-life detector + auto-quarantine
 *
 * Follows the backtest-service.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 */

import { Router } from "express";
import { z } from "zod";
import { logger } from "../index.js";
import { runPythonModule } from "../lib/python-runner.js";

export const decayRoutes = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const analyzeSchema = z.object({
  daily_pnls: z.array(z.number()).min(1),
  trades: z.array(z.record(z.unknown())).optional(),
  strategy_regime: z.string().optional(),
  current_regime: z.string().optional(),
  window: z.number().int().min(10).max(120).default(60),
});

const quarantineEvalSchema = z.object({
  current_level: z.enum(["healthy", "watch", "reduce", "quarantine", "retire"]),
  decay_score: z.number().min(0).max(100),
  days_at_current_level: z.number().int().min(0),
  improving_days: z.number().int().min(0).default(0),
});

// ─── GET /api/decay/status/:strategyId ──────────────────────────
// Current decay status + quarantine level
decayRoutes.get("/status/:strategyId", async (req, res) => {
  const { strategyId } = req.params;

  try {
    const result = await runPythonModule({
      module: "src.engine.decay.half_life",
      config: { action: "status", strategy_id: strategyId },
      componentName: "decay-status",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Decay status failed");
    const status = String(err).includes("timed out") ? 504 : 500;
    res.status(status).json({ error: "Failed to get decay status", details: String(err) });
  }
});

// ─── POST /api/decay/analyze ────────────────────────────────────
// Run full decay analysis on a strategy
decayRoutes.post("/analyze", async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.decay.half_life",
      config: { action: "analyze", ...parsed.data } as unknown as Record<string, unknown>,
      componentName: "decay-analysis",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Decay analysis failed");
    const status = String(err).includes("timed out") ? 504 : 500;
    res.status(status).json({ error: "Decay analysis failed", details: String(err) });
  }
});

// ─── GET /api/decay/signals/:strategyId ─────────────────────────
// Individual sub-signal breakdown
decayRoutes.get("/signals/:strategyId", async (req, res) => {
  const { strategyId } = req.params;

  try {
    const result = await runPythonModule({
      module: "src.engine.decay.sub_signals",
      config: { action: "signals", strategy_id: strategyId },
      componentName: "decay-signals",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Decay signals failed");
    const status = String(err).includes("timed out") ? 504 : 500;
    res.status(status).json({ error: "Failed to get decay signals", details: String(err) });
  }
});

// ─── POST /api/decay/quarantine/evaluate ────────────────────────
// Evaluate quarantine level transition
decayRoutes.post("/quarantine/evaluate", async (req, res) => {
  const parsed = quarantineEvalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.decay.quarantine",
      config: { action: "evaluate", ...parsed.data } as unknown as Record<string, unknown>,
      componentName: "quarantine-eval",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Quarantine evaluation failed");
    const status = String(err).includes("timed out") ? 504 : 500;
    res.status(status).json({ error: "Quarantine evaluation failed", details: String(err) });
  }
});

// ─── GET /api/decay/dashboard ───────────────────────────────────
// All strategies with their decay status
decayRoutes.get("/dashboard", async (_req, res) => {
  try {
    const result = await runPythonModule({
      module: "src.engine.decay.half_life",
      config: { action: "dashboard" },
      componentName: "decay-dashboard",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Decay dashboard failed");
    const status = String(err).includes("timed out") ? 504 : 500;
    res.status(status).json({ error: "Failed to get decay dashboard", details: String(err) });
  }
});
