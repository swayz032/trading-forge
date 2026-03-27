/**
 * Day Archetype Routes — Phase 4.13
 *
 * Classify trading days into 8 archetypes, predict pre-session,
 * and map strategies to their best-performing day types.
 */

import { Router } from "express";
import { z } from "zod";
import { logger } from "../index.js";
import { runPythonModule } from "../lib/python-runner.js";

export const archetypeRoutes = Router();

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
archetypeRoutes.get("/today/:symbol", async (_req, res) => {
  res.status(501).json({ error: "Not implemented — use POST /api/archetypes/classify instead" });
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
    const result = await runPythonModule({
      module: "src.engine.archetypes.classifier",
      config: { action: "classify", ...parsed.data } as unknown as Record<string, unknown>,
      componentName: "archetype-classifier",
    });
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
    const result = await runPythonModule({
      module: "src.engine.archetypes.strategy_mapper",
      config: { action: "map", ...parsed.data } as unknown as Record<string, unknown>,
      componentName: "archetype-mapper",
    });
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
