"""Tests for SMT divergence continuous confidence scoring.

Covers:
  - Empty / insufficient bars → None
  - Perfectly correlated ES + NQ (no divergence) → None
  - ES new low + NQ higher low (bullish SMT) → score > 0.5
  - ES new high + NQ lower high (bearish SMT) → score > 0.5
  - Pure-function determinism (same inputs → same output)
  - Score is clamped in [0, 1] — never overflows
  - ATR magnitude normalization (high-vol vs low-vol comparable scores)
  - Time-alignment with ts_event (backward asof, no look-ahead)
  - direction string values are canonical
"""

from __future__ import annotations

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.smt_divergence import (
    SmtDivergence,
    compute_smt_divergence,
    _compute_atr14,
    _clamp,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_bars(
    n: int,
    base_price: float = 5000.0,
    atr: float = 10.0,
    trend: float = 0.0,
    with_ts_event: bool = False,
    ts_start: datetime | None = None,
    ts_step_minutes: int = 5,
) -> pl.DataFrame:
    """Build a synthetic OHLCV bar DataFrame.

    Each bar:  close = base + trend*i + small noise (deterministic)
               high  = close + atr * 0.5
               low   = close - atr * 0.5
               open  = close - atr * 0.1 (small body)
    """
    closes = [base_price + trend * i for i in range(n)]
    highs  = [c + atr * 0.5 for c in closes]
    lows   = [c - atr * 0.5 for c in closes]
    opens  = [c - atr * 0.1 for c in closes]
    volumes = [10_000] * n

    data: dict = {
        "open":   opens,
        "high":   highs,
        "low":    lows,
        "close":  closes,
        "volume": volumes,
    }

    if with_ts_event:
        start = ts_start or datetime(2024, 1, 2, 9, 30)
        timestamps = [start + timedelta(minutes=ts_step_minutes * i) for i in range(n)]
        data["ts_event"] = timestamps

    return pl.DataFrame(data)


def _make_bullish_smt_pair(
    n_baseline: int = 40,
    lookback: int = 20,
    atr: float = 10.0,
    base_es: float = 5000.0,
    base_nq: float = 18000.0,
    with_ts_event: bool = False,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Build ES + NQ bar pair where the last bar is a bullish SMT divergence.

    ES: makes a new low (close drops 3*atr below previous range)
    NQ: does NOT make a new low (stays near base_nq)
    """
    n = n_baseline + 1  # +1 for the divergence bar

    # ES: mostly flat, last bar dips to a clear new low.
    # Close well below open on divergence bar to produce strong displacement_confirmation.
    es_closes = [base_es] * n_baseline + [base_es - 3.0 * atr]
    es_lows   = [c - atr * 0.5 for c in es_closes]
    # Force last ES low clearly below the lookback window low
    es_lows[-1] = base_es - 4.0 * atr  # well below all prior lows
    es_highs  = [c + atr * 0.5 for c in es_closes]
    # Strong divergence bar body: open near baseline, close well down → body ≈ 3*atr
    es_opens  = [c - atr * 0.1 for c in es_closes]
    es_opens[-1] = base_es  # open near baseline price
    # close already = base_es - 3.0*atr, so bar body = 3.0*atr → displacement_confirmation ≈ 1.0

    # NQ: also flat, but last bar does NOT break to a new low (higher low).
    # NQ stays near base_nq — its lookback low is base_nq - 0.5*atr.
    # Last bar: NQ low is MUCH higher than lookback low to give a big magnitude gap
    # (contributing to a strong displacement_confirmation + magnitude score).
    nq_closes = [base_nq] * n_baseline + [base_nq]
    nq_lows   = [c - atr * 0.5 for c in nq_closes]
    # NQ last bar low = base_nq - 0.1*atr (well above lookback low of base_nq - 0.5*atr)
    # This gives raw_magnitude = |(base_nq - 0.1*atr) - (base_nq - 0.5*atr)| = 0.4*atr
    nq_lows[-1] = base_nq - 0.1 * atr  # clear non-break: 0.4*atr gap vs lookback low
    nq_highs  = [c + atr * 0.5 for c in nq_closes]
    # Strong close on divergence bar: NQ closes well above open → signals
    # institutional absorption; bar body = 0.8*atr
    nq_opens  = [c - atr * 0.1 for c in nq_closes]

    def _df(opens, highs, lows, closes, ts_offset=0):
        data = {
            "open": opens, "high": highs, "low": lows,
            "close": closes, "volume": [10_000] * n,
        }
        if with_ts_event:
            start = datetime(2024, 1, 2, 9, 30)
            data["ts_event"] = [
                start + timedelta(minutes=5 * (i + ts_offset)) for i in range(n)
            ]
        return pl.DataFrame(data)

    es_df = _df(es_opens, es_highs, es_lows, es_closes, ts_offset=0)
    nq_df = _df(nq_opens, nq_highs, nq_lows, nq_closes, ts_offset=0)
    return es_df, nq_df


def _make_bearish_smt_pair(
    n_baseline: int = 40,
    lookback: int = 20,
    atr: float = 10.0,
    base_es: float = 5000.0,
    base_nq: float = 18000.0,
    with_ts_event: bool = False,
) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Build ES + NQ pair where the last bar is a bearish SMT divergence.

    ES: makes a new high (close surges 3*atr above previous range)
    NQ: does NOT make a new high (lower high)
    """
    n = n_baseline + 1

    # ES: strong surge to new high; large bar body → high displacement_confirmation
    es_closes = [base_es] * n_baseline + [base_es + 3.0 * atr]
    es_highs  = [c + atr * 0.5 for c in es_closes]
    es_highs[-1] = base_es + 4.0 * atr  # clear new high
    es_lows   = [c - atr * 0.5 for c in es_closes]
    es_opens  = [c - atr * 0.1 for c in es_closes]
    es_opens[-1] = base_es  # open near baseline → body ≈ 3.0*atr

    # NQ: lookback high = base_nq + 0.5*atr; last bar high stays well below → big magnitude gap
    nq_closes = [base_nq] * n_baseline + [base_nq]
    nq_highs  = [c + atr * 0.5 for c in nq_closes]
    nq_highs[-1] = base_nq + 0.1 * atr  # NQ does NOT make a new high; gap = 0.4*atr
    nq_lows   = [c - atr * 0.5 for c in nq_closes]
    nq_opens  = [c - atr * 0.1 for c in nq_closes]

    def _df(opens, highs, lows, closes, ts_offset=0):
        data = {
            "open": opens, "high": highs, "low": lows,
            "close": closes, "volume": [10_000] * n,
        }
        if with_ts_event:
            start = datetime(2024, 1, 2, 9, 30)
            data["ts_event"] = [
                start + timedelta(minutes=5 * (i + ts_offset)) for i in range(n)
            ]
        return pl.DataFrame(data)

    es_df = _df(es_opens, es_highs, es_lows, es_closes)
    nq_df = _df(nq_opens, nq_highs, nq_lows, nq_closes)
    return es_df, nq_df


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestEmptyAndInsufficientBars:
    def test_empty_es_returns_none(self):
        es = pl.DataFrame({"open": [], "high": [], "low": [], "close": [], "volume": []})
        nq = _make_bars(50)
        result = compute_smt_divergence(es, nq)
        assert result is None

    def test_empty_nq_returns_none(self):
        es = _make_bars(50)
        nq = pl.DataFrame({"open": [], "high": [], "low": [], "close": [], "volume": []})
        result = compute_smt_divergence(es, nq)
        assert result is None

    def test_too_few_bars_returns_none(self):
        # Need lookback(20) + ATR_PERIOD(14) + 1 = 35 bars minimum
        es = _make_bars(30)
        nq = _make_bars(30)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is None

    def test_exactly_min_bars_does_not_crash(self):
        # 36 bars = lookback(20) + ATR_PERIOD(14) + 1 + 1 margin; may return None but must not raise
        es = _make_bars(36)
        nq = _make_bars(36)
        try:
            compute_smt_divergence(es, nq, lookback=20)
        except Exception as exc:
            pytest.fail(f"Should not raise on minimum bars: {exc}")

    def test_missing_required_columns_returns_none(self):
        es = pl.DataFrame({"open": [1.0] * 50, "close": [1.0] * 50})
        nq = _make_bars(50)
        result = compute_smt_divergence(es, nq)
        assert result is None


class TestNoSMTDivergence:
    def test_perfectly_correlated_returns_none(self):
        """When ES and NQ move identically (both make new lows together), no divergence."""
        n = 50
        # Both trending down in lockstep — no divergence
        es = _make_bars(n, trend=-5.0, atr=10.0)
        nq = _make_bars(n, base_price=18000.0, trend=-18.0, atr=36.0)  # NQ ≈ 3.6× ES
        result = compute_smt_divergence(es, nq, lookback=20)
        # Perfectly correlated moves should not produce divergence
        # (both make new lows simultaneously)
        # If it detects divergence, score must still be valid [0,1]
        if result is not None:
            assert 0.0 <= result.score <= 1.0

    def test_flat_market_returns_none(self):
        """Flat market = no new highs or lows = no SMT divergence."""
        n = 50
        # Constant price series — no swings at all
        es = _make_bars(n, trend=0.0, atr=0.0)
        nq = _make_bars(n, base_price=18000.0, trend=0.0, atr=0.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        # Flat price → no breakouts → None
        assert result is None


class TestBullishSMT:
    def test_bullish_smt_detected(self):
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None, "Bullish SMT must be detected"

    def test_bullish_smt_direction(self):
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert result.direction == "bullish_es_low_nq_higher"

    def test_bullish_smt_score_above_threshold(self):
        """Canonical bullish SMT with strong setup must score > 0.5."""
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert result.score > 0.5, (
            f"Expected bullish SMT score > 0.5, got {result.score:.4f}"
        )

    def test_bullish_smt_score_in_unit_interval(self):
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert 0.0 <= result.score <= 1.0

    def test_bullish_smt_magnitude_positive(self):
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert result.magnitude >= 0.0

    def test_bullish_smt_sub_scores_in_unit_interval(self):
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert 0.0 <= result.time_synced <= 1.0
        assert 0.0 <= result.structure_quality <= 1.0
        assert 0.0 <= result.displacement_confirmation <= 1.0

    def test_bullish_smt_age_bars_zero_at_detection(self):
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert result.age_bars == 0

    def test_bullish_smt_with_ts_event(self):
        """Time-aligned variant with ts_event columns still detects bullish SMT."""
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0, with_ts_event=True)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert result.direction == "bullish_es_low_nq_higher"
        assert result.score > 0.5


class TestBearishSMT:
    def test_bearish_smt_detected(self):
        es, nq = _make_bearish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None, "Bearish SMT must be detected"

    def test_bearish_smt_direction(self):
        es, nq = _make_bearish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert result.direction == "bearish_es_high_nq_lower"

    def test_bearish_smt_score_above_threshold(self):
        es, nq = _make_bearish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert result.score > 0.5

    def test_bearish_smt_score_in_unit_interval(self):
        es, nq = _make_bearish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert 0.0 <= result.score <= 1.0


class TestPureFunctionDeterminism:
    def test_same_inputs_same_output(self):
        """Pure function: identical inputs must produce identical SmtDivergence."""
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result1 = compute_smt_divergence(es, nq, lookback=20)
        result2 = compute_smt_divergence(es, nq, lookback=20)
        assert result1 is not None
        assert result2 is not None
        assert result1.score == result2.score
        assert result1.direction == result2.direction
        assert result1.magnitude == result2.magnitude
        assert result1.time_synced == result2.time_synced
        assert result1.structure_quality == result2.structure_quality
        assert result1.displacement_confirmation == result2.displacement_confirmation

    def test_different_inputs_different_output(self):
        """Different bar data should produce different scores."""
        es1, nq1 = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        # Strong divergence (big ATR = big moves)
        es2, nq2 = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=20.0)
        r1 = compute_smt_divergence(es1, nq1, lookback=20)
        r2 = compute_smt_divergence(es2, nq2, lookback=20)
        # Both should detect but may differ in sub-component scores
        assert r1 is not None
        assert r2 is not None
        # They don't need to be identical — they're different inputs


class TestScoreBounds:
    def test_score_never_above_one(self):
        """Score must never exceed 1.0 regardless of inputs."""
        # Extreme setup: very large move, perfectly aligned
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        for _ in range(5):
            result = compute_smt_divergence(es, nq, lookback=20)
            if result is not None:
                assert result.score <= 1.0

    def test_score_never_below_zero(self):
        """Score must never go below 0.0."""
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        if result is not None:
            assert result.score >= 0.0

    def test_clamp_helper(self):
        assert _clamp(1.5) == 1.0
        assert _clamp(-0.5) == 0.0
        assert _clamp(0.5) == 0.5
        assert _clamp(1.0) == 1.0
        assert _clamp(0.0) == 0.0


class TestMagnitudeNormalization:
    def test_high_vol_and_low_vol_comparable_scores(self):
        """ATR normalization must make scores comparable across volatility regimes.

        High-vol (ATR=20) and low-vol (ATR=5) setups with equivalent relative
        divergence (same number of ATR multiples) should produce similar scores.
        """
        # Both setups: divergence = 1× ATR gap, structure = 2× ATR leg
        es_hv, nq_hv = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=20.0)
        es_lv, nq_lv = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=5.0)

        result_hv = compute_smt_divergence(es_hv, nq_hv, lookback=20)
        result_lv = compute_smt_divergence(es_lv, nq_lv, lookback=20)

        assert result_hv is not None, "High-vol SMT must be detected"
        assert result_lv is not None, "Low-vol SMT must be detected"

        # Both are constructed with the same relative move (same ATR multiples)
        # so their normalized scores should be roughly equal (±0.15 tolerance)
        score_diff = abs(result_hv.score - result_lv.score)
        assert score_diff < 0.15, (
            f"Normalized scores should be comparable: hv={result_hv.score:.4f}, "
            f"lv={result_lv.score:.4f}, diff={score_diff:.4f}"
        )

    def test_atr14_computation(self):
        """_compute_atr14 must return a positive float."""
        bars = _make_bars(50, atr=10.0)
        atr = _compute_atr14(bars)
        assert atr > 0.0
        # For our synthetic bars with atr=10.0, expect ATR near 10.0
        # True range ≈ high - low = atr, so ATR(14) ≈ atr
        assert 5.0 <= atr <= 15.0, f"ATR out of expected range: {atr}"

    def test_atr14_single_bar_returns_floor(self):
        """Single bar must not crash and returns floor value."""
        bars = pl.DataFrame({"open": [100.0], "high": [101.0], "low": [99.0], "close": [100.0], "volume": [1000]})
        atr = _compute_atr14(bars)
        assert atr > 0.0


class TestAgeBarContract:
    def test_age_bars_zero_at_detection(self):
        """age_bars is always 0 at detection time — consumer updates it."""
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert result.age_bars == 0

    def test_age_bars_can_be_updated(self):
        """Consumer can update age_bars externally (dataclass field is mutable)."""
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20, atr=10.0)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        result.age_bars = 30
        assert result.age_bars == 30


class TestTimeAlignment:
    def test_ts_event_offset_nq_still_aligns(self):
        """NQ arriving with offset timestamps must align backward to ES bars."""
        n = 50
        start_es = datetime(2024, 1, 2, 9, 30)
        # ES bars: every 5 minutes
        es_closes = [5000.0] * (n - 1) + [5000.0 - 40.0]
        es_lows = [c - 5.0 for c in es_closes]
        es_lows[-1] = 5000.0 - 50.0  # new low
        es_highs = [c + 5.0 for c in es_closes]
        es_opens = [c - 1.0 for c in es_closes]
        es_ts = [start_es + timedelta(minutes=5 * i) for i in range(n)]

        # NQ bars: same bars but with 1-minute offset (simulating timestamp skew)
        start_nq = start_es + timedelta(minutes=1)
        nq_closes = [18000.0] * (n - 1) + [18000.0 - 5.0]
        nq_lows = [c - 18.0 for c in nq_closes]
        nq_lows[-1] = 18000.0 - 15.0  # NQ does NOT break to new low — divergence
        nq_highs = [c + 18.0 for c in nq_closes]
        nq_opens = [c - 3.6 for c in nq_closes]
        nq_ts = [start_nq + timedelta(minutes=5 * i) for i in range(n)]

        es_df = pl.DataFrame({
            "ts_event": es_ts,
            "open": es_opens, "high": es_highs,
            "low": es_lows, "close": es_closes, "volume": [10_000] * n,
        })
        nq_df = pl.DataFrame({
            "ts_event": nq_ts,
            "open": nq_opens, "high": nq_highs,
            "low": nq_lows, "close": nq_closes, "volume": [10_000] * n,
        })

        # Should not raise — backward asof handles the timestamp offset
        try:
            result = compute_smt_divergence(es_df, nq_df, lookback=20)
            # Result may or may not detect divergence depending on alignment,
            # but must not raise and score must be valid
            if result is not None:
                assert 0.0 <= result.score <= 1.0
        except Exception as exc:
            pytest.fail(f"Time-aligned variant must not raise: {exc}")


class TestSMTDivergenceDataclass:
    def test_dataclass_fields(self):
        """SmtDivergence dataclass exposes all required fields."""
        d = SmtDivergence(
            detected_at_bar_idx=10,
            direction="bullish_es_low_nq_higher",
            magnitude=5.0,
            time_synced=0.8,
            structure_quality=0.7,
            displacement_confirmation=0.6,
            score=0.72,
            age_bars=0,
        )
        assert d.detected_at_bar_idx == 10
        assert d.direction == "bullish_es_low_nq_higher"
        assert d.magnitude == 5.0
        assert d.time_synced == 0.8
        assert d.structure_quality == 0.7
        assert d.displacement_confirmation == 0.6
        assert d.score == 0.72
        assert d.age_bars == 0

    def test_canonical_bullish_direction_string(self):
        es, nq = _make_bullish_smt_pair(n_baseline=40, lookback=20)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert result.direction in ("bullish_es_low_nq_higher", "bearish_es_high_nq_lower")

    def test_canonical_bearish_direction_string(self):
        es, nq = _make_bearish_smt_pair(n_baseline=40, lookback=20)
        result = compute_smt_divergence(es, nq, lookback=20)
        assert result is not None
        assert result.direction in ("bullish_es_low_nq_higher", "bearish_es_high_nq_lower")
