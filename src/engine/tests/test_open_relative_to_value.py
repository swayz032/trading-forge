"""Tests for open_relative_to_value.py — all 4 classifications + edge cases.

Minimum 6 tests as required by Track 2 spec.
"""
from __future__ import annotations

import pytest

from src.engine.context.open_relative_to_value import (
    OpenRelativeClassification,
    classify_open_relative_to_value,
)
from src.engine.indicators.volume_profile import VolumeProfileLevels


# ─── Fixtures ────────────────────────────────────────────────────────────────

def make_prior_levels(
    poc: float = 5005.0,
    vah: float = 5008.0,
    val: float = 5002.0,
    session_high: float = 5012.0,
    session_low: float = 4998.0,
) -> VolumeProfileLevels:
    lvl = VolumeProfileLevels(poc=poc, vah=vah, val=val)
    lvl.session_high = session_high
    lvl.session_low = session_low
    lvl.total_volume = 100_000.0
    return lvl


# ─── Test 1: Open-In-Value ────────────────────────────────────────────────────

def test_open_in_value():
    """Open within VAL..VAH → Open-In-Value."""
    prior = make_prior_levels(val=5002.0, vah=5008.0)
    result = classify_open_relative_to_value(open_price=5005.0, prior_levels=prior)
    assert result.classification == "Open-In-Value"


# ─── Test 2: Open-Outside-Value-Up ───────────────────────────────────────────

def test_open_outside_value_up():
    """Open above VAH but within prior range → Open-Outside-Value-Up."""
    prior = make_prior_levels(val=5002.0, vah=5008.0, session_high=5015.0, session_low=4998.0)
    result = classify_open_relative_to_value(open_price=5011.0, prior_levels=prior)
    assert result.classification == "Open-Outside-Value-Up"


# ─── Test 3: Open-Outside-Value-Down ─────────────────────────────────────────

def test_open_outside_value_down():
    """Open below VAL but within prior range → Open-Outside-Value-Down."""
    prior = make_prior_levels(val=5002.0, vah=5008.0, session_high=5015.0, session_low=4998.0)
    result = classify_open_relative_to_value(open_price=4999.0, prior_levels=prior)
    assert result.classification == "Open-Outside-Value-Down"


# ─── Test 4: Open-Outside-Range (gap up) ─────────────────────────────────────

def test_open_outside_range_gap_up():
    """Open above prior session high → Open-Outside-Range (gap up)."""
    prior = make_prior_levels(session_high=5015.0, session_low=4998.0)
    result = classify_open_relative_to_value(open_price=5020.0, prior_levels=prior)
    assert result.classification == "Open-Outside-Range"
    assert "gap_above" in result.evidence.get("reason", "")


# ─── Test 5: Open-Outside-Range (gap down) ───────────────────────────────────

def test_open_outside_range_gap_down():
    """Open below prior session low → Open-Outside-Range (gap down)."""
    prior = make_prior_levels(session_high=5015.0, session_low=4998.0)
    result = classify_open_relative_to_value(open_price=4990.0, prior_levels=prior)
    assert result.classification == "Open-Outside-Range"
    assert "gap_below" in result.evidence.get("reason", "")


# ─── Test 6: Open exactly at VAH (boundary inclusive) ────────────────────────

def test_open_exactly_at_vah_is_in_value():
    """Open exactly at VAH → Open-In-Value (inclusive upper bound)."""
    prior = make_prior_levels(val=5002.0, vah=5008.0)
    result = classify_open_relative_to_value(open_price=5008.0, prior_levels=prior)
    assert result.classification == "Open-In-Value"


# ─── Test 7: Open exactly at VAL (boundary inclusive) ────────────────────────

def test_open_exactly_at_val_is_in_value():
    """Open exactly at VAL → Open-In-Value (inclusive lower bound)."""
    prior = make_prior_levels(val=5002.0, vah=5008.0)
    result = classify_open_relative_to_value(open_price=5002.0, prior_levels=prior)
    assert result.classification == "Open-In-Value"


# ─── Test 8: Thin profile edge case (VAH == VAL == POC) ──────────────────────

def test_thin_profile_prior():
    """Prior was thin (VA collapsed to a single point) — still classifies correctly."""
    # Thin: POC=VAH=VAL=5005
    prior = make_prior_levels(poc=5005.0, vah=5005.0, val=5005.0, session_high=5015.0, session_low=4995.0)
    # Open above POC but within range
    result_above = classify_open_relative_to_value(open_price=5008.0, prior_levels=prior)
    assert result_above.classification == "Open-Outside-Value-Up"
    # Open below POC but within range
    result_below = classify_open_relative_to_value(open_price=5002.0, prior_levels=prior)
    assert result_below.classification == "Open-Outside-Value-Down"
    # Open at POC
    result_at = classify_open_relative_to_value(open_price=5005.0, prior_levels=prior)
    assert result_at.classification == "Open-In-Value"


# ─── Test 9: Tolerance parameter ─────────────────────────────────────────────

def test_tolerance_makes_near_vah_in_value():
    """With tolerance=0.25, open at VAH+0.25 → Open-In-Value."""
    prior = make_prior_levels(val=5002.0, vah=5008.0, session_high=5015.0, session_low=4998.0)
    result = classify_open_relative_to_value(open_price=5008.25, prior_levels=prior, tolerance=0.25)
    assert result.classification == "Open-In-Value"


# ─── Test 10: Evidence dict always populated ─────────────────────────────────

def test_evidence_always_populated():
    """Every result has a non-empty evidence dict with open_price."""
    prior = make_prior_levels()
    for open_price in [4990.0, 4999.0, 5005.0, 5011.0, 5020.0]:
        result = classify_open_relative_to_value(open_price=open_price, prior_levels=prior)
        assert "open_price" in result.evidence
        assert result.evidence["open_price"] == open_price


# ─── Test 11: Degenerate prior (zero poc/vah/val) ────────────────────────────

def test_degenerate_prior_levels():
    """Degenerate prior with all-zero levels returns Open-In-Value safely."""
    prior = VolumeProfileLevels(poc=0.0, vah=0.0, val=0.0)
    result = classify_open_relative_to_value(open_price=5000.0, prior_levels=prior)
    assert result.classification == "Open-In-Value"
    assert result.evidence.get("note") == "degenerate_prior"
