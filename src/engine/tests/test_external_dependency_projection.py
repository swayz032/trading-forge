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

from src.engine.extraction.compile_authority import EMPTY_COMPILE_AUTHORITY
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
    # AR-1397 re-grade: the seam now REQUIRES a receipt stamp, so this synthetic stand-in is stamped
    # to say "suppose a producer emitted exactly this". Without it the receipt refuses as unstamped
    # -- a correct refusal, but for a reason that would leave the READINESS gate here untested.
    _restamp(blocked)

    # (a) the readiness gate itself refuses
    with pytest.raises(CanonicalNodeNotAcceptedError, match="BLOCKED_EXTERNAL_DEPENDENCY"):
        _refuse_if_not_compile_ready(blocked, EMPTY_COMPILE_AUTHORITY)

    # (b) and it is WIRED IN, fires first, and names readiness -- not canonical refs
    with pytest.raises(CanonicalNodeNotAcceptedError, match="BLOCKED_EXTERNAL_DEPENDENCY"):
        build_certified_record(blocked, EMPTY_COMPILE_AUTHORITY)


def test_C0_7b_the_seam_still_accepts_a_ready_artifact():
    """The discriminating half. A refusal that fires on everything is not a gate either -- this
    proves the new check rejects the BLOCKED case specifically, not every input it is handed.

    The real certified v2.1 receipt (no external dependencies, grade GREEN) must still compile,
    which is what the committed artifact's unchanged canonical hash independently attests.
    """
    from src.engine.extraction.svkm_v2_1_compile import _refuse_if_not_compile_ready

    ready = _restamp(_run())
    assert ready["grade"] == "GREEN_PENDING_CERTIFICATION"
    assert "compile_readiness" not in ready
    _refuse_if_not_compile_ready(ready, EMPTY_COMPILE_AUTHORITY)  # must not raise

    ok = _restamp(_run(external_dependencies=(_ready_dep(),)))
    assert ok["compile_readiness"] == "READY_PENDING_CERTIFICATION"
    _refuse_if_not_compile_ready(ok, EMPTY_COMPILE_AUTHORITY)  # must not raise


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


def _canonical_receipt_hash(record: dict) -> str:
    """The certifier's own receipt hash, recomputed the way it computes it.

    `scripts/source_graph_projection_v2_1_certify.py:38-42` hashes the record BEFORE stamping
    `receipt_sha256_canonical` onto it, so the stamp is exactly recomputable by excluding the
    field again.
    """
    import hashlib

    unstamped = {k: v for k, v in record.items() if k != "receipt_sha256_canonical"}
    blob = json.dumps(unstamped, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _restamp(record: dict) -> dict:
    """Re-stamp a mutated receipt so it reads as LEGITIMATELY PRODUCED in that shape.

    Since AR-1397's F-3 repair the production receipt carries `receipt_sha256_canonical`, and the
    seam checks it FIRST -- correctly, because a tampered receipt must not be narrated as though
    its fields were trustworthy. The consequence for tests: any mutation of the real receipt
    otherwise surfaces `RECEIPT_HASH_MISMATCH` and MASKS the gate actually under test.

    So a test that wants to exercise the readiness/derivation gates re-stamps, which asserts
    exactly the right thing -- "suppose a producer legitimately emitted a receipt in this shape".
    A test that wants to exercise TAMPER detection deliberately does not re-stamp. Keeping the two
    apart is what stops one gate's refusal from being mistaken for another's.

    Delegates to the PRODUCTION stamping function rather than recomputing the hash here -- a test
    that hand-copies the thing it is testing proves only that the copy agrees with itself.
    """
    from src.engine.extraction.svkm_v2_1_compile import stamp_receipt

    stamp_receipt(record)
    return record


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
    _restamp(laundered)
    assert "compile_readiness" not in laundered
    assert laundered["external_dependencies"], "the attack requires the dependency to be present"

    with pytest.raises(CanonicalNodeNotAcceptedError, match="EXTERNAL_DEPENDENCY_READINESS_ABSENT"):
        build_certified_record(laundered, EMPTY_COMPILE_AUTHORITY)


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
    _restamp(inconsistent)
    assert "external_dependencies" not in inconsistent

    with pytest.raises(CanonicalNodeNotAcceptedError,
                       match="EXTERNAL_DEPENDENCY_RECEIPT_INCONSISTENT"):
        _refuse_if_not_compile_ready(inconsistent, EMPTY_COMPILE_AUTHORITY)


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
    _restamp(odd)

    with pytest.raises(CanonicalNodeNotAcceptedError, match="PROBABLY_FINE"):
        _refuse_if_not_compile_ready(odd, EMPTY_COMPILE_AUTHORITY)


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
    _restamp(receipt)

    with pytest.raises(CanonicalNodeNotAcceptedError) as excinfo:
        _refuse_if_not_compile_ready(receipt, EMPTY_COMPILE_AUTHORITY)
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
    _refuse_if_not_compile_ready(untouched, EMPTY_COMPILE_AUTHORITY)  # must not raise


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
    identity means something different from contract identity and neither is trustworthy.

    ⚠️ AR-1397 GRADER FINDING F-4: THIS TEST ORIGINALLY HAD NO PATH TO RED. It was written with
    `pair = ("entry_sequence[1].action", "stop.rationale")` -- ALREADY lexicographically sorted --
    so the assertion held against a sorting implementation AND a passthrough one, and it passed
    against the pre-packet production blob. That is the identical defect class this packet was
    ordered to remove from `test_C0_4f`, reintroduced inside the packet written to remove it.
    The input is now UNSORTED, and the guard below fails the test if anyone re-sorts it.
    """
    unsorted_pair = ("stop.rationale", "entry_sequence[1].action")
    assert list(unsorted_pair) != sorted(unsorted_pair), (
        "the input must be UNSORTED or this assertion cannot tell a sorting implementation from a "
        "passthrough one -- which is exactly how this test was born dead"
    )

    forward = _run(external_dependencies=(_dep(consumer_refs=unsorted_pair),))
    assert forward["external_dependencies"][0]["consumer_refs"] == sorted(unsorted_pair)


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

    ⚠️ AR-1397 GRADER FINDING F-2: THE FIRST VERSION OF THIS GUARD WAS NETWORK-ONLY, AND ITS NAME
    SAID "NO ADAPTER OR NETWORK CALL". The independent grader planted a real file-writing side
    effect inside a function `run_projection` calls repeatedly; IT FIRED 17 TIMES AND THIS TEST
    STAYED GREEN. The ruling ordered "a genuine zero-network/zero-ADAPTER guard", and half of that
    order had been filled -- which is precisely the failure mode the previous version of this test
    was retired for: a name that claims more than the assertion measures.

    So the guard now also closes the non-network reach routes an adapter would actually use --
    filesystem writes, subprocess launch, and dynamic import -- each with its own witness.

    ⚠️ AR-1397 RE-GRADE (finding F-2 residual): the first widened guard still let FIVE routes
    through, each firing 17 times under a green test -- `io.open`, `pathlib.Path.write_text`,
    `os.open`/`os.write`, `__import__`, and `os.system`. `os.system` is the sharp one: patching
    `subprocess.Popen`/`run` while leaving `os.system` open means a shell-out sails past a guard
    whose name says no adapter call was made. `Path.write_text` is the most idiomatic file write in
    modern Python and this very module uses `Path.read_text`. All five are closed below.

    THE CONTROLS PROVE THE ARMS BITE, NOT THAT PRODUCTION ROUTES THROUGH THEM. The grader's point
    is kept deliberately: an in-test call proves the patch landed; only a plant inside the call path
    proves the production code does not reach out. Both are needed, and only the first can live here.
    """
    import builtins
    import importlib
    import io
    import os
    import pathlib
    import socket
    import subprocess
    import sys
    import urllib.request

    calls: list[str] = []

    def _forbidden(name):
        def _raise(*_a, **_k):
            calls.append(name)
            raise AssertionError(f"C0 attempted an out-of-process call via {name}")
        return _raise

    real_open = builtins.open
    real_os_open = os.open
    write_modes = ("w", "a", "x", "+")

    def _guarded_open(file, mode="r", *args, **kwargs):
        if any(m in mode for m in write_modes):
            calls.append("builtins.open(write)")
            raise AssertionError("C0 attempted an out-of-process call via builtins.open(write)")
        return real_open(file, mode, *args, **kwargs)

    def _guarded_os_open(path, flags, *args, **kwargs):
        if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND):
            calls.append("os.open(write)")
            raise AssertionError("C0 attempted an out-of-process call via os.open(write)")
        return real_os_open(path, flags, *args, **kwargs)

    def _arm(m):
        """Every route, armed on a caller-supplied monkeypatch context.

        🛑 SCOPED TO A CONTEXT ON PURPOSE. `builtins.__import__` and `os.open` are load-bearing for
        pytest ITSELF -- armed for the whole test, pytest's own faulthandler teardown tripped the
        import guard at session unconfigure and took the entire run down. A guard that outlives the
        window it is guarding stops being an instrument and becomes a fault.
        """
        # -- network reach --
        m.setattr(socket, "socket", _forbidden("socket.socket"))
        m.setattr(socket, "create_connection", _forbidden("socket.create_connection"))
        m.setattr(socket, "getaddrinfo", _forbidden("socket.getaddrinfo"))
        m.setattr(urllib.request, "urlopen", _forbidden("urllib.request.urlopen"))
        # -- ADAPTER reach: the half F-2 found open, plus the five routes the re-grade found still
        #    open. An adapter that never opens a socket can still shell out, import a vendor SDK,
        #    or write a cache file.
        m.setattr(builtins, "open", _guarded_open)
        # `io.open` and `builtins.open` are the SAME underlying function but two separate module
        # attributes -- patching one leaves the other live, which is how route 1 of 5 stayed open.
        m.setattr(io, "open", _guarded_open)
        m.setattr(subprocess, "Popen", _forbidden("subprocess.Popen"))
        m.setattr(subprocess, "run", _forbidden("subprocess.run"))
        # `os.system` / `os.popen` spawn a process without touching `subprocess` at all.
        m.setattr(os, "system", _forbidden("os.system"))
        m.setattr(os, "popen", _forbidden("os.popen"))
        m.setattr(importlib, "import_module", _forbidden("importlib.import_module"))
        # `importlib.import_module` is not the only dynamic-import route; `__import__("x")` and the
        # import statement itself both go through `builtins.__import__`.
        #
        # 🛑 SCOPED TO A *NEW MODULE LOAD*, AND THAT SCOPING IS THE HONEST PART. Blanket-guarding
        # `__import__` measures "an import statement executed", not "the process reached out" --
        # every function-local `import json` in already-loaded code trips it, and the run dies for
        # a reason that has nothing to do with adapters. Referencing a module already resident in
        # `sys.modules` is NOT out-of-process reach; loading a vendor SDK that was not there is.
        # So the guard fires on the second and ignores the first, and the test name is true of what
        # is actually measured.
        real_import = builtins.__import__

        def _guarded_import(name, *args, **kwargs):
            if name.partition(".")[0] not in sys.modules:
                calls.append("builtins.__import__(new module)")
                raise AssertionError(
                    f"C0 attempted an out-of-process call via builtins.__import__(new module) "
                    f"loading {name!r}"
                )
            return real_import(name, *args, **kwargs)

        m.setattr(builtins, "__import__", _guarded_import)
        # `Path.write_text` / `write_bytes` are C-level and do NOT route through `builtins.open`.
        m.setattr(pathlib.Path, "write_text", _forbidden("pathlib.Path.write_text"))
        m.setattr(pathlib.Path, "write_bytes", _forbidden("pathlib.Path.write_bytes"))
        m.setattr(os, "open", _guarded_os_open)

    # (a) the real thing, under every arm at once
    with monkeypatch.context() as m:
        _arm(m)
        record = _run(external_dependencies=(_dep(),))
    assert record["external_dependencies"][0]["dependency_id"] == "fixture.external_state"
    assert calls == [], f"C0 reached out: {calls}"

    # (b) POSITIVE CONTROLS -- a guard nobody has seen fail is indistinguishable from one that
    #     CANNOT fail, so every arm above is proven to bite. The grader's own planted side effect
    #     was a FILE WRITE, so that arm is controlled explicitly rather than by analogy.
    #     Every arm the re-grade found open is controlled BY NAME here, so a future edit that drops
    #     one turns this list red rather than quietly reopening the route.
    #
    #     ⚠️ `os.system` / `os.popen` / `subprocess.run` appear below as GUARD CONTROLS, not as work.
    #     Each is monkeypatched to raise before it can reach a shell, which is the property being
    #     proven -- the call never executes, and there is no interpolated input for a shell to see.
    #     They are here precisely BECAUSE `os.system` is a command-injection sink: an adapter that
    #     shells out must be caught, and the re-grade measured it sailing past the previous guard.
    controls = [
        ("socket.create_connection", lambda: socket.create_connection(("127.0.0.1", 9))),
        ("builtins.open(write)", lambda: builtins.open("adapter-cache.tmp", "w")),
        # noqa UP020 is deliberate: `io.open` is the ROUTE UNDER TEST, not a stylistic slip. It is a
        # separate module attribute from `builtins.open`, and patching only the latter is how this
        # route stayed open through the first repair.
        ("builtins.open(write)", lambda: io.open("adapter-cache.tmp", "w")),  # noqa: UP020
        ("subprocess.run", lambda: subprocess.run(["cmd", "/c", "echo"])),
        ("os.system", lambda: os.system("echo")),
        ("os.popen", lambda: os.popen("echo")),
        ("importlib.import_module", lambda: importlib.import_module("json")),
        # a module that is genuinely NOT resident -- the adapter-shaped case
        ("builtins.__import__(new module)", lambda: __import__("wsgiref.simple_server")),
        ("pathlib.Path.write_text", lambda: pathlib.Path("adapter-cache.tmp").write_text("x")),
        ("pathlib.Path.write_bytes", lambda: pathlib.Path("adapter-cache.tmp").write_bytes(b"x")),
        ("os.open(write)", lambda: os.open("adapter-cache.tmp", os.O_WRONLY | os.O_CREAT)),
    ]
    for expected_name, fire in controls:
        with monkeypatch.context() as m:
            _arm(m)
            with pytest.raises(AssertionError, match="out-of-process call"):
                fire()
        assert calls[-1] == expected_name, (
            f"the {expected_name} arm did not arm; an unproven arm is an unclosed route"
        )
    assert [name for name, _ in controls] == calls, "a guard arm fired under the wrong name"

    # (c) and the READ path must still work, or (a) passed only because everything was broken
    assert real_open(FIXTURE_PATH, "r", encoding="utf-8").read(1) != ""


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


# --------------------------------------------------------------------------- #
# 10. AR-1397 INDEPENDENT GRADER FINDINGS — the attacks that survived the first repair
#
# The AR-1397 independent adversarial grade (BOUNDED 6/10) landed one CRITICAL and four lesser
# findings against the repair above. F-1 is the one that matters: the first fix closed the
# EXPENSIVE arm of the readiness attack and left the CHEAP one open.
# --------------------------------------------------------------------------- #


def _blocked_dependency_records() -> list[dict]:
    """The real E8 fixture's emitted records -- every access axis UNVERIFIED, impl NOT_STARTED."""
    fx = _load_fixture()
    run = _run(external_dependencies=(ExternalDependencySpec(**fx["external_dependency"]),))
    return run["external_dependencies"]


@pytest.mark.parametrize("keep_blocker", [True, False])
def test_AR1397_F1_declaring_READY_over_unsatisfied_records_is_refused(keep_blocker):
    """🛑 AR-1397 GRADER FINDING F-1, CRITICAL. THE SAME FAIL-OPEN, ONE SPELLING CHEAPER.

    The first repair refused a receipt whose `compile_readiness` key was DELETED. The grader simply
    SET IT TO READY instead -- on the real nine-node receipt, carrying the real E8 dependency
    record whose every access axis reads UNVERIFIED and whose implementation_status is NOT_STARTED
    -- and measured:

        A2 deps blocked + readiness SET to READY (blocker kept)     COMPILED 1 strategy
        A3 deps blocked + readiness SET to READY (blocker dropped)  COMPILED 1 strategy

    The gate paired the two fields by KEY PRESENCE and then BELIEVED THE VALUE IT FOUND. Blocking
    the deletion while trusting the assignment closed the harder attack and left the easier one.

    Readiness is now RE-DERIVED from the records the seam already holds, so the declared value is a
    claim to be checked rather than the answer.
    """
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        build_certified_record,
    )

    attack = _real_certified_receipt()
    attack["external_dependencies"] = _blocked_dependency_records()
    attack["grade"] = "RED"
    attack["compile_readiness"] = READY_PENDING_CERTIFICATION
    if keep_blocker:
        attack["structured_blocker"] = {"reason": BLOCKER_ACCESS_UNVERIFIED, "terminal": False}
    _restamp(attack)

    with pytest.raises(CanonicalNodeNotAcceptedError,
                       match="EXTERNAL_DEPENDENCY_READINESS_CONTRADICTED"):
        build_certified_record(attack, EMPTY_COMPILE_AUTHORITY)


def test_AR1397_F1b_a_genuinely_satisfied_record_still_compiles():
    """The discriminating half of F-1. Re-derivation must accept what it should accept, or the
    repair has simply made the seam refuse everything -- which passes the attack test and breaks
    the product."""
    from src.engine.extraction.svkm_v2_1_compile import (
        _refuse_if_not_compile_ready,
    )

    ready_run = _run(external_dependencies=(_ready_dep(),))
    assert ready_run["compile_readiness"] == READY_PENDING_CERTIFICATION

    receipt = _real_certified_receipt()
    receipt["external_dependencies"] = ready_run["external_dependencies"]
    receipt["compile_readiness"] = READY_PENDING_CERTIFICATION
    _restamp(receipt)
    _refuse_if_not_compile_ready(receipt, EMPTY_COMPILE_AUTHORITY)  # must not raise


@pytest.mark.parametrize("axis,bad", [
    ("access_status", ACCESS_UNVERIFIED),
    ("live_delivery", ACCESS_UNVERIFIED),
    ("historical_replay", ACCESS_UNVERIFIED),
    ("update_policy", ACCESS_UNAVAILABLE),
    ("implementation_status", "NOT_STARTED"),
    ("semantic_status", SEMANTIC_UNRESOLVED),
])
def test_AR1397_F1c_every_axis_is_re_derived_not_just_access(axis, bad):
    """Each axis independently. A re-derivation that reads only `access_status` would pass F-1's
    headline test while leaving five other routes to a false READY."""
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        _refuse_if_not_compile_ready,
    )

    ready_run = _run(external_dependencies=(_ready_dep(),))
    records = [dict(ready_run["external_dependencies"][0])]
    records[0][axis] = bad
    # AR-1398: the seam now validates each record's own contract hash BEFORE re-deriving readiness
    # (section 7.2.7). Without re-sealing, this mutation would be caught by the HASH gate and this
    # test would silently stop exercising the axis re-derivation it exists to prove -- passing for
    # the wrong reason, which is the failure this suite keeps convicting. Re-sealing also makes it
    # the STRONGER attack: an adversary who edits an axis and recomputes the digest.
    _reseal_dependency_record(records[0])

    receipt = _real_certified_receipt()
    receipt["external_dependencies"] = records
    receipt["compile_readiness"] = READY_PENDING_CERTIFICATION
    _restamp(receipt)

    with pytest.raises(CanonicalNodeNotAcceptedError) as excinfo:
        _refuse_if_not_compile_ready(receipt, EMPTY_COMPILE_AUTHORITY)
    message = str(excinfo.value)
    assert "EXTERNAL_DEPENDENCY_READINESS_CONTRADICTED" in message, (
        "a re-sealed record must reach the readiness re-derivation, not be stopped earlier by the "
        "contract-hash gate -- otherwise this test proves nothing about axis re-derivation"
    )
    assert axis in message, "the refusal must name the axis it re-derived"


def test_AR1397_F1d_an_axis_missing_from_the_record_is_not_satisfied_by_omission():
    """Deleting an axis from a record must not read as satisfied. Absence of proof is not proof of
    safety -- the same law the deleted-readiness attack established, applied one level down."""
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        _derived_dependency_blockers,
        _refuse_if_not_compile_ready,
    )

    ready_run = _run(external_dependencies=(_ready_dep(),))
    records = [dict(ready_run["external_dependencies"][0])]
    records[0].pop("implementation_status")

    receipt = _real_certified_receipt()
    receipt["external_dependencies"] = records
    receipt["compile_readiness"] = READY_PENDING_CERTIFICATION
    _restamp(receipt)

    # (a) AR-1398: a record with a DELETED field can no longer be re-sealed into a valid contract
    # -- an incomplete record is not a dependency contract at all, so the completeness gate now
    # owns this case and refuses it EARLIER than the readiness re-derivation used to. Strictly
    # stronger, and the refusal names why.
    with pytest.raises(CanonicalNodeNotAcceptedError, match="DEPENDENCY_RECORD_INCOMPLETE"):
        _refuse_if_not_compile_ready(receipt, EMPTY_COMPILE_AUTHORITY)

    # (b) AND the original AR-1397 F-1d property is asserted directly on the helper that owns it,
    # so moving the seam's refusal earlier cannot silently retire the claim this test was written
    # to make. An axis absent from a record must still count as UNSATISFIED, never as satisfied by
    # omission -- absence of proof is not proof of safety.
    blockers = _derived_dependency_blockers(records)
    assert blockers, "an omitted axis must still block when the re-derivation is asked directly"
    assert "implementation_status" in str(blockers)


def test_AR1397_F3_a_stamped_receipt_cannot_be_edited_at_all():
    """🛑 AR-1397 GRADER FINDING F-3 / ATTACK A8, the structural root cause under F-1.

    Every "refuse an edited receipt" rule is a hand-written invariant against an UNBOUNDED edit
    space, and A8 proved the space is not enumerable: RENAME `external_dependencies` and drop
    readiness, and the receipt is indistinguishable at this seam from a legitimate legacy one that
    never had either. No field-level rule can close an attack whose whole shape is ABSENCE.

    A hash can. The certifier already stamps `receipt_sha256_canonical` over the record before
    adding the field; nothing consulted it. Now the seam does.
    """
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        _refuse_if_not_compile_ready,
    )

    stamped = _real_certified_receipt()
    stamped["external_dependencies"] = _blocked_dependency_records()
    stamped["compile_readiness"] = BLOCKED_EXTERNAL_DEPENDENCY
    # stamp it exactly as scripts/source_graph_projection_v2_1_certify.py:101 does
    stamped["receipt_sha256_canonical"] = _canonical_receipt_hash(stamped)

    # A8: rename the dependency key AND drop readiness -- nothing field-level is left to catch it
    a8 = dict(stamped)
    a8["_external_dependencies_renamed"] = a8.pop("external_dependencies")
    a8.pop("compile_readiness")

    with pytest.raises(CanonicalNodeNotAcceptedError, match="RECEIPT_HASH_MISMATCH"):
        _refuse_if_not_compile_ready(a8, EMPTY_COMPILE_AUTHORITY)


def test_AR1397_F3b_an_unstamped_receipt_refuses_and_a_stamped_intact_one_passes():
    """The two discriminating halves of F-3, after the re-grade corrected which half is which."""
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        _refuse_if_not_compile_ready,
    )

    # 🛑 AR-1397 RE-GRADE, ATTACK H5. An UNSTAMPED receipt must REFUSE, not pass. The first version
    # let it through as "legacy, nothing to check" -- which left the attack fully intact: remove the
    # dependency key AND the stamp, and the receipt declares nothing, carries no evidence, and looks
    # exactly like a legitimate legacy one. An integrity check a receipt can opt out of by omitting
    # a field is not a check.
    unstamped = _real_certified_receipt()
    unstamped.pop("receipt_sha256_canonical", None)
    with pytest.raises(CanonicalNodeNotAcceptedError, match="RECEIPT_HASH_ABSENT"):
        _refuse_if_not_compile_ready(unstamped, EMPTY_COMPILE_AUTHORITY)

    # And the discriminating half: the receipt the production path actually emits is stamped,
    # intact, and must PASS its own hash check rather than be refused by it.
    intact = _real_certified_receipt()
    assert intact["receipt_sha256_canonical"] == _canonical_receipt_hash(intact)
    _refuse_if_not_compile_ready(intact, EMPTY_COMPILE_AUTHORITY)  # must not raise


def test_AR1397_F5_a_non_dict_structured_blocker_refuses_instead_of_crashing():
    """AR-1397 grader finding F-5. `record.get(...) or {}` let every TRUTHY non-dict through, so
    `structured_blocker="not a dict"` raised AttributeError rather than the documented
    CanonicalNodeNotAcceptedError. It failed closed, but in an undocumented way -- a caller
    catching the documented exception crashed."""
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        _refuse_if_not_compile_ready,
    )

    for junk in ("not a dict", 42, ["a", "list"], True):
        receipt = _real_certified_receipt()
        receipt["external_dependencies"] = _blocked_dependency_records()
        receipt["compile_readiness"] = BLOCKED_EXTERNAL_DEPENDENCY
        receipt["structured_blocker"] = junk
        _restamp(receipt)

        with pytest.raises(CanonicalNodeNotAcceptedError):
            _refuse_if_not_compile_ready(receipt, EMPTY_COMPILE_AUTHORITY)


# --------------------------------------------------------------------------- #
# 11. AR-1397 RE-GRADE FINDINGS — the holes the FIRST round of repairs left or made
#
# The re-grade at pin f8776f36 held the band flat at 6/10 BOUNDED and was right to: it still had a
# measured `COMPILED 1 strategy` on a receipt whose own dependency record read every access axis
# UNVERIFIED. G-1 got past the new backstop by never letting it run; G-2 was introduced BY the
# repair, and is this packet's own signature defect committed inside the fix for it.
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("container_label,make_container", [
    ("dict keyed by dependency_id", lambda recs: {r["dependency_id"]: r for r in recs}),
    ("non-empty string", lambda recs: "e8.htf_premium_discount"),
    ("int", lambda recs: 5),
])
def test_AR1397_G1_a_wrong_shaped_dependency_container_fails_closed(
        container_label, make_container):
    """🛑 AR-1397 RE-GRADE FINDING G-1, HIGH. THE BACKSTOP DEFEATED BY NEVER RUNNING.

    `_derived_dependency_blockers` opened with `if not isinstance(dependencies, (list, tuple)):
    return {}` -- and an empty return means NOTHING BLOCKS. So reshaping `external_dependencies`
    into a dict keyed by dependency_id (a plausible ACCIDENTAL shape, not an exotic attack) made
    the entire F-1 re-derivation evaporate, and the grader measured:

        C1 deps as DICT keyed by id     COMPILED 1
        C2 deps as a non-empty STRING   COMPILED 1
        C3 deps as int 5                COMPILED 1

    The tell was inside that one function: a non-mapping RECORD was flagged fail-closed two lines
    below, while a wrong-typed CONTAINER was silently exempted -- the same field read as
    truthy-dependencies by the pairing rules and as no-dependencies by the derivation.
    WHEN A VALIDATOR HANDLES A WRONG SHAPE TWO DIFFERENT WAYS, THE PERMISSIVE BRANCH IS THE BUG.
    """
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        build_certified_record,
    )

    attack = _real_certified_receipt()
    attack["external_dependencies"] = make_container(_blocked_dependency_records())
    attack["grade"] = "RED"
    attack["compile_readiness"] = READY_PENDING_CERTIFICATION
    _restamp(attack)  # a legitimately-stamped receipt, so the HASH gate cannot mask the derivation

    with pytest.raises(CanonicalNodeNotAcceptedError):
        build_certified_record(attack, EMPTY_COMPILE_AUTHORITY)


def test_AR1397_G1b_the_helper_itself_reports_a_container_blocker():
    """Direct on the helper, so the property is pinned where it lives rather than only through the
    seam. `{} == nothing blocks` was the whole defect, so the empty return must be unreachable for
    a wrong-shaped container."""
    from src.engine.extraction.svkm_v2_1_compile import _derived_dependency_blockers

    recs = _blocked_dependency_records()
    assert _derived_dependency_blockers({r["dependency_id"]: r for r in recs}) != {}
    assert _derived_dependency_blockers("e8.htf_premium_discount") != {}
    assert _derived_dependency_blockers(5) != {}
    # ...and the shapes that MUST still work, or the fix is just "refuse everything"
    assert _derived_dependency_blockers(recs) != {}          # blocked records still blocked
    assert _derived_dependency_blockers([]) == {}            # genuinely no dependencies
    assert _derived_dependency_blockers(()) == {}


@pytest.mark.parametrize("bad_stamp", ["", None, ["a", "list"], 0, {}])
def test_AR1397_G2_a_present_but_unreadable_receipt_stamp_refuses(bad_stamp):
    """🛑 AR-1397 RE-GRADE FINDING G-2, INTRODUCED BY THE REPAIR ITSELF.

    `_refuse_if_receipt_hash_broken` returned early on any non-string or empty stamp, so blanking
    it to "", None, or a list DISARMED the check and the receipt COMPILED. That is precisely "a
    gate keyed to a field's value is disarmed by deleting the field" -- the sentence written four
    functions up, in the repair that closed exactly that for readiness, violated here for the stamp.

    ABSENT and UNREADABLE are different facts. The key's PRESENCE proves the producer stamped this
    receipt, so a blank or wrong-typed value is a DESTROYED stamp, not an unstamped receipt.
    """
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        _refuse_if_not_compile_ready,
    )

    receipt = _real_certified_receipt()
    receipt["receipt_sha256_canonical"] = bad_stamp

    with pytest.raises(CanonicalNodeNotAcceptedError, match="RECEIPT_HASH_UNREADABLE"):
        _refuse_if_not_compile_ready(receipt, EMPTY_COMPILE_AUTHORITY)


def test_AR1397_G2b_the_production_receipt_is_stamped_so_the_hash_gate_is_not_a_no_op():
    """🛑 AR-1397 RE-GRADE, F-3 PARTIAL -- THE HALF THAT MATTERED, AND WHERE MY OWN REPLAY WAS
    OVER-BROAD.

    I reported "A8 refused RECEIPT_HASH_MISMATCH". That was true only of a receipt my TEST stamped
    by hand. `run_certified_projection()` computed the canonical hash and returned it as a SEPARATE
    VALUE without stamping the record, so on the ONLY production path the tamper check saw an
    unstamped receipt and passed -- and A8 still COMPILED. A gate that is a no-op on the real path
    is a gate in name only.

    The record is now stamped at the point of production, and the returned hash is unchanged so
    every existing pin of it still matches.
    """
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        build_certified_record,
        run_certified_projection,
    )

    record, returned_hash = run_certified_projection()
    assert record["receipt_sha256_canonical"] == returned_hash, (
        "the production receipt must carry its own stamp, or the hash gate never runs"
    )
    assert _canonical_receipt_hash(record) == returned_hash, (
        "the stamp must be computed over the UNSTAMPED record, as the certifier computes it"
    )

    # A8 against the receipt the production path actually produces -- no hand-stamping by the test
    a8 = dict(record)
    a8["external_dependencies"] = _blocked_dependency_records()
    a8["_external_dependencies_renamed"] = a8.pop("external_dependencies")
    with pytest.raises(CanonicalNodeNotAcceptedError, match="RECEIPT_HASH_MISMATCH"):
        build_certified_record(a8, EMPTY_COMPILE_AUTHORITY)


def test_AR1397_G3_the_seam_re_derives_every_axis_the_projection_gates_on():
    """AR-1397 re-grade LOW drift note, pinned rather than commented.

    The seam's re-derivation imported four axis names and RESTATED two as string literals, so a
    seventh gating axis added to the projection would silently not be re-derived at the seam. Both
    sides now read `GATING_AXES`, and this test proves that map is COMPLETE with respect to what
    the projection actually gates on -- by mutation, not by inspection: flipping each axis in the
    map must make the projection block.
    """
    from src.engine.extraction.source_graph_projection import GATING_AXES

    ready = _run(external_dependencies=(_ready_dep(),))
    assert ready["compile_readiness"] == READY_PENDING_CERTIFICATION, "control must start ready"

    # A VALID but non-satisfying value per axis. Every axis carries a closed vocabulary, so an
    # arbitrary string would be REFUSED at validation and would prove nothing about gating.
    unsatisfying = {
        "access_status": ACCESS_UNVERIFIED,
        "live_delivery": ACCESS_UNVERIFIED,
        "historical_replay": ACCESS_UNVERIFIED,
        "update_policy": ACCESS_UNAVAILABLE,
        "implementation_status": "NOT_STARTED",
        "semantic_status": SEMANTIC_UNRESOLVED,
    }
    assert set(unsatisfying) == set(GATING_AXES), (
        "GATING_AXES changed; this test must be taught the non-satisfying value for the new axis "
        "rather than silently covering one fewer axis than the seam re-derives"
    )

    for axis, bad_value in unsatisfying.items():
        assert bad_value != GATING_AXES[axis], f"{axis} control value must not be the satisfying one"
        blocked = _run(external_dependencies=(_ready_dep(**{axis: bad_value}),))
        assert blocked["compile_readiness"] == BLOCKED_EXTERNAL_DEPENDENCY, (
            f"GATING_AXES lists {axis!r} but the projection does not gate on it"
        )
        assert axis in blocked["structured_blocker"]["unverified_axes"]["fixture.external_state"]


def test_AR1397_G3b_the_projection_cannot_gate_on_an_axis_the_seam_does_not_re_derive():
    """🛑 THE DRIFT DIRECTION THAT ACTUALLY MATTERS, and the one `G3` alone could not catch.

    `G3` proves every axis IN the map is gated by the projection. It cannot catch the reverse: a
    SEVENTH axis added to the projection's gating but not to the map would leave the compile seam
    silently not re-deriving it -- which is the precise shape of every defect in this packet.

    A test pinning a hand-written list can only ever check one direction. So the projection now
    BUILDS its blocking-axis list FROM `GATING_AXES` (`source_graph_projection.py`, the `axes =`
    comprehension), which makes the two structurally incapable of disagreeing. This test pins that
    structural fact: every axis the projection reports as blocking must be a key of the map the
    seam re-derives from.
    """
    from src.engine.extraction.source_graph_projection import GATING_AXES

    # a dependency with EVERY axis unsatisfied at once, so the emitted axis list is maximal
    all_bad = _dep(access_status=ACCESS_UNVERIFIED, live_delivery=ACCESS_UNAVAILABLE,
                   historical_replay=ACCESS_UNVERIFIED, update_policy=ACCESS_UNVERIFIED,
                   implementation_status="NOT_STARTED", semantic_status=SEMANTIC_CONFLICT)
    reported = _run(
        external_dependencies=(all_bad,)
    )["structured_blocker"]["unverified_axes"]["fixture.external_state"]

    assert set(reported) == set(GATING_AXES), (
        "the projection reported a blocking axis that GATING_AXES does not carry, so the compile "
        "seam would not re-derive it -- this is the drift the shared map exists to make impossible"
    )


def test_AR1397_G3c_a_receipt_declaring_no_dependencies_still_passes_the_container_guard():
    """The grader's own question about the G-1 fix, pinned.

    `_refuse_if_not_compile_ready` defaults `dependencies` to `()` when the key is absent. Making
    the container guard fail CLOSED must not turn that empty tuple into a blocker, or every legacy
    receipt refuses and the fix is a bigger outage than the hole it closed.
    """
    from src.engine.extraction.svkm_v2_1_compile import _derived_dependency_blockers

    assert _derived_dependency_blockers(()) == {}, "the absent-key default must stay passable"
    assert _derived_dependency_blockers([]) == {}
    # ...while the wrong-shaped containers G-1 found still fail closed
    assert _derived_dependency_blockers({}) != {}, (
        "an empty DICT is not an empty list -- it is the wrong container type, and G-1 was exactly "
        "the case where a wrong container read as 'nothing blocks'"
    )


# =============================================================================================== #
# AR-1398 -- STAGE C0 CLOSURE. THE FOUR AR-1387A COUNTEREXAMPLES, AS PERMANENT TESTS.
#
# Each test below replays one thing GPT actually executed against the final AR-1397 head
# (`860525ce`) and reported as still open:
#
#   section 2  CRITICAL  delete the required dependency + readiness + blocker, re-stamp -> COMPILED
#   section 3  HIGH      a record of `dependency_id` + six ready words                  -> COMPILED
#   section 4  HIGH      four PYTHONHASHSEED values -> four different receipt hashes
#   section 5  MEDIUM    GATING_AXES.clear() -> a blocked dependency goes GREEN
#
# ★ EVERY REFUSAL TEST HERE IS PAIRED WITH A POSITIVE CONTROL THAT COMPILES. A suite that only
#   proves things are refused cannot tell "this gate catches the attack" from "this gate refuses
#   everything", and the second passes every negative test ever written. `test_AR1398_0_*` are
#   those controls and they must stay GREEN.
# =============================================================================================== #


def _reseal_dependency_record(record: dict) -> dict:
    """Recompute a record's `contract_sha256` in place, so an edited record is self-consistent.

    This is the ADVERSARY'S move, not a convenience: after AR-1398 the seam recomputes each
    record's contract hash before reading any readiness axis, so an attacker who edits a field and
    leaves the old digest is caught by arithmetic. Re-sealing is what a competent attacker does
    next, and it is the state in which the readiness re-derivation actually has to do its job.
    """
    from src.engine.extraction.source_graph_projection import (
        external_dependency_contract_hash,
    )

    record["contract_sha256"] = external_dependency_contract_hash(
        ExternalDependencySpec(**{
            k: (tuple(v) if k == "consumer_refs" else v)
            for k, v in record.items() if k != "contract_sha256"
        })
    )
    return record


def _ar1398_e8_records() -> list:
    fx = _load_fixture()
    blocked = _run(external_dependencies=(ExternalDependencySpec(**fx["external_dependency"]),))
    return blocked["external_dependencies"]


def _ar1398_e8_authority():
    """An authority that REQUIRES the E8 4H Premium/Discount dependency, pinned to its contract."""
    from src.engine.extraction.compile_authority import (
        COMPILE_AUTHORITY_VERSION,
        CompileAuthority,
        RequiredDependency,
    )
    from src.engine.extraction.source_graph_projection import (
        external_dependency_contract_hash,
    )

    dep = ExternalDependencySpec(**_load_fixture()["external_dependency"])
    return CompileAuthority(
        version=COMPILE_AUTHORITY_VERSION,
        entries=(
            RequiredDependency(
                dependency_id=dep.dependency_id,
                contract_sha256=external_dependency_contract_hash(dep),
            ),
        ),
    )


# ----------------------------------------------------------------------------------------------- #
# 0 -- THE DISCRIMINATING POSITIVE CONTROLS. If these go red, every refusal below is noise.
# ----------------------------------------------------------------------------------------------- #


def test_AR1398_0_legacy_receipt_with_an_explicit_empty_authority_still_compiles():
    """The real receipt declares no dependency, and an EXPLICIT empty authority still compiles it.

    This is the control that makes every refusal below meaningful. It also pins the exact
    concession AR-1398 section 7.2.6 grants -- an explicit empty authority is allowed for a legacy
    strategy -- so a later tightening cannot quietly withdraw it and break every legacy strategy.
    """
    from src.engine.extraction.compile_authority import EMPTY_COMPILE_AUTHORITY
    from src.engine.extraction.svkm_v2_1_compile import build_certified_record

    out = build_certified_record(_real_certified_receipt(), EMPTY_COMPILE_AUTHORITY)
    assert len(out["strategies"]) == 1


def test_AR1398_0b_a_complete_satisfied_required_dependency_compiles():
    """A required dependency that is PRESENT, COMPLETE, PIN-MATCHED and READY compiles.

    Without this, `REQUIRED_DEPENDENCY_ABSENT` and its siblings could be firing on every input and
    the packet would still look green. This proves the authority path has a passing arm at all.
    """
    from src.engine.extraction.compile_authority import (
        COMPILE_AUTHORITY_VERSION,
        CompileAuthority,
        RequiredDependency,
    )
    from src.engine.extraction.source_graph_projection import (
        external_dependency_contract_hash,
    )
    from src.engine.extraction.svkm_v2_1_compile import build_certified_record

    ready = _ready_dep()
    ready_receipt = _run(external_dependencies=(ready,))

    authority = CompileAuthority(
        version=COMPILE_AUTHORITY_VERSION,
        entries=(
            RequiredDependency(
                dependency_id=ready.dependency_id,
                contract_sha256=external_dependency_contract_hash(ready),
            ),
        ),
    )

    receipt = _real_certified_receipt()
    receipt["external_dependencies"] = ready_receipt["external_dependencies"]
    receipt["compile_readiness"] = ready_receipt["compile_readiness"]
    _restamp(receipt)

    out = build_certified_record(receipt, authority)
    assert len(out["strategies"]) == 1


# ----------------------------------------------------------------------------------------------- #
# 2 -- CRITICAL. The required dependency can be deleted and re-stamped.
# ----------------------------------------------------------------------------------------------- #


def test_AR1398_2_deleting_the_required_dependency_and_restamping_is_refused():
    """🛑 AR-1387A section 2, CRITICAL -- GPT'S EXACT REPLAY, AND THE REASON THIS PACKET EXISTS.

    GPT's measured sequence on the final AR-1397 head:

        blocked E8 dependency present                 -> CanonicalNodeNotAcceptedError
        delete external_dependencies/readiness/blocker
        re-stamp the receipt
        leave grade=RED
        build_certified_record()                      -> COMPILED 1 strategy

    Note what puts this beyond every other guard in the seam: AFTER the deletion the receipt is not
    corrupt, not inconsistent, and not lying. It is a valid receipt for a strategy that requires
    nothing, and its digest is genuinely correct because it was recomputed after the edit. A plain
    hash cannot help; neither could an HMAC, since a producer that omits the dependency would
    faithfully sign the omission (which is why AR-1387A section 6 refuses that expansion).

    THE STRATEGY BECAME LESS STRICT BY LOSING A GATE. Only an authority the receipt does not
    control can notice.
    """
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        build_certified_record,
    )

    authority = _ar1398_e8_authority()

    laundered = _real_certified_receipt()
    laundered["external_dependencies"] = _ar1398_e8_records()
    laundered["grade"] = "RED"
    laundered["compile_readiness"] = "BLOCKED_EXTERNAL_DEPENDENCY"
    _restamp(laundered)

    # Arm 1 -- the honest blocked receipt refuses, because it declares itself blocked.
    with pytest.raises(CanonicalNodeNotAcceptedError):
        build_certified_record(laundered, authority)

    # Arm 2 -- THE ATTACK, exactly as GPT ran it.
    laundered.pop("external_dependencies", None)
    laundered.pop("compile_readiness", None)
    laundered.pop("structured_blocker", None)
    _restamp(laundered)

    # POSITIVE WITNESS that the attack is really in the state it claims. Without these, the refusal
    # below could be produced by the old pairing rules and would prove nothing new.
    assert "external_dependencies" not in laundered
    assert "compile_readiness" not in laundered
    assert "structured_blocker" not in laundered

    with pytest.raises(CanonicalNodeNotAcceptedError, match="REQUIRED_DEPENDENCY_ABSENT"):
        build_certified_record(laundered, authority)


def test_AR1398_2b_a_present_but_contract_drifted_dependency_is_refused():
    """Presence alone is not enough -- the declared contract must be the RATIFIED one.

    Otherwise the section 2 repair falls to a weaker edit than deletion: keep a record carrying the
    required id, change what it says, re-stamp. Here the 4H gate quietly becomes a 1H gate.
    """
    from src.engine.extraction.source_graph_projection import (
        external_dependency_contract_hash,
    )
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        build_certified_record,
    )

    drifted = dict(_ar1398_e8_records()[0])
    drifted["decision_timeframe"] = "1h"
    drifted["contract_sha256"] = external_dependency_contract_hash(
        ExternalDependencySpec(**{
            k: (tuple(v) if k == "consumer_refs" else v)
            for k, v in drifted.items() if k != "contract_sha256"
        })
    )

    receipt = _real_certified_receipt()
    receipt["external_dependencies"] = [drifted]
    receipt["compile_readiness"] = "BLOCKED_EXTERNAL_DEPENDENCY"
    _restamp(receipt)

    with pytest.raises(CanonicalNodeNotAcceptedError, match="REQUIRED_DEPENDENCY_CONTRACT_DRIFT"):
        build_certified_record(receipt, _ar1398_e8_authority())


def test_AR1398_2c_the_authority_cannot_be_omitted_or_defaulted():
    """An omitted authority is a TypeError; an explicitly wrong one is a documented refusal.

    AR-1398 section 7.2.6 allows an explicit empty authority and forbids an omitted or defaulted
    one. Omission is enforced by the SIGNATURE rather than by a branch, because a required
    parameter is the one guard with nothing to disarm.
    """
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        build_certified_record,
    )

    receipt = _real_certified_receipt()
    with pytest.raises(TypeError):
        build_certified_record(receipt)

    for bogus in (None, {}, [], "EMPTY", 0):
        with pytest.raises(CanonicalNodeNotAcceptedError, match="COMPILE_AUTHORITY_ABSENT"):
            build_certified_record(receipt, bogus)


def test_AR1398_2d_the_authority_object_is_immutable():
    """The authority must not become the new one-line disarm point."""
    authority = _ar1398_e8_authority()
    with pytest.raises((AttributeError, TypeError)):
        authority.entries = ()
    with pytest.raises(TypeError):
        authority.required["e8.htf_premium_discount"] = "0" * 64
    with pytest.raises(AttributeError):
        authority.required.clear()
    assert len(authority.required) == 1


def test_AR1398_2e_a_malformed_authority_pin_is_refused_at_construction():
    """A half-typed pin must fail loudly at BUILD time, not silently refuse every receipt later."""
    from src.engine.extraction.compile_authority import (
        COMPILE_AUTHORITY_VERSION,
        CompileAuthority,
        CompileAuthorityError,
        RequiredDependency,
    )

    for bad in ("", "not-a-hash", "ABC" * 21 + "D", "0" * 63):
        with pytest.raises(CompileAuthorityError):
            RequiredDependency(dependency_id="x", contract_sha256=bad)
    with pytest.raises(CompileAuthorityError):
        CompileAuthority(version="compile-authority/v0", entries=())
    with pytest.raises(CompileAuthorityError):
        CompileAuthority(
            version=COMPILE_AUTHORITY_VERSION,
            entries=(RequiredDependency("dup", "a" * 64), RequiredDependency("dup", "b" * 64)),
        )


# ----------------------------------------------------------------------------------------------- #
# 3 -- HIGH. Six ready words masquerading as a dependency record.
# ----------------------------------------------------------------------------------------------- #


def test_AR1398_3_six_ready_words_are_not_a_dependency_record():
    """🛑 AR-1387A section 3, HIGH -- GPT'S FORGED MINIMUM RECORD, REPLAYED VERBATIM.

    GPT attached exactly this to the real nine-node receipt, declared readiness, re-stamped, and
    called the real compile entry point:

        {"dependency_id": "forged.minimum-record",
         "access_status": "VERIFIED", "live_delivery": "VERIFIED",
         "historical_replay": "VERIFIED", "update_policy": "VERIFIED",
         "implementation_status": "VALIDATED", "semantic_status": "MULTIMODAL_RESOLVED"}

        missing consumer_refs / provider / artifact / platform / both timeframes /
        configuration / output contract / contract hash
        build_certified_record() -> COMPILED 1 strategy

    `_derived_dependency_blockers()` re-derives the six READINESS axes, which is necessary and
    incomplete: it never asks whether the object it reads them off is a dependency contract at all.
    SIX TRUE-LOOKING WORDS ARE NOT A DEPENDENCY; THEY ARE SIX WORDS.
    """
    from src.engine.extraction.compile_authority import EMPTY_COMPILE_AUTHORITY
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        build_certified_record,
    )

    forged = {
        "dependency_id": "forged.minimum-record",
        "access_status": "VERIFIED",
        "live_delivery": "VERIFIED",
        "historical_replay": "VERIFIED",
        "update_policy": "VERIFIED",
        "implementation_status": "VALIDATED",
        "semantic_status": "MULTIMODAL_RESOLVED",
    }

    receipt = _real_certified_receipt()
    receipt["external_dependencies"] = [forged]
    receipt["compile_readiness"] = "READY_PENDING_CERTIFICATION"
    _restamp(receipt)

    with pytest.raises(CanonicalNodeNotAcceptedError, match="DEPENDENCY_RECORD_INCOMPLETE"):
        build_certified_record(receipt, EMPTY_COMPILE_AUTHORITY)


def test_AR1398_3b_the_record_schema_is_pinned_against_the_dataclass():
    """The v1 record schema must BE the dataclass's own fields, not a hand-copied list.

    A second hand-written copy of a boundary rule drifts and stops biting while still reporting
    PASS -- the failure this campaign keeps rediscovering. A field added to
    `ExternalDependencySpec` without being taught here turns this RED instead of arriving later as
    a silently tolerated "extra".
    """
    import dataclasses

    from src.engine.extraction.compile_authority import REQUIRED_DEPENDENCY_RECORD_FIELDS

    declared = {f.name for f in dataclasses.fields(ExternalDependencySpec)}
    declared.discard("expected_contract_sha256")  # caller-side assertion, never serialised
    assert REQUIRED_DEPENDENCY_RECORD_FIELDS == declared | {"contract_sha256"}


def test_AR1398_3c_every_single_required_field_is_load_bearing():
    """Field-by-field mutation across the WHOLE schema.

    A schema check satisfied by "most of the fields" has an unmeasured boundary -- and the forged
    record above was precisely a record that had *some* of them.
    """
    from src.engine.extraction.compile_authority import (
        REQUIRED_DEPENDENCY_RECORD_FIELDS,
        CompileAuthorityError,
        validate_dependency_record,
    )

    base = _ar1398_e8_records()[0]
    # Control: the unmutated record validates. Without it, "every mutation refused" is equally
    # consistent with a validator that refuses everything.
    validate_dependency_record(dict(base))

    for dropped in sorted(REQUIRED_DEPENDENCY_RECORD_FIELDS):
        record = dict(base)
        record.pop(dropped)
        with pytest.raises(CompileAuthorityError, match="DEPENDENCY_RECORD_INCOMPLETE"):
            validate_dependency_record(record)


def test_AR1398_3d_an_extra_field_is_refused_not_ignored():
    from src.engine.extraction.compile_authority import (
        CompileAuthorityError,
        validate_dependency_record,
    )

    record = dict(_ar1398_e8_records()[0])
    record["surprise"] = "anything"
    with pytest.raises(CompileAuthorityError, match="DEPENDENCY_RECORD_INCOMPLETE"):
        validate_dependency_record(record)


def test_AR1398_3e_a_tampered_field_breaks_the_recomputed_contract_hash():
    """The digest is RECOMPUTED from the record's own fields, never believed."""
    from src.engine.extraction.compile_authority import (
        CompileAuthorityError,
        validate_dependency_record,
    )

    record = dict(_ar1398_e8_records()[0])
    record["provider"] = "Somebody Else"
    with pytest.raises(CompileAuthorityError, match="DEPENDENCY_CONTRACT_HASH_MISMATCH"):
        validate_dependency_record(record)


def test_AR1398_3f_duplicate_records_and_malformed_containers_are_refused():
    from src.engine.extraction.compile_authority import EMPTY_COMPILE_AUTHORITY
    from src.engine.extraction.svkm_v2_1_compile import (
        CanonicalNodeNotAcceptedError,
        build_certified_record,
    )

    records = _ar1398_e8_records()

    receipt = _real_certified_receipt()
    receipt["external_dependencies"] = [dict(records[0]), dict(records[0])]
    receipt["compile_readiness"] = "BLOCKED_EXTERNAL_DEPENDENCY"
    _restamp(receipt)
    with pytest.raises(CanonicalNodeNotAcceptedError, match="DEPENDENCY_RECORD_DUPLICATE"):
        build_certified_record(receipt, EMPTY_COMPILE_AUTHORITY)

    # A wrong-typed container must fail CLOSED, not be coerced to "no dependencies". That is the
    # AR-1397 G-1 shape one layer up, and it must not reappear inside the control that closed it.
    receipt2 = _real_certified_receipt()
    receipt2["external_dependencies"] = {r["dependency_id"]: r for r in records}
    receipt2["compile_readiness"] = "BLOCKED_EXTERNAL_DEPENDENCY"
    _restamp(receipt2)
    with pytest.raises(CanonicalNodeNotAcceptedError, match="DEPENDENCY_CONTAINER_MALFORMED"):
        build_certified_record(receipt2, EMPTY_COMPILE_AUTHORITY)


# ----------------------------------------------------------------------------------------------- #
# 4 -- HIGH. Receipt-hash determinism across fresh processes.
# ----------------------------------------------------------------------------------------------- #


def test_AR1398_4_seed_matrix_produces_one_receipt_and_one_hash():
    """🛑 AR-1387A section 4. Four FRESH SUBPROCESSES, four `PYTHONHASHSEED` values, one hash.

    Subprocesses are not ceremony. `PYTHONHASHSEED` is read by the interpreter at STARTUP, so an
    in-process loop that sets `os.environ` changes nothing and yields a control that CANNOT FAIL --
    the worst kind, because it reports PASS forever.

    ⚠️ HONEST SCOPE, MEASURED, AND IT DISAGREES WITH THE RULING. On this tower (CPython 3.13.0) the
    PRE-REPAIR code ALREADY PASSED this: `builtins.sum()` gained Neumaier compensated summation in
    CPython 3.12, which makes the two set-order reductions order-insensitive here. GPT measured
    four different hashes on its own host, where `sum()` is a naive left fold. So on this tower
    this test is a REGRESSION GUARD, not a reproduction. `test_AR1398_4b` is the arm that goes RED
    on THIS interpreter, and the repair closes both halves.
    """
    import os
    import subprocess
    import sys

    probe = Path(__file__).resolve().parents[3] / "scripts" / "receipt_seed_matrix_probe.py"
    assert probe.exists(), probe
    repo_root = probe.parents[1]

    results = {}
    for seed in ("0", "1", "2", "42"):
        env = dict(os.environ)
        env["PYTHONHASHSEED"] = seed
        env["TF_MOCK_VBT"] = "1"
        proc = subprocess.run(
            [sys.executable, str(probe)],
            capture_output=True, text=True, cwd=str(repo_root), env=env, timeout=900,
        )
        assert proc.returncode == 0, f"seed {seed} probe failed:\n{proc.stdout}\n{proc.stderr}"
        results[seed] = proc.stdout.strip()

    assert len(set(results.values())) == 1, (
        "the certified receipt is NOT reproducible across processes; seeds disagree:\n"
        + json.dumps(results, indent=2)
    )


def test_AR1398_4b_the_relevance_reductions_do_not_depend_on_sum_accuracy():
    """The interpreter-independence arm -- the one that goes RED on THIS tower's Python.

    Simulates the interpreter GPT measured on by replacing `builtins.sum` with a naive left fold,
    which is what CPython < 3.12 does. Before the repair `_score` summed unordered SETS with
    `sum()`, so under this patch its answer depends on both set iteration order and interpreter
    version. After the repair it is `math.fsum` over `sorted(...)`, immune to both -- which is
    exactly the claim, so it is exactly what is tested.

    POSITIVE CONTROL FIRST: the patched fold must actually be order-sensitive on these values,
    otherwise this test would pass against a no-op and prove nothing.
    """
    import builtins

    from src.engine.extraction import evidence_relevance as er

    def _naive(iterable, /, start=0):
        total = start
        for value in iterable:
            total = total + value
        return total

    # ⚠️ THE FIRST VERSION OF THIS CONTROL WAS ITSELF BROKEN and the suite caught it: it compared a
    # list against `reversed(list)`, and for these three values BOTH orders fold to 0.0
    # (0+1e16+1.0 rounds back to 1e16, then -1e16 -> 0.0; and the mirror image does the same). A
    # control that compares two orderings which happen to agree cannot detect order sensitivity.
    # These two orderings genuinely disagree -- 0.0 versus 1.0 -- which is the property required.
    lost = [1e16, 1.0, -1e16]      # the 1.0 is absorbed before the cancellation
    kept = [1e16, -1e16, 1.0]      # the cancellation happens first, so the 1.0 survives
    assert _naive(lost) != _naive(kept), (
        "positive control failed: the naive fold is not order-sensitive on these values, so this "
        "test cannot detect the defect it exists to detect"
    )

    weights = {f"t{i}": 1.0 / (1.0 + i) for i in range(1, 40)}
    weights["huge"] = 1e16
    weights["tiny"] = 1e-16
    terms = set(weights)

    real_sum = builtins.sum
    builtins.sum = _naive
    try:
        baseline = er._stable_sum(terms, weights)
        for salt in range(50):
            shuffled = set(sorted(terms, key=lambda t: ((hash(t) + salt) % 7, t)))
            assert shuffled == terms
            assert er._stable_sum(shuffled, weights) == baseline
    finally:
        builtins.sum = real_sum

    assert er._stable_sum(terms, weights) == baseline, (
        "the reduction's value depends on whether builtins.sum compensates, so the receipt is not "
        "portable between CPython 3.11 and 3.12+"
    )


# ----------------------------------------------------------------------------------------------- #
# 5 -- MEDIUM. The shared gate authority must be immutable.
# ----------------------------------------------------------------------------------------------- #


def test_AR1398_5_gating_axes_cannot_be_mutated():
    """🛑 AR-1387A section 5. GPT ran `GATING_AXES.clear()` and a blocked dependency went GREEN.

        grade              GREEN_PENDING_CERTIFICATION
        compile_readiness  READY_PENDING_CERTIFICATION

    Sharing ONE declaration between projection and seam is correct and stays. What was wrong is
    that the shared object was publicly MUTABLE, so both consumers were disarmed in one line. The
    prior tests proved every key present is CONSUMED -- a completeness claim, which says nothing
    about whether the map can be EMPTIED.
    """
    from src.engine.extraction.source_graph_projection import GATING_AXES

    for mutate in (
        lambda: GATING_AXES.clear(),
        lambda: GATING_AXES.pop("access_status"),
        lambda: GATING_AXES.update({"access_status": "UNVERIFIED"}),
        lambda: GATING_AXES.__setitem__("access_status", "UNVERIFIED"),
        lambda: GATING_AXES.__delitem__("access_status"),
    ):
        with pytest.raises((AttributeError, TypeError)):
            mutate()

    assert set(GATING_AXES) == {
        "access_status", "live_delivery", "historical_replay",
        "update_policy", "implementation_status", "semantic_status",
    }


def test_AR1398_5b_both_consumers_still_derive_from_the_one_declaration():
    """Immutability must not have been bought by giving each consumer its own copy.

    That would 'fix' the mutation attack by reintroducing the copy-drift defect the shared map was
    created to remove -- trading a MEDIUM for the HIGH it replaced.
    """
    from src.engine.extraction import svkm_v2_1_compile as seam
    from src.engine.extraction.source_graph_projection import GATING_AXES

    assert seam._GATING_AXES is GATING_AXES, (
        "the compile seam must consume the SAME object the projection declares, never a copy"
    )


def test_AR1398_5c_a_blocked_dependency_still_blocks_after_the_immutability_change():
    """The end-to-end behaviour GPT's mutation subverted, asserted directly."""
    fx = _load_fixture()
    blocked = _run(external_dependencies=(ExternalDependencySpec(**fx["external_dependency"]),))
    assert blocked["grade"] == "RED"
    assert blocked["compile_readiness"] == "BLOCKED_EXTERNAL_DEPENDENCY"
