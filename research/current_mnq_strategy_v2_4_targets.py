#!/usr/bin/env python3
"""First-reaction take-profit engine for Current MNQ v2.4.

The first meaningful reaction area wins by near-edge distance. Frozen 15m key
zones, dynamic 5m liquidity clusters, PD/PW levels and active native 15m FVGs all
use the same causal zone/FVG lifecycle before competing for TP priority.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as v23
from research.current_mnq_strategy_v2_4_fvg import active_15m_fvgs
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24
from research.current_mnq_strategy_v2_4_zone_lifecycle import zone_state_at_v24

core = v23.core
TICK = core.TICK
FVG_SOURCE = "FVG_15M_NATIVE_UNMITIGATED"
KEY_SOURCES = {"PDH", "PDL", "PWH", "PWL"}


@dataclass(frozen=True)
class ReactionDestination:
    location: core.Location
    kind: str
    first_contact_distance: float
    target_raw: float
    quality: float
    meaningful: bool
    fvg_confluent: bool = False


def _liquidity_quality(loc: core.Location) -> float:
    source_bonus = 0.10 if loc.source in KEY_SOURCES else 0.0
    conf_bonus = 0.05 * min(int(loc.confluence), 2)
    return float(np.clip(float(loc.quality) + source_bonus + conf_bonus, 0.0, 1.0))


def _ahead(entry: float, lo: float, hi: float, direction: str) -> bool:
    return bool(lo > entry) if direction == "L" else bool(hi < entry)


def _first_contact(entry: float, lo: float, hi: float, direction: str) -> float:
    return float(lo - entry) if direction == "L" else float(entry - hi)


def _cluster_target(loc: core.Location, direction: str, depth: float) -> float:
    if direction == "L":
        return float(loc.lo + depth * (loc.hi - loc.lo))
    return float(loc.hi - depth * (loc.hi - loc.lo))


def _structurally_meaningful_cluster(loc: core.Location, p: core.Params) -> bool:
    if loc.source in KEY_SOURCES:
        return True
    z = getattr(loc, "zone", None)
    if z is None:
        return False
    return bool(int(getattr(z, "touches", 0)) >= 2 and float(loc.quality) >= float(p.min_zone_quality))


def _dedupe(raw_locs: list[tuple[str, core.Location, bool]]) -> list[tuple[str, core.Location, bool]]:
    priority = {"KEY_ZONE_15M": 3, "KEY_LEVEL": 2, "LIQUIDITY_CLUSTER": 1}
    chosen: list[tuple[str, core.Location, bool]] = []
    for kind, loc, conf in sorted(
        raw_locs,
        key=lambda x: (-priority.get(x[0], 0), -float(x[1].quality), x[1].mid, x[1].id),
    ):
        if any(core.overlap(loc.lo, loc.hi, x[1].lo, x[1].hi, 0.0) for x in chosen):
            continue
        chosen.append((kind, loc, conf))
    return chosen


def build_reaction_destinations(piv5: pd.DataFrame, full5: pd.DataFrame,
                                h15: pd.DataFrame, asof: pd.Timestamp,
                                p: core.Params, pdm, pwm, dte,
                                entry: float, direction: str,
                                piv15: pd.DataFrame | None = None) -> list[ReactionDestination]:
    if direction not in {"L", "S"}:
        raise ValueError("direction must be L or S")

    native_fvgs = active_15m_fvgs(h15, asof)
    a15 = h15[h15.index + pd.Timedelta(minutes=15) <= asof].atr.tail(20).median()
    atr15 = float(a15) if np.isfinite(a15) else 20.0
    refs: list[float] = []
    if dte in pdm:
        refs += list(pdm[dte])
    if pwm.get(dte):
        refs += list(pwm[dte])
    tol = max(TICK * 4, p.fvg_overlap_atr * atr15)

    raw_locs: list[tuple[str, core.Location, bool]] = []

    zones5 = core.build_zones(piv5, full5, asof, p, look_days=25)
    zones5 = [zone_state_at_v24(z, full5, asof, p) for z in zones5]
    zones5 = core.enrich_confluence(zones5, refs, native_fvgs, atr15, p)
    for loc in core.zone_locations([z for z in zones5 if z.active]):
        fvg_conf = any(core.overlap(loc.lo, loc.hi, f.lo, f.hi, tol) for f in native_fvgs)
        raw_locs.append(("LIQUIDITY_CLUSTER", loc, fvg_conf))

    if piv15 is not None:
        open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
        level_env = {"h15": h15, "piv15": piv15, "full5": full5, "pdm": pdm, "pwm": pwm}
        primary_locs, _ = build_entry_locations_v24(level_env, dte, open_ts, p)
        for loc in primary_locs:
            kind = "KEY_LEVEL" if loc.source in KEY_SOURCES else "KEY_ZONE_15M"
            fvg_conf = any(core.overlap(loc.lo, loc.hi, f.lo, f.hi, tol) for f in native_fvgs)
            raw_locs.append((kind, loc, fvg_conf))
    else:
        for loc in core.make_key_locations(pdm, pwm, dte, atr15, p):
            raw_locs.append(("KEY_LEVEL", loc, False))

    locs = _dedupe(raw_locs)
    out: list[ReactionDestination] = []
    for kind, loc, fvg_conf in locs:
        if not _ahead(entry, float(loc.lo), float(loc.hi), direction):
            continue
        contact = _first_contact(entry, float(loc.lo), float(loc.hi), direction)
        if contact <= 0:
            continue
        q = _liquidity_quality(loc)
        meaningful = bool(kind in {"KEY_ZONE_15M", "KEY_LEVEL"} or _structurally_meaningful_cluster(loc, p))
        out.append(ReactionDestination(
            location=loc, kind=kind, first_contact_distance=contact,
            target_raw=_cluster_target(loc, direction, float(p.tp_depth)),
            quality=q, meaningful=meaningful, fvg_confluent=fvg_conf,
        ))

    for i, f in enumerate(native_fvgs):
        if not _ahead(entry, f.lo, f.hi, direction):
            continue
        contact = _first_contact(entry, f.lo, f.hi, direction)
        if contact <= 0:
            continue
        loc = core.Location(
            id=f"NATIVE15_FVG_{f.formed_at.isoformat()}_{i}", side="B",
            lo=float(f.lo), hi=float(f.hi), mid=float(f.mid), source=FVG_SOURCE,
            quality=0.70, confluence=0, entry_authorized=False, zone=None,
        )
        cluster_overlap = any(core.overlap(loc.lo, loc.hi, x[1].lo, x[1].hi, 0.0) for x in locs)
        out.append(ReactionDestination(
            location=loc, kind="FVG_15M", first_contact_distance=contact,
            target_raw=float(f.mid), quality=0.70, meaningful=True,
            fvg_confluent=cluster_overlap,
        ))

    kind_rank = {"KEY_ZONE_15M": 0, "KEY_LEVEL": 1, "LIQUIDITY_CLUSTER": 2, "FVG_15M": 3}
    out.sort(key=lambda x: (x.first_contact_distance, kind_rank.get(x.kind, 9), -x.quality, x.location.id))
    return out


def classify_first_reaction_destination(destinations: list[ReactionDestination],
                                        entry: float, direction: str,
                                        setup: str, p: core.Params,
                                        strong_momentum: bool):
    if not destinations:
        return None, "NO_DESTINATION"
    min_room = float(p.min_room_r * p.stop)
    for d in destinations:
        if not d.meaningful:
            if d.quality > p.weak_blocker_quality and not (setup == "BRK5" and strong_momentum):
                if d.first_contact_distance < min_room:
                    return None, f"WEAK_NEAR_BLOCKER:{d.location.source}:{d.first_contact_distance:.2f}"
            continue
        if d.first_contact_distance < min_room:
            return None, f"FIRST_REACTION_TOO_CLOSE:{d.kind}:{d.location.source}:{d.first_contact_distance:.2f}"
        raw = float(d.target_raw)
        px = core.executable_target(raw, direction)
        if not core.tick_valid(px):
            raise RuntimeError(f"V24_TARGET_OFF_TICK:{px}")
        target = core.Target(
            d.location, raw, px, abs(px - entry), d.quality,
            False, True, d.kind == "FVG_15M" or d.fvg_confluent,
        )
        return target, f"FIRST_REACTION:{d.kind}"
    return None, "NO_MEANINGFUL_DESTINATION"


def build_and_classify(piv5: pd.DataFrame, full5: pd.DataFrame, h15: pd.DataFrame,
                       asof: pd.Timestamp, p: core.Params, pdm, pwm, dte,
                       entry: float, direction: str, setup: str,
                       strong_momentum: bool,
                       piv15: pd.DataFrame | None = None):
    destinations = build_reaction_destinations(
        piv5, full5, h15, asof, p, pdm, pwm, dte, entry, direction, piv15=piv15,
    )
    return classify_first_reaction_destination(destinations, entry, direction, setup, p, strong_momentum)
