import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { JournalEntry, JournalStats, ScoutFunnelResponse, ScoutFunnel } from "@/types/api";

export function useJournal(filters?: { status?: string; tier?: string; source?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.tier) params.set("tier", filters.tier);
  if (filters?.source) params.set("source", filters.source);
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ["journal", filters],
    queryFn: () => api.get<JournalEntry[]>(`/journal${qs ? `?${qs}` : ""}`),
  });
}

export function useJournalStats() {
  return useQuery({
    queryKey: ["journal", "stats"],
    queryFn: () => api.get<JournalStats>("/journal/stats/summary"),
  });
}

export function useScoutFunnel() {
  return useQuery<ScoutFunnel>({
    queryKey: ["journal", "scout-funnel"],
    queryFn: async () => {
      const raw = await api.get<ScoutFunnelResponse>("/journal/scout-funnel");
      const t = raw.totals ?? {};
      return {
        scouted: t.scouted ?? 0,
        tested: t.tested ?? t.backtesting ?? 0,
        passed: t.passed ?? t.validated ?? t.promoted ?? 0,
        deployed: t.deployed ?? t.paper ?? t.live ?? 0,
      };
    },
  });
}

export function useScoutFingerprints() {
  return useQuery({
    queryKey: ["journal", "scout-fingerprints"],
    queryFn: async () => {
      const res = await api.get<{ fingerprints: any[] } | any[]>("/journal/scout-fingerprints");
      return Array.isArray(res) ? res : res.fingerprints ?? [];
    },
  });
}
