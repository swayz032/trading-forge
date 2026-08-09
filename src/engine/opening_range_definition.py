"""B1 STEP 3 — the precise typed representation of a taught OPENING RANGE.

AUTHORITY: R-730 §4, executing `EXTERNAL-READ-2026-08-09-STEP3-RELEASED.md`
`STEP 3 CONTRACT`. First production code this campaign has authorized on the
money path. Pre-live, AUTONOMOUS class, `ratify-packet` staged at R-727 §3.

WHY THIS TYPE EXISTS
--------------------
R-725 §2: an opening range is **not** merely "a level construct, not a clock
window". It is a TIME-BOUNDED STATEFUL AGGREGATION THAT PRODUCES LEVELS — clock
window PLUS high/low aggregation PLUS completion state PLUS level references.
The production classifier preserved only the level half and sealed the condition
into `WAIT_STRUCTURE`, a family whose evaluator emits market-structure EVENTS and
has no field an opening range can live in.

`A CLASSIFIER THAT PRESERVES ONE OF TWO DIMENSIONS HAS NOT CLASSIFIED — IT HAS
PROJECTED.` This module is the type that holds both dimensions at once.

WHAT THIS MODULE IS NOT (R-730 §4, scope)
-----------------------------------------
It is a REPRESENTATION ONLY. There is deliberately no adapter, no evaluator, no
bar handling and no arithmetic over market data here — those are STEP 4. Asking
this module for computed state returns a REFUSAL (see `refused_state`), and
`R-730 §4` states that temporary refusal is explicitly the correct behaviour:

    "the new type MAY TEMPORARILY REFUSE because its adapter does not exist yet
     — that is explicitly SAFE. It must NEVER fall back to compute_structure_state."

`A REFUSAL IS AN HONEST OFF STATE; A SILENT WRONG ANSWER IS NOT.`

THREE INVARIANTS THIS TYPE ENFORCES BY CONSTRUCTION
---------------------------------------------------
1. **NO DEFAULT DURATION.** There is no module-level default and no duration
   field on the definition itself. A default is a silent choice, and the taught
   material offers three alternatives.
2. **NO SILENT SELECTION AMONG THE TAUGHT ALTERNATIVES.** The teacher presented
   5, 15 and 30 minutes as explicit alternatives, so all three are carried and
   none is chosen. `WHERE THE TEACHER OFFERED ALTERNATIVES, ENUMERATING THEM IS
   FIDELITY; CHOOSING ONE IS INVENTION.` (R-725 §5-2)
3. **WIDTH AND MIDPOINT ARE FORMULAS, NEVER PARAMETERS.** The source works one
   example arithmetic ("about 52 cents" off a $1.03 range). Writing `0.52` into
   a level slot would hardcode one day's arithmetic as the strategy — the exact
   invariant-1 violation this campaign exists to prevent (R-725 §5-1). The rule
   is dynamic: `width = high - low`, `midpoint = (high + low) / 2`.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

# The canonical typed subtype. Named here as the single source of truth so the
# classifier, the family declaration and the conformance suite cannot drift.
CANONICAL_TYPE: str = "OPENING_RANGE_DEFINITION"

# The refusal emitted when a session's opening window is not exactly complete.
# A B1 PASS TERM (R-727 §4-2), not a nice-to-have: a partial window does NOT
# refuse today — it silently returns a NARROWER range, which moves breakout
# thresholds INWARD. `THE FAILURE MODE OF A MISSING BAR IS NOT SILENCE — IT IS A
# CONFIDENT, TIGHTER RANGE WITH NO FLAG RAISED ANYWHERE.`
INCOMPLETE_OPENING_WINDOW: str = "INCOMPLETE_OPENING_WINDOW"


class OpeningRangeWindowStatus(str, Enum):
    """Lifecycle of one session's opening-range window.

    `ADAPTER_NOT_IMPLEMENTED` is the STEP 3 state and it is a REFUSAL, not a
    placeholder that quietly reads as success. It disappears when STEP 4 lands.
    """

    FORMING = "FORMING"
    """Inside [start, lock) — no locked range exists yet. Reading levels here
    would be lookahead."""

    COMPLETE = "COMPLETE"
    """The window closed with every expected observation present."""

    INCOMPLETE_OPENING_WINDOW = INCOMPLETE_OPENING_WINDOW
    """The window closed with observations missing, duplicated or off-grid. No
    usable state and no dependent signal for that session."""

    ADAPTER_NOT_IMPLEMENTED = "ADAPTER_NOT_IMPLEMENTED"
    """STEP 3: the typed representation exists but no adapter computes it yet."""


@dataclass(frozen=True)
class OpeningRangeProvenance:
    """Where this definition came from, so a later reader can re-derive it.

    Deliberately carries NO video id, strategy id, artifact path or strategy
    name as a module constant — those arrive as DATA on an instance. Hardcoding
    any of them was forbidden explicitly (read, STEP 3), and it is also what
    would make this type fit one video instead of expressing a concept.
    """

    source_quote: str
    """The taught sentence this definition was lowered from, verbatim."""

    condition_id: str
    """The produced condition this definition belongs to."""


@dataclass(frozen=True)
class OpeningRangeVariant:
    """ONE source-sanctioned alternative window, with its own taught evidence.

    `duration_minutes` has NO DEFAULT, here or anywhere. That is invariant 1:
    a default duration is a silent choice wearing a convenience costume.
    """

    variant_label: str
    duration_minutes: int
    source_quote: str

    def __post_init__(self) -> None:
        if self.duration_minutes <= 0:
            raise ValueError(
                f"opening-range duration must be positive; got {self.duration_minutes!r} "
                f"for variant {self.variant_label!r}"
            )


@dataclass(frozen=True)
class OpeningRangeDefinition:
    """A taught opening range, with BOTH dimensions preserved.

    SOURCE-OWNED (what the teacher said):
      session_start_local · source_timezone · variants · market_scope ·
      trading_day_rule · provenance

    FRAMEWORK / DATA-CONTRACT (what the runtime must supply before any state can
    be computed) is deliberately NOT stored here — bar interval, interval
    convention, session-date convention and completeness policy belong to the
    STEP 4 adapter, and putting them on the source-owned type would blur which
    side of the boundary a value came from.
    """

    session_start_local: str
    """Taught session start as a local wall-clock string, e.g. "09:30"."""

    source_timezone: str
    """IANA zone the taught start is expressed in, e.g. "America/New_York".
    An IANA zone, never a fixed UTC offset — a fixed offset is wrong for half
    the year and the error is silent."""

    variants: tuple[OpeningRangeVariant, ...]
    """EVERY taught alternative, in taught order, none selected. See
    `selected_duration_minutes` for why there is no chosen one."""

    market_scope: str
    """The market the teacher actually demonstrated on. R-725 §5-3 is binding:
    compile within the demonstrated scope and never present a transfer to
    another market as the source-faithful result. `PROFITABILITY ON FUTURES
    CANNOT RETROACTIVELY PROVE THE TEACHER TAUGHT IT FOR FUTURES.`"""

    trading_day_rule: str
    """How the window resets across days, in the source's own terms."""

    provenance: OpeningRangeProvenance

    def __post_init__(self) -> None:
        if not self.variants:
            raise ValueError(
                "an opening-range definition must carry at least one taught variant; "
                "an empty variant set would let a downstream default fill the gap"
            )
        labels = [v.variant_label for v in self.variants]
        if len(set(labels)) != len(labels):
            raise ValueError(f"duplicate taught variant labels: {labels}")

    @property
    def selected_duration_minutes(self) -> int:
        """DELIBERATELY UNAVAILABLE — invariant 2.

        Every caller that wants "the" duration is about to make a choice the
        teacher did not make. Raising here is what stops that choice being made
        silently three layers down. STEP 4 must pass a variant explicitly.
        """
        raise NotImplementedError(
            f"{CANONICAL_TYPE} carries {len(self.variants)} source-sanctioned alternatives "
            f"({', '.join(v.variant_label for v in self.variants)}) and selects NONE of them. "
            "The teacher offered these as alternatives; choosing one here would be invention, "
            "not compilation. Pass the intended variant explicitly."
        )


@dataclass(frozen=True)
class OpeningRangeState:
    """Computed opening-range state for ONE session.

    This is the output contract the B1 STEP 2 conformance suite requires
    production to be able to produce. Its six field names are load-bearing and
    are asserted by that suite.

    `opening_range_width` and `opening_range_midpoint` are DERIVED, never
    supplied — see `from_levels`. Accepting them as inputs is what would let one
    day's worked arithmetic be stored as the strategy.
    """

    opening_range_high: float | None
    opening_range_low: float | None
    opening_range_width: float | None
    opening_range_midpoint: float | None
    opening_range_complete: bool
    opening_range_window_status: OpeningRangeWindowStatus

    @classmethod
    def from_levels(cls, high: float, low: float) -> "OpeningRangeState":
        """The ONLY way to build a usable state: from the two aggregated levels.

        Width and midpoint are computed here from the taught formulas so no
        caller can supply them. `FILLING AN EMPTY SLOT WITH THE EXAMPLE'S ANSWER
        WOULD HARDCODE ONE DAY'S ARITHMETIC AS THE STRATEGY.`
        """
        if high < low:
            raise ValueError(
                f"opening-range high {high!r} is below low {low!r}; the aggregation is inverted"
            )
        return cls(
            opening_range_high=high,
            opening_range_low=low,
            opening_range_width=high - low,
            opening_range_midpoint=(high + low) / 2,
            opening_range_complete=True,
            opening_range_window_status=OpeningRangeWindowStatus.COMPLETE,
        )

    @classmethod
    def refused(cls, status: OpeningRangeWindowStatus) -> "OpeningRangeState":
        """A refusal: no levels, no usable state, no dependent signal.

        Used for `INCOMPLETE_OPENING_WINDOW`, for `FORMING`, and — for the whole
        of STEP 3 — for `ADAPTER_NOT_IMPLEMENTED`. Every field a consumer might
        read is None, so a consumer that ignores the status still cannot obtain a
        number. `FAIL CLOSED` is enforced by the shape, not by a convention.
        """
        if status is OpeningRangeWindowStatus.COMPLETE:
            raise ValueError(
                "COMPLETE is not a refusal state; build it with from_levels() so width and "
                "midpoint are derived rather than supplied"
            )
        return cls(
            opening_range_high=None,
            opening_range_low=None,
            opening_range_width=None,
            opening_range_midpoint=None,
            opening_range_complete=False,
            opening_range_window_status=status,
        )


def refused_state() -> OpeningRangeState:
    """The STEP 3 state for every opening-range definition: an explicit refusal.

    STEP 4 replaces this with the typed adapter. Until then this is what the
    engine can honestly say, and it is deliberately NOT a fallback to
    `structure_engine.compute_structure_state` — that route is the defect B1
    exists to remove, and returning to it under any condition would ship the
    defect behind a new name.
    """
    return OpeningRangeState.refused(OpeningRangeWindowStatus.ADAPTER_NOT_IMPLEMENTED)
