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
