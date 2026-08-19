from __future__ import annotations

import json

import pytest

from research.current_mnq_strategy_v2_4_policy import (
    fingerprinted_files,
    load_build_contract,
    semantics_hash,
)


def test_production_build_contract_covers_transitive_strategy_edge_data_and_execution_boundaries():
    b = load_build_contract()
    files = set(fingerprinted_files())
    required = {
        "research/current_mnq_strategy_v2_4_build_contract.json",
        "research/current_mnq_strategy_v2_4_premarket_semantics.json",
        "research/current_mnq_strategy_v2_4_entry_semantics.json",
        "research/current_mnq_strategy_v1_fast.py",
        "research/current_mnq_strategy_v2_ab.py",
        "research/current_mnq_strategy_v2_2_engine.py",
        "research/current_mnq_strategy_v2_2_engine_final.py",
        "research/current_mnq_strategy_v2_2_engine_runtime.py",
        "research/current_mnq_strategy_v2_2_gold_lifecycle.py",
        "research/current_mnq_strategy_v2_3_engine.py",
        "research/current_mnq_strategy_v2_3_databento.py",
        "src/engine/indicators/fvg_native.py",
        "research/current_mnq_strategy_v2_4_entries.py",
        "research/current_mnq_strategy_v2_4_force.py",
        "research/current_mnq_strategy_v2_4_zone_lifecycle.py",
        "research/current_mnq_strategy_v2_4_levels.py",
        "research/current_mnq_strategy_v2_4_premarket.py",
        "research/current_mnq_strategy_v2_4_kernel.py",
        "research/current_mnq_strategy_v2_4_targets.py",
        "research/current_mnq_strategy_v2_4_edge.py",
        "research/current_mnq_strategy_v2_4_oos.py",
        "research/current_mnq_strategy_v2_4_policy.py",
        "research/current_mnq_strategy_v2_3_broker.py",
        "research/current_mnq_strategy_v2_2_projectx_broker.py",
        "research/current_mnq_strategy_v2_4_broker.py",
        "research/current_mnq_strategy_v2_4_automation_runtime.py",
    }
    assert required.issubset(files)
    assert len(files) == len(fingerprinted_files())
    assert b["schema_version"] == 8
    assert b["release_id"] == "MNQ-V2.4-BUILD-FINGERPRINT-8-FORCE1"


def test_strategy_fingerprint_is_deterministic_on_unchanged_bytes():
    a = semantics_hash(); b = semantics_hash()
    assert a == b
    assert len(a) == 64


def test_changing_a_fingerprinted_source_changes_hash_even_if_prose_contracts_do_not(tmp_path):
    src = tmp_path / "critical.py"
    src.write_text("EDGE = 1\n")
    build = tmp_path / "build.json"
    build.write_text(json.dumps({
        "contract_files": [],
        "strategy_and_edge_source_files": [str(src)],
        "production_source_files": [],
    }))
    h1 = semantics_hash(build_path=build)
    src.write_text("EDGE = 2\n")
    h2 = semantics_hash(build_path=build)
    assert h1 != h2


def test_missing_declared_critical_file_fails_closed(tmp_path):
    build = tmp_path / "build.json"
    build.write_text(json.dumps({
        "contract_files": [],
        "strategy_and_edge_source_files": [str(tmp_path / "missing.py")],
        "production_source_files": [],
    }))
    with pytest.raises(RuntimeError, match="V24_FINGERPRINT_FILE_MISSING"):
        semantics_hash(build_path=build)
