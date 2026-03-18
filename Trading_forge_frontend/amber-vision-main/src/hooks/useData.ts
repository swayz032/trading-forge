import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { MarketDataMeta, HealthResponse, OhlcvBar } from "@/types/api";

export function useSymbols() {
  return useQuery({
    queryKey: ["data", "symbols"],
    queryFn: async () => {
      const res = await api.get<{ symbols: MarketDataMeta[] } | MarketDataMeta[]>("/data/symbols");
      return Array.isArray(res) ? res : res.symbols ?? [];
    },
  });
}

export function useOhlcv(symbol: string | undefined, timeframe?: string, start?: string, end?: string) {
  const params = new URLSearchParams();
  if (timeframe) params.set("timeframe", timeframe);
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  return useQuery({
    queryKey: ["data", symbol, "ohlcv", { timeframe, start, end }],
    queryFn: async () => {
      const res = await api.get<{ bars: OhlcvBar[] } | OhlcvBar[]>(`/data/${symbol}/ohlcv${qs ? `?${qs}` : ""}`);
      return Array.isArray(res) ? res : res.bars ?? [];
    },
    enabled: !!symbol,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<HealthResponse>("/health"),
    staleTime: 60_000,
  });
}

export function useSyncData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { symbol: string; source?: string; startDate?: string; endDate?: string }) =>
      api.post("/data/fetch", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["data"] }),
  });
}
