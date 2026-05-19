import { useMemo } from "react";
import type { Backtest, BacktestTrade } from "@/types/api";
import type { DailyPnl } from "@/components/forge/ProfitCalendar";

interface Props {
  backtest: Backtest | null | undefined;
  dailyPnls: DailyPnl[];
  trades?: BacktestTrade[] | null;
  accountSize?: number;
}

function n(v: any): number {
  if (v == null) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmtUsd(v: number): string {
  if (v === 0) return "$0.00";
  const sign = v >= 0 ? "" : "-";
  const abs = Math.abs(v);
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtUsdShort(v: number): string {
  if (v === 0) return "$0";
  const sign = v >= 0 ? "" : "-";
  const abs = Math.abs(v);
  if (abs >= 10000) return `${v >= 0 ? "" : "-"}$${(abs / 1000).toFixed(2).replace(/\.00$/, "")}k`;
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number, dp = 2): string {
  return `${v >= 0 ? "" : "-"}${Math.abs(v).toFixed(dp)}%`;
}

function fmtHours(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const hrs = ms / (1000 * 60 * 60);
  if (hrs < 1) return `${(hrs * 60).toFixed(0)} min`;
  return `${hrs.toFixed(1)}h`;
}

export function EvaluationSummary({
  backtest,
  dailyPnls,
  trades,
  accountSize = 50000,
}: Props) {
  const stats = useMemo(() => {
    const totalTrades = backtest?.totalTrades ?? trades?.length ?? 0;

    // Trading-day stats (only days with at least one trade)
    const tradingDays = dailyPnls.filter((d) => (d.trades ?? 0) > 0 || d.pnl !== 0);
    const tradingDayCount = tradingDays.length;
    const totalPnl = tradingDays.reduce((sum, d) => sum + d.pnl, 0);
    const avgPerDay = tradingDayCount > 0 ? totalPnl / tradingDayCount : 0;

    let biggestWinner = 0;
    let biggestLoser = 0;
    let winningDays = 0;
    let losingDays = 0;
    for (const d of tradingDays) {
      if (d.pnl > biggestWinner) biggestWinner = d.pnl;
      if (d.pnl < biggestLoser) biggestLoser = d.pnl;
      if (d.pnl > 0) winningDays += 1;
      else if (d.pnl < 0) losingDays += 1;
    }

    // Total fees from trades when available
    let totalFees = 0;
    if (trades?.length) {
      for (const t of trades) {
        totalFees += n(t.commission);
      }
    }

    // Avg hold time from trades
    let avgHoldMs: number | null = null;
    if (trades?.length) {
      const durs = trades.map((t) => n(t.holdDurationMs)).filter((x) => x > 0);
      if (durs.length > 0) {
        avgHoldMs = durs.reduce((a, b) => a + b, 0) / durs.length;
      }
    }

    // Winrate w/o break-even
    let winrate = backtest ? n(backtest.winRate) * 100 : 0;
    if (trades?.length) {
      const decisive = trades.filter((t) => {
        const p = n(t.pnl);
        return p > 0.5 || p < -0.5; // exclude near-breakeven
      });
      const wins = decisive.filter((t) => n(t.pnl) > 0).length;
      if (decisive.length > 0) winrate = (wins / decisive.length) * 100;
    } else if (winrate <= 1) {
      winrate *= 100; // already multiplied above; this is a noop guard
    }

    // ROI vs account size
    const totalReturn = backtest ? n(backtest.totalReturn) : totalPnl;
    const roi = accountSize > 0 ? (totalReturn / accountSize) * 100 : 0;

    const maxDdDollars = backtest ? Math.abs(n(backtest.maxDrawdown)) : 0;
    const maxDdPct = accountSize > 0 ? (maxDdDollars / accountSize) * 100 : 0;

    return {
      totalTrades,
      tradingDayCount,
      avgPerDay,
      biggestWinner,
      biggestLoser,
      totalFees,
      avgHoldMs,
      winrate,
      roi,
      maxDdPct,
      maxDdDollars,
      winningDays,
      losingDays,
    };
  }, [backtest, dailyPnls, trades, accountSize]);

  const hasAnyData =
    !!backtest || dailyPnls.length > 0 || (trades && trades.length > 0);

  return (
    <div className="forge-card p-5 h-full">
      <h3 className="text-base font-semibold text-foreground tracking-tight mb-4">
        Evaluation
      </h3>

      <div className="space-y-3">
        <Row label="Total Number of Trades" value={hasAnyData ? stats.totalTrades.toLocaleString() : "—"} />
        <Row
          label="Avg. Profit per Trading Day"
          value={hasAnyData && stats.tradingDayCount > 0 ? fmtUsd(stats.avgPerDay) : "—"}
          tone={stats.avgPerDay > 0 ? "profit" : stats.avgPerDay < 0 ? "loss" : "neutral"}
        />
        <Row
          label="Biggest Winner"
          value={hasAnyData && stats.biggestWinner > 0 ? fmtUsd(stats.biggestWinner) : "—"}
          tone="profit"
        />
        <Row
          label="Biggest Loser"
          value={hasAnyData && stats.biggestLoser < 0 ? fmtUsd(stats.biggestLoser) : "—"}
          tone="loss"
        />
        <Row
          label="Total Fees"
          value={hasAnyData ? fmtUsd(stats.totalFees) : "—"}
        />
        <Row
          label="Avg. Hold Time (Hours)"
          value={hasAnyData ? fmtHours(stats.avgHoldMs) : "—"}
        />
        <Row
          label="Winrate w/o BE"
          value={hasAnyData && stats.winrate > 0 ? fmtPct(stats.winrate, 2) : "—"}
          tone={stats.winrate >= 60 ? "profit" : stats.winrate >= 50 ? "emerald" : "loss"}
        />
        <Row
          label="ROI"
          value={hasAnyData ? fmtPct(stats.roi, 2) : "—"}
          tone={stats.roi > 0 ? "profit" : "loss"}
        />
        <Row
          label="Max Drawdown"
          value={hasAnyData && stats.maxDdDollars > 0 ? fmtPct(stats.maxDdPct, 2) : "—"}
          tone="loss"
        />
        <Row
          label="Winning / Losing Days"
          value={
            hasAnyData
              ? `${stats.winningDays} / ${stats.losingDays}`
              : "—"
          }
          tone={stats.winningDays > stats.losingDays ? "profit" : "neutral"}
        />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss" | "emerald" | "neutral";
}) {
  const cls =
    tone === "profit" ? "text-profit"
    : tone === "loss" ? "text-loss"
    : tone === "emerald" ? "text-emerald"
    : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/10 pb-2.5 last:border-0">
      <span className="text-[12px] text-text-secondary">{label}</span>
      <span className={`text-[13px] font-mono font-semibold ${cls}`}>{value}</span>
    </div>
  );
}
