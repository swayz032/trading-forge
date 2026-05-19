import { Router } from "express";
import { z } from "zod";
import { createAlphaVantageFetcher } from "../../data/fetchers/alphavantage.js";


export const indicatorRoutes = Router();

const SUPPORTED_INDICATORS = ["RSI", "MACD", "BBANDS", "SMA", "EMA", "ATR", "VWAP"] as const;
const INTERVALS = ["1min", "5min", "15min", "30min", "60min", "daily", "weekly", "monthly"] as const;

const indicatorQuerySchema = z.object({
  interval: z.enum(INTERVALS).default("daily"),
  timePeriod: z
    .string()
    .transform((v) => parseInt(v, 10))
    .optional(),
  seriesType: z.enum(["close", "open", "high", "low"]).default("close"),
});

function getFetcher() {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) throw new Error("ALPHA_VANTAGE_API_KEY not set");
  return createAlphaVantageFetcher({ apiKey });
}

// ─── GET /api/indicators/supported ───────────────────────────────
// MUST be registered before /:symbol/:indicator to avoid shadowing

indicatorRoutes.get("/supported", (req, res) => {
  res.json({
    indicators: SUPPORTED_INDICATORS,
    intervals: INTERVALS,
  });
});

// ─── GET /api/indicators/:symbol/:indicator ──────────────────────

indicatorRoutes.get("/:symbol/:indicator", async (req, res) => {
  const { symbol, indicator: rawIndicator } = req.params;
  const indicator = rawIndicator.toUpperCase();

  if (!SUPPORTED_INDICATORS.includes(indicator as typeof SUPPORTED_INDICATORS[number])) {
    res.status(400).json({
      error: `Unsupported indicator: ${indicator}`,
      supported: SUPPORTED_INDICATORS,
    });
    return;
  }

  const parsed = indicatorQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params", details: parsed.error.issues });
    return;
  }

  const { interval, timePeriod, seriesType } = parsed.data;

  try {
    const fetcher = getFetcher();
    const data = await fetcher.fetchIndicator({
      symbol,
      indicator,
      interval,
      timePeriod,
      seriesType,
    });

    res.json({
      symbol,
      indicator,
      interval,
      data,
    });
  } catch (err) {
    req.log.error({ err, symbol, indicator }, "Indicator fetch failed");
    res.status(500).json({ error: "Failed to fetch indicator data" });
  }
});

