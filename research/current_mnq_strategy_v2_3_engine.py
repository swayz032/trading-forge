#!/usr/bin/env python3
"""Production-candidate composition of the final v2.2 semantics.

No signal threshold is changed here. This wrapper binds each historical decision
to the actual session contract, preserves the causal forward-adjusted analysis
price, and restores raw executable contract prices in the audit ledger.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as core
from research.current_mnq_strategy_v2_3_policy import semantics_hash

TZ = "America/New_York"
ENGINE_VERSION = "MNQ-V2.3-PC1"

# Re-export immutable strategy types/helpers for callers.
Params = core.Params
TICK = core.TICK
POINT_VALUE = core.POINT_VALUE
CONTRACTS = core.CONTRACTS
MIN_WARMUP_DAYS = core.MIN_WARMUP_DAYS
metrics = core.metrics
intratrade_equity_risk = core.intratrade_equity_risk


def _load(path: Path) -> pd.DataFrame:
    x = pd.read_csv(path, compression="infer")
    x["datetime"] = pd.to_datetime(x["datetime"], utc=True)
    x = x.set_index("datetime").sort_index()
    x.index = x.index.tz_convert(TZ)
    return x


def load_production_dataset(root: str | Path) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    root = Path(root)
    manifest = json.loads((root / "dataset_manifest.json").read_text())
    one_path = Path(manifest["continuous_1m"]["path"])
    five_path = Path(manifest["continuous_5m"]["path"])
    if not one_path.is_absolute():
        one_path = root / one_path.name
    if not five_path.is_absolute():
        five_path = root / five_path.name
    raw1 = _load(one_path)
    raw5 = _load(five_path)
    return raw5, raw1, manifest


def prepare(raw5: pd.DataFrame, raw1: pd.DataFrame, manifest: dict) -> dict:
    env = core.prepare(raw5, raw1)
    env["dataset_manifest"] = manifest
    env["contract_by_session"] = {
        pd.Timestamp(k).date(): v for k, v in manifest["contract_sessions"].items()
    }
    # One forward-adjustment value must apply to a session's lead contract.
    one = raw1.copy()
    if "price_adjustment" not in one.columns:
        raise RuntimeError("PRODUCTION_DATASET_MISSING_PRICE_ADJUSTMENT")
    rth = one[(one.index.time >= pd.Timestamp("09:30").time()) &
              (one.index.time <= pd.Timestamp("15:59").time())]
    adjustment_by_session = {}
    for d, g in rth.groupby(rth.index.date):
        vals = sorted(set(round(float(v), 10) for v in g.price_adjustment.dropna()))
        if len(vals) != 1:
            raise RuntimeError(f"SESSION_ADJUSTMENT_AMBIGUOUS:{d}:{vals}")
        adjustment_by_session[d] = vals[0]
    env["adjustment_by_session"] = adjustment_by_session
    return env


def scoreable_days(env: dict) -> list:
    requested_start = pd.Timestamp(env["dataset_manifest"]["requested_start"]).date()
    requested_end = pd.Timestamp(env["dataset_manifest"]["requested_end"]).date()
    return [d for d in core.scoreable_days(env) if requested_start <= d <= requested_end]


def _raw_price(adjusted: float, adjustment: float) -> float:
    return float(adjusted) - float(adjustment)


def run_day(env: dict, dte, p: Params):
    row = core.run_day(env, dte, p)
    if row is None:
        return None
    if dte not in env["contract_by_session"]:
        raise RuntimeError(f"SESSION_CONTRACT_PROVENANCE_MISSING:{dte}")
    if dte not in env["adjustment_by_session"]:
        raise RuntimeError(f"SESSION_ADJUSTMENT_MISSING:{dte}")
    contract_id = env["contract_by_session"][dte]
    adj = float(env["adjustment_by_session"][dte])

    # Preserve the analysis-space prices and expose raw contract prices as the
    # executable audit contract. Additive adjustment does not alter P&L distance.
    for key in ("entry_raw_open", "entry", "stop", "target_raw", "target", "exit_price"):
        if key in row and row[key] is not None:
            row[f"analysis_{key}"] = float(row[key])
            row[key] = _raw_price(row[key], adj)
            if key in {"entry", "stop", "target", "exit_price"} and not core.tick_valid(row[key]):
                raise RuntimeError(f"RAW_EXECUTABLE_PRICE_OFF_TICK:{key}:{row[key]}")
    row["contract_id"] = contract_id
    row["price_adjustment"] = adj
    row["engine_version"] = ENGINE_VERSION
    row["semantics_sha256"] = semantics_hash()
    row["dataset_sha256"] = env["dataset_manifest"].get("dataset_sha256")
    return row


def run_backtest(env: dict, p: Params, days: list) -> pd.DataFrame:
    rows = []
    for d in days:
        row = run_day(env, d, p)
        if row is not None:
            rows.append(row)
    return pd.DataFrame(rows)
