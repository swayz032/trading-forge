"""SOURCE-RISK-HANDOFF-1 / UNIT B + UNIT C — source-exact FVG stop, no unstated buffer.

Authority: AR-1059 (gpt-rulings 8e9ea5bc) §4 UNIT B/C and §5 RED->GREEN 3,4,5,6,7.

THE DEFECT THESE TESTS CONVICT
------------------------------
`compute_structural_stop()` already implements a direction-relative FVG anchor and
emits ``stop_reason="fvg"`` (AR-1058). But it ALWAYS adds Trading Forge's framework
structural buffer beyond the supplied extreme::

    long:  stop = nearest_fvg_below - buffer      # MES buffer = 3 ticks = 0.75pt
    short: stop = nearest_fvg_above + buffer

The sVkm teacher taught::

    "put it at the bottom of the fair value candle"
    "If this candle had a big wick, then you would also include the wick."

He did NOT teach "...and then add another 0.75 points". So inside SOURCE_FAITHFUL::

    FVG wick extreme -> framework buffer -> stop      is NOT the taught strategy
    FVG wick extreme -> stop                          is

`test_legacy_buffer_is_the_defect` fails on VALUE against the CURRENT signature —
it is the positive witness that the defect is real and not merely a missing kwarg.
Every other test fails on the absent `source_exact` / `required_anchor` parameters.

WHAT MUST NOT CHANGE: default calls (no new kwargs) keep their buffered behaviour
exactly. AR-1059 §4 UNIT B: "Legacy/default behavior MUST remain unchanged."
"""
from __future__ import annotations

import pytest

from src.engine.context.structural_stops import (
    SourceAnchorUnresolved,
    compute_structural_stop,
)

# MES: tick 0.25, buffer 3 ticks = 0.75pt
MES = dict(point_value=5.0, atr=4.0, tick_size=0.25, symbol="MES")

BODY_LOW = 6001.00
WICK_LOW = 6000.00
ENTRY = 6010.00

BODY_HIGH = 5999.00
WICK_HIGH = 6000.00
ENTRY_SHORT = 5990.00


# ── The positive witness: the defect is real at the CURRENT signature ──────────


def test_legacy_buffer_is_the_defect():
    """CURRENT API + taught wick extreme -> stop is 0.75 BELOW the taught price.

    This is the semantic substitution AR-1059 §1 names. It fails today on value,
    which proves the defect exists independently of any new parameter.
    """
    plan = compute_structural_stop(
        direction="long", entry_price=ENTRY, nearest_fvg_below=WICK_LOW, **MES
    )
    assert plan.stop_reason == "fvg"
    # The framework silently moved the teacher's stop.
    assert plan.stop_price == pytest.approx(WICK_LOW - 0.75)
    # ...and THAT is what SOURCE_FAITHFUL may not do:
    assert plan.stop_price != pytest.approx(WICK_LOW)


# ── RED/GREEN 3 — wick ────────────────────────────────────────────────────────


def test_rg3_source_exact_uses_taught_wick_extreme_exactly():
    """include_wick -> 6000.00. NOT the body 6001.00. NOT 5999.25 from MES buffer."""
    plan = compute_structural_stop(
        direction="long",
        entry_price=ENTRY,
        nearest_fvg_below=WICK_LOW,
        required_anchor="fvg",
        source_exact=True,
        **MES,
    )
    assert plan.stop_price == pytest.approx(WICK_LOW), "must be the exact taught extreme"
    assert plan.stop_price != pytest.approx(BODY_LOW), "must not be the body extreme"
    assert plan.stop_price != pytest.approx(WICK_LOW - 0.75), "must not carry MES buffer"
    assert plan.stop_reason == "fvg"
    assert plan.buffer == pytest.approx(0.0)
    assert plan.sweep_aware_buffer is False


def test_rg3_body_extreme_is_carried_verbatim_when_that_is_what_is_supplied():
    """Wick-vs-body is the CALLER's choice of float; the resolver carries it exactly."""
    plan = compute_structural_stop(
        direction="long",
        entry_price=ENTRY,
        nearest_fvg_below=BODY_LOW,
        required_anchor="fvg",
        source_exact=True,
        **MES,
    )
    assert plan.stop_price == pytest.approx(BODY_LOW)


# ── RED/GREEN 4 — buffer isolation (legacy must not regress) ──────────────────


def test_rg4_legacy_default_call_keeps_its_buffer():
    """No new kwargs -> byte-identical legacy behaviour. TF_OVERLAY_VARIANT relies on this."""
    plan = compute_structural_stop(
        direction="long", entry_price=ENTRY, nearest_fvg_below=WICK_LOW, **MES
    )
    assert plan.stop_price == pytest.approx(WICK_LOW - 0.75)
    assert plan.buffer == pytest.approx(0.75)
    assert plan.sweep_aware_buffer is True


def test_rg4_source_exact_false_is_explicitly_legacy():
    """Passing source_exact=False explicitly is the same as not passing it."""
    explicit = compute_structural_stop(
        direction="long",
        entry_price=ENTRY,
        nearest_fvg_below=WICK_LOW,
        source_exact=False,
        **MES,
    )
    implicit = compute_structural_stop(
        direction="long", entry_price=ENTRY, nearest_fvg_below=WICK_LOW, **MES
    )
    assert explicit.stop_price == pytest.approx(implicit.stop_price)
    assert explicit.buffer == pytest.approx(implicit.buffer)


def test_rg4_legacy_sweep_wick_priority_is_untouched():
    """A closer sweep wick still wins a LEGACY call — we did not weaken the TF system."""
    plan = compute_structural_stop(
        direction="long",
        entry_price=ENTRY,
        nearest_fvg_below=WICK_LOW,
        sweep_wick_low=6005.00,  # closer to entry than the FVG
        **MES,
    )
    assert plan.stop_reason == "sweep_wick"


# ── RED/GREEN 5 — stop mutation ───────────────────────────────────────────────


@pytest.mark.parametrize("taught_extreme", [6000.00, 5997.25, 6002.50])
def test_rg5_moving_the_taught_extreme_moves_the_stop_deterministically(taught_extreme):
    plan = compute_structural_stop(
        direction="long",
        entry_price=ENTRY,
        nearest_fvg_below=taught_extreme,
        required_anchor="fvg",
        source_exact=True,
        **MES,
    )
    assert plan.stop_price == pytest.approx(taught_extreme)


# ── RED/GREEN 6 — direction ───────────────────────────────────────────────────


def test_rg6_long_uses_the_lower_extreme():
    plan = compute_structural_stop(
        direction="long",
        entry_price=ENTRY,
        nearest_fvg_below=WICK_LOW,
        nearest_fvg_above=6020.00,
        required_anchor="fvg",
        source_exact=True,
        **MES,
    )
    assert plan.stop_price == pytest.approx(WICK_LOW)
    assert plan.stop_price < ENTRY


def test_rg6_short_uses_the_upper_extreme():
    plan = compute_structural_stop(
        direction="short",
        entry_price=ENTRY_SHORT,
        nearest_fvg_above=WICK_HIGH,
        nearest_fvg_below=5980.00,
        required_anchor="fvg",
        source_exact=True,
        **MES,
    )
    assert plan.stop_price == pytest.approx(WICK_HIGH)
    assert plan.stop_price > ENTRY_SHORT
    assert plan.stop_reason == "fvg"


# ── RED/GREEN 7 — required anchor disappears -> REFUSE, never ATR ─────────────


def test_rg7_missing_required_fvg_refuses_and_does_not_fall_back_to_atr():
    with pytest.raises(SourceAnchorUnresolved):
        compute_structural_stop(
            direction="long",
            entry_price=ENTRY,
            nearest_fvg_below=None,
            required_anchor="fvg",
            source_exact=True,
            **MES,
        )


def test_rg7_wrong_side_fvg_refuses():
    """An FVG at/above entry cannot own a LONG stop — refuse rather than silently drop it."""
    with pytest.raises(SourceAnchorUnresolved):
        compute_structural_stop(
            direction="long",
            entry_price=ENTRY,
            nearest_fvg_below=ENTRY + 5.0,
            required_anchor="fvg",
            source_exact=True,
            **MES,
        )


def test_rg7_refusal_message_names_the_anchor_and_direction():
    """A refusal a human cannot diagnose is a silent failure with extra steps."""
    with pytest.raises(SourceAnchorUnresolved) as ei:
        compute_structural_stop(
            direction="long",
            entry_price=ENTRY,
            nearest_fvg_below=None,
            required_anchor="fvg",
            source_exact=True,
            **MES,
        )
    msg = str(ei.value)
    assert "fvg" in msg.lower()
    assert "long" in msg.lower()


# ── UNIT C — anchor enforcement: no hijack by nearer structure ────────────────


def test_unit_c_closer_sweep_wick_cannot_hijack_a_commanded_fvg_stop():
    """The teacher commanded the FVG. A nearer sweep wick must NOT win."""
    plan = compute_structural_stop(
        direction="long",
        entry_price=ENTRY,
        nearest_fvg_below=WICK_LOW,
        sweep_wick_low=6005.00,  # closer to entry — would win under legacy priority
        nearest_ob_below=6004.00,
        nearest_swing_low=6003.00,
        required_anchor="fvg",
        source_exact=True,
        **MES,
    )
    assert plan.stop_reason == "fvg"
    assert plan.stop_price == pytest.approx(WICK_LOW)


def test_unit_c_commanded_fvg_survives_even_when_it_is_the_only_structure():
    plan = compute_structural_stop(
        direction="short",
        entry_price=ENTRY_SHORT,
        nearest_fvg_above=WICK_HIGH,
        sweep_wick_high=5992.00,
        required_anchor="fvg",
        source_exact=True,
        **MES,
    )
    assert plan.stop_reason == "fvg"
    assert plan.stop_price == pytest.approx(WICK_HIGH)
