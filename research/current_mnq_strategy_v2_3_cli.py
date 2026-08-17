#!/usr/bin/env python3
"""Local operator CLI for Current MNQ v2.3 production candidate.

Credentialed commands intentionally inherit the personal-device refusal. Nothing
in this CLI can make hosted GitHub Actions a trading runtime.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from datetime import date
from pathlib import Path

from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id
from research.current_mnq_strategy_v2_3_data import collect_local_projectx
from research.current_mnq_strategy_v2_3_evidence import build_evidence, gold_counts
from research.current_mnq_strategy_v2_3_local_runtime import inspect_runtime
from research.current_mnq_strategy_v2_3_oos import run_sealed
from research.current_mnq_strategy_v2_3_policy import live_gate, research_gate, sealed_validation_gate, shadow_gate, semantics_hash
from research.current_mnq_strategy_v2_3_realtime import read_realtime_snapshot
from research.current_mnq_strategy_v2_3_shadow import summarize_shadow


def _date(text: str) -> date:
    return date.fromisoformat(text)


def _print(obj) -> None:
    print(json.dumps(obj, indent=2, sort_keys=True, default=str))


def cmd_doctor(_args):
    loc = inspect_runtime()
    pos, neg = gold_counts()
    _print({
        "release": "MNQ-V2.3-PC1",
        "semantics_sha256": semantics_hash(),
        "personal_device_candidate": loc.personal_device_candidate,
        "remote_markers": list(loc.remote_markers),
        "generic_ci": loc.generic_ci,
        "positive_user_gold": pos,
        "tempting_no_trade_user_gold": neg,
        "live_default": "REFUSE",
        "next_required": [
            "local roll-correct data collection",
            "sealed OOS",
            "one real user-labeled tempting NO-TRADE gold chart",
            "local shadow campaign",
            "broker reconciliation + emergency flatten drills",
            "signed LIVE_ELIGIBLE receipt",
        ],
    })


def cmd_contract(args):
    _print({"session": args.session.isoformat(), "contract_id": projectx_contract_id(args.session)})


def cmd_collect(args):
    manifest = collect_local_projectx(args.start, args.end, args.out, warmup_days=args.warmup_days)
    _print({
        "status": "DATASET_FROZEN",
        "dataset_sha256": manifest["dataset_sha256"],
        "requested_start": manifest["requested_start"],
        "requested_end": manifest["requested_end"],
        "sessions": manifest["sessions"],
        "output": str(Path(args.out).resolve()),
    })


def cmd_sealed(args):
    report = run_sealed(args.dataset, args.out, architecture_receipt=args.architecture_receipt)
    _print({
        "status": "SEALED_RUN_COMPLETE",
        "metrics": report["metrics"],
        "promotion_gate": report["promotion_gate"],
        "output": str(Path(args.out).resolve()),
    })


def cmd_shadow(args):
    _print(summarize_shadow(args.journal))


def cmd_realtime(args):
    s = read_realtime_snapshot(args.snapshot, args.account_id, args.contract_id)
    _print(asdict(s))


def cmd_evidence(args):
    ev = build_evidence(
        architecture_receipt=args.architecture_receipt,
        sealed_report=args.sealed_report,
        shadow_journal=args.shadow_journal,
        operations_drill_receipt=args.operations_drill_receipt,
    )
    gates = {
        "fidelity": research_gate(ev),
        "research": sealed_validation_gate(ev),
        "shadow": shadow_gate(ev),
        "live": live_gate(ev),
    }
    _print({
        "evidence": asdict(ev),
        "gates": {k: {"approved": v.approved, "stage": v.stage, "reasons": list(v.reasons)} for k, v in gates.items()},
    })


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="mnq-v23", description="Current MNQ v2.3 production-candidate operator CLI")
    sub = p.add_subparsers(dest="command", required=True)

    d = sub.add_parser("doctor", help="Show current local production blockers")
    d.set_defaults(func=cmd_doctor)

    c = sub.add_parser("contract", help="Resolve expected MNQ contract for a NY session")
    c.add_argument("--session", type=_date, required=True)
    c.set_defaults(func=cmd_contract)

    c = sub.add_parser("collect", help="Collect/freeze roll-correct ProjectX history locally")
    c.add_argument("--start", type=_date, required=True)
    c.add_argument("--end", type=_date, required=True)
    c.add_argument("--out", required=True)
    c.add_argument("--warmup-days", type=int, default=90)
    c.set_defaults(func=cmd_collect)

    s = sub.add_parser("sealed-validate", help="Run the frozen one-shot OOS validation")
    s.add_argument("--dataset", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--architecture-receipt")
    s.set_defaults(func=cmd_sealed)

    s = sub.add_parser("shadow-summary", help="Summarize the immutable local shadow journal")
    s.add_argument("--journal", required=True)
    s.set_defaults(func=cmd_shadow)

    r = sub.add_parser("realtime-health", help="Validate the local dual-hub realtime snapshot")
    r.add_argument("--snapshot", required=True)
    r.add_argument("--account-id", type=int, required=True)
    r.add_argument("--contract-id", required=True)
    r.set_defaults(func=cmd_realtime)

    e = sub.add_parser("evidence-status", help="Build promotion evidence from actual receipts")
    e.add_argument("--architecture-receipt")
    e.add_argument("--sealed-report")
    e.add_argument("--shadow-journal")
    e.add_argument("--operations-drill-receipt")
    e.set_defaults(func=cmd_evidence)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
