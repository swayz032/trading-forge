/**
 * Day Archetype Routes — Phase 4.13
 *
 * Classify trading days into 8 archetypes, predict pre-session,
 * and map strategies to their best-performing day types.
 */

import { Router } from "express";
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { z } from "zod";
import { logger } from "../index.js";

export const archetypeRoutes = Router();

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../..");

// ─── Python subprocess helper ──────────────────────────────────

function runPython(scriptPath: string, inputJson: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = ["-c", `
import sys, json
sys.path.insert(0, '.')
input_data = json.loads(sys.argv[1])
${scriptPath}
`, inputJson];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "archetype-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse archetype output: ${stdout}`));
        }
      } else {
        reject(new Error(`Archetype engine failed (exit ${code}): ${stderr}`));
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
            reject(new Error(`Archetype engine failed: ${stderr2}`));
          }
        });
        proc2.on("error", () => reject(err));
      } else {
        reject(err);
      }
    });
  });
}

function runPythonModule(module: string, configJson: string): Promise<Record<string, unknown>> {
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
      logger.info({ component: "archetype-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse archetype output: ${stdout}`));
        }
      } else {
        reject(new Error(`Archetype engine failed (exit ${code}): ${stderr}`));
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
            reject(new Error(`Archetype engine failed: ${stderr2}`));
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

const classifySchema = z.object({
  day_data: z.object({
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number().optional(),
    vwap: z.number().optional(),
  }),
  prev_day_data: z.object({
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number().optional(),
  }).optional(),
  atr: z.number().positive().optional(),
});

const strategyFitSchema = z.object({
  strategy_id: z.string().min(1),
  daily_results: z.array(z.object({
    date: z.string(),
    pnl: z.number(),
    archetype: z.string(),
  })).min(1),
});

// ─── GET /api/archetypes/today/:symbol ───────────────────────────
// Today's predicted archetype for a symbol
archetypeRoutes.get("/today/:symbol", async (req, res) => {
  const { symbol } = req.params;
  // In production, this would fetch premarket data + historical features
  // and run the KNN predictor. For now, return a placeholder.
  res.json({
    symbol,
    message: "Prediction requires premarket data. Use POST /api/archetypes/classify for manual classification.",
    hint: "Connect to Massive WebSocket for real-time premarket data to enable auto-prediction.",
  });
});

// ─── POST /api/archetypes/classify ───────────────────────────────
// Classify a single day from OHLCV data
archetypeRoutes.post("/classify", async (req, res) => {
  const parsed = classifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule(
      "src.engine.archetypes.classifier",
      JSON.stringify({
        action: "classify",
        ...parsed.data,
      }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Archetype classification failed");
    res.status(500).json({ error: "Classification failed", details: String(err) });
  }
});

// ─── GET /api/archetypes/history/:symbol ─────────────────────────
// Historical archetype labels for a symbol
archetypeRoutes.get("/history/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const { limit = "100", offset = "0" } = req.query;

  // In production, query day_archetypes table
  res.json({
    symbol,
    limit: Number(limit),
    offset: Number(offset),
    message: "Historical archetypes will be populated after running label_history on market data.",
    data: [],
  });
});

// ─── GET /api/archetypes/distribution/:symbol ────────────────────
// Archetype frequency distribution
archetypeRoutes.get("/distribution/:symbol", async (req, res) => {
  const { symbol } = req.params;

  // In production, query day_archetypes table for distribution
  res.json({
    symbol,
    message: "Distribution available after historical labeling. Use POST /api/archetypes/classify to label days.",
    distribution: {},
  });
});

// ─── POST /api/archetypes/strategy-fit ───────────────────────────
// Map strategy performance to best/worst archetypes
archetypeRoutes.post("/strategy-fit", async (req, res) => {
  const parsed = strategyFitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  try {
    const result = await runPythonModule(
      "src.engine.archetypes.strategy_mapper",
      JSON.stringify({
        action: "map",
        ...parsed.data,
      }),
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Strategy-archetype mapping failed");
    res.status(500).json({ error: "Strategy mapping failed", details: String(err) });
  }
});

// ─── GET /api/archetypes/accuracy ────────────────────────────────
// Prediction accuracy statistics
archetypeRoutes.get("/accuracy", async (_req, res) => {
  // In production, query day_archetypes table where predicted_archetype is not null
  res.json({
    message: "Accuracy stats available after predictions are stored and verified post-session.",
    total_predictions: 0,
    correct_predictions: 0,
    accuracy: 0.0,
    per_archetype: {},
  });
});
