"""VERSIONED OPUS PHASE-1 ROUTE — AR-1236 §10.

WHAT THIS IS
    The smallest missing seam between components that already exist. AR-1236 §10's fast-path rule
    is explicit: *"Do not build another locator framework, another relevance framework, or another
    generic report system. Reuse what already exists and wire the smallest missing seams."*

    So this module contains **no gate of its own**. It is an ORDERING and a DISPOSITION machine:

        batch Opus map (raw preserved upstream)
            -> literal verifier            anchor_locator._verify_and_locate, via batch_locator
            -> complete-set collision HOLD span_collision.adjudicate_locations
            -> relevance                   evidence_relevance.evaluate_evidence_relevance
            -> fidelity / inflation        source_fidelity_guard.check_condition_fidelity
            -> isolated-Opus escalation    only for held / unresolved
            -> fail closed                 anything unresolved never reaches ACCEPTED

    Every one of those five is imported. If a gate's behaviour is wrong, it is wrong in ONE place
    and this file inherits the fix.

THE ORDER IS LOAD-BEARING, NOT COSMETIC (AR-1236 §10.5-§10.6)
    Collision HOLD runs BEFORE acceptance, and ONLY relevance-approved evidence reaches fidelity.
    Running fidelity on unvetted evidence would let a mis-grounded span "clear" an inflation check
    it was never entitled to face — the check would be measuring the wrong pair. `test_…` red-proofs
    the order by asserting fidelity is not even consulted for a relevance-rejected condition.

WHAT `ACCEPTED_PENDING_CERTIFICATION` MEANS, AND WHAT IT DOES NOT
    🛑 It means every mechanical and relevance gate passed and no inflation was detected. It is NOT
    a certification, and AR-1234 §4 named the wrong architecture by name: "Opus found a quote ->
    condition certified". Certification is GPT's, downstream, and this module cannot emit it.

FAIL CLOSED (AR-1236 §10.11)
    There is no path to ACCEPTED that skips a gate. Every non-accepting disposition names the gate
    that stopped it and carries that gate's own reason string verbatim. An unresolved condition is
    UNRESOLVED — never "probably fine".

DUPLICATE ROLE IS RECORDED, NEVER SILENTLY DEDUPLICATED (AR-1236 §5, §10.9)
    When two colliding conditions ask for the same rule, the locator returning one answer twice is
    correct behaviour, not corruption. But cross-role reuse must never auto-pass merely because it
    looks plausible. So the two cases are SEPARATED and BOTH HOLD:

        DUPLICATE_ROLE_AMBIGUITY : the CONDITION TEXTS themselves encode the same requirement
        ACCIDENTAL_EVIDENCE_REUSE: the conditions differ, but one span was used for both

    The discriminator is computed from the condition texts — the extractor's output, which is
    upstream of the locator under test — never from the spans, which is the thing in question.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from . import batch_locator as bl
from . import span_collision as sc
from .evidence_relevance import evaluate_evidence_relevance
from .source_fidelity_guard import check_condition_fidelity

ROUTE_VERSION = "opus-phase1-route-v2"

# --- terminal dispositions. ACCEPTED is the ONLY non-blocking one. ----------- #
ACCEPTED = "ACCEPTED_PENDING_CERTIFICATION"
REFUSED_NO_EVIDENCE = "REFUSED_NO_EVIDENCE"
REFUSED_NOT_LITERAL = "REFUSED_NOT_LITERAL"
HELD_DUPLICATE_ROLE = "HELD_DUPLICATE_ROLE_AMBIGUITY"
HELD_EVIDENCE_REUSE = "HELD_ACCIDENTAL_EVIDENCE_REUSE"
REFUSED_RELEVANCE = "REFUSED_RELEVANCE"
RED_FIDELITY = "RED_SOURCE_FIDELITY"

# Which dispositions earn an isolated-Opus re-query (AR-1236 §6 fallback triggers).
ESCALATES_TO_ISOLATED = frozenset({
    REFUSED_NO_EVIDENCE,     # batch reader abstained
    REFUSED_NOT_LITERAL,     # quote failed literal verification
    HELD_DUPLICATE_ROLE,     # duplicate-role ambiguity unresolved
    HELD_EVIDENCE_REUSE,     # HIGH collision unresolved
    REFUSED_RELEVANCE,       # relevance rejected or unresolved
    RED_FIDELITY,            # fidelity needs wider / composed evidence
})

# A duplicate-role call needs the two condition texts to be near the same requirement. 0.6 of the
# smaller term set is a deliberately HIGH bar: this classification only ever moves a HOLD from one
# labelled bucket to another, never out of HOLD, so a wrong call costs a label and not a gate.
DUPLICATE_ROLE_JACCARD = 0.6


@dataclass
class ConditionOutcome:
    condition_ref: str
    disposition: str
    gate: str                                   # which gate decided, by name
    reason: str                                 # that gate's own words, not a paraphrase
    char_span: list[int] | None = None
    quote: str | None = None
    escalate_to_isolated: bool = False
    relevance: dict | None = None
    fidelity_findings: list[dict] = field(default_factory=list)
    fidelity_advisory: list[dict] = field(default_factory=list)
    collision_partners: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        d = dict(self.__dict__)
        return d


def _content_terms(text: str) -> set:
    """Reuse the relevance gate's own tokenizer rather than writing a second one that drifts."""
    from .evidence_relevance import _terms
    return _terms(text or "")


def _same_requirement(a: str, b: str) -> tuple[bool, float]:
    ta, tb = _content_terms(a), _content_terms(b)
    if not ta or not tb:
        return False, 0.0
    overlap = len(ta & tb) / min(len(ta), len(tb))
    return overlap >= DUPLICATE_ROLE_JACCARD, overlap


def run_route(
    transcript: str,
    conditions: Sequence[dict],
    batch_answers: Sequence[dict],
    relevance_floor: float = 0.10,
) -> dict[str, Any]:
    """Run one video's batch map through every gate, in AR-1236 §10's order.

    `conditions`   : [{condition_ref, condition_text}, ...] from the extraction, its own order.
    `batch_answers`: [{condition_ref, raw_output}, ...] exactly as ingested — raw, unrepaired.

    Returns the full route record. It writes nothing; the driver owns persistence and the
    frozen-artifact refusal, so this module stays source-agnostic and testable.
    """
    text_by_ref = {c["condition_ref"]: c["condition_text"] for c in conditions}
    answers_by_ref = {a["condition_ref"]: a["raw_output"] for a in batch_answers}

    missing = [c["condition_ref"] for c in conditions if c["condition_ref"] not in answers_by_ref]
    if missing:
        raise ValueError(
            f"batch map is incomplete: {missing}. A missing condition is a NO-SHOW, not a "
            "decline, and inventing a null for it would convert a failure into a legal answer."
        )

    # ---- STAGE 1: the literal fence, unchanged and by import ---------------- #
    verified = {
        ref: bl.verify_answer(transcript, answers_by_ref[ref]) for ref in text_by_ref
    }

    # ---- STAGE 2: complete-set collision, BEFORE any acceptance ------------- #
    located = {
        ref: tuple(v["char_span"]) for ref, v in verified.items() if v["char_span"]
    }
    verdicts, collisions = sc.adjudicate_locations(located)
    held_refs = {
        ref for ref, v in verdicts.items() if v["status"] == sc.STATUS_HELD_FOR_ADJUDICATION
    }
    partners: dict[str, list[str]] = {}
    for group in collisions:
        for ref in group.condition_refs:
            partners.setdefault(ref, []).extend(r for r in group.condition_refs if r != ref)

    outcomes: list[ConditionOutcome] = []
    for c in conditions:
        ref = c["condition_ref"]
        cond_text = text_by_ref[ref]
        mech = verified[ref]

        # ---- gate: existence -------------------------------------------- #
        if mech["outcome"] == bl.OUTCOME_ABSTAINED:
            outcomes.append(ConditionOutcome(
                ref, REFUSED_NO_EVIDENCE, "literal_verifier",
                "the batch reader declined this condition; a decline is honest and it is still "
                "not evidence",
                escalate_to_isolated=True))
            continue
        if mech["outcome"] == bl.OUTCOME_NOT_LITERAL:
            outcomes.append(ConditionOutcome(
                ref, REFUSED_NOT_LITERAL, "literal_verifier",
                "the proposed quote is not a literal span of the pinned transcript",
                escalate_to_isolated=True))
            continue

        # ---- gate: collision HOLD, before acceptance --------------------- #
        if ref in held_refs:
            mates = sorted(set(partners.get(ref, [])))
            dup = any(_same_requirement(cond_text, text_by_ref.get(m, ""))[0] for m in mates)
            overlap = max(
                (_same_requirement(cond_text, text_by_ref.get(m, ""))[1] for m in mates),
                default=0.0,
            )
            outcomes.append(ConditionOutcome(
                ref,
                HELD_DUPLICATE_ROLE if dup else HELD_EVIDENCE_REUSE,
                "span_collision",
                (f"span reused across roles with {mates}; the condition texts overlap "
                 f"{overlap:.2f} of the smaller term set, so this is "
                 + ("THE SAME REQUIREMENT WRITTEN TWICE UPSTREAM — recorded, never silently "
                    "deduplicated (AR-1236 §5)"
                    if dup else
                    "reuse across DIFFERENT requirements, which the gate must not auto-pass")),
                char_span=mech["char_span"], quote=mech["quote"],
                escalate_to_isolated=True, collision_partners=mates))
            continue

        # ---- gate: relevance. Only its approvals may reach fidelity ------ #
        rivals = [t for r, t in text_by_ref.items() if r != ref]
        rv = evaluate_evidence_relevance(
            condition_text=cond_text,
            quote=mech["quote"],
            rival_conditions=rivals,
            source_document=transcript,
            floor=relevance_floor,
        )
        rel = {"grounded": rv.grounded, "reason": rv.reason, "own_score": rv.own_score,
               "best_rival_score": rv.best_rival_score, "rival": rv.rival,
               "shared_terms": list(rv.shared_terms)}
        if not rv.grounded:
            outcomes.append(ConditionOutcome(
                ref, REFUSED_RELEVANCE, "evidence_relevance", rv.reason,
                char_span=mech["char_span"], quote=mech["quote"],
                escalate_to_isolated=True, relevance=rel))
            continue

        # ---- gate: fidelity / inflation ---------------------------------- #
        findings = check_condition_fidelity(cond_text, [mech["quote"]])
        if findings:
            outcomes.append(ConditionOutcome(
                ref, RED_FIDELITY, "source_fidelity_guard",
                "; ".join(f"{f.kind}: {f.detail}" for f in findings),
                char_span=mech["char_span"], quote=mech["quote"],
                escalate_to_isolated=True, relevance=rel,
                fidelity_findings=[{"kind": f.kind, "clause": f.clause, "detail": f.detail}
                                   for f in findings]))
            continue

        outcomes.append(ConditionOutcome(
            ref, ACCEPTED, "all_gates",
            "literal, no unresolved collision, relevance-approved, no inflation detected — "
            "PENDING CERTIFICATION, which this route cannot issue",
            char_span=mech["char_span"], quote=mech["quote"], relevance=rel))

    # ---- ADVISORY fidelity sweep — §10.6 AND §10.7, which collide on real data --------------- #
    #
    # 🛑 MEASURED ON THE REAL SLICE, AND IT WAS A DEFECT IN THIS ROUTE'S FIRST BUILD: three of the
    # four inflation defects §10.7 requires the route to CATCH never reached the fidelity gate at
    # all, because relevance refused their evidence first and §10.6 forbids passing unvetted
    # evidence to fidelity. `confirms` and `high-probability` — both named in AR-1236 §4 — were
    # being reported as nothing but "relevance refused". The requirement looked met and was not.
    #
    # AND THE RELEVANCE REFUSAL MAY ITSELF BE WRONG: AR-1225 demonstrated this gate FALSE-REJECTS
    # a faithful paraphrase when the extractor normalised the wording (gap -> FVG), which is
    # exactly the shape of these rows — zero lexical overlap on a topically correct passage.
    # Masking a proven inflation behind a gate with a known false-reject mode is the worst of
    # both, so the finding is surfaced rather than swallowed.
    #
    # THE RESOLUTION PRESERVES BOTH CLAUSES AND INVENTS NO SEMANTICS:
    #   §10.6 holds — relevance still decides what may be ACCEPTED; advisory findings GATE NOTHING.
    #   §10.7 holds — the named defects are computed and visible on every literal-quoted condition.
    # A synonym/normalisation map would "fix" the false reject, and AR-1225 refused to invent one
    # for a source-truth gate. That refusal stands; this does not route around it.
    for o in outcomes:
        if o.disposition != ACCEPTED and o.quote:
            advisory = check_condition_fidelity(text_by_ref[o.condition_ref], [o.quote])
            o.fidelity_advisory = [
                {"kind": f.kind, "clause": f.clause, "detail": f.detail} for f in advisory
            ]

    accepted = [o for o in outcomes if o.disposition == ACCEPTED]
    escalate = [o.condition_ref for o in outcomes if o.escalate_to_isolated]

    # FAIL CLOSED: the route is green only when nothing is unresolved. A partial pass is a fail.
    route_grade = "GREEN_PENDING_CERTIFICATION" if len(accepted) == len(conditions) else "RED"

    counts: dict[str, int] = {}
    for o in outcomes:
        counts[o.disposition] = counts.get(o.disposition, 0) + 1

    return {
        "route_version": ROUTE_VERSION,
        "authority": "AR-1236 §10 (versioned Opus Phase-1 / Lane-G integration)",
        "grade": route_grade,
        "grade_meaning": (
            "GREEN_PENDING_CERTIFICATION means every condition cleared every mechanical and "
            "relevance gate with no detected inflation. IT IS NOT A CERTIFICATE. AR-1234 §4 "
            "names 'Opus found a quote -> condition certified' as the wrong architecture; "
            "certification is the external authority's and this route cannot issue one."
        ),
        "gate_order": [
            "literal_verifier (anchor_locator, by import)",
            "span_collision complete-set HOLD (before acceptance)",
            "evidence_relevance (only approvals continue)",
            "source_fidelity_guard (relevance-approved evidence only)",
        ],
        "fidelity_advisory_policy": (
            "`fidelity_advisory` is computed on every literal-quoted NON-ACCEPTED condition and "
            "GATES NOTHING — it changed no disposition and cannot. It exists because AR-1236 "
            "§10.6 (only relevance-approved evidence feeds fidelity) and §10.7 (the route must "
            "catch the proven `confirms` / `high-probability` / timing-window / causal defects) "
            "collide on this slice: relevance refuses the evidence first, so the named defects "
            "would otherwise be invisible. Advisory findings are NOT proof the condition is "
            "inflated — the evidence they were computed against was itself refused."
        ),
        "condition_count": len(conditions),
        "disposition_counts": counts,
        "accepted_count": len(accepted),
        "escalate_to_isolated": escalate,
        "escalation_policy": (
            "Isolated-Opus re-query fires ONLY for these refs (AR-1236 §6). A routine stable "
            "condition does not get isolated treatment merely to force byte-identical spans."
        ),
        "collisions": [
            {"span": list(g.span), "condition_refs": list(g.condition_refs),
             "roles": list(g.roles), "severity": g.severity} for g in collisions
        ],
        "outcomes": [o.as_dict() for o in outcomes],
    }
