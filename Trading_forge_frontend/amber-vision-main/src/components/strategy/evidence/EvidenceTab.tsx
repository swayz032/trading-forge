/**
 * EvidenceTab — container for the Strategy Detail "Evidence" tab.
 *
 * Pass 19 Track B: shows operator the cross-validation provenance of the
 * strategy (which sources confirmed it + how many). For strategies that
 * pre-date the cross-validation layer (Pass 18 / 2026-05-11) we render a
 * low-prominence fallback card explaining where the strategy came from.
 *
 * Spec: docs/superpowers/specs/2026-05-11-cross-source-strategy-validation-design.md
 */

import { Loader2, FileQuestion } from "lucide-react";
import { useStrategyEvidence } from "@/hooks/useStrategyEvidence";
import { EvidenceSummaryCard } from "./EvidenceSummaryCard";
import { MentionsList } from "./MentionsList";

interface Props {
  strategyId: string;
  /** Strategy source / tags surfaced for the fallback explanation card. */
  strategySource?: string | null;
  strategyTags?: string[] | null;
}

export function EvidenceTab({
  strategyId,
  strategySource,
  strategyTags,
}: Props) {
  const { data, isLoading, isError, error } = useStrategyEvidence(strategyId);

  if (isLoading) {
    return (
      <div
        className="forge-card p-8 flex items-center justify-center"
        data-testid="evidence-loading"
      >
        <Loader2 className="w-4 h-4 animate-spin text-text-muted mr-2" />
        <span className="text-sm text-text-muted">Loading evidence…</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="forge-card p-8" data-testid="evidence-error">
        <p className="text-sm text-text-muted text-center">
          Failed to load evidence: {error instanceof Error ? error.message : "unknown error"}
        </p>
      </div>
    );
  }

  // Pre-cross-validation strategies (manual injection / Pass 16 residue).
  if (!data.cross_validated || !data.bucket) {
    const tagStr =
      strategyTags && strategyTags.length > 0
        ? strategyTags.join(", ")
        : "—";
    return (
      <div
        className="forge-card p-5 border border-amber-400/10"
        data-testid="evidence-fallback"
      >
        <div className="flex items-start gap-3">
          <FileQuestion className="w-5 h-5 text-amber-300/80 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              Pre-cross-validation strategy
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              This strategy pre-dates the cross-validation layer (added
              2026-05-11, Pass 18). It was created via manual injection
              during architecture verification or from the older single-source
              scout path.
            </p>
            {data.fallback_source_note && (
              <p className="text-xs text-text-muted leading-relaxed">
                {data.fallback_source_note}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 pt-2 max-w-md">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-text-muted block">
                  Source
                </span>
                <span className="text-xs font-mono text-foreground">
                  {strategySource ?? "unknown"}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-text-muted block">
                  Tags
                </span>
                <span className="text-xs font-mono text-foreground truncate block">
                  {tagStr}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Full cross-validated provenance.
  return (
    <div className="space-y-4" data-testid="evidence-content">
      <EvidenceSummaryCard bucket={data.bucket} crossValidated={true} />
      <MentionsList mentions={data.mentions} />
    </div>
  );
}
