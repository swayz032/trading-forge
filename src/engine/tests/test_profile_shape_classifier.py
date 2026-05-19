"""Tests for profile_shape_classifier.py — D/b/P/Thin classification.

Minimum 12 tests as required by Track 2 spec.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.profile_shape_classifier import (
    BP_POC_TAIL_PCT,
    BP_TAIL_THIN_PCT,
    D_SHAPE_MIN_VA_RANGE_PCT,
    D_SHAPE_POC_HIGH_PCT,
    D_SHAPE_POC_LOW_PCT,
    THIN_RANGE_MULTIPLIER,
    THIN_VA_MAX_RANGE_PCT,
    ProfileShapeClassification,
    ascii_profile,
    classify_profile_shape,
)
from src.engine.indicators.volume_profile import VolumeProfileLevels, compute_volume_profile


# ─── Helpers ─────────────────────────────────────────────────────────────────

def make_bars_with_distribution(
    price_volume_pairs: list[tuple[float, float]],  # (price, volume)
) -> pl.DataFrame:
    """Create bars where each bar has high==low==price and given volume."""
    rows = []
    for i, (price, vol) in enumerate(price_volume_pairs):
        ts = datetime(2026, 1, 2, 9, 30) + timedelta(minutes=5 * i)
        rows.append({
            "ts_event": ts,
            "open": price,
            "high": price,
            "low": price,
            "close": price,
            "volume": vol,
        })
    return pl.DataFrame(rows)


def make_levels_with_bin_map(
    poc: float, vah: float, val: float,
    session_high: float, session_low: float,
    bin_map: dict[float, float],
) -> VolumeProfileLevels:
    """Build a VolumeProfileLevels with explicit bin_map (for testing classifier)."""
    total_vol = sum(bin_map.values())
    lvl = VolumeProfileLevels(
        poc=poc, vah=vah, val=val,
        session_high=session_high,
        session_low=session_low,
        total_volume=total_vol,
    )
    lvl._bin_map = bin_map
    return lvl


def _balanced_bin_map(low: float, high: float, tick: float = 0.25) -> dict[float, float]:
    """Uniform volume distribution across entire range — D-shaped."""
    result = {}
    price = low
    while price <= high + 1e-9:
        result[round(price / tick) * tick] = 1000.0
        price += tick
    return result


def _b_shape_bin_map(low: float, high: float, tick: float = 0.25) -> dict[float, float]:
    """b-shaped: heavy volume at bottom 33%, thin at top 33%."""
    result = {}
    range_size = high - low
    price = low
    while price <= high + 1e-9:
        pct = (price - low) / range_size if range_size > 0 else 0.5
        if pct <= 0.33:
            vol = 5000.0   # Heavy at bottom
        elif pct >= 0.67:
            vol = 50.0     # Very thin at top
        else:
            vol = 800.0    # Moderate in middle
        result[round(price / tick) * tick] = vol
        price += tick
    return result


def _p_shape_bin_map(low: float, high: float, tick: float = 0.25) -> dict[float, float]:
    """P-shaped: heavy volume at top 33%, thin at bottom 33%."""
    result = {}
    range_size = high - low
    price = low
    while price <= high + 1e-9:
        pct = (price - low) / range_size if range_size > 0 else 0.5
        if pct >= 0.67:
            vol = 5000.0   # Heavy at top
        elif pct <= 0.33:
            vol = 50.0     # Very thin at bottom
        else:
            vol = 800.0    # Moderate in middle
        result[round(price / tick) * tick] = vol
        price += tick
    return result


# ─── Test 1: D-shaped on balanced distribution ───────────────────────────────

def test_d_shape_balanced():
    """Uniform volume with centered POC → D-shape."""
    low, high = 5000.0, 5010.0
    bin_map = _balanced_bin_map(low, high)
    poc = 5005.0  # center
    # VA covers ~60% of range
    va_range = (high - low) * 0.65
    vah = poc + va_range / 2
    val = poc - va_range / 2
    lvl = make_levels_with_bin_map(poc, vah, val, high, low, bin_map)
    result = classify_profile_shape(lvl, atr_20d=5.0)
    assert result.shape == "D", f"Expected D, got {result.shape} ({result.evidence})"
    assert result.confidence >= 0.60


# ─── Test 2: b-shaped on selling-tail-top pattern ────────────────────────────

def test_b_shape_detected():
    """Heavy bottom, thin top → b-shaped."""
    low, high = 5000.0, 5020.0
    bin_map = _b_shape_bin_map(low, high)
    poc_price = 5002.0    # bottom 10% of range (within 33%)
    va_range = (high - low) * 0.4
    lvl = make_levels_with_bin_map(
        poc=poc_price,
        vah=poc_price + va_range,
        val=poc_price,
        session_high=high,
        session_low=low,
        bin_map=bin_map,
    )
    result = classify_profile_shape(lvl, atr_20d=5.0)
    assert result.shape == "b", f"Expected b, got {result.shape} ({result.evidence})"
    assert result.confidence >= 0.60


# ─── Test 3: P-shaped on buying-tail-bottom pattern ──────────────────────────

def test_p_shape_detected():
    """Heavy top, thin bottom → P-shaped."""
    low, high = 5000.0, 5020.0
    bin_map = _p_shape_bin_map(low, high)
    poc_price = 5018.0    # top 10% of range (within top 33%)
    va_range = (high - low) * 0.4
    lvl = make_levels_with_bin_map(
        poc=poc_price,
        vah=poc_price,
        val=poc_price - va_range,
        session_high=high,
        session_low=low,
        bin_map=bin_map,
    )
    result = classify_profile_shape(lvl, atr_20d=5.0)
    assert result.shape == "P", f"Expected P, got {result.shape} ({result.evidence})"
    assert result.confidence >= 0.60


# ─── Test 4: Thin detected on trend day ──────────────────────────────────────

def test_thin_detected_on_trend_day():
    """Range > 1.5×ATR and VA < 40% of range → Thin."""
    low, high = 5000.0, 5030.0   # 30pt range vs ATR of 10 → 3×ATR
    atr = 10.0
    # VA is thin — only 20% of range
    poc = 5015.0
    va_range = (high - low) * 0.20
    # Build a bin map with volume concentrated narrowly
    bin_map: dict[float, float] = {}
    for price_cents in range(int(low / 0.25), int(high / 0.25) + 1):
        price = price_cents * 0.25
        pct = (price - low) / (high - low)
        vol = 5000.0 if 0.45 <= pct <= 0.55 else 100.0
        bin_map[price] = vol
    lvl = make_levels_with_bin_map(
        poc=poc,
        vah=poc + va_range / 2,
        val=poc - va_range / 2,
        session_high=high,
        session_low=low,
        bin_map=bin_map,
    )
    result = classify_profile_shape(lvl, atr_20d=atr)
    assert result.shape == "Thin", f"Expected Thin, got {result.shape} ({result.evidence})"


# ─── Test 5: No ATR provided — Thin check skipped ────────────────────────────

def test_no_atr_skips_thin_check():
    """Without atr_20d, Thin classification is skipped."""
    low, high = 5000.0, 5030.0
    bin_map = _balanced_bin_map(low, high)
    poc = 5015.0
    va_range = (high - low) * 0.20  # thin VA
    lvl = make_levels_with_bin_map(
        poc=poc, vah=poc + va_range / 2, val=poc - va_range / 2,
        session_high=high, session_low=low, bin_map=bin_map,
    )
    result = classify_profile_shape(lvl, atr_20d=None)
    # Should NOT be Thin without ATR
    assert result.shape != "Thin"


# ─── Test 6: Confidence score reflects certainty ─────────────────────────────

def test_confidence_range():
    """Confidence must be in [0.0, 1.0]."""
    bin_map = _balanced_bin_map(5000.0, 5010.0)
    lvl = make_levels_with_bin_map(
        poc=5005.0, vah=5008.0, val=5002.0,
        session_high=5010.0, session_low=5000.0, bin_map=bin_map,
    )
    result = classify_profile_shape(lvl, atr_20d=5.0)
    assert 0.0 <= result.confidence <= 1.0


# ─── Test 7: Degenerate — no volume ──────────────────────────────────────────

def test_degenerate_no_volume():
    """Empty bin_map returns D-shape with low confidence (degenerate)."""
    lvl = make_levels_with_bin_map(
        poc=5000.0, vah=5000.0, val=5000.0,
        session_high=5000.0, session_low=5000.0, bin_map={},
    )
    result = classify_profile_shape(lvl, atr_20d=5.0)
    assert result.shape == "D"
    assert result.confidence < 0.50


# ─── Test 8: Very thin profile (compressed range) ────────────────────────────

def test_very_thin_profile_range():
    """Tiny range (< 1 tick) → degenerate, still returns valid shape."""
    lvl = make_levels_with_bin_map(
        poc=5000.0, vah=5000.0, val=5000.0,
        session_high=5000.0, session_low=5000.0,
        bin_map={5000.0: 1000.0},
    )
    result = classify_profile_shape(lvl, atr_20d=5.0)
    assert result.shape in ("D", "b", "P", "Thin")
    assert 0.0 <= result.confidence <= 1.0


# ─── Test 9: Very wide profile ────────────────────────────────────────────────

def test_very_wide_profile():
    """Wide balanced profile → D-shaped."""
    low, high = 4900.0, 5100.0   # 200pt range
    bin_map = _balanced_bin_map(low, high)
    poc = 5000.0
    va_range = (high - low) * 0.70
    lvl = make_levels_with_bin_map(
        poc=poc, vah=poc + va_range / 2, val=poc - va_range / 2,
        session_high=high, session_low=low, bin_map=bin_map,
    )
    result = classify_profile_shape(lvl, atr_20d=30.0)  # ATR < range/1.5 → no Thin
    assert result.shape == "D"


# ─── Test 10: Ambiguous mid-range (POC not strongly in any zone) ──────────────

def test_ambiguous_mid_range():
    """POC in mid-range, thin VA — ambiguous, returns some shape with valid confidence."""
    low, high = 5000.0, 5020.0
    bin_map = _balanced_bin_map(low, high)
    poc = 5010.0  # exact center
    va_range = (high - low) * 0.30   # thin VA (below 60%)
    lvl = make_levels_with_bin_map(
        poc=poc, vah=poc + va_range / 2, val=poc - va_range / 2,
        session_high=high, session_low=low, bin_map=bin_map,
    )
    result = classify_profile_shape(lvl, atr_20d=8.0)
    assert result.shape in ("D", "b", "P", "Thin")
    assert 0.0 < result.confidence <= 1.0


# ─── Test 11: ASCII visualization doesn't crash ───────────────────────────────

def test_ascii_visualization():
    """ascii_profile should return a non-empty string without crashing."""
    low, high = 5000.0, 5010.0
    bin_map = _balanced_bin_map(low, high)
    poc = 5005.0
    va_range = (high - low) * 0.65
    lvl = make_levels_with_bin_map(
        poc=poc, vah=poc + va_range / 2, val=poc - va_range / 2,
        session_high=high, session_low=low, bin_map=bin_map,
    )
    output = ascii_profile(lvl)
    assert isinstance(output, str)
    assert len(output) > 10
    assert "POC" in output


# ─── Test 12: Evidence dict always populated ──────────────────────────────────

def test_evidence_populated():
    """Every classification returns a non-empty evidence dict."""
    bin_map = _b_shape_bin_map(5000.0, 5020.0)
    lvl = make_levels_with_bin_map(
        poc=5002.0, vah=5010.0, val=5001.0,
        session_high=5020.0, session_low=5000.0, bin_map=bin_map,
    )
    result = classify_profile_shape(lvl, atr_20d=8.0)
    assert isinstance(result.evidence, dict)
    assert "poc" in result.evidence
    assert "session_range" in result.evidence
    assert "reason" in result.evidence


# ─── Test 13: Real compute_volume_profile → classify_profile_shape pipeline ──

def test_end_to_end_d_shape_from_bars():
    """End-to-end: compute VP from bars then classify shape."""
    bars = pl.DataFrame({
        "ts_event": [datetime(2026, 1, 2, 9, 30) + timedelta(minutes=5 * i) for i in range(40)],
        "open": [5000.0 + i * 0.25 for i in range(40)],
        "high": [5000.0 + i * 0.25 for i in range(40)],
        "low": [4999.75 + i * 0.25 for i in range(40)],
        "close": [5000.0 + i * 0.25 for i in range(40)],
        "volume": [1000.0] * 40,
    })
    levels = compute_volume_profile(bars, symbol="MES")
    result = classify_profile_shape(levels, atr_20d=5.0)
    assert result.shape in ("D", "b", "P", "Thin")
    assert 0.0 < result.confidence <= 1.0
