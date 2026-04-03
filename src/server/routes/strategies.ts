import { Router } from "express";
import { eq, sql, desc, and, ilike } from "drizzle-orm";
import { db } from "../db/index.js";
import { strategies, backtests, backtestTrades, monteCarloRuns, stressTestRuns, backtestMatrix, systemJournal, complianceReviews, paperSessions, skipDecisions, strategyGraveyard, auditLog, strategyExports } from "../db/schema.js";
import { inArray } from "drizzle-orm";
import { logger } from "../index.js";
import { broadcastSSE } from "./sse.js";
import { LifecycleService } from "../services/lifecycle-service.js";

export const strategyRoutes = Router();
const lifecycleService = new LifecycleService();

function asNumericOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMcSummary(latestMc: typeof monteCarloRuns.$inferSelect | undefined) {
  if (!latestMc) return null;

  const riskMetrics =
    latestMc.riskMetrics && typeof latestMc.riskMetrics === "object"
      ? (latestMc.riskMetrics as Record<string, unknown>)
      : null;

  const medianReturn =
    asNumericOrNull(riskMetrics?.medianReturn) ??
    asNumericOrNull(riskMetrics?.p50Return) ??
    asNumericOrNull(riskMetrics?.returnP50);

  const probabilityOfRuin = asNumericOrNull(latestMc.probabilityOfRuin);
  const survivalRate =
    probabilityOfRuin == null ? null : Math.max(0, Math.min(1, 1 - probabilityOfRuin));

  return {
    survivalRate,
    medianReturn,
    worstDrawdown: asNumericOrNull(latestMc.maxDrawdownP95),
  };
}

function getPaperWinRate(paperSession: typeof paperSessions.$inferSelect | undefined) {
  if (!paperSession?.metricsSnapshot || typeof paperSession.metricsSnapshot !== "object") {
    return null;
  }

  return asNumericOrNull((paperSession.metricsSnapshot as Record<string, unknown>).winRate);
}

// List all strategies (with optional pagination + filters)
strategyRoutes.get("/", async (req, res) => {
  const { limit, offset, name, lifecycleState, symbol } = req.query;

  // Build filter conditions
  const conditions = [];
  if (name) conditions.push(ilike(strategies.name, `%${String(name)}%`));
  if (lifecycleState) conditions.push(eq(strategies.lifecycleState, String(lifecycleState)));
  if (symbol) conditions.push(eq(strategies.symbol, String(symbol)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  if (limit) {
    // Paginated mode
    const countQuery = where
      ? db.select({ count: sql<number>`count(*)::int` }).from(strategies).where(where)
      : db.select({ count: sql<number>`count(*)::int` }).from(strategies);
    const [{ count: total }] = await countQuery;

    let query = db.select().from(strategies).where(where).orderBy(desc(strategies.createdAt));
    query = query.limit(Number(limit)) as typeof query;
    if (offset) {
      query = query.offset(Number(offset)) as typeof query;
    }
    const rows = await query;
    res.json({ data: rows, total });
  } else {
    // Non-paginated (backward compatible)
    const rows = await db.select().from(strategies).where(where).orderBy(strategies.createdAt);
    res.json(rows);
  }
});

// Pipeline health
strategyRoutes.get("/pipeline", async (_req, res) => {
  const health = await lifecycleService.getPipelineHealth();
  res.json(health);
});

// GET /api/strategies/library — browse DEPLOY_READY strategies (your deployment shelf)
// MUST be before /:id to avoid Express matching "library" as a UUID
strategyRoutes.get("/library", async (_req, res) => {
  try {
    const readyStrategies = await db
      .select()
      .from(strategies)
      .where(eq(strategies.lifecycleState, "DEPLOY_READY"))
      .orderBy(desc(strategies.updatedAt));

    const library = await Promise.all(
      readyStrategies.map(async (s) => {
        const [latestBt] = await db
          .select()
          .from(backtests)
          .where(and(eq(backtests.strategyId, s.id), eq(backtests.status, "completed")))
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        const [latestMc] = await db
          .select()
          .from(monteCarloRuns)
          .where(latestBt ? eq(monteCarloRuns.backtestId, latestBt.id) : sql`false`)
          .orderBy(desc(monteCarloRuns.createdAt))
          .limit(1);

        const [paperSession] = await db
          .select()
          .from(paperSessions)
          .where(eq(paperSessions.strategyId, s.id))
          .orderBy(desc(paperSessions.createdAt))
          .limit(1);

        return {
          id: s.id,
          name: s.name,
          symbol: s.symbol,
          timeframe: s.timeframe,
          tags: s.tags,
          rollingSharpe30d: s.rollingSharpe30d,
          lifecycleChangedAt: s.lifecycleChangedAt,
          backtest: latestBt
            ? {
                tier: latestBt.tier,
                sharpe: latestBt.sharpeRatio,
                profitFactor: latestBt.profitFactor,
                winRate: latestBt.winRate,
                maxDrawdown: latestBt.maxDrawdown,
                avgDailyPnl: latestBt.avgDailyPnl,
                totalTrades: latestBt.totalTrades,
              }
            : null,
          monteCarlo: latestMc
            ? getMcSummary(latestMc)
            : null,
          paperTrading: paperSession
            ? {
                startedAt: paperSession.createdAt,
                currentEquity: paperSession.currentEquity,
                peakEquity: paperSession.peakEquity,
                totalTrades: paperSession.totalTrades,
                winRate: getPaperWinRate(paperSession),
              }
            : null,
        };
      }),
    );

    res.json({ total: library.length, strategies: library });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single strategy
strategyRoutes.get("/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(strategies)
    .where(eq(strategies.id, req.params.id));
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.json(row);
});

// Create strategy
strategyRoutes.post("/", async (req, res) => {
  const { name, description, symbol, timeframe, config, tags } = req.body;
  const [row] = await db
    .insert(strategies)
    .values({ name, description, symbol, timeframe, config, tags })
    .returning();
  broadcastSSE("strategy:created", { strategyId: row.id, name: row.name });
  res.status(201).json(row);
});

// Update strategy
strategyRoutes.patch("/:id", async (req, res) => {
  const { name, description, symbol, timeframe, config, lifecycleState, tags } = req.body;
  const [row] = await db
    .update(strategies)
    .set({
      ...(name && { name }),
      ...(description && { description }),
      ...(symbol && { symbol }),
      ...(timeframe && { timeframe }),
      ...(config && { config }),
      ...(lifecycleState && { lifecycleState }),
      ...(tags && { tags }),
      updatedAt: new Date(),
    })
    .where(eq(strategies.id, req.params.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }

  // Mark existing completed exports as stale when strategy config changes
  if (config) {
    try {
      await db.update(strategyExports)
        .set({ status: "stale" })
        .where(and(
          eq(strategyExports.strategyId, req.params.id),
          eq(strategyExports.status, "completed")
        ));
    } catch (staleErr) {
      logger.warn({ strategyId: req.params.id, err: staleErr }, "Failed to mark exports as stale");
    }
  }

  res.json(row);
});

// Transition lifecycle state
strategyRoutes.patch("/:id/lifecycle", async (req, res) => {
  const { fromState, toState } = req.body;
  if (!fromState || !toState) {
    res.status(400).json({ error: "fromState and toState required" });
    return;
  }

  if (fromState === "DEPLOY_READY" && toState === "DEPLOYED") {
    res.status(400).json({
      error: "Use /api/strategies/:id/deploy for manual TradingView deployment approval.",
    });
    return;
  }

  const result = await lifecycleService.promoteStrategy(req.params.id, fromState, toState);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({ success: true, id: req.params.id, newState: toState });
});

// POST /api/strategies/:id/deploy — Human approves deployment (DEPLOY_READY → DEPLOYED)
strategyRoutes.post("/:id/deploy", async (req, res) => {
  const strategyId = req.params.id;

  // Capture pre-deploy metrics snapshot for the audit record before the transition
  let metricsSnapshot: Record<string, unknown> = {};
  try {
    const [strat] = await db.select().from(strategies).where(eq(strategies.id, strategyId));
    const [latestBt] = await db
      .select()
      .from(backtests)
      .where(and(eq(backtests.strategyId, strategyId), eq(backtests.status, "completed")))
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    const [latestMc] = latestBt
      ? await db
          .select()
          .from(monteCarloRuns)
          .where(eq(monteCarloRuns.backtestId, latestBt.id))
          .orderBy(desc(monteCarloRuns.createdAt))
          .limit(1)
      : [undefined];

    metricsSnapshot = {
      strategyName: strat?.name ?? null,
      symbol: strat?.symbol ?? null,
      timeframe: strat?.timeframe ?? null,
      rollingSharpe30d: strat?.rollingSharpe30d ?? null,
      forgeScore: strat?.forgeScore ?? null,
      backtest: latestBt
        ? {
            id: latestBt.id,
            tier: latestBt.tier,
            sharpe: latestBt.sharpeRatio,
            profitFactor: latestBt.profitFactor,
            winRate: latestBt.winRate,
            maxDrawdown: latestBt.maxDrawdown,
            avgDailyPnl: latestBt.avgDailyPnl,
            totalTrades: latestBt.totalTrades,
          }
        : null,
      monteCarlo: latestMc
        ? {
            id: latestMc.id,
            ...getMcSummary(latestMc),
            sharpeP5: latestMc.sharpeP5,
            sharpeP50: latestMc.sharpeP50,
            sharpeP95: latestMc.sharpeP95,
          }
        : null,
    };
  } catch (snapshotErr) {
    // Non-fatal — deploy proceeds even if snapshot fails; log so we can investigate
    logger.warn({ strategyId, err: snapshotErr }, "deploy: metrics snapshot failed (non-blocking)");
  }

  const result = await lifecycleService.promoteStrategy(
    strategyId,
    "DEPLOY_READY",
    "DEPLOYED",
    {
      actor: "human_release",
      reason: "manual_tradingview_deployment_approval",
    },
  );
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  // Dedicated audit record for human deploy approval — separate from the lifecycle entry
  // so it is always queryable by action="strategy.deploy_approved"
  try {
    await db.insert(auditLog).values({
      action: "strategy.deploy_approved",
      entityType: "strategy",
      entityId: strategyId,
      input: {
        approvedBy: "swayz032", // single-user system — identity is fixed
        approvedAt: new Date().toISOString(),
        fromState: "DEPLOY_READY",
        toState: "DEPLOYED",
      },
      result: metricsSnapshot,
      status: "success",
      decisionAuthority: "human",
    });
  } catch (auditErr) {
    // Audit failure must not roll back an approved deploy — log it for investigation
    logger.error({ strategyId, err: auditErr }, "deploy: audit_log insert failed (deploy committed)");
  }

  // Fire-and-forget Pine export for the newly deployed strategy.
  // Uses the firm key from strategy config if available, otherwise defaults to topstep_50k.
  import("../services/pine-export-service.js").then(({ compilePineExport }) => {
    const firmKey = (metricsSnapshot as any)?.config?.firmKey ?? "topstep_50k";
    compilePineExport(strategyId, firmKey, "pine_indicator").catch((err: unknown) =>
      logger.error({ err, strategyId }, "Post-deploy Pine export failed"),
    );
  }).catch(() => {});

  // Broadcast deploy SSE so dashboard and any listeners know immediately
  broadcastSSE("strategy:deployed", {
    strategyId,
    name: metricsSnapshot.strategyName ?? null,
  });

  res.json({ success: true, id: strategyId, newState: "DEPLOYED", message: "Strategy deployed — you approved this." });
});

// POST /api/strategies/:id/reject-deploy — Send strategy back to paper (DEPLOY_READY → PAPER)
strategyRoutes.post("/:id/reject-deploy", async (req, res) => {
  const result = await lifecycleService.promoteStrategy(req.params.id, "DEPLOY_READY", "PAPER", {
    actor: "human_release",
    reason: "manual_deploy_rejection",
  });
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true, id: req.params.id, newState: "PAPER", message: "Strategy sent back to paper trading." });
});

// POST /api/strategies/lifecycle/check — trigger auto-promotion and demotion checks
strategyRoutes.post("/lifecycle/check", async (_req, res) => {
  try {
    const [promotions, demotions] = await Promise.all([
      lifecycleService.checkAutoPromotions(),
      lifecycleService.checkAutoDemotions(),
    ]);
    res.json({ promotions, demotions });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete strategy (cascades to all dependent records)
strategyRoutes.delete("/:id", async (req, res) => {
  const strategyId = req.params.id;

  // Find backtest IDs for this strategy
  const btRows = await db.select({ id: backtests.id }).from(backtests).where(eq(backtests.strategyId, strategyId));
  const btIds = btRows.map((r) => r.id);

  // Delete backtest-dependent records
  if (btIds.length > 0) {
    await db.delete(backtestTrades).where(inArray(backtestTrades.backtestId, btIds));
    await db.delete(monteCarloRuns).where(inArray(monteCarloRuns.backtestId, btIds));
    await db.delete(stressTestRuns).where(inArray(stressTestRuns.backtestId, btIds));
  }

  // Delete strategy-dependent records
  await db.delete(backtests).where(eq(backtests.strategyId, strategyId));
  await db.delete(backtestMatrix).where(eq(backtestMatrix.strategyId, strategyId));
  await db.delete(systemJournal).where(eq(systemJournal.strategyId, strategyId));
  await db.delete(complianceReviews).where(eq(complianceReviews.strategyId, strategyId));
  await db.delete(paperSessions).where(eq(paperSessions.strategyId, strategyId));
  await db.delete(skipDecisions).where(eq(skipDecisions.strategyId, strategyId));
  await db.delete(strategyGraveyard).where(eq(strategyGraveyard.strategyId, strategyId));

  // Delete the strategy itself
  const [row] = await db.delete(strategies).where(eq(strategies.id, strategyId)).returning();
  if (!row) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }
  res.json({ deleted: true });
});
