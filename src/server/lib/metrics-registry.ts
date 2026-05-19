/**
 * metrics-registry.ts — prom-client registry for Trading Forge
 *
 * All Prometheus metrics are declared here and registered against a single
 * non-default Registry (promRegistry). Using a dedicated registry instead of
 * the prom-client default prevents metric name collisions when the module is
 * hot-reloaded in dev mode (tsx watch) and makes test isolation trivial.
 *
 * collectDefaultMetrics() emits standard Node.js process metrics (heap, GC,
 * event loop lag, file descriptors, etc.) under the "tf_" prefix so they
 * appear alongside Trading Forge's own metrics in any scrape.
 *
 * Consumer pattern:
 *   import { httpRequestDurationMs } from "../lib/metrics-registry.js";
 *   httpRequestDurationMs.labels({ method, route, status_code }).observe(ms);
 */

import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from "prom-client";

export const promRegistry = new Registry();

// Default Node.js process metrics (heap, GC, event loop lag, active handles, etc.)
// Prefixed with "tf_" so they sit alongside Trading Forge metrics in Grafana.
collectDefaultMetrics({ register: promRegistry, prefix: "tf_" });

// ─── HTTP request latency histogram ───────────────────────────────────────────
// Buckets cover sub-10ms health checks through 60s long-poll SSE connections.
// route label uses req.route?.path to group parameterised routes (e.g. /:id).
export const httpRequestDurationMs = new Histogram({
  name: "tf_http_request_duration_ms",
  help: "HTTP request duration in milliseconds, by method, route, and status code",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  registers: [promRegistry],
});

// ─── Circuit breaker gauges ────────────────────────────────────────────────────
// Updated at scrape time from CircuitBreakerRegistry.statusAll() in metrics.ts.
// Encoding: 0=CLOSED, 1=OPEN, 2=HALF_OPEN — integer-friendly for Grafana alerting.
export const circuitBreakerState = new Gauge({
  name: "tf_circuit_breaker_state",
  help: "Circuit breaker state: 0=CLOSED, 1=OPEN, 2=HALF_OPEN",
  labelNames: ["breaker"] as const,
  registers: [promRegistry],
});

export const circuitBreakerFailures = new Gauge({
  name: "tf_circuit_breaker_failures",
  help: "Consecutive failure count per circuit breaker",
  labelNames: ["breaker"] as const,
  registers: [promRegistry],
});

// ─── Python subprocess pool gauges ────────────────────────────────────────────
// Updated at scrape time from getPythonSubprocessStats() in metrics.ts.
// Active + queued together show whether the pool is a bottleneck.
export const pythonSubprocessActive = new Gauge({
  name: "tf_python_subprocess_active",
  help: "Currently running Python subprocesses",
  registers: [promRegistry],
});

export const pythonSubprocessQueued = new Gauge({
  name: "tf_python_subprocess_queued",
  help: "Python subprocesses waiting for a concurrency slot",
  registers: [promRegistry],
});

// ─── Lifecycle counters ────────────────────────────────────────────────────────
// These are incremented by the relevant service calls. The metrics.ts scrape
// endpoint does not need to refresh these — counters accumulate in memory.
//
// TODO: wire increment calls in lifecycle-service, backtest-service, and
// paper-engine once those files are in scope for instrumentation. The counters
// are declared here so Prometheus sees them from first scrape (value 0) even
// before the first event, which prevents "no data" gaps in dashboards.

export const strategyPromotions = new Counter({
  name: "tf_strategy_promotions_total",
  help: "Total strategy lifecycle state transitions",
  labelNames: ["from_state", "to_state", "actor"] as const,
  registers: [promRegistry],
});

export const backtestRuns = new Counter({
  name: "tf_backtest_runs_total",
  help: "Total backtest runs, labelled by outcome status and mode",
  labelNames: ["status", "mode", "tier"] as const,
  registers: [promRegistry],
});

export const paperTrades = new Counter({
  name: "tf_paper_trades_total",
  help: "Total paper trades, labelled by symbol, side, and outcome",
  labelNames: ["symbol", "side", "outcome"] as const,
  registers: [promRegistry],
});
