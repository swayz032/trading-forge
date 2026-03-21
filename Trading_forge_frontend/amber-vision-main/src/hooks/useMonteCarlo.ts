import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { MonteCarloRun } from "@/types/api";

export function useMonteCarlo(filters?: { backtestId?: string }) {
  const params = new URLSearchParams();
  if (filters?.backtestId) params.set("backtestId", filters.backtestId);
  const qs = params.toString();
  return useQuery({
    queryKey: ["monte-carlo", filters],
    queryFn: async () => {
      const res = await api.get<{ data: MonteCarloRun[]; total: number } | MonteCarloRun[]>(
        `/monte-carlo${qs ? `?${qs}` : ""}`
      );
      if (Array.isArray(res)) return res;
      return res.data;
    },
    enabled: !!filters?.backtestId,
  });
}

export function useMonteCarloRun(id: string | undefined) {
  return useQuery({
    queryKey: ["monte-carlo", id],
    queryFn: () => api.get<MonteCarloRun>(`/monte-carlo/${id}`),
    enabled: !!id,
  });
}

/** Fetch recent MC runs across all backtests (for the overview panel) */
export function useRecentMonteCarlo(limit = 10) {
  return useQuery({
    queryKey: ["monte-carlo", "recent", limit],
    queryFn: async () => {
      const res = await api.get<{ data: any[]; total: number } | any[]>(
        `/monte-carlo/recent?limit=${limit}`
      );
      if (Array.isArray(res)) return res;
      return res.data;
    },
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
