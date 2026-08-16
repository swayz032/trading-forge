"""AR-1206 LANE C — THE STOP SAFETY INVARIANT.

Ruling, verbatim:

    Add a direction-aware invariant test: a wick-inclusive stop may not become tighter
    than the body-only stop. Keep STOP-A exact candle/FVG identity unresolved and
    fail-closed.

WHY THIS IS THE RIGHT THING TO PIN WHILE GEOMETRY IS STILL OPEN. The visual micro-proof
(AR-1205 §5) left one question unresolved: which candle edge the taught stop sits on. But
whatever that edge turns out to be, the teacher's stated PURPOSE is not ambiguous — he
says to include the wick so the trade has "enough room to breathe". Room-to-breathe is a
monotonic claim: including the wick must move the stop AWAY from entry, never toward it.

So this invariant is safe to assert NOW, before the label question is settled, and it is
exactly the property that a mis-resolved `fvg_low` would violate: on a short, taking a
LOW-side anchor where the wick extends UP would tighten the stop — the opposite of the
teaching. This test would go red on that mistake.

It asserts a RELATION between two calls of the real production function. It does not
assert which anchor is correct, and it does not resolve STOP-A.
"""
from __future__ import annotations

import pytest

from src.engine.context.structural_stops import compute_structural_stop

COMMON = dict(point_value=2.0, atr=20.0, tick_size=0.25, symbol="MES")


def _risk(plan, entry: float) -> float:
    """Distance from entry to stop. Bigger = wider = more room to breathe."""
    return abs(entry - plan.stop_price)


# --------------------------------------------------------------------------- #
# The invariant, both directions
# --------------------------------------------------------------------------- #


def test_short_wick_inclusive_stop_is_never_tighter_than_body_only():
    """SHORT: the stop sits ABOVE entry, so the wick HIGH is further away than the
    body high. Including the wick must widen the stop, never tighten it."""
    entry = 5000.0
    body_high = 5010.0
    wick_high = 5015.0          # the same candle's wick extends higher

    body_only = compute_structural_stop(
        "short", entry, nearest_fvg_above=body_high, **COMMON)
    wick_incl = compute_structural_stop(
        "short", entry, nearest_fvg_above=wick_high, **COMMON)

    assert _risk(wick_incl, entry) >= _risk(body_only, entry), (
        f"wick-inclusive short stop is TIGHTER than body-only: "
        f"{_risk(wick_incl, entry)} < {_risk(body_only, entry)}"
    )


def test_long_wick_inclusive_stop_is_never_tighter_than_body_only():
    """LONG: the stop sits BELOW entry, so the wick LOW is further away."""
    entry = 5000.0
    body_low = 4990.0
    wick_low = 4985.0

    body_only = compute_structural_stop(
        "long", entry, nearest_fvg_below=body_low, **COMMON)
    wick_incl = compute_structural_stop(
        "long", entry, nearest_fvg_below=wick_low, **COMMON)

    assert _risk(wick_incl, entry) >= _risk(body_only, entry), (
        f"wick-inclusive long stop is TIGHTER than body-only: "
        f"{_risk(wick_incl, entry)} < {_risk(body_only, entry)}"
    )


@pytest.mark.parametrize("direction", ["long", "short"])
def test_the_invariant_can_actually_go_red(direction):
    """POSITIVE CONTROL — the invariant must be capable of failing.

    A monotonic assertion that can never be violated proves nothing. Here the
    WRONG-SIDE anchor is fed deliberately: the low-side extreme on a short (and the
    high-side on a long) — i.e. exactly the mis-resolution AR-1204 §6 warns about,
    where "bottom ... including the wick" is compiled as a low-side anchor on a short.

    The production function must NOT quietly accept it and return a tighter stop; it
    must either refuse the wrong-side anchor or place the stop no closer than the
    body-only case. If a future change makes it silently accept, this test reds.
    """
    entry = 5000.0
    if direction == "short":
        correct = compute_structural_stop(
            "short", entry, nearest_fvg_above=5010.0, **COMMON)
        # wrong side: a level BELOW entry offered to a short
        wrong = compute_structural_stop(
            "short", entry, nearest_fvg_above=None, nearest_fvg_below=4990.0, **COMMON)
    else:
        correct = compute_structural_stop(
            "long", entry, nearest_fvg_below=4990.0, **COMMON)
        wrong = compute_structural_stop(
            "long", entry, nearest_fvg_below=None, nearest_fvg_above=5010.0, **COMMON)

    # The wrong-side level must not have been used as the structural anchor.
    assert wrong.stop_reason != correct.stop_reason or _risk(wrong, entry) >= _risk(correct, entry), (
        f"a wrong-side anchor produced a tighter stop via {wrong.stop_reason!r}: "
        f"{_risk(wrong, entry)} < {_risk(correct, entry)}"
    )
    # And the stop must still be on the protective side of entry.
    if direction == "short":
        assert wrong.stop_price > entry, "short stop landed at/below entry"
    else:
        assert wrong.stop_price < entry, "long stop landed at/above entry"


def test_stop_is_always_on_the_protective_side():
    """The floor under everything: a stop that lands on the wrong side of entry is not
    a stop. Asserted for both directions on the wick-inclusive anchors."""
    entry = 5000.0
    short = compute_structural_stop("short", entry, nearest_fvg_above=5015.0, **COMMON)
    long_ = compute_structural_stop("long", entry, nearest_fvg_below=4985.0, **COMMON)
    assert short.stop_price > entry
    assert long_.stop_price < entry
