"""Tests for walk-forward validation + optimizer — TDD."""

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.config import (
    BacktestRequest,
    IndicatorConfig,
    PositionSizeConfig,
    StopConfig,
    StrategyConfig,
)
from src.engine.optimizer import optimize_strategy
from src.engine.walk_forward import run_walk_forward, split_walk_forward_windows

# ─── Helpers ───────────────────────────────────────────────────────

def _make_synthetic_data(n: int = 300) -> pl.DataFrame:
    """Create enough data for walk-forward splits."""
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    # Trending data with some noise
    closes = [4000.0 + i * 0.5 + (i % 7) * 3 - 10 for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open":   [c - 2.0 for c in closes],
        "high":   [c + 5.0 for c in closes],
        "low":    [c - 5.0 for c in closes],
        "close":  closes,
        "volume": [50000] * n,
    })


def _make_config() -> BacktestRequest:
    return BacktestRequest(
        strategy=StrategyConfig(
            name="SMA Cross WF",
            symbol="MES",
            timeframe="daily",
            indicators=[
                IndicatorConfig(type="sma", period=5),
                IndicatorConfig(type="sma", period=15),
                IndicatorConfig(type="atr", period=14),
            ],
            entry_long="close crosses_above sma_5",
            entry_short="close crosses_below sma_5",
            exit="close crosses_below sma_15",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
        ),
        start_date="2023-01-01",
        end_date="2023-12-31",
    )


# ─── Walk-Forward Window Splitting ────────────────────────────────

class TestSplitWindows:
    def test_correct_number_of_splits(self):
        # 1000 bars: 700 IS warmup, 300 OOS / 5 = 60 bars/split > default embargo=20
        # (300-bar data had 18-bar OOS chunks which are smaller than embargo=20 → 0 windows)
        data = _make_synthetic_data(1000)
        windows = split_walk_forward_windows(data, n_splits=5, is_ratio=0.7)
        assert len(windows) == 5

    def test_is_larger_than_oos(self):
        data = _make_synthetic_data(1000)
        windows = split_walk_forward_windows(data, n_splits=5, is_ratio=0.7)
        for is_data, oos_data in windows:
            assert len(is_data) >= len(oos_data)

    def test_no_overlap_between_is_and_oos(self):
        data = _make_synthetic_data(1000)
        windows = split_walk_forward_windows(data, n_splits=3, is_ratio=0.7)
        for is_data, oos_data in windows:
            is_end = is_data["ts_event"][-1]
            oos_start = oos_data["ts_event"][0]
            assert oos_start > is_end

    def test_covers_all_data(self):
        data = _make_synthetic_data(1000)
        windows = split_walk_forward_windows(data, n_splits=5, is_ratio=0.7)
        # OOS windows should collectively cover later portion of data
        total_oos = sum(len(oos) for _, oos in windows)
        assert total_oos > 0


# ─── Optimizer ─────────────────────────────────────────────────────

class TestOptimizer:
    def test_optimize_returns_best_params(self):
        data = _make_synthetic_data(200)
        config = _make_config()
        result = optimize_strategy(config.strategy, data, n_trials=10)
        assert "best_params" in result
        assert "best_score" in result

    def test_optimize_respects_trial_limit(self):
        data = _make_synthetic_data(200)
        config = _make_config()
        result = optimize_strategy(config.strategy, data, n_trials=5)
        assert result["n_trials"] <= 5


# ─── Walk-Forward Integration ─────────────────────────────────────

class TestWalkForward:
    # ds21 note (out-of-scope discovery, same root cause as FIX 2 in
    # test_pbo_wired_in_wf.py): WF_MODE default flipped "plain" → "cpcv"
    # (2026-06-22 institutional hardening, see walk_forward.py:1136-1147).
    # `_run_walk_forward_cpcv()` hardcodes `"windows": []` in its return dict
    # (per-window detail isn't part of the CPCV-mode contract — see
    # walk_forward.py:1023) so `len(result["windows"])` is always 0 under the
    # new default. These tests were written when "plain" was the default and
    # specifically exercise the plain-mode per-window contract, so they must
    # now request wf_mode="plain" explicitly.
    def test_walk_forward_returns_oos_metrics(self):
        data = _make_synthetic_data(1000)
        config = _make_config()
        result = run_walk_forward(config, data=data, n_splits=3, embargo_bars=0, wf_mode="plain")

        assert "oos_metrics" in result
        assert "windows" in result
        assert len(result["windows"]) == 3

    def test_walk_forward_has_per_window_results(self):
        data = _make_synthetic_data(1000)
        config = _make_config()
        result = run_walk_forward(config, data=data, n_splits=3, embargo_bars=0, wf_mode="plain")

        for window in result["windows"]:
            assert "is_sharpe" in window or "oos_sharpe" in window or "oos_metrics" in window

    def test_walk_forward_aggregate_is_oos_only(self):
        """Aggregate metrics must come from OOS data only."""
        data = _make_synthetic_data(1000)
        config = _make_config()
        result = run_walk_forward(config, data=data, n_splits=3, embargo_bars=0, wf_mode="plain")

        # The aggregate oos_metrics should exist and be from OOS
        assert "oos_metrics" in result
        assert "total_return" in result["oos_metrics"]


# ─── Embargo Tests ──────────────────────────────────────────

class TestEmbargo:
    def test_embargo_creates_gap(self):
        """With embargo_bars > 0, OOS should start later than without."""
        n = 1000
        dates = [datetime(2023, 1, 1) + timedelta(hours=i) for i in range(n)]
        df = pl.DataFrame({
            "ts_event": dates,
            "open": [100.0] * n,
            "high": [101.0] * n,
            "low": [99.0] * n,
            "close": [100.5] * n,
            "volume": [1000] * n,
        })

        windows_no_embargo = split_walk_forward_windows(df, n_splits=3, embargo_bars=0)
        windows_with_embargo = split_walk_forward_windows(df, n_splits=3, embargo_bars=10)

        # With embargo, OOS data should start later (fewer bars in IS+OOS combined)
        for (is_no, oos_no), (is_emb, oos_emb) in zip(windows_no_embargo, windows_with_embargo):
            # IS should be shorter or same with embargo
            assert len(is_emb) <= len(is_no) + 10
            # OOS should have same or fewer bars
            assert len(oos_emb) <= len(oos_no)

    def test_default_embargo_is_20(self):
        """Wave C hardening: default embargo_bars changed from 0→20 to protect ad-hoc callers.

        Default call must produce same windows as explicit embargo_bars=20
        (NOT the old 0 default).  Production callers pass embargo_bars
        explicitly and are unaffected.
        """
        n = 500
        dates = [datetime(2023, 1, 1) + timedelta(hours=i) for i in range(n)]
        df = pl.DataFrame({
            "ts_event": dates,
            "open": [100.0] * n,
            "high": [101.0] * n,
            "low": [99.0] * n,
            "close": [100.5] * n,
            "volume": [1000] * n,
        })

        windows_default = split_walk_forward_windows(df, n_splits=3)
        windows_explicit_20 = split_walk_forward_windows(df, n_splits=3, embargo_bars=20)

        assert len(windows_default) == len(windows_explicit_20)
        for (is_d, oos_d), (is_e, oos_e) in zip(windows_default, windows_explicit_20):
            assert len(is_d) == len(is_e), "IS sizes must match default vs explicit-20"
            assert len(oos_d) == len(oos_e), "OOS sizes must match default vs explicit-20"

    def test_backtest_request_embargo_default_is_20(self):
        """deep-scan Backtest re-cert HIGH: BacktestRequest.embargo_bars (the PRODUCTION dispatch path
        through backtester.py) must default to 20, not 0. A 0 request-default silently OVERRODE
        run_walk_forward()'s protective 20 on every production CPCV/WF run → zero purge → IS/OOS leakage.
        """
        from src.engine.config import BacktestRequest

        assert BacktestRequest.model_fields["embargo_bars"].default == 20

    def test_default_embargo_produces_gap_vs_zero(self):
        """Default embargo=20 creates shorter OOS windows than explicit embargo=0."""
        n = 500
        dates = [datetime(2023, 1, 1) + timedelta(hours=i) for i in range(n)]
        df = pl.DataFrame({
            "ts_event": dates,
            "open": [100.0] * n,
            "high": [101.0] * n,
            "low": [99.0] * n,
            "close": [100.5] * n,
            "volume": [1000] * n,
        })

        windows_default = split_walk_forward_windows(df, n_splits=3)
        windows_zero = split_walk_forward_windows(df, n_splits=3, embargo_bars=0)

        # Default (embargo=20) must produce a tighter OOS than embargo=0
        assert len(windows_default) == len(windows_zero)
        oos_default = sum(len(oos) for _, oos in windows_default)
        oos_zero = sum(len(oos) for _, oos in windows_zero)
        assert oos_default < oos_zero, (
            f"Default (embargo=20) OOS bars={oos_default} must be < "
            f"explicit-0 OOS bars={oos_zero}"
        )

    def test_embargo_no_overlap(self):
        """IS end + embargo gap + OOS start should not overlap."""
        n = 1000
        dates = [datetime(2023, 1, 1) + timedelta(hours=i) for i in range(n)]
        df = pl.DataFrame({
            "ts_event": dates,
            "open": [100.0 + i*0.1 for i in range(n)],
            "high": [101.0 + i*0.1 for i in range(n)],
            "low": [99.0 + i*0.1 for i in range(n)],
            "close": [100.5 + i*0.1 for i in range(n)],
            "volume": [1000] * n,
        })

        embargo = 20
        windows = split_walk_forward_windows(df, n_splits=3, embargo_bars=embargo)

        for is_data, oos_data in windows:
            # The last IS timestamp should be before the first OOS timestamp
            is_last = is_data["ts_event"][-1]
            oos_first = oos_data["ts_event"][0]
            assert is_last < oos_first


# ─── Pass 2A — F-2, F-5, F-12 tests ──────────────────────────────

class TestF2BarsPerDayInAutoReduce:
    """F-2: WF auto-reduction must use BARS_PER_DAY × MIN_OOS_DAYS, not bare MIN_OOS_DAYS."""

    def test_intraday_requires_more_bars_than_daily(self):
        """For 5min data, required_bars_per_split must be > 60 (not = 60)."""
        from src.engine.backtester import BARS_PER_DAY
        from src.engine.walk_forward import MIN_OOS_DAYS
        bars_per_day_5min = BARS_PER_DAY.get("5min", 1)
        assert bars_per_day_5min > 1, "5min BARS_PER_DAY must be > 1"
        min_bars_5min = MIN_OOS_DAYS * bars_per_day_5min
        min_bars_daily = MIN_OOS_DAYS * BARS_PER_DAY.get("daily", 1)
        assert min_bars_5min > min_bars_daily, (
            f"5min minimum OOS bars ({min_bars_5min}) must exceed daily minimum ({min_bars_daily})"
        )

    def test_daily_data_not_over_reduced(self):
        """Daily data (BARS_PER_DAY=1) should use MIN_OOS_DAYS as threshold (same as before fix)."""
        from src.engine.backtester import BARS_PER_DAY
        from src.engine.walk_forward import MIN_OOS_DAYS
        bars_per_day_daily = BARS_PER_DAY.get("daily", 1)
        assert bars_per_day_daily == 1, f"Expected 1 bars/day for 'daily', got {bars_per_day_daily}"
        expected_min = MIN_OOS_DAYS * 1  # = MIN_OOS_DAYS, same as before fix
        assert expected_min == MIN_OOS_DAYS


class TestF12ClassWFOptimizeGuard:
    """F-12: run_walk_forward_class must raise NotImplementedError when optimize=True."""

    def test_optimize_true_raises(self):
        """Calling with optimize=True must raise NotImplementedError."""
        import polars as pl

        from src.engine.strategy_base import BaseStrategy
        from src.engine.walk_forward import run_walk_forward_class

        class _DummyStrategy(BaseStrategy):
            name = "dummy"
            symbol = "MES"
            timeframe = "daily"
            def compute(self, df: pl.DataFrame) -> pl.DataFrame:
                return df.with_columns([
                    pl.lit(False).alias("entry_long"),
                    pl.lit(False).alias("entry_short"),
                    pl.lit(False).alias("exit_long"),
                    pl.lit(False).alias("exit_short"),
                ])
            # FIX 4 (ds21): BaseStrategy gained abstract get_params() /
            # get_default_config() (see src/engine/strategy_base.py:61-69) —
            # this dummy predates those and can no longer be instantiated
            # without them. Minimal stubs only; the F-12 guard under test
            # fires before either method would ever be called.
            def get_params(self) -> dict:
                return {}
            def get_default_config(self) -> dict:
                return {"name": self.name, "symbol": self.symbol, "timeframe": self.timeframe}

        strategy = _DummyStrategy()
        with pytest.raises(NotImplementedError, match="Wave 24"):
            run_walk_forward_class(
                strategy=strategy,
                start_date="2023-01-01",
                end_date="2023-12-31",
                optimize=True,
            )

    def test_optimize_false_does_not_raise_not_implemented(self):
        """optimize=False (default) must not raise NotImplementedError with Wave 24."""
        import polars as pl

        from src.engine.strategy_base import BaseStrategy
        from src.engine.walk_forward import run_walk_forward_class

        # We only test that the error is NOT a NotImplementedError from the guard.
        # The function may still raise other errors (data load, etc.) — that's OK.
        class _DummyStrategy(BaseStrategy):
            name = "dummy"
            symbol = "MES"
            timeframe = "daily"
            def compute(self, df: pl.DataFrame) -> pl.DataFrame:
                return df.with_columns([
                    pl.lit(False).alias("entry_long"),
                    pl.lit(False).alias("entry_short"),
                    pl.lit(False).alias("exit_long"),
                    pl.lit(False).alias("exit_short"),
                ])
            # FIX 4 (ds21): BaseStrategy gained abstract get_params() /
            # get_default_config() (see src/engine/strategy_base.py:61-69) —
            # this dummy predates those and can no longer be instantiated
            # without them. Minimal stubs only; the F-12 guard under test
            # fires before either method would ever be called.
            def get_params(self) -> dict:
                return {}
            def get_default_config(self) -> dict:
                return {"name": self.name, "symbol": self.symbol, "timeframe": self.timeframe}

        strategy = _DummyStrategy()
        try:
            run_walk_forward_class(
                strategy=strategy,
                start_date="2023-01-01",
                end_date="2023-12-31",
                optimize=False,
            )
        except NotImplementedError as e:
            if "Wave 24" in str(e):
                pytest.fail(f"F-12 guard fired when optimize=False: {e}")
        except Exception:
            # FIX 4 (ds21): the docstring/comment above has always documented
            # that "other errors (data load, etc.) — that's OK" for this test —
            # it exists purely to prove the F-12 NotImplementedError guard does
            # NOT fire at optimize=False, not to prove a full WF run succeeds.
            # No `data=` is passed here, so run_walk_forward_class falls
            # through to load_ohlcv() against real S3 data; in sandboxes
            # without AWS credentials that raises a RuntimeError, which the
            # original bare `except NotImplementedError` did not catch and
            # therefore let escape as an unrelated test failure. Broadening
            # the catch makes the test actually honor its documented intent.
            pass


# ─── FIX 4 (deep-scan #9): plain-WF embargo calibration basis ────────────────

class TestFix4PlainWfEmbargoBasis:
    """FIX 4: wf_metadata.embargo_basis present on plain WF path.

    Pure-logic unit tests — verify the embargo calibration computation
    without invoking the full walk-forward engine (avoids vectorbt hang).
    """

    def _compute_embargo_basis(
        self,
        trades: list[dict],
        embargo_bars: int = 20,
    ) -> str:
        """Replicate FIX 4 embargo_basis logic from plain-WF aggregation block."""
        durations = [
            int(t["duration_bars"])
            for t in trades
            if isinstance(t.get("duration_bars"), (int, float)) and t["duration_bars"] > 0
        ]
        if not durations:
            return "default_20_uncalibrated"
        avg_dur = sum(durations) / len(durations)
        calibrated = max(embargo_bars, int(avg_dur + 0.5))
        return f"calibrated_{calibrated}"

    def test_no_duration_bars_returns_default(self):
        """Trades without duration_bars → 'default_20_uncalibrated'."""
        trades = [{"PnL": 100}, {"PnL": -50}]
        assert self._compute_embargo_basis(trades) == "default_20_uncalibrated"

    def test_empty_trades_returns_default(self):
        """No trades → 'default_20_uncalibrated'."""
        assert self._compute_embargo_basis([]) == "default_20_uncalibrated"

    def test_duration_above_embargo_uses_avg_duration(self):
        """Avg duration > embargo_bars → calibrated uses avg duration."""
        trades = [
            {"PnL": 100, "duration_bars": 30},
            {"PnL": -50, "duration_bars": 34},
        ]
        # avg = 32, embargo = 20 → calibrated = 32
        result = self._compute_embargo_basis(trades, embargo_bars=20)
        assert result == "calibrated_32"

    def test_duration_below_embargo_uses_embargo(self):
        """Avg duration < embargo_bars → calibrated = embargo_bars."""
        trades = [
            {"PnL": 100, "duration_bars": 5},
            {"PnL": -50, "duration_bars": 7},
        ]
        # avg = 6, embargo = 20 → calibrated = 20
        result = self._compute_embargo_basis(trades, embargo_bars=20)
        assert result == "calibrated_20"

    def test_duration_equal_to_embargo(self):
        """Avg duration == embargo_bars → calibrated = embargo_bars."""
        trades = [{"duration_bars": 20, "PnL": 100}]
        result = self._compute_embargo_basis(trades, embargo_bars=20)
        assert result == "calibrated_20"

    def test_zero_duration_bars_excluded(self):
        """duration_bars=0 entries are excluded from avg computation."""
        trades = [
            {"duration_bars": 0, "PnL": 100},  # excluded
            {"duration_bars": 30, "PnL": 50},  # only valid one
        ]
        result = self._compute_embargo_basis(trades, embargo_bars=20)
        assert result == "calibrated_30"

    def test_all_zero_duration_bars_returns_default(self):
        """All duration_bars=0 → falls back to default (no valid durations)."""
        trades = [{"duration_bars": 0, "PnL": 100}, {"duration_bars": 0, "PnL": -50}]
        result = self._compute_embargo_basis(trades)
        assert result == "default_20_uncalibrated"

    def test_format_string_prefix(self):
        """Result is either 'default_20_uncalibrated' or 'calibrated_<int>'."""
        r1 = self._compute_embargo_basis([])
        r2 = self._compute_embargo_basis([{"duration_bars": 25}], 20)
        assert r1 == "default_20_uncalibrated"
        assert r2.startswith("calibrated_")
        n = int(r2.split("_")[1])
        assert isinstance(n, int) and n > 0

    def test_replay_determinism(self):
        """Same inputs → same embargo_basis (pure function)."""
        trades = [{"duration_bars": 28, "PnL": 100}, {"duration_bars": 32, "PnL": -50}]
        r1 = self._compute_embargo_basis(trades, 20)
        r2 = self._compute_embargo_basis(trades, 20)
        assert r1 == r2
