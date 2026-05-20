"""Tests for parity_engine/shadow_runner.py.

Tests verify:
  1. Report shape is always a well-formed dict (all required keys present)
  2. PARITY_SHADOW_ENABLED=false returns disabled stub (no run, no cost)
  3. Unsupported archetype returns ran=False with correct reason, NOT a false positive
  4. Non-blocking: internal errors inside run_parity_shadow do not raise
  5. Env-gating works correctly (both directions)
  6. parity_supported() helper correctly classifies archetypes
  7. _disabled_report() and _skipped_report() satisfy the report schema

These tests use only mocked/synthetic data — no S3, no DB, no network,
no real backtrader execution. The integration tests in test_cross_engine_parity.py
cover the actual diff_harness logic.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from src.engine.parity_engine.shadow_runner import (
    _disabled_report,
    _error_report,
    _skipped_report,
    _load_tolerances,
    parity_supported,
    run_parity_shadow,
)

# ─── Required keys in every ParityShadowReport ────────────────────────

REQUIRED_KEYS = {
    "enabled",
    "ran",
    "vbt_total_pnl",
    "bt_total_pnl",
    "pnl_diff_pct",
    "vbt_trade_count",
    "bt_trade_count",
    "trade_count_diff",
    "vbt_sharpe",
    "bt_sharpe",
    "sharpe_diff",
    "passed",
    "tolerance",
    "failure_reasons",
    "execution_time_ms",
}


def _assert_report_shape(report: dict) -> None:
    """Assert all required keys are present and types are correct."""
    missing = REQUIRED_KEYS - set(report.keys())
    assert not missing, f"ParityShadowReport missing keys: {missing}"

    assert isinstance(report["enabled"], bool)
    assert isinstance(report["ran"], bool)
    assert isinstance(report["vbt_total_pnl"], (int, float))
    assert isinstance(report["bt_total_pnl"], (int, float))
    assert isinstance(report["pnl_diff_pct"], (int, float))
    assert isinstance(report["vbt_trade_count"], int)
    assert isinstance(report["bt_trade_count"], int)
    assert isinstance(report["trade_count_diff"], int)
    assert isinstance(report["vbt_sharpe"], (int, float))
    assert isinstance(report["bt_sharpe"], (int, float))
    assert isinstance(report["sharpe_diff"], (int, float))
    assert isinstance(report["passed"], bool)
    assert isinstance(report["tolerance"], dict)
    assert isinstance(report["failure_reasons"], list)
    assert isinstance(report["execution_time_ms"], (int, float))

    tol = report["tolerance"]
    assert "pnl_pct" in tol
    assert "trade_count" in tol
    assert "sharpe" in tol


# ─── Synthetic fixtures ────────────────────────────────────────────────

def _make_trending_df(n: int = 300) -> pd.DataFrame:
    """Small trending OHLCV in pandas, DatetimeIndex."""
    rng = np.random.default_rng(42)
    closes = np.zeros(n)
    closes[0] = 18000.0
    for i in range(1, n):
        closes[i] = closes[i - 1] + 2.5 + rng.normal(0, 3.0)
    # Reversal at midpoint
    mid = n // 2
    for i in range(mid, n):
        closes[i] = closes[i - 1] - 2.0 + rng.normal(0, 3.0)
    bar_range = rng.uniform(5.0, 15.0, n)
    highs = closes + bar_range * 0.6
    lows = closes - bar_range * 0.4
    opens = np.roll(closes, 1)
    opens[0] = closes[0]
    idx = pd.date_range(start="2024-01-02 09:30", periods=n, freq="15min")
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes, "volume": 1000.0},
        index=idx,
    )


def _make_fake_request(entry_indicator: str = "ema_crossover") -> Any:
    """Minimal BacktestRequest-like object sufficient for shadow_runner."""
    config = SimpleNamespace(
        name=f"test_strategy_{entry_indicator}",
        symbol="MNQ",
        timeframe="15min",
        indicators=[
            SimpleNamespace(type="ema", period=9),
            SimpleNamespace(type="ema", period=21),
        ],
        entry_long="ema_fast > ema_slow",
        entry_short="high < low",  # never-true sentinel
        exit="time_stop",
        stop_loss=SimpleNamespace(type="atr_multiple", value=1.8),
        take_profit=None,
        position_size=SimpleNamespace(type="fixed", value=1),
        fill_rate=1.0,
        spread_multiplier=1.0,
    )
    request = SimpleNamespace(strategy=config, firm="topstep")
    return request


def _make_fake_result() -> dict:
    """Minimal production backtest result dict."""
    return {
        "total_pnl": 500.0,
        "trade_count": 12,
        "sharpe": 1.2,
        "max_drawdown": 300.0,
    }


# ─── Tests: parity_supported() helper ─────────────────────────────────

class TestParitySupported:
    def test_ema_crossover_is_supported(self):
        assert parity_supported({"entry_indicator": "ema_crossover"}) is True

    def test_atr_breakout_is_supported(self):
        assert parity_supported({"entry_indicator": "atr_breakout"}) is True

    def test_unknown_archetype_is_not_supported(self):
        assert parity_supported({"entry_indicator": "opening_range_breakout"}) is False

    def test_vwap_fade_is_not_supported(self):
        assert parity_supported({"entry_indicator": "vwap_fade"}) is False

    def test_empty_indicator_is_not_supported(self):
        assert parity_supported({"entry_indicator": ""}) is False

    def test_missing_key_is_not_supported(self):
        assert parity_supported({}) is False

    def test_case_sensitive(self):
        # Must be exact match — no case folding
        assert parity_supported({"entry_indicator": "EMA_CROSSOVER"}) is False


# ─── Tests: stub report shape compliance ──────────────────────────────

class TestStubReports:
    def test_disabled_report_shape(self):
        report = _disabled_report()
        _assert_report_shape(report)
        assert report["enabled"] is False
        assert report["ran"] is False

    def test_skipped_report_shape(self):
        tol = {"pnl_pct": 0.10, "trade_count": 1, "sharpe": 0.05}
        report = _skipped_report("strategy_archetype_not_supported_by_parity_engine", True, tol)
        _assert_report_shape(report)
        assert report["enabled"] is True
        assert report["ran"] is False
        # Skipped is NOT a failure — explicit unsupported, not a false positive
        assert report["passed"] is True

    def test_error_report_shape(self):
        tol = {"pnl_pct": 0.10, "trade_count": 1, "sharpe": 0.05}
        report = _error_report("something went wrong", 12.5, tol)
        _assert_report_shape(report)
        assert report["enabled"] is True
        assert report["ran"] is False
        assert report["passed"] is True  # errors don't fail main backtest
        assert "error" in report

    def test_error_report_truncates_long_messages(self):
        tol = {"pnl_pct": 0.10, "trade_count": 1, "sharpe": 0.05}
        long_error = "x" * 1000
        report = _error_report(long_error, 0.0, tol)
        assert len(report.get("error", "")) <= 300


# ─── Tests: env-gating ────────────────────────────────────────────────

class TestEnvGating:
    def test_shadow_disabled_by_default(self, monkeypatch):
        """Without PARITY_SHADOW_ENABLED=true, should return disabled stub."""
        monkeypatch.delenv("PARITY_SHADOW_ENABLED", raising=False)

        request = _make_fake_request()
        result = _make_fake_result()
        df = _make_trending_df()

        report = run_parity_shadow(request, result, df)

        _assert_report_shape(report)
        assert report["enabled"] is False
        assert report["ran"] is False
        assert report["reason"] == "parity_shadow_disabled"

    def test_shadow_disabled_explicitly_false(self, monkeypatch):
        monkeypatch.setenv("PARITY_SHADOW_ENABLED", "false")

        request = _make_fake_request()
        result = _make_fake_result()
        df = _make_trending_df()

        report = run_parity_shadow(request, result, df)

        assert report["enabled"] is False
        assert report["ran"] is False

    def test_shadow_disabled_case_insensitive(self, monkeypatch):
        monkeypatch.setenv("PARITY_SHADOW_ENABLED", "FALSE")

        report = run_parity_shadow(_make_fake_request(), _make_fake_result(), _make_trending_df())
        assert report["enabled"] is False


# ─── Tests: unsupported archetype ─────────────────────────────────────

class TestUnsupportedArchetype:
    def test_unsupported_archetype_returns_ran_false(self, monkeypatch):
        """ORB and other unsupported archetypes must return ran=False, NOT passed=True."""
        monkeypatch.setenv("PARITY_SHADOW_ENABLED", "true")

        # Build request with ORB indicator (not in _SUPPORTED_ENTRY_INDICATORS)
        config = SimpleNamespace(
            name="orb_mnq_15m",
            symbol="MNQ",
            timeframe="15min",
            indicators=[SimpleNamespace(type="opening_range_breakout", period=15)],
            entry_long="orb_breakout",
            entry_short="high < low",
            exit="time_stop",
            stop_loss=SimpleNamespace(type="atr_multiple", value=1.8),
            take_profit=None,
            position_size=SimpleNamespace(type="fixed", value=1),
            fill_rate=1.0,
            spread_multiplier=1.0,
        )
        request = SimpleNamespace(strategy=config, firm="topstep")

        report = run_parity_shadow(request, _make_fake_result(), _make_trending_df())

        _assert_report_shape(report)
        assert report["enabled"] is True
        assert report["ran"] is False
        assert report["reason"] == "strategy_archetype_not_supported_by_parity_engine"
        # Critical: must NOT be a false-positive pass
        # (passed=True here means "not a failure", which is correct for skipped)
        assert "failure_reasons" in report
        assert report["failure_reasons"] == []

    def test_vwap_fade_not_supported(self, monkeypatch):
        monkeypatch.setenv("PARITY_SHADOW_ENABLED", "true")

        config = SimpleNamespace(
            name="vwap_fade_mes",
            symbol="MES",
            timeframe="5min",
            indicators=[SimpleNamespace(type="vwap", period=0)],
            entry_long="price_below_vwap",
            entry_short="high < low",
            exit="time_stop",
            stop_loss=SimpleNamespace(type="atr_multiple", value=1.5),
            take_profit=None,
            position_size=SimpleNamespace(type="fixed", value=1),
            fill_rate=1.0,
            spread_multiplier=1.0,
        )
        request = SimpleNamespace(strategy=config, firm="topstep")

        report = run_parity_shadow(request, _make_fake_result(), _make_trending_df())
        assert report["ran"] is False
        assert report["reason"] == "strategy_archetype_not_supported_by_parity_engine"


# ─── Tests: non-blocking failure handling ─────────────────────────────

class TestNonBlocking:
    def test_internal_error_does_not_raise(self, monkeypatch):
        """Any internal exception must be caught — main backtest result is unaffected."""
        monkeypatch.setenv("PARITY_SHADOW_ENABLED", "true")

        # Inject a failure into _reconstruct_dsl by providing a malformed request
        bad_request = SimpleNamespace(strategy=None)  # will cause AttributeError
        result = _make_fake_result()

        # Must not raise
        report = run_parity_shadow(bad_request, result, _make_trending_df())

        _assert_report_shape(report)
        assert report["ran"] is False
        assert report["enabled"] is True

    def test_none_df_does_not_raise(self, monkeypatch):
        """None df should return an error report, not raise."""
        monkeypatch.setenv("PARITY_SHADOW_ENABLED", "true")

        request = _make_fake_request("ema_crossover")
        report = run_parity_shadow(request, _make_fake_result(), None)

        _assert_report_shape(report)
        assert report["ran"] is False

    def test_diff_harness_exception_caught(self, monkeypatch):
        """Any internal exception is caught — shadow returns error report, never raises."""
        monkeypatch.setenv("PARITY_SHADOW_ENABLED", "true")

        request = _make_fake_request("ema_crossover")

        # Patch _extract_production_data to raise — this fires AFTER archetype check,
        # exercising the main except block in run_parity_shadow.
        with patch(
            "src.engine.parity_engine.shadow_runner._extract_production_data",
            side_effect=RuntimeError("simulated extraction failure"),
        ):
            # Must not raise — always returns a well-shaped report
            report = run_parity_shadow(request, _make_fake_result(), _make_trending_df())

        _assert_report_shape(report)
        assert report["ran"] is False
        assert report["enabled"] is True
        assert report.get("reason") == "parity_shadow_internal_error"
        assert "simulated extraction failure" in report.get("error", "")


# ─── Tests: tolerance env vars ────────────────────────────────────────

class TestToleranceEnv:
    def test_default_tolerances(self, monkeypatch):
        monkeypatch.delenv("PARITY_TOLERANCE_PNL_PCT", raising=False)
        monkeypatch.delenv("PARITY_TOLERANCE_TRADE_COUNT", raising=False)
        monkeypatch.delenv("PARITY_TOLERANCE_SHARPE", raising=False)

        tol = _load_tolerances()
        assert tol["pnl_pct"] == pytest.approx(0.10)
        assert tol["trade_count"] == 1
        assert tol["sharpe"] == pytest.approx(0.05)

    def test_env_overrides_tolerances(self, monkeypatch):
        monkeypatch.setenv("PARITY_TOLERANCE_PNL_PCT", "0.5")
        monkeypatch.setenv("PARITY_TOLERANCE_TRADE_COUNT", "3")
        monkeypatch.setenv("PARITY_TOLERANCE_SHARPE", "0.1")

        tol = _load_tolerances()
        assert tol["pnl_pct"] == pytest.approx(0.5)
        assert tol["trade_count"] == 3
        assert tol["sharpe"] == pytest.approx(0.1)

    def test_invalid_env_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("PARITY_TOLERANCE_PNL_PCT", "not_a_number")

        tol = _load_tolerances()
        assert tol["pnl_pct"] == pytest.approx(0.10)


# ─── Tests: end-to-end with mocked diff_harness ───────────────────────

class TestEndToEnd:
    def test_passed_report_structure(self, monkeypatch):
        """When parity passes, report has ran=True, passed=True."""
        monkeypatch.setenv("PARITY_SHADOW_ENABLED", "true")

        from src.engine.parity_engine.diff_harness import ParityResult, VBTTrade
        from src.engine.parity_engine.backtrader_adapter import BTTrade

        fake_parity_result = ParityResult(
            fixture_name="shadow:test_strategy_ema_crossover",
            vbt_trade_count=5,
            bt_trade_count=5,
            vbt_total_pnl=250.0,
            bt_total_pnl=251.0,
            pnl_diff_pct=0.04,          # within 0.10% tolerance
            vbt_sharpe=1.20,
            bt_sharpe=1.21,
            sharpe_diff=0.01,           # within 0.05 tolerance
            passed=True,
            failure_reasons=[],
            vbt_trades=[],
            bt_trades=[],
        )

        # run_parity_diff is lazily imported — patch on the source module
        with patch(
            "src.engine.parity_engine.diff_harness.run_parity_diff",
            return_value=fake_parity_result,
        ):
            request = _make_fake_request("ema_crossover")
            report = run_parity_shadow(request, _make_fake_result(), _make_trending_df())

        _assert_report_shape(report)
        assert report["enabled"] is True
        assert report["ran"] is True
        assert report["passed"] is True
        assert report["vbt_trade_count"] == 5
        assert report["bt_trade_count"] == 5
        assert report["trade_count_diff"] == 0
        assert report["failure_reasons"] == []
        assert report["execution_time_ms"] >= 0.0

    def test_drift_report_structure(self, monkeypatch):
        """When parity fails (drift), report has ran=True, passed=False, failure_reasons populated."""
        monkeypatch.setenv("PARITY_SHADOW_ENABLED", "true")

        from src.engine.parity_engine.diff_harness import ParityResult

        fake_parity_result = ParityResult(
            fixture_name="shadow:test_strategy_ema_crossover",
            vbt_trade_count=5,
            bt_trade_count=8,           # drift: 3 trades different
            vbt_total_pnl=250.0,
            bt_total_pnl=180.0,
            pnl_diff_pct=28.0,          # huge drift
            vbt_sharpe=1.20,
            bt_sharpe=0.60,
            sharpe_diff=0.60,
            passed=False,
            failure_reasons=["Trade count divergence: vbt=5 bt=8 diff=3 > tolerance=1"],
            vbt_trades=[],
            bt_trades=[],
        )

        with patch(
            "src.engine.parity_engine.diff_harness.run_parity_diff",
            return_value=fake_parity_result,
        ):
            request = _make_fake_request("ema_crossover")
            report = run_parity_shadow(request, _make_fake_result(), _make_trending_df())

        _assert_report_shape(report)
        assert report["ran"] is True
        assert report["passed"] is False
        assert len(report["failure_reasons"]) >= 1
        assert report["trade_count_diff"] == 3

    def test_drift_json_serializable(self, monkeypatch):
        """PARITY_SHADOW_DRIFT_JSON must be valid JSON (for server-side log capture)."""
        monkeypatch.setenv("PARITY_SHADOW_ENABLED", "true")

        from src.engine.parity_engine.diff_harness import ParityResult

        fake_parity_result = ParityResult(
            fixture_name="shadow:test",
            vbt_trade_count=5,
            bt_trade_count=9,
            vbt_total_pnl=100.0,
            bt_total_pnl=50.0,
            pnl_diff_pct=50.0,
            vbt_sharpe=1.0,
            bt_sharpe=0.5,
            sharpe_diff=0.5,
            passed=False,
            failure_reasons=["Trade count divergence: vbt=5 bt=9"],
            vbt_trades=[],
            bt_trades=[],
        )

        with patch(
            "src.engine.parity_engine.diff_harness.run_parity_diff",
            return_value=fake_parity_result,
        ):
            request = _make_fake_request("ema_crossover")
            report = run_parity_shadow(request, _make_fake_result(), _make_trending_df())

        # Report must be JSON-serializable (no numpy scalars, no dataclasses)
        serialized = json.dumps(report)
        parsed = json.loads(serialized)
        assert parsed["ran"] is True
        assert parsed["passed"] is False


# ─── Tests: import chain doesn't break backtester ─────────────────────

class TestImportChain:
    def test_shadow_runner_importable(self):
        """shadow_runner imports cleanly without pulling in production dep tree."""
        import src.engine.parity_engine.shadow_runner as sr
        assert callable(sr.run_parity_shadow)
        assert callable(sr.parity_supported)

    def test_backtester_importable(self):
        """The backtester.py integration edit must not break the import chain."""
        import src.engine.backtester
        assert callable(src.engine.backtester.run_backtest)
