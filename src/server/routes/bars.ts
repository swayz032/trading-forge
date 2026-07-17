/**
 * GET /api/bars/:symbol — real OHLCV bars, backed by the S3/DuckDB/Polars data
 * lake (src/engine/data_loader.py) via a Python subprocess.
 *
 * This closes the pre-market producer gap documented in CLAUDE.md §2b: before this
 * route existed, pre-market-routine.ts::getDailyBars() (and its 5m-window siblings)
 * 404'd on every call, so pmh/pml + dxy_direction/us10y_direction had delivered 0/39
 * non-null values ever. Consumer check before landing (2026-07-17): neither field
 * currently reaches a live gate — cross_asset_aligned and liquidity_target_clear are
 * both Path C (weighted-scoring) factors, and Path C has zero opted-in strategies —
 * so this is safe additive infra, not a live re-baseline.
 *
 * Symbol scope: the S3 data lake only carries MES/MNQ/MCL (+ES/NQ/CL aliases) —
 * data_loader.py's load_ohlcv() maps micros to full-size S3 paths internally. A
 * symbol with no data backing (e.g. DXY, ZN/10Y — no producer exists anywhere in
 * this codebase yet, confirmed 2026-07-17) returns an HONEST EMPTY {bars: []} at
 * 200, not a fabricated value and not a 404 — the caller already degrades
 * gracefully on empty bars. Genuine infra failures (missing S3 creds, DuckDB read
 * errors) return 502 so they're distinguishable in logs from "no data for this
 * symbol" — silently collapsing both into {bars: []} would mask real outages as
 * a data gap.
 */

import { Router } from "express";
import { z } from "zod";
import { runPythonModule } from "../lib/python-runner.js";
import { logger } from "../lib/logger.js";
import {
  resolveDailyRange,
  resolveIntradayRange,
  shapeDailyBars,
  shapeIntraBars,
  filterOvernightWindow,
  filterHourWindow,
  firstRthBar,
  etDateOf,
  type RawBar,
} from "../lib/bars-window.js";

export const barsRoutes = Router();

const symbolSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{1,10}$/, "symbol must be 1-10 alphanumeric characters");

const DAILY_TIMEFRAMES = new Set(["1d", "1D", "daily"]);

const querySchema = z.object({
  timeframe: z.string().min(1).default("1d"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  overnight: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  start_hour_et: z.coerce.number().int().min(0).max(23).optional(),
  end_hour_et: z.coerce.number().int().min(0).max(23).optional(),
});

barsRoutes.get("/:symbol", async (req, res) => {
  const symbolParsed = symbolSchema.safeParse(req.params.symbol);
  if (!symbolParsed.success) {
    res.status(400).json({ error: "Invalid symbol", details: symbolParsed.error.issues });
    return;
  }
  const symbol = symbolParsed.data.toUpperCase();

  const queryParsed = querySchema.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: "Invalid query params", details: queryParsed.error.issues });
    return;
  }
  const { timeframe, limit, date, overnight, start_hour_et, end_hour_et } = queryParsed.data;
  const isDaily = DAILY_TIMEFRAMES.has(timeframe);

  if (!isDaily && !date) {
    res.status(400).json({ error: "date is required for intraday timeframes" });
    return;
  }

  const range = isDaily
    ? resolveDailyRange(limit, date)
    : resolveIntradayRange({ date: date as string, overnight });

  let pyResult: { bars?: RawBar[] };
  try {
    pyResult = await runPythonModule<{ bars?: RawBar[] }>({
      module: "src.engine.data_loader",
      args: ["--symbol", symbol, "--timeframe", timeframe, "--start", range.start, "--end", range.end],
      timeoutMs: 30_000,
      componentName: "bars-fetch",
      lane: "backtest",
    });
  } catch (err) {
    logger.error(
      { symbol, timeframe, range, err: String(err) },
      "GET /api/bars/:symbol — Python bars fetch failed",
    );
    res.status(502).json({ error: "bars_fetch_failed", detail: String(err) });
    return;
  }

  const raw = pyResult.bars ?? [];

  if (isDaily) {
    res.json({ symbol, timeframe, bars: shapeDailyBars(raw, limit) });
    return;
  }

  // date is guaranteed present for all intraday branches (checked above).
  const sessionDate = date as string;

  if (overnight) {
    res.json({ symbol, timeframe, bars: filterOvernightWindow(raw, sessionDate) });
    return;
  }

  if (start_hour_et != null && end_hour_et != null) {
    res.json({ symbol, timeframe, bars: filterHourWindow(raw, sessionDate, start_hour_et, end_hour_et) });
    return;
  }

  if (limit === 1) {
    const bar = firstRthBar(raw, sessionDate);
    res.json({ symbol, timeframe, bars: bar ? [bar] : [] });
    return;
  }

  // Generic intraday fallback: all bars on sessionDate, ascending, capped at limit.
  const shaped = shapeIntraBars(raw)
    .filter((b) => etDateOf(b.ts) === sessionDate)
    .slice(0, limit);
  res.json({ symbol, timeframe, bars: shaped });
});
