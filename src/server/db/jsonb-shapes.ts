/**
 * jsonb-shapes.ts — TypeScript shapes for JSONB columns in paper trading tables.
 *
 * These interfaces describe the validated shapes of JSONB config columns.
 * They are NOT enforced by Drizzle at the DB level — they are runtime contracts
 * used by paper-signal-service, paper-execution-service, and related code.
 *
 * All fields optional unless noted. Unknown keys are tolerated (strict subsets only).
 *
 * IMPORTANT: When adding fields here, keep in sync with any Python callers that
 * read session.config from the DB (paper_sessions.config JSONB).
 */

// ─── Paper Session Config Shape ─────────────────────────────────────────────

/**
 * Shape of paper_sessions.config JSONB column.
 *
 * Populated when a paper session is created via POST /api/paper-sessions.
 * All fields are optional; absent fields fall back to per-firm or global defaults.
 */
export interface PaperSessionConfigShape {
  /** Strategy side for new entries. Default: from strategy DSL. */
  side?: "long" | "short";

  /** Cooldown bars after position close before re-entry allowed. Default: 4. */
  cooldown_bars?: number;

  /** Daily loss budget in dollars for governor state machine. Default: 500. */
  daily_loss_budget?: number;

  /** Whether news blackout windows are bypassed. Default: false. */
  bypass_news_blackout?: boolean;

  /** Fill model enabled (realistic latency + partial fill simulation). Default: true. */
  fillModelEnabled?: boolean;

  /** Simulated execution latency in ms. Default: 150. */
  latencyMs?: number;

  /** Firm key override (e.g. "topstep", "mffu"). Falls back to session.firmId. */
  firm_key?: string;

  // ── F-5: Topstep trailing-DD config ──────────────────────────────────────
  /**
   * Topstep trailing drawdown amount in dollars.
   * Resolution order (paper-signal-service):
   *   1. session.config.trailing_dd_amount  (this field)
   *   2. TOPSTEP_TRAILING_DD_BY_SIZE[accountStartingFloor]  (from firm-config.ts)
   *   3. 2000  (50K Topstep combine hard default)
   *
   * Set this when running a non-50K Topstep account or after a rule change.
   * Absent = use table lookup (preferred — avoids stale hardcoded values).
   */
  trailing_dd_amount?: number;
}

// ─── Adaptive Exit Engine Config Shape (Wave 25 Pass 7) ─────────────────────

/**
 * Exit style selector.
 *   "adaptive"      — Wave 25 liquidity-mapped TP + regime scaling + AVWAP runner (default for new strategies)
 *   "static_styleC" — Wave 23 33/33/34 + developing_session_poc trail (backward-compat for pre-Wave-25 strategies)
 */
export type ExitStyle = "adaptive" | "static_styleC";

/**
 * Runner trail method (regime-selected by adaptive exit engine).
 *   "anchored_vwap"    — VWAP anchored to entry bar timestamp (TRENDING regimes)
 *   "developing_poc"   — Developing session POC (RANGE_BOUND — preserves Style C behavior)
 *   "chandelier"       — Chandelier(14, 2.0) (HIGH_VOL_MACRO)
 *   "structure_trail"  — Below most recent swing low for longs (COMPRESSION)
 */
export type RunnerTrailMethod = "anchored_vwap" | "developing_poc" | "chandelier" | "structure_trail";

/**
 * Per-regime scaling arrays: [tp1_pct, tp2_pct, runner_pct].
 * All three values must sum to 1.00.
 */
export type RegimeScalingTuple = [number, number, number];

/**
 * Shape of strategies.exit_plan_config JSONB column.
 *
 * Migration: 0144_strategies_adaptive_exits.sql (idx 146).
 * NULL → exit_style defaults to "static_styleC" (backward-compat — pre-Wave-25 strategies unaffected).
 *
 * Hard invariants enforced by adaptive-exit-engine.ts (not this schema):
 *   - 15:55 ET hard flatten is NEVER overridden by the adaptive engine
 *   - BE+1 tick stop move on TP1 fill is always preserved
 *   - 67% personal DLL halt preserved
 *   - Per-symbol liquidity caps (MES 100 / MNQ 50 / MCL 30) preserved
 *   - TP targets restricted to intraday DOL only (no PWH/PWL/monthly)
 */
// ─── Adaptive Exit Plan Runtime State (Wave 25.5 Track 1) ───────────────────

/**
 * Per-bar mutable runtime state for adaptive runner trail methods.
 * Stored inside the exit_plan JSONB (paper_positions.exit_plan) to avoid
 * adding raw SQL columns for every new trail method.
 *
 * Updated in-place by updatePositionPrices on each bar for positions with
 * exit_style="adaptive". Never populated for static_styleC positions.
 *
 * anchored_vwap state:
 *   sum_pv  — running sum of (price × volume) since entry bar
 *   sum_v   — running sum of volume since entry bar
 *   avwap   — current anchored VWAP = sum_pv / sum_v (cached, avoids re-division)
 *
 * structure_trail state:
 *   current_swing_low  — lowest swing low seen since entry (long trails)
 *   current_swing_high — highest swing high seen since entry (short trails)
 */
export interface ExitPlanRuntimeState {
  // anchored_vwap
  sum_pv?: number;
  sum_v?: number;
  avwap?: number;
  // structure_trail
  current_swing_low?: number;
  current_swing_high?: number;
}

/**
 * ExitPlan extended with per-bar mutable runtime state.
 * This is the shape stored in paper_positions.exit_plan JSONB.
 *
 * The base ExitPlan (from adaptive-exit-engine.ts) is a compute-time snapshot.
 * runtime_state is appended at INSERT and updated in-place on each updatePositionPrices call.
 *
 * Import: ExitPlan is from adaptive-exit-engine.ts (server-side service).
 * We avoid a circular import by declaring the base fields inline here.
 * jsonb-shapes.ts is DB-layer only — it must NOT import from server services.
 */
export interface ExitPlanWithRuntimeState {
  /** Verbatim ExitPlan shape from adaptive-exit-engine.ts::computeExitPlan() */
  tp1: {
    source: string;
    price: number;
    level_type?: string;
    htf_significance?: number;
    r_multiple: number;
  };
  tp2: {
    source: string;
    price: number;
    level_type?: string;
    htf_significance?: number;
    r_multiple: number;
  };
  runner: {
    trail_method: RunnerTrailMethod;
    trail_anchor_value: number;
    regime_source: string;
    method_source: string;
  };
  scaling: {
    tp1_pct: number;
    tp2_pct: number;
    runner_pct: number;
    regime_source: string;
    schedule_source: string;
  };
  early_exit_threshold_delta_div: number;
  early_exit_partial_pct: number;
  pre_lunch_threshold_r: number;
  pre_lunch_partial_pct: number;
  audit_payload: Record<string, unknown>;
  /** Per-bar mutable runner trail state. Appended at INSERT (may be empty object). */
  runtime_state: ExitPlanRuntimeState;
}

/**
 * Trade-critique data-bridge (2026-07-05): entry-time decision context captured
 * by paper-signal-service.ts at signal time and merged into paper_positions.exit_plan
 * JSONB at position-open — same pattern F9 already established for `entryRegime`
 * (an extra key living alongside the typed ExitPlan fields, no migration needed).
 *
 * Read by trade-critique-service.ts at close time so the 8-dimension attribution
 * degrades gracefully toward 'partial'/'full' instead of always 'minimal'. Every
 * field is optional/nullable by design — only what the deciding signal actually
 * knew at entry is populated; nothing here is ever fabricated or backfilled.
 *
 * - `structureState` / `confluenceScore` / `confluenceFactorsActive` /
 *   `nearestLiquidityLevel` are only populated on Path C (Wave 25
 *   `entry_quality.use_weighted_scoring=true`) strategies, since Path A/B
 *   (boolean confluence) never computes a numeric score or fetches liquidity.
 *   Path A/B strategies still get `confluenceFactorsActive` (the satisfied
 *   canonical/per-strategy factor list) and `regimeAtEntry`/`atrAtEntry`.
 * - `narrativePhase` and `backtestExpectedRByRegime` are NOT populated here —
 *   the Wave 25 Pass 6 A/M/E narrative-state machine and per-regime expected-R
 *   are genuinely disconnected from the live signal path today (see CLAUDE.md
 *   §2 Wave 25 Pass 6 + Pass 2.5 notes). Left absent rather than fabricated;
 *   trade-critique-service.ts's existing missingFields/data_completeness
 *   degradation handles this exactly as before.
 */
export interface EntryDecisionContext {
  regimeAtEntry?: string | null;
  structureState?: unknown | null;
  confluenceScore?: number | null;
  confluenceFactorsActive?: string[] | null;
  nearestLiquidityLevel?: {
    price: number;
    levelType: string;
    distancePoints: number;
  } | null;
  atrAtEntry?: number | null;
}

// ─── Backtest Result Extras Shape (Wave 23 F-4) ──────────────────────────────

/**
 * Shape of backtests.result_extras JSONB column.
 *
 * Populated by backtest-service.ts::buildResultExtras() from Python backtester output.
 * Python writer stamps schema_version = "v2_truthiness" on current runs.
 * All fields optional — Python only emits what it computed.
 */
export interface BacktestResultExtrasShape {
  schema_version?: string;           // "v2_truthiness" | "v1" | undefined
  governor?: Record<string, unknown>;
  analytics?: Record<string, unknown>;
  long_short_split?: Record<string, unknown>;
  bootstrap_ci_95?: Record<string, unknown>;
  deflated_sharpe?: number | null;
  recency_analysis?: Record<string, unknown>;
  statistical_warnings?: string[] | Record<string, unknown>;
  confidence_intervals?: Record<string, unknown>;
  // B-1 / B-2 truthiness harness fields
  parity_shadow?: Record<string, unknown>;
  invariants?: Record<string, unknown>;
  // Wave 27.5 Pass B — WFE and PBO fields surfaced via result_extras
  wfe_overall?: number | null;
  pbo_overall?: number | null;
  pbo_overall_p_value?: number | null;
  // B14 / B15 gate inputs
  b14_ruin_ci?: Record<string, unknown>;
  b15_passed?: boolean;
  b10_pass?: boolean;
  frankenstein_pass?: boolean;
  compliance_pass_rate?: number;
  a14_severity?: string;
  [key: string]: unknown;            // forward-compat: accept new Python fields
}

// ─── Paper Session Governor State Shape (Wave 23 F-4) ────────────────────────

/**
 * Shape of paper_sessions.governor_state JSONB column.
 *
 * The session-level DLL governor persists its state machine here so server restarts
 * don't reset the loss-limit tracking mid-session.
 *
 * Comment from schema.ts: { state, consecutiveLosses, sessionLossPct, lastUpdatedAt }
 */
export interface PaperSessionGovernorStateShape {
  state?: "active" | "warning" | "halted" | "force_closing";
  consecutiveLosses?: number;
  consecutiveWins?: number;          // wave-23 governor tracks consecutive wins for reset logic
  sessionLossPct?: number;
  lastUpdatedAt?: string;            // ISO 8601 UTC
  [key: string]: unknown;            // forward-compat
}

export interface ExitPlanConfig {
  /**
   * Which exit engine to use for this strategy.
   * Default (when null/absent): "static_styleC" for backward-compat.
   */
  exit_style?: ExitStyle;

  /**
   * Per-regime scaling overrides. Each key is a regime string (TRENDING_UP etc.),
   * value is [tp1_pct, tp2_pct, runner_pct] summing to 1.00.
   * When null/absent, adaptive engine uses canonical regime defaults:
   *   TRENDING_UP/DOWN/EXPANSION: [0.20, 0.30, 0.50]
   *   RANGE_BOUND/COMPRESSION:    [0.50, 0.30, 0.20]
   *   HIGH_VOL_MACRO:             [0.60, 0.30, 0.10]
   *   LOW_LIQ_CHOP:               [0.50, 0.50, 0.00]
   */
  scaling_overrides?: Record<string, RegimeScalingTuple> | null;

  /**
   * Per-regime runner trail method overrides.
   * When null/absent, adaptive engine uses canonical regime defaults:
   *   TRENDING_UP/DOWN/EXPANSION: "anchored_vwap"
   *   RANGE_BOUND:                "developing_poc"
   *   HIGH_VOL_MACRO:             "chandelier"
   *   COMPRESSION:                "structure_trail"
   */
  runner_trail_overrides?: Record<string, RunnerTrailMethod> | null;

  /**
   * Minimum profit in R-multiples required for pre-lunch soft exit to fire.
   * Default: 0.3. Only applies when regime ∈ {RANGE_BOUND, LOW_LIQ_CHOP, COMPRESSION}
   * AND current ET time >= 11:30.
   */
  pre_lunch_threshold_r?: number;

  /**
   * Fraction of position to close on delta-divergence early-exit signal.
   * Default: 0.25. Must be in (0, 1). Never flips position — only reduces.
   */
  delta_div_partial_pct?: number;
}
