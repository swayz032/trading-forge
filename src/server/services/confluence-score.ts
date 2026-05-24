/**
 * confluence-score.ts — Wave 25 Pass 1, W25.1
 *
 * Weighted probabilistic confluence scoring (Path C) for Stage 2 of the A+ gate.
 *
 * Replaces the boolean "satisfied >= min_factors_satisfied" retail checklist with
 * a 9-factor weighted model where each factor carries a named weight and factors
 * with is_hard_block=true force score=0 when not satisfied.
 *
 * Pattern mirrors src/server/services/picker-metrics.ts (W23H.C composite picker):
 *   - Fixed weights at the code level (overfitting guard — adjust only after
 *     30+ days forward instrumentation via audit_log)
 *   - All component contributions clamped to their weight (0 or weight)
 *   - Final score in [0, 1]
 *
 * Override hierarchy (highest wins):
 *   1. strategy.confluence_score_weights (per-strategy DB column)
 *   2. process.env.CONFLUENCE_SCORE_WEIGHTS (JSON string, operator env var)
 *   3. CODE_DEFAULTS below
 *
 * Hard-block contract: any factor with is_hard_block=true that returns
 *   satisfied=false sets score=0 and hardBlockTriggered=true, overriding
 *   the weighted sum regardless of other factors.
 *
 * Stub contract: three factor evaluators are stubs pending upstream Pass deliveries.
 *   They MUST emit satisfied=false with a "pending_passX" reason string — they must
 *   NOT throw or return satisfied=true accidentally.
 *
 * Logger import: uses ./logger.js leaf module (feedback_helper_logger_import.md).
 */

import { logger } from "../lib/logger.js";
import { isInAnyKillzone, activeKillzones } from "../lib/killzone.js";
import { getInternalsSnapshot } from "./market-internals-service.js";
import type { RankedLevel } from "./liquidity-map-service.js";

// ─── Named weight constants — 11-factor model (W25.5c renormalization) ────────
// Weights sum to exactly 1.00. Equal-weight-ish starter.
// Overfitting guard: only adjust after 30+ days of audit_log instrumentation.

export const W_MARKET_STRUCTURE_ALIGNED = 0.20; // BOS/CHoCH/MSS aligned to bias
export const W_LIQUIDITY_TARGET_CLEAR   = 0.13; // DOL identified within R:R  (-0.02 from 0.15)
export const W_SMT_CONFIRMATION         = 0.10; // ES↔NQ divergence agrees     (-0.02 from 0.12)
export const W_VWAP_ALIGNMENT           = 0.10; // session VWAP alignment       (-0.02 from 0.12)
export const W_KILLZONE_ACTIVE          = 0.08; // in trade window              (-0.02 from 0.10)
export const W_DELTA_OR_VOLUME          = 0.08; // cumulative delta OR volume spike (-0.02 from 0.10)
export const W_VP_LEVEL_PROXIMITY       = 0.08; // POC/VAH/VAL/naked-POC magnet
export const W_MACRO_ALIGNMENT          = 0.08; // FOMC/CPI/NFP blackout safe — HARD BLOCK
export const W_INTERNALS_ALIGNED        = 0.05; // $TICK/$ADD/$VOLD (MES/MNQ only; MCL uses 0 → redistributed)
export const W_CROSS_ASSET_ALIGNED      = 0.05; // DXY + 10Y direction vs bias
export const W_REGIME_MATCH             = 0.05; // current regime in preferred_regimes[]
// Sum: 0.20+0.13+0.10+0.10+0.08+0.08+0.08+0.08+0.05+0.05+0.05 = 1.00

// MCL redistribution: internals factor weight shifts to cross_asset for crude
export const W_INTERNALS_ALIGNED_MCL    = 0.00; // internals irrelevant for crude
export const W_CROSS_ASSET_ALIGNED_MCL  = 0.10; // +0.05 redistributed from internals for MCL

// Default threshold — must be met or exceeded for the signal to pass.
export const DEFAULT_CONFLUENCE_THRESHOLD = 0.72;

// Env var name for operator-level weight override (JSON string).
const ENV_WEIGHTS_KEY = "CONFLUENCE_SCORE_WEIGHTS";

// ─── Canonical factor names (stable keys — referenced in audit rows) ──────────
export const FACTOR_MARKET_STRUCTURE_ALIGNED = "market_structure_aligned";
export const FACTOR_LIQUIDITY_TARGET_CLEAR   = "liquidity_target_clear";
export const FACTOR_SMT_CONFIRMATION         = "smt_confirmation";
export const FACTOR_VWAP_ALIGNMENT           = "vwap_alignment";
export const FACTOR_KILLZONE_ACTIVE          = "killzone_active";
export const FACTOR_DELTA_OR_VOLUME          = "delta_or_volume_signature";
export const FACTOR_VP_LEVEL_PROXIMITY       = "vp_level_proximity";
export const FACTOR_MACRO_ALIGNMENT          = "macro_alignment";
export const FACTOR_INTERNALS_ALIGNED        = "internals_aligned";
export const FACTOR_CROSS_ASSET_ALIGNED      = "cross_asset_aligned";
export const FACTOR_REGIME_MATCH             = "regime_match";

// ─── Code defaults table — 11-factor model ───────────────────────────────────
// factor → { weight, isHardBlock }
// Hard-block means: if satisfied=false for this factor → score=0, pass=false
// regardless of what the rest of the model says.
//
// MCL override: FACTOR_INTERNALS_ALIGNED weight is set to 0 for MCL (stock breadth
// is irrelevant for crude); its weight redistributes to FACTOR_CROSS_ASSET_ALIGNED.
// This redistribution is applied dynamically in evaluateWeightedConfluence().

export interface FactorConfig {
  weight: number;
  isHardBlock: boolean;
}

export const CODE_DEFAULTS: Record<string, FactorConfig> = {
  [FACTOR_MARKET_STRUCTURE_ALIGNED]: { weight: W_MARKET_STRUCTURE_ALIGNED, isHardBlock: false },
  [FACTOR_LIQUIDITY_TARGET_CLEAR]:   { weight: W_LIQUIDITY_TARGET_CLEAR,   isHardBlock: false },
  [FACTOR_SMT_CONFIRMATION]:         { weight: W_SMT_CONFIRMATION,          isHardBlock: false },
  [FACTOR_VWAP_ALIGNMENT]:           { weight: W_VWAP_ALIGNMENT,            isHardBlock: false },
  [FACTOR_KILLZONE_ACTIVE]:          { weight: W_KILLZONE_ACTIVE,           isHardBlock: false },
  [FACTOR_DELTA_OR_VOLUME]:          { weight: W_DELTA_OR_VOLUME,           isHardBlock: false },
  [FACTOR_VP_LEVEL_PROXIMITY]:       { weight: W_VP_LEVEL_PROXIMITY,        isHardBlock: false },
  [FACTOR_MACRO_ALIGNMENT]:          { weight: W_MACRO_ALIGNMENT,           isHardBlock: true  }, // HARD BLOCK
  [FACTOR_INTERNALS_ALIGNED]:        { weight: W_INTERNALS_ALIGNED,         isHardBlock: false }, // MES/MNQ only; MCL→0
  [FACTOR_CROSS_ASSET_ALIGNED]:      { weight: W_CROSS_ASSET_ALIGNED,       isHardBlock: false }, // MCL→0.10
  [FACTOR_REGIME_MATCH]:             { weight: W_REGIME_MATCH,              isHardBlock: false },
};

// ─── Public interfaces ────────────────────────────────────────────────────────

/**
 * Minimal bar data needed for factor evaluation.
 */
export interface BarSnapshot {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** UTC milliseconds — used for killzone time checks */
  timestamp?: number;
}

/**
 * Structure state published by the structure_engine.py (Pass 1 W25.2).
 * Consumed read-only here. When null, structure factors return satisfied=false
 * with reason "structure_engine_unavailable" (expected before W25.2 ships).
 *
 * SHAPE: snake_case keys produced by Python `dataclasses.asdict(StructureState)`.
 * Canonical definition lives in bias-state-service.ts — this is a structural
 * alias to keep the confluence-score.ts module self-contained (no upward import
 * into bias-state-service which transitively pulls db/schema and breaks test
 * isolation per feedback_helper_logger_import.md).
 *
 * Adding/renaming a field requires updates in 3 places — see W25.2 dataclass docstring.
 */
export interface StructureState {
  bos_recent: boolean;
  bos_direction: "bullish" | "bearish" | null;
  choch_recent: boolean;
  choch_direction: "bullish" | "bearish" | null;
  mss_recent: boolean;
  mss_direction: "bullish" | "bearish" | null;
  mss_displacement_atr_mult: number | null;
  displacement_active: boolean;
  premium_discount_zone: "premium" | "discount" | "equilibrium";
  htf_bias_aligned: boolean;
  last_break_direction: "bullish" | "bearish" | null;
  last_break_age_bars: number | null;
  swing_high: number | null;
  swing_low: number | null;
  computed_at_bar_idx: number;
  /** Derived: htf_bias_aligned && last_break_direction matches bias. Optional — eval handles via htf_bias_aligned + choch_recent when absent. */
  market_structure_aligned?: boolean;
}

/**
 * All inputs that factor evaluators can read.
 * Populated at signal time from the surrounding paper-signal-service context.
 */
export interface SignalContext {
  strategyId: string;
  bar: BarSnapshot;
  /** Current indicator snapshot — keys match DSL indicator names */
  indicators: Record<string, number | undefined>;
  direction: "long" | "short";
  symbol?: string;   // W25.5c: used by internals_aligned MCL skip + cross_asset_aligned
  /** Bias engine active strategy for this symbol+session (null = no preference) */
  bias_active_strategy_id: string | null;
  /**
   * Structure engine state — populated by bias-state-service after W25.2 ships.
   * null until the structure engine publishes its first state (Pass 1 W25.2).
   */
  structureState: StructureState | null;
  /** calendarBlocked: reuses the existing signal-time calendar check result */
  calendarBlocked: boolean;
  /**
   * UTC timestamp of the signal bar. Used by killzone_active factor.
   * When undefined, killzone evaluation uses bar.timestamp (ms epoch) as fallback.
   */
  timestampUTC?: Date;
  /**
   * W25.5c: Cross-asset direction fields from pre_market_sessions row.
   * null when the pre-market routine has not yet populated these for today.
   */
  dxyDirection?: "up" | "down" | "flat" | null;
  us10yDirection?: "up" | "down" | "flat" | null;
  /**
   * W25.6 (Pass 3): Pre-populated liquidity levels for the liquidity_target_clear
   * factor.  paper-signal-service.ts must call getNearestLiquidity() BEFORE
   * evaluateWeightedConfluence() and inject the results here.
   *
   * When null/absent: evalLiquidityTargetClear returns satisfied=false with
   * reason="liquidity_map_unavailable" (conservative fail-open).
   */
  liquidityNearestAbove?: RankedLevel[] | null;
  liquidityNearestBelow?: RankedLevel[] | null;
}

/**
 * Per-factor evaluation result.
 */
export interface FactorContribution {
  factor: string;
  weight: number;
  satisfied: boolean;
  /** Numeric contribution to score: weight × (satisfied ? 1 : 0) */
  contribution: number;
  reason: string;
  is_hard_block: boolean;
}

/**
 * Full weighted-scoring result returned by evaluateWeightedConfluence().
 */
export interface WeightedScoreResult {
  /** Final score in [0, 1] (0 if hard-block triggered) */
  score: number;
  /** Threshold applied (strategy override or DEFAULT_CONFLUENCE_THRESHOLD) */
  threshold: number;
  /** True iff score >= threshold AND no hard-block factor failed */
  passed: boolean;
  factorContributions: FactorContribution[];
  /** True if any hard-block factor returned satisfied=false */
  hardBlockTriggered: boolean;
  /** Identifies which level of the override hierarchy supplied the weights */
  weightsSource: "strategy_override" | "env_default" | "code_default";
}

// ─── Strategy shape (minimal — only fields this module reads) ─────────────────

export interface ScoringStrategy {
  id: string;
  symbol: string;
  confluence_score_weights: Record<string, number> | null;
  confluence_score_threshold: number | null;
  entry_quality?: Record<string, unknown> | null;
}

// ─── Weight resolution ────────────────────────────────────────────────────────

/**
 * Parse env var CONFLUENCE_SCORE_WEIGHTS if present.
 * Returns null on parse error (logs warning, falls back to code defaults).
 */
function parseEnvWeights(): Record<string, number> | null {
  const raw = process.env[ENV_WEIGHTS_KEY];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      logger.warn(
        { key: ENV_WEIGHTS_KEY, value: raw },
        "confluence-score: CONFLUENCE_SCORE_WEIGHTS is not a JSON object — falling back to code defaults",
      );
      return null;
    }
    return parsed as Record<string, number>;
  } catch (err) {
    logger.warn(
      { key: ENV_WEIGHTS_KEY, err },
      "confluence-score: failed to parse CONFLUENCE_SCORE_WEIGHTS JSON — falling back to code defaults",
    );
    return null;
  }
}

/**
 * Resolve weights for all 9 canonical factors according to the override hierarchy.
 * Returns a map of factor → resolved weight (NOT renormalised here — caller decides
 * whether to renormalise when a partial override set is provided).
 */
function resolveWeights(strategy: ScoringStrategy): {
  weights: Record<string, number>;
  source: WeightedScoreResult["weightsSource"];
} {
  // Priority 1: per-strategy DB column
  if (strategy.confluence_score_weights && Object.keys(strategy.confluence_score_weights).length > 0) {
    // Merge strategy overrides over code defaults (strategy may provide a partial map)
    const merged: Record<string, number> = {};
    for (const [factor, cfg] of Object.entries(CODE_DEFAULTS)) {
      merged[factor] = strategy.confluence_score_weights[factor] ?? cfg.weight;
    }
    return { weights: merged, source: "strategy_override" };
  }

  // Priority 2: env var
  const envWeights = parseEnvWeights();
  if (envWeights) {
    const merged: Record<string, number> = {};
    for (const [factor, cfg] of Object.entries(CODE_DEFAULTS)) {
      merged[factor] = envWeights[factor] ?? cfg.weight;
    }
    return { weights: merged, source: "env_default" };
  }

  // Priority 3: code defaults
  const defaults: Record<string, number> = {};
  for (const [factor, cfg] of Object.entries(CODE_DEFAULTS)) {
    defaults[factor] = cfg.weight;
  }
  return { weights: defaults, source: "code_default" };
}

// ─── Individual factor evaluators ────────────────────────────────────────────
// Each returns { satisfied, reason }. Must NEVER throw.

/**
 * market_structure_aligned — reads structureState published by W25.2.
 * Pass 1: if structureState is null, returns satisfied=false with descriptive reason.
 * This means the factor always fails until Pass 2 (W25.2) ships — which is correct:
 * strategies opting into weighted scoring before the structure engine is live will
 * not pass the default 0.72 threshold on this factor alone.
 */
function evalMarketStructureAligned(
  ctx: SignalContext,
): { satisfied: boolean; reason: string } {
  if (ctx.structureState === null) {
    return { satisfied: false, reason: "structure_engine_unavailable" };
  }
  // Prefer the explicit derived flag when published; otherwise derive from htf_bias_aligned
  // (the W25.2 canonical predicate: HTF aligned AND a recent break exists in the same direction).
  const derived =
    ctx.structureState.htf_bias_aligned === true &&
    (ctx.structureState.choch_recent === true ||
      ctx.structureState.mss_recent === true ||
      ctx.structureState.bos_recent === true);
  const satisfied =
    typeof ctx.structureState.market_structure_aligned === "boolean"
      ? ctx.structureState.market_structure_aligned
      : derived;
  return {
    satisfied,
    reason: satisfied
      ? `structure_aligned_htf=${ctx.structureState.htf_bias_aligned}_choch=${ctx.structureState.choch_recent}_mss=${ctx.structureState.mss_recent}`
      : `structure_not_aligned_htf=${ctx.structureState.htf_bias_aligned}_choch=${ctx.structureState.choch_recent}_mss=${ctx.structureState.mss_recent}`,
  };
}

/**
 * liquidity_target_clear — Pass 3, W25.6.
 *
 * Queries the persistent liquidity map for at least one active level in the
 * signal direction (above for LONG, below for SHORT) within 1 ADR.
 *
 * Satisfied when ≥1 level is returned with sweep_probability ≥ 0.4.
 * This proves a DOM-of-liquidity (DOL) exists as a realistic take-profit target.
 *
 * Fail-open on any service error (satisfied=false with descriptive reason) —
 * never throws.  The factor contributes 0 to the score when the map is
 * unavailable, which is conservative (preserves the integrity of the gate).
 */
function evalLiquidityTargetClear(
  ctx: SignalContext,
): { satisfied: boolean; reason: string } {
  // Import is dynamic to avoid circular dep and allow test mocking.
  // The import is sync-pattern-safe because getNearestLiquidity returns a Promise;
  // we call it and handle the result asynchronously inside a try/catch.
  // However, factor evaluators must be synchronous in the current architecture
  // (evaluateWeightedConfluence is sync). We therefore check whether the service
  // has already pre-populated a cached result via ctx.liquidityLevelsAbove /
  // ctx.liquidityLevelsBelow, and fall back to satisfied=false when not pre-populated.
  //
  // Call site: paper-signal-service.ts must call getNearestLiquidity() BEFORE
  // invoking evaluateWeightedConfluence() and inject the result into
  // ctx.liquidityNearestAbove / ctx.liquidityNearestBelow. Until that wiring
  // lands (Pass 3 P3.A5 architect pass), the factor reads from the pre-populated
  // fields and returns "liquidity_map_unavailable" when absent.

  const direction = ctx.direction;
  const levels = direction === "long"
    ? ctx.liquidityNearestAbove
    : ctx.liquidityNearestBelow;

  if (!levels || levels.length === 0) {
    return { satisfied: false, reason: "liquidity_map_unavailable" };
  }

  const MIN_SWEEP_PROBABILITY = 0.4;
  const qualifying = levels.filter((l) => l.sweep_probability >= MIN_SWEEP_PROBABILITY);

  if (qualifying.length === 0) {
    const best = levels[0];
    return {
      satisfied: false,
      reason: `no_level_meets_sweep_prob_threshold_best=${best.level_type}_sp=${best.sweep_probability.toFixed(2)}_dist=${best.distance_points.toFixed(2)}`,
    };
  }

  const top = qualifying[0];
  return {
    satisfied: true,
    reason: `${direction}_dol_clear_${top.level_type}_sp=${top.sweep_probability.toFixed(2)}_dist=${top.distance_points.toFixed(2)}_htf=${top.htf_significance}`,
  };
}

/**
 * smt_confirmation — STUB (pending Pass 5 W25.9 smt_divergence.py).
 */
function evalSmtConfirmation(
  _ctx: SignalContext,
): { satisfied: boolean; reason: string } {
  return { satisfied: false, reason: "smt_pending_pass5" };
}

/**
 * vwap_alignment — real-ish evaluator using existing session VWAP indicator.
 * Reads indicators.vwap; compares bar.close position relative to vwap in the
 * signal direction. Fails open when vwap indicator is absent (satisfied=false
 * to preserve the conservative character of the weighted model).
 */
function evalVwapAlignment(
  ctx: SignalContext,
): { satisfied: boolean; reason: string } {
  const vwap = ctx.indicators["vwap"];
  if (vwap === undefined || !Number.isFinite(vwap)) {
    return { satisfied: false, reason: "vwap_indicator_absent" };
  }
  const close = ctx.bar.close;
  if (ctx.direction === "long") {
    const satisfied = close > vwap;
    return {
      satisfied,
      reason: satisfied
        ? `long_close_${close.toFixed(2)}_above_vwap_${vwap.toFixed(2)}`
        : `long_close_${close.toFixed(2)}_below_vwap_${vwap.toFixed(2)}`,
    };
  } else {
    const satisfied = close < vwap;
    return {
      satisfied,
      reason: satisfied
        ? `short_close_${close.toFixed(2)}_below_vwap_${vwap.toFixed(2)}`
        : `short_close_${close.toFixed(2)}_above_vwap_${vwap.toFixed(2)}`,
    };
  }
}

/**
 * killzone_active — uses the W25.3 killzone.ts helper (static import).
 * Satisfied when the signal bar's timestamp falls within ANY of the 5
 * operator-canonical killzone windows. Active zone names are embedded in
 * the reason string for the audit trail.
 *
 * Resolution order for the timestamp:
 *   1. ctx.timestampUTC  (Date object set by paper-signal-service at signal time)
 *   2. bar.timestamp     (ms epoch fallback)
 *   3. Date.now()        (last-resort: reduces to "is it a killzone right now")
 */
function evalKillzoneActive(
  ctx: SignalContext,
): { satisfied: boolean; reason: string } {
  const tsDate: Date =
    ctx.timestampUTC instanceof Date
      ? ctx.timestampUTC
      : new Date(ctx.bar.timestamp ?? Date.now());

  const zones = activeKillzones(tsDate);
  if (zones.length > 0) {
    return {
      satisfied: true,
      reason: `active: ${zones.join(", ")}`,
    };
  }
  return {
    satisfied: isInAnyKillzone(tsDate),
    reason: "no_killzone_active",
  };
}

/**
 * delta_or_volume_signature — proxy evaluator using volume confirmation.
 * Real delta signal lands in Pass 5 (W25.9). For now: satisfied if current
 * bar volume > rolling-mean of last 20 bars × 1.2 (same threshold as canonical-5
 * volume_confirmation factor).
 */
function evalDeltaOrVolumeSignature(
  ctx: SignalContext,
): { satisfied: boolean; reason: string } {
  const vol = ctx.bar.volume;
  if (!Number.isFinite(vol) || vol <= 0) {
    return { satisfied: false, reason: "volume_absent_or_zero" };
  }
  // Try to find rolling mean from indicators snapshot
  const rollingMeanKey = "volume_rolling_mean_20";
  const rollingMean = ctx.indicators[rollingMeanKey];
  if (rollingMean !== undefined && Number.isFinite(rollingMean) && rollingMean > 0) {
    const VOLUME_SPIKE_MULTIPLE = 1.2;
    const satisfied = vol > rollingMean * VOLUME_SPIKE_MULTIPLE;
    return {
      satisfied,
      reason: satisfied
        ? `volume_spike_${vol.toFixed(0)}_gt_mean_${rollingMean.toFixed(0)}_x${VOLUME_SPIKE_MULTIPLE}`
        : `volume_insufficient_${vol.toFixed(0)}_lte_mean_${rollingMean.toFixed(0)}_x${VOLUME_SPIKE_MULTIPLE}`,
    };
  }
  // Fallback: no rolling mean in indicators — delta/volume judgment deferred
  return { satisfied: false, reason: "volume_rolling_mean_unavailable_pending_accumulation" };
}

/**
 * vp_level_proximity — reads existing VP indicators if available.
 * Satisfied when bar.close is within 1×ATR of any VP key level
 * (vp_poc, vp_vah, vp_val).
 */
function evalVpLevelProximity(
  ctx: SignalContext,
): { satisfied: boolean; reason: string } {
  const atr = ctx.indicators["atr"];
  const poc = ctx.indicators["vp_poc"];
  const vah = ctx.indicators["vp_vah"];
  const val = ctx.indicators["vp_val"];

  const levels: Array<{ name: string; value: number }> = [];
  if (poc !== undefined && Number.isFinite(poc)) levels.push({ name: "poc", value: poc });
  if (vah !== undefined && Number.isFinite(vah)) levels.push({ name: "vah", value: vah });
  if (val !== undefined && Number.isFinite(val)) levels.push({ name: "val", value: val });

  if (levels.length === 0) {
    return { satisfied: false, reason: "vp_indicators_absent" };
  }

  if (!atr || !Number.isFinite(atr) || atr <= 0) {
    return { satisfied: false, reason: "atr_indicator_absent" };
  }

  const close = ctx.bar.close;
  const VP_PROXIMITY_ATR_MULTIPLIER = 1.0; // within 1×ATR of any VP level

  for (const lvl of levels) {
    if (Math.abs(close - lvl.value) <= atr * VP_PROXIMITY_ATR_MULTIPLIER) {
      return {
        satisfied: true,
        reason: `close_${close.toFixed(2)}_within_1atr_of_${lvl.name}_${lvl.value.toFixed(2)}`,
      };
    }
  }

  const nearest = levels.reduce((best, lvl) =>
    Math.abs(close - lvl.value) < Math.abs(close - best.value) ? lvl : best
  );
  return {
    satisfied: false,
    reason: `no_vp_level_within_1atr_nearest_${nearest.name}_${nearest.value.toFixed(2)}_dist_${Math.abs(close - nearest.value).toFixed(2)}_atr_${atr.toFixed(2)}`,
  };
}

/**
 * macro_alignment — HARD BLOCK factor.
 * Reads the calendarBlocked flag already computed at signal time in paper-signal-service.
 * If any FOMC/CPI/NFP/economic-event blackout covers this bar's timestamp → satisfied=false.
 * This is a hard-block: the entire weighted score becomes 0.
 */
function evalMacroAlignment(
  ctx: SignalContext,
): { satisfied: boolean; reason: string } {
  const satisfied = !ctx.calendarBlocked;
  return {
    satisfied,
    reason: satisfied ? "no_event_blackout" : "event_blackout_active_hard_block",
  };
}

/**
 * regime_match — satisfied when the bias engine's active strategy matches
 * this strategy OR when no preference is set (bias_active_strategy_id is null).
 */
function evalRegimeMatch(
  ctx: SignalContext,
  strategyId: string,
): { satisfied: boolean; reason: string } {
  const active = ctx.bias_active_strategy_id;
  const satisfied = active === null || active === strategyId;
  return {
    satisfied,
    reason: satisfied
      ? active === null
        ? "regime_no_preference"
        : `regime_matched_active=${active}`
      : `regime_mismatch_active=${active}_this=${strategyId}`,
  };
}

/**
 * internals_aligned — W25.5c
 *
 * Reads NYSE market-breadth internals ($TICK / $ADD / $VOLD) from the live
 * market-internals-service snapshot.
 *
 * MCL skip: internals are NYSE stock-breadth; irrelevant for crude oil.
 *   When symbol === "MCL", returns satisfied=false, reason="mcl_skip_stock_breadth_irrelevant".
 *   The weight redistribution (internals → cross_asset) is handled in evaluateWeightedConfluence().
 *
 * Stale snapshot → satisfied=false, reason="internals_stale".
 *
 * Long: $TICK > +500 OR $ADD > 0 OR $VOLD > 0
 * Short: $TICK < -500 OR $ADD < 0 OR $VOLD < 0
 */
function evalInternalsAligned(
  ctx: SignalContext,
): { satisfied: boolean; reason: string } {
  // MCL skip
  if (ctx.symbol === "MCL") {
    return { satisfied: false, reason: "mcl_skip_stock_breadth_irrelevant" };
  }

  let snapshot;
  try {
    snapshot = getInternalsSnapshot();
  } catch {
    return { satisfied: false, reason: "internals_service_unavailable" };
  }

  if (snapshot.stale) {
    return { satisfied: false, reason: "internals_stale" };
  }

  const { tick, add, vold } = snapshot;

  // At least one reading must be present
  if (tick === null && add === null && vold === null) {
    return { satisfied: false, reason: "internals_all_null" };
  }

  if (ctx.direction === "long") {
    const satisfied =
      (tick !== null && tick > 500) ||
      (add  !== null && add  > 0)  ||
      (vold !== null && vold > 0);
    return {
      satisfied,
      reason: satisfied
        ? `long_internals_bullish_tick=${tick ?? "null"}_add=${add ?? "null"}_vold=${vold ?? "null"}`
        : `long_internals_not_bullish_tick=${tick ?? "null"}_add=${add ?? "null"}_vold=${vold ?? "null"}`,
    };
  } else {
    const satisfied =
      (tick !== null && tick < -500) ||
      (add  !== null && add  < 0)   ||
      (vold !== null && vold < 0);
    return {
      satisfied,
      reason: satisfied
        ? `short_internals_bearish_tick=${tick ?? "null"}_add=${add ?? "null"}_vold=${vold ?? "null"}`
        : `short_internals_not_bearish_tick=${tick ?? "null"}_add=${add ?? "null"}_vold=${vold ?? "null"}`,
    };
  }
}

/**
 * cross_asset_aligned — W25.5c
 *
 * Reads DXY / 10Y direction from SignalContext (populated by pre_market_sessions row).
 *
 * ES/NQ (equity index) — inverse correlation:
 *   long  → DXY down OR 10Y down (risk-on environment)
 *   short → DXY up OR 10Y up (risk-off environment)
 *
 * MCL (crude oil) — dollar-inverse correlation:
 *   long  → DXY down (crude benefits from weak dollar)
 *   short → DXY up
 *
 * Missing data → satisfied=false, reason="cross_asset_data_unavailable".
 */
function evalCrossAssetAligned(
  ctx: SignalContext,
): { satisfied: boolean; reason: string } {
  const dxy = ctx.dxyDirection;
  const us10y = ctx.us10yDirection;

  if (!dxy && !us10y) {
    return { satisfied: false, reason: "cross_asset_data_unavailable" };
  }

  const isMCL = ctx.symbol === "MCL";

  if (isMCL) {
    if (!dxy) return { satisfied: false, reason: "cross_asset_dxy_unavailable_mcl" };
    if (ctx.direction === "long") {
      const satisfied = dxy === "down";
      return {
        satisfied,
        reason: satisfied
          ? `mcl_long_dxy_down_bullish`
          : `mcl_long_dxy=${dxy}_not_supportive`,
      };
    } else {
      const satisfied = dxy === "up";
      return {
        satisfied,
        reason: satisfied
          ? `mcl_short_dxy_up_bearish`
          : `mcl_short_dxy=${dxy}_not_supportive`,
      };
    }
  }

  // ES / NQ — inverse correlation
  if (ctx.direction === "long") {
    const satisfied = dxy === "down" || us10y === "down";
    return {
      satisfied,
      reason: satisfied
        ? `long_risk_on_dxy=${dxy ?? "null"}_10y=${us10y ?? "null"}`
        : `long_risk_off_or_mixed_dxy=${dxy ?? "null"}_10y=${us10y ?? "null"}`,
    };
  } else {
    const satisfied = dxy === "up" || us10y === "up";
    return {
      satisfied,
      reason: satisfied
        ? `short_risk_off_dxy=${dxy ?? "null"}_10y=${us10y ?? "null"}`
        : `short_risk_on_or_mixed_dxy=${dxy ?? "null"}_10y=${us10y ?? "null"}`,
    };
  }
}

// ─── Factor dispatch table ─────────────────────────────────────────────────────

type FactorEvaluator = (ctx: SignalContext, strategyId: string) => { satisfied: boolean; reason: string };

const FACTOR_EVALUATORS: Record<string, FactorEvaluator> = {
  [FACTOR_MARKET_STRUCTURE_ALIGNED]: (ctx) => evalMarketStructureAligned(ctx),
  [FACTOR_LIQUIDITY_TARGET_CLEAR]:   (ctx) => evalLiquidityTargetClear(ctx),
  [FACTOR_SMT_CONFIRMATION]:         (ctx) => evalSmtConfirmation(ctx),
  [FACTOR_VWAP_ALIGNMENT]:           (ctx) => evalVwapAlignment(ctx),
  [FACTOR_KILLZONE_ACTIVE]:          (ctx) => evalKillzoneActive(ctx),
  [FACTOR_DELTA_OR_VOLUME]:          (ctx) => evalDeltaOrVolumeSignature(ctx),
  [FACTOR_VP_LEVEL_PROXIMITY]:       (ctx) => evalVpLevelProximity(ctx),
  [FACTOR_MACRO_ALIGNMENT]:          (ctx) => evalMacroAlignment(ctx),
  [FACTOR_INTERNALS_ALIGNED]:        (ctx) => evalInternalsAligned(ctx),
  [FACTOR_CROSS_ASSET_ALIGNED]:      (ctx) => evalCrossAssetAligned(ctx),
  [FACTOR_REGIME_MATCH]:             (ctx, id) => evalRegimeMatch(ctx, id),
};

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Evaluate all 11 canonical weighted confluence factors for a given signal.
 *
 * Safe to call from paper-signal-service: never throws. All factor evaluators
 * fail to satisfied=false on any error (conservative — preserves hard-block
 * guarantees).
 *
 * MCL redistribution: for MCL signals, FACTOR_INTERNALS_ALIGNED weight is
 * zeroed and its weight (+0.05) redistributes to FACTOR_CROSS_ASSET_ALIGNED
 * (0.05 → 0.10). Total weight sum remains 1.00.
 *
 * @param strategy  Minimal strategy shape (id, symbol, score columns).
 * @param signalContext  Bar + indicator snapshot at signal time.
 * @returns WeightedScoreResult with full factor audit trail.
 */
export function evaluateWeightedConfluence(
  strategy: ScoringStrategy,
  signalContext: SignalContext,
): WeightedScoreResult {
  const { weights: baseWeights, source: weightsSource } = resolveWeights(strategy);

  // Apply MCL weight redistribution: internals → cross_asset
  const isMCL = (signalContext.symbol ?? strategy.symbol) === "MCL";
  const weights = { ...baseWeights };
  if (isMCL) {
    const internalsWeight = weights[FACTOR_INTERNALS_ALIGNED] ?? W_INTERNALS_ALIGNED;
    weights[FACTOR_INTERNALS_ALIGNED] = W_INTERNALS_ALIGNED_MCL;
    weights[FACTOR_CROSS_ASSET_ALIGNED] = (weights[FACTOR_CROSS_ASSET_ALIGNED] ?? W_CROSS_ASSET_ALIGNED) + internalsWeight;
  }

  // Threshold: strategy column → code default
  const threshold =
    strategy.confluence_score_threshold !== null &&
    strategy.confluence_score_threshold !== undefined &&
    Number.isFinite(Number(strategy.confluence_score_threshold))
      ? Number(strategy.confluence_score_threshold)
      : DEFAULT_CONFLUENCE_THRESHOLD;

  const factorContributions: FactorContribution[] = [];
  let hardBlockTriggered = false;

  for (const factorName of Object.keys(CODE_DEFAULTS)) {
    const factorCfg = CODE_DEFAULTS[factorName];
    const weight = weights[factorName] ?? factorCfg.weight;
    const evaluator = FACTOR_EVALUATORS[factorName];

    let satisfied = false;
    let reason = "evaluator_not_registered";

    if (evaluator) {
      try {
        const result = evaluator(signalContext, strategy.id);
        satisfied = result.satisfied;
        reason = result.reason;
      } catch (err) {
        // Factor evaluator must never throw — defensive catch here as backstop.
        logger.error(
          { factor: factorName, strategyId: strategy.id, err },
          "confluence-score: factor evaluator threw unexpectedly — treating as satisfied=false (fail-closed)",
        );
        satisfied = false;
        reason = "evaluator_threw_unexpected_error";
      }
    }

    if (factorCfg.isHardBlock && !satisfied) {
      hardBlockTriggered = true;
    }

    factorContributions.push({
      factor: factorName,
      weight,
      satisfied,
      contribution: satisfied ? weight : 0,
      reason,
      is_hard_block: factorCfg.isHardBlock,
    });
  }

  // When a hard-block factor failed, score is forced to 0 regardless of sum.
  let score: number;
  if (hardBlockTriggered) {
    score = 0;
  } else {
    const rawSum = factorContributions.reduce((acc, fc) => acc + fc.contribution, 0);
    // Clamp to [0, 1] — should already be in range if weights sum to 1.0
    score = Math.max(0, Math.min(1, rawSum));
  }

  const passed = !hardBlockTriggered && score >= threshold;

  logger.debug(
    {
      strategyId: strategy.id,
      score: score.toFixed(4),
      threshold: threshold.toFixed(2),
      passed,
      hardBlockTriggered,
      weightsSource,
      factorSummary: factorContributions.map((fc) => `${fc.factor}:${fc.satisfied ? 1 : 0}`).join(","),
    },
    "confluence-score: weighted evaluation complete",
  );

  return {
    score,
    threshold,
    passed,
    factorContributions,
    hardBlockTriggered,
    weightsSource,
  };
}
