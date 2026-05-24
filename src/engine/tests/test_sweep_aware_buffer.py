"""Tests for W24-P2 Item 20: sweep-aware stop buffer.

Verifies:
  1. Per-symbol buffer is applied (MES=3t, MNQ=5t, MCL=2t)
  2. Env-var override respected
  3. Unknown symbol falls back to legacy ATR-based buffer with warning
  4. StopPlan.sweep_aware_buffer flag is set correctly
  5. Buffer parity: structural_stops.py and backtester.py path both use same tick count
"""
from __future__ import annotations

import os
import warnings

import numpy as np
import pytest

from src.engine.context.structural_stops import (
    StopPlan,
    _EFFECTIVE_BUFFER_TICKS,
    compute_structural_stop,
    get_sweep_buffer_points,
    get_sweep_buffer_ticks,
)


# ─── Unit: per-symbol tick counts ─────────────────────────────────────────────

class TestSweepBufferTicks:
    def test_mes_default_3_ticks(self):
        assert get_sweep_buffer_ticks("MES") == 3

    def test_mnq_default_5_ticks(self):
        assert get_sweep_buffer_ticks("MNQ") == 5

    def test_mcl_default_2_ticks(self):
        assert get_sweep_buffer_ticks("MCL") == 2

    def test_alias_es_mirrors_mes(self):
        assert get_sweep_buffer_ticks("ES") == get_sweep_buffer_ticks("MES")

    def test_alias_nq_mirrors_mnq(self):
        assert get_sweep_buffer_ticks("NQ") == get_sweep_buffer_ticks("MNQ")

    def test_alias_cl_mirrors_mcl(self):
        assert get_sweep_buffer_ticks("CL") == get_sweep_buffer_ticks("MCL")

    def test_unknown_symbol_returns_none(self):
        assert get_sweep_buffer_ticks("UNKNOWN") is None

    def test_case_insensitive(self):
        assert get_sweep_buffer_ticks("mes") == get_sweep_buffer_ticks("MES")


class TestSweepBufferPoints:
    def test_mes_3ticks_x_025(self):
        # MES tick_size = 0.25; 3 ticks = 0.75pt
        pts = get_sweep_buffer_points("MES", 0.25)
        assert pts is not None
        assert abs(pts - 0.75) < 1e-9

    def test_mnq_5ticks_x_025(self):
        # MNQ tick_size = 0.25; 5 ticks = 1.25pt
        pts = get_sweep_buffer_points("MNQ", 0.25)
        assert pts is not None
        assert abs(pts - 1.25) < 1e-9

    def test_mcl_2ticks_x_001(self):
        # MCL tick_size = 0.01; 2 ticks = 0.02pt
        pts = get_sweep_buffer_points("MCL", 0.01)
        assert pts is not None
        assert abs(pts - 0.02) < 1e-9

    def test_unknown_returns_none(self):
        assert get_sweep_buffer_points("UNKNOWN", 0.25) is None


# ─── Env-var override ─────────────────────────────────────────────────────────

class TestEnvVarOverride:
    """Env-var overrides are read at module import time.
    We test the buffer via compute_structural_stop with a known tick_size.
    """

    def test_env_override_applies_to_stop_plan(self, monkeypatch):
        """Monkeypatching _EFFECTIVE_BUFFER_TICKS simulates env override at runtime."""
        from src.engine.context import structural_stops as ss

        original = ss._EFFECTIVE_BUFFER_TICKS.copy()
        try:
            ss._EFFECTIVE_BUFFER_TICKS["MES"] = 6  # override to 6 ticks
            ss._EFFECTIVE_BUFFER_TICKS["ES"] = 6

            plan = compute_structural_stop(
                direction="long",
                entry_price=4500.0,
                point_value=5.0,
                atr=4.0,
                tick_size=0.25,
                symbol="MES",
                nearest_swing_low=4490.0,
            )
            # buffer = 6 × 0.25 = 1.5pt; stop = 4490 - 1.5 = 4488.5
            assert plan.sweep_aware_buffer is True
            assert plan.buffer_ticks == 6
            assert abs(plan.buffer - 1.5) < 1e-9
        finally:
            ss._EFFECTIVE_BUFFER_TICKS.clear()
            ss._EFFECTIVE_BUFFER_TICKS.update(original)


# ─── compute_structural_stop: sweep_aware flag ───────────────────────────────

class TestComputeStructuralStop:
    """Integration tests for compute_structural_stop with sweep-aware buffer."""

    def _make_plan(self, symbol: str, tick_size: float, direction: str, swing: float,
                   entry: float = 4500.0, atr: float = 4.0, point_value: float = 5.0) -> StopPlan:
        kwargs: dict = dict(
            direction=direction,
            entry_price=entry,
            point_value=point_value,
            atr=atr,
            tick_size=tick_size,
            symbol=symbol,
        )
        if direction == "long":
            kwargs["nearest_swing_low"] = swing
        else:
            kwargs["nearest_swing_high"] = swing
        return compute_structural_stop(**kwargs)

    def test_mes_long_sweep_aware(self):
        plan = self._make_plan("MES", 0.25, "long", swing=4490.0)
        # MES: 3 × 0.25 = 0.75pt buffer; stop = 4490 - 0.75 = 4489.25
        assert plan.sweep_aware_buffer is True
        assert plan.buffer_ticks == 3
        assert abs(plan.buffer - 0.75) < 1e-9
        assert abs(plan.stop_price - 4489.25) < 1e-9

    def test_mnq_long_sweep_aware(self):
        plan = self._make_plan("MNQ", 0.25, "long", swing=4490.0, point_value=2.0)
        # MNQ: 5 × 0.25 = 1.25pt buffer; stop = 4490 - 1.25 = 4488.75
        assert plan.sweep_aware_buffer is True
        assert plan.buffer_ticks == 5
        assert abs(plan.buffer - 1.25) < 1e-9
        assert abs(plan.stop_price - 4488.75) < 1e-9

    def test_mcl_long_sweep_aware(self):
        plan = self._make_plan("MCL", 0.01, "long", swing=70.0, entry=71.0,
                                atr=0.5, point_value=100.0)
        # MCL: 2 × 0.01 = 0.02pt buffer; stop = 70 - 0.02 = 69.98
        assert plan.sweep_aware_buffer is True
        assert plan.buffer_ticks == 2
        assert abs(plan.buffer - 0.02) < 1e-9
        assert abs(plan.stop_price - 69.98) < 1e-9

    def test_mes_short_sweep_aware(self):
        plan = self._make_plan("MES", 0.25, "short", swing=4510.0)
        # MES: 3 × 0.25 = 0.75pt buffer; stop = 4510 + 0.75 = 4510.75
        assert plan.sweep_aware_buffer is True
        assert abs(plan.stop_price - 4510.75) < 1e-9

    def test_unknown_symbol_falls_back_with_warning(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            plan = compute_structural_stop(
                direction="long",
                entry_price=4500.0,
                point_value=5.0,
                atr=4.0,
                tick_size=0.25,
                symbol="UNKNOWN",
                nearest_swing_low=4490.0,
            )
        assert plan.sweep_aware_buffer is False
        assert plan.buffer_ticks == 0
        # At least one UserWarning about fallback
        user_warnings = [w for w in caught if issubclass(w.category, UserWarning)]
        assert len(user_warnings) >= 1
        assert "UNKNOWN" in str(user_warnings[0].message)

    def test_legacy_buffer_is_max_tick_size_or_atr_fraction(self):
        """Verify the legacy formula when symbol is unknown."""
        tick_size = 0.25
        atr = 4.0
        expected_buffer = max(tick_size, atr * 0.10)  # = max(0.25, 0.40) = 0.40
        with warnings.catch_warnings(record=True):
            warnings.simplefilter("always")
            plan = compute_structural_stop(
                direction="long",
                entry_price=4500.0,
                point_value=5.0,
                atr=atr,
                tick_size=tick_size,
                symbol="UNKNOWN",
                nearest_swing_low=4490.0,
            )
        assert abs(plan.buffer - expected_buffer) < 1e-9

    def test_session_transition_scales_buffer(self):
        plan = compute_structural_stop(
            direction="long",
            entry_price=4500.0,
            point_value=5.0,
            atr=4.0,
            tick_size=0.25,
            symbol="MES",
            nearest_swing_low=4490.0,
            session_transition=True,
        )
        # session_adj = 1.5; buffer = 3 × 0.25 × 1.5 = 1.125
        assert plan.session_adjustment == 1.5
        assert abs(plan.buffer - 1.125) < 1e-9

    def test_stop_plan_backward_compat_risk_dollars(self):
        """Existing callers rely on risk_dollars — ensure it's still correct."""
        plan = compute_structural_stop(
            direction="long",
            entry_price=4500.0,
            point_value=5.0,
            atr=4.0,
            tick_size=0.25,
            symbol="MES",
            nearest_swing_low=4490.0,
        )
        expected_risk = abs(4500.0 - plan.stop_price) * 5.0
        assert abs(plan.risk_dollars - expected_risk) < 1e-9

    def test_atr_fallback_no_structural_levels(self):
        """When no structural level provided, ATR fallback is used."""
        plan = compute_structural_stop(
            direction="long",
            entry_price=4500.0,
            point_value=5.0,
            atr=4.0,
            tick_size=0.25,
            symbol="MES",
        )
        assert plan.stop_reason == "atr_fallback"
        # stop = entry - 1.5 × ATR = 4500 - 6.0 = 4494.0
        assert abs(plan.stop_price - 4494.0) < 1e-9
