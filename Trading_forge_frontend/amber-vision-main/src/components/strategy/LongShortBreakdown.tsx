import { useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useBacktestTrades } from "@/hooks/useBacktests";

interface LongShortBreakdownProps {
  backtestId: string | undefined;
  resultExtras?: Record<string, unknown>;
}

interface SideMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  avgWin: number;
  avgLoss: number;
}

function emptyMetrics(): SideMetrics {
  return { trades: 0, wins: 0, losses: 0, winRate: 0, pnl: 0, avgWin: 0, avgLoss: 0 };
}

function computeSide(trades: { direction?: string; pnl?: string | number | null }[], side: "long" | "short"): SideMetrics {
  const filtered = trades.filter((t) => (t.direction ?? "").toLowerCase().startsWith(side));
  if (filtered.length === 0) return emptyMetrics();
  const pnls = filtered.map((t) => Number(t.pnl ?? 0)).filter((v) => Number.isFinite(v));
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p <= 0);
  return {
    trades: filtered.length,
    wins: wins.length,
    losses: losses.length,
    winRate: filtered.length > 0 ? (wins.length / filtered.length) * 100 : 0,
    pnl: pnls.reduce((s, v) => s + v, 0),
    avgWin: wins.length > 0 ? wins.reduce((s, v) => s + v, 0) / wins.length : 0,
    avgLoss: losses.length > 0 ? losses.reduce((s, v) => s + v, 0) / losses.length : 0,
  };
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function LongShortBreakdown({ backtestId, resultExtras }: LongShortBreakdownProps) {
  // Prefer backend-computed long_short_split when available (richer + already-asymmetry-flagged).
  // Falls back to client-side computation from trade list.
  const { data: trades } = useBacktestTrades(backtestId, { limit: 5000 });

  const split = useMemo(() => {
    const fromExtras = resultExtras?.long_short_split as
      | {
          long?: { trades?: number; win_rate?: number; pnl?: number; avg_winner?: number; avg_loser?: number };
          short?: { trades?: number; win_rate?: number; pnl?: number; avg_winner?: number; avg_loser?: number };
          directional_asymmetry_pp?: number;
          asymmetry_flag?: string;
          warnings?: string[];
        }
      | undefined;

    if (fromExtras?.long && fromExtras.short) {
      return {
        long: {
          trades: fromExtras.long.trades ?? 0,
          wins: Math.round((fromExtras.long.win_rate ?? 0) * (fromExtras.long.trades ?? 0)),
          losses: Math.round((1 - (fromExtras.long.win_rate ?? 0)) * (fromExtras.long.trades ?? 0)),
          winRate: (fromExtras.long.win_rate ?? 0) * 100,
          pnl: fromExtras.long.pnl ?? 0,
          avgWin: fromExtras.long.avg_winner ?? 0,
          avgLoss: fromExtras.long.avg_loser ?? 0,
        },
        short: {
          trades: fromExtras.short.trades ?? 0,
          wins: Math.round((fromExtras.short.win_rate ?? 0) * (fromExtras.short.trades ?? 0)),
          losses: Math.round((1 - (fromExtras.short.win_rate ?? 0)) * (fromExtras.short.trades ?? 0)),
          winRate: (fromExtras.short.win_rate ?? 0) * 100,
          pnl: fromExtras.short.pnl ?? 0,
          avgWin: fromExtras.short.avg_winner ?? 0,
          avgLoss: fromExtras.short.avg_loser ?? 0,
        },
        asymmetryPp: fromExtras.directional_asymmetry_pp ?? null,
        flag: fromExtras.asymmetry_flag ?? null,
        warnings: fromExtras.warnings ?? [],
      };
    }

    if (!trades?.length) return null;
    const long = computeSide(trades as { direction?: string; pnl?: string | number | null }[], "long");
    const short = computeSide(trades as { direction?: string; pnl?: string | number | null }[], "short");
    const asymmetryPp = Math.abs(long.winRate - short.winRate);
    let flag: string;
    if (long.trades < 30 || short.trades < 30) flag = "INSUFFICIENT_DATA";
    else if (asymmetryPp <= 5) flag = "BALANCED";
    else if (asymmetryPp <= 10) flag = "SLIGHT_TILT";
    else flag = "BIASED";
    return { long, short, asymmetryPp, flag, warnings: [] };
  }, [trades, resultExtras]);

  if (!split) {
    return (
      <div className="forge-card p-5">
        <h2 className="text-sm font-medium text-foreground mb-2">Long / Short Breakdown</h2>
        <p className="text-xs text-text-muted">No trades yet — run a backtest to see the bidirectional split.</p>
      </div>
    );
  }

  const flagColor =
    split.flag === "BALANCED"
      ? "text-profit border-profit/20 bg-profit/10"
      : split.flag === "SLIGHT_TILT"
      ? "text-amber-400 border-amber-400/20 bg-amber-400/10"
      : split.flag === "BIASED"
      ? "text-loss border-loss/20 bg-loss/10"
      : "text-text-muted border-border/20 bg-surface-2";

  const flagText =
    split.flag === "BALANCED"
      ? "Bidirectional alpha"
      : split.flag === "SLIGHT_TILT"
      ? "Slight directional tilt"
      : split.flag === "BIASED"
      ? "Directionally biased"
      : "Insufficient data";

  return (
    <div className="forge-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-medium text-foreground">Long / Short Breakdown</h2>
          <p className="text-[11px] text-text-muted mt-1">
            Bidirectional symmetry diagnostic (per QuantVue V2 deck page 10) — flags strategies that look profitable only because the underlying trended one direction.
          </p>
        </div>
        <span className={`text-[10px] font-medium uppercase tracking-wider px-2 py-1 rounded border ${flagColor}`}>
          {flagText}{split.asymmetryPp != null ? ` · ${split.asymmetryPp.toFixed(1)}pp gap` : ""}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/10">
        {(["long", "short"] as const).map((side) => {
          const m = split[side];
          const winColor = "hsl(var(--profit))";
          const lossColor = "hsl(var(--loss))";
          const data = [
            { name: "Wins", value: m.wins, color: winColor },
            { name: "Losses", value: m.losses, color: lossColor },
          ];
          return (
            <div key={side} className="flex items-center gap-4 p-4 rounded-lg bg-surface-0/50 border border-border/10">
              <div className="w-28 h-28 shrink-0">
                {m.trades > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={26} outerRadius={48} startAngle={90} endAngle={-270}>
                        {data.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--surface-2))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="w-full h-full rounded-full border border-dashed border-border/30 flex items-center justify-center text-[10px] text-text-muted">
                    No trades
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-text-muted">{side}</span>
                  <span className={`text-base font-mono font-semibold ${m.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                    {m.winRate.toFixed(1)}%
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <span className="text-text-muted">Trades</span>
                  <span className="font-mono text-foreground">{m.trades}</span>
                  <span className="text-text-muted">Net P&L</span>
                  <span className={`font-mono ${m.pnl >= 0 ? "text-profit" : "text-loss"}`}>{fmtUsd(m.pnl)}</span>
                  <span className="text-text-muted">Avg Win</span>
                  <span className="font-mono text-profit">{fmtUsd(m.avgWin)}</span>
                  <span className="text-text-muted">Avg Loss</span>
                  <span className="font-mono text-loss">{fmtUsd(m.avgLoss)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {split.warnings && split.warnings.length > 0 && (
        <div className="space-y-1 pt-3 border-t border-border/10">
          {split.warnings.map((w: string, i: number) => (
            <p key={i} className="text-[11px] text-amber-400/80">⚠ {w}</p>
          ))}
        </div>
      )}
    </div>
  );
}
