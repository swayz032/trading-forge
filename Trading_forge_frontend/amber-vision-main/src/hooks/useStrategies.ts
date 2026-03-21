import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Strategy, StrategyPipeline } from "@/types/api";

export function useStrategies(filters?: {
  symbol?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.symbol) params.set("symbol", filters.symbol);
  if (filters?.limit != null) params.set("limit", String(filters.limit));
  if (filters?.offset != null) params.set("offset", String(filters.offset));
  const qs = params.toString();
  return useQuery({
    queryKey: ["strategies", filters],
    queryFn: async () => {
      const res = await api.get<{ data: Strategy[]; total: number } | Strategy[]>(
        `/strategies${qs ? `?${qs}` : ""}`
      );
      // Backend returns { data, total } when limit is provided, array otherwise
      if (Array.isArray(res)) return res;
      return res.data;
    },
  });
}

export function useStrategy(id: string | undefined) {
  return useQuery({
    queryKey: ["strategies", id],
    queryFn: () => api.get<Strategy>(`/strategies/${id}`),
    enabled: !!id,
  });
}

export function useStrategyPipeline() {
  return useQuery({
    queryKey: ["strategies", "pipeline"],
    queryFn: () => api.get<StrategyPipeline>("/strategies/pipeline"),
  });
}

export function useCreateStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Strategy>) => api.post<Strategy>("/strategies", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
  });
}

export function useUpdateStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Strategy> & { id: string }) =>
      api.patch<Strategy>(`/strategies/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
  });
}
