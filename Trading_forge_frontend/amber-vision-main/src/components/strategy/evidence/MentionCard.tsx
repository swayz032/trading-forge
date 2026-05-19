/**
 * MentionCard — one source mention contributing to a cross-validated bucket.
 *
 * Color-coded by source_provider (desaturated to fit dark theme). Shows the
 * source URL as an external link, optional confidence chip, and an indicator
 * for whether the mention came from active CV1 search vs organic scout.
 */

import { ExternalLink, Search, Inbox } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import type { EvidenceMention } from "@/types/strategy-evidence";
import type { PendingSourceProvider } from "@/types/pending-buckets";

interface Props {
  mention: EvidenceMention;
}

/**
 * Per-provider accent. Desaturated dark-theme palette per the brand rules —
 * the emerald primary stays reserved for the cross-validated status pill.
 */
const PROVIDER_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  youtube:     { bg: "bg-red-900/30",     text: "text-red-300",     border: "border-red-800/40" },
  reddit:      { bg: "bg-orange-900/30",  text: "text-orange-300",  border: "border-orange-800/40" },
  tavily:      { bg: "bg-blue-900/30",    text: "text-blue-300",    border: "border-blue-800/40" },
  brave:       { bg: "bg-purple-900/30",  text: "text-purple-300",  border: "border-purple-800/40" },
  scrapingbee: { bg: "bg-lime-900/30",    text: "text-lime-300",    border: "border-lime-800/40" },
  apify:       { bg: "bg-cyan-900/30",    text: "text-cyan-300",    border: "border-cyan-800/40" },
  parallel:    { bg: "bg-fuchsia-900/30", text: "text-fuchsia-300", border: "border-fuchsia-800/40" },
  tf_search:   { bg: "bg-emerald-900/30", text: "text-emerald-300", border: "border-emerald-800/40" },
  exa:         { bg: "bg-indigo-900/30",  text: "text-indigo-300",  border: "border-indigo-800/40" },
  manual:      { bg: "bg-slate-800/40",   text: "text-slate-300",   border: "border-slate-700/40" },
};

function providerStyle(p: PendingSourceProvider) {
  return PROVIDER_STYLES[p] ?? {
    bg: "bg-slate-800/40",
    text: "text-slate-300",
    border: "border-slate-700/40",
  };
}

export function MentionCard({ mention }: Props) {
  const style = providerStyle(mention.source_provider);
  const confidence = mention.cross_validator_confidence;
  const isCv = mention.is_cross_validation_result;

  return (
    <div
      data-testid={`evidence-mention-${mention.id}`}
      className="forge-card p-4 flex items-center gap-3"
    >
      <span
        className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${style.bg} ${style.text} ${style.border}`}
      >
        {mention.source_provider}
      </span>

      <a
        href={mention.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-foreground hover:text-primary transition-colors truncate flex-1 inline-flex items-center gap-1"
        data-testid={`evidence-mention-link-${mention.id}`}
      >
        <span className="truncate">{mention.source_url}</span>
        <ExternalLink className="w-3 h-3 flex-shrink-0" />
      </a>

      {confidence != null && (
        <span
          className="px-2 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary border border-primary/20"
          title="Cross-validator confidence"
        >
          {(confidence * 100).toFixed(0)}%
        </span>
      )}

      <span
        className="inline-flex items-center gap-1 text-[10px] text-text-muted"
        title={isCv ? "Active CV1 search result" : "Organic scout discovery"}
      >
        {isCv ? (
          <Search className="w-3 h-3" />
        ) : (
          <Inbox className="w-3 h-3" />
        )}
        {isCv ? "active search" : "organic scout"}
      </span>

      <span className="text-[10px] text-text-muted font-mono whitespace-nowrap">
        {timeAgo(mention.created_at)}
      </span>
    </div>
  );
}
