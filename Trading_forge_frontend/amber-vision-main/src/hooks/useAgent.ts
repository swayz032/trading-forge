import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { AgentJob } from "@/types/api";

interface PaginatedResponse<T> {
  data: T[];
  total: number;
}

interface AgentJobsParams {
  limit?: number;
  offset?: number;
  type?: string;
  status?: string;
}

export function useAgentJobs(params: AgentJobsParams = {}) {
  const { limit = 20, offset = 0, type, status } = params;
  return useQuery({
    queryKey: ["agent", "jobs", limit, offset, type, status],
    queryFn: () => {
      const searchParams = new URLSearchParams();
      searchParams.set("limit", String(limit));
      searchParams.set("offset", String(offset));
      if (type) searchParams.set("type", type);
      if (status) searchParams.set("status", status);
      return api.get<PaginatedResponse<AgentJob>>(`/agent/jobs?${searchParams.toString()}`);
    },
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
