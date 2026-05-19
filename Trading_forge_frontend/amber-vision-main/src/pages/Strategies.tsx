import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { Pagination } from "@/components/forge/Pagination";
import { EquityCurveSparkline } from "@/components/forge/EquityCurveSparkline";
import { TrendingUp, TrendingDown, Calendar, Play, Sparkles } from "lucide-react";
import { useStrategies } from "@/hooks/useStrategies";
import { useBacktests } from "@/hooks/useBacktests";
import { num, fmtCurrency, timeAgo } from "@/lib/utils";

type UIStatus = "active" | "paused" | "testing" | "retired";

function mapStatus(lifecycleState: string): UIStatus {
  switch (lifecycleState) {
    case "DEPLOYED":
    case "PAPER":
      return "active";
    case "DECLINING":
      return "paused";
    case "TESTING":
    case "CANDIDATE":
      return "testing";
    case "RETIRED":
      return "retired";
    default:
      return "testing";
  }
}

const statusVariant = (s: string) =>
  s === "active" ? "profit" : s === "paused" ? "amber" : "info";

const PAGE_SIZE = 20;

export default function Strategies() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("All");
  const [symbolFilter, setSymbolFilter] = useState("All");
  const [page, setPage] = useState(1);
  const { data: rawStrategies, isLoading: strategiesLoading } = useStrategies();
  const { data: rawBacktests, isLoading: backtestsLoading } = useBacktests();

  // Build a map: strategyId -> latest completed backtest
  const backtestByStrategy = useMemo(() => {
    const map = new Map<string, (typeof rawBacktests extends (infer T)[] ? T : never)>();
    if (!rawBacktests?.length) return map;
    const completed = rawBacktests
      .filter((bt) => bt.status === "completed")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    for (const bt of completed) {
      if (!map.has(bt.strategyId)) {
        map.set(bt.strategyId, bt);
      }
    }
    return map;
  }, [rawBacktests]);

  const strategies = useMemo(() => {
    if (!rawStrategies?.length) return [];
    return rawStrategies.map((s) => {
      const bt = backtestByStrategy.get(s.id);
      const pnl = bt ? num(bt.totalReturn) : null;
      const winRate = bt ? num(bt.winRate) : null;
      const sharpe = bt ? num(bt.sharpeRatio) : null;
      const trades = bt ? (bt.totalTrades ?? null) : null;
      const maxDD = bt ? num(bt.maxDrawdown) : null;
      const pnlPct = pnl !== null && pnl !== 0 ? pnl / 1000 : null;
      const hasBacktest = bt != null;
      return {
        id: s.id,
        name: s.name,
        instrument: s.symbol,
        status: mapStatus(s.lifecycleState),
        score: num(s.forgeScore),
        pnl,
        pnlPct,
        winRate,
        sharpe,
        trades,
        maxDD,
        description: s.description ?? "",
        lastTrade: bt ? timeAgo(bt.createdAt) : "--",
        latestBacktestId: bt?.id,
        hasBacktest,
      };
    });
  }, [rawStrategies, backtestByStrategy]);

  // Extract unique symbols
  const symbols = useMemo(() => {
    return [...new Set(strategies.map((s) => s.instrument).filter(Boolean))].sort();
  }, [strategies]);

  const filtered = useMemo(() => {
    let result = strategies;
    if (filter !== "All") {
      result = result.filter((s) => s.status === filter.toLowerCase());
    }
    if (symbolFilter !== "All") {
      result = result.filter((s) => s.instrument === symbolFilter);
    }
    return result;
  }, [strategies, filter, symbolFilter]);

  // Pagination
  const totalFiltered = filtered.length;
  const paginatedStrategies = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const handleFilterChange = (setter: (v: any) => void, value: any) => {
    setter(value);
    setPage(1);
  };

  const isLoading = strategiesLoading || backtestsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Strategies</h1>
          <p className="text-sm text-text-secondary mt-1">Loading strategies...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">Strategies</h1>
        <p className="text-sm text-text-secondary mt-1">
          {strategies.filter((s) => s.status === "active").length} active · {strategies.length} total
        </p>
      </motion.div>

      {/* Filter bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex items-center gap-2 flex-wrap"
      >
        {["All", "Active", "Paused", "Testing"].map((f) => (
          <button
            key={f}
            onClick={() => handleFilterChange(setFilter, f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              filter === f
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
      </motion.div>

      {/* Strategy Grid */}
      {paginatedStrategies.length > 0 ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paginatedStrategies.map((s, i) => (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05 * i }}
                className="forge-card p-5 cursor-pointer group min-h-[320px] flex flex-col ring-1 ring-white/5 hover:ring-primary/30 transition-all duration-300 relative overflow-hidden"
                onClick={() => navigate(`/strategies/${s.id}`)}
              >
                {/* Subtle gradient glow on hover */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/0 via-transparent to-primary/0 group-hover:from-primary/5 group-hover:to-primary/10 transition-all duration-500 pointer-events-none" />

                {/* Header */}
                <div className="flex items-start justify-between mb-4 relative">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-primary">{s.instrument}</span>
                      <StatusBadge variant={statusVariant(s.status)} dot>{s.status}</StatusBadge>
                    </div>
                    <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                      {s.name}
                    </h3>
                    <p className="text-[11px] text-text-muted mt-1 line-clamp-2 leading-relaxed min-h-[2.4em]">
                      {s.description || "No description"}
                    </p>
                  </div>
                  <div className="ml-3 shrink-0">
                    <ForgeScoreRing score={s.score} size={72} strokeWidth={5} label="" />
                  </div>
                </div>

                {/* Equity sparkline OR empty-state CTA */}
                <div className="mb-3 relative">
                  {s.hasBacktest ? (
                    <EquityCurveSparkline backtestId={s.latestBacktestId} height={56} />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigate(`/strategies/${s.id}?action=backtest`); }}
                      className="w-full h-14 rounded-md border border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all flex items-center justify-center gap-2 text-[11px] text-primary/80 hover:text-primary"
                    >
                      <Play className="w-3 h-3" />
                      Run a backtest to see metrics
                    </button>
                  )}
                </div>

                {/* Metrics grid — only when we have data */}
                <div className="grid grid-cols-4 gap-3 pt-3 border-t border-border/20 relative">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-0.5">P&L</span>
                    {s.pnl !== null ? (
                      <span className={`text-xs font-mono font-semibold ${s.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                        {s.pnl >= 0 ? "+" : ""}${(Math.abs(s.pnl) / 1000).toFixed(1)}k
                      </span>
                    ) : (
                      <span className="text-xs font-mono text-text-muted/50">—</span>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-0.5">Win%</span>
                    {s.winRate !== null ? (
                      <span className="text-xs font-mono font-semibold text-foreground">{s.winRate.toFixed(1)}%</span>
                    ) : (
                      <span className="text-xs font-mono text-text-muted/50">—</span>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-0.5">Sharpe</span>
                    {s.sharpe !== null ? (
                      <span className="text-xs font-mono font-semibold text-foreground">{s.sharpe.toFixed(2)}</span>
                    ) : (
                      <span className="text-xs font-mono text-text-muted/50">—</span>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-0.5">Trades</span>
                    {s.trades !== null ? (
                      <span className="text-xs font-mono font-semibold text-foreground">{s.trades}</span>
                    ) : (
                      <span className="text-xs font-mono text-text-muted/50">—</span>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/10 relative">
                  <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                    <Calendar className="w-3 h-3" />
                    {s.hasBacktest ? `Last: ${s.lastTrade}` : "Never run"}
                  </div>
                  <div className="flex items-center gap-1">
                    {s.pnlPct !== null ? (
                      <>
                        {s.pnlPct >= 0 ? (
                          <TrendingUp className="w-3 h-3 text-profit" />
                        ) : (
                          <TrendingDown className="w-3 h-3 text-loss" />
                        )}
                        <span className={`text-[10px] font-mono ${s.pnlPct >= 0 ? "text-profit" : "text-loss"}`}>
                          {s.pnlPct >= 0 ? "+" : ""}{s.pnlPct.toFixed(1)}%
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] font-mono text-text-muted/50">—</span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
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
        <div className="forge-card p-12 text-center">
          {filter === "All" && symbolFilter === "All" ? (
            <div className="flex flex-col items-center gap-4 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-full bg-primary/10 ring-1 ring-primary/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">No strategies yet</h3>
                <p className="text-xs text-text-muted mt-1">
                  Run the Strategy Scout to generate research-backed candidates,
                  or import a strategy manually.
                </p>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => navigate("/scout")}
                  className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition"
                >
                  Open Strategy Scout
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/strategies/new")}
                  className="px-4 py-1.5 rounded-md border border-border/30 text-xs font-medium hover:bg-surface-2 transition"
                >
                  Import strategy
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-muted">No matching strategies — adjust filters.</p>
          )}
        </div>
      )}
    </div>
  );
}
