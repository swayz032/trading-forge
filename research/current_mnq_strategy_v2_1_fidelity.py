#!/usr/bin/env python3
from __future__ import annotations
import itertools, json, math, urllib.request
from dataclasses import dataclass
from pathlib import Path
import numpy as np
import pandas as pd

from research import current_mnq_strategy_v1_fast as v1
from research import current_mnq_strategy_v2_ab as v2

OUT = Path("research/_mnq_v21_fidelity")
DATA = Path("research/_mnq_v21_data")
OUT.mkdir(parents=True, exist_ok=True)
DATA.mkdir(parents=True, exist_ok=True)

C, PV, FEE, STOP = 15, 2.0, 1.22 * 15, 17.25
TRADE_START = pd.Timestamp("09:30").time()
LAST_ENTRY = pd.Timestamp("12:00").time()

@dataclass(frozen=True)
class Variant:
    name: str
    bias_mode: str
    ztouch: int
    room: float
    tp: float
    reversal_mode: str

@dataclass
class Target:
    z: object
    source: str
    major: bool
    fvg_confluent: bool

def download(url, path):
    if not path.exists():
        urllib.request.urlretrieve(url, path)

def active_fvgs_partial(h: pd.DataFrame, asof: pd.Timestamp, look_days: int = 25):
    q = h[(h.index + pd.Timedelta(minutes=15) <= asof) &
          (h.index >= asof - pd.Timedelta(days=look_days))]
    n = len(q)
    if n < 3:
        return []
    lows = q.low.to_numpy(float)
    highs = q.high.to_numpy(float)
    fut_min = np.full(n, np.inf)
    fut_max = np.full(n, -np.inf)
    if n > 1:
        fut_min[:-1] = np.minimum.accumulate(lows[:0:-1])[::-1]
        fut_max[:-1] = np.maximum.accumulate(highs[:0:-1])[::-1]
    out = []
    for i in range(2, n):
        a, c = q.iloc[i-2], q.iloc[i]
        if c.low > a.high:
            lo, hi = float(a.high), float(c.low)
            m = fut_min[i]
            if m <= lo:
                continue
            rem_hi = hi if not np.isfinite(m) else min(hi, float(m))
            if rem_hi > lo:
                out.append(v1.Z("S", lo, rem_hi, (lo+rem_hi)/2, 1, 0, 0, "FVG_ACTIVE_PARTIAL"))
        if c.high < a.low:
            lo, hi = float(c.high), float(a.low)
            m = fut_max[i]
            if m >= hi:
                continue
            rem_lo = lo if not np.isfinite(m) else max(lo, float(m))
            if hi > rem_lo:
                out.append(v1.Z("R", rem_lo, hi, (rem_lo+hi)/2, 1, 0, 0, "FVG_ACTIVE_PARTIAL"))
    return out

def zone_overlap(a, b, tol=0.0):
    return not (a.hi < b.lo - tol or b.hi < a.lo - tol)

def prior_bars(full5: pd.DataFrame, ts: pd.Timestamp, n: int):
    return full5[full5.index < ts].tail(n)

def reversal_state(full5, ts, r, direction, z, p, mode):
    q = prior_bars(full5, ts, 5)
    if len(q) < 4:
        return False, 0, {}
    q4 = q.tail(4)
    approach = bool(q4.close.iloc[-1] < q4.open.iloc[0]) if direction == "L" else bool(q4.close.iloc[-1] > q4.open.iloc[0])
    bodies = q4.body.to_numpy(float)
    ranges = q4["range"].to_numpy(float)
    weakening = bool(np.nanmedian(bodies[-2:]) <= max(bodies[0], 1e-9) * 0.95)
    compression = bool((np.isfinite(ranges[-1]) and np.isfinite(ranges[0]) and ranges[-1] <= ranges[0] * 0.85) or
                       (q4.high.iloc[-1] <= q4.high.iloc[-2] and q4.low.iloc[-1] >= q4.low.iloc[-2]))
    prev = q.iloc[-1]
    rejection = bool(max(r.lw, prev.lw) >= p.rej) if direction == "L" else bool(max(r.uw, prev.uw) >= p.rej)
    if direction == "L":
        failed_push = bool(min(float(r.low), float(prev.low)) <= z.mid and float(r.close) >= z.mid)
        takeover = bool(r.be or v2.strong_bar(r, "L", p))
        away = bool(r.close >= z.mid)
    else:
        failed_push = bool(max(float(r.high), float(prev.high)) >= z.mid and float(r.close) <= z.mid)
        takeover = bool(r.se or v2.strong_bar(r, "S", p))
        away = bool(r.close <= z.mid)
    displacement = bool(takeover and (r.rr >= 1.0 or r.be or r.se))
    fight = bool(rejection and (weakening or compression or failed_push))
    if mode == "STRICT":
        ok = bool(approach and rejection and failed_push and takeover and away and displacement and (weakening or compression))
    else:
        ok = bool(approach and fight and takeover and away and displacement)
    score = int(sum([approach, weakening, compression, rejection, failed_push, takeover, away, displacement]))
    meta = dict(approach=approach, weakening=weakening, compression=compression,
                rejection=rejection, failed_push=failed_push, takeover=takeover,
                away=away, displacement=displacement, fight=fight)
    return ok, score, meta

def breakout_pressure(full5, ts, direction):
    q = prior_bars(full5, ts, 3)
    if len(q) < 3:
        return False
    if direction == "L":
        return bool((q.close > q.open).sum() >= 2 and q.close.iloc[-1] >= q.close.iloc[0])
    return bool((q.close < q.open).sum() >= 2 and q.close.iloc[-1] <= q.close.iloc[0])

def build_targets(p5, h15, asof, p, pdm, pwm, dte):
    wick = v1.clusters(p5, "S", asof, p, look=25, min_touch=3) + v1.clusters(p5, "R", asof, p, look=25, min_touch=3)
    levels = []
    pad = 2.0
    if dte in pdm:
        pdh, pdl = pdm[dte]
        levels += [v1.Z("B", pdh-pad, pdh+pad, pdh, 99, 0, 0, "PDH"),
                   v1.Z("B", pdl-pad, pdl+pad, pdl, 99, 0, 0, "PDL")]
    if pwm.get(dte):
        pwh, pwl = pwm[dte]
        levels += [v1.Z("B", pwh-pad, pwh+pad, pwh, 99, 0, 0, "PWH"),
                   v1.Z("B", pwl-pad, pwl+pad, pwl, 99, 0, 0, "PWL")]
    active = active_fvgs_partial(h15, asof)
    anchors = wick + levels
    out = []
    for a in anchors:
        fvg_conf = any(zone_overlap(a, f, 6.0) for f in active)
        major = bool(a.source in ("PDH","PDL","PWH","PWL") or a.touches >= 4 or fvg_conf)
        out.append(Target(a, a.source, major, fvg_conf))
    for f in active:
        if any(zone_overlap(f, a, 6.0) for a in anchors):
            out.append(Target(f, "FVG_CONFLUENT", True, True))
    return out

def choose_target(targets, entry, direction, p, setup):
    eligible = []
    for t in targets:
        z = t.z
        if direction == "L":
            if z.mid <= entry:
                continue
            if z.side not in ("R","B") and t.source != "FVG_CONFLUENT":
                continue
            px = z.lo + p.tp * (z.hi-z.lo)
            dist = px - entry
        else:
            if z.mid >= entry:
                continue
            if z.side not in ("S","B") and t.source != "FVG_CONFLUENT":
                continue
            px = z.hi - p.tp * (z.hi-z.lo)
            dist = entry - px
        if dist >= p.room * p.stop:
            eligible.append((float(dist), t, float(px)))
    if not eligible:
        return None
    eligible.sort(key=lambda x: x[0])
    if setup == "BRK5":
        majors = [x for x in eligible if x[1].major]
        chosen = majors[0] if majors else eligible[0]
    else:
        chosen = eligible[0]
    dist, t, px = chosen
    return t, px, float(dist / p.stop)

def prepare():
    p5 = DATA/"mnq5.csv"; p1 = DATA/"mnq1.csv"
    download(v2.MNQ5, p5); download(v2.MNQ1, p1)
    full5_raw = v2.load_mnq(p5); one_raw = v2.load_mnq(p1)
    return v2.prepare(full5_raw, one_raw)

def run_variant(env, variant: Variant):
    full5, r5, one = env["full5"], env["r5"], env["one"]
    h = env["h_ext"]; p15 = env["p15_ext"]; p5 = env["p5_ext"]
    pdm, pwm, pcm = env["pdm"], env["pwm"], env["pcm"]
    p = v1.P(stop=STOP, ztouch=variant.ztouch, room=variant.room, tp=variant.tp)
    out = []
    for dte in sorted(set(r5.index.date)):
        session = r5[r5.index.date == dte]
        if len(session) < 20:
            continue
        open_ts = session.index[0]
        bias, bias_score, _ = v2.premarket_bias(full5, dte, pdm, pwm, pcm)
        active_open = active_fvgs_partial(h, open_ts)
        zones = v1.clusters(p15, "S", open_ts, p) + v1.clusters(p15, "R", open_ts, p)
        if not zones:
            continue
        refs = []
        if dte in pdm: refs += list(pdm[dte])
        if pwm.get(dte): refs += list(pwm[dte])
        a15 = h[h.index + pd.Timedelta(minutes=15) <= open_ts].atr.tail(20).median()
        tol = max(2.0, 0.20*a15) if np.isfinite(a15) else 4.0
        for z in zones:
            z.conf = sum(z.lo-tol <= x <= z.hi+tol for x in refs)
            z.conf += int(any(zone_overlap(z, f, tol) for f in active_open))
        for i in range(0, len(session)-1):
            ts = session.index[i]
            if ts.time() < TRADE_START:
                continue
            entry_time = session.index[i+1]
            if entry_time.time() > LAST_ENTRY:
                break
            r = session.iloc[i]
            if not np.isfinite(r.atr):
                continue
            tpad = max(1.0, 0.10*r.atr)
            candidates = []
            for direction, side in [("L","S"),("S","R")]:
                near = [z for z in zones if z.side == side and v1.touch(z, r, tpad)]
                if not near:
                    continue
                z = max(near, key=lambda q: (q.conf, q.touches, q.disp))
                if not (z.conf >= 1 or z.touches >= variant.ztouch):
                    continue
                rev_ok, rev_score, _ = reversal_state(full5, ts, r, direction, z, p, variant.reversal_mode)
                if rev_ok and v2.bias_allows(bias, direction, variant.bias_mode, "REV", 5, z):
                    candidates.append((direction, z, "REV", rev_score))
                outside = r.close > z.hi + 0.05*r.atr if direction == "L" else r.close < z.lo - 0.05*r.atr
                if outside and breakout_pressure(full5, ts, direction):
                    if v2.strong_bar(r, direction, p):
                        if v2.bias_allows(bias, direction, variant.bias_mode, "BRK5", 5, z):
                            candidates.append((direction, z, "BRK5", 8))
                    else:
                        closed = h[(h.index + pd.Timedelta(minutes=15) <= entry_time)]
                        if len(closed):
                            hr = closed.iloc[-1]
                            hrange = max(float(hr.high-hr.low), .25)
                            hbf = abs(float(hr.close-hr.open))/hrange
                            accepted = hr.close > z.hi if direction == "L" else hr.close < z.lo
                            if accepted and hbf >= .50 and r.bf >= .45:
                                if v2.bias_allows(bias, direction, variant.bias_mode, "BRK15", 4, z):
                                    candidates.append((direction, z, "BRK15", 6))
            if not candidates:
                continue
            if len(set(c[0] for c in candidates)) != 1:
                continue
            direction, z, setup, story_score = max(candidates, key=lambda c: (c[3], c[1].conf, c[1].touches, c[1].disp))
            entry = float(session.iloc[i+1].open)
            targets = build_targets(p5, h, entry_time, p, pdm, pwm, dte)
            picked = choose_target(targets, entry, direction, p, setup)
            if not picked:
                continue
            tgt, target, room_r = picked
            exit_time, exit_price, why = v2.exit_1m(one, entry_time, direction, entry, target, p)
            pts = exit_price-entry if direction == "L" else entry-exit_price
            gross = pts*PV*C
            slip = p.slip*PV*C
            net = gross - FEE - slip
            out.append({
                "variant": variant.name, "session": str(dte), "signal": str(ts),
                "entry_time": str(entry_time), "side": "LONG" if direction=="L" else "SHORT",
                "setup": setup, "premarket_bias": bias, "premarket_score": bias_score,
                "entry": entry, "stop": entry-p.stop if direction=="L" else entry+p.stop,
                "target": target, "target_points": abs(target-entry), "target_source": tgt.source,
                "target_major": tgt.major, "target_fvg_confluent": tgt.fvg_confluent,
                "exit_time": str(exit_time), "exit_price": exit_price, "exit_reason": why,
                "gross_pnl": gross, "fees": FEE, "slippage_cost": slip, "net_pnl": net,
                "r": pts/p.stop, "zone_touches": z.touches, "confluence": z.conf,
                "room_r": room_r, "story_score": story_score,
                "bias_mode": variant.bias_mode, "ztouch_rule": variant.ztouch,
                "room_rule": variant.room, "tp_depth": variant.tp,
                "reversal_mode": variant.reversal_mode
            })
            break
    return pd.DataFrame(out)

def variants():
    out=[]; k=0
    for bias,zt,room,tp,rev in itertools.product(["SOFT","HARD"],[2,3],[1.5,2.0],[.40,.50,.60],["STRUCTURED","STRICT"]):
        k+=1
        out.append(Variant(f"V{k:03d}",bias,zt,room,tp,rev))
    return out

def metrics(t):
    return v2.trade_metrics(t)

def fold_results(ledgers, vars_, days, nfold=6):
    folds=np.array_split(np.array(days,dtype=object),nfold)
    d2f={str(d):i for i,a in enumerate(folds) for d in a}
    rows=[]
    for v in vars_:
        led=ledgers[v.name].copy()
        if len(led): led["fold"]=led.session.map(d2f)
        for fi,fd in enumerate(folds):
            q=led[led.fold==fi] if len(led) else led
            m=metrics(q); m.update(variant=v.name,fold=fi,days=len(fd)); rows.append(m)
    return pd.DataFrame(rows), folds

def axis_summary(summary, axis):
    rows=[]
    for val,q in summary.groupby(axis):
        rows.append({axis:val,"variants":len(q),"profitable":int((q.net_pnl>0).sum()),
                     "median_net":float(q.net_pnl.median()),
                     "median_pf":float(q.profit_factor.replace(np.inf,np.nan).median()),
                     "robust":int(q.robust_flag.sum())})
    return pd.DataFrame(rows)

def bootstrap_block(x, paths=5000, horizon=1000, block=5, seed=20260817):
    rng=np.random.default_rng(seed); x=np.asarray(x,float); n=len(x)
    if n==0: return {}
    terminals=[]; dds=[]
    for _ in range(paths):
        seq=[]
        while len(seq)<horizon:
            s=int(rng.integers(0,max(1,n-block+1)))
            seq.extend(x[s:s+block].tolist())
        a=np.asarray(seq[:horizon])
        eq=np.cumsum(a); peak=np.maximum.accumulate(np.r_[0.0,eq])[:-1]
        terminals.append(eq[-1]); dds.append(np.min(eq-peak))
    return {"paths":paths,"horizon":horizon,"terminal_p05":float(np.percentile(terminals,5)),
            "terminal_median":float(np.median(terminals)),"dd_median":float(np.median(dds)),
            "dd_ugly_p05":float(np.percentile(dds,5))}

def main():
    env=prepare()
    vars_=variants()
    base=[v for v in vars_ if (v.bias_mode,v.ztouch,v.room,v.tp,v.reversal_mode)==("SOFT",2,1.5,.50,"STRUCTURED")][0]
    ledgers={}; rows=[]
    for v in vars_:
        led=run_variant(env,v); ledgers[v.name]=led
        mm=metrics(led); mm.update(vars(v)); rows.append(mm)
    summary=pd.DataFrame(rows)
    days=sorted(set(env["r5"].index.date))
    folds_df, folds=fold_results(ledgers,vars_,days,6)
    fr=folds_df.groupby("variant").agg(
        positive_folds=("net_pnl",lambda s:int((s>0).sum())),
        median_fold_net=("net_pnl","median"),
        worst_fold_net=("net_pnl","min"),
        median_fold_pf=("profit_factor",lambda s:float(pd.Series(s).replace(np.inf,np.nan).median()))
    ).reset_index()
    summary=summary.merge(fr,on="variant",how="left")
    summary["robust_flag"]=(summary.trades>=20)&(summary.profit_factor>1)&(summary.positive_folds>=4)
    pbo, pbo_rows=v2.cscv_pbo(ledgers,vars_,folds,days)
    base_led=ledgers[base.name]
    base_m=metrics(base_led)
    old_base=v2.run_variant(env, v2.Variant("OLDV2","EXT","SOFT",2,1.5,.50))
    old_m=metrics(old_base)
    axis=pd.concat([axis_summary(summary,"bias_mode"),axis_summary(summary,"ztouch"),axis_summary(summary,"room"),axis_summary(summary,"tp"),axis_summary(summary,"reversal_mode")],ignore_index=True,sort=False)
    side=base_led.groupby("side").net_pnl.agg(["count","sum","mean"]).reset_index() if len(base_led) else pd.DataFrame()
    setup=base_led.groupby("setup").net_pnl.agg(["count","sum","mean"]).reset_index() if len(base_led) else pd.DataFrame()
    bias=base_led.groupby("premarket_bias").net_pnl.agg(["count","sum","mean"]).reset_index() if len(base_led) else pd.DataFrame()
    entry_times=pd.to_datetime(base_led.entry_time) if len(base_led) else pd.Series(dtype="datetime64[ns]")
    early=int((entry_times.dt.time <= pd.Timestamp("09:45").time()).sum()) if len(base_led) else 0
    after_noon=int((entry_times.dt.time > LAST_ENTRY).sum()) if len(base_led) else 0
    dup_days=int(base_led.session.duplicated().sum()) if len(base_led) else 0
    mc=bootstrap_block(base_led.net_pnl.to_numpy(float) if len(base_led) else [])
    summary.to_csv(OUT/"variant_summary.csv",index=False)
    folds_df.to_csv(OUT/"fold_results.csv",index=False)
    pbo_rows.to_csv(OUT/"cscv_pbo_splits.csv",index=False)
    base_led.to_csv(OUT/"base_v21_ledger.csv",index=False)
    old_base.to_csv(OUT/"old_v2_ledger.csv",index=False)
    axis.to_csv(OUT/"axis_summary.csv",index=False)
    side.to_csv(OUT/"base_side.csv",index=False)
    setup.to_csv(OUT/"base_setup.csv",index=False)
    bias.to_csv(OUT/"base_bias.csv",index=False)
    report={
        "status":"RESEARCH_ONLY_NOT_LIVE_APPROVED",
        "anti_overfit_contract":{"predeclared_variants":48,"base_selected_before_v21_pnl":base.name,
            "all_variants_logged":True,"no_unbounded_optimizer":True,"mnq_2026_is_contaminated_development_data":True,
            "fixed_semantic_repairs":["premarket bars warm 09:30 candle story","entry must be <=12:00 ET","15m S/R remains pre-open frozen","5m target map updates causally at entry","partial FVG mitigation","FVG entry-zone confluence capped binary","structured reversal state machine","strong BRK5 may skip standard shelf for next major destination"]},
        "data":{"start":str(days[0]),"end":str(days[-1]),"sessions":len(days)},
        "base_variant":vars(base),"base_metrics":base_m,"old_v2_metrics_same_data":old_m,
        "family":{"count":len(summary),"profitable":int((summary.net_pnl>0).sum()),"robust":int(summary.robust_flag.sum()),"median_net":float(summary.net_pnl.median()),"worst_net":float(summary.net_pnl.min()),"best_net":float(summary.net_pnl.max())},
        "pbo_style":{"estimate":float(pbo) if np.isfinite(pbo) else None,"splits":len(pbo_rows)},
        "semantic_checks":{"duplicate_trade_days":dup_days,"entries_after_1200":after_noon,"entries_at_or_before_0945":early,"max_zone_confluence":int(base_led.confluence.max()) if len(base_led) else 0,"median_target_points":float(base_led.target_points.median()) if len(base_led) else None,"avg_target_points":float(base_led.target_points.mean()) if len(base_led) else None},
        "monte_carlo_block":mc,
        "warnings":["Jan-Apr 2026 is development data already inspected; none of these results are final out-of-sample certification.","PBO-style estimate uses only six chronological folds and closely related variants.","Do not promote a parameter only because it has the highest P&L."]}
    (OUT/"report.json").write_text(json.dumps(report,indent=2,default=str))
    print(json.dumps(report,indent=2,default=str))
    print("\nTOP ROBUST VARIANTS (inspection only):")
    print(summary.sort_values(["robust_flag","net_pnl"],ascending=[False,False]).head(15).to_string(index=False))
    print("\nBASE SIDE:"); print(side.to_string(index=False) if len(side) else "none")
    print("\nBASE SETUP:"); print(setup.to_string(index=False) if len(setup) else "none")

if __name__=="__main__":
    main()
