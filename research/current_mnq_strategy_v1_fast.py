#!/usr/bin/env python3
from __future__ import annotations
import json, math, urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
import numpy as np, pandas as pd

D=Path('research/_mnq_data_fast'); O=Path('research/_mnq_results_fast'); D.mkdir(parents=True,exist_ok=True); O.mkdir(parents=True,exist_ok=True)
U5='https://raw.githubusercontent.com/axb0306/cme-futures-ohlc/main/MNQ/MNQ_5min_20260120_20260415.csv'
U1='https://raw.githubusercontent.com/axb0306/cme-futures-ohlc/main/MNQ/MNQ_1min_20260120_20260415.csv'
TZ='America/New_York'; C=15; PV=2.; FEE=1.22*C

@dataclass(frozen=True)
class P:
    stop:float=17.25; ztol:float=.18; zwick:float=.20; zdisp:float=.45; ztouch:int=2
    body:float=.62; rrng:float=1.25; cloc:float=.78; rej:float=.35
    room:float=1.50; tp:float=.50; slip:float=.50; target_touches:int=3

@dataclass
class Z:
    side:str; lo:float; hi:float; mid:float; touches:int; wick:float; disp:float; source:str; conf:int=0

def get(u,p):
    if not p.exists(): urllib.request.urlretrieve(u,p)
def load(p):
    x=pd.read_csv(p); x['datetime']=pd.to_datetime(x.datetime,utc=True); x=x.set_index('datetime').sort_index(); x.index=x.index.tz_convert(TZ); return x
def rth(x): return x.between_time('09:30','15:59').copy()
def tr(x):
    pc=x.close.shift(); return pd.concat([x.high-x.low,(x.high-pc).abs(),(x.low-pc).abs()],axis=1).max(axis=1)
def atr(x,n=14): return tr(x).rolling(n,min_periods=5).mean()
def feat(x):
    x=x.copy(); x['range']=(x.high-x.low).replace(0,np.nan); x['body']=(x.close-x.open).abs(); x['bf']=(x.body/x.range).fillna(0)
    x['uw']=(x.high-x[['open','close']].max(axis=1))/x.range; x['lw']=(x[['open','close']].min(axis=1)-x.low)/x.range
    x[['uw','lw']]=x[['uw','lw']].fillna(0); x['cl']=((x.close-x.low)/x.range).fillna(.5); x['medr']=x.range.rolling(10,min_periods=5).median(); x['rr']=(x.range/x.medr).fillna(0); x['atr']=atr(x)
    po=x.open.shift(); pc=x.close.shift(); x['be']=(x.close>x.open)&(pc<po)&(x.open<=pc)&(x.close>=po)&(x.bf>=.5); x['se']=(x.close<x.open)&(pc>po)&(x.open>=pc)&(x.close<=po)&(x.bf>=.5)
    return x
def htf15(x):
    y=x.resample('15min',origin='start_day',offset='9h30min',label='left',closed='left').agg(open=('open','first'),high=('high','max'),low=('low','min'),close=('close','last'),volume=('volume','sum')).dropna(); y['atr']=atr(y); return y

def pivots(x,left=2,right=2,mins=15):
    a=atr(x); rg=(x.high-x.low).replace(0,np.nan); uw=(x.high-x[['open','close']].max(axis=1))/rg; lw=(x[['open','close']].min(axis=1)-x.low)/rg; out=[]
    for i in range(left,len(x)-right):
        if not np.isfinite(a.iloc[i]) or a.iloc[i]<=0: continue
        t=x.index[i]; confirm=t+pd.Timedelta(minutes=mins*(right+1))
        if x.high.iloc[i]>=x.high.iloc[i-left:i+right+1].max():
            f=x.low.iloc[i+1:i+3]; out.append((t,confirm,'R',x.high.iloc[i],float(uw.iloc[i] or 0),(x.high.iloc[i]-f.min())/a.iloc[i],a.iloc[i]))
        if x.low.iloc[i]<=x.low.iloc[i-left:i+right+1].min():
            f=x.high.iloc[i+1:i+3]; out.append((t,confirm,'S',x.low.iloc[i],float(lw.iloc[i] or 0),(f.max()-x.low.iloc[i])/a.iloc[i],a.iloc[i]))
    return pd.DataFrame(out,columns=['t','confirm','side','price','wick','disp','atr'])

def clusters(pv,side,asof,p: P,look=40,min_touch=None):
    mt=p.ztouch if min_touch is None else min_touch
    q=pv[(pv.side==side)&(pv.confirm<=asof)&(pv.t>=asof-pd.Timedelta(days=look))&(pv.wick>=p.zwick)&(pv.disp>=p.zdisp)].sort_values('price')
    if q.empty:return []
    groups=[]; g=[]; ctr=None
    for r in q.itertuples():
        tol=max(1.,p.ztol*r.atr)
        if not g or abs(r.price-ctr)<=tol: g.append(r); ctr=np.mean([v.price for v in g])
        else: groups.append(g); g=[r]; ctr=r.price
    if g: groups.append(g)
    out=[]
    for g in groups:
        ind=[]
        for r in sorted(g,key=lambda v:v.t):
            if not ind or r.t-ind[-1].t>=pd.Timedelta(minutes=30): ind.append(r)
        if len(ind)<mt: continue
        pr=np.array([v.price for v in ind]); aa=np.median([v.atr for v in ind]); pad=.05*aa
        out.append(Z(side,float(pr.min()-pad),float(pr.max()+pad),float(pr.mean()),len(ind),float(np.mean([v.wick for v in ind])),float(np.mean([v.disp for v in ind])),'WICK'))
    return out

def levels(r5):
    ds=r5.groupby(r5.index.date).agg(hi=('high','max'),lo=('low','min')); dates=list(ds.index); pdm={}
    for i,d in enumerate(dates):
        if i: pdm[d]=(float(ds.iloc[i-1].hi),float(ds.iloc[i-1].lo))
    tmp=r5.copy(); tmp['wk']=tmp.index.to_period('W-FRI'); ws=tmp.groupby('wk').agg(hi=('high','max'),lo=('low','min')); wks=list(ws.index); prior={wks[i]:(float(ws.iloc[i-1].hi),float(ws.iloc[i-1].lo)) for i in range(1,len(wks))}
    pwm={d:prior.get(pd.Timestamp(d).to_period('W-FRI')) for d in dates}; return pdm,pwm

def fvgs(h,asof):
    q=h[(h.index+pd.Timedelta(minutes=15)<=asof)&(h.index>=asof-pd.Timedelta(days=25))]; out=[]
    for i in range(2,len(q)):
        a=q.iloc[i-2]; c=q.iloc[i]
        if c.low>a.high: out.append(Z('S',float(a.high),float(c.low),float((a.high+c.low)/2),1,0,0,'FVG'))
        if c.high<a.low: out.append(Z('R',float(c.high),float(a.low),float((c.high+a.low)/2),1,0,0,'FVG'))
    return out

def strong(r,d,p): return bool((r.close>r.open and r.bf>=p.body and r.rr>=p.rrng and r.cl>=p.cloc) if d=='L' else (r.close<r.open and r.bf>=p.body and r.rr>=p.rrng and r.cl<=1-p.cloc))
def weakstory(day,i,d):
    if i<3:return False
    q=day.iloc[i-3:i]; b=(q.close-q.open).abs().values; contract=(b[-1]<=b[0]*.9 or np.median(b[-2:])<=b[0])
    rej=(q.lw>=.30).sum()>=1 if d=='L' else (q.uw>=.30).sum()>=1
    return bool(contract and rej)

def touch(z,r,pad): return r.low<=z.hi+pad and r.high>=z.lo-pad

def choose_target(tzs,entry,d,p):
    arr=[z for z in tzs if (z.mid>entry if d=='L' else z.mid<entry)]; arr=sorted(arr,key=lambda z:abs(z.mid-entry))
    for z in arr:
        t=z.lo+p.tp*(z.hi-z.lo) if d=='L' else z.hi-p.tp*(z.hi-z.lo); dist=t-entry if d=='L' else entry-t
        if dist>=p.room*p.stop:return z,float(t),float(dist/p.stop)
    return None

def exit1(one,et,d,e,t,p):
    s=e-p.stop if d=='L' else e+p.stop; q=one[(one.index>=et)&(one.index.date==et.date())]
    for ts,r in q.iterrows():
        hs=r.low<=s if d=='L' else r.high>=s; ht=r.high>=t if d=='L' else r.low<=t
        if hs:return ts,s,'STOP_AMBIG' if ht else 'STOP'
        if ht:return ts,t,'TARGET'
    if len(q):return q.index[-1],float(q.iloc[-1].close),'FLAT'
    return et,e,'NO1M'

def run(r5,one,h,p15,p5,pdm,pwm,p):
    out=[]; days=sorted(set(r5.index.date))
    for dte in days:
        day=r5[r5.index.date==dte]; asof=day.index[0] # freeze map BEFORE RTH begins
        if len(day)<20:continue
        lv=[]
        if pdm.get(dte):lv+=list(pdm[dte])
        if pwm.get(dte):lv+=list(pwm[dte])
        f=fvgs(h,asof); a15=h[h.index+pd.Timedelta(minutes=15)<=asof].atr.tail(20).median()
        zs=clusters(p15,'S',asof,p)+clusters(p15,'R',asof,p)
        tol=max(2.,.25*a15) if np.isfinite(a15) else 4.
        for z in zs:
            z.conf=sum(z.lo-tol<=x<=z.hi+tol for x in lv)+sum(ff.side==z.side and not(ff.hi<z.lo-tol or ff.lo>z.hi+tol) for ff in f)
        tz=clusters(p5,'S',asof,p,25,p.target_touches)+clusters(p5,'R',asof,p,25,p.target_touches)
        a5=float(day.atr.dropna().median()) if day.atr.notna().any() else 20.; pad=.08*a5
        for x in lv:
            tz += [Z('R' if x>day.iloc[0].open else 'S',x-pad,x+pad,x,99,0,0,'LEVEL',2)]
        tz+=f
        for i in range(1,len(day)-1):
            ts=day.index[i]; r=day.iloc[i]
            if ts.time()<pd.Timestamp('09:35').time() or ts.time()>pd.Timestamp('15:20').time() or not np.isfinite(r.atr):continue
            cands=[]; tpad=max(1.,.10*r.atr)
            for direction,side in [('L','S'),('S','R')]:
                near=[z for z in zs if z.side==side and touch(z,r,tpad)];
                if not near:continue
                z=max(near,key=lambda z:(z.conf,z.touches,z.disp))
                if not(z.conf>=1 or z.touches>=3):continue
                if direction=='L': rej=r.lw>=p.rej and r.close>=z.mid; ctrl=strong(r,'L',p) or bool(r.be); outside=r.close>z.hi+.05*r.atr
                else: rej=r.uw>=p.rej and r.close<=z.mid; ctrl=strong(r,'S',p) or bool(r.se); outside=r.close<z.lo-.05*r.atr
                if (rej or weakstory(day,i,direction)) and ctrl:cands.append((direction,z,'REV'))
                if outside:
                    if strong(r,direction,p): cands.append((direction,z,'BRK5'))
                    else:
                        closed=h[(h.index+pd.Timedelta(minutes=15)<=ts+pd.Timedelta(minutes=5))]
                        if len(closed) and ((closed.iloc[-1].close>z.hi) if direction=='L' else (closed.iloc[-1].close<z.lo)) and r.bf>=.5:cands.append((direction,z,'BRK15'))
            if not cands:continue
            if len(set(c[0] for c in cands))!=1:continue
            direction,z,setup=max(cands,key=lambda c:(c[1].conf,c[1].touches,c[1].disp)); et=day.index[i+1]; e=float(day.iloc[i+1].open)
            pick=choose_target(tz,e,direction,p)
            if not pick:continue
            zz,t,room=pick; xt,xp,why=exit1(one,et,direction,e,t,p); pts=(xp-e) if direction=='L' else (e-xp); gross=pts*PV*C; slip=p.slip*PV*C; net=gross-FEE-slip
            out.append(dict(session=str(dte),signal=str(ts),entry_time=str(et),side='LONG' if direction=='L' else 'SHORT',setup=setup,entry=e,stop=e-p.stop if direction=='L' else e+p.stop,target=t,target_points=abs(t-e),exit_time=str(xt),exit_price=xp,exit_reason=why,gross_pnl=gross,fees=FEE,slippage_cost=slip,net_pnl=net,r=pts/p.stop,zone_touches=z.touches,confluence=z.conf,room_r=room,target_source=zz.source)); break
    return pd.DataFrame(out)

def met(t):
    if t.empty:return {'trades':0}
    x=t.net_pnl.values; w=x[x>0]; l=x[x<0]; eq=np.cumsum(x); dd=eq-np.maximum.accumulate(np.r_[0,eq])[:-1]; sd=x.std(ddof=1) if len(x)>1 else np.nan
    return {'trades':int(len(x)),'win_rate':float((x>0).mean()),'net_pnl':float(x.sum()),'avg_trade':float(x.mean()),'avg_winner':float(w.mean()) if len(w) else 0.,'median_winner':float(np.median(w)) if len(w) else 0.,'avg_loser':float(l.mean()) if len(l) else 0.,'profit_factor':float(w.sum()/abs(l.sum())) if len(l) and l.sum()!=0 else None,'sharpe':float(x.mean()/sd*np.sqrt(252)) if np.isfinite(sd) and sd else None,'max_dd':float(dd.min()),'avg_r':float(t.r.mean()),'target_rate':float((t.exit_reason=='TARGET').mean())}
def mc(t,n=10000,N=1000,block=5):
    if len(t)<5:return {'status':'INSUFFICIENT'}
    rng=np.random.default_rng(81726); x=t.net_pnl.values; finals=[]; dds=[]; streak=[]
    for _ in range(n):
        out=[]
        while len(out)<N:
            s=int(rng.integers(len(x))); out.extend(x[(s+np.arange(block))%len(x)])
        a=np.array(out[:N]); e=np.cumsum(a); dd=e-np.maximum.accumulate(np.r_[0,e])[:-1]; finals.append(e[-1]); dds.append(dd.min()); cur=best=0
        for v in a:
            if v<0:cur+=1;best=max(best,cur)
            else:cur=0
        streak.append(best)
    return {'paths':n,'terminal_p05':float(np.quantile(finals,.05)),'terminal_med':float(np.median(finals)),'prob_loss':float(np.mean(np.array(finals)<0)),'dd_med':float(np.median(dds)),'dd_ugly_p05':float(np.quantile(dds,.05)),'loss_streak_p95':float(np.quantile(streak,.95))}
def topstep(t,n=15000):
    if len(t)<5:return {'status':'INSUFFICIENT'}
    rng=np.random.default_rng(501); x=t.net_pnl.values; passn=0; fail=0; dp=[]; full=17.25*PV*C+FEE
    for _ in range(n):
        b=50000.; mll=48000.; best=0.
        for d in range(1,101):
            q=float(rng.choice(x)); adverse=max(full,-q if q<0 else 0)
            if b-adverse<=mll:fail+=1;break
            b+=q
            if b<=mll:fail+=1;break
            best=max(best,q); req=max(3000.,2*max(best,0.))
            if b-50000>=req:passn+=1;dp.append(d);break
            mll=max(mll,min(50000.,b-2000.))
        else:fail+=1
    return {'sims':n,'pass_rate':passn/n,'fail_timeout':fail/n,'median_days':float(np.median(dp)) if dp else None}

def main():
    get(U5,D/'5.csv');get(U1,D/'1.csv'); r5=feat(rth(load(D/'5.csv'))); one=rth(load(D/'1.csv')); h=htf15(r5); p15=pivots(h,mins=15); p5=pivots(r5,mins=5); pdm,pwm=levels(r5); days=sorted(set(r5.index.date)); hs=days[int(.70*len(days))]
    base=P(); led=run(r5,one,h,p15,p5,pdm,pwm,base); led.to_csv(O/'trade_ledger.csv',index=False)
    vars={'base':base,'tp40':P(tp=.4),'tp60':P(tp=.6),'room1':P(room=1.),'room2':P(room=2.),'ztight':P(ztol=.14),'zwide':P(ztol=.22),'mom_loose':P(body=.58,rrng=1.15,cloc=.74),'mom_strict':P(body=.68,rrng=1.40,cloc=.82),'stop15':P(stop=15.),'stop20':P(stop=20.),'slip1':P(slip=1.),'slip2':P(slip=2.)}
    sm=[]
    for n,p in vars.items():
        q=led if n=='base' else run(r5,one,h,p15,p5,pdm,pwm,p); m=met(q);m['variant']=n;sm.append(m)
    sdf=pd.DataFrame(sm);sdf.to_csv(O/'stress_matrix.csv',index=False)
    dev=led[led.session<str(hs)] if len(led) else led; hold=led[led.session>=str(hs)] if len(led) else led
    rep={'status':'RESEARCH_ONLY','data':{'start':str(days[0]),'end':str(days[-1]),'sessions':len(days),'holdout_start':str(hs),'bars5':len(r5),'bars1':len(one)},'baseline':met(led),'development':met(dev),'holdout':met(hold),'monte_carlo_block':mc(led),'topstep50k':topstep(led),'stress':{'variants':len(sdf),'profitable':int((sdf.net_pnl>0).sum()) if 'net_pnl' in sdf else 0,'worst_net':float(sdf.net_pnl.min()) if 'net_pnl' in sdf else None,'median_net':float(sdf.net_pnl.median()) if 'net_pnl' in sdf else None},'rules':{'one_trade_day':True,'contracts':15,'stop':17.25,'map_frozen_preopen':True,'1m_exit_order':True,'same_minute':'STOP_CONSERVATIVE'}}
    (O/'report.json').write_text(json.dumps(rep,indent=2,allow_nan=True));print(json.dumps(rep,indent=2,allow_nan=True));print('\n',sdf.to_string(index=False))
if __name__=='__main__':main()
