import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Backtest, BacktestTrade } from "@/types/api";

export function useBacktests(filters?: { strategyId?: string; status?: string; tier?: string }) {
  const params = new URLSearchParams();
  if (filters?.strategyId) params.set("strategyId", filters.strategyId);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.tier) params.set("tier", filters.tier);
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

export function useBacktestTrades(id: string | undefined) {
  return useQuery({
    queryKey: ["backtests", id, "trades"],
    queryFn: () => api.get<BacktestTrade[]>(`/backtests/${id}/trades`),
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
