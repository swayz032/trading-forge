"""SOURCE-OWNED TIMEFRAME ROLES — which timeframe owns WHICH decision, and why.

Authority: AR-1110 (gpt-rulings `25a7d8d5`) §4 "Minimum semantic carrier" and §5
"Fail-closed rule".

WHY THIS TYPE EXISTS
--------------------
`[MEASURED, AR-1109 §1.Q4]` the persisted sVkm strategy carried ONE scalar:

    strategies.timeframe = '1m'
    config.metadata.timeframe_recovery = {
        source: "backfill_recovered_from_spec",
        evidence: "all stated TFs [1m, 5m]; exec = lowest execution-grade TF across roles -> 1m",
        confidence: 0.4,
        higher_timeframe: null,
    }

The VALUE is right. The MECHANISM is a guess that happened to win: "take the lowest
stated timeframe" would return `1m` whether or not the teacher had ever said it, and
`higher_timeframe: null` means the FIVE-minute opening-range window he actually taught
had no carrier at all.

    ★★★★★ `A CORRECT VALUE FROM A HEURISTIC IS STILL A GUESS THAT HAPPENED TO WIN,
       AND THE NEXT SOURCE IS WHERE IT COSTS YOU.`

AR-1110 §4 therefore forbids, even when the number is right:

    source mentions {5m, 1m} -> choose smallest -> timeframe = 1m -> call it faithful

So this module preserves WHY each timeframe exists. It is deliberately NOT a
multi-timeframe scheduler, resampler or framework (AR-1110 §8) — it is a typed record
of four source facts and how well each one is evidenced.

WHAT IT DOES NOT DO, ON PURPOSE
-------------------------------
  · no default anywhere — a default role is a silent choice wearing a convenience costume,
    the same doctrine as `OpeningRangeDefinition.duration_minutes` (invariant 1, R-736);
  · no "nearest role" fallback — `for_role` RAISES rather than borrowing a sibling's
    timeframe, because a borrowed role is indistinguishable from a taught one downstream;
  · no inference from `strategy.timeframe` / `trigger_tf` — AR-1110 §5 forbids it by name;
  · no opinion about BARS. Interval convention, session-date convention and completeness
    policy stay with the runtime adapter, exactly as `OpeningRangeDefinition` keeps them
    off the source-owned type.

ROLE ≠ DURATION. `R-800 §4` minted it and it is the trap this module exists inside:
    ★★★★★ `OPENING-RANGE DURATION IS NOT EXECUTION TIMEFRAME.`
`OPENING_RANGE_WINDOW` here is the timeframe of the CHART the range is measured on
(sVkm: the 5-minute candle). How LONG that range runs is the opening-range variant's
`duration_minutes`, which lives on `OpeningRangeDefinition` and is untouched by this file.
"""

from __future__ import annotations

import dataclasses
from typing import Any

TIMEFRAME_ROLES_SCHEMA: str = "SOURCE_TIMEFRAME_ROLES/1"
"""Versioned so a future change to the SHAPE is a visible namespace change rather than
a silent reinterpretation of an old payload."""


class SourceTimeframeRoleError(ValueError):
    """Raised for every refusal in this module. Named so a caller can distinguish a
    source-fidelity refusal from an arbitrary ValueError deeper in the stack."""


# ── THE FOUR ROLES ───────────────────────────────────────────────────────────
# Exactly the four AR-1110 §4 names. This tuple is the closed set: an unknown role
# is a refusal, not a new member, because a role nothing consumes is a fact nobody
# checks.
OPENING_RANGE_WINDOW = "OPENING_RANGE_WINDOW"
BREAKOUT_CONFIRMATION = "BREAKOUT_CONFIRMATION"
FVG_DETECTION = "FVG_DETECTION"
ENTRY_COMPLETION = "ENTRY_COMPLETION"

REQUIRED_ROLES: tuple[str, ...] = (
    OPENING_RANGE_WINDOW,
    BREAKOUT_CONFIRMATION,
    FVG_DETECTION,
    ENTRY_COMPLETION,
)

# ── EVIDENCE GRADES ──────────────────────────────────────────────────────────
# AR-1110 §3: "Hold that evidence grading. Do not upgrade Q2/Q3 to EXPLICIT just
# because they equal 1m." The grade travels WITH the value precisely so that a later
# reader cannot launder a continuity inference into a quotation.
EXPLICIT = "EXPLICIT"
"""The teacher named this timeframe for this decision, in words."""

SOURCE_RESOLVED_BY_CONTINUITY = "SOURCE_RESOLVED_BY_CONTINUITY"
"""The teacher did not name it here, but never left the chart he named earlier, and
the inference is corroborated across worked examples. Weaker than EXPLICIT and it
must keep saying so."""

ACCEPTED_GRADES: tuple[str, ...] = (EXPLICIT, SOURCE_RESOLVED_BY_CONTINUITY)

_BINDING_KEYS = frozenset({"role", "timeframe", "evidence_grade", "source_quote", "condition_id"})
_ENVELOPE_KEYS = frozenset({"schema", "bindings"})


@dataclasses.dataclass(frozen=True)
class TimeframeRoleBinding:
    """ONE decision, the timeframe that owns it, and the evidence for that claim."""

    role: str
    timeframe: str
    evidence_grade: str
    source_quote: str
    condition_id: str

    def __post_init__(self) -> None:
        if self.role not in REQUIRED_ROLES:
            raise SourceTimeframeRoleError(
                f"unknown timeframe role {self.role!r}; the closed set is "
                f"{list(REQUIRED_ROLES)} — a role nothing consumes is a fact nobody checks"
            )
        if not isinstance(self.timeframe, str) or not self.timeframe.strip():
            raise SourceTimeframeRoleError(
                f"role {self.role!r} carries no timeframe; an empty role is exactly what a "
                "dropped source fact looks like, so it is refused rather than defaulted"
            )
        if self.evidence_grade not in ACCEPTED_GRADES:
            raise SourceTimeframeRoleError(
                f"role {self.role!r} carries evidence grade {self.evidence_grade!r}; "
                f"accepted grades are {list(ACCEPTED_GRADES)}. A role whose evidence cannot "
                "be graded may not be persisted as though it were taught"
            )
        if not isinstance(self.source_quote, str) or not self.source_quote.strip():
            raise SourceTimeframeRoleError(
                f"role {self.role!r} carries no source quote; a graded claim with no evidence "
                "attached is the grade laundering AR-1110 §3 forbids"
            )

    def to_payload(self) -> dict:
        return {
            "role": self.role,
            "timeframe": self.timeframe,
            "evidence_grade": self.evidence_grade,
            "source_quote": self.source_quote,
            "condition_id": self.condition_id,
        }


def _exact_keys(raw: Any, expected: frozenset, what: str) -> dict:
    if not isinstance(raw, dict):
        raise SourceTimeframeRoleError(f"{what} is not a mapping: {type(raw).__name__}")
    got = frozenset(raw)
    missing = sorted(expected - got)
    unknown = sorted(got - expected)
    if missing or unknown:
        raise SourceTimeframeRoleError(
            f"{what} has the wrong keys\n  missing : {missing}\n  unknown : {unknown}"
        )
    return raw


@dataclasses.dataclass(frozen=True)
class SourceTimeframeRoles:
    """All four source-owned timeframe roles for ONE source, or a refusal.

    Partial is not a state this type has. AR-1110 §5 says an absent required role
    refuses, and the cheapest place to enforce that is construction — a half-populated
    carrier that reaches the runtime is a scalar heuristic with extra steps.
    """

    bindings: tuple[TimeframeRoleBinding, ...]

    def __post_init__(self) -> None:
        seen = [b.role for b in self.bindings]
        duplicates = sorted({r for r in seen if seen.count(r) > 1})
        if duplicates:
            raise SourceTimeframeRoleError(
                f"role(s) {duplicates} bound more than once; two answers to one question "
                "is a conflict, and AR-1110 §5 refuses conflicts rather than picking"
            )
        missing = [r for r in REQUIRED_ROLES if r not in seen]
        if missing:
            raise SourceTimeframeRoleError(
                f"missing required timeframe role(s) {missing}; SOURCE_FAITHFUL refuses an "
                "incomplete role set rather than recovering it from a scalar (AR-1110 §5)"
            )

    def for_role(self, role: str) -> TimeframeRoleBinding:
        """The binding for `role`, or a refusal. NEVER a neighbouring role's value."""
        for b in self.bindings:
            if b.role == role:
                return b
        raise SourceTimeframeRoleError(
            f"no binding for role {role!r}; refusing rather than borrowing another role's "
            "timeframe, because a borrowed role is indistinguishable from a taught one "
            "everywhere downstream"
        )

    def timeframe_for(self, role: str) -> str:
        return self.for_role(role).timeframe

    def to_payload(self) -> dict:
        return {
            "schema": TIMEFRAME_ROLES_SCHEMA,
            # Emitted in the fixed REQUIRED_ROLES order so the payload is canonical and
            # two equal role sets cannot hash differently because of dict ordering.
            "bindings": [self.for_role(r).to_payload() for r in REQUIRED_ROLES],
        }

    @classmethod
    def from_payload(cls, raw: Any) -> "SourceTimeframeRoles":
        if raw is None:
            raise SourceTimeframeRoleError(
                "no timeframe-role carrier was supplied; on SOURCE_FAITHFUL that is a "
                "refusal, not a cue to fall back on strategy.timeframe or trigger_tf"
            )
        d = _exact_keys(raw, _ENVELOPE_KEYS, "timeframe-roles envelope")
        if d["schema"] != TIMEFRAME_ROLES_SCHEMA:
            raise SourceTimeframeRoleError(
                f"unrecognised timeframe-roles schema {d['schema']!r}; "
                f"expected {TIMEFRAME_ROLES_SCHEMA!r}"
            )
        if not isinstance(d["bindings"], list):
            raise SourceTimeframeRoleError("bindings is not a list")
        built = []
        for item in d["bindings"]:
            b = _exact_keys(item, _BINDING_KEYS, "timeframe-role binding")
            built.append(
                TimeframeRoleBinding(
                    role=b["role"],
                    timeframe=b["timeframe"],
                    evidence_grade=b["evidence_grade"],
                    source_quote=b["source_quote"],
                    condition_id=b["condition_id"],
                )
            )
        return cls(bindings=tuple(built))
