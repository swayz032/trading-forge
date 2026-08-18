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

import hashlib
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from . import batch_locator as bl
from . import span_collision as sc
from .evidence_antecedent import Span, bind_qualifier_to_antecedent
from .evidence_relevance import evaluate_evidence_relevance
from .opus_phase1_route import _same_requirement, _validate_composition_specs
from .source_fidelity_guard import check_condition_fidelity

PROJECTION_VERSION = "source-graph-projection-v2"

ACCEPTED = "ACCEPTED_PENDING_CERTIFICATION"
ALIAS_OF_CANONICAL = "ALIAS_OF_CANONICAL"
PRESERVED_NON_EXECUTABLE_METADATA = "PRESERVED_NON_EXECUTABLE_METADATA"


@dataclass(frozen=True)
class AliasSpec:
    alias_ref: str
    canonical_ref: str
    authority: str


@dataclass(frozen=True)
class GraphEdge:
    from_ref: str
    to_ref: str
    edge_type: str


@dataclass(frozen=True)
class ProjectionSpec:
    canonical_refs: tuple[str, ...]
    alias_specs: tuple[AliasSpec, ...]
    preserved_metadata_refs: tuple[str, ...]
    # {condition_ref: {"disposition": ..., "reason": ..., "history": ...}} -- verbatim caller
    # data for every preserved_metadata_ref; not computed by this module.
    preserved_metadata_records: dict[str, dict]
    # AR-1322A F50: {condition_ref: {"original_condition_text": str, "authority": str}} for every
    # ref whose PROJECTED text (in `conditions`) differs from what the pinned extraction
    # originally said. A ref with no entry here is asserted unchanged from the original
    # extraction. This module computes and embeds the original/projected SHA-256 pair itself
    # (never trusts a caller-supplied hash) so the receipt is self-verifying.
    correction_ledger: dict[str, dict] = None  # type: ignore[assignment]
    # AR-1322A F51: explicit dependency/order edges over EITHER canonical or alias refs. Opaque
    # to this module -- edge_type strings are fixture vocabulary the generic module never
    # inspects; only ref existence, acyclicity, and reachability are checked structurally.
    graph_edges: tuple[GraphEdge, ...] = ()
    # Refs from which every canonical node must be reachable via graph_edges (structural
    # completeness check, AR-1322A F51 "complete reachability of all nine canonical nodes").
    graph_roots: tuple[str, ...] = ()

    def __post_init__(self):
        if self.correction_ledger is None:
            object.__setattr__(self, "correction_ledger", {})


def _claim_role(condition_ref: str) -> str:
    """Mechanical role parse from the ref shape alone -- no fixture knowledge.

    entry_sequence[N].action / .rationale -> "action" / "rationale"
    confluences[N].description            -> "description"
    stop.rationale                        -> "rationale"
    targets[N].rationale                  -> "rationale"

    🛑 THIS FUNCTION ANSWERS "what claim role is this?", NOT "is this eligible to be excluded
    as non-executable metadata?" `stop.rationale` and `targets[N].rationale` share the string
    "rationale" with `entry_sequence[N].rationale` under this parse, but they are the trade's
    stop and target attachments -- never eligible for silent exclusion from the executable
    denominator. AR-1322A F49: a caller that checked `_claim_role(ref) == "rationale"` for
    metadata eligibility could exclude a stop or target ref and this function would agree.
    Use `_ENTRY_SEQUENCE_RATIONALE_RE` / `_eligible_for_preserved_metadata` for that decision
    instead -- deliberately a NARROWER, separate predicate so the two questions can never be
    silently conflated again.
    """
    tail = condition_ref.rsplit(".", 1)[-1]
    return tail


_ENTRY_SEQUENCE_RATIONALE_RE = re.compile(r"^entry_sequence\[\d+\]\.rationale$")


def _eligible_for_preserved_metadata(condition_ref: str) -> bool:
    """ONLY an `entry_sequence[N].rationale` ref may ever be preserved as non-executable
    metadata under this versioned contract (AR-1321A §7.6, AR-1322A F49 repair). An action, a
    confluence description, the stop rationale, or a target rationale is NEVER eligible --
    regardless of what `_claim_role` returns for it -- because each of those is a distinct
    source-owned executable attachment (entry trigger, timing confluence, stop geometry, profit
    target), never mere extractor commentary. This is a narrow allow-list, not a role check, so
    it cannot silently widen if a future ref shape happens to end in the word "rationale"."""
    return bool(_ENTRY_SEQUENCE_RATIONALE_RE.match(condition_ref))


def _sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def validate_graph_edges(
    edges: Sequence[GraphEdge], valid_refs: set[str], root_refs: Sequence[str],
    required_reachable: set[str],
) -> dict:
    """Structural-only validation (AR-1322A F51). This function has NO knowledge of what an
    `edge_type` string means -- it only checks:

        1. every `from_ref`/`to_ref` names a real ref in this run;
        2. the edge set is a DAG (no cycles) -- a dependency graph that cycles cannot express an
           order at all;
        3. every ref in `required_reachable` is reachable from at least one `root_refs` entry by
           following edges forward.

    Raises ValueError on (1) or (2) -- those are malformed-graph errors, not diagnostic findings.
    Returns a dict reporting (3), since incomplete reachability is a real, reportable finding
    about THIS graph's completeness, not a schema error.
    """
    for e in edges:
        if e.from_ref not in valid_refs:
            raise ValueError(f"graph edge references unknown from_ref {e.from_ref!r}")
        if e.to_ref not in valid_refs:
            raise ValueError(f"graph edge references unknown to_ref {e.to_ref!r}")
    for r in root_refs:
        if r not in valid_refs:
            raise ValueError(f"graph root {r!r} is not a valid ref in this run")

    adjacency: dict[str, list[str]] = {}
    for e in edges:
        adjacency.setdefault(e.from_ref, []).append(e.to_ref)

    # Cycle check: DFS with a recursion-stack set.
    WHITE, GREY, BLACK = 0, 1, 2
    color = {r: WHITE for r in valid_refs}
    cycle_found: list[str] = []

    def _dfs(node: str, path: list[str]) -> None:
        color[node] = GREY
        for nxt in adjacency.get(node, []):
            if color[nxt] == GREY:
                cycle_found.append(" -> ".join(path + [nxt]))
                return
            if color[nxt] == WHITE:
                _dfs(nxt, path + [nxt])
        color[node] = BLACK

    for r in sorted(valid_refs):
        if color[r] == WHITE:
            _dfs(r, [r])
        if cycle_found:
            raise ValueError(f"GRAPH_CYCLE_DETECTED: {cycle_found[0]}")

    reachable: set[str] = set()
    frontier = list(root_refs)
    while frontier:
        node = frontier.pop()
        if node in reachable:
            continue
        reachable.add(node)
        frontier.extend(adjacency.get(node, []))

    unreachable = sorted(required_reachable - reachable)
    return {
        "edge_count": len(edges),
        "root_refs": list(root_refs),
        "required_reachable_count": len(required_reachable),
        "reachable_count": len(required_reachable & reachable),
        "unreachable_refs": unreachable,
        "complete": not unreachable,
    }


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

    # Preserved-metadata mutation control (AR-1321A §7.6, narrowed by AR-1322A F49): only an
    # `entry_sequence[N].rationale` ref is eligible. NOT `_claim_role(r) == "rationale"` -- that
    # check also matches `stop.rationale` and `targets[N].rationale`, which must NEVER be
    # excludable this way (F49 fail-open finding).
    for r in preserved:
        if not _eligible_for_preserved_metadata(r):
            raise ValueError(
                f"PRESERVED_METADATA_REFUSED: {r!r} is not an entry_sequence[N].rationale ref. "
                "Only that exact shape is eligible for preserved non-executable metadata; an "
                "action, a confluence description, the stop rationale, or a target rationale "
                "may never be excluded from the executable denominator this way, even though "
                "some of them share the claim-role string 'rationale'."
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

    def _provenance(ref: str) -> dict:
        """AR-1322A F50: self-verifying original/projected text ledger entry for ANY ref. This
        module computes both hashes itself from the actual texts in play -- never trusts a
        caller-supplied hash -- so the receipt cannot silently drift from what was really used."""
        ledger_entry = projection.correction_ledger.get(ref)
        projected = text_by_ref[ref]
        if ledger_entry is not None:
            original = ledger_entry["original_condition_text"]
            authority = ledger_entry.get("authority", "")
        else:
            original = projected
            authority = "unchanged from pinned extraction"
        return {
            "original_condition_text": original,
            "original_condition_text_sha256": _sha256(original),
            "projected_condition_text": projected,
            "projected_condition_text_sha256": _sha256(projected),
            "text_changed": original != projected,
            "correction_authority": authority,
        }

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
        if alias_mech is None or alias_mech.get("outcome") != bl.OUTCOME_LITERAL:
            raise ValueError(
                f"ALIAS_EVIDENCE_REFUSED: {a.alias_ref!r} has no literal-verified evidence "
                "of its own -- an alias must be mechanically literal and non-null before it "
                "may inherit its canonical ref's disposition (AR-1322A §3.E)"
            )
        alias_quote = alias_mech["quote"]
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
            "original_quote": alias_quote,
            "original_quote_sha256": _sha256(alias_quote),
            "original_char_span": list(alias_mech["char_span"]),
        }

    for ref in projection.preserved_metadata_refs:
        rec = dict(projection.preserved_metadata_records[ref])
        rec["condition_ref"] = ref
        rec["disposition"] = PRESERVED_NON_EXECUTABLE_METADATA
        rec["excluded_from_denominator"] = True
        outcomes[ref] = rec

    # AR-1322A F50: embed self-verifying original/projected-text provenance and evidence-quote
    # hashes on EVERY outcome, not only canonical ones -- the receipt must be reconstructible
    # without reading the temporary fixture driver.
    for ref, o in outcomes.items():
        o["provenance"] = _provenance(ref)
        if o.get("quote") is not None:
            o["quote_sha256"] = _sha256(o["quote"])
        if o.get("evidence_quotes"):
            o["evidence_quote_sha256"] = [_sha256(q) for q in o["evidence_quotes"]]
        comp = o.get("composition")
        if comp and comp.get("antecedent_quote"):
            comp["antecedent_quote_sha256"] = _sha256(comp["antecedent_quote"])

    canonical_accepted = [
        r for r in projection.canonical_refs if outcomes[r]["disposition"] == ACCEPTED
    ]

    graph_report = validate_graph_edges(
        edges=list(projection.graph_edges),
        valid_refs=set(text_by_ref) | {a.alias_ref for a in projection.alias_specs},
        root_refs=list(projection.graph_roots),
        required_reachable=canonical_set,
    )

    grade = (
        "GREEN_PENDING_CERTIFICATION"
        if len(canonical_accepted) == len(projection.canonical_refs) and graph_report["complete"]
        else "RED"
    )

    return {
        "projection_version": PROJECTION_VERSION,
        "authority": "AR-1321A section 4-6 / AR-1322A section 3 (v2 receipt/guard/evidence repair)",
        "grade": grade,
        "grade_meaning": (
            "GREEN_PENDING_CERTIFICATION means every CANONICAL node cleared every mechanical, "
            "role-bounded-relevance, and fidelity gate, AND the declared graph is a complete "
            "DAG in which every canonical node is reachable from a declared root. It is NOT a "
            "certificate; certification remains external. Determinism, the negative/mutation "
            "controls, and the neighboring test suites are verified OUTSIDE this function's "
            "return value -- this grade covers only what a single run can check about itself."
        ),
        "conservation": {
            "input_ref_count": len(conditions),
            "canonical_count": len(projection.canonical_refs),
            "alias_count": len(projection.alias_specs),
            "preserved_metadata_count": len(projection.preserved_metadata_refs),
        },
        "canonical_refs": list(projection.canonical_refs),
        "canonical_accepted_count": len(canonical_accepted),
        "graph": {
            "edges": [
                {"from": e.from_ref, "to": e.to_ref, "type": e.edge_type}
                for e in projection.graph_edges
            ],
            **graph_report,
        },
        "outcomes": [outcomes[c["condition_ref"]] for c in conditions],
    }
