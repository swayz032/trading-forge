#!/usr/bin/env python3
"""Read-only preflight for the frozen MNQ v2.4 clean Databento dataset.

This script MUST NOT execute strategy P&L. It verifies the frozen dataset bytes,
manifest identity, explicit-contract/roll construction, production data quality,
scoreable-session contract provenance, and Databento dataset-condition metadata.
It writes nothing into the dataset directory and never calls run_backtest or
run_sealed.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import date, time
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from research import current_mnq_strategy_v2_3_data as common
from research import current_mnq_strategy_v2_4_engine as engine
from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id
from research.current_mnq_strategy_v2_3_oos import (
    audit_scoreable_contract_provenance,
    verify_dataset_bytes,
)
from research.current_mnq_strategy_v2_4_edge import load_edge_spec
from research.current_mnq_strategy_v2_4_policy import load_spec

DATASET_ROOT = REPO_ROOT / "data" / "mnq_v24_clean_2019_2021"
EXPECTED_SOURCE = "Databento GLBX.MDP3 explicit raw_symbol"
EXPECTED_SOURCE_UNIT = "ohlcv-1m"
EXPECTED_START = date(2019, 5, 6)
EXPECTED_END = date(2021, 12, 31)
EXPECTED_LAUNCH = date(2019, 5, 6)


def _resolve_path(root: Path, raw: str, *, raw_contract: bool = False) -> Path:
    p = Path(raw)
    if p.is_absolute():
        return p
    return root / ("raw_contracts" if raw_contract else "") / p.name


def _load_raw_contracts(root: Path, manifest: dict) -> dict[str, pd.DataFrame]:
    frames: dict[str, pd.DataFrame] = {}
    for cid, meta in sorted(manifest.get("raw_contract_files", {}).items()):
        p = _resolve_path(root, str(meta["path"]), raw_contract=True)
        x = pd.read_csv(p, compression="infer")
        frames[cid] = common.normalize_1m(x, cid)
    return frames


def _frame_view(x: pd.DataFrame) -> pd.DataFrame:
    y = x.copy()
    if "datetime" in y.columns:
        y["datetime"] = pd.to_datetime(y["datetime"], utc=True)
        y = y.set_index("datetime")
    if y.index.tz is None:
        y.index = pd.to_datetime(y.index, utc=True)
    y.index = y.index.tz_convert(common.TZ)
    return y.sort_index()


def _compare_frames(observed: pd.DataFrame, rebuilt: pd.DataFrame,
                    columns: list[str], label: str) -> dict:
    a = _frame_view(observed)
    b = _frame_view(rebuilt)
    issues: list[str] = []
    if len(a) != len(b):
        issues.append(f"{label}:row_count:{len(a)}!={len(b)}")
    if not a.index.equals(b.index):
        issues.append(f"{label}:timestamp_index_mismatch")
    shared_cols = [c for c in columns if c in a.columns and c in b.columns]
    missing = [c for c in columns if c not in a.columns or c not in b.columns]
    if missing:
        issues.append(f"{label}:missing_columns:{missing}")
    if not issues or (len(a) == len(b) and a.index.equals(b.index)):
        for c in shared_cols:
            if pd.api.types.is_numeric_dtype(a[c]) and pd.api.types.is_numeric_dtype(b[c]):
                av = pd.to_numeric(a[c], errors="coerce").to_numpy(float)
                bv = pd.to_numeric(b[c], errors="coerce").to_numpy(float)
                if not np.allclose(av, bv, rtol=0.0, atol=1e-9, equal_nan=True):
                    issues.append(f"{label}:numeric_mismatch:{c}")
            else:
                if not a[c].astype(str).equals(b[c].astype(str)):
                    issues.append(f"{label}:value_mismatch:{c}")
    return {"status": "PASS" if not issues else "REFUSE", "issues": issues}


def _expected_contract_ids(start: date, end: date) -> list[str]:
    return [w.contract_id for w in common.contract_windows(start, end, overlap_days=7)]


def _audit_manifest(root: Path, manifest: dict) -> dict:
    issues: list[str] = []
    if manifest.get("requested_start") != str(EXPECTED_START):
        issues.append(f"requested_start:{manifest.get('requested_start')}!={EXPECTED_START}")
    if manifest.get("requested_end") != str(EXPECTED_END):
        issues.append(f"requested_end:{manifest.get('requested_end')}!={EXPECTED_END}")
    if manifest.get("mnq_launch_date") != str(EXPECTED_LAUNCH):
        issues.append(f"mnq_launch_date:{manifest.get('mnq_launch_date')}!={EXPECTED_LAUNCH}")
    if manifest.get("source") != EXPECTED_SOURCE:
        issues.append(f"source:{manifest.get('source')}!={EXPECTED_SOURCE}")
    if manifest.get("source_unit") != EXPECTED_SOURCE_UNIT:
        issues.append(f"source_unit:{manifest.get('source_unit')}!={EXPECTED_SOURCE_UNIT}")
    if float(manifest.get("tick_size", -1)) != common.TICK:
        issues.append(f"tick_size:{manifest.get('tick_size')}!={common.TICK}")

    unhashed = dict(manifest)
    recorded_hash = str(unhashed.pop("dataset_sha256", ""))
    recomputed_hash = common.canonical_hash(unhashed)
    if recorded_hash != recomputed_hash:
        issues.append(f"dataset_sha256:{recorded_hash}!={recomputed_hash}")

    expected_ids = _expected_contract_ids(EXPECTED_START, EXPECTED_END)
    observed_ids = sorted(manifest.get("raw_contract_files", {}).keys())
    if observed_ids != sorted(expected_ids):
        issues.append(f"raw_contract_set:{observed_ids}!={sorted(expected_ids)}")

    defs = manifest.get("databento_definitions", {})
    if sorted(defs.keys()) != sorted(expected_ids):
        issues.append("definition_contract_set_mismatch")

    for cid in expected_ids:
        meta = manifest.get("raw_contract_files", {}).get(cid, {})
        if meta.get("source_dataset") != "GLBX.MDP3":
            issues.append(f"{cid}:source_dataset:{meta.get('source_dataset')}")
        if meta.get("source_schema") != "ohlcv-1m":
            issues.append(f"{cid}:source_schema:{meta.get('source_schema')}")
        definition = defs.get(cid, {})
        symbol = str(meta.get("source_raw_symbol", ""))
        if not symbol.startswith("MNQ") or definition.get("raw_symbol") != symbol:
            issues.append(f"{cid}:definition_raw_symbol_mismatch")

    expected_contract_sessions = {
        str(k): str(v) for k, v in common._daily_contract_map(EXPECTED_START, EXPECTED_END).items()
    }
    observed_contract_sessions = manifest.get("contract_sessions", {})
    for d, cid in expected_contract_sessions.items():
        if observed_contract_sessions.get(d) != cid:
            issues.append(f"contract_sessions:{d}:{observed_contract_sessions.get(d)}!={cid}")
            if len(issues) >= 100:
                break

    return {
        "status": "PASS" if not issues else "REFUSE",
        "issues": issues[:100],
        "recorded_dataset_sha256": recorded_hash,
        "recomputed_dataset_sha256": recomputed_hash,
        "expected_raw_contracts": len(expected_ids),
        "observed_raw_contracts": len(observed_ids),
    }


def _audit_rolls_and_rebuild(raw5: pd.DataFrame, raw1: pd.DataFrame,
                             manifest: dict, frames: dict[str, pd.DataFrame]) -> dict:
    issues: list[str] = []
    expected_dates = common.transition_dates(EXPECTED_START, EXPECTED_END)
    recorded = {str(x.get("roll_date")): x for x in manifest.get("roll_bridges", [])}
    rebuilt_bridges: list[common.RollBridge] = []

    if sorted(recorded) != sorted(str(x) for x in expected_dates):
        issues.append("roll_date_set_mismatch")

    for rd in expected_dates:
        old_id = projectx_contract_id(rd - pd.Timedelta(days=1))
        new_id = projectx_contract_id(rd)
        if old_id not in frames or new_id not in frames:
            issues.append(f"roll_source_missing:{rd}:{old_id}:{new_id}")
            continue
        rebuilt = common.compute_roll_bridge(frames[old_id], frames[new_id], rd)
        rebuilt_bridges.append(rebuilt)
        got = recorded.get(str(rd), {})
        if got.get("old_contract") != rebuilt.old_contract:
            issues.append(f"roll_old_contract:{rd}")
        if got.get("new_contract") != rebuilt.new_contract:
            issues.append(f"roll_new_contract:{rd}")
        if int(got.get("shared_minutes", -1)) != rebuilt.shared_minutes:
            issues.append(f"roll_shared_minutes:{rd}")
        try:
            gap = float(got.get("raw_gap_new_minus_old"))
        except Exception:
            gap = math.nan
        if not math.isfinite(gap) or abs(gap - rebuilt.raw_gap_new_minus_old) > 1e-9:
            issues.append(f"roll_gap:{rd}:{gap}!={rebuilt.raw_gap_new_minus_old}")

    lead = common.select_lead_rows(frames, EXPECTED_START, EXPECTED_END)
    rebuilt1 = common.forward_adjust(lead, rebuilt_bridges)
    rebuilt5 = common.derive_5m(rebuilt1)
    cmp1 = _compare_frames(
        raw1, rebuilt1,
        ["open", "high", "low", "close", "volume", "contract_id", "price_adjustment",
         "raw_open", "raw_high", "raw_low", "raw_close"],
        "continuous_1m",
    )
    cmp5 = _compare_frames(
        raw5, rebuilt5,
        ["open", "high", "low", "close", "volume", "contract_id", "price_adjustment"],
        "continuous_5m",
    )
    issues.extend(cmp1["issues"])
    issues.extend(cmp5["issues"])
    return {
        "status": "PASS" if not issues else "REFUSE",
        "issues": issues[:100],
        "expected_roll_bridges": len(expected_dates),
        "recorded_roll_bridges": len(recorded),
        "continuous_1m_rebuild": cmp1,
        "continuous_5m_rebuild": cmp5,
    }


def _all_contaminated_ranges(spec: dict, edge_spec: dict) -> list[tuple[date, date]]:
    raw = list(spec.get("anti_overfit", {}).get("contaminated_score_ranges", []))
    raw += list(edge_spec.get("anti_overfit", {}).get("known_seen_performance_ranges", []))
    out: list[tuple[date, date]] = []
    seen = set()
    for r in raw:
        s = pd.Timestamp(r["start"]).date()
        e = pd.Timestamp(r["end"]).date()
        key = (s, e)
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out


def _clean_scoreable_days(env: dict) -> list[date]:
    spec = load_spec()
    edge_spec = load_edge_spec()
    ranges = _all_contaminated_ranges(spec, edge_spec)
    days = []
    for d in engine.scoreable_days(env):
        if not (EXPECTED_START <= d <= EXPECTED_END):
            continue
        if any(s <= d <= e for s, e in ranges):
            continue
        days.append(d)
    return sorted(days)


def _minute_window_audit(raw1: pd.DataFrame, d: date) -> dict:
    if d.weekday() >= 5:
        return {"date": str(d), "weekday": False, "score_window_rows": 0,
                "score_window_expected": 0, "score_window_missing": 0, "rth_rows": 0}
    local = raw1[raw1.index.date == d]
    score = local[(local.index.time >= time(9, 30)) & (local.index.time <= time(12, 0))]
    expected = pd.date_range(
        pd.Timestamp.combine(d, time(9, 30)).tz_localize(common.TZ),
        pd.Timestamp.combine(d, time(12, 0)).tz_localize(common.TZ),
        freq="1min",
    )
    missing = expected.difference(score.index)
    rth = local[(local.index.time >= time(9, 30)) & (local.index.time <= time(15, 59))]
    return {
        "date": str(d), "weekday": True,
        "score_window_rows": int(len(score)),
        "score_window_expected": int(len(expected)),
        "score_window_missing": int(len(missing)),
        "missing_first_10": [str(x) for x in missing[:10]],
        "rth_rows": int(len(rth)),
    }


def _databento_condition_audit(raw1: pd.DataFrame, score_days: list[date]) -> dict:
    try:
        import databento as db
        client = db.Historical()
        conditions = client.metadata.get_dataset_condition(
            dataset="GLBX.MDP3",
            start_date=str(EXPECTED_START),
            end_date=str(EXPECTED_END),
        )
    except Exception as exc:
        return {
            "status": "REVIEW_REQUIRED",
            "reason": f"DATABENTO_CONDITION_UNAVAILABLE:{type(exc).__name__}:{exc}",
            "degraded_dates": [],
            "degraded_scoreable_dates": [],
            "day_audits": [],
        }

    bad = [x for x in conditions if str(x.get("condition")) != "available"]
    degraded = [x for x in bad if str(x.get("condition")) == "degraded"]
    score_set = set(score_days)
    degraded_dates = [pd.Timestamp(x["date"]).date() for x in degraded]
    degraded_scoreable = sorted(d for d in degraded_dates if d in score_set)
    audits = [_minute_window_audit(raw1, d) for d in degraded_dates]

    # Databento's condition is dataset-wide. Even when MNQ minute continuity looks
    # complete, "degraded" can also mean correctness issues; do not auto-clear it.
    status = "PASS" if not bad else "REVIEW_REQUIRED"
    return {
        "status": status,
        "non_available_conditions": bad,
        "degraded_dates": [str(d) for d in degraded_dates],
        "degraded_scoreable_dates": [str(d) for d in degraded_scoreable],
        "day_audits": audits,
        "note": (
            "Databento dataset condition is dataset-wide. A degraded day is not proof that MNQ is bad, "
            "but it cannot be called clean automatically because degraded may indicate missing or incorrect data."
        ),
    }


def main() -> None:
    print("MNQ v2.4 CLEAN DATASET PREFLIGHT — READ ONLY")
    print("strategy P&L executed: NO")
    print(f"dataset: {DATASET_ROOT}")

    result: dict = {
        "dataset_root": str(DATASET_ROOT),
        "strategy_pnl_executed": False,
        "sealed_runner_executed": False,
        "checks": {},
    }
    hard_refuse = False

    try:
        print("[1/7] loading manifest and production bars", flush=True)
        raw5, raw1, manifest = engine.load_production_dataset(DATASET_ROOT)
        result["dataset_sha256"] = manifest.get("dataset_sha256")

        print("[2/7] verifying every frozen file hash", flush=True)
        verify_dataset_bytes(DATASET_ROOT, manifest)
        result["checks"]["file_hashes"] = {"status": "PASS"}

        print("[3/7] auditing manifest identity and explicit contract map", flush=True)
        manifest_audit = _audit_manifest(DATASET_ROOT, manifest)
        result["checks"]["manifest"] = manifest_audit
        hard_refuse |= manifest_audit["status"] != "PASS"

        print("[4/7] rebuilding roll bridges and continuous 1m/5m from raw contracts", flush=True)
        frames = _load_raw_contracts(DATASET_ROOT, manifest)
        rebuild_audit = _audit_rolls_and_rebuild(raw5, raw1, manifest, frames)
        result["checks"]["roll_and_continuous_rebuild"] = rebuild_audit
        hard_refuse |= rebuild_audit["status"] != "PASS"

        print("[5/7] running production data-quality and scoreability checks (NO P&L)", flush=True)
        dq = engine.core.data_quality_gate(raw1, raw5)
        result["checks"]["production_data_quality"] = dq
        hard_refuse |= dq.get("status") != "PASS"
        env = engine.prepare(raw5, raw1, manifest)
        score_days = _clean_scoreable_days(env)
        result["clean_scoreable_sessions"] = len(score_days)
        min_sessions = int(load_edge_spec()["gates"]["minimum_score_sessions"])
        result["minimum_score_sessions_gate"] = min_sessions
        result["score_session_gate_pre_pnl"] = "PASS" if len(score_days) >= min_sessions else "REFUSE"
        hard_refuse |= len(score_days) < min_sessions

        print("[6/7] auditing every scoreable session contract provenance", flush=True)
        provenance = audit_scoreable_contract_provenance(raw1, manifest, score_days)
        result["checks"]["contract_provenance"] = provenance
        hard_refuse |= provenance.get("status") != "PASS"

        print("[7/7] checking Databento dataset-condition metadata", flush=True)
        condition = _databento_condition_audit(raw1, score_days)
        result["checks"]["databento_dataset_condition"] = condition

        if hard_refuse:
            result["status"] = "REFUSE_DATASET"
        elif condition.get("status") != "PASS":
            result["status"] = "REVIEW_REQUIRED_DATABENTO_DEGRADED"
        else:
            result["status"] = "PASS_READY_FOR_SEAL"

    except Exception as exc:
        result["status"] = "REFUSE_PREFLIGHT_EXCEPTION"
        result["error"] = f"{type(exc).__name__}:{exc}"

    print("\n" + json.dumps(result, indent=2, sort_keys=True, default=str, allow_nan=False))
    print("\nPREFLIGHT COMPLETE. Strategy P&L executed: NO")
    if result.get("status") == "PASS_READY_FOR_SEAL":
        print("NEXT: architecture/current-head evidence refresh, then ONE sealed v2.4 P&L run.")
    else:
        print("STOP: do not run sealed v2.4 P&L until the preflight status is cleared.")


if __name__ == "__main__":
    main()
