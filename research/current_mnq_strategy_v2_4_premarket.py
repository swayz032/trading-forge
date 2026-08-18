#!/usr/bin/env python3
"""Conditional premarket-plan equation for Current MNQ v2.4.

Premarket direction is a prior. Aligned/neutral setups may continue through the
remaining gates. A counter-plan setup may continue only when the market produces
strong contradictory evidence at a major authorized location. The kernel already
proves the appropriate candle/reversal/breakout confirmation before this function
is called, so this function never creates a setup by itself.
"""
from __future__ import annotations

from pathlib import Path
import json

from research import current_mnq_strategy_v2_3_engine as prod

core = prod.core
SPEC_PATH = Path(__file__).with_name("current_mnq_strategy_v2_4_premarket_semantics.json")


def load_premarket_spec(path: str | Path = SPEC_PATH) -> dict:
    return json.loads(Path(path).read_text())


def major_location(loc: core.Location, p: core.Params) -> bool:
    return bool(
        float(loc.quality) >= float(p.high_zone_quality)
        or int(loc.confluence) >= 2
    )


def plan_allows_v24(plan, direction: str, setup: str, story,
                    loc: core.Location, p: core.Params) -> bool:
    if direction not in {"L", "S"}:
        raise ValueError("direction must be L or S")
    if setup not in {"REV", "BRK5", "BRK15"}:
        raise ValueError("setup must be REV, BRK5 or BRK15")

    primary = str(getattr(plan, "primary", "NEUTRAL"))
    if primary == "NEUTRAL":
        return True
    aligned = (primary == "BULL" and direction == "L") or (primary == "BEAR" and direction == "S")
    if aligned:
        return True

    # Counter-plan evidence must occur at a major location. No extra numeric
    # threshold is introduced; high_zone_quality is already frozen in Params.
    if not major_location(loc, p):
        return False
    if setup == "REV":
        return bool(story is not None and getattr(story, "complete", False))

    # BRK5 and BRK15 are allowed here only because the shared kernel separately
    # requires their stronger confirmation equations before asking this question.
    return True
