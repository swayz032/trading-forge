#!/usr/bin/env python3
"""Causal production signal kernel for Current MNQ v2.3.

Unlike backtest `run_day`, this module never simulates an exit and never requires a
completed RTH day. Every input is physically sliced to completed bars at `as_of`.
The earliest A+ setup remains authoritative: if the process starts after that
setup, the caller must disable the session rather than enter a later setup.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import date

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod

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


def _first_candidate(env: dict, dte: date, p: prod.Params, as_of: pd.Timestamp):
    full5, r5, h15 = env["full5"], env["r5"], env["h15"]
    session = r5[r5.index.date == dte]
    if session.empty:
        return
    open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
    if open_ts - full5.index.min() < pd.Timedelta(days=core.MIN_WARMUP_DAYS):
        return
    plan = core.premarket_plan(full5, dte, env["pdm"], env["pwm"], env["pcm"])
    locations, _ = core.build_entry_locations(env, dte, open_ts, p)
    authorized = [x for x in locations if x.entry_authorized]
    pending: dict[tuple[str, str], core.PendingBreakout] = {}

    for i in range(len(session)):
        ts = session.index[i]
        bar_close = ts + pd.Timedelta(minutes=5)
        if ts.time() < core.TRADE_START or bar_close > as_of:
            continue
        r = session.iloc[i]
        if not np.isfinite(r.atr):
            continue

        current_locs = []
        for loc in authorized:
            if loc.zone is None:
                current_locs.append(loc)
                continue
            # Before-current-bar state: current breakout bar cannot erase itself.
            zs = core.zone_state_at(loc.zone, full5, ts, p)
            if zs.active:
                current_locs.append(replace(
                    loc, zone=zs, side=zs.side, quality=zs.quality,
                    confluence=zs.confluence,
                ))

        candidates: list[core.Candidate] = []
        pad = max(core.TICK * 2, p.touch_pad_atr * float(r.atr))

        for direction, side in (("L", "S"), ("S", "R")):
            near = [loc for loc in current_locs if loc.side == side and core.bar_interacts(loc, r, pad)]
            for loc in near:
                story = core.reversal_story(full5, ts, r, direction, loc, p)
                if story.complete and core.plan_allows(plan, direction, "REV", story, loc):
                    candidates.append(core.Candidate(
                        direction, "REV", loc, story, ts, bar_close, "COMPLETE_REVERSAL"
                    ))

        for direction, side in (("L", "R"), ("S", "S")):
            relevant = [loc for loc in current_locs if loc.side == side]
            for loc in relevant:
                if not core.decisive_outside(loc, r, direction, p):
                    continue
                if not core.breakout_pressure(full5, ts, direction):
                    continue
                if core.strong_bar(r, direction, p):
                    if core.plan_allows(plan, direction, "BRK5", None, loc):
                        candidates.append(core.Candidate(
                            direction, "BRK5", loc, None, ts, bar_close,
                            "STRONG_5M_ACCEPTANCE",
                        ))
                else:
                    key = (direction, loc.id)
                    pending.setdefault(key, core.PendingBreakout(
                        direction, loc.id, bar_close, loc.lo, loc.hi
                    ))

        # Pending weak-breakout attempts retain the ORIGINAL authorized location
        # snapshot; the attempted break itself is allowed to mark the current zone
        # broken without erasing the pending 15m-confirmation question.
        for key, pen in list(pending.items()):
            loc = next((x for x in authorized if x.id == pen.location_id), None)
            if loc is None:
                pending.pop(key, None)
                continue
            if bar_close - pen.attempted_at > pd.Timedelta(minutes=30):
                pending.pop(key, None)
                continue
            confirmed = core.latest_new_15m_confirmation(h15, pen, bar_close)
            if confirmed is not None and confirmed <= bar_close:
                if core.plan_allows(plan, pen.direction, "BRK15", None, loc):
                    candidates.append(core.Candidate(
                        pen.direction, "BRK15", loc, None, pen.attempted_at,
                        confirmed, "NEW_15M_ACCEPTANCE",
                    ))
                pending.pop(key, None)

        if not candidates or len(set(c.direction for c in candidates)) != 1:
            continue
        rank = {"BRK5": 3, "BRK15": 2, "REV": 1}
        cand = max(candidates, key=lambda c: (
            rank[c.setup], c.location.quality, c.location.confluence
        ))
        actionable = max(bar_close, cand.confirmed_time)
        if actionable.time() > core.LAST_ENTRY or actionable > as_of:
            continue
        yield cand, actionable, plan


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
    """Return the earliest setup that passes location/story/room/target gates.

    A fresh LONG binds to ask; a fresh SHORT binds to bid. Older candidates use
    their already-known next-1m historical reference only to establish whether the
    first daily A+ setup was missed. Callers MUST NOT enter old signals retroactively.
    """
    if dte not in env["contract_by_session"] or dte not in env["adjustment_by_session"]:
        raise RuntimeError("SIGNAL_SESSION_PROVENANCE_MISSING")
    adjustment = float(env["adjustment_by_session"][dte])
    contract_id = str(env["contract_by_session"][dte])

    for cand, actionable, plan in _first_candidate(env, dte, p, as_of):
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
            engine_version=prod.ENGINE_VERSION, semantics_sha256=prod.semantics_hash(),
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
