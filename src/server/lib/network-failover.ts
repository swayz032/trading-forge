/**
 * C4 — Network Failover via Phone USB Tethering (W16 Team A)
 *
 * Primary defense: server-side order placement (broker holds orders, not local).
 * Secondary defense: phone USB tethering (zero extra cost — uses existing plan).
 * Tertiary defense: Railway cloud failover (B6, $20/mo paid plan).
 *
 * Architecture:
 *   - Health check probes broker API reachability every 30 s on the primary ISP.
 *   - After FAILURE_THRESHOLD consecutive probe failures, fires SSE + alert.
 *   - Operator is notified to enable USB tethering (manual step — requires physical phone).
 *   - Module CANNOT auto-switch NICs; Windows NIC selection is OS-level.
 *     What it CAN do: detect connectivity loss and surface the right alert so
 *     the operator knows WHICH action to take (tether, not reboot, not wait).
 *   - FORCE_USB_TETHERING=true env var simulates tethering-active state for testing.
 *
 * State machine:
 *   PRIMARY_HEALTHY   — broker APIs reachable on primary ISP
 *   DEGRADED          — 1-2 consecutive probe failures — monitoring closely
 *   FAILOVER_ALERT    — 3+ consecutive failures — SSE + critical alert fires;
 *                       operator must enable USB tethering
 *   TETHERING_ACTIVE  — FORCE_USB_TETHERING=true (test) OR operator confirms
 *                       via POST /api/admin/network-failover/confirm-tethering
 *   RECOVERED         — probes pass again; operator clears confirm
 *
 * Broker API connectivity probes:
 *   Primary target: Tradovate API (https://live.tradovateapi.com/v1/auth/accesstokenrequest)
 *   Secondary target: RITHMIC (configurable via RITHMIC_STATUS_URL env var)
 *   Fallback probe: DNS resolution of 8.8.8.8 (confirms basic IP connectivity)
 *
 * Cost: $0 added. Phone USB tethering uses existing phone plan.
 *       Trading API traffic is low-bandwidth (KB/s), not a meaningful data draw.
 *
 * Paper parity note: network failover does NOT affect paper execution logic.
 *   Paper fills, slippage, session classification, and journal writes are
 *   unchanged by ISP state. This module is a connectivity OBSERVATION layer,
 *   not an execution modifier. Promotion-gate inputs remain undistorted.
 *
 * Drain policy: if in FAILOVER_ALERT state, paper-execution-service will log
 *   a connectivity warning alongside every new order attempt. Orders are NOT
 *   blocked — that would distort promotion inputs. The warning is journaled
 *   so post-session analysis can filter trades taken during network degradation.
 */

import { logger } from "./logger.js";
import { broadcastSSE } from "../routes/sse.js";
import { AlertFactory } from "../services/alert-service.js";

// ─── State machine ────────────────────────────────────────────────────────────

export type NetworkState =
  | "PRIMARY_HEALTHY"   // primary ISP reachable — normal ops
  | "DEGRADED"          // 1-2 consecutive probe failures — monitoring
  | "FAILOVER_ALERT"    // 3+ failures — USB tethering recommended
  | "TETHERING_ACTIVE"  // USB tethering confirmed active (env or API call)
  | "RECOVERED";        // probes pass again; waiting for operator clear

// ─── Thresholds ───────────────────────────────────────────────────────────────

const FAILURE_THRESHOLD = 3;     // consecutive probe failures → FAILOVER_ALERT
const RECOVERY_THRESHOLD = 3;    // consecutive probe passes → RECOVERED
const HEALTH_CHECK_INTERVAL_MS = 30_000; // probe broker APIs every 30 s

// ─── Broker probe URLs ────────────────────────────────────────────────────────

// Tradovate live API heartbeat — primary broker target.
// HEAD request to avoid any account-side side effects.
const TRADOVATE_PROBE_URL =
  process.env.TRADOVATE_STATUS_URL ??
  "https://live.tradovateapi.com/v1/auth/accesstokenrequest";

// Rithmic WebSocket gateway health — secondary broker target (optional).
const RITHMIC_PROBE_URL =
  process.env.RITHMIC_STATUS_URL ??
  "https://rithmic.com/status"; // configurable; absent = skip

// DNS-level fallback: checks basic IP connectivity rather than broker reachability.
// Using Cloudflare 1.1.1.1 (fetch to well-known URL resolves via OS DNS).
const DNS_FALLBACK_URL = "https://1.1.1.1";

const PROBE_TIMEOUT_MS = 8_000;

// ─── State ────────────────────────────────────────────────────────────────────

let _state: NetworkState = "PRIMARY_HEALTHY";
let _consecutiveFailures = 0;
let _consecutiveSuccesses = 0;
let _lastCheckedAt: Date | null = null;
let _lastFailureReason: string | null = null;
let _failoverAlertTriggeredAt: Date | null = null;
let _tetheringConfirmedAt: Date | null = null;
let _tetheringConfirmedBy: string | null = null;
let _healthCheckTimer: ReturnType<typeof setInterval> | null = null;
let _initialized = false;

// ─── USB tethering override ───────────────────────────────────────────────────

/**
 * Returns true when FORCE_USB_TETHERING=true is set (test/simulation mode)
 * OR when the operator has confirmed tethering via the admin API.
 */
export function isTetherActive(): boolean {
  return process.env.FORCE_USB_TETHERING === "true" ||
    _state === "TETHERING_ACTIVE";
}

/**
 * Operator confirms USB tethering is active (called via POST /api/admin/network-failover/confirm-tethering).
 * Transitions state to TETHERING_ACTIVE and writes SSE so the dashboard reflects it.
 */
export function confirmTethering(confirmedBy: string = "operator"): void {
  _tetheringConfirmedAt = new Date();
  _tetheringConfirmedBy = confirmedBy;
  transitionTo("TETHERING_ACTIVE", `USB tethering confirmed by ${confirmedBy}`);
  logger.warn(
    {
      event: "network_failover.tethering_confirmed",
      confirmedBy,
      confirmedAt: _tetheringConfirmedAt.toISOString(),
    },
    "NetworkFailover: USB tethering confirmed active by operator",
  );
}

/**
 * Operator clears the tethering confirmation (back to normal ISP).
 * Typically called after probes have been passing for a while.
 */
export function clearTetherConfirmation(): void {
  _tetheringConfirmedAt = null;
  _tetheringConfirmedBy = null;
  if (_state === "TETHERING_ACTIVE" || _state === "RECOVERED") {
    transitionTo("PRIMARY_HEALTHY", "tethering cleared by operator");
  }
}

// ─── Probe logic ──────────────────────────────────────────────────────────────

/**
 * Probe a single URL with a HEAD or GET request.
 * Returns true if HTTP response is received (any status code — we just need connectivity).
 * Returns false on network error or timeout.
 */
async function probeUrl(url: string): Promise<{ reachable: boolean; reason?: string }> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: "HEAD",
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    return { reachable: true };
  } catch (err) {
    clearTimeout(tid);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const reason = isAbort
      ? `probe timed out (${PROBE_TIMEOUT_MS}ms)`
      : (err instanceof Error ? err.message : String(err));
    return { reachable: false, reason };
  }
}

/**
 * Full connectivity health check.
 *
 * Probe order:
 *   1. Tradovate API (primary broker)
 *   2. Rithmic status (if RITHMIC_STATUS_URL configured)
 *   3. DNS fallback (1.1.1.1) — distinguishes "broker down" from "no internet"
 *
 * Returns healthy=true if ANY broker probe passes (we can reach the broker).
 * If all broker probes fail but DNS fallback passes, returns a "broker unreachable"
 * reason so the alert message distinguishes "ISP down" from "broker down".
 */
export async function checkPrimaryConnectivity(): Promise<{
  healthy: boolean;
  reason?: string;
  detail?: Record<string, unknown>;
}> {
  // Probe Tradovate (primary broker)
  const tradovate = await probeUrl(TRADOVATE_PROBE_URL);
  if (tradovate.reachable) {
    return {
      healthy: true,
      detail: { tradovate: "reachable" },
    };
  }

  // Tradovate unreachable — try Rithmic if configured
  if (RITHMIC_PROBE_URL && RITHMIC_PROBE_URL !== "https://rithmic.com/status") {
    const rithmic = await probeUrl(RITHMIC_PROBE_URL);
    if (rithmic.reachable) {
      return {
        healthy: true,
        detail: { tradovate: tradovate.reason, rithmic: "reachable" },
      };
    }
  }

  // All broker probes failed — try DNS fallback to distinguish ISP vs broker
  const dns = await probeUrl(DNS_FALLBACK_URL);
  if (dns.reachable) {
    // Internet is up but brokers are unreachable — broker-side issue, not ISP
    return {
      healthy: false,
      reason: "Broker APIs unreachable (Tradovate down). Internet connectivity OK. Not an ISP issue — USB tethering will NOT help. Wait for broker recovery.",
      detail: {
        tradovate: tradovate.reason,
        dns: "reachable",
        classification: "broker_side_outage",
      },
    };
  }

  // Full connectivity loss — primary ISP is down
  return {
    healthy: false,
    reason: `Primary ISP connectivity lost. Tradovate probe: ${tradovate.reason ?? "failed"}. DNS fallback: ${dns.reason ?? "failed"}. Enable USB tethering now.`,
    detail: {
      tradovate: tradovate.reason,
      dns: dns.reason,
      classification: "isp_outage",
    },
  };
}

// ─── State machine transitions ────────────────────────────────────────────────

function transitionTo(next: NetworkState, reason?: string): void {
  if (_state === next) return;
  const prev = _state;
  _state = next;

  logger.warn(
    {
      event: "network_failover.state_transition",
      prev,
      next,
      consecutiveFailures: _consecutiveFailures,
      consecutiveSuccesses: _consecutiveSuccesses,
      reason: reason ?? null,
    },
    `NetworkFailover: ${prev} → ${next}`,
  );

  if (next === "FAILOVER_ALERT") {
    _failoverAlertTriggeredAt = new Date();
  } else if (next === "PRIMARY_HEALTHY" || next === "RECOVERED") {
    _failoverAlertTriggeredAt = null;
  }

  broadcastSSE("network:failover-state-change", {
    prev,
    next,
    consecutiveFailures: _consecutiveFailures,
    consecutiveSuccesses: _consecutiveSuccesses,
    reason: reason ?? null,
    timestamp: new Date().toISOString(),
  });
}

function onProbeSuccess(): void {
  _lastCheckedAt = new Date();
  _consecutiveFailures = 0;
  _consecutiveSuccesses++;
  _lastFailureReason = null;

  if (_state === "FAILOVER_ALERT" || _state === "DEGRADED") {
    if (_consecutiveSuccesses >= RECOVERY_THRESHOLD) {
      transitionTo("RECOVERED", "primary ISP connectivity restored");
    }
  } else if (_state === "TETHERING_ACTIVE") {
    if (_consecutiveSuccesses >= RECOVERY_THRESHOLD) {
      transitionTo("RECOVERED", "primary ISP connectivity restored — tethering still active until operator clears");
    }
  }
  // PRIMARY_HEALTHY / RECOVERED → no-op
}

function onProbeFailure(reason: string, detail?: Record<string, unknown>): void {
  _lastCheckedAt = new Date();
  _consecutiveFailures++;
  _consecutiveSuccesses = 0;
  _lastFailureReason = reason;

  logger.warn(
    {
      event: "network_failover.probe_failed",
      consecutiveFailures: _consecutiveFailures,
      failureThreshold: FAILURE_THRESHOLD,
      reason,
      detail,
      currentState: _state,
    },
    `NetworkFailover: connectivity probe failed (${_consecutiveFailures}/${FAILURE_THRESHOLD})`,
  );

  if (_state === "PRIMARY_HEALTHY" || _state === "RECOVERED") {
    if (_consecutiveFailures >= 2) {
      transitionTo("DEGRADED", reason);
    }
    // 1st failure: log but stay in current state
  } else if (_state === "DEGRADED") {
    if (_consecutiveFailures >= FAILURE_THRESHOLD) {
      transitionTo("FAILOVER_ALERT", reason);

      // Critical alert — operator needs to act
      const isIspOutage = detail?.classification === "isp_outage";
      const alertMsg = isIspOutage
        ? `Primary ISP connectivity lost after ${_consecutiveFailures} consecutive probe failures. Enable USB tethering NOW. See infra/network-redundancy.md for steps.`
        : `Broker API unreachable after ${_consecutiveFailures} probe failures. Check broker status. USB tethering may not help (broker-side issue). Details: ${reason}`;

      AlertFactory.systemError(
        "network-connectivity-lost",
        new Error(alertMsg),
      );
    }
  }
  // FAILOVER_ALERT / TETHERING_ACTIVE: already alerted, accumulate for recovery detection
}

// ─── Health check loop ────────────────────────────────────────────────────────

async function runHealthCheck(): Promise<void> {
  if (process.env.FORCE_USB_TETHERING === "true") {
    if (_state !== "TETHERING_ACTIVE") {
      transitionTo("TETHERING_ACTIVE", "FORCE_USB_TETHERING=true");
    }
    return;
  }

  const result = await checkPrimaryConnectivity();
  if (result.healthy) {
    onProbeSuccess();
  } else {
    onProbeFailure(result.reason ?? "probe failed", result.detail);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the network health-check polling loop.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startNetworkFailoverMonitor(): void {
  if (_initialized) return;
  _initialized = true;

  if (process.env.FORCE_USB_TETHERING === "true") {
    logger.warn(
      { event: "network_failover.force_tethering_active" },
      "NetworkFailover: FORCE_USB_TETHERING=true — simulating tethering-active from startup",
    );
    transitionTo("TETHERING_ACTIVE", "FORCE_USB_TETHERING=true");
  }

  // Startup probe — establish initial state before first interval fires
  runHealthCheck().catch((err) => {
    logger.error({ err, event: "network_failover.startup_probe_error" }, "NetworkFailover: startup probe threw unexpectedly");
  });

  _healthCheckTimer = setInterval(() => {
    runHealthCheck().catch((err) => {
      logger.error({ err, event: "network_failover.health_check_error" }, "NetworkFailover: health check threw unexpectedly");
    });
  }, HEALTH_CHECK_INTERVAL_MS);

  logger.info(
    {
      event: "network_failover.monitor_started",
      intervalMs: HEALTH_CHECK_INTERVAL_MS,
      failureThreshold: FAILURE_THRESHOLD,
      recoveryThreshold: RECOVERY_THRESHOLD,
      tradovateProbe: TRADOVATE_PROBE_URL,
    },
    "NetworkFailover: health-check monitor started",
  );
}

/**
 * Stop the health-check polling loop.
 * Called during server shutdown.
 */
export function stopNetworkFailoverMonitor(): void {
  if (_healthCheckTimer !== null) {
    clearInterval(_healthCheckTimer);
    _healthCheckTimer = null;
  }
  _initialized = false;
  logger.info({ event: "network_failover.monitor_stopped" }, "NetworkFailover: monitor stopped");
}

/**
 * Current network connectivity state.
 */
export function getNetworkState(): NetworkState {
  if (process.env.FORCE_USB_TETHERING === "true") return "TETHERING_ACTIVE";
  return _state;
}

/**
 * Returns true if the system is in a connectivity-degraded state
 * (FAILOVER_ALERT or TETHERING_ACTIVE). Callers use this to annotate
 * orders with a connectivity warning in the journal.
 *
 * Does NOT block orders — paper execution continues regardless.
 * Parity note: blocking orders on network degradation would distort
 * promotion-gate inputs. The journal annotation is the correct path.
 */
export function isConnectivityDegraded(): boolean {
  const s = getNetworkState();
  return s === "FAILOVER_ALERT" || s === "DEGRADED";
}

/**
 * Diagnostic snapshot — surfaced in health endpoint.
 */
export interface NetworkFailoverStatus {
  state: NetworkState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: string | null;
  lastFailureReason: string | null;
  failoverAlertTriggeredAt: string | null;
  tetheringConfirmedAt: string | null;
  tetheringConfirmedBy: string | null;
  connectivityDegraded: boolean;
  tradovateProbeUrl: string;
}

export function getNetworkFailoverStatus(): NetworkFailoverStatus {
  return {
    state: getNetworkState(),
    consecutiveFailures: _consecutiveFailures,
    consecutiveSuccesses: _consecutiveSuccesses,
    lastCheckedAt: _lastCheckedAt?.toISOString() ?? null,
    lastFailureReason: _lastFailureReason,
    failoverAlertTriggeredAt: _failoverAlertTriggeredAt?.toISOString() ?? null,
    tetheringConfirmedAt: _tetheringConfirmedAt?.toISOString() ?? null,
    tetheringConfirmedBy: _tetheringConfirmedBy,
    connectivityDegraded: isConnectivityDegraded(),
    tradovateProbeUrl: TRADOVATE_PROBE_URL,
  };
}

/**
 * Test-only: reset state machine to initial values.
 * DO NOT call in production code.
 */
export function _resetNetworkFailoverForTests(): void {
  stopNetworkFailoverMonitor();
  _state = "PRIMARY_HEALTHY";
  _consecutiveFailures = 0;
  _consecutiveSuccesses = 0;
  _lastCheckedAt = null;
  _lastFailureReason = null;
  _failoverAlertTriggeredAt = null;
  _tetheringConfirmedAt = null;
  _tetheringConfirmedBy = null;
  _initialized = false;
}
