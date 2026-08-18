#!/usr/bin/env python3
"""First-reaction take-profit engine for Current MNQ v2.4.

Trader rule:
  Look forward from entry in the trade direction. The first MEANINGFUL reaction
  area gets priority. If a meaningful liquidity/key-level cluster is before an
  active 15m FVG, target the cluster. If the active 15m FVG is before the next
  meaningful cluster, target the FVG. FVG TP is its middle. A strong reaction
  area that is too close for required room cancels the trade; it is never silently
  skipped just to reach a prettier/farther target.

Important: ordering is by the NEAR EDGE of each reaction area (the first price
that can be contacted), not by its midpoint. The midpoint is used only after a
reaction area has been selected.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as v23
from research.current_mnq_strategy_v2_4_fvg import active_15m_fvgs

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
    # Existing safe-interior parameter is semantic, not optimized here. At the
    # frozen base it is 0.50. Longs approach from below; shorts approach above.
    if direction == "L":
        return float(loc.lo + depth * (loc.hi - loc.lo))
    return float(loc.hi - depth * (loc.hi - loc.lo))


def build_reaction_destinations(piv5: pd.DataFrame, full5: pd.DataFrame,
                                h15: pd.DataFrame, asof: pd.Timestamp,
                                p: core.Params, pdm, pwm, dte,
                                entry: float, direction: str) -> list[ReactionDestination]:
    """Build causal reaction areas using native FVG identity + existing level map."""
    if direction not in {"L", "S"}:
        raise ValueError("direction must be L or S")

    # Liquidity/reaction clusters and key levels. Deliberately pass NO FVGs into
    # enrich_confluence: v2.4 FVG identity comes exclusively from fvg_native.
    zones = core.build_zones(piv5, full5, asof, p, look_days=25)
    zones = [core.zone_state_at(z, full5, asof, p) for z in zones]
    a15 = h15[h15.index + pd.Timedelta(minutes=15) <= asof].atr.tail(20).median()
    atr15 = float(a15) if np.isfinite(a15) else 20.0
    refs: list[float] = []
    if dte in pdm:
        refs += list(pdm[dte])
    if pwm.get(dte):
        refs += list(pwm[dte])
    zones = core.enrich_confluence(zones, refs, [], atr15, p)
    locs = core.zone_locations([z for z in zones if z.active])
    locs += core.make_key_locations(pdm, pwm, dte, atr15, p)

    native_fvgs = active_15m_fvgs(h15, asof)
    out: list[ReactionDestination] = []

    # Existing level/cluster destinations.
    for loc in locs:
        if not _ahead(entry, float(loc.lo), float(loc.hi), direction):
            continue
        contact = _first_contact(entry, float(loc.lo), float(loc.hi), direction)
        if contact <= 0:
            continue
        q = _liquidity_quality(loc)
        meaningful = bool(q >= 0.62 or loc.source in KEY_SOURCES)
        raw = _cluster_target(loc, direction, float(p.tp_depth))
        fvg_conf = any(core.overlap(loc.lo, loc.hi, f.lo, f.hi, 0.0) for f in native_fvgs)
        out.append(ReactionDestination(
            location=loc,
            kind="KEY_LEVEL" if loc.source in KEY_SOURCES else "LIQUIDITY_CLUSTER",
            first_contact_distance=contact,
            target_raw=raw,
            quality=q,
            meaningful=meaningful,
            fvg_confluent=fvg_conf,
        ))

    # Native active/unmitigated 15m FVG destinations. FVG direction describes
    # how the imbalance formed; for TP selection the relevant fact is whether
    # the reaction area lies ahead of the current trade.
    for i, f in enumerate(native_fvgs):
        if not _ahead(entry, f.lo, f.hi, direction):
            continue
        contact = _first_contact(entry, f.lo, f.hi, direction)
        if contact <= 0:
            continue
        loc = core.Location(
            id=f"NATIVE15_FVG_{f.formed_at.isoformat()}_{i}",
            side="B",
            lo=float(f.lo),
            hi=float(f.hi),
            mid=float(f.mid),
            source=FVG_SOURCE,
            quality=0.70,
            confluence=0,
            entry_authorized=False,
            zone=None,
        )
        cluster_overlap = any(core.overlap(loc.lo, loc.hi, x.lo, x.hi, 0.0) for x in locs)
        out.append(ReactionDestination(
            location=loc,
            kind="FVG_15M",
            first_contact_distance=contact,
            target_raw=float(f.mid),
            quality=0.70,
            meaningful=True,
            fvg_confluent=cluster_overlap,
        ))

    # First area price can physically contact wins. Deterministic tie-breaking
    # prefers an actual liquidity/key cluster over a standalone FVG at the exact
    # same near edge, because both describe the same first reaction neighborhood.
    kind_rank = {"KEY_LEVEL": 0, "LIQUIDITY_CLUSTER": 1, "FVG_15M": 2}
    out.sort(key=lambda x: (
        x.first_contact_distance,
        kind_rank.get(x.kind, 9),
        x.location.lo,
        x.location.hi,
        x.location.id,
    ))
    return out


def classify_first_reaction_destination(destinations: list[ReactionDestination],
                                        entry: float, direction: str,
                                        setup: str, p: core.Params,
                                        strong_momentum: bool):
    """Select the trader's first meaningful reaction destination, fail-closed."""
    if not destinations:
        return None, "NO_DESTINATION"
    min_room = float(p.min_room_r * p.stop)

    for d in destinations:
        # Weak visual shelves are not a meaningful reaction destination and may
        # be ignored, preserving the trader's rule to skip tiny/noisy shelves.
        if not d.meaningful:
            if d.quality > p.weak_blocker_quality and not (setup == "BRK5" and strong_momentum):
                if d.first_contact_distance < min_room:
                    return None, f"WEAK_NEAR_BLOCKER:{d.location.source}:{d.first_contact_distance:.2f}"
            continue

        # A meaningful FVG/cluster/key-level is the first real reaction risk.
        # If there is not enough room to it, there is no A+ trade; do not jump
        # over it to manufacture a farther target.
        if d.first_contact_distance < min_room:
            return None, f"FIRST_REACTION_TOO_CLOSE:{d.kind}:{d.location.source}:{d.first_contact_distance:.2f}"

        raw = float(d.target_raw)
        px = core.executable_target(raw, direction)
        if not core.tick_valid(px):
            raise RuntimeError(f"V24_TARGET_OFF_TICK:{px}")
        target = core.Target(
            d.location,
            raw,
            px,
            abs(px - entry),
            d.quality,
            False,
            True,
            d.kind == "FVG_15M" or d.fvg_confluent,
        )
        return target, f"FIRST_REACTION:{d.kind}"

    return None, "NO_MEANINGFUL_DESTINATION"


def build_and_classify(piv5: pd.DataFrame, full5: pd.DataFrame, h15: pd.DataFrame,
                       asof: pd.Timestamp, p: core.Params, pdm, pwm, dte,
                       entry: float, direction: str, setup: str,
                       strong_momentum: bool):
    destinations = build_reaction_destinations(
        piv5, full5, h15, asof, p, pdm, pwm, dte, entry, direction,
    )
    return classify_first_reaction_destination(
        destinations, entry, direction, setup, p, strong_momentum,
    )
