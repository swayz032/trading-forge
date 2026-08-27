#!/usr/bin/env python3
"""ALGO-178 - the SECOND causality leak, isolated. Measurement only, read-only, no repair.

P1 widened to all 14 sessions x 4 anchors fails at exactly one pair: 2026-03-25 09:00. The five
locations that differ all have `created` BEFORE the anchor, so the full build includes them
legitimately - the difference is AUTHORIZATION, not existence.

THE MECHANISM, MEASURED HERE RATHER THAN INFERRED: `core.PRE_END = 09:29`, so
`build_premarket_plan_v24` windows to 09:29 REGARDLESS OF THE DECISION CLOCK. A decision at 09:00
therefore consults a structure label computed from 6 bars that had not printed. `pm_structure`
reads DOWN on full data and MIXED on truncated data - and MIXED is exactly the branch that gates
`_range_room_authorization`, so future bars switch an entire authorization gate on or off.

AND THIS WAS UNREACHABLE BEFORE THE ALGO-174 REPAIR. The only anchor used to be 09:30, which is
AFTER PRE_END=09:29, so the premarket window was always complete and the leak could never fire.
Making decisions consult the builder at their own earlier clock is what put anchors INSIDE the
premarket window for the first time. My repair did not introduce this code; it made it live.

NO REPAIR PROPOSED. Bounding the premarket window by the decision clock changes which mornings read
MIXED, which changes authorization, which changes trades. That is a ruling.
"""
import sys
from datetime import date
from pathlib import Path
import pandas as pd
sys.path.insert(0,'.')
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_premarket import build_premarket_plan_v24
core=prod.core; DATA=Path("research/_mnq_v24_replay_lab_v3/data")
env=old.prepare(old.load_csv(DATA/Path(old.DATA_FILES["5m"]).name), old.load_csv(DATA/Path(old.DATA_FILES["1m"]).name))
print(f"PRE_START={core.PRE_START}  PRE_END={core.PRE_END}")
for day,clock in (("2026-03-25","09:00"),("2026-03-25","08:05"),("2026-03-25","09:25"),("2026-03-30","08:05")):
    T=pd.Timestamp(f"{day} {clock}",tz=core.TZ); dte=date.fromisoformat(day)
    f5=env["full5"]
    trunc=f5[f5.index+pd.Timedelta(minutes=5)<=T]
    a=build_premarket_plan_v24(f5,dte); b=build_premarket_plan_v24(trunc,dte)
    sa,sb=str(a.pm_structure),str(b.pm_structure)
    n_after=len(f5[(f5.index.date==dte)&(f5.index.time>=core.PRE_START)&(f5.index.time<=core.PRE_END)&(f5.index>=T)])
    print(f"{day} {clock}: pm_structure FULL={sa:<10} TRUNCATED={sb:<10} {'*** DIFFERS ***' if sa!=sb else 'same'}"
          f"   premarket bars at/after T that FULL can see: {n_after}")
