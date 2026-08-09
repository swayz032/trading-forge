"""B1 STEP 4 — the executable acceptance the ordered REDs cannot provide.

WHY THIS FILE EXISTS, IN ONE PARAGRAPH
--------------------------------------
`R-735 §6` requires the two ordered REDs to go green "BY THE ADAPTER EXISTING
AND WORKING — not by being edited." Measured before the adapter was written
(AR-828 §2.4): **neither ordered RED ever invokes the adapter.**
`test_no_executable_opening_range_adapter_exists_yet` reads `bindable` and
`primitive`; `test_no_typed_opening_range_output_contract_exists_in_production`
reads a RETURN ANNOTATION. A module returning `refused_state()` unconditionally
turns both GREEN while computing nothing.

`A FINISH LINE THAT A STUB CAN CROSS IS NOT A FINISH LINE; IT IS A TURNSTILE.`

Every control below was pre-registered in AR-828 §2.4 and committed to BEFORE
the adapter existed, so it cannot have been fitted to whatever the adapter
happens to do (`[pre-register-criteria]`).

THE ANTI-STUB CONTROL IS THE LOAD-BEARING ONE
---------------------------------------------
`test_a_refusing_stub_cannot_satisfy_this_suite` is the red-proof: it asserts
that the always-refuse implementation — the exact shape that satisfies both
ordered REDs — FAILS here. Without it, this suite would be a pile of assertions
with no demonstrated power to reject the thing it was built to reject.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from src.engine.opening_range_adapter import OpeningRangeBar, compute_opening_range_state
from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeProvenance,
    OpeningRangeState,
    OpeningRangeVariant,
    OpeningRangeWindowStatus,
    refused_state,
)

NY = ZoneInfo("America/New_York")

FIVE = OpeningRangeVariant(
    variant_label="5m", duration_minutes=5, source_quote="the first five-minute candle"
)
FIFTEEN = OpeningRangeVariant(
    variant_label="15m", duration_minutes=15, source_quote="the first fifteen minutes"
)
THIRTY = OpeningRangeVariant(
    variant_label="30m", duration_minutes=30, source_quote="this 30 minute range"
)

DEFINITION = OpeningRangeDefinition(
    session_start_local="09:30",
    source_timezone="America/New_York",
    variants=(FIVE, FIFTEEN, THIRTY),
    market_scope="US equity index futures, as demonstrated",
    trading_day_rule="resets each regular-session open",
    provenance=OpeningRangeProvenance(
        source_quote="mark out the high and the low of that first 5-minute candle",
        condition_id="TEST_ONLY:opening-range-adapter",
    ),
)

SESSION = date(2026, 4, 15)          # an ordinary EDT weekday
AFTER_LOCK = datetime(2026, 4, 15, 12, 0, tzinfo=NY)


def _bar(minute_offset: int, high: float, low: float, *, session: date = SESSION) -> OpeningRangeBar:
    """A bar `minute_offset` minutes after the 09:30 local open."""
    start = datetime(session.year, session.month, session.day, 9, 30, tzinfo=NY)
    return OpeningRangeBar(timestamp=start + timedelta(minutes=minute_offset), high=high, low=low)


# Three 5-minute bars covering the 15-minute window. The MIDDLE bar carries both
# extremes, which is what makes the missing-bar control discriminating.
FULL_15M = (
    _bar(0, high=100.20, low=100.00),
    _bar(5, high=100.50, low=99.75),   # <- the extremes live here
    _bar(10, high=100.10, low=99.90),
)


# ── CONTROL 1 — the positive: it computes, and width/midpoint are DERIVED ────
def test_complete_window_computes_levels_with_derived_width_and_midpoint():
    state = compute_opening_range_state(
        DEFINITION, FIFTEEN, FULL_15M,
        session_date=SESSION, bar_interval_minutes=5, as_of=AFTER_LOCK,
    )

    assert state.opening_range_window_status is OpeningRangeWindowStatus.COMPLETE
    assert state.opening_range_complete is True
    assert state.opening_range_high == 100.50
    assert state.opening_range_low == 99.75

    # DERIVED, not supplied. If these were parameters, one day's worked
    # arithmetic could be stored as the strategy (R-725 §5-1).
    assert state.opening_range_width == pytest.approx(0.75)
    assert state.opening_range_midpoint == pytest.approx((100.50 + 99.75) / 2)


# ── CONTROL 2 — the missing bar must NOT yield a tighter range ───────────────
def test_missing_bar_refuses_and_does_not_return_a_narrower_range():
    """The defect this refusal exists to prevent, asserted by its value.

    `THE FAILURE MODE OF A MISSING BAR IS NOT SILENCE — IT IS A CONFIDENT,
    TIGHTER RANGE WITH NO FLAG RAISED ANYWHERE.` Dropping the middle bar
    removes BOTH extremes, so a silently-aggregating implementation returns
    high 100.20 / low 99.90 — narrower, plausible, and wrong. Asserting the
    status alone would not catch that; asserting the NUMBERS is what does.
    """
    without_middle = (FULL_15M[0], FULL_15M[2])

    state = compute_opening_range_state(
        DEFINITION, FIFTEEN, without_middle,
        session_date=SESSION, bar_interval_minutes=5, as_of=AFTER_LOCK,
    )

    assert state.opening_range_window_status is OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW
    assert state.opening_range_complete is False
    assert state.opening_range_high is None and state.opening_range_low is None

    # THE POINT: the tighter range that a silent implementation would have
    # produced is specifically absent.
    assert state.opening_range_high != 100.20
    assert state.opening_range_low != 99.90

    # POSITIVE WITNESS that the same inputs plus the missing bar DO compute —
    # so the refusal is caused by the absent observation and not by the fixture
    # being unusable in the first place.
    restored = compute_opening_range_state(
        DEFINITION, FIFTEEN, FULL_15M,
        session_date=SESSION, bar_interval_minutes=5, as_of=AFTER_LOCK,
    )
    assert restored.opening_range_window_status is OpeningRangeWindowStatus.COMPLETE
    assert restored.opening_range_high == 100.50


# ── CONTROL 3 — duplicated observation ───────────────────────────────────────
def test_duplicated_bar_refuses_rather_than_choosing_a_winner():
    duplicated = (*FULL_15M, _bar(5, high=101.00, low=99.00))

    state = compute_opening_range_state(
        DEFINITION, FIFTEEN, duplicated,
        session_date=SESSION, bar_interval_minutes=5, as_of=AFTER_LOCK,
    )

    assert state.opening_range_window_status is OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW
    # The wider range from the duplicate was NOT silently adopted.
    assert state.opening_range_high is None


# ── CONTROL 4 — off-grid timestamp ───────────────────────────────────────────
def test_off_grid_bar_refuses():
    off_grid = (FULL_15M[0], _bar(7, high=100.50, low=99.75), FULL_15M[2])

    state = compute_opening_range_state(
        DEFINITION, FIFTEEN, off_grid,
        session_date=SESSION, bar_interval_minutes=5, as_of=AFTER_LOCK,
    )

    assert state.opening_range_window_status is OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW


def test_window_not_expressible_in_whole_bars_refuses():
    """A 5-minute window sampled at 3-minute bars has no exact observation count."""
    state = compute_opening_range_state(
        DEFINITION, FIVE, (_bar(0, high=100.2, low=100.0),),
        session_date=SESSION, bar_interval_minutes=3, as_of=AFTER_LOCK,
    )
    assert state.opening_range_window_status is OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW


# ── CONTROL 5 — FORMING before the window closes, every number None ──────────
def test_before_lock_is_forming_with_no_readable_numbers():
    """Reading levels mid-window is lookahead, and the shape must prevent it."""
    mid_window = datetime(2026, 4, 15, 9, 40, tzinfo=NY)  # 09:30 + 10 of 15 min

    state = compute_opening_range_state(
        DEFINITION, FIFTEEN, FULL_15M,
        session_date=SESSION, bar_interval_minutes=5, as_of=mid_window,
    )

    assert state.opening_range_window_status is OpeningRangeWindowStatus.FORMING
    assert state.opening_range_complete is False
    assert state.opening_range_high is None
    assert state.opening_range_low is None
    assert state.opening_range_width is None
    assert state.opening_range_midpoint is None


def test_bar_stamped_at_the_lock_instant_is_excluded():
    """Half-open `[start, lock)`. Including the lock bar widens every range."""
    with_lock_bar = (*FULL_15M, _bar(15, high=105.00, low=95.00))

    state = compute_opening_range_state(
        DEFINITION, FIFTEEN, with_lock_bar,
        session_date=SESSION, bar_interval_minutes=5, as_of=AFTER_LOCK,
    )

    assert state.opening_range_window_status is OpeningRangeWindowStatus.COMPLETE
    assert state.opening_range_high == 100.50   # NOT 105.00
    assert state.opening_range_low == 99.75     # NOT 95.00


# ── CONTROL 6 — the IANA zone is load-bearing; a fixed offset must fail ──────
def test_dst_session_resolves_by_iana_zone_not_a_fixed_offset():
    """US DST began 2026-03-08, so 09:30 local is UTC-4 after it and UTC-5 before.

    A fixed -05:00 offset is wrong for half the year and the error is SILENT —
    it does not raise, it just looks in the wrong hour and finds no bars. This
    control proves the zone conversion is real by supplying bars at the TRUE
    EDT instant and, as the discriminator, showing that bars placed at the
    fixed-offset instant fall outside the window entirely.
    """
    dst_session = date(2026, 3, 9)  # Monday after the transition -> EDT (UTC-4)

    correct_open_utc = datetime(2026, 3, 9, 13, 30, tzinfo=timezone.utc)   # 09:30 EDT
    fixed_offset_open_utc = datetime(2026, 3, 9, 14, 30, tzinfo=timezone.utc)  # 09:30 "EST"

    # Sanity: the two instants really are different, or this control is vacuous.
    assert correct_open_utc != fixed_offset_open_utc

    correct_bars = tuple(
        OpeningRangeBar(
            timestamp=correct_open_utc + timedelta(minutes=offset), high=100.0 + offset, low=99.0
        )
        for offset in (0, 5, 10)
    )
    computed = compute_opening_range_state(
        DEFINITION, FIFTEEN, correct_bars,
        session_date=dst_session, bar_interval_minutes=5,
        as_of=datetime(2026, 3, 9, 18, 0, tzinfo=timezone.utc),
    )
    assert computed.opening_range_window_status is OpeningRangeWindowStatus.COMPLETE
    assert computed.opening_range_high == 110.0

    # DISCRIMINATOR: bars an hour later — where a fixed -05:00 offset would have
    # looked — are NOT in the window.
    fixed_offset_bars = tuple(
        OpeningRangeBar(
            timestamp=fixed_offset_open_utc + timedelta(minutes=offset), high=100.0 + offset, low=99.0
        )
        for offset in (0, 5, 10)
    )
    wrong = compute_opening_range_state(
        DEFINITION, FIFTEEN, fixed_offset_bars,
        session_date=dst_session, bar_interval_minutes=5,
        as_of=datetime(2026, 3, 9, 18, 0, tzinfo=timezone.utc),
    )
    assert wrong.opening_range_window_status is OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW


# ── The taught alternatives are still not chosen for anybody ─────────────────
def test_adapter_never_selects_a_duration_for_the_caller():
    """Invariant 2 survives STEP 4: the property still raises, unused."""
    with pytest.raises(NotImplementedError):
        _ = DEFINITION.selected_duration_minutes


def test_untaught_variant_is_refused():
    untaught = OpeningRangeVariant(
        variant_label="60m", duration_minutes=60, source_quote="never taught"
    )
    with pytest.raises(ValueError, match="not one of this definition's taught"):
        compute_opening_range_state(
            DEFINITION, untaught, FULL_15M,
            session_date=SESSION, bar_interval_minutes=5, as_of=AFTER_LOCK,
        )


def test_naive_timestamps_are_refused():
    with pytest.raises(ValueError, match="timezone-naive"):
        OpeningRangeBar(timestamp=datetime(2026, 4, 15, 9, 30), high=1.0, low=0.0)


# ── THE RED-PROOF — the stub that satisfies both ordered REDs fails HERE ─────
def _always_refusing_stub(*_args, **_kwargs) -> OpeningRangeState:
    """The exact shape that turns both ordered REDs green while computing nothing.

    It is registrable, resolvable, and its return annotation carries all six
    required fields — so the conformance suite cannot tell it from the real
    adapter. This suite must.
    """
    return refused_state()


def test_a_refusing_stub_cannot_satisfy_this_suite():
    """RED-PROOF AT BIRTH: the mutation must BITE, or these controls prove nothing.

    Runs the stub through the same positive control as `compute_opening_range_state`
    and requires it to FAIL. A suite that a do-nothing implementation could pass
    would be decoration.
    """
    stubbed = _always_refusing_stub(
        DEFINITION, FIFTEEN, FULL_15M,
        session_date=SESSION, bar_interval_minutes=5, as_of=AFTER_LOCK,
    )

    # The stub returns the STEP 3 refusal...
    assert stubbed.opening_range_window_status is OpeningRangeWindowStatus.ADAPTER_NOT_IMPLEMENTED
    assert stubbed.opening_range_high is None

    # ...and therefore cannot satisfy control 1, which the real adapter does.
    real = compute_opening_range_state(
        DEFINITION, FIFTEEN, FULL_15M,
        session_date=SESSION, bar_interval_minutes=5, as_of=AFTER_LOCK,
    )
    assert real.opening_range_window_status is OpeningRangeWindowStatus.COMPLETE
    assert real.opening_range_high == 100.50
    assert stubbed.opening_range_window_status is not real.opening_range_window_status
