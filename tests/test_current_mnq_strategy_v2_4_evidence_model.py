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


MANIFEST = "research/current_mnq_strategy_v2_4_visual_evidence_manifest_2026_08_20.json"


def _sets(reg):
    """DERIVE the three sets from the artifacts that own them. Never from stored counts.

    My rejected model stored its own tier lists and counts, so the test proved only that its
    own copies agreed with each other. It never joined the hash-bound names to the sealed
    manifest, and therefore missed that NINE of the twelve are already parent members."""
    man = json.load(io.open(MANIFEST, encoding="utf-8"))
    parent = set(man["screenshot_corpus"]["filenames"])
    hash_bound = {s["name"] for s in reg["hash_bound_screenshot_examples"]}
    post = {f["name"] for f in reg["screenshots_added_2026_08_21"]["files"]}
    return parent, hash_bound, post


def test_screenshot_membership_is_derived_from_the_sealed_manifest(reg):
    """ALGO-006 §4. The census, joined to the artifact that owns each fact."""
    parent, hash_bound, post = _sets(reg)
    m = reg["screenshot_evidence_model"]

    assert len(parent) == 65, f"sealed parent manifest holds {len(parent)}, expected 65"
    assert len(hash_bound) == 12
    assert len(post) == 13

    inside, outside = hash_bound & parent, hash_bound - parent
    assert len(inside) == 9, (
        f"{len(inside)} hash-bound examples are parent members; the rejected model treated "
        f"all twelve as a disjoint tier"
    )
    assert len(outside) == 3
    assert outside == {
        "Screenshot 2026-08-10 114924.png",
        "Screenshot 2026-08-10 164520.png",
        "Screenshot 2026-08-11 023933.png",
    }

    # POST must be genuinely outside both.
    assert not (post & parent), "a 2026-08-21 addition claims sealed-archive membership"
    assert not (post & hash_bound)

    # The union is COMPUTED, and the stored figure must equal it.
    union = parent | hash_bound | post
    assert len(union) == 81, f"authoritative surface is {len(union)}, expected 81"
    p = m["authority_partitions_genuinely_disjoint"]
    assert p["unique_total"] == len(union), "stored total drifted from the computed union"
    assert p["sealed_parent_members"] == len(parent)
    assert p["separately_hash_bound_outside_parent"] == len(outside)
    assert p["post_parent_operator_authorized_additions"] == len(post)
    # The three genuine partitions must actually partition the union.
    assert len(parent) + len(outside) + len(post) == len(union)

    # And the recorded cross-link/outside name lists must match what we just derived.
    assert set(m["hash_bound_cross_links_inside_parent"]["names"]) == inside
    assert set(m["hash_bound_outside_parent"]["names"]) == outside


def test_the_rejected_25_file_model_stays_on_record(reg):
    """A rejected model that is quietly deleted teaches nobody."""
    m = reg["screenshot_evidence_model"]
    r = m["REJECTED_PRIOR_MODEL"]
    assert "25" in r and "FALSE" in r
    assert "NEVER JOINED" in r
    assert "81" in r


def test_hash_disjointness_is_not_claimed_where_it_cannot_be_measured(reg):
    """The sealed manifest carries no per-file hashes, so a hash-level disjointness claim
    against it is unmeasurable. My prior model self-attested exactly that."""
    m = reg["screenshot_evidence_model"]
    assert "hash_disjointness_NOT_claimed" in m
    claim = m["hash_disjointness_NOT_claimed"]
    # Assert the PROPERTY, not one phrasing of it - an earlier version of this test pinned a
    # literal that a more precise rewrite legitimately removed.
    assert "REMOVED, not restated" in claim
    assert "BY NAME only" in claim
    assert "never become `true` metadata" in claim
    assert "tiers_are_disjoint" not in m, (
        "the self-attested disjointness flag must be removed, not restated"
    )
    # PRECISE, because my first assertion here was too broad and went red: the manifest DOES
    # carry per-file hashes - for three of the sixty-five. The other 62 are bound only by the
    # archive hash, so a hash comparison across the parent remains unmeasurable.
    man = json.load(io.open(MANIFEST, encoding="utf-8"))
    corpus = man["screenshot_corpus"]
    hashed = [x for x in corpus["directly_verified_pair"] if "sha256" in x]
    assert len(hashed) == m["parent_files_with_per_file_hashes"] == 3, (
        "the number of parent members carrying a per-file hash changed - re-derive what is "
        "measurable before claiming any hash relationship"
    )
    assert len(hashed) < len(corpus["filenames"]), (
        "if every parent member gains a hash, a real hash-disjointness claim becomes "
        "measurable and this exemption must be revisited"
    )
    assert "3 of the 65" in m["hash_disjointness_NOT_claimed"]


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
