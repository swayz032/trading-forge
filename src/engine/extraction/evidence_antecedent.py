"""EVIDENCE ANTECEDENT BINDING — carry a qualifier defined by an earlier ordered step.

Authority: GPT ruling AR-1206 LANE B. The problem it solves, in the ruling's words:

    `initial` is no longer an extraction-truth mystery. It is an evidence binding /
    antecedent-carrying problem. … make the evidence representation capable of carrying
    the minimal linked antecedent.

WHY THIS IS NOT ANOTHER WIDER QUOTE. Widening a span until a qualifier falls inside it is
a search for a greener grade (AR-1206: "do not buy another blind rerun", AR-1138 §6: no
cherry-pick loop). Composition is different and stronger: an earlier step DEFINES an
entity, a later step REFERS to it deictically ("this X"), and the qualifier is carried
across that link only if the link itself survives three mechanical checks:

  1. ORDER          — the antecedent must precede the reference in the same source.
  2. GROUNDING      — the qualifier must actually appear in the antecedent.
  3. NO REDEFINITION— nothing between them may redefine the same entity, or the deictic
                      may be pointing at the newer thing instead.

Check 3 is the one that makes this safe. Without it, "this range" would bind to the first
definition in the document no matter how many ranges were drawn in between.

Generic by construction: every domain term (entity words, qualifier synonyms, definitional
verbs) is supplied by the CALLER. This module contains no strategy, instrument, timeframe
or teacher-specific string, and a test asserts that.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ["Span", "AntecedentBinding", "bind_qualifier_to_antecedent"]


@dataclass(frozen=True)
class Span:
    start: int
    end: int

    def text(self, transcript: str) -> str:
        return transcript[self.start:self.end]


@dataclass(frozen=True)
class AntecedentBinding:
    bound: bool
    qualifier: str
    reason: str
    antecedent_span: Span | None = None
    referring_span: Span | None = None
    intervening_redefinition: str | None = None


def _present(terms: tuple[str, ...], text: str) -> str | None:
    low = text.lower()
    for t in terms:
        if re.search(r"\b" + re.escape(t.lower()) + r"\b", low):
            return t
    return None


def bind_qualifier_to_antecedent(
    transcript: str,
    qualifier: str,
    qualifier_synonyms: tuple[str, ...],
    referring_span: Span,
    antecedent_span: Span | None,
    entity_terms: tuple[str, ...],
    definitional_markers: tuple[str, ...],
) -> AntecedentBinding:
    """Decide whether `qualifier` is carried to `referring_span` by `antecedent_span`.

    Returns `bound=False` with an explicit reason on every failure path. There is no
    path that returns bound=True without all three checks passing — absence of an
    antecedent is a refusal, never a silent pass.
    """
    if antecedent_span is None:
        return AntecedentBinding(
            False, qualifier,
            "NO_ANTECEDENT: no defining span was supplied, so the qualifier is "
            "unsupported at the referring span",
            None, referring_span,
        )

    # 1. ORDER
    if antecedent_span.end > referring_span.start:
        return AntecedentBinding(
            False, qualifier,
            f"ORDER_VIOLATION: antecedent ends at {antecedent_span.end} but the "
            f"reference starts at {referring_span.start}; a definition cannot be "
            "carried backwards",
            antecedent_span, referring_span,
        )

    # 2. GROUNDING
    ante_text = antecedent_span.text(transcript)
    hit = _present(qualifier_synonyms, ante_text)
    if not hit:
        return AntecedentBinding(
            False, qualifier,
            f"QUALIFIER_UNGROUNDED: none of {list(qualifier_synonyms)} appears in the "
            "antecedent, so it does not establish the qualifier either",
            antecedent_span, referring_span,
        )

    # 3. NO INTERVENING REDEFINITION
    gap = transcript[antecedent_span.end:referring_span.start]
    for clause in re.split(r"[.!?;]", gap):
        if _present(entity_terms, clause) and _present(definitional_markers, clause):
            return AntecedentBinding(
                False, qualifier,
                "INTERVENING_REDEFINITION: the entity is defined again between the "
                "antecedent and the reference, so the deictic may point at that one",
                antecedent_span, referring_span, clause.strip()[:200],
            )

    return AntecedentBinding(
        True, qualifier,
        f"BOUND: antecedent grounds {qualifier!r} via {hit!r}, precedes the reference, "
        "and nothing redefines the entity in between",
        antecedent_span, referring_span,
    )
