#!/usr/bin/env python3
"""Gold-set-driven zone lifecycle correction for v2.2.

Derived from immutable fidelity fixture G05_FAILED_BREAKOUT_RECLAIM, not P&L.
A price breach is not automatically a permanent role flip:
- strong 5m acceptance can break immediately;
- weak breach requires a later completed 15m close beyond the same zone;
- a reclaim back through the original zone before durable acceptance restores the
  original polarity and tags the location as failed-breakout context;
- after durable acceptance, a retest that holds the broken side may flip polarity.
"""
from __future__ import annotations
from dataclasses import replace
import numpy as np
import pandas as pd
from research import current_mnq_strategy_v2_2_engine as b

FAILED_TAG = "FAILED_BREAKOUT_RECLAIM"


def _original_active_state(side: str):
    return b.ZoneState.ACTIVE_SUPPORT if side == 'S' else b.ZoneState.ACTIVE_RESISTANCE


def _outside(zone, r, p):
    atr=float(r.get('atr',np.nan)); clear=p.breakout_clear_atr*atr if np.isfinite(atr) else b.TICK*2
    return (float(r.close)<zone.lo-clear) if zone.side=='S' else (float(r.close)>zone.hi+clear)


def _reclaimed(original_side, zone, r):
    return (float(r.close)>=zone.mid) if original_side=='S' else (float(r.close)<=zone.mid)


def _holds_broken_side(original_side, zone, r):
    return (float(r.close)<zone.mid) if original_side=='S' else (float(r.close)>zone.mid)


def lifecycle(zone: b.Zone, bars5: pd.DataFrame, h15: pd.DataFrame | None,
              asof: pd.Timestamp, p: b.Params) -> b.Zone:
    q=bars5[(bars5.index>=zone.created)&(bars5.index<asof)]
    if q.empty: return zone
    z=replace(zone); original=z.side; breach_time=None; accepted_time=None; tests=0
    for ts,r in q.iterrows():
        if float(r.low)<=z.hi and float(r.high)>=z.lo: tests+=1
        if breach_time is None and _outside(z,r,p):
            breach_time=ts
            direction='S' if original=='S' else 'L'
            if b.strong_bar(r,direction,p):
                accepted_time=ts+pd.Timedelta(minutes=5)
            elif h15 is not None:
                candidates=h15[(h15.index+pd.Timedelta(minutes=15)>ts+pd.Timedelta(minutes=5)) &
                               (h15.index+pd.Timedelta(minutes=15)<=asof)]
                for hts,hr in candidates.iterrows():
                    accepted=(float(hr.close)<z.lo) if original=='S' else (float(hr.close)>z.hi)
                    if accepted:
                        accepted_time=hts+pd.Timedelta(minutes=15); break
        if breach_time is not None:
            # A reclaim before or shortly after tentative acceptance revalidates
            # original polarity. The entry story must still prove control transfer.
            if ts>breach_time and _reclaimed(original,z,r):
                z.side=original; z.state=_original_active_state(original)
                if FAILED_TAG not in z.source: z.source=f"{z.source}|{FAILED_TAG}"
                return z
            if accepted_time is not None and ts>=accepted_time:
                z.state=b.ZoneState.BROKEN
                # A later retest that HOLDS the broken side establishes role flip.
                later=q[q.index>ts]
                for _,rr in later.iterrows():
                    if float(rr.low)<=z.hi and float(rr.high)>=z.lo and _holds_broken_side(original,z,rr):
                        z.side='R' if original=='S' else 'S'
                        z.state=b.ZoneState.FLIPPED_RETEST
                        return z
                return z
    if breach_time is not None and accepted_time is not None:
        z.state=b.ZoneState.BROKEN
        return z
    if tests: z.state=b.ZoneState.TESTED
    return z
