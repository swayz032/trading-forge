/**
 * PendingMentionsList — drilldown of the per-source mentions inside a single
 * pending bucket. Rendered inside the collapsible panel underneath a
 * `<PendingBucketRow>`.
 *
 * Responsibility (single):
 *   - Fetch mentions for the given bucket_id
 *   - Render a clean, no-nonsense list of (provider, url, confidence, age)
 *
 * Does NOT own visibility / collapse state — the parent row controls when
 * this component is mounted.
 */

import { ExternalLink, Loader2 } from "lucide-react";
import { usePendingMentions } from "@/hooks/usePendingBuckets";
import { timeAgo } from "@/lib/utils";

interface Props {
  bucketId: string;
}

export function PendingMentionsList({ bucketId }: Props) {
  const { data: mentions, isLoading, error } = usePendingMentions(bucketId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-muted px-5 py-4">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading source mentions…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-loss px-5 py-4">
        Could not load mentions for this bucket.
      </div>
    );
  }

  if (!mentions || mentions.length === 0) {
    return (
      <div className="text-xs text-text-muted px-5 py-4">
        No source mentions recorded yet.
      </div>
    );
  }

  return (
    <ul
      className="border-t border-border/10 divide-y divide-border/5"
      data-testid="pending-mentions-list"
    >
      {mentions.map((m) => (
        <li
          key={m.id}
          className="flex items-center gap-3 px-5 py-3 text-xs"
        >
          <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider bg-[hsl(var(--surface-2))] text-text-secondary border border-border/20">
            {m.sourceProvider}
          </span>
          <a
            href={m.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 min-w-0 truncate text-primary hover:text-primary/80 underline underline-offset-2"
            title={m.sourceUrl}
          >
            {m.sourceUrl}
            <ExternalLink className="w-3 h-3 inline ml-1" />
          </a>
          {m.crossValidatorConfidence != null && (
            <span
              className="font-mono text-[10px] text-text-muted"
              title="cross-validator confidence"
            >
              {(m.crossValidatorConfidence * 100).toFixed(0)}%
            </span>
          )}
          <span className="text-text-muted whitespace-nowrap">
            {timeAgo(m.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}
