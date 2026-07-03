import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

export interface StarvationStrategyStatus {
  id: string;
  name: string;
  lifecycleState: string;
  entryCount: number;
  signalEvalCount: number;
  alarmLevel: "NONE" | "WARN" | "CRITICAL";
  lastWarnAt: string | null;
  lastCriticalAt: string | null;
}

export interface DeployedStrategyStarvationStatus {
  checkedAt: string;
  deployedStrategyCount: number;
  strategies: StarvationStrategyStatus[];
}

const STARVATION_SSE_EVENTS = [
  "alert:signal_starvation_warn",
  "alert:signal_starvation_critical",
] as const;

function useStarvationSseInvalidator(): void {
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
      queryClient.invalidateQueries({ queryKey: ["deployed-strategy-starvation"] });
    };

    for (const event of STARVATION_SSE_EVENTS) {
      es.addEventListener(event, handler);
    }

    es.addEventListener("error", () => {
      // Silent — 30s poll covers us
    });

    return () => {
      if (!es) return;
      for (const event of STARVATION_SSE_EVENTS) {
        es.removeEventListener(event, handler);
      }
      es.close();
    };
  }, [queryClient]);
}

export function useDeployedStrategyStarvation() {
  useStarvationSseInvalidator();
  return useQuery<DeployedStrategyStarvationStatus>({
    queryKey: ["deployed-strategy-starvation"],
    queryFn: () =>
      api.get<DeployedStrategyStarvationStatus>("/deployed-strategy-starvation/status"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
