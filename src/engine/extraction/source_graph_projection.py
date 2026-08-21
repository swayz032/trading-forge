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
import json
import re
from collections.abc import Sequence
from copy import deepcopy
from dataclasses import asdict, dataclass
from typing import Any

from . import batch_locator as bl
from . import span_collision as sc
from .evidence_antecedent import Span, bind_qualifier_to_antecedent
from .evidence_relevance import evaluate_evidence_relevance
from .opus_phase1_route import _same_requirement, _validate_composition_specs
from .source_fidelity_guard import check_condition_fidelity

PROJECTION_VERSION = "source-graph-projection-v2.1"

ACCEPTED = "ACCEPTED_PENDING_CERTIFICATION"
ALIAS_OF_CANONICAL = "ALIAS_OF_CANONICAL"
PRESERVED_NON_EXECUTABLE_METADATA = "PRESERVED_NON_EXECUTABLE_METADATA"


# AR-1395 Stage C0 (AR-1385A section 6) -- typed EXTERNAL DECISION DEPENDENCIES.
#
# A taught rule whose value is computed OUTSIDE Trading Forge -- an indicator, a data vendor, a
# platform overlay -- previously had nowhere to live here. The representation offered "an executable
# condition" or "the source did not say", and nothing between them. So a required gate whose
# provider MEANING was fully known, but whose provider ACCESS was unproven, was forced into the
# nearest wrong bucket and reported as an absent source rule.
#
# THREE FACTS THAT MUST NEVER COLLAPSE INTO ONE BOOLEAN:
#   semantic status       -- what the source says the value MEANS
#   access status         -- whether the exact value can be OBTAINED, live and historically
#   implementation status -- whether a validated adapter exists
#
# Like `graph_edges`, the domain vocabulary here is OPAQUE to this module. Output values and their
# gate consequences are fixture data; this module validates STRUCTURE only -- identity, consumer
# existence and executability, coverage of every declared output, the fail-closed law, declared
# consistency, and a self-computed contract hash. It never inspects what a value MEANS.
EXTERNAL_DEPENDENCY_KIND_INDICATOR = "EXTERNAL_INDICATOR"
EXTERNAL_DEPENDENCY_KIND_DATA_FEED = "EXTERNAL_DATA_FEED"
EXTERNAL_DEPENDENCY_KIND_PLATFORM = "EXTERNAL_PLATFORM_STATE"
_EXTERNAL_DEPENDENCY_KINDS = frozenset({
    EXTERNAL_DEPENDENCY_KIND_INDICATOR,
    EXTERNAL_DEPENDENCY_KIND_DATA_FEED,
    EXTERNAL_DEPENDENCY_KIND_PLATFORM,
})

ACCESS_UNVERIFIED = "UNVERIFIED"
ACCESS_VERIFIED = "VERIFIED"
ACCESS_UNAVAILABLE = "UNAVAILABLE"
_ACCESS_STATUSES = frozenset({ACCESS_UNVERIFIED, ACCESS_VERIFIED, ACCESS_UNAVAILABLE})

# The sentinel every external contract must declare: "the provider did not tell us". Its only
# admissible consequence is the fail-closed action. A contract that permits acting on an unresolved
# value is a fail-OPEN gate, which is the one thing this whole structure exists to make impossible.
UNRESOLVED_OUTPUT = "UNKNOWN"
FAIL_CLOSED_ACTION = "NO_TRADE"

# Readiness is emitted ALONGSIDE the grade, never instead of the semantic status. RED here means
# "not ready to execute", never "the source was not understood" -- conflating those two is exactly
# what produced a false terminal source refusal.
BLOCKED_EXTERNAL_DEPENDENCY = "BLOCKED_EXTERNAL_DEPENDENCY"
READY_PENDING_CERTIFICATION = "READY_PENDING_CERTIFICATION"

# AR-1395 F-5: the semantic axis is a CLOSED vocabulary. It was free text, so "the source was
# understood" could be asserted with an arbitrary string in a receipt whose whole purpose is to keep
# that fact honest.
SEMANTIC_RESOLVED = "MULTIMODAL_RESOLVED"
SEMANTIC_UNRESOLVED = "VISUAL_UNRESOLVED"
SEMANTIC_CONFLICT = "SOURCE_CONFLICT"
_SEMANTIC_STATUSES = frozenset({SEMANTIC_RESOLVED, SEMANTIC_UNRESOLVED, SEMANTIC_CONFLICT})

# AR-1395 F-3: the implementation axis GATES. It previously gated nothing, so a dependency with a
# verified provider and NO ADAPTER BUILT reported READY. Access proven and adapter built are two
# different facts and neither implies the other.
IMPL_NOT_STARTED = "NOT_STARTED"
IMPL_IN_PROGRESS = "IN_PROGRESS"
IMPL_VALIDATED = "VALIDATED"
_IMPL_STATUSES = frozenset({IMPL_NOT_STARTED, IMPL_IN_PROGRESS, IMPL_VALIDATED})

# AR-1395 F-4: a provider PROVEN UNAVAILABLE is a different verdict from one merely unmeasured, and
# it is TERMINAL. Reporting it as "access unverified, terminal false" inverted this module's own
# stated principle -- "unverified is not unavailable" -- inside the code protecting it.
BLOCKER_ACCESS_UNVERIFIED = "EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED"
BLOCKER_CAPABILITY_UNAVAILABLE = "UNSUPPORTED_CAPABILITY_REFUSAL"

# AR-1386A sections 3 and 5: `reason` used to be a TWO-WAY choice between terminal and nonterminal,
# so every nonterminal block was labelled ACCESS_UNVERIFIED whatever had actually blocked it. GPT
# measured a receipt reading `reason=EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED` with
# `axes=[implementation_status]` and every access axis VERIFIED. The gate was safe and the receipt
# was false, which sends the next reader to fix the wrong thing.
#
# One cause code per axis that can block, so a reason can never contradict its own axes.
BLOCKER_SEMANTIC_UNRESOLVED = "EXTERNAL_DEPENDENCY_SEMANTIC_UNRESOLVED"
BLOCKER_SEMANTIC_CONFLICT = "EXTERNAL_DEPENDENCY_SEMANTIC_CONFLICT"
BLOCKER_IMPLEMENTATION_UNVALIDATED = "EXTERNAL_DEPENDENCY_IMPLEMENTATION_UNVALIDATED"

# Precedence for the single `reason` field, most severe first. `cause_codes` always carries EVERY
# cause, so this ordering only decides which one is promoted to the headline -- AR-1386A section 5
# forbids collapsing mixed causes, not summarising them. Terminal outranks everything because it is
# the fact a reader must not miss; the remaining order follows the ruling's own enumeration.
_BLOCKER_PRECEDENCE = (
    BLOCKER_CAPABILITY_UNAVAILABLE,
    BLOCKER_ACCESS_UNVERIFIED,
    BLOCKER_IMPLEMENTATION_UNVALIDATED,
    BLOCKER_SEMANTIC_UNRESOLVED,
    BLOCKER_SEMANTIC_CONFLICT,
)

# The axes that must each be independently proven before an external dependency is executable.
# Access is not one fact: live delivery, historical replay and update policy each separately gate a
# faithful backtest, so any one of them unproven blocks.
_ACCESS_AXES = ("access_status", "live_delivery", "historical_replay", "update_policy")

# AR-1397 grader LOW note: the compile seam re-derives readiness from the emitted records, and it
# was importing the four ACCESS axis names but RESTATING "implementation_status" and
# "semantic_status" as string literals. 4 of 6 imported, 2 hand-copied -- so a seventh gating axis
# added here would silently not be re-derived there, which is the exact drift this packet keeps
# finding. This map is the ONE place that answers "which axes gate, and what value satisfies each".
# `test_source_graph_projection`/`test_external_dependency_projection` pin it against the gating
# logic below by mutation, so it cannot fall out of sync without a test going red.
GATING_AXES: dict[str, str] = {
    **{axis: ACCESS_VERIFIED for axis in _ACCESS_AXES},
    "implementation_status": IMPL_VALIDATED,
    "semantic_status": SEMANTIC_RESOLVED,
}


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
class ExternalDependencySpec:
    """One decision value this strategy needs that something outside Trading Forge computes.

    `consumer_refs` is a SET of existing executable condition refs, not one positional index: a
    single provider value can gate several taught conditions, and a positional index into a
    candidate's sequence is not a stable identity. The dependency never REPLACES those conditions
    -- every consumer stays conserved in the projection -- it records who computes a value they
    depend on.

    `configuration` and `output_contract` are opaque caller data. `output_contract` is
    `{"type": "enum", "values": [...], "gate": {value: consequence}}`; this module checks that every
    declared value has a consequence and that the unresolved sentinel fails closed, never what any
    consequence means.
    """

    dependency_id: str
    consumer_refs: tuple[str, ...]
    kind: str
    provider: str
    artifact: str
    platform: str
    display_chart_timeframe: str
    decision_timeframe: str
    configuration: dict
    output_contract: dict
    semantic_status: str
    access_status: str
    live_delivery: str
    historical_replay: str
    update_policy: str
    implementation_status: str
    # Optional caller-declared digest. It is only ever CHECKED against the hash this module
    # computes itself -- never accepted in its place. Excluded from the hash it is compared to.
    expected_contract_sha256: str | None = None


def _canonical_json_sha256(record: dict) -> str:
    """Deterministic hash of a plain record.

    Identical in form to `scripts/source_graph_projection_v2_1_certify.py::_canonical_hash` and to
    the v2.1 compile adapter's copy of it. Reused rather than re-derived so a contract hash computed
    here can never drift from the certifier's own determinism proof.

    (The sibling module is referenced by role rather than by filename on purpose: this module is
    fenced against source-specific strings by
    `test_source_graph_projection.py::test_module_contains_no_source_specific_strings`, and that
    fence caught the filename here on the first run.)
    """
    blob = json.dumps(record, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def external_dependency_contract_hash(dep: ExternalDependencySpec) -> str:
    """The authoritative contract identity, computed from every declared field.

    `expected_contract_sha256` is excluded -- a record cannot contain its own digest. Everything
    else is included, so any change to identity, consumers, configuration, output contract or
    status is observable as a different hash. Drift that nothing can see is drift nothing can
    refuse.
    """
    record = {k: v for k, v in asdict(dep).items() if k != "expected_contract_sha256"}
    # AR-1395 F-6b: SORTED. `consumer_refs` is a set by contract, so two specs differing only in the
    # order they happen to list the same consumers are the SAME contract -- and were hashing
    # differently, which would read as drift where none exists.
    record["consumer_refs"] = sorted(dep.consumer_refs)
    return _canonical_json_sha256(record)


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
    # AR-1395 C0: typed external decision dependencies. Defaulted-empty and OMITTED FROM THE
    # RECEIPT when empty, on the same additive discipline `ConditionBinding.parameters` uses, so a
    # spec that declares none serialises byte-identically to before this field existed and the
    # committed certification artifacts keep their canonical hashes.
    external_dependencies: tuple[ExternalDependencySpec, ...] = ()

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


# AR-1323A F56: the minimum narrow schema a `preserved_metadata_records` entry must satisfy. A
# dict merely existing (the AR-1322A-era check) is not enough -- `{"reason": "x"}` passed and
# still passes the eligibility gate above it. This is membership/shape validation only; it does
# not judge whether the CONTENT is a good historical record, only that the required fields exist
# and are internally consistent (e.g. a null `historical_evidence` must carry its own reason).
_REQUIRED_PRESERVED_METADATA_KEYS = (
    "original_text", "historical_disposition", "historical_evidence",
    "exclusion_reason", "exclusion_authority",
)


def _validate_preserved_metadata_schema(ref: str, record: dict) -> None:
    missing = [k for k in _REQUIRED_PRESERVED_METADATA_KEYS if k not in record]
    if missing:
        raise ValueError(
            f"PRESERVED_METADATA_SCHEMA_INCOMPLETE: {ref!r} record is missing required key(s) "
            f"{missing} -- a bare {{'reason': ...}} scaffold no longer satisfies the schema "
            "(AR-1323A F56); every preserved-metadata record must carry original_text, "
            "historical_disposition, historical_evidence (an object or explicit null), "
            "exclusion_reason, and exclusion_authority"
        )
    if not str(record.get("original_text") or "").strip():
        raise ValueError(
            f"PRESERVED_METADATA_SCHEMA_INCOMPLETE: {ref!r} record's original_text is empty"
        )
    if not str(record.get("exclusion_reason") or "").strip():
        raise ValueError(
            f"PRESERVED_METADATA_SCHEMA_INCOMPLETE: {ref!r} record's exclusion_reason is empty"
        )
    if not str(record.get("exclusion_authority") or "").strip():
        raise ValueError(
            f"PRESERVED_METADATA_SCHEMA_INCOMPLETE: {ref!r} record's exclusion_authority is "
            "empty -- an unauthored exclusion is an invented adjudication wearing a schema's "
            "clothes, the same rule AR-1243 section 11 applies to composition specs and aliases"
        )
    if not str(record.get("historical_disposition") or "").strip():
        raise ValueError(
            f"PRESERVED_METADATA_SCHEMA_INCOMPLETE: {ref!r} record's historical_disposition is "
            "empty"
        )
    corrected_text = record.get("corrected_text")
    if corrected_text is not None and not str(record.get("correction_authority") or "").strip():
        raise ValueError(
            f"PRESERVED_METADATA_SCHEMA_INCOMPLETE: {ref!r} record declares corrected_text but "
            "no correction_authority"
        )
    hist_ev = record.get("historical_evidence")
    if hist_ev is None:
        if not str(record.get("historical_evidence_null_reason") or "").strip():
            raise ValueError(
                f"PRESERVED_METADATA_SCHEMA_INCOMPLETE: {ref!r} record's historical_evidence is "
                "null but carries no historical_evidence_null_reason -- an explicit null must "
                "say WHY no historical evidence span exists, not merely omit one"
            )
        if not str(record.get("historical_evidence_null_authority") or "").strip():
            raise ValueError(
                f"PRESERVED_METADATA_SCHEMA_INCOMPLETE: {ref!r} record's historical_evidence is "
                "null but carries no historical_evidence_null_authority"
            )
    else:
        if not isinstance(hist_ev, dict) or "quote" not in hist_ev or "char_span" not in hist_ev:
            raise ValueError(
                f"PRESERVED_METADATA_SCHEMA_INCOMPLETE: {ref!r} record's historical_evidence "
                "must be an object with 'quote' and 'char_span', or explicit null"
            )


def validate_graph_edges(
    edges: Sequence[GraphEdge], valid_refs: set[str], root_refs: Sequence[str],
    required_reachable: set[str], allowed_edge_types: Sequence[str] | None = None,
) -> dict:
    """Structural-only validation (AR-1322A F51, AR-1323A F57). This function has NO knowledge of
    what an `edge_type` string MEANS -- it only checks:

        1. every `from_ref`/`to_ref` names a real ref in this run;
        2. every `edge_type` is non-empty, and (when `allowed_edge_types` is supplied) is a member
           of that caller-declared vocabulary -- membership only, never semantic inference;
        3. the edge set is a DAG (no cycles) -- a dependency graph that cycles cannot express an
           order at all;
        4. every ref in `required_reachable` is reachable from at least one `root_refs` entry by
           following edges forward.

    Raises ValueError on (1)/(2)/(3) -- those are malformed-graph errors, not diagnostic findings.
    Returns a dict reporting (4), since incomplete reachability is a real, reportable finding
    about THIS graph's completeness, not a schema error.

    `allowed_edge_types=None` (the default) skips the vocabulary-membership check -- existing
    callers that never declared a vocabulary keep their prior behavior byte-for-byte; the empty-
    type refusal applies unconditionally because an edge with no type asserts no order semantics
    at all, vocabulary or not.
    """
    vocab = set(allowed_edge_types) if allowed_edge_types is not None else None
    for e in edges:
        if e.from_ref not in valid_refs:
            raise ValueError(f"graph edge references unknown from_ref {e.from_ref!r}")
        if e.to_ref not in valid_refs:
            raise ValueError(f"graph edge references unknown to_ref {e.to_ref!r}")
        if not str(e.edge_type or "").strip():
            raise ValueError(
                f"GRAPH_EDGE_TYPE_EMPTY: edge {e.from_ref!r} -> {e.to_ref!r} has no edge_type; "
                "every declared edge must assert an order semantic, not merely a topology link"
            )
        if vocab is not None and e.edge_type not in vocab:
            raise ValueError(
                f"GRAPH_EDGE_TYPE_UNKNOWN: edge {e.from_ref!r} -> {e.to_ref!r} declares "
                f"edge_type {e.edge_type!r}, which is not a member of the declared vocabulary "
                f"{sorted(vocab)!r}"
            )
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


def validate_external_dependencies(
    dependencies: Sequence[ExternalDependencySpec],
    valid_refs: set[str],
    metadata_refs: set[str],
    alias_refs: set[str] | None = None,
) -> dict:
    """Structural validation of typed external decision dependencies. Refuses by raising.

    Checks identity, consumer existence AND executability, output coverage, the fail-closed law,
    declared consistency, and the self-computed contract hash. It never inspects what an output
    value MEANS -- that vocabulary is fixture data, exactly as `edge_type` is for the graph.

    Returns a readiness report (mirroring `validate_graph_edges`, which likewise RAISES on
    structural violations and RETURNS completeness): the unverified axes per dependency, and
    whether anything blocks. Readiness is reported, not raised, because an unproven dependency is
    a legitimate nonterminal state -- the caller turns it into a grade.
    """
    alias_refs = alias_refs or set()
    seen: set[str] = set()
    unverified: dict[str, list[str]] = {}
    unavailable: list[str] = []
    cause_codes: set[str] = set()
    records: list[dict] = []

    for dep in dependencies:
        if not (dep.dependency_id or "").strip():
            raise ValueError("EXTERNAL_DEPENDENCY_ID_EMPTY: a dependency must be identifiable")
        if dep.dependency_id in seen:
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_ID_DUPLICATE: {dep.dependency_id!r} declared more than once")
        seen.add(dep.dependency_id)

        if not dep.consumer_refs:
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_CONSUMERS_EMPTY: {dep.dependency_id!r} gates nothing")
        # AR-1395 F-14: consumer_refs is a SET. A repeated ref emitted the dependency once per
        # occurrence, so "preserved exactly once" was false for a caller that listed one twice.
        if len(set(dep.consumer_refs)) != len(dep.consumer_refs):
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_CONSUMER_DUPLICATE: {dep.dependency_id!r} lists a consumer "
                f"more than once; consumer_refs is a set, not a sequence")
        for ref in dep.consumer_refs:
            if ref not in valid_refs:
                raise ValueError(
                    f"EXTERNAL_DEPENDENCY_CONSUMER_UNKNOWN: {dep.dependency_id!r} names {ref!r}, "
                    f"which is not a ref in this run")
            if ref in metadata_refs:
                raise ValueError(
                    f"EXTERNAL_DEPENDENCY_CONSUMER_NOT_EXECUTABLE: {dep.dependency_id!r} names "
                    f"{ref!r}, which is excluded from the executable denominator. A required gate "
                    f"may not be attached to preserved commentary.")
            # AR-1395 F-9: an alias is a POINTER to a canonical node, not an executable node of its
            # own -- it carries ALIAS_OF_CANONICAL, never ACCEPTED. Gating on the pointer instead of
            # the thing it points at is an indirection the receipt cannot honestly report.
            if ref in alias_refs:
                raise ValueError(
                    f"EXTERNAL_DEPENDENCY_CONSUMER_IS_ALIAS: {dep.dependency_id!r} names {ref!r}, "
                    f"which is an alias of a canonical ref. Name the canonical ref instead.")

        if dep.kind not in _EXTERNAL_DEPENDENCY_KINDS:
            raise ValueError(f"EXTERNAL_DEPENDENCY_KIND_UNKNOWN: {dep.kind!r}")
        for axis in _ACCESS_AXES:
            if getattr(dep, axis) not in _ACCESS_STATUSES:
                raise ValueError(
                    f"EXTERNAL_DEPENDENCY_STATUS_UNKNOWN: {axis}={getattr(dep, axis)!r}")
        # AR-1395 F-5: closed vocabularies, and non-empty provider identity. An unvalidated
        # semantic_status let "the source was understood" be asserted as free text; blank
        # provider/artifact/platform left a dependency nobody could route or audit.
        if dep.semantic_status not in _SEMANTIC_STATUSES:
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_SEMANTIC_STATUS_UNKNOWN: {dep.semantic_status!r}")
        if dep.implementation_status not in _IMPL_STATUSES:
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_IMPL_STATUS_UNKNOWN: {dep.implementation_status!r}")
        for field in ("provider", "artifact", "platform"):
            if not (getattr(dep, field) or "").strip():
                raise ValueError(f"EXTERNAL_DEPENDENCY_IDENTITY_EMPTY: {field}")

        for field in ("display_chart_timeframe", "decision_timeframe"):
            if not (getattr(dep, field) or "").strip():
                raise ValueError(f"EXTERNAL_DEPENDENCY_TIMEFRAME_EMPTY: {field}")
        declared_htf = (dep.configuration or {}).get("higher_timeframe")
        if declared_htf is not None and declared_htf != dep.decision_timeframe:
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_TIMEFRAME_CONTRADICTION: configuration declares "
                f"{declared_htf!r} while decision_timeframe is {dep.decision_timeframe!r}")

        contract = dep.output_contract or {}
        values = list(contract.get("values") or ())
        gate = dict(contract.get("gate") or {})
        if contract.get("type") != "enum":
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_OUTPUT_TYPE_UNKNOWN: {dep.dependency_id!r} declares type "
                f"{contract.get('type')!r}; only 'enum' is supported")
        if not values:
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_OUTPUT_VALUES_EMPTY: {dep.dependency_id!r}")
        if len(set(values)) != len(values):
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_OUTPUT_VALUE_DUPLICATE: {dep.dependency_id!r}")
        if UNRESOLVED_OUTPUT not in values:
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_UNRESOLVED_VALUE_MISSING: {dep.dependency_id!r} declares no "
                f"{UNRESOLVED_OUTPUT!r} value, so it cannot express provider silence")

        # 🛑 AR-1395 F-2, A CRITICAL FAIL-OPEN HOLE THE INDEPENDENT GRADER FOUND.
        # This checked `values subset-of gate` ONLY. An EXTRA gate key that appears in no declared
        # value therefore passed -- and the receipt then handed every downstream consumer a mapping
        # containing it. A provider emitting that value would be read straight out of the gate and
        # acted on, in the one structure whose entire purpose is that acting is impossible unless it
        # was declared. Coverage must be an EQUALITY, not an inclusion, in both directions.
        missing = sorted(v for v in values if v not in gate)
        if missing:
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_GATE_INCOMPLETE: {dep.dependency_id!r} declares "
                f"{missing!r} with no consequence")
        undeclared = sorted(k for k in gate if k not in set(values))
        if undeclared:
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_GATE_UNDECLARED_VALUE: {dep.dependency_id!r} maps "
                f"{undeclared!r}, which is not a declared output value. A consequence for a value "
                f"the contract never declares is a route to action nobody authorised.")
        if gate[UNRESOLVED_OUTPUT] != FAIL_CLOSED_ACTION:
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_FAIL_OPEN: {dep.dependency_id!r} maps {UNRESOLVED_OUTPUT!r} "
                f"to {gate[UNRESOLVED_OUTPUT]!r}; the only admissible consequence of an "
                f"unresolved provider value is {FAIL_CLOSED_ACTION!r}")

        computed = external_dependency_contract_hash(dep)
        if dep.expected_contract_sha256 is not None and dep.expected_contract_sha256 != computed:
            raise ValueError(
                f"EXTERNAL_DEPENDENCY_CONTRACT_HASH_MISMATCH: {dep.dependency_id!r} declares "
                f"{dep.expected_contract_sha256!r}, canonical serialization gives {computed!r}")

        axes = [a for a in _ACCESS_AXES if getattr(dep, a) != ACCESS_VERIFIED]
        causes: set[str] = set()
        # Only an axis that is literally UNVERIFIED may be reported as unverified. One that is
        # proven UNAVAILABLE is a different verdict and gets its own code below -- folding it in
        # here would restate, inside the cause vocabulary, the very conflation the vocabulary
        # exists to prevent.
        if any(getattr(dep, a) == ACCESS_UNVERIFIED for a in _ACCESS_AXES):
            causes.add(BLOCKER_ACCESS_UNVERIFIED)
        # AR-1395 F-3: implementation is its own blocking axis. Provider access proven and adapter
        # built are different facts; neither implies the other, and only one of them was gating.
        if dep.implementation_status != IMPL_VALIDATED:
            axes.append("implementation_status")
            causes.add(BLOCKER_IMPLEMENTATION_UNVALIDATED)
        # 🛑 AR-1386A SECTION 3, THE CRITICAL FAIL-OPEN THIS PACKET EXISTS TO CLOSE.
        # AR-1396 gave `semantic_status` a closed vocabulary but left it gating NOTHING, so GPT held
        # every access and implementation axis ready, changed only the meaning, and measured
        # VISUAL_UNRESOLVED and SOURCE_CONFLICT both reaching READY_PENDING_CERTIFICATION.
        # A CLOSED VOCABULARY STOPS GIBBERISH; IT DOES NOT MAKE AN UNRESOLVED MEANING EXECUTABLE.
        # Especially here: the operator's correction was that visual evidence had been MISSED, and
        # the compiler must not later trade through that same unresolved state just because a
        # provider and an adapter turned up.
        if dep.semantic_status != SEMANTIC_RESOLVED:
            axes.append("semantic_status")
            causes.add(BLOCKER_SEMANTIC_UNRESOLVED if dep.semantic_status == SEMANTIC_UNRESOLVED
                       else BLOCKER_SEMANTIC_CONFLICT)
        if axes:
            unverified[dep.dependency_id] = axes
        # AR-1395 F-4: a provider PROVEN UNAVAILABLE is terminal, and distinguishing it from merely
        # unmeasured is the whole point of the vocabulary.
        if any(getattr(dep, a) == ACCESS_UNAVAILABLE for a in _ACCESS_AXES):
            unavailable.append(dep.dependency_id)
            causes.add(BLOCKER_CAPABILITY_UNAVAILABLE)
        cause_codes |= causes

        records.append({
            "dependency_id": dep.dependency_id,
            # AR-1386A section 6, deterministic correction: SORTED, matching the contract hash.
            # F-6b sorted the refs for the HASH but left the EMITTED record in caller order, so GPT
            # measured EQUAL contract hashes with UNEQUAL receipts for the same two consumers
            # reversed. If two artifacts that are the same contract are not the same receipt, then
            # receipt identity and contract identity mean different things and neither can be
            # trusted to detect drift.
            "consumer_refs": sorted(dep.consumer_refs),
            "kind": dep.kind,
            "provider": dep.provider,
            "artifact": dep.artifact,
            "platform": dep.platform,
            "display_chart_timeframe": dep.display_chart_timeframe,
            "decision_timeframe": dep.decision_timeframe,
            # AR-1395 F-6: DEEP-COPIED. These were stored by reference, so a caller mutating its own
            # dict after validation silently rewrote the receipt -- including the gate map, after the
            # fail-closed check had already approved it. Validation that a later write can undo is
            # not validation.
            "configuration": deepcopy(dep.configuration),
            "output_contract": deepcopy(dep.output_contract),
            "semantic_status": dep.semantic_status,
            "access_status": dep.access_status,
            "live_delivery": dep.live_delivery,
            "historical_replay": dep.historical_replay,
            "update_policy": dep.update_policy,
            "implementation_status": dep.implementation_status,
            "contract_sha256": computed,
        })

    return {
        "records": records,
        "unverified_axes": unverified,
        "unavailable_dependency_ids": sorted(unavailable),
        "cause_codes": sorted(cause_codes),
        "blocked": bool(unverified),
        "terminal": bool(unavailable),
    }


def _validate_projection_spec(
    spec: ProjectionSpec, conditions: Sequence[dict], text_by_ref: dict[str, str],
    transcript: str | None = None, strict_preserved_metadata_schema: bool = False,
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
        record = spec.preserved_metadata_records[r]
        if strict_preserved_metadata_schema:
            _validate_preserved_metadata_schema(r, record)
        hist_ev = record.get("historical_evidence")
        if hist_ev is not None and transcript is not None:
            start, end = int(hist_ev["char_span"][0]), int(hist_ev["char_span"][1])
            if transcript[start:end] != hist_ev["quote"]:
                raise ValueError(
                    f"PRESERVED_METADATA_EVIDENCE_NOT_LITERAL: {r!r} record's "
                    f"historical_evidence char_span [{start}, {end}] does not exactly equal "
                    "its declared quote in the pinned transcript"
                )


def run_projection(
    transcript: str,
    conditions: Sequence[dict],
    batch_answers: Sequence[dict],
    projection: ProjectionSpec,
    relevance_floor: float = 0.10,
    composition_specs: Sequence[dict] | None = None,
    extra_evidence_by_ref: dict[str, tuple[Any, ...]] | None = None,
    transcript_sha256: str | None = None,
    extraction_sha256: str | None = None,
    allowed_edge_types: Sequence[str] | None = None,
    strict_preserved_metadata_schema: bool = False,
) -> dict[str, Any]:
    """`extra_evidence_by_ref`: OPTIONAL additional literal spans folded into a canonical ref's
    fidelity evidence package, for a claim whose full scope is grounded by more than one
    independent literal span WITHOUT a deictic antecedent relationship between them (e.g. a
    bidirectional rule the source teaches via two separate worked examples). This is NOT
    `evidence_antecedent` composition — there is no "earlier definition, later reference" link
    to check order/grounding/same-entity/no-redefinition against; there are simply two literal
    spans that both bear on one claim. Relevance still runs on the PRIMARY span alone (same
    `evaluated_on: primary_span_only` scoping rule `opus_phase1_route.py` already documents for
    composition); only fidelity sees the full set.

    Each item in an `extra_evidence_by_ref` tuple is EITHER:
      * a bare `str` quote (legacy shape, preserved byte-for-byte for existing callers) — checked
        only for literal substring membership, no span embedded in the receipt; OR
      * a `dict` `{"quote": str, "char_span": [start, end]}` (AR-1323A F55) — checked for EXACT
        span identity (`transcript[start:end] == quote`, not mere substring containment, so two
        identical-text occurrences can never be silently conflated) and the resolved span/quote/
        hash is embedded per-item in the outcome's `evidence_spans` list.

    `transcript_sha256` / `extraction_sha256` (AR-1323A F55): optional caller-supplied pins.
    `transcript_sha256`, if given, is VERIFIED against a hash this function computes itself from
    the `transcript` argument in hand (never trusts the caller's claim) and embedded at receipt
    top level on match; a mismatch raises. `extraction_sha256` is carried through and embedded
    verbatim — this function has no access to the extraction record to verify it independently;
    that verification is the caller's responsibility (the caller has the record).

    `strict_preserved_metadata_schema` (AR-1323A F56, default `False`): when `True`, every
    `preserved_metadata_records` entry must satisfy the narrow schema
    `_validate_preserved_metadata_schema` enforces. Default `False` preserves the frozen v1/v2
    candidates' exact prior behavior byte-for-byte (`{"reason": ...}` scaffolding still passes) —
    this function never rewrites a caller's historical record shape to satisfy a schema that
    postdates it. The v2.1 stable spec loader always passes `True`.
    """
    if transcript_sha256 is not None:
        computed = _sha256(transcript)
        if computed != transcript_sha256:
            raise ValueError(
                f"TRANSCRIPT_PIN_MISMATCH: caller-supplied transcript_sha256 {transcript_sha256!r} "
                f"does not match the sha256 of the transcript text in hand ({computed!r})"
            )
    text_by_ref = {c["condition_ref"]: c["condition_text"] for c in conditions}
    answers_by_ref = {a["condition_ref"]: a["raw_output"] for a in batch_answers}
    _validate_projection_spec(
        projection, conditions, text_by_ref, transcript=transcript,
        strict_preserved_metadata_schema=strict_preserved_metadata_schema,
    )
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

        extra_items = tuple((extra_evidence_by_ref or {}).get(ref, ()))
        extra_quotes: list[str] = []
        extra_spans: list[dict] = []
        for item in extra_items:
            if isinstance(item, dict):
                eq, span = item["quote"], item["char_span"]
                start, end = int(span[0]), int(span[1])
                if transcript[start:end] != eq:
                    raise ValueError(
                        f"extra_evidence_by_ref[{ref!r}] declares char_span [{start}, {end}] "
                        f"that does not exactly equal its quote in the pinned transcript -- "
                        "the literal fence requires exact span identity, not mere substring "
                        "containment, so an ambiguous repeated quote can never be silently "
                        "resolved to the wrong occurrence"
                    )
                extra_quotes.append(eq)
                extra_spans.append({
                    "quote": eq, "char_span": [start, end], "quote_sha256": _sha256(eq),
                })
            else:
                eq = item
                if eq not in transcript:
                    raise ValueError(
                        f"extra_evidence_by_ref[{ref!r}] contains a span that is not a literal "
                        "substring of the pinned transcript -- the literal fence is "
                        "non-negotiable for every evidence path, including supplementary spans"
                    )
                extra_quotes.append(eq)
        full_evidence = list(evidence_quotes) + extra_quotes

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
                "supplementary_evidence_spans": extra_spans,
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
            "supplementary_evidence_spans": extra_spans,
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
        # AR-1323A F56: self-verifying hashes for every text/quote this module was handed, on the
        # same never-trust-a-caller-supplied-hash discipline as `_provenance()` below.
        rec["original_text_sha256"] = _sha256(rec.get("original_text", ""))
        if rec.get("corrected_text") is not None:
            rec["corrected_text_sha256"] = _sha256(rec["corrected_text"])
        hist_ev = rec.get("historical_evidence")
        if hist_ev is not None:
            hist_ev["quote_sha256"] = _sha256(hist_ev["quote"])
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
        allowed_edge_types=allowed_edge_types,
    )

    # AR-1395 C0: an unresolved external dependency drives the EXISTING `RED` route with a
    # structured reason. No new grade string is minted -- `g2d_finalizer` refuses any grade outside
    # {RED, GREEN_PENDING_CERTIFICATION}, and inventing a third value would fail closed there for
    # the wrong reason. Readiness is reported beside the grade, never in place of the semantic
    # status: RED here means NOT READY TO EXECUTE, never "the source was not understood".
    external_report = validate_external_dependencies(
        dependencies=list(projection.external_dependencies),
        valid_refs=set(text_by_ref) | {a.alias_ref for a in projection.alias_specs},
        metadata_refs=set(projection.preserved_metadata_refs),
        alias_refs={a.alias_ref for a in projection.alias_specs},
    )

    grade = (
        "GREEN_PENDING_CERTIFICATION"
        if len(canonical_accepted) == len(projection.canonical_refs)
        and graph_report["complete"]
        and not external_report["blocked"]
        else "RED"
    )

    external_block: dict[str, Any] = {}
    if projection.external_dependencies:
        external_block["external_dependencies"] = external_report["records"]
        external_block["compile_readiness"] = (
            BLOCKED_EXTERNAL_DEPENDENCY if external_report["blocked"]
            else READY_PENDING_CERTIFICATION
        )
        if external_report["blocked"]:
            # AR-1395 F-4: which verdict this is depends on WHY it blocks. Merely unmeasured is
            # nonterminal -- the provider may well expose the value and nobody has looked. PROVEN
            # UNAVAILABLE is terminal and must say so. Reporting the second as the first inverted
            # this module's own "unverified is not unavailable" law inside the code enforcing it.
            #
            # 🛑 AR-1386A SECTION 5. That fix left `reason` a TWO-WAY choice, so every NONTERMINAL
            # block was labelled ACCESS_UNVERIFIED whatever had really blocked it. GPT measured
            # `reason=EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED` on a receipt whose every access axis
            # was VERIFIED and whose only blocking axis was `implementation_status`. The gate was
            # safe and the receipt was FALSE -- and a false cause sends the next reader to fix the
            # wrong thing, which is how an instrument does damage without ever being unsafe.
            #
            # So: `reason` is chosen from the causes that ACTUALLY fired, and `cause_codes` carries
            # every one of them. Mixed causes are summarised, never collapsed.
            terminal = external_report["terminal"]
            causes = external_report["cause_codes"]
            reason = next((c for c in _BLOCKER_PRECEDENCE if c in causes), BLOCKER_ACCESS_UNVERIFIED)
            external_block["structured_blocker"] = {
                "reason": reason,
                "cause_codes": causes,
                "terminal": terminal,
                "dependency_ids": sorted(external_report["unverified_axes"]),
                "unverified_axes": external_report["unverified_axes"],
                "unavailable_dependency_ids": external_report["unavailable_dependency_ids"],
            }

    return {
        "projection_version": PROJECTION_VERSION,
        "authority": (
            "AR-1321A section 4-6 / AR-1322A section 3 / AR-1323A section 3 (v2.1 "
            "certificate-contract closure: versioned spec, self-contained evidence receipt, "
            "preserved-metadata schema, typed-graph vocabulary, durable proof, stable runner)"
        ),
        "transcript_sha256": transcript_sha256 if transcript_sha256 is not None else _sha256(transcript),
        "extraction_sha256": extraction_sha256,
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
        **external_block,
        "outcomes": [outcomes[c["condition_ref"]] for c in conditions],
    }
