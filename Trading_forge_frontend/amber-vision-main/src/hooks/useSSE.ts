import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { sseClient } from "@/lib/sse-client";
import type { SSEEvent, SSEEventType, SSEEventData } from "@/types/sse-events";

/**
 * Typed handler the consumer can supply. Receives the discriminated union so
 * components can `switch` on `type` and get the right data shape for free.
 */
export type SSEHandler = (event: SSEEvent) => void;

/**
 * Per-event-type side effects (cache invalidations + UX). Keeping this as a
 * lookup table makes it obvious which events are wired and which aren't.
 *
 * NOTE: backend SSE event names live in `src/server/` (search for
 * `broadcastSSE("...")`). When you add a new one there, mirror it here AND in
 * `@/types/sse-events`.
 *
 * Connection model: this hook subscribes to the shared `sseClient` singleton
 * (`@/lib/sse-client`). Every `useSSE` mount used to open its own EventSource;
 * with ~6 routes mounting the hook plus banner components doing their own
 * connections, a tab could exceed the browser's per-domain connection cap.
 * The singleton multiplexes a single EventSource across all subscribers and
 * owns the reconnect/backoff logic so this hook can stay declarative.
 */
function dispatchSideEffects(event: SSEEvent, qc: QueryClient): void {
  switch (event.type) {
    // ─── Already-handled events (kept verbatim for parity) ─────────────
    case "alert:new":
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "backtest:complete":
    case "backtest:completed":
      qc.invalidateQueries({ queryKey: ["backtests"] });
      break;

    case "paper:trade":
    case "paper:pnl":
      qc.invalidateQueries({ queryKey: ["paper"] });
      break;

    case "paper:signal":
      qc.invalidateQueries({ queryKey: ["paper", "signals"] });
      break;

    case "strategy:promoted":
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["strategies"] });
      break;

    case "mc:completed":
      qc.invalidateQueries({ queryKey: ["monte-carlo"] });
      qc.invalidateQueries({ queryKey: ["backtests"] });
      break;

    case "pipeline:mode-change":
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      break;

    case "pipeline:pause_snapshot":
    case "pipeline:resume_stale_positions":
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "deepar:forecast_ready":
      qc.invalidateQueries({ queryKey: ["deepar"] });
      break;

    case "critic:replay_started":
    case "critic:replay_complete":
      qc.invalidateQueries({ queryKey: ["critic"] });
      qc.invalidateQueries({ queryKey: ["backtests"] });
      break;

    case "strategy:analyzed":
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["backtests"] });
      qc.invalidateQueries({ queryKey: ["journal"] });
      break;

    case "strategy:analysis-error":
      qc.invalidateQueries({ queryKey: ["strategies"] });
      break;

    case "nightly:review-complete":
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["journal"] });
      break;

    case "scheduler:sharpe-updated":
      qc.invalidateQueries({ queryKey: ["strategies"] });
      break;

    case "scheduler:pre-market-alert":
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "strategy:drift-alert":
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["strategies"] });
      break;

    case "paper:kill-switch-tripped":
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["paper", "sessions"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "alert:kill_switch_down":
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "alert:compliance_gate_blocked":
      qc.invalidateQueries({ queryKey: ["paper", "compliance"] });
      qc.invalidateQueries({ queryKey: ["compliance"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "backtest:failed":
      qc.invalidateQueries({ queryKey: ["backtests"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "mc:failed":
      qc.invalidateQueries({ queryKey: ["monte-carlo"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "paper:auto_stopped":
    case "paper:auto_recovered":
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["paper", "sessions"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    // ─── NEW: priority events (lifecycle / decay / critic / system) ────

    // Lifecycle promotion is the umbrella event that fires on every state
    // transition (CANDIDATE→TESTING, TESTING→PAPER, PAPER→DEPLOY_READY, …).
    // The strategies and paper panels both depend on freshness here.
    case "lifecycle:promoted": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["paper"] });
      const data = event.data as SSEEventData<"lifecycle:promoted">;
      const label = data.name ? `"${data.name}"` : "Strategy";
      toast.info(`${label} ${data.from} → ${data.to}`);
      break;
    }

    // Human-in-the-loop gate: surface as a sticky-feeling toast so the user
    // notices even if they're not on the strategies page.
    case "strategy:deploy-ready": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      const data = event.data as SSEEventData<"strategy:deploy-ready">;
      toast.success(
        data.message ?? `${data.name} ready to deploy — review in library`,
        { duration: 10_000 }
      );
      break;
    }

    case "strategy:decay-warning": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["paper"] });
      const data = event.data as SSEEventData<"strategy:decay-warning">;
      const label = data.name ? `"${data.name}"` : "Strategy";
      toast.warning(
        data.message ?? `${label} decay warning (score ${data.decayScore})`
      );
      break;
    }

    case "strategy:decay-demotion": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["paper"] });
      const data = event.data as SSEEventData<"strategy:decay-demotion">;
      const label = data.name ? `"${data.name}"` : "Strategy";
      toast.error(
        data.message ?? `${label} demoted ${data.fromState} → ${data.toState}`,
        { duration: 8_000 }
      );
      break;
    }

    case "strategy:exportability_blocked": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      const data = event.data as SSEEventData<"strategy:exportability_blocked">;
      const label = data.name ? `"${data.name}"` : "Strategy";
      toast.warning(
        `${label} blocked at Pine export gate (score ${data.score ?? "?"}, band ${data.band ?? "?"})`
      );
      break;
    }

    case "strategy:evolved": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["critic"] });
      const data = event.data as SSEEventData<"strategy:evolved">;
      toast.info(
        `Critic evolved strategy → gen ${data.generation}` +
          (typeof data.improvement === "number" ? ` (+${data.improvement}%)` : "")
      );
      break;
    }

    case "strategy:deployed": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["paper"] });
      const data = event.data as SSEEventData<"strategy:deployed">;
      toast.success(`Deployed: ${data.name ?? data.strategyId}`);
      break;
    }

    case "strategy:created":
      qc.invalidateQueries({ queryKey: ["strategies"] });
      break;

    case "strategy:drift-demotion": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["paper"] });
      const data = event.data as SSEEventData<"strategy:drift-demotion">;
      toast.error(`Strategy demoted (drift ${data.driftSeverity.toFixed?.(2) ?? data.driftSeverity}σ)`);
      break;
    }

    case "strategy:paper-vs-backtest-alert":
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    // ─── Critic loop ──────────────────────────────────────────────────

    case "critic:started":
    case "critic:started_async":
    case "critic:evidence_collected":
    case "critic:evidence_collected_async":
    case "critic:evidence_source":
    case "critic:evaluation_complete":
      qc.invalidateQueries({ queryKey: ["critic"] });
      break;

    case "critic:candidates_ready": {
      qc.invalidateQueries({ queryKey: ["critic"] });
      const data = event.data as SSEEventData<"critic:candidates_ready">;
      toast.info(`Critic produced ${data.count} candidate${data.count === 1 ? "" : "s"}`);
      break;
    }

    case "critic:completed": {
      qc.invalidateQueries({ queryKey: ["critic"] });
      qc.invalidateQueries({ queryKey: ["backtests"] });
      const data = event.data as SSEEventData<"critic:completed">;
      if (data.status === "failed") {
        toast.error(`Critic run failed${data.error ? `: ${data.error}` : ""}`);
      } else if (data.killSignal) {
        toast.warning(`Critic killed run: ${data.killSignal}`);
      } else if (data.survivor) {
        toast.success(`Critic selected survivor ${String(data.survivor).slice(0, 8)}`);
      }
      break;
    }

    case "critic:child_created": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["critic"] });
      const data = event.data as SSEEventData<"critic:child_created">;
      // Idempotent re-emits aren't user-actionable — skip the toast.
      if (!data.idempotent) {
        toast.success(`Child strategy created (gen ${data.generation})`);
      }
      break;
    }

    // ─── Backtest matrix progress ─────────────────────────────────────

    case "backtest:matrix-progress":
    case "backtest:matrix-tier":
      qc.invalidateQueries({ queryKey: ["backtests", "matrix"] });
      break;

    case "backtest:matrix-completed": {
      qc.invalidateQueries({ queryKey: ["backtests"] });
      qc.invalidateQueries({ queryKey: ["backtests", "matrix"] });
      const data = event.data as SSEEventData<"backtest:matrix-completed">;
      toast.success(
        `Matrix complete (${data.totalCombos} combos)` +
          (data.bestCombo
            ? ` — best ${data.bestCombo.symbol ?? "?"} ${data.bestCombo.timeframe ?? ""} score ${data.bestCombo.forgeScore ?? "?"}`
            : "")
      );
      break;
    }

    case "backtest:matrix-failed": {
      qc.invalidateQueries({ queryKey: ["backtests"] });
      qc.invalidateQueries({ queryKey: ["backtests", "matrix"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const data = event.data as SSEEventData<"backtest:matrix-failed">;
      toast.error(`Matrix backtest failed${data.error ? `: ${data.error}` : ""}`);
      break;
    }

    // ─── Paper trading (additional surface area) ──────────────────────

    case "paper:position-opened":
    case "paper:fill-miss":
    case "paper:roll-flatten":
    case "paper:roll-warning":
    case "paper:consistency-warning":
    case "paper:decay-alert":
    case "paper:decay-warning":
    case "paper:session-feedback-computed":
    case "paper:session_start":
    case "paper:session_stop":
      qc.invalidateQueries({ queryKey: ["paper"] });
      break;

    // ─── Pipeline ─────────────────────────────────────────────────────

    case "pipeline:drain-resume":
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["paper"] });
      break;

    // ─── Alerts / compliance / guards ─────────────────────────────────

    case "alert:triggered":
    case "alert:compliance_guard_down":
    case "alert:calendar_guard_down":
    case "alert:ict_bridge_down":
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "compliance:cascade_revalidation": {
      qc.invalidateQueries({ queryKey: ["compliance"] });
      qc.invalidateQueries({ queryKey: ["paper", "compliance"] });
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const data = event.data as SSEEventData<"compliance:cascade_revalidation">;
      toast.error(data.message, { duration: 12_000 });
      break;
    }

    // ─── Scheduler / lifecycle housekeeping ───────────────────────────

    case "scheduler:job-complete":
    case "scheduler:decay-sweep-complete":
    case "scheduler:regret-score-fill":
    case "lifecycle:auto-check":
      // Housekeeping events — touch broad caches only when likely to change UX.
      qc.invalidateQueries({ queryKey: ["strategies"] });
      break;

    // ─── DeepAR ───────────────────────────────────────────────────────

    case "deepar:training_complete":
      qc.invalidateQueries({ queryKey: ["deepar"] });
      break;

    case "deepar:weight_changed": {
      qc.invalidateQueries({ queryKey: ["deepar"] });
      const data = event.data as SSEEventData<"deepar:weight_changed">;
      toast.info(
        `DeepAR weight ${data.previousWeight.toFixed(2)} → ${data.currentWeight.toFixed(2)}`
      );
      break;
    }

    // ─── Anti-setup / regime / archetype ──────────────────────────────

    case "anti-setup:mined":
    case "anti-setup:blocked":
    case "anti-setup:effectiveness":
      qc.invalidateQueries({ queryKey: ["anti-setup"] });
      break;

    case "archetype:predicted":
      qc.invalidateQueries({ queryKey: ["archetype"] });
      break;

    case "regime:state_updated":
      qc.invalidateQueries({ queryKey: ["regime"] });
      break;

    case "correlation:alert":
    case "portfolio:correlation_snapshot":
      qc.invalidateQueries({ queryKey: ["portfolio", "correlation"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "drift:alert":
      qc.invalidateQueries({ queryKey: ["drift"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    // ─── Pine export ──────────────────────────────────────────────────
    // (legacy `pine:export_completed` underscore event removed — server
    //  emits `pine:export-completed` hyphen, handled below)

    // ─── n8n / agents ─────────────────────────────────────────────────

    case "n8n:health-alert": {
      qc.invalidateQueries({ queryKey: ["n8n"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const data = event.data as SSEEventData<"n8n:health-alert">;
      const failingCount = data.failing?.length ?? 0;
      toast.warning(
        `n8n: ${failingCount} workflow${failingCount === 1 ? "" : "s"} with recent failures`
      );
      break;
    }

    case "n8n:workflow-failed": {
      qc.invalidateQueries({ queryKey: ["n8n"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const data = event.data as SSEEventData<"n8n:workflow-failed">;
      toast.error(`n8n workflow failed${data.workflowName ? `: ${data.workflowName}` : ""}`);
      break;
    }

    case "agent:health_sweep":
      qc.invalidateQueries({ queryKey: ["agents"] });
      break;

    case "prompt-ab-test:resolved":
    case "prompt-evolution:complete":
    case "meta:parameter_review":
      qc.invalidateQueries({ queryKey: ["agents"] });
      break;

    // ─── Metrics ──────────────────────────────────────────────────────

    case "metrics:snapshot":
      qc.invalidateQueries({ queryKey: ["metrics"] });
      break;

    case "metrics:trade-close":
      qc.invalidateQueries({ queryKey: ["metrics"] });
      qc.invalidateQueries({ queryKey: ["paper"] });
      break;

    // ─── Paper roll-spread (cost surfaced separately from slippage) ──
    case "paper:roll-spread-applied": {
      qc.invalidateQueries({ queryKey: ["paper", "trades"] });
      qc.invalidateQueries({ queryKey: ["paper"] });
      const data = event.data as SSEEventData<"paper:roll-spread-applied">;
      toast.info(
        `Roll cost applied: ${data.symbol} (${data.contracts}x) — $${data.costUsd.toFixed(2)}`
      );
      break;
    }

    // ─── n8n tournament freshness watchdog ───────────────────────────
    case "n8n:tournament-stale": {
      qc.invalidateQueries({ queryKey: ["n8n"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const data = event.data as SSEEventData<"n8n:tournament-stale">;
      const age = data.ageHours == null ? "never" : `${data.ageHours.toFixed(1)}h old`;
      toast.warning(`n8n tournament results stale (${age}) — workflow may be down`);
      break;
    }

    // ─── Evolution loop aborted at child-promotion gate ──────────────
    case "evolution:abort": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      const data = event.data as SSEEventData<"evolution:abort">;
      toast.warning(`Evolution aborted (${data.stage}): ${data.reason}`);
      break;
    }

    // ─── System shutdown ──────────────────────────────────────────────
    // The `ServerStatusBanner` component is the primary surface for this
    // event — it owns its own EventSource and persists state across the
    // reconnect window. We still surface a quick toast so consumers that
    // don't render the banner (e.g. embedded panels) get a hint.
    case "system:shutdown": {
      const data = event.data as SSEEventData<"system:shutdown">;
      toast.warning(`Server going offline (${data.reason}) — reconnecting…`, {
        duration: 8_000,
      });
      break;
    }

    // ─── Pine export agent events ─────────────────────────────────────
    case "pine:export-completed": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["pine"] });
      const data = event.data as SSEEventData<"pine:export-completed">;
      const score = (data as { score?: number })?.score;
      toast.success(`Pine export ready${score != null ? ` (score ${score})` : ""}`);
      break;
    }
    case "pine:export-failed": {
      const data = event.data as SSEEventData<"pine:export-failed">;
      toast.error(`Pine export failed (${data.errorCode}): ${data.message}`);
      break;
    }

    // ─── Critic agent run events ──────────────────────────────────────
    case "critic:run-completed": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      break;
    }
    case "critic:run-failed": {
      const data = event.data as SSEEventData<"critic:run-failed">;
      toast.error(`Critic run failed (${data.errorCode}): ${data.message}`);
      break;
    }
    case "critic:replay-completed": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["critic"] });
      qc.invalidateQueries({ queryKey: ["backtests"] });
      break;
    }

    // ─── Metrics aggregator warm-up ───────────────────────────────────
    case "metrics:warmed-up": {
      // Warm-up is informational — no toast needed; query invalidation
      // ensures dashboards reload fresh rolling metrics.
      qc.invalidateQueries({ queryKey: ["metrics"] });
      break;
    }

    default: {
      // Exhaustiveness check — TypeScript will complain if any union member
      // isn't handled. At runtime, log unknown event names so the dev
      // console makes new backend events visible immediately.
      const _exhaustive: never = event;
      void _exhaustive;
      break;
    }
  }
}

/**
 * Subscribe to a list of SSE event types. The returned discriminated union
 * narrows on `type`, so consumers can `switch` and get fully-typed `data`.
 *
 * Example:
 *   useSSE(["lifecycle:promoted"], (event) => {
 *     if (event.type === "lifecycle:promoted") {
 *       console.log(event.data.from, event.data.to); // typed
 *     }
 *   });
 *
 * Implementation: thin wrapper over the shared `sseClient` singleton. The
 * singleton owns the EventSource, reconnect logic, and listener attach/detach;
 * this hook only handles React lifecycle (subscribe on mount, unsubscribe on
 * unmount) and the per-event side-effect dispatch.
 */
export function useSSE(eventTypes: SSEEventType[], onEvent?: SSEHandler): void;
// Backwards-compatible signature — older call sites pass plain `string[]`.
export function useSSE(eventTypes: string[], onEvent?: SSEHandler): void;
export function useSSE(eventTypes: string[], onEvent?: SSEHandler): void {
  const qc = useQueryClient();
  // Stash the latest callback so identity changes don't force a re-subscribe.
  const onEventRef = useRef<SSEHandler | undefined>(onEvent);
  onEventRef.current = onEvent;

  // Stable key for the dependency array: re-subscribe only when event names
  // actually change (sorting protects against shallow-array reorderings).
  const subscriptionKey = eventTypes.slice().sort().join(",");

  useEffect(() => {
    const handler: SSEHandler = (event) => {
      try {
        dispatchSideEffects(event, qc);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error(`[useSSE] dispatch error for ${event.type}`, err);
        }
      }
      onEventRef.current?.(event);
    };

    const unsubscribe = sseClient.subscribe(eventTypes, handler);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionKey, qc]);
}
