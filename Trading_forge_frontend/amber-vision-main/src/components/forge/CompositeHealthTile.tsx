/**
 * CompositeHealthTile.tsx — Wave 28 Pass A.5
 *
 * READ-ONLY composite health tile for the ProductionStatusPanel.
 *
 * When strategyId is provided: shows per-strategy composite health breakdown.
 * When strategyId is omitted: shows portfolio summary (counts by verdict).
 *
 * Visual identity: emerald (#10B981) on near-black, glassy 3D floating card.
 * No marketing copy; plain-English stats per operator memory feedback.
 *
 * Polls every 60 seconds (aggregator runs infrequently; no need for 10s cadence).
 */

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api-client";

// ─── Types (mirroring composite-health.ts) ────────────────────────────────────

type HealthVerdict = "HEALTHY" | "MARGINAL" | "UNHEALTHY" | "CRITICAL" | "SKIPPED";

interface SubsystemDetail {
  score: number | null;
  confidence: number | null;
  available: boolean;
  computed_at: string | null;
  error?: string;
}

interface LatestHealthPayload {
  id: string;
  strategyId: number;
  evaluatedAt: string;
  compositeScore: number | null;
  verdict: HealthVerdict | null;
  subsystemScores: Record<string, SubsystemDetail>;
  computedFromNSubsystems: number;
  weightsVersionId: string;
  stalenessAgeHours: number | null;
  disagreements: unknown | null;
}

interface SummaryPayload {
  counts: Record<HealthVerdict, number>;
  totalActiveStrategies: number;
  computedAt: string;
}

interface LatestResponse {
  data: LatestHealthPayload | null;
  message?: string;
}

interface SummaryResponse {
  data: SummaryPayload;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface CompositeHealthTileProps {
  /** When set, shows per-strategy breakdown. When omitted, shows portfolio summary. */
  strategyId?: number;
}

// ─── Verdict helpers ──────────────────────────────────────────────────────────

function verdictColor(v: HealthVerdict | null): string {
  switch (v) {
    case "HEALTHY":   return "text-profit";
    case "MARGINAL":  return "text-primary";
    case "UNHEALTHY": return "text-orange-400";
    case "CRITICAL":  return "text-loss";
    default:          return "text-text-muted";
  }
}

function verdictBg(v: HealthVerdict | null): string {
  switch (v) {
    case "HEALTHY":   return "bg-profit/10 border-profit/30";
    case "MARGINAL":  return "bg-primary/10 border-primary/30";
    case "UNHEALTHY": return "bg-orange-400/10 border-orange-400/30";
    case "CRITICAL":  return "bg-loss/10 border-loss/40";
    default:          return "bg-surface-2/50 border-white/10";
  }
}

function verdictLabel(v: HealthVerdict | null): string {
  if (!v) return "UNKNOWN";
  return v;
}

/** Plain-English one-liner summarising subsystem health */
function buildSummaryLine(
  subsystems: Record<string, SubsystemDetail>,
  n: number
): string {
  const total = Object.keys(subsystems).length;
  if (total === 0) return `${n} of 12 subsystems contributed data`;

  const available = Object.values(subsystems).filter((s) => s.available).length;
  const unavailable = total - available;

  if (unavailable === 0) return `All ${available} subsystems healthy`;

  // Name the first unavailable subsystem for context
  const firstMissing = Object.entries(subsystems).find(([, v]) => !v.available)?.[0];
  const suffix = firstMissing
    ? `${firstMissing.replace(/_/g, " ")} still building evidence`
    : "some subsystems still building evidence";

  return `${available} of ${total} subsystems healthy; ${suffix}`;
}

/** Format ISO timestamp to relative age string */
function fmtAge(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ─── Sub-component: Subsystem mini-bar ───────────────────────────────────────

interface MiniBarProps {
  name: string;
  detail: SubsystemDetail;
}

function SubsystemMiniBar({ name, detail }: MiniBarProps) {
  const [expanded, setExpanded] = useState(false);

  const score = detail.score ?? 0;
  const pct = Math.round(score * 100);
  const barColor = !detail.available
    ? "bg-white/10"
    : score >= 0.75
    ? "bg-profit/70"
    : score >= 0.50
    ? "bg-primary/70"
    : score >= 0.25
    ? "bg-orange-400/70"
    : "bg-loss/70";

  const label = name.replace(/_/g, " ");

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        className="w-full text-left group"
        onClick={() => setExpanded((e) => !e)}
        aria-label={`Expand ${label} subsystem detail`}
      >
        <div className="flex items-center justify-between gap-1.5 mb-0.5">
          <span className="text-xs text-text-muted truncate group-hover:text-text-primary transition-colors">
            {label}
          </span>
          <span className="text-xs font-mono text-text-muted flex-shrink-0">
            {detail.available ? `${pct}%` : "—"}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: detail.available ? `${pct}%` : "0%" }}
          />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            key="drill"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-1 px-2 py-1.5 rounded bg-surface-2/40 border border-white/5 space-y-0.5">
              <p className="text-xs text-text-muted">
                Raw score: <span className="text-text-primary font-mono">{detail.score?.toFixed(3) ?? "—"}</span>
              </p>
              <p className="text-xs text-text-muted">
                Confidence: <span className="text-text-primary font-mono">{detail.confidence?.toFixed(3) ?? "—"}</span>
              </p>
              <p className="text-xs text-text-muted">
                Computed: <span className="text-text-primary">{fmtAge(detail.computed_at)}</span>
              </p>
              {detail.error && (
                <p className="text-xs text-loss truncate">Error: {detail.error}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-component: Portfolio summary ────────────────────────────────────────

function SummaryView({ summary }: { summary: SummaryPayload }) {
  const { counts, totalActiveStrategies, computedAt } = summary;
  const verdictOrder: HealthVerdict[] = ["HEALTHY", "MARGINAL", "UNHEALTHY", "CRITICAL", "SKIPPED"];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">
          {totalActiveStrategies} active {totalActiveStrategies === 1 ? "strategy" : "strategies"}
        </span>
        <span className="text-xs text-text-muted flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {fmtAge(computedAt)}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {verdictOrder.map((v) => (
          <div
            key={v}
            className={`rounded-lg border p-2 text-center ${verdictBg(v)}`}
          >
            <p className={`text-lg font-bold leading-none ${verdictColor(v)}`}>
              {counts[v] ?? 0}
            </p>
            <p className="text-xs text-text-muted mt-0.5 leading-tight">
              {v.charAt(0) + v.slice(1).toLowerCase()}
            </p>
          </div>
        ))}
      </div>

      {totalActiveStrategies === 0 && (
        <p className="text-xs text-text-muted text-center py-1">
          No active strategies (DEPLOYED, PILOT, PAPER, or DEPLOY_READY)
        </p>
      )}
    </div>
  );
}

// ─── Sub-component: Per-strategy breakdown ────────────────────────────────────

function StrategyView({ payload }: { payload: LatestHealthPayload }) {
  const [showSubsystems, setShowSubsystems] = useState(false);
  const subsystems = payload.subsystemScores;
  const names = Object.keys(subsystems);

  return (
    <div className="space-y-3">
      {/* Composite score + verdict */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <span className="text-3xl font-bold text-text-primary font-mono leading-none">
            {payload.compositeScore !== null
              ? (payload.compositeScore * 100).toFixed(0)
              : "—"}
          </span>
          {payload.compositeScore !== null && (
            <span className="text-sm text-text-muted ml-1">/ 100</span>
          )}
        </div>
        <div
          className={`px-2.5 py-1 rounded-full border text-xs font-bold tracking-wide ${verdictBg(payload.verdict)} ${verdictColor(payload.verdict)}`}
        >
          {verdictLabel(payload.verdict)}
        </div>
      </div>

      {/* Plain-English summary line */}
      <p className="text-xs text-text-muted">
        {buildSummaryLine(subsystems, payload.computedFromNSubsystems)}
      </p>

      {/* Meta row */}
      <div className="flex items-center justify-between text-xs text-text-muted gap-2">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3 flex-shrink-0" />
          {fmtAge(payload.evaluatedAt)}
        </span>
        <span
          title={payload.weightsVersionId}
          className="font-mono cursor-help"
        >
          w/{payload.weightsVersionId.slice(0, 8)}
        </span>
      </div>

      {/* Subsystem drill-down toggle */}
      {names.length > 0 && (
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors w-full"
          onClick={() => setShowSubsystems((s) => !s)}
        >
          {showSubsystems ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          <span>{showSubsystems ? "Hide" : "Show"} {names.length} subsystems</span>
        </button>
      )}

      <AnimatePresence>
        {showSubsystems && names.length > 0 && (
          <motion.div
            key="subsystems"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 gap-2 pt-1">
              {names.map((name) => (
                <SubsystemMiniBar
                  key={name}
                  name={name}
                  detail={subsystems[name]!}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main tile component ──────────────────────────────────────────────────────

export function CompositeHealthTile({ strategyId }: CompositeHealthTileProps) {
  const [latestData, setLatestData] = useState<LatestHealthPayload | null>(null);
  const [summaryData, setSummaryData] = useState<SummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState(false);

  const isSummaryMode = strategyId === undefined;

  const fetchData = useCallback(async () => {
    try {
      if (isSummaryMode) {
        const res = await api.get<SummaryResponse>("/composite-health/summary");
        setSummaryData(res.data);
      } else {
        const res = await api.get<LatestResponse>(
          `/composite-health/${strategyId}/latest`
        );
        if (res.data === null) {
          setAwaiting(true);
          setLatestData(null);
        } else {
          setAwaiting(false);
          setLatestData(res.data);
        }
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isSummaryMode, strategyId]);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 60_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  // Loading state
  if (loading) {
    return (
      <div className="forge-card p-5">
        <div className="flex items-center gap-2 text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading composite health…</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !latestData && !summaryData) {
    return (
      <div className="forge-card p-5 border-loss/40">
        <div className="flex items-center gap-2 text-loss">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">Composite health unavailable: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="forge-card p-5 space-y-4"
      data-testid="composite-health-tile"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-profit" />
          <h2 className="text-base font-semibold text-text-primary">Composite Health</h2>
        </div>
        {error && (
          <span className="text-xs text-primary flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            stale
          </span>
        )}
      </div>

      {/* Content */}
      {awaiting && (
        <div className="py-4 text-center">
          <p className="text-sm text-text-muted">Awaiting first aggregator run</p>
          <p className="text-xs text-text-muted mt-1">
            Composite scores are computed after enough subsystem evidence accumulates.
          </p>
        </div>
      )}

      {isSummaryMode && summaryData && (
        <SummaryView summary={summaryData} />
      )}

      {!isSummaryMode && latestData && (
        <StrategyView payload={latestData} />
      )}
    </motion.div>
  );
}
