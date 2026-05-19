/**
 * Monte Carlo screen — most recent MC run summary.
 *
 * Baby jargon:
 *   - "If we ran this 1,000 times" instead of "Monte Carlo simulations"
 *   - "Survival score" replaces "1 - probabilityOfRuin"
 *   - "Worst case loss" replaces "VaR 95"
 *   - "Most likely outcome" replaces "Sharpe P50"
 */

import { useRecentMonteCarlo } from "@/hooks/useMonteCarlo";

function n(v: string | null | undefined): number | null {
  if (v == null) return null;
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : null;
}

export function MonteCarloScreen() {
  const { data: runs } = useRecentMonteCarlo(5);
  const latest = runs?.[0];

  const por = n(latest?.probabilityOfRuin ?? null);
  const survival = por != null ? 1 - por : null;
  const sharpeP50 = n(latest?.sharpeP50 ?? null);
  const var95 = n(latest?.var95 ?? null);
  const ddP95 = n(latest?.maxDrawdownP95 ?? null);

  let survivalColor = "#94a3b8";
  let survivalLabel = "—";
  if (survival != null) {
    if (survival >= 0.95) { survivalColor = "#10B981"; survivalLabel = "VERY SAFE"; }
    else if (survival >= 0.80) { survivalColor = "#34D399"; survivalLabel = "SAFE"; }
    else if (survival >= 0.60) { survivalColor = "#facc15"; survivalLabel = "RISKY"; }
    else { survivalColor = "#ef4444"; survivalLabel = "DANGEROUS"; }
  }

  return (
    <>
      <div style={{ fontSize: 12, letterSpacing: "0.32em", color: "#10B981", fontWeight: 700 }}>
        IF WE RAN THIS 1,000 TIMES
      </div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>
        Monte Carlo · last run {latest ? new Date(latest.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#64748b" }}>
          SURVIVAL SCORE
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 4 }}>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1, color: survivalColor }}>
            {survival != null ? `${(survival * 100).toFixed(0)}%` : "—"}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: survivalColor, letterSpacing: "0.16em" }}>
            {survivalLabel}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
          how often the strategy lives in 1,000 fake market histories
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: "auto", paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#64748b" }}>
            WORST-CASE LOSS
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#ef4444", marginTop: 2 }}>
            {var95 != null ? `-$${Math.abs(Math.round(var95)).toLocaleString()}` : ddP95 != null ? `-$${Math.abs(Math.round(ddP95)).toLocaleString()}` : "—"}
          </div>
          <div style={{ fontSize: 10, color: "#64748b" }}>(95th percentile)</div>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: "#64748b" }}>
            MOST LIKELY SHARPE
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: sharpeP50 != null && sharpeP50 >= 1 ? "#10B981" : "#facc15", marginTop: 2 }}>
            {sharpeP50 != null ? sharpeP50.toFixed(2) : "—"}
          </div>
          <div style={{ fontSize: 10, color: "#64748b" }}>(median outcome)</div>
        </div>
      </div>
    </>
  );
}
