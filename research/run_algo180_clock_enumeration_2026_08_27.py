#!/usr/bin/env python3
"""ALGO-180 - THE CLOCK ENUMERATION (ALGO-179 order item 1). Measurement only. REPAIR NOTHING.

Every component on the decision path carrying a hardcoded clock was, until the ALGO-174 repair,
only ever consulted at 09:30. All of them are now consulted from 08:00. The premarket plan is the
one P1 happened to catch - not necessarily the only one, and NOT the biggest.

THE FULL ENUMERATION, by key, with the reachability verdict for each:

  TRADE_START   08:00  v2_2:43, kernel:136/259      NOT A HAZARD - compares ts against itself and
                                                    decisions never start earlier than 08:00.
  LAST_ENTRY    12:00  v2_2:44, kernel:209          NOT A HAZARD - a ceiling on ts; slices no data.
  PRE_START     04:00  v2_2:602, levels:257         NOT A HAZARD - a lower bound, always <= ts.
  RTH_END       15:59  v2_2:834 exit_1m_realistic   NOT ON THE DECISION PATH - called at v2_2:997,
                                                    AFTER the entry is committed; forward-looking
                                                    by design because it simulates the exit.
  09:30/15:55          v2_2:350 data_quality_gate   NOT ON THE DECISION PATH - callers are the
                                                    runner, the shards and the preflight only.
  15:59                v2_2:880/882 prepare         NOT A HAZARD - runs once before any decision and
                                                    every consumer re-slices by ts.
  09:30 warmup_ref     kernel:226                   NOT A HAZARD - proven by AST taint analysis to
                                                    reach no argument of the location builder.
  OVERNIGHT_START 18:00 v2_2:650                    prior-day half is always past; the SAME-DAY half
                                                    at v2_2:651 is bounded by PRE_END => same hazard.

  *** PRE_END 09:29 - THE HAZARD, AND IT HAS TWO CONSUMING CALL SITES ***
      levels.py:252   build_premarket_plan_v24(full5, dte)  - UNANCHORED. Feeds pm_structure, which
                      gates _range_room_authorization at levels:253.
      kernel.py:232   build_premarket_plan_v24(full5, dte)  - UNANCHORED, built ONCE per session
                      OUTSIDE the bucket loop and consumed INSIDE it at kernel:355 (REV),
                      kernel:392 (BRK5) and kernel:406 (BRK15) via plan_allows_v24, which gates
                      DIRECTION on every setup family through plan.primary.

  P1 CANNOT SEE THE SECOND SITE. P1 exercises build_entry_locations_v24 only, so kernel.py:232 is
  outside its reach entirely. The site P1 caught is the SMALLER of the two.

This script measures both fields at four anchors, all before PRE_END, across all 14 sessions.
REPAIRS NOTHING.
"""
import io,json,sys
from datetime import date
from pathlib import Path
import pandas as pd
sys.path.insert(0,'.')
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_premarket import build_premarket_plan_v24
core=prod.core; R=Path("research"); DATA=R/"_mnq_v24_replay_lab_v3/data"
env=old.prepare(old.load_csv(DATA/Path(old.DATA_FILES["5m"]).name), old.load_csv(DATA/Path(old.DATA_FILES["1m"]).name))
sess=[c["session"] for c in json.load(io.open(R/"current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json",encoding="utf-8"))["cases"]]
ANCH=("08:05","08:30","09:00","09:25")
f5=env["full5"]
diff_primary=0; diff_struct=0; n=0
rows=[]
for day in sess:
    dte=date.fromisoformat(day)
    full=build_premarket_plan_v24(f5,dte)
    for a in ANCH:
        T=pd.Timestamp(f"{day} {a}",tz=core.TZ)
        tr=f5[f5.index+pd.Timedelta(minutes=5)<=T]
        p2=build_premarket_plan_v24(tr,dte)
        n+=1
        pa,pb=str(getattr(full,'primary','?')),str(getattr(p2,'primary','?'))
        sa,sb=str(getattr(full,'pm_structure','?')),str(getattr(p2,'pm_structure','?'))
        if pa!=pb: diff_primary+=1; rows.append((day,a,'primary',pa,pb))
        if sa!=sb: diff_struct+=1; rows.append((day,a,'pm_structure',sa,sb))
print(f"anchor-pairs tested: {n}  (14 sessions x {len(ANCH)} anchors, all before PRE_END 09:29)")
print(f"  plan.primary     DIFFERS at {diff_primary} of {n}   <- gates DIRECTION on every setup (kernel.py:355/392/406)")
print(f"  plan.pm_structure DIFFERS at {diff_struct} of {n}   <- gates _range_room_authorization (levels.py:253)")
print("\nBY KEY:")
for d,a,f,x,y in rows: print(f"  {d} {a}  {f:<13} full={x:<10} truncated={y}")
