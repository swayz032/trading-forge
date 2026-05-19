/**
 * MentionsList — vertical stack of MentionCard rows + provider breakdown.
 *
 * Renders one badge per distinct source provider with the count of mentions,
 * then the individual mention rows beneath.
 */

import type { EvidenceMention } from "@/types/strategy-evidence";
import { MentionCard } from "./MentionCard";

interface Props {
  mentions: EvidenceMention[];
}

export function MentionsList({ mentions }: Props) {
  if (mentions.length === 0) {
    return (
      <div className="forge-card p-5">
        <p className="text-sm text-text-muted text-center">
          No source mentions recorded.
        </p>
      </div>
    );
  }

  // Provider breakdown — count of mentions per source_provider, ordered by count desc.
  const providerCounts = mentions.reduce<Record<string, number>>((acc, m) => {
    acc[m.source_provider] = (acc[m.source_provider] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.entries(providerCounts).sort(
    ([, a], [, b]) => b - a,
  );

  return (
    <div className="space-y-3">
      <div
        className="forge-card p-4"
        data-testid="evidence-provider-breakdown"
      >
        <span className="text-[10px] uppercase tracking-widest text-text-muted block mb-2">
          Source breakdown
        </span>
        <div className="flex flex-wrap gap-2">
          {breakdown.map(([provider, count]) => (
            <span
              key={provider}
              className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-[hsl(var(--surface-2))] text-foreground border border-border/20"
            >
              {provider}
              <span className="text-text-muted ml-1.5">×{count}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {mentions.map((m) => (
          <MentionCard key={m.id} mention={m} />
        ))}
      </div>
    </div>
  );
}
