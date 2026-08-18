from __future__ import annotations

from datetime import date

from research import current_mnq_strategy_v2_4_oos as oos
from research.current_mnq_strategy_v2_4_policy import load_spec, semantics_hash


def test_v24_spec_requires_fresh_sealed_validation():
    p = load_spec()
    assert p["anti_overfit"]["v2_3_sealed_result_not_valid_as_final_evidence_for_v2_4"] is True
    assert p["anti_overfit"]["no_parameter_search_on_sealed_validation"] is True
    assert p["anti_overfit"]["no_variant_promotion_from_sealed_validation"] is True
    assert len(semantics_hash()) == 64


def test_contaminated_jan_apr_2026_sessions_are_mechanically_removed():
    spec = load_spec()
    days = [date(2026, 1, 19), date(2026, 1, 20), date(2026, 3, 1), date(2026, 4, 15), date(2026, 4, 16)]
    eligible, audit = oos.apply_contaminated_score_exclusions(days, spec)
    assert eligible == [date(2026, 1, 19), date(2026, 4, 16)]
    assert audit["excluded_sessions"] == 3


def test_sealed_runner_is_bound_to_v24_engine_not_v23():
    assert oos.e.ENGINE_VERSION.startswith("MNQ-V2.4")
    assert oos.e.semantics_hash() == semantics_hash()
