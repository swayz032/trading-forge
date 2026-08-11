"""Canonical cross-timeframe reaction-shelf merger for Slumdawg.

This is the deterministic semantic oracle for Pine/FXR parity.  Candidate zones
are fused into physical reaction shelves before TP numbering.  The final TP is
always placed *inside* the selected shelf.  Context decides whether that means
the shelf midpoint (move aligned with BIG DIRECTION) or the safer near-middle
portion (temporary/countertrend move).
"""
from __future__ import annotations

from math import ceil, floor, isfinite
from typing import Iterable, Optional, Tuple

from .reaction_cluster_selector import ReactionCluster, TargetLevel


def target_depth_for_context(*, big_direction: int, current_move: int, safe_fraction: float) -> float:
    """Return the deterministic inside-zone depth for the current market context.

    BIG DIRECTION aligned with CURRENT MOVE -> exact reaction-zone midpoint.
    Otherwise -> user-configured safer near-middle depth (strictly below 0.5).
    """
    if big_direction not in {-1, 0, 1} or current_move not in {-1, 0, 1}:
        raise ValueError("directions must be -1, 0, or 1")
    if not isfinite(safe_fraction) or not 0.0 < safe_fraction < 0.5:
        raise ValueError("safe_fraction must be finite and in (0, 0.5)")
    return 0.5 if big_direction != 0 and current_move == big_direction else safe_fraction


def canonicalize_target_shelves(ladders: Iterable[Iterable[TargetLevel]], *, fusion_gap: float) -> Tuple[ReactionCluster, ...]:
    if not isfinite(fusion_gap) or fusion_gap < 0:
        raise ValueError("fusion_gap must be finite and non-negative")
    clusters = [level.cluster for ladder in ladders for level in ladder]
    if not clusters:
        return ()
    ordered = sorted(clusters, key=lambda c: (c.lower, c.upper, c.member_ids))
    out = []
    cur_lo = ordered[0].lower
    cur_hi = ordered[0].upper
    cur_ids = set(ordered[0].member_ids)
    for cluster in ordered[1:]:
        if cluster.lower <= cur_hi + fusion_gap:
            cur_lo = min(cur_lo, cluster.lower)
            cur_hi = max(cur_hi, cluster.upper)
            cur_ids.update(cluster.member_ids)
        else:
            ids = tuple(sorted(cur_ids))
            out.append(ReactionCluster(cur_lo, cur_hi, len(ids), ids))
            cur_lo, cur_hi, cur_ids = cluster.lower, cluster.upper, set(cluster.member_ids)
    ids = tuple(sorted(cur_ids))
    out.append(ReactionCluster(cur_lo, cur_hi, len(ids), ids))
    return tuple(out)


def _strict_inside_target(cluster: ReactionCluster, *, side: str, penetration_fraction: float, tick: float) -> Optional[TargetLevel]:
    if side not in {"LONG", "SHORT"}:
        raise ValueError("side must be LONG or SHORT")
    if not 0.0 < penetration_fraction <= 0.5:
        raise ValueError("penetration_fraction must be in (0, 0.5]")
    if not isfinite(tick) or tick <= 0:
        raise ValueError("tick must be finite and positive")
    min_inside = cluster.lower + tick
    max_inside = cluster.upper - tick
    if min_inside > max_inside + 1e-12:
        return None
    if side == "LONG":
        raw = cluster.lower + cluster.width * penetration_fraction
        rounded = floor((raw + 1e-12) / tick) * tick
    else:
        raw = cluster.upper - cluster.width * penetration_fraction
        rounded = ceil((raw - 1e-12) / tick) * tick
    price = min(max(rounded, min_inside), max_inside)
    return TargetLevel(cluster, raw, price)


def select_canonical_target_ladder(
    ladders: Iterable[Iterable[TargetLevel]], *, side: str, entry: float,
    entry_gap: float, zone_gap: float, fusion_gap: float,
    penetration_fraction: float, tick: float, max_targets: int = 3,
) -> Tuple[TargetLevel, ...]:
    """Fuse all candidate shelves first, then rank one TP per physical shelf.

    Distance only rejects/sequences already-qualified shelves.  It never creates a
    TP price; the displayed TP is computed from the chosen shelf geometry.
    """
    if side not in {"LONG", "SHORT"}:
        raise ValueError("side must be LONG or SHORT")
    if not isfinite(entry) or entry <= 0:
        raise ValueError("entry must be finite and positive")
    if min(entry_gap, zone_gap, fusion_gap) < 0:
        raise ValueError("gaps must be non-negative")
    if max_targets < 1:
        raise ValueError("max_targets must be >= 1")
    canonical_gap = max(zone_gap, fusion_gap)
    shelves = canonicalize_target_shelves(ladders, fusion_gap=canonical_gap)
    eligible = []
    for shelf in shelves:
        if side == "LONG":
            if shelf.lower < entry + entry_gap:
                continue
            distance = shelf.lower - entry
        else:
            if shelf.upper > entry - entry_gap:
                continue
            distance = entry - shelf.upper
        target = _strict_inside_target(
            shelf,
            side=side,
            penetration_fraction=penetration_fraction,
            tick=tick,
        )
        if target is not None:
            eligible.append((distance, target))
    eligible.sort(key=lambda item: item[0])
    return tuple(target for _, target in eligible[:max_targets])
