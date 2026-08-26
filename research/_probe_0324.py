"""WHICH BAR does T3 refuse on 03-24, and what is its geometry? Report only."""
import io, json
from datetime import date, time as _time
from pathlib import Path
import pandas as pd
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W
from research import current_mnq_strategy_v2_4_derivation as D
DATA=Path("research/_mnq_v24_replay_lab_v3/data"); LOCK=Path("research/current_mnq_strategy_v2_2_data_lock.json")
LO,HI=24219.78,24235.97   # S:2026-03-24T00:15:00-04:00:96923
obs=old.download_pinned(DATA,include_tick=False); old.verify_manifest(obs,json.loads(LOCK.read_text(encoding="utf-8")))
with W.trading_window(_time(8,0)):
    env=old.prepare(old.load_csv(DATA/Path(old.DATA_FILES["5m"]).name), old.load_csv(DATA/Path(old.DATA_FILES["1m"]).name))
    p=eng.Params(); full5=env["full5"]
    bucket=pd.Timestamp("2026-03-24 09:30",tz="America/New_York")
    bars=full5[full5.index<=bucket]
    completed=bars.iloc[:-1]; last=completed.iloc[-1]
    print(f"band [{LO}, {HI}]  (his zone S:2026-03-24T00:15...96923)")
    print(f"\nLAST COMPLETED BAR (the one ALGO-033 puts the story on): {completed.index[-1]}")
    o,h,l,c=(float(last.open),float(last.high),float(last.low),float(last.close))
    print(f"  O={o} H={h} L={l} C={c}")
    body=abs(c-o); up=h-max(o,c); lo_w=min(o,c)-l; mid=(h+l)/2
    print(f"  body={body:.2f}  upper_wick={up:.2f}  lower_wick={lo_w:.2f}  midpoint={mid:.2f}")
    print(f"  MIXED (body<both wicks)        : {body<up and body<lo_w}")
    print(f"  DIRECTIONAL (close>mid, LONG)  : {c>mid}")
    print(f"  => T3 control held: {D._t3_control(last,'L')}")
    print(f"  R2 level held  : {D._control(last,'L',LO,HI)}")
    print(f"  R2 rejection   : {D._rejection_wick(last,'L',LO,HI)}")
    # what the FORMING bar looked like at his clock
    print(f"\nFORMING 5m bar at the bucket {bars.index[-1]}:")
    t=bars.iloc[-1]; to,th,tl,tc=(float(t.open),float(t.high),float(t.low),float(t.close))
    tbody=abs(tc-to); tup=th-max(to,tc); tlo=min(to,tc)-tl; tmid=(th+tl)/2
    print(f"  O={to} H={th} L={tl} C={tc}")
    print(f"  body={tbody:.2f}  upper={tup:.2f}  lower={tlo:.2f}  mid={tmid:.2f}")
    print(f"  MIXED: {tbody<tup and tbody<tlo}   DIRECTIONAL: {tc>tmid}")
    print(f"  => T3 on the FORMING bar: {D._t3_control(t,'L')}")
