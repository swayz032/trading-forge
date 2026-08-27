#!/usr/bin/env python3
"""ALGO-169b - WHY CLEANROOM-v3 covers ZERO. Diagnosis only, run AFTER the pre-registered verdict.

v3 FAILED clause 1 (0 of 28, -0.12 sd). This asks the follow-up that decides what the failure MEANS:
are v3's zones in the RIGHT PLACES BUT TOO NARROW, or in the WRONG PLACES?

It is diagnosis, not rescue. The verdict was FAIL and is not reopened by anything here. The pads
used are the campaign's own established instrument (ALGO-153/160), not new arms invented to find a
kinder number - and pad 25.0 is included precisely because it is GENEROUS and still finds almost
nothing.

ANSWER: wrong places. Median distance from his levels to the nearest v3 zone edge is 743 pt.
"""
import io,json,sys
from pathlib import Path
import pandas as pd
sys.path.insert(0,'.')
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
import research.mnq_sr_cleanroom_v3 as CR3
core=prod.core; R=Path("research")
env=old.prepare(old.load_csv(R/"_mnq_v24_replay_lab_v3/data"/Path(old.DATA_FILES["5m"]).name),
                old.load_csv(R/"_mnq_v24_replay_lab_v3/data"/Path(old.DATA_FILES["1m"]).name))
cases=json.load(io.open(R/"current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json",encoding="utf-8"))["cases"]
labels={r["case_id"]:r for r in json.load(io.open(R/"current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json",encoding="utf-8"))["labels"]}
ov=lambda a,b,c,d,p: not(b+p<c-p or d+p<a-p)
d_near=[]; pads={0.0:0,2.5:0,10.0:0,25.0:0}; n=0; widths=[]
for c in cases:
    day=c["session"]; asof=pd.Timestamp(f"{day} 09:30",tz=core.TZ)
    z=CR3.build_map(env["h15"],env["full5"],asof)
    widths+=[x.hi-x.lo for x in z]
    for h in (labels.get(c["case_id"],{}).get("trader_zones") or []):
        n+=1
        if not z: continue
        hm=(h["lo"]+h["hi"])/2
        d_near.append(min(min(abs(hm-x.lo),abs(hm-x.hi),0 if x.lo<=hm<=x.hi else 1e9) for x in z))
        for p in pads:
            if any(ov(h["lo"],h["hi"],x.lo,x.hi,p) for x in z): pads[p]+=1
s=pd.Series(d_near)
print(f"v3 zones: {len(widths)}  median width {pd.Series(widths).median():.2f} pt  (his 0.25, v2.4 17.75)")
print(f"distance from each of his {n} levels to the NEAREST v3 zone edge:")
print(f"   median {s.median():,.1f} pt   min {s.min():.1f}   25th pct {s.quantile(.25):,.1f}")
print("coverage at the campaign's established pads:")
for p in sorted(pads): print(f"   pad {p:5.1f}: {pads[p]} of {n}")
