import { motion } from "framer-motion";
import type { Backtest, BacktestTrade } from "@/types/api";
import { deriveCardMetrics, formatSignedPnl, formatPercent, riskReward } from "@/lib/strategyMetrics";

interface Props {
  backtest: Backtest | null | undefined;
  trades: BacktestTrade[] | undefined | null;
  loading?: boolean;
}

interface Tile {
  primary: string;
  primaryClass?: string;
  label: string;
  raw: string;
}

export function StrategyMetricsRow({ backtest, trades, loading }: Props) {
  const m = deriveCardMetrics(backtest, trades);
  const rr = riskReward(trades);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="forge-card p-4 h-[88px] animate-pulse" />
        ))}
      </div>
    );
  }

  const tiles: Tile[] = [
    {
      primary: m.avgWin > 0 ? formatSignedPnl(m.avgWin) : "—",
      primaryClass: m.avgWin > 0 ? "text-profit" : undefined,
      label: "Avg win",
      raw: "PnL Win",
    },
    {
      primary: m.avgLoss < 0 ? formatSignedPnl(m.avgLoss) : "—",
      primaryClass: m.avgLoss < 0 ? "text-loss" : undefined,
      label: "Avg loss",
      raw: "PnL Loss",
    },
    {
      primary: m.sharpe > 0 ? m.sharpe.toFixed(2) : "—",
      primaryClass: m.sharpe >= 1.5 ? "text-profit" : m.sharpe >= 1 ? "text-emerald" : undefined,
      label: "Edge quality",
      raw: "Sharpe",
    },
    {
      primary: rr > 0 ? `${rr.toFixed(2)} : 1` : "—",
      primaryClass: rr >= 1.5 ? "text-profit" : undefined,
      label: "Reward vs risk",
      raw: "R/R",
    },
    {
      primary: m.drawdown > 0 ? formatSignedPnl(-m.drawdown) : "—",
      primaryClass: "text-loss",
      label: "Worst dip",
      raw: "Max Drawdown",
    },
    {
      primary: m.winRate > 0 ? formatPercent(m.winRate) : "—",
      primaryClass: m.winRate >= 0.6 ? "text-profit" : undefined,
      label: "Win rate",
      raw: "Win %",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {tiles.map((t, i) => (
        <motion.div
          key={t.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: i * 0.04 }}
          className="forge-card p-4"
        >
          <p className="text-[10px] uppercase tracking-widest text-text-muted mb-1.5">
            {t.label}
          </p>
          <p className={`text-xl font-mono font-semibold tracking-tight ${t.primaryClass ?? "text-foreground"}`}>
            {t.primary}
          </p>
          <p className="text-[9px] text-text-muted/70 mt-1.5 tracking-wider">
            {t.raw}
          </p>
        </motion.div>
      ))}
    </div>
  );
}
