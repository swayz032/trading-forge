"""SOURCE-RISK-HANDOFF-1 / UNIT D — whole-position fixed-R source target.

Authority: AR-1059 (gpt-rulings 8e9ea5bc) §4 UNIT D, §5 RED->GREEN 8 and 9.

THE DEFECT THESE TESTS CONVICT
------------------------------
The sVkm teacher taught ONE fixed target: close the whole position at 2R.

Trading Forge's existing `compute_structural_targets()` implements the DOL /
Style-C ladder instead — `structural_targets.py:115-118` defaults
``tp1 = 1.0R ("1R_default")`` and ``tp2 = 2.5R ("2.5R_default")`` with
``partial_sizes=(0.33, 0.33, 0.34)`` (`:28`, `:151`).

Reusing that ladder for the teacher's single 2R would express::

    33% out at 1R + 33% out at 2.5R + a runner

which is a DIFFERENT STRATEGY WITH THE SAME NUMBER IN IT. AR-1057 §3 named this
the reuse trap; AR-1059 §4 UNIT D forbids the reinterpretation outright.

★ A FIELD WITH THE RIGHT NAME AND THE WRONG ARITY IS NOT A REUSABLE CONTRACT.
"""
from __future__ import annotations

import pytest

from src.engine.context.structural_targets import compute_source_fixed_r_target

ENTRY_LONG = 6010.00
STOP_LONG = 6000.00  # exact taught FVG wick extreme -> risk = 10.00

ENTRY_SHORT = 5990.00
STOP_SHORT = 6000.00  # risk = 10.00


# ── RED/GREEN 8 — exact fixed R, and it moves when R moves ───────────────────


def test_rg8_long_two_r_is_exact():
    t = compute_source_fixed_r_target(
        direction="long", entry_price=ENTRY_LONG, stop_price=STOP_LONG, r_multiple=2.0
    )
    # risk = 10.00 -> target = 6010 + 20 = 6030
    assert t.target_price == pytest.approx(6030.00)
    assert t.r_multiple == pytest.approx(2.0)


def test_rg8_short_two_r_is_exact():
    t = compute_source_fixed_r_target(
        direction="short", entry_price=ENTRY_SHORT, stop_price=STOP_SHORT, r_multiple=2.0
    )
    # risk = 10.00 -> target = 5990 - 20 = 5970
    assert t.target_price == pytest.approx(5970.00)


@pytest.mark.parametrize(
    "r,expected", [(1.0, 6020.00), (2.0, 6030.00), (3.0, 6040.00), (2.5, 6035.00)]
)
def test_rg8_mutating_r_changes_the_target_deterministically(r, expected):
    t = compute_source_fixed_r_target(
        direction="long", entry_price=ENTRY_LONG, stop_price=STOP_LONG, r_multiple=r
    )
    assert t.target_price == pytest.approx(expected)


def test_rg8_target_tracks_the_stop_so_a_source_exact_stop_drives_it():
    """The teacher's 2R is measured off HIS stop. Move the stop, the target moves."""
    near = compute_source_fixed_r_target(
        direction="long", entry_price=ENTRY_LONG, stop_price=6005.00, r_multiple=2.0
    )
    far = compute_source_fixed_r_target(
        direction="long", entry_price=ENTRY_LONG, stop_price=6000.00, r_multiple=2.0
    )
    assert near.target_price == pytest.approx(6020.00)  # risk 5  -> +10
    assert far.target_price == pytest.approx(6030.00)   # risk 10 -> +20


# ── RED/GREEN 9 — whole position, no thirds ──────────────────────────────────


def test_rg9_is_whole_position_and_exposes_no_ladder():
    t = compute_source_fixed_r_target(
        direction="long", entry_price=ENTRY_LONG, stop_price=STOP_LONG, r_multiple=2.0
    )
    assert t.position_fraction == pytest.approx(1.0), "the teacher closes the WHOLE position"
    # The Style-C ladder must not leak in through any alias.
    for forbidden in ("tp1", "tp2", "tp3", "partial_sizes", "runner", "partial_at_r"):
        assert not hasattr(t, forbidden), f"Style-C ladder field {forbidden!r} leaked into the source target"


def test_rg9_no_1r_or_2p5r_default_appears():
    """1R / 2.5R are the FRAMEWORK's defaults. A 2R source target must equal neither."""
    t = compute_source_fixed_r_target(
        direction="long", entry_price=ENTRY_LONG, stop_price=STOP_LONG, r_multiple=2.0
    )
    assert t.target_price != pytest.approx(6020.00), "that is the framework 1R default"
    assert t.target_price != pytest.approx(6035.00), "that is the framework 2.5R default"


def test_rg9_reason_names_the_source_not_the_framework():
    t = compute_source_fixed_r_target(
        direction="long", entry_price=ENTRY_LONG, stop_price=STOP_LONG, r_multiple=2.0
    )
    assert "source" in t.target_reason.lower()
    assert "default" not in t.target_reason.lower(), "a source target is not a framework default"


# ── Refusal surface — a target with no honest risk basis is not a target ─────


def test_zero_risk_refuses_rather_than_returning_entry():
    """stop == entry means risk 0; a 2R target would collapse onto entry. Refuse."""
    with pytest.raises(ValueError):
        compute_source_fixed_r_target(
            direction="long", entry_price=ENTRY_LONG, stop_price=ENTRY_LONG, r_multiple=2.0
        )


def test_non_positive_r_refuses():
    with pytest.raises(ValueError):
        compute_source_fixed_r_target(
            direction="long", entry_price=ENTRY_LONG, stop_price=STOP_LONG, r_multiple=0.0
        )


def test_wrong_side_stop_refuses_for_long():
    """A LONG stop above entry is incoherent — refuse rather than invert the target."""
    with pytest.raises(ValueError):
        compute_source_fixed_r_target(
            direction="long", entry_price=ENTRY_LONG, stop_price=ENTRY_LONG + 5.0, r_multiple=2.0
        )
