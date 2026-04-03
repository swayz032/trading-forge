import { Router } from "express";
import { desc, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { deeparForecasts, deeparTrainingRuns } from "../db/schema.js";
import {
  trainDeepAR,
  predictRegime,
  getLatestForecast,
  getDeepARWeight,
} from "../services/deepar-service.js";
import { logger } from "../index.js";

export const deeparRoutes = Router();

// GET /api/deepar/forecast/all — Latest forecasts for all symbols
// MUST be registered before /forecast/:symbol to avoid "all" matching as :symbol
deeparRoutes.get("/forecast/all", async (_req, res) => {
  try {
    // Distinct on symbol, ordered by forecast_date desc
    const forecasts = await db
      .select()
      .from(deeparForecasts)
      .orderBy(desc(deeparForecasts.forecastDate))
      .limit(100);

    // Deduplicate: keep only the latest per symbol
    const seen = new Set<string>();
    const latest = [];
    for (const f of forecasts) {
      if (!seen.has(f.symbol)) {
        seen.add(f.symbol);
        latest.push(f);
      }
    }

    res.json({ forecasts: latest, weight: getDeepARWeight() });
  } catch (err) {
    logger.error({ err }, "Failed to fetch all DeepAR forecasts");
    res.status(500).json({ error: "Failed to fetch forecasts" });
  }
});

// GET /api/deepar/forecast/:symbol — Latest forecast for a symbol
deeparRoutes.get("/forecast/:symbol", async (req, res) => {
  try {
    const forecast = await getLatestForecast(req.params.symbol.toUpperCase());
    if (!forecast) {
      res.status(404).json({ error: "No forecast found for symbol" });
      return;
    }
    res.json(forecast);
  } catch (err) {
    logger.error({ err, symbol: req.params.symbol }, "Failed to fetch DeepAR forecast");
    res.status(500).json({ error: "Failed to fetch forecast" });
  }
});

// GET /api/deepar/accuracy — Rolling hit rates + graduation status
deeparRoutes.get("/accuracy", async (_req, res) => {
  try {
    // Get rolling hit rate stats
    const stats = await db
      .select({
        symbol: deeparForecasts.symbol,
        total: sql<number>`count(*)`,
        withActual: sql<number>`count(actual_regime)`,
        avgHitRate: sql<string>`avg(hit_rate::numeric)`,
        latestDate: sql<string>`max(forecast_date)`,
      })
      .from(deeparForecasts)
      .groupBy(deeparForecasts.symbol);

    const daysResult = await db
      .select({
        days: sql<number>`count(distinct forecast_date)`,
      })
      .from(deeparForecasts)
      .where(sql`actual_regime is not null`);

    const daysTracked = Number(daysResult[0]?.days ?? 0);

    res.json({
      bySymbol: stats,
      daysTracked,
      currentWeight: getDeepARWeight(),
      graduationStatus: getGraduationStatus(daysTracked, getDeepARWeight()),
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch DeepAR accuracy");
    res.status(500).json({ error: "Failed to fetch accuracy" });
  }
});

// GET /api/deepar/training-history — Paginated training run history
deeparRoutes.get("/training-history", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;

    const runs = await db
      .select()
      .from(deeparTrainingRuns)
      .orderBy(desc(deeparTrainingRuns.trainedAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ total: sql<number>`count(*)` })
      .from(deeparTrainingRuns);

    res.json({
      runs,
      total: Number(countResult?.total ?? 0),
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch DeepAR training history");
    res.status(500).json({ error: "Failed to fetch training history" });
  }
});

// POST /api/deepar/train — Manual training trigger
deeparRoutes.post("/train", async (req, res) => {
  try {
    const symbols = req.body?.symbols as string[] | undefined;
    const result = await trainDeepAR(symbols);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Manual DeepAR training failed");
    res.status(500).json({ error: "Training failed" });
  }
});

// POST /api/deepar/predict — Manual prediction trigger
deeparRoutes.post("/predict", async (req, res) => {
  try {
    const symbols = req.body?.symbols as string[] | undefined;
    const forecasts = await predictRegime(symbols);
    res.json({ forecasts, weight: getDeepARWeight() });
  } catch (err) {
    logger.error({ err }, "Manual DeepAR prediction failed");
    res.status(500).json({ error: "Prediction failed" });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────

function getGraduationStatus(daysTracked: number, weight: number): string {
  if (weight >= 0.10) return "fully_graduated";
  if (weight >= 0.05) return `partial_graduated (${120 - daysTracked} days to full)`;
  if (daysTracked >= 30) return `tracking (${60 - daysTracked} days to first graduation)`;
  return `early_tracking (${daysTracked}/60 days)`;
}
