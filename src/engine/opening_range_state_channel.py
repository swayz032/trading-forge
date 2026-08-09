"""B1 STEP 6B — the typed `STATE_PRODUCER` output channel.

AUTHORITY: `R-743 §5`–`§6` (Option A, adopted), `R-744 §6`.

WHY THIS MODULE EXISTS
----------------------
The compiler's per-condition executable contract is ONE BOOLEAN PER BAR
(`spec_condition_compiler.py:1634` writes `np.ndarray` into `per_condition_bool`).
An opening range is not a boolean: it is six fields, four of them numeric. There
was no channel that preserved it, and `AR-837` stopped on exactly that
(`TEMPORAL_STATE_CHANNEL_MISSING`).

    `DO NOT FIT A STATE PRODUCER INTO THE WRONG INTERFACE TO TURN THE ORDERED
     REDS GREEN.` (`R-743 §7`)

So this is a SECOND, PARALLEL lane. A `STATE_PRODUCER` binding never writes
`per_condition_bool`, and therefore — as `AR-839 §2` measured and `R-744 §1`
independently confirmed at the executable line — it cannot reach the boolean
conjunction, the trigger mask, or the entry-decision population. That exclusion
is a TYPE-LEVEL property of not writing the dict, not a rule someone must
remember.

WHAT IS DELIBERATELY REFUSED HERE
---------------------------------
`__bool__` RAISES on both types below. `R-743 §6` requires "no accidental
boolean conversion or boolean-array participation", and the cheapest way for
that requirement to be quietly violated is `if state:` somewhere downstream
reading as "we have a range". A truthiness test on a state record is always a
mistake here, so it fails loudly instead of answering.

    `A TYPE THAT ANSWERS A QUESTION IT SHOULD REFUSE IS HOW THE WRONG LANE GETS
     RE-CREATED UNDER A NEW NAME.`

WHAT THIS MODULE IS NOT
-----------------------
It is not a general indicator framework (`R-743 §5` is explicit that the lane is
narrow), it does not compute anything itself (the real arithmetic lives in
`opening_range_adapter.compute_opening_range_state`), and it carries no trading
decision: an opening range is context, never an entry.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from src.engine.opening_range_definition import (
    OpeningRangeState,
    OpeningRangeWindowStatus,
)

CHANNEL_SCHEMA: str = "opening_range_state_channel/v1"

CARRIER_KEY: str = "opening_range_candidates"
"""The compiled-spec key the producer attaches execution candidates under.

DELIBERATELY OUTSIDE `compiled_spec["spec"]`. `spec_producer._spec_hash` hashes the ENTIRE
spec body, so a field added INSIDE it would move `spec_hash` for every affected spec — and
`spec_hash` values are pinned in frozen artifacts (`passage-ledger.json`, `trial-counter.json`,
`packet2-inventory-22.json`). Attaching at the artifact's top level makes this carrier
HASH-NEUTRAL BY CONSTRUCTION rather than by a measurement someone has to re-take."""

# ── Named reasons for a state producer that ran and resolved nothing ─────────
# Strings, enumerated here rather than written inline at each site, so a consumer
# can branch on them and a test can require a SPECIFIC refusal rather than "some"
# refusal — an assertion that accepts any reason cannot tell a working lane from a
# broken one.
REASON_NO_CANDIDATE_CARRIER: str = "opening_range_candidates_not_carried_on_compiled_spec"
"""The condition bound and executed, but no lowered candidates travelled with the
compiled spec. This is the honest state for any spec built without the producer —
NOT an error, and NOT silently an empty range."""

REASON_TIMESTAMPS_NAIVE: str = "opening_range_bar_timestamps_are_timezone_naive"
"""The frame's timestamps carry no zone. Refused rather than assumed to be in the
taught zone: `wall-clock without a zone is not a moment in time, and guessing one
silently is how a range gets computed off the wrong hour for half the year`
(`opening_range_adapter.OpeningRangeBar`)."""

REASON_UNRESOLVABLE_BAR_INTERVAL: str = "opening_range_bar_interval_unresolvable_from_timeframe"
"""The strategy's timeframe string does not resolve to whole minutes, so
"complete window" has no definition. A refusal, never a rounding."""


class BooleanConversionRefused(TypeError):
    """Raised when something asks a typed state record for its truth value.

    A dedicated type rather than a bare `TypeError` so a test can require THIS
    refusal rather than any `TypeError` that happens to escape — an assertion
    that accepts any exception cannot tell a working guard from a typo.
    """


@dataclass(frozen=True)
class OpeningRangeCandidateState:
    """ONE execution candidate's computed opening-range state, fully typed.

    Carries the whole shape `R-743 §6` adopted verbatim from the read: candidate
    id · cache identity · duration/variant · session start · timezone ·
    trading-day rule · source condition id · provenance · high · low · width ·
    midpoint · completion · window status.

    NEVER a free-form dict. A dict would let a downstream consumer read a key
    that was never computed and get `None` back with no way to tell "refused"
    from "absent from this build".
    """

    candidate_id: str
    """WHICH candidate — `OpeningRangeExecutionCandidate.candidate_id`."""

    session_date: date
    """WHICH SESSION. An opening range is a PER-SESSION fact: the window reopens
    every trading day (that is what `trading_day_rule` records), so one state per
    candidate would be one day's arithmetic standing in for the strategy — the
    exact thing `OpeningRangeState.from_levels` refuses to let a caller supply.
    `R-744 §6(3)` requires three typed SERIES, and a series needs this key."""

    cache_identity: str
    """WHICH VERSION — the SHA-256 over the candidate's canonical payload. Two
    candidates that differ in any taught field differ here."""

    variant_label: str
    duration_minutes: int
    """The taught alternative this state was computed for. There is no selected
    duration anywhere in this lane: `OpeningRangeDefinition.selected_duration_
    minutes` raises on purpose, and every candidate carries its own."""

    session_start_local: str
    source_timezone: str
    trading_day_rule: str
    market_scope: str
    """SOURCE-OWNED facts, copied from the definition so a reader of one state
    record never has to go back to the definition to know what it describes."""

    source_condition_id: str
    source_spec_id: str
    source_quote: str
    """PROVENANCE. `source_quote` is the taught sentence this was lowered from,
    verbatim — the thing that makes a disagreement auditable against the video
    rather than against someone's memory of it."""

    state: OpeningRangeState
    """The computed levels, or an explicit refusal. Nested rather than flattened
    so the refusal semantics of `OpeningRangeState` (every numeric field `None`
    unless `COMPLETE`) survive intact and cannot be half-copied."""

    def __bool__(self) -> bool:
        raise BooleanConversionRefused(
            f"{type(self).__name__} has no truth value. An opening-range state is "
            "context with four numeric fields, not a gate; converting it to a bool "
            "is how a state producer silently re-enters the boolean lane "
            "(R-743 §6). Read `.state.opening_range_window_status` or "
            "`.is_complete` and say which question you are asking."
        )

    @property
    def is_complete(self) -> bool:
        """The EXPLICIT question `__bool__` refuses to guess at."""
        return self.state.opening_range_complete

    @property
    def opening_range_high(self) -> float | None:
        return self.state.opening_range_high

    @property
    def opening_range_low(self) -> float | None:
        return self.state.opening_range_low

    @property
    def opening_range_width(self) -> float | None:
        return self.state.opening_range_width

    @property
    def opening_range_midpoint(self) -> float | None:
        return self.state.opening_range_midpoint

    @property
    def opening_range_window_status(self) -> OpeningRangeWindowStatus:
        return self.state.opening_range_window_status

    def numeric_triple(self) -> tuple[float | None, float | None, float | None, float | None]:
        """`(high, low, width, midpoint)` — the discriminating tuple.

        `R-743 §3` / `R-744 §6(4)`: the two ordered conformance REDs are
        NECESSARY AND NOT SUFFICIENT, because `RED #2` reads a return annotation
        and never invokes the primitive — a module returning `refused_state()`
        unconditionally turns it green. Three candidates producing three
        DELIBERATELY DIFFERENT tuples here is what a stub cannot fake, so this
        accessor exists to make that comparison direct rather than reconstructed
        by each caller.
        """
        return (
            self.opening_range_high,
            self.opening_range_low,
            self.opening_range_width,
            self.opening_range_midpoint,
        )


@dataclass
class OpeningRangeStateChannel:
    """The PUBLIC production output surface for opening-range state.

    `R-743 §6`, the read's strongest clause, adopted verbatim: *"writing values
    into an internal cache that no public production consumer can read does not
    satisfy this contract."* That is `EXISTENCE IS NOT WIRING` stated correctly,
    so this object is reachable from the strategy by a public accessor and its
    contents are readable without touching a private attribute.

    Ordered, never a set or a dict-of-dicts: candidates are expanded in TAUGHT
    ORDER and that order is part of what a reader is entitled to see.
    """

    schema: str = CHANNEL_SCHEMA
    _states: list[OpeningRangeCandidateState] = field(default_factory=list)
    _unresolved: list[tuple[str, str]] = field(default_factory=list)

    def note_unresolved(self, condition_id: str, reason: str) -> None:
        """Record that a state-producer condition EXECUTED but produced no state.

        WHY THIS IS NOT AN EMPTY LIST. An empty channel has two completely
        different causes — "no opening-range condition ran" and "one ran and
        could not be resolved" — and a reader cannot tell them apart from
        emptiness alone. `AN EXPECTED ABSENCE THAT NOBODY WROTE DOWN IS
        INDISTINGUISHABLE FROM A REGRESSION` (`AR-839 §3`), so the lane records
        WHY rather than leaving the reader to guess.
        """
        if not reason:
            raise ValueError(
                f"unresolved state for condition {condition_id!r} carries no reason; an "
                "unexplained absence cannot be told apart from a lane that never ran"
            )
        self._unresolved.append((condition_id, reason))

    def unresolved(self) -> tuple[tuple[str, str], ...]:
        """`(condition_id, reason)` for every state producer that ran and resolved nothing."""
        return tuple(self._unresolved)

    def record(self, state: OpeningRangeCandidateState) -> None:
        """Append one `(candidate, session)` state.

        Duplicate `(candidate_id, session_date)` is a hard error rather than an
        overwrite: a second write under the same key means the lane ran twice for
        one session, and silently keeping the last one would hide that.
        """
        key = (state.candidate_id, state.session_date)
        if key in {(s.candidate_id, s.session_date) for s in self._states}:
            raise ValueError(
                f"candidate {state.candidate_id!r} already has recorded state for session "
                f"{state.session_date.isoformat()}; a second write means the state lane "
                "executed twice for one session, and overwriting it would hide the "
                "duplication rather than report it"
            )
        self._states.append(state)

    def states(self) -> tuple[OpeningRangeCandidateState, ...]:
        """Every recorded state, in the order recorded."""
        return tuple(self._states)

    def candidate_ids(self) -> tuple[str, ...]:
        """Distinct candidate ids, in first-recorded (taught) order."""
        seen: list[str] = []
        for s in self._states:
            if s.candidate_id not in seen:
                seen.append(s.candidate_id)
        return tuple(seen)

    def series_for(self, candidate_id: str) -> tuple[OpeningRangeCandidateState, ...]:
        """ONE candidate's per-session series, in the order recorded.

        This is the accessor `R-744 §6(3)`'s "three typed state series publicly
        observable" is satisfied by: three candidate ids, three series, each
        readable without touching a private attribute.
        """
        return tuple(s for s in self._states if s.candidate_id == candidate_id)

    def by_candidate_and_session(
        self, candidate_id: str, session_date: date
    ) -> OpeningRangeCandidateState | None:
        for s in self._states:
            if s.candidate_id == candidate_id and s.session_date == session_date:
                return s
        return None

    def __len__(self) -> int:
        return len(self._states)

    def __bool__(self) -> bool:
        raise BooleanConversionRefused(
            "OpeningRangeStateChannel has no truth value. `if channel:` reads as "
            "'a range exists' while actually asking 'is the list non-empty', and "
            "those diverge the moment a candidate refuses. Ask `len(channel)` or "
            "inspect the states explicitly."
        )
