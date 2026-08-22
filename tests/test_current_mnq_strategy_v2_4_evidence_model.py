"""Screenshot evidence model + user-fidelity-gold fingerprint binding — ALGO-004 §4.

Two custody gaps GPT found that ALGO-003 missed:

4A. The registry asserted `all_authoritative_screenshot_examples_must_be_members_of_this_corpus:
    true` while carrying operator-authorized screenshots that are explicitly NOT members of the
    sealed 65-file archive. An evidence-MODEL contradiction, not an evidence problem.

4B. `user_fidelity_gold.json` is marked IMMUTABLE and holds direct trader rules plus hash-bound
    fixtures, yet was absent from `build_contract.contract_files` — so a load-bearing fidelity
    file could change without changing the enumerated build identity.
"""
from __future__ import annotations

import hashlib
import io
import json

import pytest

REGISTRY = "research/current_mnq_strategy_v2_4_unified_fidelity_evidence_registry_2026_08_20.json"
GOLD = "research/current_mnq_strategy_v2_4_user_fidelity_gold.json"


@pytest.fixture(scope="module")
def reg():
    return json.load(io.open(REGISTRY, encoding="utf-8"))


def test_the_three_screenshot_tiers_are_disjoint_and_the_union_is_computed(reg):
    """The membership law: nothing outside the sealed archive may claim to be in it, and any
    total is COMPUTED from the tiers, never asserted."""
    m = reg["screenshot_evidence_model"]
    t = m["tiers"]
    sealed = t["sealed_parent_archive"]
    pre = set(t["hash_bound_examples_pre_parent"]["names"])
    post = set(t["operator_authorized_additions_post_parent"]["names"])

    assert sealed["closed"] is True
    assert len(sealed["archive_sha256"]) == 64
    # The tier block MIRRORS visual_parent_corpus. A red-proof arm that shrank the parent's
    # count passed, because the tier held an independent copy that did not move. Two copies
    # of one fact drift; join them instead of asserting each.
    vp = reg["visual_parent_corpus"]
    assert sealed["screenshot_count"] == vp["screenshot_count"] == 65, (
        "the sealed-archive count in the tier model and in visual_parent_corpus disagree - "
        "one of them was edited alone"
    )
    assert sealed["archive_sha256"] == vp["archive_sha256"]
    assert sealed["archive_name"] == vp["archive_name"]
    assert not (pre & post), f"tiers overlap: {sorted(pre & post)}"
    assert m["tiers_are_disjoint"] is True
    assert m["computed_union_size"] == len(pre | post), "the union must be computed, not asserted"
    assert t["hash_bound_examples_pre_parent"]["count"] == len(pre)
    assert t["operator_authorized_additions_post_parent"]["count"] == len(post)


def test_the_contradicted_closed_world_flag_is_repaired_and_the_repair_is_explained(reg):
    """Repair the semantics, not the evidence — and leave the contradiction on record."""
    vp = reg["visual_parent_corpus"]
    assert vp["all_authoritative_screenshot_examples_must_be_members_of_this_corpus"] is False
    assert "contradiction" in vp["CORRECTION_2026_08_21_ALGO_004"]
    # The sealed archive keeps its identity regardless.
    assert vp["archive_sha256"].startswith("da25a057")
    assert vp["closed_world"] is True


def test_the_registered_additions_still_disclaim_archive_membership(reg):
    s = reg["screenshots_added_2026_08_21"]
    assert "may not be cited" in s["NOT_members_of_the_sealed_65_parent_corpus"]
    assert s["count"] == 13


def test_the_immutable_gold_file_is_build_fingerprinted(reg):
    """4B. Absent from contract_files it could mutate without moving build identity."""
    from research.current_mnq_strategy_v2_4_policy import fingerprinted_files

    assert GOLD in set(fingerprinted_files()), (
        "the immutable user-fidelity gold must be part of the enumerated build identity"
    )
    b = reg["user_fidelity_gold_binding"]
    assert b["file"] == GOLD
    assert b["now_fingerprinted"] is True
    assert b["defect_closed"].strip()


def test_mutating_the_gold_file_changes_build_identity(tmp_path):
    """The mutation proof GPT asked for: it must actually move the fingerprint."""
    from research.current_mnq_strategy_v2_4_policy import semantics_hash

    before = semantics_hash()
    original = io.open(GOLD, "rb").read()
    try:
        io.open(GOLD, "wb").write(original + b"\n")
        after = semantics_hash()
    finally:
        io.open(GOLD, "wb").write(original)
    assert hashlib.sha256(io.open(GOLD, "rb").read()).hexdigest() == \
        hashlib.sha256(original).hexdigest(), "restore failed"
    assert before != after, (
        "mutating the immutable gold file did NOT change the build fingerprint - the binding "
        "is decorative"
    )
    assert semantics_hash() == before, "fingerprint did not return after restore"


def test_the_registry_records_the_gold_hash_it_binds(reg):
    b = reg["user_fidelity_gold_binding"]
    assert b["sha256"] == hashlib.sha256(io.open(GOLD, "rb").read()).hexdigest(), (
        "the recorded gold hash no longer matches the file it names"
    )
    assert "IMMUTABLE" in str(b["declared_status"])
