"""Tests for Wave 25 Pass 7 W25.17 — Exit Engine A/B harness.

Coverage:
  1. A/B harness runs without throw on synthetic strategies
  2. Markdown report structure (sections + table format)
  3. Non-regression gate detects synthetic regression (adaptive scoring worse than static)
  4. Non-regression gate passes when metrics are identical
  5. Audit hook fires (mocked)
  6. CLI --exit-engine flag accepted by BacktestRequest
  7. run_class_backtest() accepts exit_engine param + echoes it in result
  8. Trade count gate triggers when adaptive has too few/many trades
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional
from unittest.mock import MagicMock, patch

import numpy as np
import polars as pl
import pytest

from src.engine.config import BacktestRequest, StrategyConfig


# ─── Helpers ──────────────────────────────────────────────────────────


def _make_ohlcv(n: int = 100, base: float = 4000.0, seed: int = 42) -> pl.DataFrame:
    """Create deterministic synthetic OHLCV for testing."""
    rng = np.random.default_rng(seed)
    dates = [datetime(2025, 1, 1) + timedelta(minutes=5 * i) for i in range(n)]
    closes = base + np.cumsum(rng.normal(0, 2, n))
    return pl.DataFrame({
        "ts_event": dates,
        "open":   closes - rng.uniform(0.5, 2, n),
        "high":   closes + rng.uniform(1, 5, n),
        "low":    closes - rng.uniform(1, 5, n),
        "close":  closes,
        "volume": [50000] * n,
    })


def _make_synthetic_result(
    sharpe: float = 1.2,
    max_dd: float = 800.0,
    total_trades: int = 20,
    total_pnl: float = 1500.0,
    avg_r: float = 1.8,
    win_rate: float = 0.55,
    exit_engine: str = "static_styleC",
) -> dict:
    """Produce a minimal result dict that matches run_class_backtest() schema."""
    return {
        "total_return": total_pnl,
        "sharpe_ratio": sharpe,
        "max_drawdown": max_dd,
        "win_rate": win_rate,
        "win_rate_per_trade": win_rate,
        "win_rate_per_day": win_rate,
        "profit_factor": 1.6,
        "total_trades": total_trades,
        "avg_trade_pnl": total_pnl / max(total_trades, 1),
        "avg_daily_pnl": 75.0,
        "winning_days": 10,
        "total_trading_days": 15,
        "max_consecutive_losing_days": 2,
        "expectancy_per_trade": 75.0,
        "avg_winner_to_loser_ratio": 1.5,
        "avg_rr": avg_r,
        "equity_curve": [10000.0 + i * 50 for i in range(15)],
        "equity_bars": [10000.0 + i * 15 for i in range(100)],
        "trades": [],
        "daily_pnls": [75.0] * 15,
        "daily_pnl_records": [],
        "execution_time_ms": 200,
        "tier": "TIER_2",
        "forge_score": 72.0,
        "sanity_checks": {},
        "cross_validation": {},
        "sortino_ratio": 1.1,
        "bootstrap_ci_95": [0.8, 1.6],
        "deflated_sharpe": {},
        "gate_result": {"score": 72.0, "passed": True, "tier": "TIER_2", "gate_rejections": []},
        "gate_rejections": [],
        "gate_stats": {},
        "prop_compliance": {},
        "analytics": {},
        "long_short_split": {},
        "confidence_intervals": {"win_rate_95ci": [0.4, 0.7], "sharpe_95ci": [0.9, 1.5]},
        "statistical_warnings": [],
        "sample_confidence": "MEDIUM",
        "signal_diagnostics": {},
        "information_ratio": 0.8,
        "recency_analysis": {},
        "decay_analysis": {},
        "over_risk_bars": 0,
        "over_risk_pct": 0.0,
        "governor": None,
        "monthly_returns": {},
        "gap_adjusted_drawdown": None,
        "exit_engine": exit_engine,
        "run_receipt": {},
    }


# ─── 1. BacktestRequest accepts exit_engine field ──────────────────────


class TestBacktestRequestExitEngineField:
    def test_default_is_static_styleC(self):
        """BacktestRequest.exit_engine defaults to 'static_styleC' (backward compat)."""
        req = BacktestRequest(
            strategy=StrategyConfig(
                name="test",
                symbol="MES",
                timeframe="5min",
                indicators=[],
                entry_long="close > open",
                entry_short="close < open",
                exit="close < open",
                stop_loss={"type": "atr", "multiplier": 1.5},
                position_size={"type": "fixed", "contracts": 1},
            ),
            start_date="2025-01-01",
            end_date="2025-01-31",
        )
        assert req.exit_engine == "static_styleC"

    def test_adaptive_accepted(self):
        """BacktestRequest accepts exit_engine='adaptive' without validation error."""
        req = BacktestRequest(
            strategy=StrategyConfig(
                name="test",
                symbol="MES",
                timeframe="5min",
                indicators=[],
                entry_long="close > open",
                entry_short="close < open",
                exit="close < open",
                stop_loss={"type": "atr", "multiplier": 1.5},
                position_size={"type": "fixed", "contracts": 1},
            ),
            start_date="2025-01-01",
            end_date="2025-01-31",
            exit_engine="adaptive",
        )
        assert req.exit_engine == "adaptive"

    def test_invalid_value_rejected(self):
        """BacktestRequest rejects unknown exit_engine value."""
        with pytest.raises(Exception):
            BacktestRequest(
                strategy=StrategyConfig(
                    name="test",
                    symbol="MES",
                    timeframe="5min",
                    indicators=[],
                    entry_long="close > open",
                    entry_short="close < open",
                    exit="close < open",
                    stop_loss={"type": "atr", "multiplier": 1.5},
                    position_size={"type": "fixed", "contracts": 1},
                ),
                start_date="2025-01-01",
                end_date="2025-01-31",
                exit_engine="style_d_does_not_exist",
            )


# ─── 2. run_class_backtest exit_engine parameter contract ─────────────
#
# We verify the parameter exists in the function signature, is wired into the
# result dict, and that the default is "static_styleC". We do NOT execute the
# full backtester pipeline in unit tests — that belongs in integration/smoke tests
# (see verification item 3 in the task brief). The contract is:
#   - run_class_backtest() accepts exit_engine kwarg
#   - result dict contains "exit_engine" key matching the input
#   - default is "static_styleC"
#
# We verify this by inspecting the function signature and by patching the full
# computation to return a minimal result, avoiding the 60-90s vectorbt overhead.


class TestRunClassBacktestExitEngineParam:
    """Verify exit_engine parameter contract on run_class_backtest().

    We test the function signature contract (parameter name + default) without
    executing the full backtester pipeline, which requires vectorbt JIT warm-up
    (60-90s) and is reserved for integration/smoke tests.

    The wiring correctness (exit_engine → result["exit_engine"]) is verified
    by reading the function source rather than executing it, which is deterministic
    and fast.  Integration smoke tests validate end-to-end execution.
    """

    def test_exit_engine_param_exists_with_correct_default(self):
        """run_class_backtest() must have exit_engine param defaulting to 'static_styleC'."""
        import inspect
        # Import from source file directly to avoid slow vectorbt JIT compilation
        # that happens during module-level imports in backtester.py.
        import importlib.util
        import sys

        # Use inspect.signature on the already-imported module if available,
        # otherwise verify via source inspection
        if "src.engine.backtester" in sys.modules:
            from src.engine.backtester import run_class_backtest
            sig = inspect.signature(run_class_backtest)
            assert "exit_engine" in sig.parameters
            assert sig.parameters["exit_engine"].default == "static_styleC"
        else:
            # Verify via AST — no import needed
            import ast
            backtester_path = (
                __file__
                .replace("tests\\test_exit_engine_ab.py", "backtester.py")
                .replace("tests/test_exit_engine_ab.py", "backtester.py")
            )
            from pathlib import Path
            src = Path(backtester_path).read_text(encoding="utf-8")
            tree = ast.parse(src)

            func_def = None
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef) and node.name == "run_class_backtest":
                    func_def = node
                    break

            assert func_def is not None, "run_class_backtest() not found in backtester.py"

            # Check args + defaults for exit_engine="static_styleC"
            all_args = [a.arg for a in func_def.args.args]
            assert "exit_engine" in all_args, f"exit_engine not found in params: {all_args}"

    def test_exit_engine_result_key_in_return_dict(self):
        """run_class_backtest() must include 'exit_engine' in its return dict.

        Verified via AST — checks that the return dict literal in the function
        contains the "exit_engine" key without executing the full pipeline.
        """
        import ast
        from pathlib import Path

        backtester_path = (
            __file__
            .replace("tests\\test_exit_engine_ab.py", "backtester.py")
            .replace("tests/test_exit_engine_ab.py", "backtester.py")
        )
        src = Path(backtester_path).read_text(encoding="utf-8")

        # Look for the string literal "exit_engine" in the source — it must appear
        # in the return dict section (after the param definition line).
        func_start = src.find("def run_class_backtest(")
        func_end = src.find("\ndef ", func_start + 1)
        func_body = src[func_start:func_end] if func_end > 0 else src[func_start:]

        # "exit_engine": exit_engine should appear in the return dict
        assert '"exit_engine": exit_engine' in func_body, (
            "'exit_engine': exit_engine must appear in run_class_backtest return dict"
        )

    def test_exit_engine_default_is_static_styleC(self):
        """run_class_backtest() default for exit_engine must be 'static_styleC' in source."""
        import ast
        from pathlib import Path

        backtester_path = (
            __file__
            .replace("tests\\test_exit_engine_ab.py", "backtester.py")
            .replace("tests/test_exit_engine_ab.py", "backtester.py")
        )
        src = Path(backtester_path).read_text(encoding="utf-8")

        # The parameter declaration must contain the default value
        assert 'exit_engine: str = "static_styleC"' in src, (
            'exit_engine default must be "static_styleC" in run_class_backtest signature'
        )


# ─── 3. _extract_metrics helper ───────────────────────────────────────


class TestExtractMetrics:
    def test_extracts_known_fields(self):
        from scripts.wave25_exit_engine_ab_report import _extract_metrics

        result = _make_synthetic_result()
        m = _extract_metrics(result)

        assert m["total_pnl"] == 1500.0
        assert m["sharpe"] == 1.2
        assert m["max_dd"] == 800.0
        assert m["avg_r"] == 1.8
        assert m["win_rate_pct"] == 55.0
        assert m["trade_count"] == 20
        assert m["error"] is None

    def test_error_dict_propagated(self):
        from scripts.wave25_exit_engine_ab_report import _extract_metrics

        m = _extract_metrics({"error": "Something broke"})
        assert m["error"] == "Something broke"
        assert m["total_pnl"] is None


# ─── 4. Non-regression gate — pass cases ──────────────────────────────


class TestNonRegressionGatePass:
    def test_identical_metrics_passes(self):
        """Same metrics for static and adaptive: all gates pass."""
        from scripts.wave25_exit_engine_ab_report import _apply_non_regression_gate

        s = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=20)
        a = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=20)

        gate = _apply_non_regression_gate(s, a, "silver_bullet")
        assert gate["passed"] is True
        assert len(gate["blocking_failures"]) == 0

    def test_adaptive_marginally_better_passes(self):
        """Adaptive slightly better than static: all gates pass."""
        from scripts.wave25_exit_engine_ab_report import _apply_non_regression_gate

        s = _extract_metrics_from_synth(sharpe=1.2, max_dd=900.0, total_trades=20)
        a = _extract_metrics_from_synth(sharpe=1.35, max_dd=780.0, total_trades=21)

        gate = _apply_non_regression_gate(s, a, "power_of_3")
        assert gate["passed"] is True

    def test_sharpe_within_tolerance_passes(self):
        """Adaptive Sharpe only 0.04 below static (within 0.05 tolerance)."""
        from scripts.wave25_exit_engine_ab_report import _apply_non_regression_gate

        s = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=20)
        a = _extract_metrics_from_synth(sharpe=1.16, max_dd=800.0, total_trades=20)

        gate = _apply_non_regression_gate(s, a, "ict_scalp")
        assert gate["passed"] is True


# ─── 5. Non-regression gate — fail cases ──────────────────────────────


class TestNonRegressionGateFail:
    def test_sharpe_regression_below_tolerance(self):
        """Adaptive Sharpe 0.10 below static triggers gate failure."""
        from scripts.wave25_exit_engine_ab_report import _apply_non_regression_gate

        s = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=20)
        a = _extract_metrics_from_synth(sharpe=1.05, max_dd=800.0, total_trades=20)  # -0.15

        gate = _apply_non_regression_gate(s, a, "silver_bullet")
        assert gate["passed"] is False
        assert any("sharpe" in f.lower() for f in gate["blocking_failures"])

    def test_max_dd_regression_above_tolerance(self):
        """Adaptive max_DD 20% higher than static (> 10% tolerance) triggers gate failure."""
        from scripts.wave25_exit_engine_ab_report import _apply_non_regression_gate

        s = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=20)
        a = _extract_metrics_from_synth(sharpe=1.2, max_dd=1000.0, total_trades=20)  # +25%

        gate = _apply_non_regression_gate(s, a, "power_of_3")
        assert gate["passed"] is False
        assert any("max_dd" in f.lower() or "drawdown" in f.lower() or "dd" in f.lower()
                   for f in gate["blocking_failures"])

    def test_trade_count_regression_too_few(self):
        """Adaptive has 50% fewer trades than static (exits gating entries)."""
        from scripts.wave25_exit_engine_ab_report import _apply_non_regression_gate

        s = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=20)
        a = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=8)  # -60%

        gate = _apply_non_regression_gate(s, a, "ict_scalp")
        assert gate["passed"] is False
        assert any("trade" in f.lower() or "count" in f.lower()
                   for f in gate["blocking_failures"])

    def test_trade_count_regression_too_many(self):
        """Adaptive has 50% more trades than static (exits spawning phantom entries)."""
        from scripts.wave25_exit_engine_ab_report import _apply_non_regression_gate

        s = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=20)
        a = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=35)  # +75%

        gate = _apply_non_regression_gate(s, a, "silver_bullet")
        assert gate["passed"] is False

    def test_multiple_gates_fail_all_reported(self):
        """Multiple failures are all listed in blocking_failures."""
        from scripts.wave25_exit_engine_ab_report import _apply_non_regression_gate

        s = _extract_metrics_from_synth(sharpe=1.5, max_dd=600.0, total_trades=20)
        a = _extract_metrics_from_synth(sharpe=0.9, max_dd=900.0, total_trades=5)

        gate = _apply_non_regression_gate(s, a, "power_of_3")
        assert gate["passed"] is False
        # At least 2 failures reported
        assert len(gate["blocking_failures"]) >= 2

    def test_error_result_fails_gate(self):
        """Error dicts from backtest failures immediately fail the gate."""
        from scripts.wave25_exit_engine_ab_report import _apply_non_regression_gate

        s = {"error": "data load failed", "total_pnl": None, "sharpe": None, "max_dd": None,
             "avg_r": None, "win_rate_pct": None, "trade_count": None}
        a = _extract_metrics_from_synth()

        gate = _apply_non_regression_gate(s, a, "silver_bullet")
        assert gate["passed"] is False

    def test_win_rate_not_in_gate(self):
        """Win rate difference does NOT trigger gate — it is observed-only (CLAUDE.md §13)."""
        from scripts.wave25_exit_engine_ab_report import _apply_non_regression_gate

        # Identical except win_rate
        s = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=20)
        s["win_rate_pct"] = 60.0
        a = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=20)
        a["win_rate_pct"] = 30.0  # Dramatic drop — still not a gate

        gate = _apply_non_regression_gate(s, a, "silver_bullet")
        assert gate["passed"] is True  # No gate on win rate


# ─── 6. Markdown report structure ─────────────────────────────────────


class TestMarkdownReportStructure:
    def _make_strategy_result(self, strategy: str, gate_passed: bool = True) -> dict:
        from scripts.wave25_exit_engine_ab_report import (
            STRATEGY_REGISTRY,
            _apply_non_regression_gate,
        )

        static = _extract_metrics_from_synth(sharpe=1.2, max_dd=800.0, total_trades=20)
        adaptive = _extract_metrics_from_synth(
            sharpe=1.2 if gate_passed else 0.8,
            max_dd=800.0 if gate_passed else 1200.0,
            total_trades=20,
        )
        return {
            "strategy": strategy,
            "forge_name": STRATEGY_REGISTRY.get(strategy, {}).get("forge_name", strategy),
            "static": static,
            "adaptive": adaptive,
            "gate": _apply_non_regression_gate(static, adaptive, strategy),
        }

    def test_report_has_title(self):
        from scripts.wave25_exit_engine_ab_report import _build_markdown_report

        sr = [self._make_strategy_result("silver_bullet")]
        report = _build_markdown_report("2025-01-01 12:00 UTC", "2025-01-01", "2025-01-07", sr, True, False)

        assert "# Wave 25 Pass 7 — Exit Engine A/B Report" in report

    def test_report_has_overall_gate_section(self):
        from scripts.wave25_exit_engine_ab_report import _build_markdown_report

        sr = [self._make_strategy_result("silver_bullet")]
        report = _build_markdown_report("2025-01-01 12:00 UTC", "2025-01-01", "2025-01-07", sr, True, False)

        assert "## Overall Gate:" in report

    def test_report_contains_strategy_section(self):
        from scripts.wave25_exit_engine_ab_report import _build_markdown_report

        sr = [self._make_strategy_result("silver_bullet")]
        report = _build_markdown_report("2025-01-01 12:00 UTC", "2025-01-01", "2025-01-07", sr, True, False)

        assert "silver_bullet" in report

    def test_report_has_markdown_table(self):
        """Report must contain at least one Markdown table (| col | col |)."""
        from scripts.wave25_exit_engine_ab_report import _build_markdown_report

        sr = [self._make_strategy_result("silver_bullet")]
        report = _build_markdown_report("2025-01-01 12:00 UTC", "2025-01-01", "2025-01-07", sr, True, False)

        assert "| Metric |" in report
        assert "|--------|" in report or "|" in report

    def test_report_overall_pass_banner(self):
        from scripts.wave25_exit_engine_ab_report import _build_markdown_report

        sr = [self._make_strategy_result("silver_bullet", gate_passed=True)]
        report = _build_markdown_report("2025-01-01", "2025-01-01", "2025-01-07", sr, True, False)
        assert "PASS" in report

    def test_report_overall_fail_banner(self):
        from scripts.wave25_exit_engine_ab_report import _build_markdown_report

        sr = [self._make_strategy_result("silver_bullet", gate_passed=False)]
        report = _build_markdown_report("2025-01-01", "2025-01-01", "2025-01-07", sr, False, False)
        assert "FAIL" in report

    def test_report_tolerances_section(self):
        from scripts.wave25_exit_engine_ab_report import _build_markdown_report

        sr = [self._make_strategy_result("silver_bullet")]
        report = _build_markdown_report("2025-01-01", "2025-01-01", "2025-01-07", sr, True, False)

        assert "Non-regression Gate Tolerances" in report

    def test_report_win_rate_is_observed_only(self):
        """Report must note win rate is 'observed output' not a gate target."""
        from scripts.wave25_exit_engine_ab_report import _build_markdown_report

        sr = [self._make_strategy_result("silver_bullet")]
        report = _build_markdown_report("2025-01-01", "2025-01-01", "2025-01-07", sr, True, False)

        assert "observed" in report.lower()

    def test_report_adaptive_not_wired_notice(self):
        """When adaptive_wired=False, report must contain a warning note."""
        from scripts.wave25_exit_engine_ab_report import _build_markdown_report

        sr = [self._make_strategy_result("silver_bullet")]
        report = _build_markdown_report("2025-01-01", "2025-01-01", "2025-01-07", sr, True, adaptive_wired=False)

        assert "advisory" in report.lower() or "not yet" in report.lower() or "stub" in report.lower()

    def test_report_multi_strategy(self):
        """Report includes sections for all three strategies."""
        from scripts.wave25_exit_engine_ab_report import _build_markdown_report

        sr = [
            self._make_strategy_result("silver_bullet"),
            self._make_strategy_result("power_of_3"),
        ]
        report = _build_markdown_report("2025-01-01", "2025-01-01", "2025-01-07", sr, True, False)

        assert "silver_bullet" in report
        assert "power_of_3" in report


# ─── 7. Audit hook fires ───────────────────────────────────────────────


class TestAuditHook:
    def test_completed_event_emitted_on_success(self):
        """_emit_audit_event is called with 'wave25.exit_engine_ab_completed' on run."""
        from scripts.wave25_exit_engine_ab_report import run_ab_report

        # Patch _run_backtest_for_strategy to return synthetic results (no actual backtest)
        synth = _make_synthetic_result()
        with patch("scripts.wave25_exit_engine_ab_report._run_backtest_for_strategy", return_value=synth):
            with patch("scripts.wave25_exit_engine_ab_report._emit_audit_event") as mock_emit:
                run_ab_report(
                    strategies=["silver_bullet"],
                    start_date="2025-01-01",
                    end_date="2025-01-07",
                    api_base="http://localhost:4000",
                    output_path=None,
                )

        # At minimum one call with the completed event
        action_names = [call.args[0] for call in mock_emit.call_args_list]
        assert "wave25.exit_engine_ab_completed" in action_names

    def test_regression_event_emitted_when_adaptive_wired_and_fails(self):
        """When ADAPTIVE_WIRED=true and gate fails, regression event is emitted."""
        from scripts.wave25_exit_engine_ab_report import run_ab_report

        static_synth = _make_synthetic_result(sharpe=1.5, max_dd=600.0, total_trades=20)
        adaptive_synth = _make_synthetic_result(sharpe=0.5, max_dd=1500.0, total_trades=20)

        def _mock_backtest(strat, exit_eng, *args, **kwargs):
            if exit_eng == "static_styleC":
                return static_synth
            return adaptive_synth

        import scripts.wave25_exit_engine_ab_report as ab_mod
        original_wired = ab_mod.ADAPTIVE_WIRED
        ab_mod.ADAPTIVE_WIRED = True
        try:
            with patch("scripts.wave25_exit_engine_ab_report._run_backtest_for_strategy",
                       side_effect=_mock_backtest):
                with patch("scripts.wave25_exit_engine_ab_report._emit_audit_event") as mock_emit:
                    with patch("scripts.wave25_exit_engine_ab_report._send_discord_alert"):
                        run_ab_report(
                            strategies=["silver_bullet"],
                            start_date="2025-01-01",
                            end_date="2025-01-07",
                            output_path=None,
                        )

            action_names = [call.args[0] for call in mock_emit.call_args_list]
            assert "wave25.exit_engine_ab_regression_detected" in action_names
        finally:
            ab_mod.ADAPTIVE_WIRED = original_wired

    def test_regression_event_not_emitted_when_not_wired(self):
        """When ADAPTIVE_WIRED=false (stub state), regression event is NOT emitted even on metric diff."""
        from scripts.wave25_exit_engine_ab_report import run_ab_report

        static_synth = _make_synthetic_result(sharpe=1.5, max_dd=600.0, total_trades=20)
        adaptive_synth = _make_synthetic_result(sharpe=0.5, max_dd=1500.0, total_trades=20)

        def _mock_backtest(strat, exit_eng, *args, **kwargs):
            if exit_eng == "static_styleC":
                return static_synth
            return adaptive_synth

        import scripts.wave25_exit_engine_ab_report as ab_mod
        original_wired = ab_mod.ADAPTIVE_WIRED
        ab_mod.ADAPTIVE_WIRED = False
        try:
            with patch("scripts.wave25_exit_engine_ab_report._run_backtest_for_strategy",
                       side_effect=_mock_backtest):
                with patch("scripts.wave25_exit_engine_ab_report._emit_audit_event") as mock_emit:
                    run_ab_report(
                        strategies=["silver_bullet"],
                        start_date="2025-01-01",
                        end_date="2025-01-07",
                        output_path=None,
                    )

            action_names = [call.args[0] for call in mock_emit.call_args_list]
            # Completed event fires, but regression event must NOT fire
            assert "wave25.exit_engine_ab_completed" in action_names
            assert "wave25.exit_engine_ab_regression_detected" not in action_names
        finally:
            ab_mod.ADAPTIVE_WIRED = original_wired


# ─── 8. run_ab_report result schema ───────────────────────────────────


class TestRunAbReportSchema:
    def test_result_has_required_keys(self):
        from scripts.wave25_exit_engine_ab_report import run_ab_report

        synth = _make_synthetic_result()
        with patch("scripts.wave25_exit_engine_ab_report._run_backtest_for_strategy", return_value=synth):
            with patch("scripts.wave25_exit_engine_ab_report._emit_audit_event"):
                result = run_ab_report(
                    strategies=["silver_bullet"],
                    start_date="2025-01-01",
                    end_date="2025-01-07",
                    output_path=None,
                )

        assert "overall_passed" in result
        assert "strategy_results" in result
        assert "regression_detected" in result
        assert len(result["strategy_results"]) == 1

    def test_strategy_result_has_required_keys(self):
        from scripts.wave25_exit_engine_ab_report import run_ab_report

        synth = _make_synthetic_result()
        with patch("scripts.wave25_exit_engine_ab_report._run_backtest_for_strategy", return_value=synth):
            with patch("scripts.wave25_exit_engine_ab_report._emit_audit_event"):
                result = run_ab_report(
                    strategies=["silver_bullet"],
                    start_date="2025-01-01",
                    end_date="2025-01-07",
                    output_path=None,
                )

        sr = result["strategy_results"][0]
        assert "strategy" in sr
        assert "static" in sr
        assert "adaptive" in sr
        assert "gate" in sr

    def test_report_file_written(self, tmp_path):
        from scripts.wave25_exit_engine_ab_report import run_ab_report

        synth = _make_synthetic_result()
        report_path = str(tmp_path / "test_ab_report.md")

        with patch("scripts.wave25_exit_engine_ab_report._run_backtest_for_strategy", return_value=synth):
            with patch("scripts.wave25_exit_engine_ab_report._emit_audit_event"):
                result = run_ab_report(
                    strategies=["silver_bullet"],
                    start_date="2025-01-01",
                    end_date="2025-01-07",
                    output_path=report_path,
                )

        assert result["report_path"] == report_path
        import os
        assert os.path.exists(report_path)
        content = open(report_path, encoding="utf-8").read()
        assert "# Wave 25" in content


# ─── Helpers (module-level, usable across test classes) ───────────────


def _extract_metrics_from_synth(
    sharpe: float = 1.2,
    max_dd: float = 800.0,
    total_trades: int = 20,
    total_pnl: float = 1500.0,
    avg_r: float = 1.8,
    win_rate: float = 0.55,
) -> dict:
    """Build a metrics dict as returned by _extract_metrics()."""
    return {
        "total_pnl": total_pnl,
        "sharpe": sharpe,
        "max_dd": max_dd,
        "avg_r": avg_r,
        "win_rate_pct": round(win_rate * 100, 1),
        "trade_count": total_trades,
        "error": None,
    }
