#!/usr/bin/env python3
"""Development-only translation diagnostic for MNQ v2.4.

This intentionally uses the already-contaminated public Jan-Apr 2026 M26 sample.
It may diagnose semantic/mechanical effects but may NEVER promote or tune v2.4.
The same weakest-link edge equation is computed with data_clean=False so a
 good-looking number can never be mistaken for a clean OOS certificate.

FORCE1 adds a purely mechanical timing audit: every ledger row claiming an
intra-candle force trigger must have been confirmed strictly before its parent
5m/15m candle closed. This audit is not a performance threshold.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_3_oos import (
    chronological_folds, moving_block_bootstrap_mean, slippage_stress,
)
from research.current_mnq_strategy_v2_4_edge import build_edge_certificate
from research.current_mnq_strategy_v2_4_policy import load_spec, semantics_hash

ROOT = Path("research/_mnq_v24_dev_diagnostic")
DATA = ROOT / "data"
OUT = ROOT / "results"
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")


def _force_timing_audit(ledger: pd.DataFrame) -> dict:
    if ledger.empty:
        return {
            "status": "PASS_NO_FORCE_TRADES",
            "force_trades": 0,
            "before_parent_close": 0,
            "violations": [],
            "minutes_into_parent": [],
        }
    rows = []
    for _, r in ledger.iterrows():
        reason = str(r.get("candidate_reason", ""))
        if "INTRA5_FORCE" not in reason and "INTRA_FORCE" not in reason:
            continue
        confirmed = pd.Timestamp(r["confirmed_time"])
        if confirmed.tzinfo is None:
            raise RuntimeError("DEV_FORCE_CONFIRMED_TIME_NAIVE")
        if "15M_BAR3_INTRA_FORCE" in reason:
            parent_minutes = 15
            parent_start = confirmed.floor("15min")
        else:
            parent_minutes = 5
            parent_start = pd.Timestamp(r["signal_time"])
        parent_close = parent_start + pd.Timedelta(minutes=parent_minutes)
        before = bool(confirmed < parent_close)
        rows.append({
            "session": str(r.get("session")),
            "setup": str(r.get("setup")),
            "reason": reason,
            "parent_minutes": parent_minutes,
            "parent_start": str(parent_start),
            "confirmed_time": str(confirmed),
            "parent_close": str(parent_close),
            "minutes_into_parent": float((confirmed - parent_start).total_seconds() / 60.0),
            "strictly_before_parent_close": before,
        })
    violations = [x for x in rows if not x["strictly_before_parent_close"]]
    result = {
        "status": "PASS" if not violations else "FAIL",
        "force_trades": len(rows),
        "before_parent_close": sum(1 for x in rows if x["strictly_before_parent_close"]),
        "violations": violations,
        "minutes_into_parent": [x["minutes_into_parent"] for x in rows],
        "examples": rows[:20],
    }
    if violations:
        raise RuntimeError("DEV_FORCE_TIMING_BACKDATE_OR_LATE:" + json.dumps(violations[:5]))
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    observed = old.download_pinned(DATA, include_tick=False)
    lock = json.loads(LOCK.read_text())
    old.verify_manifest(observed, lock)
    raw5 = old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name)
    raw1 = old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name)
    dq = old.data_quality_gate(raw1, raw5)
    if dq["status"] != "PASS":
        raise RuntimeError("DEV_DIAGNOSTIC_DATA_QUALITY_FAIL:" + "|".join(dq["issues"]))
    env = old.prepare(raw5, raw1)
    days = old.scoreable_days(env)

    old_ledger = old.run_backtest(env, old.Params(), days)
    rows = []
    for d in days:
        r = v24._analysis_run_day(env, d, v24.Params())
        if r is not None:
            rows.append(r)
    new_ledger = pd.DataFrame(rows)
    old_ledger.to_csv(OUT / "pre_v24_ledger.csv", index=False)
    new_ledger.to_csv(OUT / "v24_zone_candle_ledger.csv", index=False)

    timing = _force_timing_audit(new_ledger)
    (OUT / "force_timing_audit.json").write_text(
        json.dumps(timing, indent=2, sort_keys=True, default=str, allow_nan=False)
    )

    def m(x):
        return old.metrics(x) if len(x) else {"trades": 0, "net_pnl": 0.0}

    spec = load_spec()
    folds_n = int(spec["evidence_policy"]["chronological_folds"])
    folds = chronological_folds(new_ledger, days, folds_n)
    boot = moving_block_bootstrap_mean(
        new_ledger.net_pnl.to_numpy(float) if len(new_ledger) else np.array([])
    )
    stress = slippage_stress(new_ledger, spec["evidence_policy"]["slippage_stress_points"])
    edge = build_edge_certificate(
        ledger=new_ledger, score_sessions=len(days), folds=folds,
        bootstrap_lcb95=boot["lower_95"], slippage_stress_net=stress,
        data_clean=False,
    )
    (OUT / "edge_diagnostic.json").write_text(
        json.dumps(edge.to_dict(), indent=2, sort_keys=True, allow_nan=False)
    )

    report = {
        "status": "DEVELOPMENT_DIAGNOSTIC_ONLY_NOT_OOS_NOT_PROMOTABLE",
        "semantics_sha256": semantics_hash(),
        "rule_changes_after_viewing_this_result_allowed": False,
        "data_contract": "single M26 public development sample; contaminated",
        "scoreable_sessions": len(days),
        "pre_v24": m(old_ledger),
        "v24_zone_candle": m(new_ledger),
        "setup_counts": new_ledger.setup.value_counts().to_dict() if len(new_ledger) else {},
        "side_counts": new_ledger.side.value_counts().to_dict() if len(new_ledger) else {},
        "candidate_reason_counts": new_ledger.candidate_reason.value_counts().to_dict() if len(new_ledger) else {},
        "force_timing_audit": timing,
        "chronological_folds": folds.to_dict(orient="records"),
        "bootstrap_mean_trade": boot,
        "slippage_stress_net": stress,
        "weakest_link_edge_diagnostic": edge.to_dict(),
        "warning": "This sample is seen/contaminated. Certified edge MUST remain false here. Do not tune thresholds or promote from this result."
    }
    (OUT / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True, default=str, allow_nan=False))
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
