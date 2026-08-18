from __future__ import annotations

from datetime import date

from research import current_mnq_strategy_v2_4_oos as oos
from research.current_mnq_strategy_v2_4_edge import load_edge_spec
from research.current_mnq_strategy_v2_4_policy import load_spec, semantics_hash


def test_v24_spec_requires_fresh_sealed_validation():
    p = load_spec(); edge = load_edge_spec()
    assert p["anti_overfit"]["v2_3_sealed_result_not_valid_as_final_evidence_for_v2_4"] is True
    assert p["anti_overfit"]["no_parameter_search_on_sealed_validation"] is True
    assert p["anti_overfit"]["no_variant_promotion_from_sealed_validation"] is True
    assert edge["anti_overfit"]["no_threshold_rescue_after_result"] is True
    assert len(semantics_hash()) == 64


def test_seen_2022_through_freeze_date_is_mechanically_removed_from_clean_oos():
    spec = load_spec(); edge = load_edge_spec()
    days = [
        date(2021, 12, 31),
        date(2022, 1, 3),
        date(2026, 1, 19),
        date(2026, 1, 20),
        date(2026, 8, 17),
        date(2026, 8, 18),
    ]
    eligible, audit = oos.apply_contaminated_score_exclusions(days, spec, edge)
    assert eligible == [date(2021, 12, 31), date(2026, 8, 18)]
    assert audit["excluded_sessions"] == 4
    assert any(r["start"] == "2022-01-01" for r in audit["declared_ranges"])


def test_eligible_years_are_measured_from_clean_days_not_whole_manifest():
    days = [date(2019, 6, 1), date(2021, 12, 31)]
    years = oos._eligible_calendar_years(days)
    assert 2.5 < years < 2.7


def test_sealed_runner_is_bound_to_v24_engine_not_v23():
    assert oos.e.ENGINE_VERSION.startswith("MNQ-V2.4")
    assert oos.e.semantics_hash() == semantics_hash()
