from __future__ import annotations

import json

from research import current_mnq_strategy_v2_4_evidence as ev
from research.current_mnq_strategy_v2_4_policy import semantics_hash


def test_gold_manifest_hashes_are_exact_sha256_and_counts_are_separate():
    hashes = ev.gold_manifest_hashes()
    pos, neg = ev.gold_counts()
    assert len(hashes["positive_user_gold_sha256"]) == 64
    assert len(hashes["tempting_no_trade_gold_sha256"]) == 64
    assert pos == 5
    assert neg >= 0


def test_architecture_gold_integrity_requires_exact_current_hashes():
    good = {"semantics_sha256": semantics_hash(), **ev.gold_manifest_hashes()}
    assert ev.architecture_gold_integrity(good)
    bad = dict(good)
    bad["positive_user_gold_sha256"] = "0" * 64
    assert not ev.architecture_gold_integrity(bad)


def test_same_counts_cannot_rescue_wrong_manifest_hash(tmp_path):
    arch = tmp_path / "arch.json"
    sealed = tmp_path / "sealed.json"
    arch.write_text(json.dumps({
        "semantics_sha256": semantics_hash(),
        "tests": 100,
        "failures": 0,
        "positive_user_gold_count": 5,
        "real_user_tempting_no_trade_gold_count": ev.gold_counts()[1],
        "positive_user_gold_sha256": "0" * 64,
        "tempting_no_trade_gold_sha256": ev.gold_manifest_hashes()["tempting_no_trade_gold_sha256"],
    }))
    sealed.write_text(json.dumps({}))
    evidence = ev.build_evidence(
        architecture_receipt=arch, sealed_report=sealed,
        shadow_journal=None, operations_drill_receipt=None,
    )
    assert evidence.real_user_positive_gold == 5
    assert evidence.gold_manifest_integrity_pass is False
