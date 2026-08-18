"""VERSIONED SOURCE-GRAPH CERTIFICATION PROJECTION — AR-1321A §4-6.

WHAT THIS IS AND WHY IT EXISTS

    AR-1320B's measurement proved the flat 12-row denominator in `opus_phase1_route.py` is
    confounded: a rationale that legitimately explains its own sibling action is penalized as if
    it were the RED-A generic-disclaimer defect, because every condition competes against every
    other condition regardless of claim role or dependency (AR-1321A §3).

    This module is the "smallest missing seam" repair AR-1321A §4 authorizes: a new VERSIONED
    projection that classifies the flat extraction's condition refs into exactly one of three
    disjoint buckets before certification, and computes relevance rivals ROLE-BOUNDED (same
    claim-role only) rather than flat-all. It is explicitly NOT a second compiler, NOT a second
    semantic grader, and NOT a change to `evidence_relevance.py`'s gate, floor, or
    `term_equivalence.py` — every one of those stays imported and byte-unchanged.

    Reused BY IMPORT, never reimplemented:
        anchor_locator / batch_locator   -- literal verification
        span_collision                   -- complete-set collision HOLD
        evidence_relevance                -- relevance gate (only its RIVAL SET changes, at the
                                             caller, not inside the gate)
        evidence_antecedent               -- antecedent/qualifier composition
        source_fidelity_guard             -- fidelity / inflation

WHAT THE PROJECTION DOES

    Given a caller-supplied `ProjectionSpec` classifying all N incoming condition_refs into:

        canonical_refs            -- refs that enter the executable certification denominator
        alias_specs                -- {alias_ref, canonical_ref, authority} -- one explicit
                                       external adjudication that alias_ref's requirement is
                                       THE SAME requirement as canonical_ref's, not a silent
                                       auto-dedup. Refused (raised) unless the two condition
                                       texts independently satisfy the SAME Jaccard-overlap test
                                       `opus_phase1_route._same_requirement` already uses to
                                       classify a collision as DUPLICATE_ROLE (reused by import,
                                       not reimplemented) -- so an attempt to alias two genuinely
                                       different requirements is refused mechanically, not by
                                       trusting the caller's say-so.
        preserved_metadata_refs   -- refs that are real extractor output, preserved with full
                                       provenance, but do NOT add a distinct source-owned
                                       executable decision and do not enter the denominator.
                                       Refused (raised) for any ref whose parsed claim-role is
                                       not "rationale" -- an action, description, stop, or target
                                       can never be silently excluded as "non-executable
                                       metadata" by construction, not by caller discipline alone.

    it validates the conservation invariant `len(conditions) == len(canonical_refs) +
    len(alias_specs) + len(preserved_metadata_refs)` with no ref missing, duplicated, or in more
    than one bucket, then runs every canonical ref through the SAME five-gate pipeline
    `opus_phase1_route.run_route` uses, in the same order, with one caller-level change: the
    relevance rival set for a canonical ref is every OTHER canonical ref sharing its claim role
    (action / rationale / description), not every other condition regardless of role.

    Alias refs never compete independently. Their outcome inherits the canonical ref's
    disposition while preserving their own original text/quote/span/hash for the receipt.

    Preserved-metadata refs never enter a gate. Their outcome is supplied verbatim by the caller
    (their own prior disposition/history), tagged so a reader can see they are deliberately
    excluded from the denominator, not silently dropped.

NO FIXTURE-SPECIFIC STRING LIVES HERE (AR-1321A §6.3)

    This module contains no strategy, instrument, video, or teacher-specific text. Every
    condition text, evidence quote, antecedent span, and bucket assignment is supplied by the
    caller via `ProjectionSpec` / `conditions` / `batch_answers`. A test asserts this the same
    way `evidence_antecedent.py` and `evidence_relevance.py` are already asserted source-agnostic.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from . import batch_locator as bl
from . import span_collision as sc
from .evidence_antecedent import Span, bind_qualifier_to_antecedent
from .evidence_relevance import evaluate_evidence_relevance
from .opus_phase1_route import _same_requirement, _validate_composition_specs
from .source_fidelity_guard import check_condition_fidelity

PROJECTION_VERSION = "source-graph-projection-v1"

ACCEPTED = "ACCEPTED_PENDING_CERTIFICATION"
ALIAS_OF_CANONICAL = "ALIAS_OF_CANONICAL"
PRESERVED_NON_EXECUTABLE_METADATA = "PRESERVED_NON_EXECUTABLE_METADATA"


@dataclass(frozen=True)
class AliasSpec:
    alias_ref: str
    canonical_ref: str
    authority: str


@dataclass(frozen=True)
class ProjectionSpec:
    canonical_refs: tuple[str, ...]
    alias_specs: tuple[AliasSpec, ...]
    preserved_metadata_refs: tuple[str, ...]
    # {condition_ref: {"disposition": ..., "reason": ..., "history": ...}} -- verbatim caller
    # data for every preserved_metadata_ref; not computed by this module.
    preserved_metadata_records: dict[str, dict]


def _claim_role(condition_ref: str) -> str:
    """Mechanical role parse from the ref shape alone -- no fixture knowledge.

    entry_sequence[N].action / .rationale -> "action" / "rationale"
    confluences[N].description            -> "description"
    stop.rationale                        -> "rationale"
    targets[N].rationale                  -> "rationale"
    """
    tail = condition_ref.rsplit(".", 1)[-1]
    return tail


def _validate_projection_spec(
    spec: ProjectionSpec, conditions: Sequence[dict], text_by_ref: dict[str, str]
) -> None:
    all_refs = {c["condition_ref"] for c in conditions}

    canonical = list(spec.canonical_refs)
    aliases = list(spec.alias_specs)
    preserved = list(spec.preserved_metadata_refs)

    bucket_of: dict[str, str] = {}
    for r in canonical:
        if r in bucket_of:
            raise ValueError(f"condition_ref {r!r} appears in more than one projection bucket")
        bucket_of[r] = "canonical"
    for a in aliases:
        if a.alias_ref in bucket_of:
            raise ValueError(
                f"condition_ref {a.alias_ref!r} appears in more than one projection bucket"
            )
        bucket_of[a.alias_ref] = "alias"
    for r in preserved:
        if r in bucket_of:
            raise ValueError(f"condition_ref {r!r} appears in more than one projection bucket")
        bucket_of[r] = "preserved_metadata"

    covered = set(bucket_of)
    if covered != all_refs:
        missing = all_refs - covered
        extra = covered - all_refs
        raise ValueError(
            "CONSERVATION_VIOLATION: projection buckets do not exactly cover the incoming "
            f"condition set. missing={sorted(missing)} extra_or_unknown={sorted(extra)}"
        )
    if len(conditions) != len(canonical) + len(aliases) + len(preserved):
        raise ValueError(
            "CONSERVATION_VIOLATION: "
            f"{len(conditions)} input refs != {len(canonical)} canonical + {len(aliases)} "
            f"alias + {len(preserved)} preserved_metadata"
        )

    # Alias negative control (AR-1321A §7.5): refuse an alias between conditions whose texts do
    # not independently satisfy the SAME duplicate-role test the collision gate already uses.
    for a in aliases:
        if a.canonical_ref not in bucket_of or bucket_of[a.canonical_ref] != "canonical":
            raise ValueError(
                f"alias {a.alias_ref!r} declares canonical_ref {a.canonical_ref!r}, which is "
                "not itself a canonical ref in this projection"
            )
        same, overlap = _same_requirement(
            text_by_ref[a.alias_ref], text_by_ref[a.canonical_ref]
        )
        if not same:
            raise ValueError(
                f"ALIAS_REFUSED: {a.alias_ref!r} and {a.canonical_ref!r} do not meet the "
                f"duplicate-role overlap test (overlap={overlap:.3f}); an alias between "
                "conditions the mechanical test does not judge to be the same requirement is "
                "refused rather than trusted on the caller's assertion alone"
            )
        if not str(a.authority or "").strip():
            raise ValueError(
                f"alias {a.alias_ref!r} -> {a.canonical_ref!r} has no `authority`; an "
                "unauthored alias is an invented per-video adjudication wearing a parameter's "
                "clothes (same rule AR-1243 §11 applies to composition specs)"
            )

    # Preserved-metadata mutation control (AR-1321A §7.6): only a "rationale"-role ref may ever
    # be excluded as non-executable metadata. An action, description, stop, or target ref can
    # never be silently excluded this way.
    for r in preserved:
        role = _claim_role(r)
        if role != "rationale":
            raise ValueError(
                f"PRESERVED_METADATA_REFUSED: {r!r} has claim-role {role!r}, not 'rationale'. "
                "Only a rationale may be preserved as non-executable metadata; an action, "
                "description, stop, or target ref may never be excluded from the executable "
                "denominator this way."
            )
        if r not in spec.preserved_metadata_records:
            raise ValueError(
                f"preserved_metadata_ref {r!r} has no caller-supplied record in "
                "preserved_metadata_records; this module computes nothing for a preserved ref, "
                "it only carries what the caller supplies"
            )


def run_projection(
    transcript: str,
    conditions: Sequence[dict],
    batch_answers: Sequence[dict],
    projection: ProjectionSpec,
    relevance_floor: float = 0.10,
    composition_specs: Sequence[dict] | None = None,
    extra_evidence_by_ref: dict[str, tuple[str, ...]] | None = None,
) -> dict[str, Any]:
    """`extra_evidence_by_ref`: OPTIONAL additional literal spans folded into a canonical ref's
    fidelity evidence package, for a claim whose full scope is grounded by more than one
    independent literal span WITHOUT a deictic antecedent relationship between them (e.g. a
    bidirectional rule the source teaches via two separate worked examples). This is NOT
    `evidence_antecedent` composition — there is no "earlier definition, later reference" link
    to check order/grounding/same-entity/no-redefinition against; there are simply two literal
    spans that both bear on one claim. The only check this function itself performs is that each
    extra span is a LITERAL substring of the pinned transcript — the same non-negotiable literal
    fence every other evidence path in this pipeline already enforces. Relevance still runs on
    the PRIMARY span alone (same `evaluated_on: primary_span_only` scoping rule
    `opus_phase1_route.py` already documents for composition); only fidelity sees the full set.
    """
    text_by_ref = {c["condition_ref"]: c["condition_text"] for c in conditions}
    answers_by_ref = {a["condition_ref"]: a["raw_output"] for a in batch_answers}
    _validate_projection_spec(projection, conditions, text_by_ref)
    specs_by_ref = _validate_composition_specs(composition_specs, text_by_ref)

    canonical_set = set(projection.canonical_refs)
    role_pool: dict[str, list[str]] = {}
    for ref in canonical_set:
        role_pool.setdefault(_claim_role(ref), []).append(ref)

    missing = [ref for ref in canonical_set if ref not in answers_by_ref]
    if missing:
        raise ValueError(f"batch map is incomplete for canonical refs: {missing}")

    verified = {ref: bl.verify_answer(transcript, answers_by_ref[ref]) for ref in canonical_set}
    located = {ref: tuple(v["char_span"]) for ref, v in verified.items() if v["char_span"]}
    verdicts, collisions = sc.adjudicate_locations(located)
    held_refs = {
        ref for ref, v in verdicts.items() if v["status"] == sc.STATUS_HELD_FOR_ADJUDICATION
    }

    outcomes: dict[str, dict] = {}
    for ref in projection.canonical_refs:
        cond_text = text_by_ref[ref]
        mech = verified[ref]

        if mech["outcome"] == bl.OUTCOME_ABSTAINED:
            outcomes[ref] = {
                "condition_ref": ref, "disposition": "REFUSED_NO_EVIDENCE",
                "gate": "literal_verifier",
                "reason": "the batch reader declined this condition",
            }
            continue
        if mech["outcome"] == bl.OUTCOME_NOT_LITERAL:
            outcomes[ref] = {
                "condition_ref": ref, "disposition": "REFUSED_NOT_LITERAL",
                "gate": "literal_verifier",
                "reason": "the proposed quote is not a literal span of the pinned transcript",
            }
            continue

        if ref in held_refs:
            outcomes[ref] = {
                "condition_ref": ref, "disposition": "HELD_UNEXPECTED_COLLISION",
                "gate": "span_collision",
                "reason": (
                    "this canonical ref collided with another canonical ref's span and was NOT "
                    "declared as an authorized alias pair in this projection -- a real, "
                    "unadjudicated collision, not the known F37 pair"
                ),
                "char_span": list(mech["char_span"]), "quote": mech["quote"],
            }
            continue

        rivals = [text_by_ref[r] for r in role_pool[_claim_role(ref)] if r != ref]
        rv = evaluate_evidence_relevance(
            condition_text=cond_text, quote=mech["quote"], rival_conditions=rivals,
            source_document=transcript, floor=relevance_floor,
        )
        rel = {
            "grounded": rv.grounded, "reason": rv.reason, "own_score": rv.own_score,
            "best_rival_score": rv.best_rival_score, "rival": rv.rival,
            "shared_terms": list(rv.shared_terms), "rival_pool": "role_bounded",
            "rival_pool_role": _claim_role(ref), "rival_pool_size": len(rivals),
        }
        if not rv.grounded:
            outcomes[ref] = {
                "condition_ref": ref, "disposition": "REFUSED_RELEVANCE",
                "gate": "evidence_relevance", "reason": rv.reason,
                "char_span": list(mech["char_span"]), "quote": mech["quote"], "relevance": rel,
                "evidence_quotes": [mech["quote"]],
            }
            continue

        evidence_quotes = [mech["quote"]]
        comp_record = None
        spec = specs_by_ref.get(ref)
        if spec is not None:
            ante = spec.get("antecedent_span")
            binding = bind_qualifier_to_antecedent(
                transcript=transcript, qualifier=spec["qualifier"],
                qualifier_synonyms=tuple(spec.get("qualifier_synonyms") or ()),
                referring_span=Span(*mech["char_span"]),
                antecedent_span=Span(int(ante[0]), int(ante[1])) if ante else None,
                entity_terms=tuple(spec.get("entity_terms") or ()),
                definitional_markers=tuple(spec.get("definitional_markers") or ()),
            )
            comp_record = {
                "attempted": True, "bound": binding.bound, "qualifier": binding.qualifier,
                "reason": binding.reason, "authority": spec["authority"],
                "antecedent_span": (
                    [binding.antecedent_span.start, binding.antecedent_span.end]
                    if binding.antecedent_span else None
                ),
                "antecedent_quote": (
                    binding.antecedent_span.text(transcript) if binding.antecedent_span else None
                ),
            }
            if not binding.bound:
                outcomes[ref] = {
                    "condition_ref": ref, "disposition": "RED_ANTECEDENT_UNBOUND",
                    "gate": "evidence_antecedent", "reason": binding.reason,
                    "char_span": list(mech["char_span"]), "quote": mech["quote"],
                    "relevance": rel, "composition": comp_record,
                    "evidence_quotes": [mech["quote"]],
                }
                continue
            evidence_quotes = [comp_record["antecedent_quote"], mech["quote"]]

        extra_quotes = tuple((extra_evidence_by_ref or {}).get(ref, ()))
        for eq in extra_quotes:
            if eq not in transcript:
                raise ValueError(
                    f"extra_evidence_by_ref[{ref!r}] contains a span that is not a literal "
                    "substring of the pinned transcript -- the literal fence is non-negotiable "
                    "for every evidence path, including supplementary spans"
                )
        full_evidence = list(evidence_quotes) + list(extra_quotes)

        findings = check_condition_fidelity(cond_text, full_evidence)
        if findings:
            outcomes[ref] = {
                "condition_ref": ref, "disposition": "RED_SOURCE_FIDELITY",
                "gate": "source_fidelity_guard",
                "reason": "; ".join(f"{f.kind}: {f.detail}" for f in findings),
                "char_span": list(mech["char_span"]), "quote": mech["quote"],
                "relevance": rel, "composition": comp_record,
                "fidelity_findings": [
                    {"kind": f.kind, "clause": f.clause, "detail": f.detail} for f in findings
                ],
                "evidence_quotes": full_evidence,
            }
            continue

        outcomes[ref] = {
            "condition_ref": ref, "disposition": ACCEPTED, "gate": "all_gates",
            "reason": (
                "literal, no unauthorized collision, role-bounded relevance approved, "
                "no inflation detected on the complete governed evidence package"
            ),
            "char_span": list(mech["char_span"]), "quote": mech["quote"], "relevance": rel,
            "composition": comp_record, "evidence_quotes": full_evidence,
        }

    for a in projection.alias_specs:
        canonical_outcome = outcomes[a.canonical_ref]
        alias_answer = answers_by_ref.get(a.alias_ref)
        alias_mech = bl.verify_answer(transcript, alias_answer) if alias_answer else None
        outcomes[a.alias_ref] = {
            "condition_ref": a.alias_ref, "disposition": ALIAS_OF_CANONICAL,
            "gate": "source_graph_projection_alias",
            "reason": (
                f"declared alias of canonical ref {a.canonical_ref!r} under authority "
                f"{a.authority!r}; inherits {canonical_outcome['disposition']} without "
                "competing independently for relevance or fidelity"
            ),
            "alias_of": a.canonical_ref,
            "inherited_disposition": canonical_outcome["disposition"],
            "original_condition_text": text_by_ref[a.alias_ref],
            "original_quote": alias_mech["quote"] if alias_mech else None,
            "original_char_span": (
                list(alias_mech["char_span"]) if alias_mech and alias_mech["char_span"] else None
            ),
        }

    for ref in projection.preserved_metadata_refs:
        rec = dict(projection.preserved_metadata_records[ref])
        rec["condition_ref"] = ref
        rec["disposition"] = PRESERVED_NON_EXECUTABLE_METADATA
        rec["excluded_from_denominator"] = True
        outcomes[ref] = rec

    canonical_accepted = [
        r for r in projection.canonical_refs if outcomes[r]["disposition"] == ACCEPTED
    ]
    grade = (
        "GREEN_PENDING_CERTIFICATION"
        if len(canonical_accepted) == len(projection.canonical_refs)
        else "RED"
    )

    return {
        "projection_version": PROJECTION_VERSION,
        "authority": "AR-1321A section 4-6 (versioned source-graph certification projection)",
        "grade": grade,
        "grade_meaning": (
            "GREEN_PENDING_CERTIFICATION means every CANONICAL node cleared every mechanical, "
            "role-bounded-relevance, and fidelity gate. It is NOT a certificate; certification "
            "remains external. Alias and preserved-metadata refs are conserved but do not enter "
            "this denominator by design."
        ),
        "conservation": {
            "input_ref_count": len(conditions),
            "canonical_count": len(projection.canonical_refs),
            "alias_count": len(projection.alias_specs),
            "preserved_metadata_count": len(projection.preserved_metadata_refs),
        },
        "canonical_refs": list(projection.canonical_refs),
        "canonical_accepted_count": len(canonical_accepted),
        "outcomes": [outcomes[c["condition_ref"]] for c in conditions],
    }
