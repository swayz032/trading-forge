import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, DollarSign, TrendingUp, TrendingDown, BarChart3, Clock,
  Activity, Loader2, Wifi, WifiOff, Zap, ShieldCheck, ShieldX,
  Radio, ChevronDown, StopCircle, Signal, Target, AlertTriangle,
} from "lucide-react";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { ForgeTable } from "@/components/forge/ForgeTable";
import { LightweightChart } from "@/components/forge/LightweightChart";
import { Button } from "@/components/ui/button";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";
import {
  usePaperSessions, usePaperPositions, usePaperTrades,
  useStartPaperSession, useStopPaperSession,
  usePaperStreams, usePaperSignals, usePaperSignalStats, useStopAllStreams, usePaperBars,
} from "@/hooks/usePaper";
import { useStrategies } from "@/hooks/useStrategies";
import { useSSE } from "@/hooks/useSSE";
import { num, fmtCurrency, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

// ── Helpers ─────────────────────────────────────────────────

function getSessionLabel(status: string) {
  if (status === "active") return { variant: "profit" as const, label: "LIVE" };
  if (status === "stopped") return { variant: "neutral" as const, label: "Stopped" };
  return { variant: "neutral" as const, label: status };
}

function fmtTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Main Page ───────────────────────────────────────────────

export default function PaperTrading() {
  const { data: sessions, isLoading: sessionsLoading } = usePaperSessions();
  const { data: positions, isLoading: positionsLoading } = usePaperPositions();
  const { data: trades, isLoading: tradesLoading } = usePaperTrades();
  const { data: streams } = usePaperStreams();
  const { data: allStrategies } = useStrategies();
  const startSession = useStartPaperSession();
  const stopSession = useStopPaperSession();
  const stopAll = useStopAllStreams();

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showStrategyPicker, setShowStrategyPicker] = useState(false);

  // SSE: auto-invalidate paper queries on live events
  useSSE(["paper:trade", "paper:pnl", "paper:signal", "strategy:promoted"]);

  const isLoading = sessionsLoading || positionsLoading || tradesLoading;
  const activeSessions = useMemo(() => (sessions ?? []).filter((s) => s.status === "active"), [sessions]);
  const stoppedSessions = useMemo(() => (sessions ?? []).filter((s) => s.status === "stopped"), [sessions]);
  const activeSession = selectedSessionId
    ? activeSessions.find((s) => s.id === selectedSessionId) ?? activeSessions[0]
    : activeSessions[0];

  // Signals for active session
  const { data: signals } = usePaperSignals(activeSession?.id);
  const { data: signalStats } = usePaperSignalStats(activeSession?.id);

  // Live price chart — get symbol from active session's stream
  const activeSymbol = useMemo(() => {
    if (!activeSession || !streams) return undefined;
    const streamInfo = streams[activeSession.id];
    return streamInfo?.symbols?.[0];
  }, [activeSession, streams]);
  const { data: liveBars } = usePaperBars(activeSymbol);

  // Strategies eligible for paper trading (PAPER lifecycle or any TIER strategy)
  const eligibleStrategies = useMemo(() => {
    const strats = allStrategies ?? [];
    return strats.filter((s) =>
      s.lifecycleState === "PAPER" || s.lifecycleState === "BACKTEST" || s.forgeScore
    );
  }, [allStrategies]);

  // ── KPIs ────────────────────────────────────────────────────

  const openPositions = useMemo(() => (positions ?? []).filter((p) => !p.closedAt), [positions]);
  const totalUnrealizedPnl = openPositions.reduce((sum, p) => sum + num(p.unrealizedPnl), 0);

  const closedTrades = trades ?? [];
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTrades = closedTrades.filter((t) => new Date(t.exitTime) >= todayStart);
  const winningTrades = todayTrades.filter((t) => num(t.pnl) > 0);
  const winRate = todayTrades.length > 0 ? (winningTrades.length / todayTrades.length) * 100 : 0;
  const dayPnl = todayTrades.reduce((sum, t) => sum + num(t.pnl), 0) + totalUnrealizedPnl;
  const totalPnl = closedTrades.reduce((sum, t) => sum + num(t.pnl), 0);

  // Stream connectivity
  const streamEntries = streams ? Object.entries(streams) : [];
  const connectedCount = streamEntries.filter(([, v]) => v.connected).length;
  const totalStreams = streamEntries.length;

  const kpis = [
    { icon: DollarSign, label: "Day P&L", value: fmtCurrency(dayPnl), positive: dayPnl >= 0 },
    { icon: TrendingUp, label: "Win Rate", value: todayTrades.length > 0 ? `${winRate.toFixed(1)}%` : "--", positive: winRate >= 50 },
    { icon: BarChart3, label: "Trades Today", value: String(todayTrades.length), positive: null as boolean | null },
    { icon: Activity, label: "Open P&L", value: fmtCurrency(totalUnrealizedPnl), positive: totalUnrealizedPnl >= 0 },
    { icon: Target, label: "Total P&L", value: fmtCurrency(totalPnl), positive: totalPnl >= 0 },
    { icon: Radio, label: "Streams", value: `${connectedCount}/${totalStreams}`, positive: connectedCount > 0 ? true : totalStreams > 0 ? false : null },
  ];

  // ── Equity curve ────────────────────────────────────────────

  const startingCapital = activeSession ? num(activeSession.startingCapital, 100000) : 100000;
  const equityData = useMemo(() => {
    if (closedTrades.length === 0) {
      return [
        { time: "Start", equity: startingCapital },
        { time: "Now", equity: startingCapital },
      ];
    }
    const sorted = [...closedTrades].sort((a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime());
    let running = startingCapital;
    return [
      { time: fmtDate(sorted[0].exitTime), equity: startingCapital },
      ...sorted.map((t) => {
        running += num(t.pnl);
        return {
          time: fmtTime(t.exitTime),
          equity: Math.round(running),
        };
      }),
    ];
  }, [closedTrades, startingCapital]);

  // ── Signal distribution ─────────────────────────────────────

  const signalDistribution = useMemo(() => {
    if (!signalStats) return [];
    return [
      { name: "Taken", count: signalStats.taken, color: "#22c55e" },
      { name: "Skipped", count: signalStats.skipped, color: "#eab308" },
      { name: "Rejected", count: signalStats.rejected, color: "#ef4444" },
    ];
  }, [signalStats]);

  // ── Position rows ───────────────────────────────────────────

  const positionRows = openPositions.map((p) => ({
    symbol: p.symbol,
    side: p.side,
    qty: p.contracts,
    entry: num(p.entryPrice),
    current: num(p.currentPrice),
    pnl: num(p.unrealizedPnl),
    duration: timeAgo(p.entryTime),
  }));

  // ── Trade rows ──────────────────────────────────────────────

  const tradeRows = closedTrades.slice(0, 30).map((t) => ({
    time: fmtTime(t.exitTime),
    date: fmtDate(t.exitTime),
    symbol: t.symbol,
    side: t.side === "long" ? "Buy" : "Sell",
    qty: t.contracts,
    entry: num(t.entryPrice),
    exit: num(t.exitPrice),
    pnl: num(t.pnl),
  }));

  type TradeRow = (typeof tradeRows)[number];

  const tradeColumns = [
    { key: "date", header: "Date", mono: true },
    { key: "time", header: "Time", mono: true },
    { key: "symbol", header: "Symbol", render: (r: TradeRow) => <span className="font-mono font-semibold text-foreground">{r.symbol}</span> },
    {
      key: "side", header: "Side",
      render: (r: TradeRow) => <StatusBadge variant={r.side === "Buy" ? "profit" : "loss"}>{r.side}</StatusBadge>,
    },
    { key: "qty", header: "Qty", align: "right" as const, mono: true },
    { key: "entry", header: "Entry", align: "right" as const, mono: true, render: (r: TradeRow) => <span className="font-mono">{r.entry.toFixed(2)}</span> },
    { key: "exit", header: "Exit", align: "right" as const, mono: true, render: (r: TradeRow) => <span className="font-mono">{r.exit.toFixed(2)}</span> },
    {
      key: "pnl", header: "P&L", align: "right" as const, sortable: true,
      render: (r: TradeRow) => (
        <span className={`font-mono font-semibold ${r.pnl >= 0 ? "text-profit" : "text-loss"}`}>
          {fmtCurrency(r.pnl)}
        </span>
      ),
    },
  ];

  // ── Actions ─────────────────────────────────────────────────

  const handleStart = (strategyId?: string) => {
    toast.info("Starting paper trading session...");
    startSession.mutate(
      { strategyId, startingCapital: "100000" },
      {
        onSuccess: () => {
          toast.success("Paper trading session started — stream connecting");
          setShowStrategyPicker(false);
        },
        onError: (err: any) => toast.error(`Failed: ${err.message}`),
      },
    );
  };

  const handleStop = (sessionId: string) => {
    toast.info("Stopping session...");
    stopSession.mutate(sessionId, {
      onSuccess: () => toast.success("Session stopped, stream disconnected"),
      onError: (err: any) => toast.error(`Failed: ${err.message}`),
    });
  };

  const handleStopAll = () => {
    stopAll.mutate(undefined, {
      onSuccess: () => toast.success("All streams stopped"),
      onError: (err: any) => toast.error(`Failed: ${err.message}`),
    });
  };

  // ── Render ──────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading paper trading data...</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Paper Trading</h1>
          <p className="text-sm text-text-secondary mt-1">
            Autopilot — winning strategies trade themselves
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Stream indicator */}
          {totalStreams > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-2 border border-border/30 text-xs">
              {connectedCount === totalStreams ? (
                <Wifi className="w-3.5 h-3.5 text-profit" />
              ) : connectedCount > 0 ? (
                <Wifi className="w-3.5 h-3.5 text-primary" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-loss" />
              )}
              <span className="font-mono text-text-secondary">{connectedCount}/{totalStreams}</span>
            </div>
          )}

          {activeSessions.length > 0 && (
            <Button size="sm" variant="outline" className="text-xs text-loss border-loss/30 hover:bg-loss/10" onClick={handleStopAll}>
              <StopCircle className="w-3.5 h-3.5 mr-1" /> Stop All
            </Button>
          )}

          <div className="relative">
            <Button
              size="sm"
              className="text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setShowStrategyPicker(!showStrategyPicker)}
              disabled={startSession.isPending}
            >
              <Play className="w-3.5 h-3.5 mr-1" /> Start Session
              <ChevronDown className="w-3 h-3 ml-1" />
            </Button>

            <AnimatePresence>
              {showStrategyPicker && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                  className="absolute right-0 top-full mt-2 z-50 w-72 bg-surface border border-border rounded-lg shadow-2xl overflow-hidden"
                >
                  <div className="p-3 border-b border-border/50">
                    <p className="text-xs font-medium text-text-secondary">Select Strategy to Paper Trade</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {eligibleStrategies.length === 0 ? (
                      <p className="text-xs text-text-muted p-4 text-center">No eligible strategies. Run backtests first.</p>
                    ) : (
                      eligibleStrategies.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => handleStart(s.id)}
                          className="w-full text-left px-3 py-2.5 hover:bg-surface-2 transition-colors border-b border-border/20 last:border-0"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-foreground truncate">{s.name}</span>
                            <StatusBadge variant={s.lifecycleState === "PAPER" ? "profit" : "amber"}>
                              {s.lifecycleState}
                            </StatusBadge>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[10px] font-mono text-text-muted">{s.symbol}</span>
                            <span className="text-[10px] font-mono text-text-muted">{s.timeframe}</span>
                            {s.forgeScore && (
                              <span className="text-[10px] font-mono text-primary">Score: {Number(s.forgeScore).toFixed(0)}</span>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="p-2 border-t border-border/50">
                    <button
                      onClick={() => handleStart()}
                      className="w-full text-center text-xs text-text-muted hover:text-foreground py-1.5 transition-colors"
                    >
                      Start without strategy (manual mode)
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── KPI Row ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="forge-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <k.icon className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] uppercase tracking-widest text-text-muted">{k.label}</span>
            </div>
            <p className={`text-lg font-mono font-semibold ${k.positive === true ? "text-profit" : k.positive === false ? "text-loss" : "text-foreground"}`}>
              {k.value}
            </p>
          </motion.div>
        ))}
      </div>

      {/* ── Active Sessions ────────────────────────────────── */}
      {activeSessions.length > 0 && (
        <div className="forge-card p-4">
          <h2 className="text-xs font-medium text-text-secondary mb-3 flex items-center gap-2 uppercase tracking-widest">
            <Zap className="w-3.5 h-3.5 text-profit" />
            Active Sessions
          </h2>
          <div className="space-y-2">
            {activeSessions.map((session) => {
              const streamInfo = streams?.[session.id];
              const stratName = (allStrategies ?? []).find((s) => s.id === session.strategyId)?.name;
              const equity = num(session.currentEquity, 100000);
              const capital = num(session.startingCapital, 100000);
              const sessionPnl = equity - capital;

              return (
                <div
                  key={session.id}
                  className={`rounded-lg p-3 flex items-center justify-between transition-colors cursor-pointer ${
                    activeSession?.id === session.id ? "bg-primary/5 border border-primary/20" : "bg-surface-2 hover:bg-surface-2/80"
                  }`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      {streamInfo?.connected ? (
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-profit opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-profit" />
                        </span>
                      ) : (
                        <span className="h-2.5 w-2.5 rounded-full bg-text-muted" />
                      )}
                      <span className="text-sm font-medium text-foreground">{stratName ?? "Manual"}</span>
                    </div>
                    {streamInfo && (
                      <span className="text-[10px] font-mono text-text-muted">
                        {streamInfo.symbols.join(", ")}
                      </span>
                    )}
                    <span className="text-[10px] text-text-muted">{timeAgo(session.startedAt)}</span>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className={`font-mono text-sm font-semibold ${sessionPnl >= 0 ? "text-profit" : "text-loss"}`}>
                      {fmtCurrency(sessionPnl)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 px-2 text-loss border-loss/30 hover:bg-loss/10"
                      onClick={(e) => { e.stopPropagation(); handleStop(session.id); }}
                    >
                      <Pause className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Live Price Chart ──────────────────────────────── */}
      {activeSymbol && (
        <div className="forge-card p-6">
          <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Live Price — {activeSymbol}
            {liveBars && liveBars.length > 0 && (
              <span className="ml-auto text-[10px] font-mono text-text-muted">{liveBars.length} bars</span>
            )}
          </h2>
          {liveBars && liveBars.length > 0 ? (
            <LightweightChart
              type="candlestick"
              data={liveBars}
              height={350}
            />
          ) : (
            <div className="flex items-center justify-center h-[350px] text-text-muted">
              <div className="text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 opacity-40" />
                <p className="text-xs">Waiting for live bars...</p>
                <p className="text-[10px] mt-1 text-text-muted">Bars populate as the Massive WS stream delivers data</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Two-column: Equity + Signal Stats ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Equity Curve */}
        <div className="lg:col-span-2 forge-card p-6">
          <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Equity Curve
          </h2>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData}>
                <defs>
                  <linearGradient id="paperEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(45,100%,50%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(45,100%,50%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsla(240,5%,18%,0.5)" />
                <XAxis dataKey="time" tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{ background: "hsl(240,10%,6%)", border: "1px solid hsl(240,5%,18%)", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "hsl(240,4%,63%)" }}
                  formatter={(v: number) => [`$${v.toLocaleString()}`, "Equity"]}
                />
                <Area type="monotone" dataKey="equity" stroke="hsl(45,100%,50%)" strokeWidth={2} fill="url(#paperEquity)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Signal Stats */}
        <div className="forge-card p-6">
          <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
            <Signal className="w-4 h-4 text-primary" />
            Signal Stats
          </h2>
          {signalStats && signalStats.total > 0 ? (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-3xl font-mono font-semibold text-foreground">{signalStats.total}</p>
                <p className="text-[10px] uppercase tracking-widest text-text-muted mt-1">Total Signals</p>
              </div>
              <div className="h-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={signalDistribution} layout="vertical">
                    <XAxis type="number" tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "hsl(240,4%,46%)", fontSize: 11 }} tickLine={false} axisLine={false} width={60} />
                    <Tooltip
                      contentStyle={{ background: "hsl(240,10%,6%)", border: "1px solid hsl(240,5%,18%)", borderRadius: 8, fontSize: 12 }}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {signalDistribution.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-sm font-mono font-semibold text-profit">{signalStats.taken}</p>
                  <p className="text-[9px] uppercase tracking-wider text-text-muted">Taken</p>
                </div>
                <div>
                  <p className="text-sm font-mono font-semibold text-primary">{signalStats.skipped}</p>
                  <p className="text-[9px] uppercase tracking-wider text-text-muted">Skipped</p>
                </div>
                <div>
                  <p className="text-sm font-mono font-semibold text-loss">{signalStats.rejected}</p>
                  <p className="text-[9px] uppercase tracking-wider text-text-muted">Rejected</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[200px] text-text-muted">
              <Signal className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-xs">No signals yet</p>
              <p className="text-[10px] mt-1">Start a session to see signal activity</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Open Positions ─────────────────────────────────── */}
      <div className="forge-card p-6">
        <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Open Positions
          {openPositions.length > 0 && (
            <span className="ml-auto text-xs font-mono text-text-muted">{openPositions.length} open</span>
          )}
        </h2>
        {positionRows.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-6">No open positions</p>
        ) : (
          <div className="space-y-2">
            {positionRows.map((p, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="rounded-lg p-4 flex items-center gap-6 bg-surface-2"
              >
                <div className="flex items-center gap-3 w-32">
                  <span className="font-mono font-semibold text-foreground">{p.symbol}</span>
                  <StatusBadge variant={p.side === "long" || p.side === "Long" ? "profit" : "loss"}>
                    {p.side.charAt(0).toUpperCase() + p.side.slice(1)}
                  </StatusBadge>
                </div>
                <div className="grid grid-cols-4 gap-6 flex-1 text-xs">
                  <div>
                    <span className="text-text-muted">Qty</span>
                    <p className="font-mono text-foreground">{p.qty}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">Entry</span>
                    <p className="font-mono text-foreground">{p.entry.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">Current</span>
                    <p className="font-mono text-foreground">{p.current.toFixed(2)}</p>
                  </div>
                  <div>
                    <span className="text-text-muted">P&L</span>
                    <p className={`font-mono font-semibold ${p.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                      {fmtCurrency(p.pnl)}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] text-text-muted font-mono">{p.duration}</span>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* ── Signal Feed ────────────────────────────────────── */}
      {signals && signals.length > 0 && (
        <div className="forge-card p-6">
          <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Signal Feed
            <span className="ml-auto text-[10px] font-mono text-text-muted">Last 50</span>
          </h2>
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {signals.map((sig) => (
              <div
                key={sig.id}
                className="flex items-center gap-3 px-3 py-2 rounded text-xs hover:bg-surface-2 transition-colors"
              >
                <span className="font-mono text-text-muted w-16">{fmtTime(sig.createdAt)}</span>
                <span className="font-mono font-medium text-foreground w-14">{sig.symbol}</span>
                {sig.action === "taken" ? (
                  <StatusBadge variant="profit">
                    <ShieldCheck className="w-3 h-3 mr-0.5" /> Taken
                  </StatusBadge>
                ) : sig.action === "rejected" ? (
                  <StatusBadge variant="loss">
                    <ShieldX className="w-3 h-3 mr-0.5" /> Rejected
                  </StatusBadge>
                ) : (
                  <StatusBadge variant="neutral">
                    <AlertTriangle className="w-3 h-3 mr-0.5" /> {sig.action}
                  </StatusBadge>
                )}
                <span className="text-text-muted truncate flex-1">{sig.reason ?? sig.signalType}</span>
                {sig.price && (
                  <span className="font-mono text-text-secondary">${Number(sig.price).toFixed(2)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Trade History ──────────────────────────────────── */}
      <div className="forge-card p-6">
        <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          Trade History
          {closedTrades.length > 0 && (
            <span className="ml-auto text-xs font-mono text-text-muted">{closedTrades.length} trades</span>
          )}
        </h2>
        {tradeRows.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-6">No trades yet. Start a session to begin autopilot trading.</p>
        ) : (
          <ForgeTable columns={tradeColumns} data={tradeRows} />
        )}
      </div>

      {/* ── Session History ────────────────────────────────── */}
      {stoppedSessions.length > 0 && (
        <div className="forge-card p-6">
          <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-text-muted" />
            Session History
          </h2>
          <div className="space-y-1.5">
            {stoppedSessions.slice(0, 10).map((session) => {
              const stratName = (allStrategies ?? []).find((s) => s.id === session.strategyId)?.name;
              const equity = num(session.currentEquity, 100000);
              const capital = num(session.startingCapital, 100000);
              const pnl = equity - capital;

              return (
                <div key={session.id} className="flex items-center justify-between px-3 py-2 rounded hover:bg-surface-2 transition-colors text-xs">
                  <div className="flex items-center gap-3">
                    <span className="text-text-muted font-mono">{fmtDate(session.startedAt)}</span>
                    <span className="text-foreground font-medium">{stratName ?? "Manual"}</span>
                    <StatusBadge variant="neutral">Stopped</StatusBadge>
                  </div>
                  <span className={`font-mono font-semibold ${pnl >= 0 ? "text-profit" : "text-loss"}`}>
                    {fmtCurrency(pnl)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Empty State ────────────────────────────────────── */}
      {activeSessions.length === 0 && closedTrades.length === 0 && (
        <div className="forge-card p-12 text-center">
          <Play className="w-12 h-12 text-primary/30 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No Active Paper Sessions</h3>
          <p className="text-sm text-text-muted max-w-md mx-auto mb-6">
            Winning strategies auto-promote to paper trading after backtesting. You can also manually start a session for any strategy.
          </p>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setShowStrategyPicker(true)}
          >
            <Play className="w-4 h-4 mr-2" /> Start Paper Session
          </Button>
        </div>
      )}
    </motion.div>
  );
}
