import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Alert } from "@/types/api";

export function useAlerts(filters?: { type?: string; severity?: string; read?: boolean }) {
  const params = new URLSearchParams();
  if (filters?.type) params.set("type", filters.type);
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.read !== undefined) params.set("read", String(filters.read));
  const qs = params.toString();
  return useQuery({
    queryKey: ["alerts", filters],
    queryFn: () => api.get<Alert[]>(`/alerts${qs ? `?${qs}` : ""}`),
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ["alerts", "unread"],
    queryFn: () => api.get<{ count: number }>("/alerts/unread"),
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { type: string; severity?: string; title: string; message: string; metadata?: any }) =>
      api.post<Alert>("/alerts", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export function useDeleteAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/alerts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}
