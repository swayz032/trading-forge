/**
 * SQA Promise Registry — tracks in-flight SQA optimization promises so the
 * critic can await completion rather than fire-and-forget polling DB.
 *
 * Design:
 *   - Session-local Map (in-process, not persisted). On server restart the registry
 *     is empty; critic falls back to the existing DB read path (null result) which
 *     is always the safe baseline. No correctness regression on restart.
 *   - Each entry holds the Promise, spawn timestamp, and status.
 *   - awaitWithTimeout: checks wall-clock elapsed since spawn. If already past
 *     30 s it returns null immediately. Otherwise waits only the remaining time.
 *   - TTL: entries pruned 5 min after spawn (avoids unbounded growth).
 *   - Circuit breaker: sliding-window counter — 3 timeouts in 10 min trips open
 *     for 1 hour. When open, awaitWithTimeout returns null fast without waiting.
 *   - Every state change writes an audit_log entry via the passed-in writer.
 *
 * Restart behaviour:
 *   On server restart, spawnedAt info is lost. The critic proceeds with the
 *   existing DB single-read fallback (no Optuna seed). This is the same outcome
 *   as the pre-fix fire-and-forget path — no regression.
 */

import { logger } from "./logger.js";

// ─── Constants ───────────────────────────────────────────────────────────────

export const SQA_AWAIT_TIMEOUT_MS = 30_000;       // hard cap: never extend
export const SQA_TTL_MS = 5 * 60 * 1000;          // prune registry entries after 5 min
export const SQA_CB_WINDOW_MS = 10 * 60 * 1000;   // sliding window for timeout counting
export const SQA_CB_THRESHOLD = 3;                 // timeouts before circuit opens
export const SQA_CB_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour open cooldown

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SqaRegistryEntry {
  promise: Promise<unknown>;
  spawnedAt: number; // Date.now() at spawn
  status: "running" | "completed" | "failed" | "timedout";
}

export type SqaCircuitState = "CLOSED" | "OPEN";

/** Minimal audit writer — injected to avoid circular import with db module. */
export type AuditWriter = (entry: {
  action: string;
  entityType: string;
  entityId: string | null;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  status: string;
  decisionAuthority: string;
}) => Promise<void>;

// ─── SqaPromiseRegistry ──────────────────────────────────────────────────────

export class SqaPromiseRegistry {
  private readonly _entries = new Map<string, SqaRegistryEntry>();

  // Circuit breaker state
  private _cbState: SqaCircuitState = "CLOSED";
  private _cbOpenedAt: number | null = null;
  private readonly _timeoutTimestamps: number[] = []; // sliding window records

  private _auditWriter: AuditWriter | null = null;

  /** Inject audit writer at startup to avoid circular imports. */
  setAuditWriter(writer: AuditWriter): void {
    this._auditWriter = writer;
  }

  // ─── Registry operations ─────────────────────────────────────────────────

  /**
   * Register an in-flight SQA promise for a backtest.
   * Call this immediately after spawning the async SQA task.
   */
  register(backtestId: string, promise: Promise<unknown>): void {
    this._prune();
    this._entries.set(backtestId, {
      promise,
      spawnedAt: Date.now(),
      status: "running",
    });
    logger.debug({ backtestId }, "sqa-registry: registered promise");
  }

  /**
   * Mark an entry as completed or failed (called from inside the SQA async task).
   * Allows future callers to skip the wait entirely if the promise already settled.
   */
  markSettled(backtestId: string, status: "completed" | "failed"): void {
    const entry = this._entries.get(backtestId);
    if (entry) {
      entry.status = status;
    }
  }

  // ─── awaitWithTimeout ────────────────────────────────────────────────────

  /**
   * Wait for the SQA promise for backtestId, bounded by the remaining time
   * budget (30 s hard cap minus elapsed since spawn).
   *
   * Returns null (no Optuna seed) when:
   *   - circuit is OPEN
   *   - no entry found (SQA was not spawned for this backtest)
   *   - wall-clock elapsed since spawn already exceeds 30 s
   *   - promise does not resolve within remaining budget
   *
   * On timeout increments the sliding-window counter and may trip the breaker.
   */
  async awaitWithTimeout(backtestId: string): Promise<unknown | null> {
    // Circuit check first — fast path
    if (this._isCircuitOpen()) {
      logger.debug({ backtestId }, "sqa-registry: circuit OPEN, skipping await");
      return null;
    }

    const entry = this._entries.get(backtestId);
    if (!entry) {
      logger.debug({ backtestId }, "sqa-registry: no entry for backtest, skipping await");
      return null;
    }

    const elapsed = Date.now() - entry.spawnedAt;
    if (elapsed >= SQA_AWAIT_TIMEOUT_MS) {
      logger.debug({ backtestId, elapsedMs: elapsed }, "sqa-registry: SQA already past 30s budget, skipping await");
      this._recordTimeout(backtestId);
      return null;
    }

    const remaining = SQA_AWAIT_TIMEOUT_MS - elapsed;

    try {
      const result = await Promise.race([
        entry.promise,
        new Promise<"__sqa_timeout__">((resolve) =>
          setTimeout(() => resolve("__sqa_timeout__"), remaining),
        ),
      ]);

      if (result === "__sqa_timeout__") {
        entry.status = "timedout";
        logger.warn({ backtestId, remainingMs: remaining, elapsedMs: elapsed }, "sqa-registry: await timed out");
        this._recordTimeout(backtestId);
        return null;
      }

      entry.status = "completed";
      logger.debug({ backtestId }, "sqa-registry: await resolved");
      return result;
    } catch (err) {
      entry.status = "failed";
      logger.warn({ backtestId, err }, "sqa-registry: promise rejected during await");
      return null;
    }
  }

  // ─── Circuit breaker ─────────────────────────────────────────────────────

  get circuitState(): SqaCircuitState {
    this._checkAutoClose();
    return this._cbState;
  }

  get openedAt(): number | null {
    return this._cbOpenedAt;
  }

  /** How many timeouts are in the current sliding window. */
  get slidingWindowCount(): number {
    this._pruneSlidingWindow();
    return this._timeoutTimestamps.length;
  }

  private _isCircuitOpen(): boolean {
    this._checkAutoClose();
    return this._cbState === "OPEN";
  }

  private _checkAutoClose(): void {
    if (this._cbState === "OPEN" && this._cbOpenedAt !== null) {
      if (Date.now() - this._cbOpenedAt >= SQA_CB_COOLDOWN_MS) {
        const prev = this._cbState;
        this._cbState = "CLOSED";
        this._cbOpenedAt = null;
        this._timeoutTimestamps.length = 0; // reset sliding window on auto-close
        logger.info({ prevState: prev }, "sqa-registry: circuit auto-closed after cooldown");
        this._writeAudit("quantum.sqa_circuit_breaker_closed", {
          reason: "cooldown_elapsed",
          cooldownMs: SQA_CB_COOLDOWN_MS,
        });
      }
    }
  }

  private _recordTimeout(backtestId: string): void {
    this._pruneSlidingWindow();
    this._timeoutTimestamps.push(Date.now());

    logger.warn(
      { backtestId, timeoutsInWindow: this._timeoutTimestamps.length, threshold: SQA_CB_THRESHOLD },
      "sqa-registry: timeout recorded in sliding window",
    );

    if (this._cbState === "CLOSED" && this._timeoutTimestamps.length >= SQA_CB_THRESHOLD) {
      this._cbState = "OPEN";
      this._cbOpenedAt = Date.now();
      logger.warn(
        {
          timeoutsInWindow: this._timeoutTimestamps.length,
          windowMs: SQA_CB_WINDOW_MS,
          cooldownMs: SQA_CB_COOLDOWN_MS,
        },
        "sqa-registry: circuit OPEN (timeout threshold reached)",
      );
      this._writeAudit("quantum.sqa_circuit_breaker_open", {
        reason: "timeout_threshold_reached",
        timeoutsInWindow: this._timeoutTimestamps.length,
        windowMs: SQA_CB_WINDOW_MS,
        cooldownMs: SQA_CB_COOLDOWN_MS,
        openedAt: new Date(this._cbOpenedAt).toISOString(),
        reopensAt: new Date(this._cbOpenedAt + SQA_CB_COOLDOWN_MS).toISOString(),
      });
    }
  }

  private _pruneSlidingWindow(): void {
    const cutoff = Date.now() - SQA_CB_WINDOW_MS;
    let i = 0;
    while (i < this._timeoutTimestamps.length && this._timeoutTimestamps[i] < cutoff) {
      i++;
    }
    if (i > 0) this._timeoutTimestamps.splice(0, i);
  }

  // ─── TTL pruning ─────────────────────────────────────────────────────────

  private _prune(): void {
    const cutoff = Date.now() - SQA_TTL_MS;
    for (const [id, entry] of this._entries) {
      if (entry.spawnedAt < cutoff) {
        this._entries.delete(id);
      }
    }
  }

  // ─── Audit writer ─────────────────────────────────────────────────────────

  private _writeAudit(action: string, details: Record<string, unknown>): void {
    if (!this._auditWriter) return;
    this._auditWriter({
      action,
      entityType: "sqa_circuit_breaker",
      entityId: null,
      input: details,
      result: { state: this._cbState },
      status: "success",
      decisionAuthority: "gate",
    }).catch((err) => {
      logger.error({ err, action }, "sqa-registry: audit write failed");
    });
  }

  // ─── Diagnostics ─────────────────────────────────────────────────────────

  status(): {
    circuitState: SqaCircuitState;
    openedAt: string | null;
    reopensAt: string | null;
    timeoutsInWindow: number;
    entryCount: number;
  } {
    this._pruneSlidingWindow();
    this._checkAutoClose();
    return {
      circuitState: this._cbState,
      openedAt: this._cbOpenedAt ? new Date(this._cbOpenedAt).toISOString() : null,
      reopensAt:
        this._cbState === "OPEN" && this._cbOpenedAt
          ? new Date(this._cbOpenedAt + SQA_CB_COOLDOWN_MS).toISOString()
          : null,
      timeoutsInWindow: this._timeoutTimestamps.length,
      entryCount: this._entries.size,
    };
  }

  /** Reset all state — for tests only. */
  _resetForTests(): void {
    this._entries.clear();
    this._cbState = "CLOSED";
    this._cbOpenedAt = null;
    this._timeoutTimestamps.length = 0;
    this._auditWriter = null;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Process-level singleton registry.
 * Imported by backtest-service (register) and critic-optimizer-service (awaitWithTimeout).
 */
export const sqaRegistry = new SqaPromiseRegistry();
