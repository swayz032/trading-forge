#!/usr/bin/env python3
"""ALGO-184 - the 15m-close optimisation, TESTED FOR EXACTNESS BEFORE BEING BUILT. IT IS REFUSED.

ALGO-175 section 5 authorised the optimisation on ONE obligation: EXACT MEMBERSHIP EQUALITY BY KEY,
all 14 sessions, every bucket. Its licence was a stated fact about the data - "pivots cannot change
between 15m closes" - and NEVER a runtime figure. Exact implies memoisation; ANY difference
anywhere implies a different strategy wearing a speed argument, and is refused.

THE LICENCE IS TRUE ABOUT PIVOTS AND FALSE ABOUT ZONES. `build_zones` consumes `asof` in three
places BEYOND pivot confirmation, and two of them move CONTINUOUSLY rather than at 15m closes:

  v2_2_engine.py:443   piv.t >= asof - look_days       the 40-day lookback EDGE slides every bucket
  v2_2_engine.py:487   rec_days = (asof - r.confirm)   recency weights change every bucket
  v2_2_engine.py:489   center = _weighted_median(prices, rec_w)
  v2_2_engine.py:519   zid = f"{side}:{created}:{round(center/TICK)}"   <- the ID CONTAINS center

So a zone's BAND and its IDENTITY both drift between 15m closes even when its pivot set is frozen.

MEASURED HERE across all 14 sessions, consecutive 5m anchors INSIDE the same 15m window:
  zone BAND set changed        28 of 448  (6.2%)
  zone ID set changed          11 of 448  (2.5%)
  membership, center excluded   6 of 448   <- the lookback edge, a SECOND mechanism

A 15m-close rebuild would therefore be INEXACT at 6.2 percent of intra-window steps. Under the
obligation as written, that is a refusal - and the refusal is the correct outcome, not a failure to
deliver. REPAIRS NOTHING, PROPOSES NOTHING.
"""
import io,json,sys
from datetime import date
from pathlib import Path
import pandas as pd
sys.path.insert(0,'.')
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
core=prod.core; R=Path("research"); DATA=R/"_mnq_v24_replay_lab_v3/data"
env=old.prepare(old.load_csv(DATA/Path(old.DATA_FILES["5m"]).name), old.load_csv(DATA/Path(old.DATA_FILES["1m"]).name))
p=prod.Params()
sess=[c["session"] for c in json.load(io.open(R/"current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json",encoding="utf-8"))["cases"]]
tot=0; changed=0; band_changed=0; memb_changed=0
for day in sess:
    dte=date.fromisoformat(day)
    # every 5m anchor 08:00-12:00; group by the 15m window each belongs to
    anchors=[pd.Timestamp(f"{day} {h:02d}:{m:02d}",tz=core.TZ) for h in range(8,12) for m in (0,5,10,15,20,25,30,35,40,45,50,55)]
    prev=None; prev_win=None
    for T in anchors:
        win=T.floor("15min")
        z=core.build_zones(env["piv15"],env["h15"],T,p,look_days=40)
        ids={str(x.id) for x in z}
        bands={(round(x.lo,4),round(x.hi,4)) for x in z}
        created={str(x.id).rsplit(":",1)[0] for x in z}   # identity WITHOUT the center price
        cur=(ids,bands,created)
        if prev is not None and win==prev_win:
            tot+=1
            if cur[0]!=prev[0]: changed+=1
            if cur[1]!=prev[1]: band_changed+=1
            if cur[2]!=prev[2]: memb_changed+=1
        prev,prev_win=cur,win
print(f"consecutive 5m anchor pairs INSIDE the same 15m window, 14 sessions: {tot}")
print(f"  zone ID set changed        : {changed} of {tot}  ({100*changed/tot:.1f}%)")
print(f"  zone BAND set changed      : {band_changed} of {tot}  ({100*band_changed/tot:.1f}%)")
print(f"  zone MEMBERSHIP (side+created, center excluded) changed: {memb_changed} of {tot}")
