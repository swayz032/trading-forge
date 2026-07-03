import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

// ─── Types (mirror broker-error-budget-service.ts) ───────────────────────────

export interface RejectionClassStats {
  count: number;
  pct: number; // 0–1 fraction of totalAttempts
}

export interface BrokerBudgetEntry {
  totalAttempts: number;
  totalRejections: number;
  byRejectionClass: Record<string, RejectionClassStats>;
  alarmed: boolean;
}

export interface BrokerErrorBudgetResult {
  byBroker: Record<string, BrokerBudgetEntry>;
  computedAt: string; // ISO-8601
  windowHours: number;
}

// ─── SSE invalidator ─────────────────────────────────────────────────────────

function useBrokerErrorBudgetSseInvalidator(): void {
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
      queryClient.invalidateQueries({ queryKey: ["broker-error-budget"] });
    };

    es.addEventListener("alert:broker_error_budget", handler);
    es.addEventListener("error", () => {
      // Silent — React Query 60s poll is the safety net.
    });

    return () => {
      if (!es) return;
      es.removeEventListener("alert:broker_error_budget", handler);
      es.close();
    };
  }, [queryClient]);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBrokerErrorBudget(windowHours = 24) {
  useBrokerErrorBudgetSseInvalidator();
  return useQuery<BrokerErrorBudgetResult>({
    queryKey: ["broker-error-budget", windowHours],
    queryFn: () =>
      api.get<BrokerErrorBudgetResult>(
        `/broker-error-budget?windowHours=${windowHours}`,
      ),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
