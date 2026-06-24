/**
 * pine-shadow-observability.ts — Pass 3 Track D (2026-06-22)
 *
 * Single-function helper that fires BOTH observability surfaces whenever a Pine
 * export request is refused because the target strategy is in SHADOW lifecycle
 * state or has shadow_mode_enabled=true.
 *
 * ─── INTEGRATION CONTRACT FOR TRACK A + C ────────────────────────────────────
 *
 * Import and call emitPineShadowRefused() immediately BEFORE throwing/returning
 * the refusal response. The call is fire-and-forget (sync void) — it MUST NOT
 * be awaited and MUST NOT be allowed to block or throw into the caller.
 *
 * The helper co-ordinates two surfaces in a single call:
 *   1. SSE broadcast  → "pine:refused_shadow_strategy" (PINE_EVENTS constant)
 *   2. Prometheus counter → tf_pine_shadow_refusals_total{blocked_at}
 *
 * Tracks A and C ALSO write the audit_log row and Discord WARN from their own
 * code. This helper is additive — it does NOT duplicate those writes.
 *
 * ─── FUNCTION SIGNATURE ──────────────────────────────────────────────────────
 *
 *   emitPineShadowRefused(payload: PineShadowRefusedPayload): void
 *
 * ─── PAYLOAD TYPE ────────────────────────────────────────────────────────────
 *
 *   interface PineShadowRefusedPayload {
 *     strategy_id:         string;          // UUID from strategies table
 *     lifecycle_state:     string;          // current lifecycle state ("SHADOW" etc.)
 *     shadow_mode_enabled: boolean;         // value of strategies.shadow_mode_enabled
 *     blocked_at:          BlockedAtSite;   // closed enum — see below
 *     correlation_id:      string | null;   // bar-handler / request correlation ID
 *   }
 *
 * ─── blocked_at CLOSED ENUM ──────────────────────────────────────────────────
 *
 *   "compileDualPineExport"  — pine-export-service.ts compileDualPineExport() entry
 *   "compilePineExport"      — pine-export-service.ts compilePineExport() entry
 *   "recipient_build"        — pine-export-recipient-service.ts build path
 *   "artifact_download"      — GET artifact-download route in pine-export.ts
 *
 * ─── USAGE (Tracks A + C call sites) ─────────────────────────────────────────
 *
 *   import { emitPineShadowRefused } from "../../lib/pine-shadow-observability.js";
 *
 *   // Inside compileDualPineExport() after assertNotShadow() throws:
 *   emitPineShadowRefused({
 *     strategy_id:         strategy.id,
 *     lifecycle_state:     strategy.lifecycleState,
 *     shadow_mode_enabled: strategy.shadowModeEnabled ?? false,
 *     blocked_at:          "compileDualPineExport",
 *     correlation_id:      correlationId ?? null,
 *   });
 *   throw new PineExportShadowError(strategy.id);
 */

import { broadcastSSE, PINE_EVENTS } from "../routes/sse.js";
import { pineShadowRefusalsTotal } from "./metrics-registry.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Closed set of call-site names where a Pine export SHADOW refusal can fire.
 * Mirrors the tf_pine_shadow_refusals_total{blocked_at} label vocabulary and
 * the PINE_EVENTS comment in sse.ts. Adding a new call site requires updating
 * this type, the Prometheus counter comment, and the SSE event comment.
 */
export type BlockedAtSite =
  | "compileDualPineExport"
  | "compilePineExport"
  | "recipient_build"
  | "artifact_download";

/**
 * Payload for emitPineShadowRefused().
 *
 * All fields are required. Pass null for correlation_id when no correlation ID
 * is available in the calling context — the helper will emit the event with
 * correlation_id: null but will NOT block or warn on that absence.
 */
export interface PineShadowRefusedPayload {
  /** Strategy UUID from the strategies table. */
  strategy_id: string;
  /** Current lifecycle state at the time of refusal (e.g. "SHADOW", "TESTING"). */
  lifecycle_state: string;
  /** Value of strategies.shadow_mode_enabled at the time of refusal. */
  shadow_mode_enabled: boolean;
  /**
   * Call-site identifier — which Pine export entry point triggered the refusal.
   * Must be one of the four values in BlockedAtSite (closed enum).
   */
  blocked_at: BlockedAtSite;
  /** Request / bar-handler correlation ID from the calling context. Null if absent. */
  correlation_id: string | null;
}

// ─── Public helper ────────────────────────────────────────────────────────────

/**
 * emitPineShadowRefused — fire-and-forget observability emission for Pine SHADOW
 * refusal events.
 *
 * Emits:
 *   1. SSE event  "pine:refused_shadow_strategy" (PINE_EVENTS.REFUSED_SHADOW_STRATEGY)
 *      payload: { strategy_id, lifecycle_state, shadow_mode_enabled, blocked_at, correlation_id }
 *   2. Prometheus counter  tf_pine_shadow_refusals_total{ blocked_at }  incremented by 1
 *
 * Contract:
 *   - Synchronous void — never throws, never returns a Promise.
 *   - Both surfaces are wrapped in try/catch — a broken SSE connection or a
 *     prom-client registration race MUST NOT propagate to the caller.
 *   - Call BEFORE throwing the PineExportShadowError so the event reaches clients
 *     even if the caller catches and re-throws.
 *   - Do NOT await this call.
 *
 * @param payload  PineShadowRefusedPayload — all fields required.
 */
export function emitPineShadowRefused(payload: PineShadowRefusedPayload): void {
  // 1. Prometheus counter — synchronous, never throws
  try {
    pineShadowRefusalsTotal.labels({ blocked_at: payload.blocked_at }).inc();
  } catch (err: unknown) {
    // Counter unavailable (test isolation / registry race) — ignore silently.
    // A missing metric increment is non-critical; the SSE event still fires.
    logger.warn(
      { err: String(err), blocked_at: payload.blocked_at },
      "pine-shadow-observability: Prometheus counter increment failed (non-blocking)",
    );
  }

  // 2. SSE broadcast — synchronous write to all connected clients
  try {
    broadcastSSE(PINE_EVENTS.REFUSED_SHADOW_STRATEGY, {
      strategy_id:         payload.strategy_id,
      lifecycle_state:     payload.lifecycle_state,
      shadow_mode_enabled: payload.shadow_mode_enabled,
      blocked_at:          payload.blocked_at,
      correlation_id:      payload.correlation_id,
    });
  } catch (err: unknown) {
    // SSE broadcast failure MUST NOT reach the caller (dead client / socket error).
    logger.warn(
      { err: String(err), strategy_id: payload.strategy_id, blocked_at: payload.blocked_at },
      "pine-shadow-observability: SSE broadcast failed (non-blocking)",
    );
  }
}
