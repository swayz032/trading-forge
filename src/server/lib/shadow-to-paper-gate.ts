/**
 * shadow-to-paper-gate.ts — Pass 5 Track B (paper-parity 2026-06-23)
 *
 * Pure-function evaluator for the SHADOW → PAPER promotion gate.
 *
 * Wave 29 Pass A.3 wired this gate inline inside the checkAutoPromotions cron
 * sweep (lifecycle-service.ts Gate 2.5). A bearer-token holder hitting
 * PATCH /:id/lifecycle with (fromState='SHADOW', toState='PAPER') can bypass
 * it entirely.
 *
 * Track B extracts the gate decision into this pure function. Track C will
 * call it from both _promoteStrategyInner (so PATCH is gated) AND the cron
 * sweep (so behavior is identical between the two paths).
 *
 * DESIGN CONTRACT:
 *   - No DB access. No Date.now(). No side effects.
 *   - Caller pre-loads shadow signals + backtest expected array and passes them in.
 *   - Caller writes audit_log rows and emits SSE events.
 *   - Output shape mirrors Track A's evaluator (wfe-gate.ts) for cross-gate symmetry.
 *
 * Threshold constants (from env, same env vars as Wave 29 Pass A.3 lifecycle gate):
 *   SHADOW_DIVERGENCE_THRESHOLD_PCT  (default 0.05) — divergence_pct ≥ this → BLOCK
 *   SHADOW_DIVERGENCE_MIN_SAMPLE     (default 20)   — below this count → insufficient_samples block
 *
 * Audit action names match the existing Gate 2.5 usage in lifecycle-service.ts
 * to ensure audit_log is consistent whether the evaluation came from the cron
 * sweep or from a lifecycle PATCH request.
 */

import {
  compareShadowToBacktest,
  MIN_SAMPLE_SIZE,
  DIVERGENCE_THRESHOLD,
} from "./shadow-signal-divergence-checker.js";
import type { ShadowSignal, ExpectedSignal } from "./shadow-signal-divergence-checker.js";

// ──────────────────────────────────────────────────────────────────────────────
// Re-export types the checker owns so callers of THIS module need only
// import from one place.
// ──────────────────────────────────────────────────────────────────────────────

export type { ShadowSignal as ShadowSignalRow } from "./shadow-signal-divergence-checker.js";
export type { ExpectedSignal } from "./shadow-signal-divergence-checker.js";

// ──────────────────────────────────────────────────────────────────────────────
// Threshold helpers (env-readable, exported for test overrides)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Divergence fraction threshold above which the gate blocks (boundary inclusive).
 * Reads SHADOW_DIVERGENCE_THRESHOLD_PCT env var; falls back to DIVERGENCE_THRESHOLD
 * from shadow-signal-divergence-checker (0.05).
 */
export function getDivergenceThreshold(): number {
  const raw = process.env.SHADOW_DIVERGENCE_THRESHOLD_PCT;
  if (raw !== undefined && raw !== "") {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  }
  return DIVERGENCE_THRESHOLD; // 0.05
}

/**
 * Minimum shadow signal count before a pass/fail verdict is possible.
 * Reads SHADOW_DIVERGENCE_MIN_SAMPLE env var; falls back to MIN_SAMPLE_SIZE
 * from shadow-signal-divergence-checker (20).
 */
export function getMinSampleSize(): number {
  const raw = process.env.SHADOW_DIVERGENCE_MIN_SAMPLE;
  if (raw !== undefined && raw !== "") {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 1) return parsed;
  }
  return MIN_SAMPLE_SIZE; // 20
}

// ──────────────────────────────────────────────────────────────────────────────
// Public shapes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Input bag passed to evaluateShadowToPaperGate.
 *
 * Caller is responsible for pre-loading both arrays from DB before calling.
 * This module owns zero I/O.
 *
 * shadowSignals:           Logged shadow signals from lifecycle_shadow_signals.
 * backtestExpectedCount:   Total expected signal count from the latest backtest
 *                          (used for context/audit; divergence comparison uses
 *                          the backtestExpected array implicitly via the checker).
 * strategyId:              UUID of the strategy being evaluated (audit context only).
 * correlationId:           Optional trace root propagated from the outer caller.
 */
export interface ShadowToPaperGateInput {
  shadowSignals: ShadowSignal[];
  /** Backtest expected signals array to compare against. */
  backtestExpected: ExpectedSignal[];
  /** Total expected signal count from backtest (informational; for audit payload). */
  backtestExpectedCount: number;
  strategyId: string;
  correlationId?: string | null;
}

/**
 * Status values mirror the semantic vocabulary used by Track A (wfe-gate.ts)
 * with the addition of shadow-specific states.
 *
 *   "pass"                  — gate cleared; promotion allowed
 *   "blocked"               — divergence_pct >= threshold (hard block)
 *   "insufficient_samples"  — below the minimum sample floor (block until more signals)
 *   "legacy_unavailable"    — shadow_signals table/data absent (grandfather proceed)
 *   "warning"               — reserved; not currently emitted
 */
export type ShadowToPaperGateStatus =
  | "pass"
  | "blocked"
  | "insufficient_samples"
  | "legacy_unavailable"
  | "warning";

/**
 * Evaluator output — symmetric with Track A (wfe-gate.ts WfeGateResult) shape:
 *   passed + status + auditAction + auditPayload + reason
 *
 * The caller writes audit_log rows and SSE events using these fields.
 * The evaluator NEVER writes to DB or emits events itself.
 */
export interface ShadowToPaperGateResult {
  /** Whether the gate allows SHADOW → PAPER promotion. */
  passed: boolean;
  /**
   * Semantic status — used to select the correct audit action + message.
   * Track A parity: "pass" ≡ "passed" in wfe-gate vocabulary.
   */
  status: ShadowToPaperGateStatus;
  /**
   * Canonical audit_log action string.
   * Matches the action names Gate 2.5 in lifecycle-service.ts already uses.
   * null when passed=true and no audit is needed (caller's discretion on happy path).
   */
  auditAction:
    | "lifecycle.shadow_divergence_blocked"
    | "lifecycle.shadow_divergence_insufficient_samples"
    | "lifecycle.shadow_divergence_check_unavailable_legacy"
    | "lifecycle.shadow_promotion_passed"
    | null;
  /**
   * Structured payload for the audit_log.result column.
   * Always present (empty object on legacy_unavailable).
   */
  auditPayload: Record<string, unknown>;
  /** Human-readable reason string. */
  reason: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Pure evaluator
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate whether a SHADOW strategy may be promoted to PAPER.
 *
 * PURE FUNCTION — no I/O, no Date.now(), no randomness.
 * Identical inputs always produce identical outputs.
 *
 * Decision tree (in order):
 *   1. shadowSignals null/empty → legacy_unavailable (proceed; grandfather window)
 *   2. shadowSignals.length < getMinSampleSize() → insufficient_samples (block)
 *   3. compareShadowToBacktest(shadowSignals, backtestExpected).ok === false
 *      a. reason==="insufficient_samples" (re-check from comparator) → insufficient_samples
 *      b. otherwise → blocked (divergence_pct >= threshold)
 *   4. otherwise → pass
 *
 * @param input  Pre-loaded signal arrays + context.
 * @param thresholdPct  Optional override for SHADOW_DIVERGENCE_THRESHOLD_PCT (for tests).
 * @param minSample     Optional override for SHADOW_DIVERGENCE_MIN_SAMPLE (for tests).
 */
export function evaluateShadowToPaperGate(
  input: ShadowToPaperGateInput,
  thresholdPct?: number,
  minSample?: number,
): ShadowToPaperGateResult {
  const { shadowSignals, backtestExpected, backtestExpectedCount, strategyId, correlationId } = input;

  const effectiveThreshold = thresholdPct ?? getDivergenceThreshold();
  const effectiveMinSample = minSample ?? getMinSampleSize();

  // ── Sample-size gate — FAIL-CLOSED at 0/null (deep-scan HIGH-1, operator-ratified 2026-07-09) ──
  // Must accumulate at least effectiveMinSample shadow signals before a divergence
  // verdict is statistically meaningful. 0 or null signals BLOCKS — matching the
  // canonical autonomous-cron path (lifecycle-service.ts → compareShadowToBacktest([])
  // → insufficient_samples → block; shadow-signal-divergence-checker.ts:175-183).
  //
  // PREVIOUSLY: null/empty returned passed:true ("legacy_unavailable") — a false-green
  // on this HARD training-serving-skew gate (CLAUDE.md §12/§13, institutional failure
  // mode #1) at the worst input, diverging from the cron which correctly fail-closes.
  // A new graduate with un-wired shadow logging, or a transient DB error swallowed to []
  // by the loader, would promote SHADOW→PAPER on the manual/n8n/HMAC path with the gate
  // validating nothing. There is NO undated grandfather here: a genuine pre-Wave-29
  // strategy carries no shadow signals AND would not be in SHADOW state to promote FROM;
  // the cron never grandfathered 0-signal promotions and this path must not either.
  const signalCount = shadowSignals?.length ?? 0;
  if (signalCount < effectiveMinSample) {
    return {
      passed: false,
      status: "insufficient_samples",
      auditAction: "lifecycle.shadow_divergence_insufficient_samples",
      auditPayload: {
        sample_size: signalCount,
        min_required: effectiveMinSample,
        strategyId,
        correlationId: correlationId ?? null,
        backtestExpectedCount,
        note: `Insufficient shadow samples (${signalCount} < ${effectiveMinSample}) — SHADOW → PAPER blocked until minimum accumulates (0/null fail-CLOSED, parity with cron)`,
      },
      reason: `insufficient_samples: ${signalCount} < ${effectiveMinSample} required`,
    };
  }

  // ── Divergence comparison ─────────────────────────────────────────────────
  // Delegate to the existing pure comparator. It re-checks sample size
  // internally (with its own MIN_SAMPLE_SIZE constant) and also enforces
  // the divergence threshold. We pass our caller-controlled threshold
  // by post-processing the comparator's result rather than relying solely
  // on the comparator's internal constant, because the caller may override
  // the threshold via env or test injection.
  const divergenceResult = compareShadowToBacktest(shadowSignals, backtestExpected);

  if (!divergenceResult.ok) {
    // Re-check: comparator may emit insufficient_samples even if our outer
    // check passed, because backtestExpected may be empty (legacy path).
    if (divergenceResult.reason === "insufficient_samples") {
      return {
        passed: false,
        status: "insufficient_samples",
        auditAction: "lifecycle.shadow_divergence_insufficient_samples",
        auditPayload: {
          sample_size: divergenceResult.sample_size,
          min_required: effectiveMinSample,
          divergence_pct: divergenceResult.divergence_pct,
          backtestExpectedCount,
          strategyId,
          correlationId: correlationId ?? null,
          note: "Comparator reported insufficient_samples (backtestExpected may be empty for pre-Wave-29 backtest)",
        },
        reason: `insufficient_samples (comparator): ${divergenceResult.reason}`,
      };
    }

    // Divergence exceeds threshold — hard block.
    // NOTE: The comparator uses its own DIVERGENCE_THRESHOLD constant internally.
    // If the caller has overridden effectiveThreshold to something tighter than
    // DIVERGENCE_THRESHOLD, we must also check that here. The comparator already
    // blocked at >= its internal 0.05 — if callerThreshold is tighter (e.g. 0.03)
    // we defer to the comparator result (which already blocked at 0.05).
    // If callerThreshold is looser (e.g. 0.10), the comparator already blocked,
    // so the result stands. Either way: comparator said !ok → we block.
    return {
      passed: false,
      status: "blocked",
      auditAction: "lifecycle.shadow_divergence_blocked",
      auditPayload: {
        divergence_pct: divergenceResult.divergence_pct,
        sample_size: divergenceResult.sample_size,
        threshold_pct: effectiveThreshold,
        per_signal_violations: divergenceResult.per_signal_violations,
        backtestExpectedCount,
        strategyId,
        correlationId: correlationId ?? null,
        reason: divergenceResult.reason,
        note: `SHADOW → PAPER blocked: divergence ${(divergenceResult.divergence_pct * 100).toFixed(2)}% >= threshold ${(effectiveThreshold * 100).toFixed(0)}%`,
      },
      reason: divergenceResult.reason ?? `divergence_blocked: ${(divergenceResult.divergence_pct * 100).toFixed(2)}% >= ${(effectiveThreshold * 100).toFixed(0)}%`,
    };
  }

  // ── Additional threshold check for caller-supplied tighter threshold ──────
  // The comparator's internal DIVERGENCE_THRESHOLD is 0.05. If the caller
  // passes a tighter threshold (e.g. 0.03), compareShadowToBacktest may have
  // returned ok=true because it only checks >= 0.05, but the caller-controlled
  // threshold should also block. Apply that check here.
  if (divergenceResult.divergence_pct >= effectiveThreshold) {
    return {
      passed: false,
      status: "blocked",
      auditAction: "lifecycle.shadow_divergence_blocked",
      auditPayload: {
        divergence_pct: divergenceResult.divergence_pct,
        sample_size: divergenceResult.sample_size,
        threshold_pct: effectiveThreshold,
        per_signal_violations: divergenceResult.per_signal_violations,
        backtestExpectedCount,
        strategyId,
        correlationId: correlationId ?? null,
        note: `SHADOW → PAPER blocked by caller-supplied threshold: divergence ${(divergenceResult.divergence_pct * 100).toFixed(2)}% >= ${(effectiveThreshold * 100).toFixed(0)}%`,
      },
      reason: `divergence_blocked_caller_threshold: ${(divergenceResult.divergence_pct * 100).toFixed(2)}% >= ${(effectiveThreshold * 100).toFixed(0)}%`,
    };
  }

  // ── Pass ──────────────────────────────────────────────────────────────────
  return {
    passed: true,
    status: "pass",
    auditAction: "lifecycle.shadow_promotion_passed",
    auditPayload: {
      divergence_pct: divergenceResult.divergence_pct,
      sample_size: divergenceResult.sample_size,
      threshold_pct: effectiveThreshold,
      per_signal_violations: divergenceResult.per_signal_violations,
      backtestExpectedCount,
      strategyId,
      correlationId: correlationId ?? null,
      note: `SHADOW → PAPER cleared: divergence ${(divergenceResult.divergence_pct * 100).toFixed(2)}% < ${(effectiveThreshold * 100).toFixed(0)}% threshold`,
    },
    reason: `divergence_pass: ${(divergenceResult.divergence_pct * 100).toFixed(2)}% < ${(effectiveThreshold * 100).toFixed(0)}% threshold`,
  };
}
