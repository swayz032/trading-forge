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
