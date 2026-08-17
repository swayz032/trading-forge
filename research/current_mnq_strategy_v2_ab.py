#!/usr/bin/env python3
from __future__ import annotations

import itertools
import json
import math
import urllib.request
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import norm, skew, kurtosis

from research import current_mnq_strategy_v1_fast as v1

OUT = Path('research/_mnq_v2_ab')
DATA = Path('research/_mnq_v2_data')
OUT.mkdir(parents=True, exist_ok=True)
DATA.mkdir(parents=True, exist_ok=True)

MNQ5 = 'https://raw.githubusercontent.com/axb0306/cme-futures-ohlc/main/MNQ/MNQ_5min_20260120_20260415.csv'
MNQ1 = 'https://raw.githubusercontent.com/axb0306/cme-futures-ohlc/main/MNQ/MNQ_1min_20260120_20260415.csv'
NQ5 = 'https://raw.githubusercontent.com/Wendigooor/nq_analyze/main/frd_sample_futures_NQ/NQ_5min_sample.csv'
NQ1 = 'https://raw.githubusercontent.com/Wendigooor/nq_analyze/main/frd_sample_futures_NQ/NQ_1min_sample.csv'

C = 15
PV = 2.0
FEE = 1.22 * C
STOP = 17.25
TRADE_START = pd.Timestamp('09:30').time()
TRADE_END = pd.Timestamp('12:00').time()
PRE_START = pd.Timestamp('04:00').time()
PRE_END = pd.Timestamp('09:29').time()


@dataclass(frozen=True)
class Variant:
    name: str
    map_scope: str       # RTH | EXT
    bias_mode: str       # SOFT | HARD
    ztouch: int          # 2 | 3
    room: float          # 1.5 | 2.0
    tp: float            # .40 | .50 | .60


def download(url: str, path: Path) -> None:
    if not path.exists():
        urllib.request.urlretrieve(url, path)


def load_mnq(path: Path) -> pd.DataFrame:
    x = pd.read_csv(path)
    x['datetime'] = pd.to_datetime(x['datetime'], utc=True)
    x = x.set_index('datetime').sort_index()
    x.index = x.index.tz_convert(v1.TZ)
    return x


def load_nq(path: Path) -> pd.DataFrame:
    x = pd.read_csv(path)
    x['timestamp'] = pd.to_datetime(x['timestamp'])
    x = x.set_index('timestamp').sort_index()
    x.index = x.index.tz_localize(v1.TZ, ambiguous='infer', nonexistent='shift_forward')
    return x


def between_times(x: pd.DataFrame, start, end) -> pd.DataFrame:
    return x[(x.index.time >= start) & (x.index.time <= end)].copy()


def rth(x: pd.DataFrame) -> pd.DataFrame:
    return between_times(x, pd.Timestamp('09:30').time(), pd.Timestamp('15:59').time())


def prev_maps(r5: pd.DataFrame):
    ds = r5.groupby(r5.index.date).agg(
        hi=('high', 'max'), lo=('low', 'min'), close=('close', 'last')
    )
    dates = list(ds.index)
    pdm, pcm = {}, {}
    for i, d in enumerate(dates):
        if i:
            pdm[d] = (float(ds.iloc[i - 1].hi), float(ds.iloc[i - 1].lo))
            pcm[d] = float(ds.iloc[i - 1].close)

    tmp = r5.copy()
    tmp['wk'] = tmp.index.tz_localize(None).to_period('W-FRI')
    ws = tmp.groupby('wk').agg(hi=('high', 'max'), lo=('low', 'min'))
    wks = list(ws.index)
    prior = {wks[i]: (float(ws.iloc[i - 1].hi), float(ws.iloc[i - 1].lo)) for i in range(1, len(wks))}
    pwm = {d: prior.get(pd.Timestamp(d).to_period('W-FRI')) for d in dates}
    return pdm, pwm, pcm


def active_fvgs(h: pd.DataFrame, asof: pd.Timestamp, look_days: int = 25):
    q = h[(h.index + pd.Timedelta(minutes=15) <= asof) & (h.index >= asof - pd.Timedelta(days=look_days))]
    out = []
    if len(q) < 3:
        return out
    for i in range(2, len(q)):
        a = q.iloc[i - 2]
        c = q.iloc[i]
        created = q.index[i] + pd.Timedelta(minutes=15)
        later = q[(q.index + pd.Timedelta(minutes=15) > created) & (q.index + pd.Timedelta(minutes=15) <= asof)]
        if c.low > a.high:  # bullish FVG, support below
            lo, hi = float(a.high), float(c.low)
            fully_filled = bool((later.low <= lo).any()) if len(later) else False
            if not fully_filled:
                out.append(v1.Z('S', lo, hi, (lo + hi) / 2, 1, 0, 0, 'FVG_ACTIVE'))
        if c.high < a.low:  # bearish FVG, resistance above
            lo, hi = float(c.high), float(a.low)
            fully_filled = bool((later.high >= hi).any()) if len(later) else False
            if not fully_filled:
                out.append(v1.Z('R', lo, hi, (lo + hi) / 2, 1, 0, 0, 'FVG_ACTIVE'))
    return out


def premarket_bias(full5: pd.DataFrame, dte, pdm, pwm, pcm):
    day = full5[full5.index.date == dte]
    pm = between_times(day, PRE_START, PRE_END)
    if len(pm) < 12:
        return 'NEUTRAL', 0.0, {'reason': 'short_premarket'}

    p = v1.feat(pm)
    last = p.iloc[-1]
    first = p.iloc[0]
    atr5 = float(p.atr.dropna().tail(20).median()) if p.atr.notna().any() else float((p.high - p.low).median())
    atr5 = max(atr5, 1.0)
    score = 0.0

    # Premarket net direction, volatility-normalized.
    net = float(last.close - first.open)
    if net >= 0.75 * atr5:
        score += 1.0
    elif net <= -0.75 * atr5:
        score -= 1.0

    # Last hour buyer-vs-seller control: body-weighted directional closes.
    lh = p.tail(12)
    denom = lh['range'].replace(0, np.nan)
    signed = np.sign(lh.close - lh.open) * (lh.body / denom).fillna(0)
    ctl = float(signed.mean())
    if ctl >= 0.15:
        score += 1.0
    elif ctl <= -0.15:
        score -= 1.0

    # Simple structure: last-third highs/lows versus first-third highs/lows.
    n = max(3, len(p) // 3)
    a, b = p.head(n), p.tail(n)
    if b.high.median() > a.high.median() and b.low.median() > a.low.median():
        score += 1.0
    elif b.high.median() < a.high.median() and b.low.median() < a.low.median():
        score -= 1.0

    # Location versus previous-day range and close.
    if dte in pdm:
        pdh, pdl = pdm[dte]
        mid = (pdh + pdl) / 2
        if last.close > pdh:
            score += 1.0
        elif last.close < pdl:
            score -= 1.0
        elif last.close > mid:
            score += 0.5
        elif last.close < mid:
            score -= 0.5
    if dte in pcm:
        if last.close > pcm[dte] + 0.25 * atr5:
            score += 0.5
        elif last.close < pcm[dte] - 0.25 * atr5:
            score -= 0.5

    # Previous-week extremes are context, not a standalone trade trigger.
    if pwm.get(dte):
        pwh, pwl = pwm[dte]
        if last.close > pwh:
            score += 0.5
        elif last.close < pwl:
            score -= 0.5

    bias = 'BULL' if score >= 1.5 else 'BEAR' if score <= -1.5 else 'NEUTRAL'
    return bias, score, {'net': net, 'control': ctl, 'pm_close': float(last.close)}


def strong_bar(r, direction, p: v1.P):
    if direction == 'L':
        return bool(r.close > r.open and r.bf >= p.body and r.rr >= p.rrng and r.cl >= p.cloc)
    return bool(r.close < r.open and r.bf >= p.body and r.rr >= p.rrng and r.cl <= 1 - p.cloc)


def reversal_story(day: pd.DataFrame, i: int, direction: str, z: v1.Z, p: v1.P):
    if i < 3:
        return 0, {}
    q = day.iloc[i - 3:i]
    r = day.iloc[i]
    prev = day.iloc[i - 1]

    approach = (q.close.iloc[-1] < q.open.iloc[0]) if direction == 'L' else (q.close.iloc[-1] > q.open.iloc[0])
    bodies = q.body.values
    weakening = bool(bodies[-1] <= bodies[0] * 0.9 or np.median(bodies[-2:]) <= bodies[0] * 0.9)
    rejection = bool(max(r.lw, prev.lw) >= p.rej) if direction == 'L' else bool(max(r.uw, prev.uw) >= p.rej)
    takeover = bool(r.be or strong_bar(r, 'L', p)) if direction == 'L' else bool(r.se or strong_bar(r, 'S', p))
    away = bool(r.close >= z.mid) if direction == 'L' else bool(r.close <= z.mid)

    score = sum([approach, weakening, rejection, takeover, away])
    return int(score), {
        'approach': approach, 'weakening': weakening, 'rejection': rejection,
        'takeover': takeover, 'away': away
    }


def breakout_pressure(day: pd.DataFrame, i: int, direction: str):
    if i < 3:
        return False
    q = day.iloc[i - 3:i]
    if direction == 'L':
        return bool((q.close > q.open).sum() >= 2 and q.close.iloc[-1] >= q.close.iloc[0])
    return bool((q.close < q.open).sum() >= 2 and q.close.iloc[-1] <= q.close.iloc[0])


def zone_overlap(a: v1.Z, b: v1.Z, tol: float):
    return not (a.hi < b.lo - tol or b.hi < a.lo - tol)


def make_targets(p5, asof, p, pdm, pwm, dte, active_fvg, entry_reference):
    # Only strong repeated 5m reactions become generic targets.
    sw = v1.clusters(p5, 'S', asof, p, look=25, min_touch=3)
    rw = v1.clusters(p5, 'R', asof, p, look=25, min_touch=3)
    wick_targets = sw + rw

    levels = []
    pad = 2.0
    if dte in pdm:
        pdh, pdl = pdm[dte]
        levels += [
            v1.Z('B', pdh - pad, pdh + pad, pdh, 99, 0, 0, 'PDH'),
            v1.Z('B', pdl - pad, pdl + pad, pdl, 99, 0, 0, 'PDL')
        ]
    if pwm.get(dte):
        pwh, pwl = pwm[dte]
        levels += [
            v1.Z('B', pwh - pad, pwh + pad, pwh, 99, 0, 0, 'PWH'),
            v1.Z('B', pwl - pad, pwl + pad, pwl, 99, 0, 0, 'PWL')
        ]

    # FVGs are not allowed as free-standing targets. They must overlap a real
    # repeated-wick target or a PD/PW reference level.
    tol = 6.0
    logical_fvg = []
    anchors = wick_targets + levels
    for f in active_fvg:
        if any(zone_overlap(f, a, tol) for a in anchors):
            logical_fvg.append(v1.Z(f.side, f.lo, f.hi, f.mid, 1, 0, 0, 'FVG_CONFLUENT'))

    return wick_targets + levels + logical_fvg


def choose_target(targets, entry, direction, p: v1.P):
    allowed = []
    for z in targets:
        if direction == 'L':
            if z.mid <= entry:
                continue
            if z.side not in ('R', 'B') and z.source != 'FVG_CONFLUENT':
                continue
            t = z.lo + p.tp * (z.hi - z.lo)
            dist = t - entry
        else:
            if z.mid >= entry:
                continue
            if z.side not in ('S', 'B') and z.source != 'FVG_CONFLUENT':
                continue
            t = z.hi - p.tp * (z.hi - z.lo)
            dist = entry - t
        if dist >= p.room * p.stop:
            allowed.append((dist, z, float(t)))
    if not allowed:
        return None
    # Nearest MEANINGFUL reaction area, after weak shelves and irrelevant FVGs
    # have already been discarded.
    allowed.sort(key=lambda x: x[0])
    dist, z, t = allowed[0]
    return z, t, float(dist / p.stop)


def bias_allows(bias: str, direction: str, mode: str, setup: str, story_score: int, z: v1.Z):
    if bias == 'NEUTRAL':
        return True
    aligned = (bias == 'BULL' and direction == 'L') or (bias == 'BEAR' and direction == 'S')
    if aligned:
        return True
    if mode == 'HARD':
        return False
    # Soft mode permits a counter-bias trade only for an actual reversal at a
    # major zone with a nearly complete 5-part control story. It never permits
    # a casual counter-bias breakout.
    return bool(setup == 'REV' and story_score >= 4 and (z.conf >= 2 or z.touches >= 3))


def exit_1m(one, entry_time, direction, entry, target, p):
    stop = entry - p.stop if direction == 'L' else entry + p.stop
    q = one[(one.index >= entry_time) & (one.index.date == entry_time.date())]
    q = q[q.index.time <= pd.Timestamp('15:59').time()]
    for ts, r in q.iterrows():
        hit_s = r.low <= stop if direction == 'L' else r.high >= stop
        hit_t = r.high >= target if direction == 'L' else r.low <= target
        if hit_s:
            return ts, stop, 'STOP_AMBIG' if hit_t else 'STOP'
        if hit_t:
            return ts, target, 'TARGET'
    if len(q):
        return q.index[-1], float(q.iloc[-1].close), 'FLAT'
    return entry_time, entry, 'NO1M'


def prepare(full5_raw: pd.DataFrame, one_raw: pd.DataFrame):
    full5 = v1.feat(full5_raw.copy())
    r5 = v1.feat(rth(full5_raw))
    one = rth(one_raw)
    h_rth = v1.htf15(r5)
    h_ext = v1.htf15(full5)
    p15_rth = v1.pivots(h_rth, mins=15)
    p15_ext = v1.pivots(h_ext, mins=15)
    p5_rth = v1.pivots(r5, mins=5)
    p5_ext = v1.pivots(full5, mins=5)
    pdm, pwm, pcm = prev_maps(r5)
    return {
        'full5': full5, 'r5': r5, 'one': one,
        'h_rth': h_rth, 'h_ext': h_ext,
        'p15_rth': p15_rth, 'p15_ext': p15_ext,
        'p5_rth': p5_rth, 'p5_ext': p5_ext,
        'pdm': pdm, 'pwm': pwm, 'pcm': pcm
    }


def run_variant(env, variant: Variant, start_date=None, end_date=None):
    full5, r5, one = env['full5'], env['r5'], env['one']
    pdm, pwm, pcm = env['pdm'], env['pwm'], env['pcm']
    h = env['h_ext'] if variant.map_scope == 'EXT' else env['h_rth']
    p15 = env['p15_ext'] if variant.map_scope == 'EXT' else env['p15_rth']
    p5 = env['p5_ext'] if variant.map_scope == 'EXT' else env['p5_rth']

    p = v1.P(stop=STOP, ztouch=variant.ztouch, room=variant.room, tp=variant.tp)
    days = sorted(set(r5.index.date))
    if start_date:
        days = [d for d in days if d >= pd.Timestamp(start_date).date()]
    if end_date:
        days = [d for d in days if d <= pd.Timestamp(end_date).date()]

    out = []
    for dte in days:
        session = r5[r5.index.date == dte]
        if len(session) < 20:
            continue
        asof = session.index[0]
        bias, bias_score, bias_meta = premarket_bias(full5, dte, pdm, pwm, pcm)

        active = active_fvgs(h, asof)
        zones = v1.clusters(p15, 'S', asof, p) + v1.clusters(p15, 'R', asof, p)
        if not zones:
            continue

        # Confluence: exact PD/PW references + ACTIVE FVG overlap only.
        ref_levels = []
        if dte in pdm:
            ref_levels += list(pdm[dte])
        if pwm.get(dte):
            ref_levels += list(pwm[dte])
        a15 = h[h.index + pd.Timedelta(minutes=15) <= asof].atr.tail(20).median()
        tol = max(2.0, 0.20 * a15) if np.isfinite(a15) else 4.0
        for z in zones:
            z.conf = sum(z.lo - tol <= x <= z.hi + tol for x in ref_levels)
            z.conf += sum(zone_overlap(z, f, tol) for f in active)

        targets = make_targets(p5, asof, p, pdm, pwm, dte, active, float(session.iloc[0].open))
        if not targets:
            continue

        for i in range(3, len(session) - 1):
            ts = session.index[i]
            if ts.time() < TRADE_START or ts.time() > TRADE_END:
                continue
            r = session.iloc[i]
            if not np.isfinite(r.atr):
                continue
            tpad = max(1.0, 0.10 * r.atr)
            candidates = []

            for direction, side in [('L', 'S'), ('S', 'R')]:
                near = [z for z in zones if z.side == side and v1.touch(z, r, tpad)]
                if not near:
                    continue
                z = max(near, key=lambda q: (q.conf, q.touches, q.disp))
                if not (z.conf >= 1 or z.touches >= variant.ztouch):
                    continue

                story_score, story = reversal_story(session, i, direction, z, p)
                if story_score >= 4 and story.get('takeover'):
                    if bias_allows(bias, direction, variant.bias_mode, 'REV', story_score, z):
                        candidates.append((direction, z, 'REV', story_score))

                outside = r.close > z.hi + 0.05 * r.atr if direction == 'L' else r.close < z.lo - 0.05 * r.atr
                if outside and breakout_pressure(session, i, direction):
                    if strong_bar(r, direction, p):
                        if bias_allows(bias, direction, variant.bias_mode, 'BRK5', 5, z):
                            candidates.append((direction, z, 'BRK5', 5))
                    else:
                        closed = h[(h.index + pd.Timedelta(minutes=15) <= ts + pd.Timedelta(minutes=5))]
                        if len(closed):
                            hr = closed.iloc[-1]
                            h_range = max(float(hr.high - hr.low), 0.25)
                            h_bf = abs(float(hr.close - hr.open)) / h_range
                            accepted = (hr.close > z.hi) if direction == 'L' else (hr.close < z.lo)
                            if accepted and h_bf >= 0.50 and r.bf >= 0.45:
                                if bias_allows(bias, direction, variant.bias_mode, 'BRK15', 4, z):
                                    candidates.append((direction, z, 'BRK15', 4))

            if not candidates:
                continue
            if len(set(c[0] for c in candidates)) != 1:
                continue

            direction, z, setup, story_score = max(candidates, key=lambda c: (c[3], c[1].conf, c[1].touches, c[1].disp))
            entry_time = session.index[i + 1]
            entry = float(session.iloc[i + 1].open)
            picked = choose_target(targets, entry, direction, p)
            if not picked:
                continue
            tz, target, room_r = picked
            exit_time, exit_price, why = exit_1m(one, entry_time, direction, entry, target, p)
            pts = exit_price - entry if direction == 'L' else entry - exit_price
            gross = pts * PV * C
            slip_cost = p.slip * PV * C
            net = gross - FEE - slip_cost
            out.append({
                'variant': variant.name, 'session': str(dte), 'signal': str(ts), 'entry_time': str(entry_time),
                'side': 'LONG' if direction == 'L' else 'SHORT', 'setup': setup,
                'premarket_bias': bias, 'premarket_score': bias_score,
                'entry': entry, 'stop': entry - p.stop if direction == 'L' else entry + p.stop,
                'target': target, 'target_points': abs(target - entry), 'target_source': tz.source,
                'exit_time': str(exit_time), 'exit_price': exit_price, 'exit_reason': why,
                'gross_pnl': gross, 'fees': FEE, 'slippage_cost': slip_cost, 'net_pnl': net,
                'r': pts / p.stop, 'zone_touches': z.touches, 'confluence': z.conf,
                'room_r': room_r, 'story_score': story_score,
                'map_scope': variant.map_scope, 'bias_mode': variant.bias_mode,
                'ztouch_rule': variant.ztouch, 'room_rule': variant.room, 'tp_depth': variant.tp
            })
            # One trade maximum. We deliberately do NOT keep searching after an
            # executed trade, matching the user's one-trade-per-day rule.
            break

    return pd.DataFrame(out)


def daily_metrics(ledger: pd.DataFrame, all_days):
    daily = pd.Series(0.0, index=pd.Index([str(d) for d in all_days], name='session'))
    if len(ledger):
        x = ledger.groupby('session').net_pnl.sum()
        daily.loc[daily.index.intersection(x.index)] = x.loc[daily.index.intersection(x.index)]
    sd = float(daily.std(ddof=1)) if len(daily) > 1 else np.nan
    sr = float(daily.mean() / sd * np.sqrt(252)) if np.isfinite(sd) and sd > 0 else np.nan
    return daily, sr


def trade_metrics(t: pd.DataFrame):
    if t.empty:
        return {'trades': 0, 'win_rate': np.nan, 'net_pnl': 0.0, 'avg_trade': np.nan, 'profit_factor': np.nan, 'max_dd': 0.0, 'avg_winner': np.nan, 'median_winner': np.nan, 'avg_loser': np.nan}
    x = t.net_pnl.to_numpy(float)
    w, l = x[x > 0], x[x < 0]
    eq = np.cumsum(x)
    peak = np.maximum.accumulate(np.r_[0.0, eq])[:-1]
    dd = eq - peak
    return {
        'trades': int(len(x)), 'win_rate': float((x > 0).mean()), 'net_pnl': float(x.sum()),
        'avg_trade': float(x.mean()), 'profit_factor': float(w.sum() / abs(l.sum())) if len(l) else np.inf,
        'max_dd': float(dd.min()) if len(dd) else 0.0,
        'avg_winner': float(w.mean()) if len(w) else np.nan,
        'median_winner': float(np.median(w)) if len(w) else np.nan,
        'avg_loser': float(l.mean()) if len(l) else np.nan
    }


def build_variants():
    out = []
    k = 0
    for scope, bias, zt, room, tp in itertools.product(
        ['RTH', 'EXT'], ['SOFT', 'HARD'], [2, 3], [1.5, 2.0], [0.40, 0.50, 0.60]
    ):
        k += 1
        out.append(Variant(f'V{k:03d}', scope, bias, zt, room, tp))
    return out


def fold_table(ledgers, variants, days, nfold=6):
    folds = np.array_split(np.array(days, dtype=object), nfold)
    day_to_fold = {str(d): i for i, arr in enumerate(folds) for d in arr}
    rows = []
    for v in variants:
        led = ledgers[v.name].copy()
        if len(led):
            led['fold'] = led.session.map(day_to_fold)
        for fi, fd in enumerate(folds):
            q = led[led.fold == fi] if len(led) else led
            m = trade_metrics(q)
            m.update({'variant': v.name, 'fold': fi, 'days': len(fd)})
            rows.append(m)
    return pd.DataFrame(rows), folds


def cscv_pbo(ledgers, variants, folds, days):
    # 6 folds -> 20 symmetric train/test choices of 3 folds each.
    day_fold = {str(d): i for i, arr in enumerate(folds) for d in arr}
    combos = list(itertools.combinations(range(len(folds)), len(folds)//2))
    rows = []

    def score(led, use_folds):
        sel_days = [str(d) for d in days if day_fold[str(d)] in use_folds]
        s = pd.Series(0.0, index=sel_days)
        if len(led):
            x = led[led.session.isin(sel_days)].groupby('session').net_pnl.sum()
            s.loc[s.index.intersection(x.index)] = x.loc[s.index.intersection(x.index)]
        sd = s.std(ddof=1)
        return float(s.mean()/sd) if np.isfinite(sd) and sd > 0 else -np.inf

    below = 0
    usable = 0
    for train in combos:
        test = tuple(i for i in range(len(folds)) if i not in train)
        train_scores = {v.name: score(ledgers[v.name], train) for v in variants}
        chosen = max(train_scores, key=train_scores.get)
        test_scores = {v.name: score(ledgers[v.name], test) for v in variants}
        vals = pd.Series(test_scores).replace([np.inf, -np.inf], np.nan).dropna()
        if chosen not in vals.index or len(vals) < 4:
            continue
        rank_pct = float(vals.rank(pct=True).loc[chosen])
        usable += 1
        if rank_pct < 0.5:
            below += 1
        rows.append({'train_folds': str(train), 'test_folds': str(test), 'selected_variant': chosen, 'oos_rank_pct': rank_pct, 'oos_score': float(vals.loc[chosen])})
    return (below / usable if usable else np.nan), pd.DataFrame(rows)


def deflated_sharpe_style(summary: pd.DataFrame, base_variant='V011'):
    # Conservative, approximate DSR-style family adjustment. Variants are highly
    # correlated, so treating all 48 as independent trials over-penalizes rather
    # than understates selection risk.
    srs = summary.daily_sharpe.dropna().to_numpy(float) / np.sqrt(252)
    if len(srs) < 3:
        return {'status': 'INSUFFICIENT'}
    n = len(srs)
    sigma_sr = float(np.std(srs, ddof=1))
    gamma = 0.5772156649015329
    z1 = norm.ppf(1 - 1 / n)
    z2 = norm.ppf(1 - 1 / (n * math.e))
    sr0 = sigma_sr * ((1 - gamma) * z1 + gamma * z2)
    best = summary.loc[summary.daily_sharpe.idxmax()]
    return {'trials': n, 'expected_max_daily_sr_null': float(sr0), 'best_variant': str(best.variant), 'best_annualized_sharpe': float(best.daily_sharpe)}


def main():
    for u, p in [(MNQ5, DATA/'mnq5.csv'), (MNQ1, DATA/'mnq1.csv'), (NQ5, DATA/'nq5.csv'), (NQ1, DATA/'nq1.csv')]:
        download(u, p)

    mnq = prepare(load_mnq(DATA/'mnq5.csv'), load_mnq(DATA/'mnq1.csv'))
    variants = build_variants()
    days = sorted(set(mnq['r5'].index.date))

    ledgers = {}
    summary_rows = []
    all_ledgers = []
    for v in variants:
        led = run_variant(mnq, v)
        ledgers[v.name] = led
        if len(led):
            all_ledgers.append(led)
        m = trade_metrics(led)
        _, dsr = daily_metrics(led, days)
        m.update({
            'variant': v.name, 'map_scope': v.map_scope, 'bias_mode': v.bias_mode,
            'ztouch': v.ztouch, 'room': v.room, 'tp': v.tp, 'daily_sharpe': dsr
        })
        summary_rows.append(m)

    summary = pd.DataFrame(summary_rows)
    summary.to_csv(OUT/'variant_summary.csv', index=False)
    if all_ledgers:
        pd.concat(all_ledgers, ignore_index=True).to_csv(OUT/'all_variant_ledgers.csv', index=False)

    folds_df, folds = fold_table(ledgers, variants, days)
    folds_df.to_csv(OUT/'fold_results.csv', index=False)

    fold_agg = folds_df.groupby('variant').agg(
        positive_folds=('net_pnl', lambda s: int((s > 0).sum())),
        median_fold_net=('net_pnl', 'median'),
        worst_fold_net=('net_pnl', 'min'),
        median_fold_pf=('profit_factor', 'median')
    ).reset_index()
    robust = summary.merge(fold_agg, on='variant')
    robust['robust_flag'] = (
        (robust.positive_folds >= 4) &
        (robust.profit_factor > 1.0) &
        (robust.trades >= 20)
    )
    robust.to_csv(OUT/'robustness_table.csv', index=False)

    pbo, pbo_rows = cscv_pbo(ledgers, variants, folds, days)
    pbo_rows.to_csv(OUT/'cscv_pbo_splits.csv', index=False)
    dsr_style = deflated_sharpe_style(summary)

    # PREDECLARED semantic base — chosen BEFORE viewing v2 P&L, not optimized:
    # EXT map, SOFT bias, 2 touches, 1.5R room, 50% safe-middle.
    base = next(v for v in variants if v.map_scope=='EXT' and v.bias_mode=='SOFT' and v.ztouch==2 and v.room==1.5 and abs(v.tp-.50)<1e-9)
    base_led = ledgers[base.name]
    base_led.to_csv(OUT/'base_v2_mnq_ledger.csv', index=False)

    # Untouched mini cross-contract check: May 2-9, 2025 NQ. Same exact base,
    # same dollar conversion as 15 MNQ. No tuning from this result.
    nq = prepare(load_nq(DATA/'nq5.csv'), load_nq(DATA/'nq1.csv'))
    nq_hold = run_variant(nq, base, start_date='2025-05-02', end_date='2025-05-09')
    nq_hold.to_csv(OUT/'nq_2025_mini_holdout.csv', index=False)

    axis_rows = []
    for col in ['map_scope','bias_mode','ztouch','room','tp']:
        for val, g in robust.groupby(col):
            axis_rows.append({
                'axis': col, 'value': val, 'variants': len(g),
                'median_net': float(g.net_pnl.median()),
                'median_pf': float(g.profit_factor.replace(np.inf, np.nan).median()),
                'robust_share': float(g.robust_flag.mean()),
                'median_positive_folds': float(g.positive_folds.median())
            })
    pd.DataFrame(axis_rows).to_csv(OUT/'axis_ab_summary.csv', index=False)

    report = {
        'status': 'RESEARCH_ONLY_NOT_LIVE_APPROVED',
        'anti_overfit_contract': {
            'predeclared_variants': 48,
            'no_unbounded_optimizer': True,
            'all_variants_logged': True,
            'fixed_trade_window_et': '09:30-12:00',
            'fixed_stop_points': STOP,
            'fixed_contracts': C,
            'fvg_rule': 'active + confluent only',
            'base_selected_before_v2_pnl': base.name,
            'mnq_2026_is_contaminated_development_data': True,
            'nq_2025_may02_may09_is_cross_contract_mini_holdout': True
        },
        'mnq_data': {'start': str(days[0]), 'end': str(days[-1]), 'sessions': len(days)},
        'base_variant': {'definition': base.__dict__, 'metrics': trade_metrics(base_led)},
        'variant_family': {
            'count': len(robust),
            'profitable': int((robust.net_pnl > 0).sum()),
            'robust_flags': int(robust.robust_flag.sum()),
            'median_net': float(robust.net_pnl.median()),
            'worst_net': float(robust.net_pnl.min()),
            'best_net': float(robust.net_pnl.max())
        },
        'cscv_style_pbo': {'estimate': float(pbo) if np.isfinite(pbo) else None, 'splits': int(len(pbo_rows))},
        'deflated_sharpe_style': dsr_style,
        'nq_2025_mini_holdout': trade_metrics(nq_hold),
        'warnings': [
            'MNQ Jan-Apr 2026 has already been inspected and is development data only.',
            'The NQ May 2-9 2025 check is a different contract size/continuous series and is only a cross-contract price-action check, not final MNQ certification.',
            'No variable is authorized for promotion solely because it has the highest P&L.'
        ]
    }
    (OUT/'report.json').write_text(json.dumps(report, indent=2, allow_nan=True))

    print(json.dumps(report, indent=2, allow_nan=True))
    print('\nTOP ROBUSTNESS TABLE (sorted for inspection only; not optimizer selection):')
    print(robust.sort_values(['robust_flag','positive_folds','profit_factor'], ascending=[False,False,False]).head(15).to_string(index=False))
    print('\nBASE MNQ LEDGER:')
    print(base_led[['session','side','setup','premarket_bias','target_source','target_points','net_pnl']].to_string(index=False) if len(base_led) else 'NO TRADES')
    print('\nNQ 2025 MINI HOLDOUT:')
    print(nq_hold[['session','side','setup','premarket_bias','target_source','target_points','net_pnl']].to_string(index=False) if len(nq_hold) else 'NO TRADES')


if __name__ == '__main__':
    main()
