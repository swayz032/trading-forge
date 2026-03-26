import { motion } from "framer-motion";
import { useParams, useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { ForgeTable } from "@/components/forge/ForgeTable";
import { LightweightChart } from "@/components/forge/LightweightChart";
import { useState, useMemo, useEffect } from "react";
import {
  AreaChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { ArrowLeft, Play, Pause, Copy, FlaskConical, Zap, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/forge/Pagination";
import { toast } from "sonner";

import { useStrategy } from "@/hooks/useStrategies";
import { useBacktests, useBacktestTrades, useBacktestEquity, useRunBacktest } from "@/hooks/useBacktests";
import { useOhlcv } from "@/hooks/useData";
import { useMonteCarlo, useMonteCarloRun, useRunMC } from "@/hooks/useMonteCarlo";
import { useStartPaperSession } from "@/hooks/usePaper";
import { num, timeAgo } from "@/lib/utils";
import type { BacktestTrade, Backtest } from "@/types/api";

function computeFanFromPaths(rawPaths: number[][]): Record<string, number>[] {
  if (!rawPaths.length) return [];
  const numDays = rawPaths[0].length;
  const percentiles = [5, 10, 25, 50, 75, 90, 95];
  const fanData: Record<string, number>[] = [];
  for (let d = 0; d < numDays; d++) {
    const vals = rawPaths.map((p) => p[d]).sort((a, b) => a - b);
    const entry: Record<string, number> = { day: d };
    for (const pct of percentiles) {
      const idx = Math.floor((pct / 100) * vals.length);
      entry[`p${pct}`] = Math.round(vals[Math.min(idx, vals.length - 1)]);
    }
    entry.mean = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    fanData.push(entry);
  }
  return fanData;
}

function mapLifecycleToStatus(state: string | undefined): string {
  if (!state) return "draft";
  const map: Record<string, string> = {
    CANDIDATE: "draft",
    INCUBATING: "draft",
    TESTING: "active",
    PAPER: "active",
    DEPLOYED: "active",
    DECLINING: "paused",
    PAUSED: "paused",
    RETIRED: "retired",
    REJECTED: "retired",
  };
  return map[state] || map[state.toUpperCase()] || state;
}

function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return "--";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

const TRADES_PAGE_SIZE = 50;

function StrategyTradesPanel({ trades, tradeColumns }: { trades: any[] | undefined; tradeColumns: any[] }) {
  const [tradePage, setTradePage] = useState(1);
  const [dirFilter, setDirFilter] = useState<"all" | "long" | "short">("all");

  const filteredTrades = useMemo(() => {
    if (!trades?.length) return [];
    if (dirFilter === "all") return trades;
    return trades.filter((t: any) => t.direction === dirFilter);
  }, [trades, dirFilter]);

  const paginatedTrades = useMemo(() => {
    const start = (tradePage - 1) * TRADES_PAGE_SIZE;
    return filteredTrades.slice(start, start + TRADES_PAGE_SIZE);
  }, [filteredTrades, tradePage]);

  return (
    <div className="forge-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-foreground">Trade Log</h2>
        <div className="flex items-center gap-2">
          {(["all", "long", "short"] as const).map((f) => (
            <button
              key={f}
              onClick={() => { setDirFilter(f); setTradePage(1); }}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                dirFilter === f
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-text-secondary hover:text-foreground border border-transparent"
              }`}
            >
              {f === "all" ? "All" : f === "long" ? "Long" : "Short"}
            </button>
          ))}
          <span className="text-xs text-text-muted font-mono ml-2">{filteredTrades.length} trades</span>
        </div>
      </div>
      {paginatedTrades.length > 0 ? (
        <>
          <div className="max-h-[500px] overflow-y-auto">
            <ForgeTable columns={tradeColumns} data={paginatedTrades} />
          </div>
          {filteredTrades.length > TRADES_PAGE_SIZE && (
            <Pagination
              page={tradePage}
              pageSize={TRADES_PAGE_SIZE}
              total={filteredTrades.length}
              onPageChange={setTradePage}
            />
          )}
        </>
      ) : (
        <p className="text-sm text-text-muted text-center py-8">No trades for latest backtest</p>
      )}
    </div>
  );
}

export default function StrategyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: strategy, isLoading: loadingStrategy } = useStrategy(id);
  const { data: backtests } = useBacktests({ strategyId: id });
  const latestBacktest = backtests?.find((b: Backtest) => b.status === "completed");
  const latestBacktestId = latestBacktest?.id;
  const { data: trades } = useBacktestTrades(latestBacktestId);
  const { data: ohlcv } = useOhlcv(strategy?.symbol, strategy?.timeframe);
  const { data: equityData } = useBacktestEquity(latestBacktestId);

  // Monte Carlo hooks
  const { data: mcRuns, isLoading: mcListLoading } = useMonteCarlo(
    latestBacktestId ? { backtestId: latestBacktestId } : undefined
  );
  const [selectedMCId, setSelectedMCId] = useState<string | undefined>();
  const { data: mcRun, isLoading: mcRunLoading } = useMonteCarloRun(selectedMCId);
  const runMC = useRunMC();

  // Auto-select latest MC run
  useEffect(() => {
    if (mcRuns && mcRuns.length > 0 && !selectedMCId) {
      setSelectedMCId(mcRuns[0].id);
    }
  }, [mcRuns, selectedMCId]);

  // Parse MC paths into fan chart data
  const fanData = useMemo(() => {
    if (!mcRun?.paths) return [];
    const paths = mcRun.paths;
    if (Array.isArray(paths) && paths.length > 0 && typeof paths[0] === "object" && "p50" in paths[0]) {
      return paths.map((p: any) => ({
        day: p.day, p5: num(p.p5), p10: num(p.p10), p25: num(p.p25),
        p50: num(p.p50), p75: num(p.p75), p90: num(p.p90), p95: num(p.p95),
        mean: num(p.mean ?? p.p50),
      }));
    }
    if (Array.isArray(paths) && paths.length > 0 && Array.isArray(paths[0])) {
      return computeFanFromPaths(paths);
    }
    return [];
  }, [mcRun]);

  // Equity curve as line chart data for overview fallback
  const equityCurveData = useMemo(() => {
    const ec = equityData?.equityCurve ?? latestBacktest?.equityCurve;
    if (!ec) return [];
    // equity curve may be array of {time, value} or {date, equity} or just number[]
    if (Array.isArray(ec)) {
      return ec.map((point: any, i: number) => {
        if (typeof point === "number") return { time: i, value: point };
        return { time: point.time ?? point.date ?? i, value: num(point.value ?? point.equity ?? point.pnl) };
      });
    }
    return [];
  }, [equityData, latestBacktest]);

  const runBacktest = useRunBacktest();
  const startPaper = useStartPaperSession();

  if (loadingStrategy) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-sm text-text-muted">Loading strategy...</span>
      </div>
    );
  }

  if (!strategy) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-sm text-text-muted">Strategy not found</span>
      </div>
    );
  }

  const status = mapLifecycleToStatus(strategy.lifecycleState);
  const score = num(strategy.forgeScore);

  // KPI values from latest completed backtest
  const sharpe = num(latestBacktest?.sharpeRatio);
  const winRate = num(latestBacktest?.winRate);
  const profitFactor = num(latestBacktest?.profitFactor);
  const maxDD = num(latestBacktest?.maxDrawdown);
  const totalTrades = latestBacktest?.totalTrades ?? 0;
  const totalReturn = num(latestBacktest?.totalReturn);

  const handleRunBacktest = () => {
    if (!id) return;
    runBacktest.mutate(
      { strategyId: id },
      {
        onSuccess: () => toast.success("Backtest queued"),
        onError: (e) => toast.error(`Backtest failed: ${e.message}`),
      }
    );
  };

  const handleStartPaper = () => {
    if (!id) return;
    startPaper.mutate(
      { strategyId: id },
      {
        onSuccess: () => toast.success("Paper session started"),
        onError: (e) => toast.error(`Paper start failed: ${e.message}`),
      }
    );
  };

  const tradeColumns = [
    { key: "entryTime", header: "Date", mono: true,
      render: (r: any) => r.entryTime ? new Date(r.entryTime).toLocaleDateString() : "--" },
    { key: "direction", header: "Side",
      render: (r: any) => <StatusBadge variant={r.direction === "long" ? "profit" : "loss"} dot>{r.direction?.toUpperCase()}</StatusBadge> },
    { key: "entryPrice", header: "Entry", align: "right" as const, mono: true,
      render: (r: any) => num(r.entryPrice).toLocaleString("en-US", { minimumFractionDigits: 2 }) },
    { key: "exitPrice", header: "Exit", align: "right" as const, mono: true,
      render: (r: any) => r.exitPrice ? num(r.exitPrice).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "--" },
    { key: "pnl", header: "P&L", align: "right" as const, mono: true, sortable: true,
      render: (r: any) => {
        const pnl = num(r.pnl);
        return <span className={pnl >= 0 ? "text-profit" : "text-loss"}>{pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(2)}</span>;
      } },
    { key: "mae", header: "MAE", align: "right" as const, mono: true,
      render: (r: any) => r.mae != null ? `$${num(r.mae).toFixed(0)}` : "--" },
    { key: "mfe", header: "MFE", align: "right" as const, mono: true,
      render: (r: any) => r.mfe != null ? `$${num(r.mfe).toFixed(0)}` : "--" },
  ];

  const backtestColumns = [
    { key: "id", header: "ID", mono: true,
      render: (r: any) => <span className="text-primary font-mono text-xs">{r.id.slice(0, 8)}</span> },
    { key: "createdAt", header: "Date", mono: true,
      render: (r: any) => timeAgo(r.createdAt) },
    { key: "period", header: "Period",
      render: (r: any) => `${new Date(r.startDate).toLocaleDateString("en-US", { month: "short" })} - ${new Date(r.endDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}` },
    { key: "sharpeRatio", header: "Sharpe", align: "right" as const, mono: true, sortable: true,
      render: (r: any) => r.status === "completed" ? num(r.sharpeRatio).toFixed(2) : <span className="text-text-muted">--</span> },
    { key: "totalTrades", header: "Trades", align: "right" as const, mono: true },
    { key: "totalReturn", header: "P&L", align: "right" as const, mono: true, sortable: true,
      render: (r: any) => {
        if (r.status !== "completed") return <span className="text-text-muted">--</span>;
        const v = num(r.totalReturn);
        return <span className={v >= 0 ? "text-profit" : "text-loss"}>{v >= 0 ? "+" : ""}${Math.abs(v).toLocaleString()}</span>;
      } },
    { key: "status", header: "Status",
      render: (r: any) => (
        <StatusBadge variant={r.status === "completed" ? "profit" : r.status === "running" ? "amber" : "neutral"} dot>
          {r.status}
        </StatusBadge>
      ) },
  ];

  const configEntries = strategy.config ? Object.entries(strategy.config) : [];

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Back nav + header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <button
          onClick={() => navigate("/strategies")}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Strategies
        </button>

        <div className="flex items-start justify-between">
          <div className="flex items-start gap-5">
            <ForgeScoreRing score={score} size={88} strokeWidth={6} label="" />
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <span className="text-xs font-mono font-semibold text-primary">{strategy.symbol}</span>
                <StatusBadge variant={status === "active" ? "profit" : status === "paused" ? "amber" : "info"} dot>{status}</StatusBadge>
              </div>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">{strategy.name}</h1>
              <p className="text-sm text-text-secondary mt-1 max-w-lg">{strategy.description || "No description"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="text-xs border-border/30 text-text-secondary hover:text-foreground">
              <Copy className="w-3.5 h-3.5 mr-1" /> Clone
            </Button>
            <Button variant="outline" size="sm" className="text-xs border-border/30 text-text-secondary hover:text-foreground" onClick={handleRunBacktest} disabled={runBacktest.isPending}>
              <FlaskConical className="w-3.5 h-3.5 mr-1" /> Run Backtest
            </Button>
            <Button variant="outline" size="sm" className="text-xs border-border/30 text-text-secondary hover:text-foreground" onClick={handleStartPaper} disabled={startPaper.isPending}>
              <Zap className="w-3.5 h-3.5 mr-1" /> Start Paper
            </Button>
            {status === "active" ? (
              <Button size="sm" className="text-xs bg-loss/10 text-loss hover:bg-loss/20 border-0">
                <Pause className="w-3.5 h-3.5 mr-1" /> Pause
              </Button>
            ) : (
              <Button size="sm" className="text-xs bg-profit/10 text-profit hover:bg-profit/20 border-0">
                <Play className="w-3.5 h-3.5 mr-1" /> Activate
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      {/* KPI Strip */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3"
      >
        {[
          { label: "Total Return", value: `$${totalReturn.toLocaleString()}`, type: totalReturn >= 0 ? "profit" : "loss" },
          { label: "Win Rate", value: `${winRate.toFixed(1)}%` },
          { label: "Sharpe", value: sharpe.toFixed(2) },
          { label: "Profit Factor", value: profitFactor.toFixed(2) },
          { label: "Max DD", value: `${maxDD.toFixed(1)}%`, type: "loss" },
          { label: "Total Trades", value: totalTrades.toString() },
          { label: "Forge Score", value: score.toString() },
        ].map((m: any, i) => (
          <div key={i} className="forge-card px-4 py-3">
            <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-1">{m.label}</span>
            <span className={`text-sm font-mono font-bold ${m.type === "profit" ? "text-profit" : m.type === "loss" ? "text-loss" : "text-foreground"}`}>
              {m.value}
            </span>
          </div>
        ))}
      </motion.div>

      {/* Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
      >
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="bg-surface-1 border border-border/20 p-1 rounded-lg">
            {["Overview", "Backtests", "Monte Carlo", "Trades", "Config"].map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab.toLowerCase().replace(" ", "-")}
                className="text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary rounded-md px-4"
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="forge-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-foreground">Price Chart — {strategy.symbol}</h2>
                <span className="text-xs text-text-muted font-mono">{strategy.timeframe}</span>
              </div>
              {ohlcv && ohlcv.length > 0 ? (
                <LightweightChart type="candlestick" data={ohlcv} height={400} />
              ) : equityCurveData.length > 0 ? (
                <>
                  <p className="text-xs text-text-muted mb-2">No OHLCV data — showing P&L curve from latest backtest</p>
                  <LightweightChart type="area" data={equityCurveData} height={400} />
                </>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-sm text-text-muted">
                  No OHLCV data available
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="forge-card p-4">
                <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-2">Avg Trade P&L</span>
                <span className={`text-lg font-mono font-bold ${num(latestBacktest?.avgTradePnl) >= 0 ? "text-profit" : "text-loss"}`}>
                  ${num(latestBacktest?.avgTradePnl).toFixed(2)}
                </span>
              </div>
              <div className="forge-card p-4">
                <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-2">Avg Daily P&L</span>
                <span className={`text-lg font-mono font-bold ${num(latestBacktest?.avgDailyPnl) >= 0 ? "text-profit" : "text-loss"}`}>
                  ${num(latestBacktest?.avgDailyPnl).toFixed(2)}
                </span>
              </div>
              <div className="forge-card p-4">
                <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-2">Execution Time</span>
                <span className="text-lg font-mono font-bold text-primary">
                  {fmtDuration(latestBacktest?.executionTimeMs)}
                </span>
              </div>
            </div>
          </TabsContent>

          {/* Backtests Tab */}
          <TabsContent value="backtests">
            <div className="forge-card p-5">
              <h2 className="text-sm font-medium text-foreground mb-4">Backtest History</h2>
              {backtests && backtests.length > 0 ? (
                <ForgeTable columns={backtestColumns} data={backtests} />
              ) : (
                <p className="text-sm text-text-muted text-center py-8">No backtests yet</p>
              )}
            </div>
          </TabsContent>

          {/* Monte Carlo Tab */}
          <TabsContent value="monte-carlo" className="space-y-4">
            {/* MC Run Selector */}
            {mcRuns && mcRuns.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-text-muted">Runs:</span>
                {mcRuns.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedMCId(run.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      selectedMCId === run.id
                        ? "bg-primary text-primary-foreground"
                        : "text-text-muted hover:text-foreground"
                    }`}
                    style={selectedMCId !== run.id ? { background: "hsl(var(--surface-2))" } : {}}
                  >
                    {new Date(run.createdAt).toLocaleDateString()} · {run.numSimulations} paths
                  </button>
                ))}
              </div>
            )}

            {/* Loading */}
            {mcRunLoading && (
              <div className="flex items-center justify-center h-64">
                <div className="text-text-muted text-sm">Loading simulation data...</div>
              </div>
            )}

            {/* Empty state */}
            {!mcRun && !mcRunLoading && (
              <div className="forge-card p-12 text-center">
                <Shuffle className="w-8 h-8 text-text-muted mx-auto mb-3" />
                <h2 className="text-lg font-semibold text-foreground mb-2">Monte Carlo Simulation</h2>
                <p className="text-sm text-text-secondary">
                  {!latestBacktestId
                    ? "No completed backtests yet. Run a backtest first, then trigger MC."
                    : mcRuns && mcRuns.length > 0
                      ? "Select a run above to view results"
                      : "No Monte Carlo runs yet. Click below to run a simulation."}
                </p>
                {latestBacktestId && (!mcRuns || mcRuns.length === 0) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 text-xs"
                    onClick={() => {
                      runMC.mutate(
                        { backtestId: latestBacktestId },
                        {
                          onSuccess: (data) => {
                            toast.success("Monte Carlo simulation completed");
                            setSelectedMCId(data.id);
                          },
                          onError: (err: any) => toast.error(err?.message ?? "Simulation failed"),
                        }
                      );
                    }}
                    disabled={runMC.isPending}
                  >
                    <Play className="w-3.5 h-3.5 mr-1" />
                    {runMC.isPending ? "Running..." : "Run Monte Carlo"}
                  </Button>
                )}
              </div>
            )}

            {/* MC Results */}
            {mcRun && !mcRunLoading && (
              <>
                {/* KPI row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {(() => {
                    const last = fanData.length > 0 ? fanData[fanData.length - 1] : null;
                    const probabilityOfRuin = num(mcRun.probabilityOfRuin);
                    return [
                      { label: "Median Terminal", value: last ? `$${(last.p50 / 1000).toFixed(1)}k` : "—" },
                      { label: "Mean Terminal", value: last ? `$${(last.mean / 1000).toFixed(1)}k` : "—" },
                      { label: "5th / 95th Pct", value: last ? `$${(last.p5 / 1000).toFixed(0)}k / $${(last.p95 / 1000).toFixed(0)}k` : "—" },
                      { label: "Risk of Ruin", value: `${probabilityOfRuin.toFixed(2)}%`, variant: probabilityOfRuin > 5 ? "loss" : "profit" },
                    ].map((k) => (
                      <div key={k.label} className="forge-card p-4">
                        <span className="text-[10px] uppercase tracking-widest text-text-muted block mb-1">{k.label}</span>
                        <span className={`text-lg font-mono font-bold ${k.variant === "loss" ? "text-loss" : k.variant === "profit" ? "text-profit" : "text-foreground"}`}>
                          {k.value}
                        </span>
                      </div>
                    ));
                  })()}
                </div>

                {/* Fan Chart */}
                {fanData.length > 0 && (
                  <div className="forge-card p-6">
                    <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
                      <Shuffle className="w-4 h-4 text-primary" />
                      Percentile Fan Chart
                    </h2>
                    <div className="h-[320px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={fanData}>
                          <defs>
                            <linearGradient id="sd-mc-outer" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="hsl(45,100%,50%)" stopOpacity={0.06} />
                              <stop offset="100%" stopColor="hsl(45,100%,50%)" stopOpacity={0.02} />
                            </linearGradient>
                            <linearGradient id="sd-mc-inner" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="hsl(45,100%,50%)" stopOpacity={0.25} />
                              <stop offset="100%" stopColor="hsl(45,100%,50%)" stopOpacity={0.08} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsla(240,5%,18%,0.5)" />
                          <XAxis dataKey="day" tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }} tickLine={false} axisLine={false} label={{ value: "Trading Days", position: "insideBottom", offset: -5, fill: "hsl(240,4%,46%)", fontSize: 10 }} />
                          <YAxis tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                          <Tooltip
                            contentStyle={{ background: "hsl(240,10%,6%)", border: "1px solid hsl(240,5%,18%)", borderRadius: 8, fontSize: 12 }}
                            labelStyle={{ color: "hsl(240,4%,63%)" }}
                            formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
                          />
                          <Area type="monotone" dataKey="p95" stroke="none" fill="url(#sd-mc-outer)" name="P95" />
                          <Area type="monotone" dataKey="p5" stroke="none" fill="transparent" name="P5" />
                          <Area type="monotone" dataKey="p75" stroke="none" fill="url(#sd-mc-inner)" name="P75" />
                          <Area type="monotone" dataKey="p25" stroke="none" fill="transparent" name="P25" />
                          <Line type="monotone" dataKey="p50" stroke="hsl(45,100%,50%)" strokeWidth={2} dot={false} name="Median" />
                          <Line type="monotone" dataKey="mean" stroke="hsl(217,91%,60%)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="Mean" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex items-center justify-center gap-6 mt-3 text-[11px]">
                      <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-primary inline-block" /> Median</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-info inline-block opacity-70" style={{ borderTop: "1px dashed" }} /> Mean</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded opacity-25 inline-block" style={{ background: "hsl(45,100%,50%)" }} /> 25th-75th</span>
                      <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded opacity-10 inline-block" style={{ background: "hsl(45,100%,50%)" }} /> 5th-95th</span>
                    </div>
                  </div>
                )}

                {/* Risk Metrics Grid */}
                <div className="forge-card p-6">
                  <h2 className="text-sm font-medium text-text-secondary mb-4">Risk Metrics</h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { label: "Max DD P5", value: mcRun.maxDrawdownP5 != null ? `${num(mcRun.maxDrawdownP5).toFixed(2)}%` : "—" },
                      { label: "Max DD P50", value: mcRun.maxDrawdownP50 != null ? `${num(mcRun.maxDrawdownP50).toFixed(2)}%` : "—" },
                      { label: "Max DD P95", value: mcRun.maxDrawdownP95 != null ? `${num(mcRun.maxDrawdownP95).toFixed(2)}%` : "—" },
                      { label: "Sharpe P5", value: mcRun.sharpeP5 != null ? num(mcRun.sharpeP5).toFixed(2) : "—" },
                      { label: "Sharpe P50", value: mcRun.sharpeP50 != null ? num(mcRun.sharpeP50).toFixed(2) : "—" },
                      { label: "Sharpe P95", value: mcRun.sharpeP95 != null ? num(mcRun.sharpeP95).toFixed(2) : "—" },
                      { label: "VaR 95%", value: mcRun.var95 != null ? `$${num(mcRun.var95).toLocaleString()}` : "—" },
                      { label: "VaR 99%", value: mcRun.var99 != null ? `$${num(mcRun.var99).toLocaleString()}` : "—" },
                      { label: "CVaR 95%", value: mcRun.cvar95 != null ? `$${num(mcRun.cvar95).toLocaleString()}` : "—" },
                    ].map((m) => (
                      <div key={m.label} className="flex justify-between items-center py-1.5 border-b border-border/10">
                        <span className="text-xs text-text-muted">{m.label}</span>
                        <span className="text-xs font-mono text-foreground">{m.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* Trades Tab */}
          <TabsContent value="trades">
            <StrategyTradesPanel trades={trades} tradeColumns={tradeColumns} />
          </TabsContent>

          {/* Config Tab */}
          <TabsContent value="config">
            <div className="forge-card p-5">
              <h2 className="text-sm font-medium text-foreground mb-4">Strategy Parameters</h2>
              {configEntries.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {configEntries.map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between p-3 rounded-lg bg-surface-0/50 border border-border/10">
                      <span className="text-xs text-text-secondary capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                      {typeof value === "object" && value !== null ? (
                        <pre className="text-xs font-mono font-semibold text-foreground whitespace-pre-wrap max-w-[60%] text-right">{JSON.stringify(value, null, 2)}</pre>
                      ) : (
                        <span className="text-xs font-mono font-semibold text-foreground">{String(value)}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted text-center py-8">No configuration</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </motion.div>
    </div>
  );
}
