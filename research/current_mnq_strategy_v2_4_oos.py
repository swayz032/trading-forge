#!/usr/bin/env python3
"""One-shot sealed validation for Current MNQ v2.4.

The prior v2.3 result is deliberately not inherited. This runner binds the seal to
the v2.4 semantic hash and executes only Params() through the shared zone+candle
candidate kernel. No parameter search or variant selection exists here.
"""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_4_engine as e
from research.current_mnq_strategy_v2_3_evidence import gold_counts
from research.current_mnq_strategy_v2_3_oos import (
    SEED,
    audit_scoreable_contract_provenance,
    chronological_folds,
    moving_block_bootstrap_mean,
    slippage_stress,
    verify_dataset_bytes,
)
from research.current_mnq_strategy_v2_4_policy import (
    Evidence, load_spec, sealed_validation_gate, semantics_hash,
)


def _json_if_present(path: str | Path | None) -> dict:
    if path is None:
        return {}
    p = Path(path)
    if not p.exists():
        return {}
    return json.loads(p.read_text())


def apply_contaminated_score_exclusions(days: list, spec: dict) -> tuple[list, dict]:
    ranges = spec.get("anti_overfit", {}).get("contaminated_score_ranges", [])
    parsed = []
    for r in ranges:
        start = pd.Timestamp(r["start"]).date(); end = pd.Timestamp(r["end"]).date()
        if start > end:
            raise RuntimeError(f"CONTAMINATED_RANGE_INVALID:{start}>{end}")
        parsed.append((start, end, str(r.get("reason", ""))))
    eligible, excluded = [], []
    for d in sorted(days):
        match = next(((s, x, why) for s, x, why in parsed if s <= d <= x), None)
        if match is None:
            eligible.append(d)
        else:
            s, x, why = match
            excluded.append({"session": str(d), "range_start": str(s), "range_end": str(x), "reason": why})
    return eligible, {
        "candidate_sessions": len(days), "eligible_sessions": len(eligible),
        "excluded_sessions": len(excluded), "declared_ranges": ranges,
        "excluded": excluded,
    }


def run_sealed(dataset_root: str | Path, out_dir: str | Path,
               architecture_receipt: str | Path | None = None) -> dict:
    root = Path(dataset_root); out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise RuntimeError("SEALED_OUTPUT_DIR_NOT_EMPTY")

    spec = load_spec()
    raw5, raw1, manifest = e.load_production_dataset(root)
    verify_dataset_bytes(root, manifest)
    seal = {
        "schema_version": 1,
        "strategy_release": e.ENGINE_VERSION,
        "sealed_utc": datetime.now(timezone.utc).isoformat(),
        "semantics_sha256": semantics_hash(),
        "dataset_sha256": manifest["dataset_sha256"],
        "parameter_object": "Params() ONLY",
        "parameter_search_allowed": False,
        "variant_selection_allowed": False,
        "bootstrap_seed": SEED,
        "v2_3_result_inherited": False,
        "contaminated_score_ranges": spec["anti_overfit"].get("contaminated_score_ranges", []),
    }
    (out / "SEAL.json").write_text(json.dumps(seal, indent=2, sort_keys=True))

    dq = e.core.data_quality_gate(raw1, raw5)
    if dq["status"] != "PASS":
        raise RuntimeError("SEALED_DATA_QUALITY_REFUSE:" + "|".join(dq["issues"]))
    env = e.prepare(raw5, raw1, manifest)
    candidate_days = e.scoreable_days(env)
    days, exclusion_audit = apply_contaminated_score_exclusions(candidate_days, spec)
    if not days:
        raise RuntimeError("SEALED_NO_UNCONTAMINATED_SCOREABLE_DAYS")
    provenance = audit_scoreable_contract_provenance(raw1, manifest, days)
    if provenance["status"] != "PASS":
        raise RuntimeError("SEALED_CONTRACT_PROVENANCE_REFUSE:" + "|".join(provenance["issues"][:10]))

    ledger = e.run_backtest(env, e.Params(), days)
    if len(ledger):
        forbidden = {x["session"] for x in exclusion_audit["excluded"]}
        overlap = forbidden.intersection(set(ledger.session.astype(str)))
        if overlap:
            raise RuntimeError(f"CONTAMINATED_SESSION_REACHED_LEDGER:{sorted(overlap)[:10]}")
    ledger.to_csv(out / "ledger.csv", index=False)

    folds_n = int(spec["evidence_policy"]["chronological_folds"])
    folds = chronological_folds(ledger, days, folds_n)
    folds.to_csv(out / "folds.csv", index=False)
    boot = moving_block_bootstrap_mean(ledger.net_pnl.to_numpy(float) if len(ledger) else np.array([]))
    stress = slippage_stress(ledger, spec["evidence_policy"]["slippage_stress_points"])
    m = e.metrics(ledger)

    start = pd.Timestamp(manifest["requested_start"]); end = pd.Timestamp(manifest["requested_end"])
    years = max(0.0, (end - start).days / 365.25)
    arch = _json_if_present(architecture_receipt)
    arch_valid = bool(arch) and arch.get("semantics_sha256") == semantics_hash()
    pos_gold, neg_gold = gold_counts()
    ev = Evidence(
        semantics_sha256=semantics_hash(),
        architecture_tests_passed=int(arch.get("tests", 0)) if arch_valid else 0,
        architecture_tests_failed=int(arch.get("failures", 1)) if arch_valid else 1,
        real_user_positive_gold=pos_gold,
        semantic_negative_fixtures=len(spec["negative_semantic_fixtures"]),
        real_user_tempting_no_trade_gold=neg_gold,
        contract_provenance_pass=True, data_quality_pass=True,
        sealed_calendar_years=years, sealed_sessions=len(days), sealed_trades=len(ledger),
        chronological_folds=folds_n, positive_folds=int((folds.net_pnl > 0).sum()),
        block_bootstrap_mean_lower_95=boot["lower_95"], slippage_stress_net=stress,
        sealed_rules_changed_after_run=False,
    )
    gate = sealed_validation_gate(ev)
    report = {
        "seal": seal, "data_quality": dq, "contamination_exclusion": exclusion_audit,
        "contract_provenance": provenance, "metrics": m,
        "folds": folds.to_dict(orient="records"),
        "block_bootstrap_mean_trade": boot, "slippage_stress_net": stress,
        "evidence": asdict(ev),
        "promotion_gate": {"approved": gate.approved, "stage": gate.stage, "reasons": list(gate.reasons)},
    }
    (out / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True, default=str, allow_nan=False))
    return report
