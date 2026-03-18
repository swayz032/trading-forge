import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { MonteCarloRun } from "@/types/api";

export function useMonteCarlo(filters?: { backtestId?: string }) {
  const params = new URLSearchParams();
  if (filters?.backtestId) params.set("backtestId", filters.backtestId);
  const qs = params.toString();
  return useQuery({
    queryKey: ["monte-carlo", filters],
    queryFn: () => api.get<MonteCarloRun[]>(`/monte-carlo${qs ? `?${qs}` : ""}`),
  });
}

export function useMonteCarloRun(id: string | undefined) {
  return useQuery({
    queryKey: ["monte-carlo", id],
    queryFn: () => api.get<MonteCarloRun>(`/monte-carlo/${id}`),
    enabled: !!id,
  });
}

export function useMCPaths(id: string | undefined) {
  return useQuery({
    queryKey: ["monte-carlo", id, "paths"],
    queryFn: async () => {
      const run = await api.get<MonteCarloRun>(`/monte-carlo/${id}`);
      return run.paths;
    },
    enabled: !!id,
  });
}

export function useMCRisk(id: string | undefined) {
  return useQuery({
    queryKey: ["monte-carlo", id, "risk"],
    queryFn: async () => {
      const run = await api.get<MonteCarloRun>(`/monte-carlo/${id}`);
      return run.riskMetrics;
    },
    enabled: !!id,
  });
}

export function useRunMC() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { backtestId: string; numSimulations?: number }) =>
      api.post<MonteCarloRun>("/monte-carlo", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["monte-carlo"] }),
  });
}
