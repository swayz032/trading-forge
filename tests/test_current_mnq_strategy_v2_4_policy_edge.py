from __future__ import annotations

from dataclasses import replace

from research.current_mnq_strategy_v2_4_policy import Evidence, load_spec, sealed_validation_gate, semantics_hash


def green_evidence(**changes):
    spec = load_spec()
    base = Evidence(
        semantics_sha256=semantics_hash(),
        architecture_tests_passed=100,
        architecture_tests_failed=0,
        real_user_positive_gold=5,
        semantic_negative_fixtures=len(spec["negative_semantic_fixtures"]),
        real_user_tempting_no_trade_gold=1,
        gold_manifest_integrity_pass=True,
        contract_provenance_pass=True,
        data_quality_pass=True,
        sealed_calendar_years=3.5,
        sealed_sessions=700,
        sealed_trades=150,
        chronological_folds=4,
        positive_folds=4,
        block_bootstrap_mean_lower_95=25.0,
        slippage_stress_net={"0.5": 10000.0, "1": 8000.0, "2": 5000.0},
        robust_edge_expectancy=20.0,
        detailed_expectancy=40.0,
        leave_best_month_out_expectancy=35.0,
        break_even_margin=0.10,
        data_clean_oos=True,
        sealed_rules_changed_after_run=False,
    )
    return replace(base, **changes)


def test_green_edge_evidence_passes_research_gate():
    result = sealed_validation_gate(green_evidence())
    assert result.approved
    assert result.stage == "RESEARCH_VERIFIED"


def test_same_gold_count_with_unproven_manifest_identity_cannot_pass():
    result = sealed_validation_gate(green_evidence(gold_manifest_integrity_pass=False))
    assert not result.approved
    assert "GOLD_MANIFEST_INTEGRITY_NOT_PROVEN" in result.reasons


def test_seen_data_cannot_pass_even_if_every_performance_number_is_good():
    result = sealed_validation_gate(green_evidence(data_clean_oos=False))
    assert not result.approved
    assert "EDGE_DATA_NOT_CLEAN_OOS" in result.reasons


def test_monster_day_dependence_is_hard_blocker():
    result = sealed_validation_gate(green_evidence(detailed_expectancy=-1.0, robust_edge_expectancy=-1.0))
    assert not result.approved
    assert "EDGE_TOP5_WINNER_REMOVAL_NOT_POSITIVE" in result.reasons
    assert "ROBUST_EDGE_EXPECTANCY_NOT_POSITIVE" in result.reasons


def test_one_month_dependence_is_hard_blocker():
    result = sealed_validation_gate(green_evidence(leave_best_month_out_expectancy=-0.01, robust_edge_expectancy=-0.01))
    assert not result.approved
    assert "EDGE_LEAVE_BEST_MONTH_OUT_NOT_POSITIVE" in result.reasons


def test_negative_break_even_margin_is_hard_blocker():
    result = sealed_validation_gate(green_evidence(break_even_margin=-0.001))
    assert not result.approved
    assert "EDGE_BREAK_EVEN_MARGIN_NOT_POSITIVE" in result.reasons
