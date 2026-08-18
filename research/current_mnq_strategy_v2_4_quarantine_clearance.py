#!/usr/bin/env python3
"""Read-only clearance for the frozen v2.4 Databento quarantine.

No strategy P&L is executed. This script proves that every current Databento
non-available dataset-condition event in the clean historical scope is declared
in the pre-PnL edge contract and that no scoreable session remains inside any
source-date + causal-lookback quarantine window.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_4_clean_dataset_preflight as preflight
from research import current_mnq_strategy_v2_4_engine as engine
from research.current_mnq_strategy_v2_4_data_quality import (
    apply_vendor_data_quality_quarantine,
    declared_vendor_condition_events,
)
from research.current_mnq_strategy_v2_4_edge import load_edge_spec


def main() -> None:
    print("MNQ v2.4 VENDOR QUARANTINE CLEARANCE — READ ONLY")
    print("strategy P&L executed: NO")
    result = {
        "strategy_pnl_executed": False,
        "sealed_runner_executed": False,
        "checks": {},
    }
    try:
        root = Path(preflight.DATASET_ROOT)
        raw5, raw1, manifest = engine.load_production_dataset(root)
        env = engine.prepare(raw5, raw1, manifest)
        edge_spec = load_edge_spec()

        # This list already excludes the frozen contaminated_score_ranges from
        # the v2.4 strategy contract, including the vendor quarantine windows.
        score_days = preflight._clean_scoreable_days(env)
        result["clean_scoreable_sessions_after_contract_exclusions"] = len(score_days)
        minimum = int(edge_spec["gates"]["minimum_score_sessions"])
        result["minimum_score_sessions_gate"] = minimum
        result["score_session_gate"] = "PASS" if len(score_days) >= minimum else "REFUSE"

        condition = preflight._databento_condition_audit(raw1, score_days)
        result["checks"]["databento_condition"] = condition

        declared = declared_vendor_condition_events(edge_spec)
        declared_keys = {(x["date"], x["condition"]) for x in declared}
        observed = condition.get("non_available_conditions", [])
        observed_keys = {
            (str(pd.Timestamp(x["date"]).date()), str(x["condition"]))
            for x in observed
        }
        unexpected = sorted(observed_keys - declared_keys)
        declared_but_not_observed = sorted(declared_keys - observed_keys)
        result["checks"]["condition_contract"] = {
            "status": "PASS" if not unexpected else "REFUSE",
            "declared": sorted(declared_keys),
            "observed": sorted(observed_keys),
            "unexpected_non_available_conditions": unexpected,
            "declared_but_not_currently_observed": declared_but_not_observed,
        }

        # Independent safety assertion: even if spec range wiring changed, the
        # dedicated quarantine module must remove zero additional score days now.
        post, qa = apply_vendor_data_quality_quarantine(score_days, edge_spec)
        leaked = sorted(set(score_days) - set(post))
        result["checks"]["causal_quarantine"] = qa | {
            "status": "PASS" if not leaked else "REFUSE",
            "leaked_score_sessions": [str(x) for x in leaked],
        }
        result["scoreable_sessions_after_independent_quarantine"] = len(post)

        degraded_scoreable = condition.get("degraded_scoreable_dates", [])
        all_good = (
            len(score_days) >= minimum
            and not unexpected
            and not degraded_scoreable
            and not leaked
        )
        result["status"] = "PASS_READY_FOR_ARCHITECTURE_REFRESH" if all_good else "REFUSE_QUARANTINE_CLEARANCE"
    except Exception as exc:
        result["status"] = "REFUSE_CLEARANCE_EXCEPTION"
        result["error"] = f"{type(exc).__name__}:{exc}"

    print("\n" + json.dumps(result, indent=2, sort_keys=True, default=str, allow_nan=False))
    print("\nCLEARANCE COMPLETE. Strategy P&L executed: NO")
    if result.get("status") == "PASS_READY_FOR_ARCHITECTURE_REFRESH":
        print("NEXT: refresh current-head architecture/gold evidence; do not run sealed P&L yet.")
    else:
        print("STOP: do not run sealed v2.4 P&L.")


if __name__ == "__main__":
    main()
