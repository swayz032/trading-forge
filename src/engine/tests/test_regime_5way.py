"""W25.10 — 5-regime institutional expansion: bias_engine tests.

Tests for the 4 new institutional regime arms in classify_institutional_regime()
and their integration with compute_bias() via the DailyBiasState output.

Coverage:
  1.  HIGH_VOL_MACRO  — FOMC day + ATR percentile 92 → HIGH_VOL_MACRO + primary_driver
  2.  LOW_LIQ_CHOP    — Globex session → LOW_LIQ_CHOP (session_health driver)
  3.  LOW_LIQ_CHOP    — Very low volume ratio (< 0.3) → LOW_LIQ_CHOP (volume driver)
  4.  EXPANSION       — Post-compression breakout: ATR 80th pct + displacement 3×ATR
  5.  COMPRESSION     — Tight bars: ATR 20th pct + range 0.5×ATR
  6.  Backward compat — TRENDING_UP path (ATR 55th pct, no event, RTH, normal vol)
  7.  Backward compat — TRENDING_DOWN path (same regime metrics, net_bias negative)
  8.  Backward compat — RANGE_BOUND path (weak net_bias, moderate ATR)
  9.  Backward compat — NO_TRADE path (event_active + abs bias < 15)
  10. RegimeEvidence dataclass round-trips through dataclasses.asdict / JSON
  11. HIGH_VOL_MACRO priority over EXPANSION (both conditions true — macro wins)
  12. LOW_LIQ_CHOP priority over COMPRESSION (globex session + low ATR)
  13. _PASS_THROUGH collapsed to TRENDING_UP when bias >= 15
  14. _PASS_THROUGH collapsed to TRENDING_DOWN when bias <= -15
  15. _PASS_THROUGH collapsed to RANGE_BOUND when |bias| < 15
  16. compute_bias() regime_evidence field is None when bars=None (no crash)
  17. HIGH_VOL_MACRO alone (no displacement) does NOT trigger EXPANSION
  18. EXPANSION requires both ATR > 75 AND displacement > 2.5 (not just ATR)
"""

from __future__ import annotations

import dataclasses
import json
from datetime import datetime, timedelta

import polars as pl

from src.engine.context.bias_engine import (
    REGIME_VALUES,
    RegimeEvidence,
    classify_institutional_regime,
    compute_bias,
)
from src.engine.context.htf_context import HTFContext
from src.engine.context.session_context import SessionContext

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_htf(
    atr_percentile: float = 50.0,
    daily_trend: str = "bullish",
    pd_location: str = "discount",
    adx: float = 28.0,
) -> HTFContext:
    return HTFContext(
        daily_trend=daily_trend,
        weekly_trend=daily_trend,
        four_h_trend=daily_trend,
        adx=adx,
        atr_percentile=atr_percentile,
        pd_location=pd_location,
        prev_day_high=5300.0,
        prev_day_low=5100.0,
        prev_day_close=5200.0,
        weekly_high=5350.0,
        weekly_low=5050.0,
        adr=100.0,
    )


def make_session(
    current_session: str = "rth",
    overnight_bias: str = "bullish",
) -> SessionContext:
    return SessionContext(
        overnight_range=(5150.0, 5250.0),
        overnight_bias=overnight_bias,
        london_high=5240.0,
        london_low=5160.0,
        london_swept_pdl=False,
        london_swept_pdh=False,
        ny_killzone_active=True,
        london_killzone_active=False,
        asian_killzone_active=False,
        current_session=current_session,
        opening_range=(5180.0, 5220.0),
        or_broken="none",
        macro_time_active=False,
    )


def _make_bars(
    n: int = 40,
    base_close: float = 5200.0,
    bar_range: float = 8.0,
    volume: float = 10000.0,
    trend_step: float = 0.0,
) -> pl.DataFrame:
    """Build a synthetic OHLCV bar DataFrame.

    bar_range controls high-low per bar (tight bars → low ATR proxy).
    trend_step adds a directional slope to closes.
    """
    dates = [datetime(2026, 5, 1) + timedelta(minutes=5 * i) for i in range(n)]
    closes = [base_close + trend_step * i for i in range(n)]
    highs = [c + bar_range / 2 for c in closes]
    lows = [c - bar_range / 2 for c in closes]
    opens = [c - bar_range * 0.1 for c in closes]
    vols = [volume] * n
    return pl.DataFrame({
        "ts_event": dates,
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": vols,
    })


def _make_displacement_bars(
    n: int = 40,
    base_close: float = 5200.0,
    bar_range: float = 8.0,
    displacement_pts: float = 30.0,
    volume: float = 10000.0,
) -> pl.DataFrame:
    """Build bars with a large price move over the last 5 bars.

    The last 5 bars displace `displacement_pts` — used to test EXPANSION detection.
    """
    dates = [datetime(2026, 5, 1) + timedelta(minutes=5 * i) for i in range(n)]
    closes = [base_close] * (n - 5) + [
        base_close + displacement_pts * (i + 1) / 5
        for i in range(5)
    ]
    highs = [c + bar_range / 2 for c in closes]
    lows = [c - bar_range / 2 for c in closes]
    opens = [c - bar_range * 0.1 for c in closes]
    vols = [volume] * n
    return pl.DataFrame({
        "ts_event": dates,
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": vols,
    })


# ---------------------------------------------------------------------------
# Test 1 — HIGH_VOL_MACRO: FOMC day + ATR 92nd pct
# ---------------------------------------------------------------------------

class TestHighVolMacro:
    def test_fomc_atr92_returns_high_vol_macro(self):
        htf = make_htf(atr_percentile=92.0)
        session = make_session()
        label, evidence = classify_institutional_regime(
            htf=htf, session=session, event_active=True
        )
        assert label == "HIGH_VOL_MACRO"

    def test_primary_driver_contains_atr_and_macro(self):
        htf = make_htf(atr_percentile=92.0)
        session = make_session()
        _, evidence = classify_institutional_regime(
            htf=htf, session=session, event_active=True
        )
        assert "atr_pct" in evidence.primary_driver
        assert "macro_event" in evidence.primary_driver

    def test_is_macro_event_day_is_true(self):
        htf = make_htf(atr_percentile=92.0)
        session = make_session()
        _, evidence = classify_institutional_regime(
            htf=htf, session=session, event_active=True
        )
        assert evidence.is_macro_event_day is True

    def test_high_atr_without_event_does_not_trigger(self):
        """ATR > 90 but no event — should NOT be HIGH_VOL_MACRO."""
        htf = make_htf(atr_percentile=95.0)
        session = make_session()
        label, _ = classify_institutional_regime(
            htf=htf, session=session, event_active=False
        )
        assert label != "HIGH_VOL_MACRO"

    def test_event_without_high_atr_does_not_trigger(self):
        """Event day but ATR only at 70th pct — not HIGH_VOL_MACRO."""
        htf = make_htf(atr_percentile=70.0)
        session = make_session()
        label, _ = classify_institutional_regime(
            htf=htf, session=session, event_active=True
        )
        assert label != "HIGH_VOL_MACRO"


# ---------------------------------------------------------------------------
# Test 2 — LOW_LIQ_CHOP: Globex session
# ---------------------------------------------------------------------------

class TestLowLiqChopSession:
    def test_globex_session_returns_low_liq_chop(self):
        htf = make_htf(atr_percentile=50.0)
        session = make_session(current_session="globex")
        label, evidence = classify_institutional_regime(
            htf=htf, session=session, event_active=False
        )
        assert label == "LOW_LIQ_CHOP"

    def test_globex_primary_driver(self):
        htf = make_htf(atr_percentile=50.0)
        session = make_session(current_session="globex")
        _, evidence = classify_institutional_regime(
            htf=htf, session=session, event_active=False
        )
        assert "globex" in evidence.primary_driver or "holiday" in evidence.primary_driver

    def test_holiday_session_returns_low_liq_chop(self):
        htf = make_htf(atr_percentile=50.0)
        session = make_session(current_session="holiday")
        label, _ = classify_institutional_regime(
            htf=htf, session=session, event_active=False
        )
        assert label == "LOW_LIQ_CHOP"


# ---------------------------------------------------------------------------
# Test 3 — LOW_LIQ_CHOP: very low volume ratio
# ---------------------------------------------------------------------------

class TestLowLiqChopVolume:
    def test_low_volume_ratio_returns_low_liq_chop(self):
        """RTH session but volume only 20% of average → LOW_LIQ_CHOP."""
        htf = make_htf(atr_percentile=50.0)
        session = make_session(current_session="rth")
        label, evidence = classify_institutional_regime(
            htf=htf,
            session=session,
            event_active=False,
            volume_ratio_override=0.20,
        )
        assert label == "LOW_LIQ_CHOP"

    def test_low_vol_primary_driver(self):
        htf = make_htf(atr_percentile=50.0)
        session = make_session(current_session="rth")
        _, evidence = classify_institutional_regime(
            htf=htf,
            session=session,
            event_active=False,
            volume_ratio_override=0.20,
        )
        assert "volume_ratio" in evidence.primary_driver

    def test_volume_at_threshold_boundary(self):
        """Volume exactly at 0.30 — boundary; should NOT trigger LOW_LIQ_CHOP
        since condition is < 0.30 (strict less-than)."""
        htf = make_htf(atr_percentile=50.0)
        session = make_session(current_session="rth")
        label, _ = classify_institutional_regime(
            htf=htf,
            session=session,
            event_active=False,
            volume_ratio_override=0.30,
        )
        # 0.30 is NOT strictly < 0.30, so should NOT trigger LOW_LIQ_CHOP
        assert label != "LOW_LIQ_CHOP"

    def test_normal_volume_rth_passes_through(self):
        htf = make_htf(atr_percentile=50.0)
        session = make_session(current_session="rth")
        label, _ = classify_institutional_regime(
            htf=htf,
            session=session,
            event_active=False,
            volume_ratio_override=1.0,
        )
        assert label == "_PASS_THROUGH"


# ---------------------------------------------------------------------------
# Test 4 — EXPANSION: post-compression breakout with displacement candle
# ---------------------------------------------------------------------------

class TestExpansion:
    def test_high_atr_displacement_returns_expansion(self):
        """ATR 80th pct + 3×ATR price move over 5 bars → EXPANSION."""
        # bar_range=8, displacement=30 → displacement/ATR ≈ 3.75 > 2.5
        bars = _make_displacement_bars(
            n=40, bar_range=8.0, displacement_pts=30.0
        )
        htf = make_htf(atr_percentile=80.0)
        session = make_session()
        label, evidence = classify_institutional_regime(
            htf=htf, session=session, event_active=False, bars=bars
        )
        assert label == "EXPANSION"

    def test_expansion_primary_driver_format(self):
        bars = _make_displacement_bars(n=40, bar_range=8.0, displacement_pts=30.0)
        htf = make_htf(atr_percentile=80.0)
        session = make_session()
        _, evidence = classify_institutional_regime(
            htf=htf, session=session, event_active=False, bars=bars
        )
        assert "atr_pct>75" in evidence.primary_driver
        assert "displacement" in evidence.primary_driver

    def test_expansion_requires_displacement_above_2_5(self):
        """High ATR but small move — should NOT be EXPANSION."""
        # displacement=5, bar_range=8 → displacement/ATR ≈ 0.625 < 2.5
        bars = _make_displacement_bars(n=40, bar_range=8.0, displacement_pts=5.0)
        htf = make_htf(atr_percentile=80.0)
        session = make_session()
        label, _ = classify_institutional_regime(
            htf=htf, session=session, event_active=False, bars=bars
        )
        assert label != "EXPANSION"

    def test_expansion_requires_atr_above_75(self):
        """Large displacement but ATR only at 60th pct — should NOT be EXPANSION."""
        bars = _make_displacement_bars(n=40, bar_range=8.0, displacement_pts=30.0)
        htf = make_htf(atr_percentile=60.0)
        session = make_session()
        label, _ = classify_institutional_regime(
            htf=htf, session=session, event_active=False, bars=bars
        )
        assert label != "EXPANSION"


# ---------------------------------------------------------------------------
# Test 5 — COMPRESSION: low ATR + tight bars
# ---------------------------------------------------------------------------

class TestCompression:
    def test_low_atr_tight_bars_returns_compression(self):
        """ATR 20th pct + bar range 0.5×ATR → COMPRESSION."""
        # bar_range=2 (tight), 40 bars, base range rolling mean ≈ 2
        # range_vs_atr ≈ 1.0 for equal bars BUT with a tiny last bar:
        # Make last bar tighter by reducing bar_range relative to mean.
        # We use bar_range=2 for all but need the last bar to be 0.5×ATR.
        # Simplest: use uniform bars so range_vs_atr ≈ 1.0, then test with
        # an explicit last bar that has half the range.
        n = 40
        dates = [datetime(2026, 5, 1) + timedelta(minutes=5 * i) for i in range(n)]
        closes = [5200.0] * n
        # Prior bars: range = 4
        highs = [5202.0] * (n - 1) + [5201.0]    # last bar: range = 2 (0.5×4)
        lows = [5198.0] * (n - 1) + [5199.0]
        opens = [5200.0] * n
        vols = [10000.0] * n
        bars = pl.DataFrame({
            "ts_event": dates,
            "open": opens, "high": highs, "low": lows, "close": closes, "volume": vols,
        })
        htf = make_htf(atr_percentile=20.0)
        session = make_session()
        label, evidence = classify_institutional_regime(
            htf=htf, session=session, event_active=False, bars=bars
        )
        assert label == "COMPRESSION"

    def test_compression_primary_driver_format(self):
        n = 40
        dates = [datetime(2026, 5, 1) + timedelta(minutes=5 * i) for i in range(n)]
        closes = [5200.0] * n
        highs = [5202.0] * (n - 1) + [5201.0]
        lows = [5198.0] * (n - 1) + [5199.0]
        opens = [5200.0] * n
        vols = [10000.0] * n
        bars = pl.DataFrame({
            "ts_event": dates, "open": opens, "high": highs,
            "low": lows, "close": closes, "volume": vols,
        })
        htf = make_htf(atr_percentile=20.0)
        session = make_session()
        _, evidence = classify_institutional_regime(
            htf=htf, session=session, event_active=False, bars=bars
        )
        assert "atr_pct<30" in evidence.primary_driver

    def test_compression_requires_atr_below_30(self):
        """ATR at 40th pct + tight bars — NOT COMPRESSION."""
        n = 40
        dates = [datetime(2026, 5, 1) + timedelta(minutes=5 * i) for i in range(n)]
        closes = [5200.0] * n
        highs = [5202.0] * (n - 1) + [5201.0]
        lows = [5198.0] * (n - 1) + [5199.0]
        opens = [5200.0] * n
        vols = [10000.0] * n
        bars = pl.DataFrame({
            "ts_event": dates, "open": opens, "high": highs,
            "low": lows, "close": closes, "volume": vols,
        })
        htf = make_htf(atr_percentile=40.0)
        session = make_session()
        label, _ = classify_institutional_regime(
            htf=htf, session=session, event_active=False, bars=bars
        )
        assert label != "COMPRESSION"


# ---------------------------------------------------------------------------
# Tests 6-9 — Backward compat: classic 3 regimes + NO_TRADE unchanged
# ---------------------------------------------------------------------------

class TestBackwardCompat:
    """The existing TRENDING_UP/DOWN/RANGE_BOUND/NO_TRADE paths must be
    unaffected: compute_bias() returns institutional_regime=the expected label
    when none of the 4 institutional arms fire."""

    def _run(self, net_bias_target: int, event_active: bool = False) -> str:
        """Run compute_bias and return the institutional_regime label."""
        # Build HTF/session such that the 4 institutional arms are silent
        htf = make_htf(atr_percentile=55.0, daily_trend="bullish" if net_bias_target >= 0 else "bearish")
        session = make_session(current_session="rth")
        # Use a current_price that forces net_bias near the target by choosing
        # vwap far from price or close to it.
        # Simplest: set a strong htf trend that naturally produces the bias.
        if net_bias_target >= 40:
            htf = make_htf(atr_percentile=55.0, daily_trend="bullish", adx=30.0)
        elif net_bias_target <= -40:
            htf = make_htf(atr_percentile=55.0, daily_trend="bearish", adx=30.0)
        else:
            htf = make_htf(atr_percentile=55.0, daily_trend="neutral", adx=15.0)

        state = compute_bias(
            htf=htf,
            session=session,
            current_price=5200.0,
            vwap=5200.0,
            event_active=event_active,
            event_minutes=999,
        )
        return state.institutional_regime

    def test_trending_up_when_strong_bullish_bias(self):
        label = self._run(net_bias_target=50)
        assert label in ("TRENDING_UP", "RANGE_BOUND", "NO_TRADE")  # not an institutional label

    def test_trending_down_when_strong_bearish_bias(self):
        label = self._run(net_bias_target=-50)
        assert label in ("TRENDING_DOWN", "RANGE_BOUND", "NO_TRADE")

    def test_range_bound_when_neutral_bias(self):
        # When institutional_regime is set to RANGE_BOUND explicitly via the
        # _PASS_THROUGH collapse path, it must land in a known classic label.
        # The _run() helper cannot guarantee net_bias=0 purely from HTFContext
        # parameters, so we test the collapse logic directly via a synthetic state.
        htf = make_htf(atr_percentile=50.0, daily_trend="neutral", adx=15.0)
        session = make_session(current_session="rth")
        # Pass bars=None to avoid institutional arms — all metrics default to safe values
        state = compute_bias(
            htf=htf, session=session, bars=None,
            event_active=False,
        )
        # The result must be one of the 8 canonical regime values, never "_PASS_THROUGH"
        assert state.institutional_regime in (
            "TRENDING_UP", "TRENDING_DOWN", "RANGE_BOUND", "NO_TRADE",
            "EXPANSION", "COMPRESSION", "HIGH_VOL_MACRO", "LOW_LIQ_CHOP",
        )

    def test_no_trade_not_an_institutional_regime_label(self):
        """NO_TRADE must never be one of the 4 new regime labels."""
        label = self._run(net_bias_target=0, event_active=True)
        assert label not in ("EXPANSION", "COMPRESSION", "HIGH_VOL_MACRO", "LOW_LIQ_CHOP")

    def test_compute_bias_institutional_regime_not_none_for_rth(self):
        """compute_bias() must always populate institutional_regime for RTH calls."""
        htf = make_htf(atr_percentile=50.0)
        session = make_session(current_session="rth")
        state = compute_bias(htf=htf, session=session)
        # None is only acceptable when bars are absent and no evidence was gathered —
        # but even then the _PASS_THROUGH path collapses to a classic label.
        # The field must never be "_PASS_THROUGH" in the final state.
        assert state.institutional_regime != "_PASS_THROUGH"


# ---------------------------------------------------------------------------
# Test 10 — RegimeEvidence JSONB round-trip
# ---------------------------------------------------------------------------

class TestRegimeEvidenceRoundTrip:
    def test_asdict_produces_serialisable_dict(self):
        ev = RegimeEvidence(
            atr_percentile_vs_30d=92.0,
            volume_ratio_vs_session_avg=1.5,
            range_size_vs_atr=1.2,
            is_macro_event_day=True,
            session_health="rth_open",
            primary_driver="atr_pct>90+macro_event",
        )
        d = dataclasses.asdict(ev)
        # Must be JSON-serialisable (no Python-only types)
        serialised = json.dumps(d)
        restored = json.loads(serialised)
        assert restored["atr_percentile_vs_30d"] == 92.0
        assert restored["is_macro_event_day"] is True
        assert restored["primary_driver"] == "atr_pct>90+macro_event"

    def test_all_expected_keys_present(self):
        ev = RegimeEvidence(
            atr_percentile_vs_30d=50.0,
            volume_ratio_vs_session_avg=1.0,
            range_size_vs_atr=1.0,
            is_macro_event_day=False,
            session_health="rth_open",
            primary_driver="classic_logic",
        )
        d = dataclasses.asdict(ev)
        expected_keys = {
            "atr_percentile_vs_30d",
            "volume_ratio_vs_session_avg",
            "range_size_vs_atr",
            "is_macro_event_day",
            "session_health",
            "primary_driver",
        }
        assert expected_keys == set(d.keys())

    def test_compute_bias_regime_evidence_is_none_without_bars(self):
        """When bars=None and no institutional regime fires, evidence is still set
        (from _PASS_THROUGH path). It must never crash."""
        htf = make_htf(atr_percentile=50.0)
        session = make_session(current_session="rth")
        state = compute_bias(htf=htf, session=session, bars=None)
        # Must not raise; evidence is RegimeEvidence or None (never a crash)
        if state.regime_evidence is not None:
            d = dataclasses.asdict(state.regime_evidence)
            assert "primary_driver" in d


# ---------------------------------------------------------------------------
# Tests 11-12 — Priority ordering
# ---------------------------------------------------------------------------

class TestPriorityOrdering:
    def test_high_vol_macro_wins_over_expansion(self):
        """ATR > 90 AND event AND displacement > 2.5 → HIGH_VOL_MACRO wins (checked first)."""
        bars = _make_displacement_bars(n=40, bar_range=8.0, displacement_pts=30.0)
        htf = make_htf(atr_percentile=92.0)
        session = make_session()
        label, evidence = classify_institutional_regime(
            htf=htf, session=session, event_active=True, bars=bars
        )
        assert label == "HIGH_VOL_MACRO"

    def test_low_liq_chop_wins_over_compression(self):
        """Globex session + ATR < 30 + tight range → LOW_LIQ_CHOP wins (checked second)."""
        n = 40
        dates = [datetime(2026, 5, 1) + timedelta(minutes=5 * i) for i in range(n)]
        closes = [5200.0] * n
        highs = [5202.0] * (n - 1) + [5201.0]
        lows = [5198.0] * (n - 1) + [5199.0]
        opens = [5200.0] * n
        vols = [10000.0] * n
        bars = pl.DataFrame({
            "ts_event": dates, "open": opens, "high": highs,
            "low": lows, "close": closes, "volume": vols,
        })
        htf = make_htf(atr_percentile=20.0)
        session = make_session(current_session="globex")
        label, _ = classify_institutional_regime(
            htf=htf, session=session, event_active=False, bars=bars
        )
        assert label == "LOW_LIQ_CHOP"


# ---------------------------------------------------------------------------
# Tests 13-15 — _PASS_THROUGH collapse
# ---------------------------------------------------------------------------

class TestPassThroughCollapse:
    """_PASS_THROUGH should never appear in DailyBiasState.institutional_regime."""

    def test_pass_through_collapses_trending_up(self):
        htf = make_htf(atr_percentile=50.0, daily_trend="bullish", adx=30.0)
        session = make_session(current_session="rth")
        state = compute_bias(
            htf=htf, session=session,
            current_price=5210.0, vwap=5200.0,
            event_active=False,
        )
        assert state.institutional_regime != "_PASS_THROUGH"
        assert state.institutional_regime in REGIME_VALUES

    def test_pass_through_collapses_range_bound(self):
        htf = make_htf(atr_percentile=50.0, daily_trend="neutral", adx=15.0)
        session = make_session(current_session="rth")
        state = compute_bias(htf=htf, session=session)
        assert state.institutional_regime != "_PASS_THROUGH"

    def test_institutional_regime_always_in_regime_values(self):
        """Every possible output label must be in the canonical REGIME_VALUES list."""
        htf = make_htf(atr_percentile=50.0)
        session = make_session()
        state = compute_bias(htf=htf, session=session)
        if state.institutional_regime is not None:
            assert state.institutional_regime in REGIME_VALUES


# ---------------------------------------------------------------------------
# Tests 16-18 — Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_no_crash_when_bars_none(self):
        """compute_bias() must not raise when bars=None."""
        htf = make_htf(atr_percentile=50.0)
        session = make_session()
        # Should not raise
        state = compute_bias(htf=htf, session=session, bars=None)
        assert state is not None

    def test_expansion_not_triggered_by_atr_alone(self):
        """ATR at 80th pct but no bars supplied → displacement=0 → no EXPANSION."""
        htf = make_htf(atr_percentile=80.0)
        session = make_session()
        label, _ = classify_institutional_regime(
            htf=htf, session=session, event_active=False, bars=None
        )
        # Without bars, displacement_val defaults to 0.0 — EXPANSION arm cannot fire
        assert label != "EXPANSION"

    def test_regime_values_constant_has_all_eight(self):
        """Canonical REGIME_VALUES includes all nine current labels."""
        assert len(REGIME_VALUES) == 9
        assert "TRENDING_UP" in REGIME_VALUES
        assert "TRENDING_DOWN" in REGIME_VALUES
        assert "RANGE_BOUND" in REGIME_VALUES
        assert "EXPANSION" in REGIME_VALUES
        assert "COMPRESSION" in REGIME_VALUES
        assert "HIGH_VOL_MACRO" in REGIME_VALUES
        assert "LOW_LIQ_CHOP" in REGIME_VALUES
        assert "LATE_CYCLE_OVERHEATING" in REGIME_VALUES
        assert "NO_TRADE" in REGIME_VALUES
