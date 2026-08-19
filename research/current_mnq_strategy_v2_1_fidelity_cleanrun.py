#!/usr/bin/env python3
from __future__ import annotations
import copy, json
from pathlib import Path
import numpy as np
import pandas as pd
from research import current_mnq_strategy_v2_1_fidelity as b

OUT = Path('research/_mnq_v21_clean')
OUT.mkdir(parents=True, exist_ok=True)

_orig_clusters=b.v1.clusters
_orig_fvg=b.active_fvgs_partial
_orig_targets=b.build_targets
_orig_prior=b.prior_bars
_orig_bias=b.v2.premarket_bias
_orig_exit=b.v2.exit_1m
_cc={}; _fc={}; _tc={}; _pc={}; _bc={}; _ec={}

def clusters(pv,side,asof,p,look=40,min_touch=None):
    key=(id(pv),side,str(asof),look,min_touch,p.ztouch,p.ztol,p.zwick,p.zdisp,p.room,p.tp,p.stop)
    if key not in _cc: _cc[key]=_orig_clusters(pv,side,asof,p,look=look,min_touch=min_touch)
    return [copy.copy(z) for z in _cc[key]]

def fvg(h,asof,look_days=25):
    key=(id(h),str(asof),look_days)
    if key not in _fc: _fc[key]=_orig_fvg(h,asof,look_days)
    return [copy.copy(z) for z in _fc[key]]

def targets(p5,h15,asof,p,pdm,pwm,dte):
    key=(id(p5),id(h15),str(asof),str(dte),p.ztouch,p.ztol,p.zwick,p.zdisp,p.room,p.tp,p.stop)
    if key not in _tc: _tc[key]=_orig_targets(p5,h15,asof,p,pdm,pwm,dte)
    return [b.Target(copy.copy(t.z),t.source,t.major,t.fvg_confluent) for t in _tc[key]]

def prior(full5,ts,n):
    key=(id(full5),str(ts),n)
    if key not in _pc: _pc[key]=_orig_prior(full5,ts,n)
    return _pc[key]

def bias(full5,dte,pdm,pwm,pcm):
    key=(id(full5),str(dte))
    if key not in _bc: _bc[key]=_orig_bias(full5,dte,pdm,pwm,pcm)
    return _bc[key]

def exit1(one,entry_time,direction,entry,target,p):
    key=(id(one),str(entry_time),direction,float(entry),float(target),float(p.stop))
    if key not in _ec: _ec[key]=_orig_exit(one,entry_time,direction,entry,target,p)
    return _ec[key]

def vdict(v):
    return {'variant':v.name,'bias_mode':v.bias_mode,'ztouch':v.ztouch,'room':v.room,'tp':v.tp,'reversal_mode':v.reversal_mode}

def main():
    # Cache substitutions only. No pandas/reporting monkey patches are allowed.
    b.v1.clusters=clusters
    b.active_fvgs_partial=fvg
    b.build_targets=targets
    b.prior_bars=prior
    b.v2.premarket_bias=bias
    b.v2.exit_1m=exit1

    env=b.prepare(); vars_=b.variants()
    base=[v for v in vars_ if (v.bias_mode,v.ztouch,v.room,v.tp,v.reversal_mode)==('SOFT',2,1.5,.50,'STRUCTURED')][0]
    ledgers={}; rows=[]
    for v in vars_:
        led=b.run_variant(env,v); ledgers[v.name]=led
        m=b.metrics(led); m.update(vdict(v)); rows.append(m)
    summary=pd.DataFrame(rows)
    days=sorted(set(env['r5'].index.date))
    folds_df, folds=b.fold_results(ledgers,vars_,days,6)
    fr=folds_df.groupby('variant').agg(
        positive_folds=('net_pnl',lambda s:int((s>0).sum())),
        median_fold_net=('net_pnl','median'),
        worst_fold_net=('net_pnl','min'),
        median_fold_pf=('profit_factor',lambda s:float(pd.Series(s).replace(np.inf,np.nan).median()))
    ).reset_index()
    summary=summary.merge(fr,on='variant',how='left')
    summary['robust_flag']=(summary.trades>=20)&(summary.profit_factor>1)&(summary.positive_folds>=4)
    pbo,pbo_rows=b.v2.cscv_pbo(ledgers,vars_,folds,days)
    base_led=ledgers[base.name]; base_m=b.metrics(base_led)
    old_base=b.v2.run_variant(env,b.v2.Variant('OLDV2','EXT','SOFT',2,1.5,.50)); old_m=b.metrics(old_base)
    axis=pd.concat([b.axis_summary(summary,'bias_mode'),b.axis_summary(summary,'ztouch'),b.axis_summary(summary,'room'),b.axis_summary(summary,'tp'),b.axis_summary(summary,'reversal_mode')],ignore_index=True,sort=False)
    side=base_led.groupby('side').net_pnl.agg(['count','sum','mean']).reset_index() if len(base_led) else pd.DataFrame()
    setup=base_led.groupby('setup').net_pnl.agg(['count','sum','mean']).reset_index() if len(base_led) else pd.DataFrame()
    bias_tab=base_led.groupby('premarket_bias').net_pnl.agg(['count','sum','mean']).reset_index() if len(base_led) else pd.DataFrame()
    if len(base_led):
        entry_times=pd.to_datetime(base_led.entry_time,utc=True).dt.tz_convert(b.v1.TZ)
        early=int((entry_times.dt.time<=pd.Timestamp('09:45').time()).sum())
        after=int((entry_times.dt.time>b.LAST_ENTRY).sum())
    else: early=after=0
    dup=int(base_led.session.duplicated().sum()) if len(base_led) else 0
    mc=b.bootstrap_block(base_led.net_pnl.to_numpy(float) if len(base_led) else [])
    summary.to_csv(OUT/'variant_summary.csv',index=False); folds_df.to_csv(OUT/'fold_results.csv',index=False)
    pbo_rows.to_csv(OUT/'cscv_pbo_splits.csv',index=False); base_led.to_csv(OUT/'base_v21_ledger.csv',index=False)
    old_base.to_csv(OUT/'old_v2_ledger.csv',index=False); axis.to_csv(OUT/'axis_summary.csv',index=False)
    side.to_csv(OUT/'base_side.csv',index=False); setup.to_csv(OUT/'base_setup.csv',index=False); bias_tab.to_csv(OUT/'base_bias.csv',index=False)
    report={
      'status':'RESEARCH_ONLY_NOT_LIVE_APPROVED',
      'runner':'clean_separation_no_reporting_monkeypatches',
      'anti_overfit_contract':{'predeclared_variants':48,'base_selected_before_v21_pnl':base.name,'all_variants_logged':True,'no_unbounded_optimizer':True,'mnq_2026_is_contaminated_development_data':True},
      'data':{'start':str(days[0]),'end':str(days[-1]),'sessions':len(days)},
      'base_variant':vdict(base),'base_metrics':base_m,'old_v2_metrics_same_data':old_m,
      'family':{'count':len(summary),'profitable':int((summary.net_pnl>0).sum()),'robust':int(summary.robust_flag.sum()),'median_net':float(summary.net_pnl.median()),'worst_net':float(summary.net_pnl.min()),'best_net':float(summary.net_pnl.max())},
      'pbo_style':{'estimate':float(pbo) if np.isfinite(pbo) else None,'splits':len(pbo_rows)},
      'semantic_checks':{'duplicate_trade_days':dup,'entries_after_1200':after,'entries_at_or_before_0945':early,'max_zone_confluence':int(base_led.confluence.max()) if len(base_led) else 0,'median_target_points':float(base_led.target_points.median()) if len(base_led) else None,'avg_target_points':float(base_led.target_points.mean()) if len(base_led) else None},
      'monte_carlo_block':mc,
      'warnings':['Jan-Apr 2026 is already-inspected development data, not final OOS certification.','PBO-style estimate uses only six chronological folds and closely related variants.','Do not promote a parameter solely because it has the highest P&L.']}
    (OUT/'report.json').write_text(json.dumps(report,indent=2,default=str))
    print(json.dumps(report,indent=2,default=str))
    print('\nBASE SIDE\n',side.to_string(index=False)); print('\nBASE SETUP\n',setup.to_string(index=False)); print('\nAXIS\n',axis.to_string(index=False))

if __name__=='__main__': main()
