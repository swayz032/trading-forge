"""Tests for Style C exit handler — Track 3.

Covers all 12 required scenarios:
  1. TP1 fill at exactly 1R (33% fraction)
  2. TP2 fill at exactly 2R (33% fraction)
  3. Runner remains open after TP1+TP2
  4. POC trail tightens as POC migrates
  5. Runner exits when POC trail is breached
  6. Regime trigger conditions checked correctly (via select_exit_style)
  7. Deterministic outputs given identical inputs
  8. Time-stop hard flatten at 15:55 ET
  9. Time-stop fires regardless of P&L
 10. tp1 idempotency — TP1 only fires once
 11. tp2 idempotency — TP2 only fires after tp1 and only once
 12. NaN inputs → HOLD (fail-closed)
 13. No POC trail before both TP1 and TP2 filled
 14. Style C HANDLER_VERSION stability
"""
from __future__ import annotations

import pytest

from src.engine.context.structural_targets import select_exit_style
from src.engine.exits.style_c_handler import (
    HANDLER_VERSION,
    TP1_FRACTION_C,
    TP2_FRACTION_C,
    StyleCState,
    evaluate_exit,
)

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_state(**kwargs) -> StyleCState:
    defaults = dict(
        direction="long",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5005.0,
        current_time_et="14:00",
        position_pct_open=1.0,
        tick_size=0.25,
        tp1_filled=False,
        tp2_filled=False,
        developing_session_poc=None,
        playbook="TREND_CONTINUATION",
        vp_shape="Thin",
        macro_state="growth",
    )
    defaults.update(kwargs)
    return StyleCState(**defaults)


# ─── Test 1: TP1 at exactly 1R ───────────────────────────────────────────────

def test_tp1_fill_at_1r_long():
    """Style C TP1 fires at +1.0R for long."""
    state = _make_state(
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5010.0,  # +1R
        tp1_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "FILL_TP1_50PCT"
    assert decision.evidence["tp1_fraction"] == TP1_FRACTION_C


def test_tp1_fill_at_1r_short():
    """Style C TP1 fires at -1.0R for short."""
    state = _make_state(
        direction="short",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=4990.0,  # -1R
        tp1_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "FILL_TP1_50PCT"


# ─── Test 2: TP2 at exactly 2R ───────────────────────────────────────────────

def test_tp2_fill_at_2r_long():
    """Style C TP2 fires at +2.0R for long after TP1 filled."""
    state = _make_state(
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5020.0,  # +2R
        tp1_filled=True,
        tp2_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "FILL_TP2"
    assert decision.evidence["tp2_fraction"] == TP2_FRACTION_C


def test_tp2_fill_at_2r_short():
    """Style C TP2 fires at -2.0R for short after TP1 filled."""
    state = _make_state(
        direction="short",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=4980.0,  # -2R
        tp1_filled=True,
        tp2_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "FILL_TP2"


# ─── Test 3: Runner stays open after TP1+TP2 with no POC breach ──────────────

def test_runner_stays_open_without_poc_breach():
    """When TP1 + TP2 filled and POC not breached, trail updates but no flatten."""
    state = _make_state(
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5025.0,
        tp1_filled=True,
        tp2_filled=True,
        developing_session_poc=5010.0,  # POC below price (not breached for long)
    )
    decision = evaluate_exit(state)
    # Should emit a trail update (POC), not TIME_STOP or FILL
    assert decision.decision == "TIGHTEN_TRAIL_TO_X"
    assert decision.new_stop == pytest.approx(5010.0)


# ─── Test 4: POC trail tightens as POC migrates ──────────────────────────────

def test_poc_trail_updates_as_poc_migrates():
    """Each call with a higher POC returns updated trail."""
    base = dict(
        entry_price=5000.0, stop_pts=10.0, tp1_filled=True, tp2_filled=True
    )

    state1 = _make_state(current_price=5030.0, developing_session_poc=5010.0, **base)
    d1 = evaluate_exit(state1)

    state2 = _make_state(current_price=5035.0, developing_session_poc=5015.0, **base)
    d2 = evaluate_exit(state2)

    assert d1.new_stop == pytest.approx(5010.0)
    assert d2.new_stop == pytest.approx(5015.0)
    assert d2.new_stop > d1.new_stop  # POC migrated up


# ─── Test 5: Runner exits when POC trail breached ────────────────────────────

def test_runner_poc_breach_long():
    """Long runner: current_price <= POC means breach → TIGHTEN_TRAIL (at POC)."""
    state = _make_state(
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5009.0,  # price dropped back to POC
        tp1_filled=True,
        tp2_filled=True,
        developing_session_poc=5010.0,  # POC above current price
    )
    decision = evaluate_exit(state)
    assert decision.decision == "TIGHTEN_TRAIL_TO_X"
    assert decision.evidence["trigger"] == "poc_trail_breached"
    assert decision.new_stop == pytest.approx(5010.0)


def test_runner_poc_breach_short():
    """Short runner: current_price >= POC means breach."""
    state = _make_state(
        direction="short",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=4991.0,  # price rallied back to POC
        tp1_filled=True,
        tp2_filled=True,
        developing_session_poc=4990.0,  # POC below current (breached for short)
    )
    decision = evaluate_exit(state)
    assert decision.decision == "TIGHTEN_TRAIL_TO_X"
    assert decision.evidence["trigger"] == "poc_trail_breached"


# ─── Test 6: Regime trigger conditions ───────────────────────────────────────

def test_select_exit_style_returns_style_c_when_conditions_met():
    """select_exit_style returns 'style_c' only when all 3 conditions are met."""
    assert select_exit_style("TREND_CONTINUATION", "Thin", "growth") == "style_c"
    assert select_exit_style("TREND_CONTINUATION", "D", "easing") == "style_c"
    assert select_exit_style("TREND_CONTINUATION", "b", None) == "style_c"
    assert select_exit_style("TREND_CONTINUATION", "P", "inflation") == "style_c"


def test_select_exit_style_returns_style_c_on_crisis():
    """Wave 24: style_c is returned even in crisis (tighter Chandelier handled by handler)."""
    assert select_exit_style("TREND_CONTINUATION", "Thin", "crisis") == "style_c"


def test_select_exit_style_returns_style_c_any_playbook():
    """Wave 24: Style D dead — all playbooks return style_c."""
    assert select_exit_style("MEAN_REVERSION", "Thin", "growth") == "style_c"
    assert select_exit_style(None, "Thin", "growth") == "style_c"


def test_select_exit_style_returns_style_c_any_vp():
    """Wave 24: Style D dead — all VP shapes return style_c."""
    assert select_exit_style("TREND_CONTINUATION", "UNKNOWN", "growth") == "style_c"
    assert select_exit_style("TREND_CONTINUATION", None, "growth") == "style_c"


def test_select_exit_style_default_no_context():
    """Wave 24: No regime context → style_c (Style D is DEAD, W23F.N)."""
    assert select_exit_style() == "style_c"


# ─── Test 7: Determinism ─────────────────────────────────────────────────────

def test_deterministic_outputs():
    """Same state → same decision every call."""
    state = _make_state(
        current_price=5010.0,
        tp1_filled=False,
    )
    results = [evaluate_exit(state) for _ in range(5)]
    assert all(r.decision == results[0].decision for r in results)
    assert all(r.new_stop == results[0].new_stop for r in results)


# ─── Test 8: Time-stop at 15:55 ET ───────────────────────────────────────────

def test_time_stop_fires_at_1555():
    """TIME_STOP_FLATTEN fires at 15:55 ET."""
    state = _make_state(current_time_et="15:55", tp1_filled=False)
    decision = evaluate_exit(state)
    assert decision.decision == "TIME_STOP_FLATTEN"


def test_time_stop_priority_over_tp1():
    """Time-stop has highest priority — even TP1 candidate defers."""
    state = _make_state(
        current_time_et="15:55",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5010.0,  # Would trigger TP1
        tp1_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "TIME_STOP_FLATTEN"


# ─── Test 9: Time-stop fires regardless of P&L ───────────────────────────────

def test_time_stop_fires_at_loss():
    """Time-stop fires for losing position."""
    state = _make_state(
        current_time_et="15:55",
        current_price=4995.0,  # losing long
        tp1_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "TIME_STOP_FLATTEN"


# ─── Test 10: TP1 idempotency ────────────────────────────────────────────────

def test_tp1_only_fires_once():
    """TP1 fill only returns when tp1_filled=False."""
    state_filled = _make_state(
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5012.0,
        tp1_filled=True,
        tp2_filled=False,
    )
    decision = evaluate_exit(state_filled)
    assert decision.decision != "FILL_TP1_50PCT"


# ─── Test 11: TP2 idempotency ────────────────────────────────────────────────

def test_tp2_fires_only_after_tp1():
    """TP2 only fires when tp1_filled=True."""
    state = _make_state(
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5020.0,  # +2R
        tp1_filled=False,
        tp2_filled=False,
    )
    decision = evaluate_exit(state)
    # tp1 not filled → TP1 should fire, not TP2
    assert decision.decision == "FILL_TP1_50PCT"


def test_tp2_fires_only_once():
    """TP2 only fires when tp2_filled=False."""
    state_both_filled = _make_state(
        current_price=5025.0,
        tp1_filled=True,
        tp2_filled=True,
        developing_session_poc=5010.0,
    )
    decision = evaluate_exit(state_both_filled)
    assert decision.decision != "FILL_TP2"


# ─── Test 12: NaN inputs → HOLD ──────────────────────────────────────────────

def test_nan_entry_price_returns_hold():
    """NaN entry_price → HOLD."""
    state = _make_state(entry_price=float("nan"))
    decision = evaluate_exit(state)
    assert decision.decision == "HOLD"
    assert "NaN" in decision.evidence.get("error", "")


def test_nan_stop_pts_returns_hold():
    """NaN stop_pts → HOLD."""
    state = _make_state(stop_pts=float("nan"))
    decision = evaluate_exit(state)
    assert decision.decision == "HOLD"


def test_zero_stop_pts_returns_hold():
    """stop_pts <= 0 → HOLD."""
    state = _make_state(stop_pts=0.0)
    decision = evaluate_exit(state)
    assert decision.decision == "HOLD"


# ─── Test 13: No POC trail before TP1 and TP2 ────────────────────────────────

def test_no_poc_trail_before_tp1():
    """POC trail not evaluated before TP1 is filled."""
    state = _make_state(
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5005.0,
        tp1_filled=False,
        tp2_filled=False,
        developing_session_poc=5002.0,
    )
    decision = evaluate_exit(state)
    # Should HOLD (price not at 1R, tp1 not filled)
    assert decision.decision == "HOLD"


def test_no_poc_trail_before_tp2():
    """POC trail not evaluated if TP1 filled but TP2 not yet filled."""
    state = _make_state(
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5025.0,  # past 2R
        tp1_filled=True,
        tp2_filled=False,
        developing_session_poc=5010.0,
    )
    decision = evaluate_exit(state)
    # Should fire TP2 (priority 3 over POC trail which is priority 4)
    assert decision.decision == "FILL_TP2"


# ─── Test 14: HANDLER_VERSION stability ──────────────────────────────────────

def test_handler_version_present():
    """ExitDecision always carries style_c handler_version."""
    state = _make_state()
    decision = evaluate_exit(state)
    assert decision.handler_version == HANDLER_VERSION
    assert HANDLER_VERSION.startswith("style_c_v")


# ─── Test 15: Style C NEVER emits MOVE_STOP_TO_BE (Defect 2 parity contract) ──

# Background: Only style_d_handler emits MOVE_STOP_TO_BE.  Style C uses the
# TS-side tp1BeStopMap mechanism (absolute_level stop config) for the BE+1tick
# guarantee.  A misleading comment in paper-execution-service.ts previously
# claimed Python made this decision — Defect 2 corrects that comment.
# These tests lock the contract so the Python handler cannot silently add
# MOVE_STOP_TO_BE in the future without a corresponding TS-side removal.

_ALL_STYLE_C_DECISIONS = {"FILL_TP1_50PCT", "FILL_TP2", "TIGHTEN_TRAIL_TO_X",
                           "TIME_STOP_FLATTEN", "HOLD"}


def _assert_no_move_stop_to_be(state: StyleCState) -> None:
    decision = evaluate_exit(state)
    assert decision.decision != "MOVE_STOP_TO_BE", (
        f"Style C must never emit MOVE_STOP_TO_BE (TS-side tp1BeStopMap handles this). "
        f"Got decision={decision.decision!r} for state={state!r}"
    )
    assert decision.decision in _ALL_STYLE_C_DECISIONS, (
        f"Unexpected Style C decision={decision.decision!r}"
    )


def test_no_move_stop_to_be_at_tp1_fill_long():
    """Long TP1 fills: FILL_TP1_50PCT emitted — NEVER MOVE_STOP_TO_BE."""
    state = _make_state(
        direction="long",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5010.0,   # exactly +1R
        tp1_filled=False,
        tp2_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "FILL_TP1_50PCT"
    _assert_no_move_stop_to_be(state)


def test_no_move_stop_to_be_at_tp1_fill_short():
    """Short TP1 fills: FILL_TP1_50PCT emitted — NEVER MOVE_STOP_TO_BE."""
    state = _make_state(
        direction="short",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=4990.0,   # exactly +1R short-side
        tp1_filled=False,
        tp2_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "FILL_TP1_50PCT"
    _assert_no_move_stop_to_be(state)


def test_no_move_stop_to_be_after_tp1_with_poc_trail():
    """After TP1 fill, POC trail updates TIGHTEN_TRAIL_TO_X — NEVER MOVE_STOP_TO_BE."""
    state = _make_state(
        direction="long",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5025.0,
        tp1_filled=True,
        tp2_filled=True,
        developing_session_poc=5015.0,
    )
    # Emit TIGHTEN_TRAIL_TO_X (POC update path) — must not be MOVE_STOP_TO_BE
    decision = evaluate_exit(state)
    assert decision.decision == "TIGHTEN_TRAIL_TO_X"
    _assert_no_move_stop_to_be(state)


def test_no_move_stop_to_be_during_hold():
    """Hold state: HOLD emitted — NEVER MOVE_STOP_TO_BE."""
    state = _make_state(
        direction="long",
        entry_price=5000.0,
        stop_pts=10.0,
        current_price=5002.0,   # below 1R
        tp1_filled=False,
        tp2_filled=False,
    )
    decision = evaluate_exit(state)
    assert decision.decision == "HOLD"
    _assert_no_move_stop_to_be(state)


def test_all_style_c_reachable_decisions_exclude_move_stop_to_be():
    """Exhaustive: every reachable Style C decision is not MOVE_STOP_TO_BE."""
    # Scenario set covers all 5 reachable paths:
    scenarios = [
        # HOLD — below TP1
        _make_state(current_price=5002.0),
        # FILL_TP1_50PCT — exactly at 1R
        _make_state(current_price=5010.0, tp1_filled=False),
        # FILL_TP2 — at 2R with TP1 already filled
        _make_state(current_price=5020.0, tp1_filled=True, tp2_filled=False),
        # TIME_STOP_FLATTEN
        _make_state(current_price=5002.0, current_time_et="15:55"),
        # TIGHTEN_TRAIL_TO_X — both filled, POC present
        _make_state(current_price=5025.0, tp1_filled=True, tp2_filled=True,
                    developing_session_poc=5015.0),
    ]
    for state in scenarios:
        _assert_no_move_stop_to_be(state)
