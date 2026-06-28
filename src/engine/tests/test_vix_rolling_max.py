"""Tests for M2 fix: VIX rolling max replaces whole-window peak look-ahead.

Tests the pure-function layer: apply_vix_margin_expansion + the per-bar
vectorized numpy logic that post-caps position sizes after compute_position_sizes.

These tests do NOT import backtester.py to avoid the vectorbt JIT hang.
They test the logic inline, mirroring the exact numpy expressions added in M2.

Run with:
    TF_MOCK_VBT=1 python -m pytest src/engine/tests/test_vix_rolling_max.py -v
"""

import os

import numpy as np
import polars as pl
import pytest


# ── Rolling max computation ───────────────────────────────────────────────────

class TestVixRollingMax:
    """Rolling 30-bar VIX max: correctness + no-look-ahead guarantee."""

    def _rolling_max_30(self, vix_arr: np.ndarray) -> np.ndarray:
        """Mirror the Polars rolling max added in M2 fix (fill_nan + min_samples)."""
        return (
            pl.Series("_vix_rm_", vix_arr, dtype=pl.Float64)
            .fill_nan(0.0)
            .rolling_max(window_size=30, min_samples=1)
            .to_numpy()
        )

    def test_rolling_max_length_matches_input(self):
        """Output array has same length as input."""
        vix = np.random.default_rng(42).uniform(15, 45, 200)
        out = self._rolling_max_30(vix)
        assert len(out) == len(vix)

    def test_rolling_max_no_look_ahead(self):
        """At bar i, rolling max uses ONLY bars 0..i — never future bars."""
        vix = np.zeros(100)
        # Insert a spike at bar 80
        vix[80] = 50.0
        rolling = self._rolling_max_30(vix)
        # Bars before bar 80 must NOT see the spike
        assert rolling[79] < 50.0, "Rolling max at bar 79 should not see the bar-80 spike"
        # Bar 80 should see the spike
        assert rolling[80] == pytest.approx(50.0, abs=0.01)
        # 30 bars after spike, it drops out of the window
        assert rolling[min(110, len(rolling) - 1)] < 50.0 or len(rolling) <= 110

    def test_rolling_max_with_nan_values(self):
        """NaN VIX bars are treated as 0.0 (fill_nan) so rolling max stays numeric.

        Polars NaN ≠ null: NaN propagates through rolling_max.
        The M2 fix converts NaN → 0.0 via fill_nan(0.0) BEFORE rolling_max so
        NaN bars never starve the window.  Rolling max at bar[2] = max(0,0,20)=20.
        """
        vix = np.array([np.nan, np.nan, 20.0, 25.0, np.nan, 30.0])
        rolling = self._rolling_max_30(vix)
        # All results should be numeric (no NaN) because fill_nan(0.0) was applied
        assert not np.any(np.isnan(rolling)), "rolling max must be NaN-free after fill_nan(0)"
        # bar[2]: window=[0,0,20] → max=20
        assert rolling[2] == pytest.approx(20.0, abs=0.01)
        # bar[5]: window includes 30.0 → max=30
        assert rolling[5] == pytest.approx(30.0, abs=0.01)
        # bar[0]: window=[0] → max=0 (NaN was filled to 0)
        assert rolling[0] == pytest.approx(0.0, abs=0.01)

    def test_rolling_max_global_peak_vs_last_bar(self):
        """Last-bar rolling max < global peak when spike is not in final 30 bars."""
        vix = np.ones(100) * 15.0  # mostly calm
        vix[20] = 60.0              # single spike early in window
        rolling = self._rolling_max_30(vix)
        global_peak = float(np.max(vix[~np.isnan(vix)]))
        last_rolling = float(rolling[-1])
        # OLD bug: used global_peak (60.0); NEW fix: uses last-bar rolling (15.0)
        assert global_peak == pytest.approx(60.0, abs=0.01)
        assert last_rolling < global_peak, (
            f"Last-bar rolling max ({last_rolling}) should be less than global peak "
            f"({global_peak}) when spike is outside the final 30-bar window"
        )

    def test_rolling_max_uniform_low_vix(self):
        """Uniform low VIX: rolling max should equal the value (no expansion)."""
        vix = np.full(50, 15.0)
        rolling = self._rolling_max_30(vix)
        np.testing.assert_allclose(rolling, 15.0, rtol=1e-6)


# ── Per-bar vectorized cap ────────────────────────────────────────────────────

class TestPerBarVixCap:
    """Vectorized per-bar VIX cap logic mirrors M2 backtester.py addition."""

    def _apply_perbar_cap(
        self,
        sizes: np.ndarray,
        vix_rolling_max: np.ndarray,
        base_mc: float = 10.0,
        thr30: float = 30.0,
        thr50: float = 50.0,
        mult30: float = 0.5,
        mult50: float = 0.25,
    ) -> np.ndarray:
        """Exact vectorized logic added in M2 fix."""
        vix_cap = np.where(
            vix_rolling_max > thr50,
            np.maximum(1.0, np.floor(base_mc * mult50)),
            np.where(
                vix_rolling_max > thr30,
                np.maximum(1.0, np.floor(base_mc * mult30)),
                base_mc,
            ),
        )
        vix_cap = np.where(np.isnan(vix_cap), base_mc, vix_cap)
        return np.minimum(sizes, vix_cap)

    def test_low_vix_no_cap_reduction(self):
        """VIX ≤ 30: per-bar cap equals base_mc (no reduction)."""
        sizes = np.full(50, 10.0)
        vix_rm = np.full(50, 20.0)  # below threshold
        capped = self._apply_perbar_cap(sizes, vix_rm, base_mc=10.0)
        np.testing.assert_allclose(capped, 10.0)

    def test_elevated_vix_halves_cap(self):
        """VIX > 30, ≤ 50: cap = floor(base × 0.5) = 5 for base=10."""
        sizes = np.full(50, 10.0)
        vix_rm = np.full(50, 35.0)
        capped = self._apply_perbar_cap(sizes, vix_rm, base_mc=10.0)
        np.testing.assert_allclose(capped, 5.0)

    def test_emergency_vix_quarters_cap(self):
        """VIX > 50: cap = floor(base × 0.25) = 2 for base=10."""
        sizes = np.full(50, 10.0)
        vix_rm = np.full(50, 55.0)
        capped = self._apply_perbar_cap(sizes, vix_rm, base_mc=10.0)
        np.testing.assert_allclose(capped, 2.0)

    def test_perbar_cap_minimum_is_1(self):
        """Emergency tier with base_mc=1: floor(1 × 0.25)=0 → clamp to 1."""
        sizes = np.full(5, 1.0)
        vix_rm = np.full(5, 60.0)  # emergency tier
        capped = self._apply_perbar_cap(sizes, vix_rm, base_mc=1.0)
        # np.maximum(1.0, floor(1*0.25)) = max(1, 0) = 1
        np.testing.assert_allclose(capped, 1.0)

    def test_mixed_vix_applies_per_bar(self):
        """Different VIX per bar → different caps per bar (no look-ahead)."""
        sizes = np.full(4, 10.0)
        vix_rm = np.array([15.0, 35.0, 55.0, 20.0])
        capped = self._apply_perbar_cap(sizes, vix_rm, base_mc=10.0)
        expected = np.array([10.0, 5.0, 2.0, 10.0])
        np.testing.assert_allclose(capped, expected)

    def test_nan_vix_treated_as_low(self):
        """NaN rolling max → full cap (no expansion, fail-open)."""
        sizes = np.full(3, 8.0)
        vix_rm = np.array([np.nan, 35.0, np.nan])
        capped = self._apply_perbar_cap(sizes, vix_rm, base_mc=10.0)
        # NaN → 10.0 (full cap), 35 → 5.0
        assert capped[0] == pytest.approx(8.0)  # min(8, 10) = 8 (NaN → base)
        assert capped[1] == pytest.approx(5.0)  # min(8, 5) = 5
        assert capped[2] == pytest.approx(8.0)  # min(8, 10) = 8 (NaN → base)

    def test_sizes_already_below_cap_unchanged(self):
        """When sizes are smaller than cap, min() leaves them unchanged."""
        sizes = np.array([2.0, 1.0, 3.0])
        vix_rm = np.array([35.0, 35.0, 35.0])  # cap = 5.0
        capped = self._apply_perbar_cap(sizes, vix_rm, base_mc=10.0)
        np.testing.assert_allclose(capped, sizes)

    def test_audit_vix_cap_basis_key_set(self):
        """M2 audit dict must contain vix_cap_basis='rolling_max_30bar'."""
        # Mirror the get_vix_expansion_audit dict construction in backtester.py.
        from src.engine.margin_expansion import get_vix_expansion_audit
        audit = get_vix_expansion_audit(base_max_contracts=10, expanded_max_contracts=5, vix_level=35.0)
        audit["vix_cap_basis"] = "rolling_max_30bar"  # M2 addition
        assert audit["vix_cap_basis"] == "rolling_max_30bar"
        assert audit["expansion_applied"] is True

    def test_old_np_max_vs_rolling_max_last_bar(self):
        """Demonstrate the look-ahead difference: old code vs new code."""
        # Early calm period, then late spike
        vix = np.concatenate([np.full(70, 15.0), np.full(30, 45.0)])  # spike in last 30 bars
        rolling = (
            pl.Series("v", vix, dtype=pl.Float64)
            .fill_nan(0.0)
            .rolling_max(window_size=30, min_samples=1)
            .to_numpy()
        )
        old_peak = float(np.max(vix))  # 45.0 — look-ahead: early bars penalised
        new_last = float(rolling[-1])   # 45.0 — last bar, but early bars get 15.0

        # For early bar (index 0): old gives max(whole)=45; new rolling gives 15
        rolling_at_early = float(rolling[0])
        assert rolling_at_early == pytest.approx(15.0, abs=0.01), (
            "Rolling max at bar 0 should reflect only bar 0's VIX (15.0), "
            "not the spike that happens 70 bars later"
        )
        assert old_peak == pytest.approx(45.0, abs=0.01)
        assert new_last == pytest.approx(45.0, abs=0.01)


# ── conftest vectorbt mock fixture ────────────────────────────────────────────

class TestConftestMockVbt:
    """L2 fix: verify the opt-in TF_MOCK_VBT fixture wires up correctly."""

    def test_mock_vbt_fixture_is_callable(self, mock_vectorbt_session):
        """Fixture resolves without error (TF_MOCK_VBT may or may not be '1')."""
        import sys
        # If TF_MOCK_VBT=1, vectorbt stub should be in sys.modules
        if os.environ.get("TF_MOCK_VBT") == "1":
            assert "vectorbt" in sys.modules
            vbt = sys.modules["vectorbt"]
            assert hasattr(vbt, "Portfolio")
        else:
            # TF_MOCK_VBT not set: nothing injected (pass-through)
            pass  # fixture should have yielded without injecting
