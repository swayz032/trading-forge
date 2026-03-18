import { Router } from "express";
import { db } from "../db/index.js";
import { paperSessions, paperPositions, paperTrades, paperSignalLog, strategies, backtests, monteCarloRuns } from "../db/schema.js";
import { eq, desc, and } from "drizzle-orm";
import { logger } from "../index.js";
import { openPosition, closePosition, updatePositionPrices, getExecutionQuality } from "../services/paper-execution-service.js";
import { detectDrift } from "../services/drift-detection-service.js";
import { calculateCorrelation, portfolioCorrelationMatrix } from "../services/correlation-service.js";
import { startStream, stopStream, stopAllStreams, getActiveStreams, isStreaming, getBarBuffer } from "../services/paper-trading-stream.js";

const router = Router();

// POST /api/paper/start — start paper trading session + live stream
router.post("/start", async (req, res) => {
  try {
    const { strategyId, startingCapital = "100000", config } = req.body;
    const [session] = await db
      .insert(paperSessions)
      .values({ strategyId, startingCapital, currentEquity: startingCapital, config })
      .returning();

    // Look up strategy symbol(s) and start the Massive WS stream
    try {
      const [strat] = await db.select().from(strategies).where(eq(strategies.id, strategyId));
      const symbols: string[] = [];
      if (strat?.symbol) symbols.push(strat.symbol);
      // Also check config for additional symbols
      const stratConfig = strat?.config as Record<string, unknown> | undefined;
      if (stratConfig?.symbol && !symbols.includes(String(stratConfig.symbol))) {
        symbols.push(String(stratConfig.symbol));
      }
      if (symbols.length > 0) {
        startStream(session.id, symbols);
        logger.info({ sessionId: session.id, symbols }, "Paper stream started for session");
      } else {
        logger.warn({ sessionId: session.id, strategyId }, "No symbols found — stream not started");
      }
    } catch (streamErr) {
      // Non-fatal: session created even if stream fails (e.g. no MASSIVE_API_KEY)
      logger.error(streamErr, "Failed to start paper stream — session created without live data");
    }

    logger.info({ sessionId: session.id }, "Paper trading session started");
    res.status(201).json(session);
  } catch (err: any) {
    logger.error(err, "Failed to start paper session");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/stop — stop session + tear down stream
router.post("/stop", async (req, res) => {
  try {
    const { sessionId } = req.body;

    // Stop the live stream first
    if (isStreaming(sessionId)) {
      stopStream(sessionId);
      logger.info({ sessionId }, "Paper stream stopped");
    }

    const [session] = await db
      .update(paperSessions)
      .set({ status: "stopped", stoppedAt: new Date() })
      .where(eq(paperSessions.id, sessionId))
      .returning();
    if (!session) return res.status(404).json({ error: "Session not found" });
    logger.info({ sessionId }, "Paper trading session stopped");
    res.json(session);
  } catch (err: any) {
    logger.error(err, "Failed to stop paper session");
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/sessions — list sessions (optional ?status=active|stopped)
router.get("/sessions", async (req, res) => {
  try {
    const statusFilter = req.query.status ? String(req.query.status) : undefined;
    const conditions = statusFilter
      ? eq(paperSessions.status, statusFilter)
      : undefined;
    const sessions = await db
      .select()
      .from(paperSessions)
      .where(conditions)
      .orderBy(desc(paperSessions.startedAt));
    res.json(sessions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/sessions/:id — session detail
router.get("/sessions/:id", async (req, res) => {
  try {
    const [session] = await db
      .select()
      .from(paperSessions)
      .where(eq(paperSessions.id, req.params.id));
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/positions — open positions
router.get("/positions", async (_req, res) => {
  try {
    const positions = await db
      .select()
      .from(paperPositions)
      .orderBy(desc(paperPositions.entryTime));
    res.json(positions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/trades — trade history
router.get("/trades", async (_req, res) => {
  try {
    const trades = await db
      .select()
      .from(paperTrades)
      .orderBy(desc(paperTrades.exitTime));
    res.json(trades);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/execute/open — open a position with realistic fills
router.post("/execute/open", async (req, res) => {
  try {
    const { sessionId, symbol, side, signalPrice, contracts = 1 } = req.body;
    if (!sessionId || !symbol || !side || !signalPrice) {
      return res.status(400).json({ error: "sessionId, symbol, side, signalPrice required" });
    }
    const result = await openPosition(sessionId, { symbol, side, signalPrice, contracts });
    res.status(201).json(result);
  } catch (err: any) {
    logger.error(err, "Failed to open paper position");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/execute/close — close a position with realistic fills
router.post("/execute/close", async (req, res) => {
  try {
    const { positionId, exitSignalPrice } = req.body;
    if (!positionId || !exitSignalPrice) {
      return res.status(400).json({ error: "positionId, exitSignalPrice required" });
    }
    const result = await closePosition(positionId, exitSignalPrice);
    res.json(result);
  } catch (err: any) {
    logger.error(err, "Failed to close paper position");
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/prices — update live prices for open positions
router.post("/prices", async (req, res) => {
  try {
    const { sessionId, prices } = req.body;
    if (!sessionId || !prices) {
      return res.status(400).json({ error: "sessionId, prices required" });
    }
    const result = await updatePositionPrices(sessionId, prices);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/execution-quality/:sessionId — execution quality stats
router.get("/execution-quality/:sessionId", async (req, res) => {
  try {
    const result = await getExecutionQuality(req.params.sessionId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/drift/:sessionId — drift detection for a session
router.get("/drift/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { strategyId } = req.query;
    if (!strategyId) {
      return res.status(400).json({ error: "strategyId query param required" });
    }
    const report = await detectDrift(String(strategyId), sessionId);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/correlation — correlation between two sessions
router.post("/correlation", async (req, res) => {
  try {
    const { sessionId1, sessionId2 } = req.body;
    if (!sessionId1 || !sessionId2) {
      return res.status(400).json({ error: "sessionId1, sessionId2 required" });
    }
    const result = await calculateCorrelation(sessionId1, sessionId2);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/correlation/matrix — portfolio correlation matrix
router.post("/correlation/matrix", async (req, res) => {
  try {
    const { sessionIds } = req.body;
    if (!Array.isArray(sessionIds) || sessionIds.length < 2) {
      return res.status(400).json({ error: "sessionIds must be array with 2+ IDs" });
    }
    const results = await portfolioCorrelationMatrix(sessionIds);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/signals/:sessionId — signal log for a session
router.get("/signals/:sessionId", async (req, res) => {
  try {
    const { limit = "100", offset = "0" } = req.query;
    const signals = await db
      .select()
      .from(paperSignalLog)
      .where(eq(paperSignalLog.sessionId, req.params.sessionId))
      .orderBy(desc(paperSignalLog.createdAt))
      .limit(Number(limit))
      .offset(Number(offset));
    res.json(signals);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/signals/:sessionId/stats — signal stats summary
router.get("/signals/:sessionId/stats", async (req, res) => {
  try {
    const signals = await db
      .select()
      .from(paperSignalLog)
      .where(eq(paperSignalLog.sessionId, req.params.sessionId));
    const total = signals.length;
    const taken = signals.filter(s => s.action === "taken").length;
    const skipped = signals.filter(s => s.action === "skipped").length;
    const rejected = signals.filter(s => s.action === "rejected").length;
    res.json({ total, taken, skipped, rejected });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/streams — active stream status
router.get("/streams", async (_req, res) => {
  try {
    const streams = getActiveStreams();
    const result: Record<string, { symbols: string[]; connected: boolean }> = {};
    for (const [sessionId, info] of streams) {
      result[sessionId] = info;
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/paper/streams/stop-all — emergency stop all streams
router.post("/streams/stop-all", async (_req, res) => {
  try {
    stopAllStreams();
    res.json({ status: "ok", message: "All streams stopped" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/bars/:symbol — rolling bar buffer for live chart
router.get("/bars/:symbol", async (req, res) => {
  try {
    const bars = getBarBuffer(req.params.symbol);
    // Transform to LightweightCharts format
    const chartData = bars.map((b) => ({
      time: Math.floor(new Date(b.timestamp).getTime() / 1000),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
    res.json(chartData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/paper/mc-compare/:sessionId — compare paper session P&L against MC distribution
router.get("/mc-compare/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Load the paper session
    const [session] = await db
      .select()
      .from(paperSessions)
      .where(eq(paperSessions.id, sessionId));
    if (!session) return res.status(404).json({ error: "Session not found" });

    const strategyId = session.strategyId;
    if (!strategyId) return res.status(400).json({ error: "Session has no linked strategy" });

    // Sum up paper trades P&L for this session
    const trades = await db
      .select({ pnl: paperTrades.pnl })
      .from(paperTrades)
      .where(eq(paperTrades.sessionId, sessionId));
    const paperPnl = trades.reduce((sum, t) => sum + parseFloat(t.pnl), 0);

    // Get latest completed backtest for this strategy
    const [latestBacktest] = await db
      .select()
      .from(backtests)
      .where(and(eq(backtests.strategyId, strategyId), eq(backtests.status, "completed")))
      .orderBy(desc(backtests.createdAt))
      .limit(1);

    if (!latestBacktest) {
      return res.json({
        sessionId,
        strategyId,
        paperPnl,
        mc_percentile: null,
        driftFromMedian: null,
        warning: "No completed backtest found for this strategy",
      });
    }

    // Get MC run for that backtest
    const [mcRun] = await db
      .select()
      .from(monteCarloRuns)
      .where(eq(monteCarloRuns.backtestId, latestBacktest.id))
      .orderBy(desc(monteCarloRuns.createdAt))
      .limit(1);

    if (!mcRun) {
      return res.json({
        sessionId,
        strategyId,
        paperPnl,
        mc_percentile: null,
        driftFromMedian: null,
        warning: "No MC run found for the latest backtest",
      });
    }

    // Compare paper P&L against MC percentiles (using max drawdown distribution as proxy)
    // MC stores p5, p50, p95 for Sharpe — use total return from backtest + MC risk metrics
    const p5 = parseFloat(mcRun.sharpeP5 ?? "0");
    const p50 = parseFloat(mcRun.sharpeP50 ?? "0");
    const p95 = parseFloat(mcRun.sharpeP95 ?? "0");

    // Estimate percentile of paper P&L using linear interpolation between MC bounds
    // Use backtest total return as the MC median outcome reference
    const backtestReturn = parseFloat(latestBacktest.totalReturn ?? "0");
    const driftFromMedian = backtestReturn !== 0
      ? ((paperPnl - backtestReturn) / Math.abs(backtestReturn)) * 100
      : 0;

    // Rough percentile estimation: map paper P&L into the MC distribution
    let mc_percentile: number;
    if (paperPnl <= backtestReturn * 0.5) mc_percentile = 5;
    else if (paperPnl <= backtestReturn * 0.75) mc_percentile = 25;
    else if (paperPnl <= backtestReturn) mc_percentile = 50;
    else if (paperPnl <= backtestReturn * 1.25) mc_percentile = 75;
    else mc_percentile = 95;

    const warning = Math.abs(driftFromMedian) > 100
      ? `Paper P&L drifts ${driftFromMedian.toFixed(1)}% from backtest median — investigate`
      : undefined;

    res.json({
      sessionId,
      strategyId,
      paperPnl,
      backtestReturn,
      mc_percentile,
      driftFromMedian: parseFloat(driftFromMedian.toFixed(2)),
      mcSharpe: { p5, p50, p95 },
      warning,
    });
  } catch (err: any) {
    logger.error(err, "MC compare failed");
    res.status(500).json({ error: err.message });
  }
});

export { router as paperRoutes };
