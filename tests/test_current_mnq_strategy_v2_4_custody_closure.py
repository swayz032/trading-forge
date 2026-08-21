"""Custody closure regression — ALGO-002 §3.

Proves the evidence identities the registry records are the identities on disk, so a future
14-case scorecard consumes an oracle whose provenance is reproducible.
"""
from __future__ import annotations

import hashlib
import io
import json
import os

import pytest

REGISTRY = "research/current_mnq_strategy_v2_4_unified_fidelity_evidence_registry_2026_08_20.json"
LEDGER_RECEIPT = "research/current_mnq_strategy_v2_4_trade_ledger_reconciliation_2026_08_21.json"
MANIFEST = "research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json"


@pytest.fixture(scope="module")
def reg():
    return json.load(io.open(REGISTRY, encoding="utf-8"))


def test_the_sealed_label_identity_is_preserved_and_honestly_scoped(reg):
    """GPT: preserve the sealed value, do not silently overwrite history.

    And the correction this packet found: 11d8dec0 was NOT a dead sandbox hash. It is a
    self-declared field inside the surviving file. It is also not independently reproducible,
    and saying so is the point."""
    t = reg["frozen_replay_evidence"]["trader_labels_identity"]
    assert reg["frozen_replay_evidence"]["trader_labels_sha256"].startswith("11d8dec0"), (
        "the historical sealed value must remain on record"
    )
    assert t["sealed_value_preserved"] == reg["frozen_replay_evidence"]["trader_labels_sha256"]
    bridge = t["sealed_value_is_NOT_a_dead_sandbox_hash"]
    assert "WRONG" in bridge and "Nothing died" in bridge, (
        "the correction must state plainly that the dead-sandbox framing was wrong"
    )
    assert "NINE serialisations" in t["but_it_is_not_independently_reproducible"]
    assert "SELF-ATTESTED" in t["but_it_is_not_independently_reproducible"]


def test_the_label_oracle_joins_the_frozen_manifest_and_matches_the_census(reg):
    """The oracle a future scorecard consumes must be the oracle the manifest names."""
    v = reg["frozen_replay_evidence"]["trader_labels_identity"]["what_IS_independently_verifiable"]
    assert v["case_ids_join_the_frozen_manifest"] is True
    assert v["case_count"] == 14
    assert v["action_census"] == {"ENTER_SHORT": 3, "ENTER_LONG": 4, "WAIT": 6, "NO_TRADE": 1}
    assert v["wait_at_replay_end_count_declared"] == 6
    assert reg["frozen_replay_evidence"]["trader_labels_identity"]["census_matches_contract"] is True
    # And the manifest itself must still hold 14 cases, or the join above is vacuous.
    m = json.load(io.open(MANIFEST, encoding="utf-8"))
    assert len(m["cases"]) == 14


def test_the_label_file_on_disk_still_hashes_to_the_recorded_bytes(reg):
    """The one hash that IS reproducible must actually reproduce."""
    v = reg["frozen_replay_evidence"]["trader_labels_identity"]["what_IS_independently_verifiable"]
    path = v["custody_path"]
    if not os.path.exists(path):
        pytest.skip("operator's label file not present on this machine")
    got = hashlib.sha256(io.open(path, "rb").read()).hexdigest()
    assert got == v["file_byte_sha256"], (
        f"the label file changed: recorded {v['file_byte_sha256'][:16]}, on disk {got[:16]}"
    )


def test_the_thirteen_screenshots_are_split_by_what_they_actually_are(reg):
    """CORRECTED. All thirteen were first registered under ONE 1m-vs-5m role. Eight of them
    are pages of the trade LEDGER - a different kind of evidence, and the very eight I had
    reported missing in the same commit. Corpus-level roles are right; one role for a MIXED
    set is not."""
    s = reg["screenshots_added_2026_08_21"]
    assert s["count"] == 13 == len(s["files"])
    assert s["role_provenance"] == "OPERATOR_STATED"
    assert "WRONG" in s["CORRECTION_2026_08_21"]
    led, tf = s["ledger_pages"], s["timeframe_comparison_pages"]
    assert led["count"] == 8 and tf["count"] == 5
    assert led["count"] + tf["count"] == s["count"]
    assert led["status"] == "DIAGNOSTIC_ONLY_NEVER_A_RULE_SELECTOR"
    assert led["role"] == "trade_ledger_page_evidence"
    assert "1m_vs_5m_same_move_appearance" in tf["roles"]
    # The two sets must be disjoint and together exhaust the thirteen.
    ln = {x["name"] for x in led["files"]}
    tn = {x["name"] for x in tf["files"]}
    assert not (ln & tn) and len(ln | tn) == 13
    assert "do not invent unique semantics" in s["roles_are_CORPUS_LEVEL_not_per_file"]
    assert "may not be cited" in s["NOT_members_of_the_sealed_65_parent_corpus"], (
        "the screenshots must be barred from claiming membership of the sealed 65-file corpus"
    )
    names, shas = set(), set()
    for f in s["files"]:
        assert f["name"].startswith("Screenshot 2026-08-21 ")
        assert len(f["sha256"]) == 64 and f["bytes"] > 0
        names.add(f["name"]); shas.add(f["sha256"])
    assert len(names) == len(shas) == 13, "duplicate screenshot name or hash"
    assert "silent-empty" in s["enumeration_control"], (
        "the zero-result enumeration bug stays on record - it would have registered an empty "
        "list under a count of 13"
    )


def test_the_ledger_receipt_is_diagnostic_only_and_names_what_did_not_survive(reg):
    """GPT: the ledger may never select a rule. And the relayed claims it killed must stay killed."""
    r = json.load(io.open(LEDGER_RECEIPT, encoding="utf-8"))
    assert r["status"] == "DIAGNOSTIC_ONLY"
    assert "may NEVER select" in r["prohibition"]
    assert r["census"]["row_count"] == 74
    assert r["census"]["side_counts"] == {"buy": 28, "sell": 46}
    assert r["money_model"]["solved_not_assumed"] is True
    assert r["money_model"]["rows_reconciling"] == 69
    st = r["stop_analysis"]
    assert st["rows_carrying_an_initialSL_field"] == 0
    # The correction that matters: an empty COLUMN is not an absent FACT.
    assert "WRONG" in st["CORRECTION_2026_08_21"]
    assert st["stop_outs_derived_from_rPnL_and_distance"] == 4
    assert st["every_one_at_exactly_17_25_points"] is True
    assert st["every_one_at_15_contracts"] is True
    assert "RETRACTED" in r["relayed_claims_tested"]["7_exact_17_25_stops"]["verdict"]
    assert "SUBSTANCE CONFIRMED" in r["relayed_claims_tested"]["7_exact_17_25_stops"]["verdict"]
    assert r["relayed_claims_tested"]["62_target_side_exits"]["measured"] == 61
    assert reg["trade_ledger_receipt"]["status"] == "DIAGNOSTIC_ONLY_NEVER_A_RULE_SELECTOR"


def test_the_eight_ledger_screenshots_reconcile_to_the_csv():
    """GPT ALGO-002 §3.3 asked for this reconciliation. It was reported NOT_RECONCILED in the
    same commit that had already registered the screenshots under the wrong role."""
    r = json.load(io.open(LEDGER_RECEIPT, encoding="utf-8"))
    e = r["eight_ledger_screenshots"]
    assert e["status"] == "RECONCILED"
    assert e["count"] == 8 == len(e["files"])
    assert "SAME ledger" in e["join_to_the_csv"]["verdict"]
    assert len(e["join_to_the_csv"]["spot_checks"]) >= 3
    # The screenshots independently corroborate the dollars-per-point reading of `amount`.
    z = e["size_column_reconciles_the_amount_column"]
    assert z["their_amount_values"] == {"30": 30}
    assert "15 contracts" in z["screenshots_show"]
    assert "N/A" in e["initial_SL_is_N_A_on_the_screenshots_too"]


def test_the_ledger_receipt_is_build_fingerprinted():
    """An authoritative receipt outside the fingerprint is the gap this estate already found once."""
    from research.current_mnq_strategy_v2_4_policy import fingerprinted_files

    assert LEDGER_RECEIPT in set(fingerprinted_files())


def test_custody_closure_did_not_reopen_manual_collection(reg):
    """The hard prohibition that survives every packet."""
    assert reg["frozen_replay_evidence"]["manual_collection_closed"] is True
    assert reg["frozen_replay_evidence"]["new_manual_replay_or_labeling_required"] is False
    assert reg["frozen_replay_evidence"]["trader_labels_identity"]["no_new_trader_labeling"] is True
    assert reg["engineering_invariants"]["new_manual_replay_work"] is False
