import { useNavigate } from "react-router-dom";
import { Search, AlertTriangle } from "lucide-react";
import { useScoutHealth } from "@/hooks/useScoutHealth";
import { timeAgo } from "@/lib/utils";

const TOTAL_KNOWN_SOURCES = 6;

type Verdict = "GREEN" | "RED" | "GRAY";

function classify(d: ReturnType<typeof useScoutHealth>["data"]): Verdict {
  if (!d) return "GRAY";
  if (d.pipelineMode !== "ACTIVE") return "GRAY";
  if (d.strategiesProducedToday === 0) return "RED";
  if (d.strategiesProducedToday > 0) return "GREEN";
  return "GRAY";
}

function verdictClasses(v: Verdict) {
  switch (v) {
    case "GREEN":
      return "text-profit bg-profit/10 border-profit/30";
    case "RED":
      return "text-loss bg-loss/10 border-loss/30";
    default:
      return "text-text-muted bg-surface-2 border-border/30";
  }
}

function verdictLabel(v: Verdict, mode?: string) {
  if (v === "GREEN") return "Scout flowing";
  if (v === "RED") return "No new strategies today";
  if (mode && mode !== "ACTIVE") return `Pipeline ${mode.toLowerCase()}`;
  return "Awaiting data";
}

// Pass 10 — distribution bar segment palette.
const REJECT_PALETTE: Record<string, string> = {
  "scout.rejected_regex": "bg-amber-500",
  "scout.rejected_auditor": "bg-orange-500",
  "scout.synthesizer_refused": "bg-rose-500",
  "scout.rejected_compile": "bg-red-500",
  "scout.rejected_critic": "bg-fuchsia-500",
};

const REJECT_LABEL: Record<string, string> = {
  "scout.rejected_regex": "Regex",
  "scout.rejected_auditor": "Auditor",
  "scout.synthesizer_refused": "Synth",
  "scout.rejected_compile": "Compile",
  "scout.rejected_critic": "Critic",
};

interface RejectDistribution {
  total: number;
  buckets: Array<{ action: string; count: number; pct: number }>;
}

function pickLatestRejectDistribution(
  alerts?: { action: string; result: unknown }[],
): RejectDistribution | null {
  if (!alerts || alerts.length === 0) return null;
  const latest = alerts.find((a) => a.action === "alert.reject_distribution_skewed");
  if (!latest || typeof latest.result !== "object" || latest.result === null) return null;
  const r = latest.result as { total?: number; distribution?: Record<string, number> };
  const total = typeof r.total === "number" ? r.total : 0;
  const dist = r.distribution ?? {};
  if (total <= 0) return null;
  const buckets = Object.entries(dist)
    .map(([action, count]) => ({
      action,
      count: Number(count),
      pct: Number(count) / total,
    }))
    .sort((a, b) => b.count - a.count);
  return { total, buckets };
}

export function ScoutHealthCard() {
  const { data, isLoading } = useScoutHealth();
  const navigate = useNavigate();

  const v = classify(data);
  const cls = verdictClasses(v);

  const sourcesUsed = data ? Object.keys(data.scoutsBySourceLast7d).length : 0;
  const lastAt = data?.lastStrategyCreatedAt ?? null;
  const recentAlerts = data?.recentAlerts ?? [];
  const recentAlertCount = recentAlerts.length;
  const rejectDist = pickLatestRejectDistribution(recentAlerts);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate("/scout")}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") navigate("/scout");
      }}
      className="forge-card p-5 cursor-pointer hover:border-emerald-500/30 transition-colors"
    >
      <div className="flex items-center gap-2 mb-3">
        <Search className="w-3.5 h-3.5 text-emerald" />
        <span className="text-[10px] uppercase tracking-widest text-text-secondary">
          Scout health
        </span>
        <div className="ml-auto flex items-center gap-2">
          {recentAlertCount > 0 && (
            <div
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-loss/30 bg-loss/10 text-loss text-[10px] font-medium"
              title={`${recentAlertCount} scout-health alert(s) in last 24h`}
            >
              <AlertTriangle className="w-3 h-3" />
              <span>{recentAlertCount} alert{recentAlertCount === 1 ? "" : "s"}</span>
            </div>
          )}
          <div
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${cls}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            <span>{verdictLabel(v, data?.pipelineMode)}</span>
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="text-xs text-text-muted">Loading scout pulse…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-text-muted">
                Strategies today
              </p>
              <p className="text-lg font-mono font-semibold text-foreground">
                {data.strategiesProducedToday}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-text-muted">
                Sources / week
              </p>
              <p className="text-lg font-mono font-semibold text-foreground">
                {sourcesUsed}
                <span className="text-text-muted text-xs">
                  {" "}/ {TOTAL_KNOWN_SOURCES}
                </span>
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-text-muted">
                Auditor rejects 24h
              </p>
              <p className="text-lg font-mono font-semibold text-foreground">
                {data.auditorRejectsLast24h}
              </p>
            </div>
          </div>

          {rejectDist && rejectDist.total > 0 && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-widest text-text-muted mb-1">
                Reject distribution (24h) — {rejectDist.total} total
              </p>
              <div className="flex w-full h-2 rounded overflow-hidden bg-surface-2">
                {rejectDist.buckets.map((b) => (
                  <div
                    key={b.action}
                    className={REJECT_PALETTE[b.action] ?? "bg-text-muted"}
                    style={{ width: `${b.pct * 100}%` }}
                    title={`${REJECT_LABEL[b.action] ?? b.action}: ${b.count} (${(b.pct * 100).toFixed(0)}%)`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[10px] text-text-muted">
                {rejectDist.buckets.map((b) => (
                  <span key={b.action} className="flex items-center gap-1">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        REJECT_PALETTE[b.action] ?? "bg-text-muted"
                      }`}
                    />
                    {REJECT_LABEL[b.action] ?? b.action}: {b.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-text-muted">
            {lastAt
              ? `Last new strategy ${timeAgo(lastAt)}.`
              : "No strategies recorded yet."}
          </p>
        </>
      )}
    </div>
  );
}
