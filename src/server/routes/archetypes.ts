/**
 * Day Archetype Routes — Phase 4.13
 *
 * Classify trading days into 8 archetypes, predict pre-session,
 * and map strategies to their best-performing day types.
 */

import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { logger } from "../index.js";
import { runPythonModule } from "../lib/python-runner.js";
import { db } from "../db/index.js";
import { dayArchetypes } from "../db/schema.js";

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
archetypeRoutes.get("/today/:symbol", async (req, res) => {
  // Proxy to POST /classify with today's date for the requested symbol
  res.status(303).json({
    redirect: "POST /api/archetypes/classify",
    message: `Use POST /api/archetypes/classify with symbol "${req.params.symbol}" and today's OHLCV data`,
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
  const parsedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const parsedOffset = Math.max(Number(offset) || 0, 0);

  try {
    const rows = await db
      .select({
        tradingDate: dayArchetypes.tradingDate,
        archetype: dayArchetypes.archetype,
        confidence: dayArchetypes.confidence,
        predictedArchetype: dayArchetypes.predictedArchetype,
        predictionCorrect: dayArchetypes.predictionCorrect,
        metrics: dayArchetypes.metrics,
        features: dayArchetypes.features,
      })
      .from(dayArchetypes)
      .where(eq(dayArchetypes.symbol, symbol))
      .orderBy(desc(dayArchetypes.tradingDate))
      .limit(parsedLimit)
      .offset(parsedOffset);

    const [{ count: total }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dayArchetypes)
      .where(eq(dayArchetypes.symbol, symbol));

    res.json({
      symbol,
      limit: parsedLimit,
      offset: parsedOffset,
      total,
      data: rows,
    });
  } catch (err) {
    logger.error({ err, symbol }, "Archetype history query failed");
    res.status(500).json({ error: "Failed to load archetype history", details: String(err) });
  }
});

// ─── GET /api/archetypes/distribution/:symbol ────────────────────
// Archetype frequency distribution
archetypeRoutes.get("/distribution/:symbol", async (req, res) => {
  const { symbol } = req.params;
  try {
    const rows = await db
      .select({
        archetype: dayArchetypes.archetype,
        count: sql<number>`count(*)::int`,
      })
      .from(dayArchetypes)
      .where(eq(dayArchetypes.symbol, symbol))
      .groupBy(dayArchetypes.archetype)
      .orderBy(sql`count(*) desc`, dayArchetypes.archetype);

    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const distribution = Object.fromEntries(
      rows.map((row) => [
        row.archetype,
        {
          count: row.count,
          share: total > 0 ? row.count / total : 0,
        },
      ]),
    );

    res.json({
      symbol,
      totalDays: total,
      distribution,
    });
  } catch (err) {
    logger.error({ err, symbol }, "Archetype distribution query failed");
    res.status(500).json({ error: "Failed to load archetype distribution", details: String(err) });
  }
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
  try {
    const rows = await db
      .select({
        predictedArchetype: dayArchetypes.predictedArchetype,
        total: sql<number>`count(*)::int`,
        correct: sql<number>`sum(case when ${dayArchetypes.predictionCorrect} then 1 else 0 end)::int`,
      })
      .from(dayArchetypes)
      .where(
        and(
          isNotNull(dayArchetypes.predictedArchetype),
          isNotNull(dayArchetypes.predictionCorrect),
        ),
      )
      .groupBy(dayArchetypes.predictedArchetype)
      .orderBy(dayArchetypes.predictedArchetype);

    const totalPredictions = rows.reduce((sum, row) => sum + row.total, 0);
    const correctPredictions = rows.reduce((sum, row) => sum + row.correct, 0);
    const perArchetype = Object.fromEntries(
      rows.map((row) => [
        row.predictedArchetype,
        {
          total: row.total,
          correct: row.correct,
          accuracy: row.total > 0 ? row.correct / row.total : 0,
        },
      ]),
    );

    res.json({
      total_predictions: totalPredictions,
      correct_predictions: correctPredictions,
      accuracy: totalPredictions > 0 ? correctPredictions / totalPredictions : 0,
      per_archetype: perArchetype,
    });
  } catch (err) {
    logger.error({ err }, "Archetype accuracy query failed");
    res.status(500).json({ error: "Failed to load archetype accuracy", details: String(err) });
  }
});
