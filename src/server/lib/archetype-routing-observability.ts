/**
 * archetype-routing-observability.ts — Pass 4.5 Track D (2026-06-23)
 *
 * Single-import helper that fires BOTH observability surfaces (SSE broadcast +
 * Prometheus counter) at each stage of the /api/live-order archetype_signal
 * handler lifecycle.
 *
 * ─── INTEGRATION CONTRACT FOR TRACK B ────────────────────────────────────────
 *
 * Import and call the appropriate helper at each stage of the archetype signal
 * flow in live-order.ts. All calls are fire-and-forget (sync void) — they MUST
 * NOT be awaited and MUST NOT be allowed to block or throw into the caller.
 *
 * Critical contract: the live-order critical path must NEVER be interrupted by
 * observability failure. Every helper is wrapped in try/catch; a broken SSE
 * connection or a prom-client registration race MUST NOT propagate to the caller.
 *
 * ─── STAGE MAPPING ───────────────────────────────────────────────────────────
 *
 *   Stage 1 — Request accepted:
 *     emitArchetypeSignalReceived(payload)
 *       Call immediately after /api/live-order validates action:"archetype_signal"
 *       and BEFORE dispatching the Python evaluator subprocess.
 *       SSE: archetype:signal_received
 *       Prometheus: NOT incremented (reception is not yet a routing decision)
 *
 *   Stage 2 — Evaluator returned a verdict:
 *     emitArchetypeSignalResolved(payload)
 *       Call after archetype_evaluator returns a valid resolved_action.
 *       SSE: archetype:signal_resolved
 *       Prometheus: tf_archetype_signals_routed_total{archetype, resolved_action}
 *
 *   Stage 3 — Evaluator failed (subprocess error / timeout):
 *     emitArchetypeEvaluatorFailed(payload)
 *       Call in the catch / timeout branch of the evaluator dispatch.
 *       SSE: archetype:evaluator_failed
 *       Prometheus: tf_archetype_signals_routed_total{archetype, resolved_action:"evaluator_failed"}
 *
 * ─── USAGE ────────────────────────────────────────────────────────────────────
 *
 *   import {
 *     emitArchetypeSignalReceived,
 *     emitArchetypeSignalResolved,
 *     emitArchetypeEvaluatorFailed,
 *   } from "../../lib/archetype-routing-observability.js";
 *
 *   // Stage 1 — request accepted:
 *   emitArchetypeSignalReceived({
 *     strategy_id:    strategy.id,
 *     archetype:      body.archetype,
 *     account_id:     session.account_id,
 *     correlation_id: req.headers["x-correlation-id"] ?? null,
 *     bar_timestamp:  body.bar_timestamp,
 *   });
 *
 *   // Stage 2 — evaluator verdict received:
 *   emitArchetypeSignalResolved({
 *     strategy_id:      strategy.id,
 *     archetype:        body.archetype,
 *     resolved_action:  verdict.action,   // e.g. "enter_long"
 *     account_id:       session.account_id,
 *     correlation_id:   req.headers["x-correlation-id"] ?? null,
 *     reason:           verdict.reason ?? null,
 *   });
 *
 *   // Stage 3 — evaluator subprocess error / timeout:
 *   emitArchetypeEvaluatorFailed({
 *     strategy_id:    strategy.id,
 *     archetype:      body.archetype,
 *     error_class:    err instanceof Error ? err.constructor.name : "UnknownError",
 *     correlation_id: req.headers["x-correlation-id"] ?? null,
 *   });
 */

import { broadcastSSE, ARCHETYPE_ROUTING_EVENTS } from "../routes/sse.js";
import { archetypeSignalsRoutedTotal } from "./metrics-registry.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Closed set of resolved_action values emitted by the archetype evaluator and
 * recorded in tf_archetype_signals_routed_total{resolved_action}.
 *
 * "evaluator_failed" is the synthetic label used when the subprocess errors or
 * times out — it is NEVER returned by the Python evaluator itself.
 */
export type ResolvedAction =
  | "enter_long"
  | "enter_short"
  | "exit_long"
  | "exit_short"
  | "hold"
  | "evaluator_failed";

/**
 * Payload for emitArchetypeSignalReceived().
 *
 * Mirrors the first SSE event in the archetype routing lifecycle. Emitted when
 * /api/live-order accepts an action:"archetype_signal" request and before the
 * evaluator subprocess is dispatched.
 */
export interface ArchetypeSignalReceivedPayload {
  /** Strategy UUID or numeric ID from the strategies table. */
  strategy_id: string;
  /** ARCHETYPE_REGISTRY key (e.g. "bounce_off_level"). */
  archetype: string;
  /** Broker account ID the signal targets. */
  account_id: string;
  /** Request correlation ID from the caller context. Null if absent. */
  correlation_id: string | null;
  /** Bar timestamp from the incoming signal payload (ISO-8601 or epoch string). */
  bar_timestamp: string;
}

/**
 * Payload for emitArchetypeSignalResolved().
 *
 * Emitted after archetype_evaluator returns a valid verdict. Carries the
 * resolved direction the evaluator returned and an optional human-readable
 * reason string from the evaluator response.
 */
export interface ArchetypeSignalResolvedPayload {
  /** Strategy UUID or numeric ID from the strategies table. */
  strategy_id: string;
  /** ARCHETYPE_REGISTRY key (e.g. "bounce_off_level"). */
  archetype: string;
  /**
   * Direction the evaluator resolved to. Must be one of the values in
   * ResolvedAction (excluding "evaluator_failed" — use emitArchetypeEvaluatorFailed).
   */
  resolved_action: Exclude<ResolvedAction, "evaluator_failed">;
  /** Broker account ID the signal targets. */
  account_id: string;
  /** Request correlation ID from the caller context. Null if absent. */
  correlation_id: string | null;
  /** Optional human-readable reason from the evaluator response. Null if absent. */
  reason: string | null;
}

/**
 * Payload for emitArchetypeEvaluatorFailed().
 *
 * Emitted when the Python evaluator subprocess fails or times out. The
 * resolved_action label is always "evaluator_failed" for this helper.
 */
export interface ArchetypeEvaluatorFailedPayload {
  /** Strategy UUID or numeric ID from the strategies table. */
  strategy_id: string;
  /** ARCHETYPE_REGISTRY key (e.g. "bounce_off_level"). */
  archetype: string;
  /**
   * Error class name from the thrown exception, or "UnknownError" when the
   * thrown value is not an Error instance.
   * Typical values: "TimeoutError" | "SubprocessError" | "Error"
   */
  error_class: string;
  /** Request correlation ID from the caller context. Null if absent. */
  correlation_id: string | null;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * emitArchetypeSignalReceived — fire-and-forget Stage 1 observability emission.
 *
 * Emits:
 *   1. SSE event "archetype:signal_received" (ARCHETYPE_ROUTING_EVENTS.SIGNAL_RECEIVED)
 *      payload: { strategy_id, archetype, account_id, correlation_id, bar_timestamp }
 *
 * NOTE: does NOT increment the Prometheus counter — reception is not yet a
 * routing decision. Only resolved and failed stages increment the counter.
 *
 * Contract:
 *   - Synchronous void — never throws, never returns a Promise.
 *   - SSE broadcast is wrapped in try/catch — socket failure MUST NOT reach caller.
 *   - Call BEFORE dispatching the Python evaluator subprocess.
 *   - Do NOT await this call.
 *
 * @param payload  ArchetypeSignalReceivedPayload — all fields required.
 */
export function emitArchetypeSignalReceived(payload: ArchetypeSignalReceivedPayload): void {
  try {
    broadcastSSE(ARCHETYPE_ROUTING_EVENTS.SIGNAL_RECEIVED, {
      strategy_id:    payload.strategy_id,
      archetype:      payload.archetype,
      account_id:     payload.account_id,
      correlation_id: payload.correlation_id,
      bar_timestamp:  payload.bar_timestamp,
    });
  } catch (err: unknown) {
    logger.warn(
      { err: String(err), strategy_id: payload.strategy_id, archetype: payload.archetype },
      "archetype-routing-observability: SSE broadcast (signal_received) failed (non-blocking)",
    );
  }
}

/**
 * emitArchetypeSignalResolved — fire-and-forget Stage 2 observability emission.
 *
 * Emits:
 *   1. SSE event "archetype:signal_resolved" (ARCHETYPE_ROUTING_EVENTS.SIGNAL_RESOLVED)
 *      payload: { strategy_id, archetype, resolved_action, account_id, correlation_id, reason }
 *   2. Prometheus counter  tf_archetype_signals_routed_total{ archetype, resolved_action }
 *      incremented by 1
 *
 * Contract:
 *   - Synchronous void — never throws, never returns a Promise.
 *   - Both surfaces are wrapped in independent try/catch blocks — a broken SSE
 *     connection or a prom-client registration race MUST NOT propagate to the caller.
 *   - Call after the archetype_evaluator returns a valid verdict.
 *   - Do NOT await this call.
 *
 * @param payload  ArchetypeSignalResolvedPayload — all fields required.
 */
export function emitArchetypeSignalResolved(payload: ArchetypeSignalResolvedPayload): void {
  // 1. Prometheus counter — synchronous, never throws
  try {
    archetypeSignalsRoutedTotal
      .labels({ archetype: payload.archetype, resolved_action: payload.resolved_action })
      .inc();
  } catch (err: unknown) {
    logger.warn(
      { err: String(err), archetype: payload.archetype, resolved_action: payload.resolved_action },
      "archetype-routing-observability: Prometheus counter increment (signal_resolved) failed (non-blocking)",
    );
  }

  // 2. SSE broadcast — synchronous write to all connected clients
  try {
    broadcastSSE(ARCHETYPE_ROUTING_EVENTS.SIGNAL_RESOLVED, {
      strategy_id:     payload.strategy_id,
      archetype:       payload.archetype,
      resolved_action: payload.resolved_action,
      account_id:      payload.account_id,
      correlation_id:  payload.correlation_id,
      reason:          payload.reason,
    });
  } catch (err: unknown) {
    logger.warn(
      { err: String(err), strategy_id: payload.strategy_id, archetype: payload.archetype },
      "archetype-routing-observability: SSE broadcast (signal_resolved) failed (non-blocking)",
    );
  }
}

/**
 * emitArchetypeEvaluatorFailed — fire-and-forget Stage 3 observability emission.
 *
 * Emits:
 *   1. SSE event "archetype:evaluator_failed" (ARCHETYPE_ROUTING_EVENTS.EVALUATOR_FAILED)
 *      payload: { strategy_id, archetype, error_class, correlation_id }
 *   2. Prometheus counter  tf_archetype_signals_routed_total{ archetype, resolved_action:"evaluator_failed" }
 *      incremented by 1
 *
 * Contract:
 *   - Synchronous void — never throws, never returns a Promise.
 *   - Both surfaces are wrapped in independent try/catch blocks — a broken SSE
 *     connection or a prom-client registration race MUST NOT propagate to the caller.
 *   - Call in the catch / timeout branch of the evaluator subprocess dispatch.
 *   - Do NOT await this call.
 *
 * @param payload  ArchetypeEvaluatorFailedPayload — all fields required.
 */
export function emitArchetypeEvaluatorFailed(payload: ArchetypeEvaluatorFailedPayload): void {
  // 1. Prometheus counter — resolved_action is always "evaluator_failed" for this helper
  try {
    archetypeSignalsRoutedTotal
      .labels({ archetype: payload.archetype, resolved_action: "evaluator_failed" })
      .inc();
  } catch (err: unknown) {
    logger.warn(
      { err: String(err), archetype: payload.archetype, error_class: payload.error_class },
      "archetype-routing-observability: Prometheus counter increment (evaluator_failed) failed (non-blocking)",
    );
  }

  // 2. SSE broadcast — synchronous write to all connected clients
  try {
    broadcastSSE(ARCHETYPE_ROUTING_EVENTS.EVALUATOR_FAILED, {
      strategy_id:    payload.strategy_id,
      archetype:      payload.archetype,
      error_class:    payload.error_class,
      correlation_id: payload.correlation_id,
    });
  } catch (err: unknown) {
    logger.warn(
      { err: String(err), strategy_id: payload.strategy_id, archetype: payload.archetype },
      "archetype-routing-observability: SSE broadcast (evaluator_failed) failed (non-blocking)",
    );
  }
}
