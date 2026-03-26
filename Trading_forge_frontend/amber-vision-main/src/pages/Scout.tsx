import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import { Pagination } from "@/components/forge/Pagination";
import {
  Search,
  Sparkles,
  Target,
  TrendingUp,
  BarChart3,
  Clock,
  Loader2,
  ExternalLink,
  Globe,
  ChevronDown,
  ChevronUp,
  Filter,
  SlidersHorizontal,
} from "lucide-react";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import { useScoutFunnel, useJournal } from "@/hooks/useJournal";
import type { JournalFilters } from "@/hooks/useJournal";
import { num, timeAgo } from "@/lib/utils";

/* ── Helpers ─────────────────────────────────────────────── */

/** Strip HTML tags and entities */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Clean display title — strip domain suffixes, trailing site names, brackets */
function cleanTitle(raw: string): string {
  let t = stripHtml(raw);
  // Remove trailing " - Reddit", " | YouTube", " - Site Name", etc.
  t = t.replace(/\s*[-|]\s*(Reddit|YouTube|Medium|Substack|TradingView|Investopedia|BabyPips|Warrior Trading|.*\.com).*$/i, "");
  // Remove "[Full Guide]", "[2024]", etc.
  t = t.replace(/\s*\[.*?\]\s*/g, " ");
  return t.trim();
}

/** Detect source from URL */
function sourceLabel(url?: string): { label: string; variant: "info" | "amber" | "neutral" } {
  if (!url) return { label: "Web", variant: "neutral" };
  const lower = url.toLowerCase();
  if (lower.includes("reddit.com")) return { label: "Reddit", variant: "amber" };
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return { label: "YouTube", variant: "info" };
  if (lower.includes("medium.com")) return { label: "Medium", variant: "info" };
  if (lower.includes("tradingview.com")) return { label: "TradingView", variant: "info" };
  return { label: "Web", variant: "neutral" };
}

/* ── Constants ───────────────────────────────────────────── */

const statusVariant: Record<string, "profit" | "amber" | "info" | "neutral"> = {
  promoted: "profit",
  validated: "profit",
  tested: "amber",
  backtesting: "amber",
  scouted: "info",
  screening: "info",
  rejected: "neutral",
};

const SOURCE_TYPE_OPTIONS = ["all", "Reddit", "YouTube", "Web"] as const;
const CONFIDENCE_OPTIONS = [
  { label: "Any", value: 0 },
  { label: "> 30%", value: 0.3 },
  { label: "> 50%", value: 0.5 },
  { label: "> 70%", value: 0.7 },
] as const;

const PAGE_SIZE = 20;

export default function Scout() {
  const [page, setPage] = useState(0);
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>("all");
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: funnel, isLoading: funnelLoading } = useScoutFunnel();

  const filters = useMemo<JournalFilters>(() => ({
    status: "scouted",
    limit: PAGE_SIZE + 10, // fetch a few extra to account for dedup
    offset: page * PAGE_SIZE,
  }), [page]);

  const { data: rawEntries, isLoading: entriesLoading } = useJournal(filters);

  // Deduplicate by title_hash, apply source/confidence filters
  const scoutResults = useMemo(() => {
    if (!rawEntries) return [];

    // Deduplicate
    const seen = new Map<string, typeof rawEntries[0]>();
    const noDup: typeof rawEntries = [];
    for (const e of rawEntries) {
      const hash = e.strategyParams?.title_hash;
      if (hash) {
        const existing = seen.get(hash);
        if (!existing || new Date(e.createdAt) > new Date(existing.createdAt)) {
          seen.set(hash, e);
        }
      } else {
        noDup.push(e);
      }
    }
    const deduped = [...noDup, ...Array.from(seen.values())].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return deduped
      .map((entry, idx) => {
        const params = entry.strategyParams ?? {};
        const perf = entry.performanceGateResult ?? {};
        const isScouted = entry.status === "scouted";
        const rawName =
          params.title ?? params.name ??
          (entry.generationPrompt ? entry.generationPrompt.slice(0, 60) : `Strategy #${idx + 1}`);
        const name = cleanTitle(rawName);
        const hasMetrics = !isScouted && (entry.forgeScore != null || perf.sharpe != null || params.sharpe != null);
        const url = params.url ?? params.source_url ?? null;
        const src = sourceLabel(url);
        const instruments: string[] = params.instruments ?? (params.symbol ? [params.symbol] : []);
        const indicators: string[] = params.indicators ?? [];
        const confidence = params.confidence ?? params.confidence_score ?? null;
        const sourceQuality = params.source_quality ?? params.sourceQuality ?? null;
        const description = params.description ?? params.summary ?? null;

        return {
          id: entry.id,
          name,
          instrument: params.symbol ?? instruments[0] ?? "—",
          instruments,
          indicators,
          timeframe: params.timeframe ?? "—",
          type: entry.source,
          sharpe: hasMetrics ? (perf.sharpe ?? perf.sharpeRatio ?? params.sharpe ?? null) : null,
          winRate: hasMetrics ? (perf.winRate ?? perf.win_rate ?? params.winRate ?? null) : null,
          trades: hasMetrics ? (perf.totalTrades ?? perf.total_trades ?? params.totalTrades ?? null) : null,
          drawdown: hasMetrics ? (perf.maxDrawdown ?? perf.max_drawdown ?? params.maxDrawdown ?? null) : null,
          forgeScore: entry.forgeScore != null ? num(entry.forgeScore) : null,
          status: entry.status,
          url,
          src,
          confidence,
          sourceQuality,
          description,
          isScouted,
          createdAt: entry.createdAt,
        };
      })
      .filter((r) => {
        // Source type filter
        if (sourceTypeFilter !== "all" && r.src.label !== sourceTypeFilter) return false;
        // Confidence threshold
        if (confidenceThreshold > 0) {
          const c = r.confidence != null ? num(r.confidence) : 0;
          if (c < confidenceThreshold) return false;
        }
        return true;
      })
      .slice(0, PAGE_SIZE);
  }, [rawEntries, sourceTypeFilter, confidenceThreshold]);

  const summaryCards = [
    { icon: Search, label: "Scanning", value: funnel ? funnel.scouted.toLocaleString() : "—", sub: "strategies scouted" },
    { icon: Target, label: "Candidates", value: funnel ? funnel.tested.toLocaleString() : "—", sub: "passed to testing" },
    { icon: Sparkles, label: "Validated", value: funnel ? funnel.passed.toLocaleString() : "—", sub: "passed gates" },
    { icon: Clock, label: "Deployed", value: funnel ? funnel.deployed.toLocaleString() : "—", sub: "live / paper" },
  ];

  const isLoading = funnelLoading || entriesLoading;
  const totalEstimate = funnel ? funnel.scouted : 0;
  const totalPages = Math.max(1, Math.ceil(totalEstimate / PAGE_SIZE));

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

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-text-muted" />

        {/* Source type */}
        <div className="flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-xs text-text-muted">Source:</span>
          {SOURCE_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => { setSourceTypeFilter(opt); setPage(0); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                sourceTypeFilter === opt
                  ? "bg-primary text-primary-foreground"
                  : "text-text-muted hover:text-foreground bg-[hsl(var(--surface-2))] border border-border/30"
              }`}
            >
              {opt === "all" ? "All" : opt}
            </button>
          ))}
        </div>

        {/* Confidence threshold */}
        <div className="flex items-center gap-1.5">
          <SlidersHorizontal className="w-3.5 h-3.5 text-text-muted" />
          <span className="text-xs text-text-muted">Confidence:</span>
          {CONFIDENCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setConfidenceThreshold(opt.value); setPage(0); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                confidenceThreshold === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-text-muted hover:text-foreground bg-[hsl(var(--surface-2))] border border-border/30"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
            <p className="text-sm text-text-muted">No scouted strategies match the current filters. Run the scout pipeline to discover strategies.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {scoutResults.map((r, i) => {
              const isExpanded = expandedId === r.id;

              return (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="forge-card overflow-hidden"
                >
                  {/* Card header — clickable */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="w-full text-left p-5 flex gap-5 hover:bg-[hsl(var(--surface-2))]/20 transition-colors"
                  >
                    {r.forgeScore != null && r.forgeScore > 0 ? (
                      <ForgeScoreRing score={r.forgeScore} maxScore={100} size={60} strokeWidth={5} />
                    ) : (
                      <div className="w-[60px] h-[60px] rounded-full border-2 border-border/30 flex items-center justify-center text-text-muted text-xs">—</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-medium text-foreground line-clamp-2" title={r.name}>{r.name}</h3>
                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                          <StatusBadge variant={statusVariant[r.status] ?? "neutral"} dot>
                            {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                          </StatusBadge>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                          )}
                        </div>
                      </div>

                      {/* Badges: instrument, source, timeframe */}
                      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                        {r.instruments.length > 0 ? (
                          r.instruments.slice(0, 3).map((inst) => (
                            <span
                              key={inst}
                              className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-primary/10 text-primary border border-primary/20"
                            >
                              {inst}
                            </span>
                          ))
                        ) : (
                          <StatusBadge variant="neutral">{r.instrument}</StatusBadge>
                        )}
                        {r.instruments.length > 3 && (
                          <span className="text-[10px] text-text-muted">+{r.instruments.length - 3}</span>
                        )}
                        <StatusBadge variant="neutral">{r.timeframe}</StatusBadge>
                        <StatusBadge variant={r.src.variant}>
                          <Globe className="w-3 h-3 inline mr-0.5" />
                          {r.src.label}
                        </StatusBadge>
                      </div>

                      {/* Indicators as chips */}
                      {r.indicators.length > 0 && (
                        <div className="flex items-center gap-1 mb-2 flex-wrap">
                          {r.indicators.slice(0, 4).map((ind) => (
                            <span
                              key={ind}
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-info/10 text-info border border-info/20"
                            >
                              {ind}
                            </span>
                          ))}
                          {r.indicators.length > 4 && (
                            <span className="text-[10px] text-text-muted">+{r.indicators.length - 4} more</span>
                          )}
                        </div>
                      )}

                      {/* Metrics or confidence row */}
                      {r.isScouted ? (
                        <div className="flex items-center gap-4 text-xs text-text-muted">
                          {r.confidence != null && (
                            <span>
                              Confidence{" "}
                              <span className={`font-mono ${num(r.confidence) >= 0.7 ? "text-profit" : num(r.confidence) >= 0.4 ? "text-primary" : "text-loss"}`}>
                                {(num(r.confidence) * 100).toFixed(0)}%
                              </span>
                            </span>
                          )}
                          {r.sourceQuality != null && (
                            <span>
                              Quality{" "}
                              <span className={`font-mono ${num(r.sourceQuality) >= 0.7 ? "text-profit" : num(r.sourceQuality) >= 0.4 ? "text-primary" : "text-loss"}`}>
                                {(num(r.sourceQuality) * 100).toFixed(0)}%
                              </span>
                            </span>
                          )}
                          <span className="text-text-muted">{timeAgo(r.createdAt)}</span>
                        </div>
                      ) : (
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
                      <div className="p-5 space-y-4">
                        {/* Description */}
                        {r.description && (
                          <div className="text-xs text-text-secondary leading-relaxed">
                            {stripHtml(r.description)}
                          </div>
                        )}

                        {/* Source URL */}
                        {r.url && (
                          <div className="flex items-center gap-2 text-xs">
                            <ExternalLink className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:text-primary/80 underline underline-offset-2 truncate"
                            >
                              View Source
                            </a>
                            <span className="text-text-muted truncate hidden sm:inline">({r.url})</span>
                          </div>
                        )}

                        {/* Detail grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="flex flex-col gap-0.5 py-2 px-3 rounded-lg bg-[hsl(var(--surface-2))]/50">
                            <span className="text-[10px] uppercase tracking-widest text-text-muted">Source</span>
                            <span className="text-sm font-medium text-foreground">{r.src.label}</span>
                          </div>
                          <div className="flex flex-col gap-0.5 py-2 px-3 rounded-lg bg-[hsl(var(--surface-2))]/50">
                            <span className="text-[10px] uppercase tracking-widest text-text-muted">Confidence</span>
                            <span className="text-sm font-mono font-semibold text-foreground">
                              {r.confidence != null ? `${(num(r.confidence) * 100).toFixed(0)}%` : "—"}
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5 py-2 px-3 rounded-lg bg-[hsl(var(--surface-2))]/50">
                            <span className="text-[10px] uppercase tracking-widest text-text-muted">Source Quality</span>
                            <span className="text-sm font-mono font-semibold text-foreground">
                              {r.sourceQuality != null ? `${(num(r.sourceQuality) * 100).toFixed(0)}%` : "—"}
                            </span>
                          </div>
                          <div className="flex flex-col gap-0.5 py-2 px-3 rounded-lg bg-[hsl(var(--surface-2))]/50">
                            <span className="text-[10px] uppercase tracking-widest text-text-muted">Scouted</span>
                            <span className="text-sm font-medium text-foreground">{timeAgo(r.createdAt)}</span>
                          </div>
                        </div>

                        {/* Instruments */}
                        {r.instruments.length > 0 && (
                          <div>
                            <span className="text-[10px] uppercase tracking-widest text-text-muted">Instruments</span>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {r.instruments.map((inst) => (
                                <span
                                  key={inst}
                                  className="px-2 py-0.5 rounded text-xs font-mono bg-primary/10 text-primary border border-primary/20"
                                >
                                  {inst}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Indicators */}
                        {r.indicators.length > 0 && (
                          <div>
                            <span className="text-[10px] uppercase tracking-widest text-text-muted">Indicators</span>
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {r.indicators.map((ind) => (
                                <span
                                  key={ind}
                                  className="px-2 py-0.5 rounded text-xs font-mono bg-info/10 text-info border border-info/20"
                                >
                                  {ind}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Timestamp */}
                        <div className="text-[11px] text-text-muted pt-1 border-t border-border/10">
                          Scouted {new Date(r.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {!isLoading && scoutResults.length > 0 && (
        <Pagination
          page={page + 1}
          pageSize={PAGE_SIZE}
          total={totalEstimate}
          onPageChange={(p) => setPage(p - 1)}
        />
      )}
    </motion.div>
  );
}
