#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd
from research import current_mnq_strategy_v2_2_engine_fast as e
from research.current_mnq_strategy_v2_2_runner import tick_order_audit, chronological_folds

ROOT=Path('research/_mnq_v22_sharded'); DATA=ROOT/'data'; OUT=ROOT/'base'; OUT.mkdir(parents=True,exist_ok=True)
LOCK=Path('research/current_mnq_strategy_v2_2_data_lock.json')

def dump(name,obj): (OUT/name).write_text(json.dumps(obj,indent=2,default=str,allow_nan=False))

def main():
    obs=e.download_pinned(DATA,include_tick=True); e.verify_manifest(obs,json.loads(LOCK.read_text()))
    raw5=e.load_csv(DATA/Path(e.DATA_FILES['5m']).name); raw1=e.load_csv(DATA/Path(e.DATA_FILES['1m']).name); tick=e.load_csv(DATA/Path(e.DATA_FILES['tick']).name)
    dq=e.data_quality_gate(raw1,raw5); dump('data_quality.json',dq)
    if dq['status']!='PASS': raise SystemExit('REFUSE_DATA_QUALITY:'+','.join(dq['issues']))
    env=e.prepare(raw5,raw1); days=e.scoreable_days(env)
    if not days: raise SystemExit('REFUSE_NO_FULL_WARMUP')
    warm={'first_raw_bar':str(env['full5'].index.min()),'first_scoreable_day':str(days[0]),'last_scoreable_day':str(days[-1]),'minimum_warmup_days':e.MIN_WARMUP_DAYS,'scoreable_sessions':len(days)}; dump('warmup.json',warm)
    p=e.Params(); led=e.run_backtest(env,p,days); led.to_csv(OUT/'base_v22_ledger.csv',index=False)
    m=e.metrics(led); dump('base_metrics.json',m); dump('mae_risk.json',e.intratrade_equity_risk(led)); dump('tick_order_audit.json',tick_order_audit(led,tick))
    folds=chronological_folds(led,days,4); folds.to_csv(OUT/'base_folds.csv',index=False)
    tick_cols=['entry','stop','target','exit_price']
    if len(led):
        valid=led[tick_cols].apply(lambda col: col.map(e.tick_valid))
        if int((~valid).any(axis=1).sum()): raise SystemExit('REFUSE_INVALID_TICK_PRICE')
    if len(led):
        led.groupby('side').net_pnl.agg(['count','sum','mean']).reset_index().to_csv(OUT/'base_side.csv',index=False)
        led.groupby('setup').net_pnl.agg(['count','sum','mean']).reset_index().to_csv(OUT/'base_setup.csv',index=False)
    dump('base_row.json',dict(variant='BASE',positive_folds=int((folds.net_pnl>0).sum()),**m))
    print(json.dumps({'status':'BASE_COMPLETE','metrics':m,'warmup':warm,'data_quality':dq},indent=2,default=str))
if __name__=='__main__': main()
