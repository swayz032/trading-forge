import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type {
  JournalEntry,
  JournalStats,
  ScoutFunnelResponse,
  ScoutFunnel,
  TradeJournalEntry,
  TradeJournalStats,
} from "@/types/api";

export interface JournalFilters {
  status?: string;
  tier?: string;
  source?: string;
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
}

export function useJournal(filters?: JournalFilters) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.tier) params.set("tier", filters.tier);
  if (filters?.source) params.set("source", filters.source);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset != null) params.set("offset", String(filters.offset));
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  const qs = params.toString();
  return useQuery({
    queryKey: ["journal", filters],
    queryFn: async () => {
      const res = await api.get<{ data: JournalEntry[]; total: number } | JournalEntry[]>(
        `/journal${qs ? `?${qs}` : ""}`
      );
      // Backend now returns { data, total } — unwrap to array for backward compat
      if (Array.isArray(res)) return res;
      return res.data;
    },
  });
}

export function useJournalPaginated(filters?: JournalFilters) {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.tier) params.set("tier", filters.tier);
  if (filters?.source) params.set("source", filters.source);
  if (filters?.limit) params.set("limit", String(filters.limit));
  if (filters?.offset != null) params.set("offset", String(filters.offset));
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  const qs = params.toString();
  return useQuery({
    queryKey: ["journal", "paginated", filters],
    queryFn: async () => {
      const res = await api.get<{ data: JournalEntry[]; total: number } | JournalEntry[]>(
        `/journal${qs ? `?${qs}` : ""}`
      );
      if (Array.isArray(res)) return { data: res, total: res.length };
      return res;
    },
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

// ─── Trade Journal hooks — Wave 26 Pass 2 ──────────────────────────────────
// These hit /api/trade-journal (paper_positions + trade_critique) — distinct
// from the system_journal research log at /api/journal.

export interface TradeJournalFilters {
  outcome?: "win" | "loss" | "scratch" | "all";
  regime?: string;
  strategyId?: string;
  accountId?: string;
  gradeMin?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

/**
 * useTradeJournal — paginated list of closed positions + GPT-5.4 autopsy.
 * Returns { data: TradeJournalEntry[], total: number } or undefined while loading.
 */
export function useTradeJournal(filters?: TradeJournalFilters) {
  const params = new URLSearchParams();
  if (filters?.outcome && filters.outcome !== "all") params.set("outcome", filters.outcome);
  if (filters?.regime && filters.regime !== "all") params.set("regime", filters.regime);
  if (filters?.strategyId) params.set("strategyId", filters.strategyId);
  if (filters?.accountId) params.set("accountId", filters.accountId);
  if (filters?.gradeMin && filters.gradeMin !== "any") params.set("gradeMin", filters.gradeMin);
  if (filters?.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters?.dateTo) params.set("dateTo", filters.dateTo);
  if (filters?.limit != null) params.set("limit", String(filters.limit));
  if (filters?.offset != null) params.set("offset", String(filters.offset));
  const qs = params.toString();

  return useQuery({
    queryKey: ["trade-journal", filters],
    queryFn: () =>
      api.get<{ data: TradeJournalEntry[]; total: number }>(
        `/trade-journal${qs ? `?${qs}` : ""}`
      ),
  });
}

/**
 * useTradeJournalStats — KPI aggregation for Trade Journal header cards.
 */
export function useTradeJournalStats() {
  return useQuery({
    queryKey: ["trade-journal", "stats"],
    queryFn: () => api.get<TradeJournalStats>("/trade-journal/stats"),
    staleTime: 60_000,  // 1-minute cache — stats are not real-time sensitive
  });
}
