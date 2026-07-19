/**
 * confluence-decay.ts — Wave 25 Pass 4, W25.7
 *
 * Pure, stateless decay functions for confluence factor staleness.
 *
 * DESIGN PRINCIPLES:
 *   - All functions are PURE — no I/O, no Date.now(), no side effects.
 *     Callers compute age and pass it in. This makes all functions replay-
 *     deterministic and trivially unit-testable.
 *   - No migration required — decay is computed, never persisted.
 *   - Backward-compat contract: when ageBars/ageHours is undefined (caller
 *     cannot determine age), all functions return confidence=1.0 (no penalty).
 *     This preserves pre-Pass-4 behavior exactly.
 *
 * ANTI-DOUBLE-DECAY RULE (critical constraint from Pass 3 architect):
 *   The following factors ALREADY have built-in time/touch decay and MUST
 *   NOT receive a second decay layer from this module:
 *     - liquidity_target_clear: decayed in liquidity-map-service.ts via
 *       touched_count (-0.2/touch) + age_decay (1 - age_hours/168) +
 *       distance_factor (exp(-dist/(max/2))). getNearestLiquidity() already
 *       returns sweep_probability that reflects all three.
 *     - internals_aligned: market-internals-service.ts gates on 5-min staleness;
 *       a stale snapshot returns satisfied=false. Double-decay would penalize twice.
 *     - macro_alignment: hard-block binary gate (FOMC/CPI/NFP blackout).
 *       No concept of decay — it's blocked or it isn't.
 *     - regime_match: binary state derived from the bias engine at signal time.
 *     - killzone_active: binary time window check — no decay concept.
 *
 * FACTORS THAT RECEIVE DECAY (6 of 11):
 *   1. market_structure_aligned — CHoCH/MSS/BOS age (trading days) from
 *      structureState.choch_age_bars / mss_age_bars / bos_age_bars
 *      (recency-first selection), falling back to last_break_age_bars when
 *      no per-type age is available
 *   2. smt_confirmation — SMT divergence resolves quickly (~60 bars half-life)
 *   3. vp_level_proximity — VP levels go stale across sessions
 *   4. vwap_alignment — anchored VWAP staleness (ageBars = bars since anchor bar)
 *   5. delta_or_volume_signature — volume signature decays per bar
 *   6. cross_asset_aligned — DXY/10Y directions shift intraday; decay by hours
 *
 * FACTORS THAT SKIP DECAY (5 of 11):
 *   1. liquidity_target_clear (already decayed in liquidity-map-service)
 *   2. internals_aligned (already stale-gated in market-internals-service)
 *   3. macro_alignment (hard-block binary)
 *   4. regime_match (binary state)
 *   5. killzone_active (binary time window)
 *
 * Logger import: leaf module logger.js (feedback_helper_logger_import.md).
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DecayInput {
  /** Bars since the signal/structure formed. Primary input for most types. */
  ageBars?: number;
  /** Hours since formed. Alternative to ageBars (used for cross_asset_aligned). */
  ageHours?: number;
  /**
   * Trading days since the signal/structure formed. Alternative to ageBars —
   * used by chochDecay/mssDecay when the caller's age is day-denominated
   * (structureState.*_age_bars is computed against daily exec_bars, not
   * 5-minute bars — see confluence-decay-bar-unit-mismatch-2026-07-17 ratify
   * packet). Takes priority over ageBars when both are present.
   */
  ageTradingDays?: number;
  /** How many times the level/signal was visited by price. */
  touchedCount?: number;
  /** Hard-kill flag: a mitigated OB/FVG is fully expired regardless of age. */
  mitigated?: boolean;
}

export interface DecayResult {
  /** Confidence multiplier in [0, 1]. Multiplies the factor's weight contribution. */
  confidence: number;
  /** Human-readable description for the audit trail. */
  reason: string;
  /** True when mitigated=true — callers MUST force satisfied=false. */
  hard_killed: boolean;
}

// ─── Named half-life constants ─────────────────────────────────────────────────
// All in bars (5-minute bars unless otherwise noted).

/** FVG: 200-bar half-life (~16.7h on 5m bars). -0.25 per touch. */
const FVG_AGE_HALF_LIFE_BARS = 200;
const FVG_AGE_MAX_PENALTY = 0.5;   // floor at 50% age penalty
const FVG_TOUCH_PENALTY = 0.25;

/** OB (Order Block): 150-bar half-life (~12.5h on 5m bars). -0.3 per touch. */
const OB_AGE_HALF_LIFE_BARS = 150;
const OB_AGE_MAX_PENALTY = 0.6;
const OB_TOUCH_PENALTY = 0.3;

/**
 * CHoCH: 100-bar half-life. No touch concept.
 * Applies ONLY to a genuine bar-granularity caller (input.ageBars, 5-minute
 * bars) — as of 2026-07-17 no production caller supplies that shape;
 * deriveFactorDecay() (the only production caller of chochDecay/mssDecay)
 * always supplies ageTradingDays, since structureState.*_age_bars is
 * computed against daily exec_bars (bias-state-service.ts), not 5-minute
 * bars. The bar-scale path below is preserved for any future genuine
 * 5-minute-bar caller and is unit-tested for backward compat.
 */
const CHOCH_AGE_HALF_LIFE_BARS = 100;
const CHOCH_AGE_MAX_PENALTY = 0.7;

/**
 * MSS: 80-bar half-life. More aggressive — institutional pros invalidate MSS
 * quickly. Same bar-vs-trading-day caveat as CHOCH_AGE_HALF_LIFE_BARS above.
 */
const MSS_AGE_HALF_LIFE_BARS = 80;
const MSS_AGE_MAX_PENALTY = 0.7;

/**
 * CHoCH day-scale half-life — 10 trading days (two trading weeks).
 * PROPOSED / needs-post-ship-validation: structureState is None in every
 * backtest (backtester.py never passes exec_bars into compute_bias()), so
 * this factor has zero historical data to tune against. This is a defensible
 * starting point, not a backtested optimum — validate via
 * signal.confluence_factor_decayed audit-row satisfied-rate over the first
 * 30+ days live (same discipline CLAUDE.md §2b already applies to the
 * 11-factor weights). Confidence reaches the 0.3 floor at 7 trading days
 * (~1.5 weeks) — see confluence-decay-bar-unit-mismatch-2026-07-17 packet §3a.
 */
const CHOCH_AGE_HALF_LIFE_TRADING_DAYS = 10;

/**
 * MSS day-scale half-life — 6 trading days (just over one trading week).
 * Kept more aggressive than CHoCH, matching the existing 80/100-bar ratio's
 * intent. PROPOSED / needs-post-ship-validation — same caveat as
 * CHOCH_AGE_HALF_LIFE_TRADING_DAYS above. Confidence reaches the 0.3 floor
 * at ~4-5 trading days (~1 week).
 */
const MSS_AGE_HALF_LIFE_TRADING_DAYS = 6;

/** SMT divergence: 60-bar half-life (~5h). Resolves quickly. */
const SMT_AGE_HALF_LIFE_BARS = 60;
const SMT_AGE_MAX_PENALTY = 0.8;

/** VP level: 5-session half-life. -0.2 per touch. */
const VP_SESSION_HALF_LIFE = 5;
const VP_SESSION_MAX_PENALTY = 0.7;
const VP_TOUCH_PENALTY = 0.2;

/** Generic fallback: 200-bar half-life ("weak decay"). */
const GENERIC_AGE_HALF_LIFE_BARS = 200;
const GENERIC_AGE_MAX_PENALTY = 0.5;

// ─── Decay telemetry threshold env var ────────────────────────────────────────
// When decay.confidence drops below this value and the factor was satisfied,
// Stage 2 should fire signal.confluence_factor_decayed audit row.
export const DECAY_TELEMETRY_THRESHOLD_DEFAULT = 0.7;

function getDecayTelemetryThreshold(): number {
  const raw = process.env.DECAY_TELEMETRY_THRESHOLD;
  if (raw !== undefined) {
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  }
  return DECAY_TELEMETRY_THRESHOLD_DEFAULT;
}

export { getDecayTelemetryThreshold };

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Clamp value to [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * If both ageBars and ageHours are undefined, return a "no-age-available"
 * sentinel that callers interpret as confidence=1.0 (no penalty).
 */
function hasAgeInfo(input: DecayInput): boolean {
  return (
    (input.ageBars !== undefined && Number.isFinite(input.ageBars)) ||
    (input.ageHours !== undefined && Number.isFinite(input.ageHours))
  );
}

// ─── Per-type pure decay functions ────────────────────────────────────────────

/**
 * FVG (Fair Value Gap) decay.
 *
 * confidence = max(0, 1 - FVG_TOUCH_PENALTY × touchedCount
 *                      - min(FVG_AGE_MAX_PENALTY, ageBars / FVG_AGE_HALF_LIFE_BARS))
 *              × (mitigated ? 0 : 1)
 *
 * Backward-compat: if ageBars is unavailable → age penalty = 0.
 */
export function fvgDecay(input: DecayInput): DecayResult {
  if (input.mitigated) {
    return {
      confidence: 0,
      reason: "fvg_mitigated_hard_kill",
      hard_killed: true,
    };
  }

  const touched = input.touchedCount ?? 0;
  const touchPenalty = FVG_TOUCH_PENALTY * touched;

  let agePenalty = 0;
  let ageStr = "age=unknown";
  if (input.ageBars !== undefined && Number.isFinite(input.ageBars)) {
    agePenalty = Math.min(FVG_AGE_MAX_PENALTY, input.ageBars / FVG_AGE_HALF_LIFE_BARS);
    ageStr = `age_bars=${input.ageBars}`;
  }

  const confidence = clamp(1 - touchPenalty - agePenalty, 0, 1);
  return {
    confidence,
    reason: `fvg: ${ageStr}, touched=${touched}, touch_penalty=${touchPenalty.toFixed(2)}, age_penalty=${agePenalty.toFixed(2)}, confidence=${confidence.toFixed(3)}`,
    hard_killed: false,
  };
}

/**
 * OB (Order Block) decay.
 *
 * confidence = max(0, 1 - OB_TOUCH_PENALTY × touchedCount
 *                      - min(OB_AGE_MAX_PENALTY, ageBars / OB_AGE_HALF_LIFE_BARS))
 *              × (mitigated ? 0 : 1)
 */
export function obDecay(input: DecayInput): DecayResult {
  if (input.mitigated) {
    return {
      confidence: 0,
      reason: "ob_mitigated_hard_kill",
      hard_killed: true,
    };
  }

  const touched = input.touchedCount ?? 0;
  const touchPenalty = OB_TOUCH_PENALTY * touched;

  let agePenalty = 0;
  let ageStr = "age=unknown";
  if (input.ageBars !== undefined && Number.isFinite(input.ageBars)) {
    agePenalty = Math.min(OB_AGE_MAX_PENALTY, input.ageBars / OB_AGE_HALF_LIFE_BARS);
    ageStr = `age_bars=${input.ageBars}`;
  }

  const confidence = clamp(1 - touchPenalty - agePenalty, 0, 1);
  return {
    confidence,
    reason: `ob: ${ageStr}, touched=${touched}, touch_penalty=${touchPenalty.toFixed(2)}, age_penalty=${agePenalty.toFixed(2)}, confidence=${confidence.toFixed(3)}`,
    hard_killed: false,
  };
}

/**
 * CHoCH (Change of Character) decay.
 *
 * Trading-day-scale (preferred, matches every production caller today):
 *   confidence = max(0, 1 - min(CHOCH_AGE_MAX_PENALTY, ageTradingDays / CHOCH_AGE_HALF_LIFE_TRADING_DAYS))
 * Bar-scale fallback (input.ageTradingDays absent, genuine 5m-bar caller):
 *   confidence = max(0, 1 - min(CHOCH_AGE_MAX_PENALTY, ageBars / CHOCH_AGE_HALF_LIFE_BARS))
 *
 * No touch concept for structure breaks.
 */
export function chochDecay(input: DecayInput): DecayResult {
  let agePenalty = 0;
  let ageStr = "age=unknown";
  if (input.ageTradingDays !== undefined && Number.isFinite(input.ageTradingDays)) {
    agePenalty = Math.min(CHOCH_AGE_MAX_PENALTY, input.ageTradingDays / CHOCH_AGE_HALF_LIFE_TRADING_DAYS);
    ageStr = `age_trading_days=${input.ageTradingDays}`;
  } else if (input.ageBars !== undefined && Number.isFinite(input.ageBars)) {
    agePenalty = Math.min(CHOCH_AGE_MAX_PENALTY, input.ageBars / CHOCH_AGE_HALF_LIFE_BARS);
    ageStr = `age_bars=${input.ageBars}`;
  }

  const confidence = clamp(1 - agePenalty, 0, 1);
  return {
    confidence,
    reason: `choch: ${ageStr}, age_penalty=${agePenalty.toFixed(2)}, confidence=${confidence.toFixed(3)}`,
    hard_killed: false,
  };
}

/**
 * MSS (Market Structure Shift) decay.
 *
 * More aggressive than CHoCH — institutional traders invalidate MSS quickly.
 * Trading-day-scale (preferred, matches every production caller today):
 *   confidence = max(0, 1 - min(MSS_AGE_MAX_PENALTY, ageTradingDays / MSS_AGE_HALF_LIFE_TRADING_DAYS))
 * Bar-scale fallback (input.ageTradingDays absent, genuine 5m-bar caller):
 *   confidence = max(0, 1 - min(MSS_AGE_MAX_PENALTY, ageBars / MSS_AGE_HALF_LIFE_BARS))
 */
export function mssDecay(input: DecayInput): DecayResult {
  let agePenalty = 0;
  let ageStr = "age=unknown";
  if (input.ageTradingDays !== undefined && Number.isFinite(input.ageTradingDays)) {
    agePenalty = Math.min(MSS_AGE_MAX_PENALTY, input.ageTradingDays / MSS_AGE_HALF_LIFE_TRADING_DAYS);
    ageStr = `age_trading_days=${input.ageTradingDays}`;
  } else if (input.ageBars !== undefined && Number.isFinite(input.ageBars)) {
    agePenalty = Math.min(MSS_AGE_MAX_PENALTY, input.ageBars / MSS_AGE_HALF_LIFE_BARS);
    ageStr = `age_bars=${input.ageBars}`;
  }

  const confidence = clamp(1 - agePenalty, 0, 1);
  return {
    confidence,
    reason: `mss: ${ageStr}, age_penalty=${agePenalty.toFixed(2)}, confidence=${confidence.toFixed(3)}`,
    hard_killed: false,
  };
}

/**
 * SMT (Smart Money Technique) divergence decay.
 *
 * SMT divergences resolve quickly — 60-bar half-life (~5h on 5m bars).
 * confidence = max(0, 1 - min(SMT_AGE_MAX_PENALTY, ageBars / SMT_AGE_HALF_LIFE_BARS))
 *
 * Pass 5 will produce a [0,1] score for smt_confirmation; until then, age-based
 * decay is the best available proxy.
 */
export function smtDecay(input: DecayInput): DecayResult {
  let agePenalty = 0;
  let ageStr = "age=unknown";
  if (input.ageBars !== undefined && Number.isFinite(input.ageBars)) {
    agePenalty = Math.min(SMT_AGE_MAX_PENALTY, input.ageBars / SMT_AGE_HALF_LIFE_BARS);
    ageStr = `age_bars=${input.ageBars}`;
  }

  const confidence = clamp(1 - agePenalty, 0, 1);
  return {
    confidence,
    reason: `smt: ${ageStr}, age_penalty=${agePenalty.toFixed(2)}, confidence=${confidence.toFixed(3)}`,
    hard_killed: false,
  };
}

/**
 * VP (Volume Profile) level decay.
 *
 * VP levels go stale across sessions (different input type — sessions, not bars).
 *
 * confidence = max(0, 1 - VP_TOUCH_PENALTY × touchedCount
 *                      - min(VP_SESSION_MAX_PENALTY, ageSessions / VP_SESSION_HALF_LIFE))
 */
export function vpLevelDecay(input: { ageSessions?: number; touchedCount?: number }): DecayResult {
  const touched = input.touchedCount ?? 0;
  const touchPenalty = VP_TOUCH_PENALTY * touched;

  let agePenalty = 0;
  let ageStr = "age=unknown";
  if (input.ageSessions !== undefined && Number.isFinite(input.ageSessions)) {
    agePenalty = Math.min(VP_SESSION_MAX_PENALTY, input.ageSessions / VP_SESSION_HALF_LIFE);
    ageStr = `age_sessions=${input.ageSessions}`;
  }

  const confidence = clamp(1 - touchPenalty - agePenalty, 0, 1);
  return {
    confidence,
    reason: `vp_level: ${ageStr}, touched=${touched}, touch_penalty=${touchPenalty.toFixed(2)}, age_penalty=${agePenalty.toFixed(2)}, confidence=${confidence.toFixed(3)}`,
    hard_killed: false,
  };
}

/**
 * Generic decay — fallback for unmapped factor types.
 *
 * Uses weak decay (~200-bar half-life, 0.5 max age penalty).
 * Touch penalty and mitigated not applied — caller uses this when no specific
 * type knowledge is available.
 */
export function genericDecay(input: DecayInput): DecayResult {
  if (input.mitigated) {
    return {
      confidence: 0,
      reason: "generic_mitigated_hard_kill",
      hard_killed: true,
    };
  }

  let agePenalty = 0;
  let ageStr = "age=unknown";
  if (input.ageBars !== undefined && Number.isFinite(input.ageBars)) {
    agePenalty = Math.min(GENERIC_AGE_MAX_PENALTY, input.ageBars / GENERIC_AGE_HALF_LIFE_BARS);
    ageStr = `age_bars=${input.ageBars}`;
  } else if (input.ageHours !== undefined && Number.isFinite(input.ageHours)) {
    // Convert hours to approximate 5m bars (12 bars/hour)
    const approxBars = input.ageHours * 12;
    agePenalty = Math.min(GENERIC_AGE_MAX_PENALTY, approxBars / GENERIC_AGE_HALF_LIFE_BARS);
    ageStr = `age_hours=${input.ageHours}`;
  }

  const confidence = clamp(1 - agePenalty, 0, 1);
  return {
    confidence,
    reason: `generic: ${ageStr}, age_penalty=${agePenalty.toFixed(2)}, confidence=${confidence.toFixed(3)}`,
    hard_killed: false,
  };
}

// ─── Factor name constants (imported from confluence-score.ts conceptually) ───
// Duplicated here to keep this module self-contained and avoid circular deps.
// If confluene-score.ts FACTOR_* constants change, update these to match.

const _FACTOR_MARKET_STRUCTURE_ALIGNED = "market_structure_aligned";
const _FACTOR_LIQUIDITY_TARGET_CLEAR   = "liquidity_target_clear";
const _FACTOR_SMT_CONFIRMATION         = "smt_confirmation";
const _FACTOR_VWAP_ALIGNMENT           = "vwap_alignment";
const _FACTOR_KILLZONE_ACTIVE          = "killzone_active";
const _FACTOR_DELTA_OR_VOLUME          = "delta_or_volume_signature";
const _FACTOR_VP_LEVEL_PROXIMITY       = "vp_level_proximity";
const _FACTOR_MACRO_ALIGNMENT          = "macro_alignment";
const _FACTOR_INTERNALS_ALIGNED        = "internals_aligned";
const _FACTOR_CROSS_ASSET_ALIGNED      = "cross_asset_aligned";
const _FACTOR_REGIME_MATCH             = "regime_match";

/**
 * NO-DECAY set — factors that must never receive a second decay layer.
 *
 * This is the canonical anti-double-decay guard. deriveFactorDecay() returns
 * null for any factor in this set, meaning Stage 2 uses contribution = weight
 * (no decay multiplier) for these factors.
 */
const NO_DECAY_FACTORS = new Set<string>([
  _FACTOR_LIQUIDITY_TARGET_CLEAR,   // decayed in liquidity-map-service.ts
  _FACTOR_INTERNALS_ALIGNED,        // stale-gated in market-internals-service.ts
  _FACTOR_MACRO_ALIGNMENT,          // hard-block binary
  _FACTOR_REGIME_MATCH,             // binary state
  _FACTOR_KILLZONE_ACTIVE,          // binary time window
]);

/**
 * StructureState shape — minimal fields needed by deriveFactorDecay.
 * Must stay in sync with confluence-score.ts::StructureState (subset only).
 */
export interface DecayStructureState {
  choch_recent?: boolean;
  mss_recent?: boolean;
  bos_recent?: boolean;
  last_break_age_bars?: number | null;
  /**
   * Age (in trading days — computed against daily exec_bars, see
   * confluence-decay-bar-unit-mismatch-2026-07-17 packet §1a) for the most
   * recent CHoCH. Selection among choch/mss/bos_age_bars is RECENCY-FIRST
   * (smallest non-null age wins; same-age ties broken MSS > CHoCH > BOS,
   * matching structure_engine.py::_find_last_break()'s own same-bar
   * tiebreak) — NOT a fixed type-priority order.
   */
  choch_age_bars?: number | null;
  /** Age in trading days for the most recent MSS. See choch_age_bars doc. */
  mss_age_bars?: number | null;
  /** Age in trading days for the most recent BOS. See choch_age_bars doc. */
  bos_age_bars?: number | null;
  mitigated?: boolean;
}

/**
 * deriveFactorDecay — aggregate helper for Stage 2 integration.
 *
 * Maps a canonical factor name to the appropriate decay function and derives
 * its inputs from structureState + signalContext. Returns null when decay
 * doesn't apply (the NO_DECAY_FACTORS set above) — Stage 2 uses weight × 1.0
 * for those factors.
 *
 * Backward-compat contract: when structureState is null (Pass 1 fail-open path)
 * and no ageBars context is available, returns confidence=1.0 (no penalty).
 * This is identical to pre-Pass-4 behavior.
 *
 * @param factorName   Canonical factor name string (FACTOR_* constant)
 * @param ctx          Context bag with optional structureState and signalContext
 * @returns DecayResult with confidence in [0,1], or null when decay doesn't apply
 */
export function deriveFactorDecay(
  factorName: string,
  ctx: {
    structureState?: DecayStructureState | null;
    signalContext: Record<string, unknown>;
  },
): DecayResult | null {
  // Anti-double-decay guard — return null for factors that must never be re-decayed.
  if (NO_DECAY_FACTORS.has(factorName)) {
    return null;
  }

  switch (factorName) {
    case _FACTOR_MARKET_STRUCTURE_ALIGNED: {
      const ss = ctx.structureState;
      if (!ss) {
        // Structure engine not yet live — no decay (full confidence).
        return { confidence: 1.0, reason: "structure_state_null_no_penalty", hard_killed: false };
      }

      // RECENCY-FIRST selection (confluence-decay-bar-unit-mismatch-2026-07-17
      // packet §2d/§3a): among whichever of choch/mss/bos_age_bars are
      // non-null, the SMALLEST age (the most recent break) wins — NOT a
      // fixed type-priority chain. structure_engine.py::_find_last_break()
      // is recency-first across bars, tiebreaking only same-bar coincidences
      // (an MSS bar is definitionally also a CHoCH bar) MSS > CHoCH > BOS.
      // Mirror that tiebreak exactly here so this dispatch stays equivalent
      // to the engine's own semantics — a type-first order (in either
      // direction) reports the wrong-age break whenever the types disagree
      // on which is most recent.
      type BreakCandidate = { type: "choch" | "mss" | "bos"; age: number; tiebreakRank: number };
      const candidates: BreakCandidate[] = [];
      if (ss.choch_recent && ss.choch_age_bars != null && Number.isFinite(ss.choch_age_bars)) {
        candidates.push({ type: "choch", age: ss.choch_age_bars, tiebreakRank: 1 });
      }
      if (ss.mss_recent && ss.mss_age_bars != null && Number.isFinite(ss.mss_age_bars)) {
        candidates.push({ type: "mss", age: ss.mss_age_bars, tiebreakRank: 2 });
      }
      if (ss.bos_recent && ss.bos_age_bars != null && Number.isFinite(ss.bos_age_bars)) {
        candidates.push({ type: "bos", age: ss.bos_age_bars, tiebreakRank: 0 });
      }
      candidates.sort((a, b) => (a.age - b.age) || (b.tiebreakRank - a.tiebreakRank));

      let ageTradingDays: number | undefined;
      let breakType = "generic_break";

      if (candidates.length > 0) {
        ageTradingDays = candidates[0].age;
        breakType = candidates[0].type;
      } else if (ss.last_break_age_bars != null && Number.isFinite(ss.last_break_age_bars)) {
        // No per-type age available (pre-3b callers, or the type never
        // occurred in the window) — fall back to the single cross-type age.
        ageTradingDays = ss.last_break_age_bars;
        breakType = "last_break";
      }

      // Delegate to the most specific decay function based on break type.
      // All 4 age sources originate from the same daily-exec_bars-computed
      // StructureState, so all 4 are trading-day-denominated (§1a/§2a).
      let result: DecayResult;
      if (breakType === "mss") {
        result = mssDecay({ ageTradingDays });
      } else {
        // CHoCH, BOS, or the last_break fallback — chochDecay is a
        // reasonable proxy for BOS/generic (same half-life class).
        result = chochDecay({ ageTradingDays });
      }

      return {
        confidence: result.confidence,
        reason: `structure_${breakType}: ${result.reason}`,
        hard_killed: false,
      };
    }

    case _FACTOR_SMT_CONFIRMATION: {
      // SMT age — when Pass 5 ships, it will produce a [0,1] score directly.
      // Until then, ageBars from signalContext (if present) is used.
      const smtAgeBars = typeof ctx.signalContext["smt_age_bars"] === "number"
        ? ctx.signalContext["smt_age_bars"] as number
        : undefined;
      return smtDecay({ ageBars: smtAgeBars });
    }

    case _FACTOR_VP_LEVEL_PROXIMITY: {
      // VP level decay by sessions since refresh.
      const ageSessions = typeof ctx.signalContext["vp_age_sessions"] === "number"
        ? ctx.signalContext["vp_age_sessions"] as number
        : undefined;
      const vpTouched = typeof ctx.signalContext["vp_touched_count"] === "number"
        ? ctx.signalContext["vp_touched_count"] as number
        : undefined;
      return vpLevelDecay({ ageSessions, touchedCount: vpTouched });
    }

    case _FACTOR_VWAP_ALIGNMENT: {
      // VWAP itself doesn't decay but anchored VWAP staleness matters.
      // ageBars here = bars since the anchor bar was set.
      const vwapAgeBars = typeof ctx.signalContext["vwap_anchor_age_bars"] === "number"
        ? ctx.signalContext["vwap_anchor_age_bars"] as number
        : undefined;
      // Use a gentle decay — VWAP recalculates each bar but anchored VWAP is static.
      // FVG half-life (200 bars) is appropriate for anchored VWAP; session VWAP gets
      // confidence=1.0 (no anchor age → no penalty).
      return fvgDecay({ ageBars: vwapAgeBars });
    }

    case _FACTOR_DELTA_OR_VOLUME: {
      // Volume signature decays per bar — multi-bar accumulation loses relevance.
      const deltaAgeBars = typeof ctx.signalContext["delta_age_bars"] === "number"
        ? ctx.signalContext["delta_age_bars"] as number
        : undefined;
      // Use generic decay (200-bar half-life) — volume signals decay moderately.
      return genericDecay({ ageBars: deltaAgeBars });
    }

    case _FACTOR_CROSS_ASSET_ALIGNED: {
      // DXY/10Y directions shift intraday — decay by hours since pre-market reading.
      const crossAgeHours = typeof ctx.signalContext["cross_asset_age_hours"] === "number"
        ? ctx.signalContext["cross_asset_age_hours"] as number
        : undefined;
      return genericDecay({ ageHours: crossAgeHours });
    }

    default:
      // Unknown factor — return null (no decay, conservative).
      return null;
  }
}
