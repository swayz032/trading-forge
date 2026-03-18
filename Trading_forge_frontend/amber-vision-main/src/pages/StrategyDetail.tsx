import { motion } from "framer-motion";
import { useParams, useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { ForgeTable } from "@/components/forge/ForgeTable";
import { LightweightChart } from "@/components/forge/LightweightChart";
import { ArrowLeft, Settings2, Play, Pause, Copy, FlaskConical, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { useStrategy } from "@/hooks/useStrategies";
import { useBacktests, useBacktestTrades, useRunBacktest } from "@/hooks/useBacktests";
import { useOhlcv } from "@/hooks/useData";
import { useStartPaperSession } from "@/hooks/usePaper";
import { num, timeAgo } from "@/lib/utils";
import type { BacktestTrade, Backtest } from "@/types/api";

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

export default function StrategyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: strategy, isLoading: loadingStrategy } = useStrategy(id);
  const { data: backtests } = useBacktests({ strategyId: id });
  const latestBacktest = backtests?.find((b: Backtest) => b.status === "completed");
  const latestBacktestId = latestBacktest?.id;
  const { data: trades } = useBacktestTrades(latestBacktestId);
  const { data: ohlcv } = useOhlcv(strategy?.symbol, strategy?.timeframe);

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
          <TabsContent value="monte-carlo">
            <div className="forge-card p-12 text-center">
              <h2 className="text-lg font-semibold text-foreground mb-2">Monte Carlo Simulation</h2>
              <p className="text-sm text-text-secondary">Fan chart with percentile bands coming in Wave 3</p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-glow-pulse" />
                <span className="text-xs text-text-muted">Wave 3</span>
              </div>
            </div>
          </TabsContent>

          {/* Trades Tab */}
          <TabsContent value="trades">
            <div className="forge-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-foreground">Trade Log</h2>
                <span className="text-xs text-text-muted font-mono">{trades?.length ?? 0} trades shown</span>
              </div>
              {trades && trades.length > 0 ? (
                <ForgeTable columns={tradeColumns} data={trades} />
              ) : (
                <p className="text-sm text-text-muted text-center py-8">No trades for latest backtest</p>
              )}
            </div>
          </TabsContent>

          {/* Config Tab */}
          <TabsContent value="config">
            <div className="forge-card p-5">
              <h2 className="text-sm font-medium text-foreground mb-4">Strategy Parameters</h2>
              {configEntries.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {configEntries.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-surface-0/50 border border-border/10">
                      <span className="text-xs text-text-secondary capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                      <span className="text-xs font-mono font-semibold text-foreground">{String(value)}</span>
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
