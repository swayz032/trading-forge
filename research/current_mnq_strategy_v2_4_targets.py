#!/usr/bin/env python3
"""Hierarchical first-reaction take-profit engine for Current MNQ v2.4.

Trader equation:
1. The first MEANINGFUL broad reaction area by near-edge distance owns the room /
   blocker question.
2. Inside a winning frozen 15m key area, use the earliest meaningful internal 5m
   liquidity cluster or active 15m FVG as the precise TP feature when present.
3. If no internal feature exists, use the broad area's safe interior.
4. A standalone 5m cluster or FVG still competes normally when it is encountered
   before any broad key area.

This preserves both "what price reacts to first" and the trader's use of the 5m
chart for precise TP placement. No farther feature may leapfrog a nearer area for
prettier PnL.
"""
from __future__ import annotations

from dataclasses import dataclass, replace

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
PRIMARY_KINDS = {"KEY_ZONE_15M", "KEY_LEVEL"}


@dataclass(frozen=True)
class ReactionDestination:
    location: core.Location
    kind: str
    first_contact_distance: float
    target_raw: float
    quality: float
    meaningful: bool
    fvg_confluent: bool = False
    precision_source: str | None = None


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


def _inside_or_overlaps(outer: core.Location, lo: float, hi: float) -> bool:
    return core.overlap(float(outer.lo), float(outer.hi), float(lo), float(hi), 0.0)


def _precision_location(primary: core.Location, feature_source: str, feature_id: str) -> core.Location:
    return replace(
        primary,
        id=f"{primary.id}|PRECISION:{feature_id}",
        source=f"{primary.source}+{feature_source}",
    )


def _refine_primary(primary_kind: str, primary: core.Location,
                    clusters5: list[core.Location], native_fvgs: list,
                    entry: float, direction: str, p: core.Params) -> ReactionDestination:
    """Keep broad-zone contact distance, but refine TP with first internal feature."""
    broad_contact = _first_contact(entry, float(primary.lo), float(primary.hi), direction)
    broad_target = _cluster_target(primary, direction, float(p.tp_depth))
    candidates: list[tuple[float, int, float, str, str, bool]] = []

    for c in clusters5:
        if not _structurally_meaningful_cluster(c, p):
            continue
        if not _inside_or_overlaps(primary, c.lo, c.hi):
            continue
        # Internal feature ordering is still by physical near edge from entry.
        if direction == "L" and float(c.hi) <= entry:
            continue
        if direction == "S" and float(c.lo) >= entry:
            continue
        contact = max(broad_contact, max(0.0, _first_contact(entry, float(c.lo), float(c.hi), direction)))
        candidates.append((
            contact, 0, _cluster_target(c, direction, float(p.tp_depth)),
            "LIQUIDITY_CLUSTER_5M", c.id, False,
        ))

    for i, f in enumerate(native_fvgs):
        if not _inside_or_overlaps(primary, f.lo, f.hi):
            continue
        if direction == "L" and float(f.hi) <= entry:
            continue
        if direction == "S" and float(f.lo) >= entry:
            continue
        contact = max(broad_contact, max(0.0, _first_contact(entry, float(f.lo), float(f.hi), direction)))
        candidates.append((
            contact, 1, float(f.mid), "FVG_15M_NATIVE", f"FVG:{f.formed_at.isoformat()}:{i}", True,
        ))

    if not candidates:
        return ReactionDestination(
            location=primary, kind=primary_kind,
            first_contact_distance=broad_contact, target_raw=broad_target,
            quality=_liquidity_quality(primary), meaningful=True,
            fvg_confluent=False, precision_source=None,
        )

    # On an exact near-edge tie, 5m cluster gets precision priority because the
    # trader explicitly uses 5m for precise TP. This tie-break never moves target
    # selection to a feature contacted later.
    contact, _, raw, source, feature_id, is_fvg = sorted(candidates, key=lambda x: (x[0], x[1], x[4]))[0]
    loc = _precision_location(primary, source, feature_id)
    return ReactionDestination(
        location=loc,
        kind=f"{primary_kind}_REFINED_{source}",
        first_contact_distance=broad_contact,
        target_raw=float(raw),
        quality=_liquidity_quality(primary),
        meaningful=True,
        fvg_confluent=bool(is_fvg),
        precision_source=source,
    )


def _dedupe_standalone_clusters(clusters: list[core.Location], primaries: list[core.Location]) -> list[core.Location]:
    # If a 5m cluster is inside a frozen HTF/key area, it is retained as internal
    # precision evidence but not emitted again as a competing standalone area.
    out = []
    for c in clusters:
        if any(_inside_or_overlaps(p, c.lo, c.hi) for p in primaries):
            continue
        out.append(c)
    return out


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

    zones5 = core.build_zones(piv5, full5, asof, p, look_days=25)
    zones5 = [zone_state_at_v24(z, full5, asof, p) for z in zones5]
    zones5 = core.enrich_confluence(zones5, refs, native_fvgs, atr15, p)
    clusters5 = core.zone_locations([z for z in zones5 if z.active])

    primaries: list[tuple[str, core.Location]] = []
    if piv15 is not None:
        open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
        level_env = {"h15": h15, "piv15": piv15, "full5": full5, "pdm": pdm, "pwm": pwm}
        primary_locs, _ = build_entry_locations_v24(level_env, dte, open_ts, p)
        for loc in primary_locs:
            kind = "KEY_LEVEL" if loc.source in KEY_SOURCES else "KEY_ZONE_15M"
            primaries.append((kind, loc))
    else:
        primaries.extend(("KEY_LEVEL", loc) for loc in core.make_key_locations(pdm, pwm, dte, atr15, p))

    out: list[ReactionDestination] = []
    primary_locs_only = [x[1] for x in primaries]
    for kind, loc in primaries:
        if not _ahead(entry, float(loc.lo), float(loc.hi), direction):
            continue
        d = _refine_primary(kind, loc, clusters5, native_fvgs, entry, direction, p)
        if d.first_contact_distance > 0:
            out.append(d)

    for loc in _dedupe_standalone_clusters(clusters5, primary_locs_only):
        if not _ahead(entry, float(loc.lo), float(loc.hi), direction):
            continue
        contact = _first_contact(entry, float(loc.lo), float(loc.hi), direction)
        if contact <= 0:
            continue
        fvg_conf = any(core.overlap(loc.lo, loc.hi, f.lo, f.hi, tol) for f in native_fvgs)
        out.append(ReactionDestination(
            location=loc, kind="LIQUIDITY_CLUSTER",
            first_contact_distance=contact,
            target_raw=_cluster_target(loc, direction, float(p.tp_depth)),
            quality=_liquidity_quality(loc),
            meaningful=_structurally_meaningful_cluster(loc, p),
            fvg_confluent=fvg_conf,
            precision_source="LIQUIDITY_CLUSTER_5M",
        ))

    # FVGs nested inside a primary have already been considered as internal
    # precision features. Emit only standalone FVGs here.
    for i, f in enumerate(native_fvgs):
        if any(_inside_or_overlaps(p0, f.lo, f.hi) for p0 in primary_locs_only):
            continue
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
        out.append(ReactionDestination(
            location=loc, kind="FVG_15M", first_contact_distance=contact,
            target_raw=float(f.mid), quality=0.70, meaningful=True,
            fvg_confluent=True, precision_source="FVG_15M_NATIVE",
        ))

    # The broad near-edge remains the decisive ordering distance even when TP is
    # refined deeper inside that area.
    kind_rank = {
        "KEY_ZONE_15M": 0, "KEY_LEVEL": 1,
        "KEY_ZONE_15M_REFINED_LIQUIDITY_CLUSTER_5M": 0,
        "KEY_LEVEL_REFINED_LIQUIDITY_CLUSTER_5M": 1,
        "KEY_ZONE_15M_REFINED_FVG_15M_NATIVE": 0,
        "KEY_LEVEL_REFINED_FVG_15M_NATIVE": 1,
        "LIQUIDITY_CLUSTER": 2, "FVG_15M": 3,
    }
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
            False, True, bool(d.fvg_confluent),
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
