/**
 * Pending Validation Watchlist — React Query hooks.
 *
 * Backend endpoints (Pass 18, added in parallel by the backend agent):
 *   GET  /api/agent/pending-buckets?status=pending
 *   GET  /api/agent/pending-buckets/:id/mentions
 *   POST /api/agent/pending-buckets/:id/graduate
 *   POST /api/agent/pending-buckets/:id/kill
 *
 * SSE invalidation is wired in `useSSE.ts` (events `pending_bucket.updated`
 * and `pending_bucket.graduated`).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  PendingBucket,
  PendingBucketActionResponse,
  PendingBucketStatus,
  PendingBucketsResponse,
  PendingMention,
  PendingMentionsResponse,
} from "@/types/pending-buckets";

export const PENDING_BUCKETS_QUERY_KEY = ["pending-buckets"] as const;

export function usePendingBuckets(
  status: PendingBucketStatus = "pending",
): UseQueryResult<PendingBucket[], Error> {
  return useQuery<PendingBucket[], Error>({
    queryKey: [...PENDING_BUCKETS_QUERY_KEY, status],
    queryFn: async () => {
      const res = await api.get<PendingBucketsResponse | PendingBucket[]>(
        `/agent/pending-buckets?status=${encodeURIComponent(status)}`,
      );
      return Array.isArray(res) ? res : res.data;
    },
    // Re-fetch on focus so the operator gets fresh counts when returning to
    // the tab; SSE invalidation handles the live path.
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    retry: 1,
  });
}

export function usePendingMentions(
  bucketId: string | null,
): UseQueryResult<PendingMention[], Error> {
  return useQuery<PendingMention[], Error>({
    queryKey: [...PENDING_BUCKETS_QUERY_KEY, "mentions", bucketId],
    enabled: !!bucketId,
    queryFn: async () => {
      const res = await api.get<PendingMentionsResponse | PendingMention[]>(
        `/agent/pending-buckets/${bucketId}/mentions`,
      );
      return Array.isArray(res) ? res : res.data;
    },
    staleTime: 30_000,
  });
}

export function useGraduateBucket() {
  const qc = useQueryClient();
  return useMutation<PendingBucketActionResponse, Error, string, { previous: PendingBucket[] | undefined }>({
    mutationFn: (bucketId: string) =>
      api.post<PendingBucketActionResponse>(
        `/agent/pending-buckets/${bucketId}/graduate`,
      ),
    onMutate: async (bucketId) => {
      await qc.cancelQueries({ queryKey: PENDING_BUCKETS_QUERY_KEY });
      const previous = qc.getQueryData<PendingBucket[]>([
        ...PENDING_BUCKETS_QUERY_KEY,
        "pending",
      ]);
      // Optimistic: flip status so the row dims out / disappears from the
      // pending-only list.
      qc.setQueryData<PendingBucket[]>(
        [...PENDING_BUCKETS_QUERY_KEY, "pending"],
        (curr) =>
          curr?.map((b) =>
            b.id === bucketId ? { ...b, status: "graduating" as const } : b,
          ),
      );
      return { previous };
    },
    onError: (_err, _bucketId, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(
          [...PENDING_BUCKETS_QUERY_KEY, "pending"],
          ctx.previous,
        );
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: PENDING_BUCKETS_QUERY_KEY });
    },
  });
}

export function useKillBucket() {
  const qc = useQueryClient();
  return useMutation<PendingBucketActionResponse, Error, string, { previous: PendingBucket[] | undefined }>({
    mutationFn: (bucketId: string) =>
      api.post<PendingBucketActionResponse>(
        `/agent/pending-buckets/${bucketId}/kill`,
      ),
    onMutate: async (bucketId) => {
      await qc.cancelQueries({ queryKey: PENDING_BUCKETS_QUERY_KEY });
      const previous = qc.getQueryData<PendingBucket[]>([
        ...PENDING_BUCKETS_QUERY_KEY,
        "pending",
      ]);
      // Optimistic remove — the row goes immediately so the operator sees the
      // kill take effect even before the network round-trip.
      qc.setQueryData<PendingBucket[]>(
        [...PENDING_BUCKETS_QUERY_KEY, "pending"],
        (curr) => curr?.filter((b) => b.id !== bucketId),
      );
      return { previous };
    },
    onError: (_err, _bucketId, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(
          [...PENDING_BUCKETS_QUERY_KEY, "pending"],
          ctx.previous,
        );
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: PENDING_BUCKETS_QUERY_KEY });
    },
  });
}
