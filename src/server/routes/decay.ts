/**
 * Decay Detection Routes — Half-life detector + auto-quarantine
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

export const decayRoutes = Router();

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
      logger.info({ component: "decay-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse decay output: ${stdout}`));
        }
      } else {
        reject(new Error(`Decay engine failed (exit ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      if (pythonCmd === "python") {
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
            reject(new Error(`Decay engine failed: ${stderr2}`));
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
    const result = await runPython(
      "src.engine.decay.half_life",
      JSON.stringify({ action: "status", strategy_id: strategyId }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Decay status failed");
    res.status(500).json({ error: "Failed to get decay status", details: String(err) });
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
    const result = await runPython(
      "src.engine.decay.half_life",
      JSON.stringify({ action: "analyze", ...parsed.data }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Decay analysis failed");
    res.status(500).json({ error: "Decay analysis failed", details: String(err) });
  }
});

// ─── GET /api/decay/signals/:strategyId ─────────────────────────
// Individual sub-signal breakdown
decayRoutes.get("/signals/:strategyId", async (req, res) => {
  const { strategyId } = req.params;

  try {
    const result = await runPython(
      "src.engine.decay.sub_signals",
      JSON.stringify({ action: "signals", strategy_id: strategyId }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Decay signals failed");
    res.status(500).json({ error: "Failed to get decay signals", details: String(err) });
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
    const result = await runPython(
      "src.engine.decay.quarantine",
      JSON.stringify({ action: "evaluate", ...parsed.data }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Quarantine evaluation failed");
    res.status(500).json({ error: "Quarantine evaluation failed", details: String(err) });
  }
});

// ─── GET /api/decay/dashboard ───────────────────────────────────
// All strategies with their decay status
decayRoutes.get("/dashboard", async (_req, res) => {
  try {
    const result = await runPython(
      "src.engine.decay.half_life",
      JSON.stringify({ action: "dashboard" }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Decay dashboard failed");
    res.status(500).json({ error: "Failed to get decay dashboard", details: String(err) });
  }
});
