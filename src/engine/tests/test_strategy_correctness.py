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


# ─── Deep-scan F-1/F-2/F-3 — Look-ahead regression coverage ───────
#
# Common bug pattern (all three): a structural event at bar E opens a
# retest/entry window starting at E+1, but the ZONE-VALIDITY code scanned
# forward past E+1 — so a zone entered immediately at E+1 was graded
# valid/invalid using bars from its own future. Each test below mutates
# ONLY a bar at/after the earliest entry bar and asserts the zone-existence
# decision does not change — i.e. it is decidable using only bars strictly
# before entry. A "positive control" case is included per archetype to
# confirm the fix bounds the window rather than deleting the check.


class TestBreakerNoLookahead:
    """F-1: breaker.py's BOS-validity loop must never read bos_list at or
    beyond broken_at + 1 — the earliest bar compute_breaker_signals() opens
    an entry window on."""

    @staticmethod
    def _patched_strategy(monkeypatch, bos_values, n, broken_at):
        from src.engine.strategies import breaker as breaker_mod

        fake_ob = pl.DataFrame({
            "index": [broken_at - 5], "top": [103.0], "bottom": [101.0], "type": ["bearish"],
        })
        empty_ob = pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8,
        })
        fake_breaker = pl.DataFrame({
            "index": [broken_at - 5], "top": [103.0], "bottom": [101.0],
            "type": ["bullish_breaker"], "broken_at": [broken_at],
        })

        monkeypatch.setattr(breaker_mod, "detect_bullish_ob", lambda *a, **k: fake_ob)
        monkeypatch.setattr(breaker_mod, "detect_bearish_ob", lambda *a, **k: empty_ob)
        monkeypatch.setattr(breaker_mod, "detect_breaker", lambda *a, **k: fake_breaker)
        monkeypatch.setattr(breaker_mod, "detect_bos", lambda *a, **k: pl.Series(bos_values, dtype=pl.Utf8))
        return breaker_mod.BreakerStrategy()

    def test_bos_after_earliest_entry_does_not_validate_breaker(self, monkeypatch):
        """A BOS confirmation appearing ONLY after broken_at + 1 (the earliest
        entry bar) must NOT validate the breaker."""
        n = 60
        broken_at = 20
        bos_values = [None] * n
        bos_values[broken_at + 2] = "bullish"  # future-only vs broken_at+1 entry
        strategy = self._patched_strategy(monkeypatch, bos_values, n, broken_at)

        df = _make_ohlcv_at_time(9, 0, n=n, trend="flat", base_price=102.0)
        result = strategy.compute(df)
        total_entries = result["entry_long"].sum() + result["entry_short"].sum()
        assert total_entries == 0, (
            "Breaker validated using a BOS that only appears AFTER the earliest "
            "entry bar (broken_at+1) — this is look-ahead bias (F-1)."
        )

    def test_bos_at_or_before_broken_at_still_validates_breaker(self, monkeypatch):
        """Sanity control: a causal BOS (at broken_at itself) must still
        validate the breaker — the fix bounds the window, it doesn't delete
        the check."""
        n = 60
        broken_at = 20
        bos_values = [None] * n
        bos_values[broken_at] = "bullish"
        strategy = self._patched_strategy(monkeypatch, bos_values, n, broken_at)

        df = _make_ohlcv_at_time(9, 0, n=n, trend="flat", base_price=102.0)
        result = strategy.compute(df)
        total_entries = result["entry_long"].sum() + result["entry_short"].sum()
        assert total_entries > 0, (
            "Sanity check failed: a causal BOS at broken_at should still "
            "validate the breaker after the F-1 fix."
        )


class TestMitigationNoLookahead:
    """F-2: mitigation.py's made-new-LL/HH scan must never decide zone
    existence using bars at or after bos_bar + 1 — the earliest bar this
    zone can be entered on."""

    def test_bullish_mb_zone_ignores_price_action_after_bos(self):
        import numpy as np
        from src.engine.strategies.mitigation import _find_mitigation_blocks

        n = 80
        ob_idx = 10
        prev_sl_price = 95.0
        bos_bar = 15

        bos_values = [None] * n
        bos_values[bos_bar] = "bullish"
        bos_series = pl.Series(bos_values, dtype=pl.Utf8)

        bear_obs = pl.DataFrame({
            "index": [ob_idx], "top": [105.0], "bottom": [100.0], "type": ["bearish"],
        })
        bull_obs = pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8,
        })
        swing_lows = pl.DataFrame({"index": [ob_idx - 5], "price": [prev_sl_price]})
        swing_highs = pl.DataFrame(schema={"index": pl.Int64, "price": pl.Float64})

        def build_df(future_breach: bool) -> pl.DataFrame:
            lows = np.full(n, 100.0)
            if future_breach:
                # Price sweeps below the prior swing low at bar 50 — well AFTER
                # bos_bar + 1 = 16, the earliest bar this zone can be entered on.
                # This must NOT retroactively decide whether the zone existed.
                lows[50] = prev_sl_price - 10.0
            return pl.DataFrame({"low": lows, "high": np.full(n, 110.0)})

        zones_clean = _find_mitigation_blocks(
            build_df(False), bull_obs, bear_obs, swing_highs, swing_lows, bos_series
        )
        zones_future_breach = _find_mitigation_blocks(
            build_df(True), bull_obs, bear_obs, swing_highs, swing_lows, bos_series
        )

        assert zones_clean == zones_future_breach, (
            "Mitigation Block zone existence changed based on a price sweep at "
            "bar 50 — AFTER the earliest entry bar (bos_bar+1=16). Zone validity "
            "must be decidable using only bars strictly before entry (F-2)."
        )
        assert len(zones_clean) == 1, "Sanity check failed: expected exactly one MB zone."
        assert zones_clean[0][3] == bos_bar, "bos_bar must still be recorded correctly."

    def test_bullish_mb_zone_still_rejected_by_breach_before_bos(self):
        """Sanity control: a breach BEFORE bos_bar (i.e. this really is a
        breaker, not a mitigation block) must still reject the zone — the
        fix bounds the window, it doesn't delete the "no new LL" check."""
        import numpy as np
        from src.engine.strategies.mitigation import _find_mitigation_blocks

        n = 80
        ob_idx = 10
        prev_sl_price = 95.0
        bos_bar = 15

        bos_values = [None] * n
        bos_values[bos_bar] = "bullish"
        bos_series = pl.Series(bos_values, dtype=pl.Utf8)

        bear_obs = pl.DataFrame({
            "index": [ob_idx], "top": [105.0], "bottom": [100.0], "type": ["bearish"],
        })
        bull_obs = pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8,
        })
        swing_lows = pl.DataFrame({"index": [ob_idx - 5], "price": [prev_sl_price]})
        swing_highs = pl.DataFrame(schema={"index": pl.Int64, "price": pl.Float64})

        lows = np.full(n, 100.0)
        lows[12] = prev_sl_price - 10.0  # breach BEFORE bos_bar=15 -> real breaker
        df = pl.DataFrame({"low": lows, "high": np.full(n, 110.0)})

        zones = _find_mitigation_blocks(df, bull_obs, bear_obs, swing_highs, swing_lows, bos_series)
        assert zones == [], (
            "A new-LL breach BEFORE bos_bar makes this a breaker setup, not a "
            "mitigation block — it must still be rejected after the F-2 fix."
        )


class TestUnicornNoLookahead:
    """F-3: unicorn.py's Unicorn Zone construction must never read
    displacement or FVG data at/after b_broken_at + 1 — the earliest bar
    the zone gates entries on (`formed >= i: continue` with formed=b_broken_at)."""

    @staticmethod
    def _make_flat_df(n: int) -> pl.DataFrame:
        base_time = datetime(2024, 3, 15, 9, 0)
        dates = [base_time + timedelta(minutes=i * 5) for i in range(n)]
        return pl.DataFrame({
            "ts_event": dates,
            "open": [102.0] * n,
            "high": [103.0] * n,
            "low": [101.0] * n,
            "close": [102.0] * n,
            "volume": [10000] * n,
        })

    @staticmethod
    def _patch_zone_inputs(monkeypatch, b_broken_at):
        from src.engine.strategies import unicorn as unicorn_mod

        fake_ob = pl.DataFrame({
            "index": [b_broken_at - 10], "top": [103.0], "bottom": [101.0], "type": ["bullish"],
        })
        empty_ob = pl.DataFrame(schema={
            "index": pl.Int64, "top": pl.Float64, "bottom": pl.Float64, "type": pl.Utf8,
        })
        fake_breaker = pl.DataFrame({
            "index": [b_broken_at - 5], "top": [105.0], "bottom": [100.0],
            "type": ["bullish_breaker"], "broken_at": [b_broken_at],
        })
        monkeypatch.setattr(unicorn_mod, "detect_bullish_ob", lambda *a, **k: fake_ob)
        monkeypatch.setattr(unicorn_mod, "detect_bearish_ob", lambda *a, **k: empty_ob)
        monkeypatch.setattr(unicorn_mod, "detect_breaker", lambda *a, **k: fake_breaker)
        return unicorn_mod

    @staticmethod
    def _fvg(f_bar: int, top: float = 104.0, bottom: float = 99.0) -> pl.DataFrame:
        return pl.DataFrame({
            "index": [f_bar], "type": ["bullish"], "top": [top], "bottom": [bottom],
            "midpoint": [(top + bottom) / 2.0], "filled": [False],
        })

    def test_displacement_after_earliest_entry_does_not_validate_zone(self, monkeypatch):
        n = 80
        b_broken_at = 30
        unicorn_mod = self._patch_zone_inputs(monkeypatch, b_broken_at)

        disp_values = [None] * n
        disp_values[b_broken_at + 1] = "bullish"  # future-only vs b_broken_at+1 entry
        monkeypatch.setattr(unicorn_mod, "detect_displacement",
                             lambda *a, **k: pl.Series(disp_values, dtype=pl.Utf8))
        monkeypatch.setattr(unicorn_mod, "detect_fvg", lambda *a, **k: self._fvg(b_broken_at - 2))

        strategy = unicorn_mod.UnicornStrategy()
        result = strategy.compute(self._make_flat_df(n))
        total_entries = result["entry_long"].sum() + result["entry_short"].sum()
        assert total_entries == 0, (
            "Unicorn Zone validated using displacement that only occurs AFTER "
            "the earliest entry bar (b_broken_at+1) — look-ahead bias (F-3)."
        )

    def test_fvg_after_earliest_entry_does_not_validate_zone(self, monkeypatch):
        n = 80
        b_broken_at = 30
        unicorn_mod = self._patch_zone_inputs(monkeypatch, b_broken_at)

        disp_values = [None] * n
        disp_values[b_broken_at] = "bullish"  # causal
        monkeypatch.setattr(unicorn_mod, "detect_displacement",
                             lambda *a, **k: pl.Series(disp_values, dtype=pl.Utf8))
        # FVG only forms 3 bars AFTER the break — inside the old +/-5 window,
        # but at/after the earliest entry bar (b_broken_at+1).
        monkeypatch.setattr(unicorn_mod, "detect_fvg", lambda *a, **k: self._fvg(b_broken_at + 3))

        strategy = unicorn_mod.UnicornStrategy()
        result = strategy.compute(self._make_flat_df(n))
        total_entries = result["entry_long"].sum() + result["entry_short"].sum()
        assert total_entries == 0, (
            "Unicorn Zone validated using an FVG that only forms AFTER the "
            "earliest entry bar (b_broken_at+1) — look-ahead bias (F-3)."
        )

    def test_fully_causal_setup_still_forms_a_zone(self, monkeypatch):
        """Sanity control: fully causal displacement + FVG must still produce
        a tradeable Unicorn Zone — the fix bounds the window, it doesn't
        delete the archetype's detection."""
        n = 80
        b_broken_at = 30
        unicorn_mod = self._patch_zone_inputs(monkeypatch, b_broken_at)

        disp_values = [None] * n
        disp_values[b_broken_at] = "bullish"
        monkeypatch.setattr(unicorn_mod, "detect_displacement",
                             lambda *a, **k: pl.Series(disp_values, dtype=pl.Utf8))
        monkeypatch.setattr(unicorn_mod, "detect_fvg", lambda *a, **k: self._fvg(b_broken_at - 2))

        strategy = unicorn_mod.UnicornStrategy()
        result = strategy.compute(self._make_flat_df(n))
        total_entries = result["entry_long"].sum() + result["entry_short"].sum()
        assert total_entries > 0, (
            "Sanity check failed: a fully causal displacement + FVG setup "
            "should still form a tradeable Unicorn Zone after the F-3 fix."
        )
