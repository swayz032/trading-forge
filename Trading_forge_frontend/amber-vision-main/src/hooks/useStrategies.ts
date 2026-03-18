import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Strategy, StrategyPipeline } from "@/types/api";

export function useStrategies() {
  return useQuery({
    queryKey: ["strategies"],
    queryFn: () => api.get<Strategy[]>("/strategies"),
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
