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

import re
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


# --------------------------------------------------------------------------- #
# THE ORDERED DISCRIMINATION RULE (R-731 §2, widened to two members at R-732 §2)
# --------------------------------------------------------------------------- #
# WHY IT LIVES HERE AND NOT IN THE CLASSIFIER, AND NOT IN THE INSTRUMENT.
# `_classify_family` imports it; `docs/replay-results/h1-battery/
# opening_range_definition_discrimination.py` imports it too. ONE rule, two
# readers. If the measurement instrument kept its own copy, the six controls
# would drift away from production and go on passing while testing a rule
# nothing runs -- the shape this campaign convicts as a dead control.
#
# WHY THE ORDER IS THE MECHANISM. R-730 §2 first stated the rule as a
# conjunction, "clock window AND range construction". AR-824 refuted it by
# measurement: the breakout sentence
#
#     "...projected going out after this 30 minute range is over ... we look
#      for a breakout"
#
# carries BOTH halves. R-731 §2 amended the design to ORDERED SEMANTIC EVIDENCE:
#
#     STAGE 1  reference/trigger evidence  -> REFUSE (blocks, whatever else is present)
#     STAGE 2  positive definition evidence -> require explicit clock AND construction
#     STAGE 3  anaphoric-only clock         -> REFUSE (carries no typed duration)
#
# WHY THIS IS NOT A `breakout` BLACKLIST. R-731 §2 forbids that explicitly, and
# the reason is this campaign's own: `GOVERN WITH A CLOSED RULE, NOT AN OPEN
# LIST` -- a blacklist is a membership test over a list you can never finish.
# Stage 1 tests a SEMANTIC RELATION with three closed classes, each a way of
# positioning the range as ALREADY CONSTRUCTED. The classes are the rule; the
# patterns are evidence FOR them. A new phrasing is therefore a question about
# which class it belongs to, not a request to extend a list.
#
# 🛑 NO VIDEO OR STRATEGY ID APPEARS BELOW, BY RULING (R-732 §2). The
# authorization is SEMANTIC. `AN ID IN PRODUCTION CODE IS A CLASSIFIER THAT HAS
# MEMORISED ITS ANSWER; AN ID IN A TEST IS A POPULATION ASSERTION.` The frozen
# two-member population is pinned in the TESTS, where it belongs.

_REFERENCE_CLASSES: dict[str, re.Pattern] = {
    # A directional relation between price and an EXISTING boundary.
    "CROSSING": re.compile(
        r"\b(?:break|breaks|breaking|broke|breakout|cross|crosses|crossing|"
        r"close[sd]?\s+(?:above|below|outside|inside)|pierce[sd]?)\b",
        re.IGNORECASE,
    ),
    # An action taken with respect to an EXISTING range.
    "CONSUMPTION": re.compile(
        r"\b(?:enter|entry|entries|look\s+for|wait\s+for|target|stop\s+(?:loss|below|above)|"
        r"take\s+profit|project(?:ing|ed)?)\b",
        re.IGNORECASE,
    ),
    # A time relation to the range's COMPLETION -- the range must already exist
    # for "after it is over" to mean anything.
    "POSTERIORITY": re.compile(
        r"\b(?:after|once)\b[^.]{0,80}?\b(?:is\s+over|has\s+(?:closed|formed|completed)|"
        r"complete[ds]?|finished)\b",
        re.IGNORECASE,
    ),
}

# An EXPLICIT clock or duration. Digits are REQUIRED, and that is what makes
# stage 3 fall out as a consequence rather than a separate special case.
_EXPLICIT_CLOCK = re.compile(
    r"\b\d{1,2}\s*[:.]\s*\d{2}\b"                     # 9:30, 09:35
    r"|\b\d{1,3}\s*-?\s*(?:minute|minutes|min)\b",    # 5 minute, 30-minute
    re.IGNORECASE,
)

# FORMATION / ESTABLISHMENT / CALCULATION / HIGH-LOW CONSTRUCTION / PRICE
# CAPTURED DURING THE WINDOW (read, PART 2 item 2).
_CONSTRUCTION = re.compile(
    r"\b(?:forms?|forming|formed|establish(?:es|ed|ing)?|"
    r"gives?\s+us|is\s+what\s+(?:forms|gives)|captur(?:e|ed|ing)|"
    r"take\s+the\s+.{0,40}?high|high\s+and\s+the?\s*.{0,20}?low|"
    r"difference\s+between\s+the\s+high)\b",
    re.IGNORECASE,
)

# A window referred to by pronoun, carrying no typed duration. Matched only so
# the refusal REASON can name stage 3 explicitly -- R-731 §4 requires refusals to
# be explicit and measured, and "no clock found" would hide which stage refused.
_ANAPHORIC_CLOCK = re.compile(
    r"\b(?:these|those|this|that)\s+(?:time\s+periods?|periods?|windows?|ranges?|candles?)\b",
    re.IGNORECASE,
)


def classify_opening_range_definition(text: str) -> tuple[bool, str, dict]:
    """Is this prose a taught opening-range DEFINITION?

    Returns `(is_definition, reason, evidence)`. The REASON is always a named
    refusal or `DEFINITION` -- never a bare False -- so a caller (and the
    committed six-control instrument) can see WHICH stage decided, and so a
    future disagreement is resolvable by reading the reason rather than
    re-deriving the rule.
    """
    reference_hits = {
        name: match.group(0)
        for name, pattern in _REFERENCE_CLASSES.items()
        if (match := pattern.search(text))
    }
    clock = _EXPLICIT_CLOCK.search(text)
    construction = _CONSTRUCTION.search(text)
    anaphoric = _ANAPHORIC_CLOCK.search(text)

    evidence = {
        "reference_classes": reference_hits,
        "explicit_clock": clock.group(0) if clock else None,
        "construction": construction.group(0) if construction else None,
        "anaphoric_clock": anaphoric.group(0) if anaphoric else None,
    }

    # STAGE 1 -- reference evidence BLOCKS, whatever else the sentence carries.
    # This is the stage that keeps "break above the opening-range high" out, and
    # keeping it out is what stops STEP 3 quietly deciding the breakout trigger.
    if reference_hits:
        return False, f"REFUSED_STAGE_1_REFERENCE[{'+'.join(sorted(reference_hits))}]", evidence
    # STAGE 3 -- an anaphoric clock supplies no typed duration.
    if clock is None:
        reason = "REFUSED_STAGE_3_ANAPHORIC_CLOCK" if anaphoric else "REFUSED_NO_EXPLICIT_CLOCK"
        return False, reason, evidence
    # STAGE 2 -- both limbs required.
    if construction is None:
        return False, "REFUSED_NO_CONSTRUCTION_EVIDENCE", evidence
    return True, "DEFINITION", evidence
