"""FINDING-4: Topstep STANDARD payout lane — consistency cap opt-out.

Tests that simulate_firm_survival() applies the 50% best-day consistency cap
ONLY when TOPSTEP_PAYOUT_LANE=consistency, and SKIPS it when TOPSTEP_PAYOUT_LANE=standard
(the default).

The firm rule "topstep_50pct" EXISTS at Topstep (it's in the firm's rules).
But the operator runs the STANDARD payout lane, where the consistency cap is
OPT-IN and defaults to OFF. The B14 simulation must not apply a payout gate
that will never fire for the operator.

NOTE: vectorbt is NOT imported here. simulate_firm_survival is a pure numpy
path — no backtester import required. If the bare import of monte_carlo hangs
(vectorbt JIT), the TF_MOCK_VBT=1 workaround applies (see conftest).
"""

from __future__ import annotations

import os

import numpy as np
import pytest

from src.engine.monte_carlo import simulate_firm_survival


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_spiky_paths(n_sims: int, n_steps: int) -> np.ndarray:
    """Paths with a single-day spike > 50% of total profit.

    Day 0: +2500 (spike)
    Days 1-N: +50 each (steady)
    Total when n_steps=30: 2500 + 29*50 = 3950.
    Day-0 fraction = 2500/3950 ≈ 63% > 50% → should fail consistency.
    """
    returns = np.full((n_sims, n_steps), 50.0)
    returns[:, 0] = 2500.0
    return np.cumsum(returns, axis=1)


def _call_firm_survival(paths: np.ndarray, lane: str) -> dict:
    """Call simulate_firm_survival for topstep_50k with the given payout lane."""
    env_patch = {"TOPSTEP_PAYOUT_LANE": lane}
    original = {k: os.environ.get(k) for k in env_patch}
    try:
        for k, v in env_patch.items():
            os.environ[k] = v
        return simulate_firm_survival(
            paths=paths,
            firm_key="topstep_50k",
            symbol="MES",
            granularity="day",
            daily_trades_per_day=1,
            backtest_commission_rt=1.24,
        )
    finally:
        for k, v in original.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


# ─── FINDING-4 core tests ─────────────────────────────────────────────────────

class TestTopstepStandardLane:
    """TOPSTEP_PAYOUT_LANE=standard → consistency cap disabled."""

    def test_standard_lane_no_consistency_fail_rate(self):
        """Standard lane: spiky paths should NOT accumulate consistency_fail_rate.

        A spiky distribution (one day > 50% of profit) would fail the consistency
        rule in the CONSISTENCY lane. In STANDARD lane, there is no cap — the
        consistency_fail_rate must be 0 (or the field absent).
        """
        paths = _make_spiky_paths(n_sims=200, n_steps=30)
        result = _call_firm_survival(paths, lane="standard")
        # In standard lane, consistency rule is not applied.
        consistency_fail_rate = result.get("consistency_fail_rate", 0.0)
        assert consistency_fail_rate == 0.0, (
            f"Standard lane should have consistency_fail_rate=0.0 "
            f"but got {consistency_fail_rate}. "
            f"The 50% best-day cap must not apply in STANDARD lane."
        )

    def test_standard_is_default(self):
        """Without TOPSTEP_PAYOUT_LANE set, standard lane behavior applies."""
        paths = _make_spiky_paths(n_sims=200, n_steps=30)
        # Remove env var entirely — default must be "standard"
        original = os.environ.pop("TOPSTEP_PAYOUT_LANE", None)
        try:
            result = simulate_firm_survival(
                paths=paths,
                firm_key="topstep_50k",
                symbol="MES",
                granularity="day",
                daily_trades_per_day=1,
                backtest_commission_rt=1.24,
            )
            consistency_fail_rate = result.get("consistency_fail_rate", 0.0)
            assert consistency_fail_rate == 0.0, (
                f"Default lane (unset env) must behave as standard; "
                f"consistency_fail_rate should be 0.0, got {consistency_fail_rate}"
            )
        finally:
            if original is not None:
                os.environ["TOPSTEP_PAYOUT_LANE"] = original


class TestTopstepConsistencyLane:
    """TOPSTEP_PAYOUT_LANE=consistency → consistency cap IS applied."""

    def test_consistency_lane_spiky_paths_fail(self):
        """Consistency lane: spiky paths must register consistency_fail_rate > 0."""
        paths = _make_spiky_paths(n_sims=200, n_steps=30)
        result = _call_firm_survival(paths, lane="consistency")
        consistency_fail_rate = result.get("consistency_fail_rate", 0.0)
        assert consistency_fail_rate > 0.0, (
            f"Consistency lane must apply the 50% best-day cap; "
            f"spiky paths should register consistency_fail_rate > 0, got {consistency_fail_rate}"
        )

    def test_consistency_lane_flat_paths_no_fail(self):
        """Consistency lane: even daily profit → no consistency failures."""
        rng = np.random.default_rng(42)
        # Very consistent daily P&L: ~100 ± 10 per day (no single spike)
        returns = rng.normal(100.0, 10.0, size=(200, 30))
        paths = np.cumsum(returns, axis=1)
        result = _call_firm_survival(paths, lane="consistency")
        # Even flat paths might show some failures due to random variance;
        # the rate should be MUCH lower than for spiky paths.
        consistency_fail_rate = result.get("consistency_fail_rate", 0.0)
        # Expect very low rate for even distribution (< 5%)
        assert consistency_fail_rate < 0.05, (
            f"Flat paths should have near-zero consistency failures in consistency lane, "
            f"got {consistency_fail_rate}"
        )


class TestTopstepMFFUParity:
    """MFFU consistency rule is unaffected by TOPSTEP_PAYOUT_LANE."""

    def test_mffu_consistency_unchanged_by_topstep_lane(self):
        """TOPSTEP_PAYOUT_LANE=standard has NO effect on MFFU's sim_payout consistency."""
        paths = _make_spiky_paths(n_sims=200, n_steps=30)
        # MFFU has "mffu_50pct_sim_payout" rule (only at sim-funded payout stage)
        env_patch = {"TOPSTEP_PAYOUT_LANE": "standard"}
        original = {k: os.environ.get(k) for k in env_patch}
        try:
            for k, v in env_patch.items():
                os.environ[k] = v
            result_mffu = simulate_firm_survival(
                paths=paths,
                firm_key="mffu_50k",
                symbol="MES",
                granularity="day",
                daily_trades_per_day=1,
                backtest_commission_rt=1.24,
            )
        finally:
            for k, v in original.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        # MFFU mffu_50pct_sim_payout is not in _consistency_map (it has payout_cycle_days
        # logic). Setting TOPSTEP_PAYOUT_LANE=standard must NOT zero out MFFU's consistency.
        # The MFFU firm_key != "topstep_50k" so the Topstep gate must not affect it.
        # We just verify the result has the expected keys (no assertion on rate value
        # since MFFU consistency only applies at sim-funded payout stage).
        assert "consistency_fail_rate" in result_mffu


class TestEnvVarCaseSensitivity:
    """TOPSTEP_PAYOUT_LANE env is case-insensitive and whitespace-stripped."""

    def test_uppercase_standard_is_recognized(self):
        """TOPSTEP_PAYOUT_LANE=STANDARD (uppercase) → standard lane behavior."""
        paths = _make_spiky_paths(n_sims=100, n_steps=30)
        result = _call_firm_survival(paths, lane="STANDARD")
        consistency_fail_rate = result.get("consistency_fail_rate", 0.0)
        assert consistency_fail_rate == 0.0

    def test_padded_standard_is_recognized(self):
        """TOPSTEP_PAYOUT_LANE=' standard ' (padded) → standard lane behavior."""
        paths = _make_spiky_paths(n_sims=100, n_steps=30)
        result = _call_firm_survival(paths, lane="  standard  ")
        consistency_fail_rate = result.get("consistency_fail_rate", 0.0)
        assert consistency_fail_rate == 0.0
