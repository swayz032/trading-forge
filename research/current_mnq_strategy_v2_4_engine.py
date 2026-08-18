#!/usr/bin/env python3
"""Historical/production-data engine for Current MNQ v2.4.

Candidate formation comes only from current_mnq_strategy_v2_4_kernel so sealed
validation and live/shadow signal formation cannot silently use different entry
semantics. Target formation comes only from current_mnq_strategy_v2_4_targets so
historical and live paths share the same first-reaction/FVG semantics.
"""
from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_3_engine as v23
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_policy import semantics_hash
from research.current_mnq_strategy_v2_4_targets import build_and_classify

core = v23.core
TZ = v23.TZ
ENGINE_VERSION = "MNQ-V2.4-ZONE-CANDLE-PC1"
Params = v23.Params
TICK = v23.TICK
POINT_VALUE = v23.POINT_VALUE
CONTRACTS = v23.CONTRACTS
MIN_WARMUP_DAYS = v23.MIN_WARMUP_DAYS
load_production_dataset = v23.load_production_dataset
prepare = v23.prepare
scoreable_days = v23.scoreable_days
metrics = v23.metrics
intratrade_equity_risk = v23.intratrade_equity_risk


def _raw_price(adjusted: float, adjustment: float) -> float:
    return float(adjusted) - float(adjustment)


def _analysis_run_day(env: dict, dte, p: Params):
    full5, one, h15 = env["full5"], env["one"], env["h15"]
    for cand, actionable, plan in iter_actionable_candidates(env, dte, p, as_of=None):
        ent = core.one_minute_entry(one, actionable, cand.direction, p)
        if ent is None:
            continue
        entry_time, entry, raw_open = ent
        if entry_time.time() > core.LAST_ENTRY:
            continue

        picked, path_reason = build_and_classify(
            env["piv5"], full5, h15, entry_time, p,
            env["pdm"], env["pwm"], dte,
            entry, cand.direction, cand.setup,
            cand.setup == "BRK5",
            piv15=env["piv15"],
        )
        if picked is None:
            continue

        exit_time, exit_px, why, mfe, mae = core.exit_1m_realistic(
            one, entry_time, cand.direction, entry, picked.executable_price, p,
        )
        pts = exit_px - entry if cand.direction == "L" else entry - exit_px
        gross = pts * core.POINT_VALUE * core.CONTRACTS
        net = gross - core.ROUND_TRIP_FEE
        stop = core.executable_stop(
            entry - p.stop if cand.direction == "L" else entry + p.stop,
            cand.direction,
        )
        if not all(core.tick_valid(x) for x in (entry, stop, picked.executable_price, exit_px)):
            raise RuntimeError("V24_ANALYSIS_EXECUTABLE_PRICE_OFF_TICK")

        return {
            "session": str(dte), "signal_time": str(cand.signal_time),
            "confirmed_time": str(cand.confirmed_time), "entry_time": str(entry_time),
            "side": "LONG" if cand.direction == "L" else "SHORT", "setup": cand.setup,
            "candidate_reason": cand.reason, "premarket_primary": plan.primary,
            "premarket_score": plan.score, "premarket_structure": plan.pm_structure,
            "premarket_location": plan.location_state, "entry_location": cand.location.source,
            "location_id": cand.location.id, "location_quality": cand.location.quality,
            "location_confluence": cand.location.confluence, "entry_raw_open": raw_open,
            "entry": entry, "stop": stop, "target_raw": picked.raw_price,
            "target": picked.executable_price, "target_points": abs(picked.executable_price-entry),
            "target_source": picked.location.source, "target_quality": picked.quality,
            "path_reason": path_reason, "exit_time": str(exit_time), "exit_price": exit_px,
            "exit_reason": why, "gross_pnl": gross, "fees": core.ROUND_TRIP_FEE,
            "net_pnl": net, "r": pts/p.stop, "mfe_points": mfe, "mae_points": mae,
        }
    return None


def run_day(env: dict, dte, p: Params):
    row = _analysis_run_day(env, dte, p)
    if row is None:
        return None
    if dte not in env["contract_by_session"]:
        raise RuntimeError(f"SESSION_CONTRACT_PROVENANCE_MISSING:{dte}")
    if dte not in env["adjustment_by_session"]:
        raise RuntimeError(f"SESSION_ADJUSTMENT_MISSING:{dte}")
    contract_id = env["contract_by_session"][dte]
    adj = float(env["adjustment_by_session"][dte])

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
