/**
 * Macro Routes — FRED/BLS/EIA macro data overlay + regime classification.
 *
 * GET   /api/macro/current            — Current macro regime (latest snapshot + classification)
 * GET   /api/macro/history            — Historical snapshots (with pagination ?limit=&offset=)
 * POST  /api/macro/sync               — Trigger manual data sync from FRED/BLS/EIA
 * GET   /api/macro/calendar           — Upcoming FOMC/CPI/NFP events
 * GET   /api/macro/strategy-fit/:id   — Strategy performance across macro regimes
 */

import { Router } from "express";
import { db } from "../db/index.js";
import { macroSnapshots, backtests, backtestTrades } from "../db/schema.js";
import { desc, sql, inArray } from "drizzle-orm";
import { logger } from "../index.js";
import { runPythonModule } from "../lib/python-runner.js";

export const macroRoutes = Router();

// ─── GET /api/macro/current ────────────────────────────────────
// Returns the latest macro snapshot + regime classification
macroRoutes.get("/current", async (_req, res) => {
  try {
    const [latest] = await db
      .select()
      .from(macroSnapshots)
      .orderBy(desc(macroSnapshots.snapshotDate))
      .limit(1);

    if (!latest) {
      res.json({
        message: "No macro snapshots available. Run POST /api/macro/sync first.",
        regime: "TRANSITION",
        confidence: 0,
        snapshot: null,
      });
      return;
    }

    res.json({
      regime: latest.macroRegime || "TRANSITION",
      confidence: Number(latest.regimeConfidence) || 0,
      snapshot_date: latest.snapshotDate,
      data: {
        fed_funds_rate: latest.fedFundsRate ? Number(latest.fedFundsRate) : null,
        treasury_10y: latest.treasury10y ? Number(latest.treasury10y) : null,
        treasury_2y: latest.treasury2y ? Number(latest.treasury2y) : null,
        treasury_3m: latest.treasury3m ? Number(latest.treasury3m) : null,
        vix: latest.vix ? Number(latest.vix) : null,
        yield_spread_10y2y: latest.yieldSpread10y2y ? Number(latest.yieldSpread10y2y) : null,
        unemployment: latest.unemployment ? Number(latest.unemployment) : null,
        cpi_yoy: latest.cpiYoy ? Number(latest.cpiYoy) : null,
        pce_yoy: latest.pceYoy ? Number(latest.pceYoy) : null,
        wti_crude: latest.wtiCrude ? Number(latest.wtiCrude) : null,
        natural_gas: latest.naturalGas ? Number(latest.naturalGas) : null,
      },
      raw_data: latest.rawData,
      created_at: latest.createdAt,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch current macro regime");
    res.status(500).json({ error: "Failed to fetch current macro regime", details: String(err) });
  }
});

// ─── GET /api/macro/history ────────────────────────────────────
// Historical macro snapshots with pagination
macroRoutes.get("/history", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 500);
  const offset = Number(req.query.offset) || 0;

  try {
    const rows = await db
      .select()
      .from(macroSnapshots)
      .orderBy(desc(macroSnapshots.snapshotDate))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(macroSnapshots);

    res.json({
      data: rows.map((r) => ({
        id: r.id,
        snapshot_date: r.snapshotDate,
        regime: r.macroRegime,
        confidence: r.regimeConfidence ? Number(r.regimeConfidence) : null,
        vix: r.vix ? Number(r.vix) : null,
        fed_funds_rate: r.fedFundsRate ? Number(r.fedFundsRate) : null,
        treasury_10y: r.treasury10y ? Number(r.treasury10y) : null,
        yield_spread_10y2y: r.yieldSpread10y2y ? Number(r.yieldSpread10y2y) : null,
        unemployment: r.unemployment ? Number(r.unemployment) : null,
        cpi_yoy: r.cpiYoy ? Number(r.cpiYoy) : null,
        wti_crude: r.wtiCrude ? Number(r.wtiCrude) : null,
      })),
      pagination: {
        limit,
        offset,
        total: Number(countResult?.count ?? 0),
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch macro history");
    res.status(500).json({ error: "Failed to fetch macro history", details: String(err) });
  }
});

// ─── POST /api/macro/sync ──────────────────────────────────────
// Trigger manual data sync from FRED/BLS/EIA
macroRoutes.post("/sync", async (_req, res) => {
  try {
    const result = await runPythonModule({
      scriptCode: `
import json, sys, os
sys.path.insert(0, '.')

results = {"status": "partial", "sources": {}}

# FRED
try:
    from src.data.macro.fred_client import get_latest_values
    fred_data = get_latest_values()
    results["sources"]["fred"] = {"status": "ok", "series_count": len([v for v in fred_data.values() if v is not None])}
    results["fred_data"] = fred_data
except Exception as e:
    results["sources"]["fred"] = {"status": "error", "error": str(e)}
    results["fred_data"] = {}

# Classify regime
try:
    from src.data.macro.macro_tagger import classify_macro_regime
    snapshot = results.get("fred_data", {})
    regime = classify_macro_regime(snapshot)
    results["regime"] = regime
except Exception as e:
    results["regime"] = {"regime": "TRANSITION", "confidence": 0, "error": str(e)}

results["status"] = "ok"
print(json.dumps(results))
`,
      componentName: "macro-sync",
      timeoutMs: 120_000,
    });

    const fredData = (result as any).fred_data || {};
    const regime = (result as any).regime || {};

    // Store snapshot in DB
    await db.insert(macroSnapshots).values({
      snapshotDate: new Date(),
      fedFundsRate: fredData.fed_funds_rate?.toString() ?? null,
      treasury10y: fredData.treasury_10y?.toString() ?? null,
      treasury2y: fredData.treasury_2y?.toString() ?? null,
      treasury3m: fredData.treasury_3m?.toString() ?? null,
      vix: fredData.vix?.toString() ?? null,
      yieldSpread10y2y: fredData.yield_spread_10y2y?.toString() ?? null,
      unemployment: fredData.unemployment?.toString() ?? null,
      cpiYoy: fredData.cpi_yoy?.toString() ?? null,
      pceYoy: fredData.pce_yoy?.toString() ?? null,
      wtiCrude: fredData.wti_crude?.toString() ?? null,
      naturalGas: fredData.natural_gas?.toString() ?? null,
      macroRegime: regime.regime || "TRANSITION",
      regimeConfidence: regime.confidence?.toString() ?? "0",
      rawData: result as Record<string, unknown>,
    });

    res.json({
      status: "ok",
      regime: regime.regime || "TRANSITION",
      confidence: regime.confidence || 0,
      sources: (result as any).sources || {},
      snapshot_date: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Macro sync failed");
    res.status(500).json({ error: "Macro sync failed", details: String(err) });
  }
});

// ─── GET /api/macro/calendar ───────────────────────────────────
// Upcoming FOMC/CPI/NFP/PPI events
macroRoutes.get("/calendar", async (req, res) => {
  const daysAhead = Math.min(Number(req.query.days_ahead) || 30, 365);

  try {
    const result = await runPythonModule({
      scriptCode: `
import json, sys
sys.path.insert(0, '.')
from src.data.macro.event_calendar import get_upcoming_events, event_proximity
from datetime import date

events = get_upcoming_events(days_ahead=${daysAhead})
proximity = event_proximity()

print(json.dumps({
    "events": events,
    "proximity": proximity,
    "today": date.today().isoformat(),
}))
`,
      componentName: "macro-calendar",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Calendar fetch failed");
    res.status(500).json({ error: "Calendar fetch failed", details: String(err) });
  }
});

// ─── GET /api/macro/strategy-fit/:id ───────────────────────────
// Strategy performance across macro regimes (real DB query)
macroRoutes.get("/strategy-fit/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Find all completed backtests for this strategy
    const strategyBacktests = await db
      .select({ id: backtests.id })
      .from(backtests)
      .where(
        sql`${backtests.strategyId} = ${id} AND ${backtests.status} = 'completed'`
      );

    if (strategyBacktests.length === 0) {
      return res.json({
        strategy_id: id,
        total_trades: 0,
        by_regime: {},
        by_session: {},
        by_day_of_week: {},
        message: "No completed backtests found for this strategy.",
      });
    }

    const backtestIds = strategyBacktests.map((b) => b.id);

    // Pull all trades for those backtests
    const trades = await db
      .select({
        pnl: backtestTrades.pnl,
        netPnl: backtestTrades.netPnl,
        macroRegime: backtestTrades.macroRegime,
        sessionType: backtestTrades.sessionType,
        dayOfWeek: backtestTrades.dayOfWeek,
      })
      .from(backtestTrades)
      .where(inArray(backtestTrades.backtestId, backtestIds));

    if (trades.length === 0) {
      return res.json({
        strategy_id: id,
        total_trades: 0,
        by_regime: {},
        by_session: {},
        by_day_of_week: {},
        message: "No trades found across backtests.",
      });
    }

    // Helper to compute group stats
    function groupStats(items: typeof trades) {
      if (items.length === 0) return null;
      const pnls = items.map((t) => parseFloat(String(t.netPnl ?? t.pnl ?? "0")));
      const wins = pnls.filter((p) => p > 0);
      const losses = pnls.filter((p) => p < 0);
      const avgPnl = pnls.reduce((s, v) => s + v, 0) / pnls.length;
      const winRate = pnls.length > 0 ? wins.length / pnls.length : 0;
      const grossWin = wins.reduce((s, v) => s + v, 0);
      const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
      const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999.99 : 0;
      return {
        avg_pnl: Math.round(avgPnl * 100) / 100,
        win_rate: Math.round(winRate * 1000) / 1000,
        profit_factor: Math.round(pf * 100) / 100,
        trades: pnls.length,
      };
    }

    // Group by regime
    const byRegime: Record<string, any> = {};
    const regimeGroups = new Map<string, typeof trades>();
    for (const t of trades) {
      const key = t.macroRegime ?? "UNKNOWN";
      if (!regimeGroups.has(key)) regimeGroups.set(key, []);
      regimeGroups.get(key)!.push(t);
    }
    for (const [key, group] of regimeGroups) {
      byRegime[key] = groupStats(group);
    }

    // Group by session
    const bySession: Record<string, any> = {};
    const sessionGroups = new Map<string, typeof trades>();
    for (const t of trades) {
      const key = t.sessionType ?? "UNKNOWN";
      if (!sessionGroups.has(key)) sessionGroups.set(key, []);
      sessionGroups.get(key)!.push(t);
    }
    for (const [key, group] of sessionGroups) {
      bySession[key] = groupStats(group);
    }

    // Group by day of week
    const byDayOfWeek: Record<string, any> = {};
    const dayGroups = new Map<number, typeof trades>();
    for (const t of trades) {
      const key = t.dayOfWeek ?? -1;
      if (!dayGroups.has(key)) dayGroups.set(key, []);
      dayGroups.get(key)!.push(t);
    }
    for (const [key, group] of dayGroups) {
      byDayOfWeek[String(key)] = groupStats(group);
    }

    // Find best regime
    let bestRegime = "";
    let bestAvgPnl = -Infinity;
    for (const [key, stats] of Object.entries(byRegime)) {
      if (stats && stats.avg_pnl > bestAvgPnl) {
        bestAvgPnl = stats.avg_pnl;
        bestRegime = key;
      }
    }

    // Find worst regime
    let worstRegime = "";
    let worstAvgPnl = Infinity;
    for (const [key, stats] of Object.entries(byRegime)) {
      if (stats && stats.avg_pnl < worstAvgPnl) {
        worstAvgPnl = stats.avg_pnl;
        worstRegime = key;
      }
    }

    const recommendation = bestRegime
      ? `Strategy performs best in ${bestRegime}. ${worstRegime && worstAvgPnl < 0 ? `Consider pausing during ${worstRegime}.` : ""}`
      : "Insufficient data for regime recommendation.";

    res.json({
      strategy_id: id,
      total_trades: trades.length,
      by_regime: byRegime,
      by_session: bySession,
      by_day_of_week: byDayOfWeek,
      best_regime: bestRegime,
      recommendation,
    });
  } catch (err) {
    logger.error({ err }, "Strategy-fit analysis failed");
    res.status(500).json({ error: "Strategy-fit analysis failed", details: String(err) });
  }
});
