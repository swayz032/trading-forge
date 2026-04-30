/**
 * Circuit Breaker — prevents cascade failures when an endpoint hangs or fails.
 *
 * States:
 *   CLOSED   — normal operation; failures are counted
 *   OPEN     — endpoint is dark; requests rejected immediately for cooldownMs
 *   HALF_OPEN — one probe request allowed; success → CLOSED, failure → OPEN again
 *
 * Tuning:
 *   failureThreshold  — consecutive failures before tripping (default: 3)
 *   cooldownMs        — how long to stay OPEN before probing (default: 30_000 ms)
 *
 * Usage:
 *   const cb = CircuitBreakerRegistry.get("ollama");
 *   const result = await cb.call(() => fetch(...));
 *   // throws CircuitOpenError if open, or propagates endpoint errors
 */

import { logger } from "./logger.js";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitOpenError extends Error {
  public readonly endpoint: string;
  public readonly openedAt: Date;
  public readonly reopensAt: Date;

  constructor(endpoint: string, openedAt: Date, cooldownMs: number) {
    const reopensAt = new Date(openedAt.getTime() + cooldownMs);
    super(
      `Circuit OPEN for endpoint "${endpoint}" — opened at ${openedAt.toISOString()}, ` +
      `probe allowed after ${reopensAt.toISOString()}`,
    );
    this.name = "CircuitOpenError";
    this.endpoint = endpoint;
    this.openedAt = openedAt;
    this.reopensAt = reopensAt;
  }
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
}

export class CircuitBreaker {
  public readonly endpoint: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt: Date | null = null;
  private probeInFlight = false;

  constructor(endpoint: string, options: CircuitBreakerOptions = {}) {
    this.endpoint = endpoint;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /**
   * Execute a callable through the circuit breaker.
   * Throws CircuitOpenError immediately when OPEN and cooldown has not elapsed.
   * Allows exactly one probe when HALF_OPEN.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.checkTransitionToHalfOpen();

    if (this.state === "OPEN") {
      throw new CircuitOpenError(this.endpoint, this.openedAt!, this.cooldownMs);
    }

    if (this.state === "HALF_OPEN") {
      if (this.probeInFlight) {
        // A probe is already in flight — reject to avoid concurrent probes
        throw new CircuitOpenError(this.endpoint, this.openedAt!, this.cooldownMs);
      }
      this.probeInFlight = true;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    } finally {
      // Clear probe flag unless the circuit re-opened during the probe attempt.
      // Cast through string to defeat TypeScript's narrowing — state can mutate
      // inside onFailure() which TypeScript doesn't track across async boundaries.
      if ((this.state as string) !== "OPEN") {
        this.probeInFlight = false;
      }
    }
  }

  private checkTransitionToHalfOpen(): void {
    if (this.state === "OPEN" && this.openedAt != null) {
      const elapsed = Date.now() - this.openedAt.getTime();
      if (elapsed >= this.cooldownMs) {
        const from = this.state;
        this.state = "HALF_OPEN";
        this.probeInFlight = false;
        logger.warn(
          { endpoint: this.endpoint, openedAt: this.openedAt.toISOString(), elapsedMs: elapsed },
          "CircuitBreaker: OPEN → HALF_OPEN (cooldown elapsed, probing)",
        );
        CircuitBreakerRegistry._notifyStateChange(this.endpoint, from, "HALF_OPEN");
      }
    }
  }

  private onSuccess(): void {
    const from = this.state;
    if (this.state === "HALF_OPEN") {
      logger.info(
        { endpoint: this.endpoint, previousFailures: this.consecutiveFailures },
        "CircuitBreaker: HALF_OPEN → CLOSED (probe succeeded)",
      );
    }
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.openedAt = null;
    if (from !== "CLOSED") {
      CircuitBreakerRegistry._notifyStateChange(this.endpoint, from, "CLOSED");
    }
  }

  private onFailure(err: unknown): void {
    this.consecutiveFailures++;
    const errMsg = err instanceof Error ? err.message : String(err);

    if (this.state === "HALF_OPEN") {
      // Probe failed — reopen for another cooldown period
      this.openedAt = new Date();
      this.state = "OPEN";
      this.probeInFlight = false;
      logger.warn(
        { endpoint: this.endpoint, error: errMsg, cooldownMs: this.cooldownMs },
        "CircuitBreaker: HALF_OPEN → OPEN (probe failed, reopening)",
      );
      CircuitBreakerRegistry._notifyStateChange(this.endpoint, "HALF_OPEN", "OPEN");
      return;
    }

    if (this.consecutiveFailures >= this.failureThreshold) {
      const from = this.state;
      this.openedAt = new Date();
      this.state = "OPEN";
      logger.warn(
        {
          endpoint: this.endpoint,
          consecutiveFailures: this.consecutiveFailures,
          threshold: this.failureThreshold,
          cooldownMs: this.cooldownMs,
          error: errMsg,
        },
        "CircuitBreaker: CLOSED → OPEN (failure threshold reached)",
      );
      CircuitBreakerRegistry._notifyStateChange(this.endpoint, from, "OPEN");
    } else {
      logger.warn(
        {
          endpoint: this.endpoint,
          consecutiveFailures: this.consecutiveFailures,
          threshold: this.failureThreshold,
          error: errMsg,
        },
        "CircuitBreaker: failure recorded",
      );
    }
  }

  /** Diagnostic snapshot — useful for health checks. */
  status(): {
    endpoint: string;
    state: CircuitState;
    consecutiveFailures: number;
    openedAt: string | null;
    reopensAt: string | null;
  } {
    const reopensAt =
      this.state === "OPEN" && this.openedAt != null
        ? new Date(this.openedAt.getTime() + this.cooldownMs).toISOString()
        : null;

    return {
      endpoint: this.endpoint,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt?.toISOString() ?? null,
      reopensAt,
    };
  }
}

/**
 * Process-wide registry: one CircuitBreaker per endpoint key.
 * Use stable, descriptive keys (e.g. "ollama", "openai").
 */
export class CircuitBreakerRegistry {
  private static readonly _breakers = new Map<string, CircuitBreaker>();
  private static _onStateChange: ((name: string, from: string, to: string) => void) | null = null;

  /**
   * Register a callback invoked whenever any breaker transitions state.
   * Only one callback is supported — last call wins.
   */
  static setOnStateChange(cb: (name: string, from: string, to: string) => void): void {
    this._onStateChange = cb;
  }

  /** Fire the onStateChange callback (called by CircuitBreaker instances). */
  static _notifyStateChange(name: string, from: string, to: string): void {
    if (this._onStateChange) {
      try {
        this._onStateChange(name, from, to);
      } catch (err) {
        logger.error({ err, breaker: name, from, to }, "CircuitBreaker onStateChange callback error");
      }
    }
  }

  static get(endpoint: string, options?: CircuitBreakerOptions): CircuitBreaker {
    if (!this._breakers.has(endpoint)) {
      this._breakers.set(endpoint, new CircuitBreaker(endpoint, options));
    }
    return this._breakers.get(endpoint)!;
  }

  /** Returns status snapshots for all registered breakers (health check endpoint). */
  static statusAll(): ReturnType<CircuitBreaker["status"]>[] {
    return [...this._breakers.values()].map((cb) => cb.status());
  }

  /** Remove all breakers — intended for tests only. */
  static _resetForTests(): void {
    this._breakers.clear();
    this._onStateChange = null;
  }
}
