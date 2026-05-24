"""Tests for DSL archetype patterns: vwap_band_reject and anchored_vwap_retest.

Coverage:
  - Pattern library recognizes both new archetypes
  - vwap_band_reject: required/optional param validation
  - vwap_band_reject: band_sigma range enforcement
  - vwap_band_reject: confirmation_bars range enforcement
  - anchored_vwap_retest: required/optional param validation
  - anchored_vwap_retest: anchor_lookback_bars range enforcement
  - Pattern description non-empty
  - validate_entry_params integration for both patterns
  - Backward-compat: existing patterns unaffected
"""
from __future__ import annotations

import pytest

from src.engine.compiler.pattern_library import (
    ENTRY_PATTERNS,
    get_pattern,
    list_patterns,
    validate_entry_params,
)


# ─── Pattern registry tests ───────────────────────────────────────────────────

class TestPatternRegistration:
    def test_vwap_band_reject_registered(self):
        assert "vwap_band_reject" in ENTRY_PATTERNS

    def test_anchored_vwap_retest_registered(self):
        assert "anchored_vwap_retest" in ENTRY_PATTERNS

    def test_get_vwap_band_reject(self):
        p = get_pattern("vwap_band_reject")
        assert p is not None
        assert "description" in p
        assert len(p["description"]) > 0

    def test_get_anchored_vwap_retest(self):
        p = get_pattern("anchored_vwap_retest")
        assert p is not None
        assert "description" in p
        assert len(p["description"]) > 0

    def test_both_in_list_patterns(self):
        names = list_patterns()
        assert "vwap_band_reject" in names
        assert "anchored_vwap_retest" in names

    def test_existing_patterns_unaffected(self):
        """Pre-existing patterns must remain registered."""
        existing = [
            "sma_crossover", "ema_crossover", "rsi_reversal", "bollinger_breakout",
            "atr_breakout", "vwap_reversion", "donchian_breakout",
            "session_open_breakout", "macd_crossover", "vwap_fade",
            "event_driven_fade", "overnight_drift",
        ]
        for name in existing:
            assert name in ENTRY_PATTERNS, f"Pre-existing pattern '{name}' missing after new registrations"


# ─── vwap_band_reject validation tests ────────────────────────────────────────

class TestVwapBandRejectValidation:
    def test_valid_minimum_params(self):
        valid, errors = validate_entry_params("vwap_band_reject", {"band_sigma": 2.0})
        assert valid, f"Expected valid, got errors: {errors}"

    def test_valid_with_optional_params(self):
        valid, errors = validate_entry_params("vwap_band_reject", {
            "band_sigma": 2.0,
            "confirmation_bars": 1,
            "require_close_inside": 1,
        })
        assert valid, f"Expected valid, got errors: {errors}"

    def test_missing_required_band_sigma(self):
        valid, errors = validate_entry_params("vwap_band_reject", {})
        assert not valid
        assert any("band_sigma" in e for e in errors), f"Expected band_sigma in errors: {errors}"

    def test_band_sigma_below_range(self):
        valid, errors = validate_entry_params("vwap_band_reject", {"band_sigma": 1.0})
        assert not valid
        assert any("band_sigma" in e for e in errors)

    def test_band_sigma_above_range(self):
        valid, errors = validate_entry_params("vwap_band_reject", {"band_sigma": 3.0})
        assert not valid
        assert any("band_sigma" in e for e in errors)

    def test_band_sigma_at_boundary_lower(self):
        valid, errors = validate_entry_params("vwap_band_reject", {"band_sigma": 1.5})
        assert valid, f"Lower boundary 1.5 should be valid: {errors}"

    def test_band_sigma_at_boundary_upper(self):
        valid, errors = validate_entry_params("vwap_band_reject", {"band_sigma": 2.5})
        assert valid, f"Upper boundary 2.5 should be valid: {errors}"

    def test_confirmation_bars_below_range(self):
        valid, errors = validate_entry_params("vwap_band_reject", {
            "band_sigma": 2.0,
            "confirmation_bars": 0,
        })
        assert not valid
        assert any("confirmation_bars" in e for e in errors)

    def test_confirmation_bars_above_range(self):
        valid, errors = validate_entry_params("vwap_band_reject", {
            "band_sigma": 2.0,
            "confirmation_bars": 4,
        })
        assert not valid
        assert any("confirmation_bars" in e for e in errors)

    def test_unknown_param_rejected(self):
        valid, errors = validate_entry_params("vwap_band_reject", {
            "band_sigma": 2.0,
            "nonexistent_param": 99,
        })
        assert not valid
        assert any("nonexistent_param" in e or "Unknown" in e for e in errors)

    def test_require_close_inside_valid_values(self):
        for val in [0, 1]:
            valid, errors = validate_entry_params("vwap_band_reject", {
                "band_sigma": 2.0,
                "require_close_inside": val,
            })
            assert valid, f"require_close_inside={val} should be valid: {errors}"


# ─── anchored_vwap_retest validation tests ────────────────────────────────────

class TestAnchoredVwapRetestValidation:
    def test_valid_minimum_params(self):
        valid, errors = validate_entry_params("anchored_vwap_retest", {"anchor_lookback_bars": 20})
        assert valid, f"Expected valid, got errors: {errors}"

    def test_valid_with_optional_params(self):
        valid, errors = validate_entry_params("anchored_vwap_retest", {
            "anchor_lookback_bars": 20,
            "confirmation_bars": 2,
            "tolerance_ticks": 3,
        })
        assert valid, f"Expected valid, got errors: {errors}"

    def test_missing_required_anchor_lookback(self):
        valid, errors = validate_entry_params("anchored_vwap_retest", {})
        assert not valid
        assert any("anchor_lookback_bars" in e for e in errors), (
            f"Expected anchor_lookback_bars in errors: {errors}"
        )

    def test_anchor_lookback_below_range(self):
        valid, errors = validate_entry_params("anchored_vwap_retest", {"anchor_lookback_bars": 0})
        assert not valid
        assert any("anchor_lookback_bars" in e for e in errors)

    def test_anchor_lookback_above_range(self):
        valid, errors = validate_entry_params("anchored_vwap_retest", {"anchor_lookback_bars": 101})
        assert not valid
        assert any("anchor_lookback_bars" in e for e in errors)

    def test_anchor_lookback_at_boundaries(self):
        for val in [1, 100]:
            valid, errors = validate_entry_params("anchored_vwap_retest", {
                "anchor_lookback_bars": val,
            })
            assert valid, f"Boundary value {val} should be valid: {errors}"

    def test_tolerance_ticks_below_range(self):
        valid, errors = validate_entry_params("anchored_vwap_retest", {
            "anchor_lookback_bars": 10,
            "tolerance_ticks": 0,
        })
        assert not valid
        assert any("tolerance_ticks" in e for e in errors)

    def test_tolerance_ticks_above_range(self):
        valid, errors = validate_entry_params("anchored_vwap_retest", {
            "anchor_lookback_bars": 10,
            "tolerance_ticks": 11,
        })
        assert not valid
        assert any("tolerance_ticks" in e for e in errors)

    def test_confirmation_bars_valid_range(self):
        for val in [1, 2, 3]:
            valid, errors = validate_entry_params("anchored_vwap_retest", {
                "anchor_lookback_bars": 10,
                "confirmation_bars": val,
            })
            assert valid, f"confirmation_bars={val} should be valid: {errors}"

    def test_unknown_param_rejected(self):
        valid, errors = validate_entry_params("anchored_vwap_retest", {
            "anchor_lookback_bars": 10,
            "mystery_param": 42,
        })
        assert not valid
        assert any("mystery_param" in e or "Unknown" in e for e in errors)


# ─── Pattern structure invariants ────────────────────────────────────────────

class TestPatternStructure:
    @pytest.mark.parametrize("pattern_name", ["vwap_band_reject", "anchored_vwap_retest"])
    def test_pattern_has_required_keys(self, pattern_name):
        p = get_pattern(pattern_name)
        assert "description" in p
        assert "required_params" in p
        assert "optional_params" in p
        assert "param_ranges" in p

    @pytest.mark.parametrize("pattern_name", ["vwap_band_reject", "anchored_vwap_retest"])
    def test_required_params_all_have_ranges(self, pattern_name):
        p = get_pattern(pattern_name)
        for param in p["required_params"]:
            assert param in p["param_ranges"], (
                f"Required param '{param}' in '{pattern_name}' has no range defined"
            )

    @pytest.mark.parametrize("pattern_name", ["vwap_band_reject", "anchored_vwap_retest"])
    def test_optional_params_all_have_ranges(self, pattern_name):
        p = get_pattern(pattern_name)
        for param in p["optional_params"]:
            assert param in p["param_ranges"], (
                f"Optional param '{param}' in '{pattern_name}' has no range defined"
            )

    @pytest.mark.parametrize("pattern_name", ["vwap_band_reject", "anchored_vwap_retest"])
    def test_range_tuples_are_ordered(self, pattern_name):
        p = get_pattern(pattern_name)
        for param, (lo, hi) in p["param_ranges"].items():
            assert lo <= hi, (
                f"Range [{lo}, {hi}] for '{param}' in '{pattern_name}' is inverted"
            )
