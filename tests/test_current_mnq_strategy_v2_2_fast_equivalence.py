from dataclasses import replace
import numpy as np
import pandas as pd
from research import current_mnq_strategy_v2_2_engine as b
from research import current_mnq_strategy_v2_2_engine_fast as fast


def reference(zone,bars,asof,p):
    q=bars[(bars.index>=zone.created)&(bars.index<asof)]
    if q.empty: return zone
    z=replace(zone); tests=0; broken_at=None
    for ts,r in q.iterrows():
        atr=float(r.get('atr',np.nan)); clear=p.breakout_clear_atr*atr if np.isfinite(atr) else b.TICK*2
        if r.low<=z.hi and r.high>=z.lo: tests+=1
        if z.side=='S' and r.close<z.lo-clear: broken_at=ts; break
        if z.side=='R' and r.close>z.hi+clear: broken_at=ts; break
    if broken_at is None:
        if tests: z.state=b.ZoneState.TESTED
        return z
    original=z.side; z.state=b.ZoneState.BROKEN
    later=q[q.index>broken_at]
    for _,r in later.iterrows():
        if r.low<=z.hi and r.high>=z.lo:
            if original=='S' and r.close<=z.mid: z.side='R'; z.state=b.ZoneState.FLIPPED_RETEST
            elif original=='R' and r.close>=z.mid: z.side='S'; z.state=b.ZoneState.FLIPPED_RETEST
            break
    return z


def test_vectorized_lifecycle_matches_reference_across_random_paths():
    rng=np.random.default_rng(22026); p=b.Params()
    for case in range(100):
        idx=pd.date_range('2026-03-25 09:00',periods=40,freq='5min',tz=b.TZ)
        basepx=100+np.cumsum(rng.normal(0,0.7,len(idx)))
        op=basepx+rng.normal(0,.2,len(idx)); cl=basepx+rng.normal(0,.2,len(idx))
        hi=np.maximum(op,cl)+rng.uniform(.1,1.2,len(idx)); lo=np.minimum(op,cl)-rng.uniform(.1,1.2,len(idx)); atr=np.full(len(idx),10.0)
        bars=pd.DataFrame({'open':op,'high':hi,'low':lo,'close':cl,'atr':atr},index=idx)
        side='S' if case%2==0 else 'R'; state=b.ZoneState.ACTIVE_SUPPORT if side=='S' else b.ZoneState.ACTIVE_RESISTANCE
        z=b.Zone('z',side,99,101,100,2,.5,.7,.7,.7,.7,.7,.8,idx[0],idx[0],state=state)
        a=reference(z,bars,idx[-1]+pd.Timedelta(minutes=5),p); c=fast.zone_state_at(z,bars,idx[-1]+pd.Timedelta(minutes=5),p)
        assert (a.state,a.side)==(c.state,c.side)
