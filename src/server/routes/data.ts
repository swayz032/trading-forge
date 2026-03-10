import { Router } from "express";
import { z } from "zod";
import { spawn } from "child_process";
import { resolve } from "path";
import {
  queryOhlcv,
  queryInfo,
  listAvailableSymbols,
} from "../../data/loaders/index.js";
import { logger } from "../index.js";

export const dataRoutes = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const ohlcvQuerySchema = z.object({
  timeframe: z.enum(["1min", "5min", "15min", "30min", "1hour", "4hour", "daily"]).default("daily"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adjusted: z
    .string()
    .transform((v) => v !== "false")
    .default("true"),
  limit: z
    .string()
    .transform((v) => parseInt(v, 10))
    .optional(),
});

const fetchSchema = z.object({
  symbol: z.string().min(1).max(10),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maxCost: z.number().optional().default(50),
});

// ─── GET /api/data/symbols ───────────────────────────────────────

dataRoutes.get("/symbols", async (_req, res) => {
  try {
    const symbols = await listAvailableSymbols();
    res.json({ symbols });
  } catch (err) {
    logger.error({ err }, "Failed to list symbols");
    res.json({ symbols: [], error: "Could not query S3 — data may not be loaded yet" });
  }
});

// ─── GET /api/data/:symbol/ohlcv ────────────────────────────────

dataRoutes.get("/:symbol/ohlcv", async (req, res) => {
  const parsed = ohlcvQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query params", details: parsed.error.issues });
    return;
  }

  const { timeframe, from, to, adjusted, limit } = parsed.data;

  try {
    const bars = await queryOhlcv({
      symbol: req.params.symbol,
      timeframe,
      from,
      to,
      adjusted: adjusted as boolean,
      limit,
    });

    res.json({
      symbol: req.params.symbol,
      timeframe,
      from,
      to,
      count: bars.length,
      bars,
    });
  } catch (err) {
    logger.error({ err, symbol: req.params.symbol }, "OHLCV query failed");
    res.status(500).json({ error: "Query failed — data may not be available for this symbol/range" });
  }
});

// ─── GET /api/data/:symbol/info ──────────────────────────────────

dataRoutes.get("/:symbol/info", async (req, res) => {
  try {
    const info = await queryInfo(req.params.symbol);
    res.json(info);
  } catch (err) {
    logger.error({ err, symbol: req.params.symbol }, "Info query failed");
    res.status(500).json({ error: "Could not get info for this symbol" });
  }
});

// ─── POST /api/data/fetch ────────────────────────────────────────

dataRoutes.post("/fetch", async (req, res) => {
  const parsed = fetchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const { symbol, start, end, maxCost } = parsed.data;

  // Return 202 immediately, run pipeline in background
  res.status(202).json({
    status: "accepted",
    message: `Pipeline started for ${symbol} from ${start} to ${end}`,
    symbol,
    start,
    end,
  });

  // Spawn pipeline in background
  const scriptPath = resolve(
    import.meta.dirname ?? ".",
    "../../data/scripts/run_pipeline.py"
  );
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  const proc = spawn(pythonCmd, [
    scriptPath,
    "--symbol", symbol,
    "--start", start,
    "--end", end,
    "--max-cost", String(maxCost),
  ], {
    env: process.env,
    stdio: "pipe",
  });

  let stdout = "";
  proc.stdout.on("data", (data) => (stdout += data.toString()));
  proc.stderr.on("data", (data) => logger.info({ step: "pipeline" }, data.toString().trim()));

  proc.on("close", (code) => {
    if (code === 0) {
      logger.info({ symbol, result: stdout.slice(0, 500) }, "Pipeline completed");
    } else {
      logger.error({ symbol, code, stdout: stdout.slice(0, 500) }, "Pipeline failed");
    }
  });
});
