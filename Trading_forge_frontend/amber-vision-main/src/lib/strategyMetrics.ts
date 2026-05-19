import type { Backtest, BacktestTrade } from "@/types/api";

function n(v: string | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function avgWin(trades: BacktestTrade[] | undefined | null): number {
  if (!trades?.length) return 0;
  let sum = 0;
  let count = 0;
  for (const t of trades) {
    const pnl = n(t.pnl);
    if (pnl > 0) {
      sum += pnl;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

export function avgLoss(trades: BacktestTrade[] | undefined | null): number {
  if (!trades?.length) return 0;
  let sum = 0;
  let count = 0;
  for (const t of trades) {
    const pnl = n(t.pnl);
    if (pnl < 0) {
      sum += pnl;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

export function riskReward(trades: BacktestTrade[] | undefined | null): number {
  const aw = avgWin(trades);
  const al = avgLoss(trades);
  if (al === 0) return 0;
  return Math.abs(aw / al);
}

export interface StrategyCardMetrics {
  pnl: number;
  avgWin: number;
  avgLoss: number;
  sharpe: number;
  winRate: number;
  drawdown: number;
}

export function deriveCardMetrics(
  bt: Backtest | null | undefined,
  trades: BacktestTrade[] | undefined | null
): StrategyCardMetrics {
  return {
    pnl: bt ? n(bt.totalReturn) : 0,
    avgWin: avgWin(trades),
    avgLoss: avgLoss(trades),
    sharpe: bt ? n(bt.sharpeRatio) : 0,
    winRate: bt ? n(bt.winRate) : 0,
    drawdown: bt ? Math.abs(n(bt.maxDrawdown)) : 0,
  };
}

/**
 * Closed-form derivation of avg-win and avg-loss from backtest summary fields.
 * Used on list pages where fetching the trade ledger per card would explode requests.
 *
 *   Let p = winRate, pf = profitFactor, e = avgTradePnl
 *   p * avgWin + (1-p) * avgLoss = e        (expectancy identity)
 *   pf = (p * avgWin) / ((1-p) * |avgLoss|) (profit factor identity)
 *
 * Solving:
 *   avgWin  =  e * pf / (p * pf + (1 - p))
 *   avgLoss = -e      / (p * pf + (1 - p))
 *
 * Returns zeros when inputs are unusable.
 */
export function deriveCardMetricsFromBacktest(
  bt: Backtest | null | undefined
): StrategyCardMetrics {
  if (!bt) {
    return { pnl: 0, avgWin: 0, avgLoss: 0, sharpe: 0, winRate: 0, drawdown: 0 };
  }

  const pnl = n(bt.totalReturn);
  const sharpe = n(bt.sharpeRatio);
  const winRate = n(bt.winRate);
  const drawdown = Math.abs(n(bt.maxDrawdown));
  const expectancy = n(bt.avgTradePnl);
  const pf = n(bt.profitFactor);
  const p = winRate;

  let aw = 0;
  let al = 0;
  const denom = p * pf + (1 - p);
  if (Number.isFinite(denom) && denom > 0 && expectancy !== 0 && pf > 0 && p > 0 && p < 1) {
    aw = (expectancy * pf) / denom;
    al = -expectancy / denom;
  }

  return { pnl, avgWin: aw, avgLoss: al, sharpe, winRate, drawdown };
}

export function formatSignedPnl(value: number, opts?: { compact?: boolean }): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  if (opts?.compact && abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}k`;
  }
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  // Backtest winRate is stored 0-1; multiply if so.
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(0)}%`;
}
