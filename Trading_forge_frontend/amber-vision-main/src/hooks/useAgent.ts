import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { AgentJob } from "@/types/api";

export function useAgentJobs() {
  return useQuery({
    queryKey: ["agent", "jobs"],
    queryFn: () => api.get<AgentJob[]>("/agent/jobs"),
  });
}

export function useAgentJob(id: string | undefined) {
  return useQuery({
    queryKey: ["agent", "jobs", id],
    queryFn: () => api.get<AgentJob>(`/agent/jobs/${id}`),
    enabled: !!id,
  });
}

export function useFindStrategies() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data?: Record<string, any>) => api.post("/agent/find-strategies", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent"] }),
  });
}
