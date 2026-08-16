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
  3. SAME ENTITY    — BOTH endpoints must name the declared entity, and the antecedent must
                      DEFINE it (carry a definitional marker) rather than merely mention it.
  4. NO REDEFINITION— nothing between them may redefine the same entity, or the deictic
                      may be pointing at the newer thing instead.

Checks 3 and 4 are the ones that make this safe. Without 4, "this range" would bind to the
first definition in the document no matter how many ranges were drawn in between.

🛑 CHECK 3 WAS MISSING UNTIL `AR-1247 F-1`, AND IT IS THE SUBTLER HOLE. `AR-1243 §11` required
"same entity linkage established" from the start; the implementation checked order, grounding
and redefinition and then returned bound=True. So an authored spec could carry a qualifier out
of an earlier span that had the right WORDS about the wrong OBJECT — the exact unsupported
composition this module exists to refuse. Order + grounding + no-redefinition are NOT
sufficient: a gap containing no redefinition of an entity that was never established in the
first place is silence, not evidence.

AND THE VOCABULARY MUST BE ABLE TO SAY NO (`AR-1247 F-2`). Empty `entity_terms` or empty
`definitional_markers` make every one of those checks unfalsifiable while the receipt still
reads like a governed binding, so an empty vocabulary is itself a refusal. Span bounds are
validated for the same reason: an out-of-range offset does not raise in Python, it silently
slices different text, and that text would become the provenance.

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
    # 0. THE VOCABULARY MUST BE ABLE TO SAY NO (`AR-1247 F-2`).
    #    With an empty entity or definitional vocabulary the redefinition loop below can never
    #    match, and the same-entity checks can never fail — the gate goes vacuous while the
    #    record still reads like a governed composition. A check that cannot refuse is not a
    #    check, so an empty vocabulary is refused rather than honoured.
    if not entity_terms:
        return AntecedentBinding(
            False, qualifier,
            "VACUOUS_ENTITY_VOCABULARY: no entity terms were declared, so no same-entity or "
            "redefinition check could ever fail; a gate that cannot refuse is not a gate",
            antecedent_span, referring_span,
        )
    if not definitional_markers:
        return AntecedentBinding(
            False, qualifier,
            "VACUOUS_DEFINITIONAL_VOCABULARY: no definitional markers were declared, so no "
            "redefinition could ever be detected and no antecedent could be shown to DEFINE "
            "anything; a gate that cannot refuse is not a gate",
            antecedent_span, referring_span,
        )

    if antecedent_span is None:
        return AntecedentBinding(
            False, qualifier,
            "NO_ANTECEDENT: no defining span was supplied, so the qualifier is "
            "unsupported at the referring span",
            None, referring_span,
        )

    # 0b. SPAN BOUNDS (`AR-1247 F-2`). A negative or over-long offset does not raise in Python —
    #     it silently slices something else, and that something else would become provenance.
    for label, span in (("antecedent", antecedent_span), ("reference", referring_span)):
        if not (0 <= span.start < span.end <= len(transcript)):
            return AntecedentBinding(
                False, qualifier,
                f"SPAN_OUT_OF_BOUNDS: the {label} span ({span.start}, {span.end}) is not a valid "
                f"range inside a transcript of length {len(transcript)}; Python would slice "
                "silently and the wrong text would become the receipt",
                antecedent_span, referring_span,
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

    # 2b. SAME-ENTITY LINKAGE (`AR-1243 §11`, missing until `AR-1247 F-1` caught it).
    #     Order + qualifier-grounding + no-redefinition are NOT sufficient. Without an endpoint
    #     entity check, an authored spec can carry a qualifier out of an earlier span that has
    #     the right WORDS but is about the wrong OBJECT — which is precisely the unsupported
    #     composition this gate exists to prevent. Both endpoints must name the entity, and the
    #     antecedent must actually DEFINE it rather than merely mention it in passing.
    ref_text = referring_span.text(transcript)

    ante_entity = _present(entity_terms, ante_text)
    if not ante_entity:
        return AntecedentBinding(
            False, qualifier,
            f"ENTITY_ABSENT_AT_ANTECEDENT: none of {list(entity_terms)} appears in the "
            "antecedent, so it does not establish the entity the reference points back at",
            antecedent_span, referring_span,
        )

    ante_marker = _present(definitional_markers, ante_text)
    if not ante_marker:
        return AntecedentBinding(
            False, qualifier,
            f"ANTECEDENT_DOES_NOT_DEFINE: the antecedent mentions {ante_entity!r} but carries "
            f"none of {list(definitional_markers)}, so it references the entity rather than "
            "defining it; a passing mention cannot be the definition a deictic points at",
            antecedent_span, referring_span,
        )

    ref_entity = _present(entity_terms, ref_text)
    if not ref_entity:
        return AntecedentBinding(
            False, qualifier,
            f"ENTITY_ABSENT_AT_REFERENCE: none of {list(entity_terms)} appears in the referring "
            "span, so there is no shared entity to carry the qualifier across",
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
        f"DEFINES {ante_entity!r} via {ante_marker!r}, the reference names {ref_entity!r} "
        "as the same entity, and nothing redefines it in between",
        antecedent_span, referring_span,
    )
