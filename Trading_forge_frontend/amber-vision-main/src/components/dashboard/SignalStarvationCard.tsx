/**
 * SignalStarvationCard — Wave 25 Gap 3
 *
 * Execution-side mirror of ScoutHealthCard. Shows whether deployed/pilot
 * strategies are actually firing entries and receiving signal evaluations.
 *
 * NONE    → green — entries firing normally
 * WARN    → amber — signals evaluated but nothing passing the A+ gate
 *           (W25.1 score threshold may be too tight)
 * CRITICAL → red — zero signal evaluations (feature pipeline broken upstream)
 */

import { AlertTriangle, Activity } from "lucide-react";
import { useDeployedStrategyStarvation, type StarvationStrategyStatus } from "@/hooks/useDeployedStrategyStarvation";
import { timeAgo } from "@/lib/utils";

type OverallVerdict = "GREEN" | "WARN" | "CRITICAL" | "GRAY";

function classify(strategies: StarvationStrategyStatus[]): OverallVerdict {
  if (strategies.length === 0) return "GRAY";
  if (strategies.some((s) => s.alarmLevel === "CRITICAL")) return "CRITICAL";
  if (strategies.some((s) => s.alarmLevel === "WARN")) return "WARN";
  return "GREEN";
}

function verdictClasses(v: OverallVerdict) {
  switch (v) {
    case "GREEN":
      return "text-profit bg-profit/10 border-profit/30";
    case "WARN":
      return "text-amber-400 bg-amber-400/10 border-amber-400/30";
    case "CRITICAL":
      return "text-loss bg-loss/10 border-loss/30";
    default:
      return "text-text-muted bg-surface-2 border-border/30";
  }
}

function verdictLabel(v: OverallVerdict): string {
  switch (v) {
    case "GREEN":
      return "Strategies firing";
  case "WARN":
      return "Signal starvation warn";
    case "CRITICAL":
      return "Feature pipeline broken";
    default:
      return "No deployed strategies";
  }
}

function alarmBadgeClasses(level: StarvationStrategyStatus["alarmLevel"]) {
  switch (level) {
    case "CRITICAL":
      return "text-loss bg-loss/10 border-loss/30";
    case "WARN":
      return "text-amber-400 bg-amber-400/10 border-amber-400/30";
    default:
      return "text-profit bg-profit/10 border-profit/30";
  }
}

export function SignalStarvationCard() {
  const { data, isLoading } = useDeployedStrategyStarvation();

  const strategies = data?.strategies ?? [];
  const v = classify(strategies);
  const cls = verdictClasses(v);

  const criticalCount = strategies.filter((s) => s.alarmLevel === "CRITICAL").length;
  const warnCount = strategies.filter((s) => s.alarmLevel === "WARN").length;
  const alertCount = criticalCount + warnCount;

  return (
    <div className="forge-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-widest text-text-secondary">
          Signal execution
        </span>
        <div className="ml-auto flex items-center gap-2">
          {alertCount > 0 && (
            <div
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-loss/30 bg-loss/10 text-loss text-[10px] font-medium"
              title={`${alertCount} signal starvation alert(s)`}
            >
              <AlertTriangle className="w-3 h-3" />
              <span>{alertCount} alert{alertCount === 1 ? "" : "s"}</span>
            </div>
          )}
          <div
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${cls}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            <span>{verdictLabel(v)}</span>
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="text-xs text-text-muted">Loading signal execution status…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-text-muted">
                Deployed
              </p>
              <p className="text-lg font-mono font-semibold text-foreground">
                {data.deployedStrategyCount}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-text-muted">
                Critical
              </p>
              <p className={`text-lg font-mono font-semibold ${criticalCount > 0 ? "text-loss" : "text-profit"}`}>
                {criticalCount}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-text-muted">
                Starvation warn
              </p>
              <p className={`text-lg font-mono font-semibold ${warnCount > 0 ? "text-amber-400" : "text-profit"}`}>
                {warnCount}
              </p>
            </div>
          </div>

          {strategies.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {strategies.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between text-[11px]"
                >
                  <span className="text-text-secondary truncate max-w-[140px]" title={s.name}>
                    {s.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted">
                      {s.entryCount} entries / {s.signalEvalCount} evals
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${alarmBadgeClasses(s.alarmLevel)}`}
                    >
                      {s.alarmLevel === "NONE" ? "OK" : s.alarmLevel}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-text-muted">
            {data.deployedStrategyCount === 0
              ? "No PILOT or DEPLOYED strategies yet."
              : `Last checked ${timeAgo(data.checkedAt)}.`}
          </p>

          {(criticalCount > 0 || warnCount > 0) && (
            <p className="text-[11px] text-amber-400 mt-1">
              {criticalCount > 0
                ? "Feature pipeline may be broken — paper session or signal service not wired."
                : "W25.1 score threshold may be too tight — signals evaluated but none passing."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
