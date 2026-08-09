"""B1 STEP 6B — the entry-eligibility surface.

AUTHORITY: `R-744 §4`, ordered as a PROPERTY rather than as a field list:

    *"the production surface must make `boolean spine satisfied` and `this
    strategy may enter` NON-EQUIVALENT AND SEPARATELY READABLE, and must carry
    the reason entry is refused."*

WHY THIS IS NOT COSMETIC, AND WHY IT IS PRE-EXISTING DEBT
---------------------------------------------------------
`spine_satisfied` is the AND of every gating condition. It is a SUBTOTAL. It has
never meant "this strategy may trade", and `R-744 §2` measured why that gap is
already open rather than opened by the state lane: the golden opening-range
condition carries `executed=False`, so it is ALREADY absent from
`per_condition_bool` today. `6B` does not change `spine_satisfied` at all — only
the CAUSE of the absence changes, from *"adapter not implemented"* to *"state
producer by design"*.

    `AN ABSENCE THAT ALREADY EXISTS IS NOT AN ABSENCE THE CHANGE CREATED — THE
     JOIN KEY IS CAUSE, NOT PRESENCE.` (`R-744`)

So this module repays debt that `6B` makes newly visible; it does not repair a
regression `6B` introduced, and it is not charged to the attempt budget
(`R-744 §7`).

THE ONE PROPERTY THIS TYPE ENFORCES
-----------------------------------
`may_enter` CANNOT BE REACHED FROM THE SUBTOTAL. It is not derived from
`boolean_spine_satisfied_bars` by any code path here, and the constructor
REFUSES to build a record that claims entry without a bound trigger. A consumer
that wants "tradable" must read a field that a satisfied spine cannot set.

`__bool__` raises for the same reason it does on the state channel: `if
eligibility:` is a question whose plausible reading ("we can trade") is exactly
the confusion this type exists to prevent.
"""

from __future__ import annotations

from dataclasses import dataclass

REASON_TRIGGER_UNRESOLVED: str = "trigger_UNRESOLVED_SOURCE_AMBIGUITY"
"""The golden strategy's standing refusal. `R-743 §6` / `R-739 §1`: the breakout
trigger is not resolvable from source, so there is no entry, no direction and no
trade — and a profitable backtest before that ambiguity is resolved from source
would prove INVENTION, not edge."""

REASON_NO_TRIGGER_BINDING: str = "trigger_not_bound"
"""No trigger condition bound at all. Distinct from the above on purpose: an
unresolvable source and an unbound engine primitive are different findings and
`TWO DIFFERENT SILENCES DESERVE TWO DIFFERENT NAMES` (`R-741 §2`)."""


class EligibilityConversionRefused(TypeError):
    """Raised when something asks the eligibility record for its truth value."""


@dataclass(frozen=True)
class EntryEligibility:
    """Whether this strategy may enter — stated SEPARATELY from the boolean subtotal.

    The two numbers travel together precisely so a reader can see that they
    disagree. Reporting only the subtotal is what made `spine_satisfied=True`
    read as executable.
    """

    boolean_spine_satisfied_bars: int
    """How many bars the gating conjunction was True on. A SUBTOTAL — it says
    nothing about whether an entry is permitted."""

    total_bars: int

    trigger_bound: bool
    """Whether an entry trigger is actually bound to an executable primitive.
    This is the field `may_enter` depends on and the subtotal cannot set."""

    may_enter: bool
    """Whether this strategy may enter a position. NEVER derived from the
    subtotal."""

    refusal_reason: str | None = None
    """Why entry is refused, in the engine's own vocabulary. Required whenever
    `may_enter` is False — a refusal that does not say why is indistinguishable
    from a value nobody computed."""

    def __post_init__(self) -> None:
        if self.may_enter and self.refusal_reason is not None:
            raise ValueError(
                f"may_enter=True carries refusal_reason {self.refusal_reason!r}; a record "
                "that both permits and refuses entry is two claims wearing one type"
            )
        if self.may_enter and not self.trigger_bound:
            raise ValueError(
                "may_enter=True with trigger_bound=False. A satisfied boolean subtotal is "
                "NOT an entry permission (R-744 §4): the gating conjunction can be True on "
                "every bar while no trigger is bound, and reaching 'tradable' from that "
                "subtotal is exactly the inference this type refuses to allow"
            )
        if not self.may_enter and not self.refusal_reason:
            raise ValueError(
                "may_enter=False with no refusal_reason; an unexplained refusal cannot be "
                "told apart from a field nobody filled in"
            )
        if self.boolean_spine_satisfied_bars < 0 or self.total_bars < 0:
            raise ValueError("bar counts cannot be negative")
        if self.boolean_spine_satisfied_bars > self.total_bars:
            raise ValueError(
                f"boolean_spine_satisfied_bars ({self.boolean_spine_satisfied_bars}) exceeds "
                f"total_bars ({self.total_bars}); the subtotal is not a subset of the run"
            )

    def __bool__(self) -> bool:
        raise EligibilityConversionRefused(
            "EntryEligibility has no truth value. `if eligibility:` reads as 'we may "
            "trade' while asking nothing of the kind. Read `.may_enter` — and if that "
            "is False, `.refusal_reason` says why."
        )
