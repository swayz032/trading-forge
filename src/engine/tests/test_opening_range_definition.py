"""B1 STEP 3 — the typed opening-range representation enforces its three invariants.

AUTHORITY: R-730 §4 / R-731 §4 / `EXTERNAL-READ-2026-08-09-STEP3-RELEASED.md` +
`...-STEP3-DISCRIMINATION-TIGHTENED.md` PART 1.

Each invariant is tested by trying to VIOLATE it, because an invariant nobody
attacks is a comment. The three:

  1. no default duration
  2. no silent selection among the taught 5/15/30 alternatives
  3. width and midpoint are derived formulas, never supplied parameters

Plus the fail-closed contract. R-731 §4 defines what that must mean, and it
excludes the cheapest version: `A CRASH, A MISSING DICTIONARY ENTRY OR AN
ACCIDENTAL EXCEPTION IS NOT AN ACCEPTABLE REFUSAL.` The refusal here is a value
the code MEANS — a typed status on a state object every field of which is None.
"""

from __future__ import annotations

import dataclasses

import pytest

from src.engine.opening_range_definition import (
    CANONICAL_TYPE,
    INCOMPLETE_OPENING_WINDOW,
    OpeningRangeDefinition,
    OpeningRangeProvenance,
    OpeningRangeState,
    OpeningRangeVariant,
    OpeningRangeWindowStatus,
    refused_state,
)

# The three taught alternatives, quoted from the frozen extraction's `variants[]`.
TAUGHT_VARIANTS = (
    OpeningRangeVariant(
        variant_label="5-minute opening range",
        duration_minutes=5,
        source_quote="The 5m minute OB takes place from 9:30 a.m. Eastern to 9:35 a.m. Eastern.",
    ),
    OpeningRangeVariant(
        variant_label="15-minute opening range",
        duration_minutes=15,
        source_quote="The 15-minute is the first 15 minutes of the market. So, from 9:30 to now 9:45.",
    ),
    OpeningRangeVariant(
        variant_label="30-minute opening range",
        duration_minutes=30,
        source_quote="And the 30 minute is from 9:30 to 10 a.m. Eastern.",
    ),
)


def _definition() -> OpeningRangeDefinition:
    return OpeningRangeDefinition(
        session_start_local="09:30",
        source_timezone="America/New_York",
        variants=TAUGHT_VARIANTS,
        market_scope="equities (S&P 500 worked example); futures MARKET_OR_TIMEFRAME_UNRESOLVED",
        trading_day_rule="recomputed each trading day; relative for every single trading day",
        provenance=OpeningRangeProvenance(
            source_quote=(
                "once you take the price that's established in the first 5, 15, and the 30 minute ranges"
            ),
            condition_id="WAIT_STRUCTURE:once-you-take-the-price-that-s-establish#0",
        ),
    )


# ── INVARIANT 1 — no default duration ────────────────────────────────────────
def test_duration_has_no_default_anywhere():
    """A variant cannot be built without stating its duration."""
    with pytest.raises(TypeError):
        OpeningRangeVariant(variant_label="5-minute opening range", source_quote="x")  # type: ignore[call-arg]

    # And the definition itself carries no duration field at all — a default
    # could not hide on it even if someone added one later without noticing.
    field_names = {f.name for f in dataclasses.fields(OpeningRangeDefinition)}
    assert "duration_minutes" not in field_names, (
        "the definition grew a duration field; a single duration on the definition IS the "
        f"silent choice invariant 2 forbids. Fields: {sorted(field_names)}"
    )


def test_a_nonsense_duration_is_refused_at_construction():
    with pytest.raises(ValueError, match="must be positive"):
        OpeningRangeVariant(variant_label="bad", duration_minutes=0, source_quote="x")


# ── INVARIANT 2 — no silent selection among the taught alternatives ──────────
def test_all_three_taught_alternatives_are_preserved_and_none_is_selected():
    definition = _definition()
    assert [v.duration_minutes for v in definition.variants] == [5, 15, 30]
    assert [v.variant_label for v in definition.variants] == [
        "5-minute opening range",
        "15-minute opening range",
        "30-minute opening range",
    ]
    # Every variant carries its own taught evidence, so none is an inference.
    for variant in definition.variants:
        assert variant.source_quote.strip(), f"{variant.variant_label} has no source quote"


def test_asking_for_the_duration_raises_rather_than_choosing_one():
    """The load-bearing test for invariant 2.

    `WHERE THE TEACHER OFFERED ALTERNATIVES, ENUMERATING THEM IS FIDELITY;
    CHOOSING ONE IS INVENTION.` A property that returned `variants[0]` would be
    a silent selection three layers below where anyone would look for it.
    """
    with pytest.raises(NotImplementedError) as exc:
        _definition().selected_duration_minutes
    message = str(exc.value)
    assert "selects NONE" in message
    # The refusal must NAME the alternatives, or the caller cannot act on it.
    for label in ("5-minute", "15-minute", "30-minute"):
        assert label in message


def test_an_empty_variant_set_is_refused():
    """An empty set would let a downstream default fill the gap unopposed."""
    with pytest.raises(ValueError, match="at least one taught variant"):
        dataclasses.replace(_definition(), variants=())


# ── INVARIANT 3 — width and midpoint are formulas, never parameters ─────────
def test_width_and_midpoint_are_derived_from_the_levels():
    """Uses the source's own worked example: high 617.65, low 616.60.

    The taught text says the range was "a dollar 3" and the half range "about 52
    cents". Those are ONE DAY'S ARITHMETIC and must never be storable. Here the
    numbers are DERIVED, which is why a different day gives a different answer.
    """
    state = OpeningRangeState.from_levels(high=617.65, low=616.60)
    assert state.opening_range_high == 617.65
    assert state.opening_range_low == 616.60
    assert state.opening_range_width == pytest.approx(1.05)
    assert state.opening_range_midpoint == pytest.approx(617.125)
    assert state.opening_range_complete is True
    assert state.opening_range_window_status is OpeningRangeWindowStatus.COMPLETE

    # A DIFFERENT day gives a different answer from the same code — the witness
    # that this is a formula and not a stored constant.
    other = OpeningRangeState.from_levels(high=620.00, low=619.00)
    assert other.opening_range_width == pytest.approx(1.00)
    assert other.opening_range_midpoint == pytest.approx(619.50)


def test_inverted_levels_are_refused():
    with pytest.raises(ValueError, match="below low"):
        OpeningRangeState.from_levels(high=616.60, low=617.65)


# ── FAIL-CLOSED — the STEP 3 contract, as R-731 §4 defines it ───────────────
def test_step3_state_is_a_refusal_and_yields_no_number_by_any_route():
    """R-730 §4: the type may refuse because its adapter does not exist. Safe.

    The refusal must be structural: a consumer that ignores the status field
    still cannot obtain a level, a width or a midpoint. And it must be a VALUE,
    not an exception — R-731 §4 rules that a crash is not an acceptable refusal.
    """
    state = refused_state()  # returns, does not raise — that is the point
    assert state.opening_range_window_status is OpeningRangeWindowStatus.ADAPTER_NOT_IMPLEMENTED
    assert state.opening_range_complete is False
    assert state.opening_range_high is None
    assert state.opening_range_low is None
    assert state.opening_range_width is None
    assert state.opening_range_midpoint is None


def test_incomplete_window_is_a_refusal_with_the_pass_term_name():
    """`INCOMPLETE_OPENING_WINDOW` is a B1 pass term (R-727 §4-2).

    B0 measured that a partial window does NOT refuse today — it silently
    returns a narrower range. The name is pinned here so STEP 5 wires the
    refusal that already has a home rather than inventing a second spelling.
    """
    state = OpeningRangeState.refused(OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW)
    assert state.opening_range_window_status.value == INCOMPLETE_OPENING_WINDOW
    assert state.opening_range_complete is False
    assert state.opening_range_width is None


def test_complete_cannot_be_forged_through_the_refusal_constructor():
    """The one way to reach COMPLETE is `from_levels`, which derives the maths.

    Without this, a caller could mint a COMPLETE state with width=None — or,
    worse, a later edit could give `refused()` a levels argument and reintroduce
    supplied width/midpoint through the back door.
    """
    with pytest.raises(ValueError, match="not a refusal state"):
        OpeningRangeState.refused(OpeningRangeWindowStatus.COMPLETE)


def test_forming_is_a_refusal_because_reading_levels_early_is_lookahead():
    state = OpeningRangeState.refused(OpeningRangeWindowStatus.FORMING)
    assert state.opening_range_high is None
    assert state.opening_range_complete is False


# ── the canonical name is single-sourced ────────────────────────────────────
def test_canonical_type_name():
    assert CANONICAL_TYPE == "OPENING_RANGE_DEFINITION"
