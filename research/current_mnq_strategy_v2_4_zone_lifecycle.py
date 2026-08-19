#!/usr/bin/env python3
"""Causal support/resistance lifecycle for Current MNQ v2.4.

The inherited engine could label a zone FLIPPED_RETEST without changing its side,
and a quick reclaim after a break could remain BROKEN. This module makes the
trader's role equation executable:

    SUPPORT --accepted break below--> PENDING
      PENDING --reclaim/close back >= midpoint--> SUPPORT restored
      PENDING --retest from below + close <= midpoint--> RESISTANCE

    RESISTANCE --accepted break above--> PENDING
      PENDING --reclaim/close back <= midpoint--> RESISTANCE restored
      PENDING --retest from above + close >= midpoint--> SUPPORT

The scan uses only completed bars before `asof`. Multiple later role changes are
allowed, but every change must pass the same break/reclaim/retest equation.
"""
from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod

core = prod.core


def origin_side(zone: core.Zone) -> str:
    """Recover immutable creation polarity from deterministic v2.4 zone ids."""
    parts = str(zone.id).split(":")
    if parts and parts[0] in {"S", "R"}:
        return parts[0]
    if len(parts) > 1 and parts[0] == "SWING" and parts[1] in {"S", "R"}:
        return parts[1]
    if zone.side in {"S", "R"}:
        return zone.side
    raise RuntimeError(f"V24_ZONE_ORIGIN_SIDE_UNKNOWN:{zone.id}:{zone.side}")


def _breaks(role: str, close: float, lo: float, hi: float, clear: float) -> bool:
    if role == "S":
        return bool(float(close) < float(lo) - float(clear))
    return bool(float(close) > float(hi) + float(clear))


def zone_state_at_v24(zone: core.Zone, bars5: pd.DataFrame,
                      asof: pd.Timestamp, p: core.Params) -> core.Zone:
    """Replay zone role causally from creation through bars strictly before asof.

    Only the four numeric fields used by the lifecycle equation are materialized.
    This is behavior-preserving but avoids pandas ``iterrows()`` constructing a
    wide object array for every repeated replay on production history.
    """
    origin = origin_side(zone)
    role = origin
    state = core.ZoneState.ACTIVE_SUPPORT if role == "S" else core.ZoneState.ACTIVE_RESISTANCE
    pending_broken_role: str | None = None

    q = bars5.loc[
        (bars5.index >= zone.created) & (bars5.index < asof),
        ["low", "high", "close", "atr"],
    ]
    if q.empty:
        return replace(zone, side=role, state=state)

    for r in q.itertuples(index=False, name=None):
        low, high, close, atr_raw = r
        atr = float(atr_raw) if pd.notna(atr_raw) else np.nan
        clear = p.breakout_clear_atr * atr if np.isfinite(atr) else core.TICK * 2
        interacts = bool(float(low) <= float(zone.hi) and float(high) >= float(zone.lo))

        if pending_broken_role is None:
            if _breaks(role, close, zone.lo, zone.hi, clear):
                pending_broken_role = role
                state = core.ZoneState.BROKEN
                continue
            if interacts:
                state = core.ZoneState.TESTED
            continue

        old = pending_broken_role
        if old == "S":
            # Failed support break: price reclaimed the zone. Location is support
            # again, but entry still needs the separate candle/control gate.
            if float(close) >= float(zone.mid):
                role = "S"
                pending_broken_role = None
                state = core.ZoneState.TESTED
                continue
            # Accepted break followed by a retest from below -> resistance.
            if interacts and float(close) <= float(zone.mid):
                role = "R"
                pending_broken_role = None
                state = core.ZoneState.FLIPPED_RETEST
                continue
        else:
            # Failed resistance break: close back down restores resistance.
            if float(close) <= float(zone.mid):
                role = "R"
                pending_broken_role = None
                state = core.ZoneState.TESTED
                continue
            # Accepted break followed by a retest from above -> support.
            if interacts and float(close) >= float(zone.mid):
                role = "S"
                pending_broken_role = None
                state = core.ZoneState.FLIPPED_RETEST
                continue

    return replace(zone, side=role, state=state)
