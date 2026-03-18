import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import {
  BookOpen,
  Filter,
  TrendingUp,
  AlertTriangle,
  Award,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
} from "lucide-react";
import { useJournal, useJournalStats } from "@/hooks/useJournal";
import { num, fmtPct, timeAgo } from "@/lib/utils";

const STATUS_OPTIONS = ["all", "passed", "failed", "pending"] as const;
const TIER_OPTIONS = ["all", "TIER_1", "TIER_2", "TIER_3", "REJECTED"] as const;
const SOURCE_OPTIONS = ["all", "n8n", "agent", "manual"] as const;

function tierVariant(tier: string | null): "profit" | "amber" | "info" | "loss" | "neutral" {
  if (!tier) return "neutral";
  if (tier === "TIER_1") return "profit";
  if (tier === "TIER_2") return "amber";
  if (tier === "TIER_3") return "info";
  if (tier === "REJECTED") return "loss";
  return "neutral";
}

function statusVariant(status: string): "profit" | "loss" | "amber" | "neutral" {
  if (status === "passed") return "profit";
  if (status === "failed") return "loss";
  if (status === "pending") return "amber";
  return "neutral";
}

export default function Journal() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filters = useMemo(() => {
    const f: { status?: string; tier?: string; source?: string } = {};
    if (statusFilter !== "all") f.status = statusFilter;
    if (tierFilter !== "all") f.tier = tierFilter;
    if (sourceFilter !== "all") f.source = sourceFilter;
    return f;
  }, [statusFilter, tierFilter, sourceFilter]);

  const { data: entries, isLoading: entriesLoading } = useJournal(filters);
  const { data: stats, isLoading: statsLoading } = useJournalStats();

  const recentCount = useMemo(() => {
    if (!entries) return 0;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return entries.filter((e) => new Date(e.createdAt).getTime() > sevenDaysAgo).length;
  }, [entries]);

  const passRate = stats ? num(stats.passRate) : 0;

  const kpis = [
    {
      icon: BookOpen,
      label: "Total Entries",
      value: stats?.total?.toLocaleString() ?? "—",
      variant: "foreground" as const,
    },
    {
      icon: TrendingUp,
      label: "Pass Rate",
      value: stats ? `${passRate.toFixed(1)}%` : "—",
      variant: (passRate >= 30 ? "profit" : passRate > 0 ? "loss" : "foreground") as const,
    },
    {
      icon: Layers,
      label: "By Tier",
      value: stats
        ? Object.entries(stats.byTier ?? {})
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k.replace("TIER_", "T")}:${v}`)
            .join(" ")  || "—"
        : "—",
      variant: "foreground" as const,
    },
    {
      icon: Clock,
      label: "Last 7 Days",
      value: String(recentCount),
      variant: "foreground" as const,
    },
  ];

  const isLoading = entriesLoading || statsLoading;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">System Journal</h1>
        <p className="text-sm text-text-secondary mt-1">
          {entries
            ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"} logged`
            : "AI strategy research log — backtests, critiques, and self-learning"}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="forge-card p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <k.icon className="w-3.5 h-3.5 text-primary" />
              <span className="text-[10px] uppercase tracking-widest text-text-muted">
                {k.label}
              </span>
            </div>
            <p
              className={`text-xl font-mono font-semibold ${
                k.variant === "loss"
                  ? "text-loss"
                  : k.variant === "profit"
                  ? "text-profit"
                  : "text-foreground"
              }`}
            >
              {k.value}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-text-muted" />

        {/* Status */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Status:</span>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setStatusFilter(opt)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                statusFilter === opt
                  ? "bg-primary text-primary-foreground"
                  : "text-text-muted hover:text-foreground bg-[hsl(var(--surface-2))] border border-border/30"
              }`}
            >
              {opt === "all" ? "All" : opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>

        {/* Tier */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Tier:</span>
          {TIER_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setTierFilter(opt)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                tierFilter === opt
                  ? "bg-primary text-primary-foreground"
                  : "text-text-muted hover:text-foreground bg-[hsl(var(--surface-2))] border border-border/30"
              }`}
            >
              {opt === "all" ? "All" : opt.replace("_", " ")}
            </button>
          ))}
        </div>

        {/* Source */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Source:</span>
          {SOURCE_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setSourceFilter(opt)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                sourceFilter === opt
                  ? "bg-primary text-primary-foreground"
                  : "text-text-muted hover:text-foreground bg-[hsl(var(--surface-2))] border border-border/30"
              }`}
            >
              {opt === "all" ? "All" : opt}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="text-text-muted text-sm">Loading journal entries...</div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && entries && entries.length === 0 && (
        <div className="forge-card p-12 text-center">
          <BookOpen className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            No journal entries match the current filters.
          </p>
        </div>
      )}

      {/* Entry list */}
      {!isLoading && entries && entries.length > 0 && (
        <div className="space-y-3">
          {entries.map((entry, i) => {
            const params = entry.strategyParams ?? {};
            const perf = entry.performanceGateResult ?? {};
            const isExpanded = expandedId === entry.id;
            const score = num(entry.forgeScore);
            const name =
              params.name ??
              (entry.generationPrompt
                ? entry.generationPrompt.slice(0, 50)
                : `Strategy #${entry.strategyId?.slice(0, 8) ?? i + 1}`);

            const sharpe = perf.sharpe ?? params.sharpe ?? null;
            const winRate = perf.winRate ?? params.winRate ?? null;
            const profitFactor = perf.profitFactor ?? params.profitFactor ?? null;
            const maxDD = perf.maxDrawdown ?? params.maxDrawdown ?? null;

            return (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="forge-card overflow-hidden"
              >
                {/* Collapsed row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="w-full text-left p-4 flex items-center gap-4 hover:bg-[hsl(var(--surface-2))]/30 transition-colors"
                >
                  {/* Score ring (compact) */}
                  <div className="flex-shrink-0">
                    <ForgeScoreRing
                      score={score}
                      size={48}
                      strokeWidth={4}
                      label=""
                    />
                  </div>

                  {/* Name + badges */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {name}
                      </span>
                      <StatusBadge variant={statusVariant(entry.status)} dot>
                        {entry.status}
                      </StatusBadge>
                      {entry.tier && (
                        <StatusBadge variant={tierVariant(entry.tier)}>
                          {entry.tier.replace("_", " ")}
                        </StatusBadge>
                      )}
                      <StatusBadge variant="neutral">{entry.source}</StatusBadge>
                    </div>

                    {/* Metrics row */}
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-text-muted">
                      {sharpe != null && (
                        <span>
                          Sharpe{" "}
                          <span
                            className={`font-mono ${
                              num(sharpe) >= 1.5 ? "text-profit" : num(sharpe) >= 1 ? "text-primary" : "text-loss"
                            }`}
                          >
                            {num(sharpe).toFixed(2)}
                          </span>
                        </span>
                      )}
                      {winRate != null && (
                        <span>
                          Win{" "}
                          <span className="font-mono text-foreground">
                            {fmtPct(num(winRate) * (num(winRate) <= 1 ? 100 : 1))}
                          </span>
                        </span>
                      )}
                      {profitFactor != null && (
                        <span>
                          PF{" "}
                          <span
                            className={`font-mono ${
                              num(profitFactor) >= 2 ? "text-profit" : num(profitFactor) >= 1.5 ? "text-primary" : "text-loss"
                            }`}
                          >
                            {num(profitFactor).toFixed(2)}
                          </span>
                        </span>
                      )}
                      {maxDD != null && (
                        <span>
                          MaxDD{" "}
                          <span className="font-mono text-loss">
                            {typeof maxDD === "number" && maxDD > 1
                              ? `-$${num(maxDD).toLocaleString()}`
                              : fmtPct(-Math.abs(num(maxDD) * 100))}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Timestamp + expand icon */}
                  <div className="flex-shrink-0 flex items-center gap-3">
                    <span className="text-xs text-text-muted">{timeAgo(entry.createdAt)}</span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-text-muted" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-muted" />
                    )}
                  </div>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    transition={{ duration: 0.25 }}
                    className="border-t border-border/10"
                  >
                    <div className="p-4 space-y-4">
                      {/* Full metrics grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: "Forge Score", value: score > 0 ? `${score}` : "—" },
                          { label: "Sharpe Ratio", value: sharpe != null ? num(sharpe).toFixed(2) : "—" },
                          {
                            label: "Win Rate",
                            value:
                              winRate != null
                                ? `${(num(winRate) * (num(winRate) <= 1 ? 100 : 1)).toFixed(1)}%`
                                : "—",
                          },
                          { label: "Profit Factor", value: profitFactor != null ? num(profitFactor).toFixed(2) : "—" },
                          {
                            label: "Max Drawdown",
                            value:
                              maxDD != null
                                ? typeof maxDD === "number" && maxDD > 1
                                  ? `-$${num(maxDD).toLocaleString()}`
                                  : `${(num(maxDD) * 100).toFixed(1)}%`
                                : "—",
                          },
                          {
                            label: "Total Trades",
                            value: perf.totalTrades != null ? String(perf.totalTrades) : "—",
                          },
                          {
                            label: "Avg Daily P&L",
                            value: perf.avgDailyPnl != null ? `$${num(perf.avgDailyPnl).toFixed(0)}` : "—",
                          },
                          {
                            label: "Expectancy",
                            value: perf.expectancy != null ? `$${num(perf.expectancy).toFixed(0)}` : "—",
                          },
                        ].map((m) => (
                          <div
                            key={m.label}
                            className="flex flex-col gap-0.5 py-2 px-3 rounded-lg bg-[hsl(var(--surface-2))]/50"
                          >
                            <span className="text-[10px] uppercase tracking-widest text-text-muted">
                              {m.label}
                            </span>
                            <span className="text-sm font-mono font-semibold text-foreground">
                              {m.value}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Strategy params */}
                      {params.symbol && (
                        <div className="flex items-center gap-3 text-xs text-text-muted">
                          {params.symbol && <span>Symbol: <span className="text-foreground font-mono">{params.symbol}</span></span>}
                          {params.timeframe && <span>TF: <span className="text-foreground font-mono">{params.timeframe}</span></span>}
                          {entry.strategyId && (
                            <span>
                              ID: <span className="text-foreground font-mono">{entry.strategyId.slice(0, 8)}</span>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Generation prompt */}
                      {entry.generationPrompt && (
                        <div className="text-xs text-text-muted">
                          <span className="text-text-secondary font-medium">Prompt: </span>
                          {entry.generationPrompt}
                        </div>
                      )}

                      {/* Analyst notes */}
                      {entry.analystNotes && (
                        <div className="rounded-lg bg-[hsl(var(--surface-2))]/40 border border-border/10 p-3">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Award className="w-3.5 h-3.5 text-primary" />
                            <span className="text-[10px] uppercase tracking-widest text-text-muted">
                              Analyst Notes
                            </span>
                          </div>
                          <p className="text-xs text-text-secondary italic leading-relaxed">
                            {entry.analystNotes}
                          </p>
                        </div>
                      )}

                      {/* Prop compliance summary */}
                      {entry.propComplianceResults && (
                        <div className="text-xs text-text-muted">
                          <span className="text-text-secondary font-medium">Prop Compliance: </span>
                          {typeof entry.propComplianceResults === "object"
                            ? Object.entries(entry.propComplianceResults)
                                .map(([firm, result]: [string, any]) =>
                                  `${firm}: ${result?.pass ? "PASS" : "FAIL"}`
                                )
                                .join(" | ")
                            : String(entry.propComplianceResults)}
                        </div>
                      )}

                      {/* Timestamps */}
                      <div className="text-[11px] text-text-muted pt-1 border-t border-border/10">
                        Created {new Date(entry.createdAt).toLocaleString()}
                        {entry.parentJournalId && (
                          <span className="ml-3">
                            Parent: <span className="font-mono">{entry.parentJournalId.slice(0, 8)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
