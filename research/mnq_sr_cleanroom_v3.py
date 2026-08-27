#!/usr/bin/env python3
"""MNQ-SR-CLEANROOM-v3 - v1 with EXACTLY ONE CHANGE. Authorized by ALGO-167.

FROZEN AND COMMITTED BEFORE ANY EVALUATION RUNS.

THE ONE CHANGE: clustering is MUTUAL OVERLAP (complete linkage) instead of TRANSITIVE CLOSURE
(single linkage). Nothing else moves. Same `MIN_WICK = 0.20`, same lookback, same rank key
(confluence, members, recency), same `TOP_PER_SESSION = 3`, same ruled band. One variable.

WHY THIS IS NOT A TUNED ALTERNATIVE, WHICH IS THE WHOLE POINT:
v1's clustering merged A with C whenever A-B and B-C overlapped, even with A and C 900 points
apart. It CHAINS. Measured consequence: median band 912.62 pts against his median 0.25, median 230
members per "level", 78 pct of the session's range covered, and coverage of his levels 0.27 sd
BELOW a random null (ALGO-166).

His RATIFIED specification says a zone is THE REJECTION WICK DOWN TO THAT CANDLE'S CLOSE. A
230-member, 912-point band already violates that definition, independent of any tolerance. So this
is NON-CONFORMANCE TO A CONFIRMED DEFINITION, not an unset parameter - and complete linkage is the
linkage that PRESERVES the definition of the thing being clustered. NO NUMBER IS CHOSEN HERE.
There is no width constant in this file and there must never be one.

PRE-REGISTERED ACCEPTANCE (ALGO-167, fixed before this file was written):
  1. coverage of his marked levels must exceed ITS OWN NULL by >= 2 sd
  2. median zone WIDTH and SHARE-OF-SESSION-RANGE are reported in the SAME TABLE as coverage,
     always - never coverage alone
  3. <= 5 zones per session
  ADVERSE BRANCH, RECORDED SO IT CANNOT BE SOFTENED LATER: mutual overlap may collapse the map to
  almost nothing, or leave it at chance. AT CHANCE IS THE MOST LIKELY OUTCOME. If that happens it
  is published as A FAILURE OF THE APPROACH - not as a reason for a fourth build.

THE FOURTEEN SESSIONS ARE THE SCORING SET FOR CLAUSE 1 ONLY, exactly as v1 was scored, and no
parameter here may be chosen by what it does to them. Verify on the AST, not the text.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from research import current_mnq_strategy_v2_3_engine as prod
from research import current_mnq_strategy_v1_fast as v1
from research.current_mnq_strategy_v2_4_fvg import active_15m_fvgs

core = prod.core

#: Inherited unchanged from v1, which inherited it unchanged from frozen v2.4. The only magnitude.
MIN_WICK = 0.20
TOP_PER_SESSION = 3


@dataclass
class CleanZone:
    side: str
    lo: float
    hi: float
    members: int
    confluence: int
    families: list = field(default_factory=list)
    last_t: pd.Timestamp = None

    @property
    def mid(self):
        return (self.lo + self.hi) / 2.0

    @property
    def width(self):
        return self.hi - self.lo


def _ruled_band(bar, side):
    """His zone: the rejection wick's extreme to that same candle's close. Unchanged from v1."""
    if side == "S":
        lo, hi = float(bar.low), float(bar.close)
    else:
        lo, hi = float(bar.close), float(bar.high)
    return (lo, hi) if hi > lo else None


def _overlap(a_lo, a_hi, b_lo, b_hi):
    return not (a_hi < b_lo or b_hi < a_lo)


def build_map(h15: pd.DataFrame, full5: pd.DataFrame, asof: pd.Timestamp,
              lookback_days: int = 40) -> list[CleanZone]:
    """The v3 map as of `asof`. Causal: only bars completed by `asof` are read."""
    piv = v1.pivots(h15[h15.index <= asof], mins=15)
    if piv.empty:
        return []
    piv = piv[(piv.confirm <= asof) & (piv.t >= asof - pd.Timedelta(days=lookback_days))]
    piv = piv[pd.to_numeric(piv.wick, errors="coerce") >= MIN_WICK]
    if piv.empty:
        return []

    zones: list[CleanZone] = []
    for side in ("S", "R"):
        bands = []
        for row in piv[piv.side == side].sort_values("t").itertuples():
            try:
                bar = h15.loc[row.t]
            except KeyError:
                continue
            if isinstance(bar, pd.DataFrame):
                bar = bar.iloc[0]
            b = _ruled_band(bar, side)
            if b is not None:
                bands.append((b[0], b[1], row.t))

        # ── THE ONE CHANGE. MUTUAL OVERLAP, NOT TRANSITIVE CLOSURE. ──
        # A band joins a cluster only if it overlaps EVERY member already in it. The cluster's
        # extent is therefore the INTERSECTION of its members' bands, which cannot grow by
        # chaining: it can only shrink or stay the same as members are added. v1 took the UNION,
        # which is what let two bands 900 points apart end up in one "level".
        used = [False] * len(bands)
        for i, (lo, hi, t) in enumerate(bands):
            if used[i]:
                continue
            lo_, hi_, n, last = lo, hi, 1, t
            used[i] = True
            members = [i]
            for j, (blo, bhi, bt) in enumerate(bands):
                if used[j] or j == i:
                    continue
                if all(_overlap(bands[m][0], bands[m][1], blo, bhi) for m in members):
                    lo_, hi_ = max(lo_, blo), min(hi_, bhi)   # INTERSECTION, never union
                    n += 1
                    last = max(last, bt)
                    used[j] = True
                    members.append(j)
            if n >= 2 and hi_ > lo_:
                zones.append(CleanZone(side, lo_, hi_, n, 0, [], last))

    if not zones:
        return []

    fvgs = active_15m_fvgs(h15, asof)
    p5 = v1.pivots(full5[full5.index <= asof], mins=5)
    p5 = p5[(p5.confirm <= asof) & (p5.t >= asof - pd.Timedelta(days=lookback_days))]
    for z in zones:
        fam = []
        if any(_overlap(z.lo, z.hi, float(f.lo), float(f.hi)) for f in fvgs):
            fam.append("ACTIVE_15M_FVG")
        if any(z.lo <= float(r.price) <= z.hi for r in p5.itertuples()):
            fam.append("5M_REACTION_CLUSTER")
        if any(o.side != z.side and _overlap(z.lo, z.hi, o.lo, o.hi) for o in zones):
            fam.append("ROLE_FLIP")
        z.families = fam
        z.confluence = len(fam)

    zones.sort(key=lambda z: (-z.confluence, -z.members, -z.last_t.value))
    return sorted(zones[:TOP_PER_SESSION], key=lambda z: z.mid)
