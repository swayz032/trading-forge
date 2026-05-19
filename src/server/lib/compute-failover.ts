/**
 * Compute Failover — B6 cloud failover for compute (free-tier first).
 *
 * Monitors local Python subprocess availability on a 30-second interval.
 * Advances a state machine from LOCAL_HEALTHY → DEGRADED → CLOUD_FAILOVER
 * after 3 consecutive health-check failures. Recovers back to LOCAL_HEALTHY
 * after 5 consecutive successful local pings.
 *
 * Cloud target: Railway free tier ($5/mo credit, emergency-only) via HTTP.
 * Manual override: FORCE_CLOUD_COMPUTE=true bypasses the health check.
 *
 * This module never mutates business logic or gates backtest results. It is
 * a routing advisory: callers ask getComputeTarget() and direct their work
 * accordingly.
 */

import { logger } from "./logger.js";
import { runPythonModule } from "./python-runner.js";
import { broadcastSSE } from "../routes/sse.js";

// ─── State machine ────────────────────────────────────────────────────────────

export type ComputeState =
  | "LOCAL_HEALTHY"   // local Python is responsive — normal ops
  | "DEGRADED"        // 1–2 consecutive local failures — monitoring closely
  | "CLOUD_FAILOVER"; // 3+ consecutive failures — routed to cloud

export type ComputeTarget = "local" | "cloud";

// Thresholds
const FAILURE_THRESHOLD = 3;     // consecutive failures to trip to CLOUD_FAILOVER
const RECOVERY_THRESHOLD = 5;    // consecutive successes to return to LOCAL_HEALTHY
const HEALTH_CHECK_INTERVAL_MS = 30_000; // ping local every 30 s

// State
let _state: ComputeState = "LOCAL_HEALTHY";
let _consecutiveFailures = 0;
let _consecutiveSuccesses = 0;
let _lastCheckedAt: Date | null = null;
let _lastFailureReason: string | null = null;
let _failoverTriggeredAt: Date | null = null;
let _healthCheckTimer: ReturnType<typeof setInterval> | null = null;
let _initialized = false;

// ─── Manual override ──────────────────────────────────────────────────────────

/** Returns true when FORCE_CLOUD_COMPUTE=true is set in the environment. */
function isForceCloud(): boolean {
  return process.env.FORCE_CLOUD_COMPUTE === "true";
}

// ─── Cloud endpoint config ────────────────────────────────────────────────────

/** Railway free-tier base URL. Set RAILWAY_COMPUTE_URL to enable cloud routing. */
function getCloudBaseUrl(): string | null {
  return process.env.RAILWAY_COMPUTE_URL ?? null;
}

// ─── Health check (ping local Python) ────────────────────────────────────────

/**
 * Probe local Python availability with a minimal no-op script.
 * Returns true if Python responds within 5 s.
 */
async function probeLocalPython(): Promise<{ healthy: boolean; reason?: string }> {
  const PROBE_TIMEOUT_MS = 5_000;
  try {
    await runPythonModule({
      scriptCode: "import sys; import json; print(json.dumps({'status':'ok'}))",
      timeoutMs: PROBE_TIMEOUT_MS,
      componentName: "compute-failover-probe",
    });
    return { healthy: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { healthy: false, reason };
  }
}

// ─── State machine transitions ────────────────────────────────────────────────

function transitionTo(next: ComputeState, reason?: string): void {
  if (_state === next) return;

  const prev = _state;
  _state = next;

  logger.warn(
    {
      event: "compute_failover.state_transition",
      prev,
      next,
      consecutiveFailures: _consecutiveFailures,
      consecutiveSuccesses: _consecutiveSuccesses,
      reason: reason ?? null,
      forceCloud: isForceCloud(),
    },
    `ComputeFailover: ${prev} → ${next}`,
  );

  if (next === "CLOUD_FAILOVER") {
    _failoverTriggeredAt = new Date();
  } else if (next === "LOCAL_HEALTHY") {
    _failoverTriggeredAt = null;
  }

  // Broadcast SSE so the dashboard reflects the mode change in real-time
  broadcastSSE("compute:failover-state-change", {
    prev,
    next,
    consecutiveFailures: _consecutiveFailures,
    consecutiveSuccesses: _consecutiveSuccesses,
    reason: reason ?? null,
    timestamp: new Date().toISOString(),
  });
}

function onHealthCheckSuccess(): void {
  _lastCheckedAt = new Date();
  _consecutiveFailures = 0;
  _consecutiveSuccesses++;
  _lastFailureReason = null;

  if (_state === "CLOUD_FAILOVER" || _state === "DEGRADED") {
    if (_consecutiveSuccesses >= RECOVERY_THRESHOLD) {
      transitionTo("LOCAL_HEALTHY", "local Python recovered");
    }
  }
  // LOCAL_HEALTHY → stay LOCAL_HEALTHY (no-op, keep counters)
}

function onHealthCheckFailure(reason: string): void {
  _lastCheckedAt = new Date();
  _consecutiveFailures++;
  _consecutiveSuccesses = 0;
  _lastFailureReason = reason;

  logger.warn(
    {
      event: "compute_failover.health_check_failed",
      consecutiveFailures: _consecutiveFailures,
      failureThreshold: FAILURE_THRESHOLD,
      reason,
      currentState: _state,
    },
    `ComputeFailover: local Python probe failed (${_consecutiveFailures}/${FAILURE_THRESHOLD})`,
  );

  if (_state === "LOCAL_HEALTHY") {
    if (_consecutiveFailures >= 2) {
      transitionTo("DEGRADED", reason);
    }
    // 1st failure: stay LOCAL_HEALTHY, just log
  } else if (_state === "DEGRADED") {
    if (_consecutiveFailures >= FAILURE_THRESHOLD) {
      transitionTo("CLOUD_FAILOVER", reason);
    }
  }
  // CLOUD_FAILOVER: already there — keep accumulating, not re-transitioning
}

// ─── Health check loop ────────────────────────────────────────────────────────

async function runHealthCheck(): Promise<void> {
  // Skip probe when force-cloud is active — no point probing local
  if (isForceCloud()) {
    if (_state !== "CLOUD_FAILOVER") {
      transitionTo("CLOUD_FAILOVER", "FORCE_CLOUD_COMPUTE=true");
    }
    return;
  }

  const { healthy, reason } = await probeLocalPython();
  if (healthy) {
    onHealthCheckSuccess();
  } else {
    onHealthCheckFailure(reason ?? "probe failed");
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the health-check polling loop.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startComputeFailoverMonitor(): void {
  if (_initialized) return;
  _initialized = true;

  if (isForceCloud()) {
    logger.warn(
      { event: "compute_failover.force_cloud_active" },
      "ComputeFailover: FORCE_CLOUD_COMPUTE=true — routing all compute to cloud from startup",
    );
    transitionTo("CLOUD_FAILOVER", "FORCE_CLOUD_COMPUTE=true");
  }

  // Run one probe at startup to establish initial state
  runHealthCheck().catch((err) => {
    logger.error({ err, event: "compute_failover.startup_probe_error" }, "ComputeFailover: startup probe threw unexpectedly");
  });

  _healthCheckTimer = setInterval(() => {
    runHealthCheck().catch((err) => {
      logger.error({ err, event: "compute_failover.health_check_error" }, "ComputeFailover: health check threw unexpectedly");
    });
  }, HEALTH_CHECK_INTERVAL_MS);

  logger.info(
    {
      event: "compute_failover.monitor_started",
      intervalMs: HEALTH_CHECK_INTERVAL_MS,
      failureThreshold: FAILURE_THRESHOLD,
      recoveryThreshold: RECOVERY_THRESHOLD,
      forceCloud: isForceCloud(),
      cloudBaseUrl: getCloudBaseUrl() ?? "(not configured)",
    },
    "ComputeFailover: health-check monitor started",
  );
}

/**
 * Stop the health-check polling loop.
 * Called during server shutdown.
 */
export function stopComputeFailoverMonitor(): void {
  if (_healthCheckTimer !== null) {
    clearInterval(_healthCheckTimer);
    _healthCheckTimer = null;
  }
  _initialized = false;
  logger.info({ event: "compute_failover.monitor_stopped" }, "ComputeFailover: monitor stopped");
}

/**
 * Current compute state.
 */
export function getComputeState(): ComputeState {
  if (isForceCloud()) return "CLOUD_FAILOVER";
  return _state;
}

/**
 * Where should this caller send compute work?
 * Returns "local" when LOCAL_HEALTHY or DEGRADED (still trying local).
 * Returns "cloud" when CLOUD_FAILOVER or FORCE_CLOUD_COMPUTE=true.
 */
export function getComputeTarget(): ComputeTarget {
  const state = getComputeState();
  if (state === "CLOUD_FAILOVER") return "cloud";
  return "local";
}

/**
 * Diagnostic snapshot — surfaced in health endpoint and isActive() payload.
 */
export interface ComputeFailoverStatus {
  state: ComputeState;
  target: ComputeTarget;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: string | null;
  lastFailureReason: string | null;
  failoverTriggeredAt: string | null;
  forceCloud: boolean;
  cloudConfigured: boolean;
  cloudBaseUrl: string | null;
}

export function getComputeFailoverStatus(): ComputeFailoverStatus {
  return {
    state: getComputeState(),
    target: getComputeTarget(),
    consecutiveFailures: _consecutiveFailures,
    consecutiveSuccesses: _consecutiveSuccesses,
    lastCheckedAt: _lastCheckedAt?.toISOString() ?? null,
    lastFailureReason: _lastFailureReason,
    failoverTriggeredAt: _failoverTriggeredAt?.toISOString() ?? null,
    forceCloud: isForceCloud(),
    cloudConfigured: getCloudBaseUrl() !== null,
    cloudBaseUrl: getCloudBaseUrl(),
  };
}

/**
 * Submit a backtest job payload to the Railway cloud compute endpoint.
 * Fire-and-forget: resolves true if accepted (2xx), false otherwise.
 *
 * The cloud endpoint is responsible for running the backtest and writing
 * results back to the shared Railway PostgreSQL database — same DB both
 * Skytech and Railway can reach.
 *
 * Callers should only invoke this when getComputeTarget() === "cloud".
 * When cloudBaseUrl is not configured, logs a warning and returns false
 * (no silent cloud submission without an explicit endpoint).
 */
export async function submitToCloud(
  jobType: "backtest" | "paper_signal",
  payload: Record<string, unknown>,
): Promise<{ submitted: boolean; reason: string }> {
  const baseUrl = getCloudBaseUrl();
  if (!baseUrl) {
    logger.warn(
      { event: "compute_failover.cloud_submit_skipped", jobType, reason: "RAILWAY_COMPUTE_URL not configured" },
      "ComputeFailover: cloud submission skipped — RAILWAY_COMPUTE_URL not set",
    );
    return { submitted: false, reason: "RAILWAY_COMPUTE_URL not configured" };
  }

  const endpoint = `${baseUrl}/api/compute/${jobType}`;
  const SUBMIT_TIMEOUT_MS = 10_000;

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), SUBMIT_TIMEOUT_MS);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(tid);

    if (res.ok) {
      logger.info(
        { event: "compute_failover.cloud_submit_ok", jobType, endpoint, status: res.status },
        "ComputeFailover: job accepted by cloud endpoint",
      );
      return { submitted: true, reason: `accepted by ${endpoint} (${res.status})` };
    } else {
      const text = await res.text().catch(() => "");
      logger.warn(
        { event: "compute_failover.cloud_submit_rejected", jobType, endpoint, status: res.status, body: text },
        "ComputeFailover: cloud endpoint rejected job",
      );
      return { submitted: false, reason: `rejected: HTTP ${res.status}` };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(
      { event: "compute_failover.cloud_submit_error", jobType, endpoint, reason },
      "ComputeFailover: cloud submission failed",
    );
    return { submitted: false, reason };
  }
}

/**
 * Test-only: reset state machine to initial values.
 * DO NOT call in production code.
 */
export function _resetForTests(): void {
  stopComputeFailoverMonitor();
  _state = "LOCAL_HEALTHY";
  _consecutiveFailures = 0;
  _consecutiveSuccesses = 0;
  _lastCheckedAt = null;
  _lastFailureReason = null;
  _failoverTriggeredAt = null;
  _initialized = false;
}
