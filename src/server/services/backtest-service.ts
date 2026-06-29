/**
 * Backtest Service — Node↔Python bridge + DB persistence
 *
 * Follows the databento.ts subprocess spawn pattern:
 * - Platform detection (python vs python3)
 * - stdout → JSON.parse
 * - stderr → logging
 */

import { eq, and, sql } from "drizzle-orm";
import { backtests, backtestTrades, stressTestRuns, strategies, paperSessions, auditLog, walkForwardWindows, strategyNames, sqaOptimizationRuns, quboTimingRuns, tensorPredictions, rlTrainingRuns, monteCarloRuns, backtestProvenance, researchTrialCounter } from "../db/schema.js";
import { broadcastSSE } from "../routes/sse.js";
import { startStream } from "./paper-trading-stream.js";
import { runMonteCarlo } from "./monte-carlo-service.js";
import { runQuantumMC } from "./quantum-mc-service.js";
import { queryInfo } from "../../data/loaders/duckdb-service.js";
import { getFirmLimit } from "../../shared/firm-config.js";
import { WFWindowMetricsSchema } from "../../shared/walk-forward-schema.js";
import { logger } from "../lib/logger.js";
import { runPythonModule } from "../lib/python-runner.js";
import { CircuitBreakerRegistry } from "../lib/circuit-breaker.js";
import { sqaRegistry } from "../lib/sqa-promise-registry.js";
import { captureToDLQ } from "../lib/dlq-service.js";
import { db } from "../db/index.js";
import { tracer } from "../lib/tracing.js";
import { isActive as isPipelineActive } from "./pipeline-control-service.js";
import { backtestRuns, backtestScoredTotal, rlTrainingEpochsTotal } from "../lib/metrics-registry.js";
import { recordCost, completeCost } from "../lib/quantum-cost-tracker.js";
import { computeResultHash, computeDataHash, computeStrategyHash } from "../lib/result-hasher.js";
// Track A F-6: insertAuditRowSafe added. Remaining db.insert(auditLog) call
// sites in this file retain raw pattern until incremental migration completes.
// TODO: correlation_id not threaded through all call sites in this file.
import { insertAuditRow, insertAuditRowSafe } from "../lib/audit-log-helper.js";
import { notifyCritical } from "./notification-service.js";
// Wave 27.5 Pass A.1 — CRITICAL #1: stamp firm rules version fingerprint at backtest creation
import { computeFirmRulesVersion } from "../lib/firm-rules-version.js";
// Wave 27.5 Pass C.2 — compliance gate enforcement mode env knob
import { resolveComplianceMode, isResearchBacktest } from "../lib/compliance-mode.js";
// RL kill-switch: RL training is an AUTONOMOUS loop — requires AUTOPILOT (mode >= 2)
import { readLearningLoopMode } from "../lib/learning-loop-mode.js";
// Wave hardening 2026-06-22 (G1a) — buildBacktestArgs extracted so tests can
// import it without the full service chain. Re-exported for backward compat.
import { buildBacktestArgs } from "../lib/backtest-args.js";
export { buildBacktestArgs };

/**
 * Normalize gate_result from Python into a stable JSONB shape.
 *
 * Python backtester.py returns gate_result with the following top-level keys:
 *   score, passed, components: { survival_score, ... }, crisis_veto, ...
 *
 * CONTRACT (with architect agent): lifecycle-service.ts reads
 *   latestBt.gateResult.components.survival_score
 * so that path MUST exist in the persisted object.
 *
 * If Python omits gate_result entirely, returns null (no partial write).
 * If Python returns a gate_result that lacks components, we preserve whatever
 * Python sent — we do NOT manufacture a fake structure.
 */
function normalizeGateResult(raw: Record<string, unknown> | undefined | null): Record<string, unknown> | null {
  if (!raw) return null;
  // Pass through the full object as-is — Python owns the structure.
  // This function exists to make the contract explicit and to be a single
  // interception point if the key name ever changes in Python.
  return raw as Record<string, unknown>;
}

/**
 * Collect unpersisted top-level Python result fields into result_extras JSONB.
 * Fields already persisted in dedicated columns are excluded to avoid duplication.
 */
function buildResultExtras(result: BacktestResult): Record<string, unknown> | null {
  const extras: Record<string, unknown> = {};
  // Fields emitted by backtester.py that have no dedicated column
  const extraKeys = [
    "governor",
    "analytics",
    "long_short_split",
    "bootstrap_ci_95",
    "deflated_sharpe",
    "recency_analysis",
    "statistical_warnings",
    "confidence_intervals",
    // B-1 parity shadow + B-2 invariant harness truthiness fields
    "parity_shadow",
    "invariants",
    // Wave 29 Pass A.3 FIX: SHADOW→PAPER divergence gate baseline.
    // The Python backtester now populates result["expected_signals"] via
    // _build_expected_signals_from_trades() inside _emit_validated_result().
    // The loader (shadow-signal-divergence-loader.ts) reads this from
    // resultExtras.expected_signals to compute the divergence comparison.
    // Without this key the loader always returned [] → 100% divergence →
    // gate permanently blocked. Fail-closed preserved: old backtests without
    // this field continue to return [] (gate blocks).
    "expected_signals",
  ] as const;
  let hasAny = false;
  for (const key of extraKeys) {
    const value = (result as unknown as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      extras[key] = value;
      hasAny = true;
    }
  }
  return hasAny ? extras : null;
}

/**
 * Equity curve size guard.
 *
 * Long backtest periods (years of intraday data) can produce equity curves with
 * 10K+ points. Persisting them as JSONB on every backtest row blows up DB size
 * and makes /api/backtests responses multi-MB.
 *
 * Strategy: index-stride downsample. Element-type-agnostic (works whether the
 * curve is number[] or Array<{time, value}>). Always preserves the final point
 * so the displayed terminal equity matches reality.
 */
const EQUITY_CURVE_MAX_POINTS = 5000;

function downsampleEquityCurve<T>(curve: T[] | null | undefined): {
  downsampled: T[] | null;
  originalLength: number;
  stride: number;
} {
  if (!Array.isArray(curve) || curve.length === 0) {
    return { downsampled: (curve ?? null) as T[] | null, originalLength: 0, stride: 1 };
  }
  if (curve.length <= EQUITY_CURVE_MAX_POINTS) {
    return { downsampled: curve, originalLength: curve.length, stride: 1 };
  }
  const stride = Math.ceil(curve.length / EQUITY_CURVE_MAX_POINTS);
  const downsampled: T[] = [];
  for (let i = 0; i < curve.length; i += stride) {
    downsampled.push(curve[i]);
  }
  // Always include the final point (terminal equity)
  const last = curve[curve.length - 1];
  if (downsampled[downsampled.length - 1] !== last) {
    downsampled.push(last);
  }
  return { downsampled, originalLength: curve.length, stride };
}

/** Convert decay_analysis from Python snake_case to frontend camelCase. */
export function normalizeDecayAnalysis(raw: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  // FIX 3 — canonicalize on Python's `accelerating_decline` (more specific than
  // the generic "declining"). Frontend types in Trading_forge_frontend/amber-vision-main
  // have been updated to accept the canonical value. We pass through unchanged
  // so the downstream contract is "Python's trend keyword == DB trend keyword
  // == frontend trend keyword" (no translator drift).
  return {
    halfLifeDays: raw.half_life_days ?? null,
    decayDetected: raw.decay_detected ?? false,
    trend: raw.trend ?? "stable",
    compositeScore: raw.composite_score ?? 0,
    decaying: raw.decaying ?? false,
    signals: raw.signals ?? {},
  };
}

interface BacktestConfig {
  strategy: {
    name: string;
    symbol: string;
    timeframe: string;
    indicators: Array<{ type: string; period: number; [key: string]: unknown }>;
    entry_long: string;
    entry_short: string;
    exit: string;
    stop_loss: { type: string; multiplier: number };
    position_size: { type: string; target_risk_dollars?: number; fixed_contracts?: number };
  };
  start_date?: string;
  end_date?: string;
  slippage_ticks?: number;
  commission_per_side?: number;
  mode?: "single" | "walkforward";
  walk_forward_splits?: number;
  embargo_bars?: number;  // Bars to skip between IS/OOS windows (prevents data leakage)
  max_trades_per_day?: number;
  firm_key?: string;
  fill_model?: {
    order_type: string;
    limit_at_current?: number;
    limit_1_tick?: number;
    limit_at_sr?: number;
    limit_at_extreme?: number;
    partial_fill_threshold?: number;
    latency_ms?: number;
  };
  event_calendar?: {
    policies: Array<{ event_type: string; action: string; window_minutes: number }>;
    calendar_source: string;
  };
  optimizer?: "optuna" | "sqa";
  refinement_stage?: number;  // 1=param refinement, 2=logic variant, 3=concept pivot
  refinement_iteration?: number;  // 0-8 iteration counter
  suppressAutoPromote?: boolean;  // When true, skip auto-promote (e.g. critic replay backtests)
  overnight_hold?: boolean;       // True = swing strategy; gates overnight margin checks in prop sim
  fill_rate?: number;             // Fraction of orders that fill (0.0–1.0); default 1.0
  spread_multiplier?: number;     // Multiplier on bid-ask spread for slippage model; default 1.0
  // B2 fix: cumulative mutation count across all critic iterations for this strategy.
  // Python walk_forward.py reads this as request.trial_n_total and uses
  // max(n_paths, trial_n_total) as n_trials for DSR deflation — ensuring the
  // bar tightens with every candidate evaluated, not just within one replay batch.
  // Default 1 = no deflation (single initial backtest, backward-compatible).
  trial_n_total?: number;
}

/**
 * Resolve date range from S3 data when dates are omitted.
 * Uses DuckDB queryInfo() to find min/max timestamps for a symbol.
 */
async function resolveDataRange(symbol: string): Promise<{ start_date: string; end_date: string }> {
  try {
    const info = await queryInfo(symbol);
    // queryInfo returns JS Date strings like "Sun Aug 02 2015 18:00:00 GMT-0400..."
    // Parse to Date, then format as YYYY-MM-DD
    const startDt = new Date(info.earliest);
    const endDt = new Date(info.latest);
    const start = startDt.toISOString().slice(0, 10);
    const end = endDt.toISOString().slice(0, 10);
    logger.info({ symbol, start, end, totalBars: info.totalBars }, "Auto-resolved data range from S3");
    return { start_date: start, end_date: end };
  } catch (err) {
    // Conservative fallback aligned with actual ratio-adjusted S3 coverage
    // (ES/NQ/CL 2015-08-02 → present). The previous 2010-01-01 / 2030-12-31
    // sentinel polluted audit logs with future end-dates and triggered
    // engine warmup walks past real data boundaries. Today's date is the
    // hard cap so we never run "the future" through the engine.
    const todayIso = new Date().toISOString().slice(0, 10);
    logger.warn({ symbol, err, fallback_end: todayIso }, "Failed to resolve data range from S3, using calibrated fallback (2015-08-02 → today)");
    return { start_date: "2015-08-02", end_date: todayIso };
  }
}

interface BacktestResult {
  total_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  avg_trade_pnl: number;
  avg_daily_pnl: number;
  winning_days: number;
  total_trading_days: number;
  max_consecutive_losing_days: number;
  expectancy_per_trade: number;
  avg_winner_to_loser_ratio: number;
  equity_curve: Array<{ time: string; value: number }>;
  monthly_returns?: Array<{ year: number; month: number; pnl: number }>;
  trades: Array<Record<string, unknown>>;
  daily_pnls: number[];
  execution_time_ms: number;
  tier?: string;
  forge_score?: number;
  walk_forward_results?: Record<string, unknown>;
  // Wave hardening 2026-06-22 (G1b): WFE + PBO keys emitted at top level when
  // Python uses the oos_metrics branch (walk_forward.py:1252). Previously absent
  // from this interface — a rename would have silently dropped them from wfResults.
  wfe_overall?: number | null;
  wfe_status?: string | null;
  pbo_overall?: number | null;
  pbo_overall_p_value?: number | null;
  // FINDING-1 (deepscan 2026-06-28): CPCV-degenerate discriminator from walk_forward.py.
  pbo_degenerate?: boolean | null;
  // Wave 3 Track 3B — BIF gate fields (contract with Python side: result.bif / result.k_eff).
  // `bif`   — Bias Information Factor; quantifies IS→OOS overfitting transfer gap.
  // `k_eff` — Effective parameter count; companion metric for audit payload.
  // Both optional (null when Python has not yet emitted them — pre-Wave-3 backtests).
  bif?: number | null;
  k_eff?: number | null;
  // WRC / SPA — data-snooping guard results.
  // Python walk_forward.py emits these at both CPCV and plain/purged_embargo WF paths.
  // Contract: wrc_result.p_value → wrcResult JSONB → evaluateWrcGate()
  //           spa_result.spa_consistent_p → spaResult JSONB → evaluateSpaGate()
  wrc_result?: Record<string, unknown> | null;
  spa_result?: Record<string, unknown> | null;
  information_ratio?: number | null;         // A13: Information Ratio (vs benchmark); null when benchmark data insufficient
  prop_compliance?: Record<string, unknown>;
  crisis_results?: Record<string, unknown>;
  decay_analysis?: Record<string, unknown>;
  run_receipt?: Record<string, unknown>;
  sanity_checks?: Record<string, unknown>;
  cross_validation?: Record<string, unknown>;
  gate_result?: Record<string, unknown>;
  gate_rejections?: Record<string, unknown>;
  daily_pnl_records?: Array<{ date: string; pnl: number }>;
  oos_metrics?: Record<string, unknown>;
  // C1 fix 2026-06-28: wf_metadata is a top-level sibling of oos_metrics in the
  // Python walk_forward.py output (emitted at walk_forward.py:~1252).
  // Contains: { mode, n_paths, dsr_pass, dsr_unavailable, dsr }.
  // Previously absent from BacktestResult — silently discarded during WfResultsShape
  // construction, disabling the DSR gate (fail-OPEN) and CPCV n_paths gate (fail-CLOSED).
  wf_metadata?: Record<string, unknown> | null;
  confidence?: string;
  windows?: Array<Record<string, unknown>>;
  n_splits?: number;
  param_stability?: Record<string, unknown>;
  error?: string;
  // ─── Truthiness fields (B-1 + B-2, consumed post-transaction) ───────────
  // B-1: parity_shadow — populated by parity_engine when both backtrader and
  //   vectorbt are available for a given strategy archetype. `ran=false` with
  //   `reason="strategy_archetype_not_supported"` is expected and not alerted.
  parity_shadow?: {
    enabled: boolean;
    ran: boolean;
    passed: boolean;
    reason?: string;
    vbt_total_pnl?: number;
    bt_total_pnl?: number;
    pnl_diff_pct?: number;
    tolerance?: number;
    [key: string]: unknown;
  };
  // B-2: invariants — populated by invariant_harness post-backtest.
  //   overall_passed=false with critical_failures is the hard-fail condition.
  invariants?: {
    passed: boolean;
    failed: Array<string>;
    overall_passed: boolean;
    critical_failures: Array<string>;
    warnings: Array<string>;
    [key: string]: unknown;
  };
  // F-1 (point-in-time integrity telemetry):
  //   tp2_liquidity_unavailable=true means this backtest used +2.0R structural TP2
  //   (not liquidity-mapped TP2) because point-in-time historical liquidity levels
  //   are not stored. The PAPER path gets real liquidity via getNearestLiquidity().
  //   This parity gap is expected and intentional. See backtest-service.ts comment
  //   at the adaptive_exit_context injection block for full rationale.
  tp2_liquidity_source?: string;
  tp2_liquidity_unavailable?: boolean;
}

interface SqaOptimizationResult {
  best_params?: Record<string, unknown>;
  best_energy?: number | string;
  robust_plateau?: Record<string, unknown>;
  all_solutions?: unknown[];
  execution_time_ms?: number;
}

interface QuboTimingResult {
  schedule?: unknown[];
  expected_return?: number | string;
  cost_savings?: number | string;
  backtest_improvement?: number | string;
}

interface TensorSignalResult {
  model_hash?: string;
  probability?: number | string;
  confidence?: number | string;
  signal?: string;
  features?: Record<string, unknown>;
  regime?: string | null;
  fragility_score?: number | string;
  regime_breakdown?: Record<string, unknown>;
}

interface RlTrainingResult {
  total_return?: number | string;
  sharpe_ratio?: number | string;
  win_rate?: number | string | null;
  total_trades?: number | null;
  n_episodes?: number | null;
  execution_time_ms?: number | null;
  policy_weights?: Record<string, unknown> | null;
  comparison_result?: Record<string, unknown> | null;
}

// Phase 12 perf fix: bumped from 10 min to 30 min (safety net only — primary speedup is
// parallel WF windows + stress-test skip in data_loader.py and walk_forward.py).
// A correctly cached + parallelized backtest should complete in < 2 min. The 30 min
// ceiling prevents zombie processes from a legitimate 5-10 min overrun without
// killing runs that are genuinely completing.
const BACKTEST_TIMEOUT_MS = 30 * 60 * 1000;

export async function runBacktest(strategyId: string, config: BacktestConfig, strategyClass?: string, externalId?: string, correlationId?: string, actor: "operator" | "automated" = "automated") {
  // ─── Pipeline pause guard ─────────────────────────────────────
  // Pause stops the AUTOMATED engine (scout-fed flow, schedulers, n8n drains)
  // from churning fresh candidates through backtest. It does NOT block the
  // operator from running manual validation during dev/maintenance work —
  // that's the whole point of backtest as a probe. Per AGENTS.md pause
  // discipline, pause gates: drainScoutedIdeas(), pipelineGate()-wrapped
  // scheduler crons, paper-engine entry, lifecycle promotion sweeps.
  // Backtest is validation, not trading.
  //
  // actor="operator" bypasses the guard with audit row (POST /api/backtests
  // route passes this). actor="automated" (default) preserves Wave 6 fix:
  // returns { status:"skipped", id:null } so callers don't get ghost IDs.
  if (actor !== "operator" && !(await isPipelineActive())) {
    logger.info(
      { fn: "runBacktest", strategyId, symbol: config.strategy.symbol, actor },
      "Skipped: pipeline paused (automated caller)",
    );
    return { id: null as unknown as string, status: "skipped", error: "pipeline_paused" };
  }

  const backtestSpan = tracer.startSpan("backtest.run");
  backtestSpan.setAttribute("strategyId", strategyId);
  backtestSpan.setAttribute("symbol", config.strategy.symbol);
  backtestSpan.setAttribute("mode", config.mode ?? "single");

  // Auto-resolve dates from S3 when omitted
  if (!config.start_date || !config.end_date) {
    const resolved = await resolveDataRange(config.strategy.symbol);
    if (!config.start_date) config.start_date = resolved.start_date;
    if (!config.end_date) config.end_date = resolved.end_date;
  }

  // Insert directly as "running" — single atomic write eliminates the
  // window where a restart could leave the row stuck in "pending" forever.
  // NOTE: pending status removed; if reintroduced, add to scheduler.ts:874 sweeper.
  // Wave 27.5 Pass A.1 — CRITICAL #1: Stamp firm rules fingerprint at row creation.
  // MC engine will assert this matches current rules before running any simulation.
  // Computed here (TS side) so the value is available immediately after insert,
  // and the Python backtester also writes it independently from Python-side globals.
  const firmRulesVersionStamp = computeFirmRulesVersion();

  // W27.5 C.2: resolve compliance_mode at INSERT time so the audit trail records
  // which mode was active for this specific backtest.
  const configRecord = config as unknown as Record<string, unknown>;
  const { mode: resolvedComplianceMode, source: complianceModeSource } =
    resolveComplianceMode(configRecord);

  const [row] = await db
    .insert(backtests)
    .values({
      ...(externalId ? { id: externalId } : {}),
      strategyId,
      symbol: config.strategy.symbol,
      timeframe: config.strategy.timeframe,
      startDate: new Date(config.start_date),
      endDate: new Date(config.end_date),
      status: "running",
      config: configRecord,
      firmRulesVersion: firmRulesVersionStamp,
      complianceMode: resolvedComplianceMode,
    })
    .returning();

  // Log research-mode override at INSERT time so operators can audit which backtests
  // were run in shadow mode (potentially over-optimistic P&L estimates).
  if (isResearchBacktest(configRecord)) {
    logger.warn(
      { backtestId: row.id, strategyId, complianceMode: "shadow", source: complianceModeSource },
      "Backtest started in RESEARCH (shadow) compliance mode — violations will be logged but NOT block trades. " +
      "P&L estimates may be over-optimistic for strategies with compliance violations.",
    );
  } else {
    logger.info(
      { backtestId: row.id, strategyId, complianceMode: resolvedComplianceMode, source: complianceModeSource },
      "Backtest compliance gate mode resolved at INSERT",
    );
  }

  const backtestId = row.id;
  backtestSpan.setAttribute("backtestId", backtestId);

  try {
    const mode = config.mode ?? "single";

    // ── Wave 25 Gap B: Adaptive exit context injection ─────────────────────
    // When exit_engine="adaptive", populate config.adaptive_exit_context so the
    // Python backtester receives a valid AdaptiveExitContext object.
    //
    // Contract (from src/engine/config.py AdaptiveExitContext):
    //   adaptive_exit_context.liquidity_snapshot: list of {level_type, price,
    //     htf_significance, sweep_probability} — intraday-only levels for the symbol.
    //   adaptive_exit_context.regime_at_entry: string | null — regime fallback.
    //   adaptive_exit_context.pre_lunch_threshold_r: float (default 0.3)
    //   adaptive_exit_context.delta_div_threshold: float (default 0.6)
    //
    // POINT-IN-TIME INTEGRITY (look-ahead prevention):
    //   getNearestLiquidity() reads the CURRENT liquidity_levels table — today's live
    //   market structure (current PDH/PDL/untouched OBs). Using those levels on
    //   historical bars is look-ahead bias: a backtest for 2024-01 cannot know what
    //   the PDH was at each historical bar using today's data.
    //
    //   There is no point-in-time liquidity snapshot store — we cannot replay "what
    //   were the intraday liquidity levels on bar X at timestamp T?". Therefore:
    //     * liquidity_snapshot is intentionally [] for ALL historical backtests.
    //     * Python structural_targets.compute_single_tp() falls through to the
    //       +2.0R structural fallback — correct for replay; NOT a bug.
    //     * The PAPER path (paper-signal-service.ts) DOES call getNearestLiquidity()
    //       because it evaluates each bar at the current moment in live execution.
    //
    //   tp2_liquidity_unavailable=true is added to the context so downstream reviewers
    //   can distinguish "backtest used R-multiple TP2" from "paper used liquidity-mapped
    //   TP2" — parity gap is expected and documented here as intentional.
    const exitEngine = (config as unknown as Record<string, unknown>)["exit_engine"];
    if (exitEngine === "adaptive" && !(config as unknown as Record<string, unknown>)["adaptive_exit_context"]) {
      const exitPlanConfig = ((config as unknown as Record<string, unknown>)["strategy"] as Record<string, unknown> | null | undefined)?.["exit_plan_config"] as Record<string, unknown> | null | undefined;
      (config as unknown as Record<string, unknown>)["adaptive_exit_context"] = {
        // Empty by design — point-in-time historical liquidity not available.
        // Python falls back to +2.0R structural target. See comment above.
        liquidity_snapshot: [],
        tp2_liquidity_unavailable: true,
        tp2_liquidity_source: "backtest_no_historical_levels",
        regime_at_entry: null,   // Python backtester uses per-bar classify_institutional_regime
        pre_lunch_threshold_r: (exitPlanConfig?.["pre_lunch_threshold_r"] as number | null) ?? 0.3,
        delta_div_threshold: (exitPlanConfig?.["delta_div_threshold"] as number | null) ?? 0.6,
      };
    }

    // F-4 fix 2026-06-28: populate trial_n_total from research_trial_counter when
    // not already set by the caller (critic-optimizer-service.ts sets it on replay
    // paths; standard backtest launch paths never set it → Python defaults to 1 →
    // effective_n_trials = n_paths only → no cumulative deflation across critic loops).
    // Fail-soft: if the lookup errors or the row is absent, default to 1 (single
    // trial — backward-compatible, no extra deflation).
    if ((config as BacktestConfig).trial_n_total == null) {
      try {
        const [trialRow] = await db
          .select({ nTotal: researchTrialCounter.nTotal })
          .from(researchTrialCounter)
          .where(eq(researchTrialCounter.strategyId, strategyId))
          .limit(1);
        (config as BacktestConfig & { trial_n_total?: number }).trial_n_total =
          trialRow?.nTotal != null && trialRow.nTotal > 0 ? trialRow.nTotal : 1;
        logger.info(
          { strategyId, trial_n_total: (config as BacktestConfig & { trial_n_total?: number }).trial_n_total },
          "F-4: trial_n_total resolved from research_trial_counter for DSR deflation",
        );
      } catch (trialLookupErr) {
        logger.warn(
          { strategyId, err: trialLookupErr },
          "F-4: trial_n_total lookup failed — defaulting to 1 (no cumulative deflation)",
        );
        (config as BacktestConfig & { trial_n_total?: number }).trial_n_total = 1;
      }
    }

    const result = await CircuitBreakerRegistry.get("python-backtest").call(() =>
      runPythonModule<BacktestResult>({
        module: "src.engine.backtester",
        // Wave hardening 2026-06-22 (G1a): use buildBacktestArgs so --b15-battery
        // is conditionally appended based on B15_BATTERY_ENABLED env flag.
        args: buildBacktestArgs({ backtestId, mode, strategyClass }),
        config: config as unknown as Record<string, unknown>,
        timeoutMs: BACKTEST_TIMEOUT_MS,
        componentName: "backtest-engine",
        correlationId,
      }),
    );

    if (result.error) {
      await db
        .update(backtests)
        .set({
          status: "failed",
          errorMessage: result.error,
          executionTimeMs: result.execution_time_ms,
        })
        .where(eq(backtests.id, backtestId));

      backtestSpan.setAttribute("status", "failed");
      backtestSpan.setAttribute("errorFromPython", true);
      backtestSpan.end();
      backtestRuns.labels({ status: "failed", mode, tier: "none" }).inc();
      broadcastSSE("backtest:failed", { backtestId, strategyId, error: result.error });
      return { id: backtestId, status: "failed", error: result.error };
    }

    // Walk-forward returns metrics nested under oos_metrics — unwrap for DB storage
    const metrics = result.oos_metrics ?? result;
    // Store full walk-forward structure (windows, confidence, param_stability) separately.
    //
    // Wave hardening 2026-06-22 (G1b): explicitly include wfe_overall, wfe_status,
    // pbo_overall, pbo_overall_p_value in the type so the WFE + Wave 29 PBO lifecycle
    // gates have a compile-checked contract to read from. These keys are emitted at
    // walk_forward.py:1252 and were previously only surviving by accidental runtime
    // object spread — a Python rename would have silently dropped them with no TS error.
    type WfResultsShape = {
      confidence?: string;
      windows?: Array<Record<string, unknown>>;
      n_splits?: number;
      param_stability?: Record<string, unknown>;
      // Wave 27.5 Pass B — WFE gate inputs (walk_forward.py:1252)
      wfe_overall?: number | null;
      wfe_status?: string | null;
      // Wave 29 Pass A.2 — PBO gate inputs (walk_forward.py:1272)
      pbo_overall?: number | null;
      pbo_overall_p_value?: number | null;
      // FINDING-1 (deepscan 2026-06-28): CPCV-degenerate discriminator.
      pbo_degenerate?: boolean | null;
      // C1 fix 2026-06-28 — wf_metadata sibling emitted by walk_forward.py.
      // Contains DSR gate inputs (dsr_pass, dsr_unavailable, dsr) and CPCV
      // orchestrator inputs (mode, n_paths).  Was previously discarded here,
      // silently disabling the DSR gate (fail-OPEN) and starving the CPCV
      // n_paths gate (fail-CLOSED) on the walkForwardResults JSONB column.
      //
      // hardening/phase-0 CPCV-exempt fields (nested inside wf_metadata):
      //   pbo_degenerate_reason?: "cpcv_is_sharpe_unavailable"
      //     — walk_forward.py emits this when mode="cpcv". PBO rank-comparison
      //       is structurally unavailable in CPCV mode. Read by lifecycle-service.ts
      //       PBO gate to emit "lifecycle.pbo_cpcv_is_unavailable" instead of
      //       the generic "lifecycle.pbo_unavailable_legacy".
      //   bif_reliable?: false
      //     — walk_forward.py emits this when mode="cpcv". BIF IS-Sharpe proxy
      //       and OOS agg_sharpe both derive from OOS data → BIF ≈ 1.0 structurally.
      //       Read by lifecycle-service.ts _promoteStrategyInner BIF pre-check to
      //       emit "lifecycle.bif_cpcv_unmeasured" audit before evaluatePaperToDeployReadyGates.
      //
      // Both fields are carried verbatim through this JSONB blob — no separate
      // top-level key needed; lifecycle-service.ts drills into wf_metadata directly.
      wf_metadata?: Record<string, unknown> | null;
    };
    const wfResults: WfResultsShape | null = result.oos_metrics
      ? {
          confidence: result.confidence,
          windows: result.windows as Array<Record<string, unknown>>,
          n_splits: result.n_splits,
          param_stability: result.param_stability,
          wfe_overall: result.wfe_overall as number | null | undefined,
          wfe_status: result.wfe_status as string | null | undefined,
          pbo_overall: result.pbo_overall as number | null | undefined,
          pbo_overall_p_value: result.pbo_overall_p_value as number | null | undefined,
          // Merge 2026-06-29: the CPCV-degenerate discriminator now rides INSIDE
          // wf_metadata as pbo_degenerate_reason ("cpcv_is_sharpe_unavailable"), persisted
          // wholesale below and read by lifecycle at wf_metadata.pbo_degenerate_reason.
          // (Superseded the deepscan-wiring top-level pbo_degenerate boolean.)
          wf_metadata: result.wf_metadata as Record<string, unknown> | null | undefined,
        }
      : (() => {
          const wfr = result.walk_forward_results as WfResultsShape | null | undefined;
          return wfr ?? null;
        })();

    // ─── Pre-compute trade rows (pure computation — outside the transaction) ───
    const trades = result.trades ?? [];
    const tradeRows = trades.map((t) => {
      // vectorbt records_readable columns:
      //   "Entry Timestamp" (int index or ISO string), "Exit Timestamp",
      //   "Avg Entry Price", "Avg Exit Price", "PnL", "Direction", "Size"
      const entryTs = t["Entry Timestamp"] ?? t["entry_time"];
      const exitTs = t["Exit Timestamp"] ?? t["exit_time"];

      // Entry/exit timestamps may be integer indices or ISO date strings
      const parseTs = (v: unknown): Date => {
        if (v == null) return new Date();
        if (typeof v === "string" && v.includes("-")) return new Date(v);
        // Integer index from vectorbt — use backtest start date + offset
        return config.start_date ? new Date(config.start_date + "T00:00:00Z") : new Date();
      };

      const direction = (t["Direction"] as string ?? t["direction"] as string ?? "long");

      return {
        backtestId,
        entryTime: parseTs(entryTs),
        exitTime: exitTs != null ? parseTs(exitTs) : null,
        direction: direction.toLowerCase().includes("short") ? "short" : "long",
        entryPrice: String(t["Avg Entry Price"] ?? t["Entry Price"] ?? t["entry_price"] ?? 0),
        exitPrice: t["Avg Exit Price"] != null || t["Exit Price"] != null || t["exit_price"] != null
          ? String(t["Avg Exit Price"] ?? t["Exit Price"] ?? t["exit_price"])
          : null,
        pnl: t["PnL"] != null || t["pnl"] != null
          ? String(t["PnL"] ?? t["pnl"])
          : null,
        netPnl: t["PnL"] != null || t["pnl"] != null
          ? String(t["PnL"] ?? t["pnl"])
          : null,
        grossPnl: t["GrossPnL"] != null || t["gross_pnl"] != null
          ? String(t["GrossPnL"] ?? t["gross_pnl"])
          : null,
        slippage: t["SlippageCost"] != null || t["slippage_cost"] != null
          ? String(t["SlippageCost"] ?? t["slippage_cost"])
          : null,
        commission: t["CommissionCost"] != null || t["commission_cost"] != null
          ? String(t["CommissionCost"] ?? t["commission_cost"])
          : null,
        contracts: Math.round(Number(t["Size"] ?? t["size"] ?? 1)),
        mae: t["MAE"] != null || t["mae"] != null
          ? String(t["MAE"] ?? t["mae"])
          : null,
        mfe: t["MFE"] != null || t["mfe"] != null
          ? String(t["MFE"] ?? t["mfe"])
          : null,
      };
    });

    // ─── Transactional completion writes ─────────────────────────────────────
    // All core persistence for a completed backtest runs in one transaction.
    // If the process crashes mid-write, the backtest row stays in "running"
    // and the incomplete partial writes are rolled back — no inconsistent state.
    //
    // Equity curve size guard: downsample before persisting. Long backtests
    // (years of intraday) can produce 10K+ point curves = many MB per row.
    // We keep originalLength + stride alongside so charts can show "showing
    // 5000 of 73,481 points (sampled every 15)".
    const rawEquityCurve = result.equity_curve ?? metrics.equity_curve ?? null;
    const equityCurveGuard = downsampleEquityCurve(rawEquityCurve as unknown[] | null);

    await db.transaction(async (tx) => {
      // 1. Update backtest row with full results
      await tx
        .update(backtests)
        .set({
          status: "completed",
          totalReturn: metrics.total_return != null ? String(metrics.total_return) : null,
          sharpeRatio: metrics.sharpe_ratio != null ? String(metrics.sharpe_ratio) : null,
          maxDrawdown: metrics.max_drawdown != null ? String(metrics.max_drawdown) : null,
          winRate: metrics.win_rate != null ? String(metrics.win_rate) : null,
          profitFactor: metrics.profit_factor != null ? String(metrics.profit_factor) : null,
          totalTrades: (metrics.total_trades as number) ?? null,
          avgTradePnl: metrics.avg_trade_pnl != null ? String(metrics.avg_trade_pnl) : null,
          avgDailyPnl: metrics.avg_daily_pnl != null ? String(metrics.avg_daily_pnl) : null,
          tier: result.tier ?? null,
          forgeScore: result.forge_score != null ? String(result.forge_score) : null,
          equityCurve: equityCurveGuard.downsampled,
          monthlyReturns: result.monthly_returns ?? null,
          dailyPnls: result.daily_pnls ?? metrics.daily_pnls ?? null,
          walkForwardResults: wfResults,
          propCompliance: result.prop_compliance ?? null,
          decayAnalysis: normalizeDecayAnalysis(result.decay_analysis as Record<string, unknown> | undefined),
          runReceipt: result.run_receipt ?? null,
          sanityChecks: result.sanity_checks ?? null,
          crossValidation: result.cross_validation ?? null,
          // Fix 3: persist full gate_result — normalizeGateResult is a passthrough
          // that makes the Python→DB contract explicit. The architect agent reads
          // gateResult.components.survival_score from this column.
          gateResult: normalizeGateResult(result.gate_result as Record<string, unknown> | undefined | null),
          gateRejections: result.gate_rejections ?? null,
          // Fix 4: persist additional Python engine outputs (migration 0053)
          // Equity curve guard: append downsample metadata so charts know the original length.
          resultExtras: (() => {
            const base = buildResultExtras(result) ?? {};
            if (equityCurveGuard.originalLength > 0) {
              base.equity_curve_original_length = equityCurveGuard.originalLength;
              base.equity_curve_stride = equityCurveGuard.stride;
            }
            return Object.keys(base).length > 0 ? base : null;
          })(),
          executionTimeMs: result.execution_time_ms,
          // A13: Information Ratio — written once on backtest completion.
          // Null when engine returned null (insufficient benchmark data or < 2 bars).
          informationRatio: result.information_ratio != null ? String(result.information_ratio) : null,
          // Wave 3 Track 3B — BIF gate fields.
          // Python WF result carries `bif` (Bias Information Factor) and `k_eff`
          // (effective parameter count) at the top level of the result dict.
          // Fail-soft: null when the Python side has not yet emitted the field
          // (pre-Wave-3 backtests); lifecycle gate treats null as a grandfather pass.
          bif: result.bif != null ? String(result.bif) : null,
          kEff: result.k_eff != null ? String(result.k_eff) : null,
          // WRC / SPA — data-snooping guard results wired from Python walk_forward.py.
          // Python emits these at both CPCV and plain/purged_embargo WF paths.
          // Contract (producer → DB → gate):
          //   wrc_result.p_value         → backtests.wrc_result (JSONB) → wrcPValue gate
          //   spa_result.spa_consistent_p → backtests.spa_result (JSONB) → spaConsistentP gate
          // Fail-soft: null when available=false (insufficient OOS obs or computation error).
          // Gate in promotion-gate-orchestrator.ts reads:
          //   (wrcResult?.p_value as number | null) → evaluateWrcGate()
          //   (spaResult?.spa_consistent_p as number | null) → evaluateSpaGate()
          // When null → fail-CLOSED unless PROMOTION_GRANDFATHER_PRE_PASS_E=true.
          wrcResult:
            (result.wrc_result as Record<string, unknown> | null | undefined) ?? null,
          spaResult:
            (result.spa_result as Record<string, unknown> | null | undefined) ?? null,
        })
        .where(eq(backtests.id, backtestId));

      // 2. Persist walk-forward windows for queryability
      if (wfResults?.windows?.length) {
        // Aggregate param_stability from the top-level result — applies to all windows equally
        const aggregateParamStability = wfResults.param_stability ?? null;
        await tx.insert(walkForwardWindows).values(
          wfResults.windows.map((w: any, idx: number) => {
            // Validate per-window OOS metrics against canonical schema before persisting.
            // A parse failure is a non-fatal warning — the window still inserts with
            // whatever the engine returned. This protects downstream consumers from
            // silently receiving partial metrics without crashing the backtest run.
            const metricsParseResult = WFWindowMetricsSchema.safeParse(w.oos_metrics);
            if (!metricsParseResult.success) {
              logger.warn(
                {
                  backtestId,
                  windowIndex: w.window ?? idx + 1,
                  issues: metricsParseResult.error.issues,
                  rawMetrics: w.oos_metrics,
                },
                "WFWindowMetrics schema mismatch — engine output missing expected fields",
              );
            }

            // IS metrics: the optimizer's IS Sharpe is the only per-window IS performance metric.
            // If optimization ran, surface it; otherwise null.
            const isMetrics = w.optimization
              ? {
                  sharpe_ratio: w.optimization.best_sharpe ?? null,
                  best_params: w.optimization.best_params ?? null,
                  trials_used: w.optimization.trials_used ?? null,
                }
              : null;

            return {
              backtestId: backtestId,
              windowIndex: w.window ?? idx + 1,
              isStart: w.is_start ?? null,
              isEnd: w.is_end ?? null,
              oosStart: w.oos_start ?? null,
              oosEnd: w.oos_end ?? null,
              bestParams: w.optimization?.best_params ?? null,
              isMetrics,
              oosMetrics: w.oos_metrics ?? null,
              paramStability: aggregateParamStability,
              confidence: w.confidence ?? null,
            };
          })
        );
      }

      // 3. Track search budget (cumulative Optuna trials)
      if (wfResults?.windows?.length) {
        const totalTrials = wfResults.windows.reduce(
          (sum: number, w: Record<string, unknown>) => {
            const opt = w.optimization as Record<string, unknown> | undefined;
            return sum + (Number(opt?.trials_used ?? opt?.n_trials ?? 0));
          },
          0,
        );
        if (totalTrials > 0) {
          await tx
            .update(strategies)
            .set({
              searchBudgetUsed: sql`COALESCE(${strategies.searchBudgetUsed}, 0) + ${totalTrials}`,
            })
            .where(eq(strategies.id, strategyId));
        }
      }

      // 4. Bulk insert trades
      if (tradeRows.length > 0) {
        await tx.insert(backtestTrades).values(tradeRows);
      }

      // 5. Persist crisis/stress test results
      if (result.crisis_results && typeof result.crisis_results === "object") {
        const cr = result.crisis_results as Record<string, unknown>;
        await tx.insert(stressTestRuns).values({
          backtestId,
          passed: cr.passed === true,
          scenarios: cr.scenarios ?? [],
          failedScenarios: cr.failed_scenarios ?? [],
          executionTimeMs: typeof cr.execution_time_ms === "number" ? cr.execution_time_ms : null,
        });
      }

      // 6. Audit log — written inside the transaction so it only exists if everything committed
      await tx.insert(auditLog).values({
        action: "backtest.run",
        entityType: "backtest",
        entityId: backtestId,
        input: config as unknown as Record<string, unknown>,
        result: {
          total_return: result.total_return,
          sharpe_ratio: result.sharpe_ratio,
          total_trades: result.total_trades,
          tier: result.tier,
        },
        status: "success",
        durationMs: result.execution_time_ms,
        correlationId: correlationId ?? null,
      });
    });

    // ─── Broadcast completion SSE ─────────────────────────────────
    broadcastSSE("backtest:completed", {
      backtestId,
      strategyId,
      tier: result.tier ?? null,
      forgeScore: result.forge_score ?? null,
    });

    // ─── Truthiness Check (B-1 parity shadow + B-2 invariants) ──────────────
    // Fires post-transaction (non-blocking fire-and-forget). Any truthiness
    // failure is audited, Discord-alerted, and surfaced via SSE so the
    // dashboard shows it without operator digging.
    //
    // Data sources (in priority order):
    //   1. result.parity_shadow / result.invariants — embedded in Python stdout
    //   2. result._truthiness_events — sentinel lines captured from Python stderr
    //      by python-runner.ts (B-1 / B-2 sentinel parsing)
    //
    // Both sources are checked so neither integration path is missed.
    (async () => {
      try {
        const resultRecord = result as unknown as Record<string, unknown>;

        // Merge sentinel events from stderr side-channel into result-level fields.
        // python-runner attaches _truthiness_events when it parsed sentinel lines.
        const stderrEvents = (resultRecord._truthiness_events as Array<{ type: string; payload: Record<string, unknown> }> | undefined) ?? [];
        for (const ev of stderrEvents) {
          if (ev.type === "parity_shadow_drift" && !result.parity_shadow) {
            result.parity_shadow = ev.payload as BacktestResult["parity_shadow"];
          }
          if (ev.type === "invariant_failure" && !result.invariants) {
            result.invariants = ev.payload as BacktestResult["invariants"];
          }
          // B15 battery sentinel — persist to backtests.b15_battery JSONB (Wave 25 Item 5)
          if (ev.type === "b15_battery" && ev.payload?.result) {
            try {
              await db
                .update(backtests)
                .set({ b15Battery: ev.payload.result as Record<string, unknown> })
                .where(eq(backtests.id, backtestId));
              logger.info(
                {
                  event: "backtest.b15_battery_persisted",
                  backtestId,
                  strategyId,
                  sdr: (ev.payload.result as Record<string, unknown>).sdr,
                  psi: (ev.payload.result as Record<string, unknown>).psi,
                  rws: (ev.payload.result as Record<string, unknown>).rws,
                  passed: (ev.payload.result as Record<string, unknown>).passed,
                },
                "B15 battery result persisted to backtests.b15_battery",
              );
            } catch (b15PersistErr) {
              logger.warn(
                { backtestId, strategyId, err: b15PersistErr },
                "B15 battery persist failed (non-blocking)",
              );
            }
          }
        }

        const parityShadow = result.parity_shadow;
        const invariants = result.invariants;

        // Evaluate failure conditions
        const invariantFailed = invariants != null && invariants.overall_passed === false;
        const invariantCritical = invariantFailed && (invariants.critical_failures?.length ?? 0) > 0;

        // parityFailed = parity RAN and still disagreed (ran=true + passed=false).
        // When ran=false with reason="strategy_archetype_not_supported" that is an
        // expected skip — not a failure. When ran=false with any other reason that
        // is an unexpected skip (engine crash / missing dep) captured by parityUnexpectedSkip.
        const parityFailed = parityShadow != null && parityShadow.ran === true && parityShadow.passed === false;
        const parityCatastrophic = parityFailed && (parityShadow.pnl_diff_pct ?? 0) > 1.0;

        // parity ran=false is expected for unsupported archetypes — only alert on
        // unexpected non-runs (e.g. parity was supposed to run but crashed silently).
        const parityUnexpectedSkip =
          parityShadow != null &&
          parityShadow.ran === false &&
          parityShadow.reason !== "strategy_archetype_not_supported";

        const hasTruthinessFailure = invariantFailed || parityFailed || parityUnexpectedSkip;

        if (!hasTruthinessFailure) {
          // All checks passed — log a brief confirmation for queryability.
          if (parityShadow != null || invariants != null) {
            logger.info(
              {
                event: "backtest.truthiness_passed",
                backtestId,
                strategyId,
                correlationId: correlationId ?? null,
                parityRan: parityShadow?.ran ?? null,
                invariantsChecked: invariants != null,
              },
              "backtest.truthiness: all checks passed",
            );
          }
          return;
        }

        // ── Determine overall severity ──────────────────────────────────────
        const severity = invariantCritical || parityCatastrophic ? "CRITICAL" : "WARNING";

        // ── Build evidence summary ──────────────────────────────────────────
        const evidenceParts: string[] = [];
        if (invariantFailed) {
          const critList = (invariants.critical_failures ?? []).join(", ") || "none listed";
          const failList = (invariants.failed ?? []).join(", ") || "none listed";
          evidenceParts.push(`invariants failed: critical=[${critList}] all=[${failList}]`);
        }
        if (parityFailed) {
          const diff = parityShadow.pnl_diff_pct != null
            ? `pnl_diff_pct=${(parityShadow.pnl_diff_pct * 100).toFixed(2)}%`
            : "diff=unknown";
          const vbt = parityShadow.vbt_total_pnl != null ? `vbt=$${parityShadow.vbt_total_pnl}` : "";
          const bt = parityShadow.bt_total_pnl != null ? `bt=$${parityShadow.bt_total_pnl}` : "";
          evidenceParts.push(`parity shadow drift: ${diff} ${vbt} ${bt}`.trim());
        }
        if (parityUnexpectedSkip) {
          evidenceParts.push(`parity shadow skipped unexpectedly: reason=${parityShadow?.reason ?? "unknown"}`);
        }
        const evidenceSummary = evidenceParts.join(" | ");

        // ── Audit log ────────────────────────────────────────────────────────
        const auditAction = invariantFailed ? "backtest.invariants_failed" : "backtest.parity_shadow_drift";
        await insertAuditRow({
          action: auditAction,
          entityType: "backtest",
          entityId: backtestId,
          input: {
            strategyId,
            symbol: config.strategy.symbol,
            startDate: config.start_date,
            endDate: config.end_date,
          },
          result: {
            invariant_report: invariants ?? null,
            parity_shadow_report: parityShadow ?? null,
            severity,
            evidence_summary: evidenceSummary,
          },
          status: "failure",
          decisionAuthority: "system",
          correlationId: correlationId ?? null,
        });

        logger.error(
          {
            event: auditAction,
            backtestId,
            strategyId,
            symbol: config.strategy.symbol,
            severity,
            correlationId: correlationId ?? null,
            invariant_report: invariants ?? null,
            parity_shadow_report: parityShadow ?? null,
          },
          `backtest.truthiness: ${severity} failure — ${evidenceSummary}`,
        );

        // ── SSE — live dashboard surfacing ────────────────────────────────────
        broadcastSSE("backtest:truthiness_failure", {
          backtestId,
          strategyId,
          type: invariantFailed ? "invariant" : parityFailed ? "parity" : "parity_skip",
          severity,
          evidence: evidenceSummary,
          invariant_report: invariants ?? null,
          parity_shadow_report: parityShadow ?? null,
          correlationId: correlationId ?? null,
          timestamp: new Date().toISOString(),
        });

        // ── Discord alert (CRITICAL failures only) ────────────────────────────
        if (severity === "CRITICAL") {
          const strategySymbol = config.strategy.symbol;
          const strategyName = config.strategy.name ?? strategyId;
          const dateRange = `${config.start_date ?? "?"} → ${config.end_date ?? "?"}`;
          const failureType = invariantFailed
            ? (invariants.critical_failures?.[0] ?? "invariant_failure")
            : "parity_drift";

          const { appendFamilyGradePostscript: appendFGP } = await import("../lib/notification-helpers.js");
          notifyCritical(
            "BACKTEST TRUTHINESS FAILURE",
            appendFGP(
              [
                `Backtest: ${backtestId}`,
                `Strategy: ${strategyName} (${strategySymbol})`,
                `Dates: ${dateRange}`,
                `Failure type: ${failureType}`,
                `Evidence: ${evidenceSummary}`,
                `Severity: ${severity}`,
              ].join("\n"),
              "A backtest failed unexpectedly — the result couldn't be verified against expected behavior.",
              "No action needed — the bot will retry. Call Tony if backtests keep failing.",
            ),
            {
              backtestId,
              strategyId,
              symbol: strategySymbol,
              correlationId: correlationId ?? null,
            },
          );
        }
      } catch (truthinessErr) {
        // Non-blocking — truthiness audit/alert failure must never abort the backtest flow.
        logger.warn(
          { backtestId, strategyId, err: truthinessErr },
          "backtest.truthiness: audit/alert block failed (non-blocking — backtest is still completed)",
        );
      }
    })();

    // ─── W27.5 C.2: Compliance aggregation Discord warning ─────────────────────
    // When enforce mode is active and violations exceeded 5% of attempted trades,
    // emit a family-grade Discord WARN so operators know how many trades were
    // blocked by firm-rule enforcement.
    (async () => {
      try {
        const resultRecord = result as unknown as Record<string, unknown>;
        // parity_gate field (W27.5 C.2) carries compliance gate stats at top-level result.
        // run_receipt.parity_long / parity_short is the backward-compat fallback.
        const parityGate = resultRecord.parity_gate as Record<string, unknown> | null | undefined;
        const runReceipt = resultRecord.run_receipt as Record<string, unknown> | null | undefined;
        if (!parityGate && !runReceipt) return;

        // Aggregate compliance_blocked across long + short parity stats
        const parityLong = (parityGate?.["long"] ?? runReceipt?.parity_long) as Record<string, unknown> | null | undefined;
        const parityShort = (parityGate?.["short"] ?? runReceipt?.parity_short) as Record<string, unknown> | null | undefined;
        const blockedLong = Number(parityLong?.compliance_blocked ?? 0);
        const blockedShort = Number(parityShort?.compliance_blocked ?? 0);
        const totalBlocked = blockedLong + blockedShort;
        const complianceModeInResult = String(parityLong?.compliance_mode ?? parityShort?.compliance_mode ?? resolvedComplianceMode);

        if (complianceModeInResult !== "enforce" || totalBlocked === 0) return;

        // Compute attempted = signals_evaluated before blocking
        const attemptedLong = Number(parityLong?.skip_signals_evaluated ?? 0) + blockedLong;
        const attemptedShort = Number(parityShort?.skip_signals_evaluated ?? 0) + blockedShort;
        const totalAttempted = attemptedLong + attemptedShort;

        if (totalAttempted === 0) return;

        const blockedPct = totalBlocked / totalAttempted;
        const DISCORD_THRESHOLD = 0.05; // 5% of attempted trades

        // Log at info level regardless of threshold
        logger.info(
          {
            event: "backtest.compliance_enforcement_summary",
            backtestId,
            strategyId,
            totalBlocked,
            totalAttempted,
            blockedPct: (blockedPct * 100).toFixed(1) + "%",
            complianceMode: complianceModeInResult,
          },
          "Compliance gate enforcement summary",
        );

        // Emit audit row for every enforce-mode backtest that had blocks
        await insertAuditRowSafe({
          action: "compliance.enforce_block",
          entityType: "backtest",
          entityId: backtestId,
          input: { strategyId, complianceMode: complianceModeInResult },
          result: {
            total_blocked: totalBlocked,
            total_attempted: totalAttempted,
            blocked_pct: blockedPct,
            violation_types: (parityLong?.compliance_violations as unknown[] | undefined ?? [])
              .concat(parityShort?.compliance_violations as unknown[] | undefined ?? []),
          },
          status: "success",
        });

        if (blockedPct > DISCORD_THRESHOLD) {
          const { notifyWarning } = await import("./notification-service.js");
          const { appendFamilyGradePostscript } = await import("../lib/notification-helpers.js");
          const strategyName = config.strategy.name ?? strategyId;
          const firmId = (config as unknown as Record<string, unknown>).firm_key as string | undefined ?? "unknown";
          const topViolation = (() => {
            const allViolations = [
              ...(parityLong?.compliance_violations as Array<Record<string, unknown>> | undefined ?? []),
              ...(parityShort?.compliance_violations as Array<Record<string, unknown>> | undefined ?? []),
            ];
            if (!allViolations.length) return "unknown";
            // Count by type
            const counts: Record<string, number> = {};
            for (const v of allViolations) {
              const t = String(v?.type ?? "unknown");
              counts[t] = (counts[t] ?? 0) + 1;
            }
            return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
          })();

          const operatorBody =
            `[WARN] Compliance enforcement blocked ${totalBlocked}/${totalAttempted} trades during backtest of ${strategyName}\n` +
            `Firm: ${firmId}\n` +
            `Blocked: ${(blockedPct * 100).toFixed(1)}% of attempted trades\n` +
            `Most common violation: ${topViolation}\n` +
            `Report: /api/backtests/${backtestId}/compliance-summary`;

          const plainWhat =
            "The bot was tested against a prop firm's rules. " +
            `Some attempted trades (${totalBlocked} of ${totalAttempted}) would have broken the rules and were blocked.`;

          const plainAction =
            "If this strategy moves to live trading, those trades simply won't happen. No action needed.";

          notifyWarning(
            "Compliance Enforcement Blocked Trades",
            appendFamilyGradePostscript(operatorBody, plainWhat, plainAction),
            { backtestId, strategyId, totalBlocked, totalAttempted, firmId },
          );
        }
      } catch (complianceAggErr) {
        logger.warn(
          { backtestId, strategyId, err: complianceAggErr },
          "Compliance aggregation Discord warning failed (non-blocking)",
        );
      }
    })();

    // ─── CF-3 Fix: Sync forgeScore + tier onto strategies row unconditionally ──
    // Previously, strategies.forgeScore was only updated inside the TIER_1/2/3
    // auto-promote gate (lines below). REJECTED-tier strategies never had their
    // forge_score reflected on the strategies row, so the UI showed 0/null and
    // the lifecycle gate had no evidence of the actual computed score.
    //
    // Now: update strategies.forgeScore for ALL completed backtests, regardless of
    // tier outcome. This lets operators see "REJECTED at 14/100" instead of "0",
    // which is the actual signal for "how close is this to the 50-point gate?".
    //
    // We do NOT update strategies.lifecycleState here — that stays gated on the
    // TIER_1/2/3 fast-track or lifecycle-service.checkAutoPromotions.
    if (result.forge_score != null) {
      await db
        .update(strategies)
        .set({ forgeScore: String(result.forge_score) })
        .where(eq(strategies.id, strategyId));

      // Broadcast backtest:scored so dashboards update immediately on completion.
      broadcastSSE("backtest:scored", {
        backtestId,
        strategyId,
        forgeScore: result.forge_score,
        tier: result.tier ?? null,
        gateRejected: result.tier === "REJECTED" || !result.tier,
        correlationId: correlationId ?? null,
      });

      // Audit log: forge scoring outcome — structured evidence for promotion decisions.
      // Non-transactional (fires outside the main tx) — failure is non-blocking.
      // Track A F-6: migrated to insertAuditRowSafe (absorbs write failures without .catch chain)
      await insertAuditRowSafe({
        action: "backtest.scored",
        entityType: "backtest",
        entityId: backtestId,
        input: { strategyId, tier: result.tier ?? null },
        result: {
          forgeScore: result.forge_score,
          tier: result.tier ?? null,
          gateRejected: result.tier === "REJECTED" || !result.tier,
          totalTrades: result.total_trades ?? null,
          sharpeRatio: result.sharpe_ratio ?? null,
          avgDailyPnl: result.avg_daily_pnl ?? null,
        },
        status: result.tier && ["TIER_1", "TIER_2", "TIER_3"].includes(result.tier) ? "success" : "failure",
        decisionAuthority: "gate",
        correlationId: correlationId ?? null, // TODO: correlation_id not always threaded here
      });

      // Prometheus counter for tier distribution monitoring
      backtestScoredTotal.labels({ tier: result.tier ?? "null" }).inc();

      logger.info(
        { backtestId, strategyId, forgeScore: result.forge_score, tier: result.tier ?? null, gateRejected: result.tier === "REJECTED" || !result.tier },
        "backtest.scored: strategies.forgeScore updated",
      );
    }

    // W9-3: Broadcast per-window walk-forward progress SSE. Fires post-commit
    // (same pattern as graveyard_burial) so events only emit on durable rows.
    if (wfResults?.windows?.length) {
      const ts = new Date().toISOString();
      for (let idx = 0; idx < wfResults.windows.length; idx++) {
        const w = wfResults.windows[idx] as Record<string, unknown>;
        const oosMetrics = (w.oos_metrics as Record<string, unknown> | undefined) ?? null;
        const oosSharpe = oosMetrics?.sharpe_ratio != null ? Number(oosMetrics.sharpe_ratio) : null;
        const oosNetPnl = oosMetrics?.total_return != null ? Number(oosMetrics.total_return) : null;
        // A window "passed" if OOS Sharpe >= 0.5 (minimum viable threshold)
        const passed = oosSharpe != null ? oosSharpe >= 0.5 : false;
        broadcastSSE("walkforward:window_complete", {
          backtestId,
          strategyId,
          windowIndex: typeof w.window === "number" ? w.window : idx + 1,
          windowStart: (w.oos_start as string | null) ?? null,
          windowEnd: (w.oos_end as string | null) ?? null,
          oosSharpe,
          oosNetPnl,
          passed,
          correlationId: correlationId ?? null,
          timestamp: ts,
        });
      }
    }

    backtestRuns.labels({ status: "completed", mode, tier: result.tier ?? "none" }).inc();

    // ─── A2: Backtest Provenance Tracking (fire-and-forget) ──────────────────
    // Write a provenance row for every completed backtest. Non-blocking — a
    // provenance write failure MUST NOT abort the backtest flow.
    //
    // result_hash: SHA-256 of the canonical result JSON. With DETERMINISM_MODE=true,
    //   identical inputs produce identical result_hash values. Divergent hashes for
    //   the same (data_hash, code_git_sha, strategy_hash) triple signal nondeterminism.
    //
    // result.provenance_meta is optionally emitted by backtester.py when
    //   DETERMINISM_MODE=true. Fields: python_version, numpy_version,
    //   determinism_env_set. When absent (older engine, test fixtures), we store null.
    (async () => {
      try {
        const resultRecord = result as unknown as Record<string, unknown>;
        const provenanceMeta = resultRecord.provenance_meta as
          | { python_version?: string; numpy_version?: string; determinism_env_set?: boolean }
          | undefined;

        const dataHash = computeDataHash(
          String(config.strategy?.symbol ?? "unknown"),
          String(config.strategy?.timeframe ?? "unknown"),
          String(config.start_date ?? ""),
          String(config.end_date ?? ""),
        );

        const strategyHash = computeStrategyHash(config.strategy ?? config);

        // Code git SHA: prefer explicit FORGE_GIT_SHA env var (injected by deploy
        // pipeline), fall back to "unknown" (no git available in this process).
        const codeGitSha = process.env.FORGE_GIT_SHA ?? "unknown";

        // Compute result hash from the raw Python result dict. We hash the full
        // result including provenance_meta so that environment changes are visible.
        const resultHash = computeResultHash(resultRecord);

        await db.insert(backtestProvenance).values({
          backtestId,
          dataHash,
          codeGitSha,
          strategyHash,
          resultHash,
          pythonVersion: provenanceMeta?.python_version ?? null,
          numpyVersion: provenanceMeta?.numpy_version ?? null,
          determinismEnvSet: provenanceMeta?.determinism_env_set ?? null,
        });

        logger.debug(
          { backtestId, strategyId, dataHash, codeGitSha: codeGitSha.slice(0, 8), resultHash: resultHash.slice(0, 8) },
          "A2 provenance: row written",
        );
      } catch (provenanceErr) {
        // Non-blocking — provenance write failure must never abort the backtest flow.
        logger.warn(
          { backtestId, strategyId, err: provenanceErr },
          "A2 provenance: write failed (non-blocking — backtest is still completed)",
        );
      }
    })();

    // ─── A7: Signal Vector Persistence (fire-and-forget) ─────────────────────
    // Persist the signal vector emitted by backtester.py for cross-correlation checks.
    // Non-blocking — a signal vector write failure MUST NOT abort the backtest flow.
    //
    // signal_vector: Python list of int8 per bar (1=long, -1=short, 0=none).
    // Compressed with gzip (Node built-in zlib) before DB storage.
    // Used by PAPER→DEPLOY_READY gate (fail-closed) and /api/signal-correlation/matrix.
    //
    // Fire-and-forget pattern matches A2 provenance block immediately above.
    (async () => {
      try {
        const resultRecord = result as unknown as Record<string, unknown>;
        const signalVector = resultRecord.signal_vector;

        if (!Array.isArray(signalVector) || signalVector.length === 0) {
          logger.debug(
            { backtestId, strategyId },
            "A7: no signal_vector in result (old engine or empty run) — skipping persistence",
          );
          return;
        }

        const { persistSignalVector } = await import("./signal-correlation-service.js");
        const persisted = await persistSignalVector(strategyId, backtestId, signalVector as number[]);

        if (persisted) {
          logger.debug(
            { backtestId, strategyId, nBars: signalVector.length },
            "A7: signal vector persisted",
          );
        }
      } catch (sigVecErr) {
        // Non-blocking — signal vector write failure must never abort the backtest flow.
        logger.warn(
          { backtestId, strategyId, err: sigVecErr },
          "A7: signal vector persistence failed (non-blocking — backtest is still completed)",
        );
      }
    })();

    // ─── A14: Synthetic Black Swan Survival evaluation (fire-and-forget) ──────
    // Runs the synthetic regime evaluator AFTER backtest completion against the
    // synthetic regime bank (W19 / Pass 4 wiring).
    //
    // Hard contract — DO NOT change:
    //   - Fire-and-forget. NEVER awaited. NEVER affects backtest return value.
    //   - Errors from runBlackSwanTest swallowed via .catch() with logger.error.
    //   - Phase 0 advisory: lifecycle-service reads the latest run; promotion
    //     never blocks on this evaluation.
    //
    // Pattern source: A7 signal-vector persistence block immediately above.
    (async () => {
      try {
        const { runBlackSwanTest } = await import("./synthetic-black-swan-service.js");
        runBlackSwanTest(backtestId, strategyId, { correlationId: correlationId ?? undefined })
          .catch((err) => logger.error({ err, backtestId }, "synth_black_swan_eval_failed"));
      } catch (importErr) {
        // Dynamic import failure is non-blocking — backtest is still completed.
        logger.warn(
          { backtestId, strategyId, err: importErr },
          "A14: synthetic black swan dynamic import failed (non-blocking — backtest still completed)",
        );
      }
    })();

    // ─── B10: MRP (Minimum Regime Performance) computation (fire-and-forget) ──
    // Computes per-regime Sharpe from backtestTrades.macroRegime groupings and
    // stores the minimum (worst-regime Sharpe) as mrp_sharpe on the backtest row.
    //
    // Reuses backtestTrades already written in the main tx above. Non-blocking.
    // Null macroRegime trades are bucketed into a synthetic "UNKNOWN" regime group
    // and excluded from the MRP minimum (only named regimes count for the gate).
    //
    // Sharpe per regime: (mean_pnl / std_pnl) * sqrt(252) — annualized.
    // Requires >= 3 trades in a regime group to compute Sharpe (fewer → ignored).
    //
    // mrp_sharpe = min(regime_sharpes.values()) — worst-regime Sharpe.
    // Soft gate: MRP > 0.5 advisory at PAPER → DEPLOY_READY; hard gate after 30 days.
    (async () => {
      try {
        const trades = await db
          .select({ pnl: backtestTrades.pnl, macroRegime: backtestTrades.macroRegime })
          .from(backtestTrades)
          .where(eq(backtestTrades.backtestId, backtestId));

        if (trades.length === 0) {
          logger.debug({ backtestId }, "B10 MRP: no trades — skipping MRP computation");
          return;
        }

        // Group trades by macroRegime
        const byRegime: Record<string, number[]> = {};
        for (const t of trades) {
          const regime = t.macroRegime ?? "UNKNOWN";
          if (!byRegime[regime]) byRegime[regime] = [];
          byRegime[regime].push(parseFloat(String(t.pnl ?? 0)));
        }

        // Compute per-regime Sharpe (annualized, min 3 trades required)
        const ANNUALIZE = Math.sqrt(252);
        const MIN_TRADES_PER_REGIME = 3;
        const regimeSharpes: Record<string, number> = {};

        for (const [regime, pnls] of Object.entries(byRegime)) {
          if (regime === "UNKNOWN" || pnls.length < MIN_TRADES_PER_REGIME) continue;
          const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
          const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length;
          const std = Math.sqrt(variance);
          if (std === 0) continue;  // Constant PnL — can't compute meaningful Sharpe
          regimeSharpes[regime] = (mean / std) * ANNUALIZE;
        }

        if (Object.keys(regimeSharpes).length === 0) {
          logger.debug(
            { backtestId, regimeGroups: Object.keys(byRegime) },
            "B10 MRP: no regime groups with >= 3 trades — MRP not computed",
          );
          return;
        }

        const mrpSharpeValue = Math.min(...Object.values(regimeSharpes));

        // Update the backtest row with MRP results (best-effort, non-blocking)
        await db
          .update(backtests)
          .set({
            mrpSharpe: String(mrpSharpeValue),
            mrpRegimeBreakdown: regimeSharpes as unknown as Record<string, unknown>,
          })
          .where(eq(backtests.id, backtestId));

        logger.info(
          { backtestId, strategyId, mrpSharpe: mrpSharpeValue.toFixed(3), regimeSharpes },
          "B10 MRP: computed and persisted",
        );

        if (mrpSharpeValue < 0.5) {
          logger.warn(
            { backtestId, strategyId, mrpSharpe: mrpSharpeValue.toFixed(3) },
            "B10 MRP: mrp_sharpe < 0.5 — strategy has regime-conditional fragility (soft advisory, not a gate yet)",
          );
        }
      } catch (mrpErr) {
        logger.warn(
          { backtestId, strategyId, err: mrpErr },
          "B10 MRP: computation failed (non-blocking — backtest is still completed)",
        );
      }
    })();

    // ─── Optional SQA parameter optimization (fire-and-forget) ───
    // Fires for ALL qualifying backtests (non-REJECTED with walk-forward results),
    // not just those explicitly requesting the SQA optimizer.
    if (result.tier && result.tier !== "REJECTED" && wfResults && config.strategy?.indicators?.length) {
      // Register the SQA promise in the session-local registry so the critic
      // can await it with a bounded timeout instead of fire-and-forget polling.
      // The IIFE itself is still fire-and-forget (non-blocking to the backtest
      // response), but critic-optimizer-service can now observe its completion.
      const sqaTask = (async () => {
        // Hoist cost telemetry vars OUTSIDE try block so catch handler can reference
        // them even if early failures (paramRanges build, sqaOptimizationRuns insert)
        // throw before they would have been initialized inside the try (TDZ guard).
        let sqaCostStart = Date.now();
        let sqaCostRowId: string | null = null;
        try {
          // Build param ranges from strategy indicator parameters
          const paramRanges: Array<{ name: string; min_val: number; max_val: number; n_bits: number }> = [];
          for (const ind of config.strategy.indicators) {
            if (ind.period) {
              paramRanges.push({
                name: `${ind.type}_period`,
                min_val: Math.max(1, Math.round(ind.period * 0.5)),
                max_val: Math.round(ind.period * 2.0),
                n_bits: 4,
              });
            }
          }
          if (config.strategy.stop_loss?.multiplier) {
            paramRanges.push({
              name: "stop_loss_multiplier",
              min_val: config.strategy.stop_loss.multiplier * 0.5,
              max_val: config.strategy.stop_loss.multiplier * 2.0,
              n_bits: 4,
            });
          }

          if (paramRanges.length === 0) return;

          const sqaConfig = {
            param_ranges: paramRanges,
            num_reads: 100,
            num_sweeps: 1000,
            objective: "maximize_sharpe",
          };

          // Insert running row before Python call so status is visible during execution
          const [sqaRow] = await db.insert(sqaOptimizationRuns).values({
            backtestId,
            strategyId,
            status: "running",
            paramRanges: paramRanges as any,
            bestParams: {},
            bestEnergy: "0",
            robustPlateau: {},
            allSolutions: [],
            numReads: sqaConfig.num_reads,
            numSweeps: sqaConfig.num_sweeps,
            executionTimeMs: 0,
            governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
          }).returning();

          // ── Cost telemetry (Tier 1.4) ─────────────────────────────────────────
          sqaCostStart = Date.now();
          ({ id: sqaCostRowId } = await recordCost({
            moduleName: "sqa",
            backtestId,
            strategyId,
          }));

          const sqaResult = await runPythonModule<SqaOptimizationResult>({
            module: "src.engine.quantum_annealing_optimizer",
            config: sqaConfig,
            componentName: "sqa-optimizer",
            correlationId,
          });

          // Store SQA results on the backtest record.
          // Fresh DB read before merge — avoids clobbering concurrent writes to
          // walkForwardResults that may have occurred since backtest completion.
          const [freshBacktest] = await db
            .select({ walkForwardResults: backtests.walkForwardResults })
            .from(backtests)
            .where(eq(backtests.id, backtestId));
          const freshWfr = (freshBacktest?.walkForwardResults ?? {}) as Record<string, unknown>;

          await db.update(backtests).set({
            walkForwardResults: {
              ...freshWfr,
              sqa_optimization: {
                best_params: sqaResult.best_params,
                best_energy: sqaResult.best_energy,
                robust_plateau: sqaResult.robust_plateau,
                method: "sqa",
                governance: { experimental: true, authoritative: false, decision_role: "challenger_only" },
              },
            },
          }).where(eq(backtests.id, backtestId));

          // Update first-class sqa_optimization_runs row with results
          await db.update(sqaOptimizationRuns).set({
            status: "completed",
            bestParams: sqaResult.best_params ?? {},
            bestEnergy: String(sqaResult.best_energy ?? 0),
            robustPlateau: sqaResult.robust_plateau ?? {},
            allSolutions: sqaResult.all_solutions ?? [],
            executionTimeMs: sqaResult.execution_time_ms ?? 0,
          }).where(eq(sqaOptimizationRuns.id, sqaRow.id));

          logger.info({ backtestId, bestParams: sqaResult.best_params }, "SQA optimization completed");
          // ── Cost telemetry success (Tier 1.4) ────────────────────────────────
          await completeCost(sqaCostRowId, {
            wallClockMs: Date.now() - sqaCostStart,
            status: "completed",
          });
          sqaRegistry.markSettled(backtestId, "completed");
        } catch (sqaErr) {
          const sqaErrMsg = sqaErr instanceof Error ? sqaErr.message : String(sqaErr);
          logger.error({ backtestId, err: sqaErr }, "SQA optimization failed (non-blocking)");
          // ── Cost telemetry failure (Tier 1.4) ────────────────────────────────
          // sqaCostRowId may be null if failure occurred before recordCost ran.
          // completeCost handles STALE_PENDING_SENTINEL_ID via no-op; null skipped here.
          if (sqaCostRowId) {
            await completeCost(sqaCostRowId, {
              wallClockMs: Date.now() - sqaCostStart,
              status: "failed",
              errorMessage: sqaErrMsg,
            });
          }
          sqaRegistry.markSettled(backtestId, "failed");
          // Mark any running SQA rows for this backtest as failed
          await db.update(sqaOptimizationRuns).set({ status: "failed" })
            .where(and(eq(sqaOptimizationRuns.backtestId, backtestId), eq(sqaOptimizationRuns.status, "running")));
          await captureToDLQ({
            operationType: "sqa_optimization:failure",
            entityType: "backtest",
            entityId: backtestId,
            errorMessage: sqaErrMsg,
            metadata: { backtestId, strategyId, correlationId: correlationId ?? null },
          }).catch(() => {});
        }
      })();
      // Register promise AFTER spawn so critic can await it with bounded timeout.
      sqaRegistry.register(backtestId, sqaTask);
    }

    // ─── Auto Monte Carlo for non-tier-qualifying backtests (fire-and-forget) ───
    // MC data is needed to evaluate ANY strategy. For tier-qualifying backtests
    // (TIER_1/2/3), MC is run synchronously inside the auto-promote gate below
    // so survival-rate is part of the promotion decision and atomicity is preserved.
    // For REJECTED / no-tier results, fire-and-forget MC for analytics only.
    //
    // FIX 1 — critic replay MC: when suppressAutoPromote=true (set during critic
    // replay), the blocking MC gate is intentionally skipped (replay shouldn't
    // gate the critic flow), but the fire-and-forget MC must STILL fire so the
    // lifecycle gate at TESTING→PAPER has MC data later. Without this, the child
    // strategy gets no MC record and the lifecycle gate silently blocks promotion
    // forever (it reads monteCarloRuns.probabilityOfRuin and finds nothing).
    // The condition !isTierQualifying already evaluates to true when suppressAutoPromote
    // is true (because the !config.suppressAutoPromote conjunct is false), so this
    // branch fires for critic replays — but we make the intent explicit and add an
    // audit row so the replay→MC linkage is queryable. We also write the audit row
    // synchronously BEFORE the fire-and-forget so the linkage survives even if MC
    // crashes or the process restarts.
    const isTierQualifying =
      !config.suppressAutoPromote &&
      result.tier &&
      ["TIER_1", "TIER_2", "TIER_3"].includes(result.tier);

    const isCriticReplay = config.suppressAutoPromote === true;

    if (result.daily_pnls?.length > 0 && (!isTierQualifying || isCriticReplay)) {
      // Critic-replay MC: write an explicit audit row marking this as a
      // critic-replay-triggered MC so the replay→MC link is queryable later.
      if (isCriticReplay) {
        try {
          await db.insert(auditLog).values({
            action: "strategy.critic-replay-mc-triggered",
            entityType: "strategy",
            entityId: strategyId,
            input: { backtestId, tier: result.tier ?? null },
            result: {
              note: "fire-and-forget MC triggered for critic-replay child so TESTING→PAPER lifecycle gate has MC data",
            },
            status: "success",
            decisionAuthority: "gate",
            correlationId: correlationId ?? null,
          });
        } catch (auditErr) {
          logger.warn({ backtestId, strategyId, err: auditErr }, "critic-replay-mc-triggered audit insert failed (non-blocking)");
        }
      }

      // P1-5: Pre-insert pending MC row BEFORE the fire-and-forget Python call.
      // Without this row, a Node crash between `runMonteCarlo()`'s entry and
      // its internal `.insert(monteCarloRuns)` leaves no pending record. The
      // stale-pending sweeper (scheduler.ts:1072 — 90 min cutoff for
      // monte_carlo_runs) cannot mark a run as failed if no row exists.
      // Result: the TESTING→PAPER lifecycle gate either waits forever
      // (looking for an MC row that never gets written) or, on critic-replay,
      // misses the survivor's MC evidence entirely.
      //
      // We pre-insert with a generated UUID and pass it as `externalId`.
      // monte-carlo-service.ts uses .onConflictDoNothing() and re-fetches the
      // row when externalId is provided, so the eventual `runMonteCarlo` call
      // is idempotent: it either uses our pre-inserted row, or (on retry from
      // a crash that did insert before failing) reuses the one already there.
      // The success/failure update at the end of `runMonteCarlo` then
      // transitions the row to "completed"/"failed".
      (async () => {
        const { randomUUID } = await import("crypto");
        const preInsertedMcId = randomUUID();
        try {
          await db.insert(monteCarloRuns).values({
            id: preInsertedMcId,
            backtestId,
            status: "running",
            numSimulations: 50_000,
            gpuAccelerated: true,
          });
        } catch (preInsertErr) {
          logger.warn(
            { backtestId, err: preInsertErr, isCriticReplay },
            "Auto MC: pre-insert pending row failed (proceeding — runMonteCarlo will create its own row)",
          );
          // Fall through with a fresh ID so runMonteCarlo can still self-insert.
        }

        runMonteCarlo(
          backtestId,
          {
            numSimulations: 50_000,
            method: "both",
            firms: ["topstep_50k", "mffu_50k"],
          },
          preInsertedMcId,
        )
          .then((mcResult) => {
            logger.info({ backtestId, mcId: mcResult.id, status: mcResult.status, isCriticReplay }, "Auto MC completed");
          })
          .catch((mcErr) => {
            logger.error({ backtestId, err: mcErr, isCriticReplay }, "Auto MC failed (non-blocking)");
          });
      })();
    } else if (isCriticReplay && (!result.daily_pnls || result.daily_pnls.length === 0)) {
      // Defensive: critic-replay with no daily_pnls — MC cannot run, but the
      // lifecycle gate at TESTING→PAPER will still look for an MC row. Record
      // the skip explicitly so the gate's lookup-failure is replayable.
      try {
        await db.insert(auditLog).values({
          action: "strategy.critic-replay-mc-skipped",
          entityType: "strategy",
          entityId: strategyId,
          input: { backtestId, tier: result.tier ?? null },
          result: {
            reason: "no daily_pnls — MC cannot be run on a replay backtest with empty daily_pnls",
          },
          status: "failure",
          decisionAuthority: "gate",
          correlationId: correlationId ?? null,
        });
      } catch (auditErr) {
        logger.warn({ backtestId, strategyId, err: auditErr }, "critic-replay-mc-skipped audit insert failed (non-blocking)");
      }
    }

    // ─── Auto QUBO timing optimization (fire-and-forget) ───
    if (result.daily_pnls?.length > 0 && result.tier && result.tier !== "REJECTED") {
      (async () => {
        // Insert running row before Python call
        const [quboRow] = await db.insert(quboTimingRuns).values({
          backtestId,
          strategyId,
          status: "running",
          sessionType: "rth",
          windowSize: 30,
          schedule: [],
          expectedReturn: "0",
          costSavings: "0",
          backtestImprovement: "0",
          governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
        }).returning();

        try {
          const quboConfig = {
            historical_returns: result.daily_pnls,
            session_type: "rth",
            window_size: 30,
            num_reads: 100,
          };

          const quboResult = await runPythonModule<QuboTimingResult>({
            module: "src.engine.qubo_trade_timing",
            config: quboConfig,
            componentName: "qubo-timing",
            correlationId,
          });

          await db.update(quboTimingRuns).set({
            status: "completed",
            schedule: quboResult.schedule ?? [],
            expectedReturn: String(quboResult.expected_return ?? 0),
            costSavings: String(quboResult.cost_savings ?? 0),
            backtestImprovement: String(quboResult.backtest_improvement ?? 0),
          }).where(eq(quboTimingRuns.id, quboRow.id));

          logger.info({ backtestId }, "Auto QUBO timing completed");
        } catch (quboErr) {
          const quboErrMsg = quboErr instanceof Error ? quboErr.message : String(quboErr);
          logger.error({ backtestId, err: quboErr }, "Auto QUBO timing failed (non-blocking)");
          await db.update(quboTimingRuns).set({ status: "failed" }).where(eq(quboTimingRuns.id, quboRow.id));
          await captureToDLQ({
            operationType: "qubo_timing:failure",
            entityType: "backtest",
            entityId: backtestId,
            errorMessage: quboErrMsg,
            metadata: { backtestId, strategyId, quboRowId: quboRow.id, correlationId: correlationId ?? null },
          }).catch(() => {});
        }
      })();
    }

    // ─── Auto tensor signal evaluation (fire-and-forget) ───
    if (result.daily_pnls?.length > 0 && result.tier && result.tier !== "REJECTED") {
      (async () => {
        // Insert running row before Python call
        const [tensorRow] = await db.insert(tensorPredictions).values({
          backtestId,
          strategyId,
          status: "running",
          modelVersion: "pending",
          probability: "0",
          confidence: "0",
          signal: "neutral",
          featureSnapshot: {},
          regimeAtPrediction: null,
          fragilityScore: "0",
          regimeBreakdown: {},
          governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
        }).returning();

        // ── Cost telemetry (Tier 1.4) — hoisted so catch block can completeCost ─
        const tensorCostStart = Date.now();
        const { id: tensorCostRowId } = await recordCost({
          moduleName: "rl_agent",   // tensor_signal uses the rl_agent module slot
          backtestId,
          strategyId,
        });

        try {
          // Build regime labels from daily P&Ls (simple volatility-based bucketing)
          const pnls = result.daily_pnls as number[];
          const regimeLabels: number[] = [];
          const windowSize = 20;
          for (let i = 0; i < pnls.length; i++) {
            const start = Math.max(0, i - windowSize);
            const window = pnls.slice(start, i + 1);
            const mean = window.reduce((a, b) => a + b, 0) / window.length;
            const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
            // Simple regime: 0=low-vol, 1=mid-vol, 2=high-vol
            regimeLabels.push(variance < 50000 ? 0 : variance < 200000 ? 1 : 2);
          }

          const tensorConfig = {
            daily_pnls: pnls,
            trades: result.trades?.slice(0, 200) ?? [],
            strategy_config: config.strategy ?? {},
            regime_labels: regimeLabels,
            compute_fragility: true,
          };

          const tensorResult = await runPythonModule<TensorSignalResult>({
            module: "src.engine.tensor_signal_model",
            config: { ...tensorConfig, mode: "predict" },
            componentName: "tensor-predict",
            correlationId,
          });

          // probability===null means model not trained — mark skipped, not completed,
          // so the critic evidence query omits this row rather than reading a fake 0.5.
          const tensorProbability = tensorResult.probability;
          if (tensorProbability === null || tensorProbability === undefined) {
            await db.update(tensorPredictions).set({
              status: "skipped_no_model",
              modelVersion: "no_model",
              signal: "no_model",
            }).where(eq(tensorPredictions.id, tensorRow.id));
            // Cost telemetry: skipped counts as completed (Python ran, model just not trained)
            await completeCost(tensorCostRowId, {
              wallClockMs: Date.now() - tensorCostStart,
              status: "completed",
            });
            logger.info({ backtestId }, "Auto tensor evaluation skipped — model not trained");
          } else {
            await db.update(tensorPredictions).set({
              status: "completed",
              modelVersion: tensorResult.model_hash ?? "unknown",
              probability: String(tensorProbability),
              confidence: String(tensorResult.confidence ?? 0),
              signal: tensorResult.signal ?? "neutral",
              featureSnapshot: tensorResult.features ?? {},
              regimeAtPrediction: tensorResult.regime ?? null,
              fragilityScore: String(tensorResult.fragility_score ?? 0),
              regimeBreakdown: tensorResult.regime_breakdown ?? {},
            }).where(eq(tensorPredictions.id, tensorRow.id));
            // ── Cost telemetry success (Tier 1.4) ────────────────────────────
            await completeCost(tensorCostRowId, {
              wallClockMs: Date.now() - tensorCostStart,
              status: "completed",
            });
            logger.info({ backtestId }, "Auto tensor evaluation completed");
          }
        } catch (tensorErr) {
          const tensorErrMsg = tensorErr instanceof Error ? tensorErr.message : String(tensorErr);
          logger.error({ backtestId, err: tensorErr }, "Auto tensor evaluation failed (non-blocking)");
          await db.update(tensorPredictions).set({ status: "failed" }).where(eq(tensorPredictions.id, tensorRow.id));
          // ── Cost telemetry failure (Tier 1.4) ──────────────────────────────
          await completeCost(tensorCostRowId, {
            wallClockMs: Date.now() - tensorCostStart,
            status: "failed",
            errorMessage: tensorErrMsg,
          });
          await captureToDLQ({
            operationType: "tensor_prediction:failure",
            entityType: "backtest",
            entityId: backtestId,
            errorMessage: tensorErrMsg,
            metadata: { backtestId, strategyId, tensorRowId: tensorRow.id, correlationId: correlationId ?? null },
          }).catch(() => {});
        }
      })();
    }

    // ─── Auto RL training (fire-and-forget) — LEGACY PATH ───────────────────
    // Requires 50+ daily P&L samples for a meaningful training episode set.
    // Writes to `rl_training_runs` (consumed by critic-optimizer-service.ts).
    // Kill switch: RL training is an AUTONOMOUS loop → requires AUTOPILOT (mode>=2).
    // Off-RTH guard: mirrors the C.2 path to prevent dual GPU subprocesses during RTH.
    // NOTE: `rl_training_runs` IS consumed by the critic — see critic-optimizer-service.ts
    // line ~1393. This legacy path is retained (not retired) but gated identically to C.2.
    if (result.tier && result.tier !== "REJECTED" && result.daily_pnls?.length >= 50) {
      void (async () => {
        // ── Kill-switch gate (AUTOPILOT required — autonomous loop) ──────────
        const rlLegacyMode = await readLearningLoopMode();
        if (!rlLegacyMode.autonomousOn) {
          logger.info(
            { strategyId, backtestId, mode: rlLegacyMode.mode },
            "backtest-service: RL legacy training skipped — kill switch not AUTOPILOT",
          );
          await db.insert(auditLog).values({
            action: "quantum_rl.training_loop_halted_skip",
            entityType: "strategy",
            entityId: String(strategyId),
            status: "success",
            correlationId: correlationId ?? null,
            result: {
              reason: "kill_switch_not_autopilot",
              mode: rlLegacyMode.mode,
              path: "legacy_rl_training_runs",
              backtest_id: backtestId,
            },
          }).catch((auditErr) =>
            logger.warn({ err: String(auditErr), strategyId }, "backtest-service: RL legacy halt audit failed"),
          );
          return;
        }
        // ── Off-RTH guard (no GPU subprocess during live-market hours) ───────
        const { isOffRthTrainingWindow } = await import("../lib/quantum-rl-training-runner.js");
        if (!isOffRthTrainingWindow()) {
          logger.info(
            { strategyId, backtestId },
            "backtest-service: RL legacy training skipped — within RTH window",
          );
          return;
        }
        // Insert running row before Python call
        const [rlRow] = await db.insert(rlTrainingRuns).values({
          strategyId,
          status: "running",
          method: "pennylane_vqc",
          totalReturn: "0",
          sharpeRatio: "0",
          governanceLabels: { experimental: true, authoritative: false, decision_role: "challenger_only" },
        }).returning();

        // ── Cost telemetry (Tier 1.4) — hoisted so catch block can completeCost ─
        const rlCostStart = Date.now();
        const { id: rlCostRowId } = await recordCost({
          moduleName: "rl_agent",
          backtestId,
          strategyId,
        });

        try {
          const rlConfig = {
            strategy_id: strategyId,
            daily_pnls: result.daily_pnls,
            n_episodes: 100,
            max_steps: result.daily_pnls.length,
          };
          const rlResult = await runPythonModule<RlTrainingResult>({
            module: "src.engine.quantum_rl_agent",
            config: rlConfig,
            componentName: "rl-agent",
            correlationId,
          });
          if (rlResult) {
            await db.update(rlTrainingRuns).set({
              status: "completed",
              totalReturn: String(rlResult.total_return ?? 0),
              sharpeRatio: String(rlResult.sharpe_ratio ?? 0),
              winRate: rlResult.win_rate != null ? String(rlResult.win_rate) : null,
              totalTrades: rlResult.total_trades ?? null,
              episodes: rlResult.n_episodes ?? null,
              executionTimeMs: rlResult.execution_time_ms ?? null,
              policyWeights: rlResult.policy_weights ?? null,
              comparisonResult: rlResult.comparison_result ?? null,
            }).where(eq(rlTrainingRuns.id, rlRow.id));
            // ── Cost telemetry success (Tier 1.4) ──────────────────────────────
            await completeCost(rlCostRowId, {
              wallClockMs: Date.now() - rlCostStart,
              status: "completed",
            });
            logger.info({ backtestId, strategyId }, "Auto RL training completed");
          }
        } catch (err) {
          const rlErrMsg = err instanceof Error ? err.message : String(err);
          logger.error({ err, strategyId }, "Auto RL training failed");
          await db.update(rlTrainingRuns).set({ status: "failed" }).where(eq(rlTrainingRuns.id, rlRow.id));
          // ── Cost telemetry failure (Tier 1.4) ──────────────────────────────
          await completeCost(rlCostRowId, {
            wallClockMs: Date.now() - rlCostStart,
            status: "failed",
            errorMessage: rlErrMsg,
          });
          await captureToDLQ({
            operationType: "rl_training:failure",
            entityType: "strategy",
            entityId: strategyId,
            errorMessage: rlErrMsg,
            metadata: { backtestId, strategyId, rlRowId: rlRow.id, correlationId: correlationId ?? null },
          }).catch(() => {});
        }
      })();
    }

    // ─── W29 Pass C.2: Regime-conditioned RL training auto-fire ─────────────────
    // Fires when strategy has entry_quality.train_rl_policy=true.
    // Uses quantum-rl-training-runner.ts (mirrors quantum-replay-runner.ts pattern).
    // ET-hour guard: only off-RTH windows {6,7,8,16,17} — enforced inside runner.
    // Circuit breaker: 5 consecutive failures → 1h cooldown.
    // Kill switch: RL training is an AUTONOMOUS loop → requires AUTOPILOT (mode>=2).
    // governance: challenger_only, training_mode=true, never blocks lifecycle.
    {
      const entryQuality = (config as unknown as Record<string, unknown>)["entry_quality"] as Record<string, unknown> | undefined;
      const trainRlPolicy = entryQuality?.train_rl_policy === true;
      if (!config.suppressAutoPromote && trainRlPolicy && result.tier && result.tier !== "REJECTED") {
        void (async () => {
          // ── Kill-switch gate (AUTOPILOT required — autonomous loop) ──────────
          const rlC2Mode = await readLearningLoopMode();
          if (!rlC2Mode.autonomousOn) {
            logger.info(
              { strategyId, backtestId, mode: rlC2Mode.mode },
              "backtest-service: RL C.2 training skipped — kill switch not AUTOPILOT",
            );
            await db.insert(auditLog).values({
              action: "quantum_rl.training_loop_halted_skip",
              entityType: "strategy",
              entityId: String(strategyId),
              status: "success",
              correlationId: correlationId ?? null,
              result: {
                reason: "kill_switch_not_autopilot",
                mode: rlC2Mode.mode,
                path: "c2_quantum_rl_runs",
                backtest_id: backtestId,
              },
            }).catch((auditErr) =>
              logger.warn({ err: String(auditErr), strategyId }, "backtest-service: RL C.2 halt audit failed"),
            );
            return;
          }
          try {
            const { runRlTrainingForStrategy, deriveRlTrainingSeed, _getRlConsecutiveFailuresForTests } = await import("../lib/quantum-rl-training-runner.js");
            const rlSeed = deriveRlTrainingSeed(strategyId);
            const rlTrainingResult = await runRlTrainingForStrategy(strategyId, 200, correlationId);
            await db.insert(auditLog).values({
              action: "quantum_rl.training_auto_fire_enqueued",
              entityType: "strategy",
              entityId: String(strategyId),
              status: "success",
              correlationId: correlationId ?? null,
              result: {
                trigger: "post_backtest_auto_fire",
                backtest_id: backtestId,
                strategy_id: strategyId,
                seed: rlSeed,
                regimes_trained: rlTrainingResult.regimesTrained,
                duration_ms: rlTrainingResult.durationMs,
                training_status: rlTrainingResult.status,
              },
            });
            // Wave 29 Pass D.1: emit SSE quantum_rl:training_completed so
            // dashboard subscribers receive real-time training visibility.
            if (rlTrainingResult.status === "completed") {
              broadcastSSE("quantum_rl:training_completed", {
                strategy_id: strategyId,
                regimes_trained: rlTrainingResult.regimesTrained,
                duration_ms: rlTrainingResult.durationMs,
                correlation_id: correlationId ?? null,
              });
              // Wave 29 prod hardening: increment Prom counter #5 — regimesTrained is a count, not an array
              try {
                const nRegimes = rlTrainingResult.regimesTrained ?? 0;
                if (nRegimes > 0) {
                  rlTrainingEpochsTotal.labels({ regime: "combined" }).inc(
                    parseInt(process.env.QUANTUM_RL_TRAINING_EPOCHS ?? "200", 10) || 200
                  );
                }
              } catch (_promErr) { /* non-blocking */ }
            }
          } catch (rlTrainErr) {
            logger.error({ err: rlTrainErr, strategyId, correlationId }, "RL training auto-fire failed (non-blocking)");
            try {
              const { _getRlConsecutiveFailuresForTests } = await import("../lib/quantum-rl-training-runner.js");
              const failures = _getRlConsecutiveFailuresForTests();
              const threshold = Math.max(1, parseInt(process.env.QUANTUM_RL_TRAINING_FAILURE_THRESHOLD ?? "5", 10) || 5);
              if (failures >= threshold) {
                await db.insert(auditLog).values({
                  action: "quantum_rl.training_circuit_breaker_opened",
                  entityType: "strategy",
                  entityId: String(strategyId),
                  status: "failure",
                  correlationId: correlationId ?? null,
                  result: { consecutive_failures: failures, threshold, strategy_id: strategyId, error: String(rlTrainErr) },
                });
                return;
              }
            } catch { /* circuit-breaker-check failure — fall through */ }
            await db.insert(auditLog).values({
              action: "quantum_rl.training_auto_fire_failed",
              entityType: "strategy",
              entityId: String(strategyId),
              status: "failure",
              correlationId: correlationId ?? null,
              result: { error: String(rlTrainErr), strategy_id: strategyId, backtest_id: backtestId },
            });
          }
        })();
      }
    }

    // ─── Auto Quantum Monte Carlo (fire-and-forget) ───
    // Quantum-enhanced breach probability estimation for qualifying backtests.
    // Same guard pattern as QUBO/Tensor/RL: non-REJECTED tier with daily P&Ls.
    // CB key: "python-quantum-mc" — shared with any future direct QMC call sites.
    // runQuantumMC already inserts a "running" quantumMcRuns row before calling Python
    // (confirmed: quantum-mc-service.ts:125-136), so no pre-insert is needed here.
    if (result.tier && result.tier !== "REJECTED" && result.daily_pnls?.length > 0) {
      (async () => {
        try {
          const firmKey = config.firm_key ?? "topstep_50k";
          const qmcResult = await CircuitBreakerRegistry.get("python-quantum-mc", { failureThreshold: 3, cooldownMs: 30_000 }).call(
            () => runQuantumMC(backtestId, "breach", firmKey),
          );
          logger.info({ backtestId, qmcId: qmcResult.id, status: qmcResult.status }, "Auto quantum MC completed");
        } catch (qmcErr) {
          // Circuit open or Python failure — log and swallow (non-blocking)
          logger.error({ backtestId, err: qmcErr }, "Auto quantum MC failed (non-blocking)");
        }
      })();
    }

    // ─── Auto Quantum Replay Grading (fire-and-forget) — Wave 27 Pass 1.5 ───
    // Invokes Python quantum replay after EVERY qualifying backtest so operators
    // never need to manually trigger it. Challenger-only governance: rows carry
    // governance_labels.replay_mode=true and are advisory-only (never block promotion).
    //
    // Guard: suppressAutoPromote skips replay backtests to avoid recursive loops.
    // same tier guard as QMC: non-REJECTED with daily P&Ls required.
    // Opt-OUT default: QUANTUM_REPLAY_AUTO_FIRE_ENABLED unset or "true" → fires.
    // In-process circuit breaker (QUANTUM_REPLAY_FAILURE_THRESHOLD, default 5)
    // prevents thundering-herd on repeated Python/DB failures.
    if (
      !config.suppressAutoPromote &&
      result.tier &&
      result.tier !== "REJECTED" &&
      result.daily_pnls?.length > 0
    ) {
      void (async () => {
        try {
          const { isQuantumReplayEnabled, runQuantumReplayForBacktest } = await import("../lib/quantum-replay-runner.js");
          if (!isQuantumReplayEnabled()) return;
          const replayResult = await runQuantumReplayForBacktest(backtestId, correlationId);
          // M9: parentCorrelationId links the replay row back to its originating
          // backtest. The replay's own UUID (correlationId in the replay's scope)
          // is the audit's primary correlationId; parentCorrelationId is the
          // cross-system trace key that ties replay activity to its source backtest.
          //
          // Query to find all activity downstream of a given backtest:
          //   WHERE correlation_id = $backtestId
          //      OR result->>'parentCorrelationId' = $backtestId
          await db.insert(auditLog).values({
            action: "quantum_replay.auto_fire_enqueued",
            entityType: "backtest",
            entityId: backtestId,
            status: "success",
            correlationId: correlationId ?? null,
            result: {
              trigger: "post_backtest_auto_fire",
              backtest_id: backtestId,
              rows_written: replayResult.rowsWritten,
              duration_ms: replayResult.durationMs,
              replay_status: replayResult.status,
              // Cross-system trace key: the backtest's own correlationId is the
              // parentCorrelationId for every downstream replay operation. Allows
              // a single query to reconstruct the full causal chain:
              //   WHERE correlation_id=$backtestId OR result->>'parentCorrelationId'=$backtestId
              parentCorrelationId: correlationId ?? null,
            },
          });
        } catch (replayErr) {
          logger.error({ err: replayErr, backtestId, correlationId }, "quantum replay auto-fire failed (non-blocking)");
          try {
            // Check if circuit just opened (failure was the threshold-breaker)
            const { _getConsecutiveFailuresForTests } = await import("../lib/quantum-replay-runner.js");
            const failures = _getConsecutiveFailuresForTests();
            const threshold = Math.max(1, parseInt(process.env.QUANTUM_REPLAY_FAILURE_THRESHOLD ?? "5", 10) || 5);
            if (failures >= threshold) {
              logger.error(
                { backtestId, correlationId, consecutiveFailures: failures, threshold },
                "quantum-replay-runner: circuit breaker threshold reached — logging circuit_breaker_opened audit row",
              );
              await db.insert(auditLog).values({
                action: "quantum_replay.circuit_breaker_opened",
                entityType: "backtest",
                entityId: backtestId,
                status: "failure",
                correlationId: correlationId ?? null,
                result: {
                  consecutive_failures: failures,
                  threshold,
                  backtest_id: backtestId,
                  error: String(replayErr),
                },
              });
              return;
            }
          } catch { /* circuit-breaker-check failure — fall through to generic audit */ }
          await db.insert(auditLog).values({
            action: "quantum_replay.auto_fire_failed",
            entityType: "backtest",
            entityId: backtestId,
            status: "failure",
            correlationId: correlationId ?? null,
            result: {
              error: String(replayErr),
              backtest_id: backtestId,
            },
          }).catch((auditErr) => {
            logger.error({ err: auditErr, backtestId }, "quantum-replay-runner: audit write failed (swallowed)");
          });
        }
      })();
    }

    // ─── Auto Critic Optimization (fire-and-forget) ───
    // Guard: critic needs walk-forward data for param stability analysis.
    // Trigger for any qualifying backtest that has walk-forward results,
    // regardless of optimizer type (covers n8n walk-forward runs too).
    // P2-3: suppress critic auto-trigger for replay backtests (suppressAutoPromote=true).
    // Replays are already inside a critic cycle — firing critic again would create an
    // uncontrolled recursive loop.
    if (!config.suppressAutoPromote && result.tier && result.tier !== "REJECTED" && wfResults) {
      import("./critic-optimizer-service.js")
        .then(({ triggerCriticOptimizer }) =>
          triggerCriticOptimizer(backtestId, strategyId, config as unknown as Record<string, unknown>),
        )
        .then((criticResult) => {
          logger.info({ backtestId, runId: criticResult.runId, status: criticResult.status }, "Auto critic optimizer triggered");
        })
        .catch((criticErr) => {
          logger.error({ backtestId, err: criticErr }, "Auto critic optimizer failed (non-blocking)");
        });
    }

    // ─── Auto-promote to paper trading if strategy passes gates ───
    // suppressAutoPromote: skip promotion for critic replay backtests — the critic
    // loop decides promotion authority, not individual replay runs.
    if (!config.suppressAutoPromote && result.tier && ["TIER_1", "TIER_2", "TIER_3"].includes(result.tier)) {
      try {
        // Check graveyard similarity before promoting
        try {
          const { GraveyardGate } = await import("./graveyard-gate.js");
          const gate = new GraveyardGate();
          const graveyardCheck = await gate.check(config.strategy.name || "");
          if (graveyardCheck.blocked) {
            logger.warn({ strategyId, similarity: graveyardCheck.similarity }, "Strategy blocked by graveyard similarity");
            return { id: backtestId, status: "completed", ...result };
          }
        } catch (err) {
          logger.warn({ err }, "Graveyard check failed, proceeding anyway");
        }

        // ─── FIX 2 — CANDIDATE→SHADOW fast-track: entry-quality gates before SHADOW entry.
        // F-3 fix (2026-06-23): fast-track now routes CANDIDATE→SHADOW (not CANDIDATE→PAPER).
        // No strategy may reach PAPER (real TradersPost creds, paper capital) without SHADOW
        // skew measurement. SHADOW→PAPER is gated by the A.3 divergence check in
        // checkAutoPromotions (≥20 signals, <5% divergence). TESTING is still skippable —
        // SHADOW is the mandatory skew measurement layer for training-serving parity.
        //
        // The 4 entry-quality gates still run here BEFORE entering SHADOW — they are
        // appropriate entry-quality gates regardless of the destination state.
        // Gate order (fail fast on cheap checks, expensive MC last):
        //   2a. raw_survival_score >= 60 (cheap; reads gateResult JSONB on `result`)
        //   2b. compliance ruleset drift gate (cheap; per-firm DB read)
        //   2c. Pine exportability ok (medium; pine-export-service)
        //   --- existing MC survival gate (expensive; Python subprocess) ---

        // ── 2a. Survival score gate (raw_survival_score >= 60) ───────────
        // gate_result.components.raw_survival_score is the unscaled 0-100 score
        // from survival_scorer.py. Score < 60 means the strategy is likely to
        // hit daily loss limits or DD limits in live trading.
        try {
          const gateResultRaw = (result as unknown as Record<string, unknown>).gate_result;
          if (gateResultRaw && typeof gateResultRaw === "object") {
            const components = (gateResultRaw as Record<string, unknown>).components as
              | Record<string, number>
              | undefined;
            const rawSurvivalScore =
              components?.raw_survival_score ?? components?.survival_score ?? null;
            if (rawSurvivalScore !== null && rawSurvivalScore < 60) {
              logger.warn(
                { strategyId, backtestId, rawSurvivalScore },
                "CANDIDATE→SHADOW fast-track blocked: survival-score-below-threshold",
              );
              await db.insert(auditLog).values({
                action: "strategy.fast-track.survival-score-blocked",
                entityType: "strategy",
                entityId: strategyId,
                input: { backtestId, fromState: "CANDIDATE", toState: "SHADOW" },
                result: {
                  reason: "survival-score-below-threshold",
                  survival_score: rawSurvivalScore,
                  minimum_required: 60,
                },
                status: "failure",
                decisionAuthority: "gate",
                correlationId: correlationId ?? null,
              });
              return { id: backtestId, status: "completed", ...result };
            }
          }
          // No gateResult on the result is permissive — same fallback behavior as lifecycle-service.
        } catch (gateErr) {
          // Gate read failure is informational, not a strategy failure
          logger.warn(
            { strategyId, err: gateErr },
            "CANDIDATE→SHADOW fast-track: survival-score gate read failed (proceeding)",
          );
        }

        // ── 2b. Compliance ruleset drift gate ─────────────────────────────
        // If the latest ruleset row for any qualifying firm has driftDetected=true,
        // the prop compliance result on this backtest is no longer trustworthy.
        try {
          const propComplianceRaw = (result as unknown as Record<string, unknown>).prop_compliance;
          const { passingFirmNamesFromCompliance, findFirmsWithComplianceDrift } = await import("./lifecycle-service.js");
          const passingFirmNames = passingFirmNamesFromCompliance(propComplianceRaw);
          if (passingFirmNames.length > 0) {
            const driftFirms = await findFirmsWithComplianceDrift(passingFirmNames);
            if (driftFirms.length > 0) {
              logger.warn(
                { strategyId, backtestId, driftFirms },
                "CANDIDATE→SHADOW fast-track blocked: compliance ruleset drift detected",
              );
              await db.insert(auditLog).values({
                action: "strategy.fast-track.compliance-drift-blocked",
                entityType: "strategy",
                entityId: strategyId,
                input: { backtestId, fromState: "CANDIDATE", toState: "SHADOW" },
                result: {
                  firms_with_drift: driftFirms,
                  qualifying_firms: passingFirmNames,
                  reason:
                    "compliance ruleset drift_detected — promotion held until human revalidation",
                },
                status: "failure",
                decisionAuthority: "gate",
                correlationId: correlationId ?? null,
              });
              return { id: backtestId, status: "completed", ...result };
            }
          }
        } catch (driftErr) {
          // Drift gate infra failure is informational — do not block promotion on infra errors
          logger.warn(
            { strategyId, err: driftErr },
            "CANDIDATE→SHADOW fast-track: compliance drift gate read failed (proceeding)",
          );
        }

        // ── 2b'. Compliance gate (P0-2 part 2) ─────────────────────────────
        // Mirrors the TESTING→PAPER promotion-time gate in lifecycle-service.
        // The drift gate above only catches firms with driftDetected=true on
        // their latest ruleset. The compliance gate also blocks on stale
        // (>24h) rulesets and "no_ruleset" firms. Same fail-closed posture
        // as paper-execution-service: subprocess failure → block promotion.
        try {
          const propComplianceRaw = (result as unknown as Record<string, unknown>).prop_compliance;
          const { passingFirmNamesFromCompliance, runComplianceGateForFirms } = await import("./lifecycle-service.js");
          const passingFirmNames = passingFirmNamesFromCompliance(propComplianceRaw);
          if (passingFirmNames.length > 0) {
            const { firmsFailing, details } = await runComplianceGateForFirms(passingFirmNames);
            if (firmsFailing.length > 0) {
              logger.warn(
                { strategyId, backtestId, firmsFailing, details },
                "CANDIDATE→SHADOW fast-track blocked: compliance gate (freshness) failed",
              );
              await db.insert(auditLog).values({
                action: "strategy.fast-track.compliance_blocked",
                entityType: "strategy",
                entityId: strategyId,
                input: { backtestId, fromState: "CANDIDATE", toState: "SHADOW" },
                result: {
                  firms_failing: firmsFailing,
                  qualifying_firms: passingFirmNames,
                  details,
                  reason: "compliance_gate.check_freshness failed — fast-track promotion held",
                },
                status: "failure",
                decisionAuthority: "gate",
                correlationId: correlationId ?? null,
              });
              broadcastSSE("strategy:compliance_blocked", {
                strategyId,
                fromState: "CANDIDATE",
                toState: "SHADOW",
                firmsFailing,
                details,
              });
              return { id: backtestId, status: "completed", ...result };
            }
          }
        } catch (complianceGateErr) {
          // Wrapper-level error (not a per-firm fail). Same posture as the
          // drift gate above: log and proceed. The per-firm fail-closed path
          // is inside runComplianceGateForFirms itself; reaching here means
          // something at the dynamic-import or aggregation layer broke.
          logger.warn(
            { strategyId, err: complianceGateErr },
            "CANDIDATE→SHADOW fast-track: compliance gate wrapper threw (proceeding — per-firm fail-closed still applies inside the helper)",
          );
        }

        // ── 2c. Pine exportability pre-check ──────────────────────────────
        // A strategy that cannot be exported to Pine cannot be deployed to TradingView,
        // so promoting it to PAPER would create a stuck DEPLOY_READY downstream.
        try {
          const { checkExportability } = await import("./pine-export-service.js");
          const exportCheck = await checkExportability(strategyId);
          if (!exportCheck.ok) {
            logger.warn(
              {
                strategyId,
                backtestId,
                score: exportCheck.score,
                band: exportCheck.band,
                deductions: exportCheck.deductions,
              },
              "CANDIDATE→SHADOW fast-track blocked: Pine exportability issues",
            );
            await db.insert(auditLog).values({
              action: "strategy.fast-track.exportability-blocked",
              entityType: "strategy",
              entityId: strategyId,
              input: { backtestId, fromState: "CANDIDATE", toState: "SHADOW" },
              result: {
                reasons: (exportCheck as Record<string, unknown>).reasons ?? null,
                score: exportCheck.score,
                band: exportCheck.band,
                deductions: exportCheck.deductions,
              },
              status: "failure",
              decisionAuthority: "gate",
              correlationId: correlationId ?? null,
            });
            broadcastSSE("strategy:exportability_blocked", {
              strategyId,
              fromState: "CANDIDATE",
              toState: "SHADOW",
              score: exportCheck.score,
              band: exportCheck.band,
              reasons: (exportCheck as Record<string, unknown>).reasons ?? null,
            });
            return { id: backtestId, status: "completed", ...result };
          }
        } catch (exportErr) {
          // checkExportability infra failure is informational — do not block on infra errors
          logger.warn(
            { strategyId, err: exportErr },
            "CANDIDATE→SHADOW fast-track: exportability check failed (proceeding)",
          );
        }

        // ─── MC survival gate (BLOCKING) ────────────────────────────
        // MC must pass before auto-promote to PAPER. Latency tradeoff: MC can take
        // 30-90s for 50k simulations, which extends the backtest response time.
        // This is acceptable because the alternative (fire-and-forget MC) creates
        // the dual-promotion bypass that lets strategies into PAPER without ever
        // being evaluated for ruin probability — the very bug this gate fixes.
        // If MC is unavailable (Python subprocess fails), strategy stays CANDIDATE
        // and a "mc-unavailable-promotion-blocked" audit row is written.
        let mcSurvivalRate: number | null = null;
        let mcPassed = false;
        let mcUnavailable = false;
        if (result.daily_pnls?.length > 0) {
          try {
            // Wrap MC call with circuit breaker — "python-mc" is shared with any other
            // direct call site to monte-carlo-service. If the circuit is OPEN (3 failures
            // within the cooldown window), this throws CircuitOpenError immediately and
            // we fall through to the mcUnavailable block below. On success the semantics
            // of runMonteCarlo are completely unchanged.
            const mcResult = await CircuitBreakerRegistry.get("python-mc", { failureThreshold: 3, cooldownMs: 30_000 }).call(
              () => runMonteCarlo(backtestId, {
                numSimulations: 50_000,
                method: "both",
                firms: ["topstep_50k", "mffu_50k"],
              }),
            );
            if (mcResult.status === "completed") {
              // Narrowed: completed branch carries the full MCResult including risk_metrics
              const mcCompleted = mcResult as { id: string; status: "completed"; risk_metrics?: Record<string, unknown> };
              const ruinRaw = mcCompleted.risk_metrics?.probability_of_ruin;
              if (ruinRaw != null) {
                const ruin = Number(ruinRaw);
                mcSurvivalRate = 1 - ruin;
                mcPassed = mcSurvivalRate >= 0.70;
                logger.info(
                  { backtestId, strategyId, mcId: mcCompleted.id, survivalRate: mcSurvivalRate.toFixed(4), passed: mcPassed },
                  "Auto-promote MC gate evaluated",
                );
              } else {
                mcUnavailable = true;
                logger.warn({ backtestId, mcId: mcCompleted.id }, "Auto-promote MC gate: completed but probability_of_ruin missing, blocking promotion");
              }
            } else {
              // MC failed → block promotion
              mcUnavailable = true;
              logger.warn({ backtestId, mcStatus: mcResult.status }, "Auto-promote MC gate: MC did not complete, blocking promotion");
            }
          } catch (mcErr) {
            mcUnavailable = true;
            logger.error({ backtestId, err: mcErr }, "Auto-promote MC gate: MC threw, blocking promotion");
          }
        } else {
          // No daily_pnls → can't run MC → block promotion (strategy can't be evaluated for ruin)
          mcUnavailable = true;
          logger.warn({ backtestId, strategyId }, "Auto-promote MC gate: no daily_pnls, blocking promotion");
        }

        // If MC didn't pass, log a blocked audit row and skip promotion (strategy stays CANDIDATE)
        if (!mcPassed) {
          const blockedAction = mcUnavailable ? "mc-unavailable-promotion-blocked" : "mc-survival-promotion-blocked";
          await db.insert(auditLog).values({
            action: blockedAction,
            entityType: "strategy",
            entityId: strategyId,
            input: { backtestId, tier: result.tier },
            result: {
              survivalRate: mcSurvivalRate,
              threshold: 0.70,
              mcUnavailable,
            },
            status: "failure",
            decisionAuthority: "gate",
            correlationId: correlationId ?? null,
          });
          logger.warn(
            { strategyId, backtestId, tier: result.tier, survivalRate: mcSurvivalRate, mcUnavailable },
            "Auto-promote blocked at MC gate — strategy stays CANDIDATE",
          );
          return { id: backtestId, status: "completed", ...result };
        }

        // Determine paper session config before entering the transaction
        const dailyLossLimit = (() => {
          const firmKey = config.firm_key;
          if (firmKey) {
            const firmName = firmKey.replace(/_\d+k$/i, "");
            const limits = getFirmLimit(firmName);
            if (limits) {
              return limits.dailyLossLimit ?? limits.maxDrawdown;
            }
          }
          return 2000;
        })();

        // paperSessionId is NOT created here (F-3 fix: SHADOW entry, not PAPER).
        // Paper session is created when SHADOW→PAPER divergence gate clears.
        let promotionSucceeded = false;
        let promotionError: string | undefined;

        // All promotion writes are transactional: lifecycle state (SHADOW) + audit log.
        // No paper session is created here (F-3 fix) — session created at SHADOW→PAPER.
        // If any write fails, none persist — strategy stays in CANDIDATE.
        // Lifecycle write goes through LifecycleService.promoteStrategy() so there is
        // ONE path to lifecycle state changes — closes the dual-promotion bypass.
        const { LifecycleService } = await import("./lifecycle-service.js");
        const lifecycle = new LifecycleService();

        await db.transaction(async (tx) => {
          // Auto-name assignment for TIER_1 strategies
          if (result.tier === "TIER_1") {
            // Idempotency: skip if strategy already has a Forge name
            const [existingName] = await tx
              .select()
              .from(strategyNames)
              .where(eq(strategyNames.strategyId, strategyId))
              .limit(1);

            if (existingName) {
              logger.info({ strategyId, forgeName: existingName.fullName }, "Strategy already has Forge name, skipping");
            } else {
              // Atomic claim: UPDATE ... WHERE claimed=false RETURNING * (race-safe)
              const [claimedName] = await tx
                .update(strategyNames)
                .set({
                  claimed: true,
                  claimedAt: new Date(),
                  strategyId,
                  originClass: strategyClass ?? null,
                })
                .where(
                  and(
                    eq(strategyNames.claimed, false),
                    eq(strategyNames.retired, false),
                    eq(strategyNames.id, sql`(SELECT id FROM strategy_names WHERE claimed = false AND retired = false LIMIT 1 FOR UPDATE SKIP LOCKED)`),
                  )
                )
                .returning();

              if (claimedName) {
                await tx.update(strategies).set({
                  name: claimedName.fullName,
                }).where(eq(strategies.id, strategyId));

                logger.info({
                  strategyId,
                  forgeName: claimedName.fullName,
                  codename: claimedName.codename,
                }, "Strategy auto-named on TIER_1 promotion");

                await tx.insert(auditLog).values({
                  action: "strategy.auto-named",
                  entityType: "strategy",
                  entityId: strategyId,
                  input: { codename: claimedName.codename },
                  result: { fullName: claimedName.fullName },
                  status: "success",
                  correlationId: correlationId ?? null,
                });
              } else {
                // Fallback: generate unique name with crypto random suffix
                const { randomUUID } = await import("crypto");
                const fallbackName = `Forge Alpha-${randomUUID().slice(0, 8).toUpperCase()}`;
                await tx.update(strategies).set({
                  name: fallbackName,
                }).where(eq(strategies.id, strategyId));
                logger.warn({ strategyId, fallbackName }, "No codenames available, used fallback name");
              }
            }
          }

          // Update forgeScore separately — promoteStrategy doesn't touch it
          if (result.forge_score != null) {
            await tx.update(strategies).set({
              forgeScore: String(result.forge_score),
            }).where(eq(strategies.id, strategyId));
          }

          // ── Single path lifecycle write: CANDIDATE → SHADOW via LifecycleService ──
          // F-3 fix (2026-06-23): routes to SHADOW (not PAPER). No paper session is
          // created here — paper sessions are created when SHADOW→PAPER fires via the
          // A.3 divergence gate in checkAutoPromotions (≥20 signals, <5% divergence).
          // The lifecycle write atomically sets shadow_mode_enabled=true so the signal
          // interceptor (paper-signal-service) begins capturing signals immediately.
          // Cast tx to typeof db — Drizzle's PgTransaction is structurally compatible
          // with the db handle for query/insert/update/select but lacks `$client`.
          // This matches the pattern used in src/server/lib/db-locks.ts.
          const promoteResult = await lifecycle.promoteStrategy(
            strategyId,
            "CANDIDATE",
            "SHADOW",
            { actor: "system", reason: "tier-qualified-shadow-entry" },
            tx as unknown as typeof db,
          );
          if (!promoteResult.success) {
            promotionError = promoteResult.error;
            // Throwing inside tx triggers rollback — Forge name claim reverts so we
            // don't end up with a claimed name for a non-SHADOW strategy.
            throw new Error(`Lifecycle promotion failed: ${promoteResult.error}`);
          }

          // Auto-promote context audit row — captures backtest+MC+tier metadata so
          // observers can join lifecycle audit row to its triggering backtest. The
          // canonical "strategy.lifecycle" audit row is written by promoteStrategy()
          // above; this is the supplementary context, NOT the lifecycle event itself.
          // NOTE: No paperSessionId here — paper session is created at SHADOW→PAPER.
          await tx.insert(auditLog).values({
            action: "strategy.auto-promote-context",
            entityType: "strategy",
            entityId: strategyId,
            input: { backtestId, tier: result.tier },
            result: {
              toState: "SHADOW",
              mcSurvivalRate,
              forgeScore: result.forge_score,
            },
            status: "success",
            decisionAuthority: "gate",
            correlationId: correlationId ?? null,
          });

          promotionSucceeded = true;
        });

        // If the tx rolled back, surface the error and bail before SSE
        if (!promotionSucceeded) {
          logger.warn(
            { strategyId, backtestId, error: promotionError },
            "Auto-promote transaction rolled back — strategy not promoted to SHADOW",
          );
          return { id: backtestId, status: "completed", ...result };
        }

        // NOTE (F-3): No stream start here. Streams are started when SHADOW→PAPER
        // fires via the A.3 divergence gate in checkAutoPromotions. In SHADOW state
        // the signal interceptor captures signals but does NOT open TradersPost orders.

        // Broadcast SHADOW entry event (outside transaction — SSE is best-effort)
        broadcastSSE("strategy:promoted", {
          strategyId,
          tier: result.tier,
          forgeScore: result.forge_score,
          toState: "SHADOW",
          // paperSessionId not yet set — created at SHADOW→PAPER divergence gate
        });

        logger.info({
          strategyId,
          tier: result.tier,
          toState: "SHADOW",
        }, "Strategy fast-tracked to SHADOW — skew measurement begins (F-3)");
      } catch (promoErr) {
        logger.error(promoErr, "Failed to fast-track strategy to SHADOW");
      }
    }

    backtestSpan.setAttribute("status", "completed");
    backtestSpan.setAttribute("tier", result.tier ?? "unknown");
    backtestSpan.end();
    return { id: backtestId, status: "completed", ...result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(backtests)
      .set({ status: "failed", errorMessage: errorMsg })
      .where(eq(backtests.id, backtestId));

    await db.insert(auditLog).values({
      action: "backtest.run",
      entityType: "backtest",
      entityId: backtestId,
      input: config as unknown as Record<string, unknown>,
      result: { error: errorMsg },
      status: "failure",
      decisionAuthority: "agent",
      errorMessage: errorMsg,
      correlationId: correlationId ?? null,
    });

    backtestSpan.setAttribute("status", "failed");
    backtestSpan.end();
    broadcastSSE("backtest:failed", { backtestId, strategyId, error: errorMsg });
    return { id: backtestId, status: "failed", error: errorMsg };
  }
}
