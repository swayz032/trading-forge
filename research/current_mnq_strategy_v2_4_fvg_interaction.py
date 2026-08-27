#!/usr/bin/env python3
"""Causal 15m-FVG support/resistance interaction locations for MNQ v2.4.

Direct trader clarification, 2026-08-20:
- an FVG may itself be the support/resistance interaction area;
- bearish price action may reject an FVG acting as resistance and push away;
- bullish price action confronting that resistance FVG must disrespect/clear it;
- mirror the rule for bullish FVG support versus bearish clearance;
- the FVG never authorizes a trade by itself: normal candle-story + live-force
  or normal breakout proof remains mandatory.

Only completed, still-active 15m FVGs are exposed. A bullish native FVG is a
potential support band; a bearish native FVG is a potential resistance band.
The existing kernel decides whether price actually rejects, breaks, retests or
fails at the band.
"""
from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_3_engine as v23
from research.current_mnq_strategy_v2_4_fvg import active_15m_fvgs
from src.engine.indicators.fvg_native import BULLISH, BEARISH

core = v23.core
FVG_INTERACTION_SOURCE = "FVG_15M_CAUSAL_INTERACTION"
FVG_INTERACTION_QUALITY = 0.70


def active_fvg_interaction_locations(h15: pd.DataFrame, asof: pd.Timestamp) -> list[core.Location]:
    """Map active completed-15m FVGs to potential S/R locations.

    `entry_authorized=True` means the band may participate in the normal location
    gate. It does NOT bypass the downstream candle-story, force, room, first-A+
    or daily-bullet gates.
    """
    out: list[core.Location] = []
    for f in active_15m_fvgs(h15, asof):
        if f.direction == BULLISH:
            side = "S"
        elif f.direction == BEARISH:
            side = "R"
        else:
            raise RuntimeError(f"V24_UNKNOWN_FVG_DIRECTION:{f.direction}")
        out.append(core.Location(
            id=f"FVG15:{f.direction}:{f.formed_at.isoformat()}:{round(float(f.mid)/core.TICK)}",
            side=side,
            lo=float(f.lo),
            hi=float(f.hi),
            mid=float(f.mid),
            source=FVG_INTERACTION_SOURCE,
            quality=float(FVG_INTERACTION_QUALITY),
            confluence=0,
            entry_authorized=True,
            zone=None,
        ))
    return sorted(out, key=lambda x: (x.mid, x.id))
