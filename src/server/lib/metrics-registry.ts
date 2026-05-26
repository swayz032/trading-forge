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

// ─── Backtest scoring counter ─────────────────────────────────────────────────
// Incremented in backtest-service.ts after forge_score + tier are computed.
// label "tier" carries the Tier enum value (tier1, tier2, tier3, null) so
// dashboards can track tier-distribution over time without a separate query.
export const backtestScoredTotal = new Counter({
  name: "tf_backtest_scored_total",
  help: "Total backtests scored with forge_score + tier",
  labelNames: ["tier"] as const,
  registers: [promRegistry],
});

// ─── Cross-validator metrics ──────────────────────────────────────────────────
// Incremented by agent.ts cross-validate endpoint on every call attempt.
// label "outcome" carries: match_confirmed | match_rejected | model_unavailable | error
export const crossValidatorCallsTotal = new Counter({
  name: "tf_cross_validator_calls_total",
  help: "Total cross-validator LLM calls, labelled by outcome",
  labelNames: ["outcome"] as const,
  registers: [promRegistry],
});

// Histogram over LLM latency for cross-validator calls (seconds, not ms).
// Using prom-client default buckets (.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10).
export const crossValidatorLatencySeconds = new Histogram({
  name: "tf_cross_validator_latency_seconds",
  help: "Cross-validator LLM call latency in seconds",
  registers: [promRegistry],
});

// ─── Pending bucket metrics ───────────────────────────────────────────────────
// pendingBucketsGraduatedTotal — incremented each time a pending bucket is
// promoted to a graduated strategy. No label needed; cardinality = 0.
export const pendingBucketsGraduatedTotal = new Counter({
  name: "tf_pending_buckets_graduated_total",
  help: "Total pending buckets graduated to strategies",
  registers: [promRegistry],
});

// pendingBucketsTotal — set at scrape time from direct-bucket-graduator counts
// broken out by status (pending | graduating | graduated | expired | killed).
// label "status" keeps this gauge at 5 time series max — safe cardinality.
export const pendingBucketsTotal = new Gauge({
  name: "tf_pending_buckets_count",
  help: "Current count of pending concept buckets by status",
  labelNames: ["status"] as const,
  registers: [promRegistry],
});

// ─── Cron job concurrency gauge ───────────────────────────────────────────────
// Tracks how many scheduler cron jobs are executing simultaneously.
// Updated at entry/exit of withRetry so ops-on-call can spot concurrency spikes.
export const cronJobsConcurrent = new Gauge({
  name: "tf_cron_jobs_concurrent",
  help: "Number of scheduler cron jobs currently executing",
  registers: [promRegistry],
});

// ─── Wave 26 Pass G archetype signal counters (2026-05-26) ────────────────────
// Incremented by archetype-signal-audit.ts emitArchetypeSignalAudit() on every
// signal fired from a Wave 26 Pass G archetype. Labels:
//   archetype: "bounce_off_level" | "ict_bias_aligned_continuation"
//   direction: "long" | "short"
// Lets dashboards track signal rate per archetype + per direction without a
// full audit_log query. Declared at registry init so Prometheus sees zero values
// from first scrape (no "no data" gaps in Grafana).
export const archetypeSignalsTotal = new Counter({
  name: "tf_archetype_signals_total",
  help: "Total archetype signal fires, labelled by archetype name and direction",
  labelNames: ["archetype", "direction"] as const,
  registers: [promRegistry],
});

// ─── Strategy source-URL resolution counter (2026-05-26) ──────────────────────
// Incremented by getStrategySourceUrl (Wave 26 Pass G A3) on every resolution
// attempt. label "path" carries: direct | variant_inheritance | audit_fallback |
// multi_source | unresolved. Lets operators track which resolution path dominates
// and catch "unresolved" spikes that indicate orphan-strategy accumulation.
export const strategySourceResolutionTotal = new Counter({
  name: "tf_strategy_source_resolution_total",
  help: "Total strategy source-URL resolution calls, labelled by resolution path",
  labelNames: ["path"] as const,
  registers: [promRegistry],
});
