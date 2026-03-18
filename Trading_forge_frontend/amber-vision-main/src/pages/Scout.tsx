import { motion } from "framer-motion";
import { Search, Sparkles, Target, TrendingUp, BarChart3, Clock, Loader2 } from "lucide-react";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import { useScoutFunnel, useJournal } from "@/hooks/useJournal";
import { num, timeAgo } from "@/lib/utils";

const statusVariant: Record<string, "profit" | "amber" | "info" | "neutral"> = {
  promoted: "profit",
  validated: "profit",
  tested: "amber",
  backtesting: "amber",
  scouted: "info",
  screening: "info",
  rejected: "neutral",
};

export default function Scout() {
  const { data: funnel, isLoading: funnelLoading } = useScoutFunnel();
  const { data: entries, isLoading: entriesLoading } = useJournal({ status: "scouted", limit: 20 });

  const summaryCards = [
    { icon: Search, label: "Scanning", value: funnel ? funnel.scouted.toLocaleString() : "—", sub: "strategies scouted" },
    { icon: Target, label: "Candidates", value: funnel ? funnel.tested.toLocaleString() : "—", sub: "passed to testing" },
    { icon: Sparkles, label: "Validated", value: funnel ? funnel.passed.toLocaleString() : "—", sub: "passed gates" },
    { icon: Clock, label: "Deployed", value: funnel ? funnel.deployed.toLocaleString() : "—", sub: "live / paper" },
  ];

  const scoutResults = (entries ?? []).map((entry, idx) => {
    const params = entry.strategyParams ?? {};
    const perf = entry.performanceGateResult ?? {};
    return {
      id: entry.id,
      name: params.name ?? (entry.generationPrompt ? entry.generationPrompt.slice(0, 30) : `Strategy #${idx + 1}`),
      instrument: params.symbol ?? "—",
      timeframe: params.timeframe ?? "—",
      type: entry.source,
      sharpe: perf.sharpe ?? params.sharpe ?? null,
      winRate: perf.winRate ?? params.winRate ?? null,
      trades: perf.totalTrades ?? params.totalTrades ?? null,
      drawdown: perf.maxDrawdown ?? params.maxDrawdown ?? null,
      forgeScore: num(entry.forgeScore),
      status: entry.status,
    };
  });

  const isLoading = funnelLoading || entriesLoading;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Strategy Scout</h1>
        <p className="text-sm text-text-secondary mt-1">AI-powered strategy discovery & parameter optimization</p>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="forge-card p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <c.icon className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] uppercase tracking-widest text-text-muted">{c.label}</span>
            </div>
            <p className="text-xl font-mono font-semibold text-foreground">{c.value}</p>
            <p className="text-[11px] text-text-muted mt-0.5">{c.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Results */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-text-secondary flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Scout Results
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-text-muted gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading scout data...</span>
          </div>
        ) : scoutResults.length === 0 ? (
          <div className="forge-card p-8 text-center">
            <p className="text-sm text-text-muted">No scouted strategies yet. Run the scout pipeline to discover strategies.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {scoutResults.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="forge-card p-5 flex gap-5 cursor-pointer"
              >
                <ForgeScoreRing score={r.forgeScore} maxScore={100} size={60} strokeWidth={5} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-foreground truncate">{r.name}</h3>
                    <StatusBadge variant={statusVariant[r.status] ?? "neutral"} dot>
                      {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                    </StatusBadge>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <StatusBadge variant="neutral">{r.instrument}</StatusBadge>
                    <StatusBadge variant="neutral">{r.timeframe}</StatusBadge>
                    <StatusBadge variant="neutral">{r.type}</StatusBadge>
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-text-muted">Sharpe</span>
                      <p className="font-mono text-foreground">{r.sharpe != null ? num(r.sharpe).toFixed(2) : "—"}</p>
                    </div>
                    <div>
                      <span className="text-text-muted">Win %</span>
                      <p className="font-mono text-foreground">{r.winRate != null ? `${num(r.winRate).toFixed(1)}%` : "—"}</p>
                    </div>
                    <div>
                      <span className="text-text-muted">Trades</span>
                      <p className="font-mono text-foreground">{r.trades != null ? num(r.trades) : "—"}</p>
                    </div>
                    <div>
                      <span className="text-text-muted">Max DD</span>
                      <p className="font-mono text-loss">{r.drawdown != null ? `${num(r.drawdown).toFixed(1)}%` : "—"}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
