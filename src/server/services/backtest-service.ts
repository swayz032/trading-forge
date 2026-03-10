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
import { backtests, backtestTrades, auditLog } from "../db/schema.js";
import { logger } from "../index.js";

const PROJECT_ROOT = pathResolve(import.meta.dirname ?? ".", "../..");

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
  start_date: string;
  end_date: string;
  slippage_ticks?: number;
  commission_per_side?: number;
  mode?: "single" | "walkforward";
  walk_forward_splits?: number;
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
  equity_curve: number[];
  trades: Array<Record<string, unknown>>;
  daily_pnls: number[];
  execution_time_ms: number;
  tier?: string;
  forge_score?: number;
  walk_forward_results?: Record<string, unknown>;
  prop_compliance?: Record<string, unknown>;
  error?: string;
}

function runPythonBacktest(configJson: string, mode: string, backtestId: string): Promise<BacktestResult> {
  return new Promise((resolve, reject) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const args = [
      "-m", "src.engine.backtester",
      "--config", configJson,
      "--backtest-id", backtestId,
      "--mode", mode,
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

export async function runBacktest(strategyId: string, config: BacktestConfig) {
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
    const result = await runPythonBacktest(configJson, mode, backtestId);

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
        dailyPnls: result.daily_pnls,
        walkForwardResults: result.walk_forward_results ?? null,
        propCompliance: result.prop_compliance ?? null,
        executionTimeMs: result.execution_time_ms,
      })
      .where(eq(backtests.id, backtestId));

    // Bulk insert trades
    if (result.trades.length > 0) {
      const tradeRows = result.trades.map((t) => ({
        backtestId,
        entryTime: new Date(t["Entry Timestamp"] as string || t["entry_time"] as string || new Date()),
        exitTime: t["Exit Timestamp"] || t["exit_time"]
          ? new Date(t["Exit Timestamp"] as string || t["exit_time"] as string)
          : null,
        direction: (t["Direction"] as string || t["direction"] as string || "long").toLowerCase().includes("short") ? "short" : "long",
        entryPrice: String(t["Entry Price"] ?? t["entry_price"] ?? 0),
        exitPrice: t["Exit Price"] != null || t["exit_price"] != null
          ? String(t["Exit Price"] ?? t["exit_price"])
          : null,
        pnl: t["PnL"] != null || t["pnl"] != null
          ? String(t["PnL"] ?? t["pnl"])
          : null,
        contracts: 1,
      }));

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
