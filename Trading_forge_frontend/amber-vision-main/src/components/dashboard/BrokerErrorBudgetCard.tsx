import { AlertTriangle, CheckCircle, Activity } from "lucide-react";
import { useBrokerErrorBudget } from "@/hooks/useBrokerErrorBudget";
import type { BrokerBudgetEntry } from "@/hooks/useBrokerErrorBudget";
import { timeAgo } from "@/lib/utils";

const ALARM_THRESHOLD_PCT = 0.05; // must match service constant

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pctDisplay(pct: number): string {
  return `${(pct * 100).toFixed(1)}%`;
}

function classColor(pct: number): string {
  if (pct > ALARM_THRESHOLD_PCT) return "text-loss";
  if (pct > ALARM_THRESHOLD_PCT * 0.6) return "text-amber-400";
  return "text-profit";
}

function classBgColor(pct: number): string {
  if (pct > ALARM_THRESHOLD_PCT) return "bg-loss/10 border-loss/30";
  if (pct > ALARM_THRESHOLD_PCT * 0.6) return "bg-amber-500/10 border-amber-500/30";
  return "bg-profit/10 border-profit/30";
}

// ─── Sub-component: per-broker row ────────────────────────────────────────────

function BrokerRow({
  broker,
  entry,
}: {
  broker: string;
  entry: BrokerBudgetEntry;
}) {
  const classes = Object.entries(entry.byRejectionClass).sort(
    ([, a], [, b]) => b.pct - a.pct,
  );

  return (
    <div className="border border-border/20 rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {entry.alarmed ? (
            <AlertTriangle className="w-3.5 h-3.5 text-loss" />
          ) : (
            <CheckCircle className="w-3.5 h-3.5 text-profit" />
          )}
          <span className="text-xs font-mono font-semibold text-foreground uppercase">
            {broker}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-text-muted">
          <span>{entry.totalAttempts} attempts</span>
          <span>{entry.totalRejections} rejected</span>
          {entry.alarmed && (
            <span className="px-1.5 py-0.5 rounded border border-loss/30 bg-loss/10 text-loss font-medium">
              ALARM
            </span>
          )}
        </div>
      </div>

      {classes.length > 0 ? (
        <div className="space-y-1">
          {classes.map(([cls, stats]) => (
            <div
              key={cls}
              className={`flex items-center justify-between px-2 py-1 rounded border text-[10px] ${classBgColor(stats.pct)}`}
            >
              <span className="font-mono text-text-secondary truncate max-w-[60%]">
                {cls}
              </span>
              <div className="flex items-center gap-2 ml-2 shrink-0">
                <span className="text-text-muted">{stats.count}×</span>
                <span className={`font-semibold ${classColor(stats.pct)}`}>
                  {pctDisplay(stats.pct)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-text-muted">No rejections in window.</p>
      )}
    </div>
  );
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function BrokerErrorBudgetCard() {
  const { data, isLoading, isError } = useBrokerErrorBudget(24);

  const alarmedCount = data
    ? Object.values(data.byBroker).filter((e) => e.alarmed).length
    : 0;

  const brokerEntries = data
    ? Object.entries(data.byBroker).sort(([, a], [, b]) =>
        b.alarmed === a.alarmed ? 0 : b.alarmed ? 1 : -1,
      )
    : [];

  return (
    <div className="forge-card p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-3.5 h-3.5 text-emerald" />
        <span className="text-[10px] uppercase tracking-widest text-text-secondary">
          Broker error budget
        </span>
        <div className="ml-auto flex items-center gap-2">
          {alarmedCount > 0 && (
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-loss/30 bg-loss/10 text-loss text-[10px] font-medium">
              <AlertTriangle className="w-3 h-3" />
              <span>
                {alarmedCount} broker{alarmedCount !== 1 ? "s" : ""} alarmed
              </span>
            </div>
          )}
          {!isLoading && !isError && alarmedCount === 0 && (
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-profit/30 bg-profit/10 text-profit text-[10px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              <span>All clear</span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      {isLoading && (
        <div className="text-xs text-text-muted">Loading broker budget…</div>
      )}

      {isError && (
        <div className="text-xs text-loss">
          Failed to load broker error budget.
        </div>
      )}

      {!isLoading && !isError && data && (
        <>
          {brokerEntries.length === 0 ? (
            <p className="text-xs text-text-muted">
              No routing attempts in the last {data.windowHours}h window.
            </p>
          ) : (
            <div className="space-y-2">
              {brokerEntries.map(([broker, entry]) => (
                <BrokerRow key={broker} broker={broker} entry={entry} />
              ))}
            </div>
          )}

          <p className="text-[10px] text-text-muted mt-3">
            Rolling {data.windowHours}h window. Alarm threshold: {(ALARM_THRESHOLD_PCT * 100).toFixed(0)}%.
            {data.computedAt
              ? ` Last computed ${timeAgo(data.computedAt)}.`
              : ""}
          </p>
        </>
      )}
    </div>
  );
}
