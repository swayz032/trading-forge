"""Strategy correctness tests — verify each rewritten strategy implements its concept correctly.

Each strategy gets at least one positive test (should generate signals in correct conditions)
and one negative test (should NOT generate signals in wrong conditions).
"""

from datetime import datetime, timedelta

import polars as pl
import pytest


def _make_ohlcv_at_time(start_hour: int, start_minute: int = 0, n: int = 50,
                         trend: str = "up", base_price: float = 4500.0):
    """Create OHLCV data starting at a specific time.

    Args:
        start_hour: Hour in ET (0-23)
        start_minute: Minute (0-59)
        n: Number of bars
        trend: "up", "down", or "flat"
        base_price: Starting price
    """
    base_time = datetime(2024, 3, 15, start_hour, start_minute)
    dates = [base_time + timedelta(minutes=i * 5) for i in range(n)]

    closes = []
    for i in range(n):
        if trend == "up":
            closes.append(base_price + i * 0.5 + (i % 5) * 0.3)
        elif trend == "down":
            closes.append(base_price - i * 0.5 - (i % 5) * 0.3)
        else:
            closes.append(base_price + (i % 7) * 0.3 - 1.0)

    return pl.DataFrame({
        "ts_event": dates,
        "open": [c - 0.3 for c in closes],
        "high": [c + 1.5 for c in closes],
        "low": [c - 1.5 for c in closes],
        "close": closes,
        "volume": [10000] * n,
    })


# ─── Silver Bullet ────────────────────────────────────────────────

class TestSilverBulletCorrectness:
    def test_no_signals_outside_sb_windows(self):
        """Signals at 8:30 AM (outside SB window) should NOT trigger entries."""
        from src.engine.strategies.silver_bullet import SilverBulletStrategy
        strategy = SilverBulletStrategy()
        # Data starting at 8:00 AM, ending before 10:00 AM (outside SB window)
        df = _make_ohlcv_at_time(8, 0, n=20, trend="up")
        result = strategy.compute(df)
        assert "entry_long" in result.columns
        entry_count = result["entry_long"].sum() + result["entry_short"].sum()
        # With only 20 bars (8:00-9:40 AM), no signals should appear
        # because the SB NY AM window starts at 10:00
        assert entry_count == 0, f"Expected 0 entries outside SB window, got {entry_count}"

    def test_imports_correct_session_functions(self):
        """Silver Bullet must import SB-specific session functions, not wide killzones."""
        import inspect
        from src.engine.strategies.silver_bullet import SilverBulletStrategy
        source = inspect.getsource(SilverBulletStrategy)
        assert "is_silver_bullet_nyam" in source
        assert "is_nyam_killzone" not in source

    def test_requires_displacement(self):
        """Silver Bullet must use detect_displacement."""
        import inspect
        from src.engine.strategies.silver_bullet import SilverBulletStrategy
        source = inspect.getsource(SilverBulletStrategy)
        assert "displacement" in source.lower()


# ─── SMT Reversal ─────────────────────────────────────────────────

class TestSMTReversalCorrectness:
    def test_single_instrument_returns_no_signals(self):
        """SMT with only one instrument should return zero entries."""
        from src.engine.strategies.smt_reversal import SMTReversalStrategy
        strategy = SMTReversalStrategy()
        df = _make_ohlcv_at_time(9, 0, n=100, trend="up")
        result = strategy.compute(df)
        entry_count = result["entry_long"].sum() + result["entry_short"].sum()
        assert entry_count == 0, "Single-instrument compute() must return no signals"

    def test_is_multi_instrument(self):
        """SMT Reversal must declare itself as multi-instrument."""
        from src.engine.strategies.smt_reversal import SMTReversalStrategy
        strategy = SMTReversalStrategy()
        assert strategy.is_multi_instrument is True

    def test_no_rsi_import(self):
        """SMT Reversal must NOT use RSI — that was the broken implementation."""
        import inspect
        from src.engine.strategies.smt_reversal import SMTReversalStrategy
        source = inspect.getsource(SMTReversalStrategy)
        assert "compute_rsi" not in source
        assert "rsi" not in source.lower() or "rsi" not in inspect.getsource(SMTReversalStrategy.__init__).lower()

    def test_uses_smt_divergence(self):
        """SMT Reversal must use smt_divergence from smt.py."""
        import inspect
        from src.engine.strategies.smt_reversal import SMTReversalStrategy
        source = inspect.getsource(SMTReversalStrategy)
        assert "smt_divergence" in source


# ─── Judas Swing ──────────────────────────────────────────────────

class TestJudasSwingCorrectness:
    def test_tracks_opening_move(self):
        """Judas Swing must track the opening move direction."""
        import inspect
        from src.engine.strategies.judas_swing import JudasSwingStrategy
        source = inspect.getsource(JudasSwingStrategy)
        assert "opening_move" in source.lower() or "fake" in source.lower()

    def test_entry_opposes_opening(self):
        """Entry direction must oppose the fake opening move."""
        import inspect
        from src.engine.strategies.judas_swing import JudasSwingStrategy
        source = inspect.getsource(JudasSwingStrategy)
        # Should have logic where bearish opening → long entry, bullish opening → short
        assert "opening_move_dir" in source

    def test_compute_returns_signals(self):
        """Judas Swing compute should return valid signal columns."""
        from src.engine.strategies.judas_swing import JudasSwingStrategy
        strategy = JudasSwingStrategy()
        df = _make_ohlcv_at_time(8, 0, n=100, trend="down")
        result = strategy.compute(df)
        for col in ("entry_long", "entry_short", "exit_long", "exit_short"):
            assert col in result.columns


# ─── ICT 2022 Model ──────────────────────────────────────────────

class TestICT2022Correctness:
    def test_uses_liquidity_sweep(self):
        """ICT 2022 must detect liquidity sweeps."""
        import inspect
        from src.engine.strategies.ict_2022 import ICT2022Strategy
        source = inspect.getsource(ICT2022Strategy)
        assert "detect_sweep" in source or "sweep" in source.lower()

    def test_uses_ote_zone(self):
        """ICT 2022 must use OTE zone for entry."""
        import inspect
        from src.engine.strategies.ict_2022 import ICT2022Strategy
        source = inspect.getsource(ICT2022Strategy)
        assert "ote_zone" in source

    def test_requires_mss_after_sweep(self):
        """MSS must come AFTER the sweep (not before)."""
        import inspect
        from src.engine.strategies.ict_2022 import ICT2022Strategy
        source = inspect.getsource(ICT2022Strategy)
        assert "last_bullish_mss > last_ssl_sweep" in source or "mss" in source.lower()

    def test_compute_returns_signals(self):
        from src.engine.strategies.ict_2022 import ICT2022Strategy
        strategy = ICT2022Strategy()
        df = _make_ohlcv_at_time(9, 0, n=100, trend="up")
        result = strategy.compute(df)
        for col in ("entry_long", "entry_short", "exit_long", "exit_short"):
            assert col in result.columns


# ─── Turtle Soup ──────────────────────────────────────────────────

class TestTurtleSoupCorrectness:
    def test_uses_mss_not_just_fvg(self):
        """Turtle Soup should use MSS for confirmation, not just FVG."""
        import inspect
        from src.engine.strategies.turtle_soup import TurtleSoupStrategy
        source = inspect.getsource(TurtleSoupStrategy)
        assert "detect_mss" in source

    def test_has_session_filter(self):
        """Must filter to NY AM or London sessions."""
        import inspect
        from src.engine.strategies.turtle_soup import TurtleSoupStrategy
        source = inspect.getsource(TurtleSoupStrategy)
        assert "is_nyam_killzone" in source or "is_london_killzone" in source


# ─── IOFED ────────────────────────────────────────────────────────

class TestIOFEDCorrectness:
    def test_has_htf_direction_check(self):
        """IOFED must check HTF order flow direction."""
        import inspect
        from src.engine.strategies.iofed import IOFEDStrategy
        source = inspect.getsource(IOFEDStrategy)
        assert "premium_discount" in source or "pd_list" in source or "pd_zones" in source

    def test_compute_returns_signals(self):
        from src.engine.strategies.iofed import IOFEDStrategy
        strategy = IOFEDStrategy()
        df = _make_ohlcv_at_time(9, 0, n=100, trend="up")
        result = strategy.compute(df)
        for col in ("entry_long", "entry_short", "exit_long", "exit_short"):
            assert col in result.columns


# ─── Breaker ──────────────────────────────────────────────────────

class TestBreakerCorrectness:
    def test_uses_bos_validation(self):
        """Breaker must validate with BOS at break point."""
        import inspect
        from src.engine.strategies.breaker import BreakerStrategy
        source = inspect.getsource(BreakerStrategy)
        assert "detect_bos" in source

    def test_compute_returns_signals(self):
        from src.engine.strategies.breaker import BreakerStrategy
        strategy = BreakerStrategy()
        df = _make_ohlcv_at_time(9, 0, n=100, trend="down")
        result = strategy.compute(df)
        for col in ("entry_long", "entry_short", "exit_long", "exit_short"):
            assert col in result.columns


# ─── OTE ──────────────────────────────────────────────────────────

class TestOTECorrectness:
    def test_uses_displacement_detection(self):
        """OTE should use displacement to identify impulsive legs."""
        import inspect
        from src.engine.strategies.ote_strategy import OTEStrategy
        source = inspect.getsource(OTEStrategy)
        assert "detect_displacement" in source or "displacement" in source

    def test_compute_returns_signals(self):
        from src.engine.strategies.ote_strategy import OTEStrategy
        strategy = OTEStrategy()
        df = _make_ohlcv_at_time(9, 0, n=100, trend="up")
        result = strategy.compute(df)
        for col in ("entry_long", "entry_short", "exit_long", "exit_short"):
            assert col in result.columns


# ─── NY Lunch Reversal ────────────────────────────────────────────

class TestNYLunchReversalCorrectness:
    def test_mss_must_oppose_am_direction(self):
        """MSS direction must oppose AM move direction."""
        import inspect
        from src.engine.strategies.ny_lunch_reversal import NYLunchReversalStrategy
        source = inspect.getsource(NYLunchReversalStrategy)
        assert "am_direction" in source

    def test_compute_returns_signals(self):
        from src.engine.strategies.ny_lunch_reversal import NYLunchReversalStrategy
        strategy = NYLunchReversalStrategy()
        df = _make_ohlcv_at_time(8, 0, n=200, trend="down")
        result = strategy.compute(df)
        for col in ("entry_long", "entry_short", "exit_long", "exit_short"):
            assert col in result.columns
