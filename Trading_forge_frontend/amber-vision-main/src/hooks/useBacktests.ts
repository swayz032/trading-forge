import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Backtest, BacktestTrade } from "@/types/api";

export function useBacktests(filters?: {
  strategyId?: string;
  status?: string;
  tier?: string;
  symbol?: string;
  timeframe?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.strategyId) params.set("strategyId", filters.strategyId);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.tier) params.set("tier", filters.tier);
  if (filters?.symbol) params.set("symbol", filters.symbol);
  if (filters?.timeframe) params.set("timeframe", filters.timeframe);
  if (filters?.limit != null) params.set("limit", String(filters.limit));
  if (filters?.offset != null) params.set("offset", String(filters.offset));
  const qs = params.toString();
  return useQuery({
    queryKey: ["backtests", filters],
    queryFn: () => api.get<Backtest[]>(`/backtests${qs ? `?${qs}` : ""}`),
  });
}

export function useBacktest(id: string | undefined) {
  return useQuery({
    queryKey: ["backtests", id],
    queryFn: () => api.get<Backtest>(`/backtests/${id}`),
    enabled: !!id,
  });
}

export function useBacktestEquity(id: string | undefined) {
  return useQuery({
    queryKey: ["backtests", id, "equity"],
    queryFn: () => api.get<{ equityCurve: any }>(`/backtests/${id}/equity`),
    enabled: !!id,
  });
}

export function useBacktestTrades(id: string | undefined, pagination?: { limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (pagination?.limit != null) params.set("limit", String(pagination.limit));
  if (pagination?.offset != null) params.set("offset", String(pagination.offset));
  const qs = params.toString();
  return useQuery({
    queryKey: ["backtests", id, "trades", pagination],
    queryFn: () => api.get<BacktestTrade[]>(`/backtests/${id}/trades${qs ? `?${qs}` : ""}`),
    enabled: !!id,
  });
}

export function useRunBacktest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { strategyId: string; startDate?: string; endDate?: string }) =>
      api.post<Backtest>("/backtests", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backtests"] }),
  });
}
