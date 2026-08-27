#!/usr/bin/env python3
"""Sealed, no-parameter-search validation runner for Current MNQ v2.3.

The only allowed strategy parameter object is Params() from the frozen semantic
build. This runner verifies dataset bytes, freezes spec+dataset hashes, executes
once, and reports chronology/bootstrap/slippage evidence. It never promotes a
best variant because no variants are run. Previously inspected development date
ranges are mechanically excluded from OOS score evidence.
"""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as e
from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id
from research.current_mnq_strategy_v2_3_data import sha256_file
from research.current_mnq_strategy_v2_3_evidence import gold_counts
from research.current_mnq_strategy_v2_3_policy import Evidence, load_spec, sealed_validation_gate, semantics_hash

SEED = 20260817
BASELINE_TOTAL_SLIPPAGE_POINTS = 0.50
POINT_VALUE = 2.0
CONTRACTS = 15


def _json_if_present(path: str | Path | None) -> dict:
    if path is None:
        return {}
    p = Path(path)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except Exception as exc:
        raise RuntimeError(f"ARCHITECTURE_RECEIPT_CORRUPT:{p}") from exc


def verify_dataset_bytes(root: str | Path, manifest: dict) -> None:
    root = Path(root)
    for section in ("continuous_1m", "continuous_5m"):
        meta = manifest[section]
        p = Path(meta["path"])
        if not p.is_absolute():
            p = root / p.name
        if not p.exists():
            raise RuntimeError(f"SEALED_DATA_FILE_MISSING:{section}")
        if sha256_file(p) != meta["sha256"]:
            raise RuntimeError(f"SEALED_DATA_HASH_MISMATCH:{section}")
    for cid, meta in manifest.get("raw_contract_files", {}).items():
        p = Path(meta["path"])
        if not p.is_absolute():
            p = root / "raw_contracts" / p.name
        if not p.exists():
            raise RuntimeError(f"SEALED_RAW_CONTRACT_MISSING:{cid}")
        if sha256_file(p) != meta["sha256"]:
            raise RuntimeError(f"SEALED_RAW_HASH_MISMATCH:{cid}")


def chronological_folds(ledger: pd.DataFrame, sessions: list, n: int = 4) -> pd.DataFrame:
    days = np.array(sorted(sessions), dtype=object)
    chunks = np.array_split(days, n)
    rows = []
    for i, chunk in enumerate(chunks):
        ss = {str(d) for d in chunk}
        g = ledger[ledger.session.astype(str).isin(ss)] if len(ledger) else ledger
        rows.append({
            "fold": i + 1,
            "first_session": str(chunk[0]) if len(chunk) else None,
            "last_session": str(chunk[-1]) if len(chunk) else None,
            "sessions": int(len(chunk)),
            "trades": int(len(g)),
            "net_pnl": float(g.net_pnl.sum()) if len(g) else 0.0,
            "avg_trade": float(g.net_pnl.mean()) if len(g) else 0.0,
        })
    return pd.DataFrame(rows)


def moving_block_bootstrap_mean(values: np.ndarray, block: int = 5, paths: int = 10000,
                                seed: int = SEED) -> dict:
    x = np.asarray(values, dtype=float)
    if len(x) < 2:
        return {"paths": paths, "block": block, "lower_95": None, "median": None, "upper_95": None}
    block = max(1, min(int(block), len(x)))
    starts = np.arange(0, len(x) - block + 1)
    rng = np.random.default_rng(seed)
    means = np.empty(paths, dtype=float)
    needed = int(np.ceil(len(x) / block))
    for i in range(paths):
        picks = rng.choice(starts, size=needed, replace=True)
        sample = np.concatenate([x[j:j + block] for j in picks])[:len(x)]
        means[i] = sample.mean()
    return {
        "paths": int(paths), "block": int(block),
        "lower_95": float(np.quantile(means, 0.025)),
        "median": float(np.quantile(means, 0.5)),
        "upper_95": float(np.quantile(means, 0.975)),
    }


def slippage_stress(ledger: pd.DataFrame, points: list[float]) -> dict[str, float]:
    out = {}
    base = float(ledger.net_pnl.sum()) if len(ledger) else 0.0
    for total in points:
        incremental = max(0.0, float(total) - BASELINE_TOTAL_SLIPPAGE_POINTS)
        penalty = incremental * POINT_VALUE * CONTRACTS * len(ledger)
        out[f"{float(total):g}"] = float(base - penalty)
    return out


def _data_quality(raw1: pd.DataFrame, raw5: pd.DataFrame) -> dict:
    return e.core.data_quality_gate(raw1, raw5)


def apply_contaminated_score_exclusions(days: list, spec: dict | None = None) -> tuple[list, dict]:
    spec = spec or load_spec()
    ranges = spec.get("anti_overfit", {}).get("contaminated_score_ranges", [])
    parsed = []
    for r in ranges:
        start = pd.Timestamp(r["start"]).date()
        end = pd.Timestamp(r["end"]).date()
        if start > end:
            raise RuntimeError(f"CONTAMINATED_RANGE_INVALID:{start}>{end}")
        parsed.append((start, end, str(r.get("reason", ""))))
    eligible, excluded = [], []
    for d in sorted(days):
        match = next(((s, e, why) for s, e, why in parsed if s <= d <= e), None)
        if match is None:
            eligible.append(d)
        else:
            s, e, why = match
            excluded.append({"session": str(d), "range_start": str(s), "range_end": str(e), "reason": why})
    return eligible, {
        "candidate_sessions": len(days),
        "eligible_sessions": len(eligible),
        "excluded_sessions": len(excluded),
        "declared_ranges": ranges,
        "excluded": excluded,
    }


def audit_scoreable_contract_provenance(raw1: pd.DataFrame, manifest: dict, days: list) -> dict:
    """Every OOS-scored session—not only trade days—must carry its exact lead contract."""
    issues = []
    rth = raw1[(raw1.index.time >= pd.Timestamp("09:30").time()) &
               (raw1.index.time <= pd.Timestamp("15:59").time())]
    for d in days:
        expected = projectx_contract_id(d)
        declared = manifest.get("contract_sessions", {}).get(str(d))
        if declared != expected:
            issues.append(f"MANIFEST_CONTRACT:{d}:{declared}!={expected}")
            continue
        g = rth[rth.index.date == d]
        if g.empty:
            issues.append(f"RTH_SESSION_MISSING:{d}")
            continue
        observed = sorted(set(str(x) for x in g.get("contract_id", pd.Series(dtype=str)).dropna()))
        if observed != [expected]:
            issues.append(f"BAR_CONTRACT:{d}:{observed}!={[expected]}")
    return {
        "status": "PASS" if not issues else "REFUSE",
        "scoreable_sessions": len(days),
        "issues": issues[:100],
    }


def run_sealed(dataset_root: str | Path, out_dir: str | Path,
               architecture_receipt: str | Path | None = None) -> dict:
    root = Path(dataset_root)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise RuntimeError("SEALED_OUTPUT_DIR_NOT_EMPTY")

    spec = load_spec()
    raw5, raw1, manifest = e.load_production_dataset(root)
    verify_dataset_bytes(root, manifest)
    seal = {
        "schema_version": 1,
        "sealed_utc": datetime.now(timezone.utc).isoformat(),
        "semantics_sha256": semantics_hash(),
        "dataset_sha256": manifest["dataset_sha256"],
        "parameter_object": "Params() ONLY",
        "parameter_search_allowed": False,
        "variant_selection_allowed": False,
        "bootstrap_seed": SEED,
        "contaminated_score_ranges": spec.get("anti_overfit", {}).get("contaminated_score_ranges", []),
    }
    (out / "SEAL.json").write_text(json.dumps(seal, indent=2, sort_keys=True))

    dq = _data_quality(raw1, raw5)
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

    start = pd.Timestamp(manifest["requested_start"])
    end = pd.Timestamp(manifest["requested_end"])
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
        contract_provenance_pass=True,
        data_quality_pass=True,
        sealed_calendar_years=years,
        sealed_sessions=len(days),
        sealed_trades=len(ledger),
        chronological_folds=folds_n,
        positive_folds=int((folds.net_pnl > 0).sum()),
        block_bootstrap_mean_lower_95=boot["lower_95"],
        slippage_stress_net=stress,
        sealed_rules_changed_after_run=False,
    )
    gate = sealed_validation_gate(ev)
    report = {
        "seal": seal,
        "data_quality": dq,
        "contamination_exclusion": exclusion_audit,
        "contract_provenance": provenance,
        "metrics": m,
        "folds": folds.to_dict(orient="records"),
        "block_bootstrap_mean_trade": boot,
        "slippage_stress_net": stress,
        "evidence": asdict(ev),
        "promotion_gate": {"approved": gate.approved, "stage": gate.stage, "reasons": list(gate.reasons)},
    }
    (out / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True, default=str, allow_nan=False))
    return report
