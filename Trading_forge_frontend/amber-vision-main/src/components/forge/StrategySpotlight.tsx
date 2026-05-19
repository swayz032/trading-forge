import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { Check, X } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { num, dollarsToPoints, fmtPoints, CONTRACT_SPECS } from "@/lib/utils";
import { useAllFirmAccounts } from "@/hooks/usePropFirm";
import type { Backtest, BacktestTrade } from "@/types/api";
import type { LeaderboardRow } from "./StrategyLeaderboard";

interface Props {
  row: LeaderboardRow | null;
  backtest: Backtest | null;
  trades: BacktestTrade[];
}

const FALLBACK_FIRMS: { name: string; display: string; profitTarget: number; ddLimit: number }[] = [
  { name: "topstep",  display: "Topstep",        profitTarget: 3000, ddLimit: 2000 },
  { name: "mffu",     display: "MFFU",            profitTarget: 3000, ddLimit: 2500 },
  { name: "tpt",      display: "TPT",             profitTarget: 3000, ddLimit: 2500 },
  { name: "apex",     display: "Apex",            profitTarget: 3000, ddLimit: 2500 },
  { name: "ffn",      display: "FFN",             profitTarget: 3000, ddLimit: 2500 },
  { name: "alpha",    display: "Alpha Futures",   profitTarget: 3000, ddLimit: 2000 },
  { name: "tradeify", display: "Tradeify",        profitTarget: 3000, ddLimit: 2500 },
  { name: "e2t",      display: "Earn2Trade",      profitTarget: 3000, ddLimit: 2000 },
];

const DailyPnlTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const pts = payload[0].value;
    return (
      <div className="glass rounded-lg border border-border/30 px-3 py-2">
        <p className="text-xs text-text-muted">{payload[0].payload.day}</p>
        <p className={`text-sm font-mono font-semibold ${pts >= 0 ? "text-profit" : "text-loss"}`}>
          {fmtPoints(pts)}
        </p>
      </div>
    );
  }
  return null;
};

export function StrategySpotlight({ row, backtest, trades }: Props) {
  const { data: firmAccounts } = useAllFirmAccounts();

  const symbol = row?.symbol || "ES";

  const dailyPnlBars = useMemo(() => {
    if (!row) return [];
    if (!trades.length) {
      if (backtest?.dailyPnls && Array.isArray(backtest.dailyPnls)) {
        return backtest.dailyPnls.slice(-30).map((pnl: number, i: number) => ({
          day: `D${i + 1}`,
          pts: dollarsToPoints(pnl, symbol, 1),
        }));
      }
      return [];
    }
    const dayMap = new Map<string, number>();
    for (const t of trades) {
      const d = (t.exitTime ?? t.entryTime)?.slice(0, 10);
      if (d) dayMap.set(d, (dayMap.get(d) ?? 0) + num(t.pnl));
    }
    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, dollarPnl]) => ({
        day: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        pts: dollarsToPoints(dollarPnl, symbol, 1),
      }));
  }, [trades, backtest, symbol, row]);

  const firmGrid = useMemo(() => {
    if (!row) return [];
    const maxDdDollars = Math.abs(num(backtest?.maxDrawdown));
    const ddDollars = maxDdDollars < 1 ? maxDdDollars * 50000
      : maxDdDollars <= 100 ? (maxDdDollars / 100) * 50000
      : maxDdDollars;

    const firms = firmAccounts?.length
      ? firmAccounts.map((fa) => ({
          name: fa.firm, display: fa.displayName,
          profitTarget: fa.config.profitTarget, ddLimit: fa.config.maxDrawdown,
        }))
      : FALLBACK_FIRMS;

    const tightest = firms.reduce((min, f) => f.profitTarget < min ? f.profitTarget : min, firms[0]?.profitTarget ?? 3000);

    return firms.map((firm) => {
      const passes = ddDollars < firm.ddLimit;
      const daysToPass = row.daysToPass != null && tightest > 0
        ? Math.ceil(firm.profitTarget / (tightest / row.daysToPass))
        : null;
      return { ...firm, passes, daysToPass };
    });
  }, [backtest, row, firmAccounts]);

  const passCount = firmGrid.filter((f) => f.passes).length;

  const crisisResults = useMemo(() => {
    const cr = (backtest as any)?.crisisResults ?? (backtest?.walkForwardResults as any)?.crisis_results;
    if (!cr || !Array.isArray(cr)) return null;
    return cr as Array<{ name: string; passed: boolean }>;
  }, [backtest]);

  const decayAnalysis = useMemo(() => {
    return backtest?.decayAnalysis ?? null;
  }, [backtest]);


  if (!row) {
    return (
      <div className="forge-card p-6 flex items-center justify-center h-full min-h-[400px]">
        <p className="text-sm text-text-muted">Click a strategy above to see details</p>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={row.id}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -12 }}
        transition={{ duration: 0.25 }}
        className="forge-card p-5 space-y-5 overflow-y-auto"
        style={{ maxHeight: "calc(100vh - 160px)" }}
      >
        {/* ── Header ── */}
        <div>
          <h2 className="text-lg font-semibold text-foreground">{row.name}</h2>
          <p className="text-sm text-text-muted mt-0.5">{row.symbol} · {row.timeframe}</p>
        </div>

        {/* ── Key Stats ── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-surface-0/60 rounded-lg px-3 py-2.5 text-center">
            <p className="text-xl font-mono font-bold text-foreground">
              {row.avgPtsPerTrade > 0 ? row.avgPtsPerTrade.toFixed(1) : "--"}
            </p>
            <p className="text-[11px] text-text-muted mt-0.5">pts / trade</p>
          </div>
          <div className="bg-surface-0/60 rounded-lg px-3 py-2.5 text-center">
            <p className={`text-xl font-mono font-bold ${row.winRate >= 60 ? "text-profit" : row.winRate > 0 ? "text-foreground" : "text-text-muted"}`}>
              {row.winRate > 0 ? `${row.winRate.toFixed(0)}%` : "--"}
            </p>
            <p className="text-[11px] text-text-muted mt-0.5">win rate</p>
          </div>
          <div className="bg-surface-0/60 rounded-lg px-3 py-2.5 text-center">
            <p className={`text-xl font-mono font-bold ${passCount === 8 ? "text-profit" : passCount > 0 ? "text-primary" : "text-text-muted"}`}>
              {passCount}/8
            </p>
            <p className="text-[11px] text-text-muted mt-0.5">firms passing</p>
          </div>
        </div>

        {/* ── Daily P&L ── */}
        <div>
          <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2">Daily P&L</h3>
          {dailyPnlBars.length > 0 ? (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={dailyPnlBars}>
                <XAxis dataKey="day" tick={false} axisLine={false} />
                <YAxis hide />
                <Tooltip content={<DailyPnlTooltip />} />
                <ReferenceLine y={0} stroke="hsl(240, 5%, 20%)" />
                <Bar dataKey="pts" radius={[2, 2, 0, 0]}>
                  {dailyPnlBars.map((d, i) => (
                    <Cell key={i} fill={d.pts >= 0 ? "hsl(142, 70%, 45%)" : "hsl(0, 70%, 50%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-text-muted text-center py-3">No trades yet — run a backtest first</p>
          )}
        </div>

        {/* ── Firms: Simple Pass/Fail ── */}
        <div>
          <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2">Passing Firms</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {firmGrid.map((f) => (
              <div
                key={f.name}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                  f.passes
                    ? "bg-profit/5 border border-profit/15"
                    : "bg-surface-0/40 border border-border/10"
                }`}
              >
                {f.passes ? (
                  <Check className="w-3.5 h-3.5 text-profit flex-shrink-0" />
                ) : (
                  <X className="w-3.5 h-3.5 text-text-muted/40 flex-shrink-0" />
                )}
                <span className={`text-[12px] font-medium ${f.passes ? "text-foreground" : "text-text-muted"}`}>
                  {f.display}
                </span>
                {f.passes && f.daysToPass && (
                  <span className="text-[10px] font-mono text-profit ml-auto">{f.daysToPass}d</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Crash Tested ── */}
        {crisisResults && (
          <div>
            <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2">Crash Tested</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {crisisResults.map((cr, i) => (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-0/30">
                  {cr.passed ? (
                    <Check className="w-3 h-3 text-profit flex-shrink-0" />
                  ) : (
                    <X className="w-3 h-3 text-loss flex-shrink-0" />
                  )}
                  <span className="text-[11px] text-foreground truncate">{cr.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Strategy Health ── */}
        {decayAnalysis && (
          <div>
            <h3 className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2">Strategy Health</h3>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-0/40">
              <span className={`text-lg font-mono font-bold ${
                decayAnalysis.compositeScore > 60 ? "text-loss" :
                decayAnalysis.compositeScore > 30 ? "text-primary" : "text-profit"
              }`}>
                {decayAnalysis.compositeScore > 60 ? "Weak" :
                 decayAnalysis.compositeScore > 30 ? "OK" : "Strong"}
              </span>
              {decayAnalysis.trend && (
                <span className={`text-xs ${
                  decayAnalysis.trend === "improving" ? "text-profit" :
                  decayAnalysis.trend === "accelerating_decline" ? "text-loss" : "text-text-muted"
                }`}>
                  {decayAnalysis.trend === "improving" ? "Getting better" :
                   decayAnalysis.trend === "accelerating_decline" ? "Getting worse" : "Steady"}
                </span>
              )}
            </div>
          </div>
        )}

      </motion.div>
    </AnimatePresence>
  );
}
