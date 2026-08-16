"""DUPLICATE-SPAN COLLISION DIAGNOSTIC — AR-1226 §6 LANE L1 item 3.

Runs on a location SET before it is accepted, and answers one question the per-condition
gates structurally cannot:

    is the same source span being reused as evidence for conditions that assert
    different things?

Each anchor in the AR-1199 golden slice passed its own literal check in isolation. The defect
was only visible ACROSS the set: six conditions spanning three different roles — several
entry-sequence steps, the stop and the target — all pointed at one generic disclaimer.
No single-condition gate can see that, because each one looks at exactly one pair.

🛑 IT EXPOSES, IT DOES NOT DECIDE (AR-1226 §6.3, verbatim: "the diagnostic must expose/force
adjudication, not invent that universal rule"). One quote legitimately supporting two closely
related fields is normal — `entry_sequence[0].action` and `entry_sequence[0].rationale` may well
share evidence. So reuse is reported with a SEVERITY, and only CROSS-ROLE reuse is treated as
high — because an entry rule, a stop rule and a target rule asserting different facts cannot all
rest on the same sentence.

No domain vocabulary: roles are derived from the caller's own condition references.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass

__all__ = [
    "SpanCollision",
    "detect_span_collisions",
    "role_of",
    "adjudicate_locations",
    "STATUS_ACCEPTED",
    "STATUS_ACCEPTED_PENDING_REVIEW",
    "STATUS_REFUSED_PENDING_ADJUDICATION",
]


@dataclass(frozen=True)
class SpanCollision:
    span: tuple[int, int]
    condition_refs: tuple[str, ...]
    roles: tuple[str, ...]
    severity: str          # "HIGH" (cross-role) | "REVIEW" (same-role reuse)
    detail: str


def role_of(condition_ref: str) -> str:
    """Top-level role of a condition reference: `entry_sequence[2].action` -> `entry_sequence`."""
    m = re.match(r"([A-Za-z_]+)", condition_ref or "")
    return m.group(1) if m else ""


def _overlap(a: tuple[int, int], b: tuple[int, int]) -> float:
    """Fraction of the SHORTER span covered by the intersection."""
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    inter = max(0, hi - lo)
    shortest = min(a[1] - a[0], b[1] - b[0])
    return inter / shortest if shortest > 0 else 0.0


def detect_span_collisions(
    locations: dict,
    substantial_overlap: float = 0.80,
) -> list[SpanCollision]:
    """Report source spans reused across conditions.

    `locations` maps condition_ref -> (start, end). Spans are grouped when they are identical
    or overlap by at least `substantial_overlap` of the shorter span, so a trivially trimmed
    re-use cannot evade the check by a few characters.

    Returns one entry per colliding group. An empty list means no reuse was detected — it does
    NOT mean the bindings are correct, only that this particular blindness is absent.
    """
    items = [(ref, tuple(span)) for ref, span in (locations or {}).items() if span]
    groups: list[list] = []
    for ref, span in sorted(items, key=lambda x: (x[1], x[0])):
        for g in groups:
            if _overlap(g[0][1], span) >= substantial_overlap:
                g.append((ref, span))
                break
        else:
            groups.append([(ref, span)])

    out: list[SpanCollision] = []
    for g in groups:
        if len(g) < 2:
            continue
        refs = tuple(r for r, _ in g)
        roles = tuple(sorted({role_of(r) for r in refs}))
        if len(roles) > 1:
            severity = "HIGH"
            detail = (
                f"one source span is the evidence for {len(refs)} conditions spanning "
                f"{len(roles)} different roles {list(roles)} — conditions in different roles "
                "assert different facts and cannot all rest on the same sentence"
            )
        else:
            severity = "REVIEW"
            detail = (
                f"one source span is reused by {len(refs)} conditions in the same role "
                f"({roles[0]}) — legitimate for closely related fields, but it must be "
                "adjudicated rather than assumed"
            )
        out.append(SpanCollision(
            span=g[0][1], condition_refs=refs, roles=roles,
            severity=severity, detail=detail,
        ))
    out.sort(key=lambda c: (c.severity != "HIGH", -len(c.condition_refs)))
    return out


STATUS_ACCEPTED = "ACCEPTED"
STATUS_ACCEPTED_PENDING_REVIEW = "ACCEPTED_PENDING_REVIEW"
STATUS_REFUSED_PENDING_ADJUDICATION = "REFUSED_PENDING_ADJUDICATION"


def adjudicate_locations(
    locations: dict,
    substantial_overlap: float = 0.80,
) -> tuple[dict, list[SpanCollision]]:
    """Apply `detect_span_collisions` to a location set BEFORE it is accepted
    (AR-1226 §6.3, verbatim: "Add a duplicate-span collision diagnostic before accepting a
    location set").

    🛑 A refusal here is NOT a claim that the quote is semantically wrong. It says the SET
    cannot be accepted as N independently grounded conditions without adjudication — which
    is why the status is `REFUSED_PENDING_ADJUDICATION` and never `WRONG`. Deciding which
    (if any) member of a cross-role group keeps the span is an adjudication this module does
    not make (§6.3: "expose/force adjudication, not invent that universal rule").

    The three tiers, and the second one is the one that keeps §6.4 honest:

      no reuse        -> ACCEPTED
      same-role reuse -> ACCEPTED_PENDING_REVIEW  (flagged, NEVER auto-refused — closely
                         related fields may legitimately rest on one sentence)
      cross-role reuse-> REFUSED_PENDING_ADJUDICATION  (fails closed: an entry rule, a stop
                         rule and a target rule assert different facts, so §6.5's cluster
                         can never silently pass as independent grounded conditions again)

    Returns `(verdicts, collisions)` where `verdicts` maps every condition_ref in
    `locations` to its status record. Refs with a falsy span are absent from both — an
    unlocated condition has no span to collide.
    """
    collisions = detect_span_collisions(locations, substantial_overlap=substantial_overlap)

    severity_of: dict[str, str] = {}
    group_of: dict[str, tuple[str, ...]] = {}
    for c in collisions:
        for ref in c.condition_refs:
            severity_of[ref] = c.severity
            group_of[ref] = c.condition_refs

    verdicts: dict[str, dict] = {}
    for ref, span in (locations or {}).items():
        if not span:
            continue
        severity = severity_of.get(ref)
        if severity == "HIGH":
            status, reason = (
                STATUS_REFUSED_PENDING_ADJUDICATION,
                "span is reused across different top-level roles; the set cannot be accepted "
                "as independently grounded conditions until adjudicated",
            )
        elif severity == "REVIEW":
            status, reason = (
                STATUS_ACCEPTED_PENDING_REVIEW,
                "span is reused within one role; legitimate for closely related fields, "
                "flagged for adjudication but not refused",
            )
        else:
            status, reason = STATUS_ACCEPTED, "span is not reused by any other condition"
        verdicts[ref] = {
            "status": status,
            "collision_severity": severity,
            "collides_with": [r for r in group_of.get(ref, ()) if r != ref],
            "reason": reason,
        }
    return verdicts, collisions


def summarise(collisions: list[SpanCollision]) -> dict:
    by = defaultdict(int)
    for c in collisions:
        by[c.severity] += 1
    return {"collisions": len(collisions), "high": by["HIGH"], "review": by["REVIEW"]}
