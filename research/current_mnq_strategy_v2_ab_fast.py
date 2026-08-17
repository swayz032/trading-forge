#!/usr/bin/env python3
from __future__ import annotations

import pandas as pd
import numpy as np

from research import current_mnq_strategy_v2_ab as m

_CACHE = {}


def _ctx(env, variant, dte):
    key = (id(env['r5']), variant.map_scope, variant.ztouch, str(dte))
    if key in _CACHE:
        return _CACHE[key]

    full5, r5 = env['full5'], env['r5']
    pdm, pwm, pcm = env['pdm'], env['pwm'], env['pcm']
    h = env['h_ext'] if variant.map_scope == 'EXT' else env['h_rth']
    p15 = env['p15_ext'] if variant.map_scope == 'EXT' else env['p15_rth']
    p5 = env['p5_ext'] if variant.map_scope == 'EXT' else env['p5_rth']
    p = m.v1.P(stop=m.STOP, ztouch=variant.ztouch, room=1.5, tp=.5)

    session = r5[r5.index.date == dte]
    if len(session) < 20:
        _CACHE[key] = None
        return None
    asof = session.index[0]
    bias, bias_score, bias_meta = m.premarket_bias(full5, dte, pdm, pwm, pcm)
    active = m.active_fvgs(h, asof)
    zones = m.v1.clusters(p15, 'S', asof, p) + m.v1.clusters(p15, 'R', asof, p)
    if not zones:
        _CACHE[key] = None
        return None

    ref_levels = []
    if dte in pdm:
        ref_levels += list(pdm[dte])
    if pwm.get(dte):
        ref_levels += list(pwm[dte])
    a15 = h[h.index + pd.Timedelta(minutes=15) <= asof].atr.tail(20).median()
    tol = max(2.0, 0.20 * a15) if np.isfinite(a15) else 4.0
    for z in zones:
        z.conf = sum(z.lo - tol <= x <= z.hi + tol for x in ref_levels)
        z.conf += sum(m.zone_overlap(z, f, tol) for f in active)

    targets = m.make_targets(p5, asof, p, pdm, pwm, dte, active, float(session.iloc[0].open))
    if not targets:
        _CACHE[key] = None
        return None

    ans = {
        'session': session, 'h': h, 'zones': zones, 'targets': targets,
        'bias': bias, 'bias_score': bias_score
    }
    _CACHE[key] = ans
    return ans


def cached_run_variant(env, variant, start_date=None, end_date=None):
    one = env['one']
    days = sorted(set(env['r5'].index.date))
    if start_date:
        days = [d for d in days if d >= pd.Timestamp(start_date).date()]
    if end_date:
        days = [d for d in days if d <= pd.Timestamp(end_date).date()]

    p = m.v1.P(stop=m.STOP, ztouch=variant.ztouch, room=variant.room, tp=variant.tp)
    out = []

    for dte in days:
        c = _ctx(env, variant, dte)
        if not c:
            continue
        session, h, zones, targets = c['session'], c['h'], c['zones'], c['targets']
        bias, bias_score = c['bias'], c['bias_score']

        for i in range(3, len(session) - 1):
            ts = session.index[i]
            if ts.time() < m.TRADE_START or ts.time() > m.TRADE_END:
                continue
            r = session.iloc[i]
            if not np.isfinite(r.atr):
                continue
            tpad = max(1.0, 0.10 * r.atr)
            candidates = []

            for direction, side in [('L', 'S'), ('S', 'R')]:
                near = [z for z in zones if z.side == side and m.v1.touch(z, r, tpad)]
                if not near:
                    continue
                z = max(near, key=lambda q: (q.conf, q.touches, q.disp))
                if not (z.conf >= 1 or z.touches >= variant.ztouch):
                    continue

                story_score, story = m.reversal_story(session, i, direction, z, p)
                if story_score >= 4 and story.get('takeover'):
                    if m.bias_allows(bias, direction, variant.bias_mode, 'REV', story_score, z):
                        candidates.append((direction, z, 'REV', story_score))

                outside = r.close > z.hi + 0.05 * r.atr if direction == 'L' else r.close < z.lo - 0.05 * r.atr
                if outside and m.breakout_pressure(session, i, direction):
                    if m.strong_bar(r, direction, p):
                        if m.bias_allows(bias, direction, variant.bias_mode, 'BRK5', 5, z):
                            candidates.append((direction, z, 'BRK5', 5))
                    else:
                        closed = h[(h.index + pd.Timedelta(minutes=15) <= ts + pd.Timedelta(minutes=5))]
                        if len(closed):
                            hr = closed.iloc[-1]
                            hrange = max(float(hr.high - hr.low), 0.25)
                            hbf = abs(float(hr.close - hr.open)) / hrange
                            accepted = (hr.close > z.hi) if direction == 'L' else (hr.close < z.lo)
                            if accepted and hbf >= 0.50 and r.bf >= 0.45:
                                if m.bias_allows(bias, direction, variant.bias_mode, 'BRK15', 4, z):
                                    candidates.append((direction, z, 'BRK15', 4))

            if not candidates:
                continue
            if len(set(ca[0] for ca in candidates)) != 1:
                continue

            direction, z, setup, story_score = max(candidates, key=lambda ca: (ca[3], ca[1].conf, ca[1].touches, ca[1].disp))
            entry_time = session.index[i + 1]
            entry = float(session.iloc[i + 1].open)
            picked = m.choose_target(targets, entry, direction, p)
            if not picked:
                continue
            tz, target, room_r = picked
            exit_time, exit_price, why = m.exit_1m(one, entry_time, direction, entry, target, p)
            pts = exit_price - entry if direction == 'L' else entry - exit_price
            gross = pts * m.PV * m.C
            slip_cost = p.slip * m.PV * m.C
            net = gross - m.FEE - slip_cost
            out.append({
                'variant': variant.name, 'session': str(dte), 'signal': str(ts), 'entry_time': str(entry_time),
                'side': 'LONG' if direction == 'L' else 'SHORT', 'setup': setup,
                'premarket_bias': bias, 'premarket_score': bias_score,
                'entry': entry, 'stop': entry - p.stop if direction == 'L' else entry + p.stop,
                'target': target, 'target_points': abs(target - entry), 'target_source': tz.source,
                'exit_time': str(exit_time), 'exit_price': exit_price, 'exit_reason': why,
                'gross_pnl': gross, 'fees': m.FEE, 'slippage_cost': slip_cost, 'net_pnl': net,
                'r': pts / p.stop, 'zone_touches': z.touches, 'confluence': z.conf,
                'room_r': room_r, 'story_score': story_score,
                'map_scope': variant.map_scope, 'bias_mode': variant.bias_mode,
                'ztouch_rule': variant.ztouch, 'room_rule': variant.room, 'tp_depth': variant.tp
            })
            break

    return pd.DataFrame(out)


if __name__ == '__main__':
    m.run_variant = cached_run_variant
    m.main()
