/**
 * PendingValidationTab — top-level container for the Pending Validation
 * Watchlist on the /scout page (Pass 18 cross-source validation).
 *
 * Single responsibility:
 *   - Fetch pending buckets, render loading / error / empty / list states.
 *   - Wire SSE invalidation for `pending_bucket.updated` /
 *     `pending_bucket.graduated`.
 *
 * Row mutation logic + drilldown live in `<PendingBucketRow>` /
 * `<PendingMentionsList>`.
 */

import { Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorBanner } from "@/components/forge/QueryErrorBanner";
import { usePendingBuckets, PENDING_BUCKETS_QUERY_KEY } from "@/hooks/usePendingBuckets";
import { useSSE } from "@/hooks/useSSE";
import { PendingBucketRow } from "./PendingBucketRow";

export function PendingValidationTab() {
  const { data, isLoading, error } = usePendingBuckets("pending");

  // SSE invalidation is handled centrally in `useSSE`; subscribing here makes
  // the connection explicit for this view and keeps the dependency obvious.
  useSSE(["pending_bucket.updated", "pending_bucket.graduated"]);

  if (isLoading) {
    return (
      <div
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
        data-testid="pending-buckets-loading"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="forge-card p-5">
            <div className="flex gap-5">
              <Skeleton className="w-[60px] h-[60px] rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-1.5 w-full" />
                <div className="flex gap-1.5">
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-4 w-14" />
                </div>
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-7 w-28" />
                  <Skeleton className="h-7 w-16" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <QueryErrorBanner
        message="Couldn't load pending strategies. Retry?"
        queryKey={[...PENDING_BUCKETS_QUERY_KEY]}
      />
    );
  }

  if (!data || data.length === 0) {
    return (
      <div
        className="forge-card p-12 text-center"
        data-testid="pending-buckets-empty"
      >
        <Sparkles className="w-8 h-8 text-primary/40 mx-auto mb-3" />
        <p className="text-sm text-text-secondary max-w-md mx-auto">
          No pending strategy candidates. Scouts will surface them here as
          multi-source consensus builds.
        </p>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      data-testid="pending-buckets-list"
    >
      {data.map((bucket, i) => (
        <PendingBucketRow key={bucket.id} bucket={bucket} index={i} />
      ))}
    </div>
  );
}
