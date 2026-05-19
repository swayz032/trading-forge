import { motion } from "framer-motion";
import { useState, useMemo, useEffect } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { Shuffle, TrendingUp, AlertTriangle, Target, BarChart3, Percent, Play, Clock } from "lucide-react";
import { useMonteCarlo, useMonteCarloRun, useRunMC, useRecentMonteCarlo } from "@/hooks/useMonteCarlo";
import { useBacktests } from "@/hooks/useBacktests";
import { useStrategies } from "@/hooks/useStrategies";
import { num, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

/**
 * If paths is an array of raw path arrays (number[][]),
 * compute percentile fan data from them.
 */
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

/**
 * Compute terminal distribution histogram from fan data or raw paths.
 */
function computeHistogram(terminals: number[], bucketCount = 40) {
  if (!terminals.length) return [];
  const min = Math.min(...terminals);
  const max = Math.max(...terminals);
  const bucketSize = (max - min) / bucketCount || 1;
  const histogram: { range: string; count: number; midpoint: number }[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const lo = min + i * bucketSize;
    const hi = lo + bucketSize;
    const count = terminals.filter((v) => v >= lo && (i === bucketCount - 1 ? v <= hi : v < hi)).length;
    histogram.push({
      range: `$${(lo / 1000).toFixed(0)}k`,
      count,
      midpoint: (lo + hi) / 2,
    });
  }
  return histogram;
}

export default function MonteCarlo() {
  const [selectedBacktestId, setSelectedBacktestId] = useState<string>("");
  const [selectedMCId, setSelectedMCId] = useState<string | undefined>();

  // Fetch completed backtests for selector
  const { data: backtests, isLoading: btLoading } = useBacktests({ status: "completed" });

  // Strategy names lookup
  const { data: rawStrategies } = useStrategies();
  const strategyMap = useMemo(() => {
    const map = new Map<string, { name: string; symbol: string; timeframe: string }>();
    rawStrategies?.forEach((s) => map.set(s.id, { name: s.name, symbol: s.symbol, timeframe: s.timeframe }));
    return map;
  }, [rawStrategies]);

  // Backtest lookup (strategyId -> details)
  const backtestMap = useMemo(() => {
    const map = new Map<string, { strategyId: string; symbol: string; timeframe: string }>();
    backtests?.forEach((bt) => map.set(bt.id, { strategyId: bt.strategyId, symbol: bt.symbol, timeframe: bt.timeframe }));
    return map;
  }, [backtests]);

  // Fetch recent MC runs for overview
  const { data: recentMCRuns, isLoading: recentLoading } = useRecentMonteCarlo(10);

  // Fetch MC runs for selected backtest
  const { data: mcRuns, isLoading: mcListLoading } = useMonteCarlo(
    selectedBacktestId ? { backtestId: selectedBacktestId } : undefined
  );

  // Fetch detailed MC run
  const { data: mcRun, isLoading: mcRunLoading } = useMonteCarloRun(selectedMCId);

  // Run mutation
  const runMC = useRunMC();

  // Auto-select latest completed backtest if none selected (only if no recent overview)
  useEffect(() => {
    if (!selectedBacktestId && backtests && backtests.length > 0 && !recentMCRuns?.length) {
      setSelectedBacktestId(backtests[0].id);
    }
  }, [backtests, selectedBacktestId, recentMCRuns]);

  // Auto-select latest MC run when runs load
  useEffect(() => {
    if (mcRuns && mcRuns.length > 0 && !selectedMCId) {
      setSelectedMCId(mcRuns[0].id);
    }
  }, [mcRuns, selectedMCId]);

  const handleRunMC = () => {
    if (!selectedBacktestId) {
      toast.error("Select a backtest first");
      return;
    }
    runMC.mutate(
      { backtestId: selectedBacktestId },
      {
        onSuccess: (data) => {
          toast.success("Monte Carlo simulation completed");
          setSelectedMCId(data.id);
        },
        onError: (err: any) => {
          toast.error(err?.message ?? "Simulation failed");
        },
      }
    );
  };

  const handleSelectRecentRun = (run: any) => {
    // Find the backtest for this MC run
    setSelectedBacktestId(run.backtestId);
    setSelectedMCId(run.id);
  };

  // Parse paths JSONB into fan chart data
  const fanData = useMemo(() => {
    if (!mcRun?.paths) return [];
    const paths = mcRun.paths;

    if (Array.isArray(paths) && paths.length > 0 && typeof paths[0] === "object" && "p50" in paths[0]) {
      return paths.map((p: any) => ({
        day: p.day,
        p5: num(p.p5),
        p10: num(p.p10),
        p25: num(p.p25),
        p50: num(p.p50),
        p75: num(p.p75),
        p90: num(p.p90),
        p95: num(p.p95),
        mean: num(p.mean ?? p.p50),
      }));
    }

    if (Array.isArray(paths) && paths.length > 0 && Array.isArray(paths[0])) {
      return computeFanFromPaths(paths);
    }

    return [];
  }, [mcRun]);

  // Compute terminal stats from fan data or mcRun fields
  const terminalStats = useMemo(() => {
    if (!mcRun) return null;

    let medianTerminal = 0;
    let meanTerminal = 0;
    let p5Terminal = 0;
    let p95Terminal = 0;

    if (fanData.length > 0) {
      const last = fanData[fanData.length - 1];
      medianTerminal = last.p50 ?? 0;
      meanTerminal = last.mean ?? medianTerminal;
      p5Terminal = last.p5 ?? 0;
      p95Terminal = last.p95 ?? 0;
    }

    return { medianTerminal, meanTerminal, p5Terminal, p95Terminal };
  }, [mcRun, fanData]);

  // Histogram from risk metrics or raw paths
  const histogram = useMemo(() => {
    if (!mcRun) return [];

    if (mcRun.riskMetrics?.histogram && Array.isArray(mcRun.riskMetrics.histogram)) {
      return mcRun.riskMetrics.histogram;
    }

    if (mcRun.paths && Array.isArray(mcRun.paths) && mcRun.paths.length > 0 && Array.isArray(mcRun.paths[0])) {
      const terminals = mcRun.paths.map((p: number[]) => p[p.length - 1]);
      return computeHistogram(terminals);
    }

    if (fanData.length > 0) {
      return [];
    }

    return [];
  }, [mcRun, fanData]);

  // Ruin by day from risk metrics
  const ruinByDay = useMemo(() => {
    if (!mcRun?.riskMetrics?.ruinByDay) return [];
    return mcRun.riskMetrics.ruinByDay;
  }, [mcRun]);

  const probabilityOfRuin = mcRun ? num(mcRun.probabilityOfRuin) : 0;

  const kpis = mcRun && terminalStats ? [
    { icon: Target, label: "Median Terminal", value: `$${(terminalStats.medianTerminal / 1000).toFixed(1)}k`, variant: "foreground" },
    { icon: TrendingUp, label: "Mean Terminal", value: `$${(terminalStats.meanTerminal / 1000).toFixed(1)}k`, variant: "foreground" },
    { icon: Percent, label: "5th / 95th Pct", value: `$${(terminalStats.p5Terminal / 1000).toFixed(0)}k / $${(terminalStats.p95Terminal / 1000).toFixed(0)}k`, variant: "foreground" },
    { icon: AlertTriangle, label: "Risk of Ruin", value: `${probabilityOfRuin.toFixed(2)}%`, variant: probabilityOfRuin > 5 ? "loss" : "profit" },
  ] : [];

  // Determine initial equity for ruin line (from fan data day 0)
  const initialEquity = fanData.length > 0 ? fanData[0].p50 : 50000;
  const ruinThreshold = initialEquity * 0.5;

  // Show recent simulations overview when no MC run is selected
  const showRecentOverview = !mcRun && !mcRunLoading && !selectedMCId;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      {/* Header + Backtest Selector */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Monte Carlo Simulation</h1>
          <p className="text-sm text-text-secondary mt-1">
            {mcRun
              ? `${mcRun.numSimulations} paths · ${mcRun.gpuAccelerated ? "GPU accelerated" : "CPU"}`
              : "Select a backtest and run a simulation"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedBacktestId}
            onChange={(e) => {
              setSelectedBacktestId(e.target.value);
              setSelectedMCId(undefined);
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--surface-2))] text-foreground border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Select backtest...</option>
            {(backtests ?? []).map((bt) => (
              <option key={bt.id} value={bt.id}>
                {bt.symbol} · {bt.timeframe} · {bt.startDate?.split("T")[0]}
              </option>
            ))}
          </select>
          <button
            onClick={handleRunMC}
            disabled={!selectedBacktestId || runMC.isPending}
            className="px-3 py-1.5 rounded-full text-xs font-medium bg-primary text-primary-foreground flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <Play className="w-3 h-3" />
            {runMC.isPending ? "Running..." : "Run Simulation"}
          </button>
        </div>
      </div>

      {/* Recent Simulations Overview */}
      {showRecentOverview && recentMCRuns && recentMCRuns.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4"
        >
          <h2 className="text-sm font-medium text-text-secondary">Recent Simulations</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {recentMCRuns.map((run: any) => {
              const bt = backtestMap.get(run.backtestId);
              const strat = bt ? strategyMap.get(bt.strategyId) : null;
              const survivalRate = run.probabilityOfRuin != null ? (100 - num(run.probabilityOfRuin)).toFixed(1) : null;
              const maxDDP50 = run.maxDrawdownP50 != null ? num(run.maxDrawdownP50).toFixed(1) : null;

              return (
                <motion.div
                  key={run.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="forge-card p-4 cursor-pointer hover:border-primary/30 transition-all"
                  onClick={() => handleSelectRecentRun(run)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-foreground truncate">
                      {strat?.name ?? bt?.symbol ?? "Unknown"}
                    </span>
                    <span className="text-[10px] text-text-muted">{timeAgo(run.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    {bt && (
                      <>
                        <span className="text-[10px] font-mono text-primary">{bt.symbol}</span>
                        <span className="text-[10px] text-text-muted">{bt.timeframe}</span>
                      </>
                    )}
                    <span className="text-[10px] text-text-muted">{run.numSimulations} paths</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-text-muted block">Survival</span>
                      <span className={`text-xs font-mono font-semibold ${survivalRate && parseFloat(survivalRate) > 95 ? "text-profit" : "text-loss"}`}>
                        {survivalRate ? `${survivalRate}%` : "--"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-text-muted block">Max DD P50</span>
                      <span className="text-xs font-mono font-semibold text-foreground">
                        {maxDDP50 ? `${maxDDP50}%` : "--"}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Recent overview empty + loading */}
      {showRecentOverview && recentLoading && (
        <div className="flex items-center justify-center h-32">
          <div className="text-text-muted text-sm">Loading recent simulations...</div>
        </div>
      )}

      {/* MC Run Selector (if runs exist) */}
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

      {/* Empty state */}
      {!mcRun && !mcRunLoading && selectedBacktestId && (!recentMCRuns || recentMCRuns.length === 0) && (
        <div className="forge-card p-12 text-center">
          <Shuffle className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            {selectedBacktestId
              ? mcRuns && mcRuns.length > 0
                ? "Select a run above to view results"
                : "No simulations yet. Click Run Simulation to start."
              : "Select a completed backtest to run a Monte Carlo simulation"}
          </p>
        </div>
      )}

      {/* Loading state */}
      {mcRunLoading && (
        <div className="flex items-center justify-center h-64">
          <div className="text-text-muted text-sm">Loading simulation data...</div>
        </div>
      )}

      {/* Results */}
      {mcRun && !mcRunLoading && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map((k, i) => (
              <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="forge-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <k.icon className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[10px] uppercase tracking-widest text-text-muted">{k.label}</span>
                </div>
                <p className={`text-xl font-mono font-semibold ${k.variant === "loss" ? "text-loss" : k.variant === "profit" ? "text-profit" : "text-foreground"}`}>
                  {k.value}
                </p>
              </motion.div>
            ))}
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
                      <linearGradient id="mc-outer" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(45,100%,50%)" stopOpacity={0.06} />
                        <stop offset="100%" stopColor="hsl(45,100%,50%)" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="mc-mid" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(45,100%,50%)" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="hsl(45,100%,50%)" stopOpacity={0.04} />
                      </linearGradient>
                      <linearGradient id="mc-inner" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(45,100%,50%)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="hsl(45,100%,50%)" stopOpacity={0.08} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsla(240,5%,18%,0.5)" />
                    <XAxis dataKey="day" tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }} tickLine={false} axisLine={false} label={{ value: "Trading Days", position: "insideBottom", offset: -5, fill: "hsl(240,4%,46%)", fontSize: 10 }} />
                    <YAxis tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: "hsl(240,10%,6%)", border: "1px solid hsl(240,5%,18%)", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "hsl(240,4%,63%)" }}
                      formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
                    />
                    <ReferenceLine y={ruinThreshold} stroke="hsl(0,84%,60%)" strokeDasharray="6 4" strokeOpacity={0.6} label={{ value: `Ruin $${(ruinThreshold / 1000).toFixed(0)}k`, fill: "hsl(0,84%,60%)", fontSize: 10, position: "insideTopRight" }} />
                    {/* 5-95 band */}
                    <Area type="monotone" dataKey="p95" stackId="outer" stroke="none" fill="url(#mc-outer)" name="P95" />
                    <Area type="monotone" dataKey="p5" stackId="outer-base" stroke="none" fill="transparent" name="P5" />
                    {/* 10-90 band */}
                    <Area type="monotone" dataKey="p90" stroke="none" fill="url(#mc-mid)" name="P90" />
                    <Area type="monotone" dataKey="p10" stroke="none" fill="transparent" name="P10" />
                    {/* 25-75 band */}
                    <Area type="monotone" dataKey="p75" stroke="none" fill="url(#mc-inner)" name="P75" />
                    <Area type="monotone" dataKey="p25" stroke="none" fill="transparent" name="P25" />
                    {/* Median line */}
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Terminal Distribution */}
            {histogram.length > 0 && (
              <div className="forge-card p-6">
                <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  Terminal Equity Distribution
                </h2>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histogram}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsla(240,5%,18%,0.5)" />
                      <XAxis dataKey="range" tick={{ fill: "hsl(240,4%,46%)", fontSize: 9 }} tickLine={false} axisLine={false} interval={Math.floor(histogram.length / 8)} />
                      <YAxis tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ background: "hsl(240,10%,6%)", border: "1px solid hsl(240,5%,18%)", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "hsl(240,4%,63%)" }}
                      />
                      <ReferenceLine x={histogram.findIndex(h => h.midpoint >= initialEquity) >= 0 ? histogram[histogram.findIndex(h => h.midpoint >= initialEquity)].range : undefined} stroke="hsl(240,4%,46%)" strokeDasharray="4 3" strokeOpacity={0.5} />
                      <Bar dataKey="count" radius={[2, 2, 0, 0]} name="Paths">
                        {histogram.map((entry, idx) => (
                          <Cell
                            key={idx}
                            fill={entry.midpoint >= initialEquity ? "hsl(45,100%,50%)" : "hsl(0,84%,60%)"}
                            fillOpacity={0.7}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Risk of Ruin Over Time */}
            {ruinByDay.length > 0 && (
              <div className="forge-card p-6">
                <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-loss" />
                  Cumulative Risk of Ruin
                </h2>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={ruinByDay}>
                      <defs>
                        <linearGradient id="ruin-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(0,84%,60%)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="hsl(0,84%,60%)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsla(240,5%,18%,0.5)" />
                      <XAxis dataKey="day" tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }} tickLine={false} axisLine={false} label={{ value: "Trading Days", position: "insideBottom", offset: -5, fill: "hsl(240,4%,46%)", fontSize: 10 }} />
                      <YAxis tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }} tickLine={false} axisLine={false} unit="%" domain={[0, "auto"]} />
                      <Tooltip
                        contentStyle={{ background: "hsl(240,10%,6%)", border: "1px solid hsl(240,5%,18%)", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "hsl(240,4%,63%)" }}
                        formatter={(v: number) => [`${v}%`, "Ruin Probability"]}
                      />
                      <Area type="monotone" dataKey="ruinPct" stroke="hsl(0,84%,60%)" strokeWidth={2} fill="url(#ruin-fill)" name="Ruin %" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Additional risk metrics from the MC run */}
            {mcRun && (
              <div className="forge-card p-6">
                <h2 className="text-sm font-medium text-text-secondary mb-4">Risk Metrics</h2>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Max DD P5", value: mcRun.maxDrawdownP5 != null ? `${num(mcRun.maxDrawdownP5).toFixed(2)}%` : "--" },
                    { label: "Max DD P50", value: mcRun.maxDrawdownP50 != null ? `${num(mcRun.maxDrawdownP50).toFixed(2)}%` : "--" },
                    { label: "Max DD P95", value: mcRun.maxDrawdownP95 != null ? `${num(mcRun.maxDrawdownP95).toFixed(2)}%` : "--" },
                    { label: "Sharpe P5", value: mcRun.sharpeP5 != null ? num(mcRun.sharpeP5).toFixed(2) : "--" },
                    { label: "Sharpe P50", value: mcRun.sharpeP50 != null ? num(mcRun.sharpeP50).toFixed(2) : "--" },
                    { label: "Sharpe P95", value: mcRun.sharpeP95 != null ? num(mcRun.sharpeP95).toFixed(2) : "--" },
                    { label: "VaR 95%", value: mcRun.var95 != null ? `$${num(mcRun.var95).toLocaleString()}` : "--" },
                    { label: "VaR 99%", value: mcRun.var99 != null ? `$${num(mcRun.var99).toLocaleString()}` : "--" },
                    { label: "CVaR 95%", value: mcRun.cvar95 != null ? `$${num(mcRun.cvar95).toLocaleString()}` : "--" },
                    { label: "Prob. of Ruin", value: mcRun.probabilityOfRuin != null ? `${num(mcRun.probabilityOfRuin).toFixed(2)}%` : "--" },
                  ].map((m) => (
                    <div key={m.label} className="flex justify-between items-center py-1.5 border-b border-border/10">
                      <span className="text-xs text-text-muted">{m.label}</span>
                      <span className="text-xs font-mono text-foreground">{m.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
