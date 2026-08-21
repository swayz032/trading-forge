#!/usr/bin/env python3
"""Trader-fidelity target policy for Current MNQ v2.4.

The base target builder owns causal reaction construction, physical ordering,
S/R reaction significance, 5m liquidity/reaction clusters, 15m-FVG midpoint
precision and executable tick rounding. PDH/PDL/PWH/PWL are forbidden and are
never passed into reaction construction by this wrapper.

This layer owns the trader's direct TP-display entry-gap rule:

- TP1 is still the first meaningful physical reaction.
- The trader may enter with TP1 nearby when the planned TP display still represents
  at least $400 at the frozen 15-MNQ reference size.
- The strategy stores that rule as a size-invariant price-distance test: planned
  target distance * $2/MNQ-point * 15 reference contracts >= $400. Runtime risk
  sizing therefore cannot silently change signal semantics.
- If the planned TP1 display is under $400, the immediate entry is blocked. A
  farther TP2 may NOT be selected merely because it has more room.
- TP1 may be skipped only when the CURRENT candidate is itself a valid continuation
  through that same physical reaction area using an already-approved reaction/test
  path: repeat-test momentum, completed first-break follow-through, or weak-break
  pullback 15m-bar3 continuation. The true-displacement prebreak exception alone
  does not prove that a too-close TP1 was processed.
- Structural weak-blocker handling remains on the inherited frozen room equation;
  this $400 rule is specifically the trader's planned-TP display gap, not a rewrite
  of every room/blocker threshold in the strategy.

This module deliberately wraps, rather than forks, reaction construction so
historical and live/shadow paths remain on one target implementation.
"""
from __future__ import annotations

from research import current_mnq_strategy_v2_4_targets as base

core = base.core
ReactionDestination = base.ReactionDestination

TP_GAP_REFERENCE_USD = 400.0
TP_GAP_REFERENCE_CONTRACTS = 15
TP_GAP_POINT_VALUE_USD = float(core.POINT_VALUE)
PROCESSED_REACTION_REASONS = frozenset({
    "PREBREAK_REPEAT_TEST_INTRA5_FORCE",
    "FIRST_BREAK_PRINT_THEN_INTRA5_FORCE",
    "WEAK_BREAK_PULLBACK_15M_BAR3_INTRA_FORCE",
})


def reference_tp_reward_usd(target_distance_points: float) -> float:
    """Trader's TP display normalized to the frozen 15-MNQ reference size."""
    return float(target_distance_points) * TP_GAP_POINT_VALUE_USD * TP_GAP_REFERENCE_CONTRACTS


def _overlap(a, b) -> bool:
    if a is None or b is None:
        return False
    return max(float(a.lo), float(b.lo)) <= min(float(a.hi), float(b.hi))


def _current_candidate_processed_reaction(
    d: ReactionDestination,
    setup: str,
    entry_location,
    candidate_reason: str | None,
) -> bool:
    """True only when this candidate earned continuation at the TP1 area itself."""
    if setup not in {"BRK5", "BRK15"}:
        return False
    if candidate_reason not in PROCESSED_REACTION_REASONS:
        return False
    return _overlap(entry_location, d.location)


def classify_first_reaction_destination(
    destinations: list[ReactionDestination],
    entry: float,
    direction: str,
    setup: str,
    p: core.Params,
    strong_momentum: bool,
    entry_location=None,
    candidate_reason: str | None = None,
):
    if not destinations:
        return None, "NO_DESTINATION"

    structural_min_room = float(p.min_room_r * p.stop)
    processed: list[ReactionDestination] = []

    for d in destinations:
        if not d.meaningful:
            if d.quality > p.weak_blocker_quality and not (setup == "BRK5" and strong_momentum):
                if d.first_contact_distance < structural_min_room:
                    return None, f"WEAK_NEAR_BLOCKER:{d.location.source}:{d.first_contact_distance:.2f}"
            continue

        if _current_candidate_processed_reaction(
            d, setup, entry_location, candidate_reason,
        ):
            processed.append(d)
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

        reference_reward = reference_tp_reward_usd(actual_target_distance)
        if reference_reward + 1e-9 < TP_GAP_REFERENCE_USD:
            return None, (
                f"TP1_REFERENCE_REWARD_UNDER_400:{reference_reward:.2f}:"
                f"{d.kind}:{d.location.source}"
            )

        target = core.Target(
            d.location, raw, px, actual_target_distance, d.quality,
            False, True, bool(d.fvg_confluent),
        )
        target.kind = d.kind
        target.first_contact_distance = float(d.first_contact_distance)
        target.reference_tp_reward_usd = float(reference_reward)

        if processed:
            skipped = ",".join(f"{x.kind}:{x.location.source}" for x in processed)
            return target, f"PROCESSED_REACTION_ROLLOVER:{skipped}->NEXT:{d.kind}"
        return target, f"FIRST_REACTION:{d.kind}"

    if processed:
        skipped = ",".join(f"{x.kind}:{x.location.source}" for x in processed)
        return None, f"PROCESSED_REACTION_NO_NEXT_DESTINATION:{skipped}"
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
    entry_location=None,
    candidate_reason: str | None = None,
):
    # pdm/pwm remain API-compatibility parameters only. The current strategy's
    # reaction map is closed to named daily/weekly levels, so force empty maps.
    destinations = base.build_reaction_destinations(
        piv5, full5, h15, asof, p, {}, {}, dte, entry, direction, piv15=piv15,
    )
    return classify_first_reaction_destination(
        destinations, entry, direction, setup, p, strong_momentum,
        entry_location=entry_location,
        candidate_reason=candidate_reason,
    )
