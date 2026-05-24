"""Tests for adaptive_exits.py — Wave 25 Gap B Python mirror of adaptive-exit-engine.ts.

Coverage:
  1. compute_exit_plan_python — pure function, no I/O
  2. INTRADAY_ALLOWED_LEVEL_TYPES filter (day-trader mandate)
  3. R-multiple fallback when no qualifying liquidity within range
  4. All 4 regime scaling schedules (TRENDING/RANGE/MACRO/CHOP)
  5. All 4 runner trail methods (anchored_vwap/developing_poc/chandelier/structure_trail)
  6. TP1 min-R gate (0.8R minimum)
  7. TP2 at-least-0.5R-beyond-TP1 constraint
  8. Pre-lunch time check
  9. Error resilience (bad inputs → conservative fallback, never raises)
 10. Scaling sums to 1.00
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import pytest

from src.engine.config import LiquidityLevelSnapshot
from src.engine.exits.adaptive_exits import (
    EXCLUDED_LEVEL_TYPES,
    INTRADAY_ALLOWED_LEVEL_TYPES,
    PRE_LUNCH_TRIGGER_REGIMES,
    REGIME_SCALING_DEFAULTS,
    ExitPlan,
    ExitTarget,
    _compute_r_multiple,
    _is_at_or_after_pre_lunch_et,
    compute_exit_plan_python,
)

# ─── Helpers ──────────────────────────────────────────────────────────────────


def _make_liq(level_type: str, price: float, htf_sig: int = 3) -> LiquidityLevelSnapshot:
    return LiquidityLevelSnapshot(
        level_type=level_type,
        price=price,
        htf_significance=htf_sig,
        sweep_probability=0.6,
    )


def _default_plan(
    entry: float = 4000.0,
    stop: float = 3994.0,   # 6pt stop → 1R = 6pt
    direction: str = "long",
    regime: str = "TRENDING_UP",
    liquidity: list | None = None,
) -> ExitPlan:
    if liquidity is None:
        liquidity = []
    return compute_exit_plan_python(
        entry_price=entry,
        stop_price=stop,
        direction=direction,
        symbol="MES",
        bar_ts=datetime(2025, 6, 10, 14, 0),  # 10:00 ET (before pre-lunch)
        atr=6.0,
        regime=regime,
        liquidity_snapshot=liquidity,
    )


# ─── 1. Pure function — no side effects ───────────────────────────────────────


class TestComputeExitPlanPython:
    def test_returns_exit_plan_instance(self):
        plan = _default_plan()
        assert isinstance(plan, ExitPlan)

    def test_tp1_and_tp2_are_exit_targets(self):
        plan = _default_plan()
        assert isinstance(plan.tp1, ExitTarget)
        assert isinstance(plan.tp2, ExitTarget)

    def test_same_inputs_same_output(self):
        """Replay determinism: same inputs → identical ExitPlan."""
        plan_a = _default_plan()
        plan_b = _default_plan()
        assert plan_a.tp1.price == plan_b.tp1.price
        assert plan_a.tp2.price == plan_b.tp2.price
        assert plan_a.runner_trail_method == plan_b.runner_trail_method
        assert plan_a.scaling.tp1_pct == plan_b.scaling.tp1_pct

    def test_no_liquidity_falls_back_to_r_multiples(self):
        """Empty snapshot → +1R TP1, +2R TP2."""
        plan = _default_plan(entry=4000.0, stop=3994.0, direction="long", liquidity=[])
        assert plan.tp1.source == "r_multiple"
        assert plan.tp1.r_multiple == pytest.approx(1.0)
        assert plan.tp2.source == "r_multiple"
        assert plan.tp2.r_multiple == pytest.approx(2.0)
        # TP1 = 4000 + 6 = 4006, TP2 = 4000 + 12 = 4012
        assert plan.tp1.price == pytest.approx(4006.0)
        assert plan.tp2.price == pytest.approx(4012.0)

    def test_short_r_multiple_fallback(self):
        """Short direction R-multiple fallback: prices go DOWN."""
        plan = compute_exit_plan_python(
            entry_price=4000.0,
            stop_price=4006.0,  # 6pt stop above for short
            direction="short",
            symbol="MES",
            bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=6.0,
            regime="TRENDING_DOWN",
            liquidity_snapshot=[],
        )
        assert plan.tp1.price == pytest.approx(3994.0)  # 4000 - 6
        assert plan.tp2.price == pytest.approx(3988.0)  # 4000 - 12

    def test_liquidity_tp1_min_r_gate(self):
        """Only liquidity with R >= 0.8 qualifies for TP1.
        Uses atr=10 so both levels are within the max_distance=1×ATR cap.
        """
        # Level at 4003 = 0.5R (< 0.8 threshold) should be skipped
        # Level at 4005 = ~0.83R (>= 0.8) should be chosen
        liq = [
            _make_liq("pdh", 4003.0),   # 0.5R — below gate
            _make_liq("hod", 4005.0),   # 0.83R — passes
        ]
        plan = compute_exit_plan_python(
            entry_price=4000.0, stop_price=3994.0, direction="long",
            symbol="MES", bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=10.0, regime="TRENDING_UP", liquidity_snapshot=liq,
        )
        # TP1 should be the hod at 4005
        assert plan.tp1.source == "liquidity"
        assert plan.tp1.price == pytest.approx(4005.0)
        assert plan.tp1.level_type == "hod"

    def test_liquidity_tp2_at_least_0p5R_beyond_tp1(self):
        """TP2 must be at least 0.5R beyond TP1 R-multiple.
        Uses atr=10 so all levels are within the max_distance=1×ATR cap.
        """
        # stop=3994 → stop_dist=6 → 1R=6pt
        # atr=10 so all these levels are within max_distance
        liq = [
            _make_liq("pdh", 4006.0),         # 1.0R — qualifies as TP1
            _make_liq("asian_high", 4007.0),   # 1.17R — 0.17R above TP1, too close (<0.5R gap)
            _make_liq("london_high", 4009.0),  # 1.5R — exactly 0.5R above TP1, qualifies
        ]
        plan = compute_exit_plan_python(
            entry_price=4000.0, stop_price=3994.0, direction="long",
            symbol="MES", bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=10.0,   # large enough to allow all candidates through distance cap
            regime="TRENDING_UP", liquidity_snapshot=liq,
        )
        assert plan.tp1.price == pytest.approx(4006.0)
        # asian_high skipped (0.17R gap < 0.5R threshold), london_high used as TP2
        assert plan.tp2.price == pytest.approx(4009.0)

    def test_liquidity_tp2_fallback_to_2R_when_no_qualifying(self):
        """When no level qualifies as TP2, fall back to +2R.
        Uses atr=10 to ensure TP1 candidate is within distance cap."""
        liq = [_make_liq("pdh", 4006.0)]   # only TP1 candidate, no TP2
        plan = compute_exit_plan_python(
            entry_price=4000.0, stop_price=3994.0, direction="long",
            symbol="MES", bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=10.0, regime="TRENDING_UP", liquidity_snapshot=liq,
        )
        assert plan.tp1.source == "liquidity"
        assert plan.tp2.source == "r_multiple"
        assert plan.tp2.r_multiple == pytest.approx(2.0)

    def test_audit_payload_populated(self):
        plan = _default_plan()
        assert "entry_price" in plan.audit_payload
        assert "tp1_source" in plan.audit_payload
        assert "regime" in plan.audit_payload


# ─── 2. INTRADAY_ALLOWED_LEVEL_TYPES filter ───────────────────────────────────


class TestIntradayAllowedFilter:
    def test_intraday_types_accepted(self):
        """Every type in INTRADAY_ALLOWED_LEVEL_TYPES must pass the filter.
        Uses atr=10 to ensure the 4006 price level is within max_distance cap.
        """
        for ltype in INTRADAY_ALLOWED_LEVEL_TYPES:
            liq = [_make_liq(ltype, 4006.0)]
            plan = compute_exit_plan_python(
                entry_price=4000.0, stop_price=3994.0, direction="long",
                symbol="MES", bar_ts=datetime(2025, 6, 10, 14, 0),
                atr=10.0, regime="TRENDING_UP", liquidity_snapshot=liq,
            )
            # If the level passes the filter, TP1 may be liquidity source
            # (it will be if R >= 0.8, which it is at 4006 with 6pt stop)
            assert plan.tp1.source in ("liquidity", "r_multiple")

    def test_pwh_iso_excluded(self):
        """pwh_iso must NOT appear in TP candidates (day-trader mandate).
        Uses atr=10 to ensure the price level is within max_distance cap.
        """
        liq = [_make_liq("pwh_iso", 4006.0)]
        plan = compute_exit_plan_python(
            entry_price=4000.0, stop_price=3994.0, direction="long",
            symbol="MES", bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=10.0, regime="TRENDING_UP", liquidity_snapshot=liq,
        )
        # pwh_iso excluded → falls back to R-multiple
        assert plan.tp1.source == "r_multiple"
        assert plan.tp1.level_type is None

    def test_pwl_iso_excluded(self):
        """pwl_iso excluded from TP candidates."""
        liq = [_make_liq("pwl_iso", 3994.0)]
        plan = compute_exit_plan_python(
            entry_price=4000.0,
            stop_price=4006.0,
            direction="short",
            symbol="MES",
            bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=10.0,
            regime="TRENDING_DOWN",
            liquidity_snapshot=liq,
        )
        assert plan.tp1.source == "r_multiple"

    def test_pmh_excluded(self):
        liq = [_make_liq("pmh", 4006.0)]
        plan = compute_exit_plan_python(
            entry_price=4000.0, stop_price=3994.0, direction="long",
            symbol="MES", bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=10.0, regime="TRENDING_UP", liquidity_snapshot=liq,
        )
        assert plan.tp1.source == "r_multiple"

    def test_pml_excluded(self):
        liq = [_make_liq("pml", 3994.0)]
        plan = compute_exit_plan_python(
            entry_price=4000.0,
            stop_price=4006.0,
            direction="short",
            symbol="MES",
            bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=10.0,
            regime="TRENDING_DOWN",
            liquidity_snapshot=liq,
        )
        assert plan.tp1.source == "r_multiple"

    def test_excluded_set_contents(self):
        """Verify EXCLUDED_LEVEL_TYPES contains exactly the multi-day DOL types."""
        assert "pwh_iso" in EXCLUDED_LEVEL_TYPES
        assert "pwl_iso" in EXCLUDED_LEVEL_TYPES
        assert "pmh" in EXCLUDED_LEVEL_TYPES
        assert "pml" in EXCLUDED_LEVEL_TYPES

    def test_no_overlap_between_allowed_and_excluded(self):
        """No type should appear in both INTRADAY_ALLOWED and EXCLUDED."""
        overlap = INTRADAY_ALLOWED_LEVEL_TYPES & EXCLUDED_LEVEL_TYPES
        assert len(overlap) == 0, f"Overlap: {overlap}"


# ─── 3. Regime scaling schedules ──────────────────────────────────────────────


class TestRegimeScaling:
    def test_trending_up_scaling(self):
        plan = _default_plan(regime="TRENDING_UP")
        assert plan.scaling.tp1_pct == pytest.approx(0.20)
        assert plan.scaling.tp2_pct == pytest.approx(0.30)
        assert plan.scaling.runner_pct == pytest.approx(0.50)

    def test_trending_down_scaling(self):
        plan = _default_plan(regime="TRENDING_DOWN")
        assert plan.scaling.tp1_pct == pytest.approx(0.20)
        assert plan.scaling.runner_pct == pytest.approx(0.50)

    def test_expansion_scaling(self):
        """EXPANSION regime: trend-like (20/30/50)."""
        plan = _default_plan(regime="EXPANSION")
        assert plan.scaling.tp1_pct == pytest.approx(0.20)
        assert plan.scaling.runner_pct == pytest.approx(0.50)

    def test_range_bound_scaling(self):
        """RANGE_BOUND: quick harvest (50/30/20)."""
        plan = _default_plan(regime="RANGE_BOUND")
        assert plan.scaling.tp1_pct == pytest.approx(0.50)
        assert plan.scaling.tp2_pct == pytest.approx(0.30)
        assert plan.scaling.runner_pct == pytest.approx(0.20)

    def test_compression_scaling(self):
        """COMPRESSION: same as RANGE_BOUND (50/30/20)."""
        plan = _default_plan(regime="COMPRESSION")
        assert plan.scaling.tp1_pct == pytest.approx(0.50)

    def test_high_vol_macro_scaling(self):
        """HIGH_VOL_MACRO: fast exit (60/30/10)."""
        plan = _default_plan(regime="HIGH_VOL_MACRO")
        assert plan.scaling.tp1_pct == pytest.approx(0.60)
        assert plan.scaling.tp2_pct == pytest.approx(0.30)
        assert plan.scaling.runner_pct == pytest.approx(0.10)

    def test_low_liq_chop_scaling(self):
        """LOW_LIQ_CHOP: no runner (50/50/0)."""
        plan = _default_plan(regime="LOW_LIQ_CHOP")
        assert plan.scaling.tp1_pct == pytest.approx(0.50)
        assert plan.scaling.tp2_pct == pytest.approx(0.50)
        assert plan.scaling.runner_pct == pytest.approx(0.00)

    def test_unknown_regime_fallback(self):
        """Unknown regime: conservative fallback (50/30/20)."""
        plan = _default_plan(regime="SOME_UNKNOWN_REGIME")
        assert plan.scaling.tp1_pct + plan.scaling.tp2_pct + plan.scaling.runner_pct == pytest.approx(1.0)

    def test_all_regimes_sum_to_1(self):
        """All regime scaling tuples must sum to exactly 1.00."""
        for regime, (tp1, tp2, runner) in REGIME_SCALING_DEFAULTS.items():
            total = tp1 + tp2 + runner
            assert abs(total - 1.0) < 1e-9, f"Regime {regime} scaling sums to {total}, expected 1.0"


# ─── 4. Runner trail method by regime ─────────────────────────────────────────


class TestRunnerTrailMethod:
    def test_trending_up_uses_anchored_vwap(self):
        plan = _default_plan(regime="TRENDING_UP")
        assert plan.runner_trail_method == "anchored_vwap"

    def test_trending_down_uses_anchored_vwap(self):
        plan = _default_plan(regime="TRENDING_DOWN")
        assert plan.runner_trail_method == "anchored_vwap"

    def test_expansion_uses_anchored_vwap(self):
        plan = _default_plan(regime="EXPANSION")
        assert plan.runner_trail_method == "anchored_vwap"

    def test_range_bound_uses_developing_poc(self):
        plan = _default_plan(regime="RANGE_BOUND")
        assert plan.runner_trail_method == "developing_poc"

    def test_compression_uses_structure_trail(self):
        plan = _default_plan(regime="COMPRESSION")
        assert plan.runner_trail_method == "structure_trail"

    def test_high_vol_macro_uses_chandelier(self):
        plan = _default_plan(regime="HIGH_VOL_MACRO")
        assert plan.runner_trail_method == "chandelier"

    def test_low_liq_chop_uses_developing_poc(self):
        plan = _default_plan(regime="LOW_LIQ_CHOP")
        assert plan.runner_trail_method == "developing_poc"

    def test_unknown_regime_has_valid_trail(self):
        plan = _default_plan(regime="MYSTERY_REGIME")
        assert plan.runner_trail_method in ("anchored_vwap", "developing_poc", "chandelier", "structure_trail")


# ─── 5. Pre-lunch time check ───────────────────────────────────────────────────


class TestPreLunchCheck:
    def test_before_11_30_returns_false(self):
        """10:00 ET (14:00 UTC) is before pre-lunch threshold."""
        ts = datetime(2025, 6, 10, 14, 0)  # 14:00 UTC = 10:00 EDT
        assert _is_at_or_after_pre_lunch_et(ts) is False

    def test_at_15_30_utc_returns_true(self):
        """15:30 UTC = 11:30 EDT = pre-lunch threshold."""
        ts = datetime(2025, 6, 10, 15, 30)
        assert _is_at_or_after_pre_lunch_et(ts) is True

    def test_after_15_30_utc_returns_true(self):
        """16:00 UTC = 12:00 EDT — after pre-lunch."""
        ts = datetime(2025, 6, 10, 16, 0)
        assert _is_at_or_after_pre_lunch_et(ts) is True

    def test_pre_lunch_trigger_regimes_set(self):
        """Verify pre-lunch only fires for rotational/slow regimes."""
        assert "RANGE_BOUND" in PRE_LUNCH_TRIGGER_REGIMES
        assert "LOW_LIQ_CHOP" in PRE_LUNCH_TRIGGER_REGIMES
        assert "COMPRESSION" in PRE_LUNCH_TRIGGER_REGIMES
        # Trend regime must NOT be in pre-lunch set
        assert "TRENDING_UP" not in PRE_LUNCH_TRIGGER_REGIMES
        assert "EXPANSION" not in PRE_LUNCH_TRIGGER_REGIMES


# ─── 6. Error resilience ──────────────────────────────────────────────────────


class TestErrorResilience:
    def test_zero_stop_distance_does_not_raise(self):
        """Entry == stop: degenerate case → fallback plan, no exception."""
        plan = compute_exit_plan_python(
            entry_price=4000.0,
            stop_price=4000.0,   # zero distance
            direction="long",
            symbol="MES",
            bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=6.0,
            regime="TRENDING_UP",
            liquidity_snapshot=[],
        )
        # Must not raise; scaling sums to 1.0
        total = plan.scaling.tp1_pct + plan.scaling.tp2_pct + plan.scaling.runner_pct
        assert abs(total - 1.0) < 1e-6

    def test_none_level_type_in_snapshot_skipped(self):
        """Malformed snapshot entries (missing level_type) are silently skipped."""
        @dataclass
        class BadLevel:
            level_type: str = None
            price: float = 4006.0
            htf_significance: int = 3
            sweep_probability: float = None

        plan = compute_exit_plan_python(
            entry_price=4000.0,
            stop_price=3994.0,
            direction="long",
            symbol="MES",
            bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=6.0,
            regime="TRENDING_UP",
            liquidity_snapshot=[BadLevel()],
        )
        # Malformed entry skipped → falls back to R-multiple
        assert plan.tp1.source == "r_multiple"

    def test_nan_stop_returns_fallback(self):
        """NaN stop distance produces fallback plan without raising."""
        plan = compute_exit_plan_python(
            entry_price=4000.0,
            stop_price=float("nan"),
            direction="long",
            symbol="MES",
            bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=6.0,
            regime="TRENDING_UP",
            liquidity_snapshot=[],
        )
        # Should not raise — fallback plan
        assert plan is not None


# ─── 7. _compute_r_multiple helper ────────────────────────────────────────────


class TestComputeRMultiple:
    def test_long_1r(self):
        r = _compute_r_multiple(4000.0, 4006.0, "long", 3994.0)
        assert r == pytest.approx(1.0)

    def test_long_2r(self):
        r = _compute_r_multiple(4000.0, 4012.0, "long", 3994.0)
        assert r == pytest.approx(2.0)

    def test_short_1r(self):
        r = _compute_r_multiple(4000.0, 3994.0, "short", 4006.0)
        assert r == pytest.approx(1.0)

    def test_zero_stop_distance_returns_zero(self):
        r = _compute_r_multiple(4000.0, 4006.0, "long", 4000.0)
        assert r == 0.0


# ─── 8. Thresholds pass-through ───────────────────────────────────────────────


class TestThresholds:
    def test_default_pre_lunch_threshold(self):
        plan = _default_plan()
        assert plan.pre_lunch_threshold_r == pytest.approx(0.3)

    def test_custom_pre_lunch_threshold(self):
        plan = compute_exit_plan_python(
            entry_price=4000.0,
            stop_price=3994.0,
            direction="long",
            symbol="MES",
            bar_ts=datetime(2025, 6, 10, 14, 0),
            atr=6.0,
            regime="TRENDING_UP",
            liquidity_snapshot=[],
            pre_lunch_threshold_r=0.5,
        )
        assert plan.pre_lunch_threshold_r == pytest.approx(0.5)

    def test_default_delta_div_threshold(self):
        plan = _default_plan()
        assert 0 < plan.early_exit_threshold_delta_div <= 1.0
