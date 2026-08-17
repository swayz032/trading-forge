#!/usr/bin/env python3
from __future__ import annotations
import argparse, json
from pathlib import Path
import numpy as np
import pandas as pd
from research import current_mnq_strategy_v2_2_engine_fast as e

ROOT=Path('research/_mnq_v22_sharded'); DATA=ROOT/'data'; LOCK=Path('research/current_mnq_strategy_v2_2_data_lock.json')

def fold_count(led,days,n=4):
    folds=np.array_split(np.array(days,dtype=object),n); pos=0; vals=[]
    for fd in folds:
        ids={str(x) for x in fd}; q=led[led.session.isin(ids)] if len(led) else led; m=e.metrics(q); net=float(m.get('net_pnl',0.0)); vals.append(net); pos+=int(net>0)
    return pos,vals

def load_env():
    obs=e.download_pinned(DATA,include_tick=False); e.verify_manifest(obs,json.loads(LOCK.read_text()))
    raw5=e.load_csv(DATA/Path(e.DATA_FILES['5m']).name); raw1=e.load_csv(DATA/Path(e.DATA_FILES['1m']).name)
    dq=e.data_quality_gate(raw1,raw5)
    if dq['status']!='PASS': raise SystemExit('REFUSE_DATA_QUALITY:'+','.join(dq['issues']))
    env=e.prepare(raw5,raw1); days=e.scoreable_days(env)
    if not days: raise SystemExit('REFUSE_NO_FULL_WARMUP')
    return env,days

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--kind',choices=['params','slippage'],required=True); ap.add_argument('--index',type=int,default=0); ap.add_argument('--count',type=int,default=1); a=ap.parse_args()
    env,days=load_env(); base=e.Params(); rows=[]
    if a.kind=='params':
        items=e.deterministic_perturbations(base,n=24)[1:]
        items=[x for j,x in enumerate(items) if j%a.count==a.index]
        out=ROOT/f'param_{a.index}'; out.mkdir(parents=True,exist_ok=True)
    else:
        items=e.stress_slippage_profiles(base)
        items=[x for j,x in enumerate(items) if j%a.count==a.index]
        out=ROOT/f'slip_{a.index}'; out.mkdir(parents=True,exist_ok=True)
    for name,p in items:
        led=e.run_backtest(env,p,days); m=e.metrics(led); pos,foldnets=fold_count(led,days)
        row={'variant':name,'positive_folds':pos,'fold_nets':'|'.join(f'{x:.10f}' for x in foldnets),**m}; rows.append(row)
        print(json.dumps({'variant':name,'trades':m.get('trades'),'net_pnl':m.get('net_pnl'),'profit_factor':m.get('profit_factor'),'positive_folds':pos},default=str))
    pd.DataFrame(rows).to_csv(out/f'{a.kind}_shard_{a.index}.csv',index=False)
    (out/f'{a.kind}_shard_{a.index}.json').write_text(json.dumps({'kind':a.kind,'index':a.index,'count':a.count,'variants':[r['variant'] for r in rows]},indent=2))
if __name__=='__main__': main()
