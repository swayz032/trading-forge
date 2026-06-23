/**
 * alert-dedup.ts — per-key alert deduplication with configurable window.
 *
 * WHY THIS EXISTS:
 *   The ollama cold-load spiral (2026-06-23) generated identical Discord
 *   CRITICAL alerts every ~4 minutes for over an hour. The notification-service
 *   dedup is title-based with a 10-minute window — too short for sustained
 *   infrastructure failures, and not keyed on our stable event keys.
 *
 *   This helper provides:
 *     • Per alertKey (stable string) dedup with operator-configurable window
 *       (ALERT_DEDUP_WINDOW_MS, default 1 hour)
 *     • Severity escalation exception: re-alert IMMEDIATELY when severity goes up
 *     • "All clear" re-arm: a recovery notification can reset the key so the
 *       next failure fires immediately
 *     • Purely in-process; no DB dependency
 *
 * USAGE:
 *   import { shouldEmitAlert, markAlertEmitted, clearAlertKey } from "./alert-dedup.js";
 *
 *   if (shouldEmitAlert("ollama.circuit_open", "CRITICAL")) {
 *     markAlertEmitted("ollama.circuit_open", "CRITICAL");
 *     notifyCritical(...);
 *   }
 *
 *   // On recovery:
 *   clearAlertKey("ollama.circuit_open");
 *   notifyInfo(...); // all-clear fires regardless of dedup
 *
 * DESIGN CONSTRAINTS:
 *   • No Date.now() in pure logic — callers inject `nowMs` for testability
 *   • Fail-soft — shouldEmitAlert returns true on internal errors (prefer spam
 *     over silence in a production alerting path)
 *   • Thread-safe for single-process Node (no concurrent state mutations)
 */

import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

interface DedupEntry {
  lastEmittedAt: number;   // epoch ms
  lastSeverity: AlertSeverity;
}

// ─── Severity ordering ────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  INFO: 0,
  WARNING: 1,
  CRITICAL: 2,
};

function isEscalation(prev: AlertSeverity, next: AlertSeverity): boolean {
  return SEVERITY_RANK[next] > SEVERITY_RANK[prev];
}

// ─── State ────────────────────────────────────────────────────────────────────

const _entries = new Map<string, DedupEntry>();

// ─── Config ───────────────────────────────────────────────────────────────────

function getDedupWindowMs(): number {
  const raw = process.env.ALERT_DEDUP_WINDOW_MS;
  if (!raw) return 3_600_000; // 1 hour default
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3_600_000;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the alert for `alertKey` should be emitted.
 *
 * Emits when:
 *   1. No prior entry for this key (first fire)
 *   2. Window elapsed since last emit
 *   3. Severity escalated (e.g. WARNING → CRITICAL) regardless of window
 *
 * Injects `nowMs` for deterministic testing. Pass `Date.now()` in production.
 */
export function shouldEmitAlert(
  alertKey: string,
  severity: AlertSeverity,
  nowMs: number = Date.now(),
): boolean {
  try {
    const entry = _entries.get(alertKey);

    // First fire
    if (!entry) {
      return true;
    }

    // Severity escalation — re-alert immediately
    if (isEscalation(entry.lastSeverity, severity)) {
      logger.debug(
        { alertKey, prevSeverity: entry.lastSeverity, newSeverity: severity },
        "alert-dedup: severity escalation — bypassing dedup window",
      );
      return true;
    }

    // Window check
    const windowMs = getDedupWindowMs();
    const elapsed = nowMs - entry.lastEmittedAt;
    if (elapsed >= windowMs) {
      return true;
    }

    logger.debug(
      {
        alertKey,
        severity,
        elapsedMs: elapsed,
        windowMs,
        suppressedUntilMs: entry.lastEmittedAt + windowMs,
      },
      "alert-dedup: alert suppressed within dedup window",
    );
    return false;
  } catch (err) {
    // Fail-soft: prefer potential spam over silent suppression in a prod alert path
    logger.error({ err, alertKey }, "alert-dedup: shouldEmitAlert threw — defaulting to emit");
    return true;
  }
}

/**
 * Record that an alert was emitted for `alertKey` at `nowMs`.
 * Call immediately after emitting to set the dedup window start.
 */
export function markAlertEmitted(
  alertKey: string,
  severity: AlertSeverity,
  nowMs: number = Date.now(),
): void {
  _entries.set(alertKey, { lastEmittedAt: nowMs, lastSeverity: severity });
}

/**
 * Clear the dedup state for `alertKey`.
 * Use on recovery so the next failure fires immediately rather than waiting
 * for the window to expire. "All clear" notifications should call this first.
 */
export function clearAlertKey(alertKey: string): void {
  _entries.delete(alertKey);
}

/**
 * Returns the current dedup state for `alertKey` — useful for tests and
 * health checks. Returns null if no entry exists.
 */
export function getAlertEntry(alertKey: string): Readonly<DedupEntry> | null {
  return _entries.get(alertKey) ?? null;
}

/**
 * Reset ALL dedup state. Intended for tests only.
 */
export function _resetDedupForTests(): void {
  _entries.clear();
}
