import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { TrendingUp, TrendingDown, Calendar } from "lucide-react";
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

export default function Strategies() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("All");
  const { data: rawStrategies, isLoading: strategiesLoading } = useStrategies();
  const { data: rawBacktests, isLoading: backtestsLoading } = useBacktests();

  // Build a map: strategyId → latest completed backtest
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
      const pnlPct = pnl !== null && pnl !== 0 ? pnl / 1000 : null; // rough % estimate
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
        lastTrade: bt ? timeAgo(bt.createdAt) : "—",
      };
    });
  }, [rawStrategies, backtestByStrategy]);

  const filtered = useMemo(() => {
    if (filter === "All") return strategies;
    return strategies.filter((s) => s.status === filter.toLowerCase());
  }, [strategies, filter]);

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
        className="flex items-center gap-2"
      >
        {["All", "Active", "Paused", "Testing"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              filter === f
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-text-secondary hover:text-foreground hover:bg-surface-2/50 border border-transparent"
            }`}
          >
            {f}
          </button>
        ))}
      </motion.div>

      {/* Strategy Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 * i }}
              className="forge-card p-5 cursor-pointer group"
              onClick={() => navigate(`/strategies/${s.id}`)}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-mono font-semibold text-primary">{s.instrument}</span>
                    <StatusBadge variant={statusVariant(s.status)} dot>{s.status}</StatusBadge>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                    {s.name}
                  </h3>
                  <p className="text-[11px] text-text-muted mt-1 line-clamp-2 leading-relaxed">
                    {s.description}
                  </p>
                </div>
                <div className="ml-3 shrink-0">
                  <ForgeScoreRing score={s.score} size={72} strokeWidth={5} label="" />
                </div>
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-4 gap-3 pt-3 border-t border-border/20">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-0.5">P&L</span>
                  <span className={`text-xs font-mono font-semibold ${s.pnl !== null && s.pnl >= 0 ? "text-profit" : s.pnl !== null ? "text-loss" : "text-text-muted"}`}>
                    {s.pnl !== null
                      ? `${s.pnl >= 0 ? "+" : ""}$${(Math.abs(s.pnl) / 1000).toFixed(1)}k`
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-0.5">Win%</span>
                  <span className="text-xs font-mono font-semibold text-foreground">
                    {s.winRate !== null ? `${s.winRate.toFixed(1)}%` : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-0.5">Sharpe</span>
                  <span className="text-xs font-mono font-semibold text-foreground">
                    {s.sharpe !== null ? s.sharpe.toFixed(2) : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-text-muted block mb-0.5">Trades</span>
                  <span className="text-xs font-mono font-semibold text-foreground">
                    {s.trades !== null ? s.trades : "—"}
                  </span>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/10">
                <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                  <Calendar className="w-3 h-3" />
                  Last backtest: {s.lastTrade}
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
                    <span className="text-[10px] font-mono text-text-muted">—</span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="forge-card p-12 text-center">
          <p className="text-sm text-text-muted">
            {filter === "All" ? "No strategies yet" : `No ${filter.toLowerCase()} strategies`}
          </p>
        </div>
      )}
    </div>
  );
}
