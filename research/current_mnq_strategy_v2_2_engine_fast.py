#!/usr/bin/env python3
"""Speed-only v2.2 runtime layer.

Vectorizes the already-frozen zone lifecycle calculation. It must preserve the exact
semantics of current_mnq_strategy_v2_2_engine_runtime.zone_state_at. No thresholds,
entry rules, target rules, or performance parameters are changed here.
"""
from __future__ import annotations

from dataclasses import replace
import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_2_engine as base
from research import current_mnq_strategy_v2_2_engine_runtime as rt


def zone_state_at(zone: base.Zone, bars5: pd.DataFrame, asof: pd.Timestamp, p: base.Params) -> base.Zone:
    q = bars5[(bars5.index >= zone.created) & (bars5.index < asof)]
    if q.empty:
        return zone
    z = replace(zone)
    atr = q["atr"].to_numpy(float) if "atr" in q else np.full(len(q), np.nan)
    clear = np.where(np.isfinite(atr), p.breakout_clear_atr * atr, base.TICK * 2)
    lows = q.low.to_numpy(float); highs = q.high.to_numpy(float); closes = q.close.to_numpy(float)
    interactions = (lows <= z.hi) & (highs >= z.lo)
    if z.side == "S":
        broken = closes < (z.lo - clear)
    else:
        broken = closes > (z.hi + clear)
    hit = np.flatnonzero(broken)
    if len(hit) == 0:
        if interactions.any():
            z.state = base.ZoneState.TESTED
        return z
    bi = int(hit[0])
    original_side = z.side
    z.state = base.ZoneState.BROKEN
    later_interactions = np.flatnonzero(interactions & (np.arange(len(q)) > bi))
    if len(later_interactions):
        j = int(later_interactions[0])
        if original_side == "S" and closes[j] <= z.mid:
            z.side = "R"
            z.state = base.ZoneState.FLIPPED_RETEST
        elif original_side == "R" and closes[j] >= z.mid:
            z.side = "S"
            z.state = base.ZoneState.FLIPPED_RETEST
    return z


# Patch both modules because runtime.run_day resolves its own module-global function,
# while base.build_target_locations resolves the base-module function.
rt.zone_state_at = zone_state_at
base.zone_state_at = zone_state_at

for _name in dir(rt):
    if not _name.startswith("_") and _name not in globals():
        globals()[_name] = getattr(rt, _name)
