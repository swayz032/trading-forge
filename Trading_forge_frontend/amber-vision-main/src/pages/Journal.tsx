/**
 * Journal.tsx — Wave 26 Pass 2
 *
 * Repurposed from system_journal (research log) → trade journal (paper_positions
 * + trade_critique).  This is the institutional autopsy layer — every closed
 * paper trade, GPT-5.4 annotated, dual-rendered for operator and family.
 *
 * DUAL RENDERING (Finding 9 — autonomous-readiness audit):
 *   Operator view  — technical accordion is OPEN by default; full 8-dimension
 *                    attribution, parameter hints, R percentile, consistency cap.
 *   Family view    — plain-English block only; technical accordion COLLAPSED.
 *
 *   Toggle lives in localStorage at key 'tf:is_operator_account' (boolean,
 *   default true).  A small "View: Operator | Family" toggle sits top-right
 *   of the header.  The real account context wiring (account_strategy_assignments
 *   .is_operator_account) is deferred to a future architect pass — this covers
 *   the automation-readiness gate requirement.
 *
 * DATA SEMANTICS:
 *   - source: GET /api/trade-journal (paper_positions LEFT JOIN trade_critique)
 *   - positions without critique → shown with grade=null (never hidden)
 *   - Default sort: critiquedAt DESC, exitTime DESC
 *
 * PRESERVED UX SHELL:
 *   - Page header with subtitle
 *   - 4-5 KPI cards
 *   - Filter bar (outcome / regime / strategy / gradeMin / date range)
 *   - Expandable card list with pagination
 */

import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import { Pagination } from "@/components/forge/Pagination";
import {
  BookOpen,
  Filter,
  TrendingUp,
  Award,
  ChevronDown,
  ChevronUp,
  Clock,
  Calendar,
  BarChart2,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Target,
} from "lucide-react";
import {
  useTradeJournal,
  useTradeJournalStats,
  type TradeJournalFilters,
} from "@/hooks/useJournal";
import { translateGrade, translateRegime, translateAttribution } from "@/lib/journalTranslate";
import type { TradeJournalEntry } from "@/types/api";
import { num, timeAgo } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

const OUTCOME_OPTIONS = ["all", "win", "loss", "scratch"] as const;
const REGIME_OPTIONS  = ["all", "TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND"] as const;
const GRADE_OPTIONS   = ["any", "C+", "B", "B+", "A", "A+"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function outcomeVariant(outcome: string): "profit" | "loss" | "neutral" | "amber" {
  if (outcome === "win")    return "profit";
  if (outcome === "loss")   return "loss";
  if (outcome === "scratch") return "amber";
  return "neutral";
}

function formatR(r: number | null | undefined): string {
  if (r == null) return "—";
  const sign = r > 0 ? "+" : "";
  return `${sign}${r.toFixed(2)}R`;
}

function formatElapsed(entryTime: string | null, exitTime: string | null): string {
  if (!entryTime || !exitTime) return "—";
  const ms = new Date(exitTime).getTime() - new Date(entryTime).getTime();
  if (ms < 0) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem   = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

/**
 * AttributionBar — simple Tailwind-div bar chart for 8-dimension attribution.
 * No chart library required; purely Tailwind divs.
 */
function AttributionBar({ factor, weight, label }: { factor: string; weight: number; label: string }) {
  const pct = Math.max(0, Math.min(100, weight * 100));
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-text-muted w-36 truncate flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[hsl(var(--surface-2))]">
        <div
          className="h-full rounded-full bg-primary/70"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-mono text-text-muted w-8 text-right">{(pct).toFixed(0)}%</span>
    </div>
  );
}

// ─── Trade Card (expanded detail) ────────────────────────────────────────────

function TradeCardExpanded({
  entry,
  isOperator,
}: {
  entry: TradeJournalEntry;
  isOperator: boolean;
}) {
  const [techOpen, setTechOpen] = useState(isOperator);
  const pe = entry.plainEnglish;
  const td = entry.technicalDiagnosis;
  const gradeStyle = translateGrade(entry.grade);

  // Attribution bars
  const attributionRows = translateAttribution(td?.attribution_weights);

  // Confluence factors missed chips
  const factorsMissed: string[] = td?.confluence_factors_missed ?? [];

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="border-t border-border/10"
    >
      <div className="p-4 space-y-4">

        {/* ── Plain-English block — ALWAYS VISIBLE ── */}
        <div className="rounded-lg bg-[hsl(var(--surface-2))]/50 border border-border/20 p-4 space-y-3">
          {/* Grade pill + one-liner */}
          <div className="flex items-start gap-3">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${gradeStyle.bgColor} ${gradeStyle.color} flex-shrink-0`}
            >
              {gradeStyle.label}
            </span>
            <p className="text-sm text-foreground leading-relaxed">
              {pe?.one_liner ?? "No autopsy available yet — position will be critiqued in the next batch."}
            </p>
          </div>

          {pe && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              {pe.what_went_right && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-profit" />
                    <span className="text-[10px] uppercase tracking-widest text-text-muted">Went Right</span>
                  </div>
                  <p className="text-xs text-text-secondary">{pe.what_went_right}</p>
                </div>
              )}
              {pe.what_to_watch && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Eye className="w-3 h-3 text-amber-400" />
                    <span className="text-[10px] uppercase tracking-widest text-text-muted">Watch</span>
                  </div>
                  <p className="text-xs text-text-secondary">{pe.what_to_watch}</p>
                </div>
              )}
              {pe.action_needed && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3 text-primary" />
                    <span className="text-[10px] uppercase tracking-widest text-text-muted">Action</span>
                  </div>
                  <p className="text-xs text-text-secondary">{pe.action_needed}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Data completeness pill ── */}
        {entry.dataCompleteness && entry.dataCompleteness !== "full" && (
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                entry.dataCompleteness === "minimal"
                  ? "bg-loss/10 text-loss border border-loss/20"
                  : "bg-amber-400/10 text-amber-400 border border-amber-400/20"
              }`}
            >
              {entry.dataCompleteness === "minimal" ? "Minimal data" : "Partial data"}
            </span>
            {entry.missingFields.map((f) => (
              <span
                key={f}
                className="px-2 py-0.5 rounded text-[10px] text-text-muted bg-[hsl(var(--surface-2))] border border-border/20"
              >
                {f}
              </span>
            ))}
          </div>
        )}

        {/* ── Technical Details accordion — OPERATOR default open, FAMILY collapsed ── */}
        {entry.grade != null && td != null && (
          <div className="border border-border/20 rounded-lg overflow-hidden">
            <button
              onClick={() => setTechOpen(!techOpen)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-[hsl(var(--surface-2))]/30 hover:bg-[hsl(var(--surface-2))]/50 transition-colors text-left"
            >
              <span className="text-xs font-medium text-text-secondary flex items-center gap-2">
                <BarChart2 className="w-3.5 h-3.5 text-primary" />
                Technical Details
              </span>
              {techOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
              )}
            </button>

            {techOpen && (
              <div className="p-4 space-y-4">
                {/* Attribution radar (Tailwind bars) */}
                {attributionRows.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[10px] uppercase tracking-widest text-text-muted">8-Dimension Attribution</span>
                    <div className="space-y-1.5">
                      {attributionRows.slice(0, 8).map((row) => (
                        <AttributionBar key={row.factor} {...row} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Key technical metrics grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {td.exit_execution_delta_r != null && (
                    <div className="py-2 px-3 rounded-lg bg-[hsl(var(--surface-2))]/50">
                      <span className="text-[10px] uppercase tracking-widest text-text-muted block">Exit Execution Delta</span>
                      <span className={`text-sm font-mono font-semibold ${Number(td.exit_execution_delta_r) < 0 ? "text-loss" : "text-profit"}`}>
                        {formatR(Number(td.exit_execution_delta_r))}
                      </span>
                    </div>
                  )}
                  {td.expected_r_percentile != null && (
                    <div className="py-2 px-3 rounded-lg bg-[hsl(var(--surface-2))]/50">
                      <span className="text-[10px] uppercase tracking-widest text-text-muted block">R Percentile</span>
                      <span className="text-sm font-mono font-semibold text-foreground">
                        p{Math.round(Number(td.expected_r_percentile))}
                      </span>
                    </div>
                  )}
                  {td.topstep_consistency_distance_to_cap != null && (
                    <div className="py-2 px-3 rounded-lg bg-[hsl(var(--surface-2))]/50">
                      <span className="text-[10px] uppercase tracking-widest text-text-muted block">Topstep Cap Dist.</span>
                      <span className="text-sm font-mono font-semibold text-foreground">
                        {Number(td.topstep_consistency_distance_to_cap).toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {entry.confluenceScoreAtEntry != null && (
                    <div className="py-2 px-3 rounded-lg bg-[hsl(var(--surface-2))]/50">
                      <span className="text-[10px] uppercase tracking-widest text-text-muted block">Confluence Score</span>
                      <span className={`text-sm font-mono font-semibold ${entry.confluenceScoreAtEntry >= 0.72 ? "text-profit" : "text-amber-400"}`}>
                        {(entry.confluenceScoreAtEntry * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                  {entry.implementationShortfall != null && (
                    <div className="py-2 px-3 rounded-lg bg-[hsl(var(--surface-2))]/50">
                      <span className="text-[10px] uppercase tracking-widest text-text-muted block">Impl. Shortfall</span>
                      <span className="text-sm font-mono font-semibold text-foreground">
                        {entry.implementationShortfall}
                      </span>
                    </div>
                  )}
                  {entry.fillRatio != null && (
                    <div className="py-2 px-3 rounded-lg bg-[hsl(var(--surface-2))]/50">
                      <span className="text-[10px] uppercase tracking-widest text-text-muted block">Fill Ratio</span>
                      <span className="text-sm font-mono font-semibold text-foreground">
                        {(Number(entry.fillRatio) * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Confluence factors missed */}
                {factorsMissed.length > 0 && (
                  <div>
                    <span className="text-[10px] uppercase tracking-widest text-text-muted">Confluence Missed</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {factorsMissed.map((f) => (
                        <span
                          key={f}
                          className="px-2 py-0.5 rounded text-xs font-mono bg-loss/10 text-loss border border-loss/20"
                        >
                          {f.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Parameter hint card */}
                {td.parameter_hint && (
                  <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 space-y-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Target className="w-3.5 h-3.5 text-primary" />
                      <span className="text-[10px] uppercase tracking-widest text-text-muted">Parameter Hint</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-text-muted">
                        Field: <span className="text-foreground font-mono">{td.parameter_hint.field}</span>
                      </span>
                      <span className="text-text-muted">
                        Current: <span className="text-foreground font-mono">{td.parameter_hint.current}</span>
                      </span>
                      <span className="text-text-muted">
                        Suggested: <span className="text-primary font-mono">{td.parameter_hint.suggested_range}</span>
                      </span>
                      <span className="text-text-muted">
                        Confidence: <span className="text-foreground font-mono">
                          {(Number(td.parameter_hint.confidence) * 100).toFixed(0)}%
                        </span>
                      </span>
                    </div>
                  </div>
                )}

                {/* Context at trade time */}
                <div className="flex flex-wrap gap-3 text-xs text-text-muted pt-1 border-t border-border/10">
                  {entry.regimeAtEntry && (
                    <span>Regime: <span className="text-foreground">{translateRegime(entry.regimeAtEntry)}</span></span>
                  )}
                  {entry.structureStateAtEntry && (
                    <span>Structure: <span className="text-foreground font-mono">{entry.structureStateAtEntry}</span></span>
                  )}
                  {entry.narrativePhaseAtEntry && (
                    <span>Narrative: <span className="text-foreground">{entry.narrativePhaseAtEntry}</span></span>
                  )}
                  {entry.exitReason && (
                    <span>Exit: <span className="text-foreground">{entry.exitReason}</span></span>
                  )}
                </div>

                {/* Provenance */}
                {(entry.provider ?? entry.model) && (
                  <div className="text-[11px] text-text-muted pt-1 border-t border-border/10">
                    Critiqued by {entry.model ?? entry.provider}
                    {entry.critiquedAt && ` on ${new Date(entry.critiquedAt).toLocaleString()}`}
                    {entry.correlationId && (
                      <span className="ml-3 font-mono">corr:{entry.correlationId.slice(0, 8)}</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* No critique yet — friendly message */}
        {entry.grade == null && (
          <div className="text-xs text-text-muted italic">
            GPT-5.4 autopsy not yet run — position will be critiqued in the next nightly batch.
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Journal() {
  /**
   * Operator/Family toggle.
   * localStorage key: 'tf:is_operator_account' (boolean, default true).
   * Operator view = technical accordion open by default.
   * Family view   = plain-English only, accordion collapsed.
   * Real account wiring (account_strategy_assignments.is_operator_account) is
   * deferred to a future architect pass — this covers Finding 9 gate requirement.
   */
  const [isOperator, setIsOperator] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("tf:is_operator_account");
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });

  const toggleOperator = () => {
    const next = !isOperator;
    setIsOperator(next);
    try { localStorage.setItem("tf:is_operator_account", String(next)); } catch {}
  };

  // Filter state
  const [outcomeFilter, setOutcomeFilter]   = useState<string>("all");
  const [regimeFilter,  setRegimeFilter]    = useState<string>("all");
  const [strategyFilter, setStrategyFilter] = useState<string>("all");
  const [gradeMinFilter, setGradeMinFilter] = useState<string>("any");
  const [expandedId, setExpandedId]         = useState<string | null>(null);
  const [page, setPage]                     = useState(0);
  const [dateFrom, setDateFrom]             = useState<string>("");
  const [dateTo, setDateTo]                 = useState<string>("");

  const filters = useMemo<TradeJournalFilters>(() => {
    const f: TradeJournalFilters = {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    };
    if (outcomeFilter !== "all")   f.outcome  = outcomeFilter as any;
    if (regimeFilter  !== "all")   f.regime   = regimeFilter;
    if (gradeMinFilter !== "any")  f.gradeMin = gradeMinFilter;
    if (dateFrom) f.dateFrom = dateFrom;
    if (dateTo)   f.dateTo   = dateTo;
    return f;
  }, [outcomeFilter, regimeFilter, strategyFilter, gradeMinFilter, page, dateFrom, dateTo]);

  const { data: pageResult, isLoading: entriesLoading } = useTradeJournal(filters);
  const { data: stats, isLoading: statsLoading }        = useTradeJournalStats();

  const entries: TradeJournalEntry[] = pageResult?.data ?? [];
  const totalEstimate = pageResult?.total ?? stats?.totalTrades ?? 0;
  const totalPages    = Math.max(1, Math.ceil(totalEstimate / PAGE_SIZE));
  const isLoading     = entriesLoading || statsLoading;

  // Derive strategy name list from stats for the strategy filter
  const strategyNames = useMemo(
    () => ["all", ...Object.keys(stats?.byStrategy ?? {}).sort()],
    [stats]
  );

  const handleFilterChange = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(0);
  };

  // KPI cards
  const avgRDisplay = stats?.avgR != null ? formatR(stats.avgR) : "—";
  const winRatePct  = stats?.winRate != null ? (stats.winRate * 100).toFixed(1) + "%" : "—";
  const gradeStyle  = translateGrade(stats?.avgGrade ?? null);

  const kpis = [
    {
      icon: BookOpen,
      label: "Total Trades",
      value: stats?.totalTrades?.toLocaleString() ?? "—",
      variant: "foreground" as const,
    },
    {
      icon: TrendingUp,
      label: "Win Rate",
      value: winRatePct,
      variant: (
        stats?.winRate != null
          ? stats.winRate >= 0.5 ? "profit" : "loss"
          : "foreground"
      ) as "profit" | "loss" | "foreground",
    },
    {
      icon: BarChart2,
      label: "Avg R",
      value: avgRDisplay,
      variant: (
        stats?.avgR != null
          ? stats.avgR > 0 ? "profit" : stats.avgR < 0 ? "loss" : "foreground"
          : "foreground"
      ) as "profit" | "loss" | "foreground",
    },
    {
      icon: Award,
      label: "Avg Grade",
      value: stats?.avgGrade ?? "—",
      variant: "foreground" as const,
      extra: stats?.avgGrade ? gradeStyle.color : undefined,
    },
    {
      icon: Clock,
      label: "Last 7 Days",
      value: stats?.last7DaysCount?.toLocaleString() ?? "—",
      variant: "foreground" as const,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Trade Journal</h1>
          <p className="text-sm text-text-secondary mt-1">
            {entries.length > 0
              ? `${totalEstimate.toLocaleString()} trades — page ${page + 1} of ${totalPages}`
              : "GPT-5.4 autopsy of every closed trade — institutional attribution"}
          </p>
        </div>

        {/* Operator / Family view toggle */}
        <button
          onClick={toggleOperator}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
            isOperator
              ? "bg-primary/10 text-primary border-primary/30"
              : "bg-[hsl(var(--surface-2))] text-text-muted border-border/30 hover:text-foreground"
          }`}
          title={`tf:is_operator_account = ${isOperator}. Click to toggle Operator / Family view.`}
        >
          {isOperator ? (
            <><Eye className="w-3 h-3" /> Operator</>
          ) : (
            <><EyeOff className="w-3 h-3" /> Family</>
          )}
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
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
                k.extra
                  ? k.extra
                  : k.variant === "loss"
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

        {/* Outcome */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Outcome:</span>
          {OUTCOME_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => handleFilterChange(setOutcomeFilter, opt)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                outcomeFilter === opt
                  ? "bg-primary text-primary-foreground"
                  : "text-text-muted hover:text-foreground bg-[hsl(var(--surface-2))] border border-border/30"
              }`}
            >
              {opt === "all" ? "All" : opt.charAt(0).toUpperCase() + opt.slice(1)}
            </button>
          ))}
        </div>

        {/* Regime */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Regime:</span>
          {REGIME_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => handleFilterChange(setRegimeFilter, opt)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                regimeFilter === opt
                  ? "bg-primary text-primary-foreground"
                  : "text-text-muted hover:text-foreground bg-[hsl(var(--surface-2))] border border-border/30"
              }`}
            >
              {opt === "all" ? "All" : translateRegime(opt)}
            </button>
          ))}
        </div>

        {/* Strategy */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Strategy:</span>
          <select
            value={strategyFilter}
            onChange={(e) => handleFilterChange(setStrategyFilter, e.target.value)}
            className="px-2 py-1.5 rounded text-xs bg-[hsl(var(--surface-2))] border border-border/30 text-foreground"
          >
            {strategyNames.map((name) => (
              <option key={name} value={name}>
                {name === "all" ? "All" : name}
              </option>
            ))}
          </select>
        </div>

        {/* Grade min */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Min Grade:</span>
          {GRADE_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => handleFilterChange(setGradeMinFilter, opt)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                gradeMinFilter === opt
                  ? "bg-primary text-primary-foreground"
                  : "text-text-muted hover:text-foreground bg-[hsl(var(--surface-2))] border border-border/30"
              }`}
            >
              {opt === "any" ? "Any" : opt}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-text-muted" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
            className="px-2 py-1 rounded text-xs bg-[hsl(var(--surface-2))] border border-border/30 text-foreground"
          />
          <span className="text-xs text-text-muted">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
            className="px-2 py-1 rounded text-xs bg-[hsl(var(--surface-2))] border border-border/30 text-foreground"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(""); setDateTo(""); setPage(0); }}
              className="px-2 py-1 rounded text-xs text-text-muted hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="text-text-muted text-sm">Loading trade journal...</div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && entries.length === 0 && (
        <div className="forge-card p-12 text-center">
          <BookOpen className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            No closed trades match the current filters.
          </p>
        </div>
      )}

      {/* Trade list */}
      {!isLoading && entries.length > 0 && (
        <div className="space-y-3 max-h-[calc(100vh-420px)] overflow-y-auto pr-1">
          {entries.map((entry, i) => {
            const isExpanded    = expandedId === entry.positionId;
            const gradeStyle    = translateGrade(entry.grade);
            const outcomeVar    = outcomeVariant(entry.outcome);
            // Score ring: entry_quality_score / 10 (0-100 normalized from 0-10 scale)
            const score = entry.entryQualityScore != null
              ? Math.round(entry.entryQualityScore * 10)
              : 0;

            const elapsedStr = formatElapsed(
              entry.entryTime as string | null,
              entry.exitTime as string | null
            );

            return (
              <motion.div
                key={entry.positionId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="forge-card overflow-hidden"
              >
                {/* Collapsed row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : entry.positionId)}
                  className="w-full text-left p-4 flex items-center gap-4 hover:bg-[hsl(var(--surface-2))]/30 transition-colors"
                >
                  {/* Score ring (entry_quality_score / 10) */}
                  <div className="flex-shrink-0">
                    <ForgeScoreRing
                      score={score}
                      size={48}
                      strokeWidth={4}
                      label=""
                    />
                  </div>

                  {/* Identity + badges */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {entry.strategyName} {entry.side.toUpperCase()} {entry.symbol}
                      </span>
                      {/* Outcome badge */}
                      <StatusBadge variant={outcomeVar} dot>
                        {entry.outcome}
                      </StatusBadge>
                      {/* Grade pill */}
                      {entry.grade && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${gradeStyle.bgColor} ${gradeStyle.color}`}
                        >
                          {gradeStyle.label}
                        </span>
                      )}
                    </div>

                    {/* Inline metrics */}
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-text-muted flex-wrap">
                      <span>
                        R{" "}
                        <span
                          className={`font-mono ${
                            entry.realizedR == null
                              ? "text-foreground"
                              : entry.realizedR > 0
                              ? "text-profit"
                              : entry.realizedR < 0
                              ? "text-loss"
                              : "text-foreground"
                          }`}
                        >
                          {formatR(entry.realizedR)}
                        </span>
                      </span>
                      {entry.regimeAtEntry && (
                        <span>{translateRegime(entry.regimeAtEntry)}</span>
                      )}
                      {entry.exitReason && (
                        <span>
                          Exit: <span className="text-foreground">{entry.exitReason}</span>
                        </span>
                      )}
                      <span>{elapsedStr}</span>
                    </div>
                  </div>

                  {/* Timestamp + expand chevron */}
                  <div className="flex-shrink-0 flex items-center gap-3">
                    <span className="text-xs text-text-muted">
                      {entry.exitTime ? timeAgo(entry.exitTime as string) : "—"}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-text-muted" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-muted" />
                    )}
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <TradeCardExpanded entry={entry} isOperator={isOperator} />
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && entries.length > 0 && (
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
