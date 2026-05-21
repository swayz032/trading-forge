/**
 * usePipelineMode — read + mutate the global Trading Forge pipeline state.
 *
 * Backend endpoints (existing — no new routes added by Command Room):
 *   GET  /api/admin/pipeline/status   → { mode: "ACTIVE" | "PAUSED" | "VACATION", subsystems, timestamp }
 *   POST /api/admin/pipeline/start    → mode = "ACTIVE"
 *   POST /api/admin/pipeline/pause    → mode = "PAUSED" (body: { reason?: string })
 *   POST /api/admin/pipeline/vacation → mode = "VACATION"
 *
 * The Command Room red button toggles between ACTIVE ↔ PAUSED. Vacation mode
 * is a separate operator decision (not exposed in the 3D scene).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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

async function postPause(reason: string): Promise<{ mode: PipelineMode }> {
  const res = await fetch("/api/admin/pipeline/pause", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(`pause failed ${res.status}`);
  return res.json();
}

async function postStart(): Promise<{ mode: PipelineMode }> {
  const res = await fetch("/api/admin/pipeline/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`start failed ${res.status}`);
  return res.json();
}

export function usePipelineMode() {
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: fetchStatus,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const pause = useMutation({
    mutationFn: (reason?: string) => postPause(reason ?? "Command Room red button"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
  });

  const start = useMutation({
    mutationFn: postStart,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
    },
  });

  // Fail-closed: until we hear ACTIVE from the backend, the UI must surface
  // "UNKNOWN" — never silently assume the bot is running.
  const mode: PipelineModeOrUnknown = status.data?.mode ?? "UNKNOWN";
  const isActive = mode === "ACTIVE";
  const isPaused = mode === "PAUSED";
  const isVacation = mode === "VACATION";
  const isUnknown = mode === "UNKNOWN";
  const isPending = pause.isPending || start.isPending;

  const toggle = () => {
    if (isPending) return;
    // Fail-closed: don't dispatch state-mutating calls while UNKNOWN —
    // operator must wait for status to resolve, otherwise we could pause a
    // bot that's already paused or resume one that's intentionally halted.
    if (isUnknown) return;
    if (isActive) {
      pause.mutate("Command Room red button");
    } else {
      start.mutate();
    }
  };

  return {
    mode,
    isActive,
    isPaused,
    isVacation,
    isUnknown,
    isLoading: status.isLoading,
    isPending,
    error: status.error ?? pause.error ?? start.error,
    toggle,
    refetch: status.refetch,
  };
}
