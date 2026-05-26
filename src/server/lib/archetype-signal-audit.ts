/**
 * archetype-signal-audit.ts — Wave 26 Pass G (2026-05-26)
 *
 * Observability hooks for the two new engine archetypes shipped in Pass G:
 *   A1: bounce_off_level
 *   A2: ict_bias_aligned_continuation
 *
 * INTEGRATION CONTRACT FOR A1 AND A2:
 *   Call emitArchetypeSignalAudit() once per bar where the archetype fires a
 *   long or short signal. Pass the full per-archetype payload. The helper:
 *     1. Writes an audit_log row (fire-and-forget — never blocks signal flow)
 *     2. Broadcasts factory:archetype_signal_fired SSE event
 *     3. Increments tf_archetype_signals_total Prometheus counter
 *
 * ALL WRITES ARE FIRE-AND-FORGET (.catch) — no exception can reach the signal path.
 *
 * Correlation ID propagation:
 *   Pass the bar-handler correlation_id as `correlationId` in every call.
 *   If the calling context has no correlation_id, pass null — the audit helper
 *   will emit a propagation-gap warning but will NOT block the insert.
 *
 * Usage example (A1 bounce_off_level):
 *   import { emitBounceOffLevelSignal } from "../../lib/archetype-signal-audit.js";
 *   // ...inside bar handler, after signal fires:
 *   emitBounceOffLevelSignal({
 *     strategy_id:       strategy.id,
 *     correlation_id:    correlationId,
 *     direction:         "long",
 *     ma_type:           "ema",
 *     ma_period:         21,
 *     rejection_pattern: "hammer",
 *     bar_timestamp:     bar.timestamp.toISOString(),
 *   });
 *
 * Usage example (A2 ict_bias_aligned_continuation):
 *   import { emitIctBiasAlignedContinuationSignal } from "../../lib/archetype-signal-audit.js";
 *   emitIctBiasAlignedContinuationSignal({
 *     strategy_id:          strategy.id,
 *     correlation_id:       correlationId,
 *     direction:            "short",
 *     htf_bias:             "bearish",
 *     structure_break_type: "CHoCH",
 *     fvg_age_bars:         3,
 *     killzone:             "ny_am",
 *     bar_timestamp:        bar.timestamp.toISOString(),
 *   });
 */

import { insertAuditRowSafe } from "./audit-log-helper.js";
import { archetypeSignalsTotal } from "./metrics-registry.js";
import { broadcastSSE, FACTORY_EVENTS } from "../routes/sse.js";
import { logger } from "./logger.js";

// ─── Payload types ─────────────────────────────────────────────────────────────

export interface BounceOffLevelSignalPayload {
  /** Strategy row ID from the strategies table. */
  strategy_id: string;
  /** Bar-handler correlation ID — from §10b propagation chain. Pass null if absent. */
  correlation_id: string | null;
  /** Trade direction: "long" | "short". */
  direction: "long" | "short";
  /** MA type used as the level: "ema" | "sma" | "dema" | "alma" | "vwap". */
  ma_type: string;
  /** MA period in bars (e.g. 21). */
  ma_period: number;
  /**
   * Rejection candle pattern that confirmed the bounce:
   * "hammer", "shooting_star", "engulfing", "doji", "pin_bar", etc.
   * Use "none" when the archetype fires on a plain close-vs-MA comparison.
   */
  rejection_pattern: string;
  /** ISO-8601 timestamp of the trigger bar. */
  bar_timestamp: string;
}

export interface IctBiasAlignedContinuationSignalPayload {
  /** Strategy row ID from the strategies table. */
  strategy_id: string;
  /** Bar-handler correlation ID — from §10b propagation chain. Pass null if absent. */
  correlation_id: string | null;
  /** Trade direction: "long" | "short". */
  direction: "long" | "short";
  /** HTF directional bias at signal time: "bullish" | "bearish" | "neutral". */
  htf_bias: string;
  /** Structure break type that triggered entry: "BOS" | "CHoCH". */
  structure_break_type: "BOS" | "CHoCH";
  /** Age of the FVG entry target in bars at signal time. */
  fvg_age_bars: number;
  /**
   * Active killzone at signal time.
   * Matches killzone.ts zone names: "london" | "ny_am" | "ny_pm" |
   * "silver_bullet" | "macro_window" | "none".
   */
  killzone: string;
  /** ISO-8601 timestamp of the trigger bar. */
  bar_timestamp: string;
}

// ─── Internal broadcast helper ─────────────────────────────────────────────────

function broadcastArchetypeSSE(
  archetype: "bounce_off_level" | "ict_bias_aligned_continuation",
  payload: BounceOffLevelSignalPayload | IctBiasAlignedContinuationSignalPayload,
): void {
  try {
    broadcastSSE(FACTORY_EVENTS.ARCHETYPE_SIGNAL_FIRED, {
      archetype,
      ...payload,
    });
  } catch (err: unknown) {
    // SSE broadcast failure MUST NOT reach the signal path
    logger.warn(
      { err: String(err), archetype, strategy_id: payload.strategy_id },
      "archetype-signal-audit: SSE broadcast failed (non-blocking)",
    );
  }
}

// ─── Public emit functions ─────────────────────────────────────────────────────

/**
 * Emit observability signals for a bounce_off_level archetype signal fire.
 *
 * Call once per bar where the archetype generates a long or short signal.
 * Fire-and-forget — returns void immediately; all I/O is async background.
 */
export function emitBounceOffLevelSignal(
  payload: BounceOffLevelSignalPayload,
): void {
  // 1. Prometheus counter — synchronous, never throws
  try {
    archetypeSignalsTotal.labels({
      archetype: "bounce_off_level",
      direction: payload.direction,
    }).inc();
  } catch { /* counter unavailable — ignore */ }

  // 2. SSE broadcast — synchronous write to connected clients
  broadcastArchetypeSSE("bounce_off_level", payload);

  // 3. Audit log — async fire-and-forget
  insertAuditRowSafe({
    action: "engine.archetype.bounce_off_level.signal_fired",
    entityType: "strategy",
    entityId: payload.strategy_id,
    input: {
      strategy_id:       payload.strategy_id,
      bar_timestamp:     payload.bar_timestamp,
    } as Record<string, unknown>,
    result: {
      direction:         payload.direction,
      ma_type:           payload.ma_type,
      ma_period:         payload.ma_period,
      rejection_pattern: payload.rejection_pattern,
    } as Record<string, unknown>,
    status: "info",
    decisionAuthority: "system",
    correlationId: payload.correlation_id ?? null,
  }).catch((err: unknown) =>
    logger.warn(
      { err: String(err), strategy_id: payload.strategy_id },
      "archetype-signal-audit: bounce_off_level audit write failed (non-blocking)",
    )
  );
}

/**
 * Emit observability signals for an ict_bias_aligned_continuation archetype
 * signal fire.
 *
 * Call once per bar where the archetype generates a long or short signal.
 * Fire-and-forget — returns void immediately; all I/O is async background.
 */
export function emitIctBiasAlignedContinuationSignal(
  payload: IctBiasAlignedContinuationSignalPayload,
): void {
  // 1. Prometheus counter — synchronous, never throws
  try {
    archetypeSignalsTotal.labels({
      archetype: "ict_bias_aligned_continuation",
      direction: payload.direction,
    }).inc();
  } catch { /* counter unavailable — ignore */ }

  // 2. SSE broadcast — synchronous write to connected clients
  broadcastArchetypeSSE("ict_bias_aligned_continuation", payload);

  // 3. Audit log — async fire-and-forget
  insertAuditRowSafe({
    action: "engine.archetype.ict_bias_aligned_continuation.signal_fired",
    entityType: "strategy",
    entityId: payload.strategy_id,
    input: {
      strategy_id:   payload.strategy_id,
      bar_timestamp: payload.bar_timestamp,
    } as Record<string, unknown>,
    result: {
      direction:            payload.direction,
      htf_bias:             payload.htf_bias,
      structure_break_type: payload.structure_break_type,
      fvg_age_bars:         payload.fvg_age_bars,
      killzone:             payload.killzone,
    } as Record<string, unknown>,
    status: "info",
    decisionAuthority: "system",
    correlationId: payload.correlation_id ?? null,
  }).catch((err: unknown) =>
    logger.warn(
      { err: String(err), strategy_id: payload.strategy_id },
      "archetype-signal-audit: ict_bias_aligned_continuation audit write failed (non-blocking)",
    )
  );
}
