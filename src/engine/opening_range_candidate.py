"""B1 STEP 6A — the typed OPENING RANGE EXECUTION CANDIDATE and its identity.

AUTHORITY: R-738 §3 (the carrier and what it may not contain), §7-2 (identity is
keyed on the full payload, never on duration alone), §8 requirement (11) (cache
identity stable across processes), R-740 §5/§7.

WHAT A CANDIDATE IS
-------------------
`OpeningRangeDefinition` carries EVERY taught alternative and selects none of
them — that is its whole point, and asking it for "the" duration raises. But
nothing can execute an alternative set. A candidate is the one object that says:
**this source condition, run with THIS taught variant** — and there is one per
taught variant, produced deterministically, with no default and no favourite.

    `THE TEACHER GAVE THREE VERSIONS, SO THE FACTORY MAKES THREE BOTS.
     IT DOES NOT GUESS WHICH ONE SHE REALLY MEANT.`  (R-736 §4)

WHAT IT IS DELIBERATELY NOT
---------------------------
It is NOT `ConditionBinding.parameters` and it is NOT the parameter grammar.
R-678 §6 reserves that grammar to the advisor desk and R-738 §3 decided this
question explicitly: an opening-range duration was never an arbitrary indicator
parameter, it is a SOURCE-SANCTIONED ALTERNATIVE that already has a typed home
(`OpeningRangeVariant`). This module introduces no writer to `parameters`, no
`dict[str, Any]`, no arbitrary parameter names and no optional duration.

    `THE FIRST PRODUCTION WRITER OF A FIELD RESERVED FOR A FUTURE DESIGN IS THE
     DESIGN.`  (R-738 §2)

WHY THE CANDIDATE REFERENCES RATHER THAN COPIES
-----------------------------------------------
The definition already owns session start, timezone, market scope, trading-day
rule and provenance; the variant already owns label, duration and quote. This
type holds REFERENCES to both and restates neither.

    `TWO FIELDS HOLDING ONE FACT ARE A DISAGREEMENT WITH A COMMIT DATE.`

TWO IDENTITIES, AND THEY ANSWER DIFFERENT QUESTIONS
---------------------------------------------------
`candidate_id`  — WHICH candidate this is. Stable, human-traceable, and it
                  carries the duration as well as the label so that changing a
                  duration cannot leave the id looking unchanged.
`cache_identity` — WHICH VERSION of it. A SHA-256 over the COMPLETE canonical
                  payload, so any change to any source-owned fact produces a new
                  namespace.

Both are derived, never free-form, and neither uses Python's `hash()`. `hash()`
of a str is salted per process by PYTHONHASHSEED, which would satisfy the
uniqueness and sensitivity obligations while failing requirement (11):

    `A UNIQUENESS TEST AND A SENSITIVITY TEST ARE BOTH SATISFIED BY RANDOMNESS;
     ONLY A STABILITY TEST EXCLUDES IT.`  (R-737 §8)

The payload includes the definition's FULL taught variant set, not just the one
variant being executed. That is deliberate: a change to the taught set is a
change to the SOURCE, and a source change should invalidate the namespace of
every candidate derived from it.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from src.engine.opening_range_definition import (
    CANONICAL_TYPE,
    OpeningRangeDefinition,
    OpeningRangeVariant,
)

CANDIDATE_SCHEMA: str = "OPENING_RANGE_EXECUTION_CANDIDATE/1"
"""Versioned so that a future change to the canonical payload SHAPE is a visible
namespace change rather than a silent cache collision across two shapes."""


@dataclass(frozen=True)
class OpeningRangeExecutionCandidate:
    """One source condition made executable with EXACTLY ONE taught variant.

    Deliberately carries no video id, strategy name or artifact path as a module
    constant — `source_spec_id` and `source_condition_id` arrive as DATA on an
    instance, which is what keeps this a concept rather than one video's shape.
    """

    source_spec_id: str
    source_condition_id: str
    definition: OpeningRangeDefinition
    variant: OpeningRangeVariant

    def __post_init__(self) -> None:
        if self.variant not in self.definition.variants:
            taught = ", ".join(
                f"{v.variant_label}={v.duration_minutes}m" for v in self.definition.variants
            )
            raise ValueError(
                f"variant {self.variant.variant_label!r} "
                f"({self.variant.duration_minutes}m) is not among the taught variants "
                f"of this {CANONICAL_TYPE} [{taught}] — an execution candidate may only "
                "carry an alternative the source actually taught, and anything else is "
                "an invented duration wearing a valid type"
            )

    def canonical_payload(self) -> dict:
        """The COMPLETE, order-stable description this candidate's identity is
        derived from.

        Built by explicit field enumeration in a fixed order — never by
        iterating a set, a dict or `__dict__`, whose orders are not part of any
        contract. Every value is a `str` or an `int`; nothing here depends on
        object identity or on a repr.
        """
        return {
            "schema": CANDIDATE_SCHEMA,
            "canonical_type": CANONICAL_TYPE,
            "source_spec_id": self.source_spec_id,
            "source_condition_id": self.source_condition_id,
            "definition": {
                "session_start_local": self.definition.session_start_local,
                "source_timezone": self.definition.source_timezone,
                "market_scope": self.definition.market_scope,
                "trading_day_rule": self.definition.trading_day_rule,
                "provenance": {
                    "source_quote": self.definition.provenance.source_quote,
                    "condition_id": self.definition.provenance.condition_id,
                },
                "taught_variants": [
                    {
                        "variant_label": v.variant_label,
                        "duration_minutes": v.duration_minutes,
                        "source_quote": v.source_quote,
                    }
                    for v in self.definition.variants
                ],
            },
            "variant": {
                "variant_label": self.variant.variant_label,
                "duration_minutes": self.variant.duration_minutes,
                "source_quote": self.variant.source_quote,
            },
        }

    @property
    def candidate_id(self) -> str:
        """WHICH candidate. Carries the duration as well as the label because
        `A UNIQUENESS GUARD PROVES UNIQUENESS OF THE FIELD IT READS, AND OF
        NOTHING ELSE` (R-738 §7-2) — the definition's own guard reads
        `variant_label` only, so two variants can legally share a duration, and
        an id keyed on either field alone would fail one of those cases."""
        return (
            f"{self.source_spec_id}::{self.source_condition_id}"
            f"::{self.variant.variant_label}@{self.variant.duration_minutes}m"
        )

    @property
    def cache_identity(self) -> str:
        """WHICH VERSION. SHA-256 over the canonical payload, serialised with
        `sort_keys=True` so the digest cannot depend on dict insertion order,
        and with `ensure_ascii=False` + explicit UTF-8 so a non-ASCII source
        quote hashes the same on every platform."""
        blob = json.dumps(
            self.canonical_payload(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def expand_execution_candidates(
    source_spec_id: str,
    source_condition_id: str,
    definition: OpeningRangeDefinition,
) -> tuple[OpeningRangeExecutionCandidate, ...]:
    """Deterministically expand a taught definition into one candidate per
    taught variant, IN TAUGHT ORDER, choosing none of them.

    There is no `default_variant` argument and no primary. Callers that want
    "the" duration are making a choice the teacher declined to make, and
    `OpeningRangeDefinition.selected_duration_minutes` already raises to stop
    that happening three layers down.
    """
    return tuple(
        OpeningRangeExecutionCandidate(
            source_spec_id=source_spec_id,
            source_condition_id=source_condition_id,
            definition=definition,
            variant=variant,
        )
        for variant in definition.variants
    )
