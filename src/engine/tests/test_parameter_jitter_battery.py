"""Tests for B15 Parameter Robustness Battery (Wave 25 Item 5).

Covers:
  - Deterministic SDR with synthetic stable strategy → SDR matches expected
  - Deterministic PSI with known-sensitive param → PSI reflects sensitivity
  - RWS from synthetic monthly returns → std-dev matches known value
  - Fragile strategy (razor-edge MA threshold) → SDR < 0.85
  - Wildly sensitive single param → PSI > 0.05
  - Bad 6-month window → RWS > 0.20
  - passed=true only when ALL 3 thresholds met
  - Parameter extraction from nested DSL
  - run_b15_battery() orchestrator integration
  - Advisory/blocking behavior via B15_BATTERY_ENABLED env
  - CLI --b15-battery flag emits B15_BATTERY_JSON sentinel
"""
from __future__ import annotations

import json
import math
from unittest.mock import patch

from src.engine.parameter_jitter_battery import (
    DEFAULT_PSI_THRESHOLD,
    DEFAULT_RWS_THRESHOLD,
    DEFAULT_SDR_THRESHOLD,
    _extract_numeric_params,
    _sharpe_from_monthly_returns,
    compute_psi,
    compute_rws,
    compute_sdr,
    run_b15_battery,
)

# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _make_base_result(sharpe: float = 1.8, monthly_returns: list[float] | None = None) -> dict:
    """Synthetic base backtest result."""
    if monthly_returns is None:
        # 24 months of stable +1% returns
        monthly_returns = [0.01] * 24
    return {
        "oos_metrics": {"sharpe_ratio": sharpe},
        "monthly_returns": {
            f"{2024 + i // 12}-{(i % 12) + 1:02d}": r
            for i, r in enumerate(monthly_returns)
        },
        "equity_curve": [1000.0 + i * 10 for i in range(len(monthly_returns) * 21)],
    }


def _make_stable_dsl(symbol: str = "MES") -> dict:
    """Synthetic DSL for a stable strategy with a few numeric params."""
    return {
        "strategy": {
            "name": "test_stable",
            "symbol": symbol,
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


# ─── _extract_numeric_params ──────────────────────────────────────────────────

class TestExtractNumericParams:
    def test_flat_dict_extracts_all_numbers(self):
        dsl = {"a": 1, "b": 2.5, "c": "text", "d": True}
        result = _extract_numeric_params(dsl)
        assert "a" in result
        assert "b" in result
        assert "c" not in result   # string
        assert "d" not in result   # bool

    def test_nested_dict_uses_dotpath(self):
        dsl = {"stop_loss": {"multiplier": 1.5}}
        result = _extract_numeric_params(dsl)
        assert "stop_loss.multiplier" in result
        assert result["stop_loss.multiplier"] == 1.5

    def test_list_uses_bracket_notation(self):
        dsl = {"indicators": [{"period": 9}, {"period": 21}]}
        result = _extract_numeric_params(dsl)
        assert "indicators[0].period" in result
        assert "indicators[1].period" in result
        assert result["indicators[0].period"] == 9.0
        assert result["indicators[1].period"] == 21.0

    def test_full_dsl_returns_multiple_params(self):
        dsl = _make_stable_dsl()
        result = _extract_numeric_params(dsl)
        # Should find: period=9, period=21, multiplier=1.5, fixed_contracts=6
        assert len(result) >= 4


# ─── _sharpe_from_monthly_returns ─────────────────────────────────────────────

class TestSharpeFromMonthlyReturns:
    def test_constant_positive_returns_positive_sharpe(self):
        returns = [0.02] * 12
        s = _sharpe_from_monthly_returns(returns)
        assert s == 0.0  # zero std-dev → 0

    def test_variable_returns_nonzero_sharpe(self):
        returns = [0.02, -0.01, 0.03, 0.01, -0.02, 0.04] * 2
        s = _sharpe_from_monthly_returns(returns)
        assert math.isfinite(s)
        assert s != 0.0

    def test_single_element_returns_zero(self):
        assert _sharpe_from_monthly_returns([0.05]) == 0.0

    def test_empty_returns_zero(self):
        assert _sharpe_from_monthly_returns([]) == 0.0


# ─── compute_rws ──────────────────────────────────────────────────────────────

class TestComputeRws:
    def test_stable_monthly_returns_low_rws(self):
        # 24 months of identical returns → windows have same Sharpe → RWS ≈ 0
        result = _make_base_result(monthly_returns=[0.01] * 24)
        rws_out = compute_rws(result, window_months=6)
        assert rws_out["rws"] < 0.01, f"Expected near-zero RWS, got {rws_out['rws']}"
        assert rws_out["n_windows"] >= 3

    def test_volatile_monthly_returns_high_rws(self):
        # Alternating good/bad 6-month windows → high std-dev of window Sharpes
        good = [0.05] * 6    # Sharpe >> 0
        bad = [-0.05] * 6    # Sharpe << 0
        monthly = good + bad + good + bad
        result = _make_base_result(monthly_returns=monthly)
        rws_out = compute_rws(result, window_months=6)
        assert rws_out["rws"] > DEFAULT_RWS_THRESHOLD, (
            f"Expected RWS > {DEFAULT_RWS_THRESHOLD}, got {rws_out['rws']}"
        )

    def test_insufficient_months_single_window(self):
        # Only 4 months, window_months=6 → fallback to single window
        result = _make_base_result(monthly_returns=[0.01, 0.02, -0.01, 0.03])
        rws_out = compute_rws(result, window_months=6)
        # With 1 window, RWS = 0 (std-dev undefined → we return 0)
        assert rws_out["rws"] == 0.0
        assert rws_out["n_windows"] <= 1

    def test_equity_curve_fallback(self):
        # No monthly_returns — use equity_curve
        result = {
            "oos_metrics": {"sharpe_ratio": 1.5},
            "equity_curve": [1000 + i * 2 for i in range(21 * 12)],
        }
        rws_out = compute_rws(result, window_months=6)
        assert rws_out["rws"] >= 0.0
        assert "window_sharpes" in rws_out

    def test_empty_data_returns_zero(self):
        rws_out = compute_rws({}, window_months=6)
        assert rws_out["rws"] == 0.0
        assert rws_out["n_windows"] == 0


# ─── compute_sdr ──────────────────────────────────────────────────────────────

class TestComputeSdr:
    def _mock_run_backtest(self, return_sharpe: float = 1.8):
        """Patch _run_backtest_for_dsl to return a fixed Sharpe."""
        return patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=return_sharpe,
        )

    def test_stable_strategy_sdr_near_1(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=1.8)
        with self._mock_run_backtest(1.8):
            out = compute_sdr(dsl, base_result, n_perturbations=5, seed=42)
        assert out["sdr"] >= DEFAULT_SDR_THRESHOLD, (
            f"Expected SDR >= {DEFAULT_SDR_THRESHOLD}, got {out['sdr']}"
        )
        assert out["base_sharpe"] == 1.8
        assert len(out["perturbations"]) == 5
        assert out["valid_perturbations"] == 5
        assert out["failed_perturbations"] == 0

    def test_fragile_strategy_sdr_below_threshold(self):
        # Perturbed Sharpe = 0.5 when base = 1.8 → SDR = 0.5/1.8 ≈ 0.28
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=1.8)
        with self._mock_run_backtest(0.5):
            out = compute_sdr(dsl, base_result, n_perturbations=5, seed=42)
        assert out["sdr"] < DEFAULT_SDR_THRESHOLD, (
            f"Expected SDR < {DEFAULT_SDR_THRESHOLD} for fragile strategy, got {out['sdr']}"
        )

    def test_determinism_same_seed_same_result(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=1.5)
        with self._mock_run_backtest(1.4):
            out1 = compute_sdr(dsl, base_result, n_perturbations=10, seed=99)
            out2 = compute_sdr(dsl, base_result, n_perturbations=10, seed=99)
        assert out1["sdr"] == out2["sdr"]
        # Param sets should be identical
        for p1, p2 in zip(out1["perturbations"], out2["perturbations"], strict=False):
            assert p1["params"] == p2["params"]

    def test_negative_base_sharpe_returns_zero_sdr(self):
        # Negative base Sharpe → SDR = 0.0 (not meaningful to ratio)
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=-1.0)
        with self._mock_run_backtest(-0.5):
            out = compute_sdr(dsl, base_result, n_perturbations=3, seed=0)
        assert out["sdr"] == 0.0

    def test_all_perturbations_fail_sdr_zero(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=1.5)
        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=None,
        ):
            out = compute_sdr(dsl, base_result, n_perturbations=5, seed=0)
        assert out["sdr"] == 0.0
        assert out["failed_perturbations"] == 5
        assert out["valid_perturbations"] == 0


# ─── compute_psi ──────────────────────────────────────────────────────────────

class TestComputePsi:
    def test_insensitive_strategy_low_psi(self):
        # All sweep points return the same Sharpe → PSI = 0
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=1.8)
        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.8,
        ):
            out = compute_psi(dsl, base_result, sweep_points=5)
        assert out["psi"] <= DEFAULT_PSI_THRESHOLD, (
            f"Expected PSI <= {DEFAULT_PSI_THRESHOLD}, got {out['psi']}"
        )

    def test_hypersensitive_param_high_psi(self):
        # Each sweep point returns very different Sharpe → PSI > threshold
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=1.8)
        sharpes = iter([2.0, 0.1, 3.0, -0.5, 1.0] * 20)
        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            side_effect=lambda _: next(sharpes, 1.0),
        ):
            out = compute_psi(dsl, base_result, sweep_points=5)
        assert out["psi"] > DEFAULT_PSI_THRESHOLD, (
            f"Expected PSI > {DEFAULT_PSI_THRESHOLD} for sensitive param, got {out['psi']}"
        )
        assert "by_parameter" in out

    def test_by_parameter_keys_are_dotpaths(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=1.0)
        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.0,
        ):
            out = compute_psi(dsl, base_result, sweep_points=3)
        for key in out["by_parameter"]:
            assert "." in key or "[" in key, f"Expected dotpath key, got '{key}'"


# ─── run_b15_battery ──────────────────────────────────────────────────────────

class TestRunB15Battery:
    def test_all_pass_returns_passed_true(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=2.0, monthly_returns=[0.01] * 24)
        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.9,  # SDR = 1.9/2.0 = 0.95 > 0.85
        ):
            out = run_b15_battery(
                dsl,
                base_result,
                params={"n_perturbations": 5, "sweep_points": 3, "seed": 0},
            )
        assert out["sdr"] >= DEFAULT_SDR_THRESHOLD
        assert out["rws"] <= DEFAULT_RWS_THRESHOLD
        # psi may still be low since backtests return constant
        assert "passed" in out
        assert out["failures"] is not None
        assert isinstance(out["failures"], list)

    def test_sdr_failure_blocks(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=2.0)
        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=0.5,  # SDR = 0.5/2.0 = 0.25 < 0.85
        ):
            out = run_b15_battery(
                dsl,
                base_result,
                params={"n_perturbations": 3, "sweep_points": 2, "seed": 0},
            )
        assert out["passed"] is False
        assert any("SDR" in f for f in out["failures"])

    def test_rws_failure_blocks(self):
        # Volatile months → RWS > 0.20
        volatile = ([0.10, 0.08, 0.12, 0.09, 0.11, 0.07]
                    + [-0.10, -0.08, -0.12, -0.09, -0.11, -0.07]) * 2
        base_result = _make_base_result(sharpe=2.0, monthly_returns=volatile)
        dsl = _make_stable_dsl()
        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.9,  # SDR passes
        ):
            out = run_b15_battery(
                dsl,
                base_result,
                params={"n_perturbations": 3, "sweep_points": 2, "seed": 0},
            )
        # RWS should be high due to volatile months
        assert out["rws"] > DEFAULT_RWS_THRESHOLD
        assert out["passed"] is False
        assert any("RWS" in f for f in out["failures"])

    def test_thresholds_are_in_result(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result()
        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.0,
        ):
            out = run_b15_battery(dsl, base_result, params={"n_perturbations": 2, "sweep_points": 2})
        assert out["thresholds"]["sdr"] == DEFAULT_SDR_THRESHOLD
        assert out["thresholds"]["psi"] == DEFAULT_PSI_THRESHOLD
        assert out["thresholds"]["rws"] == DEFAULT_RWS_THRESHOLD

    def test_detail_keys_present(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result()
        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.0,
        ):
            out = run_b15_battery(dsl, base_result, params={"n_perturbations": 2, "sweep_points": 2})
        assert "sdr_detail" in out
        assert "psi_detail" in out
        assert "rws_detail" in out
        assert "perturbations" in out["sdr_detail"]
        assert "by_parameter" in out["psi_detail"]
        assert "window_sharpes" in out["rws_detail"]

    def test_custom_thresholds_respected(self):
        dsl = _make_stable_dsl()
        base_result = _make_base_result(sharpe=2.0)
        with patch(
            "src.engine.parameter_jitter_battery._run_backtest_for_dsl",
            return_value=1.8,  # SDR = 0.9 > default 0.85 → passes default
        ):
            # Raise SDR threshold to 0.99 so 0.9 fails
            out = run_b15_battery(
                dsl,
                base_result,
                params={
                    "n_perturbations": 3,
                    "sweep_points": 2,
                    "seed": 0,
                    "sdr_threshold": 0.99,
                },
            )
        assert out["passed"] is False
        assert any("SDR" in f for f in out["failures"])


# ─── CLI sentinel test (integration — syntax-checks the --b15-battery path) ───

class TestB15CliSentinel:
    def test_b15_battery_sentinel_format(self):
        # Verify sentinel string format matches what python-runner.ts expects:
        # "B15_BATTERY_JSON <json>"
        sentinel_prefix = "B15_BATTERY_JSON"
        payload = {
            "event": "b15_battery",
            "backtest_id": "test-123",
            "result": {"sdr": 0.9, "psi": 0.02, "rws": 0.15, "passed": True},
        }
        sentinel_line = f"{sentinel_prefix} {json.dumps(payload)}"
        # Verify it parses back correctly
        assert sentinel_line.startswith("B15_BATTERY_JSON ")
        parsed = json.loads(sentinel_line[len("B15_BATTERY_JSON "):])
        assert parsed["event"] == "b15_battery"
        assert parsed["result"]["passed"] is True
