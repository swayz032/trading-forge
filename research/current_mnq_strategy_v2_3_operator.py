#!/usr/bin/env python3
"""Canonical operator CLI for Current MNQ v2.3.

This CLI intentionally exposes the safe evidence/deployment sequence and imports
production surfaces rather than asking the operator to assemble research modules.
Secrets are read only from local environment variables and are never printed.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

from research.current_mnq_strategy_v2_2_projectx_broker import ProjectXBroker
from research.current_mnq_strategy_v2_3_account_risk import AccountRiskConfig, AccountRiskStore
from research.current_mnq_strategy_v2_3_databento import collect_databento
from research.current_mnq_strategy_v2_3_device import enroll_device, verify_device
from research.current_mnq_strategy_v2_3_evidence import build_evidence
from research.current_mnq_strategy_v2_3_local_runtime import inspect_runtime
from research.current_mnq_strategy_v2_3_oos import run_sealed
from research.current_mnq_strategy_v2_3_operations_drill import OperationsDrill, write_drill_receipt
from research.current_mnq_strategy_v2_3_policy import live_gate, research_gate, sealed_validation_gate, shadow_gate, semantics_hash
from research.current_mnq_strategy_v2_3_production import (
    ProductionAutomation, ProductionShadow, create_device_bound_promotion_receipt,
)
from research.current_mnq_strategy_v2_3_shadow import summarize_shadow

HERE = Path(__file__).resolve().parent
SIDECAR_DIR = HERE / "mnq_v23_realtime"


def emit(obj) -> None:
    print(json.dumps(obj, indent=2, sort_keys=True, default=str))


def d(text: str) -> date:
    return date.fromisoformat(text)


def risk_store(args) -> AccountRiskStore:
    return AccountRiskStore(
        AccountRiskConfig(
            account_id=args.account_id,
            account_size_label=args.account_size_label,
            starting_balance=args.starting_balance,
            max_loss_distance=args.max_loss_distance,
            platform_max_micros=args.platform_max_micros,
            min_same_stop_survival=args.min_same_stop_survival,
        ),
        args.risk_state,
    )


def cmd_doctor(args):
    loc = inspect_runtime()
    device = None
    device_error = None
    if args.device and Path(args.device).exists():
        try:
            device = verify_device(args.device)
        except Exception as exc:
            device_error = str(exc)
    emit({
        "release": "MNQ-V2.3-PC1",
        "semantics_sha256": semantics_hash(),
        "personal_device_candidate": loc.personal_device_candidate,
        "remote_markers": list(loc.remote_markers),
        "device_enrolled_and_verified": device is not None,
        "device_error": device_error,
        "credentials_present": {
            "TOPSTEPX_USERNAME": bool(os.getenv("TOPSTEPX_USERNAME")),
            "TOPSTEPX_API_KEY": bool(os.getenv("TOPSTEPX_API_KEY")),
            "DATABENTO_API_KEY": bool(os.getenv("DATABENTO_API_KEY")),
            "MNQ_V23_DEVICE_HMAC_KEY": bool(os.getenv("MNQ_V23_DEVICE_HMAC_KEY")),
            "MNQ_V23_RELEASE_HMAC_KEY": bool(os.getenv("MNQ_V23_RELEASE_HMAC_KEY")),
            "MNQ_V23_LIVE_ARM": os.getenv("MNQ_V23_LIVE_ARM") == "I_ACCEPT_LIVE_ORDER_RISK",
        },
        "automation_default": "REFUSE_UNTIL_ALL_EVIDENCE_PASSES",
        "topstep_lfa_projectx_automation": "REFUSE",
    })


def cmd_enroll(args):
    emit(enroll_device(args.device, label=args.label))


def cmd_collect_db(args):
    m = collect_databento(args.start, args.end, args.out, warmup_days=args.warmup_days)
    emit({
        "status": "DATASET_FROZEN", "source": m.get("source"),
        "dataset_sha256": m["dataset_sha256"], "sessions": m["sessions"],
        "requested_start": m["requested_start"], "requested_end": m["requested_end"],
        "output": str(Path(args.out).resolve()),
    })


def cmd_sealed(args):
    r = run_sealed(args.dataset, args.out, architecture_receipt=args.architecture_receipt)
    emit({"status": "SEALED_COMPLETE", "metrics": r["metrics"], "gate": r["promotion_gate"]})


def cmd_realtime(args):
    # Inherit local credential/account/contract environment without echoing it.
    pkg_lock = SIDECAR_DIR / "package-lock.json"
    install = ["npm", "ci" if pkg_lock.exists() else "install", "--ignore-scripts", "--no-audit", "--no-fund"]
    subprocess.run(install, cwd=SIDECAR_DIR, check=True)
    raise SystemExit(subprocess.call(["node", "sidecar.mjs"], cwd=SIDECAR_DIR, env=os.environ.copy()))


def cmd_shadow(args):
    p = ProductionShadow(
        device_enrollment=args.device,
        account_id=args.account_id,
        realtime_snapshot_path=args.snapshot,
        context_root=args.context_root,
        journal_path=args.journal,
    )
    p.run_until_window_end(poll_seconds=args.poll_seconds)
    emit(summarize_shadow(args.journal))


def cmd_shadow_summary(args):
    emit(summarize_shadow(args.journal))


def cmd_reconcile(args):
    d = OperationsDrill(args.account_id, args.snapshot)
    emit(d.reconciliation_check(args.contract_id))


def cmd_flatten_drill(args):
    if args.confirm != "CANCEL_AND_FLATTEN_EXISTING_SIM_STATE":
        raise RuntimeError("EXACT_FLATTEN_DRILL_CONFIRMATION_REQUIRED")
    d = OperationsDrill(args.account_id, args.snapshot)
    rec = d.reconciliation_check(args.contract_id)
    flat = d.emergency_flatten_existing_state(args.contract_id)
    emit(write_drill_receipt(
        args.out, account_id=args.account_id,
        reconciliation=rec, emergency_flatten=flat,
    ))


def cmd_reconcile_receipt(args):
    d = OperationsDrill(args.account_id, args.snapshot)
    rec = d.reconciliation_check(args.contract_id)
    emit(write_drill_receipt(
        args.out, account_id=args.account_id,
        reconciliation=rec, emergency_flatten=None,
    ))


def cmd_evidence(args):
    ev = build_evidence(
        architecture_receipt=args.architecture_receipt,
        sealed_report=args.sealed_report,
        shadow_journal=args.shadow_journal,
        operations_drill_receipt=args.drill_receipt,
    )
    gates = {
        "fidelity": research_gate(ev),
        "sealed": sealed_validation_gate(ev),
        "shadow": shadow_gate(ev),
        "automation": live_gate(ev),
    }
    emit({
        "evidence": ev.__dict__,
        "gates": {k: {"approved": v.approved, "stage": v.stage, "reasons": list(v.reasons)} for k, v in gates.items()},
    })


def cmd_promote(args):
    emit(create_device_bound_promotion_receipt(
        account_id=args.account_id,
        device_enrollment=args.device,
        architecture_receipt=args.architecture_receipt,
        sealed_report=args.sealed_report,
        shadow_journal=args.shadow_journal,
        operations_drill_receipt=args.drill_receipt,
        output=args.out,
    ))


def cmd_eod_risk(args):
    store = risk_store(args)
    broker = ProjectXBroker(account_id=args.account_id)
    account = broker.account_snapshot()
    state = store.record_eod_balance(args.session.isoformat(), float(account["balance"]))
    emit({
        "status": "EOD_RISK_STATE_UPDATED",
        "session": args.session.isoformat(),
        "highest_eod_balance": state.highest_eod_balance,
        "trailing_floor": store.trailing_floor(state),
    })


def cmd_automation_once(args):
    store = risk_store(args)
    prod = ProductionAutomation(
        account_id=args.account_id,
        device_enrollment=args.device,
        promotion_receipt=args.promotion_receipt,
        risk_store=store,
        realtime_snapshot_path=args.snapshot,
        context_root=args.context_root,
        ledger_path=args.ledger,
    )
    emit(prod.evaluate_once(
        desired_qty=args.desired_qty,
        slippage_stress_points=args.slippage_stress_points,
        dll_remaining=args.dll_remaining,
    ))


def add_account(p):
    p.add_argument("--account-id", type=int, required=True)


def add_risk(p):
    add_account(p)
    p.add_argument("--account-size-label", required=True)
    p.add_argument("--starting-balance", type=float, required=True)
    p.add_argument("--max-loss-distance", type=float, required=True)
    p.add_argument("--platform-max-micros", type=int, default=50)
    p.add_argument("--min-same-stop-survival", type=int, default=3)
    p.add_argument("--risk-state", required=True)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="mnq-v23-production", description="Faithful MNQ v2.3 production operator")
    s = p.add_subparsers(dest="cmd", required=True)

    x=s.add_parser("doctor"); x.add_argument("--device"); x.set_defaults(func=cmd_doctor)
    x=s.add_parser("enroll-device"); x.add_argument("--device", required=True); x.add_argument("--label", default="primary-trading-pc"); x.set_defaults(func=cmd_enroll)
    x=s.add_parser("collect-databento"); x.add_argument("--start",type=d,required=True); x.add_argument("--end",type=d,required=True); x.add_argument("--out",required=True); x.add_argument("--warmup-days",type=int,default=90); x.set_defaults(func=cmd_collect_db)
    x=s.add_parser("sealed-validate"); x.add_argument("--dataset",required=True); x.add_argument("--out",required=True); x.add_argument("--architecture-receipt",required=True); x.set_defaults(func=cmd_sealed)
    x=s.add_parser("start-realtime"); x.set_defaults(func=cmd_realtime)
    x=s.add_parser("shadow-run"); add_account(x); x.add_argument("--device",required=True); x.add_argument("--snapshot",required=True); x.add_argument("--context-root",required=True); x.add_argument("--journal",required=True); x.add_argument("--poll-seconds",type=float,default=1.0); x.set_defaults(func=cmd_shadow)
    x=s.add_parser("shadow-summary"); x.add_argument("--journal",required=True); x.set_defaults(func=cmd_shadow_summary)
    x=s.add_parser("reconcile-drill"); add_account(x); x.add_argument("--snapshot",required=True); x.add_argument("--contract-id",required=True); x.set_defaults(func=cmd_reconcile)
    x=s.add_parser("write-reconcile-receipt"); add_account(x); x.add_argument("--snapshot",required=True); x.add_argument("--contract-id",required=True); x.add_argument("--out",required=True); x.set_defaults(func=cmd_reconcile_receipt)
    x=s.add_parser("emergency-flatten-drill"); add_account(x); x.add_argument("--snapshot",required=True); x.add_argument("--contract-id",required=True); x.add_argument("--confirm",required=True); x.add_argument("--out",required=True); x.set_defaults(func=cmd_flatten_drill)
    x=s.add_parser("evidence-status"); x.add_argument("--architecture-receipt",required=True); x.add_argument("--sealed-report",required=True); x.add_argument("--shadow-journal",required=True); x.add_argument("--drill-receipt",required=True); x.set_defaults(func=cmd_evidence)
    x=s.add_parser("promote"); add_account(x); x.add_argument("--device",required=True); x.add_argument("--architecture-receipt",required=True); x.add_argument("--sealed-report",required=True); x.add_argument("--shadow-journal",required=True); x.add_argument("--drill-receipt",required=True); x.add_argument("--out",required=True); x.set_defaults(func=cmd_promote)
    x=s.add_parser("eod-risk-update"); add_risk(x); x.add_argument("--session",type=d,required=True); x.set_defaults(func=cmd_eod_risk)
    x=s.add_parser("automation-once"); add_risk(x); x.add_argument("--device",required=True); x.add_argument("--promotion-receipt",required=True); x.add_argument("--snapshot",required=True); x.add_argument("--context-root",required=True); x.add_argument("--ledger",required=True); x.add_argument("--desired-qty",type=int,default=15); x.add_argument("--slippage-stress-points",type=float,default=2.0); x.add_argument("--dll-remaining",type=float); x.set_defaults(func=cmd_automation_once)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
