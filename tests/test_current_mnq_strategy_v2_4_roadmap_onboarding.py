from __future__ import annotations

import json
from pathlib import Path

from research import current_mnq_strategy_v2_4_engine as eng

ROOT = Path(__file__).resolve().parents[1]
ROADMAP = ROOT / "research" / "current_mnq_strategy_v2_4_roadmap.json"
ONBOARDING = ROOT / "research" / "current_mnq_strategy_v2_4_engineer_onboarding.md"
SPEC = ROOT / "research" / "current_mnq_strategy_v2_4_spec.json"
ENTRY = ROOT / "research" / "current_mnq_strategy_v2_4_entry_semantics.json"
GOLD = ROOT / "research" / "current_mnq_strategy_v2_4_user_fidelity_gold.json"


def _j(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_fast_robust_roadmap_is_locked_and_release_aligned():
    r = _j(ROADMAP)
    s = _j(SPEC)
    assert r["status"] == "LOCKED_FAST_ROBUST_CRITICAL_PATH"
    assert r["strategy_release_id"] == s["release_id"] == eng.ENGINE_VERSION
    assert r["current_stage"] == "FIDELITY"
    assert r["critical_path"] == [
        "FIDELITY", "FREEZE", "CLEAN_EDGE", "ROBUSTNESS",
        "EXECUTION", "SHADOW", "PRODUCTION",
    ]


def test_roadmap_preserves_core_strategy_and_antirescue_rules():
    r = _j(ROADMAP)
    inv = r["frozen_strategy_invariants"]
    assert inv["stop_points"] == 17.25
    assert inv["max_trades_per_session"] == 1
    assert inv["only_two_prebreak_exceptions"] == [
        "REPEAT_TEST_MOMENTUM_ATTACK",
        "DISPLACEMENT_SEQUENCE_INTO_LEVEL",
    ]
    assert inv["momentum_is_not_automatic_displacement"] is True
    assert inv["fvg_required_for_displacement_entry"] is False
    assert inv["target_rule"] == "FIRST_MEANINGFUL_PHYSICAL_REACTION_WINS"
    assert inv["live_force_uses_causal_completed_1m_subbars"] is True
    assert inv["future_next_candle_forbidden"] is True

    non_goals = set(r["hard_non_goals_until_v24_is_decided"])
    required = {
        "new indicators",
        "new strategy families",
        "parameter optimization from observed performance",
        "machine-learning optimization",
        "quantum optimization",
        "widening the 17.25-point stop to rescue performance",
        "moving TP farther because historical PnL looks better",
        "using future candles or final parent OHLC to backdate an entry",
        "substituting NQ or synthetic pre-launch MNQ for required clean MNQ evidence",
    }
    assert required.issubset(non_goals)


def test_roadmap_clean_contract_matches_frozen_evidence_chronology():
    r = _j(ROADMAP)
    clean = r["stage_contracts"]["CLEAN_EDGE"]["dataset"]
    assert clean["instrument"] == "MNQ"
    assert clean["range"] == "2019-05-06..2021-12-31"
    assert clean["dataset_sha256"] == "45c792819f1f4680a7d50051abda85a3c2e4ca617c749940a2aa4b7c88b6c4af"
    assert clean["scoreable_sessions"] == 547
    assert r["evidence_chronology"]["prior_clean_attempt_status"] == (
        "ABORTED_PRE_RESULT_ARRAY_MEMORY_ERROR_NO_LEDGER_OR_EDGE_RESULT_OBSERVED"
    )


def test_onboarding_is_zero_chat_history_complete_on_critical_contracts():
    text = ONBOARDING.read_text(encoding="utf-8")
    required_literals = [
        "research/current_mnq_strategy_v2_4_roadmap.json",
        "research/current_mnq_strategy_v2_4_spec.json",
        "research/current_mnq_strategy_v2_4_entry_semantics.json",
        "research/current_mnq_strategy_v2_4_user_fidelity_gold.json",
        "research/current_mnq_strategy_v2_4_targets.py",
        "research/current_mnq_strategy_v2_4_force.py",
        "research/current_mnq_strategy_v2_4_kernel.py",
        "MNQ-V2.4-ZONE-CANDLE-PC3-FORCE1",
        "17.25",
        "REPEAT_TEST_MOMENTUM_ATTACK",
        "DISPLACEMENT_SEQUENCE_INTO_LEVEL",
        "FIRST_MEANINGFUL_PHYSICAL_REACTION",
        "completed 1-minute sub-bars only",
        "ABORTED_PRE_RESULT_ARRAY_MEMORY_ERROR_NO_LEDGER_OR_EDGE_RESULT_OBSERVED",
        "FIDELITY → FREEZE → CLEAN_EDGE → ROBUSTNESS → EXECUTION → SHADOW → PRODUCTION",
        "DRAFT / DO NOT MERGE",
        "Do not ask the trader to reteach rules",
    ]
    for literal in required_literals:
        assert literal in text, literal


def test_onboarding_and_machine_contract_agree_on_prebreak_exclusivity_and_force():
    text = ONBOARDING.read_text(encoding="utf-8")
    entry = _j(ENTRY)
    gold = _j(GOLD)
    assert entry["pre_break_early_entry_exceptions"]["exclusive"] is True
    assert len(entry["pre_break_early_entry_exceptions"]["families"]) == 2
    assert entry["live_force_equation"]["future_next_candle_forbidden"] is True
    assert entry["live_force_equation"]["tick_order_inference_forbidden"] is True
    assert "There are exactly two" in text
    assert "use the next candle" in text
    assert "invent tick order" in text
    assert any(
        x["id"] == "V24G08_LIVE_MOMENTUM_FORCE_BEFORE_CANDLE_CLOSE"
        for x in gold["fixtures"]
    )


def test_roadmap_governance_keeps_pr_unmerged_during_research():
    r = _j(ROADMAP)
    g = r["repository_governance"]
    assert g["repo"] == "swayz032/trading-forge"
    assert g["branch"] == "research/current-mnq-strategy-v2-4-zone-first-candles"
    assert g["pull_request"] == 38
    assert g["pull_request_must_remain_draft_during_research"] is True
    assert g["do_not_merge_until_explicitly_authorized_after_gates"] is True
