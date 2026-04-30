import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  ChevronRight, BarChart3, Activity, Crosshair, Route,
  Check, X, Minus, Loader2,
} from "lucide-react";
import { TradingViewWidget } from "@/components/forge/TradingViewWidget";
import { StrategyLeaderboard } from "@/components/forge/StrategyLeaderboard";
import { StrategySpotlight } from "@/components/forge/StrategySpotlight";
import { useStrategies } from "@/hooks/useStrategies";
import { useBacktests, useBacktestTrades } from "@/hooks/useBacktests";
import { useMonteCarlo } from "@/hooks/useMonteCarlo";
import { useSSE } from "@/hooks/useSSE";
import type { LeaderboardRow } from "@/components/forge/StrategyLeaderboard";
import { num, dollarsToPoints, fmtPoints } from "@/lib/utils";

// ── Session ──
function getETTime() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function getSession() {
  const et = getETTime();
  const d = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
  if (d === 0 || d === 6) return { label: "CLOSED", color: "text-text-muted", dot: "bg-text-muted/50" };
  if (mins >= 570 && mins < 960) return { label: "RTH OPEN", color: "text-profit", dot: "bg-profit" };
  if (mins >= 480 && mins < 570) return { label: "PRE-MARKET", color: "text-primary", dot: "bg-primary" };
  if (mins >= 1080 || mins < 480) return { label: "OVERNIGHT", color: "text-info", dot: "bg-info" };
  return { label: "CLOSED", color: "text-text-muted", dot: "bg-text-muted/50" };
}
function formatET() {
  return getETTime().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function Dashboard() {
  // SSE: keep dashboard fresh on strategy/health/risk events
  useSSE([
    "alert:new",
    "strategy:promoted",
    "strategy:analyzed",
    "strategy:drift-alert",
    "backtest:completed",
    "paper:kill-switch-tripped",
    "paper:auto_stopped",
    "paper:auto_recovered",
  ]);

  const [etTime, setEtTime] = useState(formatET());
  const [session, setSession] = useState(getSession());
  useEffect(() => {
    const iv = setInterval(() => { setEtTime(formatET()); setSession(getSession()); }, 1000);
    return () => clearInterval(iv);
  }, []);

  const { data: strategies, isLoading: sLoad } = useStrategies();
  const { data: backtests, isLoading: bLoad } = useBacktests();
  const [selectedRow, setSelectedRow] = useState<LeaderboardRow | null>(null);
  const { data: selectedTrades } = useBacktestTrades(selectedRow?.backtestId ?? undefined);

  const selectedBacktest = useMemo(() => {
    if (!selectedRow?.backtestId || !backtests) return null;
    return backtests.find((bt) => bt.id === selectedRow.backtestId) ?? null;
  }, [selectedRow, backtests]);

  // MC data for selected strategy's backtest
  const { data: mcRuns } = useMonteCarlo(
    selectedRow?.backtestId ? { backtestId: selectedRow.backtestId } : undefined
  );
  const latestMC = useMemo(() => {
    if (!mcRuns?.length) return null;
    return mcRuns[0];
  }, [mcRuns]);

  // ── Pipeline counts ──
  const pipeline = useMemo(() => {
    const s = strategies ?? [];
    return {
      scouted: s.filter((x) => x.lifecycleState === "CANDIDATE").length,
      testing: s.filter((x) => x.lifecycleState === "TESTING").length,
      paper: s.filter((x) => x.lifecycleState === "PAPER").length,
      funded: s.filter((x) => x.lifecycleState === "DEPLOYED").length,
    };
  }, [strategies]);

  // ── Panel 1: Trade Breakdown stats ──
  const tradeStats = useMemo(() => {
    if (!selectedRow || !selectedBacktest) return null;

    const bt = selectedBacktest;
    const symbol = selectedRow.symbol || "ES";
    const trades = selectedTrades ?? [];

    const totalTrades = bt.totalTrades ?? 0;
    const winRate = num(bt.winRate) * 100;
    const profitFactor = num(bt.profitFactor);
    const sharpe = num(bt.sharpeRatio);
    const maxDdDollars = Math.abs(num(bt.maxDrawdown));
    const maxDdPts = maxDdDollars > 0 ? dollarsToPoints(maxDdDollars, symbol, 1) : 0;
    const expectancyDollars = num(bt.avgTradePnl);
    const expectancyPts = expectancyDollars !== 0 ? dollarsToPoints(expectancyDollars, symbol, 1) : 0;

    // Compute net P&L from totalReturn or sum of trades
    const totalReturnDollars = num(bt.totalReturn);
    const netPnlPts = totalReturnDollars !== 0
      ? dollarsToPoints(totalReturnDollars, symbol, 1)
      : 0;

    // Compute per-trade stats from trades array
    let avgWinnerPts = 0;
    let avgLoserPts = 0;
    let largestWinPts = 0;
    let largestLossPts = 0;
    let rr = 0;

    if (trades.length > 0) {
      const winners: number[] = [];
      const losers: number[] = [];

      for (const t of trades) {
        const pnlDollars = num(t.pnl);
        const pnlPts = dollarsToPoints(pnlDollars, symbol, t.contracts || 1);
        if (pnlPts >= 0) {
          winners.push(pnlPts);
        } else {
          losers.push(pnlPts);
        }
      }

      if (winners.length > 0) {
        avgWinnerPts = winners.reduce((a, b) => a + b, 0) / winners.length;
        largestWinPts = Math.max(...winners);
      }
      if (losers.length > 0) {
        avgLoserPts = losers.reduce((a, b) => a + b, 0) / losers.length;
        largestLossPts = Math.min(...losers);
      }
      if (avgLoserPts !== 0) {
        rr = Math.abs(avgWinnerPts / avgLoserPts);
      }
    }

    return {
      totalTrades,
      netPnlPts,
      winRate,
      profitFactor,
      expectancyPts,
      maxDdPts,
      rr,
      avgWinnerPts,
      avgLoserPts,
      largestWinPts,
      largestLossPts,
      sharpe,
    };
  }, [selectedRow, selectedBacktest, selectedTrades]);

  // ── Panel 3: Journey stages ──
  const journeyStages = useMemo(() => {
    if (!selectedRow) return null;

    const bt = selectedBacktest;
    const symbol = selectedRow.symbol || "ES";
    const lifecycle = strategies?.find((s) => s.id === selectedRow.strategyId)?.lifecycleState ?? "CANDIDATE";

    // Backtest stage
    const btNetPnl = bt ? dollarsToPoints(num(bt.totalReturn), symbol, 1) : 0;
    const btTotalTrades = bt?.totalTrades ?? 0;
    const btWinRate = num(bt?.winRate) * 100;
    const btForgeScore = num(bt?.forgeScore);
    const btStatus: "passed" | "running" | "not_started" =
      bt?.status === "completed" ? "passed" :
      bt?.status === "running" ? "running" : "not_started";

    // Monte Carlo stage
    const mcSurvival = latestMC ? (1 - num(latestMC.probabilityOfRuin)) * 100 : null;
    const mcMedian = latestMC ? num(latestMC.sharpeP50) : null;
    const mcWorst = latestMC ? num(latestMC.maxDrawdownP95) : null;
    const mcStatus: "passed" | "not_run" =
      latestMC ? "passed" : "not_run";

    // Eval stage — based on lifecycle
    const evalStatus: "passed" | "in_progress" | "not_started" =
      lifecycle === "DEPLOYED" ? "passed" :
      lifecycle === "PAPER" || lifecycle === "TESTING" ? "in_progress" : "not_started";

    // Buffer stage
    const bufferStatus: "passed" | "building" | "not_started" =
      lifecycle === "DEPLOYED" ? "building" : "not_started";

    // Payout stage
    const payoutStatus: "active" | "not_started" =
      lifecycle === "DEPLOYED" ? "active" : "not_started";

    return {
      backtest: { netPnl: btNetPnl, totalTrades: btTotalTrades, winRate: btWinRate, forgeScore: btForgeScore, status: btStatus },
      monteCarlo: { survivalRate: mcSurvival, medianOutcome: mcMedian, worstCase: mcWorst, status: mcStatus },
      eval: { profitTarget: 3000, earned: 0, days: 0, status: evalStatus },
      buffer: { target: 2500, built: 0, status: bufferStatus },
      payout: { totalWithdrawn: 0, monthlyAvg: 0, split: 90, status: payoutStatus },
    };
  }, [selectedRow, selectedBacktest, latestMC, strategies]);

  if (sLoad || bLoad) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <div className="w-3 h-3 rounded-full bg-primary animate-pulse mx-auto mb-3" />
          <p className="text-sm text-text-secondary">Loading strategies...</p>
        </div>
      </div>
    );
  }

  const hasStrategies = (strategies ?? []).length > 0;

  return (
    <div className="space-y-4 max-w-[1600px]">

      {/* ROW 1: Header + Ticker Tape */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-foreground">Command Center</h1>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-surface-1 border border-border/20">
              <span className={`w-2 h-2 rounded-full ${session.dot} status-dot`} />
              <span className={`text-xs font-semibold uppercase tracking-wider ${session.color}`}>{session.label}</span>
              <span className="text-xs font-mono text-text-muted">{etTime} ET</span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="font-mono text-info font-bold">{pipeline.scouted}</span>
            <span className="text-text-muted">scouted</span>
            <ChevronRight className="w-3 h-3 text-text-muted/30" />
            <span className="font-mono text-primary font-bold">{pipeline.testing}</span>
            <span className="text-text-muted">testing</span>
            <ChevronRight className="w-3 h-3 text-text-muted/30" />
            <span className="font-mono text-regime font-bold">{pipeline.paper}</span>
            <span className="text-text-muted">paper</span>
            <ChevronRight className="w-3 h-3 text-text-muted/30" />
            <span className="font-mono text-profit font-bold">{pipeline.funded}</span>
            <span className="text-text-muted">funded</span>
          </div>
        </div>
        <div className="rounded-lg overflow-hidden">
          <TradingViewWidget type="ticker-tape" />
        </div>
      </motion.div>

      {/* ROW 2: Strategy Scoreboard */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1 }}
        style={{ minHeight: 200 }}
      >
        {hasStrategies ? (
          <StrategyLeaderboard
            strategies={strategies ?? []}
            backtests={backtests ?? []}
            selectedId={selectedRow?.id ?? null}
            onSelect={setSelectedRow}
          />
        ) : (
          <div className="forge-card p-8 text-center">
            <p className="text-sm text-text-muted">No strategies yet — run the scout pipeline to discover strategies</p>
          </div>
        )}
      </motion.div>

      {/* ROW 3: Three Detail Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Panel 1 — Trade Breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.15 }}
          className="forge-card p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-text-muted" />
            <span className="text-xs uppercase tracking-widest text-text-muted font-medium">Trade Breakdown</span>
          </div>

          {!selectedRow ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-text-muted">Click a strategy above</p>
            </div>
          ) : !tradeStats ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-text-muted">No backtest data</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Total Trades" value={tradeStats.totalTrades > 0 ? tradeStats.totalTrades.toLocaleString() : "--"} />
                <StatTile
                  label="Net P&L"
                  value={tradeStats.netPnlPts !== 0 ? fmtPoints(tradeStats.netPnlPts) : "--"}
                  color={tradeStats.netPnlPts > 0 ? "text-profit" : tradeStats.netPnlPts < 0 ? "text-loss" : undefined}
                />
                <StatTile
                  label="Win Rate"
                  value={tradeStats.winRate > 0 ? `${tradeStats.winRate.toFixed(0)}%` : "--"}
                  color={tradeStats.winRate >= 60 ? "text-profit" : undefined}
                />
                <StatTile
                  label="Profit Factor"
                  value={tradeStats.profitFactor > 0 ? `${tradeStats.profitFactor.toFixed(1)}x` : "--"}
                  color={tradeStats.profitFactor >= 2 ? "text-profit" : undefined}
                />
                <StatTile
                  label="Expectancy"
                  value={tradeStats.expectancyPts !== 0 ? `${tradeStats.expectancyPts >= 0 ? "+" : ""}${tradeStats.expectancyPts.toFixed(1)} pts/trade` : "--"}
                  color={tradeStats.expectancyPts > 0 ? "text-profit" : tradeStats.expectancyPts < 0 ? "text-loss" : undefined}
                />
                <StatTile
                  label="Max DD"
                  value={tradeStats.maxDdPts > 0 ? `-${tradeStats.maxDdPts.toFixed(1)} pts` : "--"}
                  color="text-loss"
                />
                <StatTile
                  label="R:R"
                  value={tradeStats.rr > 0 ? `${tradeStats.rr.toFixed(1)}:1` : "--"}
                  color={tradeStats.rr >= 1.5 ? "text-profit" : undefined}
                />
                <StatTile
                  label="Avg Winner"
                  value={tradeStats.avgWinnerPts > 0 ? `+${tradeStats.avgWinnerPts.toFixed(1)} pts` : "--"}
                  color="text-profit"
                />
                <StatTile
                  label="Avg Loser"
                  value={tradeStats.avgLoserPts < 0 ? `${tradeStats.avgLoserPts.toFixed(1)} pts` : "--"}
                  color="text-loss"
                />
                <StatTile
                  label="Largest Win"
                  value={tradeStats.largestWinPts > 0 ? `+${tradeStats.largestWinPts.toFixed(1)} pts` : "--"}
                  color="text-profit"
                />
                <StatTile
                  label="Largest Loss"
                  value={tradeStats.largestLossPts < 0 ? `${tradeStats.largestLossPts.toFixed(1)} pts` : "--"}
                  color="text-loss"
                />
                <StatTile
                  label="Sharpe"
                  value={tradeStats.sharpe > 0 ? tradeStats.sharpe.toFixed(1) : "--"}
                  color={tradeStats.sharpe >= 2 ? "text-profit" : tradeStats.sharpe >= 1.5 ? "text-primary" : undefined}
                />
              </div>

              {/* Monte Carlo summary */}
              {latestMC && (
                <div className="pt-2 border-t border-border/10">
                  <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">Monte Carlo</p>
                  <div className="grid grid-cols-2 gap-2">
                    <StatTile
                      label="Survival"
                      value={`${((1 - num(latestMC.probabilityOfRuin)) * 100).toFixed(0)}%`}
                      color={num(latestMC.probabilityOfRuin) < 0.1 ? "text-profit" : "text-loss"}
                    />
                    <StatTile
                      label="Median Sharpe"
                      value={num(latestMC.sharpeP50) > 0 ? num(latestMC.sharpeP50).toFixed(2) : "--"}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>

        {/* Panel 2 — Strategy Spotlight */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.2 }}
        >
          <StrategySpotlight
            row={selectedRow}
            backtest={selectedBacktest}
            trades={selectedTrades ?? []}
          />
        </motion.div>

        {/* Panel 3 — Strategy Journey */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.25 }}
          className="forge-card p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <Route className="w-4 h-4 text-text-muted" />
            <span className="text-xs uppercase tracking-widest text-text-muted font-medium">Strategy Journey</span>
          </div>

          {!selectedRow ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-text-muted">Click a strategy above</p>
            </div>
          ) : !journeyStages ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-text-muted">No data yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* BACKTEST */}
              <JourneyStage
                label="BACKTEST"
                status={journeyStages.backtest.status === "passed" ? "green" : journeyStages.backtest.status === "running" ? "amber" : "grey"}
                items={journeyStages.backtest.status !== "not_started" ? [
                  { label: "Net P&L", value: journeyStages.backtest.netPnl !== 0 ? fmtPoints(journeyStages.backtest.netPnl) : "--" },
                  { label: "Trades", value: journeyStages.backtest.totalTrades > 0 ? journeyStages.backtest.totalTrades.toLocaleString() : "--" },
                  { label: "Win Rate", value: journeyStages.backtest.winRate > 0 ? `${journeyStages.backtest.winRate.toFixed(0)}%` : "--" },
                  { label: "Forge Score", value: journeyStages.backtest.forgeScore > 0 ? journeyStages.backtest.forgeScore.toFixed(0) : "--" },
                ] : undefined}
              />

              {/* MONTE CARLO */}
              <JourneyStage
                label="MONTE CARLO"
                status={journeyStages.monteCarlo.status === "passed" ? "green" : "grey"}
                items={journeyStages.monteCarlo.status === "passed" ? [
                  { label: "Survival", value: journeyStages.monteCarlo.survivalRate != null ? `${journeyStages.monteCarlo.survivalRate.toFixed(0)}%` : "--" },
                  { label: "Median", value: journeyStages.monteCarlo.medianOutcome != null ? journeyStages.monteCarlo.medianOutcome.toFixed(2) : "--" },
                  { label: "Worst Case", value: journeyStages.monteCarlo.worstCase != null ? `$${Math.abs(journeyStages.monteCarlo.worstCase).toLocaleString()}` : "--" },
                ] : undefined}
              />

              {/* EVAL */}
              <JourneyStage
                label="EVAL"
                status={journeyStages.eval.status === "passed" ? "green" : journeyStages.eval.status === "in_progress" ? "amber" : "grey"}
                progress={journeyStages.eval.status !== "not_started" ? {
                  current: journeyStages.eval.earned,
                  target: journeyStages.eval.profitTarget,
                  label: `$${journeyStages.eval.earned.toLocaleString()} / $${journeyStages.eval.profitTarget.toLocaleString()}`,
                } : undefined}
              />

              {/* BUFFER */}
              <JourneyStage
                label="BUFFER"
                status={journeyStages.buffer.status === "passed" ? "green" : journeyStages.buffer.status === "building" ? "amber" : "grey"}
                progress={journeyStages.buffer.status !== "not_started" ? {
                  current: journeyStages.buffer.built,
                  target: journeyStages.buffer.target,
                  label: `$${journeyStages.buffer.built.toLocaleString()} / $${journeyStages.buffer.target.toLocaleString()}`,
                } : undefined}
              />

              {/* PAYOUT */}
              <JourneyStage
                label="PAYOUT"
                status={journeyStages.payout.status === "active" ? "green" : "grey"}
                items={journeyStages.payout.status === "active" ? [
                  { label: "Withdrawn", value: `$${journeyStages.payout.totalWithdrawn.toLocaleString()}` },
                  { label: "Monthly Avg", value: `$${journeyStages.payout.monthlyAvg.toLocaleString()}` },
                  { label: "Split", value: `${journeyStages.payout.split}%` },
                ] : undefined}
              />
            </div>
          )}
        </motion.div>
      </div>

      {/* ROW 4: Your Markets — ES, NQ, CL */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.3 }}
      >
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-4 h-4 text-text-muted" />
          <span className="text-xs uppercase tracking-widest text-text-muted font-medium">Your Markets</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { symbol: "FOREXCOM:SPXUSD", label: "ES", name: "S&P 500 Futures" },
            { symbol: "FOREXCOM:NSXUSD", label: "NQ", name: "Nasdaq Futures" },
            { symbol: "TVC:USOIL", label: "CL", name: "Crude Oil" },
          ].map((mkt) => (
            <div key={mkt.symbol} className="forge-card overflow-hidden">
              <div style={{ height: 220 }}>
                <TradingViewWidget type="symbol-chart" symbol={mkt.symbol} height={220} />
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ── Stat Tile (for Trade Breakdown grid) ──
function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-surface-0/60 border border-border/10">
      <p className={`text-[15px] font-mono font-bold ${color ?? "text-foreground"}`}>{value}</p>
      <p className="text-[10px] text-text-muted mt-0.5">{label}</p>
    </div>
  );
}

// ── Journey Stage Card (for Strategy Journey) ──
function JourneyStage({
  label,
  status,
  items,
  progress,
}: {
  label: string;
  status: "green" | "amber" | "grey";
  items?: { label: string; value: string }[];
  progress?: { current: number; target: number; label: string };
}) {
  const bgColor = status === "green" ? "bg-profit/5 border-profit/20"
    : status === "amber" ? "bg-primary/5 border-primary/20"
    : "bg-surface-0/40 border-border/10";

  const dotColor = status === "green" ? "bg-profit"
    : status === "amber" ? "bg-primary"
    : "bg-text-muted/30";

  const labelColor = status === "grey" ? "text-text-muted" : "text-foreground";

  const StatusIcon = status === "green" ? Check
    : status === "amber" ? Loader2
    : Minus;

  const iconColor = status === "green" ? "text-profit"
    : status === "amber" ? "text-primary animate-spin"
    : "text-text-muted/40";

  return (
    <div className={`px-3 py-2.5 rounded-lg border ${bgColor}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${labelColor}`}>{label}</span>
        </div>
        <StatusIcon className={`w-3.5 h-3.5 ${iconColor}`} />
      </div>

      {status === "grey" && !items && !progress && (
        <p className="text-[11px] text-text-muted/50 ml-4">—</p>
      )}

      {items && (
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 ml-4">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-1">
              <span className="text-[10px] text-text-muted">{item.label}:</span>
              <span className="text-[11px] font-mono font-medium text-foreground">{item.value}</span>
            </div>
          ))}
        </div>
      )}

      {progress && (
        <div className="ml-4 mt-1">
          <div className="w-full h-1.5 rounded-full bg-surface-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${status === "green" ? "bg-profit" : "bg-primary"}`}
              style={{ width: `${Math.min(100, progress.target > 0 ? (progress.current / progress.target) * 100 : 0)}%` }}
            />
          </div>
          <p className="text-[10px] font-mono text-text-muted mt-0.5">{progress.label}</p>
        </div>
      )}
    </div>
  );
}
