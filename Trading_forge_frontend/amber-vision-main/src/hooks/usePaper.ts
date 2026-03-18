import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { PaperSession, PaperPosition, PaperTrade } from "@/types/api";

export function usePaperSessions() {
  return useQuery({
    queryKey: ["paper", "sessions"],
    queryFn: () => api.get<PaperSession[]>("/paper/sessions"),
  });
}

export function usePaperSession(id: string | undefined) {
  return useQuery({
    queryKey: ["paper", "sessions", id],
    queryFn: () => api.get<PaperSession>(`/paper/sessions/${id}`),
    enabled: !!id,
  });
}

export function usePaperPositions() {
  return useQuery({
    queryKey: ["paper", "positions"],
    queryFn: () => api.get<PaperPosition[]>("/paper/positions"),
  });
}

export function usePaperTrades() {
  return useQuery({
    queryKey: ["paper", "trades"],
    queryFn: () => api.get<PaperTrade[]>("/paper/trades"),
  });
}

export function useStartPaperSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { strategyId?: string; startingCapital?: string; config?: any }) =>
      api.post<PaperSession>("/paper/start", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["paper"] }),
  });
}

export function useStopPaperSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.post<PaperSession>("/paper/stop", { sessionId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["paper"] }),
  });
}

// ── New hooks for paper trading autopilot ───────────────────

export interface StreamStatus {
  [sessionId: string]: { symbols: string[]; connected: boolean };
}

export interface SignalLogEntry {
  id: string;
  sessionId: string;
  symbol: string;
  signalType: string;
  action: string;
  reason: string | null;
  price: string | null;
  indicatorValues: any;
  createdAt: string;
}

export interface SignalStats {
  total: number;
  taken: number;
  skipped: number;
  rejected: number;
}

export function usePaperStreams() {
  return useQuery({
    queryKey: ["paper", "streams"],
    queryFn: () => api.get<StreamStatus>("/paper/streams"),
    refetchInterval: 5000, // poll every 5s for connection status
  });
}

export function usePaperSignals(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["paper", "signals", sessionId],
    queryFn: () => api.get<SignalLogEntry[]>(`/paper/signals/${sessionId}?limit=50`),
    enabled: !!sessionId,
    refetchInterval: 10000,
  });
}

export function usePaperSignalStats(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["paper", "signals", sessionId, "stats"],
    queryFn: () => api.get<SignalStats>(`/paper/signals/${sessionId}/stats`),
    enabled: !!sessionId,
  });
}

export interface BarData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function usePaperBars(symbol: string | undefined) {
  return useQuery({
    queryKey: ["paper", "bars", symbol],
    queryFn: () => api.get<BarData[]>(`/paper/bars/${symbol}`),
    enabled: !!symbol,
    refetchInterval: 5000, // refresh bars every 5s for live chart
  });
}

export function useStopAllStreams() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/paper/streams/stop-all", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["paper"] }),
  });
}
