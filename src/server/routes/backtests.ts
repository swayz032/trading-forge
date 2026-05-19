import { Router } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "crypto";
import { db } from "../db/index.js";
import { backtests, backtestTrades, backtestMatrix, monteCarloRuns, stressTestRuns, strategies, auditLog } from "../db/schema.js";
import { runBacktest } from "../services/backtest-service.js";
import { runMatrix, getMatrixStatus } from "../services/matrix-backtest-service.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";

export const backtestRoutes = Router();

/**
 * G7.1 contract — POST /api/backtests response shape (202 Accepted, async).
 * The backtest is fire-and-forget; the consumer polls `GET /api/backtests/:id`
 * for completion status. Frontend imports this type from here, not from a
 * hand-rolled DB shape. See `src/server/lib/api-contracts.ts`.
 */
export interface BacktestSubmitResponse {
  message: string;
  backtestId: string;
}

// ─── Validation Schemas ──────────────────────────────────────────

const indicatorSchema = z.object({
  type: z.enum(["sma", "ema", "rsi", "macd", "vwap", "bbands", "atr", "adx", "adr"]),
  period: z.number().int().positive(),
  fast: z.number().int().optional(),
  slow: z.number().int().optional(),
  signal: z.number().int().optional(),
  std_dev: z.number().optional(),
});

const strategyConfigSchema = z.object({
  name: z.string().min(1),
  symbol: z.enum(["MES", "MNQ", "MCL"]),
  timeframe: z.string().min(1),
  indicators: z.array(indicatorSchema).max(5).default([]),
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
  strategy: strategyConfigSchema.optional(), // Optional — if omitted, loaded from DB
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  slippage_ticks: z.number().positive().optional().default(1.0),
  commission_per_side: z.number().nonnegative().optional().default(0.62),
  mode: z.enum(["single", "walkforward"]).optional().default("walkforward"),
  walk_forward_splits: z.number().int().min(2).max(10).optional().default(5),
  optimizer: z.enum(["optuna", "sqa"]).optional().default("optuna"),
  refinement_stage: z.number().int().min(1).max(3).optional(),
  refinement_iteration: z.number().int().min(0).max(8).optional(),
});

// ══════════════════════════════════════════════════════════════════
// IMPORTANT: Named routes (/compare, /matrix, /matrix/:id) MUST be
// registered BEFORE the parameterized /:id catch-all, otherwise
// Express matches "matrix" and "compare" as :id values.
// ══════════════════════════════════════════════════════════════════

// ─── POST /api/backtests — Run a new backtest (async) ────────────
// G3.3: idempotencyMiddleware deduplicates identical POSTs by Idempotency-Key
// header for 24h, preventing double-spawn of expensive Python backtests.
backtestRoutes.post("/", idempotencyMiddleware, async (req, res) => {
  const parsed = backtestRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { strategyId, strategy: providedStrategy, ...config } = parsed.data;

  // If no strategy config provided, load it from the DB
  let resolvedStrategy = providedStrategy;
  let strategyClass: string | undefined;

  try {
    const [strat] = await db.select().from(strategies).where(eq(strategies.id, strategyId));
    if (!strat && !providedStrategy) {
      res.status(404).json({ error: "Strategy not found and no config provided" });
      return;
    }
    const stratConfig = strat?.config as Record<string, unknown> | undefined;
    if (stratConfig?.strategy_class) {
      strategyClass = String(stratConfig.strategy_class);
    }
    // If no strategy config was sent in the request, use the one from DB
    if (!resolvedStrategy && stratConfig) {
      // Merge DB fields with config — the DB strategy row has symbol/timeframe at top level
      resolvedStrategy = {
        name: strat!.name,
        symbol: strat!.symbol as any,
        timeframe: strat!.timeframe,
        indicators: (stratConfig.indicators as any[]) ?? [],
        entry_long: String(stratConfig.entry_long ?? ""),
        entry_short: String(stratConfig.entry_short ?? ""),
        exit: String(stratConfig.exit ?? ""),
        stop_loss: (stratConfig.stop_loss as any) ?? { type: "atr", multiplier: 2.0 },
        position_size: (stratConfig.position_size as any) ?? { type: "fixed", fixed_contracts: 1 },
      };
    }
  } catch {
    if (!providedStrategy) {
      res.status(500).json({ error: "Failed to load strategy from DB" });
      return;
    }
    // Non-fatal if we already have a provided strategy
  }

  if (!resolvedStrategy) {
    res.status(400).json({ error: "No strategy config provided and could not load from DB" });
    return;
  }

  // Reassemble config with the resolved strategy
  const fullConfig = { ...config, strategy: resolvedStrategy };

  // Generate the backtest ID upfront to avoid race condition
  const backtestId = randomUUID();

  // Fire and forget — return 202 immediately.
  // req.id and req.log are set by correlationMiddleware (typed in src/server/types/express.d.ts).
  const correlationId = req.id;
  runBacktest(strategyId, fullConfig, strategyClass, backtestId, correlationId).then((_result) => {
    // Logged internally by runBacktest
  }).catch((err) => {
    req.log.error({ err, strategyId, backtestId, correlationId }, "Fire-and-forget backtest failed");
  });

  const response: BacktestSubmitResponse = {
    message: "Backtest started",
    backtestId,
  };
  res.status(202).json(response);
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
      startDate: backtests.startDate,
      endDate: backtests.endDate,
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

// ─── POST /api/backtests/kill-signal — Evaluate refinement kill signal ──
backtestRoutes.post("/kill-signal", async (req, res) => {
  const schema = z.object({
    attempts: z.array(z.object({
      sharpe_ratio: z.number(),
      max_drawdown: z.number(),
      win_rate: z.number(),
      profit_factor: z.number(),
      avg_daily_pnl: z.number(),
    })).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { attempts } = parsed.data;
  const TIER3_MINS = { sharpe_ratio: 1.5, profit_factor: 1.75, avg_daily_pnl: 250, win_rate: 0.60 };

  // Catastrophic risk: immediate kill
  for (const a of attempts) {
    if (a.max_drawdown > 6000) {
      res.json({ kill_signal: "catastrophic_risk", stage: getStage(attempts.length), stage_prompt: getStagePrompt(getStage(attempts.length)) });
      return;
    }
  }

  const bestSharpe = Math.max(...attempts.map((a) => a.sharpe_ratio));
  const bestPf = Math.max(...attempts.map((a) => a.profit_factor));
  const bestWr = Math.max(...attempts.map((a) => a.win_rate));
  const bestPnl = Math.max(...attempts.map((a) => a.avg_daily_pnl));

  if (bestSharpe < 0.8) { res.json({ kill_signal: "no_edge", stage: getStage(attempts.length) }); return; }
  if (bestWr < 0.40) { res.json({ kill_signal: "wrong_direction", stage: getStage(attempts.length) }); return; }
  if (bestPf < 1.0) { res.json({ kill_signal: "unprofitable", stage: getStage(attempts.length) }); return; }

  if (attempts.length >= 2) {
    const prevSharpe = attempts[attempts.length - 2].sharpe_ratio;
    const currSharpe = attempts[attempts.length - 1].sharpe_ratio;
    if (Math.abs(currSharpe - prevSharpe) < 0.1 && currSharpe < TIER3_MINS.sharpe_ratio) {
      res.json({ kill_signal: "flat_improvement", stage: getStage(attempts.length) });
      return;
    }
  }

  if (attempts.length >= 3) {
    const pctSharpe = bestSharpe / TIER3_MINS.sharpe_ratio;
    const pctPf = bestPf / TIER3_MINS.profit_factor;
    const pctPnl = bestPnl / TIER3_MINS.avg_daily_pnl;
    if ((pctSharpe + pctPf + pctPnl) / 3 < 0.70) {
      res.json({ kill_signal: "below_tier3", stage: getStage(attempts.length) });
      return;
    }
  }

  const stage = getStage(attempts.length);
  res.json({ kill_signal: null, stage, stage_prompt: getStagePrompt(stage) });
});

function getStage(iterationCount: number): number {
  if (iterationCount <= 3) return 1;
  if (iterationCount <= 6) return 2;
  return 3;
}

function getStagePrompt(stage: number): string {
  const prompts: Record<number, string> = {
    1: "STAGE 1 — PARAMETER REFINEMENT: Same strategy logic, adjust parameters. Try different lookback periods, ATR multiples, or threshold values. Do NOT change the core entry/exit logic.",
    2: "STAGE 2 — LOGIC VARIANT: Same edge thesis, different execution. Try a different entry method (e.g., mean reversion instead of breakout) or different exit logic.",
    3: "STAGE 3 — CONCEPT PIVOT: Different edge entirely for this symbol/session. Abandon the previous approach. Try a completely different strategy concept.",
  };
  return prompts[stage] ?? prompts[1];
}

// ─── POST /api/backtests/matrix — Cross-matrix testing ────────────
backtestRoutes.post("/matrix", async (req, res) => {
  const schema = z.object({
    strategyId: z.string().uuid(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { strategyId } = parsed.data;

  // Fire and forget — tiered execution takes ~11 min
  runMatrix(strategyId).catch((err) => {
    req.log.error({ err, strategyId }, "Fire-and-forget matrix backtest failed");
  });

  // Get the matrix ID
  const [row] = await db
    .select({ id: backtestMatrix.id })
    .from(backtestMatrix)
    .where(eq(backtestMatrix.strategyId, strategyId))
    .orderBy(desc(backtestMatrix.createdAt))
    .limit(1);

  res.status(202).json({
    message: "Matrix backtest started — 3 symbols × 7 timeframes, tiered execution",
    matrixId: row?.id,
  });
});

// ─── GET /api/backtests/matrix/:id — Matrix status ────────────────
backtestRoutes.get("/matrix/:id", async (req, res) => {
  const id = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: "Invalid matrix ID format (expected UUID)" });
    return;
  }
  const row = await getMatrixStatus(id);
  if (!row) {
    res.status(404).json({ error: "Matrix not found" });
    return;
  }
  res.json(row);
});

// ─── GET /api/backtests/matrix — Latest matrix by strategyId ───────
backtestRoutes.get("/matrix", async (req, res) => {
  const { strategyId } = req.query;
  if (!strategyId || typeof strategyId !== "string") {
    res.status(400).json({ error: "strategyId query parameter required" });
    return;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(strategyId)) {
    res.status(400).json({ error: "Invalid strategyId format (expected UUID)" });
    return;
  }

  const [row] = await db
    .select()
    .from(backtestMatrix)
    .where(eq(backtestMatrix.strategyId, strategyId))
    .orderBy(desc(backtestMatrix.createdAt))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "No matrix found for this strategy" });
    return;
  }

  res.json(row);
});

// ─── GET /api/backtests/:id — Full backtest detail ───────────────
// NOTE: This catch-all MUST be after all named routes (/compare, /matrix)
backtestRoutes.get("/:id", async (req, res) => {
  const id = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: "Invalid backtest ID format (expected UUID)" });
    return;
  }
  const [row] = await db
    .select()
    .from(backtests)
    .where(eq(backtests.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }

  // Attach crisis/stress test results if they exist
  const [stressRow] = await db
    .select()
    .from(stressTestRuns)
    .where(eq(stressTestRuns.backtestId, req.params.id))
    .limit(1);

  const result: Record<string, unknown> = { ...row };
  if (stressRow) {
    result.crisisResults = stressRow.scenarios;
  }

  res.json(result);
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

  res.json({ equityCurve: row.equityCurve });
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

// ─── DELETE /api/backtests/:id — Cascade delete ──────────────────
backtestRoutes.delete("/:id", async (req, res) => {
  const backtestId = req.params.id;

  // Delete related records first (FK constraints)
  await db.delete(monteCarloRuns).where(eq(monteCarloRuns.backtestId, backtestId));
  await db.delete(stressTestRuns).where(eq(stressTestRuns.backtestId, backtestId));
  await db.delete(backtestTrades).where(eq(backtestTrades.backtestId, backtestId));

  const [deleted] = await db
    .delete(backtests)
    .where(eq(backtests.id, backtestId))
    .returning({ id: backtests.id });

  if (!deleted) {
    res.status(404).json({ error: "Backtest not found" });
    return;
  }

  // Audit log — include correlationId to link this human action to the originating HTTP request
  await db.insert(auditLog).values({
    action: "backtest.delete",
    entityType: "backtest",
    entityId: backtestId,
    input: {},
    result: {},
    status: "success",
    decisionAuthority: "human",
    correlationId: req.id ?? null,
  });

  res.json({ deleted: true, id: backtestId });
});
