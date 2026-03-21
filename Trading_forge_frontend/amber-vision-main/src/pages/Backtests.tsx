import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { ForgeTable } from "@/components/forge/ForgeTable";
import { Pagination } from "@/components/forge/Pagination";
import { FlaskConical, TrendingUp, Calendar, Clock } from "lucide-react";

import { useBacktests } from "@/hooks/useBacktests";
import { useStrategies } from "@/hooks/useStrategies";
import { num, timeAgo } from "@/lib/utils";
import type { Backtest, Strategy } from "@/types/api";

function fmtDuration(ms: number | null | undefined): string {
  if (!ms) return "--";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

const statusFilters = ["All", "Completed", "Running", "Queued", "Failed"] as const;
type StatusFilter = (typeof statusFilters)[number];

const PAGE_SIZE = 25;

export default function Backtests() {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState<StatusFilter>("All");
  const [symbolFilter, setSymbolFilter] = useState<string>("All");
  const [timeframeFilter, setTimeframeFilter] = useState<string>("All");
  const [page, setPage] = useState(1);

  const { data: backtests, isLoading } = useBacktests();
  const { data: strategies } = useStrategies();

  // Build strategy name lookup
  const strategyMap = new Map<string, string>();
  strategies?.forEach((s: Strategy) => strategyMap.set(s.id, s.name));

  // Extract unique symbols and timeframes for filter dropdowns
  const symbols = useMemo(() => {
    if (!backtests?.length) return [];
    return [...new Set(backtests.map((b: Backtest) => b.symbol).filter(Boolean))].sort();
  }, [backtests]);

  const timeframes = useMemo(() => {
    if (!backtests?.length) return [];
    return [...new Set(backtests.map((b: Backtest) => b.timeframe).filter(Boolean))].sort();
  }, [backtests]);

  // Filter
  const filtered = useMemo(() => {
    let result = backtests ?? [];
    if (activeFilter !== "All") {
      result = result.filter((b: Backtest) => b.status === activeFilter.toLowerCase());
    }
    if (symbolFilter !== "All") {
      result = result.filter((b: Backtest) => b.symbol === symbolFilter);
    }
    if (timeframeFilter !== "All") {
      result = result.filter((b: Backtest) => b.timeframe === timeframeFilter);
    }
    return result;
  }, [backtests, activeFilter, symbolFilter, timeframeFilter]);

  // Pagination
  const totalFiltered = filtered.length;
  const paginatedData = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // Reset page when filters change
  const handleFilterChange = (setter: (v: any) => void, value: any) => {
    setter(value);
    setPage(1);
  };

  const completed = (backtests ?? []).filter((b: Backtest) => b.status === "completed").length;
  const running = (backtests ?? []).filter((b: Backtest) => b.status === "running").length;
  const total = (backtests ?? []).length;

  // Summary stats
  const bestSharpe = (backtests ?? [])
    .filter((b: Backtest) => b.status === "completed")
    .reduce((best: number, b: Backtest) => Math.max(best, num(b.sharpeRatio)), 0);

  const latestId = (backtests ?? []).length > 0 ? (backtests![0].id?.slice(0, 8) ?? "--") : "--";

  const avgRuntime = (() => {
    const times = (backtests ?? [])
      .filter((b: Backtest) => b.executionTimeMs != null)
      .map((b: Backtest) => b.executionTimeMs!);
    if (times.length === 0) return "--";
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return fmtDuration(avg);
  })();

  const columns = [
    { key: "id", header: "ID", mono: true,
      render: (r: any) => <span className="text-primary font-mono text-xs">{r.id.slice(0, 8)}</span> },
    { key: "strategy", header: "Strategy",
      render: (r: any) => strategyMap.get(r.strategyId) || r.strategyId?.slice(0, 8) || "--" },
    { key: "symbol", header: "Sym", mono: true,
      render: (r: any) => <span className="font-mono text-xs text-primary">{r.symbol}</span> },
    { key: "period", header: "Period",
      render: (r: any) => {
        try {
          const start = new Date(r.startDate).toLocaleDateString("en-US", { month: "short" });
          const end = new Date(r.endDate).toLocaleDateString("en-US", { month: "short", year: "numeric" });
          return `${start} - ${end}`;
        } catch {
          return "--";
        }
      } },
    { key: "totalTrades", header: "Trades", align: "right" as const, mono: true, sortable: true },
    { key: "pnl", header: "P&L", align: "right" as const, mono: true, sortable: true,
      render: (r: any) => {
        if (r.status !== "completed") return <span className="text-text-muted">--</span>;
        const totalReturn = num(r.totalReturn);
        const pnl = Math.abs(totalReturn) < 10 ? totalReturn * 50_000 : totalReturn;
        return (
          <span className={pnl >= 0 ? "text-profit" : "text-loss"}>
            {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span>
        );
      } },
    { key: "sharpe", header: "Sharpe", align: "right" as const, mono: true, sortable: true,
      render: (r: any) => r.status === "completed" ? (
        <span className={num(r.sharpeRatio) >= 1.5 ? "text-profit" : num(r.sharpeRatio) >= 1 ? "text-foreground" : "text-loss"}>
          {num(r.sharpeRatio).toFixed(2)}
        </span>
      ) : <span className="text-text-muted">--</span> },
    { key: "winRate", header: "Win%", align: "right" as const, mono: true, sortable: true,
      render: (r: any) => r.status === "completed" ? `${num(r.winRate).toFixed(1)}%` : <span className="text-text-muted">--</span> },
    { key: "duration", header: "Runtime", align: "right" as const, mono: true,
      render: (r: any) => fmtDuration(r.executionTimeMs) },
    { key: "status", header: "Status",
      render: (r: any) => (
        <StatusBadge
          variant={r.status === "completed" ? "profit" : r.status === "running" ? "amber" : r.status === "failed" ? "loss" : "neutral"}
          dot
        >
          {r.status}
        </StatusBadge>
      ) },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-sm text-text-muted">Loading backtests...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Backtests</h1>
        <p className="text-sm text-text-secondary mt-1">
          {completed} completed · {running} running · {total} total
        </p>
      </motion.div>

      {/* Summary cards */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        {[
          { icon: FlaskConical, label: "Total Backtests", value: total.toString(), color: "text-primary" },
          { icon: TrendingUp, label: "Best Sharpe", value: bestSharpe > 0 ? bestSharpe.toFixed(2) : "--", color: "text-profit" },
          { icon: Calendar, label: "Latest", value: latestId, color: "text-foreground" },
          { icon: Clock, label: "Avg Runtime", value: avgRuntime, color: "text-foreground" },
        ].map((m, i) => (
          <div key={i} className="forge-card px-4 py-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-surface-2/50">
              <m.icon className="w-4 h-4 text-text-muted" />
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-text-muted block">{m.label}</span>
              <span className={`text-sm font-mono font-bold ${m.color}`}>{m.value}</span>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Filter chips */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="flex items-center gap-2 flex-wrap">
        {statusFilters.map((f) => (
          <button
            key={f}
            onClick={() => handleFilterChange(setActiveFilter, f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              activeFilter === f
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-text-secondary hover:text-foreground hover:bg-surface-2/50 border border-transparent"
            }`}
          >
            {f}
          </button>
        ))}

        {/* Symbol filter */}
        {symbols.length > 1 && (
          <select
            value={symbolFilter}
            onChange={(e) => handleFilterChange(setSymbolFilter, e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--surface-2))] text-foreground border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="All">All Symbols</option>
            {symbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}

        {/* Timeframe filter */}
        {timeframes.length > 1 && (
          <select
            value={timeframeFilter}
            onChange={(e) => handleFilterChange(setTimeframeFilter, e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--surface-2))] text-foreground border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="All">All Timeframes</option>
            {timeframes.map((tf) => (
              <option key={tf} value={tf}>{tf}</option>
            ))}
          </select>
        )}
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="forge-card p-5"
      >
        {paginatedData.length > 0 ? (
          <>
            <ForgeTable
              columns={columns}
              data={paginatedData}
              className="cursor-pointer"
              onRowClick={(row: any) => navigate(`/backtests/${row.id}`)}
            />
            {totalFiltered > PAGE_SIZE && (
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={totalFiltered}
                onPageChange={setPage}
              />
            )}
          </>
        ) : (
          <p className="text-sm text-text-muted text-center py-8">No backtests found</p>
        )}
      </motion.div>
    </div>
  );
}
