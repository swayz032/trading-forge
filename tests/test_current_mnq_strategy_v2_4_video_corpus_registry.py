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
RECEIPT = "research/current_mnq_strategy_v2_4_video_corpus_custody_receipt_2026_08_21.md"

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

# The founding three were only ever checked for a NON-EMPTY role list, which meant a sealed
# role could be replaced with a banned concept and stay green. Pinned field-for-field now,
# exactly like the added five.
SEALED_ROLES = {
    "Desktop 2026.08.19 - 02.12.06.01.mp4": [
        "forming_5m_directional_force", "tug_of_war_giveback",
        "entry_before_5m_close_when_force_is_real"],
    "Desktop 2026.08.19 - 02.13.19.02.mp4": [
        "forming_5m_directional_force", "tug_of_war_giveback",
        "entry_before_5m_close_when_force_is_real"],
    "Desktop 2026.08.20 - 20.37.47.04.mp4": [
        "exact_200_dollar_unsafe_tp_example", "tp1_reaction",
        "retest_then_later_momentum_continuation", "no_blind_tp1_to_tp2_leapfrog"],
}

# Guarding WHO may speak is half a guard. The trader's actual sentence is the entire point
# of this registry, and it was the one field nothing pinned - a quote could be inverted to
# mean the opposite with provenance, roles, hash and duration all untouched.
OPERATOR_WORDS = {
    "Desktop 2026.08.19 - 19.49.23.03.mp4": (
        "i entry on 5 minute; the 1 minute chart is to show what the candles and trade "
        "looks like in 1 minute cause the bot uses 1 min candles to equal 5 minute "
        "candles; that is already in my files."
    ),
    "Desktop 2026.08.21 - 10.40.34.05.mp4": (
        "this video i was showing how price reject key level but the candle stick "
        "patterns was terrible to take a trade you see the first candle sellers was "
        "still in control as for the second one and the other ones was doji/indecision "
        "candles it wasnt until later probably 15 mins it was a break out"
    ),
}

# A third location holding this file's own bytes. Deliberately NOT the full build
# fingerprint - see fingerprint_anchor in the registry for why, and for the honest limit.
REGISTRY_SHA256 = "97e7273e699bfb9be0f918fd9bcf924591ee301c9f53fd935c00eddc0fdd5d24"

ALLOWED_PROVENANCE = {
    "OPERATOR_STATED",
    "DERIVED_NOT_OPERATOR_STATED",
    "NO_EVIDENCE_VALUE",
}

# Independent pin of every video added 2026-08-21: sha256 (re-hashed from the operator's
# files by two implementations and by an independent grader), duration, provenance, and the
# EXACT role list. Kept here, in a second file, on purpose - a drive-by edit to the registry
# alone must disagree with this copy and go red. Format checks are not identity checks.
ADDED_2026_08_21 = {
    "Desktop 2026.08.19 - 19.49.23.03.mp4": {
        "sha256": "74b1585768e77dc394fcef6f94bf445a3faeb7842f19b9cd0b6034328f604d20",
        "duration_seconds": 31.8,
        "role_provenance": "OPERATOR_STATED",
        "roles": ["1m_causal_decomposition_only", "forming_5m_force_path"],
    },
    "Desktop 2026.08.15 - 17.13.57.01.mp4": {
        "sha256": "7dbc51c72d8b638a1157b294f9ea021f83fda77b6a91e390ee8c5c4c08cf257a",
        "duration_seconds": 14027.6,
        "role_provenance": "DERIVED_NOT_OPERATOR_STATED",
        "roles": ["extended_replay_session_mixed_timeframes"],
    },
    "Desktop 2026.08.16 - 23.06.30.02.mp4": {
        "sha256": "8f4020a8aa7dd6fa48d48508d411e25466577fcd0e140e4ed79a9dd232ec8c8a",
        "duration_seconds": 98.3,
        "role_provenance": "DERIVED_NOT_OPERATOR_STATED",
        "roles": ["zone_long_entry", "momentum_after_zone_reaction",
                  "frozen_17_25_stop_in_situ", "target_reached_full_tp",
                  "multi_timeframe_15m_and_5m_views"],
    },
    "Desktop 2026.08.21 - 10.40.34.05.mp4": {
        "sha256": "08e87682f683db1b9a37200744006588c4a46bedde7d83c3e2c65b9f19870b2b",
        "duration_seconds": 385.7,
        "role_provenance": "OPERATOR_STATED",
        "roles": ["rejection_at_key_level_without_momentum_candle_wait",
                  "doji_indecision_cluster_is_not_an_entry",
                  "live_forward_session",
                  "later_breakout_after_failed_rejection_story"],
    },
    "Desktop 2026.08.16 - 23.34.40.03.mp4": {
        "sha256": "da8b6c2e4f53f26c4946b526ebeb076b26a7813be02c03391c41a4e7ad638c12",
        "duration_seconds": 1.5,
        "role_provenance": "NO_EVIDENCE_VALUE",
        "roles": [],
    },
}

# Only these videos may ever claim to speak with the trader's authority.
OPERATOR_STATED_CLOSED_SET = {
    "Desktop 2026.08.19 - 19.49.23.03.mp4",
    "Desktop 2026.08.21 - 10.40.34.05.mp4",
}

# Two of the operator's four frozen WAIT reasons now have a live worked example bound to
# them. If these roles are ever dropped, the WAIT predicates lose their witness.
WAIT_REASON_WITNESS = {
    "Desktop 2026.08.21 - 10.40.34.05.mp4": {
        "rejection_at_key_level_without_momentum_candle_wait",
        "doji_indecision_cluster_is_not_an_entry",
    },
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
        assert by_name[name]["roles"] == SEALED_ROLES[name], (
            f"sealed video roles were EDITED: {name} now claims "
            f"{by_name[name]['roles']}, sealed set is {SEALED_ROLES[name]}"
        )


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


def test_every_added_video_is_pinned_field_for_field(registry):
    """PROBE-A and PROBE-B: a format check is not an identity check, and a flag that
    gates nothing is decoration. Hash, duration and the exact role list are all pinned."""
    by_name = {v["name"]: v for v in registry["verified_video_evidence"]}
    for name, pin in ADDED_2026_08_21.items():
        assert name in by_name, f"video added on 2026-08-21 has gone missing: {name}"
        got = by_name[name]
        assert got["sha256"] == pin["sha256"], (
            f"{name}: sha256 substituted - registry says {got['sha256']}, "
            f"the operator's file hashes to {pin['sha256']}"
        )
        assert got["duration_seconds"] == pin["duration_seconds"], (
            f"{name}: duration falsified"
        )
        assert got["role_provenance"] == pin["role_provenance"], (
            f"{name}: provenance relabelled"
        )
        assert got["roles"] == pin["roles"], (
            f"{name}: role list edited - registry says {got['roles']}, "
            f"pinned is {pin['roles']}. A role may not be added to a video by an "
            f"edit that touches only the registry."
        )
    assert len(by_name) == len(SEALED_VIDEOS) + len(ADDED_2026_08_21) == 8


def test_only_a_closed_set_of_videos_may_speak_as_the_trader(registry):
    """PROBE-E: forbidding operator_words on a DERIVED row is only half the guard.
    The provenance field is asserted by the very edit it polices, so relabelling a
    DERIVED row to OPERATOR_STATED and inventing quotes must red too."""
    claimed = {
        v["name"] for v in registry["verified_video_evidence"]
        if v.get("role_provenance") == "OPERATOR_STATED"
    }
    assert claimed == OPERATOR_STATED_CLOSED_SET, (
        f"OPERATOR_STATED set changed: {claimed} != {OPERATOR_STATED_CLOSED_SET}. "
        f"Only the operator may add a video to this set."
    )
    declared = set(registry["video_corpus_extension_2026_08_21"][
        "operator_stated_entries_are_a_closed_set"])
    assert declared == OPERATOR_STATED_CLOSED_SET, (
        "the registry's own closed set disagrees with the pinned one"
    )
    # Anything outside the set carrying operator words is a forgery either way.
    for v in registry["verified_video_evidence"]:
        if v["name"] not in OPERATOR_STATED_CLOSED_SET:
            assert not v.get("operator_words"), f"{v['name']} forges trader words"


def test_the_live_wait_example_keeps_its_witness_roles(registry):
    """The 2026-08-21 live clip is the only worked example bound to two of the four
    frozen WAIT reasons. Dropping either role silently orphans a WAIT predicate."""
    by_name = {v["name"]: v for v in registry["verified_video_evidence"]}
    for name, required in WAIT_REASON_WITNESS.items():
        got = set(by_name[name]["roles"])
        assert required.issubset(got), (
            f"{name} lost a WAIT-reason witness role: missing {required - got}"
        )
        assert by_name[name]["role_provenance"] == "OPERATOR_STATED"
        assert by_name[name]["operator_words"], "a WAIT witness must carry the trader's words"


def test_enumeration_status_is_declared_for_every_added_video(registry):
    """A DERIVED role is only as good as the coverage behind it. Every added video must
    say how much of it was actually looked at, so no reader mistakes 9 frames of a
    3h54m file for a viewing."""
    ext = registry["video_corpus_extension_2026_08_21"]
    status = ext["enumeration_status"]
    for name in ADDED_2026_08_21:
        assert name in status, f"{name} declares no enumeration status"
        assert status[name].strip(), f"{name} has an empty enumeration status"
    by_name = {v["name"]: v for v in registry["verified_video_evidence"]}
    # The one file nobody has watched must still say so, in a field a test can read.
    assert by_name["Desktop 2026.08.15 - 17.13.57.01.mp4"]["enumerated"] is False
    assert "UNENUMERATED" in status["Desktop 2026.08.15 - 17.13.57.01.mp4"]
    # The fully-walked one must claim it and back it with a stated method.
    six = by_name["Desktop 2026.08.16 - 23.06.30.02.mp4"]
    assert six["enumerated"] is True
    assert six["enumeration_method"].strip()
    # The audio disposition must keep its retraction and its exception on record.
    a = ext["audio_disposition"]
    assert a["retracted_overclaim"].strip(), "the retracted overclaim may not be tidied away"
    assert "COMPLETE audio track of all 8" in a["method"], (
        "the claim must rest on full-track measurement, not sampling"
    )
    exc = a["the_one_exception"]
    assert exc["file"] == "Desktop 2026.08.20 - 20.37.47.04.mp4"
    assert exc["audible_duration_seconds"] == 1.17
    assert "HYPOTHESIS" in exc["reading"], (
        "the reading of the burst is unverified and must stay labelled as such"
    )
    assert a["positive_control"].strip(), "an absence claim owes a positive control"


def test_the_traders_actual_words_are_pinned_not_merely_present(registry):
    """Guarding WHO may speak is half a guard. A quote rewritten to say the opposite of
    what he said passed every other check. The text itself is the evidence."""
    by_name = {v["name"]: v for v in registry["verified_video_evidence"]}
    for name, words in OPERATOR_WORDS.items():
        assert by_name[name]["operator_words"] == words, (
            f"{name}: the trader's words were EDITED. This registry exists to preserve "
            f"what he actually said; that sentence is not a summary field."
        )
    assert set(OPERATOR_WORDS) == OPERATOR_STATED_CLOSED_SET, (
        "every video permitted to speak as the trader must have its words pinned"
    )


def test_enumeration_status_cannot_drift_from_the_entries(registry):
    """The status map was prose. It could claim ENUMERATED with no method, contradict the
    entry it describes, or carry rows for files that do not exist."""
    ext = registry["video_corpus_extension_2026_08_21"]
    status = ext["enumeration_status"]
    by_name = {v["name"]: v for v in registry["verified_video_evidence"]}
    assert set(status) == set(ADDED_2026_08_21), (
        "status map and added-video set disagree - a row for a video never added, or an "
        "added video with no row"
    )
    for name in ADDED_2026_08_21:
        entry, text = by_name[name], status[name]
        if entry.get("enumerated") is True:
            assert entry.get("enumeration_method", "").strip(), (
                f"{name} claims ENUMERATED with no stated method"
            )
            assert "UNENUMERATED" not in text, (
                f"{name}: entry says enumerated, status map says the opposite"
            )
        if entry.get("enumerated") is False:
            assert "UNENUMERATED" in text, (
                f"{name}: entry says NOT enumerated, status map does not say so"
            )
        assert str(entry["duration_seconds"]) in text, (
            f"{name}: status row does not state the duration it claims to cover"
        )


def test_this_registry_file_is_anchored_by_its_own_bytes(registry):
    """'Tamper-evident via the fingerprint' was weaker than claimed - the fingerprint moves
    but its value is anchored nowhere and no tests/ path is fingerprinted, so a consistent
    registry+test edit red-lit nothing. This is a third location. It does not make tampering
    impossible; it removes the silent property."""
    import hashlib
    digest = hashlib.sha256(open(REGISTRY, "rb").read()).hexdigest()
    assert digest == REGISTRY_SHA256, (
        f"registry bytes changed without updating the anchor. measured={digest} "
        f"anchored={REGISTRY_SHA256}. If intended, update REGISTRY_SHA256 deliberately and "
        f"say why in the commit message. If not, you have found an unreviewed edit."
    )
    anchor = registry["video_corpus_extension_2026_08_21"]["fingerprint_anchor"]
    assert anchor["honest_limit"].strip(), "an anchor must state what it does NOT prevent"


def test_the_custody_receipt_does_not_contradict_the_registry(registry):
    """Root cause of the stale receipt: the registry had a guard and the receipt did not,
    so corrections flowed to the guarded artifact and stopped at the unguarded one - and
    the unguarded one is the custody document. This test reads the receipt."""
    receipt = open(RECEIPT, encoding="utf-8").read()
    # A retired role name MAY appear - a retraction that names what it retracts is correct.
    # What must never happen is it appearing as a CURRENT claim. So every line carrying one
    # must also carry retraction language.
    markers = ("REFUTED", "earlier", "CORRECTED", "retired", "replaced", "Retracted")
    for term in ("extended_5m_zone_replay_session", "zones_marked_no_trade_observation"):
        for line in receipt.splitlines():
            if term in line:
                assert any(m in line for m in markers), (
                    f"custody receipt states retired role {term!r} as a CURRENT claim, with "
                    f"no retraction marker on the line: {line[:120]!r}"
                )
    # And the live role lists must carry the replacements, never the retired names.
    for line in receipt.splitlines():
        if line.startswith("Roles: "):
            assert "extended_5m_zone_replay_session" not in line
            assert "zones_marked_no_trade_observation" not in line
    for required in ("extended_replay_session_mixed_timeframes", "target_reached_full_tp",
                     "4140.00", "bee2303b", "OPERATOR_STATED", "UNENUMERATED"):
        assert required in receipt, f"custody receipt is missing {required!r}"
    for name in OPERATOR_WORDS:
        assert name in receipt, f"custody receipt does not mention {name}"


def test_the_independent_grade_is_recorded_with_its_confirmed_defects(registry):
    """Doer != grader. The grade and what it convicted must survive in the artifact,
    not just in a commit message nobody re-reads."""
    g = registry["video_corpus_extension_2026_08_21"]["independent_grade_2026_08_21"]
    assert g["commit_graded"] == "5341bb6e"
    assert g["band"] == 6 and g["verdict"] == "BOUNDED"
    assert len(g["confirmed_defects_the_doer_published"]) >= 4
    assert len(g["false_green_routes_closed_here"]) >= 4
    # The specific numeric corrections must be named, not summarised away.
    blob = " ".join(g["confirmed_defects_the_doer_published"])
    assert "bee2303b" in blob and "77d4a9a9" in blob, "the wrong hash must stay on record"
    assert "4 failed / 4 passed" in blob


def test_registry_is_still_bound_into_the_build_fingerprint(registry):
    """Positive control: the guarded file must actually be load-bearing."""
    from research.current_mnq_strategy_v2_4_policy import fingerprinted_files

    assert REGISTRY in set(fingerprinted_files())
    assert registry["engineering_invariants"][
        "all_authoritative_evidence_files_or_manifests_are_build_fingerprinted"] is True
