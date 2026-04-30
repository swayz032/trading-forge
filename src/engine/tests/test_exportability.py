"""Tests for exportability scoring — Path A ICT contradiction fix.

P1 fix: ICT indicators (fvg, order_block, breaker_block, liquidity_sweep) previously scored
-10 each (CUSTOM_PINE_INDICATORS), yielding exportable=True (~score 80) while the compiler
raised ValueError and produced zero artifacts. Each ICT indicator now deducts -25 so a
strategy with 2+ ICT indicators falls at or below score=50 -> exportable=False, matching
actual compiler behaviour.
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

@pytest.mark.parametrize("ict_type", list(ICT_NO_PINE_INDICATORS))
def test_single_ict_indicator_deducts_30(ict_type):
    """One ICT indicator: 100 - 30 = 70. Still exportable=True (>= 50) but band=reducible.
    User is warned via deduction message; alert-only export is still possible."""
    result = score_exportability(_strategy([ict_type]))
    assert result.score == pytest.approx(70.0)
    assert result.exportable is True
    assert result.band == "reducible"


@pytest.mark.parametrize("ict_type", list(ICT_NO_PINE_INDICATORS))
def test_single_ict_indicator_score_is_zero(ict_type):
    """Indicator-level score for ICT type must be 0 (no Pine equivalent)."""
    result = score_exportability(_strategy([ict_type]))
    assert result.indicator_scores[ict_type] == 0.0


@pytest.mark.parametrize("ict_type", list(ICT_NO_PINE_INDICATORS))
def test_single_ict_deduction_message_is_honest(ict_type):
    result = score_exportability(_strategy([ict_type]))
    assert any("no Pine equivalent" in d for d in result.deductions)
    assert any("will not produce a Pine artifact" in d for d in result.deductions)


# ─── Two ICT indicators (the silent-contradiction case) ─────────────────────

def test_two_ict_indicators_score_below_50():
    """
    Core regression: fvg + order_block used to score 80 (exportable=True) while compiler
    produced zero artifacts. Now: 100 - 30 - 30 = 40 -> exportable=False.
    We use -30 (not -25) so that two ICT indicators land strictly below the >= 50 threshold.
    """
    result = score_exportability(_strategy(["fvg", "order_block"]))
    assert result.score == pytest.approx(40.0)
    assert result.exportable is False


def test_two_ict_indicators_band_is_alert_only_or_do_not_export():
    result = score_exportability(_strategy(["fvg", "order_block"]))
    assert result.band in ("alert_only", "do_not_export")


def test_ote_strategy_two_ict_indicators_not_exportable():
    """OTE pattern typically uses order_block + liquidity_sweep — must score exportable=False.
    100 - 30 - 30 = 40 -> exportable=False."""
    result = score_exportability(_strategy(["order_block", "liquidity_sweep"]))
    assert result.score == pytest.approx(40.0)
    assert result.exportable is False


# ─── Three ICT indicators ────────────────────────────────────────────────────

def test_three_ict_indicators_do_not_export():
    """100 - 90 = 10 -> band=do_not_export."""
    result = score_exportability(_strategy(["fvg", "order_block", "breaker_block"]))
    assert result.score == pytest.approx(10.0)
    assert result.exportable is False
    assert result.band == "do_not_export"


# ─── Mixed: ICT + native ─────────────────────────────────────────────────────

def test_ict_plus_native_indicator_correct_score():
    """sma (native, -0) + fvg (ICT, -30) = 70. exportable=True but reducible."""
    result = score_exportability(_strategy(["sma", "fvg"]))
    assert result.score == pytest.approx(70.0)
    assert result.exportable is True
    assert result.indicator_scores["sma"] == 100.0
    assert result.indicator_scores["fvg"] == 0.0


def test_ict_plus_native_two_ict_not_exportable():
    """sma + fvg + order_block = 100 - 30 - 30 = 40 -> exportable=False."""
    result = score_exportability(_strategy(["sma", "fvg", "order_block"]))
    assert result.score == pytest.approx(40.0)
    assert result.exportable is False


# ─── volume_profile still uses the old -10 path ──────────────────────────────

def test_volume_profile_not_ict_penalised():
    """volume_profile is in CUSTOM_PINE_INDICATORS (custom-approximation path), not
    ICT_NO_PINE_INDICATORS. It receives the -10 custom-approximation deduction (score 90),
    not the -30 ICT deduction. Key assertion: score is strictly better than any ICT
    indicator (90 vs 70 for one ICT) and exportable=True."""
    result = score_exportability(_strategy(["volume_profile"]))
    # Custom-approximation deduction: 100 - 10 = 90
    assert result.score == pytest.approx(90.0)
    assert result.exportable is True
    # Must not have the ICT-specific "no Pine equivalent" deduction
    assert not any("no Pine equivalent" in d for d in result.deductions)
    # Must have the custom-approximation deduction
    assert any("custom Pine implementation" in d for d in result.deductions)


# ─── Exportable=False stays False under clamping ─────────────────────────────

def test_four_ict_indicators_clamped_to_zero():
    """100 - 120 = -20, clamped to 0. exportable=False, do_not_export."""
    result = score_exportability(
        _strategy(["fvg", "order_block", "breaker_block", "liquidity_sweep"])
    )
    assert result.score == pytest.approx(0.0)
    assert result.exportable is False
    assert result.band == "do_not_export"
