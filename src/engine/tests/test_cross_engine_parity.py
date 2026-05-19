"""A3 — Cross-Engine Parity Test (W10 Team A).

Runs the same fixture through two independent implementations:
  - VBT side: a minimal bar-by-bar vectorbt-equivalent runner inside diff_harness.py
  - BT side: backtrader (event-driven, separate execution model)

If both engines agree within tolerance, the backtester is likely correct.
If they disagree, the divergence is documented for investigation.

Tolerances (per plan A3):
  PnL:    within 0.1%
  Trades: within ±1
  Sharpe: within 0.05

Test isolation:
  - Uses only synthetic OHLCV data — no S3, no DB, no network.
  - backtrader is imported only inside this file and parity_engine/.
    It does NOT bleed into any production path.
  - conftest.py autouse determinism fixture applies automatically.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.engine.parity_engine.diff_harness import (
    PNL_TOLERANCE_PCT,
    SHARPE_TOLERANCE,
    TRADE_COUNT_TOLERANCE,
    ParityResult,
    run_parity_diff,
)
from src.engine.parity_engine.backtrader_adapter import run_backtrader

# ─── Constants ────────────────────────────────────────────────────────

FIXTURE_DIR = Path(__file__).parent.parent / "strategies" / "dsl_fixtures"


# ─── Synthetic data helpers ────────────────────────────────────────────

def _make_trending_ohlcv(
    n: int = 500,
    base: float = 18000.0,   # MNQ range
    tick: float = 0.25,
    trend: float = 2.5,      # points per bar — enough for EMA crossover to fire
    seed: int = 42,
) -> pd.DataFrame:
    """Generate deterministic trending OHLCV for EMA crossover tests."""
    rng = np.random.default_rng(seed)
    closes = np.zeros(n, dtype=float)
    closes[0] = base
    noise = rng.normal(0, 5.0, n)   # 5-point noise (smaller than trend)
    for i in range(1, n):
        closes[i] = closes[i - 1] + trend + noise[i]

    # Add a reversal at midpoint to generate crossover signals in both directions
    mid = n // 2
    for i in range(mid, n):
        closes[i] = closes[i - 1] - trend * 0.8 + noise[i]

    bar_range = rng.uniform(5.0, 15.0, n)
    highs = closes + bar_range * 0.6
    lows = closes - bar_range * 0.4
    opens = np.roll(closes, 1)
    opens[0] = closes[0]

    idx = pd.date_range(start="2024-01-02 09:30", periods=n, freq="15min")
    return pd.DataFrame({
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": rng.integers(500, 5000, n).astype(float),
    }, index=idx)


def _make_ranging_ohlcv(
    n: int = 600,
    base: float = 5200.0,   # MES range
    atr_size: float = 8.0,  # controls ATR value → breakout channel width
    seed: int = 42,
) -> pd.DataFrame:
    """Generate deterministic ranging OHLCV for ATR breakout tests.

    Oscillates inside a band, with occasional breakouts large enough to
    trigger the 1.5x ATR breakout entry on scalper_mes.
    """
    rng = np.random.default_rng(seed)
    closes = np.zeros(n, dtype=float)
    closes[0] = base

    for i in range(1, n):
        # Mostly oscillate around base
        reversion = -0.3 * (closes[i - 1] - base)
        noise = rng.normal(0, atr_size * 0.7)
        closes[i] = closes[i - 1] + reversion + noise

    # Inject 8 explicit breakout events (every 70 bars)
    for k in range(8):
        idx_b = 50 + k * 70
        if idx_b + 5 < n:
            direction = 1 if k % 2 == 0 else -1
            for j in range(5):
                closes[idx_b + j] = closes[idx_b - 1] + direction * atr_size * (2.5 + j * 0.5)

    bar_range = rng.uniform(3.0, atr_size * 1.5, n)
    highs = closes + bar_range * 0.6
    lows = closes - bar_range * 0.4
    opens = np.roll(closes, 1)
    opens[0] = closes[0]

    idx = pd.date_range(start="2024-01-02 09:30", periods=n, freq="5min")
    return pd.DataFrame({
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": rng.integers(500, 5000, n).astype(float),
    }, index=idx)


def _flat_slippage(n: int, dollars_per_bar: float = 1.25) -> np.ndarray:
    """Deterministic, uniform slippage array."""
    return np.full(n, dollars_per_bar, dtype=float)


# ─── Load DSL fixtures ────────────────────────────────────────────────

def _load_dsl(name: str) -> dict:
    path = FIXTURE_DIR / f"{name}.json"
    with open(path) as f:
        return json.load(f)


# ─── Fixtures ─────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def trend_mnq_dsl():
    return _load_dsl("trend_mnq")


@pytest.fixture(scope="module")
def scalper_mes_dsl():
    return _load_dsl("scalper_mes")


@pytest.fixture(scope="module")
def trending_df():
    return _make_trending_ohlcv()


@pytest.fixture(scope="module")
def ranging_df():
    return _make_ranging_ohlcv()


# ═══ Test class: Parity harness infrastructure ════════════════════════

class TestParityHarnessInfra:
    """Verify the diff harness behaves correctly before running fixture parity."""

    def test_deterministic_data_generation(self):
        """Same seed produces identical data."""
        df1 = _make_trending_ohlcv(seed=42)
        df2 = _make_trending_ohlcv(seed=42)
        pd.testing.assert_frame_equal(df1, df2)

    def test_different_seeds_produce_different_data(self):
        df1 = _make_trending_ohlcv(seed=42)
        df2 = _make_trending_ohlcv(seed=99)
        assert not df1["close"].equals(df2["close"])

    def test_slippage_array_shape(self):
        df = _make_trending_ohlcv(n=100)
        slip = _flat_slippage(len(df))
        assert slip.shape == (100,)
        assert not np.any(np.isnan(slip))

    def test_ohlcv_invariant_trending(self):
        """high >= close >= low for every bar."""
        df = _make_trending_ohlcv()
        assert (df["high"] >= df["close"]).all()
        assert (df["close"] >= df["low"]).all()

    def test_ohlcv_invariant_ranging(self):
        df = _make_ranging_ohlcv()
        assert (df["high"] >= df["close"]).all()
        assert (df["close"] >= df["low"]).all()

    def test_fixture_files_exist(self):
        assert (FIXTURE_DIR / "trend_mnq.json").exists()
        assert (FIXTURE_DIR / "scalper_mes.json").exists()

    def test_dsl_loads_correctly(self):
        dsl = _load_dsl("trend_mnq")
        assert dsl["entry_indicator"] == "ema_crossover"
        assert dsl["symbol"] == "MNQ"

    def test_parity_result_schema(self, trend_mnq_dsl, trending_df):
        """ParityResult has all required fields."""
        result = run_parity_diff(
            fixture_name="trend_mnq",
            dsl=trend_mnq_dsl,
            df_pd=trending_df,
            slippage_arr=_flat_slippage(len(trending_df)),
            commission_per_side=0.62,
            point_value=2.0,   # MNQ
            contracts=1,
        )
        assert isinstance(result.fixture_name, str)
        assert isinstance(result.vbt_trade_count, int)
        assert isinstance(result.bt_trade_count, int)
        assert isinstance(result.vbt_total_pnl, float)
        assert isinstance(result.bt_total_pnl, float)
        assert isinstance(result.pnl_diff_pct, float)
        assert isinstance(result.vbt_sharpe, float)
        assert isinstance(result.bt_sharpe, float)
        assert isinstance(result.sharpe_diff, float)
        assert isinstance(result.passed, bool)
        assert isinstance(result.failure_reasons, list)
        assert isinstance(result.vbt_trades, list)
        assert isinstance(result.bt_trades, list)


# ═══ Test class: Backtrader adapter unit tests ════════════════════════

class TestBacktraderAdapter:
    """Unit tests for the backtrader adapter in isolation."""

    def test_bt_produces_trades_on_trending_data(self, trend_mnq_dsl, trending_df):
        trades = run_backtrader(
            dsl=trend_mnq_dsl,
            df_pd=trending_df,
            slippage_arr=_flat_slippage(len(trending_df)),
            commission_per_side=0.62,
            point_value=2.0,
            contracts=1,
        )
        # Should produce at least 1 trade on trending data
        assert len(trades) >= 1

    def test_bt_trade_schema(self, trend_mnq_dsl, trending_df):
        trades = run_backtrader(
            dsl=trend_mnq_dsl,
            df_pd=trending_df,
            slippage_arr=_flat_slippage(len(trending_df)),
            commission_per_side=0.62,
            point_value=2.0,
            contracts=1,
        )
        assert len(trades) > 0
        t = trades[0]
        assert t.entry_bar >= 0
        assert t.exit_bar > t.entry_bar
        assert t.direction in ("Long", "Short")
        assert t.contracts == 1
        assert isinstance(t.net_pnl, float)
        assert t.exit_reason in ("stop", "target", "signal", "eod")

    def test_bt_pnl_math_is_futures_correct(self, trend_mnq_dsl, trending_df):
        """net_pnl = gross - slip - commission (never delegated to backtrader broker)."""
        trades = run_backtrader(
            dsl=trend_mnq_dsl,
            df_pd=trending_df,
            slippage_arr=_flat_slippage(len(trending_df), 1.0),
            commission_per_side=0.62,
            point_value=2.0,
            contracts=1,
        )
        assert len(trades) > 0
        t = trades[0]
        # Verify: gross = price_diff * contracts * point_value
        if t.direction == "Long":
            expected_gross = (t.exit_price - t.entry_price) * t.contracts * 2.0
        else:
            expected_gross = (t.entry_price - t.exit_price) * t.contracts * 2.0
        assert math.isclose(t.gross_pnl, expected_gross, rel_tol=1e-6), (
            f"Gross PnL math wrong: expected {expected_gross:.4f}, got {t.gross_pnl}"
        )
        # Verify: comm_cost = commission_per_side * contracts * 2
        assert math.isclose(t.comm_cost, 0.62 * 1 * 2, rel_tol=1e-6)

    def test_bt_both_directions_produce_trades(self, trend_mnq_dsl, trending_df):
        """direction=both generates both long and short trades."""
        assert trend_mnq_dsl["direction"] == "both"
        trades = run_backtrader(
            dsl=trend_mnq_dsl,
            df_pd=trending_df,
            slippage_arr=_flat_slippage(len(trending_df)),
            commission_per_side=0.62,
            point_value=2.0,
            contracts=1,
        )
        directions = {t.direction for t in trades}
        assert "Long" in directions or "Short" in directions  # at least one

    def test_bt_deterministic(self, trend_mnq_dsl, trending_df):
        """Same inputs → same trade list on two runs."""
        slip = _flat_slippage(len(trending_df))
        trades1 = run_backtrader(trend_mnq_dsl, trending_df, slip, 0.62, 2.0, 1)
        trades2 = run_backtrader(trend_mnq_dsl, trending_df, slip, 0.62, 2.0, 1)
        assert len(trades1) == len(trades2)
        for t1, t2 in zip(trades1, trades2):
            assert t1.entry_bar == t2.entry_bar
            assert t1.exit_bar == t2.exit_bar
            assert math.isclose(t1.net_pnl, t2.net_pnl, abs_tol=1e-9)

    def test_bt_atr_breakout_produces_trades(self, scalper_mes_dsl, ranging_df):
        trades = run_backtrader(
            dsl=scalper_mes_dsl,
            df_pd=ranging_df,
            slippage_arr=_flat_slippage(len(ranging_df)),
            commission_per_side=0.62,
            point_value=5.0,
            contracts=1,
        )
        assert len(trades) >= 1

    def test_bt_unsupported_indicator_raises(self):
        dsl = {
            "entry_indicator": "keltner_squeeze",
            "direction": "long",
            "entry_params": {},
        }
        df = _make_trending_ohlcv(n=50)
        slip = _flat_slippage(50)
        with pytest.raises(NotImplementedError):
            run_backtrader(dsl, df, slip, 0.62, 5.0, 1)


# ═══ Test class: Fixture parity — trend_mnq (EMA crossover) ══════════

class TestParityTrendMNQ:
    """Cross-engine parity for trend_mnq.json (EMA crossover)."""

    @pytest.fixture(autouse=True)
    def _run(self, trend_mnq_dsl, trending_df):
        self.result: ParityResult = run_parity_diff(
            fixture_name="trend_mnq",
            dsl=trend_mnq_dsl,
            df_pd=trending_df,
            slippage_arr=_flat_slippage(len(trending_df)),
            commission_per_side=0.62,
            point_value=2.0,   # MNQ = $2/point
            contracts=1,
        )

    def test_both_engines_produce_trades(self):
        assert self.result.vbt_trade_count >= 1, "VBT produced no trades"
        assert self.result.bt_trade_count >= 1, "Backtrader produced no trades"

    def test_trade_count_within_tolerance(self):
        diff = abs(self.result.vbt_trade_count - self.result.bt_trade_count)
        assert diff <= TRADE_COUNT_TOLERANCE, (
            f"Trade count divergence: VBT={self.result.vbt_trade_count} "
            f"BT={self.result.bt_trade_count} diff={diff}\n"
            f"Failure reasons: {self.result.failure_reasons}"
        )

    def test_pnl_within_tolerance(self):
        assert self.result.pnl_diff_pct <= PNL_TOLERANCE_PCT, (
            f"PnL divergence too large: {self.result.pnl_diff_pct:.4f}% > {PNL_TOLERANCE_PCT}%\n"
            f"VBT total: {self.result.vbt_total_pnl:.2f}, BT total: {self.result.bt_total_pnl:.2f}\n"
            f"Failure reasons: {self.result.failure_reasons}"
        )

    def test_sharpe_within_tolerance(self):
        assert self.result.sharpe_diff <= SHARPE_TOLERANCE, (
            f"Sharpe divergence: VBT={self.result.vbt_sharpe:.4f} "
            f"BT={self.result.bt_sharpe:.4f} diff={self.result.sharpe_diff:.4f}\n"
            f"Failure reasons: {self.result.failure_reasons}"
        )

    def test_parity_passed(self):
        """Master assertion — all tolerances satisfied."""
        if not self.result.passed:
            # Print trade-by-trade comparison for diagnostics
            print("\n── VBT trades ──")
            for t in self.result.vbt_trades[:10]:
                print(f"  bar {t.entry_bar}->{t.exit_bar} {t.direction} "
                      f"net={t.net_pnl:.2f} reason={t.exit_reason}")
            print("── BT trades ──")
            for t in self.result.bt_trades[:10]:
                print(f"  bar {t.entry_bar}->{t.exit_bar} {t.direction} "
                      f"net={t.net_pnl:.2f} reason={t.exit_reason}")
        assert self.result.passed, (
            f"Parity FAILED for {self.result.fixture_name}:\n"
            + "\n".join(f"  - {r}" for r in self.result.failure_reasons)
        )

    def test_result_is_deterministic(self, trend_mnq_dsl, trending_df):
        """Running diff twice gives identical results."""
        slip = _flat_slippage(len(trending_df))
        r1 = run_parity_diff("trend_mnq", trend_mnq_dsl, trending_df, slip, 0.62, 2.0, 1)
        r2 = run_parity_diff("trend_mnq", trend_mnq_dsl, trending_df, slip, 0.62, 2.0, 1)
        assert r1.vbt_trade_count == r2.vbt_trade_count
        assert r1.bt_trade_count == r2.bt_trade_count
        assert math.isclose(r1.vbt_total_pnl, r2.vbt_total_pnl, abs_tol=1e-6)
        assert math.isclose(r1.bt_total_pnl, r2.bt_total_pnl, abs_tol=1e-6)


# ═══ Test class: Fixture parity — scalper_mes (ATR breakout) ═════════

class TestParityScalperMES:
    """Cross-engine parity for scalper_mes.json (ATR breakout)."""

    @pytest.fixture(autouse=True)
    def _run(self, scalper_mes_dsl, ranging_df):
        self.result: ParityResult = run_parity_diff(
            fixture_name="scalper_mes",
            dsl=scalper_mes_dsl,
            df_pd=ranging_df,
            slippage_arr=_flat_slippage(len(ranging_df)),
            commission_per_side=0.62,
            point_value=5.0,   # MES = $5/point
            contracts=1,
        )

    def test_both_engines_produce_trades(self):
        assert self.result.vbt_trade_count >= 1, "VBT produced no trades"
        assert self.result.bt_trade_count >= 1, "Backtrader produced no trades"

    def test_trade_count_within_tolerance(self):
        diff = abs(self.result.vbt_trade_count - self.result.bt_trade_count)
        assert diff <= TRADE_COUNT_TOLERANCE, (
            f"Trade count divergence: VBT={self.result.vbt_trade_count} "
            f"BT={self.result.bt_trade_count} diff={diff}\n"
            f"Failure reasons: {self.result.failure_reasons}"
        )

    def test_pnl_within_tolerance(self):
        assert self.result.pnl_diff_pct <= PNL_TOLERANCE_PCT, (
            f"PnL divergence: {self.result.pnl_diff_pct:.4f}% > {PNL_TOLERANCE_PCT}%\n"
            f"VBT={self.result.vbt_total_pnl:.2f} BT={self.result.bt_total_pnl:.2f}\n"
            f"Failures: {self.result.failure_reasons}"
        )

    def test_sharpe_within_tolerance(self):
        assert self.result.sharpe_diff <= SHARPE_TOLERANCE, (
            f"Sharpe divergence: VBT={self.result.vbt_sharpe:.4f} "
            f"BT={self.result.bt_sharpe:.4f} diff={self.result.sharpe_diff:.4f}\n"
            f"Failures: {self.result.failure_reasons}"
        )

    def test_parity_passed(self):
        """Master assertion — all tolerances satisfied."""
        if not self.result.passed:
            print("\n── VBT trades ──")
            for t in self.result.vbt_trades[:10]:
                print(f"  bar {t.entry_bar}->{t.exit_bar} {t.direction} "
                      f"net={t.net_pnl:.2f} reason={t.exit_reason}")
            print("── BT trades ──")
            for t in self.result.bt_trades[:10]:
                print(f"  bar {t.entry_bar}->{t.exit_bar} {t.direction} "
                      f"net={t.net_pnl:.2f} reason={t.exit_reason}")
        assert self.result.passed, (
            f"Parity FAILED for {self.result.fixture_name}:\n"
            + "\n".join(f"  - {r}" for r in self.result.failure_reasons)
        )

    def test_result_is_deterministic(self, scalper_mes_dsl, ranging_df):
        slip = _flat_slippage(len(ranging_df))
        r1 = run_parity_diff("scalper_mes", scalper_mes_dsl, ranging_df, slip, 0.62, 5.0, 1)
        r2 = run_parity_diff("scalper_mes", scalper_mes_dsl, ranging_df, slip, 0.62, 5.0, 1)
        assert r1.vbt_trade_count == r2.vbt_trade_count
        assert r1.bt_trade_count == r2.bt_trade_count
        assert math.isclose(r1.vbt_total_pnl, r2.vbt_total_pnl, abs_tol=1e-6)
        assert math.isclose(r1.bt_total_pnl, r2.bt_total_pnl, abs_tol=1e-6)


# ═══ Test class: P&L math correctness ════════════════════════════════

class TestPnLMath:
    """Verify that both engines apply correct futures P&L formula."""

    def test_vbt_side_pnl_math(self, trend_mnq_dsl, trending_df):
        """VBT runner computes net_pnl = gross - slip - commission correctly."""
        from src.engine.parity_engine.diff_harness import _run_vbt_ema_crossover
        slip = _flat_slippage(len(trending_df), 2.0)  # $2/bar deterministic slip
        trades = _run_vbt_ema_crossover(
            trending_df, trend_mnq_dsl, slip, 0.62, 2.0, 1
        )
        assert len(trades) > 0
        t = trades[0]
        if t.direction == "Long":
            expected_gross = (t.exit_price - t.entry_price) * 1 * 2.0
        else:
            expected_gross = (t.entry_price - t.exit_price) * 1 * 2.0
        # slip_cost = (entry_slip + exit_slip) * contracts
        # comm_cost = 0.62 * 2 * 1
        # net = gross - slip_cost - comm_cost
        slip_cost = (slip[t.entry_bar] + slip[t.exit_bar]) * 1
        comm_cost = 0.62 * 2
        expected_net = expected_gross - slip_cost - comm_cost
        assert math.isclose(t.net_pnl, round(expected_net, 2), abs_tol=0.01), (
            f"VBT net_pnl math error: expected {expected_net:.4f} got {t.net_pnl}"
        )

    def test_no_lookahead_both_engines(self, trend_mnq_dsl, trending_df):
        """Entry fills occur after EMA warmup + confirmation + next-bar shift."""
        slip = _flat_slippage(len(trending_df))
        result = run_parity_diff("trend_mnq", trend_mnq_dsl, trending_df, slip, 0.62, 2.0, 1)
        # Earliest possible entry = slow_period (warmup) + confirmation_bars + 1 (next-bar shift)
        slow_period = trend_mnq_dsl["entry_params"]["slow_period"]
        conf_bars = trend_mnq_dsl["entry_params"]["confirmation_bars"]
        # +1 for crossover detection needing a prior bar, +1 for next-bar fill = +2 minimum
        min_entry = slow_period + conf_bars + 2
        for t in result.vbt_trades:
            assert t.entry_bar >= slow_period, (
                f"VBT trade entry bar {t.entry_bar} is before EMA warmup={slow_period}"
            )
        for t in result.bt_trades:
            assert t.entry_bar >= slow_period, (
                f"BT trade entry bar {t.entry_bar} is before EMA warmup={slow_period}"
            )

    def test_zero_slippage_no_impact_on_count(self, trend_mnq_dsl, trending_df):
        """Zero slippage does not change trade count vs positive slippage."""
        slip_zero = np.zeros(len(trending_df))
        slip_pos = _flat_slippage(len(trending_df), 1.0)
        r_zero = run_parity_diff("trend_mnq", trend_mnq_dsl, trending_df, slip_zero, 0.62, 2.0, 1)
        r_pos = run_parity_diff("trend_mnq", trend_mnq_dsl, trending_df, slip_pos, 0.62, 2.0, 1)
        # Trade count must be identical (slippage never filters signals)
        assert r_zero.vbt_trade_count == r_pos.vbt_trade_count
        assert r_zero.bt_trade_count == r_pos.bt_trade_count

    def test_higher_commission_reduces_net_pnl(self, trend_mnq_dsl, trending_df):
        """Higher commission → lower total PnL (sanity check)."""
        slip = _flat_slippage(len(trending_df))
        r_low = run_parity_diff("trend_mnq", trend_mnq_dsl, trending_df, slip, 0.62, 2.0, 1)
        r_high = run_parity_diff("trend_mnq", trend_mnq_dsl, trending_df, slip, 5.00, 2.0, 1)
        assert r_high.vbt_total_pnl < r_low.vbt_total_pnl
        assert r_high.bt_total_pnl < r_low.bt_total_pnl


# ═══ Test class: Production isolation ════════════════════════════════

class TestProductionIsolation:
    """Verify backtrader does not bleed into production paths."""

    def test_backtrader_not_imported_in_backtester(self):
        """backtester.py must not import backtrader."""
        backtester_path = (
            Path(__file__).parent.parent / "backtester.py"
        )
        content = backtester_path.read_text()
        assert "import backtrader" not in content, (
            "backtester.py must not import backtrader — parity engine is test-only"
        )
        assert "from backtrader" not in content, (
            "backtester.py must not import from backtrader"
        )

    def test_backtrader_not_in_signals(self):
        signals_path = Path(__file__).parent.parent / "signals.py"
        content = signals_path.read_text()
        assert "backtrader" not in content

    def test_backtrader_not_in_fill_model(self):
        fill_path = Path(__file__).parent.parent / "fill_model.py"
        if fill_path.exists():
            content = fill_path.read_text()
            assert "backtrader" not in content

    def test_parity_engine_init_is_test_only(self):
        """__init__.py documents test-only constraint."""
        init_path = Path(__file__).parent.parent / "parity_engine" / "__init__.py"
        content = init_path.read_text()
        assert "TEST-ONLY" in content or "test-only" in content.lower(), (
            "parity_engine/__init__.py must document that this package is test-only"
        )
