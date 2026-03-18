import { motion } from "framer-motion";
import { useMemo } from "react";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { Shield, ShieldAlert, ShieldCheck, Clock, AlertTriangle, FileCheck } from "lucide-react";
import { useRulesets, useDrift, useGate } from "@/hooks/useCompliance";
import { timeAgo } from "@/lib/utils";

export default function Compliance() {
  const { data: rulesets, isLoading: rulesetsLoading } = useRulesets();
  const { data: drifts, isLoading: driftsLoading } = useDrift();
  const { data: gate, isLoading: gateLoading } = useGate();

  const canTrade = gate?.canTrade ?? gate?.allFreshForTrading ?? false;
  const reasons: string[] = gate?.reasons ?? gate?.staleFirms ?? [];
  const firmStatuses: any[] = gate?.firmStatuses ?? gate?.decisions ?? [];

  const activeRulesets = useMemo(
    () => (rulesets ?? []).filter((r) => r.status === "active").length,
    [rulesets]
  );

  const unresolvedDrifts = useMemo(
    () => (drifts ?? []).filter((d) => !d.resolved).length,
    [drifts]
  );

  const lastSync = useMemo(() => {
    if (!rulesets || rulesets.length === 0) return null;
    const sorted = [...rulesets].sort(
      (a, b) => new Date(b.retrievedAt).getTime() - new Date(a.retrievedAt).getTime()
    );
    return sorted[0].retrievedAt;
  }, [rulesets]);

  const kpis = [
    {
      icon: FileCheck,
      label: "Active Rulesets",
      value: String(activeRulesets),
      variant: "foreground" as const,
    },
    {
      icon: AlertTriangle,
      label: "Unresolved Drifts",
      value: String(unresolvedDrifts),
      variant: (unresolvedDrifts > 0 ? "loss" : "profit") as const,
    },
    {
      icon: Clock,
      label: "Last Sync",
      value: lastSync ? timeAgo(lastSync) : "—",
      variant: "foreground" as const,
    },
    {
      icon: Shield,
      label: "Gate Status",
      value: canTrade ? "CLEAR" : "BLOCKED",
      variant: (canTrade ? "profit" : "loss") as const,
    },
  ];

  const statusVariant = (status: string) => {
    switch (status) {
      case "active":
        return "profit" as const;
      case "stale":
        return "amber" as const;
      case "expired":
        return "loss" as const;
      default:
        return "neutral" as const;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Compliance</h1>
        <p className="text-sm text-text-secondary mt-1">
          Prop firm rule enforcement &amp; drift detection
        </p>
      </div>

      {/* Gate Status Banner */}
      {!gateLoading && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className={`forge-card p-6 border-2 ${
            canTrade ? "border-profit/30" : "border-loss/30"
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            {canTrade ? (
              <ShieldCheck className="w-6 h-6 text-profit" />
            ) : (
              <ShieldAlert className="w-6 h-6 text-loss" />
            )}
            <span
              className={`text-lg font-semibold font-mono ${
                canTrade ? "text-profit" : "text-loss"
              }`}
            >
              {canTrade ? "CLEAR TO TRADE" : "TRADING BLOCKED"}
            </span>
          </div>
          {reasons.length > 0 && (
            <ul className="mt-3 space-y-1.5 ml-9">
              {reasons.map((r, i) => (
                <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-loss mt-0.5 shrink-0" />
                  {r}
                </li>
              ))}
            </ul>
          )}
          {firmStatuses.length > 0 && canTrade && (
            <div className="mt-3 ml-9 flex flex-wrap gap-2">
              {firmStatuses.map((fs: any, i: number) => (
                <StatusBadge
                  key={i}
                  variant={fs.compliant ? "profit" : "loss"}
                  dot
                >
                  {fs.firm ?? fs.name ?? `Firm ${i + 1}`}
                </StatusBadge>
              ))}
            </div>
          )}
        </motion.div>
      )}

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

      {/* Two-column grid: Rulesets + Drift Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Rulesets */}
        <div className="forge-card p-6">
          <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-primary" />
            Rulesets
          </h2>
          {rulesetsLoading ? (
            <p className="text-sm text-text-muted">Loading rulesets...</p>
          ) : !rulesets || rulesets.length === 0 ? (
            <p className="text-sm text-text-muted">No rulesets found.</p>
          ) : (
            <div className="space-y-3">
              {rulesets.map((rs) => (
                <div
                  key={rs.id}
                  className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-foreground truncate">
                        {rs.firm}
                      </span>
                      <span className="text-xs text-text-muted">{rs.accountType}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      <span>Synced {timeAgo(rs.retrievedAt)}</span>
                      {rs.driftDetected && (
                        <span className="flex items-center gap-1 text-loss">
                          <AlertTriangle className="w-3 h-3" />
                          Drift
                        </span>
                      )}
                    </div>
                  </div>
                  <StatusBadge variant={statusVariant(rs.status)} dot>
                    {rs.status}
                  </StatusBadge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Drift Log */}
        <div className="forge-card p-6">
          <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-loss" />
            Drift Log
          </h2>
          {driftsLoading ? (
            <p className="text-sm text-text-muted">Loading drift log...</p>
          ) : !drifts || drifts.length === 0 ? (
            <div className="text-center py-8">
              <ShieldCheck className="w-6 h-6 text-profit mx-auto mb-2" />
              <p className="text-sm text-text-muted">No unresolved drifts detected.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {drifts.map((d) => (
                <div
                  key={d.id}
                  className="py-2.5 px-3 rounded-lg bg-[hsl(var(--surface-2))] border border-border/30"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">
                      {d.firm}
                      <span className="text-text-muted ml-1.5 text-xs">{d.accountType}</span>
                    </span>
                    <StatusBadge variant={d.resolved ? "profit" : "loss"} dot>
                      {d.resolved ? "Resolved" : "Unresolved"}
                    </StatusBadge>
                  </div>
                  {d.driftSummary && (
                    <p className="text-xs text-text-secondary mb-1.5">{d.driftSummary}</p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Clock className="w-3 h-3" />
                    <span>Detected {timeAgo(d.detectedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
