/**
 * adaptive-exit-engine.ts — Wave 25 Pass 7 (W25.12 / W25.13 / W25.14 / W25.15 / W25.16)
 *
 * Institutional adaptive exit engine. Replaces static Style C 33/33/34 R-multiple
 * TP targets with liquidity-mapped + regime-aware + order-flow-sensitive adaptive exits.
 *
 * Sub-tracks (all in this one service file, executed sequentially at signal time):
 *   W25.12 — Liquidity-Mapped TP Engine
 *             TP1 = nearest intraday liquidity (min R ≥ 0.8); fallback +1R
 *             TP2 = next liquidity level OR +2R (whichever closer)
 *             Day-trader mandate: NO PWH/PWL/PMH/PML in TP candidate set
 *   W25.13 — Regime-Dependent Scaling Schedule
 *             TRENDING 20/30/50 | RANGE 50/30/20 | HIGH_VOL_MACRO 60/30/10 | LOW_LIQ_CHOP 50/50/0
 *   W25.14 — Delta-Divergence Early-Exit (position open, price in favor, delta diverges)
 *             25% extra partial close; never flips position
 *   W25.15 — Anchored VWAP Runner Trail (regime-selected trail method)
 *             TRENDING → anchored_vwap | RANGE → developing_poc | HIGH_VOL_MACRO → chandelier
 *   W25.16 — Pre-Lunch Soft Exit (RANGE/LOW_LIQ_CHOP/COMPRESSION at 11:30 ET with profit ≥ 0.3R)
 *
 * HARD INVARIANTS (must NEVER be overridden):
 *   - 15:55 ET hard flatten (CLAUDE.md §4) — adaptive engine may flatten EARLIER, NEVER later
 *   - BE+1 tick on TP1 fill — preserved
 *   - 67% personal DLL halt — preserved (not this engine's concern; enforced upstream)
 *   - Per-symbol liquidity caps (MES 100 / MNQ 50 / MCL 30) — preserved upstream
 *   - No PWH/PWL/PMH/PML in TP candidate set — day-trader mandate (CLAUDE.md §2b / feedback)
 *
 * Consumed services (all from previous passes — no reimplementations):
 *   W25.6  liquidity-map-service.ts::getNearestLiquidity()
 *   W25.7  confluence-decay.ts::WeightedScoreResult.decayedFactors[]
 *   W25.11 narrative-state-service.ts::NarrativePhase
 *   W25.10 bias_engine.classify_institutional_regime() → marketState.regime
 *
 * Parity note:
 *   When exit_style="static_styleC" (default for pre-Wave-25 strategies), this engine
 *   is NOT called.  framework-overlay.ts routes to the legacy 33/33/34 + POC trail path.
 *   That path is UNCHANGED by this PR.
 *
 * Logger: imported from ../lib/logger.js leaf module (feedback_helper_logger_import).
 * Audit:  insertAuditRow from ../lib/audit-log-helper.js (§10b mandate).
 */

import { logger } from "../lib/logger.js";
import { insertAuditRow } from "../lib/audit-log-helper.js";
import { getNearestLiquidity, type RankedLevel, type LevelType } from "./liquidity-map-service.js";
import type { WeightedScoreResult } from "./confluence-score.js";
import type { ExitPlanConfig, RunnerTrailMethod, ExitStyle } from "../db/jsonb-shapes.js";

// ─── Re-export types from jsonb-shapes so callers can import from this module ──
export type { ExitStyle, RunnerTrailMethod } from "../db/jsonb-shapes.js";

// ─── Day-trader-only liquidity filter ────────────────────────────────────────
// CLAUDE.md §2b day-trader mandate: TP targets INTRADAY only.
// PWH/PWL/PMH/PML → multi-day chase blows EOD-DD buffer.
// This set is the ALLOWED list — only these level_types may appear in TP candidates.
const INTRADAY_ALLOWED_LEVEL_TYPES = new Set<LevelType>([
  "pdh", "pdl",           // prior-day high/low (daily level, intraday reference)
  "asian_high", "asian_low",
  "london_high", "london_low",
  "hod", "lod",           // developing session HOD/LOD
  "naked_poc",            // naked POC (last 5 sessions — intraday context)
  "untouched_fvg",        // intraday FVG
  "untouched_ob",         // intraday OB
  "eqh", "eql",           // equal highs/lows (stop cluster)
]);

// Explicitly EXCLUDED (must not appear in TP candidates):
// "pwh_iso", "pwl_iso", "pmh", "pml" — multi-day DOL, violates day-trader mandate.

// ─── Regime scaling defaults ──────────────────────────────────────────────────
// Maps regime string → [tp1_pct, tp2_pct, runner_pct] (must sum to 1.00).
// Per-strategy overrides via exit_plan_config.scaling_overrides.

type ScalingTuple = [number, number, number];

const REGIME_SCALING_DEFAULTS: Record<string, ScalingTuple> = {
  TRENDING_UP:    [0.20, 0.30, 0.50],
  TRENDING_DOWN:  [0.20, 0.30, 0.50],
  EXPANSION:      [0.20, 0.30, 0.50],
  RANGE_BOUND:    [0.50, 0.30, 0.20],
  COMPRESSION:    [0.50, 0.30, 0.20],
  HIGH_VOL_MACRO: [0.60, 0.30, 0.10],
  LOW_LIQ_CHOP:   [0.50, 0.50, 0.00],
  // Fallback for unknown regimes — conservative harvest
  UNKNOWN:        [0.50, 0.30, 0.20],
};

// ─── Runner trail defaults ────────────────────────────────────────────────────
// Maps regime → trail method.  Per-strategy overrides via exit_plan_config.runner_trail_overrides.

const REGIME_RUNNER_TRAIL_DEFAULTS: Record<string, RunnerTrailMethod> = {
  TRENDING_UP:    "anchored_vwap",
  TRENDING_DOWN:  "anchored_vwap",
  EXPANSION:      "anchored_vwap",
  RANGE_BOUND:    "developing_poc",
  COMPRESSION:    "structure_trail",
  HIGH_VOL_MACRO: "chandelier",
  LOW_LIQ_CHOP:   "developing_poc",  // no runner in LOW_LIQ_CHOP but method still declared
};

// ─── Pre-lunch regime set ─────────────────────────────────────────────────────
// W25.16: pre-lunch partial only fires on rotational/slow regimes.
const PRE_LUNCH_TRIGGER_REGIMES = new Set<string>([
  "RANGE_BOUND",
  "LOW_LIQ_CHOP",
  "COMPRESSION",
]);

// ─── Delta-divergence threshold ──────────────────────────────────────────────
// Env var EXIT_DELTA_DIVERGENCE_THRESHOLD overrides; [0,1] scale.
const DEFAULT_DELTA_DIVERGENCE_THRESHOLD = 0.6;
function getDeltaDivThreshold(): number {
  const raw = process.env["EXIT_DELTA_DIVERGENCE_THRESHOLD"];
  if (raw == null) return DEFAULT_DELTA_DIVERGENCE_THRESHOLD;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed < 0 || parsed > 1) {
    logger.warn({ raw }, "EXIT_DELTA_DIVERGENCE_THRESHOLD invalid — using default 0.6");
    return DEFAULT_DELTA_DIVERGENCE_THRESHOLD;
  }
  return parsed;
}

// ─── R-multiple helper ────────────────────────────────────────────────────────
function computeRMultiple(
  entryPrice: number,
  targetPrice: number,
  direction: "long" | "short",
  stopPrice: number,
): number {
  const stopDistance = Math.abs(entryPrice - stopPrice);
  if (stopDistance <= 0) return 0;
  if (direction === "long") {
    return (targetPrice - entryPrice) / stopDistance;
  }
  return (entryPrice - targetPrice) / stopDistance;
}

// ─── Pre-lunch ET time check ──────────────────────────────────────────────────
// Returns true if the bar's timestamp (UTC) is at or after 11:30 ET (16:30 UTC).
// Handles EDT (UTC-4) and EST (UTC-5) via Intl.DateTimeFormat.
function isAtOrAfterPreLunchET(tsEvent: Date): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(tsEvent);
  const hourPart = parts.find((p) => p.type === "hour");
  const minutePart = parts.find((p) => p.type === "minute");
  if (!hourPart || !minutePart) return false;
  const h = parseInt(hourPart.value, 10);
  const m = parseInt(minutePart.value, 10);
  return h > 11 || (h === 11 && m >= 30);
}

// ─── Exported interfaces ──────────────────────────────────────────────────────

export interface ExitTarget {
  /** Where this price came from. */
  source: "liquidity" | "r_multiple" | "vwap_band_2s";
  price: number;
  /** Populated when source="liquidity" */
  level_type?: LevelType;
  /** HTF significance 1-5 (populated when source="liquidity") */
  htf_significance?: number;
  /** Implied R given entry + stop */
  r_multiple: number;
}

export interface ScalingSchedule {
  tp1_pct: number;
  tp2_pct: number;
  /** tp1_pct + tp2_pct + runner_pct === 1.00 */
  runner_pct: number;
  /** Audit: which regime key sourced the schedule */
  regime_source: string;
  /** "strategy_override" | "regime_default" */
  schedule_source: "strategy_override" | "regime_default";
}

export interface ExitPlan {
  tp1: ExitTarget;
  tp2: ExitTarget;
  runner: {
    trail_method: RunnerTrailMethod;
    /** Entry timestamp (for anchored_vwap anchor); entry stop price (for chandelier); swing price (for structure_trail) */
    trail_anchor_value: number;
    /** Audit: which regime key sourced the trail method */
    regime_source: string;
    /** "strategy_override" | "regime_default" */
    method_source: "strategy_override" | "regime_default";
  };
  scaling: ScalingSchedule;
  /**
   * W25.14: Cumulative-delta divergence score threshold.
   * When current position's delta_divergence exceeds this, 25% extra partial close fires.
   */
  early_exit_threshold_delta_div: number;
  /** Fraction of position to close on delta-divergence signal (default 0.25) */
  early_exit_partial_pct: number;
  /**
   * W25.16: Minimum profit R required for pre-lunch partial to fire.
   * Default 0.3. Applied only on rotational regimes at >= 11:30 ET.
   */
  pre_lunch_threshold_r: number;
  /** Fraction of position to close on pre-lunch soft exit (always 0.50) */
  pre_lunch_partial_pct: number;
  /** Full audit payload for signal.exit_plan_computed event */
  audit_payload: Record<string, unknown>;
}

// ─── computeExitPlan input ────────────────────────────────────────────────────

export interface ExitPlanInput {
  strategy: {
    id: string;
    exit_plan_config: ExitPlanConfig | null | undefined;
  };
  entry: {
    price: number;
    stop: number;
    direction: "long" | "short";
    timestamp: Date;
  };
  symbol: string;
  bar: {
    close: number;
    high: number;
    low: number;
    volume: number;
    ts_event: Date;
  };
  marketState: {
    /** Institutional regime string e.g. "TRENDING_UP", "RANGE_BOUND", "HIGH_VOL_MACRO" etc. */
    regime: string;
    narrativePhase: string | null;
    atr: number;
  };
  /** Optional: Pass 4 decay result; used to tighten exits on aged confluence. */
  weightedScore?: WeightedScoreResult;
  correlationId?: string;
}

// ─── W25.12 — Liquidity-Mapped TP Engine ────────────────────────────────────

/**
 * Pick TP1 from the nearest INTRADAY liquidity level with implied R >= minR.
 * Falls back to +1R / +2R when no qualifying level exists.
 *
 * Day-trader mandate enforced here: only INTRADAY_ALLOWED_LEVEL_TYPES pass the filter.
 * PWH/PWL/PMH/PML are explicitly rejected.
 */
async function buildLiquidityTargets(
  symbol: string,
  entry: ExitPlanInput["entry"],
  atr: number,
): Promise<{ tp1: ExitTarget; tp2: ExitTarget }> {
  const stopDistance = Math.abs(entry.price - entry.stop);
  const direction: "above" | "below" = entry.direction === "long" ? "above" : "below";

  // Max search distance = 1×ATR (don't reach for far-away levels)
  const maxDistance = atr;

  let candidates: RankedLevel[] = [];
  try {
    candidates = await getNearestLiquidity(symbol, entry.price, direction, maxDistance);
  } catch (err) {
    logger.warn({ err, symbol }, "adaptive-exit-engine: getNearestLiquidity failed — using R-multiple fallback");
  }

  // Day-trader mandate filter: reject multi-day DOL level types
  const intradayCandidates = candidates.filter((c) => INTRADAY_ALLOWED_LEVEL_TYPES.has(c.level_type));

  // TP1 — nearest with min R >= 0.8
  const tp1Candidate = intradayCandidates.find((c) => {
    const r = computeRMultiple(entry.price, c.price, entry.direction, entry.stop);
    return r >= 0.8;
  });

  let tp1: ExitTarget;
  if (tp1Candidate) {
    tp1 = {
      source: "liquidity",
      price: tp1Candidate.price,
      level_type: tp1Candidate.level_type,
      htf_significance: tp1Candidate.htf_significance,
      r_multiple: computeRMultiple(entry.price, tp1Candidate.price, entry.direction, entry.stop),
    };
  } else {
    // Fallback to +1R
    const tp1Price = entry.direction === "long"
      ? entry.price + 1.0 * stopDistance
      : entry.price - 1.0 * stopDistance;
    tp1 = {
      source: "r_multiple",
      price: tp1Price,
      r_multiple: 1.0,
    };
  }

  // TP2 — next intraday level after TP1, or +2R fallback (whichever closer)
  const tp2FallbackR = 2.0;
  const tp2FallbackPrice = entry.direction === "long"
    ? entry.price + tp2FallbackR * stopDistance
    : entry.price - tp2FallbackR * stopDistance;

  const tp2Candidate = intradayCandidates.find((c) => {
    if (c === tp1Candidate) return false;
    const r = computeRMultiple(entry.price, c.price, entry.direction, entry.stop);
    return r >= tp1.r_multiple + 0.5; // at least 0.5R beyond TP1
  });

  let tp2: ExitTarget;
  if (tp2Candidate) {
    const tp2CandidateR = computeRMultiple(entry.price, tp2Candidate.price, entry.direction, entry.stop);
    // Use whichever is closer to entry
    if (tp2CandidateR <= tp2FallbackR) {
      tp2 = {
        source: "liquidity",
        price: tp2Candidate.price,
        level_type: tp2Candidate.level_type,
        htf_significance: tp2Candidate.htf_significance,
        r_multiple: tp2CandidateR,
      };
    } else {
      tp2 = {
        source: "r_multiple",
        price: tp2FallbackPrice,
        r_multiple: tp2FallbackR,
      };
    }
  } else {
    tp2 = {
      source: "r_multiple",
      price: tp2FallbackPrice,
      r_multiple: tp2FallbackR,
    };
  }

  return { tp1, tp2 };
}

// ─── W25.13 — Regime-Dependent Scaling Schedule ──────────────────────────────

function buildScalingSchedule(
  regime: string,
  config: ExitPlanConfig | null | undefined,
): ScalingSchedule {
  const overrides = config?.scaling_overrides;
  const overrideTuple = overrides?.[regime];

  if (overrideTuple) {
    const [tp1_pct, tp2_pct, runner_pct] = overrideTuple;
    return {
      tp1_pct,
      tp2_pct,
      runner_pct,
      regime_source: regime,
      schedule_source: "strategy_override",
    };
  }

  const defaults = REGIME_SCALING_DEFAULTS[regime] ?? REGIME_SCALING_DEFAULTS["UNKNOWN"];
  const [tp1_pct, tp2_pct, runner_pct] = defaults;
  return {
    tp1_pct,
    tp2_pct,
    runner_pct,
    regime_source: regime,
    schedule_source: "regime_default",
  };
}

// ─── W25.15 — Runner Trail Method Selection ──────────────────────────────────

function resolveRunnerTrailMethod(
  regime: string,
  config: ExitPlanConfig | null | undefined,
): { method: RunnerTrailMethod; source: "strategy_override" | "regime_default" } {
  const overrides = config?.runner_trail_overrides;
  const override = overrides?.[regime] as RunnerTrailMethod | undefined;

  if (override) {
    return { method: override, source: "strategy_override" };
  }

  const method: RunnerTrailMethod =
    (REGIME_RUNNER_TRAIL_DEFAULTS[regime] as RunnerTrailMethod | undefined) ?? "developing_poc";
  return { method, source: "regime_default" };
}

// ─── W25.16 — Pre-Lunch soft exit guard (pure — returns bool, no side effects) ─

export interface PreLunchDecision {
  /** True if pre-lunch partial should fire for this bar/position */
  shouldFire: boolean;
  /** Regime that triggered the decision */
  regime: string;
  /** ET time string for audit */
  time_et: string;
  /** Current position profit in R-multiples */
  profit_r: number;
  /** Fraction to close (0.50 when shouldFire=true, 0 otherwise) */
  partial_pct: number;
  /** New stop level after tightening (BE + 0.5R above/below entry) */
  tightened_stop: number;
}

export function computePreLunchDecision(params: {
  regime: string;
  bar: ExitPlanInput["bar"];
  entry: ExitPlanInput["entry"];
  currentPnlR: number;
  thresholdR: number;
}): PreLunchDecision {
  const { regime, bar, entry, currentPnlR, thresholdR } = params;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const timeEt = formatter.format(bar.ts_event);

  const stopDistance = Math.abs(entry.price - entry.stop);
  // BE + 0.5R stop
  const tightenedStop = entry.direction === "long"
    ? entry.price + 0.5 * stopDistance
    : entry.price - 0.5 * stopDistance;

  const shouldFire =
    PRE_LUNCH_TRIGGER_REGIMES.has(regime) &&
    isAtOrAfterPreLunchET(bar.ts_event) &&
    currentPnlR >= thresholdR;

  return {
    shouldFire,
    regime,
    time_et: timeEt,
    profit_r: currentPnlR,
    partial_pct: shouldFire ? 0.50 : 0,
    tightened_stop: tightenedStop,
  };
}

// ─── W25.14 — Delta-Divergence early-exit guard (pure) ───────────────────────

export interface DeltaDivDecision {
  /** True if 25% extra partial should fire */
  shouldFire: boolean;
  /** Cumulative delta divergence score [0,1] */
  delta_score: number;
  /** Threshold that was applied */
  threshold: number;
  /** Always 0.25 when shouldFire (or config override) — never flips position */
  partial_pct: number;
}

export function computeDeltaDivDecision(params: {
  /** True when position is currently profitable */
  positionInFavor: boolean;
  /** Current profit in R-multiples */
  currentPnlR: number;
  /** Cumulative delta divergence score [0,1] from SMT/order-flow module */
  deltaDivergenceScore: number;
  /** True when position HAS already hit TP1 (only lock-in BEFORE TP1) */
  tp1AlreadyHit: boolean;
  config: ExitPlanConfig | null | undefined;
}): DeltaDivDecision {
  const threshold = getDeltaDivThreshold();
  const partialPct = params.config?.delta_div_partial_pct ?? 0.25;

  const shouldFire =
    params.positionInFavor &&
    params.currentPnlR >= 0.5 &&
    !params.tp1AlreadyHit &&
    params.deltaDivergenceScore > threshold;

  return {
    shouldFire,
    delta_score: params.deltaDivergenceScore,
    threshold,
    partial_pct: shouldFire ? partialPct : 0,
  };
}

// ─── Main: computeExitPlan ────────────────────────────────────────────────────

/**
 * Compute a full institutional exit plan for a new position.
 *
 * Consumes: liquidity-map-service (TP levels), regime (scaling + trail),
 * narrative phase (audit only), and optionally weighted-score decay factors.
 *
 * Returns: ExitPlan with tp1/tp2 targets, runner trail method, scaling schedule,
 * delta-div threshold, pre-lunch threshold, and full audit payload.
 *
 * Fallback contract (fail-OPEN for TP, fail-CLOSED for nothing):
 *   - If liquidity-map fails → R-multiple fallback (positions still get targets)
 *   - If regime unknown → UNKNOWN scaling defaults (conservative harvest)
 *   - This function NEVER throws; all errors are caught and logged
 *
 * Parity note:
 *   This function is only called when exit_style="adaptive".
 *   framework-overlay.ts gates the call; pre-Wave-25 strategies never reach here.
 */
export async function computeExitPlan(opts: ExitPlanInput): Promise<ExitPlan> {
  const { strategy, entry, symbol, bar, marketState, weightedScore, correlationId } = opts;
  const config = strategy.exit_plan_config ?? null;
  const regime = marketState.regime ?? "UNKNOWN";

  // ─ W25.12: Liquidity-mapped TP targets ─
  const { tp1, tp2 } = await buildLiquidityTargets(symbol, entry, marketState.atr);

  // ─ W25.13: Regime scaling schedule ─
  const scaling = buildScalingSchedule(regime, config);

  // ─ W25.15: Runner trail method ─
  const { method: trailMethod, source: methodSource } = resolveRunnerTrailMethod(regime, config);

  // Runner trail anchor value:
  //   anchored_vwap   → use entry bar timestamp as numeric millis (anchor for AVWAP computation downstream)
  //   chandelier      → use entry ATR stop as the Chandelier seed
  //   structure_trail → use entry stop price as the structural reference
  //   developing_poc  → 0 (POC computed externally, not parameterized here)
  //
  // Wave 26 Pass L (2026-05-27) Tweak 1 — Chandelier multiplier is regime-aware:
  //   TRENDING_UP / TRENDING_DOWN / EXPANSION → 2.5× (StratBase 2026-02:
  //     PF 1.56 at 2.5× vs 1.44 at 2.0× — 8% profit factor improvement on
  //     trending regimes per institutional 2026 evidence).
  //   Other regimes (HIGH_VOL_MACRO, RANGE_BOUND, etc.) → 2.0× (intraday default).
  //   Operator override: STOP_CHANDELIER_MULTIPLIER_TRENDING env var.
  const CHANDELIER_MULTIPLIER_TRENDING = Number(
    process.env.STOP_CHANDELIER_MULTIPLIER_TRENDING ?? 2.5,
  );
  const CHANDELIER_MULTIPLIER_DEFAULT = 2.0;
  const isTrendingRegime =
    regime === "TRENDING_UP" || regime === "TRENDING_DOWN" || regime === "EXPANSION";
  const chandelierMultiplier = Number.isFinite(CHANDELIER_MULTIPLIER_TRENDING) && isTrendingRegime
    ? CHANDELIER_MULTIPLIER_TRENDING
    : CHANDELIER_MULTIPLIER_DEFAULT;

  const trailAnchorValue =
    trailMethod === "anchored_vwap"
      ? entry.timestamp.getTime()
      : trailMethod === "chandelier"
        ? marketState.atr * chandelierMultiplier
        : entry.stop;             // structure_trail + developing_poc

  // ─ Pre-lunch and delta-div config params ─
  const preLunchThresholdR = config?.pre_lunch_threshold_r ?? 0.3;
  const deltaThreshold = getDeltaDivThreshold();
  const deltaDivPartialPct = config?.delta_div_partial_pct ?? 0.25;

  // ─ Decay factor audit (Pass 4 integration) ─
  const decayedFactorCount = weightedScore?.decayedFactors?.length ?? 0;

  // ─ Audit payload ─
  const auditPayload: Record<string, unknown> = {
    strategy_id: strategy.id,
    symbol,
    regime,
    narrative_phase: marketState.narrativePhase,
    tp1_source: tp1.source,
    tp1_level_type: tp1.level_type ?? null,
    tp1_r_multiple: tp1.r_multiple,
    tp1_price: tp1.price,
    tp2_source: tp2.source,
    tp2_level_type: tp2.level_type ?? null,
    tp2_r_multiple: tp2.r_multiple,
    tp2_price: tp2.price,
    runner_method: trailMethod,
    runner_method_source: methodSource,
    scaling_tp1_pct: scaling.tp1_pct,
    scaling_tp2_pct: scaling.tp2_pct,
    scaling_runner_pct: scaling.runner_pct,
    scaling_source: scaling.schedule_source,
    pre_lunch_threshold_r: preLunchThresholdR,
    delta_div_threshold: deltaThreshold,
    delta_div_partial_pct: deltaDivPartialPct,
    decayed_factor_count: decayedFactorCount,
    atr: marketState.atr,
    entry_price: entry.price,
    entry_stop: entry.stop,
    entry_direction: entry.direction,
  };

  // ─ Audit: signal.exit_plan_computed ─
  insertAuditRow({
    action: "signal.exit_plan_computed",
    entityId: strategy.id,
    entityType: "strategy",
    result: {
      tp1_source: tp1.source,
      tp1_level_type: tp1.level_type ?? null,
      tp2_source: tp2.source,
      runner_method: trailMethod,
      scaling: {
        tp1_pct: scaling.tp1_pct,
        tp2_pct: scaling.tp2_pct,
        runner_pct: scaling.runner_pct,
      },
    },
    correlationId: correlationId ?? null,
    status: "success",
  }).catch((err) => logger.warn({ err }, "adaptive-exit-engine: audit signal.exit_plan_computed failed (non-blocking)"));

  // ─ Audit: signal.scaling_schedule_selected ─
  insertAuditRow({
    action: "signal.scaling_schedule_selected",
    entityId: strategy.id,
    entityType: "strategy",
    result: {
      regime,
      tp1_pct: scaling.tp1_pct,
      tp2_pct: scaling.tp2_pct,
      runner_pct: scaling.runner_pct,
      source: scaling.schedule_source,
    },
    correlationId: correlationId ?? null,
    status: "success",
  }).catch((err) => logger.warn({ err }, "adaptive-exit-engine: audit signal.scaling_schedule_selected failed (non-blocking)"));

  // ─ Audit: signal.runner_trail_method_selected ─
  insertAuditRow({
    action: "signal.runner_trail_method_selected",
    entityId: strategy.id,
    entityType: "strategy",
    result: {
      regime,
      method: trailMethod,
      source: methodSource,
    },
    correlationId: correlationId ?? null,
    status: "success",
  }).catch((err) => logger.warn({ err }, "adaptive-exit-engine: audit signal.runner_trail_method_selected failed (non-blocking)"));

  return {
    tp1,
    tp2,
    runner: {
      trail_method: trailMethod,
      trail_anchor_value: trailAnchorValue,
      regime_source: regime,
      method_source: methodSource,
    },
    scaling,
    early_exit_threshold_delta_div: deltaThreshold,
    early_exit_partial_pct: deltaDivPartialPct,
    pre_lunch_threshold_r: preLunchThresholdR,
    pre_lunch_partial_pct: 0.50,  // always 50% when pre-lunch fires (per W25.16 spec)
    audit_payload: auditPayload,
  };
}

// ─── Audit emission helpers for position-monitoring events ───────────────────
// Called by paper-execution-service (or caller) when early-exit events fire.

/**
 * Emit audit row for signal.early_partial_exit_triggered (W25.14 delta divergence).
 * Call this AFTER closing the partial — audit confirms what was done, not what's planned.
 */
export async function auditDeltaDivEarlyExit(params: {
  strategyId: string;
  deltaDivDecision: DeltaDivDecision;
  correlationId?: string;
}): Promise<void> {
  await insertAuditRow({
    action: "signal.early_partial_exit_triggered",
    entityId: params.strategyId,
    entityType: "strategy",
    result: {
      reason: "delta_divergence",
      delta_score: params.deltaDivDecision.delta_score,
      threshold: params.deltaDivDecision.threshold,
      partial_pct: params.deltaDivDecision.partial_pct,
    },
    correlationId: params.correlationId ?? null,
    status: "success",
  });
}

/**
 * Emit audit row for signal.pre_lunch_partial_exit (W25.16).
 * Call this AFTER closing the pre-lunch partial.
 */
export async function auditPreLunchExit(params: {
  strategyId: string;
  decision: PreLunchDecision;
  correlationId?: string;
}): Promise<void> {
  await insertAuditRow({
    action: "signal.pre_lunch_partial_exit",
    entityId: params.strategyId,
    entityType: "strategy",
    result: {
      regime: params.decision.regime,
      time_et: params.decision.time_et,
      profit_r: params.decision.profit_r,
      partial_pct: params.decision.partial_pct,
    },
    correlationId: params.correlationId ?? null,
    status: "success",
  });
}
