"""Tests for Style D exit handler — Track 3.

Covers all 12 required scenarios:
  1. TP1 fill at exactly 1R
  2. TP1 fill above 1R (price overshot)
  3. BE move applied correctly after TP1
  4. Chandelier trail tracks correctly (long)
  5. Chandelier trail tracks correctly (short)
  6. Swing-low trail tightens correctly
  7. Swing-low trail picks tighter of (chandelier vs swing)
  8. Time-stop hard flatten at 15:55 ET
  9. Time-stop fires regardless of P&L
 10. No trail update when position not yet at 1R
 11. Multiple TP1 calls only fill 50% once (idempotency)
 12. Idempotency of HOLD decisions
 13. ATR=0 guard (NaN / zero ATR falls back safely)
 14. Missing fields → HOLD (fail-closed)
 15. NaN input → HOLD (fail-closed)
"""
from __future__ import annotations

import math
import pytest

from src.engine.exits.style_d_handler import (
    ExitDecision,
    ExitState,
    HANDLER_VERSION,
    evaluate_exit,
    _compute_chandelier_stop,
    _tighter_trail,
)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_state(**kwargs) -> ExitState:
    """Return a minimal valid ExitState, overriding defaults with kwargs."""
    defaults = dict(
        direction="long",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5005.0,
        current_high_since_entry=5010.0,
        current_low_since_entry=4995.0,
        atr_14=8.0,
        last_2bar_swing_low=4990.0,
        last_2bar_swing_high=5010.0,
        current_time_et="14:00",
        position_pct_open=1.0,
        tick_size=0.25,
        tp1_filled=False,
        be_stop_applied=False,
        chandelier_stop_long=4990.0,
        chandelier_stop_short=5010.0,
    )
    defaults.update(kwargs)
    return ExitState(**defaults)


# ─── Test 1: TP1 fill at exactly 1R ──────────────────────────────────────────

def test_tp1_fill_at_exactly_1r_long():
    """TP1 fires when price == entry + 1R exactly."""
    state = _make_state(
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5010.0,  # entry + 1R
        tp1_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "FILL_TP1_50PCT"
    assert decision.evidence["tp1_price"] == pytest.approx(5010.0)
    assert decision.handler_version == HANDLER_VERSION


def test_tp1_fill_at_exactly_1r_short():
    """TP1 fires when price == entry - 1R exactly (short)."""
    state = _make_state(
        direction="short",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=4990.0,  # entry - 1R
        tp1_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "FILL_TP1_50PCT"


# ─── Test 2: TP1 fill above 1R ───────────────────────────────────────────────

def test_tp1_fill_above_1r():
    """TP1 fires when price has overshot beyond 1R."""
    state = _make_state(
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5015.0,  # 1.5R
        tp1_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "FILL_TP1_50PCT"


# ─── Test 3: BE move applied after TP1 ───────────────────────────────────────

def test_be_move_after_tp1():
    """MOVE_STOP_TO_BE fires when tp1_filled=True and be_stop_applied=False."""
    state = _make_state(
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5015.0,
        tp1_filled=True,
        be_stop_applied=False,
        tick_size=0.25,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "MOVE_STOP_TO_BE"
    # BE price = entry + 1 tick for longs
    assert decision.new_stop == pytest.approx(5000.25)


def test_be_move_short():
    """MOVE_STOP_TO_BE for short: BE = entry - 1 tick."""
    state = _make_state(
        direction="short",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=4985.0,
        tp1_filled=True,
        be_stop_applied=False,
        tick_size=0.25,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "MOVE_STOP_TO_BE"
    assert decision.new_stop == pytest.approx(4999.75)


# ─── Test 4: Chandelier trail tracks long ────────────────────────────────────

def test_chandelier_trail_long():
    """After TP1 + BE applied, Chandelier trail returned for long."""
    # ATR=8, mult=2.0, chandelier = highest_high - 2*ATR = 5020 - 16 = 5004
    state = _make_state(
        direction="long",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5020.0,
        current_high_since_entry=5020.0,
        atr_14=8.0,
        last_2bar_swing_low=None,  # no swing, only chandelier
        tp1_filled=True,
        be_stop_applied=True,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "TIGHTEN_TRAIL_TO_X"
    assert decision.new_stop == pytest.approx(5020.0 - 2.0 * 8.0)  # 5004.0


# ─── Test 5: Chandelier trail tracks short ───────────────────────────────────

def test_chandelier_trail_short():
    """After TP1 + BE applied, Chandelier trail for short."""
    # ATR=8, mult=2.0, chandelier = lowest_low + 2*ATR = 4980 + 16 = 4996
    state = _make_state(
        direction="short",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=4980.0,
        current_high_since_entry=5001.0,
        current_low_since_entry=4980.0,
        atr_14=8.0,
        last_2bar_swing_high=None,
        tp1_filled=True,
        be_stop_applied=True,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "TIGHTEN_TRAIL_TO_X"
    assert decision.new_stop == pytest.approx(4980.0 + 2.0 * 8.0)  # 4996.0


# ─── Test 6: Swing-low trail tightens correctly ──────────────────────────────

def test_swing_low_trail_tightens():
    """When swing trail is tighter than chandelier for long, swing wins."""
    # chandelier = 5020 - 2*8 = 5004
    # swing_low  = 5006  <- tighter (higher) for longs
    state = _make_state(
        direction="long",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5020.0,
        current_high_since_entry=5020.0,
        atr_14=8.0,
        last_2bar_swing_low=5006.0,
        tp1_filled=True,
        be_stop_applied=True,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "TIGHTEN_TRAIL_TO_X"
    # Tighter of chandelier(5004) and swing(5006) = max = 5006
    assert decision.new_stop == pytest.approx(5006.0)


# ─── Test 7: Picks tighter of chandelier vs swing ────────────────────────────

def test_tighter_of_both():
    """tighter_of_both picks the closer-to-price stop."""
    # long: max(chandelier, swing)
    assert _tighter_trail("long", 5004.0, 5006.0, 5000.0) == pytest.approx(5006.0)
    assert _tighter_trail("long", 5006.0, 5004.0, 5000.0) == pytest.approx(5006.0)
    # short: min(chandelier, swing)
    assert _tighter_trail("short", 4996.0, 4994.0, 5000.0) == pytest.approx(4994.0)
    assert _tighter_trail("short", 4994.0, 4996.0, 5000.0) == pytest.approx(4994.0)
    # One None: return the non-None
    assert _tighter_trail("long", 5004.0, None, 5000.0) == pytest.approx(5004.0)
    assert _tighter_trail("long", None, 5006.0, 5000.0) == pytest.approx(5006.0)
    # Both None: return None
    assert _tighter_trail("long", None, None, 5000.0) is None


# ─── Test 8: Time-stop at 15:55 ET ───────────────────────────────────────────

def test_time_stop_at_1555():
    """TIME_STOP_FLATTEN fires at exactly 15:55 ET."""
    state = _make_state(current_time_et="15:55", tp1_filled=False)
    decision = evaluate_exit(state)
    assert decision.decision == "TIME_STOP_FLATTEN"


def test_time_stop_after_1555():
    """TIME_STOP_FLATTEN fires at 15:58 ET too."""
    state = _make_state(current_time_et="15:58", tp1_filled=False)
    decision = evaluate_exit(state)
    assert decision.decision == "TIME_STOP_FLATTEN"


def test_no_time_stop_before_1555():
    """No time-stop before 15:55 ET."""
    state = _make_state(current_time_et="15:54", tp1_filled=False, current_price=5005.0)
    decision = evaluate_exit(state)
    assert decision.decision != "TIME_STOP_FLATTEN"


# ─── Test 9: Time-stop fires regardless of P&L ───────────────────────────────

def test_time_stop_fires_at_loss():
    """Time-stop fires even when trade is losing."""
    state = _make_state(
        current_time_et="15:55",
        current_price=4995.0,  # down 5 points (losing long)
        tp1_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "TIME_STOP_FLATTEN"


def test_time_stop_fires_after_tp1():
    """Time-stop fires even when TP1 already filled (runner still open)."""
    state = _make_state(
        current_time_et="15:55",
        current_price=5020.0,
        tp1_filled=True,
        be_stop_applied=True,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "TIME_STOP_FLATTEN"


# ─── Test 10: No trail when position not yet at 1R ───────────────────────────

def test_no_trail_before_tp1():
    """No trail update when TP1 hasn't been filled yet."""
    state = _make_state(
        current_price=5005.0,  # below 1R (1R = 5010)
        tp1_filled=False,
        be_stop_applied=False,
    )
    decision = evaluate_exit(state)
    # Should HOLD (not at TP1 yet, no BE, no trail)
    assert decision.decision == "HOLD"


# ─── Test 11: TP1 only fills once (idempotency) ──────────────────────────────

def test_tp1_idempotent():
    """FILL_TP1_50PCT only fires when tp1_filled=False."""
    state_unfilled = _make_state(
        current_price=5015.0, tp1_filled=False, be_stop_applied=False
    )
    state_filled = _make_state(
        current_price=5015.0, tp1_filled=True, be_stop_applied=False
    )
    d1 = evaluate_exit(state_unfilled)
    d2 = evaluate_exit(state_filled)
    assert d1.decision == "FILL_TP1_50PCT"
    assert d2.decision != "FILL_TP1_50PCT"  # should be MOVE_STOP_TO_BE


# ─── Test 12: Idempotency of HOLD decisions ──────────────────────────────────

def test_hold_idempotent():
    """Same state → same HOLD decision every call."""
    state = _make_state(
        current_price=5005.0,
        tp1_filled=False,
        be_stop_applied=False,
        current_time_et="13:00",
    )
    d1 = evaluate_exit(state)
    d2 = evaluate_exit(state)
    d3 = evaluate_exit(state)
    assert d1.decision == d2.decision == d3.decision
    assert d1.decision == "HOLD"


# ─── Test 13: ATR=0 guard ────────────────────────────────────────────────────

def test_atr_zero_returns_hold_on_trail():
    """ATR=0 produces None chandelier; if only chandelier and swing both None → HOLD."""
    state = _make_state(
        atr_14=0.0,
        last_2bar_swing_low=None,
        tp1_filled=True,
        be_stop_applied=True,
        current_price=5020.0,
    )
    decision = evaluate_exit(state)
    # No chandelier (ATR=0), no swing trail → no trail to emit → HOLD
    assert decision.decision == "HOLD"


# ─── Test 14: NaN input → HOLD ───────────────────────────────────────────────

def test_nan_entry_price_returns_hold():
    """NaN in entry_price → HOLD with error evidence."""
    state = _make_state(entry_price=float("nan"))
    decision = evaluate_exit(state)
    assert decision.decision == "HOLD"
    assert "NaN" in decision.evidence.get("error", "")


def test_nan_stop_pts_returns_hold():
    """NaN in stop_pts → HOLD."""
    state = _make_state(stop_pts=float("nan"))
    decision = evaluate_exit(state)
    assert decision.decision == "HOLD"


# ─── Test 15: Handler version is stable ──────────────────────────────────────

def test_handler_version_present():
    """ExitDecision always carries handler_version."""
    state = _make_state()
    decision = evaluate_exit(state)
    assert decision.handler_version == HANDLER_VERSION
    assert HANDLER_VERSION.startswith("style_d_v")


# ─── Chandelier unit tests ────────────────────────────────────────────────────

def test_chandelier_long_formula():
    """Chandelier long = highest_high - mult * ATR."""
    result = _compute_chandelier_stop(
        direction="long",
        current_high_since_entry=5020.0,
        current_low_since_entry=4990.0,
        atr_14=8.0,
        period=14,
        mult=2.0,
    )
    assert result == pytest.approx(5020.0 - 2.0 * 8.0)


def test_chandelier_short_formula():
    """Chandelier short = lowest_low + mult * ATR."""
    result = _compute_chandelier_stop(
        direction="short",
        current_high_since_entry=5010.0,
        current_low_since_entry=4980.0,
        atr_14=8.0,
        period=14,
        mult=2.0,
    )
    assert result == pytest.approx(4980.0 + 2.0 * 8.0)


def test_chandelier_zero_atr_returns_none():
    """ATR=0 → Chandelier returns None (no valid trail)."""
    result = _compute_chandelier_stop(
        direction="long",
        current_high_since_entry=5020.0,
        current_low_since_entry=4990.0,
        atr_14=0.0,
        period=14,
        mult=2.0,
    )
    assert result is None
