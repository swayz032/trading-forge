/**
 * RegimeCoverageCard — Wave 25 Gap 9
 *
 * Shows which market regimes have ≥1 deployed/pilot strategy covering them.
 * A regime shift to an uncovered regime produces zero trades silently.
 *
 * Green check = covered. Red X = gap (will zero-out trades in this regime).
 */

import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { timeAgo } from "@/lib/utils";

interface RegimeCoverageEntry {
  regime: string;
  deployedCount: number;
  covered: boolean;
  strategyIds: string[];
}

interface RegimeCoverageStatus {
  checkedAt: string;
  regimes: RegimeCoverageEntry[];
  gapRegimes: string[];
}

function useRegimeCoverage() {
  return useQuery<RegimeCoverageStatus>({
    queryKey: ["regime-coverage"],
    queryFn: () => api.get<RegimeCoverageStatus>("/webhook-latency/regime-coverage"),
    staleTime: 5 * 60_000, // 5 min — daily cron; no SSE for this
    refetchOnWindowFocus: true,
  });
}

// Human-friendly labels for regime names
const REGIME_LABEL: Record<string, string> = {
  TRENDING_UP: "Trend Up",
  TRENDING_DOWN: "Trend Down",
  RANGE_BOUND: "Range",
  EXPANSION: "Expansion",
  COMPRESSION: "Compression",
  HIGH_VOL_MACRO: "High Vol",
  LOW_LIQ_CHOP: "Low Liq",
};

export function RegimeCoverageCard() {
  const { data, isLoading } = useRegimeCoverage();

  const gapCount = data?.gapRegimes.length ?? 0;
  const allCovered = gapCount === 0 && (data?.regimes.length ?? 0) > 0;

  return (
    <div className="forge-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-widest text-text-secondary">
          Regime coverage
        </span>
        <div className="ml-auto">
          {!isLoading && data && (
            <div
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${
                allCovered
                  ? "text-profit bg-profit/10 border-profit/30"
                  : gapCount > 0
                  ? "text-loss bg-loss/10 border-loss/30"
                  : "text-text-muted bg-surface-2 border-border/30"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              <span>{allCovered ? "All covered" : `${gapCount} gap${gapCount === 1 ? "" : "s"}`}</span>
            </div>
          )}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="text-xs text-text-muted">Loading regime coverage…</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-x-3 gap-y-2">
            {data.regimes.map((r) => (
              <div key={r.regime} className="flex items-center gap-1.5">
                {r.covered ? (
                  <Check className="w-3 h-3 text-profit flex-shrink-0" />
                ) : (
                  <X className="w-3 h-3 text-loss flex-shrink-0" />
                )}
                <span
                  className={`text-[11px] ${r.covered ? "text-text-secondary" : "text-loss"}`}
                  title={`${r.deployedCount} deployed strateg${r.deployedCount === 1 ? "y" : "ies"}`}
                >
                  {REGIME_LABEL[r.regime] ?? r.regime}
                  {r.covered && (
                    <span className="text-text-muted ml-0.5">({r.deployedCount})</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          {gapCount > 0 && (
            <p className="text-[11px] text-loss mt-2">
              Missing: {data.gapRegimes.map((r) => REGIME_LABEL[r] ?? r).join(", ")}. A regime shift here will produce zero trades.
            </p>
          )}

          <p className="text-[11px] text-text-muted mt-2">
            {data.checkedAt ? `Checked ${timeAgo(data.checkedAt)}.` : ""}
          </p>
        </>
      )}
    </div>
  );
}
