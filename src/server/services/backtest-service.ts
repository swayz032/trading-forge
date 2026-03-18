/**
 * Backtest Service — Node↔Python bridge + DB persistence
 *
 * Follows the databento.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout → JSON.parse
 * - stderr → logging
 */

import { spawn } from "child_process";
import { resolve as pathResolve } from "path";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { backtests, backtestTrades, strategies, paperSessions, auditLog } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { startStream } from "./paper-trading-stream.js";
import { queryInfo } from "../../data/loaders/duckdb-service.js";
import { logger } from "../index.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../../..");

interface BacktestConfig {
  strategy: {
    name: string;
    symbol: string;
    timeframe: string;
    indicators: Array<{ type: string; period: number; [key: string]: unknown }>;
    entry_long: string;
    entry_short: string;
    exit: string;
    stop_loss: { type: string; multiplier: number };
    position_size: { type: string; target_risk_dollars?: number; fixed_contracts?: number };
  };
  start_date?: string;
  end_date?: string;
  slippage_ticks?: number;
  commission_per_side?: number;
  mode?: "single" | "walkforward";
  walk_forward_splits?: number;
}

/**
 * Resolve date range from S3 data when dates are omitted.
 * Uses DuckDB queryInfo() to find min/max timestamps for a symbol.
 */
async function resolveDataRange(symbol: string): Promise<{ start_date: string; end_date: string }> {
  try {
    const info = await queryInfo(symbol);
    // Extract YYYY-MM-DD from ISO timestamps
    const start = info.earliest.slice(0, 10);
    const end = info.latest.slice(0, 10);
    logger.info({ symbol, start, end, totalBars: info.totalBars }, "Auto-resolved data range from S3");
    return { start_date: start, end_date: end };
  } catch (err) {
    logger.warn({ symbol, err }, "Failed to resolve data range from S3, using fallback");
    return { start_date: "2010-01-01", end_date: "2030-12-31" };
  }
}

interface BacktestResult {
  total_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  avg_trade_pnl: number;
  avg_daily_pnl: number;
  winning_days: number;
  total_trading_days: number;
  max_consecutive_losing_days: number;
  expectancy_per_trade: number;
  avg_winner_to_loser_ratio: number;
  equity_curve: Array<{ time: string; value: number }>;
  monthly_returns?: Array<{ year: number; month: number; pnl: number }>;
  trades: Array<Record<string, unknown>>;
  daily_pnls: number[];
  execution_time_ms: number;
  tier?: string;
  forge_score?: number;
  walk_forward_results?: Record<string, unknown>;
  prop_compliance?: Record<string, unknown>;
  daily_pnl_records?: Array<{ date: string; pnl: number }>;
  error?: string;
}

function runPythonBacktest(configJson: string, mode: string, backtestId: string, strategyClass?: string): Promise<BacktestResult> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = [
      "-m", "src.engine.backtester",
      "--config", configJson,
      "--backtest-id", backtestId,
      "--mode", mode,
      ...(strategyClass ? ["--strategy-class", strategyClass] : []),
    ];

    const proc = spawn(pythonCmd, args, {
      env: { ...process.env },
      cwd: PROJECT_ROOT,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      logger.info({ component: "backtest-engine" }, data.toString().trim());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          reject(new Error(`Failed to parse backtest output: ${stdout}`));
        }
      } else {
        reject(new Error(`Backtest failed (exit ${code}): ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      if (pythonCmd === "python") {
        // Retry with python3
        const proc2 = spawn("python3", args, {
          env: { ...process.env },
          cwd: PROJECT_ROOT,
        });
        let stdout2 = "";
        let stderr2 = "";
        proc2.stdout.on("data", (data) => (stdout2 += data.toString()));
        proc2.stderr.on("data", (data) => (stderr2 += data.toString()));
        proc2.on("close", (code) => {
          if (code === 0) {
            try { resolve(JSON.parse(stdout2.trim())); }
            catch { reject(new Error(`Failed to parse: ${stdout2}`)); }
          } else {
            reject(new Error(`Backtest failed: ${stderr2}`));
          }
        });
        proc2.on("error", () => reject(err));
      } else {
        reject(err);
      }
    });
  });
}

export async function runBacktest(strategyId: string, config: BacktestConfig, strategyClass?: string) {
  // Auto-resolve dates from S3 when omitted
  if (!config.start_date || !config.end_date) {
    const resolved = await resolveDataRange(config.strategy.symbol);
    if (!config.start_date) config.start_date = resolved.start_date;
    if (!config.end_date) config.end_date = resolved.end_date;
  }

  // Insert pending row
  const [row] = await db
    .insert(backtests)
    .values({
      strategyId,
      symbol: config.strategy.symbol,
      timeframe: config.strategy.timeframe,
      startDate: new Date(config.start_date),
      endDate: new Date(config.end_date),
      status: "pending",
      config: config as unknown as Record<string, unknown>,
    })
    .returning();

  const backtestId = row.id;

  // Update to running
  await db
    .update(backtests)
    .set({ status: "running" })
    .where(eq(backtests.id, backtestId));

  try {
    const configJson = JSON.stringify(config);
    const mode = config.mode ?? "single";
    const result = await runPythonBacktest(configJson, mode, backtestId, strategyClass);

    if (result.error) {
      await db
        .update(backtests)
        .set({
          status: "failed",
          errorMessage: result.error,
          executionTimeMs: result.execution_time_ms,
        })
        .where(eq(backtests.id, backtestId));

      return { id: backtestId, status: "failed", error: result.error };
    }

    // Update backtest row with results
    await db
      .update(backtests)
      .set({
        status: "completed",
        totalReturn: String(result.total_return),
        sharpeRatio: String(result.sharpe_ratio),
        maxDrawdown: String(result.max_drawdown),
        winRate: String(result.win_rate),
        profitFactor: String(result.profit_factor),
        totalTrades: result.total_trades,
        avgTradePnl: String(result.avg_trade_pnl),
        avgDailyPnl: String(result.avg_daily_pnl),
        tier: result.tier ?? null,
        forgeScore: result.forge_score != null ? String(result.forge_score) : null,
        equityCurve: result.equity_curve,
        monthlyReturns: result.monthly_returns ?? null,
        dailyPnls: result.daily_pnls,
        walkForwardResults: result.walk_forward_results ?? null,
        propCompliance: result.prop_compliance ?? null,
        executionTimeMs: result.execution_time_ms,
      })
      .where(eq(backtests.id, backtestId));

    // Bulk insert trades
    if (result.trades.length > 0) {
      const tradeRows = result.trades.map((t) => {
        // vectorbt records_readable columns:
        //   "Entry Timestamp" (int index or ISO string), "Exit Timestamp",
        //   "Avg Entry Price", "Avg Exit Price", "PnL", "Direction", "Size"
        const entryTs = t["Entry Timestamp"] ?? t["entry_time"];
        const exitTs = t["Exit Timestamp"] ?? t["exit_time"];

        // Entry/exit timestamps may be integer indices or ISO date strings
        const parseTs = (v: unknown): Date => {
          if (v == null) return new Date();
          if (typeof v === "string" && v.includes("-")) return new Date(v);
          // Integer index from vectorbt — use backtest start date + offset
          return new Date(config.start_date + "T00:00:00Z");
        };

        const direction = (t["Direction"] as string ?? t["direction"] as string ?? "long");

        return {
          backtestId,
          entryTime: parseTs(entryTs),
          exitTime: exitTs != null ? parseTs(exitTs) : null,
          direction: direction.toLowerCase().includes("short") ? "short" : "long",
          entryPrice: String(t["Avg Entry Price"] ?? t["Entry Price"] ?? t["entry_price"] ?? 0),
          exitPrice: t["Avg Exit Price"] != null || t["Exit Price"] != null || t["exit_price"] != null
            ? String(t["Avg Exit Price"] ?? t["Exit Price"] ?? t["exit_price"])
            : null,
          pnl: t["PnL"] != null || t["pnl"] != null
            ? String(t["PnL"] ?? t["pnl"])
            : null,
          contracts: Math.round(Number(t["Size"] ?? t["size"] ?? 1)),
        };
      });

      await db.insert(backtestTrades).values(tradeRows);
    }

    // Audit log
    await db.insert(auditLog).values({
      action: "backtest.run",
      entityType: "backtest",
      entityId: backtestId,
      input: config as unknown as Record<string, unknown>,
      result: {
        total_return: result.total_return,
        sharpe_ratio: result.sharpe_ratio,
        total_trades: result.total_trades,
        tier: result.tier,
      },
      status: "success",
      durationMs: result.execution_time_ms,
    });

    // ─── Auto-promote to paper trading if strategy passes gates ───
    if (result.tier && ["TIER_1", "TIER_2", "TIER_3"].includes(result.tier)) {
      try {
        // Update strategy lifecycle to PAPER
        await db.update(strategies).set({
          lifecycleState: "PAPER",
          lifecycleChangedAt: new Date(),
          forgeScore: result.forge_score != null ? String(result.forge_score) : null,
        }).where(eq(strategies.id, strategyId));

        // Create paper trading session
        const [paperSession] = await db.insert(paperSessions).values({
          strategyId,
          startingCapital: "100000",
          currentEquity: "100000",
          config: {
            preferred_sessions: ["NY_RTH"],
            max_concurrent_positions: 1,
            cooldown_bars: 4,
            daily_loss_limit: 2000,
            backtestId,
            tier: result.tier,
            forge_score: result.forge_score,
          },
        }).returning();

        // Start live stream for the paper session
        try {
          startStream(paperSession.id, [config.strategy.symbol]);
        } catch (streamErr) {
          logger.warn(streamErr, "Auto-promoted session created but stream failed to start");
        }

        // Broadcast promotion event
        broadcastSSE("strategy:promoted", {
          strategyId,
          tier: result.tier,
          forgeScore: result.forge_score,
          paperSessionId: paperSession.id,
        });

        logger.info({
          strategyId,
          tier: result.tier,
          paperSessionId: paperSession.id,
        }, "Strategy auto-promoted to paper trading");

        await db.insert(auditLog).values({
          action: "strategy.auto-promote",
          entityType: "strategy",
          entityId: strategyId,
          input: { backtestId, tier: result.tier },
          result: { paperSessionId: paperSession.id },
          status: "success",
        });
      } catch (promoErr) {
        logger.error(promoErr, "Failed to auto-promote strategy to paper trading");
      }
    }

    return { id: backtestId, status: "completed", ...result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(backtests)
      .set({ status: "failed", errorMessage: errorMsg })
      .where(eq(backtests.id, backtestId));

    await db.insert(auditLog).values({
      action: "backtest.run",
      entityType: "backtest",
      entityId: backtestId,
      input: config as unknown as Record<string, unknown>,
      result: { error: errorMsg },
      status: "failure",
    });

    return { id: backtestId, status: "failed", error: errorMsg };
  }
}
