#!/usr/bin/env python3
"""Current MNQ Strategy v1 — research-only deterministic backtest.

This is intentionally separate from the legacy Slumdawg indicator.
Rules encoded from the current strategy discussion:
- MNQ, New York RTH only, max one trade/session.
- 15m repeated-rejection-wick support/resistance zones.
- PDH/PDL/PWH/PWL and 15m FVG context.
- 5m candle-control confirmation.
- Strong momentum breakout may confirm on 5m; weaker breakout requires 15m acceptance.
- 17.25-point stop, 15 MNQ contracts.
- Target = next significant 5m reaction structure, conservative interior/middle target.
- No lookahead. Entries occur at the next 5m bar open.
- 1m data resolves stop-vs-target ordering; same-1m ambiguity is charged as a stop.

The defaults below are broad geometric research definitions, not optimized thresholds.
The stress suite perturbs them rather than selecting the best result.
"""
from __future__ import annotations

import json
import math
import os
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

DATA_DIR = Path("research/_mnq_data")
OUT_DIR = Path("research/_mnq_results")
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

URL5 = "https://raw.githubusercontent.com/axb0306/cme-futures-ohlc/main/MNQ/MNQ_5min_20260120_20260415.csv"
URL1 = "https://raw.githubusercontent.com/axb0306/cme-futures-ohlc/main/MNQ/MNQ_1min_20260120_20260415.csv"

POINT_VALUE = 2.0
CONTRACTS = 15
STOP_POINTS_DEFAULT = 17.25
RT_FEE_PER_CONTRACT = 1.22
RTH_START = "09:30"
RTH_END = "16:00"
TZ = "America/New_York"


@dataclass(frozen=True)
class Params:
    stop_points: float = 17.25
    zone_tol_atr: float = 0.18
    zone_pad_atr: float = 0.05
    min_15_touches: int = 2
    min_5_target_touches: int = 3
    min_wick_frac: float = 0.20
    min_zone_displacement_atr: float = 0.45
    strong_body_frac: float = 0.62
    strong_range_ratio: float = 1.25
    strong_close_loc: float = 0.78
    reject_wick_frac: float = 0.35
    min_room_r: float = 1.50
    tp_depth: float = 0.50
    slippage_points_roundtrip: float = 0.50
    require_confluence_or_3touch: bool = True


@dataclass
class Zone:
    side: str
    low: float
    high: float
    center: float
    touches: int
    wick_quality: float
    displacement: float
    confluence: int
    source: str


@dataclass
class Trade:
    session: str
    signal_time: str
    entry_time: str
    side: str
    setup: str
    entry: float
    stop: float
    target: float
    target_points: float
    exit_time: str
    exit_price: float
    exit_reason: str
    gross_pnl: float
    fees: float
    slippage_cost: float
    net_pnl: float
    realized_r: float
    zone_touches: int
    zone_confluence: int
    room_r: float


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 1000:
        return
    print(f"downloading {url}")
    urllib.request.urlretrieve(url, dest)


def load_bars(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["datetime"] = pd.to_datetime(df["datetime"], utc=True)
    df = df.set_index("datetime").sort_index()
    df.index = df.index.tz_convert(TZ)
    for c in ["open", "high", "low", "close", "volume"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.dropna(subset=["open", "high", "low", "close"])


def rth_only(df: pd.DataFrame) -> pd.DataFrame:
    return df.between_time(RTH_START, "15:59", inclusive="both").copy()


def true_range(df: pd.DataFrame) -> pd.Series:
    pc = df["close"].shift(1)
    return pd.concat([(df.high-df.low), (df.high-pc).abs(), (df.low-pc).abs()], axis=1).max(axis=1)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return true_range(df).rolling(n, min_periods=max(3, n//2)).mean()


def aggregate_15m(rth5: pd.DataFrame) -> pd.DataFrame:
    out = rth5.resample("15min", origin="start_day", offset="9h30min", label="left", closed="left").agg(
        {"open":"first","high":"max","low":"min","close":"last","volume":"sum"}
    ).dropna()
    out["atr"] = atr(out, 14)
    return out


def add_5m_features(df: pd.DataFrame) -> pd.DataFrame:
    x = df.copy()
    x["range"] = (x.high-x.low).replace(0, np.nan)
    x["body"] = (x.close-x.open).abs()
    x["body_frac"] = (x.body/x.range).fillna(0)
    x["upper_wick"] = x.high-x[["open","close"]].max(axis=1)
    x["lower_wick"] = x[["open","close"]].min(axis=1)-x.low
    x["upper_wick_frac"] = (x.upper_wick/x.range).fillna(0)
    x["lower_wick_frac"] = (x.lower_wick/x.range).fillna(0)
    x["close_loc"] = ((x.close-x.low)/x.range).fillna(0.5)
    x["med_range10"] = x["range"].rolling(10, min_periods=5).median()
    x["range_ratio"] = (x["range"]/x.med_range10).replace([np.inf,-np.inf], np.nan).fillna(0)
    x["atr"] = atr(x, 14)
    prev_o, prev_c = x.open.shift(1), x.close.shift(1)
    x["bull_engulf"] = (x.close>x.open) & (prev_c<prev_o) & (x.open<=prev_c) & (x.close>=prev_o) & (x.body_frac>=0.50)
    x["bear_engulf"] = (x.close<x.open) & (prev_c>prev_o) & (x.open>=prev_c) & (x.close<=prev_o) & (x.body_frac>=0.50)
    x["inside"] = (x.high<=x.high.shift(1)) & (x.low>=x.low.shift(1))
    return x


def confirmed_pivots(df: pd.DataFrame, left: int, right: int, min_wick_frac: float, timeframe_min: int) -> pd.DataFrame:
    rows=[]
    ranges=(df.high-df.low).replace(0,np.nan)
    up=(df.high-df[["open","close"]].max(axis=1))/ranges
    lo=(df[["open","close"]].min(axis=1)-df.low)/ranges
    a=atr(df,14)
    vals=df.reset_index()
    idx_col=vals.columns[0]
    for i in range(left, len(df)-right):
        ts=df.index[i]
        atr_i=float(a.iloc[i]) if pd.notna(a.iloc[i]) else np.nan
        if not np.isfinite(atr_i) or atr_i<=0: continue
        window_hi=df.high.iloc[i-left:i+right+1]
        window_lo=df.low.iloc[i-left:i+right+1]
        confirm=ts+pd.Timedelta(minutes=timeframe_min*(right+1))
        if df.high.iloc[i] >= window_hi.max() and float(up.iloc[i] if pd.notna(up.iloc[i]) else 0)>=min_wick_frac:
            future=df.low.iloc[i+1:min(i+3,len(df))]
            disp=(df.high.iloc[i]-future.min())/atr_i if len(future) else 0
            rows.append((ts,confirm,"resistance",float(df.high.iloc[i]),float(up.iloc[i]),float(disp),atr_i))
        if df.low.iloc[i] <= window_lo.min() and float(lo.iloc[i] if pd.notna(lo.iloc[i]) else 0)>=min_wick_frac:
            future=df.high.iloc[i+1:min(i+3,len(df))]
            disp=(future.max()-df.low.iloc[i])/atr_i if len(future) else 0
            rows.append((ts,confirm,"support",float(df.low.iloc[i]),float(lo.iloc[i]),float(disp),atr_i))
    return pd.DataFrame(rows,columns=["pivot_time","confirm_time","side","price","wick","disp","atr"])


def cluster_pivots(piv: pd.DataFrame, side: str, now: pd.Timestamp, lookback_days: int, p: Params, min_touches: int) -> List[Zone]:
    if piv.empty: return []
    q=piv[(piv.side==side)&(piv.confirm_time<=now)&(piv.pivot_time>=now-pd.Timedelta(days=lookback_days))].copy()
    if q.empty: return []
    q=q[q.disp>=p.min_zone_displacement_atr]
    if q.empty: return []
    q=q.sort_values("price")
    groups=[]; cur=[]; center=None
    for row in q.itertuples():
        tol=max(1.0,p.zone_tol_atr*row.atr)
        if not cur or abs(row.price-center)<=tol:
            cur.append(row); center=float(np.mean([r.price for r in cur]))
        else:
            groups.append(cur); cur=[row]; center=row.price
    if cur: groups.append(cur)
    zones=[]
    for g in groups:
        # Require independent reactions, not adjacent bars from one event.
        times=sorted(r.pivot_time for r in g)
        independent=[]
        for r in sorted(g,key=lambda z:z.pivot_time):
            if not independent or (r.pivot_time-independent[-1].pivot_time)>=pd.Timedelta(minutes=30):
                independent.append(r)
        if len(independent)<min_touches: continue
        prices=np.array([r.price for r in independent],float)
        atr0=float(np.median([r.atr for r in independent]))
        pad=p.zone_pad_atr*atr0
        zones.append(Zone(side,float(prices.min()-pad),float(prices.max()+pad),float(prices.mean()),len(independent),
                          float(np.mean([r.wick for r in independent])),float(np.mean([r.disp for r in independent])),0,"wick_cluster"))
    return zones


def session_levels(rth5: pd.DataFrame) -> Tuple[Dict,Dict]:
    daily=rth5.groupby(rth5.index.date).agg(high=("high","max"),low=("low","min"))
    pdlev={}
    dates=list(daily.index)
    for i,d in enumerate(dates):
        if i>0: pdlev[d]=(float(daily.iloc[i-1].high),float(daily.iloc[i-1].low))
    # Previous completed Monday-Friday calendar week from RTH data.
    temp=rth5.copy(); temp["date"]=temp.index.date; temp["week"]=temp.index.to_period("W-FRI")
    weekly=temp.groupby("week").agg(high=("high","max"),low=("low","min"))
    weeks=list(weekly.index)
    wkmap={weeks[i]:(float(weekly.iloc[i-1].high),float(weekly.iloc[i-1].low)) for i in range(1,len(weeks))}
    pwlev={d:wkmap.get(pd.Timestamp(d).to_period("W-FRI")) for d in dates}
    return pdlev,pwlev


def fvg_zones(htf: pd.DataFrame, now: pd.Timestamp, lookback_days: int=20) -> List[Zone]:
    q=htf[(htf.index+pd.Timedelta(minutes=15)<=now)&(htf.index>=now-pd.Timedelta(days=lookback_days))]
    z=[]
    for i in range(2,len(q)):
        a=q.iloc[i-2]; c=q.iloc[i]
        if c.low>a.high:
            z.append(Zone("support",float(a.high),float(c.low),float((a.high+c.low)/2),1,0,0,0,"15m_bull_fvg"))
        if c.high<a.low:
            z.append(Zone("resistance",float(c.high),float(a.low),float((c.high+a.low)/2),1,0,0,0,"15m_bear_fvg"))
    return z


def confluence_count(zone: Zone, levels: List[float], fvgs: List[Zone], atr15: float) -> int:
    tol=max(2.0,0.25*atr15)
    n=sum(1 for lv in levels if lv is not None and np.isfinite(lv) and zone.low-tol<=lv<=zone.high+tol)
    for f in fvgs:
        if f.side==zone.side and not (f.high<zone.low-tol or f.low>zone.high+tol): n+=1
    return n


def nearest_active_zone(zones: List[Zone], price: float, side: str, touch_pad: float) -> Optional[Zone]:
    cand=[]
    for z in zones:
        if z.side!=side: continue
        if z.low-touch_pad<=price<=z.high+touch_pad:
            cand.append(z)
    if not cand: return None
    return max(cand,key=lambda z:(z.touches,z.confluence,z.displacement,-abs(z.center-price)))


def target_candidates(now: pd.Timestamp, entry: float, direction: str, piv5: pd.DataFrame, p: Params,
                      levels: List[float], fvgs: List[Zone], atr5: float) -> List[Zone]:
    side="resistance" if direction=="long" else "support"
    zs=cluster_pivots(piv5,side,now,20,p,p.min_5_target_touches)
    # Major D/W levels are valid destination candidates with a narrow structural zone.
    pad=max(1.0,0.08*atr5)
    for lv in levels:
        if lv is None or not np.isfinite(lv): continue
        if (direction=="long" and lv>entry) or (direction=="short" and lv<entry):
            zs.append(Zone(side,lv-pad,lv+pad,lv,99,0,0,2,"D/W_level"))
    # 15m FVG can be a destination.
    for f in fvgs:
        if (direction=="long" and f.center>entry) or (direction=="short" and f.center<entry):
            zs.append(f)
    if direction=="long": zs=[z for z in zs if z.center>entry]
    else: zs=[z for z in zs if z.center<entry]
    return sorted(zs,key=lambda z:abs(z.center-entry))


def choose_target(cands: List[Zone], entry: float, direction: str, p: Params) -> Optional[Tuple[Zone,float,float]]:
    min_dist=p.min_room_r*p.stop_points
    for z in cands:
        # Skip tiny/weak wick shelves; D/W and FVG are explicitly meaningful sources.
        if z.source=="wick_cluster" and z.touches<p.min_5_target_touches: continue
        if direction=="long":
            target=z.low+p.tp_depth*(z.high-z.low)
            dist=target-entry
        else:
            target=z.high-p.tp_depth*(z.high-z.low)
            dist=entry-target
        if dist>=min_dist:
            return z,float(target),float(dist/p.stop_points)
    return None


def strong_control(row, direction: str, p: Params) -> bool:
    if direction=="long":
        return row.close>row.open and row.body_frac>=p.strong_body_frac and row.range_ratio>=p.strong_range_ratio and row.close_loc>=p.strong_close_loc
    return row.close<row.open and row.body_frac>=p.strong_body_frac and row.range_ratio>=p.strong_range_ratio and row.close_loc<=1-p.strong_close_loc


def weakening_story(df: pd.DataFrame, i: int, direction: str) -> bool:
    if i<3: return False
    a=df.iloc[i-3:i]
    bodies=(a.close-a.open).abs().values
    # Either contraction into the zone or repeated rejection against the incoming side.
    contraction=(bodies[-1]<=bodies[0]*0.9) or (np.median(bodies[-2:])<=bodies[0])
    if direction=="long":
        rejection=(a.lower_wick_frac>=0.30).sum()>=1 or (a.close<a.open).sum()>=2
    else:
        rejection=(a.upper_wick_frac>=0.30).sum()>=1 or (a.close>a.open).sum()>=2
    return bool(contraction and rejection)


def confirmed_15m_acceptance(htf: pd.DataFrame, now: pd.Timestamp, zone: Zone, direction: str) -> bool:
    closed=htf[htf.index+pd.Timedelta(minutes=15)<=now]
    if closed.empty: return False
    last=closed.iloc[-1]
    return bool(last.close>zone.high if direction=="long" else last.close<zone.low)


def execute_trade(one: pd.DataFrame, entry_time: pd.Timestamp, direction: str, entry: float, target: float, p: Params) -> Tuple[pd.Timestamp,float,str]:
    stop=entry-p.stop_points if direction=="long" else entry+p.stop_points
    day=entry_time.date()
    path=one[(one.index>=entry_time)&(one.index.date==day)&(one.index.time<pd.Timestamp("16:00").time())]
    for ts,r in path.iterrows():
        if direction=="long":
            hit_s=r.low<=stop; hit_t=r.high>=target
        else:
            hit_s=r.high>=stop; hit_t=r.low<=target
        if hit_s and hit_t: return ts,float(stop),"STOP_AMBIGUOUS_CONSERVATIVE"
        if hit_s: return ts,float(stop),"STOP"
        if hit_t: return ts,float(target),"TARGET"
    if len(path): return path.index[-1],float(path.iloc[-1].close),"SESSION_FLAT"
    return entry_time,float(entry),"NO_1M_DATA"


def run_strategy(rth5: pd.DataFrame, one: pd.DataFrame, htf: pd.DataFrame, piv15: pd.DataFrame, piv5: pd.DataFrame,
                 pdlev: Dict, pwlev: Dict, p: Params) -> pd.DataFrame:
    trades=[]
    sessions=sorted(set(rth5.index.date))
    for d in sessions:
        day=rth5[rth5.index.date==d]
        if len(day)<20: continue
        prev=pdlev.get(d); pweek=pwlev.get(d)
        levels=[]
        if prev: levels += [prev[0],prev[1]]
        if pweek: levels += [pweek[0],pweek[1]]
        taken=False
        # Avoid first five minutes and late-day entries; one A+ trade max.
        for i in range(1,len(day)-1):
            ts=day.index[i]
            if ts.time()<pd.Timestamp("09:35").time() or ts.time()>pd.Timestamp("15:20").time(): continue
            now=ts+pd.Timedelta(minutes=5)  # signal candle is closed
            row=day.iloc[i]
            if not np.isfinite(row.atr) or row.atr<=0: continue
            closed15=htf[htf.index+pd.Timedelta(minutes=15)<=now]
            if len(closed15)<20: continue
            atr15=float(closed15.iloc[-1].atr) if np.isfinite(closed15.iloc[-1].atr) else float(np.nanmedian(closed15.atr.tail(20)))
            if not np.isfinite(atr15) or atr15<=0: continue
            fvgs=fvg_zones(htf,now)
            s15=cluster_pivots(piv15,"support",now,35,p,p.min_15_touches)
            r15=cluster_pivots(piv15,"resistance",now,35,p,p.min_15_touches)
            for z in s15+r15:
                z.confluence=confluence_count(z,levels,fvgs,atr15)
            touch_pad=max(1.0,0.10*row.atr)
            # Candidate setups are evaluated in chronological order; no best-of-day hindsight.
            candidates=[]
            for direction,zlist in [("long",s15),("short",r15)]:
                z=nearest_active_zone(zlist,float(row.close),"support" if direction=="long" else "resistance",touch_pad)
                if z is None: continue
                if p.require_confluence_or_3touch and not (z.confluence>=1 or z.touches>=3): continue
                # Reversal story: actual touch/rejection + weakening approach + control transfer.
                touched=(row.low<=z.high+touch_pad and row.high>=z.low-touch_pad)
                if direction=="long":
                    rejection=row.lower_wick_frac>=p.reject_wick_frac and row.close>=z.center
                    ctrl=strong_control(row,"long",p) or bool(row.bull_engulf)
                else:
                    rejection=row.upper_wick_frac>=p.reject_wick_frac and row.close<=z.center
                    ctrl=strong_control(row,"short",p) or bool(row.bear_engulf)
                if touched and (rejection or weakening_story(day,i,direction)) and ctrl:
                    candidates.append((direction,z,"REVERSAL_CONTROL"))
                # Strong 5m breakout OR safer weak-momentum 15m acceptance.
                if direction=="long":
                    outside=row.close>z.high+0.05*row.atr
                else:
                    outside=row.close<z.low-0.05*row.atr
                if outside:
                    if strong_control(row,direction,p):
                        candidates.append((direction,z,"BREAKOUT_5M_STRONG"))
                    elif confirmed_15m_acceptance(htf,now,z,direction) and row.body_frac>=0.50:
                        candidates.append((direction,z,"BREAKOUT_15M_SAFE"))
            if not candidates: continue
            # If both sides somehow qualify, fail closed instead of guessing.
            dirs=set(c[0] for c in candidates)
            if len(dirs)!=1: continue
            direction,z,setup=max(candidates,key=lambda x:(x[1].confluence,x[1].touches,x[1].displacement))
            entry_time=day.index[i+1]
            entry=float(day.iloc[i+1].open)
            tc=target_candidates(now,entry,direction,piv5,p,levels,fvgs,float(row.atr))
            target_sel=choose_target(tc,entry,direction,p)
            if target_sel is None: continue
            tz,target,room_r=target_sel
            stop=entry-p.stop_points if direction=="long" else entry+p.stop_points
            exit_time,exit_price,reason=execute_trade(one,entry_time,direction,entry,target,p)
            pts=(exit_price-entry) if direction=="long" else (entry-exit_price)
            gross=pts*POINT_VALUE*CONTRACTS
            fees=RT_FEE_PER_CONTRACT*CONTRACTS
            slip=p.slippage_points_roundtrip*POINT_VALUE*CONTRACTS
            net=gross-fees-slip
            trades.append(Trade(str(d),str(ts),str(entry_time),direction,setup,entry,stop,target,
                                abs(target-entry),str(exit_time),exit_price,reason,gross,fees,slip,net,
                                pts/p.stop_points,z.touches,z.confluence,room_r))
            taken=True
            break
        # max one trade/day is hard-enforced by break.
    return pd.DataFrame([asdict(t) for t in trades])


def metrics(t: pd.DataFrame) -> Dict[str,float]:
    if t.empty: return {"trades":0}
    x=t.net_pnl.astype(float).values
    wins=x[x>0]; losses=x[x<0]
    eq=np.cumsum(x); peaks=np.maximum.accumulate(np.r_[0,eq])[:-1]; dd=eq-peaks
    mean=x.mean(); sd=x.std(ddof=1) if len(x)>1 else np.nan
    downside=x[x<0].std(ddof=1) if (x<0).sum()>1 else np.nan
    pf=wins.sum()/abs(losses.sum()) if losses.sum()!=0 else np.inf
    avg_win=wins.mean() if len(wins) else 0; avg_loss=losses.mean() if len(losses) else 0
    # trade-level Sharpe annualized to ~252 sessions; one trade max/day.
    sharpe=(mean/sd*math.sqrt(252)) if np.isfinite(sd) and sd>0 else np.nan
    sortino=(mean/downside*math.sqrt(252)) if np.isfinite(downside) and downside>0 else np.nan
    return {
        "trades":int(len(t)),"win_rate":float((x>0).mean()),"net_pnl":float(x.sum()),"avg_trade":float(mean),
        "avg_winner":float(avg_win),"median_winner":float(np.median(wins) if len(wins) else 0),"avg_loser":float(avg_loss),
        "profit_factor":float(pf),"sharpe_trade_ann":float(sharpe),"sortino_trade_ann":float(sortino),
        "max_drawdown":float(dd.min() if len(dd) else 0),"avg_realized_r":float(t.realized_r.mean()),
        "median_realized_r":float(t.realized_r.median()),"target_hit_rate":float((t.exit_reason=="TARGET").mean()),
        "stop_rate":float(t.exit_reason.str.startswith("STOP").mean()),
    }


def monte_carlo(t: pd.DataFrame, npaths:int=20000, ntrades:int=1000, block:int=5, seed:int=20260817) -> Dict:
    if len(t)<5: return {"status":"INSUFFICIENT_TRADES"}
    rng=np.random.default_rng(seed); x=t.net_pnl.astype(float).values
    finals=[]; dds=[]; streaks=[]
    for _ in range(npaths):
        # circular block bootstrap preserves some clustering/regime dependence.
        out=[]
        while len(out)<ntrades:
            s=int(rng.integers(0,len(x)))
            out.extend([x[(s+j)%len(x)] for j in range(block)])
        arr=np.array(out[:ntrades])
        eq=np.cumsum(arr); peak=np.maximum.accumulate(np.r_[0,eq])[:-1]; dd=eq-peak
        finals.append(eq[-1]); dds.append(dd.min())
        cur=best=0
        for v in arr:
            if v<0: cur+=1; best=max(best,cur)
            else: cur=0
        streaks.append(best)
    return {
        "paths":npaths,"simulated_trades_per_path":ntrades,"block":block,
        "terminal_pnl_p05":float(np.quantile(finals,.05)),"terminal_pnl_median":float(np.median(finals)),
        "terminal_pnl_p95":float(np.quantile(finals,.95)),"prob_terminal_loss":float(np.mean(np.array(finals)<0)),
        "max_dd_median":float(np.median(dds)),"max_dd_p05_ugly":float(np.quantile(dds,.05)),
        "losing_streak_median":float(np.median(streaks)),"losing_streak_p95":float(np.quantile(streaks,.95)),
    }


def topstep_sim(t: pd.DataFrame, n:int=30000, seed:int=42) -> Dict:
    if len(t)<5: return {"status":"INSUFFICIENT_TRADES"}
    rng=np.random.default_rng(seed)
    # Use observed trade outcomes; intraday MLL stress assumes a full stop can be visited before any winner.
    outcomes=t.net_pnl.astype(float).values
    full_stop=STOP_POINTS_DEFAULT*POINT_VALUE*CONTRACTS + RT_FEE_PER_CONTRACT*CONTRACTS
    passes=0; days_pass=[]; fails=0
    for _ in range(n):
        bal=50000.0; mll=48000.0; best_day=0.0
        for day in range(1,101):
            pnl=float(rng.choice(outcomes))
            adverse=max(full_stop, -pnl if pnl<0 else 0.0)
            if bal-adverse<=mll:
                fails+=1; break
            bal+=pnl
            if bal<=mll:
                fails+=1; break
            best_day=max(best_day,pnl)
            total=bal-50000.0
            required=max(3000.0,2.0*max(best_day,0.0))
            if total>=required:
                passes+=1; days_pass.append(day); break
            mll=max(mll,min(50000.0,bal-2000.0))
        else:
            fails+=1
    return {"sims":n,"pass_rate":passes/n,"fail_or_timeout_rate":fails/n,
            "median_days_to_pass":float(np.median(days_pass)) if days_pass else None,
            "p90_days_to_pass":float(np.quantile(days_pass,.90)) if days_pass else None}


def main():
    download(URL5,DATA_DIR/"mnq5.csv"); download(URL1,DATA_DIR/"mnq1.csv")
    raw5=load_bars(DATA_DIR/"mnq5.csv"); raw1=load_bars(DATA_DIR/"mnq1.csv")
    rth5=add_5m_features(rth_only(raw5)); one=rth_only(raw1); htf=aggregate_15m(rth5)
    piv15=confirmed_pivots(htf,2,2,Params().min_wick_frac,15)
    piv5=confirmed_pivots(rth5,2,2,Params().min_wick_frac,5)
    pdlev,pwlev=session_levels(rth5)
    dates=sorted(set(rth5.index.date)); split=max(1,int(len(dates)*0.70)); holdout_start=dates[split]
    base=Params()
    ledger=run_strategy(rth5,one,htf,piv15,piv5,pdlev,pwlev,base)
    ledger.to_csv(OUT_DIR/"trade_ledger.csv",index=False)
    if not ledger.empty:
        ledger[ledger.session < str(holdout_start)].to_csv(OUT_DIR/"development_ledger.csv",index=False)
        ledger[ledger.session >= str(holdout_start)].to_csv(OUT_DIR/"holdout_ledger.csv",index=False)
    variants={
        "baseline":base,
        "tp_40":Params(tp_depth=.40),"tp_60":Params(tp_depth=.60),
        "room_1R":Params(min_room_r=1.0),"room_2R":Params(min_room_r=2.0),
        "zone_tight":Params(zone_tol_atr=.14),"zone_wide":Params(zone_tol_atr=.22),
        "momentum_loose":Params(strong_body_frac=.58,strong_range_ratio=1.15,strong_close_loc=.74),
        "momentum_strict":Params(strong_body_frac=.68,strong_range_ratio=1.40,strong_close_loc=.82),
        "stop_15":Params(stop_points=15.0),"stop_20":Params(stop_points=20.0),
        "slip_0":Params(slippage_points_roundtrip=0.0),"slip_1":Params(slippage_points_roundtrip=1.0),
        "slip_2":Params(slippage_points_roundtrip=2.0),
        "no_confluence_gate":Params(require_confluence_or_3touch=False),
    }
    stress=[]
    for name,par in variants.items():
        tr=ledger if name=="baseline" else run_strategy(rth5,one,htf,piv15,piv5,pdlev,pwlev,par)
        m=metrics(tr); m["variant"]=name; stress.append(m)
    stressdf=pd.DataFrame(stress); stressdf.to_csv(OUT_DIR/"stress_matrix.csv",index=False)
    dev=ledger[ledger.session < str(holdout_start)] if not ledger.empty else ledger
    hold=ledger[ledger.session >= str(holdout_start)] if not ledger.empty else ledger
    report={
        "status":"RESEARCH_ONLY_NOT_LIVE_APPROVED",
        "data":{"first_session":str(dates[0]),"last_session":str(dates[-1]),"sessions":len(dates),"holdout_start":str(holdout_start),
                "rth_5m_bars":int(len(rth5)),"rth_1m_bars":int(len(one))},
        "rules":{"one_trade_max_per_day":True,"contracts":CONTRACTS,"stop_points":base.stop_points,"point_value":POINT_VALUE,
                 "same_1m_stop_target_policy":"STOP_CONSERVATIVE","entry":"NEXT_5M_OPEN","session":"09:30-16:00 ET"},
        "baseline":metrics(ledger),"development":metrics(dev),"holdout":metrics(hold),
        "monte_carlo":monte_carlo(ledger),"topstep_50k":topstep_sim(ledger),
        "stress_summary":{"variants":len(stressdf),"profitable_variants":int((stressdf.net_pnl>0).sum()) if "net_pnl" in stressdf else 0,
                          "worst_variant_net":float(stressdf.net_pnl.min()) if "net_pnl" in stressdf else None,
                          "median_variant_net":float(stressdf.net_pnl.median()) if "net_pnl" in stressdf else None},
        "limits":["Available public MNQ data currently covers only the listed sessions, not 1,000 independent trades.",
                  "Thresholds are broad predeclared research geometry, not fitted to maximize this sample.",
                  "Topstep simulation uses current 50K MLL/profit/consistency mechanics and observed ledger resampling; it is not a promise of future passing."],
    }
    (OUT_DIR/"report.json").write_text(json.dumps(report,indent=2,allow_nan=True))
    print(json.dumps(report,indent=2,allow_nan=True))
    print("\nSTRESS MATRIX\n",stressdf.to_string(index=False))

if __name__=="__main__":
    main()
