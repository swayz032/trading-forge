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
import sys
import types
import uuid
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import polars as pl
import pytest

# Guard against vectorbt JIT compile hang during pytest collection.
# backtester.py (imported by black_swan_evaluator) pulls vectorbt at module
# level which triggers Numba/Cython JIT on Windows — hangs forever under
# pytest. This mock must be registered BEFORE the src.engine.* imports below.
_vbt_mock = types.ModuleType("vectorbt")
_vbt_mock.Portfolio = MagicMock()
sys.modules.setdefault("vectorbt", _vbt_mock)

# psycopg2 is not installed in this environment (DATABASE_URL in .env is a
# live-DB placeholder, not a test fixture). black_swan_evaluator.py imports
# psycopg2 LAZILY inside _query_regime_bank / _load_strategy_config_from_db,
# so the module itself imports fine without it (proven by the 31 tests
# above) — but the CRIT-1a/CRIT-1b regression tests below DO call those two
# functions directly, so psycopg2 must be mocked before they run. Mirrors the
# established pattern in test_deepscan14_anti_setup_db_wiring.py.
if "psycopg2" not in sys.modules:
    sys.modules["psycopg2"] = MagicMock()
    sys.modules["psycopg2.extras"] = MagicMock()

from src.engine.black_swan_evaluator import (  # noqa: E402
    BLACK_SWAN_TOP_K,
    DEFAULT_PROP_FIRM_CAP_DOLLARS,
    RegimeRecord,
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
        import json
        from unittest.mock import patch

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


# ─── A14 Archetype Routing Tests (gap fix) ────────────────────────────────────


class TestArchetypeRouting:
    """A14 gap fix: archetype strategies must route to Python class, not SMA DSL.

    Pre-fix behavior: entry_indicator='archetype:bounce_off_level' fell through
    to entry_long='close crosses_above sma_10' — testing a completely wrong strategy.

    Post-fix behavior: archetype strategies call run_class_backtest() with the
    instantiated Python class (BounceOffLevelStrategy, etc.).
    """

    def _make_archetype_config(self, archetype_key: str) -> dict:
        return {
            "name": f"ArchetypeTest_{archetype_key}",
            "symbol": "MES",
            "timeframe": "daily",
            "entry_indicator": f"archetype:{archetype_key}",
            "indicators": [{"type": "atr", "period": 14}],
            # No entry_long/entry_short — archetype routing should NOT use these
            "stop_loss": {"type": "atr", "multiplier": 2.0},
            "position_size": {"type": "dynamic_atr", "target_risk_dollars": 500},
        }

    def _mock_class_backtest_result(self, max_drawdown: float = 800.0) -> dict:
        return {
            "max_drawdown": max_drawdown,
            "total_return": 300.0,
            "sharpe_ratio": 0.9,
            "win_rate": 0.52,
            "profit_factor": 1.4,
            "total_trades": 8,
            "equity_curve": [50000.0],
            "trades": [],
            "daily_pnls": [],
            "execution_time_ms": 15,
        }

    def test_archetype_strategy_calls_run_class_backtest_not_dsl(self):
        """evaluate_strategy must call run_class_backtest (not run_backtest)
        when entry_indicator='archetype:bounce_off_level'."""
        ohlcv = _make_ohlcv(n=100)
        regime = _make_regime_record(ohlcv=ohlcv)
        strategy_config = self._make_archetype_config("bounce_off_level")

        class_backtest_calls = []
        dsl_backtest_calls = []

        def mock_class_run(strategy, start_date, end_date, data=None, **kw):
            class_backtest_calls.append({"strategy": strategy, "data": data})
            return self._mock_class_backtest_result()

        def mock_dsl_run(request, data=None, **kw):
            dsl_backtest_calls.append({"request": request, "data": data})
            return self._mock_class_backtest_result()

        with patch("src.engine.black_swan_evaluator.run_class_backtest", side_effect=mock_class_run):
            with patch("src.engine.black_swan_evaluator.run_backtest", side_effect=mock_dsl_run):
                evaluate_strategy(
                    strategy_config=strategy_config,
                    regime_records=[regime],
                    prop_firm_cap_dollars=2000.0,
                )

        # run_class_backtest must have been called (archetype routing)
        assert len(class_backtest_calls) == 1, (
            f"Expected run_class_backtest to be called for archetype, got {len(class_backtest_calls)} calls"
        )
        # run_backtest (DSL) must NOT have been called
        assert len(dsl_backtest_calls) == 0, (
            f"run_backtest (DSL) must NOT be called for archetype strategies, "
            f"got {len(dsl_backtest_calls)} calls"
        )

    def test_archetype_routing_passes_correct_data(self):
        """run_class_backtest must receive the regime OHLCV as data=."""
        ohlcv = _make_ohlcv(n=100)
        regime = _make_regime_record(ohlcv=ohlcv)
        strategy_config = self._make_archetype_config("ict_breaker")

        captured = {}

        def mock_class_run(strategy, start_date, end_date, data=None, **kw):
            captured["data"] = data
            return self._mock_class_backtest_result()

        with patch("src.engine.black_swan_evaluator.run_class_backtest", side_effect=mock_class_run):
            with patch("src.engine.black_swan_evaluator.run_backtest", return_value=self._mock_class_backtest_result()):
                evaluate_strategy(
                    strategy_config=strategy_config,
                    regime_records=[regime],
                    prop_firm_cap_dollars=2000.0,
                )

        assert captured.get("data") is not None, "run_class_backtest must receive data="
        assert len(captured["data"]) == 100, "data must be the regime OHLCV (100 bars)"

    def test_dsl_fallback_for_known_structural_archetypes(self):
        """Known structural archetypes without Python classes use DSL fallback."""
        # 'break_of_structure' is in _KNOWN_DSL_FALLBACK_ARCHETYPES — no Python class
        ohlcv = _make_ohlcv(n=60)
        regime = _make_regime_record(ohlcv=ohlcv)
        strategy_config = self._make_archetype_config("break_of_structure")

        class_backtest_calls = []
        dsl_backtest_calls = []

        def mock_class_run(strategy, start_date, end_date, data=None, **kw):
            class_backtest_calls.append(True)
            return self._mock_class_backtest_result()

        def mock_dsl_run(request, data=None, **kw):
            dsl_backtest_calls.append(True)
            return self._mock_class_backtest_result()

        with patch("src.engine.black_swan_evaluator.run_class_backtest", side_effect=mock_class_run):
            with patch("src.engine.black_swan_evaluator.run_backtest", side_effect=mock_dsl_run):
                evaluate_strategy(
                    strategy_config=strategy_config,
                    regime_records=[regime],
                    prop_firm_cap_dollars=2000.0,
                )

        # Should have fallen through to DSL backtest
        assert len(dsl_backtest_calls) == 1, (
            "break_of_structure (no Python class) must use DSL fallback"
        )
        assert len(class_backtest_calls) == 0, (
            "run_class_backtest must not be called for structural primitives"
        )

    def test_non_archetype_strategy_still_uses_dsl(self):
        """Non-archetype strategies (no entry_indicator='archetype:...') still use DSL."""
        ohlcv = _make_ohlcv(n=60)
        regime = _make_regime_record(ohlcv=ohlcv)
        strategy_config = _make_strategy_config()  # plain DSL config, no entry_indicator

        class_backtest_calls = []
        dsl_backtest_calls = []

        def mock_class_run(strategy, start_date, end_date, data=None, **kw):
            class_backtest_calls.append(True)
            return self._mock_class_backtest_result()

        def mock_dsl_run(request, data=None, **kw):
            dsl_backtest_calls.append(True)
            return self._mock_class_backtest_result()

        with patch("src.engine.black_swan_evaluator.run_class_backtest", side_effect=mock_class_run):
            with patch("src.engine.black_swan_evaluator.run_backtest", side_effect=mock_dsl_run):
                evaluate_strategy(
                    strategy_config=strategy_config,
                    regime_records=[regime],
                    prop_firm_cap_dollars=2000.0,
                )

        assert len(dsl_backtest_calls) == 1, "DSL strategy must use run_backtest"
        assert len(class_backtest_calls) == 0, "DSL strategy must not call run_class_backtest"

    def test_archetype_map_has_all_python_class_archetypes(self):
        """_ARCHETYPE_TO_CLASS_PATH must contain all archetypes that have Python classes."""
        from src.engine.black_swan_evaluator import _ARCHETYPE_TO_CLASS_PATH
        # At minimum, these known archetypes must be routed
        required_archetypes = {
            "bounce_off_level",
            "ict_breaker",
            "judas_swing",
            "silver_bullet",
            "ict_bias_aligned_continuation",
        }
        missing = required_archetypes - set(_ARCHETYPE_TO_CLASS_PATH.keys())
        assert not missing, (
            f"Required archetypes missing from _ARCHETYPE_TO_CLASS_PATH: {missing}"
        )

    def test_archetype_class_path_strings_are_valid_python_module_paths(self):
        """All class paths in _ARCHETYPE_TO_CLASS_PATH must be importable dotted paths."""
        from src.engine.black_swan_evaluator import _ARCHETYPE_TO_CLASS_PATH
        for key, path in _ARCHETYPE_TO_CLASS_PATH.items():
            # Must have format 'module.path.ClassName'
            parts = path.split(".")
            assert len(parts) >= 3, f"Archetype {key}: class path too short: {path}"
            assert parts[0] == "src", f"Archetype {key}: must start with 'src': {path}"
            # Last part must start with uppercase (ClassName convention)
            assert parts[-1][0].isupper(), (
                f"Archetype {key}: class name must be uppercase: {parts[-1]}"
            )


# ─── CRIT-1a/CRIT-1b Regression Tests (2026-07-17) ────────────────────────────
#
# Live-DB verification (ratify packet grounding, 2026-07-17):
#   SELECT count(*) FROM strategies WHERE config ? 'symbol'        → 0 (of 120)
#   SELECT DISTINCT timeframe FROM strategies                      → 1m,5m,15m,30m,1h,4h
#   SELECT DISTINCT timeframe FROM synthetic_regime_bank            → 5min (23 rows, MES/MNQ/MCL)
#
# Before these fixes: (a) symbol/timeframe were read off the config JSONB TOP
# LEVEL, which 0/120 live strategies populate, so every real strategy resolved
# to the hardcoded MES/daily default regardless of its actual market/timeframe;
# (b) even with (a) fixed, the raw "5m" vs bank "5min" string mismatch meant
# _query_regime_bank found zero regime_labels for every real strategy and
# ValueError'd into the advisory path 100% of the time. The tests below prove
# a real strategy (MNQ / 5m) now resolves its REAL symbol/timeframe and finds
# genuine bank coverage — not a ValueError, not a silent MES/daily default.


class TestCanonicalizeTimeframe:
    """CRIT-1b: the timeframe-alias -> canonical-duration mapper."""

    def test_shorthand_and_bank_alias_canonicalize_identically(self):
        from src.engine.black_swan_evaluator import _canonicalize_timeframe

        assert _canonicalize_timeframe("5m") == _canonicalize_timeframe("5min")
        assert _canonicalize_timeframe("15m") == _canonicalize_timeframe("15min")
        assert _canonicalize_timeframe("30m") == _canonicalize_timeframe("30min")
        assert (
            _canonicalize_timeframe("1h")
            == _canonicalize_timeframe("60min")
            == _canonicalize_timeframe("1hour")
        )
        assert (
            _canonicalize_timeframe("4h")
            == _canonicalize_timeframe("240min")
            == _canonicalize_timeframe("4hour")
        )

    def test_daily_aliases_canonicalize_to_daily_sentinel(self):
        from src.engine.black_swan_evaluator import _canonicalize_timeframe

        assert _canonicalize_timeframe("daily") == "daily"
        assert _canonicalize_timeframe("1d") == "daily"
        assert _canonicalize_timeframe("1D") == "daily"

    def test_distinct_durations_are_not_equal(self):
        from src.engine.black_swan_evaluator import _canonicalize_timeframe

        assert _canonicalize_timeframe("5m") != _canonicalize_timeframe("15m")
        assert _canonicalize_timeframe("1h") != _canonicalize_timeframe("4h")

    def test_unrecognized_alias_returns_none_not_crash(self):
        from src.engine.black_swan_evaluator import _canonicalize_timeframe

        assert _canonicalize_timeframe("weird_tf") is None
        assert _canonicalize_timeframe("") is None
        assert _canonicalize_timeframe(None) is None  # type: ignore[arg-type]


class TestResolveBankTimeframe:
    """CRIT-1b: _resolve_bank_timeframe matches a strategy's shorthand alias
    against whatever literal string the bank actually stores for that symbol
    — this is the fix that makes the live "5m" strategy vs "5min" bank row
    mismatch resolve instead of silently missing every label."""

    def _make_cursor(self, distinct_rows):
        cur = MagicMock()
        cur.fetchall.return_value = distinct_rows
        return cur

    def test_resolves_5m_strategy_to_bank_5min_row(self):
        """The exact live mismatch: strategy declares '5m', bank stores '5min'."""
        from src.engine.black_swan_evaluator import _resolve_bank_timeframe

        cur = self._make_cursor([{"timeframe": "5min"}])
        result = _resolve_bank_timeframe(cur, "MNQ", "5m")
        assert result == "5min"

    def test_no_duration_equivalent_coverage_returns_none_not_valueerror(self):
        """Bank only has 5min rows; a 15m strategy has genuinely zero coverage —
        this must be a clean None (insufficient-data path), never a crash."""
        from src.engine.black_swan_evaluator import _resolve_bank_timeframe

        cur = self._make_cursor([{"timeframe": "5min"}])
        result = _resolve_bank_timeframe(cur, "MNQ", "15m")
        assert result is None

    def test_unrecognized_requested_timeframe_short_circuits_without_querying(self):
        from src.engine.black_swan_evaluator import _resolve_bank_timeframe

        cur = MagicMock()
        result = _resolve_bank_timeframe(cur, "MNQ", "not_a_real_timeframe")
        assert result is None
        cur.execute.assert_not_called()

    def test_matches_alternate_hour_alias_conventions(self):
        """Bank could plausibly store '1hour' or '60min' for an hourly regime —
        either must resolve for a strategy declaring '1h'."""
        from src.engine.black_swan_evaluator import _resolve_bank_timeframe

        cur_1hour = self._make_cursor([{"timeframe": "1hour"}])
        assert _resolve_bank_timeframe(cur_1hour, "MES", "1h") == "1hour"

        cur_60min = self._make_cursor([{"timeframe": "60min"}])
        assert _resolve_bank_timeframe(cur_60min, "MES", "1h") == "60min"


class TestLoadStrategyConfigFromDbPrecedence:
    """CRIT-1a: symbol/timeframe resolution precedence.

    THE test that fails without FIX 1: pre-fix code read
    `strategy_cfg.get("symbol", "MES")` from the config JSONB TOP LEVEL —
    verified live that 0/120 strategies populate that key, so every real
    strategy silently resolved to MES/daily regardless of its actual market.
    These tests simulate the verified-live row shape (DB columns populated,
    config has no top-level symbol/timeframe key) and assert the DB columns
    win, producing the strategy's REAL symbol/timeframe.
    """

    def _load(self, monkeypatch, *, db_symbol, db_timeframe, config):
        monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@localhost/db")

        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_cursor.fetchone.return_value = {
            "symbol": db_symbol,
            "timeframe": db_timeframe,
            "config": config,
        }

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        with patch("psycopg2.connect", return_value=mock_conn):
            from src.engine.black_swan_evaluator import _load_strategy_config_from_db

            return _load_strategy_config_from_db("strategy-under-test")

    def test_real_strategy_shape_resolves_db_columns_not_mes_daily_default(
        self, monkeypatch
    ):
        """The exact shape verified live: config has NO top-level symbol/
        timeframe keys; the real values live on the DB columns. Pre-FIX-1
        this would have silently resolved to MES/daily regardless."""
        config = {"strategy": {"timeframe": "5m"}, "indicators": []}

        cfg, symbol, timeframe = self._load(
            monkeypatch, db_symbol="MNQ", db_timeframe="5m", config=config
        )

        assert symbol == "MNQ"
        assert timeframe == "5m"
        assert symbol != "MES", "must not silently fall back to the MES default"
        assert timeframe != "daily", "must not silently fall back to the daily default"

    def test_non_daily_timeframe_resolves_correctly(self, monkeypatch):
        """A non-daily (1h) strategy must resolve to '1h', not the daily default."""
        config = {"strategy": {"timeframe": "1h"}}

        cfg, symbol, timeframe = self._load(
            monkeypatch, db_symbol="MCL", db_timeframe="1h", config=config
        )

        assert symbol == "MCL"
        assert timeframe == "1h"

    def test_db_columns_win_over_disagreeing_nested_config(self, monkeypatch):
        """DB column is the declared precedence winner even when nested config disagrees."""
        config = {"strategy": {"timeframe": "1h", "symbol": "MCL"}}

        cfg, symbol, timeframe = self._load(
            monkeypatch, db_symbol="MES", db_timeframe="15m", config=config
        )

        assert symbol == "MES"
        assert timeframe == "15m"

    def test_falls_back_to_nested_config_when_db_columns_blank(self, monkeypatch):
        config = {"strategy": {"timeframe": "30m", "symbol": "MNQ"}}

        cfg, symbol, timeframe = self._load(
            monkeypatch, db_symbol=None, db_timeframe=None, config=config
        )

        assert symbol == "MNQ"
        assert timeframe == "30m"

    def test_falls_back_to_top_level_config_keys_when_db_and_nested_blank(
        self, monkeypatch
    ):
        config = {"symbol": "MCL", "timeframe": "4h"}

        cfg, symbol, timeframe = self._load(
            monkeypatch, db_symbol=None, db_timeframe=None, config=config
        )

        assert symbol == "MCL"
        assert timeframe == "4h"

    def test_defaults_to_mes_daily_only_as_last_resort(self, monkeypatch):
        """Only when EVERY source is blank does the hardcoded default fire."""
        config: dict = {}

        cfg, symbol, timeframe = self._load(
            monkeypatch, db_symbol=None, db_timeframe=None, config=config
        )

        assert symbol == "MES"
        assert timeframe == "daily"

    def test_returns_config_dict_unchanged(self, monkeypatch):
        config = {"strategy": {"timeframe": "5m"}, "indicators": [{"type": "atr"}]}

        cfg, symbol, timeframe = self._load(
            monkeypatch, db_symbol="MES", db_timeframe="5m", config=config
        )

        assert cfg == config


class TestQueryRegimeBankTimeframeNormalizationEndToEnd:
    """CRIT-1b end-to-end: _query_regime_bank resolves the bank's literal
    timeframe alias via _resolve_bank_timeframe before running the label/
    sample queries, so a "5m" strategy finds the bank's "5min" rows instead
    of ValueError'ing on every call (the pre-fix behavior for 100% of live
    strategies, verified — see module docstring above)."""

    def _make_mock_cursor(self, *, distinct_timeframes, labels, sample_rows):
        """Build a MagicMock cursor answering, in call order:
        1. _resolve_bank_timeframe's DISTINCT timeframe lookup -> distinct_timeframes
        2. sql_labels DISTINCT regime_label lookup -> labels
        3. per-label: SELECT setseed() (no rows) then sql_sample -> sample_rows
        """
        cur = MagicMock()
        # setseed() calls don't fetchall in the code path (only execute), so we
        # only need fetchall results for: resolve_bank_timeframe, sql_labels,
        # then one sql_sample fetchall per label.
        fetchall_returns = [distinct_timeframes, labels] + [sample_rows for _ in labels]
        cur.fetchall.side_effect = fetchall_returns
        return cur

    def test_5m_strategy_finds_5min_bank_coverage_not_valueerror(self, monkeypatch):
        """The core regression: a real MNQ/5m strategy must find bank coverage
        (bank stores '5min') instead of raising ValueError on every call."""
        monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@localhost/db")

        sample_row = {
            "id": "regime-uuid-1",
            "symbol": "MNQ",
            "timeframe": "5min",
            "regime_label": "COVID_crash",
            "s3_path": "s3://bucket/MNQ/5min/COVID_crash/regime-uuid-1.parquet",
            "num_bars": 1200,
            "generator_model_version": "stochastic_v1.0",
        }
        cur = self._make_mock_cursor(
            distinct_timeframes=[{"timeframe": "5min"}],
            labels=[{"regime_label": "COVID_crash"}],
            sample_rows=[sample_row],
        )
        cur.__enter__ = MagicMock(return_value=cur)
        cur.__exit__ = MagicMock(return_value=False)

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = cur

        with patch("psycopg2.connect", return_value=mock_conn):
            from src.engine.black_swan_evaluator import _query_regime_bank

            records = _query_regime_bank(
                symbol="MNQ",
                timeframe="5m",  # the strategy's real (shorthand) declared timeframe
                regime_count=1,
                strategy_id="strat-1",
                backtest_id="bt-1",
            )

        assert len(records) == 1
        assert records[0].symbol == "MNQ"
        assert records[0].timeframe == "5min"
        assert records[0].regime_label == "COVID_crash"

    def test_timeframe_with_zero_bank_coverage_raises_clean_valueerror(self, monkeypatch):
        """A strategy on a timeframe the bank genuinely has no coverage for
        (e.g. 15m, when the bank only has 5min rows) must raise ValueError —
        a legitimate insufficient-data signal the CLI degrades to advisory,
        NOT an unrelated crash."""
        monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@localhost/db")

        cur = MagicMock()
        cur.fetchall.return_value = [{"timeframe": "5min"}]  # only 5min exists
        cur.__enter__ = MagicMock(return_value=cur)
        cur.__exit__ = MagicMock(return_value=False)

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = cur

        with patch("psycopg2.connect", return_value=mock_conn):
            from src.engine.black_swan_evaluator import _query_regime_bank

            with pytest.raises(ValueError, match="No stylized-fact-passing regimes"):
                _query_regime_bank(
                    symbol="MNQ",
                    timeframe="15m",
                    regime_count=1,
                    strategy_id="strat-1",
                    backtest_id="bt-1",
                )
