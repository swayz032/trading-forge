/**
 * Survival Routes — Prop firm survival optimization API
 *
 * Follows the backtest-service.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 */

import { Router } from "express";
import { z } from "zod";
import { runPythonModule } from "../lib/python-runner.js";

export const survivalRoutes = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const survivalScoreSchema = z.object({
  daily_pnls: z.array(z.number()).min(1),
  firm: z.string().min(1),
  account_type: z.string().default("50K"),
  num_mc_sims: z.number().int().min(100).max(50_000).default(5000),
  weights: z.record(z.number()).optional(),
  avg_trades_per_day: z.number().positive().default(2.0),
});

const compareSchema = z.object({
  strategies: z.array(z.object({
    name: z.string().min(1),
    daily_pnls: z.array(z.number()).min(1),
  })).min(1).max(10),
  firms: z.array(z.string()).optional(),
  account_type: z.string().default("50K"),
  num_mc_sims: z.number().int().min(100).max(50_000).default(5000),
});

const monteCarloSchema = z.object({
  daily_pnls: z.array(z.number()).min(1),
  max_drawdown: z.number().positive(),
  drawdown_type: z.enum(["trailing", "EOD", "intraday"]).default("trailing"),
  num_sims: z.number().int().min(100).max(50_000).default(5000),
});

// ─── POST /api/survival/score ────────────────────────────────────
// Survival score for strategy + firm combo
survivalRoutes.post("/score", async (req, res) => {
  const parsed = survivalScoreSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.survival.survival_scorer",
      config: parsed.data as unknown as Record<string, unknown>,
      componentName: "survival-scorer",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Survival score failed");
    res.status(500).json({ error: "Survival score calculation failed", details: String(err) });
  }
});

// ─── POST /api/survival/compare ──────────────────────────────────
// Compare strategies by survival score
survivalRoutes.post("/compare", async (req, res) => {
  const parsed = compareSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.survival.survival_comparator",
      config: parsed.data as unknown as Record<string, unknown>,
      componentName: "survival-comparator",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Survival compare failed");
    res.status(500).json({ error: "Survival comparison failed", details: String(err) });
  }
});

// ─── GET /api/survival/firm-profiles ─────────────────────────────
// List all firm survival profiles
survivalRoutes.get("/firm-profiles", async (_req, res) => {
  try {
    const result = await runPythonModule({
      module: "src.engine.survival.firm_profiles",
      config: { action: "list" },
      componentName: "firm-profiles",
    });
    res.json(result);
  } catch {
    // Fallback: return firm list if python fails
    res.json({
      firms: [
        "MFFU", "Topstep", "TPT", "Apex", "FFN", "Alpha", "Tradeify", "Earn2Trade",
      ],
    });
  }
});

// ─── POST /api/survival/monte-carlo ──────────────────────────────
// MC simulation for DD breach probability
survivalRoutes.post("/monte-carlo", async (req, res) => {
  const parsed = monteCarloSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule({
      module: "src.engine.survival.drawdown_simulator",
      config: parsed.data as unknown as Record<string, unknown>,
      componentName: "survival-mc",
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Survival MC failed");
    res.status(500).json({ error: "Monte Carlo simulation failed", details: String(err) });
  }
});

// ─── GET /api/survival/leaderboard ───────────────────────────────
// Rank strategies by survival per firm
// Query params: ?firm=MFFU&account_type=50K&limit=20
survivalRoutes.get("/leaderboard", async (req, res) => {
  // Proxy guidance — leaderboard requires running compare across strategies
  res.status(303).json({
    redirect: "POST /api/survival/compare",
    message: "Use POST /api/survival/compare with multiple backtest IDs to generate a survival leaderboard",
  });
});
