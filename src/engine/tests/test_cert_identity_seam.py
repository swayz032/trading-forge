"""AR-1283 — identity-preserving certification seam (ruling AR-1282A §7).

Production-path tests: every assertion runs against the REAL committed sVkm
artifacts and the REAL production conveyor, never a re-implementation.

The law under test: a certificate condition's identity is its
`condition_ref`. `char_span` is a join coordinate. The seam must refuse — not
deduplicate — whenever those two are confused.
"""
from __future__ import annotations

import copy
import json
import pathlib

import pytest

from src.engine.extraction.cert_identity_seam import (
    ACCEPTED,
    GREEN,
    REASON_AMBIGUOUS_CONDITION_TEXT,
    REASON_CONDITION_TEXT_MISMATCH,
    REASON_IDENTITY_COLLISION,
    REASON_REF_SET_MISMATCH,
    REASON_ROUTE_NOT_GREEN,
    REASON_ROUTE_ROW_NOT_ACCEPTED,
    REASON_SPAN_MISMATCH,
    REASON_UNKNOWN_CONDITION_REF,
    SeamRefusal,
    assert_certifiable_final_route,
    assert_identity_preserved,
    bind_route_identities,
    make_identity_propose_fn,
    verify_anchor_identity,
)
from src.engine.extraction.pilot_conveyor import prepare_strategy

_ROOT = pathlib.Path(__file__).resolve().parents[3]
_GOLDEN = _ROOT / "docs" / "replay-results" / "svkm-extraction-certified"
_STRATEGY_JSON = _GOLDEN / "sVkmZklJDHI.json"
_ROUTE_JSON = _GOLDEN / "grade" / "opus-v2" / "opus_phase1_route_t1.json"
_TRANSCRIPT = (
    _ROOT / "src" / "engine" / "extraction" / "fixtures" / "source-evidence"
    / "sVkmZklJDHI.transcript.txt"
)

SHARED_SPAN_PAIR = ("confluences[1].description", "entry_sequence[1].action")


@pytest.fixture(scope="module")
def strategy() -> dict:
    doc = json.loads(_STRATEGY_JSON.read_text(encoding="utf-8"))
    return doc["extraction"]["strategies"][0]


@pytest.fixture(scope="module")
def route() -> dict:
    return json.loads(_ROUTE_JSON.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def transcript() -> str:
    return _TRANSCRIPT.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def prepared(strategy, transcript, route) -> dict:
    """The real conveyor run over the four accepted rows (adapter abstains on
    the rest). Pure/deterministic: the propose seam is a dict lookup."""
    ids = bind_route_identities(strategy, route)
    propose, _ = make_identity_propose_fn(ids)
    return prepare_strategy(
        strategy,
        transcript,
        "sVkmZklJDHI",
        extractor_version="test-ar1283",
        taxonomy_version="test-ar1283",
        strategy_index=0,
        propose_fn=propose,
    )


def _all_accepted(route: dict) -> dict:
    out = copy.deepcopy(route)
    for o in out["outcomes"]:
        o["disposition"] = ACCEPTED
    return out


# --------------------------------------------------------------------------- #
# Binding — identity count is preserved by construction
# --------------------------------------------------------------------------- #
def test_binds_one_identity_per_route_row(strategy, route):
    ids = bind_route_identities(strategy, route)
    assert len(ids) == 12
    assert len({i.condition_ref for i in ids}) == 12
    assert sum(1 for i in ids if i.accepted) == 4


def test_the_real_route_has_twelve_identities_but_only_eleven_spans(strategy, route):
    """The exact condition that made AR-1282's dedup control invalid. If this
    ever stops being true the control's defect class has changed and the
    repair must be re-argued, not silently kept."""
    ids = bind_route_identities(strategy, route)
    spans = [i.char_span for i in ids]
    assert len(spans) == 12
    assert len(set(spans)) == 11
    shared = [i.condition_ref for i in ids if spans.count(i.char_span) > 1]
    assert tuple(sorted(shared)) == SHARED_SPAN_PAIR


def test_production_already_holds_both_sides_of_the_collision(route):
    """The aliasing pair is not merely detectable — production already
    withheld it. This is why the seam's precondition is sufficient."""
    held = {
        o["condition_ref"]: o["disposition"]
        for o in route["outcomes"]
        if o["condition_ref"] in SHARED_SPAN_PAIR
    }
    assert set(held.values()) == {"HELD_DUPLICATE_ROLE_AMBIGUITY"}


# --------------------------------------------------------------------------- #
# §7B — final-route GREEN is a HARD precondition, and every leg is live
# --------------------------------------------------------------------------- #
def test_red_route_refuses_certification(strategy, route):
    with pytest.raises(SeamRefusal) as exc:
        assert_certifiable_final_route(bind_route_identities(strategy, route), route["grade"], strategy)
    assert exc.value.reason == REASON_ROUTE_NOT_GREEN


def test_green_alone_is_not_enough(strategy, route):
    """Discriminating: proves the acceptance leg is not shadowed by the grade leg."""
    with pytest.raises(SeamRefusal) as exc:
        assert_certifiable_final_route(bind_route_identities(strategy, route), GREEN, strategy)
    assert exc.value.reason == REASON_ROUTE_ROW_NOT_ACCEPTED


def test_collision_leg_is_live_behind_the_earlier_gates(strategy, route):
    """Discriminating: with grade AND acceptance satisfied, the collision leg
    is the only thing left standing between an alias and a certificate."""
    with pytest.raises(SeamRefusal) as exc:
        assert_certifiable_final_route(
            bind_route_identities(strategy, _all_accepted(route)), GREEN, strategy
        )
    assert exc.value.reason == REASON_IDENTITY_COLLISION
    assert "9432" in exc.value.detail


# --------------------------------------------------------------------------- #
# §7C — the negative controls
# --------------------------------------------------------------------------- #
def test_unknown_condition_ref_refuses(strategy, route):
    bad = copy.deepcopy(route)
    bad["outcomes"][0]["condition_ref"] = "entry_sequence[99].action"
    with pytest.raises(SeamRefusal) as exc:
        bind_route_identities(strategy, bad)
    assert exc.value.reason == REASON_UNKNOWN_CONDITION_REF


def test_condition_text_mismatch_refuses(strategy, route):
    bad = copy.deepcopy(route)
    bad["outcomes"][0]["condition_text"] = "not the spine's text"
    with pytest.raises(SeamRefusal) as exc:
        bind_route_identities(strategy, bad)
    assert exc.value.reason == REASON_CONDITION_TEXT_MISMATCH


def test_missing_identity_refuses(strategy, route):
    bad = copy.deepcopy(route)
    bad["outcomes"].pop(3)
    with pytest.raises(SeamRefusal) as exc:
        assert_certifiable_final_route(bind_route_identities(strategy, bad), GREEN, strategy)
    assert exc.value.reason == REASON_REF_SET_MISMATCH


def test_duplicated_identity_refuses(strategy, route):
    bad = _all_accepted(route)
    bad["outcomes"].append(copy.deepcopy(bad["outcomes"][0]))
    with pytest.raises(SeamRefusal) as exc:
        assert_certifiable_final_route(bind_route_identities(strategy, bad), GREEN, strategy)
    assert exc.value.reason == REASON_REF_SET_MISMATCH


def test_two_identities_sharing_condition_text_refuse(strategy, route):
    strat = copy.deepcopy(strategy)
    strat["entry_sequence"][1]["action"] = strat["entry_sequence"][0]["action"]
    with pytest.raises(SeamRefusal) as exc:
        make_identity_propose_fn(bind_route_identities(strat, _all_accepted(route)))
    assert exc.value.reason == REASON_AMBIGUOUS_CONDITION_TEXT


# --------------------------------------------------------------------------- #
# §7C(3) / §7 F-3 — the exact-span pin, with its positive witness
# --------------------------------------------------------------------------- #
def test_accepted_rows_pin_their_exact_route_spans(strategy, route, prepared):
    """POSITIVE WITNESS. Without this the refusal test below would prove only
    that the path is broken for every input."""
    ids = bind_route_identities(strategy, route)
    records = verify_anchor_identity(prepared, ids)
    assert len(records) == 4
    assert all(r["span_pinned"] for r in records)
    assert all(r["route_span"] == r["resolved_span"] for r in records)


def test_literal_quote_at_the_wrong_span_refuses(strategy, route, prepared):
    """The quote is untouched and still resolves; only the claimed span moves.
    This is the `_verify_and_locate` leftmost-occurrence hazard."""
    bad = copy.deepcopy(route)
    victim = next(o for o in bad["outcomes"] if o["disposition"] == ACCEPTED)
    victim["char_span"] = [victim["char_span"][0] + 1000, victim["char_span"][1] + 1000]
    with pytest.raises(SeamRefusal) as exc:
        verify_anchor_identity(prepared, bind_route_identities(strategy, bad))
    assert exc.value.reason == REASON_SPAN_MISMATCH


# --------------------------------------------------------------------------- #
# §7A — the seam never collapses identities
# --------------------------------------------------------------------------- #
def test_identity_count_drift_refuses(strategy, route, prepared):
    ids = bind_route_identities(strategy, route)
    cert_missing_a_row = {"conditions": [{"classifying_tier": None}] * 11}
    with pytest.raises(SeamRefusal):
        assert_identity_preserved(ids, prepared, cert_missing_a_row)


def test_seam_carries_every_condition_ref_through_the_conveyor(strategy, route, prepared):
    ids = bind_route_identities(strategy, route)
    seen = {o["condition_ref"] for o in prepared["condition_outcomes"]} | {
        u.condition_ref for u in prepared["unanchored_conditions"]
    }
    assert {i.condition_ref for i in ids} == seen
    assert len(seen) == 12


def test_the_four_accepted_rows_are_still_zero_at_tier_one(strategy, route, prepared):
    """AR-1282's load-bearing result, re-measured through the identity seam
    rather than carried across from the previous packet."""
    ids = bind_route_identities(strategy, route)
    accepted = {i.condition_ref for i in ids if i.accepted}
    outcomes = {
        o["condition_ref"]: o["outcome"]
        for o in prepared["condition_outcomes"]
        if o["condition_ref"] in accepted
    }
    assert len(outcomes) == 4
    assert sum(1 for v in outcomes.values() if v == "classified_tier1") == 0
