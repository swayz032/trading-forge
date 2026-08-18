#!/usr/bin/env python3
"""Causal live/shadow signal kernel for Current MNQ v2.4."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date

import pandas as pd

from research import current_mnq_strategy_v2_4_engine as prod
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_policy import semantics_hash

core = prod.core


@dataclass(frozen=True)
class SignalDecision:
    session: str
    signal_time: str
    confirmed_time: str
    actionable_time: str
    side: str
    setup: str
    reason: str
    premarket_primary: str
    premarket_score: float
    premarket_structure: str
    premarket_location: str
    entry_location: str
    location_id: str
    location_quality: float
    location_confluence: int
    reference_entry: float
    stop: float
    target: float
    target_points: float
    target_source: str
    target_quality: float
    path_reason: str
    contract_id: str
    price_adjustment: float
    engine_version: str
    semantics_sha256: str
    dataset_sha256: str | None
    reference_source: str

    def to_dict(self) -> dict:
        return asdict(self)


def _completed_inputs(raw5: pd.DataFrame, raw1: pd.DataFrame, as_of: pd.Timestamp):
    if as_of.tzinfo is None:
        raise RuntimeError("SIGNAL_ASOF_MUST_BE_TZ_AWARE")
    five = raw5[(raw5.index + pd.Timedelta(minutes=5)) <= as_of].copy()
    one = raw1[(raw1.index + pd.Timedelta(minutes=1)) <= as_of].copy()
    return five, one


def prepare_causal(raw5: pd.DataFrame, raw1: pd.DataFrame, manifest: dict,
                   as_of: pd.Timestamp) -> dict:
    five, one = _completed_inputs(raw5, raw1, as_of)
    if five.empty or one.empty:
        raise RuntimeError("SIGNAL_INSUFFICIENT_COMPLETED_DATA")
    env = prod.prepare(five, one, manifest)
    env["signal_as_of"] = as_of
    return env


def _historical_reference(env: dict, actionable: pd.Timestamp, direction: str, p: prod.Params):
    ent = core.one_minute_entry(env["one"], actionable, direction, p)
    if ent is None:
        return None
    entry_time, entry, _raw_open = ent
    if entry_time.time() > core.LAST_ENTRY:
        return None
    return entry_time, float(entry), "HISTORICAL_NEXT_1M"


def find_first_actionable_signal(env: dict, dte: date, p: prod.Params,
                                 as_of: pd.Timestamp,
                                 live_bid_raw: float | None = None,
                                 live_ask_raw: float | None = None,
                                 live_freshness_seconds: float = 20.0) -> SignalDecision | None:
    if dte not in env["contract_by_session"] or dte not in env["adjustment_by_session"]:
        raise RuntimeError("SIGNAL_SESSION_PROVENANCE_MISSING")
    adjustment = float(env["adjustment_by_session"][dte])
    contract_id = str(env["contract_by_session"][dte])

    for cand, actionable, plan in iter_actionable_candidates(env, dte, p, as_of=as_of):
        age = (as_of - actionable).total_seconds()
        side_live = live_ask_raw if cand.direction == "L" else live_bid_raw
        use_live = side_live is not None and -1.0 <= age <= live_freshness_seconds
        if use_live:
            reference_analysis = float(side_live) + adjustment
            entry_time = actionable
            reference_source = "LIVE_ASK" if cand.direction == "L" else "LIVE_BID"
        else:
            hist = _historical_reference(env, actionable, cand.direction, p)
            if hist is None:
                continue
            entry_time, reference_analysis, reference_source = hist

        targets = core.build_target_locations(
            env["piv5"], env["full5"], env["h15"], entry_time, p,
            env["pdm"], env["pwm"], dte,
        )
        picked, path_reason = core.classify_path_and_destination(
            targets, reference_analysis, cand.direction, cand.setup, p,
            cand.setup == "BRK5",
        )
        if picked is None:
            continue

        stop_analysis = core.executable_stop(
            reference_analysis - p.stop if cand.direction == "L" else reference_analysis + p.stop,
            cand.direction,
        )
        reference_raw = reference_analysis - adjustment
        stop_raw = stop_analysis - adjustment
        target_raw = picked.executable_price - adjustment
        for name, px in (("entry", reference_raw), ("stop", stop_raw), ("target", target_raw)):
            if not core.tick_valid(px):
                raise RuntimeError(f"SIGNAL_RAW_{name.upper()}_OFF_TICK:{px}")

        return SignalDecision(
            session=str(dte), signal_time=str(cand.signal_time),
            confirmed_time=str(cand.confirmed_time), actionable_time=str(actionable),
            side="LONG" if cand.direction == "L" else "SHORT", setup=cand.setup,
            reason=cand.reason, premarket_primary=plan.primary,
            premarket_score=float(plan.score), premarket_structure=plan.pm_structure,
            premarket_location=plan.location_state, entry_location=cand.location.source,
            location_id=cand.location.id, location_quality=float(cand.location.quality),
            location_confluence=int(cand.location.confluence),
            reference_entry=float(reference_raw), stop=float(stop_raw), target=float(target_raw),
            target_points=abs(float(target_raw - reference_raw)),
            target_source=picked.location.source, target_quality=float(picked.quality),
            path_reason=path_reason, contract_id=contract_id, price_adjustment=adjustment,
            engine_version=prod.ENGINE_VERSION, semantics_sha256=semantics_hash(),
            dataset_sha256=env["dataset_manifest"].get("dataset_sha256"),
            reference_source=reference_source,
        )
    return None


def signal_is_fresh(decision: SignalDecision, as_of: pd.Timestamp,
                    max_age_seconds: float = 20.0) -> bool:
    actionable = pd.Timestamp(decision.actionable_time)
    if actionable.tzinfo is None:
        raise RuntimeError("DECISION_ACTIONABLE_TIME_NAIVE")
    age = (as_of - actionable).total_seconds()
    return -1.0 <= age <= max_age_seconds
