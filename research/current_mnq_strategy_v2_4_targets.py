#!/usr/bin/env python3
"""Hierarchical first-reaction take-profit engine for Current MNQ v2.4.

Direct trader fidelity scope (2026-08-20): TP construction uses only structural
support/resistance reaction zones, 5m liquidity/reaction clusters, and active 15m
FVGs. PDH/PDL/PWH/PWL are legacy inputs retained only in the function signature
for compatibility and are deliberately ignored.

Trader equation:
1. The first MEANINGFUL reaction area by physical near edge owns the room/blocker
   question.
2. A broad 15m S/R area may use an internal 5m liquidity/reaction cluster or
   active 15m FVG for precise TP only when that feature does NOT protrude toward
   entry.
3. When an FVG owns the first meaningful destination, TP is the FVG midpoint.
4. Internal precision is clipped to the geometric INTERSECTION with the broad
   S/R area, so a refined target can never escape the area that won first reaction.
5. A feature that protrudes toward entry remains a standalone earlier reaction and
   competes using its true near edge.
6. TP/reaction significance is intentionally distinct from entry authorization:
   an active 15m S/R zone with >=2 independent rejections and minimum structural
   quality may block/refine a target even when it is not authorized as a fresh
   A+ entry.

No farther feature may leapfrog a nearer meaningful reaction area for prettier PnL.
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
    # No bonus exists for inherited named daily/weekly levels. Quality comes only
    # from the structural S/R or reaction cluster plus active FVG confluence.
    conf_bonus = 0.05 * min(int(loc.confluence), 2)
    return float(np.clip(float(loc.quality) + conf_bonus, 0.0, 1.0))


def _ahead(entry: float, lo: float, hi: float, direction: str) -> bool:
    return bool(lo > entry) if direction == "L" else bool(hi < entry)


def _first_contact(entry: float, lo: float, hi: float, direction: str) -> float:
    return float(lo - entry) if direction == "L" else float(entry - hi)


def _interval_target(lo: float, hi: float, direction: str, depth: float) -> float:
    if direction == "L":
        return float(lo + depth * (hi - lo))
    return float(hi - depth * (hi - lo))


def _cluster_target(loc: core.Location, direction: str, depth: float) -> float:
    return _interval_target(float(loc.lo), float(loc.hi), direction, depth)


def _structurally_meaningful_cluster(loc: core.Location, p: core.Params) -> bool:
    z = getattr(loc, "zone", None)
    if z is None:
        return False
    return bool(int(getattr(z, "touches", 0)) >= 2 and float(loc.quality) >= float(p.min_zone_quality))


def _target_only_15m_locations(zones: list[core.Zone],
                               existing_ids: set[str],
                               p: core.Params) -> list[core.Location]:
    """Keep meaningful 15m S/R reactions even when entry authorization is stricter."""
    out: list[core.Location] = []
    for z in zones:
        if z is None or not z.active or z.id in existing_ids:
            continue
        if int(getattr(z, "touches", 0)) < 2:
            continue
        if float(getattr(z, "quality", 0.0)) < float(p.min_zone_quality):
            continue
        out.append(core.Location(
            id=z.id, side=z.side, lo=float(z.lo), hi=float(z.hi), mid=float(z.mid),
            source=z.source, quality=float(z.quality), confluence=int(z.confluence),
            entry_authorized=False, zone=z,
        ))
    return out


def _intersection(primary: core.Location, lo: float, hi: float) -> tuple[float, float] | None:
    ilo = max(float(primary.lo), float(lo))
    ihi = min(float(primary.hi), float(hi))
    if ilo > ihi:
        return None
    return float(ilo), float(ihi)


def _protrudes_toward_entry(primary: core.Location, lo: float, hi: float,
                            direction: str) -> bool:
    """True when feature starts closer to entry than the broad S/R area."""
    if direction == "L":
        return float(lo) < float(primary.lo)
    return float(hi) > float(primary.hi)


def _is_internal_feature(primary: core.Location, lo: float, hi: float,
                         direction: str) -> bool:
    return bool(
        _intersection(primary, lo, hi) is not None
        and not _protrudes_toward_entry(primary, lo, hi, direction)
    )


def _precision_location(primary: core.Location, feature_source: str, feature_id: str,
                        lo: float, hi: float) -> core.Location:
    return replace(
        primary,
        id=f"{primary.id}|PRECISION:{feature_id}",
        lo=float(lo), hi=float(hi), mid=float((lo + hi) / 2.0),
        source=f"{primary.source}+{feature_source}",
    )


def _refine_primary(primary_kind: str, primary: core.Location,
                    clusters5: list[core.Location], native_fvgs: list,
                    entry: float, direction: str, p: core.Params) -> ReactionDestination:
    """Refine a broad S/R area only with features that begin no earlier than it."""
    broad_contact = _first_contact(entry, float(primary.lo), float(primary.hi), direction)
    broad_target = _cluster_target(primary, direction, float(p.tp_depth))
    # contact, kind-priority, target, source, id, is_fvg, intersection_lo, intersection_hi
    candidates: list[tuple[float, int, float, str, str, bool, float, float]] = []

    for c in clusters5:
        if not _structurally_meaningful_cluster(c, p):
            continue
        if not _is_internal_feature(primary, c.lo, c.hi, direction):
            continue
        inter = _intersection(primary, c.lo, c.hi)
        assert inter is not None
        ilo, ihi = inter
        if direction == "L" and ihi <= entry:
            continue
        if direction == "S" and ilo >= entry:
            continue
        contact = max(0.0, _first_contact(entry, ilo, ihi, direction))
        if contact < broad_contact - 1e-9:
            raise RuntimeError("V24_INTERNAL_CLUSTER_CONTACT_PRECEDES_PRIMARY")
        candidates.append((
            contact, 0, _interval_target(ilo, ihi, direction, float(p.tp_depth)),
            "LIQUIDITY_CLUSTER_5M", c.id, False, ilo, ihi,
        ))

    for i, f in enumerate(native_fvgs):
        if not _is_internal_feature(primary, f.lo, f.hi, direction):
            continue
        inter = _intersection(primary, f.lo, f.hi)
        assert inter is not None
        ilo, ihi = inter
        if direction == "L" and ihi <= entry:
            continue
        if direction == "S" and ilo >= entry:
            continue
        contact = max(0.0, _first_contact(entry, ilo, ihi, direction))
        if contact < broad_contact - 1e-9:
            raise RuntimeError("V24_INTERNAL_FVG_CONTACT_PRECEDES_PRIMARY")
        candidates.append((
            contact, 1, float((ilo + ihi) / 2.0), "FVG_15M_NATIVE",
            f"FVG:{f.formed_at.isoformat()}:{i}", True, ilo, ihi,
        ))

    if not candidates:
        return ReactionDestination(
            location=primary, kind=primary_kind,
            first_contact_distance=broad_contact, target_raw=broad_target,
            quality=_liquidity_quality(primary), meaningful=True,
            fvg_confluent=False, precision_source=None,
        )

    # Internal ordering remains physical. Exact contact ties prefer 5m precision
    # because the trader uses 5m for precise reaction/liquidity TP placement.
    contact, _, raw, source, feature_id, is_fvg, ilo, ihi = sorted(
        candidates, key=lambda x: (x[0], x[1], x[4])
    )[0]
    loc = _precision_location(primary, source, feature_id, ilo, ihi)
    if direction == "L" and not (float(primary.lo) <= raw <= float(primary.hi)):
        raise RuntimeError("V24_REFINED_LONG_TARGET_ESCAPED_PRIMARY")
    if direction == "S" and not (float(primary.lo) <= raw <= float(primary.hi)):
        raise RuntimeError("V24_REFINED_SHORT_TARGET_ESCAPED_PRIMARY")
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


def _dedupe_standalone_clusters(clusters: list[core.Location], primaries: list[core.Location],
                                direction: str) -> list[core.Location]:
    """Suppress only truly internal clusters; protruding overlaps stay standalone."""
    out = []
    for c in clusters:
        if any(_is_internal_feature(p, c.lo, c.hi, direction) for p in primaries):
            continue
        out.append(c)
    return out


def _fvg_is_internal_to_any(f, primaries: list[core.Location], direction: str) -> bool:
    return any(_is_internal_feature(p, f.lo, f.hi, direction) for p in primaries)


def build_reaction_destinations(piv5: pd.DataFrame, full5: pd.DataFrame,
                                h15: pd.DataFrame, asof: pd.Timestamp,
                                p: core.Params, pdm, pwm, dte,
                                entry: float, direction: str,
                                piv15: pd.DataFrame | None = None) -> list[ReactionDestination]:
    if direction not in {"L", "S"}:
        raise ValueError("direction must be L or S")

    # pdm/pwm are intentionally ignored. They remain arguments only so inherited
    # callers do not need a simultaneous API migration.
    native_fvgs = active_15m_fvgs(h15, asof)
    a15 = h15[h15.index + pd.Timedelta(minutes=15) <= asof].atr.tail(20).median()
    atr15 = float(a15) if np.isfinite(a15) else 20.0
    tol = max(TICK * 4, p.fvg_overlap_atr * atr15)

    zones5 = core.build_zones(piv5, full5, asof, p, look_days=25)
    zones5 = [zone_state_at_v24(z, full5, asof, p) for z in zones5]
    zones5 = core.enrich_confluence(zones5, [], native_fvgs, atr15, p)
    clusters5 = core.zone_locations([z for z in zones5 if z.active])

    primaries: list[tuple[str, core.Location]] = []
    if piv15 is not None:
        open_ts = pd.Timestamp(f"{dte} 09:30", tz=core.TZ)
        level_env = {"h15": h15, "piv15": piv15, "full5": full5}
        primary_locs, primary_zones = build_entry_locations_v24(level_env, dte, open_ts, p)
        # Entry authorization is intentionally stricter than reaction relevance.
        # Add established active 15m S/R zones that remain meaningful TP blockers.
        existing = {loc.id for loc in primary_locs}
        primary_locs = list(primary_locs) + _target_only_15m_locations(primary_zones, existing, p)
        primaries.extend(("KEY_ZONE_15M", loc) for loc in primary_locs)

    out: list[ReactionDestination] = []
    primary_locs_only = [x[1] for x in primaries]
    for kind, loc in primaries:
        if not _ahead(entry, float(loc.lo), float(loc.hi), direction):
            continue
        d = _refine_primary(kind, loc, clusters5, native_fvgs, entry, direction, p)
        if d.first_contact_distance > 0:
            out.append(d)

    for loc in _dedupe_standalone_clusters(clusters5, primary_locs_only, direction):
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

    # Suppress only truly internal FVGs already used for S/R refinement. An FVG
    # that appears before the S/R zone remains a standalone earlier reaction and
    # therefore wins by physical first contact. Its TP is always its midpoint.
    for i, f in enumerate(native_fvgs):
        if _fvg_is_internal_to_any(f, primary_locs_only, direction):
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

    kind_rank = {
        "KEY_ZONE_15M": 0,
        "KEY_ZONE_15M_REFINED_LIQUIDITY_CLUSTER_5M": 0,
        "KEY_ZONE_15M_REFINED_FVG_15M_NATIVE": 0,
        "LIQUIDITY_CLUSTER": 1,
        "FVG_15M": 2,
    }
    out.sort(key=lambda x: (
        x.first_contact_distance, kind_rank.get(x.kind, 9), -x.quality, x.location.id,
    ))
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
        # Defensive invariant: precise TP itself may never be closer than the
        # reaction-area contact distance used to justify room.
        actual_target_distance = abs(float(px) - float(entry))
        if actual_target_distance + 1e-9 < float(d.first_contact_distance):
            raise RuntimeError(
                f"V24_TARGET_DISTANCE_LT_REACTION_CONTACT:{actual_target_distance:.4f}<"
                f"{d.first_contact_distance:.4f}"
            )
        target = core.Target(
            d.location, raw, px, actual_target_distance, d.quality,
            False, True, bool(d.fvg_confluent),
        )
        target.kind = d.kind
        target.first_contact_distance = float(d.first_contact_distance)
        return target, f"FIRST_REACTION:{d.kind}"
    return None, "NO_MEANINGFUL_DESTINATION"


def build_and_classify(piv5: pd.DataFrame, full5: pd.DataFrame, h15: pd.DataFrame,
                       asof: pd.Timestamp, p: core.Params, pdm, pwm, dte,
                       entry: float, direction: str, setup: str,
                       strong_momentum: bool,
                       piv15: pd.DataFrame | None = None):
    destinations = build_reaction_destinations(
        piv5, full5, h15, asof, p, {}, {}, dte, entry, direction, piv15=piv15,
    )
    return classify_first_reaction_destination(destinations, entry, direction, setup, p, strong_momentum)
