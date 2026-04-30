import { Router } from "express";
import { desc, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { deeparForecasts, deeparTrainingRuns } from "../db/schema.js";
import {
  trainDeepAR,
  predictRegime,
  getLatestForecast,
  getDeepARWeight,
  isDeepARDeferred,
} from "../services/deepar-service.js";
import { isActive as isPipelineActive } from "../services/pipeline-control-service.js";
export const deeparRoutes = Router();

// GET /api/deepar/forecast/all — Latest forecasts for all symbols
// MUST be registered before /forecast/:symbol to avoid "all" matching as :symbol
deeparRoutes.get("/forecast/all", async (req, res) => {
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
    req.log.error({ err }, "Failed to fetch all DeepAR forecasts");
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
    req.log.error({ err, symbol: req.params.symbol }, "Failed to fetch DeepAR forecast");
    res.status(500).json({ error: "Failed to fetch forecast" });
  }
});

// GET /api/deepar/accuracy — Rolling hit rates + graduation status
deeparRoutes.get("/accuracy", async (req, res) => {
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
    req.log.error({ err }, "Failed to fetch DeepAR accuracy");
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
    req.log.error({ err }, "Failed to fetch DeepAR training history");
    res.status(500).json({ error: "Failed to fetch training history" });
  }
});

// POST /api/deepar/train — Manual training trigger
deeparRoutes.post("/train", async (req, res) => {
  // FIX 5 — pipeline pause gate. trainDeepAR() spawns Python and writes
  // deepar_training_runs rows. Block side-effects when pipeline is paused.
  if (!(await isPipelineActive())) {
    res.status(423).json({ error: "pipeline_paused" });
    return;
  }
  try {
    const symbols = req.body?.symbols as string[] | undefined;
    const result = await trainDeepAR(symbols);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Manual DeepAR training failed");
    res.status(500).json({ error: "Training failed" });
  }
});

// POST /api/deepar/predict — Manual prediction trigger
deeparRoutes.post("/predict", async (req, res) => {
  // FIX 5 — pipeline pause gate. predictRegime() spawns Python and writes
  // deepar_forecasts rows. Block side-effects when pipeline is paused.
  if (!(await isPipelineActive())) {
    res.status(423).json({ error: "pipeline_paused" });
    return;
  }
  try {
    const symbols = req.body?.symbols as string[] | undefined;
    const forecasts = await predictRegime(symbols);
    // Caveat 1: surface deferred sentinel as 503 so callers know the prediction
    // was skipped (circuit open) rather than failed silently with empty payload.
    if (isDeepARDeferred(forecasts)) {
      res.status(503).json({
        deferred: true,
        reason: forecasts.reason,
        reopensAt: forecasts.reopensAt,
        symbols: forecasts.symbols,
        weight: getDeepARWeight(),
      });
      return;
    }
    res.json({ forecasts, weight: getDeepARWeight() });
  } catch (err) {
    req.log.error({ err }, "Manual DeepAR prediction failed");
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
