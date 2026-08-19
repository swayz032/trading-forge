#!/usr/bin/env python3
"""Final semantic composition layer for MNQ v2.2.

This module composes:
- the frozen v2.2 engine,
- runtime breakout-state corrections,
- gold-set failed-breakout/reclaim lifecycle semantics.

It intentionally does NOT rerun or optimize the contaminated Jan-Apr development
P&L. Future performance tests must use roll-correct new data.
"""
from __future__ import annotations

import pandas as pd

from research import current_mnq_strategy_v2_2_engine as base
from research import current_mnq_strategy_v2_2_engine_runtime as rt
from research import current_mnq_strategy_v2_2_gold_lifecycle as gold

_HTF_CACHE: dict[int, pd.DataFrame] = {}


def gold_zone_state_at(zone: base.Zone, bars5: pd.DataFrame, asof: pd.Timestamp, p: base.Params) -> base.Zone:
    # All production call sites pass the feature-enriched 5m stream. Build/cached
    # 15m bars causally for weak-breach confirmation. If a fixture passes a 15m
    # stream directly, use it as-is.
    if len(bars5.index) >= 2:
        med = bars5.index.to_series().diff().dropna().median()
    else:
        med = pd.Timedelta(minutes=5)
    if med >= pd.Timedelta(minutes=14):
        h15 = bars5
    else:
        key = id(bars5)
        if key not in _HTF_CACHE:
            _HTF_CACHE[key] = base.v1.htf15(bars5)
        h15 = _HTF_CACHE[key]
    return gold.lifecycle(zone, bars5, h15, asof, p)


# Install the gold-set-driven lifecycle everywhere zone state is resolved.
base.zone_state_at = gold_zone_state_at
rt.zone_state_at = gold_zone_state_at

# The corrected runtime run_day resolves its module-global zone_state_at and
# base.build_target_locations resolves base.zone_state_at, so both now share the
# same gold lifecycle.
for _name in dir(rt):
    if not _name.startswith('_') and _name not in globals():
        globals()[_name] = getattr(rt, _name)

zone_state_at = gold_zone_state_at
