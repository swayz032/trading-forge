/**
 * ProductionStatusPanel.tsx — Track 4 Phase 4B
 *
 * Top-of-dashboard 6-question production health panel.
 *
 * Answers:
 *   1. Are we trading right now? (GREEN check / RED X with reason)
 *   2. Today's P&L: $X / target $Y (color-coded)
 *   3. Drawdown distance: $X buffer left of $Y trailing DD
 *   4. Last clean reconciliation: N days ago (GREEN <24hrs, YELLOW <72hrs, RED >72hrs)
 *   5. Kill switches: 9 layers, all GREEN or specific RED layer named
 *   6. Alerts: Discord webhook last fired X minutes ago
 *
 * Polls /api/production/status every 10 seconds.
 *
 * Visual identity: emerald (#10B981) on near-black, glassy 3D floating cards.
 */

import { useEffect, useState, useMemo } from "react";
import { CompositeHealthTile } from "./CompositeHealthTile";
import { AbSharpeComparisonTile } from "./AbSharpeComparisonTile";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Shield,
  Bell,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Tag,
} from "lucide-react";
import { api } from "@/lib/api-client";

// ─── Types (mirroring production-status.ts) ───────────────────────────────────

type OverallSeverity = "green" | "yellow" | "red";

interface KillSwitchLayer {
  layer: number;
  name: string;
  halted: boolean;
  reason?: string;
}

interface KillSwitchStatusReport {
  overall_halted: boolean;
  production_mode: string;
  layers: KillSwitchLayer[];
  checked_at: string;
}

interface ProductionStatusResponse {
  overall: OverallSeverity;
  productionMode: string;
  sixQuestions: {
    areWeTrading: {
      answer: string;
      halted: boolean;
      reason: string | null;
      severity: OverallSeverity;
    };
    pnlToday: {
      todayPnl: number | null;
      expectedPnl: number | null;
      delta: number | null;
      severity: OverallSeverity;
    };
    drawdownDistance: {
      bufferRemaining: number | null;
      firmLimit: number | null;
      usedPct: number | null;
      severity: OverallSeverity;
    };
    lastCleanReconciliation: {
      lastCleanDate: string | null;
      ageHours: number | null;
      severity: OverallSeverity;
    };
    killSwitchLayers: KillSwitchStatusReport;
    alertingStatus: {
      lastAlertFiredAt: string | null;
      minutesSinceLastAlert: number | null;
      webhookConfigured: boolean;
    };
  };
  generatedAt: string;
  cacheHit: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function severityColor(s: OverallSeverity): string {
  switch (s) {
    case "green":  return "text-profit";
    case "yellow": return "text-primary";
    case "red":    return "text-loss";
  }
}

function severityBg(s: OverallSeverity): string {
  switch (s) {
    case "green":  return "bg-profit/10";
    case "yellow": return "bg-primary/10";
    case "red":    return "bg-loss/10";
  }
}

function severityBorder(s: OverallSeverity): string {
  switch (s) {
    case "green":  return "border-profit/30";
    case "yellow": return "border-primary/30";
    case "red":    return "border-loss/40";
  }
}

function fmtPnl(v: number | null): string {
  if (v === null) return "—";
  return (v >= 0 ? "+" : "") + "$" + Math.abs(v).toFixed(0);
}

function fmtAgeHours(h: number | null): string {
  if (h === null) return "never";
  if (h < 1) return "< 1 hour ago";
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ─── Sub-panels ───────────────────────────────────────────────────────────────

function TradingStatusCard({ q }: { q: ProductionStatusResponse["sixQuestions"]["areWeTrading"] }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg p-3 ${severityBg(q.severity)} border ${severityBorder(q.severity)}`}>
      {q.halted
        ? <XCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${severityColor(q.severity)}`} />
        : <CheckCircle2 className={`w-5 h-5 mt-0.5 flex-shrink-0 ${severityColor(q.severity)}`} />
      }
      <div>
        <p className="text-sm font-semibold text-text-primary leading-tight">Q1 — Are we trading?</p>
        <p className={`text-sm mt-0.5 ${severityColor(q.severity)}`}>{q.answer}</p>
        {q.reason && <p className="text-xs text-text-muted mt-0.5">{q.reason}</p>}
      </div>
    </div>
  );
}

function PnLCard({ q }: { q: ProductionStatusResponse["sixQuestions"]["pnlToday"] }) {
  const DeltaIcon = q.delta === null ? Minus : q.delta >= 0 ? TrendingUp : TrendingDown;
  return (
    <div className={`flex items-start gap-3 rounded-lg p-3 ${severityBg(q.severity)} border ${severityBorder(q.severity)}`}>
      <DeltaIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${severityColor(q.severity)}`} />
      <div>
        <p className="text-sm font-semibold text-text-primary leading-tight">Q2 — Today's P&L</p>
        <p className={`text-sm mt-0.5 ${severityColor(q.severity)}`}>
          {fmtPnl(q.todayPnl)} actual · {fmtPnl(q.expectedPnl)} expected
        </p>
        {q.delta !== null && (
          <p className="text-xs text-text-muted mt-0.5">
            Delta: {fmtPnl(q.delta)}
          </p>
        )}
        {q.todayPnl === null && (
          <p className="text-xs text-text-muted mt-0.5">No recon run yet today</p>
        )}
      </div>
    </div>
  );
}

function DrawdownCard({ q }: { q: ProductionStatusResponse["sixQuestions"]["drawdownDistance"] }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg p-3 ${severityBg(q.severity)} border ${severityBorder(q.severity)}`}>
      <Shield className={`w-5 h-5 mt-0.5 flex-shrink-0 ${severityColor(q.severity)}`} />
      <div>
        <p className="text-sm font-semibold text-text-primary leading-tight">Q3 — Drawdown distance</p>
        {q.bufferRemaining !== null
          ? (
            <p className={`text-sm mt-0.5 ${severityColor(q.severity)}`}>
              ${q.bufferRemaining.toFixed(0)} buffer left of ${q.firmLimit?.toFixed(0)} trailing DD
              {q.usedPct !== null && ` (${(q.usedPct * 100).toFixed(0)}% used)`}
            </p>
          )
          : (
            <p className="text-sm mt-0.5 text-text-muted">Wiring pending (Phase 4C)</p>
          )
        }
      </div>
    </div>
  );
}

function ReconCard({ q }: { q: ProductionStatusResponse["sixQuestions"]["lastCleanReconciliation"] }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg p-3 ${severityBg(q.severity)} border ${severityBorder(q.severity)}`}>
      <Clock className={`w-5 h-5 mt-0.5 flex-shrink-0 ${severityColor(q.severity)}`} />
      <div>
        <p className="text-sm font-semibold text-text-primary leading-tight">Q4 — Last clean reconciliation</p>
        <p className={`text-sm mt-0.5 ${severityColor(q.severity)}`}>
          {q.lastCleanDate ?? "never"} · {fmtAgeHours(q.ageHours)}
        </p>
      </div>
    </div>
  );
}

function KillSwitchCard({ q }: { q: KillSwitchStatusReport }) {
  const haltedLayers = q.layers.filter((l) => l.halted);
  const allGreen = haltedLayers.length === 0;
  const severity: OverallSeverity = allGreen ? "green" : "red";

  return (
    <div className={`flex items-start gap-3 rounded-lg p-3 ${severityBg(severity)} border ${severityBorder(severity)}`}>
      <Shield className={`w-5 h-5 mt-0.5 flex-shrink-0 ${severityColor(severity)}`} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-primary leading-tight">Q5 — Kill switches (9 layers)</p>
        {allGreen
          ? <p className="text-sm mt-0.5 text-profit">All 9 layers GREEN</p>
          : (
            <ul className="mt-1 space-y-0.5">
              {haltedLayers.map((l) => (
                <li key={l.layer} className="text-xs text-loss truncate">
                  Layer {l.layer} ({l.name}){l.reason ? `: ${l.reason}` : ""}
                </li>
              ))}
            </ul>
          )
        }
        <p className="text-xs text-text-muted mt-0.5">
          Mode: {q.production_mode}
        </p>
      </div>
    </div>
  );
}

function AlertingCard({ q }: { q: ProductionStatusResponse["sixQuestions"]["alertingStatus"] }) {
  const severity: OverallSeverity = q.webhookConfigured ? "green" : "yellow";
  return (
    <div className={`flex items-start gap-3 rounded-lg p-3 ${severityBg(severity)} border ${severityBorder(severity)}`}>
      <Bell className={`w-5 h-5 mt-0.5 flex-shrink-0 ${severityColor(severity)}`} />
      <div>
        <p className="text-sm font-semibold text-text-primary leading-tight">Q6 — Alerting status</p>
        <p className={`text-sm mt-0.5 ${severityColor(severity)}`}>
          {q.webhookConfigured ? "Discord webhook configured" : "Webhook not configured"}
        </p>
        <p className="text-xs text-text-muted mt-0.5">
          {q.minutesSinceLastAlert !== null
            ? `Last alert: ${q.minutesSinceLastAlert}m ago`
            : "No alerts yet"
          }
        </p>
      </div>
    </div>
  );
}

// ─── Overall badge ────────────────────────────────────────────────────────────

function OverallBadge({ overall, mode }: { overall: OverallSeverity; mode: string }) {
  const labels: Record<OverallSeverity, string> = {
    green: "ALL SYSTEMS GREEN",
    yellow: "ATTENTION REQUIRED",
    red: "PRODUCTION HALTED",
  };
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide ${severityColor(overall)} ${severityBg(overall)} border ${severityBorder(overall)}`}>
      {overall === "green"
        ? <CheckCircle2 className="w-3.5 h-3.5" />
        : overall === "yellow"
          ? <AlertTriangle className="w-3.5 h-3.5" />
          : <XCircle className="w-3.5 h-3.5" />
      }
      {labels[overall]} · {mode}
    </div>
  );
}

// ─── Archetype Queue tile (Pass 7 Track D) ────────────────────────────────────

interface ArchetypeQueueSummary {
  ok: boolean;
  total: number;
  top: Array<{ term: string; extractionCount: number }>;
  readyCount: number;
}

/** READY_THRESHOLD: extraction_count >= 3 means the term has appeared across
 *  enough different transcripts to justify creating a new canonical archetype. */
const READY_THRESHOLD = 3;

export function ArchetypeQueueTile() {
  const [data, setData] = useState<ArchetypeQueueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchSummary() {
      try {
        const res = await api.get<ArchetypeQueueSummary>(
          "/admin/needs-archetype-queue/summary",
        );
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSummary();
    // Refresh every 60 seconds — queue depth changes slowly.
    const iv = setInterval(fetchSummary, 60_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  if (loading && !data) {
    return (
      <div
        className="forge-card p-4 border border-text-muted/20"
        data-testid="archetype-queue-tile"
        data-state="loading"
      >
        <div className="flex items-center gap-2 text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading archetype queue…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="forge-card p-4 border border-loss/30"
        data-testid="archetype-queue-tile"
        data-state="error"
      >
        <div className="flex items-center gap-2 text-loss">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">
            Archetype queue unavailable: {error ?? "no data"}
          </span>
        </div>
      </div>
    );
  }

  const isEmpty = data.total === 0;

  return (
    <div
      className="forge-card p-4 border border-text-muted/20 space-y-3"
      data-testid="archetype-queue-tile"
      data-total={data.total}
      data-ready-count={data.readyCount}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-text-primary">
            Archetype Queue
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {data.readyCount > 0 && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full bg-profit/15 text-profit border border-profit/30"
              data-testid="archetype-queue-ready-badge"
            >
              {data.readyCount} ready
            </span>
          )}
          <span className="text-xs text-text-muted">
            {data.total} pending
          </span>
        </div>
      </div>

      {/* Content */}
      {isEmpty ? (
        <p
          className="text-sm text-text-muted italic"
          data-testid="archetype-queue-empty"
        >
          No items pending
        </p>
      ) : (
        <div className="space-y-1" data-testid="archetype-queue-list">
          {data.top.map((item) => {
            const isReady = item.extractionCount >= READY_THRESHOLD;
            return (
              <div
                key={item.term}
                className={`flex items-center justify-between px-2 py-1 rounded text-xs ${
                  isReady
                    ? "bg-profit/8 border border-profit/20 text-text-primary"
                    : "bg-transparent text-text-muted"
                }`}
                data-testid="archetype-queue-item"
                data-term={item.term}
                data-ready={isReady ? "true" : "false"}
              >
                <span className="font-mono truncate max-w-[70%]">
                  {item.term}
                </span>
                <span
                  className={`font-semibold ${isReady ? "text-profit" : "text-text-muted"}`}
                >
                  {item.extractionCount}×
                  {isReady && (
                    <span className="ml-1 text-profit/80">ready</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer hint */}
      {data.readyCount > 0 && (
        <p className="text-xs text-text-muted">
          Terms with {READY_THRESHOLD}+ extractions are ready for archetype
          creation.
        </p>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

/** Threshold (ms) beyond which the last-successful payload is considered stale
 *  and the panel switches to amber-overlay mode. 30s matches the 10s polling
 *  cadence × 3 — a single dropped poll is fine; three in a row is suspicious. */
const STALENESS_THRESHOLD_MS = 30_000;

function formatAge(ageMs: number): string {
  const sec = Math.max(0, Math.round(ageMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

export function ProductionStatusPanel() {
  const [data, setData] = useState<ProductionStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  /** Wall-clock of the most recent SUCCESSFUL fetch. Drives the staleness
   *  overlay independently of `data.generatedAt` (which can lag the cache). */
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  /** Force a re-render every second so the staleness badge ticks even when
   *  no new data arrives — otherwise an outage would freeze the age string. */
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await api.get<ProductionStatusResponse>("/production/status");
        if (!cancelled) {
          // F-6 fix: keep last successful data on transient failure. We only
          // overwrite `data` on success — never null it out on error.
          setData(res);
          setError(null);
          setLastSuccessAt(Date.now());
        }
      } catch (err) {
        if (!cancelled) {
          // Surface the error but DO NOT clear `data` — the operator must
          // keep seeing the last-known-good snapshot with a stale overlay.
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStatus();
    const iv = setInterval(fetchStatus, 10_000); // 10-second polling
    // Tick once per second so staleness UI stays live.
    const tickIv = setInterval(() => {
      if (!cancelled) setNow(Date.now());
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(iv);
      clearInterval(tickIv);
    };
  }, []);

  const generatedAtMs = useMemo(() => {
    if (!data?.generatedAt) return null;
    const t = new Date(data.generatedAt).getTime();
    return Number.isFinite(t) ? t : null;
  }, [data?.generatedAt]);

  // Staleness derived from BOTH (a) the server-reported generatedAt and (b)
  // wall-clock since our last successful fetch. Whichever is older wins —
  // catches both backend cache freezes and frontend network outages.
  const ageMs = useMemo(() => {
    const candidates: number[] = [];
    if (generatedAtMs !== null) candidates.push(now - generatedAtMs);
    if (lastSuccessAt !== null) candidates.push(now - lastSuccessAt);
    if (candidates.length === 0) return 0;
    return Math.max(...candidates);
  }, [now, generatedAtMs, lastSuccessAt]);

  const isStale = ageMs > STALENESS_THRESHOLD_MS;

  // Initial loading state — no data yet, nothing to show under an overlay.
  if (loading && !data) {
    return (
      <div className="forge-card p-5">
        <div className="flex items-center gap-2 text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading production status…</span>
        </div>
      </div>
    );
  }

  // Never recovered (first fetch failed and no cached data) — explicit error.
  if (!data) {
    return (
      <div className="forge-card p-5 border-loss/40">
        <div className="flex items-center gap-2 text-loss">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">Production status unavailable: {error ?? "no data"}</span>
        </div>
      </div>
    );
  }

  const q = data.sixQuestions;
  const staleCardBorder = isStale ? "ring-1 ring-primary/40" : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={`forge-card p-5 space-y-4 relative ${isStale ? "border-primary/40" : ""}`}
      data-testid="production-status-panel"
      data-overall={data.overall}
      data-stale={isStale ? "true" : "false"}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Production Status</h2>
          <p className="text-xs text-text-muted">
            {data.cacheHit ? "Cached · " : "Live · "}
            {new Date(data.generatedAt).toLocaleTimeString()}
          </p>
        </div>
        <OverallBadge overall={data.overall} mode={data.productionMode} />
      </div>

      {/* Stale overlay — amber banner shown when last-successful fetch / generatedAt
          is older than threshold. Operator sees last-known-good with a clear
          "this may not reflect reality" cue. F-6 fix. */}
      {isStale && (
        <div
          role="status"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs"
          data-testid="production-status-stale-banner"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span className="font-semibold tracking-wide">STALE</span>
          <span className="text-text-muted">
            last update {formatAge(ageMs)} ago
            {error ? ` · ${error}` : ""}
          </span>
        </div>
      )}

      {/* Composite Health tile — portfolio summary mode (READ-ONLY, W28 A.5) */}
      <CompositeHealthTile />

      {/* A/B Paper Trade Comparison tile — READ-ONLY, W29 D.2 */}
      <AbSharpeComparisonTile />

      {/* Archetype Queue tile — Pass 7 Track D: factory self-maintenance loop visibility */}
      <ArchetypeQueueTile />

      {/* 6 Questions — 2-column grid on wide, 1-column on narrow.
          Each card gets a subtle amber ring when stale, so the staleness cue
          is visible even if the operator scrolled past the header banner. */}
      <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 ${staleCardBorder ? "[&>*]:" + staleCardBorder : ""}`}>
        <div className={staleCardBorder}><TradingStatusCard q={q.areWeTrading} /></div>
        <div className={staleCardBorder}><PnLCard q={q.pnlToday} /></div>
        <div className={staleCardBorder}><DrawdownCard q={q.drawdownDistance} /></div>
        <div className={staleCardBorder}><ReconCard q={q.lastCleanReconciliation} /></div>
        <div className={`md:col-span-2 ${staleCardBorder}`}>
          <KillSwitchCard q={q.killSwitchLayers} />
        </div>
        <div className={`md:col-span-2 ${staleCardBorder}`}>
          <AlertingCard q={q.alertingStatus} />
        </div>
      </div>
    </motion.div>
  );
}
