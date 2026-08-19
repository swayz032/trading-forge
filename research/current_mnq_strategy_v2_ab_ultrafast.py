#!/usr/bin/env python3
from __future__ import annotations

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_ab as m
from research import current_mnq_strategy_v2_ab_fast as fast


def active_fvgs_linear(h: pd.DataFrame, asof: pd.Timestamp, look_days: int = 25):
    q = h[(h.index + pd.Timedelta(minutes=15) <= asof) & (h.index >= asof - pd.Timedelta(days=look_days))]
    n = len(q)
    if n < 3:
        return []

    lows = q.low.to_numpy(float)
    highs = q.high.to_numpy(float)
    # Future extrema STRICTLY after index i. This is equivalent to asking
    # whether any later completed 15m bar fully filled the gap.
    fut_min = np.full(n, np.inf)
    fut_max = np.full(n, -np.inf)
    if n > 1:
        fut_min[:-1] = np.minimum.accumulate(lows[:0:-1])[::-1]
        fut_max[:-1] = np.maximum.accumulate(highs[:0:-1])[::-1]

    out = []
    for i in range(2, n):
        a = q.iloc[i - 2]
        c = q.iloc[i]
        if c.low > a.high:
            lo, hi = float(a.high), float(c.low)
            if not (fut_min[i] <= lo):
                out.append(m.v1.Z('S', lo, hi, (lo + hi) / 2, 1, 0, 0, 'FVG_ACTIVE'))
        if c.high < a.low:
            lo, hi = float(c.high), float(a.low)
            if not (fut_max[i] >= hi):
                out.append(m.v1.Z('R', lo, hi, (lo + hi) / 2, 1, 0, 0, 'FVG_ACTIVE'))
    return out


if __name__ == '__main__':
    # Engineering-only substitutions: identical strategy semantics.
    m.active_fvgs = active_fvgs_linear
    fast._CACHE.clear()
    m.run_variant = fast.cached_run_variant
    m.main()
