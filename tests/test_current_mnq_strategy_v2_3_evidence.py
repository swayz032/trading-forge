from __future__ import annotations

from datetime import date

import pandas as pd

from research.current_mnq_strategy_v2_3_evidence import build_evidence, gold_counts
from research.current_mnq_strategy_v2_3_oos import (
    apply_contaminated_score_exclusions,
    audit_scoreable_contract_provenance,
)
from research.current_mnq_strategy_v2_3_policy import research_gate, semantics_hash


def test_gold_counts_are_read_from_real_manifests_not_constants():
    assert gold_counts() == (5, 0)


def test_missing_receipts_and_shadow_fail_closed_in_derived_evidence():
    ev = build_evidence(
        architecture_receipt=None,
        sealed_report=None,
        shadow_journal=None,
        operations_drill_receipt=None,
    )
    assert ev.semantics_sha256 == semantics_hash()
    assert ev.real_user_positive_gold == 5
    assert ev.real_user_tempting_no_trade_gold == 0
    assert ev.architecture_tests_passed == 0
    assert ev.architecture_tests_failed == 1
    assert not research_gate(ev).approved


def test_previously_inspected_2026_window_is_mechanically_excluded_from_oos_scores():
    days = [
        date(2026, 1, 19),
        date(2026, 1, 20),
        date(2026, 3, 16),
        date(2026, 4, 15),
        date(2026, 4, 16),
    ]
    eligible, audit = apply_contaminated_score_exclusions(days)
    assert eligible == [date(2026, 1, 19), date(2026, 4, 16)]
    assert audit["excluded_sessions"] == 3
    assert {x["session"] for x in audit["excluded"]} == {
        "2026-01-20", "2026-03-16", "2026-04-15"
    }


def _rth_day(day: str, contract: str) -> pd.DataFrame:
    idx = pd.date_range(f"{day} 13:30:00+00:00", periods=390, freq="1min")
    return pd.DataFrame({"contract_id": contract}, index=idx.tz_convert("America/New_York"))


def test_contract_provenance_checks_no_trade_sessions_too():
    d1 = date(2026, 3, 13)  # H26 under frozen roll policy
    d2 = date(2026, 3, 16)  # M26 after Monday roll
    raw = pd.concat([
        _rth_day("2026-03-13", "CON.F.US.MNQ.H26"),
        _rth_day("2026-03-16", "CON.F.US.MNQ.M26"),
    ])
    manifest = {"contract_sessions": {
        str(d1): "CON.F.US.MNQ.H26",
        str(d2): "CON.F.US.MNQ.M26",
    }}
    report = audit_scoreable_contract_provenance(raw, manifest, [d1, d2])
    assert report["status"] == "PASS"

    # Corrupt the second/no-trade session. It must fail even if no ledger trade
    # would have existed on that day.
    bad = raw.copy()
    bad.loc[bad.index.date == d2, "contract_id"] = "CON.F.US.MNQ.H26"
    report2 = audit_scoreable_contract_provenance(bad, manifest, [d1, d2])
    assert report2["status"] == "REFUSE"
    assert any("BAR_CONTRACT:2026-03-16" in x for x in report2["issues"])
