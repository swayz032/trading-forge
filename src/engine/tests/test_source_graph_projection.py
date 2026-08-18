"""AR-1321A / AR-1322A F53 — permanent focused tests for `source_graph_projection.py`.

Covers the load-bearing behaviors that were previously proven only by `_tmp.py` investigation
scripts: conservation validation, the narrowed preserved-metadata eligibility guard (F49), the
alias negative control, graph acyclicity/reachability validation, the alias-must-be-literal
requirement, and an end-to-end GREEN run of the real sVkm v2 projection (frozen inputs, zero
model calls).
"""
from __future__ import annotations

import pytest

from src.engine.extraction.source_graph_projection import (
    AliasSpec,
    GraphEdge,
    ProjectionSpec,
    _eligible_for_preserved_metadata,
    run_projection,
    validate_graph_edges,
)

# ---- minimal synthetic fixture: 4 conditions, no real transcript dependency ---- #

TRANSCRIPT = (
    "The trader marks the high and low of the first candle. The trader waits for a close "
    "outside that range. The trader enters on the third candle close. The trader places a "
    "stop below the low."
)

CONDITIONS = [
    {"condition_ref": "entry_sequence[0].action", "condition_text": "Mark the high and low of the first candle."},
    {"condition_ref": "entry_sequence[1].action", "condition_text": "Wait for a close outside the range."},
    {"condition_ref": "entry_sequence[1].rationale", "condition_text": "The close outside the range confirms direction."},
    {"condition_ref": "stop.rationale", "condition_text": "The stop is placed below the low."},
]

ANSWERS = [
    {"condition_ref": "entry_sequence[0].action",
     "raw_output": "The trader marks the high and low of the first candle."},
    {"condition_ref": "entry_sequence[1].action",
     "raw_output": "The trader waits for a close outside that range."},
    {"condition_ref": "entry_sequence[1].rationale",
     "raw_output": "The trader enters on the third candle close."},
    {"condition_ref": "stop.rationale",
     "raw_output": "The trader places a stop below the low."},
]


def _minimal_projection(**overrides) -> ProjectionSpec:
    base = dict(
        canonical_refs=("entry_sequence[0].action", "entry_sequence[1].action",
                         "entry_sequence[1].rationale", "stop.rationale"),
        alias_specs=(),
        preserved_metadata_refs=(),
        preserved_metadata_records={},
    )
    base.update(overrides)
    return ProjectionSpec(**base)


# --------------------------------------------------------------------------- #
# Conservation
# --------------------------------------------------------------------------- #


def test_conservation_violation_missing_ref_is_refused():
    proj = _minimal_projection(
        canonical_refs=("entry_sequence[0].action", "entry_sequence[1].action", "stop.rationale"),
    )
    with pytest.raises(ValueError, match="CONSERVATION_VIOLATION"):
        run_projection(TRANSCRIPT, CONDITIONS, ANSWERS, proj)


def test_conservation_violation_ref_in_two_buckets_is_refused():
    with pytest.raises(ValueError, match="more than one projection bucket"):
        _validate_via_run(
            canonical_refs=("entry_sequence[0].action", "entry_sequence[1].action",
                             "entry_sequence[1].rationale", "stop.rationale"),
            preserved_metadata_refs=("entry_sequence[1].rationale",),
            preserved_metadata_records={"entry_sequence[1].rationale": {"reason": "x"}},
        )


def _validate_via_run(**kwargs):
    proj = _minimal_projection(**kwargs)
    run_projection(TRANSCRIPT, CONDITIONS, ANSWERS, proj)


# --------------------------------------------------------------------------- #
# F49 — narrowed preserved-metadata eligibility (the fail-open bug AR-1322A caught)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("ref", [
    "entry_sequence[0].action",
    "stop.rationale",
])
def test_F49_non_entry_sequence_rationale_refs_are_never_eligible(ref):
    """🛑 THE REGRESSION WITNESS FOR F49. Before the fix, `_eligible_for_preserved_metadata`
    was `_claim_role(ref) == "rationale"`, which is TRUE for `stop.rationale` — a caller could
    silently exclude the trade's own stop geometry from the executable denominator. This must
    stay False for every ref shape except entry_sequence[N].rationale, forever."""
    assert _eligible_for_preserved_metadata(ref) is False


def test_F49_entry_sequence_rationale_is_eligible():
    assert _eligible_for_preserved_metadata("entry_sequence[7].rationale") is True


@pytest.mark.parametrize("bad_ref,label", [
    ("entry_sequence[0].action", "an action"),
    ("stop.rationale", "the stop rationale"),
])
def test_F49_mutation_excluding_action_or_stop_as_metadata_is_refused(bad_ref, label):
    """Four independent mutations were required by AR-1322A section 3.C item 6 — this file
    covers action and stop.rationale directly (the two present in this minimal fixture);
    confluence-description and target-rationale coverage lives in the sVkm-specific fixture
    integration test below, which uses the real 12-condition shape."""
    proj = _minimal_projection(
        canonical_refs=tuple(
            c["condition_ref"] for c in CONDITIONS if c["condition_ref"] != bad_ref
        ),
        preserved_metadata_refs=(bad_ref,),
        preserved_metadata_records={bad_ref: {"reason": f"mutation test -- {label}"}},
    )
    with pytest.raises(ValueError, match="PRESERVED_METADATA_REFUSED"):
        run_projection(TRANSCRIPT, CONDITIONS, ANSWERS, proj)


# --------------------------------------------------------------------------- #
# Alias negative control + literal-evidence requirement
# --------------------------------------------------------------------------- #


def test_alias_between_different_requirements_is_refused():
    proj = _minimal_projection(
        canonical_refs=("entry_sequence[0].action", "entry_sequence[1].action", "stop.rationale"),
        alias_specs=(AliasSpec("entry_sequence[1].rationale", "stop.rationale", "mutation test"),),
    )
    with pytest.raises(ValueError, match="ALIAS_REFUSED"):
        run_projection(TRANSCRIPT, CONDITIONS, ANSWERS, proj)


def test_alias_with_no_authority_is_refused():
    proj = _minimal_projection(
        canonical_refs=("entry_sequence[0].action", "entry_sequence[1].action", "stop.rationale"),
        alias_specs=(AliasSpec("entry_sequence[1].rationale", "entry_sequence[1].action", ""),),
    )
    with pytest.raises(ValueError):
        run_projection(TRANSCRIPT, CONDITIONS, ANSWERS, proj)


def test_alias_requires_its_own_literal_nonnull_evidence():
    """AR-1322A section 3.E: 'Alias evidence must be mechanically literal and non-null before
    the alias can inherit.' An alias ref with no batch answer at all must refuse, not silently
    produce a null-provenance outcome."""
    answers_without_alias_ref = [a for a in ANSWERS if a["condition_ref"] != "entry_sequence[1].rationale"]
    proj = _minimal_projection(
        canonical_refs=("entry_sequence[0].action", "entry_sequence[1].action", "stop.rationale"),
        alias_specs=(AliasSpec("entry_sequence[1].rationale", "entry_sequence[1].action",
                                "same predicate, test double"),),
    )
    conditions_matching_same_text = [
        {"condition_ref": "entry_sequence[0].action", "condition_text": "Mark the high and low of the first candle."},
        {"condition_ref": "entry_sequence[1].action", "condition_text": "Wait for a close outside the range."},
        {"condition_ref": "entry_sequence[1].rationale", "condition_text": "Wait for a close outside the range."},
        {"condition_ref": "stop.rationale", "condition_text": "The stop is placed below the low."},
    ]
    with pytest.raises(ValueError, match="ALIAS_EVIDENCE_REFUSED"):
        run_projection(TRANSCRIPT, conditions_matching_same_text, answers_without_alias_ref, proj)


# --------------------------------------------------------------------------- #
# Graph validation — acyclicity + reachability (F51)
# --------------------------------------------------------------------------- #


def test_graph_cycle_is_refused():
    edges = [
        GraphEdge("a", "b", "x"),
        GraphEdge("b", "c", "x"),
        GraphEdge("c", "a", "x"),
    ]
    with pytest.raises(ValueError, match="GRAPH_CYCLE_DETECTED"):
        validate_graph_edges(edges, valid_refs={"a", "b", "c"}, root_refs=["a"], required_reachable={"a", "b", "c"})


def test_graph_unknown_ref_is_refused():
    edges = [GraphEdge("a", "ghost", "x")]
    with pytest.raises(ValueError, match="unknown to_ref"):
        validate_graph_edges(edges, valid_refs={"a"}, root_refs=["a"], required_reachable={"a"})


def test_graph_incomplete_reachability_is_reported_not_raised():
    """Incomplete reachability is a real, reportable FINDING about graph completeness, not a
    malformed-input error — the function must return a report, not raise."""
    edges = [GraphEdge("a", "b", "x")]
    report = validate_graph_edges(edges, valid_refs={"a", "b", "c"}, root_refs=["a"], required_reachable={"a", "b", "c"})
    assert report["complete"] is False
    assert report["unreachable_refs"] == ["c"]


def test_graph_complete_reachability_reports_complete():
    edges = [GraphEdge("a", "b", "x"), GraphEdge("b", "c", "x")]
    report = validate_graph_edges(edges, valid_refs={"a", "b", "c"}, root_refs=["a"], required_reachable={"a", "b", "c"})
    assert report["complete"] is True
    assert report["unreachable_refs"] == []


def test_grade_is_RED_when_graph_incomplete_even_if_all_canonical_accepted():
    proj = _minimal_projection(graph_edges=(GraphEdge("entry_sequence[0].action", "stop.rationale", "x"),),
                                graph_roots=("entry_sequence[0].action",))
    record = run_projection(TRANSCRIPT, CONDITIONS, ANSWERS, proj)
    assert record["grade"] == "RED"
    assert record["graph"]["complete"] is False


# --------------------------------------------------------------------------- #
# Provenance / hashing (F50)
# --------------------------------------------------------------------------- #


def test_provenance_hashes_are_self_verifying_not_caller_trusted():
    import hashlib

    proj = _minimal_projection(
        correction_ledger={
            "entry_sequence[1].rationale": {
                "original_condition_text": "old wrong text nobody should trust",
                "authority": "test",
            },
        },
    )
    record = run_projection(TRANSCRIPT, CONDITIONS, ANSWERS, proj)
    o = next(x for x in record["outcomes"] if x["condition_ref"] == "entry_sequence[1].rationale")
    prov = o["provenance"]
    assert prov["original_condition_text"] == "old wrong text nobody should trust"
    assert prov["original_condition_text_sha256"] == hashlib.sha256(prov["original_condition_text"].encode()).hexdigest()
    assert prov["projected_condition_text_sha256"] == hashlib.sha256(prov["projected_condition_text"].encode()).hexdigest()
    assert prov["text_changed"] is True


def test_provenance_unchanged_ref_reports_unchanged():
    record = run_projection(TRANSCRIPT, CONDITIONS, ANSWERS, _minimal_projection())
    o = next(x for x in record["outcomes"] if x["condition_ref"] == "entry_sequence[0].action")
    assert o["provenance"]["text_changed"] is False
    assert o["provenance"]["original_condition_text"] == o["provenance"]["projected_condition_text"]


# --------------------------------------------------------------------------- #
# No fixture-specific string (same discipline `test_evidence_relevance.py` already asserts)
# --------------------------------------------------------------------------- #


def test_module_contains_no_source_specific_strings():
    import inspect

    from src.engine.extraction import source_graph_projection as m

    src = inspect.getsource(m).lower()
    for banned in ("svkm", "fair value", "nasdaq", "9:30", "fvg", "risk-to-reward",
                   "downside", "upside", "short", "buy"):
        assert banned not in src, f"module hardcodes source-specific string: {banned!r}"


# --------------------------------------------------------------------------- #
# End-to-end: the real sVkm v2 projection, frozen inputs, zero model calls
# --------------------------------------------------------------------------- #


def test_real_svkm_v2_projection_is_green_9_of_9_with_complete_graph():
    """Integration witness for the actual certification candidate. Uses the same
    `build_record()` the committed `source_graph_projection_v2.json` artifact was generated
    from — same function, so this test and the committed artifact cannot silently drift apart."""
    import importlib.util
    import os

    spec = importlib.util.spec_from_file_location(
        "_v2_driver",
        os.path.join("scripts", "ar1322a_source_graph_projection_v2_driver_tmp.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    record = mod.build_record()
    assert record["grade"] == "GREEN_PENDING_CERTIFICATION"
    assert record["canonical_accepted_count"] == 9
    assert record["conservation"] == {
        "input_ref_count": 12, "canonical_count": 9, "alias_count": 1,
        "preserved_metadata_count": 2,
    }
    assert record["graph"]["complete"] is True
    assert record["graph"]["unreachable_refs"] == []

    outcome_by_ref = {o["condition_ref"]: o for o in record["outcomes"]}
    assert outcome_by_ref["entry_sequence[1].rationale"]["disposition"] == "ACCEPTED_PENDING_CERTIFICATION"
    # F48 regression witness: the direction node's governed evidence must contain the words
    # the condition text actually claims.
    joined_evidence = " ".join(outcome_by_ref["entry_sequence[1].rationale"]["evidence_quotes"]).lower()
    assert "short" in joined_evidence
    assert "buy" in joined_evidence


# --------------------------------------------------------------------------- #
# AR-1323A section 3 -- certificate-contract closure (v2.1). The frozen v1/v2 tests above are
# UNTOUCHED historical regression witnesses; everything below proves F54-F60 against the NEW
# versioned spec artifact and the NEW stable spec loader -- never `_tmp.py`.
# --------------------------------------------------------------------------- #

V2_1_SPEC_PATH = (
    "docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2_1_spec.json"
)


def _load_pinned_v2_1():
    """Same pinned corpus loader every other test in this suite reuses BY IMPORT -- never
    reimplemented. Dynamically loaded because `scripts/` is not an importable package."""
    import importlib.util
    import os

    spec = importlib.util.spec_from_file_location(
        "_svkm_bench_v2_1", os.path.join("scripts", "svkm_locator_benchmark.py")
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._load_pinned()


def test_F54_v2_1_spec_is_a_versioned_data_artifact_not_a_tmp_driver():
    """AR-1323A F54 regression witness: the spec is loadable as pure JSON data -- no Python
    execution, no `_tmp.py` import required to read the fixture-specific adjudication."""
    import json

    with open(V2_1_SPEC_PATH, encoding="utf-8") as f:
        spec = json.load(f)
    assert spec["spec_version"] == "source-graph-projection-v2.1"
    assert len(spec["conditions"]) == 12
    assert len(spec["canonical_refs"]) == 9
    assert len(spec["alias_specs"]) == 1
    assert len(spec["preserved_metadata_refs"]) == 2
    assert len(spec["graph_edges"]) == 9
    assert set(spec["allowed_edge_types"]) == {e["type"] for e in spec["graph_edges"]}


def test_F55_F56_F57_v2_1_spec_pin_verification_and_stable_loader():
    """AR-1323A F55/F56/F57 end-to-end: the STABLE loader (`source_graph_projection_spec.py`,
    never `_tmp.py`) verifies pins, builds `run_projection()` kwargs, and the resulting receipt
    carries self-contained pins + per-item supplementary evidence spans."""
    from src.engine.extraction import source_graph_projection_spec as sgps
    from src.engine.extraction.source_graph_projection import run_projection

    transcript, extraction_record = _load_pinned_v2_1()
    spec = sgps.load_spec_json(V2_1_SPEC_PATH)
    inputs = sgps.build_projection_run_inputs(
        spec, transcript, verify_pins=True, extraction_record=extraction_record,
    )
    record = run_projection(**inputs.run_kwargs())

    assert record["grade"] == "GREEN_PENDING_CERTIFICATION"
    assert record["canonical_accepted_count"] == 9
    assert record["conservation"] == {
        "input_ref_count": 12, "canonical_count": 9, "alias_count": 1,
        "preserved_metadata_count": 2,
    }
    assert record["graph"]["complete"] is True

    # F55: self-contained pins present and correct (never trust-only, `run_projection` itself
    # re-derives transcript_sha256 from the transcript in hand).
    assert record["transcript_sha256"] == spec["pins"]["transcript_sha256"]
    assert record["extraction_sha256"] == spec["pins"]["extraction_sha256"]

    # F55: the direction node's supplementary evidence now carries exact spans, not just quotes.
    outcome_by_ref = {o["condition_ref"]: o for o in record["outcomes"]}
    direction = outcome_by_ref["entry_sequence[1].rationale"]
    assert len(direction["supplementary_evidence_spans"]) == 2
    for item in direction["supplementary_evidence_spans"]:
        start, end = item["char_span"]
        assert transcript[start:end] == item["quote"]
        assert item["quote_sha256"]

    # F56: preserved-metadata records carry the full narrow schema, self-verifying hashes
    # included, and the AR-1314B correction is a structured ledger entry, not only history prose.
    preserved = outcome_by_ref["entry_sequence[2].rationale"]
    assert preserved["disposition"] == "PRESERVED_NON_EXECUTABLE_METADATA"
    assert preserved["corrected_text"] == "The FVG provides an entry point after the initial directional breakout."
    assert preserved["correction_authority"]
    assert preserved["original_text_sha256"]
    assert preserved["corrected_text_sha256"]
    assert preserved["historical_evidence"]["quote_sha256"]
    assert preserved["exclusion_reason"]
    assert preserved["exclusion_authority"]

    # F57: every graph edge is typed, and the type is drawn from the spec's declared vocabulary.
    for e in record["graph"]["edges"]:
        assert e["type"] in spec["allowed_edge_types"]


def test_F58_four_independent_metadata_exclusion_mutations_on_real_fixture():
    """AR-1323A F58: the four required mutations (action / confluence description / stop /
    target) are now frozen in the PERMANENT test surface against the REAL 12-condition shape --
    previously only `scripts/ar1321a_projection_controls_tmp.py` item 6 covered all four; this
    file's F49 tests above cover only action + stop on the 4-condition minimal fixture."""
    from src.engine.extraction import source_graph_projection_spec as sgps
    from src.engine.extraction.source_graph_projection import run_projection

    transcript, extraction_record = _load_pinned_v2_1()
    spec = sgps.load_spec_json(V2_1_SPEC_PATH)
    inputs = sgps.build_projection_run_inputs(
        spec, transcript, verify_pins=True, extraction_record=extraction_record,
    )
    mutation_targets = [
        ("entry_sequence[0].action", "an entry action"),
        ("confluences[0].description", "a confluence description"),
        ("stop.rationale", "the stop rationale"),
        ("targets[0].rationale", "a target rationale"),
    ]
    for bad_ref, label in mutation_targets:
        mutated = ProjectionSpec(
            canonical_refs=tuple(r for r in inputs.projection.canonical_refs if r != bad_ref),
            alias_specs=inputs.projection.alias_specs,
            preserved_metadata_refs=inputs.projection.preserved_metadata_refs + (bad_ref,),
            preserved_metadata_records={
                **inputs.projection.preserved_metadata_records,
                bad_ref: {"reason": f"MUTATION TEST -- must refuse, this is {label}"},
            },
            correction_ledger=inputs.projection.correction_ledger,
            graph_edges=inputs.projection.graph_edges,
            graph_roots=inputs.projection.graph_roots,
        )
        with pytest.raises(ValueError, match="PRESERVED_METADATA_REFUSED"):
            run_projection(
                transcript=transcript, conditions=list(inputs.conditions),
                batch_answers=list(inputs.batch_answers), projection=mutated,
                composition_specs=list(inputs.composition_specs),
                extra_evidence_by_ref=inputs.extra_evidence_by_ref,
            )


def test_F58_disclaimer_rejected_across_all_9_canonical_nodes_role_bounded():
    """AR-1323A F58: the char-19546 'not perfect' disclaimer must be rejected as grounding for
    EVERY canonical node under the role-bounded rival pool -- ported from
    `ar1321a_projection_controls_tmp.py` item 7 into the permanent surface, reading condition
    texts from the committed v2.1 spec (no drift-prone hardcoded duplicate)."""
    import json

    from src.engine.extraction import evidence_relevance as er
    from src.engine.extraction.source_graph_projection import _claim_role

    transcript, _ = _load_pinned_v2_1()
    with open(V2_1_SPEC_PATH, encoding="utf-8") as f:
        spec = json.load(f)
    text_by_ref = {c["condition_ref"]: c["condition_text"] for c in spec["conditions"]}
    canonical_texts = {r: text_by_ref[r] for r in spec["canonical_refs"]}

    disclaimer = transcript[19546:19757]
    assert "not perfect" in disclaimer

    role_pool: dict[str, list[str]] = {}
    for ref in canonical_texts:
        role_pool.setdefault(_claim_role(ref), []).append(ref)

    for ref, text in canonical_texts.items():
        rivals = [canonical_texts[r] for r in role_pool[_claim_role(ref)] if r != ref]
        v = er.evaluate_evidence_relevance(
            text, disclaimer, rival_conditions=rivals, source_document=transcript,
        )
        assert not v.grounded, f"disclaimer wrongly grounded against {ref!r}: {v.reason}"


def test_F58_generic_reused_quote_rejected_across_same_role_actions():
    """AR-1323A F58: a generic quote reused across two different actions must stay
    rejected/held under role-bounded (actions-only) rivals -- ported from
    `ar1321a_projection_controls_tmp.py` item 8."""
    import json

    from src.engine.extraction import evidence_relevance as er
    from src.engine.extraction.source_graph_projection import _claim_role

    transcript, _ = _load_pinned_v2_1()
    with open(V2_1_SPEC_PATH, encoding="utf-8") as f:
        spec = json.load(f)
    text_by_ref = {c["condition_ref"]: c["condition_text"] for c in spec["conditions"]}
    canonical_texts = {r: text_by_ref[r] for r in spec["canonical_refs"]}

    role_pool: dict[str, list[str]] = {}
    for ref in canonical_texts:
        role_pool.setdefault(_claim_role(ref), []).append(ref)

    action_refs = role_pool["action"]
    generic_action_quote = "Okay, let's go ahead and take a look at the chart here."
    for ref in action_refs:
        rivals = [canonical_texts[r] for r in action_refs if r != ref]
        v = er.evaluate_evidence_relevance(
            canonical_texts[ref], generic_action_quote, rival_conditions=rivals,
            source_document=transcript,
        )
        assert not v.grounded, f"generic quote wrongly grounded against {ref!r}: {v.reason}"


def test_F56_incomplete_preserved_metadata_record_is_refused_under_strict_schema():
    """AR-1323A F56 regression witness: a bare `{"reason": ...}` scaffold on an ELIGIBLE ref
    (so eligibility alone cannot explain the refusal) must be refused once
    `strict_preserved_metadata_schema=True` -- the exact defect F56 found in the AR-1322A V2
    candidate's `_validate_projection_spec()` check."""
    proj = ProjectionSpec(
        canonical_refs=("entry_sequence[0].action", "entry_sequence[1].action", "stop.rationale"),
        alias_specs=(),
        preserved_metadata_refs=("entry_sequence[9].rationale",),
        preserved_metadata_records={"entry_sequence[9].rationale": {"reason": "incomplete scaffold"}},
    )
    conditions = [
        c for c in CONDITIONS if c["condition_ref"] != "entry_sequence[1].rationale"
    ] + [{"condition_ref": "entry_sequence[9].rationale", "condition_text": "commentary only"}]
    answers = [
        a for a in ANSWERS if a["condition_ref"] != "entry_sequence[1].rationale"
    ] + [{"condition_ref": "entry_sequence[9].rationale", "raw_output": "commentary only"}]
    with pytest.raises(ValueError, match="PRESERVED_METADATA_SCHEMA_INCOMPLETE"):
        run_projection(
            TRANSCRIPT, conditions, answers, proj, strict_preserved_metadata_schema=True,
        )


def test_F55_supplementary_span_not_matching_its_quote_is_refused():
    """AR-1323A F55 regression witness: a declared `char_span` that does not exactly equal its
    quote in the transcript must be refused -- this is the exact ambiguity F55 found (identical
    text occurring more than once could previously be silently resolved to the wrong span)."""
    proj = _minimal_projection()
    bad_extra_evidence = {
        "entry_sequence[1].action": (
            {"quote": "The stop is placed below the low.", "char_span": [0, 10]},
        ),
    }
    with pytest.raises(ValueError, match="does not exactly equal its quote"):
        run_projection(
            TRANSCRIPT, CONDITIONS, ANSWERS, proj, extra_evidence_by_ref=bad_extra_evidence,
        )


def test_F57_empty_edge_type_is_always_refused():
    edges = [GraphEdge("a", "b", "")]
    with pytest.raises(ValueError, match="GRAPH_EDGE_TYPE_EMPTY"):
        validate_graph_edges(edges, valid_refs={"a", "b"}, root_refs=["a"], required_reachable={"a", "b"})


def test_F57_unknown_edge_type_is_refused_when_vocabulary_declared():
    edges = [GraphEdge("a", "b", "not_in_vocabulary")]
    with pytest.raises(ValueError, match="GRAPH_EDGE_TYPE_UNKNOWN"):
        validate_graph_edges(
            edges, valid_refs={"a", "b"}, root_refs=["a"], required_reachable={"a", "b"},
            allowed_edge_types=("range_enables_breakout_close",),
        )


def test_F57_known_edge_type_passes_vocabulary_check():
    edges = [GraphEdge("a", "b", "range_enables_breakout_close")]
    report = validate_graph_edges(
        edges, valid_refs={"a", "b"}, root_refs=["a"], required_reachable={"a", "b"},
        allowed_edge_types=("range_enables_breakout_close",),
    )
    assert report["complete"] is True


def test_F60_v2_1_stable_loader_is_the_permanent_integration_test_owner():
    """AR-1323A F60 regression witness: this permanent test imports the STABLE spec loader
    (`source_graph_projection_spec.py`) directly -- it never imports a `_tmp.py` file to reach
    the certification candidate. The frozen `_tmp.py`-based v2 test above remains as historical
    regression evidence for the FROZEN v2 candidate; this test is the v2.1 owner F60 requires."""
    from src.engine.extraction import source_graph_projection_spec as sgps

    transcript, extraction_record = _load_pinned_v2_1()
    spec = sgps.load_spec_json(V2_1_SPEC_PATH)
    inputs = sgps.build_projection_run_inputs(
        spec, transcript, verify_pins=True, extraction_record=extraction_record,
    )
    assert inputs.allowed_edge_types
    assert "scripts" not in sgps.__file__.replace("\\", "/").split("/")


def test_F55_v1_and_v2_legacy_string_extra_evidence_still_works_unchanged():
    """Backward-compatibility witness: the pre-AR-1323A `tuple[str, ...]` shape for
    `extra_evidence_by_ref` (used by the frozen v1/v2 drivers) still behaves byte-for-byte --
    F55's stronger span-checked shape is additive, not a breaking change to history."""
    proj = _minimal_projection()
    record = run_projection(
        TRANSCRIPT, CONDITIONS, ANSWERS, proj,
        extra_evidence_by_ref={"entry_sequence[1].action": ("The trader places a stop below the low.",)},
    )
    outcome = next(o for o in record["outcomes"] if o["condition_ref"] == "entry_sequence[1].action")
    assert outcome["disposition"] == "ACCEPTED_PENDING_CERTIFICATION"
    assert outcome["supplementary_evidence_spans"] == []
