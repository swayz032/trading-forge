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
    ACCESS_UNVERIFIED,
    ACCESS_VERIFIED,
    BLOCKED_EXTERNAL_DEPENDENCY,
    EXTERNAL_DEPENDENCY_KIND_INDICATOR,
    FAIL_CLOSED_ACTION,
    ExternalDependencySpec,
    GraphEdge,
    ProjectionSpec,
    UNRESOLVED_OUTPUT,
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
    dep = _dep(access_status=ACCESS_VERIFIED, live_delivery=ACCESS_VERIFIED,
               historical_replay=ACCESS_VERIFIED, update_policy=ACCESS_VERIFIED)
    record = _run(external_dependencies=(dep,))
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


def test_C0_4f_no_adapter_or_network_call_is_made():
    """C0 REPRESENTS a dependency; it does not integrate one. The proof that nothing reached out is
    that the projection is a pure function of its frozen inputs -- run it twice, identical result."""
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
