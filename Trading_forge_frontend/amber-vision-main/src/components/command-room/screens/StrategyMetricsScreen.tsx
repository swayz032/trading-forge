/**
 * Strategy Metrics screen — top deployed / paper strategy + headline numbers.
 *
 * Baby jargon translation (no trader friend required):
 *   - "Best worker right now" — replaces "Top deployed strategy"
 *   - "Money it makes per day" — replaces "Avg daily P&L"
 *   - "Risk-reward score" — replaces "Sharpe ratio" with verdict (poor/ok/good/great)
 *   - "Worst losing streak" — replaces "Max drawdown"
 */

import { useStrategies } from "@/hooks/useStrategies";
import { useBacktests } from "@/hooks/useBacktests";
import { useMemo } from "react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

function n(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const x = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(x) ? x : null;
}

function sharpeVerdict(s: number | null): { label: string; color: string } {
  if (s == null) return { label: "—", color: "#94a3b8" };
  if (s >= 2.0) return { label: "GREAT", color: "#10B981" };
  if (s >= 1.5) return { label: "GOOD", color: "#34D399" };
  if (s >= 1.0) return { label: "OK", color: "#facc15" };
  return { label: "WEAK", color: "#ef4444" };
}

const STATE_PRIORITY = ["DEPLOYED", "PILOT", "DEPLOY_READY", "PAPER", "TESTING"];

export function StrategyMetricsScreen() {
  const { data: strategies } = useStrategies();
  const { data: backtests } = useBacktests();

  const best = useMemo(() => {
    if (!strategies?.length) return null;
    const sorted = [...strategies].sort((a, b) => {
      const ai = STATE_PRIORITY.indexOf(a.lifecycleState);
      const bi = STATE_PRIORITY.indexOf(b.lifecycleState);
      const aOrder = ai === -1 ? 99 : ai;
      const bOrder = bi === -1 ? 99 : bi;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (n(b.rollingSharpe30d) ?? 0) - (n(a.rollingSharpe30d) ?? 0);
    });
    return sorted[0];
  }, [strategies]);

  const bestBacktest = useMemo(() => {
    if (!best || !backtests?.length) return null;
    return [...backtests]
      .filter((bt) => bt.strategyId === best.id && bt.status === "completed")
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0] ?? null;
  }, [best, backtests]);

  const sharpe = n(bestBacktest?.sharpeRatio) ?? n(best?.rollingSharpe30d ?? null);
  const verdict = sharpeVerdict(sharpe);
  const avgDaily = n(bestBacktest?.avgDailyPnl);
  const dd = n(bestBacktest?.maxDrawdown);
  const tier = bestBacktest?.tier;

  // Build a sparkline of the best strategy's last 12 backtest Sharpe values
  // so the wall TV has live motion the operator can scan from a distance.
  const sharpeSeries = useMemo(() => {
    if (!best || !backtests?.length) return [] as Array<{ x: number; y: number }>;
    return [...backtests]
      .filter((bt) => bt.strategyId === best.id && bt.status === "completed")
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      .slice(-12)
      .map((bt, i) => ({ x: i, y: n(bt.sharpeRatio) ?? 0 }));
  }, [best, backtests]);

  return (
    <>
      <div style={{ fontSize: 12, letterSpacing: "0.32em", color: "#10B981", fontWeight: 700 }}>
        BEST WORKER RIGHT NOW
      </div>
      <div style={{ fontSize: 28, fontWeight: 600, marginTop: 6, lineHeight: 1.1 }}>
        {best?.name ?? "No strategies yet"}
      </div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>
        {best ? `${best.symbol} · ${best.timeframe} · ${best.lifecycleState.toLowerCase().replace("_", " ")}` : "Add a strategy to see metrics"}
        {tier ? ` · ${tier.toUpperCase()}` : ""}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 22 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#64748b" }}>
            MAKES PER DAY
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: avgDaily != null && avgDaily > 0 ? "#10B981" : avgDaily != null && avgDaily < 0 ? "#ef4444" : "#e2e8f0" }}>
            {avgDaily != null ? `${avgDaily >= 0 ? "+" : ""}$${Math.round(avgDaily)}` : "—"}
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>per trading day</div>
        </div>

        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#64748b" }}>
            RISK-REWARD
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: verdict.color }}>
            {verdict.label}
          </div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
            {sharpe != null ? `Sharpe ${sharpe.toFixed(2)}` : "no data"}
          </div>
        </div>
      </div>

      {/* Sharpe trend sparkline — live motion, scannable from across the room */}
      {sharpeSeries.length > 1 && (
        <div style={{ marginTop: 14, height: 60 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#64748b", marginBottom: 4 }}>
            RISK-REWARD TREND · LAST {sharpeSeries.length} TESTS
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sharpeSeries} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <YAxis hide domain={[0, "dataMax + 0.3"]} />
              <Line
                type="monotone"
                dataKey="y"
                stroke="#10B981"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#64748b" }}>
          WORST LOSING STREAK
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, color: "#ef4444", marginTop: 2 }}>
          {dd != null ? `-$${Math.abs(Math.round(dd)).toLocaleString()}` : "—"}
        </div>
      </div>
    </>
  );
}
