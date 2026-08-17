#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd
from research import current_mnq_strategy_v2_2_engine_fast as e

ROOT=Path('research/_mnq_v22_tick_diag'); DATA=ROOT/'data'; OUT=ROOT/'results'; OUT.mkdir(parents=True,exist_ok=True)
LOCK=Path('research/current_mnq_strategy_v2_2_data_lock.json')

def dump(name,obj): (OUT/name).write_text(json.dumps(obj,indent=2,default=str,allow_nan=False))

def main():
    obs=e.download_pinned(DATA,include_tick=True); e.verify_manifest(obs,json.loads(LOCK.read_text()))
    raw5=e.load_csv(DATA/Path(e.DATA_FILES['5m']).name); raw1=e.load_csv(DATA/Path(e.DATA_FILES['1m']).name); tick=e.load_csv(DATA/Path(e.DATA_FILES['tick']).name)
    env=e.prepare(raw5,raw1); days=e.scoreable_days(env); led=e.run_backtest(env,e.Params(),days)
    led.to_csv(OUT/'base_ledger_for_tick_diag.csv',index=False)

    # Aggregate the purported tick bars to one-minute OHLC and compare against the
    # independently downloaded one-minute stream on timestamps both sources share.
    ta=tick[['open','high','low','close']].resample('1min',origin='start_day',label='left',closed='left').agg(
        open=('open','first'),high=('high','max'),low=('low','min'),close=('close','last')).dropna()
    shared=ta.index.intersection(raw1.index)
    d=(ta.loc[shared]-raw1.loc[shared,['open','high','low','close']]).abs()
    exact=(d<=1e-9).all(axis=1)
    close_diff=d['close']
    global_report={
      'tick_rows':int(len(tick)),'tick_first':str(tick.index.min()),'tick_last':str(tick.index.max()),
      'tick_1m_aggregates':int(len(ta)),'shared_tick_vs_1m_minutes':int(len(shared)),
      'exact_ohlc_parity_rate':float(exact.mean()) if len(exact) else None,
      'median_abs_close_difference':float(close_diff.median()) if len(close_diff) else None,
      'p95_abs_close_difference':float(close_diff.quantile(.95)) if len(close_diff) else None,
      'max_abs_close_difference':float(close_diff.max()) if len(close_diff) else None,
    }
    dump('global_tick_vs_1m.json',global_report)

    trade_rows=[]
    for r in led.itertuples():
        et=pd.Timestamp(r.entry_time); xt=pd.Timestamp(r.exit_time)
        q1=raw1[(raw1.index>=et)&(raw1.index<=xt)]
        qt=tick[(tick.index>=et)&(tick.index<=xt)]
        direction='L' if r.side=='LONG' else 'S'
        if len(qt):
            tlo=float(qt.low.min()); thi=float(qt.high.max())
            stop_seen=(tlo<=float(r.stop)) if direction=='L' else (thi>=float(r.stop))
            target_seen=(thi>=float(r.target)) if direction=='L' else (tlo<=float(r.target))
        else:
            tlo=thi=None; stop_seen=target_seen=False
        trade_rows.append({
          'session':r.session,'side':r.side,'entry_time':r.entry_time,'exit_time':r.exit_time,
          'stop':float(r.stop),'target':float(r.target),'recorded_exit':r.exit_reason,
          'one_minute_rows':int(len(q1)),'one_minute_low':float(q1.low.min()) if len(q1) else None,
          'one_minute_high':float(q1.high.max()) if len(q1) else None,
          'tick_rows':int(len(qt)),'tick_low':tlo,'tick_high':thi,
          'tick_stop_seen':bool(stop_seen),'tick_target_seen':bool(target_seen),
          'first_tick':str(qt.index.min()) if len(qt) else None,'last_tick':str(qt.index.max()) if len(qt) else None,
        })
    pd.DataFrame(trade_rows).to_csv(OUT/'trade_tick_windows.csv',index=False)
    report={'global':global_report,'trades':trade_rows,
            'verdict':'PASS' if global_report['exact_ohlc_parity_rate'] is not None and global_report['exact_ohlc_parity_rate']>=.995 else 'TICK_STREAM_NOT_PARITY_WITH_1M'}
    dump('report.json',report); print(json.dumps(report,indent=2,default=str))
if __name__=='__main__': main()
