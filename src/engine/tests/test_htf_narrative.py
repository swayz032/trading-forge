"""W25.5 — Unit tests for htf_narrative.py.

Tests:
- AsianRange detection (Globex window 22:00 UTC–07:00 UTC)
- LondonBias direction and PDH/PDL sweep
- NYBias open relation to overnight range
- DailyDealing quadrant math
- Pure function invariant (same inputs → same outputs)
- Fail-open: empty DataFrames never raise

Run:
    python -m pytest src/engine/tests/test_htf_narrative.py -v
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import polars as pl
import pytest

from src.engine.context.htf_narrative import (
    AsianRange,
    DailyDealing,
    HtfNarrative,
    LondonBias,
    NYBias,
    _classify_quadrant,
    _compute_asian_range,
    _compute_daily_dealing,
    _compute_london_bias,
    _compute_ny_bias,
    compute_htf_narrative,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _ts_utc(dt_str: str) -> datetime:
    """Parse 'YYYY-MM-DD HH:MM' to UTC datetime."""
    return datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc)


def _make_intraday(
    hour_values: list[tuple[int, int, float, float, float]],
    date_str: str = "2024-01-03",
) -> pl.DataFrame:
    """Build intraday bars from (hour, minute, high, low, close) tuples."""
    ts_list = []
    highs, lows, closes, opens, vols = [], [], [], [], []
    for (h, m, hi, lo, cl) in hour_values:
        ts_list.append(datetime.fromisoformat(f"{date_str} {h:02d}:{m:02d}:00").replace(tzinfo=timezone.utc))
        highs.append(hi)
        lows.append(lo)
        closes.append(cl)
        opens.append(cl)
        vols.append(100.0)
    return pl.DataFrame({
        "ts_event": ts_list,
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": vols,
    }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))


def _make_daily(rows: list[tuple[str, float, float, float]]) -> pl.DataFrame:
    """Build daily bars from (date_str, high, low, close) tuples."""
    ts_list, highs, lows, closes = [], [], [], []
    for (ds, hi, lo, cl) in rows:
        ts_list.append(datetime.fromisoformat(f"{ds} 00:00:00").replace(tzinfo=timezone.utc))
        highs.append(hi)
        lows.append(lo)
        closes.append(cl)
    return pl.DataFrame({
        "ts_event": ts_list,
        "open": closes,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": [10000.0] * len(ts_list),
    }).with_columns(pl.col("ts_event").cast(pl.Datetime("us", "UTC")))


# ─── Tests: _classify_quadrant ────────────────────────────────────────────────

class TestClassifyQuadrant:
    """Unit tests for the Fibonacci quadrant classifier."""

    def test_premium_upper(self):
        # (98.5-90)/(100-90) = 0.85 >= 0.786 → premium_upper
        assert _classify_quadrant(98.5, 100.0, 90.0) == "premium_upper"

    def test_premium_lower(self):
        # (96-90)/(100-90) = 0.6 → in [0.618? no, 0.6 < 0.618] → equilibrium
        # Use 97 → (97-90)/10 = 0.7 → premium_lower (0.618-0.786)
        assert _classify_quadrant(97.0, 100.0, 90.0) == "premium_lower"

    def test_equilibrium(self):
        # 95 → (95-90)/10 = 0.5 → equilibrium (0.382-0.618)
        assert _classify_quadrant(95.0, 100.0, 90.0) == "equilibrium"

    def test_discount_upper(self):
        # 93 → (93-90)/10 = 0.3 → in [0.236, 0.382) → discount_upper
        assert _classify_quadrant(93.0, 100.0, 90.0) == "discount_upper"

    def test_discount_lower(self):
        # 91 → (91-90)/10 = 0.1 → < 0.236 → discount_lower
        assert _classify_quadrant(91.0, 100.0, 90.0) == "discount_lower"

    def test_zero_range_returns_none(self):
        assert _classify_quadrant(100.0, 100.0, 100.0) is None

    def test_at_boundary_premium_lower(self):
        # Exactly 0.618: (96.18-90)/10 = 0.618 → premium_lower (>= 0.618)
        assert _classify_quadrant(96.18, 100.0, 90.0) == "premium_lower"


# ─── Tests: AsianRange ────────────────────────────────────────────────────────

class TestAsianRange:
    """Tests for Asian session range computation."""

    def test_asian_bars_detected(self):
        """Asian bars (22:00–07:00 UTC) are captured correctly."""
        # 23:00 UTC and 01:00 UTC should both be inside Asian session
        bars = _make_intraday([
            (23, 0, 5000.0, 4900.0, 4950.0),   # 23:00 UTC = inside Asian
            (1, 0, 5050.0, 4850.0, 4950.0),    # 01:00 UTC = inside Asian
            (13, 30, 5100.0, 4950.0, 5080.0),  # 13:30 UTC = NY session (not Asian)
        ])
        result = _compute_asian_range(bars)
        assert result.high is not None
        assert result.low is not None
        # High is max of Asian bars: max(5000, 5050) = 5050
        assert result.high == 5050.0
        # Low is min of Asian bars: min(4900, 4850) = 4850
        assert result.low == 4850.0
        assert result.range_size is not None
        assert abs(result.range_size - 200.0) < 0.01

    def test_no_asian_bars_returns_empty(self):
        """If no bars fall in Asian window, returns AsianRange with all None."""
        # Only NY bars (13:30–14:30 UTC)
        bars = _make_intraday([
            (13, 30, 5000.0, 4980.0, 4990.0),
            (13, 45, 5010.0, 4985.0, 5005.0),
        ])
        result = _compute_asian_range(bars)
        assert result.high is None
        assert result.low is None
        assert result.range_size is None

    def test_empty_df_returns_empty(self):
        """Empty intraday DataFrame returns all-None AsianRange."""
        result = _compute_asian_range(pl.DataFrame())
        assert result.high is None and result.low is None

    def test_range_size_computed_correctly(self):
        """range_size = high - low."""
        bars = _make_intraday([
            (23, 0, 5100.0, 4900.0, 5000.0),
        ])
        result = _compute_asian_range(bars)
        assert result.range_size is not None
        assert abs(result.range_size - 200.0) < 0.01


# ─── Tests: LondonBias ────────────────────────────────────────────────────────

class TestLondonBias:
    """Tests for London session bias and PDH/PDL sweep detection."""

    def _make_asian(self, high: float = 5000.0, low: float = 4900.0) -> AsianRange:
        return AsianRange(high=high, low=low, range_size=high - low, formed_at_bar_idx=None)

    def test_bullish_london_expansion(self):
        """London high above overnight mid + low above asian low → bullish."""
        asian = self._make_asian(5000.0, 4900.0)
        # overnight_mid = 4950; London: high=5100 > 4950, low=4910 > 4900 → bullish
        london_bars = _make_intraday([
            (8, 0, 5100.0, 4910.0, 5090.0),   # 08:00 UTC = inside London
        ])
        daily = _make_daily([
            ("2024-01-02", 4980.0, 4870.0, 4960.0),  # previous day (PDH/PDL)
            ("2024-01-03", 5000.0, 4900.0, 4950.0),  # today forming
        ])
        result = _compute_london_bias(london_bars, daily, asian)
        assert result.direction == "bullish"

    def test_bearish_london_expansion(self):
        """London low below overnight mid + high below asian high → bearish."""
        asian = self._make_asian(5000.0, 4900.0)
        # overnight_mid = 4950; London: high=4990 < 5000, low=4800 < 4950 → bearish
        london_bars = _make_intraday([
            (8, 0, 4990.0, 4800.0, 4850.0),
        ])
        daily = _make_daily([
            ("2024-01-02", 4980.0, 4870.0, 4960.0),
            ("2024-01-03", 5000.0, 4900.0, 4950.0),
        ])
        result = _compute_london_bias(london_bars, daily, asian)
        assert result.direction == "bearish"

    def test_swept_pdh(self):
        """London high above prior day high sets swept_pdh=True."""
        asian = self._make_asian(5000.0, 4900.0)
        # PDH = 4980; London high = 4990 > 4980 → swept
        london_bars = _make_intraday([
            (8, 0, 4990.0, 4910.0, 4960.0),
        ])
        daily = _make_daily([
            ("2024-01-02", 4980.0, 4870.0, 4960.0),
            ("2024-01-03", 5000.0, 4900.0, 4950.0),
        ])
        result = _compute_london_bias(london_bars, daily, asian)
        assert result.swept_pdh is True

    def test_swept_pdl(self):
        """London low below prior day low sets swept_pdl=True."""
        asian = self._make_asian(5000.0, 4900.0)
        london_bars = _make_intraday([
            (8, 0, 4950.0, 4860.0, 4900.0),  # low=4860 < PDL=4870
        ])
        daily = _make_daily([
            ("2024-01-02", 4980.0, 4870.0, 4960.0),
            ("2024-01-03", 5000.0, 4900.0, 4950.0),
        ])
        result = _compute_london_bias(london_bars, daily, asian)
        assert result.swept_pdl is True

    def test_no_london_bars_returns_none(self):
        """No London session bars → all fields default/None."""
        asian = self._make_asian()
        bars = _make_intraday([(13, 30, 5000.0, 4900.0, 4950.0)])  # NY, not London
        daily = _make_daily([("2024-01-02", 5000.0, 4900.0, 4950.0),
                             ("2024-01-03", 5000.0, 4900.0, 4950.0)])
        result = _compute_london_bias(bars, daily, asian)
        assert result.direction is None
        assert result.swept_pdh is False
        assert result.swept_pdl is False


# ─── Tests: NYBias ────────────────────────────────────────────────────────────

class TestNYBias:
    """Tests for NY open bias relative to overnight range."""

    def _make_asian(self, high: float = 5000.0, low: float = 4900.0) -> AsianRange:
        return AsianRange(high=high, low=low, range_size=high - low, formed_at_bar_idx=None)

    def test_open_above_overnight_range(self):
        """NY open above asian_range.high → open_above_overnight_range=True, bullish."""
        asian = self._make_asian(5000.0, 4900.0)
        # NY open (13:30 UTC = 09:30 EDT): open = 5050 > 5000
        bars = _make_intraday([(13, 30, 5060.0, 5045.0, 5050.0)])
        result = _compute_ny_bias(bars, asian)
        assert result.open_above_overnight_range is True
        assert result.direction == "bullish"

    def test_open_below_overnight_range(self):
        """NY open below asian_range.low → open_below_overnight_range=True, bearish."""
        asian = self._make_asian(5000.0, 4900.0)
        bars = _make_intraday([(13, 30, 4885.0, 4875.0, 4880.0)])
        result = _compute_ny_bias(bars, asian)
        assert result.open_below_overnight_range is True
        assert result.direction == "bearish"

    def test_open_inside_range_midpoint_bullish(self):
        """NY open above midpoint but inside range → bullish bias, not gap."""
        asian = self._make_asian(5000.0, 4900.0)
        # mid = 4950; open = 4970 > 4950 → bullish but NOT above range
        bars = _make_intraday([(13, 30, 4975.0, 4965.0, 4970.0)])
        result = _compute_ny_bias(bars, asian)
        assert result.open_above_overnight_range is False
        assert result.direction == "bullish"

    def test_empty_df_returns_empty(self):
        """Empty intraday bars → all fields default."""
        asian = self._make_asian()
        result = _compute_ny_bias(pl.DataFrame(), asian)
        assert result.direction is None
        assert result.open_above_overnight_range is False

    def test_no_ny_bars_returns_empty(self):
        """If no bars at or after 13:30 UTC → NYBias all default."""
        asian = self._make_asian()
        bars = _make_intraday([(8, 0, 5000.0, 4900.0, 4950.0)])  # London, not NY
        result = _compute_ny_bias(bars, asian)
        assert result.direction is None


# ─── Tests: DailyDealing ──────────────────────────────────────────────────────

class TestDailyDealing:
    """Tests for daily dealing range quadrant computation."""

    def test_current_price_in_equilibrium(self):
        """Price at 50% of daily range → equilibrium."""
        daily = _make_daily([
            ("2024-01-02", 5100.0, 4900.0, 5000.0),
            ("2024-01-03", 5100.0, 4900.0, 5000.0),
        ])
        intraday = _make_intraday([(13, 30, 5010.0, 4990.0, 5000.0)])
        result = _compute_daily_dealing(daily, intraday)
        assert result.dealing_range_high == 5100.0  # PDH
        assert result.dealing_range_low == 4900.0   # PDL
        assert result.current_quadrant == "equilibrium"

    def test_current_price_premium_upper(self):
        """Price in top 21.4% of range → premium_upper."""
        daily = _make_daily([
            ("2024-01-02", 5100.0, 4900.0, 5000.0),
            ("2024-01-03", 5100.0, 4900.0, 5000.0),
        ])
        # 5090 → (5090-4900)/200 = 0.95 → premium_upper
        intraday = _make_intraday([(13, 30, 5090.0, 5080.0, 5090.0)])
        result = _compute_daily_dealing(daily, intraday)
        assert result.current_quadrant == "premium_upper"

    def test_current_price_discount_lower(self):
        """Price in bottom 23.6% of range → discount_lower."""
        daily = _make_daily([
            ("2024-01-02", 5100.0, 4900.0, 5000.0),
            ("2024-01-03", 5100.0, 4900.0, 5000.0),
        ])
        # 4920 → (4920-4900)/200 = 0.10 → discount_lower
        intraday = _make_intraday([(13, 30, 4925.0, 4915.0, 4920.0)])
        result = _compute_daily_dealing(daily, intraday)
        assert result.current_quadrant == "discount_lower"

    def test_insufficient_daily_bars_returns_none(self):
        """Fewer than 2 daily bars → PDH/PDL not available → None."""
        daily = _make_daily([("2024-01-03", 5100.0, 4900.0, 5000.0)])
        intraday = _make_intraday([(13, 30, 5000.0, 4950.0, 4980.0)])
        result = _compute_daily_dealing(daily, intraday)
        assert result.dealing_range_high is None
        assert result.dealing_range_low is None
        assert result.current_quadrant is None


# ─── Tests: compute_htf_narrative (integration) ───────────────────────────────

class TestComputeHtfNarrative:
    """Integration tests for the top-level compute_htf_narrative() function."""

    def _make_full_session(self) -> tuple[pl.DataFrame, pl.DataFrame]:
        """Build a realistic daily + intraday dataset for one session."""
        daily = _make_daily([
            ("2024-01-02", 5100.0, 4900.0, 4980.0),  # PDH/PDL
            ("2024-01-03", 5050.0, 4950.0, 5000.0),  # today forming
        ])
        # Intraday: Asian (23:00), London (08:00), NY (13:30)
        intraday = _make_intraday([
            (23, 0,  5010.0, 4960.0, 4990.0),   # Asian
            (2,  0,  5020.0, 4950.0, 4995.0),   # Asian
            (8,  0,  5030.0, 4970.0, 5020.0),   # London
            (13, 30, 5080.0, 5060.0, 5075.0),   # NY open
        ])
        return daily, intraday

    def test_returns_htf_narrative_type(self):
        """compute_htf_narrative returns an HtfNarrative instance."""
        daily, intraday = self._make_full_session()
        result = compute_htf_narrative(daily, intraday, None, current_bar_idx=42)
        assert isinstance(result, HtfNarrative)

    def test_computed_at_bar_idx_preserved(self):
        """computed_at_bar_idx matches the argument passed in."""
        daily, intraday = self._make_full_session()
        result = compute_htf_narrative(daily, intraday, None, current_bar_idx=77)
        assert result.computed_at_bar_idx == 77

    def test_sub_dataclasses_present(self):
        """All four sub-dataclasses are populated."""
        daily, intraday = self._make_full_session()
        result = compute_htf_narrative(daily, intraday, None, current_bar_idx=0)
        assert isinstance(result.asian_range, AsianRange)
        assert isinstance(result.london_bias, LondonBias)
        assert isinstance(result.ny_bias, NYBias)
        assert isinstance(result.daily_dealing, DailyDealing)

    def test_pure_function_same_inputs_same_output(self):
        """Calling compute_htf_narrative twice with identical inputs produces identical results."""
        daily, intraday = self._make_full_session()
        r1 = compute_htf_narrative(daily, intraday, None, current_bar_idx=10)
        r2 = compute_htf_narrative(daily, intraday, None, current_bar_idx=10)
        # asian_range
        assert r1.asian_range.high == r2.asian_range.high
        assert r1.asian_range.low == r2.asian_range.low
        # london_bias
        assert r1.london_bias.direction == r2.london_bias.direction
        assert r1.london_bias.swept_pdh == r2.london_bias.swept_pdh
        # ny_bias
        assert r1.ny_bias.direction == r2.ny_bias.direction
        # daily_dealing
        assert r1.daily_dealing.current_quadrant == r2.daily_dealing.current_quadrant

    def test_empty_daily_bars_does_not_raise(self):
        """Empty daily_bars → fail-open, no exception."""
        _, intraday = self._make_full_session()
        result = compute_htf_narrative(pl.DataFrame(), intraday, None, current_bar_idx=0)
        assert isinstance(result, HtfNarrative)
        # DailyDealing will have Nones but should not raise
        assert result.daily_dealing.dealing_range_high is None

    def test_empty_intraday_bars_does_not_raise(self):
        """Empty intraday_bars → fail-open, no exception."""
        daily, _ = self._make_full_session()
        result = compute_htf_narrative(daily, pl.DataFrame(), None, current_bar_idx=0)
        assert isinstance(result, HtfNarrative)
        assert result.asian_range.high is None
        assert result.london_bias.direction is None
        assert result.ny_bias.direction is None
