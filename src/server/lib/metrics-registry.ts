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
// Declared at registry init so Prometheus sees them from first scrape (value 0)
// even before the first event, which prevents "no data" gaps in dashboards.
//
// Wired: lifecycle-service.ts (strategyPromotions), backtest-service.ts (backtestRuns), paper-execution-service.ts (paperTrades).

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
export const pboBlocksTotal = new Counter({
  name: "tf_pbo_blocks_total",
  help: "Total PBO overfit blocks at TESTING lifecycle gate, labelled by institutional regime",
  labelNames: ["regime"] as const,
  registers: [promRegistry],
});
// CF1.1 CLOSED (deepscan15 2026-07-03): the deprecated `pboBLocksTotal` (capital-L
// typo) alias has been removed. All real consumers were already migrated to the
// canonical `pboBlocksTotal` (lifecycle-service.ts, cf1 2026-06-24); the only
// remaining references were the 6 test files below, which have been updated in the
// same commit to import `pboBlocksTotal` directly:
//   wave29-prod-hardening-prom-counters.test.ts, wave29-pass-d1-observability.test.ts,
//   wave-a-paper-parity-trades-counter.test.ts, wave-a-paper-parity-promotions-counter.test.ts,
//   wave-a-paper-parity-auto-promo-gates.test.ts
// (wave-b-paper-parity-pbo-regime-label.test.ts used an unrelated local variable of
// the same name — never imported the alias — no change needed there.)
// No Prometheus double-registration risk: the alias was a bare JS const reference to
// the same Counter instance, not a second `new Counter(...)` registration.

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
//
//   AUDIT NOTE — F-2 (2026-06-28): The increment site in backtest-service.ts
//   always passes {regime: "combined"} — the RL training loop aggregates across
//   institutional regimes per epoch and does not decompose by regime at the
//   individual-epoch level. The label is retained for forward-compatibility
//   (per-regime epoch breakdown is a future enhancement). "combined" is the
//   ONLY value currently emitted; per-regime series remain at zero and are
//   NOT zero-initialised (that would create misleading "0" regime signals).
//   See the zero-init at end of file which pre-seeds only "combined".
export const rlTrainingEpochsTotal = new Counter({
  name: "tf_rl_training_epochs_total",
  help: "Total RL training epochs completed, labelled by institutional regime (regime=combined is the only currently-emitted value — per-regime breakdown is a future enhancement; see audit note F-2 2026-06-28)",
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
// Zero-initialize all four outcome labels so Prometheus sees value=0 from first
// scrape instead of "no data".  Without this, Grafana shows blank panels for
// the `blocked_unavailable` series until the first DB-error path fires in prod.
// Outcome labels (closed set):
//   passed                   → divergence gate cleared; strategy promoted to PAPER
//   blocked_divergence        → divergence_pct ≥ SHADOW_DIVERGENCE_THRESHOLD_PCT
//   blocked_insufficient_samples → sample_size < SHADOW_DIVERGENCE_MIN_SAMPLE
//   blocked_unavailable      → fail-closed DB-error path (divergence inputs unavailable)
(function () {
  const SHADOW_OUTCOMES = [
    "passed",
    "blocked_divergence",
    "blocked_insufficient_samples",
    "blocked_unavailable",
  ] as const;
  for (const outcome of SHADOW_OUTCOMES) {
    lifecycleShadowPromotionsTotal.labels({ outcome }).inc(0);
  }
})();

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

// ─── Pass 4.5 Track D — Archetype routing observability counter (2026-06-23) ───
//
// tf_archetype_signals_routed_total{archetype, resolved_action}
//   Incremented by archetype-routing-observability.ts on every archetype signal
//   resolution at /api/live-order. Emitted by:
//     - emitArchetypeSignalResolved()  → resolved_action = direction from evaluator
//     - emitArchetypeEvaluatorFailed() → resolved_action = "evaluator_failed"
//
//   Labels:
//     archetype       — ARCHETYPE_REGISTRY key (e.g. "bounce_off_level",
//                       "ict_bias_aligned_continuation", etc.) — up to 39+ values
//     resolved_action — closed set:
//                       enter_long | enter_short | exit_long | exit_short |
//                       hold | evaluator_failed
//
//   Cardinality: ~40 archetypes × 6 actions = ~240 time series — safe.
//   Declared at registry init so Prometheus sees zero values from first scrape
//   (no "no data" gaps in Grafana before the first live-order archetype signal).
//
//   Operational question answered: "Which archetypes are most active and do any
//   show elevated evaluator_failed rates indicating subprocess fragility?"
export const archetypeSignalsRoutedTotal = new Counter({
  name: "tf_archetype_signals_routed_total",
  help: "Total archetype signals routed through /api/live-order, labelled by archetype and resolved action",
  labelNames: ["archetype", "resolved_action"] as const,
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

// ─── Wave 4 Track 4B — Layer 15 Leak Detection counters (2026-06-27) ──────────
//
// tf_layer15_leak_detections_total{category, severity}
//   Incremented by leak-detection-service.ts on every leak finding emitted.
//
//   category label (closed set — 6 Layer 15 taxonomy buckets):
//     "execution_slippage"   — avg(|slippage|) z-score vs 60d baseline
//     "allocation_drift"     — contracts-used z-score vs 60d baseline
//     "regime"               — current regime outside trained/preferred regimes
//     "attribution_opacity"  — trade critique data_completeness='minimal' or missing fields
//     "subsystem_consensus"  — composite health score drop + ≥N subsystems regressed
//     "mc_distribution_breach" — realized paper metrics vs promotion-time MC distribution
//
//   severity label (closed set):
//     "info"    — signal detected; monitor
//     "warning" — signal elevated; investigate soon
//     "high"    — action needed; Discord WARN fires
//
//   Cardinality: 6 categories × 3 severities = 18 time series — safe.
//
//   GAP 4 fix: zero-initialized at registry startup for all 18 label combinations
//   so Prometheus sees value=0 from first scrape instead of "no data".
//   Without this, Grafana shows blank panels for categories that haven't fired yet
//   (e.g. "mc_distribution_breach" before the first live promotion).
//
//   Operational question answered: "Which leak category fires most often at high
//   severity?" — informs where to prioritise debugging effort across strategies.
//
// ADVISORY-ONLY: these counters reflect observation signals. No hard-gate or
// lifecycle-promotion decision is derived from them.
export const layer15LeakDetectionsTotal = new Counter({
  name: "tf_layer15_leak_detections_total",
  help: "Total Layer 15 leak findings emitted, labelled by category and severity",
  labelNames: ["category", "severity"] as const,
  registers: [promRegistry],
});

// ─── Deep-scan #16 Wave-1 Track 5 — institutional hard-gate counters (2026-07-04) ──
//
// HIGH E-6 finding: B14 ci_high, WFE, and parameter-drift gates in lifecycle-service.ts
// write audit_log + SSE on every evaluation but incremented NO Prometheus counter —
// a promotion pipeline could sit blocked for weeks with no Grafana panel moving.
//
// All three counters share the same label shape:
//   transition — which lifecycle hop the gate fired on (closed set, 3 values):
//     "TESTING_TO_PAPER" | "SHADOW_TO_PAPER" | "PAPER_TO_DEPLOY_READY"
//   outcome — closed set, 4 values:
//     "pass"  — gate evaluated real data and allowed promotion
//     "block" — gate evaluated real data and blocked promotion
//     "legacy" — gate exempted the strategy (legacy_null / cpcv_exempt / data
//                unavailable) — advisory-visible but not a hard pass/fail
//     "error" — gate infrastructure (DB read) threw; caller fail-closed
//
// Cardinality per counter: 3 transitions × 4 outcomes = 12 time series — safe.
// Zero-initialised below so Grafana never shows "no data" for an outcome that
// simply hasn't fired yet (e.g. "error" before the first DB hiccup).
//
// Operational question answered: "Is the B14/WFE/parameter-drift gate stack
// actually evaluating strategies, and is a promotion pipeline stuck blocked?"
export const b14GateTotal = new Counter({
  name: "tf_b14_gate_total",
  help: "Total B14 Survival Twin ci_high gate evaluations, labelled by lifecycle transition and outcome",
  labelNames: ["transition", "outcome"] as const,
  registers: [promRegistry],
});

export const wfeGateTotal = new Counter({
  name: "tf_wfe_gate_total",
  help: "Total Walk-Forward Efficiency (WFE) gate evaluations, labelled by lifecycle transition and outcome",
  labelNames: ["transition", "outcome"] as const,
  registers: [promRegistry],
});

export const parameterDriftGateTotal = new Counter({
  name: "tf_parameter_drift_gate_total",
  help: "Total parameter-drift overfit gate evaluations, labelled by lifecycle transition and outcome",
  labelNames: ["transition", "outcome"] as const,
  registers: [promRegistry],
});

(function _zeroInitHardGateCounters() {
  const TRANSITIONS = ["TESTING_TO_PAPER", "SHADOW_TO_PAPER", "PAPER_TO_DEPLOY_READY"] as const;
  const OUTCOMES = ["pass", "block", "legacy", "error"] as const;
  for (const transition of TRANSITIONS) {
    for (const outcome of OUTCOMES) {
      b14GateTotal.labels({ transition, outcome }).inc(0);
      wfeGateTotal.labels({ transition, outcome }).inc(0);
      parameterDriftGateTotal.labels({ transition, outcome }).inc(0);
    }
  }
})();

// ─── Deep-scan #16 Wave-1 Track 5 — backtest completion-write failure counter ──
//
// HIGH E-7 finding: backtest-service.ts's completion-write transaction has no
// local catch; if the outer catch's recovery write ALSO throws, the row sits
// status="running" forever with zero DB trace.
//
// tf_backtest_completion_write_failed_total{stage}
//   stage = "completion_write" — the primary db.transaction() persisting engine
//            results failed (outer catch's recovery write is expected to run next).
//   stage = "recovery_write"   — the OUTER catch's own status="failed" write (and/or
//            its audit_log insert) ALSO failed. This is the E-7 worst case: a
//            "running" row with genuinely zero DB trace. This counter (in-memory,
//            survives DB outages) plus the accompanying structured log are the
//            ONLY discoverability signal left in that scenario.
//
// Cardinality: 2 stage values — safe.
export const backtestCompletionWriteFailedTotal = new Counter({
  name: "tf_backtest_completion_write_failed_total",
  help: "Total backtest completion-write failures, labelled by failure stage (completion_write vs recovery_write)",
  labelNames: ["stage"] as const,
  registers: [promRegistry],
});

(function _zeroInitBacktestCompletionWriteFailed() {
  for (const stage of ["completion_write", "recovery_write"] as const) {
    backtestCompletionWriteFailedTotal.labels({ stage }).inc(0);
  }
})();

// ─── Deep-scan #16 Wave-1 Track 5 — quantum MC run outcome counter ────────────
//
// HIGH E-8 finding: backtest-service.ts's auto quantum-MC fire-and-forget hook
// caught failures with logger.error only — no audit_log, no counter, no Discord.
// quantum-mc-service.ts:runQuantumMC() could also throw BEFORE its own qmcRow
// insert (pre-insert DB error), leaving no row to attach a failure audit to.
//
// tf_quantum_mc_runs_total{outcome}
//   "completed"       — Python quantum MC ran and the DB write succeeded.
//   "failed"          — runQuantumMC's internal try/catch handled a Python/DB
//                       failure AFTER the running row was created (existing
//                       "quantum-mc.run" failure audit row covers this case).
//   "pre_insert_error" — the initial backtest-fetch or "running"-row insert threw
//                       BEFORE a quantumMcRuns row existed to attach an audit to.
//   "auto_fire_uncaught" — the fire-and-forget auto-trigger in backtest-service.ts
//                       caught an error from the circuit breaker or an unexpected
//                       throw (distinct from the two internal outcomes above).
//
// Cardinality: 4 outcome values — safe. Advisory/challenger-only per CLAUDE.md —
// this counter is purely for observability, never a gate signal.
export const quantumMcRunsTotal = new Counter({
  name: "tf_quantum_mc_runs_total",
  help: "Total quantum Monte Carlo runs, labelled by outcome (challenger-only, advisory)",
  labelNames: ["outcome"] as const,
  registers: [promRegistry],
});

(function _zeroInitQuantumMcRunsTotal() {
  for (const outcome of ["completed", "failed", "pre_insert_error", "auto_fire_uncaught"] as const) {
    quantumMcRunsTotal.labels({ outcome }).inc(0);
  }
})();

// ─── Deep-scan #16 Wave-1 Track 5 — cross-track dsl_guards.guards_failed consumer ──
//
// Cross-track contract note: Track 2 is adding result["dsl_guards"]["guards_failed"]
// to the Python engine (backtester.py already emits result["dsl_guards"] with
// stop_ceiling_skips/time_stop_exits/dll_halt_blocks — see _dsl_guards_meta — but
// guards_failed did not exist yet at the time this counter shipped). backtest-service.ts
// reads it back out of the raw Python result (forward-compatible, zero-cost until the
// producer field lands) and increments this counter + a dedicated
// backtest.dsl_guards_failed audit row whenever the list is non-empty, so a backtest
// with a failed DSL guard is discoverable as NOT clean for promotion even though no
// lifecycle gate reads this field yet (that wiring is out of scope for this track —
// see the "E-1 guards_failed consumer" note in the deep-scan #16 Track 5 report).
export const backtestDslGuardsFailedTotal = new Counter({
  name: "tf_backtest_dsl_guards_failed_total",
  help: "Total backtests where result.dsl_guards.guards_failed was non-empty (invalid for promotion, cross-track Track 2 contract)",
  registers: [promRegistry],
});

// Zero-init all 6 × 3 = 18 label combinations so Prometheus sees value=0 from
// first scrape. prom-client Counters do not pre-register label sets automatically;
// without this, Grafana shows "no data" for categories that have not yet fired.
(function _zeroInitLayer15Labels() {
  const LAYER15_CATEGORIES = [
    "execution_slippage",
    "allocation_drift",
    "regime",
    "attribution_opacity",
    "subsystem_consensus",
    "mc_distribution_breach",
  ] as const;
  const LAYER15_SEVERITIES = ["info", "warning", "high"] as const;
  for (const category of LAYER15_CATEGORIES) {
    for (const severity of LAYER15_SEVERITIES) {
      layer15LeakDetectionsTotal.labels({ category, severity }).inc(0);
    }
  }
})();

// tf_layer15_run_duration_ms
//   Histogram of end-to-end leak detection run durations.
//   Buckets cover from a sub-second fast-path (all strategies clean) through a
//   worst-case multi-strategy deep scan (~60s for 50+ strategies).
//   Operational question answered: "Is the 3AM orchestrator completing its
//   leak scan before market open at 09:30 ET?"
export const layer15RunDurationMs = new Histogram({
  name: "tf_layer15_run_duration_ms",
  help: "End-to-end Layer 15 leak detection run duration in milliseconds",
  buckets: [100, 500, 1000, 2500, 5000, 10000, 20000, 30000, 60000],
  registers: [promRegistry],
});

// ─── Candidate backtest conveyor counter (2026-06-28) ─────────────────────────
//
// tf_candidate_conveyor_enqueued_total
//   Incremented by candidate-backtest-conveyor-service.ts each time a CANDIDATE
//   strategy is successfully handed to runBacktest() (status !== "skipped").
//   No labels — single time series, minimal cardinality.
//   Cardinality: 1. Lets dashboards answer "how many automated backtests have
//   been enqueued since boot?" without a full audit_log scan.
export const candidateConveyorEnqueuedTotal = new Counter({
  name: "tf_candidate_conveyor_enqueued_total",
  help: "Total backtests enqueued by the candidate backtest conveyor",
  registers: [promRegistry],
});

// ─── Wave 4 Track 4B — BIF gate evaluation counter (2026-06-28) ───────────────
//
// tf_bif_gate_evaluations_total{outcome}
//   Incremented by lifecycle-service.ts at every BIF gate evaluation at the
//   PAPER → DEPLOY_READY lifecycle transition, immediately after evaluateBifGate()
//   resolves.
//
//   outcome label (closed set — mirrors BIF gate reason codes from bif-gate.ts):
//     "clean"       — bif ≤ BIF_WARN_THRESHOLD (2.0): no overfitting concern
//     "warn"        — BIF_WARN_THRESHOLD < bif ≤ BIF_BLOCK_THRESHOLD: elevated bias, promotion allowed
//     "blocked"     — bif > BIF_BLOCK_THRESHOLD (4.0): hard block, synthetic overfit
//     "legacy_null" — bif absent (pre-Wave-3 backtest): grandfather pass, promoted with warn audit
//
//   Cardinality: 4 outcome values = 4 time series — safe.
//   Declared at registry init so Prometheus sees zero values from first scrape
//   (no "no data" gaps in Grafana before the first promotion attempt).
//
//   Operational question answered: "How often does the BIF gate block vs pass
//   promotions, and is the system still processing legacy-null backtests?"
//   Lets dashboards detect a systematic cluster of blocked promotions that indicate
//   the autonomous scout is generating over-fit strategy candidates.
export const bifGateEvaluationsTotal = new Counter({
  name: "tf_bif_gate_evaluations_total",
  help: "Total BIF gate evaluations at PAPER→DEPLOY_READY, labelled by gate outcome",
  labelNames: ["outcome"] as const,
  registers: [promRegistry],
});

// ─── Wave A — Slippage-Survival gate block counter (2026-07-03) ───────────────
//
// tf_slippage_survival_blocks_total{breaks_at}
//   Incremented by lifecycle-service.ts each time the Slippage-Survival gate
//   BLOCKS a PAPER → DEPLOY_READY promotion (evaluateSlippageSurvivalGate()
//   returns passed=false). Only fires on the blocked outcome — this is a
//   "blocks" counter, not a full outcome counter (mirrors the name/shape the
//   design spec specifies: `tf_slippage_survival_blocks_total{breaks_at}`).
//
//   breaks_at label — the smallest slippage multiple (stringified, e.g. "1",
//   "1.5", "2") where the producer's re-price sweep found the edge died.
//   Cardinality: bounded by SLIPPAGE_SURVIVAL_MULTIPLES (default 3 sweep
//   points) — safe.
//
//   Operational question answered: "How many strategies are being blocked for
//   living on optimistic fills, and at which slippage multiple do they break?"
export const slippageSurvivalBlocksTotal = new Counter({
  name: "tf_slippage_survival_blocks_total",
  help: "Total Slippage-Survival gate blocks at PAPER→DEPLOY_READY, labelled by the breaks_at multiple",
  labelNames: ["breaks_at"] as const,
  registers: [promRegistry],
});

// ── Auto-Graveyard (Production Hardening) ────────────────────────────────────
//   Incremented each time checkAutoPromotions() auto-promotes a strategy to
//   GRAVEYARD after LIFECYCLE_GATE_FAIL_GRAVEYARD_THRESHOLD (default 3)
//   consecutive hard gate failures for the same (strategy, gate) pair.
//   Labels: gate — the name of the hard gate that triggered burial, e.g.
//     "mc_survival_below_floor", "b14_ci_high", "wfe_hard_floor", etc.
//   Cardinality: N_gate_names (bounded — closed allowlist in lifecycle-service).
//   Lets dashboards answer "how many strategies were buried per gate type?"
//   without scanning audit_log.
export const autoGraveyardTotal = new Counter({
  name: "tf_auto_graveyard_total",
  help: "Total auto-graveyard promotions triggered by consecutive hard gate failures, labelled by gate name",
  labelNames: ["gate"] as const,
  registers: [promRegistry],
});

// ─── Audit write failure counter (2026-06-29) ─────────────────────────────────
//
// tf_audit_write_failures_total{action}
//   Incremented in every non-blocking insertAuditRow() .catch() handler on the
//   execution path (paper-signal-service.ts). Previously these were silent swallows
//   (.catch(() => {})). Each failure now logs a structured warn AND increments this
//   counter so DB pressure, pool exhaustion, or post-migration schema mismatches
//   become visible on the metrics dashboard without blocking signal evaluation.
//
//   action label: the audit_log action string of the row that failed to write.
//   Cardinality: ~25 distinct action values — safe (bounded by the known audit
//   actions on the execution path).
//
//   Operational question answered: "Are audit writes silently failing during a
//   session?" — a spike here under DB load is the early signal that the session's
//   audit_log trail may be incomplete (DLL breach, cooldown, position open rows
//   missing). Allows targeting an investigation before the session ends.
export const auditWriteFailuresTotal = new Counter({
  name: "tf_audit_write_failures_total",
  help: "Total non-blocking insertAuditRow() failures on the execution path, labelled by audit action",
  labelNames: ["action"] as const,
  registers: [promRegistry],
});

// Deep-scan #5 M1 (2026-06-29): live SSE client count was logged on connect/disconnect
// but invisible to Prometheus — could not alert on "0 SSE clients while paper engine
// active" or detect unbounded client accumulation. Set from sse.ts on every mutation.
export const sseClientsConnected = new Gauge({
  name: "tf_sse_clients_connected",
  help: "Number of currently-connected SSE clients (dashboard live-event subscribers)",
  registers: [promRegistry],
});

// ─── Wave 29 quantum observability zero-init (2026-06-28) ──────────────────────
//
// Fix MED-1: Zero-initialise closed-label-set Wave 29 counters so Prometheus sees
// value=0 from first scrape instead of "no data". Without this Grafana shows blank
// panels for label combinations that have not yet fired (e.g. the "manual" kill-switch
// reason, or "blocked_insufficient_samples" shadow-promotion outcome, or any PBO
// block regime before the first TESTING→SHADOW promotion attempt).
//
// Pattern mirrors the layer15 zero-init IIFE (lines ~510-525).
//
// Intentionally EXCLUDED from zero-init:
//   tf_regime_drift_detections_total{from_regime, to_regime} — 36-combo sparse
//   matrix; zero-initialising all combinations creates misleading gauge noise.
//
//   tf_rl_training_epochs_total{regime} — see audit note F-2: only "combined" is
//   ever emitted; regime-specific values are never populated today.
(function _zeroInitWave29QuantumLabels() {
  // tf_rl_kill_switch_total{reason} — 3 closed values
  const RL_KILL_SWITCH_REASONS = [
    "sharpe_gap_30pct",
    "insufficient_samples",
    "manual",
  ] as const;
  for (const reason of RL_KILL_SWITCH_REASONS) {
    rlKillSwitchTotal.labels({ reason }).inc(0);
  }

  // tf_lifecycle_shadow_promotions_total{outcome} — 3 closed values
  const SHADOW_PROMOTION_OUTCOMES = [
    "passed",
    "blocked_divergence",
    "blocked_insufficient_samples",
  ] as const;
  for (const outcome of SHADOW_PROMOTION_OUTCOMES) {
    lifecycleShadowPromotionsTotal.labels({ outcome }).inc(0);
  }

  // tf_pbo_blocks_total{regime} — 6 institutional regimes
  const INSTITUTIONAL_REGIMES = [
    "TRENDING",
    "EXPANSION",
    "RANGE_BOUND",
    "COMPRESSION",
    "HIGH_VOL_MACRO",
    "LOW_LIQ_CHOP",
  ] as const;
  for (const regime of INSTITUTIONAL_REGIMES) {
    pboBlocksTotal.labels({ regime }).inc(0);
  }

  // tf_rl_training_epochs_total{regime} — only zero-init the aggregate "combined"
  // label (the only value ever emitted by the increment site; see audit note F-2).
  rlTrainingEpochsTotal.labels({ regime: "combined" }).inc(0);
})();
