"""Tests for exportability scoring — ICT alert-only model (Pass 2 Track B, verified 2026-07-06).

The raw ICT names (fvg/order_block/breaker_block/liquidity_sweep) map to a REAL alert-only Pine via
ARCHETYPE_PINE_RECIPE (verified: a script WITH an alertcondition, no placeholder), so an ICT-entry
strategy IS Pine-exportable as a passive alert marker — the Python engine owns the actual entry/exit.
indicator_score=60 with a gentle -5 advisory ("prefer 'archetype:<key>'"). These tests assert that
verified-current behavior; the earlier strict "ICT = no Pine, score 0, not exportable" model was
deliberately superseded. (Pine is the family-distribution + visual-monitor path only.)
"""
import pytest
from src.engine.exportability import score_exportability, ICT_NO_PINE_INDICATORS


# ─── Helpers ────────────────────────────────────────────────────────────────

def _strategy(indicators: list[str], **kwargs) -> dict:
    """Minimal strategy dict for scoring tests."""
    return {
        "indicators": [{"type": t} for t in indicators],
        "exit_type": "atr_multiple",
        **kwargs,
    }


# ─── Native Pine indicators (regression) ────────────────────────────────────

def test_native_pine_indicators_score_100():
    result = score_exportability(_strategy(["sma", "ema", "rsi"]))
    assert result.score == 100.0
    assert result.exportable is True
    assert result.band == "clean"


# ─── Single ICT indicator ────────────────────────────────────────────────────

# ─── ICT indicators — ALERT-ONLY model (Pass 2 Track B, 2026-06-22; verified 2026-07-06) ────────────
# NOTE (deep-scan Pine re-verify 2026-07-06): the strict "ICT = no Pine, score 0, not exportable" model
# these tests originally encoded was DELIBERATELY superseded by Pass 2 Track B — the raw ICT names
# (fvg/order_block/breaker_block/liquidity_sweep) now map to a REAL alert-only Pine via
# ARCHETYPE_PINE_RECIPE (verified: ARCHETYPE_PINE_RECIPE['fvg'] is a 510-char script WITH an alertcondition,
# no placeholder). So an ICT-entry strategy IS Pine-exportable as a passive alert marker (the Python engine
# owns the actual entry/exit). indicator_score=60, per-ICT deduction is a gentle -5 advisory ("prefer
# 'archetype:<key>'"), NOT the old -30 "no Pine equivalent". These tests assert that VERIFIED-correct
# behavior. (Pine is the family-distribution + visual-monitor path only; the operator trades engine-direct.)
@pytest.mark.parametrize("ict_type", list(ICT_NO_PINE_INDICATORS))
def test_single_ict_indicator_alert_only_recipe(ict_type):
    """One ICT indicator now has an alert-only Pine recipe (only a -5 advisory): score 95, band=clean."""
    result = score_exportability(_strategy([ict_type]))
    assert result.score == pytest.approx(95.0)
    assert result.exportable is True
    assert result.band == "clean"


@pytest.mark.parametrize("ict_type", list(ICT_NO_PINE_INDICATORS))
def test_single_ict_indicator_score_is_60(ict_type):
    """Indicator-level score for a raw ICT type is 60 (alert-only recipe available), not 0."""
    result = score_exportability(_strategy([ict_type]))
    assert result.indicator_scores[ict_type] == 60.0


@pytest.mark.parametrize("ict_type", list(ICT_NO_PINE_INDICATORS))
def test_single_ict_advisory_recommends_archetype_form(ict_type):
    """The honest advisory now lives in recommendations: alert-only recipe exists, prefer archetype:<key>."""
    result = score_exportability(_strategy([ict_type]))
    assert any("alert-only Pine recipe" in r and "archetype" in r for r in result.recommendations)


# ─── Two ICT indicators — still exportable (alert-only), advisory only ───────

def test_two_ict_indicators_alert_only_exportable():
    """fvg + order_block: two -5 advisories → score 90, still exportable (alert-only), band=clean."""
    result = score_exportability(_strategy(["fvg", "order_block"]))
    assert result.score == pytest.approx(90.0)
    assert result.exportable is True
    assert result.band == "clean"


def test_ote_strategy_two_ict_indicators_alert_only_exportable():
    """OTE (order_block + liquidity_sweep): alert-only exportable via ARCHETYPE_PINE_RECIPE → score 90."""
    result = score_exportability(_strategy(["order_block", "liquidity_sweep"]))
    assert result.score == pytest.approx(90.0)
    assert result.exportable is True


# ─── Three / four ICT indicators — still exportable as alert-only markers ────

def test_three_ict_indicators_alert_only_exportable():
    """Three raw ICT: score 85, band=reducible, exportable=True (each has an alert-only recipe)."""
    result = score_exportability(_strategy(["fvg", "order_block", "breaker_block"]))
    assert result.score == pytest.approx(85.0)
    assert result.exportable is True
    assert result.band == "reducible"


def test_four_ict_indicators_alert_only_band():
    """Four raw ICT: score 80, band=reducible, exportable=True (alert-only markers, not do_not_export)."""
    result = score_exportability(
        _strategy(["fvg", "order_block", "breaker_block", "liquidity_sweep"])
    )
    assert result.score == pytest.approx(80.0)
    assert result.exportable is True
    assert result.band == "reducible"


# ─── Mixed: ICT + native ─────────────────────────────────────────────────────

def test_ict_plus_native_indicator_correct_score():
    """sma (native, 100) + fvg (ICT alert-only, 60, -5 advisory) → score 95, exportable=True, band=clean."""
    result = score_exportability(_strategy(["sma", "fvg"]))
    assert result.score == pytest.approx(95.0)
    assert result.exportable is True
    assert result.indicator_scores["sma"] == 100.0
    assert result.indicator_scores["fvg"] == 60.0


def test_ict_plus_native_two_ict_alert_only_exportable():
    """sma + fvg + order_block → score 90, exportable=True (alert-only recipe for both ICT names)."""
    result = score_exportability(_strategy(["sma", "fvg", "order_block"]))
    assert result.score == pytest.approx(90.0)
    assert result.exportable is True


# ─── volume_profile — NONE_MAPPED (genuinely no Pine, unlike ICT alert-only) ─

def test_volume_profile_none_mapped_borderline_exportable():
    """volume_profile is NONE_MAPPED in INDICATOR_MAP (real placeholder-only, NO alert recipe) — distinct
    from the raw ICT names which DO have an alert-only recipe. score 50 (borderline), band=alert_only."""
    result = score_exportability(_strategy(["volume_profile"]))
    assert result.score == pytest.approx(50.0)
    assert result.exportable is True   # exactly at the >=50 threshold with a clean exit
    assert result.band == "alert_only"
    assert result.indicator_scores["volume_profile"] == 0.0
    # It genuinely has no Pine equivalent (mapped to None) — the honest deduction says so.
    assert any("no Pine equivalent" in d and "None" in d for d in result.deductions)
