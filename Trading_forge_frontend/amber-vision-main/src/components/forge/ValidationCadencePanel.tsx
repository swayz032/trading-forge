/**
 * C7 — Validation Cadence Panel (W16 Team C)
 *
 * Visual forcing function for the operator. Renders RED when:
 *   - Days since last live backtest > VALIDATION_CADENCE_RED_THRESHOLD_DAYS (default 7)
 *   - OR strategies tested end-to-end this month < min threshold (default 1)
 *   - OR Reality Check Score < 50/100
 *
 * Wired to GET /api/validation-cadence/dashboard. Polled every 60s so a fresh
 * backtest run resets the panel without requiring a manual refresh.
 *
 * Per AGENTS.md hard rule: when this panel is RED, no new infrastructure work
 * is approved. Operator must run a strategy through the full pipeline first.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Activity, Calendar, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";

interface ValidationCadenceDashboard {
  generatedAt: string;
  daysSinceLastLiveBacktest: {
    days: number | null;
    lastBacktestAt: string | null;
    lastBacktestId: string | null;
    isRed: boolean;
    thresholdDays: number;
  };
  strategiesThisMonth: {
    count: number;
    strategyIds: string[];
    monthStart: string;
    minThreshold: number;
    isBelowThreshold: boolean;
  };
  realityCheck: {
    score: number;
    breakdown: {
      cadenceScore: number;
      throughputScore: number;
      fidelityScore: number;
    };
    thresholdDays: number;
    minStrategiesThreshold: number;
  };
}

export function ValidationCadencePanel() {
  const [data, setData] = useState<ValidationCadenceDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const res = await api.get<ValidationCadenceDashboard>("/validation-cadence/dashboard");
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    const iv = setInterval(fetchData, 60_000); // 60s refresh
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  if (loading) {
    return (
      <div className="forge-card p-5">
        <div className="flex items-center gap-2 text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading validation cadence…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="forge-card p-5 border-loss/40">
        <div className="flex items-center gap-2 text-loss">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">Validation cadence unavailable: {error ?? "no data"}</span>
        </div>
      </div>
    );
  }

  const isRed =
    data.daysSinceLastLiveBacktest.isRed ||
    data.strategiesThisMonth.isBelowThreshold ||
    data.realityCheck.score < 50;

  const cadenceLabel =
    data.daysSinceLastLiveBacktest.days == null
      ? "NEVER"
      : `${data.daysSinceLastLiveBacktest.days} day${data.daysSinceLastLiveBacktest.days === 1 ? "" : "s"}`;

  const scoreColor =
    data.realityCheck.score >= 75
      ? "text-profit"
      : data.realityCheck.score >= 50
        ? "text-primary"
        : "text-loss";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className={
        isRed
          ? "forge-card p-5 border-2 border-loss bg-loss/5 ring-2 ring-loss/30"
          : "forge-card p-5"
      }
      data-testid="validation-cadence-panel"
      data-panel-state={isRed ? "RED" : "OK"}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          {isRed ? (
            <AlertTriangle className="w-5 h-5 text-loss" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-profit" />
          )}
          <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            Validation Cadence
          </h3>
        </div>
        <div className={`text-3xl font-mono font-bold ${scoreColor}`}>
          {data.realityCheck.score}
          <span className="text-base text-text-muted">/100</span>
        </div>
      </div>

      {/* RED alert banner */}
      {isRed && (
        <div className="mb-4 p-3 rounded-md bg-loss/10 border border-loss/40">
          <div className="flex items-center gap-2 text-loss font-semibold text-sm mb-1">
            <AlertTriangle className="w-4 h-4" />
            FORCING FUNCTION TRIGGERED
          </div>
          <div className="text-xs text-text-secondary">
            {data.daysSinceLastLiveBacktest.isRed && (
              <div>
                {cadenceLabel} since last live backtest (threshold:{" "}
                {data.daysSinceLastLiveBacktest.thresholdDays} days)
              </div>
            )}
            {data.strategiesThisMonth.isBelowThreshold && (
              <div>
                Only {data.strategiesThisMonth.count} of {data.strategiesThisMonth.minThreshold}{" "}
                required strategies tested end-to-end this month
              </div>
            )}
            <div className="mt-2 italic">
              Per AGENTS.md: no new infrastructure work approved until this clears.
            </div>
          </div>
        </div>
      )}

      {/* Metric breakdown */}
      <div className="grid grid-cols-3 gap-3">
        <MetricSlot
          icon={<Calendar className="w-3 h-3" />}
          label="Days Since Last Backtest"
          value={cadenceLabel}
          isRed={data.daysSinceLastLiveBacktest.isRed}
          score={data.realityCheck.breakdown.cadenceScore}
          maxScore={40}
        />
        <MetricSlot
          icon={<Activity className="w-3 h-3" />}
          label="Strategies E2E This Month"
          value={`${data.strategiesThisMonth.count}`}
          isRed={data.strategiesThisMonth.isBelowThreshold}
          score={data.realityCheck.breakdown.throughputScore}
          maxScore={40}
        />
        <MetricSlot
          icon={<CheckCircle2 className="w-3 h-3" />}
          label="Paper-vs-Backtest Fidelity"
          value={`${data.realityCheck.breakdown.fidelityScore}/20`}
          isRed={data.realityCheck.breakdown.fidelityScore < 10}
          score={data.realityCheck.breakdown.fidelityScore}
          maxScore={20}
        />
      </div>

      {data.daysSinceLastLiveBacktest.lastBacktestAt && (
        <div className="mt-3 text-xs text-text-muted text-right font-mono">
          Last backtest: {new Date(data.daysSinceLastLiveBacktest.lastBacktestAt).toLocaleString()}
        </div>
      )}
    </motion.div>
  );
}

function MetricSlot({
  icon,
  label,
  value,
  isRed,
  score,
  maxScore,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  isRed: boolean;
  score: number;
  maxScore: number;
}) {
  const pct = Math.min(100, Math.max(0, (score / maxScore) * 100));
  return (
    <div className={isRed ? "p-3 rounded-md bg-loss/5 border border-loss/30" : "p-3 rounded-md bg-surface-2"}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-lg font-mono font-bold ${isRed ? "text-loss" : "text-foreground"}`}>
        {value}
      </div>
      <div className="mt-2 h-1 rounded-full bg-surface-3 overflow-hidden">
        <div
          className={`h-full ${isRed ? "bg-loss" : "bg-profit"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
