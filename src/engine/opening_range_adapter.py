"""B1 STEP 4 — the executable adapter that computes a taught OPENING RANGE.

AUTHORITY: R-735 §6, which conditionally released STEP 4 once the R-735 §5
documentation correction landed and was pushed (AR-828 §1, commit `cc2152d5`).
Design filed in advance at AR-828 §2 and NOT pre-approved by the desk — the
desk said so explicitly, so this module is written to be judged, not blessed.

WHAT STEP 3 LEFT AND WHAT THIS ADDS
-----------------------------------
`opening_range_definition.py` is a REPRESENTATION ONLY: it types the taught
concept and returns `ADAPTER_NOT_IMPLEMENTED` for every request for computed
state. This module is the arithmetic that representation refused to guess at.

`A REFUSAL IS AN HONEST OFF STATE` was the STEP 3 answer. STEP 4's job is to
replace exactly one refusal — `ADAPTER_NOT_IMPLEMENTED` — while leaving every
OTHER refusal in place and, in two cases, making them reachable for the first
time. `FORMING` and `INCOMPLETE_OPENING_WINDOW` were declared by STEP 3 and
could never be returned by anything; they are returned here.

🛑 THE FINISH LINE DOES NOT CHECK THIS FILE'S ARITHMETIC (AR-828 §2.4)
----------------------------------------------------------------------
Measured before this module was written: `test_no_executable_opening_range_
adapter_exists_yet` reads only `bindable`/`primitive`, and
`test_no_typed_opening_range_output_contract_exists_in_production` reads only
the RETURN ANNOTATION's field names. **Neither ever calls this function.** A
module that returned `refused_state()` unconditionally would turn both GREEN.

`A FINISH LINE THAT A STUB CAN CROSS IS NOT A FINISH LINE; IT IS A TURNSTILE.`

So the executable evidence in `src/engine/tests/test_opening_range_adapter.py`
is the real acceptance, it was pre-registered in AR-828 §2.4 BEFORE this code
existed, and it may not be weakened to match whatever this file happens to do.

🛑🛑 NOT REGISTERED YET, AND THE REASON IS A SCOPE STOP — NOT AN OVERSIGHT
--------------------------------------------------------------------------
`FAMILY_META["OPENING_RANGE_DEFINITION"]` still declares `unsupported=True`
and this module is NOT yet its primitive. That is deliberate and it is
reported in AR-829, not left for a reader to discover.

MEASURED (AR-829 §2): declaring the primitive obliges an `ENFORCED_DISPATCH`
entry, because `family_meta_enforcement.verify_dispatch_coverage()` proves
set equality in BOTH directions — a declared name with no route is an
unroutable pointer. A dispatch handler evaluates per bar, and to evaluate it
must know WHICH taught window it is computing. MEASURED: the golden slice's
binding carries `parameters=None`, and its taught prose names THREE windows
("the first 5, 15, and the 30 minute ranges").

⇒ Wiring this module to production requires naming a duration the teacher
did not name. That is the scope class R-732 reserved to the desk, AR-828 §2.5
pre-registered as a STOP, and this seat will not decide it.

`A MODULE THAT COMPUTES CORRECTLY AND IS NOT WIRED IS AN HONEST PARTIAL; ONE
THAT IS WIRED BY GUESSING A TAUGHT VALUE IS A FIDELITY DEFECT.`

WHAT IS SOURCE-OWNED AND WHAT IS FRAMEWORK-OWNED
------------------------------------------------
STEP 3 deliberately kept bar interval, interval convention, session-date
convention and completeness policy OFF the definition type, because putting
them there would blur which side of the boundary a value came from. They are
therefore PARAMETERS here — supplied by the runtime, never inferred, never
defaulted. `definition` carries what the teacher said; every keyword argument
below carries what the data feed is.

🛑 NO DURATION IS CHOSEN HERE. `variant` is a REQUIRED parameter and
`selected_duration_minutes` is never called — it still raises, invariant 2
intact. The teacher offered alternatives; the caller must have already decided
which one it is asking about. `WHERE THE TEACHER OFFERED ALTERNATIVES,
ENUMERATING THEM IS FIDELITY; CHOOSING ONE IS INVENTION.` (R-725 §5-2)

🛑 THIS MODULE NEVER IMPORTS, CALLS OR FALLS BACK TO
`structure_engine.compute_structure_state`. That route is the defect B1 exists
to remove, and reaching it under any condition would ship the defect behind a
new name (R-730 §4).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import polars as pl

from src.engine.indicators.core import compute_opening_range_breakout
from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeState,
    OpeningRangeVariant,
    OpeningRangeWindowStatus,
)


@dataclass(frozen=True)
class OpeningRangeBar:
    """ONE observation inside the opening window.

    `timestamp` is the bar's OPEN instant and must be TIMEZONE-AWARE. A naive
    timestamp is rejected rather than assumed to be in the source zone: the
    whole point of carrying an IANA zone on the definition is that wall-clock
    without a zone is not a moment in time, and guessing one silently is how a
    range gets computed off the wrong hour for half the year.
    """

    timestamp: datetime
    high: float
    low: float

    def __post_init__(self) -> None:
        if self.timestamp.tzinfo is None or self.timestamp.utcoffset() is None:
            raise ValueError(
                f"opening-range bar timestamp {self.timestamp!r} is timezone-naive; "
                "supply an aware datetime so the session window is unambiguous"
            )
        # ORDER MATTERS, AND A TEST CAUGHT IT (R-737 §6-1 closeout). The
        # inversion check is guarded on FINITENESS because it otherwise fires
        # first on `high=-inf` or `low=+inf` — both of which are genuinely
        # "high < low" — and RAISES, converting bad market data into an
        # exception. R-737 §6-1 is explicit that non-finite data takes the
        # REFUSAL-STATE branch, not the raise branch, so a corrupt observation
        # must survive construction long enough for the adapter to refuse it.
        #
        # `AN INVERTED BAR AND A CORRUPT BAR ARE DIFFERENT DEFECTS, AND THE
        # GUARD THAT RUNS FIRST DECIDES WHICH ONE THE SYSTEM REPORTS.`
        if math.isfinite(self.high) and math.isfinite(self.low) and self.high < self.low:
            raise ValueError(
                f"opening-range bar has high {self.high!r} below low {self.low!r}; "
                "the observation is inverted"
            )


def _window_bounds(
    definition: OpeningRangeDefinition,
    variant: OpeningRangeVariant,
    session_date: date,
) -> tuple[datetime, datetime]:
    """The half-open window `[start, lock)` for one session, in the taught zone.

    HALF-OPEN IS THE MECHANISM, NOT A STYLE CHOICE. The bar stamped exactly at
    the lock instant is the FIRST bar after the range, and including it would
    widen every range by one bar while looking perfectly reasonable.
    """
    zone = ZoneInfo(definition.source_timezone)
    hour_text, _, minute_text = definition.session_start_local.partition(":")
    start = datetime(
        session_date.year,
        session_date.month,
        session_date.day,
        int(hour_text),
        int(minute_text),
        tzinfo=zone,
    )
    lock = start + timedelta(minutes=variant.duration_minutes)

    # ── R-736 §5-4: THE TRADING-DAY BOUNDARY STAYS EXPLICIT ──────────────────
    # The shared calculator groups by CALENDAR DATE. For a window that stays
    # inside one local day that grouping is a no-op, which is why reuse is safe
    # here. A window crossing local midnight is a DIFFERENT day convention, and
    # the ruling is explicit: unsupported conventions must REFUSE, never
    # silently inherit the legacy calendar-date behaviour.
    #
    # This raises rather than returning a refusal state because it is a
    # CONFIGURATION the adapter does not support, not a condition of the market
    # data — the same split as the untaught-variant guard below.
    if lock.astimezone(zone).date() != start.astimezone(zone).date():
        raise ValueError(
            f"the taught window {definition.session_start_local}+{variant.duration_minutes}m "
            f"crosses local midnight in {definition.source_timezone}. That is a trading-day "
            "convention this adapter does not support, and inheriting the shared calculator's "
            "calendar-date grouping would silently answer a different question."
        )
    return start, lock


def opening_range_window_bounds(
    definition: OpeningRangeDefinition,
    variant: OpeningRangeVariant,
    session_date: date,
) -> tuple[datetime, datetime]:
    """PUBLIC `[start, lock)` for one session — B1 STEP 6B (`R-743 §6`).

    A thin delegation to `_window_bounds`, added so the LOCK INSTANT is a
    first-class public fact rather than a private detail the state lane has to
    re-derive.

    WHY THE STATE LANE NEEDS IT, AND WHY RE-DERIVING WOULD HAVE BEEN WRONG. The
    lock is the exact instant the opening range becomes knowable. Computing a
    session's state `as_of` anything LATER (the session's last bar, the frame's
    last bar) publishes a value the market could not have known at the time, and
    computing it EARLIER is the `FORMING` refusal by design. Re-deriving the
    boundary in a second module would also have been a SECOND INSTRUMENT: two
    window calculators that agree today and diverge on the first daylight-saving
    edge, with nothing joining them.
    """
    return _window_bounds(definition, variant, session_date)


# The fail-loud READ-OUT row (see `_aggregate_levels`). Its values are chosen so
# that IF it ever leaked past the shared calculator's in-range mask, the result
# would be catastrophically, visibly wrong rather than subtly off. A sentinel
# that degrades quietly is worse than none.
_READOUT_HIGH = 1e9
_READOUT_LOW = -1e9


def _aggregate_levels(
    definition: OpeningRangeDefinition,
    variant: OpeningRangeVariant,
    in_window: Sequence[OpeningRangeBar],
    start: datetime,
    lock: datetime,
) -> tuple[float, float]:
    """Delegate the max/min aggregation to the ONE production calculator.

    R-736 §5-1: this module must not be a SECOND CALCULATOR. `A SECOND
    CALCULATOR AGREES WITH THE FIRST UNTIL THE DAY IT DOES NOT.` So the levels
    are produced by `indicators.core.compute_opening_range_breakout`, the same
    function the backtester uses — called with EVERY parameter explicit, never
    on its defaults (`range_minutes: int = 15` is a silent duration selection,
    and choosing for a teacher who declined to is the defect B1 exists to stop).

    IT IS CALLED ONLY AFTER THIS MODULE'S TYPED VALIDATION HAS PASSED. That
    ordering is the whole safety argument: the legacy function does not check
    completeness, so on a gapped window it returns a confident narrower range.
    By the time it runs here, membership, grid alignment, duplication and count
    have already been proven, and the timezone has been resolved through the
    taught IANA zone rather than assumed.

    THE READ-OUT ROW. The shared calculator publishes locked levels ONLY on rows
    at or after the lock, and every validated bar is by construction BEFORE it —
    so a frame of in-window bars alone would come back all-null. One row stamped
    at the lock instant is appended to read the answer out. It cannot influence
    the aggregate: the calculator's in-range mask is `[start, lock)` and this row
    sits exactly at `lock`. `test_readout_row_cannot_influence_the_levels` proves
    that rather than asserting it.
    """
    zone = ZoneInfo(definition.source_timezone)

    # Wall-clock in the TAUGHT zone. The shared calculator reads hour/minute off
    # the timestamp, so the zone conversion must happen here, where the typed
    # definition says which zone is meant.
    timestamps = [bar.timestamp.astimezone(zone).replace(tzinfo=None) for bar in in_window]
    highs = [bar.high for bar in in_window]
    lows = [bar.low for bar in in_window]

    timestamps.append(lock.astimezone(zone).replace(tzinfo=None))
    highs.append(_READOUT_HIGH)
    lows.append(_READOUT_LOW)

    frame = pl.DataFrame({"ts_et": timestamps, "high": highs, "low": lows})
    orh, orl, _or_range = compute_opening_range_breakout(
        frame,
        range_minutes=variant.duration_minutes,
        session_start_et=definition.session_start_local,
    )
    return float(orh[-1]), float(orl[-1])


def compute_opening_range_state(
    definition: OpeningRangeDefinition,
    variant: OpeningRangeVariant,
    bars: Sequence[OpeningRangeBar],
    *,
    session_date: date,
    bar_interval_minutes: int,
    as_of: datetime,
) -> OpeningRangeState:
    """Compute one session's opening-range state, or refuse and say why.

    The return annotation is load-bearing: `_typed_opening_range_fields` in the
    conformance suite resolves this primitive and reads `OpeningRangeState`'s
    field names off it. That is the OUTPUT CONTRACT gate.

    REFUSES, never guesses:
      * `FORMING`                   — asked before the window closed.
      * `INCOMPLETE_OPENING_WINDOW` — the window closed with observations
        missing, duplicated, or off the interval grid.

    `THE FAILURE MODE OF A MISSING BAR IS NOT SILENCE — IT IS A CONFIDENT,
    TIGHTER RANGE WITH NO FLAG RAISED ANYWHERE.` (opening_range_definition.py)
    A refusal here is what stops that; every numeric field comes back `None`.
    """
    if variant not in definition.variants:
        raise ValueError(
            f"variant {variant.variant_label!r} is not one of this definition's taught "
            f"alternatives ({', '.join(v.variant_label for v in definition.variants)}). "
            "Computing a window the teacher never taught would be invention, not compilation."
        )
    if bar_interval_minutes <= 0:
        raise ValueError(
            f"bar interval must be positive; got {bar_interval_minutes!r}"
        )
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError(
            f"as_of {as_of!r} is timezone-naive; the window boundary cannot be compared "
            "against an instant that has no zone"
        )

    start, lock = _window_bounds(definition, variant, session_date)

    # ── FORMING — reading levels before the window closes is lookahead ───────
    if as_of < lock:
        return OpeningRangeState.refused(OpeningRangeWindowStatus.FORMING)

    # ── The window must be expressible in whole bars ─────────────────────────
    # A 5-minute window sampled at 3-minute bars has no exact observation count,
    # so "complete" has no definition. That is a refusal, not a rounding.
    if variant.duration_minutes % bar_interval_minutes != 0:
        return OpeningRangeState.refused(
            OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW
        )
    expected_count = variant.duration_minutes // bar_interval_minutes

    # ── Membership, then grid alignment, then completeness ───────────────────
    in_window = [bar for bar in bars if start <= bar.timestamp < lock]

    # ── NON-FINITE MARKET DATA — R-737 §6-1 ──────────────────────────────────
    # `NaN` / `+inf` / `-inf` in an observation. This is BAD MARKET DATA, not an
    # unsupported configuration, so it takes the REFUSAL-STATE branch rather
    # than the raise branch the midnight guard takes — the same split this
    # module already draws everywhere else.
    #
    # IT NEEDS ITS OWN CHECK AND CANNOT BE LEFT TO THE ONES BELOW: `NaN`
    # compares False against everything, so `OpeningRangeBar`'s `high < low`
    # guard waves it through, and `max()`/`min()` would then propagate it into a
    # COMPLETE state whose levels are `nan`. A range of `nan` is not a wrong
    # number — it is a number-shaped hole that every downstream comparison
    # silently answers False to.
    if any(
        not math.isfinite(value)
        for bar in in_window
        for value in (bar.high, bar.low)
    ):
        return OpeningRangeState.refused(
            OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW
        )

    offsets: list[int] = []
    for bar in in_window:
        delta = bar.timestamp - start
        minutes, remainder_seconds = divmod(int(delta.total_seconds()), 60)
        # OFF-GRID: a bar that does not sit on an interval boundary means the
        # feed is not what the caller declared it to be. Aggregating it would
        # produce a range from a sampling the caller cannot describe.
        if remainder_seconds or minutes % bar_interval_minutes:
            return OpeningRangeState.refused(
                OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW
            )
        offsets.append(minutes)

    # DUPLICATED: two observations for the same slot. Which one is the truth is
    # not a question this adapter may answer by picking the extreme one.
    if len(set(offsets)) != len(offsets):
        return OpeningRangeState.refused(
            OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW
        )

    # MISSING: fewer observations than the declared sampling requires. This is
    # the branch that would otherwise return a narrower, confident range.
    if len(offsets) != expected_count:
        return OpeningRangeState.refused(
            OpeningRangeWindowStatus.INCOMPLETE_OPENING_WINDOW
        )

    # ── COMPLETE — levels from the SHARED calculator, width/midpoint DERIVED ─
    # The aggregation is delegated, not re-implemented (R-736 §5-1). Width and
    # midpoint are then computed by `from_levels`, the only constructor that
    # yields a usable state — there is deliberately no path here that could
    # supply them.
    high, low = _aggregate_levels(definition, variant, in_window, start, lock)
    return OpeningRangeState.from_levels(high=high, low=low)
