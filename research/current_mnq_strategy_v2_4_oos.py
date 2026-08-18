#!/usr/bin/env python3
"""One-shot sealed validation for Current MNQ v2.4.

The prior v2.3 result is deliberately not inherited. This runner binds the seal to
the complete v2.4 build fingerprint and executes only Params() through the shared
zone+candle candidate kernel. No parameter search or variant selection exists.

EDGE-EQUATION-2 requires the complete genuine MNQ pre-contamination historical
scope: dataset coverage must begin no later than MNQ launch (2019-05-06) and run
through 2021-12-31. Initial post-launch warmup is present but unscored. This avoids
both the mathematically impossible legacy 3-calendar-year gate and any temptation
to cherry-pick a smaller clean subrange after seeing performance.
"""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_4_engine as e
from research.current_mnq_strategy_v2_3_oos import (
    SEED, audit_scoreable_contract_provenance, chronological_folds,
    moving_block_bootstrap_mean, slippage_stress, verify_dataset_bytes,
)
from research.current_mnq_strategy_v2_4_edge import build_edge_certificate, load_edge_spec
from research.current_mnq_strategy_v2_4_evidence import (
    architecture_gold_integrity, gold_counts, gold_manifest_hashes,
)
from research.current_mnq_strategy_v2_4_policy import Evidence, load_spec, sealed_validation_gate, semantics_hash

CLEAN_SESSIONS_PER_YEAR = 252.0


def _json_if_present(path: str | Path | None) -> dict:
    if path is None:
        return {}
    p = Path(path)
    if not p.exists():
        return {}
    return json.loads(p.read_text())


def _all_contaminated_ranges(spec: dict, edge_spec: dict) -> list[dict]:
    ranges = list(spec.get("anti_overfit", {}).get("contaminated_score_ranges", []))
    ranges += list(edge_spec.get("anti_overfit", {}).get("known_seen_performance_ranges", []))
    unique = []; seen = set()
    for r in ranges:
        key = (str(r["start"]), str(r["end"]), str(r.get("reason", "")))
        if key not in seen:
            seen.add(key); unique.append(dict(r))
    return unique


def apply_contaminated_score_exclusions(days: list, spec: dict,
                                        edge_spec: dict | None = None) -> tuple[list, dict]:
    edge_spec = edge_spec or load_edge_spec()
    ranges = _all_contaminated_ranges(spec, edge_spec)
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


def _clean_historical_scope(edge_spec: dict) -> tuple[pd.Timestamp, pd.Timestamp]:
    scope = edge_spec["clean_historical_scope"]
    start = pd.Timestamp(scope["required_dataset_start_on_or_before"])
    end = pd.Timestamp(scope["required_dataset_end_on_or_after"])
    if start > end:
        raise RuntimeError("V24_CLEAN_SCOPE_INVALID")
    return start, end


def audit_clean_historical_scope(manifest: dict, edge_spec: dict) -> dict:
    required_start, required_end = _clean_historical_scope(edge_spec)
    try:
        observed_start = pd.Timestamp(manifest["requested_start"])
        observed_end = pd.Timestamp(manifest["requested_end"])
    except Exception as exc:
        raise RuntimeError("V24_CLEAN_SCOPE_MANIFEST_DATES_MISSING") from exc
    issues = []
    if observed_start > required_start:
        issues.append(f"DATASET_START_TOO_LATE:{observed_start.date()}>{required_start.date()}")
    if observed_end < required_end:
        issues.append(f"DATASET_END_TOO_EARLY:{observed_end.date()}<{required_end.date()}")
    return {
        "status": "PASS" if not issues else "REFUSE",
        "required_start": str(required_start.date()),
        "required_end": str(required_end.date()),
        "observed_requested_start": str(observed_start.date()),
        "observed_requested_end": str(observed_end.date()),
        "issues": issues,
    }


def restrict_to_clean_historical_scope(days: list, edge_spec: dict) -> list:
    start, end = _clean_historical_scope(edge_spec)
    s, x = start.date(), end.date()
    return [d for d in sorted(days) if s <= d <= x]


def _eligible_calendar_years(days: list) -> float:
    # Informational only under EDGE-EQUATION-2; actual session count is the gate.
    return float(len(set(days)) / CLEAN_SESSIONS_PER_YEAR)


def run_sealed(dataset_root: str | Path, out_dir: str | Path,
               architecture_receipt: str | Path | None = None) -> dict:
    root = Path(dataset_root); out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise RuntimeError("SEALED_OUTPUT_DIR_NOT_EMPTY")

    spec = load_spec(); edge_spec = load_edge_spec()
    raw5, raw1, manifest = e.load_production_dataset(root)
    verify_dataset_bytes(root, manifest)
    scope_audit = audit_clean_historical_scope(manifest, edge_spec)
    if scope_audit["status"] != "PASS":
        raise RuntimeError("SEALED_CLEAN_SCOPE_REFUSE:" + "|".join(scope_audit["issues"]))

    seal = {
        "schema_version": 5,
        "strategy_release": e.ENGINE_VERSION,
        "sealed_utc": datetime.now(timezone.utc).isoformat(),
        "semantics_sha256": semantics_hash(),
        "dataset_sha256": manifest["dataset_sha256"],
        "parameter_object": "Params() ONLY",
        "parameter_search_allowed": False,
        "variant_selection_allowed": False,
        "bootstrap_seed": SEED,
        "v2_3_result_inherited": False,
        "clean_scope": scope_audit,
        "clean_years_method": "unique_clean_score_sessions/252_INFORMATIONAL_ONLY",
        "edge_equation": edge_spec["equation"],
        "gold_manifest_sha256": gold_manifest_hashes(),
        "contaminated_score_ranges": _all_contaminated_ranges(spec, edge_spec),
    }
    (out / "SEAL.json").write_text(json.dumps(seal, indent=2, sort_keys=True))

    dq = e.core.data_quality_gate(raw1, raw5)
    if dq["status"] != "PASS":
        raise RuntimeError("SEALED_DATA_QUALITY_REFUSE:" + "|".join(dq["issues"]))
    env = e.prepare(raw5, raw1, manifest)
    candidate_days = e.scoreable_days(env)
    uncontaminated, exclusion_audit = apply_contaminated_score_exclusions(candidate_days, spec, edge_spec)
    days = restrict_to_clean_historical_scope(uncontaminated, edge_spec)
    if not days:
        raise RuntimeError("SEALED_NO_CLEAN_SCOREABLE_DAYS")
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

    years = _eligible_calendar_years(days)
    arch = _json_if_present(architecture_receipt)
    arch_valid = bool(arch) and arch.get("semantics_sha256") == semantics_hash()
    gold_valid = arch_valid and architecture_gold_integrity(arch)
    pos_gold, neg_gold = gold_counts()

    edge = build_edge_certificate(
        ledger=ledger, score_sessions=len(days), folds=folds,
        bootstrap_lcb95=boot["lower_95"], slippage_stress_net=stress,
        data_clean=True, edge_spec=edge_spec,
    )
    (out / "edge_certificate.json").write_text(
        json.dumps(edge.to_dict(), indent=2, sort_keys=True, allow_nan=False)
    )

    ev = Evidence(
        semantics_sha256=semantics_hash(),
        architecture_tests_passed=int(arch.get("tests", 0)) if arch_valid else 0,
        architecture_tests_failed=int(arch.get("failures", 1)) if arch_valid else 1,
        real_user_positive_gold=pos_gold,
        semantic_negative_fixtures=len(spec["negative_semantic_fixtures"]),
        real_user_tempting_no_trade_gold=neg_gold,
        gold_manifest_integrity_pass=bool(gold_valid),
        contract_provenance_pass=True, data_quality_pass=True,
        clean_historical_scope_pass=True,
        sealed_calendar_years=years, sealed_sessions=len(days), sealed_trades=len(ledger),
        chronological_folds=folds_n, positive_folds=int((folds.net_pnl > 0).sum()),
        block_bootstrap_mean_lower_95=boot["lower_95"], slippage_stress_net=stress,
        robust_edge_expectancy=edge.robust_edge_expectancy,
        detailed_expectancy=edge.detailed_expectancy,
        leave_best_month_out_expectancy=edge.leave_best_month_out_expectancy,
        break_even_margin=edge.break_even_margin,
        data_clean_oos=edge.data_clean,
        sealed_rules_changed_after_run=False,
    )
    gate = sealed_validation_gate(ev)
    report = {
        "seal": seal, "data_quality": dq, "clean_historical_scope": scope_audit,
        "contamination_exclusion": exclusion_audit,
        "clean_score_sessions": len(days), "clean_observation_years": years,
        "clean_observation_years_method": "unique_clean_score_sessions/252_INFORMATIONAL_ONLY",
        "gold_manifest_integrity_pass": bool(gold_valid),
        "contract_provenance": provenance, "metrics": m,
        "folds": folds.to_dict(orient="records"),
        "block_bootstrap_mean_trade": boot, "slippage_stress_net": stress,
        "edge_certificate": edge.to_dict(), "evidence": asdict(ev),
        "promotion_gate": {"approved": gate.approved, "stage": gate.stage, "reasons": list(gate.reasons)},
    }
    (out / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True, default=str, allow_nan=False))
    return report
