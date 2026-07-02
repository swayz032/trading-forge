/**
 * usePipelineMode — READ-ONLY view of the global Trading Forge pipeline state.
 *
 * ARCHITECTURE DECISION (operator, 2026-07-02, pinned): the Slumhouse Office
 * (public/slumhouse/office.html) is the ONLY control room. This React SPA is a
 * read-only observation deck — the pause/resume mutations that used to live
 * here (POST /api/admin/pipeline/pause|start) were REMOVED in the Layer-4
 * Office P0 pass. Pipeline control is the Office "Bot Power" switch.
 *
 * Backend endpoint (read side only):
 *   GET /api/admin/pipeline/status → { mode: "ACTIVE" | "PAUSED" | "VACATION", subsystems, timestamp }
 */

import { useQuery } from "@tanstack/react-query";

export type PipelineMode = "ACTIVE" | "PAUSED" | "VACATION";

/** Sentinel returned by the hook BEFORE the first successful status fetch (or
 *  while the fetch is in-flight/erroring). Consumers must render this distinctly
 *  — typically as a dim/amber "STATUS UNKNOWN — RETRYING" pill — so the operator
 *  cannot mistake "we don't know" for "we're running". Fail-closed per
 *  CLAUDE.md §2/§13: never default the live trading status to ACTIVE while
 *  ground-truth is unknown.
 */
export type PipelineModeOrUnknown = PipelineMode | "UNKNOWN";

export interface PipelineStatus {
  mode: PipelineMode;
  subsystems: {
    scheduler: "running" | "paused";
    lifecycle: "running" | "paused";
    paper_trading: "active" | "paused" | "stopped";
  };
  timestamp: string;
}

const STATUS_QUERY_KEY = ["pipeline-mode"] as const;

async function fetchStatus(): Promise<PipelineStatus> {
  const res = await fetch("/api/admin/pipeline/status");
  if (!res.ok) {
    throw new Error(`pipeline status ${res.status}`);
  }
  return res.json();
}

export function usePipelineMode() {
  const status = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: fetchStatus,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  // Fail-closed: until we hear ACTIVE from the backend, the UI must surface
  // "UNKNOWN" — never silently assume the bot is running.
  const mode: PipelineModeOrUnknown = status.data?.mode ?? "UNKNOWN";

  return {
    mode,
    isActive: mode === "ACTIVE",
    isPaused: mode === "PAUSED",
    isVacation: mode === "VACATION",
    isUnknown: mode === "UNKNOWN",
    isLoading: status.isLoading,
    error: status.error,
    refetch: status.refetch,
  };
}
