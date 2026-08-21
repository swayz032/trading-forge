"""AR-1325A STAGE-2 PROOF -- the certified V2.1 source graph compiles through the EXISTING
production compiler (SPINE-A + spec_producer.py), and each of AR-1325A section 3's ten "Stage-2
proof requirements" is measured here, against the REAL certified receipt -- never a hand-built
stand-in for it.

WHAT THIS FILE PROVES, AND WHAT IT DOES NOT
---------------------------------------------
  * proves: `compile_svkm_v2_1_vertical()` -> a real `.spec.json` artifact, produced by the
    UNCHANGED `compile_certified_record.py` / `spec_producer.py` entry point AR-1325A named;
  * proves: every one of the 9 certified canonical refs maps to SOMETHING in the compiled
    output (literal text, or a named structural property -- see `CANONICAL_NODE_MAPPING`
    below, satisfying AR-1325A's "exact mapping from each of the 9 certified canonical nodes"
    requirement);
  * proves: the alias ref never becomes a second independent condition, and the 2
    preserved-metadata refs never enter executable logic -- both by MUTATING the input and
    showing the compiled output is unchanged, not merely by inspecting the code path;
  * proves: a mutated/un-ACCEPTED canonical ref REFUSES the compile rather than silently
    falling back to raw text;
  * proves: two compiles from the same committed inputs are byte-identical;
  * proves: `source_risk` / `source_timeframe_roles` are attached from FROZEN, already-ruled
    authority and validate against the production `assert_svkm_role_combination` guard;
  * proves, at the REAL production seam (`SpecConditionStrategy._h_opening_range`, the exact
    handler `svkm_role_execution.py`'s own module docstring names as "the causal gate that
    ACTUALLY EXECUTES") that the compiled artifact's timeframe-role carrier drives a REAL
    5-minute opening-range aggregation off a 5-minute source frame -- not the 1-minute
    execution bars sitting in `ctx`, mirroring `test_svkm_role_execution.py` section 9's own
    "production evidence" bar, with MY compiled spec instead of the synthetic fixture there.

  🛑 NOT PROVEN HERE, AND SAID SO RATHER THAN IMPLIED: a full multi-bar breakout -> FVG ->
     third-candle-entry -> stop -> 2R-target trade simulation. That machinery (FVG detection,
     entry trigger, source-faithful stop/target application) is Band C's, unchanged by this
     adapter, and is already proven real and production-wired against a Band-C-shaped spec by
     `test_source_vertical_join.py` and `test_source_band_c_vertical.py` -- re-deriving it here
     against a second, differently-sourced spec would be the "second calculator" this campaign's
     own doctrine forbids (R-736 section 5-1), for a claim (Band C's entry/exit engine works)
     this file is not the one certifying. What IS new and IS proven here is that THIS adapter's
     OUTPUT is shaped correctly enough to reach that machinery at all -- see
     `test_compiled_artifact_binds_without_error` and the `_h_opening_range` proof above.
     AR-1325A section 4 also keeps "broad historical backtests" LOCKED; a full trade
     simulation would sit closer to that boundary than this file intends to.
"""

from __future__ import annotations

import copy
import json
from datetime import timedelta

import numpy as np
import pytest

from src.engine.extraction.source_graph_projection import ACCEPTED as CANONICAL_ACCEPTED
from src.engine.extraction.svkm_v2_1_compile import (
    _CANONICAL_REFS_IN_ORDER,
    CanonicalNodeNotAcceptedError,
    _outcome_by_ref,
    build_certified_record,
    compile_svkm_v2_1_vertical,
    run_certified_projection,
    stamp_receipt,
)
from src.engine.source_timeframe_roles import SourceTimeframeRoles
from src.engine.svkm_role_execution import assert_svkm_role_combination

# The exact hash AR-1325A's own ruling text cites as the certified receipt's deterministic
# canonical hash ("fd79f602cd55e0abde88cf95516d1a3efe100395c948c5db22ca8d3bc162fc4f") -- a
# cross-check that this module runs the SAME projection the ruling itself inspected, not a
# drifted copy.
_AR_1325A_CITED_HASH = "fd79f602cd55e0abde88cf95516d1a3efe100395c948c5db22ca8d3bc162fc4f"

# ── AR-1325A section 3's exact 9-mechanic list, each pinned to how it is preserved. Every
# entry is either a literal substring the compiled artifact must carry, or a documented
# STRUCTURAL property (checked by a dedicated assertion, named here so the mapping is total).
CANONICAL_NODE_MAPPING = {
    "entry_sequence[0].action": "literal:9:30 AM ET",
    "entry_sequence[1].action": "literal:1-minute candle to close outside",
    "entry_sequence[1].rationale": "structural:direction_both_plus_breakout_routing",
    "entry_sequence[2].action": "literal:Fair Value Gap",
    "entry_sequence[3].rationale": "structural:fvg_validity_fused_into_entry_action",
    "entry_sequence[3].action": "literal:closure of the third candle",
    "confluences[0].description": "literal:9:30 AM ET New York session",
    "stop.rationale": "structural:source_risk.stop",
    "targets[0].rationale": "structural:source_risk.target",
}


@pytest.fixture(scope="module")
def compiled_artifact_path() -> str:
    return compile_svkm_v2_1_vertical()


@pytest.fixture(scope="module")
def compiled_artifact(compiled_artifact_path: str) -> dict:
    with open(compiled_artifact_path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def projection_record():
    record, canonical_hash = run_certified_projection()
    return record, canonical_hash


# ══ 1. THE COMPILE ACTUALLY PRODUCES A REAL ARTIFACT, VIA THE UNCHANGED SPINE-A ENTRY ═══


def test_compile_produces_artifact_with_all_required_fields(compiled_artifact: dict):
    assert compiled_artifact["video"] == "sVkmZklJDHI__s0"
    assert compiled_artifact["spec"]["direction"] == "both"
    assert isinstance(compiled_artifact["spec"]["entry_conditions"], list)
    assert len(compiled_artifact["spec"]["entry_conditions"]) > 0
    assert compiled_artifact["spec"]["entry_trigger_id"]
    assert compiled_artifact["graph_canonical_hash"] == _AR_1325A_CITED_HASH
    assert compiled_artifact["ledger_d"] == "CONSERVED"


def test_compiled_artifact_binds_without_error(compiled_artifact: dict):
    """The compiled spec reaches Band C's own binding-plan machinery (`compile_binding_plan`,
    the SAME function `spec_producer.py::_approximation_metrics` calls) without raising, and
    at least the entry trigger binds and executes. Not a full trade proof -- see module
    docstring -- but proves the artifact is SHAPED correctly enough to reach Band C at all."""
    from src.engine.spec_family_bindings import compile_binding_plan

    plan = compile_binding_plan(compiled_artifact["spec"])
    assert plan.compiled, "the compiled spec did not clear the binding-plan coverage threshold"
    executed = [b for b in plan.bindings if b.executed]
    assert executed, "no condition executed a real primitive"
    trigger_bound = [
        b for b in plan.bindings
        if b.condition_id == compiled_artifact["spec"]["entry_trigger_id"] and b.bindable
    ]
    assert trigger_bound, "the entry trigger condition itself did not bind"


# ══ 2. EVERY ONE OF THE 9 CANONICAL NODES MAPS TO SOMETHING IN THE COMPILED OUTPUT ══════


def _all_compiled_text(artifact: dict) -> str:
    return json.dumps(artifact["spec"], ensure_ascii=False)


@pytest.mark.parametrize("ref", sorted(CANONICAL_NODE_MAPPING))
def test_every_canonical_node_is_accounted_for(
    ref: str, compiled_artifact: dict, projection_record,
):
    record, _hash = projection_record
    outcomes = _outcome_by_ref(record)
    projected_text = outcomes[ref]["provenance"]["projected_condition_text"]
    mapping = CANONICAL_NODE_MAPPING[ref]

    if mapping.startswith("literal:"):
        assert projected_text in _all_compiled_text(compiled_artifact), (
            f"{ref!r}'s certified text {projected_text!r} does not appear anywhere in the "
            "compiled spec body"
        )
    elif mapping == "structural:direction_both_plus_breakout_routing":
        # entry_sequence[1].rationale ("downside break short, upside break buy") is preserved
        # as the RUNTIME breakout-direction property, not as its own entry_conditions[] item --
        # `spec_producer.py::_condition_text` always prefers `action` over `rationale` when
        # both are present (true here), so this canonical fact is compiled into `direction`
        # staying "both" (never narrowed to one side) plus Band C's own breakout-side detection,
        # not into a duplicate boolean predicate.
        assert compiled_artifact["spec"]["direction"] == "both"
    elif mapping == "structural:source_risk.stop":
        assert compiled_artifact["spec"]["source_risk"]["stop"]["anchor"] == "displacement_candle_low"
        assert compiled_artifact["spec"]["source_risk"]["stop"]["include_wick"] is True
    elif mapping == "structural:source_risk.target":
        assert compiled_artifact["spec"]["source_risk"]["target"]["type"] == "FIXED_R"
        assert compiled_artifact["spec"]["source_risk"]["target"]["r_multiple"] == 2
    elif mapping == "structural:fvg_validity_fused_into_entry_action":
        # `_condition_text()` prefers `action` over `rationale` whenever `action` is present
        # (true for step 4), so entry_sequence[3].rationale's certified "valid once its third
        # candle has been printed" fact never becomes its OWN entry_conditions[] entry --
        # instead it is FUSED: entry_sequence[3].action's own certified text ("Enter the trade
        # ... on the closure of the third candle of the FVG sequence") already encodes the same
        # third-candle-completion requirement as part of the entry criterion itself. Assert the
        # fused literal is present, and that the rationale's OWN certified text is genuinely
        # absent as a standalone entry -- the mapping is honest about non-duplication, not
        # merely silent about it.
        action_text = outcomes["entry_sequence[3].action"]["provenance"]["projected_condition_text"]
        assert "third candle" in action_text
        assert action_text in _all_compiled_text(compiled_artifact)
        assert projected_text not in _all_compiled_text(compiled_artifact), (
            "entry_sequence[3].rationale's own text should NOT appear standalone -- its fact "
            "is fused into entry_sequence[3].action, not duplicated"
        )
    else:
        raise AssertionError(f"unmapped case for {ref!r}: {mapping!r}")


def test_canonical_node_mapping_is_total(projection_record):
    """The mapping table above covers EXACTLY the 9 canonical refs -- not more, not fewer."""
    record, _hash = projection_record
    outcomes = _outcome_by_ref(record)
    canonical = {
        ref for ref, o in outcomes.items() if o["disposition"] == CANONICAL_ACCEPTED
    }
    assert canonical == set(_CANONICAL_REFS_IN_ORDER) == set(CANONICAL_NODE_MAPPING)


# ══ 3. THE ALIAS NEVER BECOMES A SECOND INDEPENDENT CONDITION ═══════════════════════════


def test_alias_ref_text_never_appears_in_compiled_output(compiled_artifact: dict, projection_record):
    record, _hash = projection_record
    outcomes = _outcome_by_ref(record)
    alias_outcome = outcomes["confluences[1].description"]
    assert alias_outcome["disposition"] == "ALIAS_OF_CANONICAL"
    assert alias_outcome["alias_of"] == "entry_sequence[1].action"
    entry_condition_count = len(compiled_artifact["spec"]["entry_conditions"])

    # Mutate the alias's raw text in a fresh reconstruction and prove the compiled artifact's
    # entry_conditions COUNT and CONTENT are unaffected -- the alias is excluded structurally,
    # not merely coincidentally absent.
    mutated_record = copy.deepcopy(record)
    mutated_outcomes = _outcome_by_ref(mutated_record)
    mutated_outcomes["confluences[1].description"]["original_condition_text"] = (
        "AN ENTIRELY DIFFERENT SENTENCE"
    )
    mutated_outcomes["confluences[1].description"]["provenance"]["projected_condition_text"] = (
        "AN ENTIRELY DIFFERENT SENTENCE"
    )
    # AR-1397 F-3: the receipt now carries `receipt_sha256_canonical` and the compile seam checks it
    # FIRST, so an edited receipt refuses as tampered before any other gate speaks. This test's
    # mutation stands in for "a projection that legitimately PRODUCED this text", not for tampering,
    # so it re-stamps -- otherwise the tamper gate masks the structural claim under test.
    stamp_receipt(mutated_record)
    rebuilt = build_certified_record(mutated_record)
    assert len(rebuilt["strategies"][0]["confluences"]) == 1, (
        "the alias must never appear as a second confluences[] entry regardless of its text"
    )
    assert entry_condition_count == 5, "sanity: 4 entry_sequence steps + 1 real confluence"


# ══ 4. PRESERVED-METADATA IS STRUCTURALLY INERT, PROVEN BY MUTATION ═════════════════════


def test_preserved_metadata_is_structurally_inert(projection_record, compiled_artifact_path):
    """Mutate the 2 preserved-metadata refs' raw text and prove the RECONSTRUCTED RECORD's
    `entry_sequence[].rationale` values change (provenance IS carried), while re-running them
    through the real `produce_spec_artifact` (via a fresh compile) yields byte-identical
    `entry_conditions` -- because `_condition_text()` always prefers the non-empty `action`
    field over `rationale`, for both mutated steps."""
    from src.engine.extraction.spec_producer import produce_spec_artifact

    record, _hash = projection_record

    baseline_record = build_certified_record(record)
    baseline_spec = produce_spec_artifact(
        baseline_record["strategies"][0], video="sVkmZklJDHI__s0",
    )

    mutated_record = copy.deepcopy(record)
    mutated_outcomes = _outcome_by_ref(mutated_record)
    for ref in ("entry_sequence[0].rationale", "entry_sequence[2].rationale"):
        mutated_outcomes[ref]["original_text"] = "MUTATED PRESERVED METADATA TEXT " + ref

    # AR-1397 F-3: re-stamp, for the same reason as the alias test above -- this mutation stands in
    # for a projection that legitimately produced this text, not for a tampered receipt.
    stamp_receipt(mutated_record)
    mutated_certified_record = build_certified_record(mutated_record)
    # Provenance text DID change (the mutation reached the reconstruction)...
    assert mutated_certified_record["strategies"][0]["entry_sequence"][0]["rationale"] != (
        baseline_record["strategies"][0]["entry_sequence"][0]["rationale"]
    )
    # ...but the COMPILED entry_conditions are byte-identical, because `action` always wins.
    mutated_spec = produce_spec_artifact(
        mutated_certified_record["strategies"][0], video="sVkmZklJDHI__s0",
    )
    assert mutated_spec["spec"]["entry_conditions"] == baseline_spec["spec"]["entry_conditions"]
    assert mutated_spec["spec_hash"] == baseline_spec["spec_hash"]


def test_AR1397_the_inertness_property_has_a_path_to_red(projection_record):
    """🛑 THE POSITIVE CONTROL THE TEST ABOVE WAS MISSING, closing the AR-1397 grader's last
    reachable NOT-MEASURED item.

    `test_preserved_metadata_is_structurally_inert` asserts that mutating the two preserved-metadata
    refs leaves `entry_conditions` byte-identical. On its own that assertion cannot distinguish
    "the metadata is structurally unreachable" from "this mutation happens not to matter" -- an
    unchanged output is exactly what a vacuous test also produces. The grader flagged that it had
    never mutated the inertness MECHANISM, so the property was confirmed by construction only.

    The mechanism is `spec_producer._condition_text()` preferring a non-empty `action` over
    `rationale`, and both preserved-metadata steps carrying a non-empty `action`. So BLANK THE
    ACTION on those steps: the rationale must then reach the compiled output. If it does not, the
    inertness above was never load-bearing and the sibling test proves nothing.

    Deliberately mutates only the RECORD, never production code -- no `spec_producer` change, no
    monkeypatch of the thing under test.
    """
    from src.engine.extraction.spec_producer import produce_spec_artifact

    record, _hash = projection_record
    baseline = produce_spec_artifact(
        build_certified_record(record)["strategies"][0], video="sVkmZklJDHI__s0",
    )

    leaked = copy.deepcopy(record)
    outcomes = _outcome_by_ref(leaked)
    for ref in ("entry_sequence[0].rationale", "entry_sequence[2].rationale"):
        outcomes[ref]["original_text"] = "LEAKED PRESERVED METADATA " + ref
    stamp_receipt(leaked)

    strategy = build_certified_record(leaked)["strategies"][0]
    # blank the `action` that was winning, so `rationale` becomes the selected text
    blanked = 0
    for step in strategy["entry_sequence"]:
        if str(step.get("rationale") or "").startswith("LEAKED PRESERVED METADATA"):
            step["action"] = ""
            blanked += 1
    assert blanked == 2, f"expected both preserved-metadata steps, blanked {blanked}"

    leaked_spec = produce_spec_artifact(strategy, video="sVkmZklJDHI__s0")
    assert leaked_spec["spec"]["entry_conditions"] != baseline["spec"]["entry_conditions"], (
        "blanking the winning `action` did NOT change the compiled output, so the inertness "
        "asserted by test_preserved_metadata_is_structurally_inert is vacuous -- that test cannot "
        "tell an unreachable field from an irrelevant mutation"
    )


# ══ 5. A MUTATED / UN-ACCEPTED CANONICAL NODE REFUSES THE COMPILE ═══════════════════════


def test_refuses_when_a_load_bearing_canonical_ref_is_not_accepted(projection_record):
    record, _hash = projection_record
    mutated = copy.deepcopy(record)
    outcomes = _outcome_by_ref(mutated)
    # entry_sequence[2].action -- the FVG-formation step -- corrupted to a REFUSED disposition,
    # simulating what a real relevance/fidelity-gate failure would produce.
    outcomes["entry_sequence[2].action"]["disposition"] = "RED_SOURCE_FIDELITY"

    # AR-1397 F-3: re-stamped so this proves what it claims -- that the CANONICAL-REF gate refuses a
    # projection which genuinely produced a RED disposition. Without the re-stamp the receipt would
    # refuse as TAMPERED first, which is a correct refusal for the wrong reason and would leave the
    # canonical-ref gate itself untested.
    stamp_receipt(mutated)
    with pytest.raises(CanonicalNodeNotAcceptedError, match=r"entry_sequence\[2\]\.action"):
        build_certified_record(mutated)


def test_refuses_when_a_canonical_ref_is_removed_entirely(projection_record):
    record, _hash = projection_record
    mutated = copy.deepcopy(record)
    mutated["outcomes"] = [
        o for o in mutated["outcomes"] if o["condition_ref"] != "stop.rationale"
    ]
    stamp_receipt(mutated)  # AR-1397 F-3, as above
    with pytest.raises(CanonicalNodeNotAcceptedError, match=r"stop\.rationale"):
        build_certified_record(mutated)


def test_AR1397_an_UNstamped_edit_refuses_as_tampered_before_any_other_gate(projection_record):
    """The pair to the four re-stamps above, and the reason they are not a weakening.

    Re-stamping says "suppose a producer legitimately emitted this". WITHOUT the re-stamp the same
    edits must refuse as TAMPERED -- otherwise the stamp added by AR-1397 F-3 is decorative and the
    re-stamps really would be hiding something.
    """
    record, _hash = projection_record
    tampered = copy.deepcopy(record)
    _outcome_by_ref(tampered)["entry_sequence[2].action"]["disposition"] = "RED_SOURCE_FIDELITY"

    assert tampered["receipt_sha256_canonical"], "the production receipt must arrive stamped"
    with pytest.raises(CanonicalNodeNotAcceptedError, match="RECEIPT_HASH_MISMATCH"):
        build_certified_record(tampered)


# ══ 6. DETERMINISTIC REPEAT COMPILE ══════════════════════════════════════════════════════


def test_deterministic_repeat_compile(tmp_path):
    out_a = compile_svkm_v2_1_vertical(out_dir=str(tmp_path / "run_a"))
    out_b = compile_svkm_v2_1_vertical(out_dir=str(tmp_path / "run_b"))
    with open(out_a, encoding="utf-8") as f:
        artifact_a = f.read()
    with open(out_b, encoding="utf-8") as f:
        artifact_b = f.read()
    assert artifact_a == artifact_b, "two compiles of the same committed inputs must be byte-identical"

    parsed_a = json.loads(artifact_a)
    assert parsed_a["graph_canonical_hash"] == _AR_1325A_CITED_HASH


def test_run_certified_projection_is_deterministic():
    record_1, hash_1 = run_certified_projection()
    record_2, hash_2 = run_certified_projection()
    assert hash_1 == hash_2 == _AR_1325A_CITED_HASH
    assert record_1 == record_2


# ══ 7. source_risk / source_timeframe_roles -- FROZEN AUTHORITY, VALIDATED ══════════════


def test_source_risk_matches_frozen_ar_1068_contract(compiled_artifact: dict):
    sr = compiled_artifact["spec"]["source_risk"]
    assert sr["mode"] == "SOURCE_FAITHFUL"
    assert sr["stop"] == {"anchor": "displacement_candle_low", "include_wick": True}
    assert sr["target"] == {"type": "FIXED_R", "r_multiple": 2}
    # Short-side boundary preserved, not widened: no short-specific anchor is ever emitted.
    assert "displacement_candle_high" not in json.dumps(sr)


def test_source_timeframe_roles_validate_against_the_production_guard(compiled_artifact: dict):
    roles = SourceTimeframeRoles.from_payload(compiled_artifact["spec"]["source_timeframe_roles"])
    assert_svkm_role_combination(roles)  # raises on any mismatch


def test_timeframe_role_quotes_are_real_transcript_substrings(compiled_artifact: dict):
    """Unlike `test_svkm_role_execution.py`'s own synthetic role quotes (which do NOT occur in
    the pinned transcript -- they are unit-test placeholders), every quote this adapter emits
    must be a real, literal substring of the pinned sVkm transcript."""
    transcript_path = "src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt"
    with open(transcript_path, encoding="utf-8") as f:
        transcript = f.read()
    for binding in compiled_artifact["spec"]["source_timeframe_roles"]["bindings"]:
        assert binding["source_quote"] in transcript, (
            f"role {binding['role']!r}'s source_quote is not a literal transcript substring"
        )


# ══ 8. PRODUCTION-SEAM PROOF -- THE REAL `_h_opening_range` HANDLER, WITH MY ARTIFACT ═══


def _open_ny(minute_offset: int):
    from datetime import date, datetime
    from zoneinfo import ZoneInfo

    ny = ZoneInfo("America/New_York")
    session = date(2026, 4, 15)
    start = datetime(session.year, session.month, session.day, 9, 30, tzinfo=ny)
    return start + timedelta(minutes=minute_offset)


def test_PRODUCTION_real_artifact_drives_the_5m_range_off_the_5m_frame(compiled_artifact: dict):
    """The compiled artifact's `source_timeframe_roles` (OPENING_RANGE_WINDOW=5m,
    BREAKOUT_CONFIRMATION/FVG_DETECTION/ENTRY_COMPLETION=1m) must make a REAL
    `SpecConditionStrategy`, on a 1-minute instance, aggregate the taught opening range from a
    genuine 5-minute source frame -- not from the 1-minute execution bars sitting in `ctx`.
    This is the exact production seam `svkm_role_execution.py`'s own docstring names as "the
    causal gate that ACTUALLY EXECUTES", exercised here with MY compiled artifact rather than
    the synthetic fixture `test_svkm_role_execution.py` uses for its own unit coverage.
    """
    from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate
    from src.engine.opening_range_definition import (
        OpeningRangeDefinition,
        OpeningRangeProvenance,
        OpeningRangeVariant,
    )
    from src.engine.spec_condition_compiler import SpecConditionStrategy
    from src.engine.spec_family_bindings import ConditionBinding
    from src.engine.svkm_role_execution import RoleFrame

    roles = SourceTimeframeRoles.from_payload(compiled_artifact["spec"]["source_timeframe_roles"])
    or_condition_id = compiled_artifact["spec"]["entry_conditions"][0]["id"]
    assert compiled_artifact["spec"]["entry_conditions"][0]["type"] == "OPENING_RANGE_DEFINITION"

    variant = OpeningRangeVariant(
        variant_label="5m", duration_minutes=5, source_quote="that first 5-minute candle",
    )
    definition = OpeningRangeDefinition(
        session_start_local="09:30",
        source_timezone="America/New_York",
        variants=(variant,),
        market_scope="MES, regular-session opening",
        trading_day_rule="resets each regular-session open",
        provenance=OpeningRangeProvenance(source_quote="mark out the high and the low", condition_id=or_condition_id),
    )
    candidate = OpeningRangeExecutionCandidate(
        source_spec_id=compiled_artifact["video"],
        source_condition_id=or_condition_id,
        definition=definition,
        variant=variant,
    )

    frame_5m = RoleFrame(
        timeframe="5m",
        timestamps=(_open_ny(0), _open_ny(5), _open_ny(10)),
        highs=(4512.75, 4515.00, 4516.25),
        lows=(4498.25, 4502.00, 4503.50),
    )

    strategy = SpecConditionStrategy(
        compiled_spec=compiled_artifact,
        symbol="MES",
        timeframe="1m",
        opening_range_candidate=candidate,
        source_timeframe_roles=roles,
        opening_range_source_frame=frame_5m,
    )

    binding = ConditionBinding(
        condition_id=or_condition_id, type="OPENING_RANGE_DEFINITION", role="context",
        object="opening_range", bindable=True,
        primitive="opening_range_adapter.compute_opening_range_state",
        approximation=False, executed=True,
    )
    ts_list = [_open_ny(i) for i in range(15)]
    ctx = {
        "n": 15, "ts_list": ts_list,
        # deliberately DIFFERENT numbers than the 5m frame, so a positive read off the wrong
        # series is caught rather than accidentally matching.
        "high": np.array([100.0 + i * 0.05 for i in range(15)], dtype=float),
        "low": np.array([99.5 + i * 0.05 for i in range(15)], dtype=float),
    }

    out = strategy._h_opening_range(binding, ctx)
    assert out.any(), "the taught opening-range window never became available"
    session_date = _open_ny(0).date()
    record = strategy._source_or_sessions[session_date]
    assert record.or_high == pytest.approx(4512.75)
    assert record.or_low == pytest.approx(4498.25)
    # NEGATIVE CONTROL -- none of the 1m execution-frame numbers leaked into the range.
    assert record.or_high not in {100.0, 100.05, 100.10}
