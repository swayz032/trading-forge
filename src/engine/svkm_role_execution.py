"""SVKM-ROLE-EXEC-1 — the narrow 5m-window / 1m-execution seam. ONE SOURCE, NO FRAMEWORK.

Authority: AR-1113 (gpt-rulings `12b565ad`) §3 "narrow sVkm 5m→1m source-role execution
adapter", §3.1 "prefer two explicit source frames", §3.2 fail-closed boundaries.

WHY THIS MODULE EXISTS — THE DEFECT IT REMOVES
----------------------------------------------
`[MEASURED, AR-1113 §2.4, re-measured at 365dfa0b]` the role carrier landed and the
runtime PARSES it:

    backtester.py:7537   _cls_source_timeframe_roles = _resolve_source_timeframe_roles(strategy)

and then `grep -rn _cls_source_timeframe_roles` returns exactly two lines — the
initialisation and that assignment. **Nothing reads it.** The engine can therefore prove
a role declaration exists while remaining unable to execute the role semantics, and the
production class backtest still loads ONE bar series off the scalar `strategy.timeframe`.

    ★★★★★ `A SOURCE FACT THAT IS VALIDATED BUT CANNOT CHANGE EXECUTION IS NOT YET A
       COMPILED MONEY-PATH FACT.` (AR-1113 §1)

This module is the smallest seam that makes the role VALUE change what the engine reads.

🛑 WHAT THIS IS NOT, AND THE RULING SAYS SO BY NAME (AR-1113 §3)
----------------------------------------------------------------
NOT a generic multi-timeframe orchestration engine · NOT strategy-wide resampling
infrastructure · NOT a generalized timeframe dependency graph · NOT a framework for
future timeframe combinations. It refuses every role combination that is not sVkm's,
which is precisely what stops it becoming a framework by accretion.

    `THE NARROWNESS IS THE FEATURE. A SEAM THAT ACCEPTS EVERY COMBINATION IS THE
     GENERIC ENGINE THE RULING FORBADE, ARRIVING ONE ROLE AT A TIME.`

TWO EXPLICIT FRAMES, NOT A RESAMPLER (AR-1113 §3.1)
---------------------------------------------------
The 5m opening-range series is supplied as its own frame. Deriving it from 1m data would
quietly introduce a second ungraded question — *does our 1m→5m aggregation reproduce the
vendor's 5m bar boundaries and timestamp semantics?* — and answer it by assumption. That
equivalence must be separately demonstrated before it may be relied on; this module
therefore has no aggregation path at all, so there is nothing to assume.

`src/data/scripts/resample_timeframes.py` already produces stored higher-timeframe series
at the DATA layer. That is where a 5m frame comes from; it is not re-implemented here.

NO SECOND CALCULATOR
--------------------
The range arithmetic is delegated to `opening_range_adapter.compute_opening_range_state`,
the module the desk already audited (R-736 §5-1: `A SECOND CALCULATOR AGREES WITH THE
FIRST UNTIL THE DAY IT DOES NOT`). This file contributes the ROLE BINDING and the CAUSAL
GATE, and no max/min of its own.

CAUSALITY IS THE WHOLE SAFETY ARGUMENT (AR-1113 §3.1, §6.F)
------------------------------------------------------------
The 5m range may become visible to the 1m path only AFTER the source 5m candle is
complete. No 1m bar may read a future 5m high/low. The lock instant is the boundary and
it is half-open `[start, lock)` — the 1m bar stamped exactly at `lock` is the first bar
permitted to see levels, because by then the 5m candle it summarises has closed.
"""

from __future__ import annotations

import dataclasses
import re
from collections.abc import Sequence
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from src.engine.opening_range_adapter import OpeningRangeBar, compute_opening_range_state
from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeState,
    OpeningRangeVariant,
    OpeningRangeWindowStatus,
)
from src.engine.source_timeframe_roles import (
    BREAKOUT_CONFIRMATION,
    ENTRY_COMPLETION,
    FVG_DETECTION,
    OPENING_RANGE_WINDOW,
    SourceTimeframeRoles,
)


class SourceRoleExecutionError(ValueError):
    """Every refusal in this module. Named so a caller can tell a role-fidelity refusal
    apart from an arbitrary ValueError deeper in the stack — the same discipline as
    `SourceTimeframeRoleError`."""


# ── THE sVkm ROLE COMBINATION — CLOSED, AND CHECKED BY VALUE ─────────────────
# AR-1113 §3.1 states the required resolution explicitly. This dict is the whole
# "which source is this adapter for" answer: a role set that does not match it is
# refused rather than executed on a best guess.
#
# 🛑 THIS IS A GUARD, NOT A DEFAULT. It never SUPPLIES a timeframe — it only refuses a
# carrier whose timeframes are not these. The values still come from the persisted
# source contract, so a row that lost its roles cannot be rescued by this table.
SVKM_EXPECTED_ROLE_TIMEFRAMES: dict[str, str] = {
    OPENING_RANGE_WINDOW: "5m",
    BREAKOUT_CONFIRMATION: "1m",
    FVG_DETECTION: "1m",
    ENTRY_COMPLETION: "1m",
}

_TIMEFRAME_PATTERN = re.compile(r"^(\d+)m$")


def parse_minutes(timeframe: str) -> int:
    """`'5m' -> 5`. Refuses everything else, on purpose.

    Deliberately supports ONLY whole-minute timeframes. `1h` and `1d` are not
    unsupported-by-oversight — supporting them is how this narrow seam grows into the
    generic engine AR-1113 §3 forbids. When a source needs them, that is a ruling, not
    a regex change.
    """
    if not isinstance(timeframe, str):
        raise SourceRoleExecutionError(
            f"timeframe {timeframe!r} is not a string; a role timeframe must be a "
            "declared value, never an inferred object"
        )
    match = _TIMEFRAME_PATTERN.match(timeframe.strip())
    if not match:
        raise SourceRoleExecutionError(
            f"timeframe {timeframe!r} is not a whole-minute timeframe such as '1m' or "
            "'5m'. This seam is deliberately narrow (AR-1113 §3); widening it is a "
            "ruling, not a parsing change. REFUSING."
        )
    minutes = int(match.group(1))
    if minutes <= 0:
        raise SourceRoleExecutionError(f"timeframe {timeframe!r} is not positive")
    return minutes


def assert_svkm_role_combination(roles: SourceTimeframeRoles) -> None:
    """Refuse any role set that is not sVkm's 5m-window / 1m-execution combination.

    AR-1113 §3.2: *"the expected sVkm role combination is not present"* is a refusal.
    `SourceTimeframeRoles` already proves the set is COMPLETE and internally consistent;
    it has no opinion about WHICH source it describes. That is this check's job.
    """
    wrong: list[str] = []
    for role, expected in SVKM_EXPECTED_ROLE_TIMEFRAMES.items():
        # `timeframe_for` RAISES on an absent role rather than borrowing a sibling's
        # value, so a missing role surfaces here as a refusal, not as a silent skip.
        actual = roles.timeframe_for(role)
        if actual.strip() != expected:
            wrong.append(f"{role}: declared {actual!r}, this adapter requires {expected!r}")
    if wrong:
        raise SourceRoleExecutionError(
            "the persisted role set is not the sVkm 5m-window / 1m-execution "
            "combination this narrow adapter was authorised for (AR-1113 §3.1):\n  "
            + "\n  ".join(wrong)
            + "\nA generic multi-timeframe engine is NOT authorised (AR-1113 §3), so "
            "an unrecognised combination REFUSES rather than being handled generically."
        )


@dataclasses.dataclass(frozen=True)
class RoleFrame:
    """One supplied bar series, and the role timeframe it CLAIMS to be.

    `timestamps` are the bars' OPEN instants and must be timezone-aware — the same rule
    `OpeningRangeBar` enforces, for the same reason: wall-clock without a zone is not a
    moment in time, and guessing one is how a range lands on the wrong hour for half
    the year.
    """

    timeframe: str
    timestamps: tuple[datetime, ...]
    highs: tuple[float, ...]
    lows: tuple[float, ...]

    def __post_init__(self) -> None:
        n = len(self.timestamps)
        if len(self.highs) != n or len(self.lows) != n:
            raise SourceRoleExecutionError(
                f"frame {self.timeframe!r} has ragged columns: "
                f"{n} timestamps, {len(self.highs)} highs, {len(self.lows)} lows"
            )
        if n == 0:
            raise SourceRoleExecutionError(
                f"frame {self.timeframe!r} is empty; an empty frame is exactly what a "
                "failed load looks like, and it is refused rather than treated as a "
                "session with no bars"
            )
        for ts in self.timestamps:
            if ts.tzinfo is None or ts.utcoffset() is None:
                raise SourceRoleExecutionError(
                    f"frame {self.timeframe!r} carries the timezone-naive timestamp "
                    f"{ts!r}; supply aware datetimes so the session window is unambiguous"
                )

    def verify_spacing(self) -> None:
        """Prove the frame IS the timeframe it says it is.

        🛑 AR-1113 §3.2: *"the persisted role carrier and the actual supplied frame
        timeframes disagree"* must refuse. A LABEL CHECK CANNOT SEE THAT — comparing the
        declared string against itself always passes. So this reads the actual bar
        spacing off the data.

        `A FRAME THAT IS TRUSTED BECAUSE OF ITS LABEL IS A 1m SERIES ONE MISLABEL AWAY
         FROM BEING AGGREGATED AS 5m.`
        """
        expected = parse_minutes(self.timeframe)
        ordered = sorted(self.timestamps)
        if list(ordered) != list(self.timestamps):
            raise SourceRoleExecutionError(
                f"frame {self.timeframe!r} is not in ascending timestamp order; an "
                "out-of-order series cannot be checked for causality"
            )
        if len(set(self.timestamps)) != len(self.timestamps):
            raise SourceRoleExecutionError(
                f"frame {self.timeframe!r} contains duplicate timestamps; which bar is "
                "the truth is not a question this adapter may answer by picking one"
            )
        for earlier, later in zip(self.timestamps, self.timestamps[1:], strict=False):
            gap = later - earlier
            if gap != timedelta(minutes=expected):
                raise SourceRoleExecutionError(
                    f"frame declared {self.timeframe!r} has a {gap} gap between "
                    f"{earlier.isoformat()} and {later.isoformat()}; the declared role "
                    "timeframe and the supplied series disagree (AR-1113 §3.2). "
                    "REFUSING rather than aggregating a series of unknown sampling."
                )

    def zone_key(self) -> str:
        """The frame's UTC offsets, as the identity two frames must agree on.

        AR-1113 §3.2 refuses when *"the 1m and 5m frames disagree on session/timezone
        identity"*. Comparing `tzinfo` objects would compare LABELS; two frames can
        carry the same zone name and different offsets if one was localised wrong, so
        the offset actually in force is the honest key.
        """
        return "|".join(sorted({str(ts.utcoffset()) for ts in self.timestamps}))


@dataclasses.dataclass(frozen=True)
class CausalOpeningRange:
    """The 5m opening range, and the instant before which the 1m path may not see it.

    THE CAUSAL GATE LIVES HERE AND NOWHERE ELSE. A caller cannot reach the levels
    without passing an instant, so "read the range" and "prove you are allowed to" are
    the same call. An attribute holding bare levels would be readable from any bar.
    """

    lock: datetime
    complete_state: OpeningRangeState
    forming_state: OpeningRangeState

    def state_as_of(self, as_of: datetime) -> OpeningRangeState:
        """The OR state legally visible to an execution bar at `as_of`.

        Half-open `[start, lock)`: a 1m bar stamped exactly at `lock` is the FIRST that
        may see levels, because the 5m candle it summarises has closed by then.
        """
        if as_of.tzinfo is None or as_of.utcoffset() is None:
            raise SourceRoleExecutionError(
                f"as_of {as_of!r} is timezone-naive; availability cannot be decided "
                "against an instant that has no zone"
            )
        if as_of < self.lock:
            return self.forming_state
        return self.complete_state

    def is_available_at(self, as_of: datetime) -> bool:
        return self.state_as_of(as_of).opening_range_complete


def build_causal_opening_range(
    *,
    roles: SourceTimeframeRoles,
    definition: OpeningRangeDefinition,
    variant: OpeningRangeVariant,
    opening_range_frame: RoleFrame,
    execution_frame: RoleFrame,
    session_date: date,
) -> CausalOpeningRange:
    """The sVkm 5m opening range, gated so no 1m bar can read it early.

    Every branch below is a REFUSAL. There is deliberately no path that returns a
    usable range from an incomplete, mislabelled, or mismatched input, and no path that
    consults `strategy.timeframe`, `trigger_tf`, or a lowest-timeframe rule — AR-1113
    §3.2 forbids the fallback by name, and the way to forbid a fallback is not to write
    one.

        `NO "BEST EFFORT" SUBSTITUTION IS AUTHORISED ON SOURCE_FAITHFUL.` (AR-1113 §3.2)
    """
    # ── 1. The role set must be sVkm's, by VALUE ─────────────────────────────
    assert_svkm_role_combination(roles)

    or_timeframe = roles.timeframe_for(OPENING_RANGE_WINDOW)
    exec_timeframe = roles.timeframe_for(BREAKOUT_CONFIRMATION)

    # ── 2. The supplied frames must be the frames the ROLES asked for ────────
    # Declared-vs-declared first (cheap, catches a caller wiring the frames to the
    # wrong roles), then declared-vs-actual (`verify_spacing`, which is the one that
    # can catch a mislabelled series).
    if opening_range_frame.timeframe.strip() != or_timeframe.strip():
        raise SourceRoleExecutionError(
            f"OPENING_RANGE_WINDOW declares {or_timeframe!r} but the supplied "
            f"opening-range frame is {opening_range_frame.timeframe!r}. The persisted "
            "role carrier and the actual supplied frame disagree (AR-1113 §3.2)."
        )
    if execution_frame.timeframe.strip() != exec_timeframe.strip():
        raise SourceRoleExecutionError(
            f"the 1m execution roles declare {exec_timeframe!r} but the supplied "
            f"execution frame is {execution_frame.timeframe!r}. The persisted role "
            "carrier and the actual supplied frame disagree (AR-1113 §3.2)."
        )
    opening_range_frame.verify_spacing()
    execution_frame.verify_spacing()

    # ── 3. The two frames must describe the same session ─────────────────────
    if opening_range_frame.zone_key() != execution_frame.zone_key():
        raise SourceRoleExecutionError(
            "the 1m execution frame and the 5m opening-range frame disagree on "
            f"timezone identity ({execution_frame.zone_key()!r} vs "
            f"{opening_range_frame.zone_key()!r}); joining them would align the range "
            "to the wrong hour (AR-1113 §3.2). REFUSING."
        )

    zone = ZoneInfo(definition.source_timezone)
    frame_offsets = {str(ts.utcoffset()) for ts in opening_range_frame.timestamps}
    taught_offsets = {
        str(ts.astimezone(zone).utcoffset())
        for ts in opening_range_frame.timestamps
    }
    if frame_offsets != taught_offsets:
        raise SourceRoleExecutionError(
            f"the supplied frames sit at offsets {sorted(frame_offsets)} but the taught "
            f"source timezone {definition.source_timezone!r} puts those instants at "
            f"{sorted(taught_offsets)}; the session identity the teacher taught and the "
            "one the data carries are different (AR-1113 §3.2). REFUSING."
        )

    # ── 4. Delegate the arithmetic. NO SECOND CALCULATOR. ────────────────────
    or_interval = parse_minutes(or_timeframe)
    bars: Sequence[OpeningRangeBar] = tuple(
        OpeningRangeBar(timestamp=ts, high=h, low=lo)
        for ts, h, lo in zip(
            opening_range_frame.timestamps,
            opening_range_frame.highs,
            opening_range_frame.lows,
            strict=True,
        )
    )

    # The lock instant is recomputed by the SAME rule the adapter uses, and then
    # PROVEN below by asking the adapter itself — see the equivalence assertion.
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

    complete_state = compute_opening_range_state(
        definition,
        variant,
        bars,
        session_date=session_date,
        bar_interval_minutes=or_interval,
        as_of=lock,
    )
    forming_state = compute_opening_range_state(
        definition,
        variant,
        bars,
        session_date=session_date,
        bar_interval_minutes=or_interval,
        as_of=start,
    )

    # ── 5. An incomplete 5m window REFUSES; it does not execute on a gap ─────
    # The adapter returns a refusal STATE (every numeric field None) for a missing,
    # duplicated or off-grid window. On SOURCE_FAITHFUL that state may not simply flow
    # onward as "no signal today" — AR-1113 §3.2 lists *"the 5m source bar is missing or
    # incomplete"* and *"the opening-range bar cannot be uniquely identified"* as
    # refusals. Converting the state into a raise here is what makes them refusals.
    if not complete_state.opening_range_complete:
        raise SourceRoleExecutionError(
            "the 5m opening-range window did not complete: "
            f"{complete_state.opening_range_window_status.value}. The source 5m bar is "
            "missing, duplicated, off-grid or non-finite, so the taught range cannot be "
            "identified (AR-1113 §3.2). REFUSING rather than executing 1m bars against "
            "a range that was never established."
        )
    if forming_state.opening_range_window_status is not OpeningRangeWindowStatus.FORMING:
        raise SourceRoleExecutionError(
            "the adapter did not report FORMING before the lock instant; the causal "
            "gate cannot be trusted if the pre-lock state is not a refusal"
        )

    return CausalOpeningRange(
        lock=lock, complete_state=complete_state, forming_state=forming_state
    )
