"""AR-1395 Stage C0 — permanent tests for typed EXTERNAL DECISION DEPENDENCIES in the source graph.

AUTHORITY: AR-1385A sections 6 and 7, on AR-1384A section 6.

WHAT THIS EXISTS TO PREVENT. A taught rule whose value is computed by something outside Trading
Forge -- an indicator, a data vendor, a platform overlay -- used to have nowhere to live in the
representation. The pipeline had `SOURCE_MISSING` and it had executable conditions, and nothing in
between. So a required gate whose provider semantics were fully known, but whose provider ACCESS was
unproven, got forced into the nearest wrong bucket and reported as an absent source rule. That
misclassification produced a false terminal source refusal (AR-1383A, retracted by AR-1384A).

    THREE FACTS THAT MUST NEVER COLLAPSE INTO ONE BOOLEAN:
      semantic status        -- what the source says the value MEANS          (resolved here)
      access status          -- can we OBTAIN it, live and historically       (unverified here)
      implementation status  -- is there a validated adapter                  (not started here)

THE GENERIC MODULE STAYS GENERIC. `source_graph_projection.py` carries a banned-string fence
(`test_source_graph_projection.py::test_module_contains_no_source_specific_strings`) which forbids
source-specific vocabulary in its source -- including the substring "short". The domain gate values
of any real strategy are therefore DATA that flows through, never literals the module knows. These
unit tests use deliberately domain-neutral output values to prove that; only the pinned calibration
fixture carries real ones.

FAIL-CLOSED IS THE POINT. An unresolved dependency must drive the receipt to the existing `RED`
route with a structured blocker. It must never be able to make a strategy LESS strict by being
absent, and its unresolved sentinel must never map to anything that permits a trade.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.engine.extraction.source_graph_projection import (
    ACCESS_UNAVAILABLE,
    ACCESS_UNVERIFIED,
    ACCESS_VERIFIED,
    BLOCKED_EXTERNAL_DEPENDENCY,
    BLOCKER_ACCESS_UNVERIFIED,
    BLOCKER_CAPABILITY_UNAVAILABLE,
    BLOCKER_IMPLEMENTATION_UNVALIDATED,
    BLOCKER_SEMANTIC_CONFLICT,
    BLOCKER_SEMANTIC_UNRESOLVED,
    EXTERNAL_DEPENDENCY_KIND_INDICATOR,
    FAIL_CLOSED_ACTION,
    READY_PENDING_CERTIFICATION,
    SEMANTIC_CONFLICT,
    SEMANTIC_RESOLVED,
    SEMANTIC_UNRESOLVED,
    UNRESOLVED_OUTPUT,
    AliasSpec,
    ExternalDependencySpec,
    GraphEdge,
    ProjectionSpec,
    external_dependency_contract_hash,
    run_projection,
)

# ---- the same minimal synthetic fixture the sibling suite uses ---- #

# A deliberately GREEN synthetic fixture: every condition is literally grounded in the transcript
# so the baseline accepts 4 of 4. See the note on GRAPH_EDGES below for why that matters.
TRANSCRIPT = (
    "The trader marks the high and low of the first candle. The trader waits for a close "
    "outside that range. A close outside that range confirms the direction. The trader places "
    "a stop below the low."
)

CONDITIONS = [
    {"condition_ref": "entry_sequence[0].action",
     "condition_text": "The trader marks the high and low of the first candle."},
    {"condition_ref": "entry_sequence[1].action",
     "condition_text": "The trader waits for a close outside that range."},
    {"condition_ref": "entry_sequence[1].rationale",
     "condition_text": "A close outside that range confirms the direction."},
    {"condition_ref": "stop.rationale",
     "condition_text": "The trader places a stop below the low."},
]

ANSWERS = [
    {"condition_ref": "entry_sequence[0].action",
     "raw_output": "The trader marks the high and low of the first candle."},
    {"condition_ref": "entry_sequence[1].action",
     "raw_output": "The trader waits for a close outside that range."},
    {"condition_ref": "entry_sequence[1].rationale",
     "raw_output": "A close outside that range confirms the direction."},
    {"condition_ref": "stop.rationale",
     "raw_output": "The trader places a stop below the low."},
]

ALL_REFS = ("entry_sequence[0].action", "entry_sequence[1].action",
            "entry_sequence[1].rationale", "stop.rationale")

# Domain-neutral output vocabulary. Deliberately NOT a real strategy's values -- see the module
# docstring: proving the generic module never inspects domain meaning.
OUT_A, OUT_B = "STATE_A", "STATE_B"
ACT_A, ACT_B = "DIRECTION_A_ONLY", "DIRECTION_B_ONLY"


def _dep(**overrides) -> ExternalDependencySpec:
    base = dict(
        dependency_id="fixture.external_state",
        consumer_refs=("entry_sequence[1].action",),
        kind=EXTERNAL_DEPENDENCY_KIND_INDICATOR,
        provider="Fixture Provider",
        artifact="Fixture Artifact",
        platform="Fixture Platform",
        display_chart_timeframe="15m",
        decision_timeframe="4h",
        configuration={"higher_timeframe": "4h"},
        output_contract={
            "type": "enum",
            "values": [OUT_A, OUT_B, UNRESOLVED_OUTPUT],
            "gate": {OUT_A: ACT_A, OUT_B: ACT_B, UNRESOLVED_OUTPUT: FAIL_CLOSED_ACTION},
        },
        semantic_status="MULTIMODAL_RESOLVED",
        access_status=ACCESS_UNVERIFIED,
        live_delivery=ACCESS_UNVERIFIED,
        historical_replay=ACCESS_UNVERIFIED,
        update_policy=ACCESS_UNVERIFIED,
        implementation_status="NOT_STARTED",
    )
    base.update(overrides)
    return ExternalDependencySpec(**base)


# 🛑 THE BASELINE MUST BE GREEN, OR EVERY "RED" ASSERTION BELOW PASSES FOR THE WRONG REASON.
# A projection with no declared edges grades RED on graph incompleteness alone (the sibling suite's
# `test_grade_is_RED_when_graph_incomplete_even_if_all_canonical_accepted` proves that). Without
# these edges, a test asserting "the unresolved dependency forced RED" would be satisfied by a
# fixture that was already RED before the dependency existed -- a control that cannot discriminate.
# The first run of this suite failed exactly that way, and the failure is why the edges are here.
GRAPH_EDGES = (
    GraphEdge("entry_sequence[0].action", "entry_sequence[1].action", "precedes"),
    GraphEdge("entry_sequence[1].action", "entry_sequence[1].rationale", "precedes"),
    GraphEdge("entry_sequence[1].action", "stop.rationale", "precedes"),
)
GRAPH_ROOTS = ("entry_sequence[0].action",)


def _ready_dep(**overrides) -> ExternalDependencySpec:
    """A dependency with every blocking axis satisfied. Used as the discriminating control: a
    refusal that fires on this too would prove nothing about the refusals that should fire."""
    base = dict(access_status=ACCESS_VERIFIED, live_delivery=ACCESS_VERIFIED,
                historical_replay=ACCESS_VERIFIED, update_policy=ACCESS_VERIFIED,
                implementation_status="VALIDATED")
    base.update(overrides)
    return _dep(**base)


def _projection(**overrides) -> ProjectionSpec:
    base = dict(
        canonical_refs=ALL_REFS,
        alias_specs=(),
        preserved_metadata_refs=(),
        preserved_metadata_records={},
        graph_edges=GRAPH_EDGES,
        graph_roots=GRAPH_ROOTS,
    )
    base.update(overrides)
    return ProjectionSpec(**base)


def _run(**overrides):
    return run_projection(TRANSCRIPT, CONDITIONS, ANSWERS, _projection(**overrides))


# --------------------------------------------------------------------------- #
# 1. Backward compatibility — the whole point of an ADDITIVE change
# --------------------------------------------------------------------------- #


def test_C0_1_legacy_spec_without_dependencies_is_byte_identical():
    """A spec that declares no external dependency must produce EXACTLY the receipt it produced
    before this feature existed -- same grade, conservation, outcomes, and no new keys.

    This is the omit-when-empty discipline `ConditionBinding.parameters` already established. It
    is what lets the committed v2.1 certification artifact keep its canonical hash."""
    record = _run()
    assert record["grade"] == "GREEN_PENDING_CERTIFICATION"
    assert "external_dependencies" not in record
    assert "compile_readiness" not in record
    assert "structured_blocker" not in record


def test_C0_1b_projection_spec_default_is_empty():
    assert _projection().external_dependencies == ()


# --------------------------------------------------------------------------- #
# 2. Representation — the dependency is preserved, exactly once, with its consumers
# --------------------------------------------------------------------------- #


def test_C0_2_dependency_with_two_consumers_is_preserved_exactly_once():
    dep = _dep(consumer_refs=("entry_sequence[1].action", "stop.rationale"))
    record = _run(external_dependencies=(dep,))

    deps = record["external_dependencies"]
    assert len(deps) == 1, "one declared dependency must appear exactly once"
    assert deps[0]["dependency_id"] == "fixture.external_state"
    assert deps[0]["consumer_refs"] == ["entry_sequence[1].action", "stop.rationale"]


def test_C0_2b_consumers_remain_conserved_in_the_graph():
    """🛑 THE DEPENDENCY IS NOT A SUBSTITUTE CONDITION. Declaring that an outside component computes
    a value must NOT make the taught rule that consumes it disappear from the executable set."""
    dep = _dep(consumer_refs=("entry_sequence[1].action", "stop.rationale"))
    record = _run(external_dependencies=(dep,))

    assert record["conservation"]["input_ref_count"] == len(CONDITIONS)
    assert record["conservation"]["canonical_count"] == len(ALL_REFS)
    projected = {o["condition_ref"] for o in record["outcomes"]}
    for ref in dep.consumer_refs:
        assert ref in projected, f"consumer {ref} vanished from the projection"


# --------------------------------------------------------------------------- #
# 3. Structural validation — every refusal in AR-1385A section 6.3
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("dep_id", ["", "   "])
def test_C0_3_empty_dependency_id_is_refused(dep_id):
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_ID_EMPTY"):
        _run(external_dependencies=(_dep(dependency_id=dep_id),))


def test_C0_3b_duplicate_dependency_id_is_refused():
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_ID_DUPLICATE"):
        _run(external_dependencies=(_dep(), _dep(consumer_refs=("stop.rationale",))))


def test_C0_3c_empty_consumer_set_is_refused():
    """A dependency nothing consumes is not a gate -- it is decoration wearing a contract."""
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_CONSUMERS_EMPTY"):
        _run(external_dependencies=(_dep(consumer_refs=()),))


def test_C0_3d_unknown_consumer_ref_is_refused():
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_CONSUMER_UNKNOWN"):
        _run(external_dependencies=(_dep(consumer_refs=("entry_sequence[9].action",)),))


def test_C0_3e_metadata_only_consumer_is_refused():
    """🛑 THE ONTOLOGY RULE, MADE EXECUTABLE (AR-1384A section 6.4). A required gate may not be
    pointed at a ref that has been excluded from the executable denominator as commentary. That
    demotion is exactly how a direction gate got recorded as non-executable context."""
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_CONSUMER_NOT_EXECUTABLE"):
        _run(
            canonical_refs=("entry_sequence[0].action", "entry_sequence[1].action", "stop.rationale"),
            preserved_metadata_refs=("entry_sequence[1].rationale",),
            preserved_metadata_records={
                "entry_sequence[1].rationale": {
                    "original_text": "The close outside the range confirms direction.",
                    "historical_disposition": "EXCLUDED",
                    "historical_evidence": None,
                    "exclusion_reason": "extractor commentary",
                    "exclusion_authority": "fixture",
                    "historical_evidence_absent_reason": "no quote",
                }
            },
            external_dependencies=(_dep(consumer_refs=("entry_sequence[1].rationale",)),),
        )


def test_C0_3f_unknown_kind_is_refused():
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_KIND_UNKNOWN"):
        _run(external_dependencies=(_dep(kind="MYSTERY_BOX"),))


@pytest.mark.parametrize("field", ["access_status", "live_delivery", "historical_replay",
                                    "update_policy"])
def test_C0_3g_unknown_access_status_is_refused(field):
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_STATUS_UNKNOWN"):
        _run(external_dependencies=(_dep(**{field: "PROBABLY_FINE"}),))


def test_C0_3h_gate_not_covering_every_output_is_refused():
    """Every declared output value needs a declared consequence. A value with no gate entry is an
    input the compiler cannot answer for."""
    bad = {"type": "enum",
           "values": [OUT_A, OUT_B, UNRESOLVED_OUTPUT],
           "gate": {OUT_A: ACT_A, UNRESOLVED_OUTPUT: FAIL_CLOSED_ACTION}}
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_GATE_INCOMPLETE"):
        _run(external_dependencies=(_dep(output_contract=bad),))


def test_C0_3i_empty_output_values_is_refused():
    bad = {"type": "enum", "values": [], "gate": {}}
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_OUTPUT_VALUES_EMPTY"):
        _run(external_dependencies=(_dep(output_contract=bad),))


def test_C0_3j_missing_unresolved_sentinel_is_refused():
    """Every external dependency must declare what it means to NOT KNOW. A contract with no
    unresolved value cannot express provider silence, and silence is the common case."""
    bad = {"type": "enum", "values": [OUT_A, OUT_B], "gate": {OUT_A: ACT_A, OUT_B: ACT_B}}
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_UNRESOLVED_VALUE_MISSING"):
        _run(external_dependencies=(_dep(output_contract=bad),))


def test_C0_3k_timeframe_contradiction_is_refused():
    """A declared configuration that disagrees with the declared decision timeframe is a contract
    that cannot be true."""
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_TIMEFRAME_CONTRADICTION"):
        _run(external_dependencies=(_dep(configuration={"higher_timeframe": "1h"}),))


@pytest.mark.parametrize("field", ["display_chart_timeframe", "decision_timeframe"])
def test_C0_3l_empty_timeframe_is_refused(field):
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_TIMEFRAME_EMPTY"):
        _run(external_dependencies=(_dep(**{field: ""}),))


# --------------------------------------------------------------------------- #
# 4. FAIL-CLOSED — the rules that decide whether money can move
# --------------------------------------------------------------------------- #


def test_C0_4_unresolved_value_mapping_to_anything_but_fail_closed_is_refused():
    """🛑 THE SINGLE MOST LOAD-BEARING REFUSAL IN THIS MODULE. If the provider says nothing, or
    says something we do not recognise, the only admissible consequence is no trade. A contract
    that permits action on an unresolved value is a fail-OPEN gate."""
    bad = {"type": "enum",
           "values": [OUT_A, OUT_B, UNRESOLVED_OUTPUT],
           "gate": {OUT_A: ACT_A, OUT_B: ACT_B, UNRESOLVED_OUTPUT: ACT_A}}
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_FAIL_OPEN"):
        _run(external_dependencies=(_dep(output_contract=bad),))


def test_C0_4b_unverified_access_forces_RED_and_a_structured_blocker():
    record = _run(external_dependencies=(_dep(),))
    assert record["grade"] == "RED", "an unresolved external dependency may not read as green"
    assert record["compile_readiness"] == BLOCKED_EXTERNAL_DEPENDENCY
    assert record["structured_blocker"]["reason"] == "EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED"
    assert record["structured_blocker"]["dependency_ids"] == ["fixture.external_state"]


def test_C0_4c_semantic_status_survives_the_red_grade():
    """RED is about READINESS, not about whether the source was understood. Collapsing those two
    is the exact error that produced the false terminal refusal."""
    record = _run(external_dependencies=(_dep(),))
    assert record["grade"] == "RED"
    assert record["external_dependencies"][0]["semantic_status"] == "MULTIMODAL_RESOLVED"


def test_C0_4d_verified_access_does_not_block():
    """AMENDED after grader finding F-3: verified ACCESS alone is no longer sufficient. The adapter
    must also be built (`implementation_status=VALIDATED`), because access proven and adapter built
    are different facts and neither implies the other. `_ready_dep()` satisfies both."""
    record = _run(external_dependencies=(_ready_dep(),))
    assert record["compile_readiness"] == "READY_PENDING_CERTIFICATION"
    assert record["grade"] == "GREEN_PENDING_CERTIFICATION"


@pytest.mark.parametrize("field", ["live_delivery", "historical_replay", "update_policy"])
def test_C0_4e_any_unverified_axis_blocks_not_just_access_status(field):
    """Access is not one fact. Live delivery, historical replay and update policy each independently
    gate a source-faithful backtest, and any one of them unproven must block."""
    axes = {"access_status": ACCESS_VERIFIED, "live_delivery": ACCESS_VERIFIED,
            "historical_replay": ACCESS_VERIFIED, "update_policy": ACCESS_VERIFIED}
    axes[field] = ACCESS_UNVERIFIED
    record = _run(external_dependencies=(_dep(**axes),))
    assert record["compile_readiness"] == BLOCKED_EXTERNAL_DEPENDENCY
    assert field in record["structured_blocker"]["unverified_axes"]["fixture.external_state"]


def test_C0_4f_projection_is_deterministic_across_runs():
    """🛑 RENAMED BY AR-1386A section 6.1. This test used to be called
    `test_C0_4f_no_adapter_or_network_call_is_made` and claimed to prove that nothing reached out.

    IT COULD NOT DETECT A NETWORK CALL AT ALL. The independent AR-1395 grader planted a real
    deterministic side effect; it fired 35 times and this assertion stayed green -- because a call
    that returns the same thing every time leaves two equal results, which is precisely what an
    equality between two runs cannot distinguish from no call.

    DETERMINISM IS A REAL PROPERTY AND WORTH ASSERTING; IT IS JUST NOT THE ZERO-CALL PROPERTY.
    So the claim is now scoped to what the assertion actually measures, and the zero-call property
    is proven separately, with a guard that has a positive control:
    `test_AR1397_5_no_adapter_or_network_call_is_made`.
    """
    a = _run(external_dependencies=(_dep(),))
    b = _run(external_dependencies=(_dep(),))
    assert a == b


# --------------------------------------------------------------------------- #
# 5. Contract hash — computed here, never trusted from the caller
# --------------------------------------------------------------------------- #


def test_C0_5_contract_hash_is_emitted_and_stable():
    record = _run(external_dependencies=(_dep(),))
    emitted = record["external_dependencies"][0]["contract_sha256"]
    assert emitted == external_dependency_contract_hash(_dep())
    assert len(emitted) == 64


def test_C0_5b_decision_timeframe_mutation_changes_the_contract_hash():
    """A configuration change must be observable. If two different contracts hash the same, drift
    is undetectable by construction."""
    base = external_dependency_contract_hash(_dep())
    moved = external_dependency_contract_hash(
        _dep(decision_timeframe="1h", configuration={"higher_timeframe": "1h"}))
    assert base != moved


def test_C0_5c_gate_mutation_changes_the_contract_hash():
    flipped = {"type": "enum",
               "values": [OUT_A, OUT_B, UNRESOLVED_OUTPUT],
               "gate": {OUT_A: ACT_B, OUT_B: ACT_A, UNRESOLVED_OUTPUT: FAIL_CLOSED_ACTION}}
    assert external_dependency_contract_hash(_dep()) != \
        external_dependency_contract_hash(_dep(output_contract=flipped))


def test_C0_5d_caller_supplied_hash_mismatch_is_refused():
    """The module computes the authoritative hash. A caller-supplied digest may only ever be
    CHECKED against it -- never accepted in its place."""
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_CONTRACT_HASH_MISMATCH"):
        _run(external_dependencies=(_dep(expected_contract_sha256="0" * 64),))


def test_C0_5e_caller_supplied_hash_matching_is_accepted():
    dep = _dep()
    ok = _dep(expected_contract_sha256=external_dependency_contract_hash(dep))
    record = _run(external_dependencies=(ok,))
    assert record["external_dependencies"][0]["contract_sha256"] == \
        external_dependency_contract_hash(dep)


# --------------------------------------------------------------------------- #
# 6. The pinned calibration fixture — real accepted facts, structured refusal expected
# --------------------------------------------------------------------------- #

FIXTURE_PATH = Path(
    "docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/"
    "e8-calibration/external_dependency_calibration_fixture.json"
)


def _load_fixture() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_C0_6_calibration_fixture_exists_and_pins_its_evidence():
    fx = _load_fixture()
    dep = fx["external_dependency"]
    assert dep["display_chart_timeframe"] == "15m"
    assert dep["decision_timeframe"] == "4h"
    assert dep["semantic_status"] == "MULTIMODAL_RESOLVED"
    assert dep["access_status"] == ACCESS_UNVERIFIED
    assert fx["evidence_receipt_sha256"], "the fixture must pin the accepted visual evidence"


def test_C0_6b_calibration_fixture_maps_unresolved_to_fail_closed():
    gate = _load_fixture()["external_dependency"]["output_contract"]["gate"]
    assert gate[UNRESOLVED_OUTPUT] == FAIL_CLOSED_ACTION


def test_C0_6c_calibration_fixture_compiles_to_a_structured_nonterminal_refusal():
    """🛑 THE EXPECTED RESULT IS A NAMED, STRUCTURED, NONTERMINAL REFUSAL -- not a trade, and not a
    green executable strategy. Nonterminal matters: access is UNVERIFIED, not proven unavailable."""
    fx = _load_fixture()
    dep = ExternalDependencySpec(**fx["external_dependency"])
    record = _run(external_dependencies=(dep,))

    assert record["grade"] == "RED"
    assert record["compile_readiness"] == BLOCKED_EXTERNAL_DEPENDENCY
    assert record["structured_blocker"]["reason"] == "EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED"
    assert record["structured_blocker"]["terminal"] is False
    assert record["external_dependencies"][0]["semantic_status"] == "MULTIMODAL_RESOLVED"


def test_C0_6d_removing_the_dependency_cannot_make_the_strategy_less_strict():
    """🛑 THE ANTI-LAUNDERING ASSERTION (AR-1385A section 7 item 15). If deleting a broken gate
    turned the artifact green, the cheapest route past any external blocker would be to drop it.
    The fixture therefore asserts its own dependency's presence."""
    fx = _load_fixture()
    with_dep = _run(external_dependencies=(ExternalDependencySpec(**fx["external_dependency"]),))
    without_dep = _run()

    assert with_dep["grade"] == "RED"
    assert without_dep["grade"] == "GREEN_PENDING_CERTIFICATION"
    assert fx["required_dependency_ids"] == [fx["external_dependency"]["dependency_id"]], (
        "the fixture must name the dependency it requires, so its removal is detectable"
    )


def test_C0_6e_calibration_fixture_consumers_are_executable_refs():
    fx = _load_fixture()
    for ref in fx["external_dependency"]["consumer_refs"]:
        assert ref in ALL_REFS, (
            f"fixture consumer {ref} is not an executable ref of the calibration projection"
        )


# --------------------------------------------------------------------------- #
# 7. The certification seam — AR-1385A section 7 item 16
# --------------------------------------------------------------------------- #


def test_C0_7_blocked_artifact_cannot_pass_the_compile_seam_as_executable():
    """🛑 THE HOLE THIS TEST WAS WRITTEN TO CLOSE, FOUND BY ATTACKING MY OWN CHANGE.

    `build_certified_record()` refused only on a canonical ref that was not ACCEPTED. It never
    read `grade`. In a C0 artifact EVERY canonical ref is accepted -- the source conditions verify
    fine -- and it is the external DEPENDENCY that blocks. So a receipt carrying
    `grade=RED` and `compile_readiness=BLOCKED_EXTERNAL_DEPENDENCY` sailed straight through the
    compile seam as though it were executable.

    That is exactly the false green AR-1385A section 7 item 16 forbids: "No C0 output can pass the
    certification/readiness seam as executable." A readiness signal that no consumer enforces is
    not a gate, it is a comment.

    ⚠️ AND THIS TEST ITSELF NEARLY PASSED FOR THE WRONG REASON. Calling `build_certified_record`
    on this synthetic 4-ref projection raises `CanonicalNodeNotAcceptedError` no matter what --
    because the synthetic fixture does not carry the 9 real canonical refs the adapter expects. A
    green from that would have proven nothing about readiness. So the readiness refusal is asserted
    on its own function, and the wiring is asserted by requiring the readiness message to be the one
    that surfaces -- i.e. that it fires BEFORE the canonical-ref check it would otherwise hide
    behind.
    """
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        _refuse_if_not_compile_ready,
        build_certified_record,
    )

    fx = _load_fixture()
    blocked = _run(external_dependencies=(ExternalDependencySpec(**fx["external_dependency"]),))
    assert blocked["compile_readiness"] == BLOCKED_EXTERNAL_DEPENDENCY

    # (a) the readiness gate itself refuses
    with pytest.raises(CanonicalNodeNotAcceptedError, match="BLOCKED_EXTERNAL_DEPENDENCY"):
        _refuse_if_not_compile_ready(blocked)

    # (b) and it is WIRED IN, fires first, and names readiness -- not canonical refs
    with pytest.raises(CanonicalNodeNotAcceptedError, match="BLOCKED_EXTERNAL_DEPENDENCY"):
        build_certified_record(blocked)


def test_C0_7b_the_seam_still_accepts_a_ready_artifact():
    """The discriminating half. A refusal that fires on everything is not a gate either -- this
    proves the new check rejects the BLOCKED case specifically, not every input it is handed.

    The real certified v2.1 receipt (no external dependencies, grade GREEN) must still compile,
    which is what the committed artifact's unchanged canonical hash independently attests.
    """
    from src.engine.extraction.svkm_v2_1_compile import _refuse_if_not_compile_ready

    ready = _run()
    assert ready["grade"] == "GREEN_PENDING_CERTIFICATION"
    assert "compile_readiness" not in ready
    _refuse_if_not_compile_ready(ready)  # must not raise

    ok = _run(external_dependencies=(_ready_dep(),))
    assert ok["compile_readiness"] == "READY_PENDING_CERTIFICATION"
    _refuse_if_not_compile_ready(ok)  # must not raise


# --------------------------------------------------------------------------- #
# 8. GRADER FINDINGS — every defect the independent adversarial grade landed
#
# `GRADE-AR1395-STAGE-C0-BOUNDED-2026-08-21.md`, VERIFIED band 5/10, 14 attacks landed. Each test
# below is named for the finding it closes and FAILED before the corresponding repair. They are
# grouped here rather than scattered so the cost of that grade stays legible.
# --------------------------------------------------------------------------- #


def test_F2_extra_gate_key_not_in_declared_values_is_refused():
    """🛑 F-2, CRITICAL, AND THE WORST DEFECT IN THIS PACKET.

    Coverage was checked in ONE direction only -- `values subset-of gate`. An EXTRA gate key that
    appears in no declared value therefore passed validation, and the receipt then handed every
    downstream consumer a mapping containing it. A provider emitting that value would have its
    consequence read straight out of the gate and acted on.

    A FAIL-OPEN ROUTE, INSIDE THE STRUCTURE WHOSE ENTIRE PURPOSE IS THAT ACTION IS IMPOSSIBLE
    UNLESS IT WAS DECLARED. Coverage is now an equality, both directions.
    """
    bad = {"type": "enum",
           "values": [OUT_A, OUT_B, UNRESOLVED_OUTPUT],
           "gate": {OUT_A: ACT_A, OUT_B: ACT_B, UNRESOLVED_OUTPUT: FAIL_CLOSED_ACTION,
                    "STALE": ACT_A}}
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_GATE_UNDECLARED_VALUE"):
        _run(external_dependencies=(_dep(output_contract=bad),))


def test_F2b_the_undeclared_key_never_reaches_the_receipt():
    """The consequence half of F-2: it is not enough that validation now objects -- no receipt may
    ever carry a mapping a consumer could act on. Positive witness that the path ran: the valid
    contract IS emitted, so the absence below is a real absence."""
    ok = _run(external_dependencies=(_dep(),))
    gate = ok["external_dependencies"][0]["output_contract"]["gate"]
    assert set(gate) == {OUT_A, OUT_B, UNRESOLVED_OUTPUT}


def test_F3_implementation_status_actually_gates():
    """F-3, HIGH, novel. `implementation_status` gated NOTHING: verified access plus
    `NOT_STARTED` reported READY. Provider access proven and adapter built are different facts and
    neither implies the other -- the E8 fixture carries `NOT_STARTED`, so the moment C1 verified
    access it would have gone green with no adapter in existence."""
    dep = _ready_dep(implementation_status="NOT_STARTED")
    record = _run(external_dependencies=(dep,))
    assert record["compile_readiness"] == BLOCKED_EXTERNAL_DEPENDENCY
    assert "implementation_status" in \
        record["structured_blocker"]["unverified_axes"]["fixture.external_state"]


def test_F4_proven_unavailable_is_terminal_and_named_as_such():
    """F-4, HIGH, novel. `UNAVAILABLE` was reported as `..._ACCESS_UNVERIFIED, terminal: False` --
    this module's own law, "unverified is not unavailable", inverted inside the code enforcing it.
    Proven-unavailable is a different verdict and it is TERMINAL."""
    dep = _ready_dep(access_status="UNAVAILABLE")
    record = _run(external_dependencies=(dep,))
    blocker = record["structured_blocker"]
    assert blocker["reason"] == "UNSUPPORTED_CAPABILITY_REFUSAL"
    assert blocker["terminal"] is True
    assert blocker["unavailable_dependency_ids"] == ["fixture.external_state"]


def test_F4b_merely_unverified_stays_nonterminal():
    """The discriminating half of F-4 -- otherwise the repair could simply mark everything
    terminal, which would be a different false verdict in the opposite direction."""
    blocker = _run(external_dependencies=(_dep(),))["structured_blocker"]
    assert blocker["reason"] == "EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED"
    assert blocker["terminal"] is False
    assert blocker["unavailable_dependency_ids"] == []


@pytest.mark.parametrize("field", ["provider", "artifact", "platform"])
def test_F5_blank_provider_identity_is_refused(field):
    """F-5: blank identity left a dependency nobody could route, audit, or version."""
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_IDENTITY_EMPTY"):
        _run(external_dependencies=(_dep(**{field: "   "}),))


def test_F5b_arbitrary_semantic_status_is_refused():
    """F-5: `semantic_status` was free text, so "the source was understood" could be asserted with
    any string at all -- in the receipt whose whole purpose is keeping that fact honest."""
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_SEMANTIC_STATUS_UNKNOWN"):
        _run(external_dependencies=(_dep(semantic_status="LOOKS_FINE_TO_ME"),))


def test_F5c_arbitrary_implementation_status_is_refused():
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_IMPL_STATUS_UNKNOWN"):
        _run(external_dependencies=(_dep(implementation_status="NEARLY_DONE"),))


def test_F6_post_validation_mutation_cannot_rewrite_the_receipt():
    """🛑 F-6. The caller's `output_contract` was stored BY REFERENCE, so mutating it after
    validation silently rewrote the receipt -- including the gate map, after the fail-closed check
    had already approved it. VALIDATION A LATER WRITE CAN UNDO IS NOT VALIDATION."""
    contract = {"type": "enum",
                "values": [OUT_A, OUT_B, UNRESOLVED_OUTPUT],
                "gate": {OUT_A: ACT_A, OUT_B: ACT_B, UNRESOLVED_OUTPUT: FAIL_CLOSED_ACTION}}
    record = _run(external_dependencies=(_dep(output_contract=contract),))

    contract["gate"][UNRESOLVED_OUTPUT] = ACT_A  # the attack: fail-open, after approval
    assert record["external_dependencies"][0]["output_contract"]["gate"][UNRESOLVED_OUTPUT] == \
        FAIL_CLOSED_ACTION


def test_F6b_consumer_ref_order_does_not_change_the_contract_hash():
    """F-6b: `consumer_refs` is a set by contract, so two specs listing the same consumers in a
    different order are the SAME contract -- and were hashing differently, which reads as drift
    where none exists."""
    a = _dep(consumer_refs=("entry_sequence[1].action", "stop.rationale"))
    b = _dep(consumer_refs=("stop.rationale", "entry_sequence[1].action"))
    assert external_dependency_contract_hash(a) == external_dependency_contract_hash(b)


def test_F9_alias_ref_as_consumer_is_refused():
    """F-9: an alias is a POINTER to a canonical node, carrying `ALIAS_OF_CANONICAL` and never
    `ACCEPTED`. Gating on the pointer rather than the thing it points at is an indirection the
    receipt cannot honestly report."""
    proj_kwargs = dict(
        canonical_refs=("entry_sequence[0].action", "entry_sequence[1].action",
                        "stop.rationale"),
        alias_specs=(AliasSpec(alias_ref="entry_sequence[1].rationale",
                               canonical_ref="entry_sequence[1].action",
                               authority="fixture"),),
    )
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_CONSUMER_IS_ALIAS"):
        _run(external_dependencies=(_dep(consumer_refs=("entry_sequence[1].rationale",)),),
             **proj_kwargs)


def test_F14_duplicate_consumer_refs_are_refused():
    """F-14: a repeated consumer emitted the dependency once per occurrence, so AR-1385A section 7
    item 2 -- "preserved exactly once" -- was false for a caller that listed one twice."""
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_CONSUMER_DUPLICATE"):
        _run(external_dependencies=(
            _dep(consumer_refs=("entry_sequence[1].action", "entry_sequence[1].action")),))


def test_A14_non_enum_output_type_is_refused():
    """Grader attack A14: `output_contract["type"]` was never validated, so a contract could
    declare any shape while being interpreted as an enum."""
    bad = {"type": "continuous",
           "values": [OUT_A, UNRESOLVED_OUTPUT],
           "gate": {OUT_A: ACT_A, UNRESOLVED_OUTPUT: FAIL_CLOSED_ACTION}}
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_OUTPUT_TYPE_UNKNOWN"):
        _run(external_dependencies=(_dep(output_contract=bad),))


def test_F8_the_production_spec_loader_can_declare_a_dependency():
    """🛑 F-8, HIGH, novel, and the one that made everything else moot.

    `build_projection_run_inputs()` never passed `external_dependencies`, so NO PRODUCTION CALLER
    COULD DECLARE ONE. The typed dependency and every fail-closed guard behind it were reachable
    only from tests that build `ProjectionSpec` by hand -- which also made the certification-seam
    requirement VACUOUSLY unreachable rather than merely unmet.

    ★ EXISTENCE IS NOT WIRING.
    """
    from src.engine.extraction.source_graph_projection_spec import (
        build_projection_run_inputs,
    )

    fx = _load_fixture()
    spec = {
        "spec_version": "source-graph-projection-v2.1",
        "canonical_refs": list(ALL_REFS),
        "alias_specs": [],
        "preserved_metadata_refs": [],
        "preserved_metadata_records": {},
        "correction_ledger": {},
        "graph_edges": [{"from": e.from_ref, "to": e.to_ref, "type": e.edge_type}
                        for e in GRAPH_EDGES],
        "graph_roots": list(GRAPH_ROOTS),
        "allowed_edge_types": ["precedes"],
        "external_dependencies": [fx["external_dependency"]],
        "pins": {"transcript_sha256": "x", "extraction_sha256": "y"},
        "conditions": CONDITIONS,
        "raw_output_by_ref": {a["condition_ref"]: a["raw_output"] for a in ANSWERS},
    }
    inputs = build_projection_run_inputs(spec, TRANSCRIPT, verify_pins=False)
    deps = inputs.projection.external_dependencies
    assert len(deps) == 1
    assert deps[0].dependency_id == "e8.htf_premium_discount"


def test_F8b_a_spec_declaring_no_dependency_still_loads_unchanged():
    """The compatibility half of F-8: the new key is optional, on the same `.get()`-with-default
    discipline `composition_specs` already uses, so every existing spec keeps loading."""
    from src.engine.extraction.source_graph_projection_spec import (
        build_projection_run_inputs,
    )

    spec = {
        "spec_version": "source-graph-projection-v2.1",
        "canonical_refs": list(ALL_REFS),
        "alias_specs": [],
        "preserved_metadata_refs": [],
        "preserved_metadata_records": {},
        "correction_ledger": {},
        "graph_edges": [],
        "graph_roots": [],
        "allowed_edge_types": [],
        "pins": {"transcript_sha256": "x", "extraction_sha256": "y"},
        "conditions": CONDITIONS,
        "raw_output_by_ref": {a["condition_ref"]: a["raw_output"] for a in ANSWERS},
    }
    inputs = build_projection_run_inputs(spec, TRANSCRIPT, verify_pins=False)
    assert inputs.projection.external_dependencies == ()


def test_F10_the_pinned_fixture_gate_is_hash_pinned():
    """F-10: flipping the two direction consequences in the pinned calibration fixture went
    UNDETECTED -- nothing pinned the fixture's contract. A fixture that can be silently rewritten
    is not a fixture."""
    fx = _load_fixture()
    dep = ExternalDependencySpec(**fx["external_dependency"])
    assert external_dependency_contract_hash(dep) == fx["expected_contract_sha256"], (
        "the calibration fixture's contract changed; if that was intentional, update "
        "expected_contract_sha256 deliberately and say why"
    )


# --------------------------------------------------------------------------- #
# 9. AR-1397 — the AR-1386A closure packet
#
# AR-1386A graded AR-1395/AR-1396 a PARTIAL PASS and reproduced TWO counterexamples in which the
# compiler still turns green while a dependency is unsatisfied, plus one contradiction between a
# blocker's reason and its own axes, one order-dependent receipt, and five missing E8 birth tests.
#
# Every test below FAILED before its repair. The two counterexamples are transcribed from the
# ruling's own measured output, not paraphrased, so that if the repair is ever reverted the test
# reproduces GPT's exact attack rather than a nearby one.
# --------------------------------------------------------------------------- #


# ---- 9.1 AR-1386A section 3: unresolved / conflicting MEANING must not reach ready ---- #


@pytest.mark.parametrize("bad_semantic", [SEMANTIC_UNRESOLVED, SEMANTIC_CONFLICT])
def test_AR1397_1_unresolved_or_conflicting_semantics_cannot_report_ready(bad_semantic):
    """🛑 AR-1386A section 3, CRITICAL, REACHABLE FAIL-OPEN.

    GPT held EVERY access axis and the implementation axis ready and changed ONLY the semantic
    status, and measured:

        VISUAL_UNRESOLVED -> GREEN_PENDING_CERTIFICATION / READY_PENDING_CERTIFICATION
        SOURCE_CONFLICT   -> GREEN_PENDING_CERTIFICATION / READY_PENDING_CERTIFICATION

    AR-1396 gave `semantic_status` a CLOSED VOCABULARY but never made it GATE. A closed vocabulary
    stops gibberish; it does not make an unresolved or conflicting meaning executable.

    THIS IS THE MOST MATERIAL DEFECT IN THE PACKET, because the operator's own correction was that
    VISUAL EVIDENCE HAD BEEN MISSED. The compiler must not later trade through the same unresolved
    visual state merely because provider access and an adapter now exist.
    """
    record = _run(external_dependencies=(_ready_dep(semantic_status=bad_semantic),))

    assert record["grade"] == "RED"
    assert record["compile_readiness"] == BLOCKED_EXTERNAL_DEPENDENCY
    # and the receipt still tells the truth about WHICH axis blocked
    assert "semantic_status" in \
        record["structured_blocker"]["unverified_axes"]["fixture.external_state"]


def test_AR1397_1b_the_semantic_block_is_nonterminal_and_named_honestly():
    """A semantic block is NOT a proven-unavailable capability. AR-1386A section 3: block "with an
    honest semantic reason and terminal=false unless a separate ruling proves a terminal
    condition". Reporting an unresolved MEANING as an unavailable CAPABILITY would repeat, on the
    semantic axis, exactly the false terminal refusal AR-1384A retracted."""
    blocker = _run(
        external_dependencies=(_ready_dep(semantic_status=SEMANTIC_UNRESOLVED),)
    )["structured_blocker"]

    assert blocker["reason"] == BLOCKER_SEMANTIC_UNRESOLVED
    assert blocker["terminal"] is False
    assert blocker["reason"] != BLOCKER_CAPABILITY_UNAVAILABLE


def test_AR1397_1c_conflicting_semantics_are_named_apart_from_unresolved_ones():
    """"We could not resolve the meaning" and "two sources disagree about it" are different facts
    about the source and must not collapse into one code -- the same three-facts-never-collapse
    discipline this module's docstring already applies to semantic/access/implementation."""
    blocker = _run(
        external_dependencies=(_ready_dep(semantic_status=SEMANTIC_CONFLICT),)
    )["structured_blocker"]

    assert blocker["reason"] == BLOCKER_SEMANTIC_CONFLICT
    assert blocker["terminal"] is False


def test_AR1397_1d_only_resolved_semantics_contribute_to_ready():
    """The discriminating control. A gate that fires on every semantic value is not a gate."""
    ok = _run(external_dependencies=(_ready_dep(semantic_status=SEMANTIC_RESOLVED),))
    assert ok["grade"] == "GREEN_PENDING_CERTIFICATION"
    assert ok["compile_readiness"] == READY_PENDING_CERTIFICATION
    assert "structured_blocker" not in ok


# ---- 9.2 AR-1386A section 4: deleting the readiness field must not launder a RED receipt ---- #


def _real_certified_receipt() -> dict:
    """The REAL nine-canonical-node certified receipt, not a synthetic stand-in.

    AR-1386A section 4 requires the end-to-end proof to run on this: "A helper-only test is
    insufficient because the earlier packet already demonstrated how a synthetic seam test can pass
    for the wrong reason." The synthetic 4-ref projection raises `CanonicalNodeNotAcceptedError`
    unconditionally at `build_certified_record`, so a laundering attack against it would be masked
    by an unrelated refusal and prove nothing.
    """
    from src.engine.extraction.svkm_v2_1_compile import run_certified_projection

    record, _ = run_certified_projection()
    return record


def test_AR1397_2_dependency_bearing_receipt_with_readiness_removed_is_refused():
    """🛑 AR-1386A section 4, CRITICAL. GPT'S EXACT ATTACK, REPRODUCED END TO END.

    `_refuse_if_not_compile_ready()` ASSUMED that a missing `compile_readiness` key means the
    receipt declares no external dependency. It never checked that assumption. So GPT took the real
    nine-node certified receipt, added the emitted dependency record, marked it RED, DELETED
    `compile_readiness`, and called the real compile entry point:

        external_dependencies present : yes
        grade                         : RED
        compile_readiness             : absent
        build_certified_record()      : COMPILED 1 strategy

    The existing seam test (`test_C0_7`) proves only that an EXPLICIT blocked readiness value
    refuses. It does not prove that readiness CANNOT BE DELETED -- and the cheapest possible attack
    on a gate keyed to a field's value is to remove the field.

    A GATE THAT A DELETION DISARMS IS NOT A GATE.
    """
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        build_certified_record,
    )

    fx = _load_fixture()
    blocked = _run(external_dependencies=(ExternalDependencySpec(**fx["external_dependency"]),))

    laundered = _real_certified_receipt()
    laundered["external_dependencies"] = blocked["external_dependencies"]
    laundered["grade"] = "RED"
    laundered.pop("compile_readiness", None)
    assert "compile_readiness" not in laundered
    assert laundered["external_dependencies"], "the attack requires the dependency to be present"

    with pytest.raises(CanonicalNodeNotAcceptedError, match="EXTERNAL_DEPENDENCY_READINESS_ABSENT"):
        build_certified_record(laundered)


def test_AR1397_2b_readiness_without_any_dependency_record_is_refused_as_inconsistent():
    """AR-1386A section 4, the other direction: `compile_readiness` present + absent dependency
    records is an INCONSISTENT receipt. Either half alone is a receipt that half-remembers what it
    declared, and a consumer cannot tell which half to believe."""
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        _refuse_if_not_compile_ready,
    )

    inconsistent = _real_certified_receipt()
    inconsistent["compile_readiness"] = READY_PENDING_CERTIFICATION
    assert "external_dependencies" not in inconsistent

    with pytest.raises(CanonicalNodeNotAcceptedError,
                       match="EXTERNAL_DEPENDENCY_RECEIPT_INCONSISTENT"):
        _refuse_if_not_compile_ready(inconsistent)


def test_AR1397_2c_an_unknown_readiness_value_is_refused():
    """Blocked OR unknown readiness refuses. A vocabulary this gate does not recognise must fail
    CLOSED -- treating an unrecognised readiness as "not blocked" is the same fail-open shape as
    the deleted key, wearing a different spelling."""
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        _refuse_if_not_compile_ready,
    )

    fx = _load_fixture()
    blocked = _run(external_dependencies=(ExternalDependencySpec(**fx["external_dependency"]),))
    odd = _real_certified_receipt()
    odd["external_dependencies"] = blocked["external_dependencies"]
    odd["compile_readiness"] = "PROBABLY_FINE"

    with pytest.raises(CanonicalNodeNotAcceptedError, match="PROBABLY_FINE"):
        _refuse_if_not_compile_ready(odd)


def test_AR1397_2d_terminal_wording_comes_from_the_structured_blocker():
    """🛑 AR-1386A section 4, final bullet. The refusal message ENDED with the hard-coded sentence
    "This refusal is NONTERMINAL -- unverified is not unavailable."

    That sentence is TRUE for an unverified provider and FALSE for one proven unavailable -- and
    the message printed it either way. A receipt whose structured blocker says `terminal=true`
    would have been narrated to a human as nonterminal, which is the false-terminal error of
    AR-1383A running in reverse. Terminal wording must be READ FROM the structured blocker.
    """
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        _refuse_if_not_compile_ready,
    )

    terminal_dep = _ready_dep(access_status=ACCESS_UNAVAILABLE)
    terminal_run = _run(external_dependencies=(terminal_dep,))
    assert terminal_run["structured_blocker"]["terminal"] is True

    receipt = _real_certified_receipt()
    receipt["external_dependencies"] = terminal_run["external_dependencies"]
    receipt["compile_readiness"] = terminal_run["compile_readiness"]
    receipt["structured_blocker"] = terminal_run["structured_blocker"]

    with pytest.raises(CanonicalNodeNotAcceptedError) as excinfo:
        _refuse_if_not_compile_ready(receipt)
    message = str(excinfo.value)
    assert "TERMINAL" in message
    assert "NONTERMINAL" not in message, (
        "a proven-unavailable capability was narrated as nonterminal"
    )


def test_AR1397_2e_the_seam_still_accepts_the_real_receipt_untouched():
    """The discriminating half of every refusal above. The REAL certified receipt -- no external
    dependencies, no readiness key -- must still pass unchanged, or these repairs have simply
    broken the legacy path they promised to leave alone."""
    from src.engine.extraction.svkm_v2_1_compile import _refuse_if_not_compile_ready

    untouched = _real_certified_receipt()
    assert "external_dependencies" not in untouched
    assert "compile_readiness" not in untouched
    _refuse_if_not_compile_ready(untouched)  # must not raise


# ---- 9.3 AR-1386A section 5: the blocker reason must not contradict its own axes ---- #


def test_AR1397_3_reason_names_the_actual_blocking_axis_not_access_by_default():
    """🛑 AR-1386A section 5, HIGH. With ALL access axes VERIFIED and only
    `implementation_status=NOT_STARTED`, GPT measured:

        grade  RED / BLOCKED_EXTERNAL_DEPENDENCY
        reason EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED      <- FALSE
        axes   [implementation_status]

    The gate blocked safely and the receipt told the wrong story. `reason` was a two-way choice
    between terminal and not-terminal, so every nonterminal block was labelled access-unverified
    whatever had actually blocked it. A receipt is an instrument; a safe gate that reports a false
    cause sends the next reader to fix the wrong thing.
    """
    blocker = _run(
        external_dependencies=(_dep(access_status=ACCESS_VERIFIED,
                                    live_delivery=ACCESS_VERIFIED,
                                    historical_replay=ACCESS_VERIFIED,
                                    update_policy=ACCESS_VERIFIED,
                                    implementation_status="NOT_STARTED"),)
    )["structured_blocker"]

    assert blocker["unverified_axes"]["fixture.external_state"] == ["implementation_status"]
    assert blocker["reason"] == BLOCKER_IMPLEMENTATION_UNVALIDATED
    assert blocker["reason"] != BLOCKER_ACCESS_UNVERIFIED
    assert blocker["terminal"] is False


def test_AR1397_3b_mixed_causes_preserve_every_cause_code():
    """AR-1386A section 5: "mixed causes -> preserve all cause codes/axes without relabelling them
    as access-only". One `reason` string cannot carry three simultaneous facts, so the reason is
    the highest-precedence cause AND `cause_codes` carries all of them. Collapsing them would be
    the same "one misleading boolean" the ruling forbids."""
    blocker = _run(
        external_dependencies=(_dep(semantic_status=SEMANTIC_CONFLICT,
                                    access_status=ACCESS_UNVERIFIED,
                                    live_delivery=ACCESS_VERIFIED,
                                    historical_replay=ACCESS_VERIFIED,
                                    update_policy=ACCESS_VERIFIED,
                                    implementation_status="IN_PROGRESS"),)
    )["structured_blocker"]

    assert set(blocker["cause_codes"]) == {
        BLOCKER_ACCESS_UNVERIFIED,
        BLOCKER_SEMANTIC_CONFLICT,
        BLOCKER_IMPLEMENTATION_UNVALIDATED,
    }
    assert blocker["cause_codes"] == sorted(blocker["cause_codes"]), "cause codes must be canonical"
    assert set(blocker["unverified_axes"]["fixture.external_state"]) == {
        "access_status", "semantic_status", "implementation_status",
    }


def test_AR1397_3c_proven_unavailable_still_outranks_every_other_cause():
    """Precedence check. A terminal capability refusal must not be demoted to a semantic or
    implementation reason just because those axes ALSO block -- terminal is the fact a reader must
    not miss."""
    blocker = _run(
        external_dependencies=(_dep(access_status=ACCESS_UNAVAILABLE,
                                    semantic_status=SEMANTIC_UNRESOLVED,
                                    implementation_status="NOT_STARTED"),)
    )["structured_blocker"]

    assert blocker["reason"] == BLOCKER_CAPABILITY_UNAVAILABLE
    assert blocker["terminal"] is True
    assert BLOCKER_SEMANTIC_UNRESOLVED in blocker["cause_codes"]
    assert BLOCKER_IMPLEMENTATION_UNVALIDATED in blocker["cause_codes"]


# ---- 9.4 AR-1386A section 6, final item: the emitted receipt must be order-independent ---- #


def test_AR1397_4_emitted_consumer_refs_are_canonically_sorted():
    """AR-1386A section 6, deterministic correction. `consumer_refs` is a SET by contract and
    AR-1395 F-6b already sorted it for the HASH -- but the EMITTED record still preserved caller
    order. GPT measured EQUAL contract hashes with UNEQUAL receipts for the same two consumers
    reversed. Two artifacts that are the same contract must be the same receipt, or receipt
    identity means something different from contract identity and neither is trustworthy."""
    pair = ("entry_sequence[1].action", "stop.rationale")
    forward = _run(external_dependencies=(_dep(consumer_refs=pair),))
    assert forward["external_dependencies"][0]["consumer_refs"] == sorted(pair)


def test_AR1397_4b_receipt_identity_is_order_independent():
    """The paired assertion AR-1386A asks for by name ("add receipt-identity coverage"): equal
    hashes must now imply equal receipts."""
    pair = ("entry_sequence[1].action", "stop.rationale")
    forward = _run(external_dependencies=(_dep(consumer_refs=pair),))
    reversed_ = _run(external_dependencies=(_dep(consumer_refs=tuple(reversed(pair))),))

    assert external_dependency_contract_hash(_dep(consumer_refs=pair)) == \
        external_dependency_contract_hash(_dep(consumer_refs=tuple(reversed(pair))))
    assert forward["external_dependencies"] == reversed_["external_dependencies"]


# ---- 9.5 AR-1386A section 6.1: a zero-call guard that can actually fail ---- #


def test_AR1397_5_no_adapter_or_network_call_is_made(monkeypatch):
    """🛑 AR-1386A section 6.1. THE REPLACEMENT FOR A TEST THAT COULD NOT DETECT WHAT IT CLAIMED.

    The old `test_C0_4f_no_adapter_or_network_call_is_made` asserted `run(a) == run(b)`. The
    independent AR-1395 grader planted a REAL deterministic side effect, it FIRED 35 TIMES, and the
    test stayed green -- an equality between two runs cannot see a call that returns the same value
    twice.

    This guard instead makes the call itself impossible: every socket constructor and HTTP opener
    raises. And it ships with the POSITIVE CONTROL the ruling demands -- a guard nobody has ever
    seen fail is indistinguishable from a guard that cannot fail.
    """
    import socket
    import urllib.request

    calls: list[str] = []

    def _forbidden(name):
        def _raise(*_a, **_k):
            calls.append(name)
            raise AssertionError(f"C0 attempted a network call via {name}")
        return _raise

    monkeypatch.setattr(socket, "socket", _forbidden("socket.socket"))
    monkeypatch.setattr(socket, "create_connection", _forbidden("socket.create_connection"))
    monkeypatch.setattr(socket, "getaddrinfo", _forbidden("socket.getaddrinfo"))
    monkeypatch.setattr(urllib.request, "urlopen", _forbidden("urllib.request.urlopen"))

    # (a) the real thing, under the armed guard
    record = _run(external_dependencies=(_dep(),))
    assert record["external_dependencies"][0]["dependency_id"] == "fixture.external_state"
    assert calls == [], f"C0 reached out: {calls}"

    # (b) POSITIVE CONTROL -- the guard must be able to fail, or (a) proved nothing
    with pytest.raises(AssertionError, match="attempted a network call"):
        socket.create_connection(("127.0.0.1", 9))
    assert calls == ["socket.create_connection"], "the positive control did not arm the guard"


# ---- 9.6 AR-1386A section 6.2-6.5: the five focused E8 birth-test gaps ---- #


def test_AR1397_6_fixture_premium_gates_short_only_and_discount_gates_long_only():
    """AR-1386A section 6.2: assert the DIRECTION MAPPING DIRECTLY. The suite previously covered
    this only through the fixture's presence and a generic hash-sensitivity test -- neither of
    which reads the mapping, so both would survive the two consequences being swapped in a way
    that mattered. This is the taught fact the whole E8 calibration exists to preserve."""
    gate = _load_fixture()["external_dependency"]["output_contract"]["gate"]
    assert gate["PREMIUM"] == "SHORT_ONLY"
    assert gate["DISCOUNT"] == "LONG_ONLY"
    assert gate[UNRESOLVED_OUTPUT] == FAIL_CLOSED_ACTION


def test_AR1397_7_indicator_optional_cannot_delete_the_required_dependency():
    """AR-1386A section 6.3, the explicit negative test. "The indicator is optional" is the exact
    sentence that would make this dependency disappear -- and a strategy must never become LESS
    strict by losing a gate it could not satisfy. The fixture NAMES its required dependency ids, so
    a receipt that omits them is detectably non-conformant rather than quietly green."""
    fx = _load_fixture()
    required = set(fx["required_dependency_ids"])
    assert required, "the fixture must name what it requires or nothing is detectable"

    with_dep = _run(external_dependencies=(ExternalDependencySpec(**fx["external_dependency"]),))
    emitted = {d["dependency_id"] for d in with_dep.get("external_dependencies", ())}
    assert required <= emitted

    # "optional" == dropped. The receipt goes green, and that is precisely why the fixture's
    # requirement -- not the receipt's own grade -- is the thing that must catch it.
    optional = _run()
    emitted_optional = {d["dependency_id"] for d in optional.get("external_dependencies", ())}
    assert optional["grade"] == "GREEN_PENDING_CERTIFICATION"
    assert not required <= emitted_optional, (
        "dropping the indicator must be DETECTABLE against the fixture's required ids"
    )


def test_AR1397_8_pointing_the_dependency_at_an_unrelated_condition_is_rejected():
    """AR-1386A section 6.4. Re-aimed at an unrelated executable condition, the E8 dependency must
    be REFUSED -- and the ruling is explicit that this should be enforced by the EXISTING pinned
    contract rather than by inventing a broad role ontology to satisfy one fixture.

    It is: `consumer_refs` is inside the contract hash, so re-aiming the dependency changes its
    identity and the fixture's pinned `expected_contract_sha256` no longer matches.
    """
    fx = _load_fixture()
    original = fx["external_dependency"]["consumer_refs"]
    unrelated = "stop.rationale"
    assert unrelated in ALL_REFS and unrelated not in original

    re_aimed = dict(fx["external_dependency"],
                    consumer_refs=(unrelated,),
                    expected_contract_sha256=fx["expected_contract_sha256"])
    with pytest.raises(ValueError, match="EXTERNAL_DEPENDENCY_CONTRACT_HASH_MISMATCH"):
        _run(external_dependencies=(ExternalDependencySpec(**re_aimed),))


def test_AR1397_9_the_E8_result_is_never_reported_as_a_missing_source():
    """🛑 AR-1386A section 6.5, AND THE ORIGINAL SIN OF THIS WHOLE THREAD.

    The 15m-display / 4H-decision Premium-Discount fact was once forced into `SOURCE_MISSING`
    because the representation had nowhere else to put it, and that misclassification produced the
    false terminal source refusal AR-1383A issued and AR-1384A retracted.

    The refusal this fixture produces must be about ACCESS, never about the SOURCE. So: no
    missing-source vocabulary anywhere in the emitted receipt, and the semantic status stays
    resolved through the RED grade.
    """
    fx = _load_fixture()
    record = _run(external_dependencies=(ExternalDependencySpec(**fx["external_dependency"]),))

    assert record["grade"] == "RED"
    assert record["external_dependencies"][0]["semantic_status"] == SEMANTIC_RESOLVED
    assert record["structured_blocker"]["reason"] == BLOCKER_ACCESS_UNVERIFIED
    assert record["structured_blocker"]["terminal"] is False

    blob = json.dumps(record, sort_keys=True)
    for banned in ("HTF_SOURCE_MISSING", "SOURCE_MISSING"):
        assert banned not in blob, (
            f"the E8 calibration result reported {banned}; the source was understood, only "
            f"provider ACCESS is unproven"
        )
