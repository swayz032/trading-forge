import { useMemo } from "react";
import { motion } from "framer-motion";
import { Building2 } from "lucide-react";
import {
  useSimulateBacktest,
  survivalVerdict,
  formatSurvivalPct,
  type SimulateResult,
} from "@/hooks/usePropFirm";
import { StatusBadge } from "@/components/forge/StatusBadge";
import { formatPnl } from "@/lib/mcTranslate";

interface Props {
  backtestId: string | undefined | null;
}

type Verdict = "GOOD" | "BORDERLINE" | "SKIP" | "UNKNOWN";

function classifyFirm(r: SimulateResult | null | undefined): Verdict {
  if (!r) return "UNKNOWN";
  if (!r.passes) return "SKIP";
  if (r.evalDays <= 20 && r.monthlyNet >= 4000) return "GOOD";
  return "BORDERLINE";
}

function verdictPill(v: Verdict) {
  switch (v) {
    case "GOOD":
      return { icon: "✅", label: "Best fit", classes: "text-profit bg-profit/10 border-profit/30" };
    case "BORDERLINE":
      return { icon: "⚠️", label: "Borderline fit", classes: "text-emerald bg-emerald-500/10 border-emerald-500/30" };
    case "SKIP":
      return { icon: "🚫", label: "Skip this firm", classes: "text-loss bg-loss/10 border-loss/30" };
    default:
      return { icon: "•", label: "Awaiting backtest", classes: "text-text-muted bg-surface-2 border-border/30" };
  }
}

export function PropFirmSimCard({ backtestId }: Props) {
  const enabled = !!backtestId;
  const { data: sim, isLoading } = useSimulateBacktest(enabled ? (backtestId as string) : undefined);

  const best = sim?.bestFirm ?? null;
  const v = useMemo(() => classifyFirm(best), [best]);
  const pill = verdictPill(v);

  if (isLoading || !enabled) {
    return (
      <div className="forge-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-3.5 h-3.5 text-emerald" />
          <span className="text-[10px] uppercase tracking-widest text-text-secondary">
            Prop Firm Match
          </span>
          {isLoading && enabled && <span className="text-[10px] text-emerald animate-pulse ml-auto">simulating…</span>}
        </div>
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${pill.classes}`}>
          <span className="text-sm leading-none">{pill.icon}</span>
          <span>{pill.label}</span>
        </div>
        <div className="mb-3 mt-3">
          <p className="text-lg font-semibold text-text-muted">—</p>
          <p className="text-[10px] uppercase tracking-widest text-text-muted">
            no strategy selected
          </p>
        </div>
        <div className="space-y-2 text-xs">
          <Row label="Days to pass" value="—" />
          <Row label="Buffer phase" value="—" />
          <Row label="Your cut after passing" value="—" />
          <Row label="Annual profit estimate" value="—" />
        </div>
      </div>
    );
  }

  if (!best) {
    return (
      <div className="forge-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="w-3.5 h-3.5 text-emerald" />
          <span className="text-[10px] uppercase tracking-widest text-text-secondary">
            Prop Firm Match
          </span>
        </div>
        <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${pill.classes}`}>
          <span className="text-sm leading-none">{pill.icon}</span>
          <span>No firm passes — drawdown or rules blocking</span>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-text-secondary italic border-l-2 border-loss/30 pl-3">
          This strategy fails compliance on every firm. Tighten drawdown or rework the rule set before promoting.
        </p>
      </div>
    );
  }

  // B14 — Trust Score is now the primary metric. When `survivalProbability`
  // is null (e.g. pre-B14 backtests, compute timeout), fall back to "—"
  // and still render the legacy "Best fit" verdict pill as a backup so the
  // card never appears empty.
  const survivalP = best.survivalProbability;
  const hasSurvival = survivalP != null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 }}
      className="forge-card p-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <Building2 className="w-3.5 h-3.5 text-emerald" />
        <span className="text-[10px] uppercase tracking-widest text-text-secondary">
          Prop Firm Match
        </span>
      </div>

      {/* PRIMARY METRIC — Trust Score (B14). Falls back to legacy verdict
          pill when survival data is unavailable. */}
      {hasSurvival ? (
        <div className="mb-3">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-widest text-text-muted">
              Trust Score
            </span>
            <span className="text-[9px] text-text-muted normal-case tracking-normal">
              Phase 0
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <StatusBadge variant={survivalVerdict(survivalP)}>
              {formatSurvivalPct(survivalP)}
            </StatusBadge>
            <span className="text-[10px] uppercase tracking-widest text-text-muted">
              6-mo · {best.displayName}
            </span>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-text-muted mt-1">
            {best.accountType}
          </p>
        </div>
      ) : (
        <div className="mb-3">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${pill.classes}`}>
            <span className="text-sm leading-none">{pill.icon}</span>
            <span>{pill.label}</span>
          </div>
          <p className="text-lg font-semibold text-foreground mt-2">{best.displayName}</p>
          <p className="text-[10px] uppercase tracking-widest text-text-muted">
            {best.accountType} · trust score —
          </p>
        </div>
      )}

      {/* SECONDARY — existing 4 ROI/timeline metrics. Reduced visual weight
          via opacity-80 so Trust Score reads as the dominant headline. */}
      <div className="space-y-2 text-[11px] opacity-80">
        <Row label="Days to pass" value={`${best.evalDays} days`} valueClass={best.evalDays <= 20 ? "text-profit" : "text-emerald"} />
        <Row label="Buffer phase" value={`${best.bufferDays} days`} />
        <Row label="Your cut after passing" value={`${(best.roi >= 0 ? "+" : "")}${(formatPnl(best.monthlyNet))}/mo`} valueClass="text-profit" />
        <Row label="Annual profit estimate" value={formatPnl(best.annualProfit)} valueClass="text-profit" />
      </div>

      {best.violations?.length > 0 && (
        <div className="mt-3 text-[11px] leading-relaxed text-loss italic border-l-2 border-loss/30 pl-3">
          Risk note: {best.violations.slice(0, 2).join(" · ")}
        </div>
      )}
    </motion.div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/10 pb-1.5">
      <span className="text-text-secondary">{label}</span>
      <span className={`font-mono font-semibold ${valueClass ?? "text-foreground"}`}>{value}</span>
    </div>
  );
}
