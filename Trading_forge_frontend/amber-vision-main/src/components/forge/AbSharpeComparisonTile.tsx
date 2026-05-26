/**
 * AbSharpeComparisonTile.tsx — Wave 29 Pass D.2 (paper-parity)
 *
 * READ-ONLY A/B paper sub-account Sharpe comparison tile.
 * Displays Sub-Account 1 (baseline) vs Sub-Account 2 (RL-challenger) metrics.
 *
 * Structural template: CompositeHealthTile.tsx (Wave 28 Pass A.5)
 * Visual identity: emerald (#10B981) on near-black, glassy 3D floating card.
 * Stats: plain-English summary line per feedback_plain_english_stats.md.
 * Polling: 60s (consistent with CompositeHealthTile).
 * State: loading / error / empty ("awaiting first paper trade") / populated.
 *
 * READ-ONLY HARD CONSTRAINT: No buttons, no actions, no kill switch override UI.
 */

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Clock,
  Loader2,
  Shield,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api-client";

// ─── Types (mirroring ab-comparison.ts) ──────────────────────────────────────

interface SubAccountMetrics {
  rolling_20_session_sharpe: number;
  cumulative_pnl: number;
  max_drawdown: number;
  trade_count: number;
}

interface ABComparisonDelta {
  sharpe_delta: number;
  pnl_delta: number;
  drawdown_delta: number;
}

interface KillSwitchStatus {
  is_armed: boolean;
  currently_dormant: boolean;
  last_evaluated: string | null;
}

interface ABComparisonPayload {
  sub_account_1: SubAccountMetrics;
  sub_account_2: SubAccountMetrics;
  delta: ABComparisonDelta;
  kill_switch_status: KillSwitchStatus;
  last_updated: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPnl(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}$${Math.abs(v).toFixed(0)}`;
}

function fmtSharpe(v: number): string {
  return v.toFixed(2);
}

function fmtDd(v: number): string {
  // max_drawdown is negative or zero
  return `$${Math.abs(v).toFixed(0)}`;
}

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

/** Derive plain-English one-liner per feedback_plain_english_stats.md */
function buildSummaryLine(
  delta: ABComparisonDelta,
  ks: KillSwitchStatus,
  sub1: SubAccountMetrics,
  sub2: SubAccountMetrics,
): string {
  if (sub1.trade_count === 0 && sub2.trade_count === 0) {
    return "Awaiting first paper trade — RL agent training in progress";
  }

  if (sub2.trade_count === 0) {
    return "Baseline trading; RL challenger not yet promoted to paper";
  }

  if (sub1.trade_count === 0) {
    return "RL challenger trading; baseline not yet in paper";
  }

  if (!ks.is_armed) {
    return "RL kill switch disarmed — RL signal not influencing paper routing";
  }

  if (ks.currently_dormant) {
    const gapPct = Math.abs(delta.sharpe_delta / (sub1.rolling_20_session_sharpe || 1)) * 100;
    return (
      `RL agent is hurting — currently dormant ` +
      `(Sub-Account 2 was ${gapPct.toFixed(0)}% Sharpe gap; kill switch engaged)`
    );
  }

  if (delta.sharpe_delta >= 0) {
    return (
      `RL agent is helping (Sharpe +${delta.sharpe_delta.toFixed(2)} over baseline; ` +
      `Sub-Account 2 outperforming)`
    );
  }

  return (
    `RL agent has negative edge (Sharpe ${delta.sharpe_delta.toFixed(2)} vs baseline; ` +
    `monitor kill switch threshold)`
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface MetricsColumnProps {
  label: string;
  metrics: SubAccountMetrics;
  highlight?: boolean;
}

function MetricsColumn({ label, metrics, highlight = false }: MetricsColumnProps) {
  const isEmpty = metrics.trade_count === 0;

  return (
    <div
      className={`flex-1 rounded-lg p-3 space-y-2 border ${
        highlight
          ? "bg-profit/5 border-profit/20"
          : "bg-surface-2/40 border-white/10"
      }`}
    >
      <p
        className={`text-xs font-semibold tracking-wide truncate ${
          highlight ? "text-profit" : "text-text-muted"
        }`}
      >
        {label}
      </p>

      {isEmpty ? (
        <p className="text-xs text-text-muted italic">No trades yet</p>
      ) : (
        <div className="space-y-1.5">
          {/* Rolling 20-session Sharpe */}
          <div>
            <p className="text-xs text-text-muted leading-none">Rolling 20-Session Sharpe</p>
            <p
              className={`text-lg font-bold font-mono leading-tight mt-0.5 ${
                metrics.rolling_20_session_sharpe >= 1.5
                  ? "text-profit"
                  : metrics.rolling_20_session_sharpe >= 0.5
                  ? "text-primary"
                  : metrics.rolling_20_session_sharpe >= 0
                  ? "text-text-primary"
                  : "text-loss"
              }`}
            >
              {fmtSharpe(metrics.rolling_20_session_sharpe)}
            </p>
          </div>

          {/* Cumulative P&L */}
          <div>
            <p className="text-xs text-text-muted leading-none">Cumulative P&L</p>
            <p
              className={`text-sm font-semibold font-mono mt-0.5 ${
                metrics.cumulative_pnl >= 0 ? "text-profit" : "text-loss"
              }`}
            >
              {fmtPnl(metrics.cumulative_pnl)}
            </p>
          </div>

          {/* Max Drawdown */}
          <div>
            <p className="text-xs text-text-muted leading-none">Max Drawdown</p>
            <p className="text-sm font-semibold font-mono mt-0.5 text-loss">
              -{fmtDd(metrics.max_drawdown)}
            </p>
          </div>

          {/* Trade Count */}
          <div>
            <p className="text-xs text-text-muted leading-none">Trade Count</p>
            <p className="text-sm font-mono text-text-primary mt-0.5">
              {metrics.trade_count}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Kill switch badge ────────────────────────────────────────────────────────

function KillSwitchBadge({ ks }: { ks: KillSwitchStatus }) {
  if (!ks.is_armed) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-2/50 border border-white/10">
        <Shield className="w-3 h-3 text-text-muted" />
        <span className="text-xs text-text-muted font-medium">Kill switch disarmed</span>
      </div>
    );
  }

  if (ks.currently_dormant) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-loss/10 border border-loss/30">
        <Shield className="w-3 h-3 text-loss" />
        <span className="text-xs text-loss font-medium">Kill switch DORMANT</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-profit/10 border border-profit/30">
      <Shield className="w-3 h-3 text-profit" />
      <span className="text-xs text-profit font-medium">Kill switch armed</span>
    </div>
  );
}

// ─── Delta row ────────────────────────────────────────────────────────────────

function DeltaRow({ delta, sub1, sub2 }: { delta: ABComparisonDelta; sub1: SubAccountMetrics; sub2: SubAccountMetrics }) {
  const hasData = sub1.trade_count > 0 || sub2.trade_count > 0;
  if (!hasData) return null;

  const sharpeDelta = delta.sharpe_delta;
  const DeltaIcon = sharpeDelta >= 0 ? TrendingUp : TrendingDown;
  const deltaColor = sharpeDelta >= 0 ? "text-profit" : "text-loss";
  const deltaBg = sharpeDelta >= 0 ? "bg-profit/10 border-profit/30" : "bg-loss/10 border-loss/30";
  const deltaLabel =
    sharpeDelta >= 0
      ? `+${sharpeDelta.toFixed(2)} Sharpe edge`
      : `${sharpeDelta.toFixed(2)} Sharpe gap`;

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${deltaBg}`}>
      <DeltaIcon className={`w-4 h-4 flex-shrink-0 ${deltaColor}`} />
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-bold ${deltaColor}`}>{deltaLabel}</span>
        <span className="text-xs text-text-muted ml-2">
          P&L delta: {fmtPnl(delta.pnl_delta)}
        </span>
      </div>
    </div>
  );
}

// ─── Main tile ────────────────────────────────────────────────────────────────

export function AbSharpeComparisonTile() {
  const [data, setData] = useState<ABComparisonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get<ABComparisonPayload>("/ab-comparison/recent");
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

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
          <span className="text-sm">Loading A/B comparison…</span>
        </div>
      </div>
    );
  }

  // Error state (no prior data)
  if (error && !data) {
    return (
      <div className="forge-card p-5 border-loss/40">
        <div className="flex items-center gap-2 text-loss">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">A/B comparison unavailable: {error}</span>
        </div>
      </div>
    );
  }

  // Empty state (API returned but no trades yet)
  const isEmpty =
    !data ||
    (data.sub_account_1.trade_count === 0 && data.sub_account_2.trade_count === 0);

  if (isEmpty) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="forge-card p-5 space-y-3"
        data-testid="ab-comparison-tile"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-profit" />
          <h2 className="text-base font-semibold text-text-primary">A/B Paper Trade Comparison</h2>
        </div>
        <p className="text-sm text-text-muted">
          Awaiting first paper trade — RL agent training in progress
        </p>
        <p className="text-xs text-text-muted">
          Sub-Account 1 (Baseline) and Sub-Account 2 (RL-Challenger) metrics will appear here
          after the first paper position closes.
        </p>
      </motion.div>
    );
  }

  const { sub_account_1, sub_account_2, delta, kill_switch_status, last_updated } = data!;
  const rlOutperforming = !kill_switch_status.currently_dormant && delta.sharpe_delta >= 0;
  const summaryLine = buildSummaryLine(delta, kill_switch_status, sub_account_1, sub_account_2);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="forge-card p-5 space-y-4"
      data-testid="ab-comparison-tile"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-profit" />
          <h2 className="text-base font-semibold text-text-primary">A/B Paper Trade Comparison</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <KillSwitchBadge ks={kill_switch_status} />
          <span className="text-xs text-text-muted flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {fmtAge(last_updated)}
          </span>
        </div>
      </div>

      {/* Error banner (stale data) */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Stale data — last refresh failed: {error}</span>
        </div>
      )}

      {/* Two-column sub-account metrics */}
      <div className="flex gap-3">
        <MetricsColumn
          label="Baseline (Sub-Account 1)"
          metrics={sub_account_1}
          highlight={false}
        />
        <MetricsColumn
          label="RL-Challenger (Sub-Account 2)"
          metrics={sub_account_2}
          highlight={rlOutperforming}
        />
      </div>

      {/* Delta line */}
      <DeltaRow delta={delta} sub1={sub_account_1} sub2={sub_account_2} />

      {/* Kill switch last-evaluated timestamp */}
      {kill_switch_status.last_evaluated && (
        <p className="text-xs text-text-muted">
          Kill switch last evaluated: {fmtAge(kill_switch_status.last_evaluated)}
        </p>
      )}

      {/* Plain-English summary */}
      <p
        className={`text-xs leading-relaxed ${
          kill_switch_status.currently_dormant
            ? "text-loss"
            : delta.sharpe_delta >= 0 && (sub_account_1.trade_count > 0 || sub_account_2.trade_count > 0)
            ? "text-profit"
            : "text-text-muted"
        }`}
      >
        {summaryLine}
      </p>
    </motion.div>
  );
}
