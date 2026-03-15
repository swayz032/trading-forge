/**
 * Survival Routes — Prop firm survival optimization API
 *
 * Follows the backtest-service.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout -> JSON.parse
 * - stderr -> logging
 */

import { Router } from "express";
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { z } from "zod";
import { logger } from "../index.js";

export const survivalRoutes = Router();

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../..");

// ─── Python subprocess helper ──────────────────────────────────

function runPython(module: string, configJson: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-m", module, "--config", configJson];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "survival-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse survival output: ${stdout}`));
        }
      } else {
        reject(new Error(`Survival engine failed (exit ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      if (pythonCmd === "python") {
        // Retry with python3
        const proc2 = spawn("python3", args, {
          env: { ...process.env },
          cwd: PROJECT_ROOT,
        });
        let stdout2 = "";
        let stderr2 = "";
        proc2.stdout.on("data", (data) => (stdout2 += data.toString()));
        proc2.stderr.on("data", (data) => (stderr2 += data.toString()));
        proc2.on("close", (code) => {
          if (code === 0) {
            try { resolve(JSON.parse(stdout2.trim())); }
            catch { reject(new Error(`Failed to parse: ${stdout2}`)); }
          } else {
            reject(new Error(`Survival engine failed: ${stderr2}`));
          }
        });
        proc2.on("error", () => reject(err));
      } else {
        reject(err);
      }
    });
  });
}

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
    const result = await runPython(
      "src.engine.survival.survival_scorer",
      JSON.stringify(parsed.data),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Survival score failed");
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
    const result = await runPython(
      "src.engine.survival.survival_comparator",
      JSON.stringify(parsed.data),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Survival compare failed");
    res.status(500).json({ error: "Survival comparison failed", details: String(err) });
  }
});

// ─── GET /api/survival/firm-profiles ─────────────────────────────
// List all firm survival profiles (no Python needed — read from JSON)
survivalRoutes.get("/firm-profiles", async (_req, res) => {
  try {
    const result = await runPython(
      "src.engine.survival.firm_profiles",
      JSON.stringify({ action: "list" }),
    );
    res.json(result);
  } catch {
    // Fallback: return firm list from a simple Python call
    // If that also fails, return hardcoded list
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
    const result = await runPython(
      "src.engine.survival.drawdown_simulator",
      JSON.stringify(parsed.data),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Survival MC failed");
    res.status(500).json({ error: "Monte Carlo simulation failed", details: String(err) });
  }
});

// ─── GET /api/survival/leaderboard ───────────────────────────────
// Rank strategies by survival per firm
// Query params: ?firm=MFFU&account_type=50K&limit=20
survivalRoutes.get("/leaderboard", async (req, res) => {
  // This would typically query the database for stored survival scores.
  // For now, return a placeholder indicating the endpoint is available
  // and scores should be computed via POST /api/survival/compare
  const { firm, limit = "20" } = req.query;

  res.json({
    message: "Use POST /api/survival/compare with strategy daily_pnls to generate leaderboard",
    firm: firm || "all",
    limit: Number(limit),
    hint: "POST to /api/survival/compare with strategies array to get ranked results",
  });
});
