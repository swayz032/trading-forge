#!/usr/bin/env python3
"""Trader-fidelity target policy for Current MNQ v2.4.

The base target builder still owns causal reaction construction, physical ordering,
15m-FVG midpoint precision, key-zone significance and executable tick rounding.
This policy changes only the final room decision after the trader's 2026-08-20
frozen replay clarification:

- TP1 is still the first meaningful physical reaction.
- If TP1 still has the frozen minimum room at the ACTUAL entry clock, TP1 wins.
- If price has already moved so close to TP1 before the A+ entry becomes actionable
  that TP1 no longer has that same frozen room, TP1 is a consumed/too-late
  destination for this entry plan and the next meaningful physical reaction may
  become TP2.
- No new threshold is introduced. Rollover reuses Params.min_room_r * Params.stop.
- A farther destination may never be chosen merely because its historical PnL is
  prettier. The only skip authority is that the nearer destination is already
  inside the frozen room requirement at the actual entry clock.

This module deliberately wraps, rather than forks, reaction construction so
historical and live/shadow paths remain on one target implementation.
"""
from __future__ import annotations

from research import current_mnq_strategy_v2_4_targets as base

core = base.core
ReactionDestination = base.ReactionDestination


def classify_first_reaction_destination(
    destinations: list[ReactionDestination],
    entry: float,
    direction: str,
    setup: str,
    p: core.Params,
    strong_momentum: bool,
):
    if not destinations:
        return None, "NO_DESTINATION"

    min_room = float(p.min_room_r * p.stop)
    rolled: list[ReactionDestination] = []

    for d in destinations:
        # Preserve the inherited weak-blocker contract. A weak structure does not
        # become TP1/TP2 merely because this policy supports target ladders.
        if not d.meaningful:
            if d.quality > p.weak_blocker_quality and not (setup == "BRK5" and strong_momentum):
                if d.first_contact_distance < min_room:
                    return None, f"WEAK_NEAR_BLOCKER:{d.location.source}:{d.first_contact_distance:.2f}"
            continue

        # New direct-trader rule: a meaningful destination that has already become
        # too close by the time the entry is actually actionable is a consumed TP
        # candidate for this trade plan. Continue in physical order to TP2/next.
        if d.first_contact_distance < min_room:
            rolled.append(d)
            continue

        raw = float(d.target_raw)
        px = core.executable_target(raw, direction)
        if not core.tick_valid(px):
            raise RuntimeError(f"V24_TARGET_OFF_TICK:{px}")

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

        if rolled:
            skipped = ",".join(f"{x.kind}:{x.location.source}" for x in rolled)
            return target, f"FIRST_REACTION_ROLLOVER:{skipped}->NEXT:{d.kind}"
        return target, f"FIRST_REACTION:{d.kind}"

    if rolled:
        skipped = ",".join(
            f"{x.kind}:{x.location.source}:{x.first_contact_distance:.2f}" for x in rolled
        )
        return None, f"ALL_MEANINGFUL_REACTIONS_TOO_CLOSE:{skipped}"
    return None, "NO_MEANINGFUL_DESTINATION"


def build_and_classify(
    piv5,
    full5,
    h15,
    asof,
    p,
    pdm,
    pwm,
    dte,
    entry: float,
    direction: str,
    setup: str,
    strong_momentum: bool,
    piv15=None,
):
    destinations = base.build_reaction_destinations(
        piv5, full5, h15, asof, p, pdm, pwm, dte, entry, direction, piv15=piv15,
    )
    return classify_first_reaction_destination(
        destinations, entry, direction, setup, p, strong_momentum,
    )
