/**
 * Canonical schema for walk-forward window OOS metrics.
 *
 * 9-field contract (total_trading_days is optional — not always populated
 * for intraday strategies with sparse daily P&L records).
 *
 * This schema is the authoritative contract between:
 *   - Python engine (walk_forward.py) → produces these fields
 *   - DB persistence (backtest-service.ts) → validates before insert
 *   - Downstream consumers (critic, prop sim, portfolio optimizer)
 */

import { z } from "zod";

export const WFWindowMetricsSchema = z.object({
  /** Annualised Sharpe ratio computed from OOS daily P&Ls */
  sharpe_ratio: z.number(),
  /** Gross-wins / gross-losses ratio across all OOS trades */
  profit_factor: z.number(),
  /** Maximum peak-to-trough drawdown over the OOS window ($) */
  max_drawdown: z.number(),
  /** Fraction of OOS trades that closed with positive P&L */
  win_rate: z.number(),
  /** Total number of OOS trades executed */
  total_trades: z.number().int(),
  /** Mean daily P&L over OOS trading days */
  avg_daily_pnl: z.number(),
  /** Sum of all OOS trade P&Ls ($) */
  total_return: z.number(),
  /** total_return / total_trades — average P&L per trade ($) */
  avg_trade_pnl: z.number(),
  /** Calendar trading days in the OOS window (optional — may be absent for
   *  intraday strategies that do not populate daily_pnls on every session) */
  total_trading_days: z.number().int().optional(),
});

export type WFWindowMetrics = z.infer<typeof WFWindowMetricsSchema>;

/**
 * Alias for WFWindowMetricsSchema — consumers may import either name.
 * WFWindowOosMetricsSchema is the public-facing name for the canonical OOS
 * metrics contract; WFWindowMetricsSchema is the internal backtest-service name.
 * Both refer to the same shape — do not diverge them.
 */
export const WFWindowOosMetricsSchema = WFWindowMetricsSchema;
export type WFWindowOosMetrics = WFWindowMetrics;
