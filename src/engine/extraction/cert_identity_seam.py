"""IDENTITY-PRESERVING CERTIFICATION SEAM — AR-1283 (ruling AR-1282A §7).

Binds a FINAL Opus/G2 evidence route to the EXISTING pilot conveyor without
ever letting a condition IDENTITY be invented, merged, aliased or dropped.

THE LAW THIS ENCODES
--------------------
The identity of a certificate condition is its ``condition_ref``.
``char_span`` is a JOIN COORDINATE, never an identity.

That distinction is load-bearing because production ``cert_assembler.py``
joins tier-3 verdicts to tier-1 fall-throughs BY ``char_span``
(``tier3_by_span = {v.char_span: v ...}``). Two different condition
identities that share one span would therefore consume the SAME tier-3
verdict. This module's job is to make that state unreachable at the seam,
NOT to redesign the span-keyed join downstream (AR-1282A §4 explicitly
forbids the pre-emptive redesign).

WHY THIS MODULE EXISTS AT ALL (the AR-1282 defect it repairs)
-------------------------------------------------------------
``anchor_locator.locate_anchor`` receives only ``(transcript,
condition_text)`` and its verifier ``_verify_and_locate`` returns the FIRST
(leftmost) resolving occurrence. So a quote that is perfectly literal can
still resolve to a DIFFERENT span than the route row it came from, and a
text-keyed proposal map silently merges two conditions that share text.
AR-1282's measurement adapter was keyed by text alone; that was sufficient
to establish its 0/4 result but is not sufficient as the permanent seam
(AR-1282A §5). Everything here exists to close that gap.

WHAT THIS MODULE DOES NOT DO
----------------------------
* it never calls a model — every function is pure over data already on disk;
* it never stamps ``ACCEPTED_PENDING_CERTIFICATION`` as a classifying tier —
  route acceptance is evidence acceptance, not certification;
* it never deduplicates. When two identities collide it REFUSES. Collapsing
  rows to make a proof green is the exact defect AR-1282A §3 rejected.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

from .pilot_conveyor import extract_spine_condition_texts
from .span_collision import detect_span_collisions

__all__ = [
    "ACCEPTED",
    "GREEN",
    "RouteIdentity",
    "SeamRefusal",
    "REASON_ROUTE_NOT_GREEN",
    "REASON_ROUTE_ROW_NOT_ACCEPTED",
    "REASON_REF_SET_MISMATCH",
    "REASON_UNKNOWN_CONDITION_REF",
    "REASON_CONDITION_TEXT_MISMATCH",
    "REASON_IDENTITY_COLLISION",
    "REASON_AMBIGUOUS_CONDITION_TEXT",
    "REASON_SPAN_MISMATCH",
    "REASON_IDENTITY_COUNT_DRIFT",
    "REASON_IDENTITY_DROPPED",
    "bind_route_identities",
    "assert_certifiable_final_route",
    "make_identity_propose_fn",
    "verify_anchor_identity",
    "assert_identity_preserved",
]

# Route vocabulary — the strings production `opus_phase1_route.py` emits.
ACCEPTED = "ACCEPTED_PENDING_CERTIFICATION"
GREEN = "GREEN_PENDING_CERTIFICATION"

REASON_ROUTE_NOT_GREEN = "final_route_not_green_pending_certification"
REASON_ROUTE_ROW_NOT_ACCEPTED = "final_route_row_not_accepted"
REASON_REF_SET_MISMATCH = "route_ref_set_does_not_match_spine"
REASON_UNKNOWN_CONDITION_REF = "route_row_ref_absent_from_spine"
REASON_CONDITION_TEXT_MISMATCH = "route_row_text_differs_from_spine"
REASON_IDENTITY_COLLISION = "two_identities_share_a_certification_join_span"
REASON_AMBIGUOUS_CONDITION_TEXT = "two_identities_share_condition_text"
REASON_SPAN_MISMATCH = "anchor_resolved_to_a_different_span_than_the_route_row"
REASON_IDENTITY_COUNT_DRIFT = "identity_count_changed_across_the_seam"
REASON_IDENTITY_DROPPED = "condition_ref_disappeared_across_the_seam"


class SeamRefusal(RuntimeError):
    """The seam refuses rather than guesses. `reason` is machine-readable."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class RouteIdentity:
    """One condition identity, carrying every field AR-1282A §5 requires the
    permanent seam to preserve AND verify."""

    condition_ref: str
    condition_text: str
    quote: str
    char_span: tuple[int, int]
    disposition: str

    @property
    def accepted(self) -> bool:
        return self.disposition == ACCEPTED


def bind_route_identities(
    strategy: dict, route: dict, strategy_index: int = 0
) -> list[RouteIdentity]:
    """Bind every route outcome to its spine condition BY ``condition_ref``.

    Refuses on any ref the spine does not carry, and on any row whose route
    text disagrees with the spine text where the route supplies one. The
    returned list has exactly one entry per route outcome, in route order —
    identity count is preserved by construction, never by a set operation.
    """
    spine = extract_spine_condition_texts(strategy, strategy_index)
    text_by_ref = {c.condition_ref: c.text for c in spine}

    identities: list[RouteIdentity] = []
    for outcome in route.get("outcomes") or []:
        ref = outcome.get("condition_ref")
        if ref not in text_by_ref:
            raise SeamRefusal(
                REASON_UNKNOWN_CONDITION_REF,
                f"route row {ref!r} has no matching spine condition",
            )
        # If the route carries its own copy of the condition text, it must
        # agree with the spine's. A silent disagreement here would mean the
        # route and the conveyor are certifying two different conditions.
        route_text = outcome.get("condition_text")
        if isinstance(route_text, str) and route_text != text_by_ref[ref]:
            raise SeamRefusal(
                REASON_CONDITION_TEXT_MISMATCH,
                f"{ref}: route text differs from spine text",
            )
        span = outcome.get("char_span") or (0, 0)
        identities.append(
            RouteIdentity(
                condition_ref=ref,
                condition_text=text_by_ref[ref],
                quote=outcome.get("quote") or "",
                char_span=(int(span[0]), int(span[1])),
                disposition=outcome.get("disposition") or "",
            )
        )
    return identities


def assert_certifiable_final_route(
    identities: list[RouteIdentity],
    route_grade: Optional[str],
    strategy: dict,
    strategy_index: int = 0,
) -> dict:
    """AR-1282A §7B — the HARD precondition on a real certification read.

    Refuses unless the final route is GREEN_PENDING_CERTIFICATION, carries
    EVERY spine condition_ref exactly once, every row is accepted, and no two
    identities share a certification join span.

    The collision leg reuses production ``detect_span_collisions`` rather
    than an exact-span equality test of its own, so a substantially
    OVERLAPPING alias (not merely an identical span) is caught too — the same
    authority ``opus_phase1_route`` already gates acceptance with.

    Returns a summary dict on success. Raises `SeamRefusal` otherwise.
    """
    if route_grade != GREEN:
        raise SeamRefusal(
            REASON_ROUTE_NOT_GREEN,
            f"route grade is {route_grade!r}, refusing certification read",
        )

    expected = [c.condition_ref for c in extract_spine_condition_texts(strategy, strategy_index)]
    got = [i.condition_ref for i in identities]
    if sorted(got) != sorted(expected) or len(got) != len(set(got)):
        raise SeamRefusal(
            REASON_REF_SET_MISMATCH,
            f"expected {len(expected)} unique spine refs, route carries {len(got)} "
            f"({len(set(got))} unique); missing={sorted(set(expected) - set(got))} "
            f"extra={sorted(set(got) - set(expected))}",
        )

    not_accepted = [i.condition_ref for i in identities if not i.accepted]
    if not_accepted:
        raise SeamRefusal(
            REASON_ROUTE_ROW_NOT_ACCEPTED,
            f"{len(not_accepted)} row(s) not accepted: {not_accepted}",
        )

    collisions = detect_span_collisions({i.condition_ref: i.char_span for i in identities})
    if collisions:
        raise SeamRefusal(
            REASON_IDENTITY_COLLISION,
            "; ".join(f"{tuple(c.span)} shared by {list(c.condition_refs)} [{c.severity}]" for c in collisions),
        )

    texts: dict[str, str] = {}
    for i in identities:
        prior = texts.get(i.condition_text)
        if prior is not None:
            raise SeamRefusal(
                REASON_AMBIGUOUS_CONDITION_TEXT,
                f"{prior!r} and {i.condition_ref!r} share condition text; a text-keyed "
                "proposal seam cannot tell them apart",
            )
        texts[i.condition_text] = i.condition_ref

    return {
        "route_grade": route_grade,
        "identity_count": len(identities),
        "all_accepted": True,
        "collisions": 0,
    }


def make_identity_propose_fn(
    identities: list[RouteIdentity],
) -> tuple[Callable[[str, str], Optional[str]], list[dict]]:
    """The zero-model PROPOSE seam, keyed by condition TEXT because that is
    all ``locate_anchor`` passes through — and REFUSING when two identities
    share text, because in that case the key cannot name one identity.

    Only ACCEPTED identities enter the map; every other condition gets None,
    which ``locate_anchor`` treats as LOCATOR_DECLINED (an honest abstain,
    never a fabricated anchor).

    The exact-span guarantee is NOT provided here — it cannot be, since the
    proposal seam never sees the resolved span. `verify_anchor_identity`
    below is the other half of the contract and is mandatory.
    """
    by_text: dict[str, str] = {}
    for i in identities:
        if not i.accepted:
            continue
        if i.condition_text in by_text:
            raise SeamRefusal(
                REASON_AMBIGUOUS_CONDITION_TEXT,
                f"{i.condition_ref!r} shares condition text with an earlier accepted identity",
            )
        by_text[i.condition_text] = i.quote

    calls: list[dict] = []

    def propose(_transcript: str, condition_text: str) -> Optional[str]:
        quote = by_text.get(condition_text)
        calls.append({"condition_text": condition_text[:80], "proposed": quote is not None})
        return quote

    return propose, calls


def verify_anchor_identity(
    prepare_output: dict, identities: list[RouteIdentity]
) -> list[dict]:
    """AR-1282A §7C — pin the EXACT span, not merely the quote text.

    For every ACCEPTED identity, require that the conveyor resolved an anchor
    and that the resolved ``char_span`` equals the route row's own span. A
    literal quote that resolved to a different occurrence REFUSES — that is
    the ``_verify_and_locate`` leftmost-occurrence hazard, closed.

    Returns one verification record per accepted identity.
    """
    span_by_ref = {
        o["condition_ref"]: tuple(o["char_span"])
        for o in prepare_output.get("condition_outcomes") or []
        if o.get("char_span") is not None
    }
    unanchored = {u.condition_ref for u in prepare_output.get("unanchored_conditions") or []}

    records: list[dict] = []
    for i in identities:
        if not i.accepted:
            continue
        if i.condition_ref in unanchored or i.condition_ref not in span_by_ref:
            raise SeamRefusal(
                REASON_SPAN_MISMATCH,
                f"{i.condition_ref}: accepted route row did not anchor in the conveyor",
            )
        resolved = span_by_ref[i.condition_ref]
        if resolved != i.char_span:
            raise SeamRefusal(
                REASON_SPAN_MISMATCH,
                f"{i.condition_ref}: route span {i.char_span} but anchor resolved {resolved}",
            )
        records.append(
            {
                "condition_ref": i.condition_ref,
                "route_span": list(i.char_span),
                "resolved_span": list(resolved),
                "span_pinned": True,
            }
        )
    return records


def assert_identity_preserved(
    identities: list[RouteIdentity], prepare_output: dict, certificate: dict
) -> dict:
    """AR-1282A §7A — the count/identity invariant across the whole seam.

    ``input identities == adapter identities == certificate condition rows``,
    with no ``condition_ref`` disappearing. Refuses on any drift; never
    repairs one.
    """
    n_in = len(identities)
    outcomes = prepare_output.get("condition_outcomes") or []
    unanchored = prepare_output.get("unanchored_conditions") or []
    n_adapter = len(outcomes) + len(unanchored)
    n_cert = len(certificate.get("conditions") or [])

    if not (n_in == n_adapter == n_cert):
        raise SeamRefusal(
            REASON_IDENTITY_COUNT_DRIFT,
            f"input={n_in} adapter={n_adapter} certificate={n_cert}",
        )

    seen = {o["condition_ref"] for o in outcomes} | {u.condition_ref for u in unanchored}
    lost = sorted({i.condition_ref for i in identities} - seen)
    if lost:
        raise SeamRefusal(REASON_IDENTITY_DROPPED, f"lost refs: {lost}")

    return {
        "input_condition_identities": n_in,
        "adapter_condition_identities": n_adapter,
        "certificate_condition_rows": n_cert,
        "no_condition_ref_disappeared": True,
        "no_identities_merged_by_span": True,
    }
