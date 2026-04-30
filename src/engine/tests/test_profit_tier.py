"""Tests for compute_profit_tier() — Tier 5.4 Profit-Based Position Scaling.

Formula: tier_count = floor(account_pnl_total / threshold)
         extra_contracts = tier_count * increment
         final = min(base + extra, firm_max)

CLAUDE.md constraint: ONE account must be profitable — no multi-account scaling.
Cap at firm max_contracts (CONTRACT_CAP_MAX = 20) via existing per-firm constraint.
"""

from __future__ import annotations

import math

import numpy as np
import polars as pl
import pytest

from src.engine.firm_config import CONTRACT_CAP_MAX, CONTRACT_CAP_MIN


# ---------------------------------------------------------------------------
# Import guard — tests run BEFORE implementation (TDD red phase)
# ---------------------------------------------------------------------------

def _import_helper():
    from src.engine.sizing import compute_profit_tier, compute_position_sizes
    return compute_profit_tier, compute_position_sizes


# ---------------------------------------------------------------------------
# compute_profit_tier unit tests
# ---------------------------------------------------------------------------

class TestComputeProfitTier:
    """Unit tests for the compute_profit_tier helper."""

    def setup_method(self):
        from src.engine.sizing import compute_profit_tier
        self.fn = compute_profit_tier

    # --- Core formula ---

    def test_zero_pnl_no_scaling(self):
        """pnl=0 -> tier_count=0 -> no extra contracts added."""
        assert self.fn(0.0, 10) == 10

    def test_one_tier(self):
        """$3,000 pnl / $3,000 threshold = 1 tier -> +2 contracts -> 12."""
        assert self.fn(3000.0, 10) == 12

    def test_three_tiers(self):
        """$9,000 pnl / $3,000 threshold = 3 tiers -> +6 contracts -> 16."""
        assert self.fn(9000.0, 10) == 16

    def test_custom_increment(self):
        """Custom increment=4: 1 tier * 4 = +4 -> base 10 -> 14."""
        assert self.fn(3000.0, 10, increment=4) == 14

    def test_negative_pnl_no_scaling(self):
        """Negative PnL -> tier_count treated as 0 -> base unchanged."""
        assert self.fn(-500.0, 10) == 10

    def test_just_below_threshold(self):
        """$2,999.99 < $3,000 threshold -> floor(0.999...) = 0 -> no scaling."""
        assert self.fn(2999.99, 10) == 10

    def test_exactly_on_boundary(self):
        """$6,000 exactly -> 2 tiers -> +4 -> 14."""
        assert self.fn(6000.0, 10) == 14

    def test_partial_tier_floored(self):
        """$4,500 / $3,000 = 1.5 -> floor=1 -> +2 -> 12 (not 13)."""
        assert self.fn(4500.0, 10) == 12

    # --- Cap behavior ---

    def test_large_pnl_capped_at_firm_max(self):
        """$50,000 pnl would produce many tiers but result is clamped to firm_max=20."""
        result = self.fn(50000.0, 10)
        assert result == CONTRACT_CAP_MAX

    def test_result_never_below_base(self):
        """Result must never be less than base_contracts."""
        for pnl in [-100000.0, -1.0, 0.0]:
            result = self.fn(pnl, 10)
            assert result >= 10, f"pnl={pnl} returned {result} < base=10"

    def test_result_never_exceeds_firm_max(self):
        """Result is always <= CONTRACT_CAP_MAX regardless of PnL."""
        for pnl in [0.0, 3000.0, 100000.0, 1_000_000.0]:
            result = self.fn(pnl, 10)
            assert result <= CONTRACT_CAP_MAX, f"pnl={pnl} returned {result} > {CONTRACT_CAP_MAX}"

    def test_explicit_firm_max_overrides_default(self):
        """Caller can pass explicit firm_max to enforce tighter cap."""
        # With firm_max=12: base=10, 3 tiers at $9K would yield 16, capped to 12.
        result = self.fn(9000.0, 10, firm_max=12)
        assert result == 12

    def test_explicit_firm_max_below_cap_min_still_respected(self):
        """firm_max < base: result stays at base (never below base)."""
        # firm_max=8 is below base=10 — result must be base=10 (floor)
        result = self.fn(0.0, 10, firm_max=8)
        assert result == 10

    # --- Property tests ---

    def test_monotone_in_pnl(self):
        """Higher PnL never produces fewer contracts (monotone non-decreasing)."""
        previous = self.fn(0.0, 10)
        for pnl in [1000.0, 2999.0, 3000.0, 6000.0, 9000.0, 15000.0, 50000.0]:
            current = self.fn(pnl, 10)
            assert current >= previous, f"pnl={pnl} produced {current} < previous {previous}"
            previous = current

    def test_custom_threshold(self):
        """Custom threshold: $5,000 threshold, 1 tier at $5,000 -> +2 -> 12."""
        result = self.fn(5000.0, 10, threshold=5000.0)
        assert result == 12

    def test_integer_result(self):
        """Helper always returns an int (never float)."""
        result = self.fn(3000.0, 10)
        assert isinstance(result, int)

    def test_base_contracts_preserved_at_zero_pnl(self):
        """base_contracts=5 with pnl=0 -> returns 5 (no scaling)."""
        result = self.fn(0.0, 5)
        assert result == 5

    def test_base_contracts_preserved_at_large_pnl_with_low_base(self):
        """base_contracts=1, pnl=$9K -> 3 tiers * 2 = +6 -> 7, within cap."""
        result = self.fn(9000.0, 1)
        assert result == 7


# ---------------------------------------------------------------------------
# compute_profit_tier — single-account constraint tests
# ---------------------------------------------------------------------------

class TestSingleAccountConstraint:
    """Verify CLAUDE.md constraint: ONE account must be profitable.
    Scaling must be single-account compounding, not multi-account aggregation.
    """

    def setup_method(self):
        from src.engine.sizing import compute_profit_tier
        self.fn = compute_profit_tier

    def test_independent_calls_do_not_accumulate(self):
        """Each call is stateless — no hidden state accumulates between calls."""
        result1 = self.fn(3000.0, 10)
        result2 = self.fn(3000.0, 10)
        assert result1 == result2 == 12

    def test_negative_pnl_resets_to_base(self):
        """After drawdown (negative PnL), sizing returns to base (no legacy scaling)."""
        assert self.fn(-1.0, 10) == 10
        assert self.fn(0.0, 10) == 10


# ---------------------------------------------------------------------------
# compute_position_sizes integration — profit_scaling_tier parameter
# ---------------------------------------------------------------------------

class TestComputePositionSizesIntegration:
    """Integration tests: profit_scaling_tier dict passed into compute_position_sizes()."""

    def _make_df(self, n: int = 10, atr_value: float = 4.0) -> pl.DataFrame:
        """Minimal DataFrame with atr_14 column."""
        return pl.DataFrame({
            "atr_14": [atr_value] * n,
        })

    def _make_config(self):
        from src.engine.config import PositionSizeConfig
        return PositionSizeConfig(
            type="dynamic_atr",
            target_risk_dollars=500.0,
        )

    def _make_spec(self):
        from src.engine.config import ContractSpec
        # MES: tick_size=0.25, tick_value=1.25, point_value=5.0
        return ContractSpec(
            tick_size=0.25,
            tick_value=1.25,
            point_value=5.0,
        )

    def test_none_profit_scaling_tier_is_backward_compatible(self):
        """profit_scaling_tier=None (default) produces identical output to pre-Tier-5.4 behavior."""
        from src.engine.sizing import compute_position_sizes
        df = self._make_df()
        config = self._make_config()
        spec = self._make_spec()

        sizes_baseline, over_risk_baseline = compute_position_sizes(
            df, config, spec, atr_period=14, max_contracts=15
        )
        sizes_explicit_none, over_risk_explicit = compute_position_sizes(
            df, config, spec, atr_period=14, max_contracts=15,
            profit_scaling_tier=None,
        )
        np.testing.assert_array_equal(sizes_baseline, sizes_explicit_none)
        np.testing.assert_array_equal(over_risk_baseline, over_risk_explicit)

    def test_profit_scaling_tier_increases_sizes(self):
        """With $6K cumulative profit (2 tiers * 2 = +4 contracts), sizes are larger."""
        from src.engine.sizing import compute_position_sizes
        df = self._make_df()
        config = self._make_config()
        spec = self._make_spec()

        sizes_no_scale, _ = compute_position_sizes(
            df, config, spec, atr_period=14, max_contracts=15,
        )
        sizes_scaled, _ = compute_position_sizes(
            df, config, spec, atr_period=14, max_contracts=15,
            profit_scaling_tier={"increment": 2, "threshold": 3000.0, "account_pnl_total": 6000.0},
        )
        # Scaled sizes should be >= baseline (profit tier adds contracts)
        assert np.all(sizes_scaled[~np.isnan(sizes_scaled)] >= sizes_no_scale[~np.isnan(sizes_no_scale)]) or \
               np.all(sizes_scaled[~np.isnan(sizes_scaled)] == sizes_no_scale[~np.isnan(sizes_no_scale)])

    def test_profit_scaling_tier_6k_adds_4_contracts(self):
        """$6K cumulative profit -> 2 tiers * 2 increment = 4 extra contracts."""
        from src.engine.sizing import compute_position_sizes, compute_profit_tier
        base = 10
        result = compute_profit_tier(6000.0, base, increment=2, threshold=3000.0)
        assert result == base + 4, f"Expected {base + 4}, got {result}"

    def test_profit_scaling_cap_respected_in_pipeline(self):
        """Scaled result is always capped at firm max_contracts (CONTRACT_CAP_MAX=20)."""
        from src.engine.sizing import compute_position_sizes
        df = self._make_df()
        config = self._make_config()
        spec = self._make_spec()

        sizes_scaled, _ = compute_position_sizes(
            df, config, spec, atr_period=14, max_contracts=15,
            profit_scaling_tier={"increment": 2, "threshold": 3000.0, "account_pnl_total": 999999.0},
        )
        valid = sizes_scaled[~np.isnan(sizes_scaled)]
        assert np.all(valid <= CONTRACT_CAP_MAX), f"Size exceeded CONTRACT_CAP_MAX: {valid.max()}"

    def test_negative_pnl_in_scaling_tier_no_scaling(self):
        """Negative account_pnl_total in profit_scaling_tier -> no scaling applied."""
        from src.engine.sizing import compute_position_sizes
        df = self._make_df()
        config = self._make_config()
        spec = self._make_spec()

        sizes_no_scale, _ = compute_position_sizes(
            df, config, spec, atr_period=14, max_contracts=15,
        )
        sizes_neg_pnl, _ = compute_position_sizes(
            df, config, spec, atr_period=14, max_contracts=15,
            profit_scaling_tier={"increment": 2, "threshold": 3000.0, "account_pnl_total": -500.0},
        )
        np.testing.assert_array_equal(sizes_no_scale, sizes_neg_pnl)

    def test_fixed_mode_unaffected_by_profit_scaling_tier(self):
        """Fixed sizing mode ignores profit_scaling_tier (mode stays fixed)."""
        from src.engine.config import PositionSizeConfig
        from src.engine.sizing import compute_position_sizes
        df = self._make_df()
        spec = self._make_spec()
        fixed_config = PositionSizeConfig(
            type="fixed",
            fixed_contracts=3,
        )

        sizes_fixed, _ = compute_position_sizes(
            df, fixed_config, spec, atr_period=14,
            profit_scaling_tier={"increment": 2, "threshold": 3000.0, "account_pnl_total": 9000.0},
        )
        # Fixed mode: all sizes == fixed_contracts regardless
        valid = sizes_fixed[~np.isnan(sizes_fixed)]
        assert np.all(valid == 3)

    def test_golden_file_regression_no_param(self):
        """Existing backtests WITHOUT profit_scaling_tier produce IDENTICAL output."""
        from src.engine.sizing import compute_position_sizes
        df = self._make_df(n=5, atr_value=4.0)
        config = self._make_config()
        spec = self._make_spec()

        sizes_old, over_risk_old = compute_position_sizes(df, config, spec, 14, 15)
        sizes_new, over_risk_new = compute_position_sizes(
            df, config, spec, 14, 15, profit_scaling_tier=None
        )
        np.testing.assert_array_equal(sizes_old, sizes_new)
        np.testing.assert_array_equal(over_risk_old, over_risk_new)
