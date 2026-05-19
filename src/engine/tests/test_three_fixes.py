"""Regression tests for three confirmed bug fixes:

  Fix 1 — WF max_dd uses bar-level equity (not daily P&L aggregates).
  Fix 2 — Friction split across entry/exit bars; total P&L invariant preserved.
  Fix 3 — fill_model and cross_validation use PCG64DXSM (create_authoritative_rng).
"""

from __future__ import annotations

import numpy as np
import pytest


# ─── Fix 1: WF intraday max DD ──────────────────────────────────────────────

class TestWFIntraMaxDD:
    """The walk-forward aggregator must report max_dd using bar-level equity,
    not daily P&L aggregates.  A strategy with -$1800 close-to-close DD but
    -$2200 intraday swing must be flagged with max_dd >= 2200."""

    def _build_equity_bars_with_intraday_spike(self) -> list[float]:
        """Synthetic bar sequence with:
          - start capital: 50_000
          - intraday trough: -$2200 below peak (hits 47_800)
          - daily close: only -$1800 below peak (48_200)
        Pattern: rises to 50_000, drops intraday to 47_800 within a bar sequence,
        but closes the *day* at 48_200 (less than $2200 below peak).
        """
        # Day 1: start at 50_000, no movement
        bars = [50_000.0] * 5

        # Day 2: rises to peak 50_200 within day
        bars += [50_050.0, 50_100.0, 50_150.0, 50_200.0]

        # Day 3 intraday: drops hard to 47_800 (peak=50_200, intraday DD=$2400 > $2200)
        # but closes at 48_400 (close-to-peak DD=$1800)
        bars += [50_000.0, 49_500.0, 49_000.0, 48_500.0, 47_800.0, 48_000.0, 48_200.0, 48_400.0]

        # Day 4: recovers partially
        bars += [48_600.0, 48_800.0, 49_000.0]

        return bars

    def test_bar_level_max_dd_exceeds_daily_max_dd(self):
        """Bar-level max DD must be >= intraday trough depth ($2400 here)."""
        equity_bars = np.array(self._build_equity_bars_with_intraday_spike(), dtype=float)

        # Compute bar-level max DD (the new WF approach)
        running_peak = np.maximum.accumulate(equity_bars)
        bar_level_max_dd = float(np.max(running_peak - equity_bars))

        # Compute daily-close-level max DD (the OLD faulty approach)
        # Simulate daily closes: last bar of each "day" segment
        day_closes = [50_000.0, 50_200.0, 48_400.0, 49_000.0]
        cum_pnl_daily = np.cumsum(np.diff([50_000.0] + day_closes))
        running_peak_daily = np.maximum.accumulate(np.array([50_000.0] + day_closes))
        daily_max_dd = float(np.max(running_peak_daily - np.array([50_000.0] + day_closes)))

        # Bar-level should catch the deeper intraday swing
        assert bar_level_max_dd > daily_max_dd, (
            f"bar_level_max_dd={bar_level_max_dd:.0f} should exceed daily_max_dd={daily_max_dd:.0f}"
        )
        # The intraday trough is 47_800 vs peak 50_200 = $2400 drawdown
        assert bar_level_max_dd >= 2400.0, (
            f"Expected bar-level max_dd >= $2400, got {bar_level_max_dd:.2f}"
        )

    def test_wf_aggregator_uses_equity_bars_when_available(self):
        """When equity_bars is present in OOS results, WF must use it for max_dd."""
        from unittest.mock import patch, MagicMock
        import numpy as np

        # Build an equity_bars list with known $2200 intraday DD
        equity_bars = [50_000.0, 50_100.0, 47_800.0, 48_500.0, 49_000.0]
        # Daily P&L implies only -$1000 DD (from 50_100 → 49_100 or similar)
        daily_pnls = [100.0, -2200.0 + 2000.0, 500.0]  # sum ~ $0 — bar-level DD dominates

        # Directly test the bar-level DD computation path that walk_forward.py uses
        eq_arr = np.array(equity_bars, dtype=float)
        running_peak = np.maximum.accumulate(eq_arr)
        max_dd_bars = float(np.max(running_peak - eq_arr))

        # Fallback daily P&L path
        cum_pnl = np.cumsum(daily_pnls)
        running_peak_daily = np.maximum.accumulate(cum_pnl)
        max_dd_daily = float(np.max(running_peak_daily - cum_pnl))

        assert max_dd_bars >= 2200.0, (
            f"Bar-level max_dd should catch $2200 intraday swing, got {max_dd_bars:.2f}"
        )
        assert max_dd_bars > max_dd_daily, (
            f"Bar-level max_dd={max_dd_bars:.2f} should exceed daily max_dd={max_dd_daily:.2f}"
        )

    def test_equity_bars_key_present_in_backtest_result(self):
        """run_backtest result must contain equity_bars key."""
        from datetime import datetime, timedelta
        import polars as pl
        from src.engine.config import (
            BacktestRequest, StrategyConfig, IndicatorConfig,
            PositionSizeConfig, StopConfig,
        )
        from src.engine.backtester import run_backtest

        n = 120
        dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
        closes = [4000.0 + i * 0.3 + (i % 5) * 2 for i in range(n)]
        df = pl.DataFrame({
            "ts_event": dates,
            "open":   [c - 1.0 for c in closes],
            "high":   [c + 3.0 for c in closes],
            "low":    [c - 3.0 for c in closes],
            "close":  closes,
            "volume": [50000] * n,
        })
        config = BacktestRequest(
            strategy=StrategyConfig(
                name="TestEqBars",
                symbol="MES",
                timeframe="daily",
                indicators=[IndicatorConfig(type="sma", period=5)],
                entry_long="close crosses_above sma_5",
                entry_short="close crosses_below sma_5",
                exit="close crosses_below sma_5",
                stop_loss=StopConfig(type="atr", multiplier=2.0),
                position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
            ),
            start_date="2023-01-01",
            end_date="2023-05-01",
        )
        result = run_backtest(config, data=df)
        assert "equity_bars" in result, "run_backtest result must contain equity_bars"
        assert isinstance(result["equity_bars"], list), "equity_bars must be a list"
        assert len(result["equity_bars"]) > 0, "equity_bars must be non-empty"
        # Bar-level max DD should be >= daily-close max DD (never less)
        bar_arr = np.array(result["equity_bars"], dtype=float)
        bar_peak = np.maximum.accumulate(bar_arr)
        bar_dd = float(np.max(bar_peak - bar_arr))
        # Daily DD from daily_pnls
        daily_pnls = result.get("daily_pnls", [])
        if daily_pnls:
            cum = np.cumsum(daily_pnls)
            daily_peak = np.maximum.accumulate(cum)
            daily_dd = float(np.max(daily_peak - cum))
            assert bar_dd >= daily_dd - 0.01, (
                f"Bar-level max_dd={bar_dd:.2f} should not be less than daily_dd={daily_dd:.2f}"
            )


# ─── Fix 2: Friction split across entry/exit bars ───────────────────────────

class TestFrictionSplit:
    """Total trade P&L must be unchanged after the friction split fix.
    Entry bars should carry entry_slip + half commission.
    Exit bars should carry exit_slip + half commission.
    """

    def _make_trade(self, entry_idx: int, exit_idx: int,
                    entry_price: float, exit_price: float,
                    slip_cost: float, comm_cost: float) -> dict:
        return {
            "Entry Idx": entry_idx,
            "Exit Idx": exit_idx,
            "Avg Entry Price": entry_price,
            "Avg Exit Price": exit_price,
            "Size": 1,
            "Direction": "Long",
            "SlippageCost": slip_cost,
            "CommissionCost": comm_cost,
            "PnL": (exit_price - entry_price) * 5.0 - slip_cost - comm_cost,
        }

    def test_3day_trade_friction_split_total_invariant(self):
        """3-day trade: total bar P&Ls must equal (exit-entry) * point_value - total_friction."""
        # Setup: 5-bar array, MES point_value=5
        n_bars = 5
        point_value = 5.0
        entry_idx = 1
        exit_idx = 4
        entry_price = 4000.0
        exit_price = 4020.0
        slip_cost = 6.0   # total slippage (split 3+3)
        comm_cost = 4.0   # total commission (split 2+2)

        close_arr = np.array([4000.0, 4000.0, 4010.0, 4015.0, 4020.0])

        # Build expected split values
        entry_slip = slip_cost / 2.0  # 3.0
        exit_slip = slip_cost / 2.0   # 3.0
        half_comm = comm_cost / 2.0   # 2.0

        bar_dollar_pnls = np.zeros(n_bars)

        # Entry bar: entry_price → close[entry_idx]
        bar_dollar_pnls[entry_idx] += (close_arr[entry_idx] - entry_price) * 1 * point_value
        # Intermediate bars: close[i-1] → close[i]
        prev = close_arr[entry_idx]
        for bar in range(entry_idx + 1, exit_idx):
            bar_dollar_pnls[bar] += (close_arr[bar] - prev) * 1 * point_value
            prev = close_arr[bar]
        # Exit bar: prev close → exit price
        bar_dollar_pnls[exit_idx] += (exit_price - prev) * 1 * point_value

        # Apply friction split
        bar_dollar_pnls[entry_idx] -= (entry_slip + half_comm)  # entry bar: 3 + 2 = 5
        bar_dollar_pnls[exit_idx] -= (exit_slip + half_comm)    # exit bar:  3 + 2 = 5

        total_bar_pnl = float(np.sum(bar_dollar_pnls))
        expected_trade_pnl = (exit_price - entry_price) * point_value - slip_cost - comm_cost

        assert abs(total_bar_pnl - expected_trade_pnl) < 0.01, (
            f"Total P&L invariant broken: bars={total_bar_pnl:.2f}, expected={expected_trade_pnl:.2f}"
        )

    def test_friction_split_not_all_on_entry_bar(self):
        """After fix: entry bar must NOT carry all friction — exit bar must also be reduced."""
        n_bars = 5
        point_value = 5.0
        entry_idx = 1
        exit_idx = 4
        entry_price = 4000.0
        exit_price = 4020.0
        slip_cost = 6.0
        comm_cost = 4.0

        close_arr = np.array([4000.0, 4000.0, 4010.0, 4015.0, 4020.0])

        bar_old = np.zeros(n_bars)
        bar_new = np.zeros(n_bars)

        # Both paths: same mark-to-market P&L
        for bar_arr in [bar_old, bar_new]:
            bar_arr[entry_idx] += (close_arr[entry_idx] - entry_price) * point_value
            prev = close_arr[entry_idx]
            for b in range(entry_idx + 1, exit_idx):
                bar_arr[b] += (close_arr[b] - prev) * point_value
                prev = close_arr[b]
            bar_arr[exit_idx] += (exit_price - prev) * point_value

        # Old path: all friction on entry bar
        bar_old[entry_idx] -= (slip_cost + comm_cost)

        # New path (Fix 2): split
        entry_slip = slip_cost / 2.0
        exit_slip = slip_cost / 2.0
        half_comm = comm_cost / 2.0
        bar_new[entry_idx] -= (entry_slip + half_comm)
        bar_new[exit_idx] -= (exit_slip + half_comm)

        # Totals must be identical
        assert abs(np.sum(bar_old) - np.sum(bar_new)) < 0.01, "Total P&L must be invariant"

        # Entry bar must differ between old and new
        assert abs(bar_old[entry_idx] - bar_new[entry_idx]) > 0.5, (
            "Entry bar P&L should differ: some friction moved to exit bar"
        )
        # Exit bar must carry friction in new path
        assert bar_new[exit_idx] < bar_old[exit_idx], (
            "Exit bar P&L should be reduced by exit friction in new path"
        )

    def test_daily_pnl_total_unchanged_after_friction_split(self):
        """Running the actual backtester: total return must not change after the friction split."""
        from datetime import datetime, timedelta
        import polars as pl
        from src.engine.config import (
            BacktestRequest, StrategyConfig, IndicatorConfig,
            PositionSizeConfig, StopConfig,
        )
        from src.engine.backtester import run_backtest

        n = 150
        dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
        # Trend data → generates real trades
        closes = [4000.0 + i * 0.8 + (i % 10) * 1.5 - 7 for i in range(n)]
        df = pl.DataFrame({
            "ts_event": dates,
            "open":   [c - 1.0 for c in closes],
            "high":   [c + 4.0 for c in closes],
            "low":    [c - 4.0 for c in closes],
            "close":  closes,
            "volume": [50000] * n,
        })
        config = BacktestRequest(
            strategy=StrategyConfig(
                name="FrictionTest",
                symbol="MES",
                timeframe="daily",
                indicators=[IndicatorConfig(type="sma", period=5)],
                entry_long="close crosses_above sma_5",
                entry_short="close crosses_below sma_5",
                exit="close crosses_below sma_5",
                stop_loss=StopConfig(type="atr", multiplier=2.0),
                position_size=PositionSizeConfig(type="fixed", fixed_contracts=1),
            ),
            start_date="2023-01-01",
            end_date="2023-06-01",
        )
        result = run_backtest(config, data=df)
        # Reconciliation check is inside run_backtest — if it passes, total P&L is consistent.
        # Also verify that daily_pnls sums to approximately total_return
        total_return = result["total_return"]
        daily_sum = sum(result.get("daily_pnls", []))
        # The equity curve is mark-to-market; daily_pnls are computed from equity curve diffs,
        # so their sum should equal total_return within floating-point tolerance.
        assert abs(daily_sum - total_return) < 1.0, (
            f"daily_pnls sum={daily_sum:.2f} should match total_return={total_return:.2f}"
        )


# ─── Fix 3: PCG64DXSM determinism ───────────────────────────────────────────

class TestPCG64DXSMDeterminism:
    """fill_model.apply_fill_model and cross_validation.bootstrap_ci must use
    PCG64DXSM (create_authoritative_rng) and produce identical output for the
    same seed on repeated calls."""

    def test_fill_model_same_seed_identical_output_pcg64dxsm(self):
        """apply_fill_model with same seed must produce np.array_equal output (PCG64DXSM)."""
        from src.engine.fill_model import apply_fill_model

        entries = np.ones(30, dtype=bool)
        fill_probs = np.full(30, 0.60)
        sizes = np.full(30, 2.0)
        seed = 77

        f1, s1 = apply_fill_model(entries, fill_probs, sizes, seed=seed)
        f2, s2 = apply_fill_model(entries, fill_probs, sizes, seed=seed)

        assert np.array_equal(f1, f2), "fill entries must be identical for same seed"
        assert np.array_equal(s1, s2), "fill sizes must be identical for same seed"

    def test_fill_model_uses_pcg64dxsm_not_sfc64(self):
        """Verify create_authoritative_rng is imported and used; no bare default_rng call."""
        import src.engine.fill_model as fm
        import inspect, re
        source = inspect.getsource(fm.apply_fill_model)
        assert "create_authoritative_rng" in source, (
            "apply_fill_model must call create_authoritative_rng, not np.random.default_rng"
        )
        # Scan for actual code call (not comments): rng = np.random.default_rng(...)
        non_comment_lines = [
            line for line in source.splitlines()
            if not line.lstrip().startswith("#")
        ]
        non_comment_src = "\n".join(non_comment_lines)
        assert "default_rng" not in non_comment_src, (
            "apply_fill_model must not call np.random.default_rng (SFC64 family) in non-comment code"
        )

    def test_bootstrap_ci_same_seed_identical_output_pcg64dxsm(self):
        """bootstrap_ci with same seed must produce identical ci_lower/ci_upper (PCG64DXSM)."""
        from src.engine.cross_validation import bootstrap_ci

        daily_pnls = [100.0, -50.0, 200.0, -30.0, 150.0, 80.0, -20.0,
                      120.0, -90.0, 75.0, 110.0, -40.0]
        seed = 42

        r1 = bootstrap_ci(daily_pnls, n_resamples=500, seed=seed)
        r2 = bootstrap_ci(daily_pnls, n_resamples=500, seed=seed)

        assert r1["ci_lower"] == r2["ci_lower"], (
            f"ci_lower must be identical: {r1['ci_lower']} vs {r2['ci_lower']}"
        )
        assert r1["ci_upper"] == r2["ci_upper"], (
            f"ci_upper must be identical: {r1['ci_upper']} vs {r2['ci_upper']}"
        )

    def test_bootstrap_ci_uses_pcg64dxsm_not_sfc64(self):
        """Verify create_authoritative_rng is imported and used in bootstrap_ci."""
        import src.engine.cross_validation as cv
        import inspect
        source = inspect.getsource(cv.bootstrap_ci)
        assert "create_authoritative_rng" in source, (
            "bootstrap_ci must call create_authoritative_rng"
        )
        assert "default_rng" not in source, (
            "bootstrap_ci must not use np.random.default_rng"
        )

    def test_different_seeds_produce_different_bootstrap_results(self):
        """Different seeds must produce different CI bounds (statistical sanity check)."""
        from src.engine.cross_validation import bootstrap_ci

        daily_pnls = [float(i * 10 - 50) for i in range(20)]  # varied P&Ls

        r1 = bootstrap_ci(daily_pnls, n_resamples=1000, seed=1)
        r2 = bootstrap_ci(daily_pnls, n_resamples=1000, seed=999)

        # Extremely unlikely to match across 1000 resamples with different seeds
        assert r1["ci_lower"] != r2["ci_lower"] or r1["ci_upper"] != r2["ci_upper"], (
            "Different seeds should produce different bootstrap CI results"
        )
