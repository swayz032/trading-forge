/**
 * Portfolio Routes — Aggregate portfolio risk dashboard.
 *
 * GET /api/portfolio/heat — Total portfolio risk snapshot
 */

import { Router } from "express";
import { db } from "../db/index.js";
import { paperSessions, paperPositions, strategies } from "../db/schema.js";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { logger } from "../index.js";

export const portfolioRoutes = Router();

portfolioRoutes.get("/heat", async (_req, res) => {
  try {
    // 1. Get active paper sessions
    const activeSessions = await db
      .select({
        id: paperSessions.id,
        strategyId: paperSessions.strategyId,
        startingCapital: paperSessions.startingCapital,
        currentEquity: paperSessions.currentEquity,
      })
      .from(paperSessions)
      .where(eq(paperSessions.status, "active"));

    if (activeSessions.length === 0) {
      return res.json({
        active_sessions: 0,
        total_unrealized_pnl: 0,
        positions: [],
        drawdown_usage: [],
        max_correlated_pair: null,
        portfolio_sharpe: null,
        message: "No active paper sessions.",
      });
    }

    const sessionIds = activeSessions.map((s) => s.id);

    // 2. Get open positions
    const positions = await db
      .select({
        sessionId: paperPositions.sessionId,
        symbol: paperPositions.symbol,
        side: paperPositions.side,
        entryPrice: paperPositions.entryPrice,
        currentPrice: paperPositions.currentPrice,
        contracts: paperPositions.contracts,
        unrealizedPnl: paperPositions.unrealizedPnl,
      })
      .from(paperPositions)
      .where(
        and(inArray(paperPositions.sessionId, sessionIds), isNull(paperPositions.closedAt))
      );

    // 3. Total unrealized P&L
    const totalUnrealizedPnl = positions.reduce(
      (sum, p) => sum + parseFloat(String(p.unrealizedPnl ?? "0")),
      0
    );

    // 4. Drawdown usage per session
    const drawdownUsage = activeSessions.map((s) => {
      const starting = parseFloat(String(s.startingCapital));
      const current = parseFloat(String(s.currentEquity));
      const dd = starting - current;
      const ddPct = starting > 0 ? (dd / starting) * 100 : 0;
      return {
        session_id: s.id,
        strategy_id: s.strategyId,
        starting_capital: starting,
        current_equity: current,
        drawdown: Math.round(dd * 100) / 100,
        drawdown_pct: Math.round(ddPct * 100) / 100,
      };
    });

    // 5. Strategy-level regime concentration
    const strategyIds = [
      ...new Set(activeSessions.map((s) => s.strategyId).filter((id): id is string => id != null)),
    ];
    const regimeConcentration: Record<string, number> = {};
    if (strategyIds.length > 0) {
      const strats = await db
        .select({ preferredRegime: strategies.preferredRegime })
        .from(strategies)
        .where(inArray(strategies.id, strategyIds));

      for (const s of strats) {
        const regime = s.preferredRegime ?? "UNKNOWN";
        regimeConcentration[regime] = (regimeConcentration[regime] ?? 0) + 1;
      }
    }

    // 6. Portfolio-level Sharpe (from rolling Sharpe of active strategies)
    let portfolioSharpe: number | null = null;
    if (strategyIds.length > 0) {
      const sharpes = await db
        .select({ sharpe: strategies.rollingSharpe30d })
        .from(strategies)
        .where(inArray(strategies.id, strategyIds));

      const validSharpes = sharpes
        .map((s) => parseFloat(String(s.sharpe ?? "0")))
        .filter((v) => !isNaN(v) && v !== 0);

      if (validSharpes.length > 0) {
        portfolioSharpe =
          Math.round(
            (validSharpes.reduce((s, v) => s + v, 0) / validSharpes.length) *
              100
          ) / 100;
      }
    }

    // 7. Find max correlated pair (by symbol overlap)
    const symbolCounts = new Map<string, number>();
    for (const p of positions) {
      if (p.symbol) {
        symbolCounts.set(p.symbol, (symbolCounts.get(p.symbol) ?? 0) + 1);
      }
    }
    let maxCorrelatedPair: { symbols: string[]; warning: string } | null = null;
    for (const [sym, count] of symbolCounts) {
      if (count > 1) {
        maxCorrelatedPair = {
          symbols: [sym, sym],
          warning: `${count} positions in ${sym} — high correlation risk`,
        };
        break;
      }
    }

    // 8. Heat percentage (total drawdown / total starting capital)
    const totalStarting = activeSessions.reduce(
      (s, a) => s + parseFloat(String(a.startingCapital)),
      0
    );
    const totalCurrent = activeSessions.reduce(
      (s, a) => s + parseFloat(String(a.currentEquity)),
      0
    );
    const heatPct =
      totalStarting > 0
        ? Math.round(
            ((totalStarting - totalCurrent) / totalStarting) * 10000
          ) / 100
        : 0;

    res.json({
      active_sessions: activeSessions.length,
      total_unrealized_pnl: Math.round(totalUnrealizedPnl * 100) / 100,
      total_positions: positions.length,
      heat_pct: heatPct,
      drawdown_usage: drawdownUsage,
      regime_concentration: regimeConcentration,
      max_correlated_pair: maxCorrelatedPair,
      portfolio_sharpe: portfolioSharpe,
      positions: positions.map((p) => ({
        session_id: p.sessionId,
        symbol: p.symbol,
        side: p.side,
        contracts: p.contracts,
        unrealized_pnl: parseFloat(String(p.unrealizedPnl ?? "0")),
      })),
    });
  } catch (err) {
    logger.error({ err }, "Portfolio heat failed");
    res
      .status(500)
      .json({ error: "Portfolio heat failed", details: String(err) });
  }
});
