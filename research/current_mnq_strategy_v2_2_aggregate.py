#!/usr/bin/env python3
from __future__ import annotations
import json, shutil
from pathlib import Path
import numpy as np
import pandas as pd

IN=Path('research/_mnq_v22_sharded_inputs'); OUT=Path('research/_mnq_v22_final'); OUT.mkdir(parents=True,exist_ok=True)

def readj(name): return json.loads((IN/name).read_text())
def dump(name,obj): (OUT/name).write_text(json.dumps(obj,indent=2,default=str,allow_nan=False))

def main():
    base=readj('base_metrics.json'); base_row=readj('base_row.json'); warm=readj('warmup.json'); dq=readj('data_quality.json'); mae=readj('mae_risk.json'); tick=readj('tick_order_audit.json')
    param_files=sorted(IN.glob('params_shard_*.csv'))
    if not param_files: param_files=sorted(IN.glob('params_shard*.csv'))
    # Artifact filenames are produced as params_shard_N.csv inside each shard.
    params=pd.concat([pd.read_csv(p) for p in param_files],ignore_index=True) if param_files else pd.DataFrame()
    base_df=pd.DataFrame([base_row]); family=pd.concat([base_df,params],ignore_index=True,sort=False)
    if len(family)!=25: raise SystemExit(f'REFUSE_EXPECTED_25_VARIANTS_GOT_{len(family)}')
    if family.variant.nunique()!=25: raise SystemExit('REFUSE_DUPLICATE_VARIANTS')
    slips_files=sorted(IN.glob('slippage_shard_*.csv'))
    slips=pd.concat([pd.read_csv(p) for p in slips_files],ignore_index=True) if slips_files else pd.DataFrame()
    if len(slips)!=4: raise SystemExit(f'REFUSE_EXPECTED_4_SLIPPAGE_GOT_{len(slips)}')
    family.to_csv(OUT/'parameter_perturbation_summary.csv',index=False); slips.to_csv(OUT/'slippage_stress.csv',index=False)
    for f in ['base_v22_ledger.csv','base_folds.csv','base_side.csv','base_setup.csv','data_quality.json','warmup.json','mae_risk.json','tick_order_audit.json']:
        src=IN/f
        if src.exists(): shutil.copy2(src,OUT/f)
    finite_pf=family.profit_factor.replace([np.inf,-np.inf],np.nan)
    report={
      'status':'RESEARCH_ONLY_NOT_LIVE_APPROVED','version':'v2.2-sharded',
      'anti_overfit_contract':{'repair_charter_frozen_before_v22_pnl':True,'data_hashes_frozen_before_v22_pnl':True,'base_not_selected_from_v22_pnl':True,'finite_parameter_family':25,'all_24_perturbations_logged':True,'no_best_variant_promotion':True,'development_period_is_contaminated':True},
      'data':{'warmup':warm,'quality':dq,'contract_status':'single-contract M26 development sample; NOT then-active front-month certification'},
      'base_metrics':base,'mae_risk':mae,'tick_order_audit':tick,
      'parameter_family':{'count':int(len(family)),'profitable':int((family.net_pnl>0).sum()),'profitable_share':float((family.net_pnl>0).mean()),'positive_3of4_folds':int((family.positive_folds>=3).sum()),'median_net':float(family.net_pnl.median()),'worst_net':float(family.net_pnl.min()),'best_net':float(family.net_pnl.max()),'median_profit_factor':float(finite_pf.median()) if finite_pf.notna().any() else None},
      'slippage_stress':slips.to_dict(orient='records'),
      'promotion_blocks':['Scored development sample after full 60-day warmup is small.','Current source is M26 single-contract data, not a roll-aware then-active MNQ series.','No sealed multi-year MNQ OOS has been run.','Trader-fidelity gold set from exact screenshots/videos is not yet immutable/timestamp-labeled.','Tick source is trade-event OHLC, not bid/ask queue evidence.','No validated TopstepX production broker adapter is connected; live orders remain refused.'],
      'decision':'DO_NOT_PROMOTE_LIVE'
    }
    dump('report.json',report)
    print(json.dumps(report,indent=2,default=str))
if __name__=='__main__': main()
