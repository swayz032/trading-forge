"""Guards the unified fidelity registry's video corpus.

The registry is build-fingerprinted, so its bytes are part of the release identity.
Nothing previously asserted anything about its *content*: a later edit could drop a
sealed video, substitute a hash, or quietly present an engineer's reading as the
trader's words, and every existing test would stay green.

These tests exist to make that impossible.
"""
from __future__ import annotations

import io
import json
import re

import pytest

REGISTRY = "research/current_mnq_strategy_v2_4_unified_fidelity_evidence_registry_2026_08_20.json"

# The three videos sealed on 2026-08-20, re-verified byte-exact against the operator's
# local files on 2026-08-21. These may never change without a new operator ruling.
SEALED_VIDEOS = {
    "Desktop 2026.08.19 - 02.12.06.01.mp4":
        "1e39083c6a8078022b5c84827b63e5b63908979177407d1868521934d48d3733",
    "Desktop 2026.08.19 - 02.13.19.02.mp4":
        "95bcbb3f7bf3893385f77eb612e2bbb82e772c546d53a3a9a816c1f4e1ce4f00",
    "Desktop 2026.08.20 - 20.37.47.04.mp4":
        "218ca9bb827db2c540d19782f6cef2227e45492a1a04b847dd78a6b3e23cda72",
}

ALLOWED_PROVENANCE = {
    "OPERATOR_STATED",
    "DERIVED_NOT_OPERATOR_STATED",
    "NO_EVIDENCE_VALUE",
}

HEX64 = re.compile(r"^[0-9a-f]{64}$")


@pytest.fixture(scope="module")
def registry():
    return json.load(io.open(REGISTRY, encoding="utf-8"))


def test_every_sealed_video_survives_with_its_exact_hash(registry):
    by_name = {v["name"]: v for v in registry["verified_video_evidence"]}
    for name, sha in SEALED_VIDEOS.items():
        assert name in by_name, f"sealed video dropped from the registry: {name}"
        assert by_name[name]["sha256"] == sha, f"sealed video hash substituted: {name}"
        assert by_name[name]["roles"], f"sealed video lost its roles: {name}"


def test_every_video_entry_is_hash_bound_and_uniquely_identified(registry):
    videos = registry["verified_video_evidence"]
    hashes = [v["sha256"] for v in videos]
    for v in videos:
        assert v["name"].endswith(".mp4"), v["name"]
        assert HEX64.match(v["sha256"]), f"not a sha256: {v['name']}"
        assert isinstance(v["roles"], list)
    assert len(set(hashes)) == len(hashes), "duplicate video hash in the registry"
    assert len(set(v["name"] for v in videos)) == len(videos), "duplicate video name"


def test_no_video_role_may_be_unlabelled_as_to_who_said_it(registry):
    """A DERIVED reading must never be readable as the trader's own words."""
    for v in registry["verified_video_evidence"]:
        if v["name"] in SEALED_VIDEOS:
            continue
        prov = v.get("role_provenance")
        assert prov in ALLOWED_PROVENANCE, (
            f"{v['name']} carries roles with no declared provenance: {prov!r}"
        )
        if prov == "OPERATOR_STATED":
            assert v.get("operator_words"), (
                f"{v['name']} claims OPERATOR_STATED but quotes no operator words"
            )
        else:
            assert not v.get("operator_words"), (
                f"{v['name']} is {prov} but carries operator_words - a derived reading "
                f"may not wear the trader's authority"
            )
        if prov == "NO_EVIDENCE_VALUE":
            assert v["roles"] == [], f"{v['name']} is NO_EVIDENCE_VALUE but claims roles"


def test_the_2026_08_21_extension_is_operator_authorized_and_does_not_reopen_replays(registry):
    ext = registry["video_corpus_extension_2026_08_21"]
    assert ext["authorizing_words"] == "and it gets added"
    assert ext["prior_three_reverified_byte_exact"] is True
    assert ext["added_video_count"] == 5
    assert ext["total_video_count_after"] == len(registry["verified_video_evidence"]) == 8
    # Adding evidence must NOT be readable as reopening manual replay collection.
    assert ext["manual_collection_remains_closed"] is True
    assert ext["no_new_trader_replay_or_labeling_requested_or_implied"] is True
    assert registry["frozen_replay_evidence"]["manual_collection_closed"] is True
    assert registry["frozen_replay_evidence"]["new_manual_replay_or_labeling_required"] is False
    assert registry["engineering_invariants"]["new_manual_replay_work"] is False
    # Video evidence is fidelity evidence, never edge evidence.
    assert ext["edge_evidence_eligible"] is False


def test_the_amendment_declares_itself_in_the_schema(registry):
    """A changed shape must announce itself; a silent shape change is undetectable."""
    assert registry["schema_version"] == 2
    assert registry["amended_at"] == "2026-08-21"
    assert "Purely additive" in registry["amendment"]
    # The lock itself is not repealed by the amendment.
    assert registry["status"] == "LOCKED_UNIFIED_TRADER_FIDELITY_EVIDENCE_REGISTRY"
    assert registry["locked_at"] == "2026-08-20"


def test_pdh_clearance_does_not_weaken_the_pdh_ban(registry):
    """The operator cleared the *label*; the ban on PDH as an input must be untouched."""
    pdh = registry["video_corpus_extension_2026_08_21"]["pdh_label_disposition"]
    assert pdh["changes_the_ban"] is False
    assert pdh["tag"] == "pdh_label_visible_not_a_strategy_input"
    assert pdh["clearance_scope"], "a clearance with no stated scope is a blank cheque"
    # The forbidding rules themselves must still be exactly as they were.
    assert "PDH/PDL/PWH/PWL are forbidden" in \
        registry["semantic_crosswalk"]["market_map"]["final_rule"]
    assert "PDH_PDL_PWH_PWL_as_strategy_levels" in \
        registry["conflict_resolution"]["examples_of_superseded_interpretations"]


def test_unenumerated_and_forward_dated_videos_carry_their_own_warnings(registry):
    by_name = {v["name"]: v for v in registry["verified_video_evidence"]}
    # 3h53m48s of footage sampled at 6 frames may not be cited for any specific rule.
    long_session = by_name["Desktop 2026.08.15 - 17.13.57.01.mp4"]
    assert long_session["enumerated"] is False
    assert long_session["duration_seconds"] > 14000
    # The 2026-08-21 live session post-dates the 2026-08-17 contamination boundary.
    live = by_name["Desktop 2026.08.21 - 10.40.34.05.mp4"]
    assert "NOT edge evidence" in live["notes"]


def test_registry_is_still_bound_into_the_build_fingerprint(registry):
    """Positive control: the guarded file must actually be load-bearing."""
    from research.current_mnq_strategy_v2_4_policy import fingerprinted_files

    assert REGISTRY in set(fingerprinted_files())
    assert registry["engineering_invariants"][
        "all_authoritative_evidence_files_or_manifests_are_build_fingerprinted"] is True
