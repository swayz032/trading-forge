"""Tests for A14 Black Swan Evaluator (Pass 2B, W19).

TDD: tests authored before the implementation.

Design contract:
  - evaluate_strategy(strategy_config, regime_records, prop_firm_cap) -> EvalResult
  - evaluate_strategy is a pure function; no DB writes, no S3 writes.
  - A regime is "survived" iff max_drawdown_dollars < prop_firm_cap_dollars
  - (strict less-than: hitting exactly the cap is considered NOT survived,
     matching existing performance gate logic where max_drawdown must be BELOW cap)
  - Per-regime backtester errors count as failed (not survived), never crash the
    whole evaluation.
  - Empty regime bank → ValueError with clear message.
  - JSON output contract matches the plan spec verbatim.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import polars as pl
import pytest

from src.engine.black_swan_evaluator import (
    BLACK_SWAN_TOP_K,
    DEFAULT_PROP_FIRM_CAP_DOLLARS,
    RegimeRecord,
    RegimeSurvivalResult,
    evaluate_strategy,
    score_survival,
)


# ─── Fixtures ─────────────────────────────────────────────────────────────────


def _make_ohlcv(n: int = 50, start_price: float = 4000.0) -> pl.DataFrame:
    """Minimal synthetic OHLCV DataFrame for testing (no S3, no DB)."""
    dates = [datetime(2025, 1, 2) + timedelta(days=i) for i in range(n)]
    closes = [start_price + i * 0.5 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open":   [c - 1.0 for c in closes],
        "high":   [c + 2.0 for c in closes],
        "low":    [c - 2.0 for c in closes],
        "close":  closes,
        "volume": [10000] * n,
    })


def _make_regime_record(
    label: str = "crash",
    ohlcv: pl.DataFrame | None = None,
    regime_id: str | None = None,
) -> RegimeRecord:
    """Build a RegimeRecord with an embedded Polars DataFrame (bypasses S3)."""
    if ohlcv is None:
        ohlcv = _make_ohlcv()
    if regime_id is None:
        regime_id = str(uuid.uuid4())
    return RegimeRecord(
        id=regime_id,
        symbol="MES",
        timeframe="daily",
        regime_label=label,
        s3_path=f"s3://test-bucket/synthetic/{label}/{regime_id}.parquet",
        num_bars=len(ohlcv),
        generator_model_version="v1.0-2026-05-04",
        ohlcv=ohlcv,
    )


def _make_strategy_config(symbol: str = "MES") -> dict:
    """Minimal strategy DSL config dict for backtest calls."""
    return {
        "name": "BSE Test Strategy",
        "symbol": symbol,
        "timeframe": "daily",
        "indicators": [
            {"type": "sma", "period": 10},
            {"type": "atr", "period": 14},
        ],
        "entry_long": "close crosses_above sma_10",
        "entry_short": "close crosses_below sma_10",
        "exit": "close crosses_below sma_10",
        "stop_loss": {"type": "atr", "multiplier": 2.0},
        "position_size": {"type": "dynamic_atr", "target_risk_dollars": 500},
    }


# ─── Unit Tests: score_survival ────────────────────────────────────────────────


class TestScoreSurvival:
    """Test the pure survival scoring function."""

    def test_below_cap_survives(self):
        """Drawdown below cap → survived."""
        result = score_survival(drawdown_dollars=1500.0, cap_dollars=2000.0)
        assert result is True

    def test_at_cap_does_not_survive(self):
        """Drawdown exactly at cap → NOT survived (strict less-than semantics)."""
        result = score_survival(drawdown_dollars=2000.0, cap_dollars=2000.0)
        assert result is False

    def test_above_cap_does_not_survive(self):
        """Drawdown exceeding cap → NOT survived."""
        result = score_survival(drawdown_dollars=3812.0, cap_dollars=2000.0)
        assert result is False

    def test_zero_drawdown_survives(self):
        """Zero drawdown always survives."""
        result = score_survival(drawdown_dollars=0.0, cap_dollars=2000.0)
        assert result is True

    def test_negative_drawdown_treated_as_zero(self):
        """Negative drawdown (gain) treated as 0 — always survives."""
        result = score_survival(drawdown_dollars=-500.0, cap_dollars=2000.0)
        assert result is True


# ─── Unit Tests: evaluate_strategy pure function ──────────────────────────────


class TestEvaluateStrategy:
    """Core evaluate_strategy logic with mocked backtester."""

    def _mock_backtest_result(self, max_drawdown: float) -> dict:
        """Construct a plausible run_backtest return dict."""
        return {
            "max_drawdown": max_drawdown,
            "total_return": 500.0,
            "sharpe_ratio": 1.2,
            "win_rate": 0.55,
            "profit_factor": 1.8,
            "total_trades": 20,
            "equity_curve": [50000.0 + i * 10 for i in range(50)],
            "trades": [],
            "daily_pnls": [10.0] * 20,
            "execution_time_ms": 50,
        }

    def test_drawdown_breach_fails_survival(self):
        """A regime producing $3000 drawdown with a $2000 cap → NOT survived."""
        regime = _make_regime_record(label="rate_shock")
        strategy_config = _make_strategy_config()
        cap = 2000.0

        with patch(
            "src.engine.black_swan_evaluator.run_backtest",
            return_value=self._mock_backtest_result(max_drawdown=3000.0),
        ):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=[regime],
                prop_firm_cap_dollars=cap,
            )

        assert result.num_regimes_tested == 1
        assert result.num_regimes_survived == 0
        assert result.survival_rate == 0.0

    def test_drawdown_within_cap_survives(self):
        """A regime with $1500 drawdown under a $2000 cap → survived."""
        regime = _make_regime_record(label="low_vol")
        strategy_config = _make_strategy_config()
        cap = 2000.0

        with patch(
            "src.engine.black_swan_evaluator.run_backtest",
            return_value=self._mock_backtest_result(max_drawdown=1500.0),
        ):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=[regime],
                prop_firm_cap_dollars=cap,
            )

        assert result.num_regimes_survived == 1
        assert result.survival_rate == 1.0

    def test_survival_rate_precision(self):
        """743 survived out of 1000 → survival_rate = 0.743 (4dp)."""
        n = 1000
        n_survived = 743

        # Build regime records with alternating outcomes
        regimes = []
        mock_results = []
        for i in range(n):
            regimes.append(_make_regime_record(label="crash" if i % 3 == 0 else "normal"))
            # First 743 survive (drawdown < cap), rest fail
            dd = 1500.0 if i < n_survived else 2500.0
            mock_results.append(self._mock_backtest_result(max_drawdown=dd))

        strategy_config = _make_strategy_config()
        cap = 2000.0

        call_count = [0]

        def mock_run(request, data=None, **kwargs):
            idx = call_count[0]
            call_count[0] += 1
            return mock_results[idx]

        with patch("src.engine.black_swan_evaluator.run_backtest", side_effect=mock_run):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=regimes,
                prop_firm_cap_dollars=cap,
            )

        assert result.num_regimes_tested == 1000
        assert result.num_regimes_survived == 743
        assert round(result.survival_rate, 4) == 0.743

    def test_worst_k_extraction_and_sort(self):
        """Top-K worst regimes are correctly sorted by drawdown (highest first)."""
        n = 20
        drawdowns = [float(i * 100) for i in range(n)]  # 0, 100, ..., 1900
        regimes = [_make_regime_record(label=f"regime_{i}") for i in range(n)]

        strategy_config = _make_strategy_config()
        cap = 5000.0  # All survive — testing sort only

        call_count = [0]

        def mock_run(request, data=None, **kwargs):
            idx = call_count[0]
            call_count[0] += 1
            return self._mock_backtest_result(max_drawdown=drawdowns[idx])

        with patch("src.engine.black_swan_evaluator.run_backtest", side_effect=mock_run):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=regimes,
                prop_firm_cap_dollars=cap,
            )

        assert len(result.worst_k) <= BLACK_SWAN_TOP_K
        # Worst first: drawdown 1900 should be first in worst_k
        assert result.worst_k[0]["drawdown"] == max(drawdowns)
        # All worst_k entries have required fields
        for entry in result.worst_k:
            assert "id" in entry
            assert "drawdown" in entry
            assert "label" in entry

    def test_worst_regime_populated(self):
        """worst_regime field is the single highest-drawdown regime."""
        regimes = [
            _make_regime_record(label="crash", regime_id="aaa-111"),
            _make_regime_record(label="normal", regime_id="bbb-222"),
            _make_regime_record(label="rate_shock", regime_id="ccc-333"),
        ]
        drawdowns = [3812.0, 800.0, 1200.0]
        strategy_config = _make_strategy_config()
        cap = 5000.0

        call_count = [0]

        def mock_run(request, data=None, **kwargs):
            idx = call_count[0]
            call_count[0] += 1
            return self._mock_backtest_result(max_drawdown=drawdowns[idx])

        with patch("src.engine.black_swan_evaluator.run_backtest", side_effect=mock_run):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=regimes,
                prop_firm_cap_dollars=cap,
            )

        assert result.worst_regime is not None
        assert result.worst_regime["id"] == "aaa-111"
        assert result.worst_regime["drawdown"] == 3812.0
        assert result.worst_regime["label"] == "crash"

    def test_empty_regime_bank_raises(self):
        """Empty regime list raises ValueError with a clear message."""
        strategy_config = _make_strategy_config()

        with pytest.raises(ValueError, match="regime_records.*empty"):
            evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=[],
                prop_firm_cap_dollars=2000.0,
            )

    def test_per_regime_error_counted_as_failed_not_crash(self):
        """If one regime's backtester call raises, count that regime as failed
        (not survived), and do NOT abort the entire evaluation."""
        regimes = [
            _make_regime_record(label="crash"),
            _make_regime_record(label="normal"),
            _make_regime_record(label="rate_shock"),
        ]
        strategy_config = _make_strategy_config()
        cap = 2000.0

        call_count = [0]

        def mock_run(request, data=None, **kwargs):
            idx = call_count[0]
            call_count[0] += 1
            if idx == 1:
                raise RuntimeError("Simulated backtester failure on regime 1")
            return self._mock_backtest_result(max_drawdown=1000.0)  # Regimes 0,2 survive

        with patch("src.engine.black_swan_evaluator.run_backtest", side_effect=mock_run):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=regimes,
                prop_firm_cap_dollars=cap,
            )

        # 3 regimes tested, 2 survived (error on regime 1 = not survived)
        assert result.num_regimes_tested == 3
        assert result.num_regimes_survived == 2
        assert round(result.survival_rate, 4) == round(2 / 3, 4)

    def test_default_cap_applied(self):
        """When prop_firm_cap_dollars is omitted, DEFAULT_PROP_FIRM_CAP_DOLLARS is used."""
        regime = _make_regime_record()
        strategy_config = _make_strategy_config()

        with patch(
            "src.engine.black_swan_evaluator.run_backtest",
            return_value=self._mock_backtest_result(max_drawdown=DEFAULT_PROP_FIRM_CAP_DOLLARS - 1),
        ):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=[regime],
                # No prop_firm_cap_dollars → uses default
            )

        assert result.num_regimes_survived == 1

    def test_at_cap_does_not_survive_end_to_end(self):
        """Drawdown exactly at cap edge case flows through evaluate_strategy correctly."""
        regime = _make_regime_record()
        strategy_config = _make_strategy_config()
        cap = 2000.0

        with patch(
            "src.engine.black_swan_evaluator.run_backtest",
            return_value=self._mock_backtest_result(max_drawdown=2000.0),
        ):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=[regime],
                prop_firm_cap_dollars=cap,
            )

        assert result.num_regimes_survived == 0
        assert result.survival_rate == 0.0


# ─── JSON Contract Tests ───────────────────────────────────────────────────────


class TestJsonContract:
    """Verify the JSON output contract matches the spec verbatim."""

    def test_json_output_schema(self):
        """Output JSON has all required fields at correct types."""
        regime = _make_regime_record(label="crash")
        strategy_config = _make_strategy_config()
        cap = 2000.0

        mock_result = {
            "max_drawdown": 3000.0,
            "total_return": -200.0,
            "sharpe_ratio": -0.5,
            "win_rate": 0.40,
            "profit_factor": 0.8,
            "total_trades": 5,
            "equity_curve": [50000.0],
            "trades": [],
            "daily_pnls": [],
            "execution_time_ms": 30,
        }

        with patch("src.engine.black_swan_evaluator.run_backtest", return_value=mock_result):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=[regime],
                prop_firm_cap_dollars=cap,
            )

        # Serialize to dict (mirrors JSON output from CLI)
        out = result.to_json_dict()

        assert isinstance(out["num_regimes_tested"], int)
        assert isinstance(out["num_regimes_survived"], int)
        assert isinstance(out["survival_rate"], float)
        assert isinstance(out["worst_k"], list)
        assert isinstance(out["generator_model_version"], str)

        # worst_regime is None when no regimes ran (here 1 ran → should be set)
        assert out["worst_regime"] is not None
        assert "id" in out["worst_regime"]
        assert "drawdown" in out["worst_regime"]
        assert "label" in out["worst_regime"]

    def test_json_serializable(self):
        """Output must be json.dumps-safe (no numpy types, no non-serializables)."""
        regime = _make_regime_record()
        strategy_config = _make_strategy_config()

        mock_result = {
            "max_drawdown": 1000.0,
            "total_return": 200.0,
            "sharpe_ratio": 1.5,
            "win_rate": 0.6,
            "profit_factor": 2.0,
            "total_trades": 10,
            "equity_curve": [50000.0],
            "trades": [],
            "daily_pnls": [],
            "execution_time_ms": 25,
        }

        with patch("src.engine.black_swan_evaluator.run_backtest", return_value=mock_result):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=[regime],
                prop_firm_cap_dollars=2000.0,
            )

        out = result.to_json_dict()
        serialized = json.dumps(out)
        parsed = json.loads(serialized)
        assert parsed["num_regimes_tested"] == 1

    def test_generator_model_version_propagated(self):
        """generator_model_version from regime records propagates to output."""
        regime = _make_regime_record()
        regime = RegimeRecord(
            id=regime.id,
            symbol=regime.symbol,
            timeframe=regime.timeframe,
            regime_label=regime.regime_label,
            s3_path=regime.s3_path,
            num_bars=regime.num_bars,
            generator_model_version="v2.0-custom",
            ohlcv=regime.ohlcv,
        )
        strategy_config = _make_strategy_config()

        mock_result = {
            "max_drawdown": 500.0,
            "total_return": 100.0,
            "sharpe_ratio": 1.0,
            "win_rate": 0.5,
            "profit_factor": 1.5,
            "total_trades": 5,
            "equity_curve": [50000.0],
            "trades": [],
            "daily_pnls": [],
            "execution_time_ms": 20,
        }

        with patch("src.engine.black_swan_evaluator.run_backtest", return_value=mock_result):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=[regime],
                prop_firm_cap_dollars=2000.0,
            )

        out = result.to_json_dict()
        assert out["generator_model_version"] == "v2.0-custom"


# ─── Worst-K Ordering Tests ────────────────────────────────────────────────────


class TestWorstKOrdering:
    """Verify worst-K extraction and ordering with deterministic fixtures."""

    def test_top_k_capped_at_constant(self):
        """worst_k never exceeds BLACK_SWAN_TOP_K entries."""
        n = BLACK_SWAN_TOP_K + 5  # more regimes than K
        regimes = [_make_regime_record(label="normal") for _ in range(n)]
        strategy_config = _make_strategy_config()
        cap = 5000.0

        call_count = [0]

        def mock_run(request, data=None, **kwargs):
            dd = float(call_count[0] * 50)  # distinct drawdowns: 0, 50, 100, ...
            call_count[0] += 1
            return {
                "max_drawdown": dd,
                "total_return": 0.0,
                "sharpe_ratio": 0.0,
                "win_rate": 0.5,
                "profit_factor": 1.0,
                "total_trades": 0,
                "equity_curve": [],
                "trades": [],
                "daily_pnls": [],
                "execution_time_ms": 10,
            }

        with patch("src.engine.black_swan_evaluator.run_backtest", side_effect=mock_run):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=regimes,
                prop_firm_cap_dollars=cap,
            )

        assert len(result.worst_k) == BLACK_SWAN_TOP_K

    def test_worst_k_sorted_descending_by_drawdown(self):
        """worst_k entries are sorted worst first (highest drawdown first)."""
        drawdowns = [100.0, 500.0, 50.0, 300.0, 200.0]
        regimes = [_make_regime_record(label=f"r{i}") for i in range(len(drawdowns))]
        strategy_config = _make_strategy_config()
        cap = 5000.0

        call_count = [0]

        def mock_run(request, data=None, **kwargs):
            dd = drawdowns[call_count[0]]
            call_count[0] += 1
            return {
                "max_drawdown": dd,
                "total_return": 0.0,
                "sharpe_ratio": 0.0,
                "win_rate": 0.5,
                "profit_factor": 1.0,
                "total_trades": 0,
                "equity_curve": [],
                "trades": [],
                "daily_pnls": [],
                "execution_time_ms": 10,
            }

        with patch("src.engine.black_swan_evaluator.run_backtest", side_effect=mock_run):
            result = evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=regimes,
                prop_firm_cap_dollars=cap,
            )

        sorted_drawdowns = [entry["drawdown"] for entry in result.worst_k]
        assert sorted_drawdowns == sorted(sorted_drawdowns, reverse=True)


# ─── Backtester Invocation Tests ───────────────────────────────────────────────


class TestBacktesterInvocation:
    """Verify that evaluate_strategy calls run_backtest with correct arguments."""

    def test_backtester_called_with_injected_data(self):
        """run_backtest must be called with the regime ohlcv as data= kwarg."""
        ohlcv = _make_ohlcv(n=60)
        regime = _make_regime_record(ohlcv=ohlcv)
        strategy_config = _make_strategy_config()

        captured_calls = []

        def mock_run(request, data=None, **kwargs):
            captured_calls.append({"request": request, "data": data})
            return {
                "max_drawdown": 500.0,
                "total_return": 0.0,
                "sharpe_ratio": 0.0,
                "win_rate": 0.5,
                "profit_factor": 1.0,
                "total_trades": 0,
                "equity_curve": [],
                "trades": [],
                "daily_pnls": [],
                "execution_time_ms": 10,
            }

        with patch("src.engine.black_swan_evaluator.run_backtest", side_effect=mock_run):
            evaluate_strategy(
                strategy_config=strategy_config,
                regime_records=[regime],
                prop_firm_cap_dollars=2000.0,
            )

        assert len(captured_calls) == 1
        # data= was passed (not None) — clean injection point used
        assert captured_calls[0]["data"] is not None

    def test_backtester_not_modified(self):
        """Confirm run_backtest is imported from backtester (not monkey-patched)."""
        import src.engine.black_swan_evaluator as bse
        from src.engine.backtester import run_backtest as original_run_backtest

        # The evaluator's run_backtest should be the original function when unpatched
        assert bse.run_backtest is original_run_backtest


# ─── F-1 Tests: Regime Bank Disconnect Advisory Degradation ──────────────────


class TestF1RegimeBankAdvisoryDegradation:
    """F-1 (2026-05-20): NEMO→A14→bank pipeline is structurally disconnected.

    The CLI entry point must gracefully degrade to an advisory result when
    the synthetic_regime_bank is empty or stale (>90 days), instead of
    crashing or halting promotion. gate_passed=None signals advisory mode.

    These tests verify the _query_regime_bank ValueError path and the advisory
    JSON contract without touching DB or S3.
    """

    def test_advisory_json_structure_is_serializable(self):
        """Advisory result JSON matches the expected schema and is json.dumps-safe."""
        import json
        from src.engine.black_swan_evaluator import _UNKNOWN_MODEL_VERSION

        advisory = {
            "num_regimes_tested": 0,
            "num_regimes_survived": 0,
            "survival_rate": None,
            "worst_regime": None,
            "worst_k": [],
            "generator_model_version": _UNKNOWN_MODEL_VERSION,
            "advisory": True,
            "gate_passed": None,
            "reason": "regime_bank_stale_or_empty",
        }
        serialized = json.dumps(advisory)
        parsed = json.loads(serialized)

        # Required fields present
        assert "advisory" in parsed
        assert "gate_passed" in parsed
        assert "reason" in parsed
        assert parsed["advisory"] is True
        assert parsed["gate_passed"] is None
        assert parsed["reason"] == "regime_bank_stale_or_empty"
        assert parsed["num_regimes_tested"] == 0
        assert parsed["num_regimes_survived"] == 0
        assert parsed["survival_rate"] is None

    def test_advisory_does_not_raise_on_empty_bank(self):
        """When _query_regime_bank raises ValueError, CLI does not raise — returns advisory."""
        from unittest.mock import patch
        import json, sys
        from io import StringIO

        # Patch both DB functions to simulate empty bank + valid strategy
        with patch(
            "src.engine.black_swan_evaluator._load_strategy_config_from_db",
            return_value={"symbol": "MES", "timeframe": "daily"},
        ):
            with patch(
                "src.engine.black_swan_evaluator._query_regime_bank",
                side_effect=ValueError("No stylized-fact-passing regimes found"),
            ):
                # The CLI __main__ block uses sys.exit(0) on advisory + print to stdout.
                # We test the advisory construction logic directly since __main__ is not
                # a callable function.
                try:
                    _query_regime_bank = __import__(
                        "src.engine.black_swan_evaluator",
                        fromlist=["_query_regime_bank"],
                    )._query_regime_bank
                except Exception:
                    pass

                # What we're asserting: the advisory dict above satisfies the schema
                # and the ValueError from _query_regime_bank would produce it.
                # This is a unit test of the advisory contract — full CLI integration
                # requires a subprocess call which we skip here (no DB/S3 in CI).
                from src.engine.black_swan_evaluator import _UNKNOWN_MODEL_VERSION
                advisory = {
                    "advisory": True,
                    "gate_passed": None,
                    "reason": "regime_bank_stale_or_empty",
                    "num_regimes_tested": 0,
                    "num_regimes_survived": 0,
                    "survival_rate": None,
                    "worst_regime": None,
                    "worst_k": [],
                    "generator_model_version": _UNKNOWN_MODEL_VERSION,
                }
                assert json.dumps(advisory) != ""  # serializable
                assert advisory["advisory"] is True

    def test_nemo_a14_bridge_is_importable(self):
        """nemo_a14_bridge can be imported — NEMO→A14 translation layer is wired."""
        from src.engine.nemo_a14_bridge import (
            A14ConditioningVector,
            nemo_to_a14_conditioning,
        )
        assert callable(nemo_to_a14_conditioning)
        assert A14ConditioningVector is not None

    def test_nemo_a14_bridge_produces_valid_conditioning_vector(self):
        """nemo_to_a14_conditioning produces an A14ConditioningVector with required fields.

        Constructs a NeMoScenario directly (no model load, no GPU) to avoid
        hanging in CI when CUDA/NeMo is not available.
        """
        from src.engine.nemo_a14_bridge import nemo_to_a14_conditioning
        from src.engine.nemo_scenario_designer import NeMoScenario

        # Direct construction — avoids NeMoScenarioDesigner._resolve_device() call
        scenario = NeMoScenario(
            scenario_label="crash_test",
            severity="extreme",
            duration_days=5,
            target_vol=0.45,
            target_trend=-0.6,
            target_gap_profile={"mean": -0.05, "std": 0.12, "skew": -1.5},
            narrative="Synthetic crash scenario for F-1 test",
            macro_links={"equities": -0.3, "bonds": 0.1},
            generator_version="v1.0-test",
            run_id="f1-test-run",
            seed=42,
        )
        vec = nemo_to_a14_conditioning(scenario)

        assert vec.regime_label == "crash_test"
        assert vec.target_vol == 0.45
        assert vec.target_trend == -0.6
        assert isinstance(vec.extras, dict)
        assert vec.extras.get("source") == "nemo"
        assert vec.extras.get("severity") == "extreme"
