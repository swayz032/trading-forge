import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface ScoutHealthAlert {
  action: string;
  createdAt: string;
  result: unknown;
}

export interface ScoutHealth {
  lastStrategyCreatedAt: string | null;
  strategiesProducedToday: number;
  scoutsBySourceLast7d: Record<string, number>;
  synthesizerHealth: {
    gpt5mini_calls_today: number;
    ollama_fallback_calls_today: number;
    rejected_compile_today: number;
    rejected_critic_today: number;
  };
  auditorRejectsLast24h: number;
  pipelineMode: "ACTIVE" | "PAUSED" | "VACATION";
  /** Pass 10 — last 24h of scout-health audit alerts (drain-stall, reject-skew, etc.). */
  recentAlerts?: ScoutHealthAlert[];
}

/**
 * Pass 10 — Real-time SSE wiring.
 *
 * Subscribes to `scout-health:*` and `windows:real-reboot-pending` events on
 * the existing /api/sse/events stream. Every matching event invalidates the
 * React Query cache so the tile re-fetches immediately rather than waiting
 * for its 30s staleTime to expire. Falls back gracefully when the browser
 * does not support EventSource or the connection drops — the 30s poll is
 * the safety net.
 */
const SCOUT_HEALTH_EVENTS = [
  "scout-health:drain-stall",
  "scout-health:reject-skew",
  "scout-health:reject-spike",
  "scout-health:no-strategies-today",
  "windows:real-reboot-pending",
] as const;

function useScoutHealthSseInvalidator(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;

    const baseUrl =
      (typeof window !== "undefined" && (window as any).__API_BASE__) ||
      (import.meta as any)?.env?.VITE_API_BASE_URL ||
      "";
    const url = `${baseUrl}/api/sse/events`;

    let es: EventSource | null = null;
    try {
      es = new EventSource(url, { withCredentials: true });
    } catch {
      return;
    }

    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ["scout-health"] });
    };

    for (const event of SCOUT_HEALTH_EVENTS) {
      es.addEventListener(event, handler);
    }

    es.addEventListener("error", () => {
      // Silent — the React Query 30s poll will keep the tile fresh.
    });

    return () => {
      if (!es) return;
      for (const event of SCOUT_HEALTH_EVENTS) {
        es.removeEventListener(event, handler);
      }
      es.close();
    };
  }, [queryClient]);
}

export function useScoutHealth() {
  useScoutHealthSseInvalidator();
  return useQuery<ScoutHealth>({
    queryKey: ["scout-health"],
    queryFn: () => api.get<ScoutHealth>("/scout/health"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
