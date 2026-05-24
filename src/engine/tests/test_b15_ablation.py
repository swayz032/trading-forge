"""Wave 25 Pass 2 — Inst-8: Tests for B15 Factor Ablation hook.

Covers:
  - ablation produces both with_factor and without_factor metric blocks
  - delta block is populated with correct arithmetic
  - marginal_edge_significant=True when factor adds large improvement
  - marginal_edge_significant=False when factor adds no signal

Synthetic strategy data is generated inline; no numpy.random dependency
(blocked on this tower by Windows AppControl for np._bounded_integers DLL).
All randomness goes through stdlib random.Random(seed=42).

SMC context: 'market_structure_aligned' (W25.2 BOS/CHoCH/MSS) is practitioner-
consensus but not yet research-corroborated as a standalone futures edge.
This ablation hook gathers evidence before any future factor promotion.
"""
from __future__ import annotations

import math
from unittest.mock import patch

import pytest

from src.engine.parameter_jitter_battery import (
    ABLATION_DELTA_PF_THRESHOLD,
    ABLATION_DELTA_SHARPE_THRESHOLD,
    run_b15_ablation,
)

# ─── Shared fixtures ──────────────────────────────────────────────────────────

def _make_base_result(
    sharpe: float = 1.8,
    pf: float = 1.9,
    max_dd: float = 0.05,
    monthly_returns: list[float] | None = None,
) -> dict:
    """Synthetic base backtest result."""
    if monthly_returns is None:
        monthly_returns = [0.01] * 24
    return {
        "oos_metrics": {
            "sharpe_ratio": sharpe,
            "profit_factor": pf,
            "max_drawdown": max_dd,
        },
        "monthly_returns": {f"2024-{(i % 12) + 1:02d}": r for i, r in enumerate(monthly_returns)},
        "equity_curve": [1000.0 + i * 10 for i in range(len(monthly_returns) * 21)],
    }


def _make_stable_dsl() -> dict:
    """Minimal DSL with numeric params — used by SDR/PSI sweeps."""
    return {
        "strategy": {
            "name": "test_smc_ablation",
            "symbol": "MES",
            "timeframe": "5m",
            "indicators": [{"type": "ema", "period": 9}, {"type": "ema", "period": 21}],
            "entry_long": "ema_9 > ema_21",
            "entry_short": "high < low",
            "exit": "ema_9 < ema_21",
            "stop_loss": {"type": "atr", "multiplier": 1.5},
            "position_size": {"type": "fixed", "fixed_contracts": 6},
        },
        "start_date": "2024-01-01",
        "end_date": "2024-12-31",
    }


# ─── Test 1: ablation produces both with_factor and without_factor blocks ─────

class TestAblationProducesBothMetricBlocks:
    """The ablation result must contain both 'with_factor' and 'without_factor'
    metric dictionaries, each having the required keys.
    """

    def test_both_blocks_present_with_required_keys(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=2.0, pf=2.1, max_dd=0.04)
        ablated_result = _make_base_result(sharpe=2.0, pf=2.1, max_dd=0.04)

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.9,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 3, "sweep_points": 2, "seed": 42},
            )

        required_keys = {"sdr", "psi", "rws", "sharpe", "pf", "max_dd"}

        assert "with_factor" in out, "Missing 'with_factor' block"
        assert "without_factor" in out, "Missing 'without_factor' block"
        assert required_keys <= set(out["with_factor"].keys()), (
            f"with_factor missing keys: {required_keys - set(out['with_factor'].keys())}"
        )
        assert required_keys <= set(out["without_factor"].keys()), (
            f"without_factor missing keys: {required_keys - set(out['without_factor'].keys())}"
        )

    def test_factor_ablated_field_matches_input(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result()
        ablated_result = _make_base_result()

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.8,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 2, "sweep_points": 2, "seed": 42},
            )

        assert out["factor_ablated"] == "market_structure_aligned"

    def test_nested_b15_results_embedded(self):
        """Full B15 results for each scenario must be embedded in the ablation output."""
        dsl = _make_stable_dsl()
        base_result = _make_base_result()
        ablated_result = _make_base_result()

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.8,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="vp_shape",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 2, "sweep_points": 2, "seed": 42},
            )

        assert "with_factor_b15" in out
        assert "without_factor_b15" in out
        assert "sdr" in out["with_factor_b15"]
        assert "psi" in out["without_factor_b15"]

    def test_missing_ablated_result_raises(self):
        """Passing ablated_backtest_result=None must raise ValueError immediately."""
        dsl = _make_stable_dsl()
        base_result = _make_base_result()

        with pytest.raises(ValueError, match="ablated_backtest_result is required"):
            run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=None,
            )


# ─── Test 2: delta block is populated ─────────────────────────────────────────

class TestDeltaBlockPopulated:
    """The 'delta' block must be present and contain arithmetic differences
    (with_factor minus without_factor) for all metric keys.
    """

    def test_delta_keys_match_metric_blocks(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=2.0, pf=2.0, max_dd=0.03)
        ablated_result = _make_base_result(sharpe=1.5, pf=1.6, max_dd=0.06)

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.9,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 3, "sweep_points": 2, "seed": 42},
            )

        assert "delta" in out
        expected_keys = {"sdr", "psi", "rws", "sharpe", "pf", "max_dd"}
        assert expected_keys <= set(out["delta"].keys()), (
            f"delta missing keys: {expected_keys - set(out['delta'].keys())}"
        )

    def test_delta_sharpe_arithmetic(self):
        """delta['sharpe'] must equal with_factor['sharpe'] - without_factor['sharpe']."""
        dsl = _make_stable_dsl()
        # with_factor result: sharpe=2.0
        base_result = _make_base_result(sharpe=2.0, pf=2.0, max_dd=0.03)
        # without_factor result: sharpe=1.5
        ablated_result = _make_base_result(sharpe=1.5, pf=1.5, max_dd=0.03)

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.9,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 2, "sweep_points": 2, "seed": 42},
            )

        expected_delta_sharpe = round(
            out["with_factor"]["sharpe"] - out["without_factor"]["sharpe"], 6
        )
        assert abs(out["delta"]["sharpe"] - expected_delta_sharpe) < 1e-9, (
            f"delta sharpe mismatch: expected {expected_delta_sharpe}, "
            f"got {out['delta']['sharpe']}"
        )

    def test_delta_values_are_finite(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result()
        ablated_result = _make_base_result()

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.8,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 2, "sweep_points": 2, "seed": 42},
            )

        for key, val in out["delta"].items():
            if val is not None:
                assert math.isfinite(val), f"delta[{key!r}] is not finite: {val}"


# ─── Test 3: marginal_edge_significant=True when improvement is large ─────────

class TestMarginalEdgeSignificantTrue:
    """When the factor clearly improves Sharpe and PF above both thresholds,
    marginal_edge_significant must be True.
    """

    def test_large_sharpe_and_pf_improvement_is_significant(self):
        # with_factor: sharpe=2.5, pf=2.8
        # without_factor: sharpe=2.0, pf=2.5
        # delta_sharpe = 0.5 > 0.2, delta_pf = 0.3 > 0.1 → significant
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=2.5, pf=2.8, max_dd=0.03)
        ablated_result = _make_base_result(sharpe=2.0, pf=2.5, max_dd=0.03)

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=2.0,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 3, "sweep_points": 2, "seed": 42},
            )

        delta_sharpe = out["delta"]["sharpe"]
        delta_pf = out["delta"]["pf"]

        assert delta_sharpe > ABLATION_DELTA_SHARPE_THRESHOLD, (
            f"Expected delta_sharpe > {ABLATION_DELTA_SHARPE_THRESHOLD}, got {delta_sharpe}"
        )
        assert delta_pf > ABLATION_DELTA_PF_THRESHOLD, (
            f"Expected delta_pf > {ABLATION_DELTA_PF_THRESHOLD}, got {delta_pf}"
        )
        assert out["marginal_edge_significant"] is True, (
            "Expected marginal_edge_significant=True for large improvement"
        )

    def test_threshold_boundary_both_just_above(self):
        """Delta sharpe=0.21 and delta pf=0.11 should be significant."""
        dsl = _make_stable_dsl()
        # Sharpe diff = 0.21, PF diff = 0.11
        base_result = _make_base_result(sharpe=2.21, pf=1.91, max_dd=0.03)
        ablated_result = _make_base_result(sharpe=2.00, pf=1.80, max_dd=0.03)

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=2.0,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 2, "sweep_points": 2, "seed": 42},
            )

        assert out["marginal_edge_significant"] is True


# ─── Test 4: marginal_edge_significant=False when factor adds no signal ───────

class TestMarginalEdgeSignificantFalse:
    """When the factor adds little or no signal, marginal_edge_significant must
    be False.
    """

    def test_identical_results_not_significant(self):
        """If factor makes no difference at all, delta=0 → not significant."""
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=1.8, pf=1.9, max_dd=0.05)
        # Ablated result is identical — factor did nothing
        ablated_result = _make_base_result(sharpe=1.8, pf=1.9, max_dd=0.05)

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.8,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 2, "sweep_points": 2, "seed": 42},
            )

        assert out["marginal_edge_significant"] is False, (
            "Expected marginal_edge_significant=False when factor adds no signal"
        )

    def test_sharpe_above_but_pf_below_not_significant(self):
        """Both thresholds must be met; failing pf alone blocks significance."""
        # delta_sharpe = 0.5 (above threshold), delta_pf = 0.05 (below threshold)
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=2.5, pf=1.75, max_dd=0.04)
        ablated_result = _make_base_result(sharpe=2.0, pf=1.70, max_dd=0.04)

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=2.0,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 2, "sweep_points": 2, "seed": 42},
            )

        delta_pf = out["delta"]["pf"]
        assert delta_pf <= ABLATION_DELTA_PF_THRESHOLD, (
            f"Expected delta_pf <= {ABLATION_DELTA_PF_THRESHOLD}, got {delta_pf}"
        )
        assert out["marginal_edge_significant"] is False

    def test_pf_above_but_sharpe_below_not_significant(self):
        """Both thresholds must be met; failing sharpe alone blocks significance."""
        # delta_sharpe = 0.1 (below threshold), delta_pf = 0.3 (above threshold)
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=1.9, pf=2.1, max_dd=0.04)
        ablated_result = _make_base_result(sharpe=1.8, pf=1.8, max_dd=0.04)

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.8,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 2, "sweep_points": 2, "seed": 42},
            )

        delta_sharpe = out["delta"]["sharpe"]
        assert delta_sharpe <= ABLATION_DELTA_SHARPE_THRESHOLD, (
            f"Expected delta_sharpe <= {ABLATION_DELTA_SHARPE_THRESHOLD}, got {delta_sharpe}"
        )
        assert out["marginal_edge_significant"] is False

    def test_threshold_boundary_exactly_at_limit_not_significant(self):
        """delta_sharpe=0.20 exactly (not strictly greater) is not significant."""
        dsl = _make_stable_dsl()
        # Sharpe diff = exactly 0.20
        base_result = _make_base_result(sharpe=2.20, pf=2.0, max_dd=0.03)
        ablated_result = _make_base_result(sharpe=2.00, pf=1.5, max_dd=0.03)

        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=2.0,
        ):
            out = run_b15_ablation(
                dsl,
                base_result,
                factor_name="market_structure_aligned",
                ablated_backtest_result=ablated_result,
                params={"n_perturbations": 2, "sweep_points": 2, "seed": 42},
            )

        # delta_sharpe=0.2 is NOT strictly > 0.2 → not significant
        assert out["marginal_edge_significant"] is False
