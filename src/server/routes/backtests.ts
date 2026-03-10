import { Router } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { backtests, backtestTrades, auditLog } from "../db/schema.js";
import { runBacktest } from "../services/backtest-service.js";

export const backtestRoutes = Router();

// ─── Validation Schemas ──────────────────────────────────────────

const indicatorSchema = z.object({
  type: z.enum(["sma", "ema", "rsi", "macd", "vwap", "bbands", "atr"]),
  period: z.number().int().positive(),
  fast: z.number().int().optional(),
  slow: z.number().int().optional(),
  signal: z.number().int().optional(),
  std_dev: z.number().optional(),
});

const strategyConfigSchema = z.object({
  name: z.string().min(1),
  symbol: z.enum(["ES", "NQ", "CL", "YM", "RTY", "GC", "MES", "MNQ"]),
  timeframe: z.string().min(1),
  indicators: z.array(indicatorSchema).min(1).max(5),
  entry_long: z.string().min(1),
  entry_short: z.string().min(1),
  exit: z.string().min(1),
  stop_loss: z.object({
    type: z.enum(["atr", "fixed", "trailing_atr"]),
    multiplier: z.number().positive().default(2.0),
  }),
  position_size: z.object({
    type: z.enum(["dynamic_atr", "fixed"]),
    target_risk_dollars: z.number().positive().optional().default(500),
    fixed_contracts: z.number().int().positive().optional().default(1),
  }),
});

const backtestRequestSchema = z.object({
  strategyId: z.string().uuid(),
  strategy: strategyConfigSchema,
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slippage_ticks: z.number().positive().optional().default(1.0),
  commission_per_side: z.number().nonnegative().optional().default(4.50),
  mode: z.enum(["single", "walkforward"]).optional().default("single"),
  walk_forward_splits: z.number().int().min(2).max(10).optional().default(5),
});

// ─── POST /api/backtests — Run a new backtest (async) ────────────
backtestRoutes.post("/", async (req, res) => {
  const parsed = backtestRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { strategyId, ...config } = parsed.data;

  // Fire and forget — return 202 immediately
  const backtestPromise = runBacktest(strategyId, config);

  // Return the backtest ID immediately
  backtestPromise.then((result) => {
    // Logged internally
  }).catch(() => {
    // Error already persisted to DB
  });

  // Quick insert to get the ID
  const [row] = await db
    .select({ id: backtests.id })
    .from(backtests)
    .where(eq(backtests.strategyId, strategyId))
    .orderBy(desc(backtests.createdAt))
    .limit(1);

  res.status(202).json({
    message: "Backtest started",
    backtestId: row?.id,
  });
});

// ─── GET /api/backtests — List backtests ─────────────────────────
backtestRoutes.get("/", async (req, res) => {
  const { strategyId, status, tier, limit = "50", offset = "0" } = req.query;

  const conditions = [];
  if (strategyId) conditions.push(eq(backtests.strategyId, String(strategyId)));
  if (status) conditions.push(eq(backtests.status, String(status)));
  if (tier) conditions.push(eq(backtests.tier, String(tier)));

  const rows = await db
    .select({
      id: backtests.id,
      strategyId: backtests.strategyId,
      symbol: backtests.symbol,
      timeframe: backtests.timeframe,
      status: backtests.status,
      tier: backtests.tier,
      totalReturn: backtests.totalReturn,
      sharpeRatio: backtests.sharpeRatio,
      maxDrawdown: backtests.maxDrawdown,
      winRate: backtests.winRate,
      profitFactor: backtests.profitFactor,
      totalTrades: backtests.totalTrades,
      avgDailyPnl: backtests.avgDailyPnl,
      forgeScore: backtests.forgeScore,
      executionTimeMs: backtests.executionTimeMs,
      createdAt: backtests.createdAt,
    })
    .from(backtests)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(backtests.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));

  res.json(rows);
});

// ─── GET /api/backtests/:id — Full backtest detail ───────────────
backtestRoutes.get("/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(backtests)
    .where(eq(backtests.id, req.params.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }

  res.json(row);
});

// ─── GET /api/backtests/:id/equity — Equity curve ────────────────
backtestRoutes.get("/:id/equity", async (req, res) => {
  const [row] = await db
    .select({ equityCurve: backtests.equityCurve })
    .from(backtests)
    .where(eq(backtests.id, req.params.id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }

  res.json({ equity_curve: row.equityCurve });
});

// ─── GET /api/backtests/:id/trades — Paginated trades ────────────
backtestRoutes.get("/:id/trades", async (req, res) => {
  const { limit = "100", offset = "0" } = req.query;

  const trades = await db
    .select()
    .from(backtestTrades)
    .where(eq(backtestTrades.backtestId, req.params.id))
    .limit(Number(limit))
    .offset(Number(offset));

  res.json(trades);
});

// ─── POST /api/backtests/compare — Side-by-side metrics ──────────
backtestRoutes.post("/compare", async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5) {
    res.status(400).json({ error: "Provide 1-5 backtest IDs" });
    return;
  }

  const rows = await db
    .select()
    .from(backtests)
    .where(inArray(backtests.id, ids));

  res.json(rows);
});

// ─── DELETE /api/backtests/:id — Cascade delete ──────────────────
backtestRoutes.delete("/:id", async (req, res) => {
  const backtestId = req.params.id;

  // Trades cascade automatically via FK
  const [deleted] = await db
    .delete(backtests)
    .where(eq(backtests.id, backtestId))
    .returning({ id: backtests.id });

  if (!deleted) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }

  // Audit log
  await db.insert(auditLog).values({
    action: "backtest.delete",
    entityType: "backtest",
    entityId: backtestId,
    input: {},
    result: {},
    status: "success",
  });

  res.json({ deleted: true, id: backtestId });
});
