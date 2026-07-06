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

    // deepscan18 (E-E1 sweep): GROUNDED 2026-07-05 — these two look like a
    // dead tile (no `broadcastSSE()` call site anywhere in src/server), but
    // the real emitter is EXTERNAL: the n8n workflow "Strategy Deep Analysis
    // Pipeline" (id 40q1SdSjUxyZ9Jux) posts `{type:"strategy:analyzed"|
    // "strategy:analysis-error", data:{...}}` to POST /api/sse/broadcast
    // (src/server/routes/sse.ts's generic n8n bridge) on completion/failure.
    // Payload verified against workflows/n8n/_archived/Strategy_Deep_Analysis_
    // Pipeline_40q1SdSjUxyZ9Jux.json — matches StrategyAnalyzedData /
    // StrategyAnalysisErrorData exactly. CURRENTLY DORMANT: the 2026-06-29
    // live-fleet snapshot (workflows/n8n/_live-snapshot-2026-06-29.json)
    // records this workflow's `active` flag as `false`, and the file now
    // lives under `_archived/` — consistent with the ongoing n8n archival
    // cleanup (see AGENT-LOGS deepscan15). Kept wired (harmless — cache
    // invalidation only, no toast) so the tile lights up the moment an
    // operator reactivates the workflow; not removed, since a real working
    // emitter exists, just not currently turned on.
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

    case "paper:kill-switch-tripped": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["paper", "sessions"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      // F-8 fix: surface a sticky, important error toast so the operator
      // can't miss a kill-switch trip even if they're on another page.
      // Mirrors the pattern used for `paper:force-flatten-all` below.
      const data = event.data as SSEEventData<"paper:kill-switch-tripped">;
      const sessionId = (data as { sessionId?: unknown })?.sessionId;
      const reason = (data as { reason?: unknown })?.reason;
      const symbol = (data as { symbol?: unknown })?.symbol;
      const shortSession = typeof sessionId === "string" ? sessionId.slice(0, 8) : "?";
      const reasonStr = typeof reason === "string" && reason.length > 0 ? reason : "kill switch tripped";
      const symbolStr = typeof symbol === "string" && symbol.length > 0 ? ` · ${symbol}` : "";
      toast.error(
        `KILL SWITCH TRIPPED — session ${shortSession}${symbolStr} · ${reasonStr}`,
        { duration: Infinity, important: true },
      );
      break;
    }

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

    // ─── Pending validation watchlist (Pass 18) ───────────────────────
    case "pending_bucket.updated": {
      qc.invalidateQueries({ queryKey: ["pending-buckets"] });
      break;
    }

    case "pending_bucket.graduated": {
      qc.invalidateQueries({ queryKey: ["pending-buckets"] });
      qc.invalidateQueries({ queryKey: ["strategies"] });
      const data = event.data as SSEEventData<"pending_bucket.graduated">;
      const label = data.name ?? data.market ?? "Strategy";
      toast.success(`Strategy graduated! ${label}`);
      break;
    }

    // ─── Lifecycle gate evaluation (Wave 4, 2026-05-16) ─────────────────
    // Wires the Wave 2 lifecycle:gate_evaluated emits to the frontend.
    // Shows a toast on FAIL / KILL decisions. On A7 PASS with ramp_up_mode,
    // shows a distinct informational toast so operator sees first-strategy
    // is in ramp-up territory. Silent for routine PASS rows.
    case "lifecycle:gate_evaluated": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      const data = event.data as SSEEventData<"lifecycle:gate_evaluated">;
      const { gate, decision, strategy_id, ramp_up_mode } = data;
      const shortId = String(strategy_id).slice(0, 8);

      if (decision === "killed") {
        toast.error(
          `Gate ${gate}: strategy ${shortId} — KILLED (sent to graveyard)`,
          { duration: 10_000 }
        );
      } else if (decision === "failed") {
        toast.warning(`Gate ${gate}: strategy ${shortId} — FAILED`);
      } else if (decision === "passed" && ramp_up_mode) {
        // A7 ramp-up: first strategy, no DEPLOYED strategy to compare against.
        // Must be surfaced distinctly per pinned facts (plan §2, A7 ramp_up_mode).
        toast.info(
          `Gate A7 PASS (ramp-up mode) — strategy ${shortId} is the first strategy, no signal-vector baseline yet`,
          { duration: 8_000 }
        );
      } else if (decision === "promoted") {
        toast.success(`Gate ${gate}: strategy ${shortId} — auto-promoted to DEPLOYED`);
      } else if (
        decision === "deferred_insufficient_sessions" ||
        decision === "deferred_sharpe_below_threshold"
      ) {
        // Deferred is informational — no toast noise, just invalidate.
        if (import.meta.env.DEV) {
          console.info(`[lifecycle:gate_evaluated] ${gate} ${decision} for ${shortId}`);
        }
      }
      // PASS without ramp_up_mode: silent, no toast.
      break;
    }

    // ─── Operator-dashboard events (cache invalidations; panels not yet built) ─
    // These events are typed for exhaustiveness. When a dashboard panel is
    // added for each category, promote the case to produce a real UX effect.

    case "production:mode-changed":
      qc.invalidateQueries({ queryKey: ["production"] });
      break;

    case "production:drift-detection-completed":
      qc.invalidateQueries({ queryKey: ["production", "drift"] });
      break;

    case "production:reconciliation-completed":
      qc.invalidateQueries({ queryKey: ["production", "reconciliation"] });
      break;

    case "compute:failover-state-change":
      qc.invalidateQueries({ queryKey: ["compute"] });
      break;

    case "network:failover-state-change":
      qc.invalidateQueries({ queryKey: ["network"] });
      break;

    case "strategy:compliance_blocked": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["compliance"] });
      const data = event.data as SSEEventData<"strategy:compliance_blocked">;
      toast.error(
        `Strategy ${String(data.strategyId).slice(0, 8)} blocked by compliance gate`
      );
      break;
    }

    case "strategy:assignment_collision": {
      qc.invalidateQueries({ queryKey: ["assignments"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const data = event.data as SSEEventData<"strategy:assignment_collision">;
      toast.error(
        `Assignment collision: strategy ${String(data.strategyId).slice(0, 8)} + account ${String(data.accountId).slice(0, 8)}`
      );
      break;
    }

    case "compliance:collaborative_trading_warning": {
      qc.invalidateQueries({ queryKey: ["compliance"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const data = event.data as SSEEventData<"compliance:collaborative_trading_warning">;
      toast.error(
        `MFFU collaborative-trading warning: strategy ${String(data.strategyId).slice(0, 8)} on ${(data.accountIds?.length ?? 0)} accounts`,
        { duration: 12_000 }
      );
      break;
    }

    case "lifecycle:operator_absent_autopromoted": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      const data = event.data as SSEEventData<"lifecycle:operator_absent_autopromoted">;
      toast.info(
        `Operator-absent auto-promotion: ${String(data.strategyId).slice(0, 8)} ${data.from} → ${data.to}`
      );
      break;
    }

    case "paper:entry-blocked-production-halt":
    case "paper:order-blocked-outage":
    case "paper:order-blocked-suspension":
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "paper:kill-switch-threshold-tripped": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const data = event.data as SSEEventData<"paper:kill-switch-threshold-tripped">;
      toast.warning(
        `Kill switch threshold (${data.threshold ?? "67"}% DLL): new entries blocked for session ${String(data.sessionId).slice(0, 8)}`,
        { duration: 10_000 }
      );
      break;
    }

    case "paper:force-flatten-all": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const data = event.data as SSEEventData<"paper:force-flatten-all">;
      toast.error(
        `Force-flatten: ${data.count} position${data.count === 1 ? "" : "s"} (${data.reason})`
      );
      break;
    }

    case "broker:order_routed":
      qc.invalidateQueries({ queryKey: ["broker"] });
      break;

    case "pine_export:hmac_persist_failed": {
      qc.invalidateQueries({ queryKey: ["pine"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      toast.error("Pine export: HMAC secret persist failed — delivery may retry");
      break;
    }

    case "pine_export:recipient_generated":
    case "pine_export:delivered":
      qc.invalidateQueries({ queryKey: ["pine"] });
      break;

    // deepscan18 (E-E1 sweep): `pending_bucket.expired` REMOVED 2026-07-05.
    // Grounded check: the only server-side reference to this event was its own
    // test file (pending-bucket-expiry.test.ts), which mocks a
    // `runPendingBucketExpiry()` function that does not exist anywhere in
    // src/server — the implementation was never written (or was lost). The
    // event genuinely cannot fire today. Removed from the catalog rather than
    // wired, since implementing the missing expiry-sweep cron is new business
    // logic, out of scope for an observability pass. Flagged as a carry-forward
    // for whoever owns the pending-bucket lifecycle: either build
    // runPendingBucketExpiry() (the test already specifies its contract) or
    // delete the orphaned test.

    case "auction:imbalance-updated":
      qc.invalidateQueries({ queryKey: ["auction"] });
      break;

    case "scout-health:reject-spike":
    case "scout-health:no-strategies-today":
      qc.invalidateQueries({ queryKey: ["scout"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      break;

    case "prop-firm:snapshot-captured":
    case "prop-firm:suspension-detected":
    case "prop-firm:suspension-cleared":
      qc.invalidateQueries({ queryKey: ["prop-firm"] });
      break;

    case "vp:levels-computed":
      qc.invalidateQueries({ queryKey: ["volume-profile"] });
      break;

    // deepscan18 (E-E1 sweep): `windows:health-check-ram-warning` and
    // `windows:real-reboot-pending` REMOVED 2026-07-05. Grounded check:
    // windows-health-check-service.ts folds BOTH RAM/disk degradation and
    // pending-reboot into the single unified `windows:health-check-failed`
    // event, discriminated by a `status` field ("degraded" | "pending_reboot"
    // | "failed_updates" | "script_error") — there is no separate emit site
    // for either dedicated event name; they were speculative catalog entries
    // that never matched the server's actual (deliberately unified) design.
    case "windows:health-check-failed":
      qc.invalidateQueries({ queryKey: ["health"] });
      break;

    // deepscan18 (E-E1 sweep): `compliance:violation_detected` REMOVED
    // 2026-07-05. Grounded check: no server-side code constructs this event
    // name or a matching payload shape ({rule, strategy_id, position_id, firm,
    // details}) anywhere in src/server. Existing specific compliance-violation
    // paths (cross-account hedge, price-lock, 2%-rule, daily-cap, lunch
    // blackout) already broadcast their own distinctly-named events, all
    // handled elsewhere in this switch — this was a speculative generic
    // catch-all that nothing ever emits.

    // deepscan18 (E-E1 sweep): `migration:legacy_firm_cleanup_complete`
    // REMOVED 2026-07-05. Grounded check: this commemorates one-time
    // migration 0097 (legacy prop-firm data cleanup), applied historically on
    // 2026-05-10 — a one-shot DB migration, not a live runtime event. It can
    // never fire again; no dashboard could ever have observed it live.
    //
    // `firm_count_changed` REMOVED 2026-07-05. Grounded check: `enabled_firms`
    // (instanceConfig.enabledFirms) is read-only at runtime — no route or
    // service in src/server ever mutates it, so nothing can trigger a
    // "count changed" event. Speculative entry, never wired to any writer.

    // deepscan18 (E-E1 sweep): these 6 discriminants were previously
    // `paper:exit:tp1_filled` etc (with a `:exit:` infix) — a name that never
    // matched anything broadcast server-side. The real events, per
    // PAPER_EXIT_EVENTS in src/server/routes/sse.ts (broadcast from
    // paper-execution-service.ts), have NO `:exit:` infix. Flagged as a
    // carry-forward in sse-events.ts's PaperExitTp1FilledData doc comment;
    // fixed here now that this session has frontend-hook edit scope.
    case "paper:tp1_filled":
    case "paper:tp2_filled":
    case "paper:be_stop_moved":
    case "paper:trail_tightened":
    case "paper:time_stop_flattened":
    case "paper:handler_error":
      qc.invalidateQueries({ queryKey: ["paper"] });
      break;

    case "a-plus-auditor:scan-complete":
      qc.invalidateQueries({ queryKey: ["agents"] });
      break;

    case "nemo:scenario-generated":
    case "nemo:scenario-error":
      qc.invalidateQueries({ queryKey: ["nemo"] });
      break;

    case "strategy:assigned":
    case "strategy:unassigned":
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
      break;

    // ─── Wave 8: graveyard burial (terminal non-reversible transition) ──
    case "strategy:graveyard_burial": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      const data = event.data as SSEEventData<"strategy:graveyard_burial">;
      const label = data.name ? `"${data.name}"` : String(data.strategyId).slice(0, 8);
      toast.error(
        `${label} buried in graveyard — ${data.failureModes?.join(", ") ?? data.deathReason}`,
        { duration: 10_000 }
      );
      break;
    }

    // ─── Wave 9-2: Pine export server-side failure ────────────────────
    case "pine_export:failed": {
      qc.invalidateQueries({ queryKey: ["pine"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const data = event.data as SSEEventData<"pine_export:failed">;
      const shortId = data.strategyId ? String(data.strategyId).slice(0, 8) : "?";
      toast.error(
        `Pine export failed [${data.errorCode}] strategy ${shortId}: ${data.errorMessage}`,
        { duration: 10_000 }
      );
      break;
    }

    // ─── Wave 9-3: Walk-forward window progress ───────────────────────
    case "walkforward:window_complete": {
      qc.invalidateQueries({ queryKey: ["backtests"] });
      // No toast — this fires per window and would be noisy for multi-window jobs.
      break;
    }

    // ─── Wave 9-3: Compliance drift detection ─────────────────────────
    case "compliance:drift_detected": {
      qc.invalidateQueries({ queryKey: ["compliance"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const data = event.data as SSEEventData<"compliance:drift_detected">;
      const firmList = data.affectedFirms?.join(", ") ?? "unknown";
      if (data.severity === "critical") {
        toast.error(
          `Compliance rules drifted — CRITICAL: active strategies may be violating updated ${firmList} rules`,
          { duration: 12_000 }
        );
      } else {
        toast.warning(
          `Compliance rules drifted (${firmList}) — review and re-validate active strategies`,
          { duration: 10_000 }
        );
      }
      break;
    }

    // ─── Deep-scan #12 Track R: Safety-critical events (sticky persistent toast) ──
    // These represent immediate trading risk — toast must NEVER auto-dismiss.

    case "kill_switch:dll_force_close": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      const shortSess = String(d.session_id).slice(0, 8);
      toast.error(
        `KILL SWITCH — DLL force-close: session ${shortSess} · firm ${d.firm_id} · day P&L $${d.day_pnl}`,
        { duration: Infinity, important: true },
      );
      break;
    }

    case "kill_switch:layer_halted": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.error(
        `KILL SWITCH — Layer ${d.layer} halted: ${d.reason}`,
        { duration: Infinity, important: true },
      );
      break;
    }

    case "kill_switch:c1_cme_eval_failed": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.error(
        `KILL SWITCH — CME eval failed (layer ${d.layer}): ${d.error_message}`,
        { duration: Infinity, important: true },
      );
      break;
    }

    case "quantum_rl:kill_switch_engaged": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      const gapPct = (d.sharpe_gap_ratio * 100).toFixed(1);
      toast.error(
        `RL KILL SWITCH — strategy ${d.strategy_id}: ${d.reason} · Sharpe gap ${gapPct}% over ${d.sessions_evaluated} sessions`,
        { duration: Infinity, important: true },
      );
      break;
    }

    case "exchange:outage-detected": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.error(
        `EXCHANGE OUTAGE — ${d.exchange}: ${d.reason} · affected: ${d.affectedSymbols.join(", ")}`,
        { duration: Infinity, important: true },
      );
      break;
    }

    case "broker:degraded": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.error(
        `BROKER DEGRADED — ${d.broker}: ${d.reason}`,
        { duration: Infinity, important: true },
      );
      break;
    }

    case "risk:dd_velocity_autopause": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.error(
        `DD VELOCITY AUTOPAUSE — ${d.firmId}: ${d.rollingDDPct.toFixed(2)}% in ${d.windowMinutes}min · threshold ${d.effectiveThreshold.toFixed(2)}%`,
        { duration: Infinity, important: true },
      );
      break;
    }

    case "paper:position-stop-breached": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.error(
        `STOP BREACHED — ${d.symbol} ${d.side} · stop ${d.stopLevel} · current ${d.currentPrice}`,
        { duration: Infinity, important: true },
      );
      break;
    }

    case "paper:auto_restart_exhausted": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      const shortSess2 = String(d.sessionId).slice(0, 8);
      toast.error(
        `AUTO-RESTART EXHAUSTED — session ${shortSess2} (${d.restartCount} attempts) · manual intervention required`,
        { duration: Infinity, important: true },
      );
      break;
    }

    case "fill_reconciliation:drift_detected": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.error(
        `FILL DRIFT — ${d.symbol}: server qty ${d.serverNetQty} vs broker qty ${d.brokerPositionQty}`,
        { duration: Infinity, important: true },
      );
      break;
    }

    case "fill_reconciliation:unmatched_fill": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.error(
        `UNMATCHED FILL — ${d.symbol} qty ${d.filled_qty} · broker ref: ${d.broker_order_ref ?? "??"}`,
        { duration: Infinity, important: true },
      );
      break;
    }

    // ─── Operationally-significant events (warning/info toast + cache invalidation) ──

    case "exchange:outage-resolved": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.success(
        `Exchange outage resolved — ${d.exchange} · ${d.note}`,
        { duration: 8_000 },
      );
      break;
    }

    case "risk:dd_velocity_warning": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.warning(
        `DD velocity warning — ${d.firmId}: ${d.rollingDDPct.toFixed(2)}% in ${d.windowMinutes}min`,
        { duration: 10_000 },
      );
      break;
    }

    case "PAPER_PARITY_DEGRADED": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      const shortSess3 = String(d.sessionId).slice(0, 8);
      toast.warning(
        `Paper parity degraded (${d.source}) — session ${shortSess3} · ${d.symbol}`,
        { duration: 10_000 },
      );
      break;
    }

    case "backtest:truthiness_failure": {
      qc.invalidateQueries({ queryKey: ["backtests"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      const shortBt = String(d.backtestId).slice(0, 8);
      toast.error(
        `Backtest truthiness failure [${d.type}/${d.severity}] — backtest ${shortBt}`,
        { duration: 10_000 },
      );
      break;
    }

    case "compliance:rejected": {
      qc.invalidateQueries({ queryKey: ["compliance"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.warning(
        `Compliance rejected — ${d.symbol} (${d.firmId}): ${d.reason}`,
        { duration: 10_000 },
      );
      break;
    }

    case "signal:macro_gate_eval_failed": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      const d = event.data;
      toast.warning(
        `Macro gate eval failed — ${d.symbol}: ${d.error_message}`,
        { duration: 10_000 },
      );
      break;
    }

    case "paper:auto_restarted": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      const d = event.data;
      toast(
        `Paper session restarted (attempt ${d.restartAttempt}) — ${d.symbols.join(", ")}`,
        { duration: 6_000 },
      );
      break;
    }

    case "monte_carlo:trades_fallback_used": {
      qc.invalidateQueries({ queryKey: ["monte-carlo"] });
      const d = event.data;
      toast.warning(
        `MC bootstrap: trade records sparse (${d.tradeCount} < ${d.minRequired}) — using daily P&L aggregates; drawdown estimates may be understated`,
        { duration: 8_000 },
      );
      break;
    }

    case "pending_bucket:killed": {
      qc.invalidateQueries({ queryKey: ["pending-buckets"] });
      break;
    }

    // ─── Deep-scan #15 FIX-3 (H4): Wave 29 catalog completeness ─────────
    // Minimal wiring only (cache invalidation, no new toast/dashboard UI) —
    // these events were type-unreachable before this pass. A dedicated
    // dashboard surface for SHADOW/PBO/RL-A-B observability is a separate,
    // larger effort (see CLAUDE.md Wave 29 observability-surface entries);
    // this just keeps the discriminated union honest and the data reachable
    // for any consumer that wants to `switch` on these types directly.
    case "signal:shadow_logged": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      break;
    }

    case "lifecycle:pbo_evaluated": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      break;
    }

    case "lifecycle:shadow_divergence_evaluated": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      break;
    }

    case "signal:rl_ab_routed": {
      qc.invalidateQueries({ queryKey: ["paper"] });
      break;
    }

    case "quantum_rl:training_completed": {
      qc.invalidateQueries({ queryKey: ["strategies"] });
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

  // Reconnect bridge: after a successful reconnect, the React Query caches
  // for live-trading-critical surfaces (paper, alerts, strategies, production)
  // may have drifted while the SSE connection was down. Invalidate them so
  // the next render reflects ground truth from the API rather than stale
  // pre-outage data. F-4 fix.
  useEffect(() => {
    const handleReconnect = () => {
      qc.invalidateQueries({ queryKey: ["paper"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["strategies"] });
      qc.invalidateQueries({ queryKey: ["production"] });
    };
    return sseClient.setReconnectHandler(handleReconnect);
  }, [qc]);
}
