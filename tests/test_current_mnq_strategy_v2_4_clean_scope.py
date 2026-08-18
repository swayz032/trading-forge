from __future__ import annotations

from datetime import date

import pytest

from research import current_mnq_strategy_v2_4_oos as oos
from research import current_mnq_strategy_v2_4_policy as policy
from research import current_mnq_strategy_v2_3_databento as dbhist


def edge_spec():
    return policy.load_edge_spec()


def test_clean_scope_requires_dataset_from_mnq_launch_through_end_2021():
    spec = edge_spec()
    good = {"requested_start": "2019-05-06", "requested_end": "2021-12-31"}
    assert oos.audit_clean_historical_scope(good, spec)["status"] == "PASS"

    late = {"requested_start": "2020-01-01", "requested_end": "2021-12-31"}
    r = oos.audit_clean_historical_scope(late, spec)
    assert r["status"] == "REFUSE"
    assert any(x.startswith("DATASET_START_TOO_LATE") for x in r["issues"])

    short = {"requested_start": "2019-05-06", "requested_end": "2021-06-30"}
    r = oos.audit_clean_historical_scope(short, spec)
    assert r["status"] == "REFUSE"
    assert any(x.startswith("DATASET_END_TOO_EARLY") for x in r["issues"])


def test_scope_restriction_cannot_mix_seen_2022_plus_or_future_days_into_historical_seal():
    spec = edge_spec()
    days = [
        date(2019, 5, 6), date(2020, 6, 1), date(2021, 12, 31),
        date(2022, 1, 3), date(2026, 8, 18),
    ]
    assert oos.restrict_to_clean_historical_scope(days, spec) == [
        date(2019, 5, 6), date(2020, 6, 1), date(2021, 12, 31),
    ]


def test_databento_collector_refuses_synthetic_prelaunch_mnq(tmp_path):
    with pytest.raises(ValueError, match="did not exist before 2019-05-06"):
        dbhist.collect_databento(date(2019, 5, 1), date(2019, 6, 1), tmp_path)


def test_edge_equation_2_records_impossible_legacy_calendar_gate_reason_before_clean_pnl():
    spec = edge_spec()
    assert spec["release_id"] == "MNQ-V2.4-EDGE-EQUATION-2-DQ1"
    assert spec["clean_historical_scope"]["instrument_launch_date"] == "2019-05-06"
    assert spec["clean_historical_scope"]["require_full_available_pre_contamination_history"] is True
    assert spec["anti_overfit"]["gate_change_reason_must_predate_clean_result"] is True


def test_policy_uses_complete_clean_scope_and_actual_sessions_not_legacy_calendar_year_gate(monkeypatch):
    monkeypatch.setattr(policy, "semantics_hash", lambda: "x")
    monkeypatch.setattr(policy, "load_edge_spec", lambda: {
        "gates": {"minimum_score_sessions": 500, "minimum_trades": 100}
    })
    spec = {
        "evidence_policy": {
            "real_user_positive_gold_min": 0,
            "semantic_negative_fixture_min": 0,
            "real_user_tempting_no_trade_gold_min": 0,
            "sealed_validation_min_calendar_years": 3,
            "sealed_validation_min_sessions": 500,
            "sealed_validation_min_trades": 100,
            "chronological_folds": 4,
            "min_positive_folds": 3,
            "slippage_stress_points": [0.5],
        }
    }
    ev = policy.Evidence(
        semantics_sha256="x", architecture_tests_passed=1,
        gold_manifest_integrity_pass=True, contract_provenance_pass=True,
        data_quality_pass=True, clean_historical_scope_pass=True,
        sealed_calendar_years=2.4, sealed_sessions=500, sealed_trades=100,
        chronological_folds=4, positive_folds=3,
        block_bootstrap_mean_lower_95=1.0, slippage_stress_net={"0.5": 1.0},
        robust_edge_expectancy=1.0, detailed_expectancy=1.0,
        leave_best_month_out_expectancy=1.0, break_even_margin=.1,
        data_clean_oos=True, sealed_rules_changed_after_run=False,
    )
    result = policy.sealed_validation_gate(ev, spec)
    assert "INSUFFICIENT_SEALED_YEARS" not in result.reasons
    assert "CLEAN_HISTORICAL_SCOPE_INCOMPLETE" not in result.reasons
