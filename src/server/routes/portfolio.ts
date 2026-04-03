/**
 * Portfolio Routes — Aggregate portfolio risk dashboard.
 *
 * GET /api/portfolio/heat           — Total portfolio risk snapshot
 * GET /api/portfolio/correlation    — Robust covariance + Euler decomposition
 * GET /api/portfolio/decomposition  — Euler risk decomposition per strategy + Component VaR
 * GET /api/portfolio/equity-curve   — Combined equity curve across deployed strategies
 * GET /api/portfolio/diversification — Diversification ratio, correlation matrix, Herfindahl index
 */

import { Router } from "express";
import { db } from "../db/index.js";
import { paperSessions, paperPositions, paperTrades, strategies, backtests } from "../db/schema.js";
import { eq, and, isNull, inArray, desc } from "drizzle-orm";
import { runPythonModule } from "../lib/python-runner.js";
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

// ─── GET /api/portfolio/correlation ─────────────────────────────
// Robust covariance matrix + Euler risk decomposition via LedoitWolf

portfolioRoutes.get("/correlation", async (_req, res) => {
  try {
    // 1. Get active paper sessions with their strategy links
    const activeSessions = await db
      .select({
        id: paperSessions.id,
        strategyId: paperSessions.strategyId,
        currentEquity: paperSessions.currentEquity,
        startingCapital: paperSessions.startingCapital,
      })
      .from(paperSessions)
      .where(eq(paperSessions.status, "active"));

    if (activeSessions.length < 2) {
      return res.json({
        message: "Need at least 2 active strategies for correlation analysis",
        strategies: activeSessions.length,
        correlation: null,
        risk_decomposition: null,
      });
    }

    const sessionIds = activeSessions.map((s) => s.id);
    const strategyIds = [
      ...new Set(activeSessions.map((s) => s.strategyId).filter((id): id is string => id != null)),
    ];

    // 2. Collect daily returns per strategy from paper trades
    //    Group trade P&Ls by date to get daily returns per strategy
    const trades = await db
      .select({
        sessionId: paperTrades.sessionId,
        pnl: paperTrades.pnl,
        exitTime: paperTrades.exitTime,
      })
      .from(paperTrades)
      .where(inArray(paperTrades.sessionId, sessionIds));

    // Build daily P&L per session
    const sessionDailyPnl = new Map<string, Map<string, number>>();
    const allDates = new Set<string>();

    for (const trade of trades) {
      const dateKey = trade.exitTime.toISOString().slice(0, 10);
      allDates.add(dateKey);

      if (!sessionDailyPnl.has(trade.sessionId)) {
        sessionDailyPnl.set(trade.sessionId, new Map());
      }
      const dailyMap = sessionDailyPnl.get(trade.sessionId)!;
      dailyMap.set(dateKey, (dailyMap.get(dateKey) ?? 0) + parseFloat(String(trade.pnl)));
    }

    // If paper trades are sparse, also try backtest dailyPnls as fallback
    if (allDates.size < 5 && strategyIds.length >= 2) {
      // Get latest completed backtest per strategy
      for (const stratId of strategyIds) {
        const [bt] = await db
          .select({ id: backtests.id, dailyPnls: backtests.dailyPnls, strategyId: backtests.strategyId })
          .from(backtests)
          .where(and(eq(backtests.strategyId, stratId), eq(backtests.status, "completed")))
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (bt?.dailyPnls && Array.isArray(bt.dailyPnls)) {
          // Find the session for this strategy
          const session = activeSessions.find((s) => s.strategyId === stratId);
          if (!session) continue;

          if (!sessionDailyPnl.has(session.id)) {
            sessionDailyPnl.set(session.id, new Map());
          }
          const dailyMap = sessionDailyPnl.get(session.id)!;
          // Use synthetic dates for backtest data (indexed from day 0)
          (bt.dailyPnls as number[]).forEach((pnl, i) => {
            const syntheticDate = `bt-${i.toString().padStart(4, "0")}`;
            allDates.add(syntheticDate);
            dailyMap.set(syntheticDate, (dailyMap.get(syntheticDate) ?? 0) + pnl);
          });
        }
      }
    }

    const sortedDates = Array.from(allDates).sort();
    // Only include sessions that have data
    const activeSids = sessionIds.filter((sid) => sessionDailyPnl.has(sid) && sessionDailyPnl.get(sid)!.size > 0);

    if (activeSids.length < 2 || sortedDates.length < 3) {
      return res.json({
        message: "Insufficient return history for correlation (need >= 2 strategies with >= 3 daily observations)",
        strategies: activeSids.length,
        observations: sortedDates.length,
        correlation: null,
        risk_decomposition: null,
      });
    }

    // 3. Build returns matrix (n_observations x n_strategies)
    const returnsMatrix: number[][] = [];
    for (const date of sortedDates) {
      const row: number[] = [];
      for (const sid of activeSids) {
        row.push(sessionDailyPnl.get(sid)?.get(date) ?? 0);
      }
      returnsMatrix.push(row);
    }

    // 4. Compute equal weights (or proportional to capital)
    const totalCapital = activeSids.reduce((sum, sid) => {
      const session = activeSessions.find((s) => s.id === sid);
      return sum + parseFloat(String(session?.startingCapital ?? "50000"));
    }, 0);
    const weights = activeSids.map((sid) => {
      const session = activeSessions.find((s) => s.id === sid);
      return parseFloat(String(session?.startingCapital ?? "50000")) / totalCapital;
    });

    // 5. Call Python robust_covariance module via scriptCode
    const strategyLabels = activeSids.map((sid) => {
      const session = activeSessions.find((s) => s.id === sid);
      return session?.strategyId ?? sid;
    });

    const pythonScript = `
import sys, json, numpy as np
sys.path.insert(0, ".")
from src.engine.robust_covariance import estimate_covariance, portfolio_risk_decomposition

config = json.loads(open(sys.argv[1]).read())
returns = np.array(config["returns_matrix"])
weights = np.array(config["weights"])

cov_result = estimate_covariance(returns, method=config.get("method", "ledoit_wolf"))
risk_result = portfolio_risk_decomposition(weights, np.array(cov_result["covariance"]))

print(json.dumps({
    "covariance": cov_result,
    "risk_decomposition": risk_result,
}))
`;

    const result = await runPythonModule<{
      covariance: {
        covariance: number[][];
        correlation: number[][];
        shrinkage: number | null;
        method: string;
        condition_number: number;
      };
      risk_decomposition: {
        portfolio_volatility: number;
        marginal_risk: number[];
        component_risk: number[];
        pct_contribution: number[];
      };
    }>({
      scriptCode: pythonScript,
      config: {
        returns_matrix: returnsMatrix,
        weights,
        method: "ledoit_wolf",
      },
      timeoutMs: 30_000,
      componentName: "robust-covariance",
    });

    // 6. Annotate with strategy labels
    const correlationMatrix = result.covariance.correlation;
    let maxCorrelatedPair: { strategies: string[]; correlation: number } | null = null;
    for (let i = 0; i < strategyLabels.length; i++) {
      for (let j = i + 1; j < strategyLabels.length; j++) {
        const corr = correlationMatrix[i][j];
        if (!maxCorrelatedPair || Math.abs(corr) > Math.abs(maxCorrelatedPair.correlation)) {
          maxCorrelatedPair = {
            strategies: [strategyLabels[i], strategyLabels[j]],
            correlation: Math.round(corr * 1000) / 1000,
          };
        }
      }
    }

    return res.json({
      strategy_labels: strategyLabels,
      observations: sortedDates.length,
      covariance: result.covariance,
      risk_decomposition: {
        ...result.risk_decomposition,
        strategy_labels: strategyLabels,
        weights,
      },
      max_correlated_pair: maxCorrelatedPair,
      warning: maxCorrelatedPair && Math.abs(maxCorrelatedPair.correlation) > 0.5
        ? `High correlation (${maxCorrelatedPair.correlation}) between strategies — treat as single position for sizing`
        : null,
    });
  } catch (err) {
    logger.error({ err }, "Portfolio correlation failed");
    res.status(500).json({ error: "Portfolio correlation failed", details: String(err) });
  }
});

// ─── GET /api/portfolio/decomposition ─────────────────────────────
// Euler risk decomposition per strategy via Python robust_covariance

portfolioRoutes.get("/decomposition", async (_req, res) => {
  try {
    // 1. Get strategies with DEPLOYED or PAPER lifecycle state
    const deployedStrategies = await db
      .select({
        id: strategies.id,
        name: strategies.name,
        lifecycleState: strategies.lifecycleState,
      })
      .from(strategies)
      .where(inArray(strategies.lifecycleState, ["DEPLOYED", "PAPER"]));

    if (deployedStrategies.length < 2) {
      return res.json({
        message: "Need at least 2 deployed/paper strategies for Euler decomposition",
        strategies: deployedStrategies.length,
        decomposition: null,
      });
    }

    const strategyIds = deployedStrategies.map((s) => s.id);

    // 2. Gather daily returns per strategy from backtests (dailyPnls)
    const returnsPerStrategy = new Map<string, number[]>();
    let maxLen = 0;

    for (const stratId of strategyIds) {
      const [bt] = await db
        .select({ dailyPnls: backtests.dailyPnls })
        .from(backtests)
        .where(and(eq(backtests.strategyId, stratId), eq(backtests.status, "completed")))
        .orderBy(desc(backtests.createdAt))
        .limit(1);

      if (bt?.dailyPnls && Array.isArray(bt.dailyPnls)) {
        returnsPerStrategy.set(stratId, bt.dailyPnls as number[]);
        maxLen = Math.max(maxLen, (bt.dailyPnls as number[]).length);
      }
    }

    // Also try paper trades as a supplement
    for (const stratId of strategyIds) {
      if (returnsPerStrategy.has(stratId)) continue;

      const sessions = await db
        .select({ id: paperSessions.id })
        .from(paperSessions)
        .where(and(eq(paperSessions.strategyId, stratId), eq(paperSessions.status, "active")));

      if (sessions.length === 0) continue;

      const trades = await db
        .select({ pnl: paperTrades.pnl, exitTime: paperTrades.exitTime })
        .from(paperTrades)
        .where(inArray(paperTrades.sessionId, sessions.map((s) => s.id)));

      if (trades.length === 0) continue;

      const dailyMap = new Map<string, number>();
      for (const t of trades) {
        const dateKey = t.exitTime.toISOString().slice(0, 10);
        dailyMap.set(dateKey, (dailyMap.get(dateKey) ?? 0) + parseFloat(String(t.pnl)));
      }
      const sorted = Array.from(dailyMap.entries()).sort(([a], [b]) => a.localeCompare(b));
      returnsPerStrategy.set(stratId, sorted.map(([, v]) => v));
      maxLen = Math.max(maxLen, sorted.length);
    }

    const activeIds = strategyIds.filter((id) => returnsPerStrategy.has(id));
    if (activeIds.length < 2 || maxLen < 3) {
      return res.json({
        message: "Insufficient return data for decomposition (need >= 2 strategies with >= 3 observations)",
        strategies: activeIds.length,
        observations: maxLen,
        decomposition: null,
      });
    }

    // 3. Build aligned returns matrix (pad shorter series with 0)
    const returnsMatrix: number[][] = [];
    for (let i = 0; i < maxLen; i++) {
      const row: number[] = [];
      for (const sid of activeIds) {
        const returns = returnsPerStrategy.get(sid)!;
        row.push(i < returns.length ? returns[i] : 0);
      }
      returnsMatrix.push(row);
    }

    // 4. Equal weights
    const n = activeIds.length;
    const weights = activeIds.map(() => 1.0 / n);

    // 5. Call Python for Euler decomposition
    const strategyLabels = activeIds.map((sid) => {
      const s = deployedStrategies.find((st) => st.id === sid);
      return s?.name ?? sid;
    });

    const pythonScript = `
import sys, json, numpy as np
sys.path.insert(0, ".")
from src.engine.robust_covariance import estimate_covariance, portfolio_risk_decomposition

config_path = sys.argv[sys.argv.index('--config') + 1]
config = json.loads(open(config_path).read())
returns = np.array(config["returns_matrix"])
weights = np.array(config["weights"])

cov_result = estimate_covariance(returns, method=config.get("method", "ledoit_wolf"))
cov_matrix = np.array(cov_result["covariance"])
risk_result = portfolio_risk_decomposition(weights, cov_matrix)

# Component VaR at 95% confidence (parametric)
z_95 = 1.6449
port_vol = risk_result["portfolio_volatility"]
component_var = [cr * z_95 for cr in risk_result["component_risk"]]

print(json.dumps({
    "portfolio_volatility": risk_result["portfolio_volatility"],
    "marginal_risk": risk_result["marginal_risk"],
    "component_risk": risk_result["component_risk"],
    "pct_contribution": risk_result["pct_contribution"],
    "component_var_95": component_var,
    "covariance_method": cov_result["method"],
    "shrinkage": cov_result["shrinkage"],
    "condition_number": cov_result["condition_number"],
}))
`;

    const result = await runPythonModule<{
      portfolio_volatility: number;
      marginal_risk: number[];
      component_risk: number[];
      pct_contribution: number[];
      component_var_95: number[];
      covariance_method: string;
      shrinkage: number | null;
      condition_number: number;
    }>({
      scriptCode: pythonScript,
      config: {
        returns_matrix: returnsMatrix,
        weights,
        method: "ledoit_wolf",
      },
      timeoutMs: 30_000,
      componentName: "euler-decomposition",
    });

    return res.json({
      strategy_labels: strategyLabels,
      strategy_ids: activeIds,
      observations: maxLen,
      weights,
      portfolio_volatility: result.portfolio_volatility,
      per_strategy: strategyLabels.map((label, i) => ({
        strategy: label,
        weight: weights[i],
        marginal_risk: Math.round(result.marginal_risk[i] * 1e6) / 1e6,
        component_risk: Math.round(result.component_risk[i] * 1e6) / 1e6,
        pct_contribution: Math.round(result.pct_contribution[i] * 10000) / 100, // as percentage
        component_var_95: Math.round(result.component_var_95[i] * 100) / 100,
      })),
      covariance_method: result.covariance_method,
      shrinkage: result.shrinkage,
      condition_number: result.condition_number,
    });
  } catch (err) {
    logger.error({ err }, "Portfolio decomposition failed");
    const status = String(err).includes("timed out") || String(err).includes("failed") ? 503 : 500;
    res.status(status).json({ error: "Portfolio decomposition failed", details: String(err) });
  }
});

// ─── GET /api/portfolio/equity-curve ─────────────────────────────
// Combined portfolio equity curve across deployed/paper strategies

portfolioRoutes.get("/equity-curve", async (_req, res) => {
  try {
    // 1. Get strategies with DEPLOYED or PAPER lifecycle state
    const deployedStrategies = await db
      .select({
        id: strategies.id,
        name: strategies.name,
        lifecycleState: strategies.lifecycleState,
      })
      .from(strategies)
      .where(inArray(strategies.lifecycleState, ["DEPLOYED", "PAPER"]));

    if (deployedStrategies.length === 0) {
      return res.json({
        message: "No deployed or paper strategies found",
        strategies: 0,
        equity_curve: null,
      });
    }

    const strategyIds = deployedStrategies.map((s) => s.id);

    // 2. Collect daily P&L from paper trades (primary source)
    const allDailyPnl = new Map<string, number>(); // date -> aggregated P&L
    const perStrategyDailyPnl = new Map<string, Map<string, number>>();
    let hasData = false;

    for (const stratId of strategyIds) {
      const sessions = await db
        .select({ id: paperSessions.id })
        .from(paperSessions)
        .where(eq(paperSessions.strategyId, stratId));

      if (sessions.length === 0) continue;

      const trades = await db
        .select({ pnl: paperTrades.pnl, exitTime: paperTrades.exitTime })
        .from(paperTrades)
        .where(inArray(paperTrades.sessionId, sessions.map((s) => s.id)));

      if (trades.length === 0) continue;
      hasData = true;

      const stratDaily = new Map<string, number>();
      for (const t of trades) {
        const dateKey = t.exitTime.toISOString().slice(0, 10);
        const pnl = parseFloat(String(t.pnl));
        stratDaily.set(dateKey, (stratDaily.get(dateKey) ?? 0) + pnl);
        allDailyPnl.set(dateKey, (allDailyPnl.get(dateKey) ?? 0) + pnl);
      }
      perStrategyDailyPnl.set(stratId, stratDaily);
    }

    // 3. Fallback to backtest dailyPnls if no paper trades
    if (!hasData) {
      for (const stratId of strategyIds) {
        const [bt] = await db
          .select({ dailyPnls: backtests.dailyPnls, startDate: backtests.startDate })
          .from(backtests)
          .where(and(eq(backtests.strategyId, stratId), eq(backtests.status, "completed")))
          .orderBy(desc(backtests.createdAt))
          .limit(1);

        if (bt?.dailyPnls && Array.isArray(bt.dailyPnls)) {
          hasData = true;
          const stratDaily = new Map<string, number>();
          const baseDate = bt.startDate ?? new Date("2025-01-01");
          (bt.dailyPnls as number[]).forEach((pnl, i) => {
            const d = new Date(baseDate);
            d.setDate(d.getDate() + i);
            const dateKey = d.toISOString().slice(0, 10);
            stratDaily.set(dateKey, (stratDaily.get(dateKey) ?? 0) + pnl);
            allDailyPnl.set(dateKey, (allDailyPnl.get(dateKey) ?? 0) + pnl);
          });
          perStrategyDailyPnl.set(stratId, stratDaily);
        }
      }
    }

    if (!hasData || allDailyPnl.size === 0) {
      return res.json({
        message: "No trade data available for equity curve",
        strategies: deployedStrategies.length,
        equity_curve: null,
      });
    }

    // 4. Build cumulative equity curve
    const sortedDates = Array.from(allDailyPnl.keys()).sort();
    let cumulative = 0;
    const equityCurve = sortedDates.map((date) => {
      cumulative += allDailyPnl.get(date)!;
      return {
        date,
        daily_pnl: Math.round(allDailyPnl.get(date)! * 100) / 100,
        cumulative_pnl: Math.round(cumulative * 100) / 100,
      };
    });

    // 5. Compute summary stats
    const dailyValues = sortedDates.map((d) => allDailyPnl.get(d)!);
    const avgDaily = dailyValues.reduce((s, v) => s + v, 0) / dailyValues.length;
    const winDays = dailyValues.filter((v) => v > 0).length;
    let peak = 0;
    let maxDd = 0;
    let runningCum = 0;
    for (const v of dailyValues) {
      runningCum += v;
      if (runningCum > peak) peak = runningCum;
      const dd = peak - runningCum;
      if (dd > maxDd) maxDd = dd;
    }

    return res.json({
      strategy_count: deployedStrategies.length,
      strategies: deployedStrategies.map((s) => ({ id: s.id, name: s.name, state: s.lifecycleState })),
      trading_days: sortedDates.length,
      total_pnl: Math.round(cumulative * 100) / 100,
      avg_daily_pnl: Math.round(avgDaily * 100) / 100,
      win_day_rate: Math.round((winDays / sortedDates.length) * 10000) / 100,
      max_drawdown: Math.round(maxDd * 100) / 100,
      equity_curve: equityCurve,
    });
  } catch (err) {
    logger.error({ err }, "Portfolio equity curve failed");
    res.status(500).json({ error: "Portfolio equity curve failed", details: String(err) });
  }
});

// ─── GET /api/portfolio/diversification ─────────────────────────────
// Diversification score: correlation matrix, diversification ratio, Herfindahl index

portfolioRoutes.get("/diversification", async (_req, res) => {
  try {
    // 1. Get strategies with DEPLOYED or PAPER lifecycle state
    const deployedStrategies = await db
      .select({
        id: strategies.id,
        name: strategies.name,
        lifecycleState: strategies.lifecycleState,
      })
      .from(strategies)
      .where(inArray(strategies.lifecycleState, ["DEPLOYED", "PAPER"]));

    if (deployedStrategies.length < 2) {
      return res.json({
        message: "Need at least 2 deployed/paper strategies for diversification analysis",
        strategies: deployedStrategies.length,
        diversification: null,
      });
    }

    const strategyIds = deployedStrategies.map((s) => s.id);

    // 2. Gather daily returns per strategy
    const returnsPerStrategy = new Map<string, number[]>();
    let maxLen = 0;

    for (const stratId of strategyIds) {
      // Try backtests first
      const [bt] = await db
        .select({ dailyPnls: backtests.dailyPnls })
        .from(backtests)
        .where(and(eq(backtests.strategyId, stratId), eq(backtests.status, "completed")))
        .orderBy(desc(backtests.createdAt))
        .limit(1);

      if (bt?.dailyPnls && Array.isArray(bt.dailyPnls)) {
        returnsPerStrategy.set(stratId, bt.dailyPnls as number[]);
        maxLen = Math.max(maxLen, (bt.dailyPnls as number[]).length);
        continue;
      }

      // Fallback to paper trades
      const sessions = await db
        .select({ id: paperSessions.id })
        .from(paperSessions)
        .where(and(eq(paperSessions.strategyId, stratId), eq(paperSessions.status, "active")));

      if (sessions.length === 0) continue;

      const trades = await db
        .select({ pnl: paperTrades.pnl, exitTime: paperTrades.exitTime })
        .from(paperTrades)
        .where(inArray(paperTrades.sessionId, sessions.map((s) => s.id)));

      if (trades.length === 0) continue;

      const dailyMap = new Map<string, number>();
      for (const t of trades) {
        const dateKey = t.exitTime.toISOString().slice(0, 10);
        dailyMap.set(dateKey, (dailyMap.get(dateKey) ?? 0) + parseFloat(String(t.pnl)));
      }
      const sorted = Array.from(dailyMap.entries()).sort(([a], [b]) => a.localeCompare(b));
      returnsPerStrategy.set(stratId, sorted.map(([, v]) => v));
      maxLen = Math.max(maxLen, sorted.length);
    }

    const activeIds = strategyIds.filter((id) => returnsPerStrategy.has(id));
    if (activeIds.length < 2 || maxLen < 3) {
      return res.json({
        message: "Insufficient return data for diversification analysis (need >= 2 strategies with >= 3 observations)",
        strategies: activeIds.length,
        observations: maxLen,
        diversification: null,
      });
    }

    // 3. Build aligned returns matrix
    const returnsMatrix: number[][] = [];
    for (let i = 0; i < maxLen; i++) {
      const row: number[] = [];
      for (const sid of activeIds) {
        const returns = returnsPerStrategy.get(sid)!;
        row.push(i < returns.length ? returns[i] : 0);
      }
      returnsMatrix.push(row);
    }

    const n = activeIds.length;
    const weights = activeIds.map(() => 1.0 / n);

    const strategyLabels = activeIds.map((sid) => {
      const s = deployedStrategies.find((st) => st.id === sid);
      return s?.name ?? sid;
    });

    // 4. Call Python for correlation + diversification metrics
    const pythonScript = `
import sys, json, numpy as np
sys.path.insert(0, ".")
from src.engine.robust_covariance import estimate_covariance

config_path = sys.argv[sys.argv.index('--config') + 1]
config = json.loads(open(config_path).read())
returns = np.array(config["returns_matrix"])
weights = np.array(config["weights"])

cov_result = estimate_covariance(returns, method=config.get("method", "ledoit_wolf"))
cov = np.array(cov_result["covariance"])
corr = np.array(cov_result["correlation"])

# Individual strategy volatilities
individual_vols = np.sqrt(np.diag(cov))

# Portfolio volatility
port_var = float(weights @ cov @ weights)
port_vol = np.sqrt(max(port_var, 0))

# Diversification ratio = weighted sum of individual vols / portfolio vol
weighted_vol_sum = float(np.sum(weights * individual_vols))
diversification_ratio = weighted_vol_sum / port_vol if port_vol > 1e-10 else 1.0

# Herfindahl index on risk contributions (concentration measure)
marginal = (cov @ weights) / port_vol if port_vol > 1e-10 else np.zeros(len(weights))
component_risk = weights * marginal
total_component = np.sum(np.abs(component_risk))
risk_shares = np.abs(component_risk) / total_component if total_component > 1e-10 else np.ones(len(weights)) / len(weights)
herfindahl = float(np.sum(risk_shares ** 2))

# Average pairwise correlation (off-diagonal)
n = corr.shape[0]
off_diag = []
for i in range(n):
    for j in range(i + 1, n):
        off_diag.append(float(corr[i][j]))
avg_correlation = sum(off_diag) / len(off_diag) if off_diag else 0.0

print(json.dumps({
    "correlation_matrix": cov_result["correlation"],
    "individual_volatilities": individual_vols.tolist(),
    "portfolio_volatility": float(port_vol),
    "diversification_ratio": diversification_ratio,
    "herfindahl_index": herfindahl,
    "avg_pairwise_correlation": avg_correlation,
    "risk_shares": risk_shares.tolist(),
    "covariance_method": cov_result["method"],
}))
`;

    const result = await runPythonModule<{
      correlation_matrix: number[][];
      individual_volatilities: number[];
      portfolio_volatility: number;
      diversification_ratio: number;
      herfindahl_index: number;
      avg_pairwise_correlation: number;
      risk_shares: number[];
      covariance_method: string;
    }>({
      scriptCode: pythonScript,
      config: {
        returns_matrix: returnsMatrix,
        weights,
        method: "ledoit_wolf",
      },
      timeoutMs: 30_000,
      componentName: "diversification-score",
    });

    // Interpret scores
    const divRatio = result.diversification_ratio;
    const hhi = result.herfindahl_index;
    const avgCorr = result.avg_pairwise_correlation;

    let diversificationGrade: string;
    if (divRatio >= 1.5 && avgCorr < 0.3) {
      diversificationGrade = "EXCELLENT";
    } else if (divRatio >= 1.2 && avgCorr < 0.5) {
      diversificationGrade = "GOOD";
    } else if (divRatio >= 1.05) {
      diversificationGrade = "MODERATE";
    } else {
      diversificationGrade = "POOR";
    }

    // Build pairwise correlation table
    const pairwiseCorrelations: { strategy_a: string; strategy_b: string; correlation: number }[] = [];
    for (let i = 0; i < strategyLabels.length; i++) {
      for (let j = i + 1; j < strategyLabels.length; j++) {
        pairwiseCorrelations.push({
          strategy_a: strategyLabels[i],
          strategy_b: strategyLabels[j],
          correlation: Math.round(result.correlation_matrix[i][j] * 1000) / 1000,
        });
      }
    }

    return res.json({
      strategy_labels: strategyLabels,
      strategy_count: activeIds.length,
      observations: maxLen,
      diversification_ratio: Math.round(divRatio * 1000) / 1000,
      herfindahl_index: Math.round(hhi * 10000) / 10000,
      avg_pairwise_correlation: Math.round(avgCorr * 1000) / 1000,
      diversification_grade: diversificationGrade,
      pairwise_correlations: pairwiseCorrelations,
      risk_concentration: strategyLabels.map((label, i) => ({
        strategy: label,
        risk_share_pct: Math.round(result.risk_shares[i] * 10000) / 100,
        individual_volatility: Math.round(result.individual_volatilities[i] * 1e6) / 1e6,
      })),
      portfolio_volatility: result.portfolio_volatility,
      covariance_method: result.covariance_method,
      warnings: [
        ...(avgCorr > 0.5 ? [`High average correlation (${Math.round(avgCorr * 100)}%) — strategies may move together, treat as reduced diversification`] : []),
        ...(hhi > 0.5 ? [`High risk concentration (HHI=${Math.round(hhi * 100)}%) — risk is dominated by few strategies`] : []),
        ...pairwiseCorrelations
          .filter((p) => Math.abs(p.correlation) > 0.5)
          .map((p) => `${p.strategy_a} ↔ ${p.strategy_b} correlation ${p.correlation} > 0.5 threshold`),
      ],
    });
  } catch (err) {
    logger.error({ err }, "Portfolio diversification failed");
    const status = String(err).includes("timed out") || String(err).includes("failed") ? 503 : 500;
    res.status(status).json({ error: "Portfolio diversification failed", details: String(err) });
  }
});
