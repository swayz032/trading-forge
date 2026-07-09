"""adaptive_exits.py — Python mirror of adaptive-exit-engine.ts for backtest path.

Wave 25 Gap B: closes the P7 architect deferral. Wires the adaptive exit logic
into the Python backtest engine so the A/B harness produces real divergent results.

PURE FUNCTIONS — no I/O, no time.now() inside.

The TS version (src/server/services/adaptive-exit-engine.ts) is canonical for
the paper-side (live execution).  This Python mirror:
  - MUST produce equivalent TP1/TP2/runner targets for the same inputs
    (paper/backtest parity contract)
  - Reads liquidity from BacktestRequest.adaptive_exit_context.liquidity_snapshot
    (NO DB calls — snapshot replay only)
  - Reads regime from bias_engine.classify_institutional_regime() output
  - Reads pre_lunch_threshold_r + delta_div_threshold from AdaptiveExitContext

Parity contract:
  Same inputs (entry, stop, direction, symbol, bar_ts, regime, liquidity_snapshot)
  MUST produce same TP1/TP2/runner_trail_method/scaling_schedule as
  TS computeExitPlan() for the same logical scenario.

Day-trader mandate (CLAUDE.md §2b / feedback_day_trader_only_no_swing.md):
  INTRADAY_ALLOWED_LEVEL_TYPES enforced — NO pwh_iso/pwl_iso/pmh/pml.
  These multi-day DOL targets blow the EOD-DD buffer.

Hard invariants (CLAUDE.md §4 — NEVER overridden):
  - 15:55 ET hard flatten ALWAYS applies regardless of engine
  - BE+1 on TP1 fill ALWAYS applies
  - Adaptive engine may flatten EARLIER (pre-lunch, delta divergence), NEVER later

References:
  - src/server/services/adaptive-exit-engine.ts (canonical TS version)
  - src/engine/config.py AdaptiveExitContext + LiquidityLevelSnapshot
  - Wave 25 plan floating-yawning-lantern.md Gap B section

deepscan17 (2026-07-05) B-4/B-15: liquidity TP1/TP2 selection previously ranked by
pure geometric proximity here vs composite rank score on the TS side (same
liquidity snapshot -> different TP1/TP2 across engines, untested because every
harness fixture passed an empty snapshot). _build_liquidity_targets() now
reproduces the TS three-stage pipeline (direction+distance filter -> composite
rank sort + top-5 truncation -> day-trader type filter) exactly. Added
compute_pre_lunch_decision() as a real, importable W25.16 decision function for
parity testing (previously only the low-level time-check helper was exported).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Optional

# ─── Day-trader-only liquidity filter ─────────────────────────────────────────
# CLAUDE.md §2b day-trader mandate: TP targets INTRADAY only.
# PWH/PWL/PMH/PML → multi-day chase, blows EOD-DD buffer.
# This set is the ALLOWED list — only these level_types may appear in TP candidates.
INTRADAY_ALLOWED_LEVEL_TYPES: frozenset[str] = frozenset({
    "pdh",            # prior-day high (daily level, intraday reference)
    "pdl",            # prior-day low
    "asian_high",     # Asian session high (03:00-08:00 ET window)
    "asian_low",
    "london_high",    # London session high
    "london_low",
    "hod",            # developing session high-of-day
    "lod",            # developing session low-of-day
    "naked_poc",      # naked POC (last 5 sessions — intraday context)
    "untouched_fvg",  # intraday fair-value gap
    "untouched_ob",   # intraday order block
    "eqh",            # equal highs (stop cluster)
    "eql",            # equal lows
})

# Explicitly EXCLUDED (must NOT appear in TP candidates):
# "pwh_iso", "pwl_iso", "pmh", "pml" — multi-day DOL, violates day-trader mandate.
EXCLUDED_LEVEL_TYPES: frozenset[str] = frozenset({
    "pwh_iso", "pwl_iso", "pmh", "pml",
})

# ─── Regime scaling defaults ───────────────────────────────────────────────────
# Maps regime string → (tp1_pct, tp2_pct, runner_pct) — must sum to 1.00.
# PARITY: mirrors REGIME_SCALING_DEFAULTS in adaptive-exit-engine.ts exactly.
# Per-strategy overrides: not yet wired in Python path (Phase 1 plain implementation).

REGIME_SCALING_DEFAULTS: dict[str, tuple[float, float, float]] = {
    "TRENDING_UP":    (0.20, 0.30, 0.50),   # bigger runner in trend
    "TRENDING_DOWN":  (0.20, 0.30, 0.50),
    "EXPANSION":      (0.20, 0.30, 0.50),   # displacement regime — trend-like
    "RANGE_BOUND":    (0.50, 0.30, 0.20),   # quick harvest
    "COMPRESSION":    (0.50, 0.30, 0.20),   # breakout prep — harvest quickly
    "HIGH_VOL_MACRO": (0.60, 0.30, 0.10),   # fast exit, small runner on macro days
    "LOW_LIQ_CHOP":   (0.50, 0.50, 0.00),   # no runner — chop kills convexity
    # Fallback for unknown/unmapped regimes — conservative harvest
    "UNKNOWN":        (0.50, 0.30, 0.20),
}

# ─── Runner trail method by regime ────────────────────────────────────────────
# PARITY: mirrors REGIME_RUNNER_TRAIL_DEFAULTS in adaptive-exit-engine.ts exactly.

REGIME_RUNNER_TRAIL_DEFAULTS: dict[str, str] = {
    "TRENDING_UP":    "anchored_vwap",
    "TRENDING_DOWN":  "anchored_vwap",
    "EXPANSION":      "anchored_vwap",
    "RANGE_BOUND":    "developing_poc",
    "COMPRESSION":    "structure_trail",
    "HIGH_VOL_MACRO": "chandelier",
    "LOW_LIQ_CHOP":   "developing_poc",   # no runner in LOW_LIQ_CHOP, method still declared
}

# ─── Pre-lunch regime set ──────────────────────────────────────────────────────
# W25.16: pre-lunch partial only fires on rotational/slow regimes.
PRE_LUNCH_TRIGGER_REGIMES: frozenset[str] = frozenset({
    "RANGE_BOUND",
    "LOW_LIQ_CHOP",
    "COMPRESSION",
})

# ─── Delta-divergence threshold ───────────────────────────────────────────────
DEFAULT_DELTA_DIVERGENCE_THRESHOLD: float = float(
    os.environ.get("EXIT_DELTA_DIVERGENCE_THRESHOLD", "0.6")
)


# ─── Output dataclasses ────────────────────────────────────────────────────────

@dataclass
class ExitTarget:
    """A single TP target.

    PARITY: mirrors ExitTarget interface in adaptive-exit-engine.ts.
    """
    source: str              # 'liquidity' | 'r_multiple' | 'vwap_band_2s'
    price: float
    r_multiple: float
    level_type: Optional[str] = None     # populated when source='liquidity'
    htf_significance: Optional[int] = None  # 1-5, populated when source='liquidity'


@dataclass
class ScalingSchedule:
    """Regime-dependent scaling fractions.

    PARITY: mirrors ScalingSchedule interface in adaptive-exit-engine.ts.
    tp1_pct + tp2_pct + runner_pct must sum to 1.00.
    """
    tp1_pct: float
    tp2_pct: float
    runner_pct: float
    regime_source: str    # which regime key sourced the schedule


@dataclass
class ExitPlan:
    """Complete exit plan for one trade.

    PARITY: mirrors ExitPlan interface in adaptive-exit-engine.ts.
    Stored on position state and re-used bar-by-bar until position closes.
    """
    tp1: ExitTarget
    tp2: ExitTarget
    runner_trail_method: str    # 'anchored_vwap'|'developing_poc'|'chandelier'|'structure_trail'
    scaling: ScalingSchedule
    early_exit_threshold_delta_div: float
    pre_lunch_threshold_r: float
    # Pre-lunch partial fraction (always 0.50 per W25.16)
    pre_lunch_partial_pct: float = 0.50
    # Delta-divergence partial fraction (always 0.25 per W25.14)
    early_exit_partial_pct: float = 0.25
    # Audit payload (populated at plan creation time)
    audit_payload: dict = field(default_factory=dict)


# ─── R-multiple helper ─────────────────────────────────────────────────────────

def _compute_r_multiple(
    entry_price: float,
    target_price: float,
    direction: str,
    stop_price: float,
) -> float:
    """Compute implied R for a target price.

    PARITY: mirrors computeRMultiple() in adaptive-exit-engine.ts.
    Returns 0 if stop distance is zero.
    """
    stop_distance = abs(entry_price - stop_price)
    if stop_distance <= 0:
        return 0.0
    if direction == "long":
        return (target_price - entry_price) / stop_distance
    return (entry_price - target_price) / stop_distance


# ─── Liquidity target builder ──────────────────────────────────────────────────

def _snapshot_field(lvl, name: str, default=None):
    """Read a field from either a LiquidityLevelSnapshot dataclass or a plain dict.

    deepscan17 (2026-07-05) fix: the prior `getattr(...) or dict.get(...)` pattern
    treated a legitimate 0.0 (falsy) sweep_probability as "missing" and silently
    discarded it. Explicit None-checks so a real 0.0 survives.
    """
    val = lvl.get(name, default) if isinstance(lvl, dict) else getattr(lvl, name, default)
    return default if val is None else val


def _compute_rank_score(
    htf_significance: float,
    sweep_probability: float,
    distance_points: float,
    max_distance: float,
) -> float:
    """Composite rank score for a liquidity candidate.

    PARITY: mirrors computeRankScore() in liquidity-map-service.ts exactly
    (htf_significance/5 * 0.4 + sweep_probability * 0.4 + proximity_factor * 0.2).

    deepscan17 (2026-07-05) B-4(b): this function did not exist before — Python
    picked TP1/TP2 by pure geometric proximity while TS ranks by this composite
    score, so identical liquidity snapshots produced different TP1/TP2 selections
    across engines. See _build_liquidity_targets() for the fix.
    """
    safe_dist = max_distance if max_distance > 0 else 14.0
    proximity_factor = 1.0 / (1.0 + abs(distance_points) / safe_dist)
    return (htf_significance / 5.0) * 0.4 + sweep_probability * 0.4 + proximity_factor * 0.2


def _build_liquidity_targets(
    entry_price: float,
    stop_price: float,
    direction: str,
    atr: float,
    liquidity_snapshot: list,
) -> tuple[ExitTarget, ExitTarget]:
    """Pick TP1 and TP2 from the liquidity snapshot.

    PARITY: mirrors buildLiquidityTargets() in adaptive-exit-engine.ts AND
    getNearestLiquidity() in liquidity-map-service.ts.

    deepscan17 (2026-07-05) B-4(b) FIX: this function previously sorted candidates
    by pure geometric proximity (nearest price wins), which diverges from the TS
    engine's composite rank score (significance + sweep_probability + proximity,
    computed by getNearestLiquidity() and truncated to top-5 BEFORE the day-trader
    filter is applied). Identical liquidity snapshots could pick different TP1/TP2
    on the two engines — the headline adaptive-exit feature was silently ungated
    by the parity harness (all 5 fixtures passed an empty snapshot). This function
    now reproduces the TS three-stage pipeline exactly:
      1. Filter by direction + max-distance across ALL level types (not just
         intraday-allowed — matches getNearestLiquidity()'s own candidate pool).
      2. Rank by composite score descending, truncate to top 5
         (getNearestLiquidity() default maxResults=5).
      3. THEN filter to INTRADAY_ALLOWED_LEVEL_TYPES (matches
         buildLiquidityTargets()'s filter applied AFTER the DB call returns).
    A consequence documented for the record: because truncation happens BEFORE
    the day-trader filter, a snapshot with 5+ high-rank non-intraday levels (e.g.
    pwh_iso/pmh) can starve the intraday candidate pool even though qualifying
    intraday levels exist further down the rank order. This is the TS engine's
    existing behavior, not something introduced by this fix — Python is now
    faithful to it rather than silently different.

    Day-trader mandate: only INTRADAY_ALLOWED_LEVEL_TYPES pass the Stage 3 filter.
    PWH/PWL/PMH/PML are explicitly rejected from ever becoming TP1/TP2 targets.

    Fallbacks:
      TP1 fallback → +1R (r_multiple=1.0)
      TP2 fallback → +2R (r_multiple=2.0) or next level (whichever closer to entry)

    Args:
        liquidity_snapshot: list of LiquidityLevelSnapshot (from AdaptiveExitContext)
        direction: 'long' | 'short'
        atr: ATR at entry bar (used as max search distance cap)
    """
    stop_distance = abs(entry_price - stop_price)

    # Max search distance = 1×ATR (don't reach for far-away levels) — mirrors
    # getNearestLiquidity()'s distanceCap when buildLiquidityTargets() passes atr.
    max_distance = atr

    # ── Stage 1: direction + distance filter across ALL level types ─────────
    all_candidates = []
    for lvl in liquidity_snapshot:
        ltype = _snapshot_field(lvl, "level_type")
        price = _snapshot_field(lvl, "price")
        if ltype is None or price is None:
            continue
        htf_sig = _snapshot_field(lvl, "htf_significance", 1)
        sweep_prob = _snapshot_field(lvl, "sweep_probability", 0.0)

        # PARITY: TS computes `dist = above ? price - fromPrice : fromPrice - price`
        # and rejects `dist < 0` (behind price) or `dist > distanceCap`. dist == 0
        # (level exactly at entry) is allowed on the TS side, so it is here too.
        dist = (price - entry_price) if direction == "long" else (entry_price - price)
        if dist < 0 or dist > max_distance:
            continue

        rank_score = _compute_rank_score(htf_sig, sweep_prob, dist, max_distance)
        r = _compute_r_multiple(entry_price, price, direction, stop_price)
        all_candidates.append({
            "level_type": ltype,
            "price": price,
            "htf_significance": htf_sig,
            "sweep_probability": sweep_prob,
            "distance_points": dist,
            "rank_score": rank_score,
            "r_multiple": r,
        })

    # ── Stage 2: composite-rank sort descending + top-5 truncation ──────────
    # PARITY: getNearestLiquidity() default maxResults=5.
    all_candidates.sort(key=lambda c: c["rank_score"], reverse=True)
    top_ranked = all_candidates[:5]

    # ── Stage 3: day-trader mandate filter (applied AFTER truncation) ───────
    intraday_candidates = [c for c in top_ranked if c["level_type"] in INTRADAY_ALLOWED_LEVEL_TYPES]

    # ── TP1: first candidate in rank order with min R >= 0.8 ────────────────
    tp1_candidate = None
    for c in intraday_candidates:
        if c["r_multiple"] >= 0.8:
            tp1_candidate = c
            break

    if tp1_candidate is not None:
        tp1 = ExitTarget(
            source="liquidity",
            price=tp1_candidate["price"],
            r_multiple=tp1_candidate["r_multiple"],
            level_type=tp1_candidate["level_type"],
            htf_significance=tp1_candidate["htf_significance"],
        )
    else:
        # Fallback to +1R
        tp1_price = (
            entry_price + 1.0 * stop_distance
            if direction == "long"
            else entry_price - 1.0 * stop_distance
        )
        tp1 = ExitTarget(
            source="r_multiple",
            price=tp1_price,
            r_multiple=1.0,
        )

    # ── TP2: next candidate in rank order (excluding TP1), or +2R fallback ──
    tp2_fallback_r = 2.0
    tp2_fallback_price = (
        entry_price + tp2_fallback_r * stop_distance
        if direction == "long"
        else entry_price - tp2_fallback_r * stop_distance
    )

    tp2_candidate = None
    for c in intraday_candidates:
        if c is tp1_candidate:
            continue
        # Must be at least 0.5R beyond TP1
        if c["r_multiple"] >= tp1.r_multiple + 0.5:
            tp2_candidate = c
            break

    if tp2_candidate is not None:
        # Use whichever is closer to entry (smaller R is closer)
        if tp2_candidate["r_multiple"] <= tp2_fallback_r:
            tp2 = ExitTarget(
                source="liquidity",
                price=tp2_candidate["price"],
                r_multiple=tp2_candidate["r_multiple"],
                level_type=tp2_candidate["level_type"],
                htf_significance=tp2_candidate["htf_significance"],
            )
        else:
            tp2 = ExitTarget(
                source="r_multiple",
                price=tp2_fallback_price,
                r_multiple=tp2_fallback_r,
            )
    else:
        tp2 = ExitTarget(
            source="r_multiple",
            price=tp2_fallback_price,
            r_multiple=tp2_fallback_r,
        )

    return tp1, tp2


# ─── Scaling schedule builder ──────────────────────────────────────────────────

def _get_scaling_schedule(regime: str) -> ScalingSchedule:
    """Return the regime-dependent scaling schedule.

    PARITY: mirrors the REGIME_SCALING_DEFAULTS lookup in adaptive-exit-engine.ts.
    Falls back to UNKNOWN (50/30/20) for any unmapped regime string.
    """
    key = regime if regime in REGIME_SCALING_DEFAULTS else "UNKNOWN"
    tp1, tp2, runner = REGIME_SCALING_DEFAULTS[key]
    return ScalingSchedule(
        tp1_pct=tp1,
        tp2_pct=tp2,
        runner_pct=runner,
        regime_source=key,
    )


# ─── Runner trail method picker ────────────────────────────────────────────────

def _get_runner_trail_method(regime: str) -> str:
    """Return the regime-dependent runner trail method.

    PARITY: mirrors the REGIME_RUNNER_TRAIL_DEFAULTS lookup in adaptive-exit-engine.ts.
    Falls back to 'developing_poc' for any unmapped regime string.
    """
    return REGIME_RUNNER_TRAIL_DEFAULTS.get(regime, "developing_poc")


# ─── Pre-lunch time check ──────────────────────────────────────────────────────

def _is_at_or_after_pre_lunch_et(bar_ts: datetime) -> bool:
    """Return True if bar timestamp is at or after 11:30 ET (DST-correct).

    PARITY: mirrors isAtOrAfterPreLunchET() in adaptive-exit-engine.ts.

    H5c fix (2026-06-29): replaced the UTC-offset approximation with a ZoneInfo
    conversion so the check is correct year-round.

    Previous implementation:
        return utc_hour > 15 or (utc_hour == 15 and utc_minute >= 30)
    This checked ">= 15:30 UTC" which equals 11:30 EDT (summer, UTC-4) but fires at
    10:30 ET in EST winter (UTC-5) — one full hour too early, incorrectly suppressing
    the session window every November→March.

    Fix: convert bar_ts to America/New_York via zoneinfo.ZoneInfo (stdlib ≥3.9) and
    compare (et.hour, et.minute) >= (11, 30). DST transitions are handled by the OS
    timezone database.
    """
    try:
        _ET = ZoneInfo("America/New_York")
        if bar_ts.tzinfo is None:
            # Assume UTC if naive — attach tzinfo before converting
            bar_ts_aware = bar_ts.replace(tzinfo=timezone.utc)
        else:
            bar_ts_aware = bar_ts
        et = bar_ts_aware.astimezone(_ET)
        return (et.hour, et.minute) >= (11, 30)
    except Exception:
        return False


# ─── Pre-lunch soft-exit decision (W25.16) — pure function ────────────────────

def compute_pre_lunch_decision(
    regime: str,
    bar_ts: datetime,
    entry_price: float,
    stop_price: float,
    direction: str,
    current_pnl_r: float,
    threshold_r: float,
) -> dict:
    """Pre-lunch soft-exit decision — pure function, no I/O.

    deepscan17 (2026-07-05) B-15 fix: added so the TS<->Python parity harness has
    a real, importable decision function to assert against instead of a
    tautological echo of the pre_lunch_threshold_r input (the harness previously
    only checked that both sides stored back the same float it was given, which
    proves nothing about whether the two engines agree on WHEN the partial fires).

    PARITY: mirrors computePreLunchDecision() in adaptive-exit-engine.ts (same
    trigger-regime membership check via PRE_LUNCH_TRIGGER_REGIMES, same
    at-or-after-11:30-ET gate via _is_at_or_after_pre_lunch_et, same BE+0.5R
    tightened-stop formula) AND the inline pre-lunch block in
    backtester.py::_apply_adaptive_management (same three-condition AND +
    half_r_offset formula — see that function's W25.16 comment block). This is a
    formalization, not a new code path: backtester.py computes its own
    current_pnl_r per-bar from max-favorable-excursion and is NOT refactored to
    call this function (backtester.py is out of scope for this fix); the formulas
    here are copied 1:1 from that block so this function reflects real production
    behavior rather than a third independent guess.

    Args:
        current_pnl_r: caller-supplied current profit in R-multiples (TS callers
            pass this directly; backtester.py derives it from bar-by-bar MFE).
    """
    stop_distance = abs(entry_price - stop_price)
    tightened_stop = (
        entry_price + 0.5 * stop_distance
        if direction == "long"
        else entry_price - 0.5 * stop_distance
    )
    should_fire = (
        regime in PRE_LUNCH_TRIGGER_REGIMES
        and _is_at_or_after_pre_lunch_et(bar_ts)
        and current_pnl_r >= threshold_r
    )
    return {
        "should_fire": should_fire,
        "regime": regime,
        "profit_r": current_pnl_r,
        "partial_pct": 0.50 if should_fire else 0.0,
        "tightened_stop": tightened_stop,
    }


# ─── Main entry point ─────────────────────────────────────────────────────────

def compute_exit_plan_python(
    entry_price: float,
    stop_price: float,
    direction: str,
    symbol: str,
    bar_ts: datetime,
    atr: float,
    regime: str,
    liquidity_snapshot: list,
    pre_lunch_threshold_r: float = 0.3,
    delta_div_threshold: float = DEFAULT_DELTA_DIVERGENCE_THRESHOLD,
) -> ExitPlan:
    """Compute adaptive exit plan — pure function.

    This is the Python equivalent of computeExitPlan() in adaptive-exit-engine.ts.
    Called once per trade at position open; the result is cached on position state
    and reused bar-by-bar until the trade closes.

    PARITY CONTRACT:
      Same inputs (entry, stop, direction, symbol, bar_ts, regime, liquidity_snapshot)
      MUST produce the same TP1/TP2/runner_trail_method/scaling tuple as the TS
      computeExitPlan() for the same logical scenario.

    Args:
        entry_price: Entry fill price
        stop_price: Initial stop price (determines R distance)
        direction: 'long' | 'short'
        symbol: Instrument symbol (MES / MNQ / MCL)
        bar_ts: Entry bar timestamp (used for pre-lunch check)
        atr: ATR at entry bar (points, not ticks)
        regime: Institutional regime string from classify_institutional_regime()
        liquidity_snapshot: list[LiquidityLevelSnapshot] from AdaptiveExitContext
        pre_lunch_threshold_r: Min profit R for pre-lunch partial (default 0.3)
        delta_div_threshold: Delta-divergence threshold for 25% partial (default 0.6)

    Returns:
        ExitPlan with tp1, tp2, runner_trail_method, scaling, thresholds.
        Never raises — returns conservative fallback (static_styleC-equivalent R-multiples)
        on any exception.
    """
    try:
        # ── TP1 + TP2 from liquidity snapshot ──────────────────────────────
        tp1, tp2 = _build_liquidity_targets(
            entry_price=entry_price,
            stop_price=stop_price,
            direction=direction,
            atr=atr,
            liquidity_snapshot=liquidity_snapshot,
        )

        # ── Regime-dependent scaling ────────────────────────────────────────
        scaling = _get_scaling_schedule(regime)

        # ── Regime-dependent runner trail ───────────────────────────────────
        runner_trail_method = _get_runner_trail_method(regime)

        # ── Audit payload ───────────────────────────────────────────────────
        audit_payload = {
            "entry_price": entry_price,
            "stop_price": stop_price,
            "direction": direction,
            "symbol": symbol,
            "regime": regime,
            "tp1_source": tp1.source,
            "tp1_price": tp1.price,
            "tp1_r": round(tp1.r_multiple, 3),
            "tp1_level_type": tp1.level_type,
            "tp2_source": tp2.source,
            "tp2_price": tp2.price,
            "tp2_r": round(tp2.r_multiple, 3),
            "tp2_level_type": tp2.level_type,
            "runner_trail_method": runner_trail_method,
            "scaling_tp1_pct": scaling.tp1_pct,
            "scaling_tp2_pct": scaling.tp2_pct,
            "scaling_runner_pct": scaling.runner_pct,
            "scaling_regime_source": scaling.regime_source,
            "liquidity_levels_available": len(liquidity_snapshot),
            "pre_lunch_threshold_r": pre_lunch_threshold_r,
            "delta_div_threshold": delta_div_threshold,
        }

        return ExitPlan(
            tp1=tp1,
            tp2=tp2,
            runner_trail_method=runner_trail_method,
            scaling=scaling,
            early_exit_threshold_delta_div=delta_div_threshold,
            pre_lunch_threshold_r=pre_lunch_threshold_r,
            audit_payload=audit_payload,
        )

    except Exception as exc:
        # Fail-closed: return conservative R-multiple fallback
        stop_distance = abs(entry_price - stop_price) or 1.0
        tp1_price = (
            entry_price + 1.0 * stop_distance
            if direction == "long"
            else entry_price - 1.0 * stop_distance
        )
        tp2_price = (
            entry_price + 2.0 * stop_distance
            if direction == "long"
            else entry_price - 2.0 * stop_distance
        )
        fallback_scaling = ScalingSchedule(
            tp1_pct=0.33,
            tp2_pct=0.33,
            runner_pct=0.34,
            regime_source="fallback_error",
        )
        return ExitPlan(
            tp1=ExitTarget(source="r_multiple", price=tp1_price, r_multiple=1.0),
            tp2=ExitTarget(source="r_multiple", price=tp2_price, r_multiple=2.0),
            runner_trail_method="developing_poc",
            scaling=fallback_scaling,
            early_exit_threshold_delta_div=delta_div_threshold,
            pre_lunch_threshold_r=pre_lunch_threshold_r,
            audit_payload={"error": repr(exc), "fallback": True},
        )
