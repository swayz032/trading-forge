#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_2_engine_runtime as e

ROOT = Path("research/_mnq_v22")
DATA = ROOT / "data"
OUT = ROOT / "results"
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")


def save_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str, allow_nan=False))


def variant_row(name, p, led):
    m = e.metrics(led)
    m.update({"variant": name})
    return m


def chronological_folds(ledger, days, n=4):
    folds = np.array_split(np.array(days, dtype=object), n)
    rows = []
    for i, fd in enumerate(folds):
        ids = {str(x) for x in fd}
        q = ledger[ledger.session.isin(ids)] if len(ledger) else ledger
        m = e.metrics(q)
        m.update({"fold": i, "days": len(fd), "start": str(fd[0]) if len(fd) else None,
                  "end": str(fd[-1]) if len(fd) else None})
        rows.append(m)
    return pd.DataFrame(rows)


def tick_order_audit(ledger: pd.DataFrame, tick_raw: pd.DataFrame) -> dict:
    if ledger.empty or tick_raw.empty:
        return {"compared": 0, "mismatches": 0, "status": "INSUFFICIENT"}
    compared = 0
    mismatches = 0
    details = []
    for r in ledger.itertuples():
        et = pd.Timestamp(r.entry_time)
        xt = pd.Timestamp(r.exit_time)
        q = tick_raw[(tick_raw.index >= et) & (tick_raw.index <= xt)]
        if q.empty:
            continue
        direction = "L" if r.side == "LONG" else "S"
        first = None
        for ts0, b0 in q.iterrows():
            if direction == "L":
                hs = float(b0.low) <= float(r.stop)
                ht = float(b0.high) >= float(r.target) + e.TICK
            else:
                hs = float(b0.high) >= float(r.stop)
                ht = float(b0.low) <= float(r.target) - e.TICK
            if hs or ht:
                if hs and ht:
                    outcome = "AMBIG"
                elif hs:
                    outcome = "STOP"
                else:
                    outcome = "TARGET"
                first = (ts0, outcome)
                break
        if first is None:
            continue
        compared += 1
        recorded = "TARGET" if "TARGET" in str(r.exit_reason) else "STOP" if "STOP" in str(r.exit_reason) else "OTHER"
        mismatch = recorded != "OTHER" and first[1] not in (recorded, "AMBIG")
        mismatches += int(mismatch)
        if mismatch:
            details.append({"session": r.session, "tick_first": first[1], "recorded": recorded, "timestamp": str(first[0])})
    return {"compared": compared, "mismatches": mismatches, "mismatch_details": details[:20],
            "status": "PASS" if compared and mismatches == 0 else "WARN" if compared else "INSUFFICIENT"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest-only", action="store_true")
    ap.add_argument("--full", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    observed = e.download_pinned(DATA, include_tick=True)
    save_json(OUT / "observed_data_manifest.json", {
        "schema": 1,
        "source_contract_policy": "single_contract_development_only",
        "files": observed,
    })
    if args.manifest_only and not args.full:
        print(json.dumps({"status": "MANIFEST_ONLY", "files": observed}, indent=2))
        return

    if not LOCK.exists():
        raise SystemExit("REFUSE: pinned data lock missing")
    lock = json.loads(LOCK.read_text())
    e.verify_manifest(observed, lock)

    raw5 = e.load_csv(DATA / Path(e.DATA_FILES["5m"]).name)
    raw1 = e.load_csv(DATA / Path(e.DATA_FILES["1m"]).name)
    rawtick = e.load_csv(DATA / Path(e.DATA_FILES["tick"]).name)
    dq = e.data_quality_gate(raw1, raw5)
    save_json(OUT / "data_quality.json", dq)
    if dq["status"] != "PASS":
        raise SystemExit("REFUSE: data quality gate failed: " + ";".join(dq["issues"]))

    env = e.prepare(raw5, raw1)
    days = e.scoreable_days(env)
    warmup = {
        "first_raw_bar": str(env["full5"].index.min()),
        "first_scoreable_day": str(days[0]) if days else None,
        "last_scoreable_day": str(days[-1]) if days else None,
        "minimum_warmup_days": e.MIN_WARMUP_DAYS,
        "scoreable_sessions": len(days),
    }
    save_json(OUT / "warmup_report.json", warmup)
    if not days:
        raise SystemExit("REFUSE: no sessions have full warmup")

    base = e.Params()
    base_ledger = e.run_backtest(env, base, days)
    base_ledger.to_csv(OUT / "base_v22_ledger.csv", index=False)
    base_metrics = e.metrics(base_ledger)
    mae_risk = e.intratrade_equity_risk(base_ledger)
    tick_audit = tick_order_audit(base_ledger, rawtick)
    save_json(OUT / "tick_order_audit.json", tick_audit)
    folds = chronological_folds(base_ledger, days, 4)
    folds.to_csv(OUT / "base_chronological_folds.csv", index=False)

    tick_cols = ["entry", "stop", "target", "exit_price"]
    invalid_tick_rows = 0
    if len(base_ledger):
        invalid_tick_rows = int((~base_ledger[tick_cols].applymap(e.tick_valid)).any(axis=1).sum())
    if invalid_tick_rows:
        raise SystemExit(f"REFUSE: {invalid_tick_rows} ledger rows contain invalid tick prices")

    var_rows = []
    for name, p in e.deterministic_perturbations(base, n=24):
        led = base_ledger if name == "BASE" else e.run_backtest(env, p, days)
        var_rows.append(variant_row(name, p, led))
    variants = pd.DataFrame(var_rows)
    variants.to_csv(OUT / "parameter_perturbation_summary.csv", index=False)

    slip_rows = []
    for name, p in e.stress_slippage_profiles(base):
        led = e.run_backtest(env, p, days)
        slip_rows.append(variant_row(name, p, led))
    slippage = pd.DataFrame(slip_rows)
    slippage.to_csv(OUT / "slippage_stress.csv", index=False)

    if len(variants):
        profitable_share = float((variants.net_pnl > 0).mean())
        median_net = float(variants.net_pnl.median())
        min_net = float(variants.net_pnl.min())
        median_pf = float(variants.profit_factor.replace([np.inf, -np.inf], np.nan).median())
    else:
        profitable_share = median_net = min_net = median_pf = None

    report = {
        "status": "RESEARCH_ONLY_NOT_LIVE_APPROVED",
        "version": "v2.2",
        "anti_overfit_contract": {
            "repair_charter_frozen_before_v22_pnl": True,
            "base_not_selected_from_v22_pnl": True,
            "finite_parameter_perturbations": 25,
            "no_best_variant_promotion": True,
            "development_period_is_contaminated": True,
        },
        "data": {
            "source_repo": e.SOURCE_REPO,
            "source_commit": e.SOURCE_COMMIT,
            "contract_id": e.SOURCE_CONTRACT_ID,
            "contract_status": "single-contract M26 development sample; NOT active-front-month certification",
            "warmup": warmup,
            "quality": dq,
        },
        "semantic": {
            "breakout_polarity": {"REV_LONG": "SUPPORT", "REV_SHORT": "RESISTANCE", "BRK_LONG": "RESISTANCE", "BRK_SHORT": "SUPPORT"},
            "weak_breakout_requires_new_15m_close_after_attempt": True,
            "confluence_independent_from_zone_constructor": True,
            "blockers_separate_from_destinations": True,
            "all_executable_prices_tick_normalized": True,
            "zone_lifecycle_enabled": True,
            "premarket_plan_includes_overnight_context": True,
            "key_levels_standalone_entry_authorized": False,
            "reason_key_levels_off": "awaiting user-fidelity gold-set confirmation; implemented as unified Location context/targets",
        },
        "base_metrics": base_metrics,
        "mae_risk": mae_risk,
        "tick_order_audit": tick_audit,
        "robustness_family": {
            "count": int(len(variants)),
            "profitable_share": profitable_share,
            "median_net": median_net,
            "worst_net": min_net,
            "median_profit_factor": median_pf,
        },
        "slippage_stress": slippage.to_dict(orient="records"),
        "known_blocks": [
            "Current public 1m/5m data is only Jan-Apr 2026; after 60-day warmup the scored sample is small.",
            "Source is a single M26 contract sample, not then-active front-month multi-year MNQ.",
            "Public tick history begins 2026-03-09 and is trade-bar data, not a full bid/ask queue model.",
            "Real trader gold-set fixtures from the user's exact screenshots/videos are not yet timestamp-labeled.",
            "Production broker/order-state integration requires a live TopstepX adapter and credentials; strategy remains REFUSE for live money.",
        ],
    }
    save_json(OUT / "report.json", report)
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    main()
