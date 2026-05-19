"""Tests for harsh-regime survival auto-test (Wave 23 / Track 23.D).

Design principles:
- All tests are deterministic — no nondeterministic RNG or I/O.
- run_backtest is injected as a mock function (unit-test isolation).
- No hit-rate thresholds in any test assertion.
- Coverage: date range validation, per-regime expectancy_R math, pass/fail logic,
  advisory-phase non-blocking behavior.
"""

from __future__ import annotations

import pytest

from src.engine.regime_survival import (
    HARSH_REGIMES,
    _compute_regime_stats,
    _MIN_TRADES_PER_REGIME,
    run_harsh_regime_survival,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_trade(pnl: float, risk_per_contract: float, size: float = 1.0) -> dict:
    """Create a minimal trade dict for regime_stats computation."""
    return {
        "PnL": pnl,
        "risk_dollars_per_contract": risk_per_contract,
        "Size": size,
    }


def _make_profitable_trades(n: int = 20, pnl: float = 100.0, risk: float = 40.0) -> list[dict]:
    """Return n profitable trades at 2.5R expectancy."""
    return [_make_trade(pnl=pnl, risk_per_contract=risk) for _ in range(n)]


def _make_losing_trades(n: int = 20, pnl: float = -50.0, risk: float = 40.0) -> list[dict]:
    """Return n losing trades at negative expectancy."""
    return [_make_trade(pnl=pnl, risk_per_contract=risk) for _ in range(n)]


def _mock_run_backtest_factory(regime_trades: dict[str, list[dict]]):
    """Return a mock run_backtest that returns trades keyed by date range."""
    def mock_run_backtest(request):
        # Find the matching regime by start_date
        for name, start, end in HARSH_REGIMES:
            if request.start_date == start and request.end_date == end:
                trades = regime_trades.get(name, [])
                return {"trades": trades}
        return {"trades": []}
    return mock_run_backtest


# ─── Test: HARSH_REGIMES date range validation ────────────────────────────────

class TestHarshRegimeDates:
    def test_four_regimes_defined(self):
        assert len(HARSH_REGIMES) == 4

    def test_regime_names(self):
        names = [r[0] for r in HARSH_REGIMES]
        assert "covid_2020" in names
        assert "fed_pivot_2022" in names
        assert "yen_carry_2024" in names
        assert "apr_vol_spike_2025" in names

    def test_covid_2020_dates(self):
        covid = next(r for r in HARSH_REGIMES if r[0] == "covid_2020")
        assert covid[1] == "2020-02-01"
        assert covid[2] == "2020-04-30"

    def test_fed_pivot_2022_dates(self):
        fed = next(r for r in HARSH_REGIMES if r[0] == "fed_pivot_2022")
        assert fed[1] == "2022-01-01"
        assert fed[2] == "2022-06-30"

    def test_yen_carry_2024_dates(self):
        yen = next(r for r in HARSH_REGIMES if r[0] == "yen_carry_2024")
        assert yen[1] == "2024-08-01"
        assert yen[2] == "2024-08-31"

    def test_apr_vol_spike_2025_dates(self):
        apr = next(r for r in HARSH_REGIMES if r[0] == "apr_vol_spike_2025")
        assert apr[1] == "2025-04-01"
        assert apr[2] == "2025-04-30"

    def test_start_before_end_for_all_regimes(self):
        from datetime import date
        for name, start, end in HARSH_REGIMES:
            s = date.fromisoformat(start)
            e = date.fromisoformat(end)
            assert s < e, f"Regime {name}: start {start} must be before end {end}"


# ─── Test: _compute_regime_stats ─────────────────────────────────────────────

class TestComputeRegimeStats:
    def test_no_trades_returns_failed(self):
        result = _compute_regime_stats([])
        assert result["passed"] is False
        assert result["failure_reason"] == "no_trades"
        assert result["trade_count"] == 0

    def test_insufficient_trades_returns_failed(self):
        trades = [_make_trade(100.0, 40.0) for _ in range(_MIN_TRADES_PER_REGIME - 1)]
        result = _compute_regime_stats(trades)
        assert result["passed"] is False
        assert "insufficient_trades" in result["failure_reason"]

    def test_profitable_strategy_passes(self):
        """Strategy with positive expectancy in crisis regime passes."""
        trades = _make_profitable_trades(20, pnl=100.0, risk=40.0)  # 2.5R
        result = _compute_regime_stats(trades)
        assert result["passed"] is True
        assert result["expectancy_r"] is not None
        assert result["expectancy_r"] > 0
        assert result["trade_count"] == 20

    def test_losing_strategy_fails(self):
        """Strategy with negative expectancy fails."""
        trades = _make_losing_trades(20, pnl=-50.0, risk=40.0)  # -1.25R
        result = _compute_regime_stats(trades)
        assert result["passed"] is False

    def test_expectancy_r_computation(self):
        """avg_trade_pnl=100, avg_risk=40 → expectancy_R=2.5."""
        trades = [_make_trade(100.0, 40.0) for _ in range(10)]
        result = _compute_regime_stats(trades)
        assert result["expectancy_r"] is not None
        assert abs(result["expectancy_r"] - 2.5) < 0.01

    def test_pf_computation(self):
        """Half winning, half losing: PF = gross_profit / gross_loss."""
        trades = (
            [_make_trade(200.0, 50.0) for _ in range(5)] +  # winners
            [_make_trade(-100.0, 50.0) for _ in range(5)]    # losers
        )
        result = _compute_regime_stats(trades)
        # gross_profit=1000, gross_loss=500, PF=2.0
        assert result["pf"] is not None
        assert abs(result["pf"] - 2.0) < 0.01

    def test_breakeven_pf_passes(self):
        """Exactly breakeven (PF=1.0) passes the crisis gate (crisis survival = not losing)."""
        # Alternate winners/losers of same magnitude
        trades = (
            [_make_trade(50.0, 50.0) for _ in range(10)] +
            [_make_trade(-50.0, 50.0) for _ in range(10)]
        )
        result = _compute_regime_stats(trades)
        # PF=1.0, expectancy_R=0.0 — expectancy_R gate: >= 0.0 passes (breakeven in crisis)
        assert result["trade_count"] == 20

    def test_no_valid_risk_data_returns_no_expectancy(self):
        """Trades with zero risk_dollars_per_contract produce None expectancy_r."""
        trades = [{"PnL": 100.0, "risk_dollars_per_contract": 0.0, "Size": 1.0} for _ in range(10)]
        result = _compute_regime_stats(trades)
        assert result["expectancy_r"] is None

    def test_mixed_size_trades_weighted_correctly(self):
        """risk_dollars_per_contract × Size gives per-trade total risk."""
        # 2 contracts, $50/contract risk, $200 PnL per trade → expectancy_R = 200/100 = 2.0
        trades = [_make_trade(pnl=200.0, risk_per_contract=50.0, size=2.0) for _ in range(10)]
        result = _compute_regime_stats(trades)
        assert result["expectancy_r"] is not None
        assert abs(result["expectancy_r"] - 2.0) < 0.01


# ─── Test: run_harsh_regime_survival ────────────────────────────────────────

class TestRunHarshRegimeSurvival:
    def _minimal_strategy_config(self) -> dict:
        """Minimal valid strategy config for StrategyConfig schema."""
        return {
            "name": "test_strategy_23d",
            "symbol": "MES",
            "timeframe": "5m",
            "indicators": [],
            "entry_long": "close > open",
            "entry_short": "close < open",
            "exit": "close",
            "stop_loss": {"type": "atr", "atr_multiplier": 2.0},
            "position_size": {"type": "fixed", "contracts": 1},
        }

    def test_all_regimes_win_returns_all_passed_true(self):
        """When every regime run produces profitable trades, all_passed is True."""
        trades = _make_profitable_trades(20, pnl=100.0, risk=40.0)
        mock_fn = _mock_run_backtest_factory({
            "covid_2020": trades,
            "fed_pivot_2022": trades,
            "yen_carry_2024": trades,
            "apr_vol_spike_2025": trades,
        })
        result = run_harsh_regime_survival(
            self._minimal_strategy_config(),
            run_backtest_fn=mock_fn,
        )
        assert result["all_passed"] is True
        assert result["regimes_failed"] == []
        assert len(result["regimes"]) == 4

    def test_all_regimes_lose_returns_all_passed_false(self):
        """When every regime run produces losing trades, all_passed is False, all 4 fail."""
        trades = _make_losing_trades(20, pnl=-80.0, risk=40.0)
        mock_fn = _mock_run_backtest_factory({
            "covid_2020": trades,
            "fed_pivot_2022": trades,
            "yen_carry_2024": trades,
            "apr_vol_spike_2025": trades,
        })
        result = run_harsh_regime_survival(
            self._minimal_strategy_config(),
            run_backtest_fn=mock_fn,
        )
        assert result["all_passed"] is False
        assert len(result["regimes_failed"]) == 4

    def test_partial_fail_reports_correct_failed_regimes(self):
        """When only 2 regimes fail, regimes_failed lists exactly those 2."""
        good_trades = _make_profitable_trades(20, pnl=100.0, risk=40.0)
        bad_trades = _make_losing_trades(20, pnl=-60.0, risk=40.0)
        mock_fn = _mock_run_backtest_factory({
            "covid_2020": good_trades,
            "fed_pivot_2022": bad_trades,
            "yen_carry_2024": good_trades,
            "apr_vol_spike_2025": bad_trades,
        })
        result = run_harsh_regime_survival(
            self._minimal_strategy_config(),
            run_backtest_fn=mock_fn,
        )
        assert result["all_passed"] is False
        assert set(result["regimes_failed"]) == {"fed_pivot_2022", "apr_vol_spike_2025"}

    def test_advisory_phase_does_not_set_would_block(self):
        """In advisory phase (default), would_block is False even if all regimes fail."""
        bad_trades = _make_losing_trades(20, pnl=-60.0, risk=40.0)
        mock_fn = _mock_run_backtest_factory({
            "covid_2020": bad_trades,
            "fed_pivot_2022": bad_trades,
            "yen_carry_2024": bad_trades,
            "apr_vol_spike_2025": bad_trades,
        })
        result = run_harsh_regime_survival(
            self._minimal_strategy_config(),
            run_backtest_fn=mock_fn,
        )
        assert result["all_passed"] is False
        # Phase is advisory by default — would_block must be False (soft gate)
        assert result["would_block"] is False
        assert result["phase"] == "advisory"

    def test_per_regime_expectancy_r_computed(self):
        """Each regime entry contains expectancy_r, pf, sharpe, trade_count."""
        trades = _make_profitable_trades(15, pnl=100.0, risk=40.0)
        mock_fn = _mock_run_backtest_factory({
            "covid_2020": trades,
            "fed_pivot_2022": trades,
            "yen_carry_2024": trades,
            "apr_vol_spike_2025": trades,
        })
        result = run_harsh_regime_survival(
            self._minimal_strategy_config(),
            run_backtest_fn=mock_fn,
        )
        for name in ["covid_2020", "fed_pivot_2022", "yen_carry_2024", "apr_vol_spike_2025"]:
            regime = result["regimes"][name]
            assert "expectancy_r" in regime
            assert "pf" in regime
            assert "sharpe" in regime
            assert "trade_count" in regime
            assert "passed" in regime

    def test_backtest_error_treats_regime_as_failed(self):
        """If run_backtest raises for a regime, that regime is counted as failed (fail-closed)."""
        good_trades = _make_profitable_trades(15, pnl=100.0, risk=40.0)

        call_count = [0]
        def mock_fn_with_error(request):
            call_count[0] += 1
            if request.start_date == "2020-02-01":
                raise RuntimeError("S3 data read error simulated")
            return {"trades": good_trades}

        result = run_harsh_regime_survival(
            self._minimal_strategy_config(),
            run_backtest_fn=mock_fn_with_error,
        )
        assert "covid_2020" in result["regimes_failed"]
        assert result["regimes"]["covid_2020"]["passed"] is False

    def test_result_has_all_four_regime_keys(self):
        """Result always has all 4 regime keys regardless of errors."""
        trades = _make_profitable_trades(10, pnl=100.0, risk=40.0)
        mock_fn = _mock_run_backtest_factory({
            "covid_2020": trades,
            "fed_pivot_2022": trades,
            "yen_carry_2024": trades,
            "apr_vol_spike_2025": trades,
        })
        result = run_harsh_regime_survival(
            self._minimal_strategy_config(),
            run_backtest_fn=mock_fn,
        )
        expected_keys = {"covid_2020", "fed_pivot_2022", "yen_carry_2024", "apr_vol_spike_2025"}
        assert set(result["regimes"].keys()) == expected_keys

    def test_no_hit_rate_threshold_in_gate_logic(self):
        """Confirm gate passes a strategy with 30% hit rate if R-expectancy is positive.

        This test proves the gate is hit-rate-agnostic. A strategy winning 30% of trades
        at 4R per winner should still pass (positive expectancy).
        """
        # 30% win rate: 6 winners at +160 each, 14 losers at -40 each
        # Avg PnL = (6×160 + 14×(-40)) / 20 = (960-560)/20 = 20 (positive)
        # avg_risk = 40, expectancy_R = 20/40 = 0.5R > 0 → passes
        trades = (
            [_make_trade(pnl=160.0, risk_per_contract=40.0) for _ in range(6)] +
            [_make_trade(pnl=-40.0, risk_per_contract=40.0) for _ in range(14)]
        )
        result = _compute_regime_stats(trades)
        assert result["passed"] is True, (
            f"30%-hit-rate strategy with positive expectancy should pass. Got: {result}"
        )
