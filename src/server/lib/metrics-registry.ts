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

// ─── Wave 26 Pass G B3 — confluence quality counters (2026-05-26) ─────────────
//
// tf_graduation_factor_quality_total
//   Incremented by confluence-quality-audit.ts::emitFactorQualityClassified()
//   on every graduation. label "quality" carries: rich | thin | fallback_only.
//   Lets dashboards track library confluence-health over time without a full
//   audit_log query. Declared at registry init so Prometheus sees zero values
//   from first scrape (no "no data" gaps in Grafana).
export const graduationFactorQualityTotal = new Counter({
  name: "tf_graduation_factor_quality_total",
  help: "Total graduation factor-quality classifications, labelled by quality bucket",
  labelNames: ["quality"] as const,
  registers: [promRegistry],
});

// tf_graduation_bidirectional_rejection_total
//   Incremented when Gate 1 fires (direction=both, one side empty).
//   label "reason" carries the structured rejection reason code.
export const graduationBidirectionalRejectionTotal = new Counter({
  name: "tf_graduation_bidirectional_rejection_total",
  help: "Total bidirectional graduation rejections, labelled by reason code",
  labelNames: ["reason"] as const,
  registers: [promRegistry],
});

// tf_extraction_confluence_depth_histogram
//   Observed by confluence-quality-audit.ts on every graduation.
//   Buckets cover 0–5+ confluence factors extracted from the transcript.
//   Lets operators query "what fraction of extractions produce ≥3 factors"
//   to track whether B1's richer Gemma prompt is working over time.
export const extractionConfluenceDepthHistogram = new Histogram({
  name: "tf_extraction_confluence_depth_histogram",
  help: "Number of confluence factors extracted per graduation attempt",
  buckets: [0, 1, 2, 3, 4, 5],
  registers: [promRegistry],
});

// ─── Wave 26 Pass G Pass F — DD velocity + regime transition counters (2026-05-26) ──
//
// tf_dd_velocity_autopause_total
//   Incremented by dd-velocity-gate.ts::_handleAutopause() on every DD velocity
//   breach that triggers pipeline AUTOPAUSE_DD_VELOCITY. No labels needed —
//   the session context is in the audit_log. Cardinality = 1 time series.
//   Declared at registry init so Prometheus sees zero from first scrape.
export const ddVelocityAutopauseTotal = new Counter({
  name: "tf_dd_velocity_autopause_total",
  help: "Total DD velocity autopause events triggered",
  registers: [promRegistry],
});

// tf_regime_transition_total
//   Incremented by bias-state-service.ts (or the bias engine TS caller) on every
//   regime transition. Labels: from (previous regime), to (new regime).
//   Lets dashboards track regime-transition frequency and detect LATE_CYCLE spikes.
//   Cardinality: 8 from × 8 to = 64 time series max — safe.
export const regimeTransitionTotal = new Counter({
  name: "tf_regime_transition_total",
  help: "Total institutional regime transitions, labelled by from and to regime",
  labelNames: ["from", "to"] as const,
  registers: [promRegistry],
});

// ─── Wave 29 Pass D.1 — observability surface (2026-05-26) ────────────────────
//
// Closed label-set enumerations used across Wave 29 metrics.
// All labels are from closed sets to prevent unbounded cardinality.
//
// Institutional regime vocab (Wave 25 Pass 6, 5-state canonical):
//   TRENDING | EXPANSION | RANGE_BOUND | COMPRESSION | HIGH_VOL_MACRO | LOW_LIQ_CHOP
//
// divergence_bucket: pre_check | low | medium | high
//   pre_check  → shadow not yet evaluated (< SHADOW_DIVERGENCE_MIN_SAMPLE rows)
//   low        → divergence_pct < 0.02
//   medium     → 0.02 ≤ divergence_pct < 0.05
//   high       → divergence_pct ≥ 0.05 (BLOCKED)
//
// shadow_promotion outcome: passed | blocked_divergence | blocked_insufficient_samples
//
// kill_switch reason: sharpe_gap_30pct | insufficient_samples | manual

// tf_pbo_blocks_total{regime}
//   Incremented by pbo-gate.ts / lifecycle-service.ts when lifecycle.pbo_overfit_block
//   audit fires (Pass A.2 gate at TESTING → SHADOW / TESTING → PAPER).
//   regime label = institutional regime at the time of block evaluation.
//   Cardinality: 6 regime values × 1 counter = 6 time series max.
export const pboBLocksTotal = new Counter({
  name: "tf_pbo_blocks_total",
  help: "Total PBO overfit blocks at TESTING lifecycle gate, labelled by institutional regime",
  labelNames: ["regime"] as const,
  registers: [promRegistry],
});

// tf_shadow_signals_total{strategy_id, divergence_bucket}
//   Incremented on each shadow signal write (lifecycle.shadow_signal_logged audit).
//   strategy_id: numeric string — callers supply from strategy DB row.
//   divergence_bucket: pre_check | low | medium | high (closed enum above).
//   WARNING: strategy_id label creates cardinality proportional to strategy count.
//   With ~100-200 strategies this is safe; do NOT accept user-input values here.
export const shadowSignalsTotal = new Counter({
  name: "tf_shadow_signals_total",
  help: "Total shadow signals written per strategy with divergence bucket classification",
  labelNames: ["strategy_id", "divergence_bucket"] as const,
  registers: [promRegistry],
});

// tf_rl_training_epochs_total{regime}
//   Incremented per RL training epoch completion (quantum_rl.training_completed audit).
//   regime label = institutional regime the policy was trained on.
//   Cardinality: 6 regime values × 1 counter = 6 time series max.
export const rlTrainingEpochsTotal = new Counter({
  name: "tf_rl_training_epochs_total",
  help: "Total RL training epochs completed, labelled by institutional regime",
  labelNames: ["regime"] as const,
  registers: [promRegistry],
});

// tf_rl_kill_switch_total{reason}
//   Incremented when the RL kill switch engages (quantum_rl.kill_switch_engaged audit).
//   reason: sharpe_gap_30pct | insufficient_samples | manual  (closed set).
//   Cardinality: 3 reason values = 3 time series max.
export const rlKillSwitchTotal = new Counter({
  name: "tf_rl_kill_switch_total",
  help: "Total RL kill switch engagements, labelled by trigger reason",
  labelNames: ["reason"] as const,
  registers: [promRegistry],
});

// tf_rl_ab_sharpe_delta
//   Gauge holding the current rolling 20-session Sharpe delta: Sub2 − Sub1.
//   Positive → RL-challenger outperforms baseline.
//   Negative → RL-challenger underperforms baseline (approaches kill-switch threshold).
//   Updated whenever the composite aggregator evaluates the RL subsystem.
export const rlAbSharpeDelta = new Gauge({
  name: "tf_rl_ab_sharpe_delta",
  help: "Current rolling 20-session Sharpe delta: RL-challenger (Sub2) minus baseline (Sub1)",
  registers: [promRegistry],
});

// tf_rl_ab_pnl_delta
//   Gauge holding the cumulative P&L delta: Sub2 − Sub1.
//   Captures the real-dollar marginal edge of the RL-challenger path.
//   Updated alongside tf_rl_ab_sharpe_delta on each aggregator cycle.
export const rlAbPnlDelta = new Gauge({
  name: "tf_rl_ab_pnl_delta",
  help: "Cumulative P&L delta: RL-challenger (Sub2) minus baseline (Sub1)",
  registers: [promRegistry],
});

// tf_frozen_policy_overrides_total
//   Incremented on every HMAC override use (frozen_policy.override_used audit, Pass B.2).
//   No label — cardinality 1, session context in audit_log.
//   Lets operators detect systematic override patterns without querying DB.
export const frozenPolicyOverridesTotal = new Counter({
  name: "tf_frozen_policy_overrides_total",
  help: "Total frozen-policy HMAC override uses (lifecycle contract bypasses)",
  registers: [promRegistry],
});

// tf_regime_drift_detections_total{from_regime, to_regime}
//   Incremented per regime drift detected (strategy.regime_drift_detected audit, Pass B.3).
//   from_regime: regime the strategy was trained on.
//   to_regime:   current live institutional_regime.
//   Cardinality: 6 from × 6 to = 36 time series max — safe.
export const regimeDriftDetectionsTotal = new Counter({
  name: "tf_regime_drift_detections_total",
  help: "Total regime drift detections triggering auto-demotion, labelled by from/to regime",
  labelNames: ["from_regime", "to_regime"] as const,
  registers: [promRegistry],
});

// tf_lifecycle_shadow_promotions_total{outcome}
//   Incremented at the SHADOW → PAPER gate evaluation (Pass A.3).
//   outcome: passed | blocked_divergence | blocked_insufficient_samples (closed set).
//   Lets operators track funnel attrition at the shadow-divergence gate over time.
export const lifecycleShadowPromotionsTotal = new Counter({
  name: "tf_lifecycle_shadow_promotions_total",
  help: "Total SHADOW → PAPER gate evaluations, labelled by outcome",
  labelNames: ["outcome"] as const,
  registers: [promRegistry],
});

// Pass 1 Track D: counts warning-severity alerts routed to Discord via notification-service.
// Answers "how many non-critical alerts reached Discord?" on the observability dashboard.
export const warningSeverityDiscordRoutedTotal = new Counter({
  name: "tf_warning_severity_discord_routed_total",
  help: "Total warning/info-severity createAlert() calls routed through notification-service to Discord",
  labelNames: ["severity"] as const,
  registers: [promRegistry],
});

// ─── Pass 4 Track C — TradersPost per-call rejection counter (2026-06-23) ─────
//
// tf_broker_router_traderspost_rejects_total{status_code, signal_action}
//   Incremented by broker-router.ts at the submitResult.success===false branch —
//   i.e. every time TradersPost returns a 4xx/5xx or the submission times out —
//   BEFORE the circuit breaker opens. Once the breaker opens (3 consecutive
//   failures) the notifyCritical fires; this counter captures every per-call slip
//   whether the breaker is open or not.
//
//   Labels:
//     status_code   — HTTP status code as string, or "unknown" when null/undefined
//                     (timeout, connection-refused, etc.)
//     signal_action — the signal.action string (e.g. "enter_long", "exit_long")
//                     or "unknown" when absent
//
//   Cardinality: ~5 status codes × ~4 actions = ~20 time series — safe.
//
//   Operational question answered: "Are per-call TradersPost rejections
//   concentrated on a specific action or status code?" — useful for diagnosing
//   payload shape errors (400) vs server-side TradersPost outages (503+).
export const traderspostRejectsTotal = new Counter({
  name: "tf_broker_router_traderspost_rejects_total",
  help: "Total per-call TradersPost webhook submission failures (4xx/5xx/timeout) before circuit-breaker threshold",
  labelNames: ["status_code", "signal_action"] as const,
  registers: [promRegistry],
});

// ─── Pass 3 Track D — Pine Export SHADOW refusal counter (2026-06-22) ─────────
//
// tf_pine_shadow_refusals_total{blocked_at}
//   Incremented by pine-shadow-observability.ts::emitPineShadowRefused() on every
//   Pine export request blocked because the strategy is in SHADOW state or has
//   shadow_mode_enabled=true.
//
//   blocked_at label (closed set — mirrors PINE_EVENTS comment in sse.ts):
//     "compileDualPineExport" — pine-export-service.ts compileDualPineExport() entry
//     "compilePineExport"     — pine-export-service.ts compilePineExport() entry
//     "recipient_build"       — pine-export-recipient-service.ts build path
//     "artifact_download"     — GET artifact-download route (pine-export.ts)
//
//   Cardinality: 4 label values = 4 time series — safe.
//   Declared at registry init so Prometheus sees zero values from first scrape
//   (no "no data" gaps in Grafana even before the first refusal fires).
//
//   Operational question answered: "Which Pine export entry point generates the
//   most SHADOW refusals?" — useful for targeting operator education or guarding
//   against SHADOW-strategy Pine leak at the busiest call site.
export const pineShadowRefusalsTotal = new Counter({
  name: "tf_pine_shadow_refusals_total",
  help: "Total Pine export requests refused because the strategy is in SHADOW state or shadow_mode_enabled=true, labelled by call-site",
  labelNames: ["blocked_at"] as const,
  registers: [promRegistry],
});
