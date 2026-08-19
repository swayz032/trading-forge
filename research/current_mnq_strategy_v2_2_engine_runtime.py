#!/usr/bin/env python3
"""Runtime corrections layered on the frozen v2.2 engine.

This module exists so small correctness repairs can be independently reviewed without
rewriting the full research engine. It monkey-patches only the named functions below,
then re-exports the engine API. No performance parameters are changed here.
"""
from __future__ import annotations

from dataclasses import replace
import pandas as pd
import numpy as np

from research import current_mnq_strategy_v2_2_engine as b


def zone_state_at(zone: b.Zone, bars5: pd.DataFrame, asof: pd.Timestamp, p: b.Params) -> b.Zone:
    q = bars5[(bars5.index >= zone.created) & (bars5.index < asof)]
    if q.empty:
        return zone
    z = replace(zone)
    tests = 0
    broken_at = None
    for ts, r in q.iterrows():
        atr = float(r.get("atr", np.nan))
        clear = p.breakout_clear_atr * atr if np.isfinite(atr) else b.TICK * 2
        if r.low <= z.hi and r.high >= z.lo:
            tests += 1
        if z.side == "S" and r.close < z.lo - clear:
            broken_at = ts
            break
        if z.side == "R" and r.close > z.hi + clear:
            broken_at = ts
            break
    if broken_at is None:
        if tests:
            z.state = b.ZoneState.TESTED
        return z

    original_side = z.side
    z.state = b.ZoneState.BROKEN
    later = q[q.index > broken_at]
    if len(later):
        for _, r in later.iterrows():
            if r.low <= z.hi and r.high >= z.lo:
                if original_side == "S" and r.close <= z.mid:
                    z.side = "R"
                    z.state = b.ZoneState.FLIPPED_RETEST
                elif original_side == "R" and r.close >= z.mid:
                    z.side = "S"
                    z.state = b.ZoneState.FLIPPED_RETEST
                break
    return z


def run_day(env, dte, p: b.Params):
    full5, r5, one, h15 = env["full5"], env["r5"], env["one"], env["h15"]
    session = r5[r5.index.date == dte]
    if len(session) < 76:
        return None
    open_ts = session.index[0]
    plan = b.premarket_plan(full5, dte, env["pdm"], env["pwm"], env["pcm"])
    locations, _ = b.build_entry_locations(env, dte, open_ts, p)
    authorized = [x for x in locations if x.entry_authorized]
    pending: dict[tuple[str, str], b.PendingBreakout] = {}

    for i in range(0, len(session)):
        ts = session.index[i]
        if ts.time() < b.TRADE_START:
            continue
        r = session.iloc[i]
        bar_close = ts + pd.Timedelta(minutes=5)
        if not np.isfinite(r.atr):
            continue

        # IMPORTANT: evaluate against zone state that existed BEFORE the current
        # 5m bar. The current breakout bar must not retire its own level before
        # breakout detection sees it.
        current_locs = []
        for loc in authorized:
            if loc.zone is None:
                current_locs.append(loc)
                continue
            zs = zone_state_at(loc.zone, full5, ts, p)
            if zs.active:
                current_locs.append(replace(loc, zone=zs, side=zs.side,
                                            quality=zs.quality, confluence=zs.confluence))

        candidates: list[b.Candidate] = []
        pad = max(b.TICK * 2, p.touch_pad_atr * float(r.atr))

        # REVERSAL polarity: long from support, short from resistance.
        for direction, side in (("L", "S"), ("S", "R")):
            near = [loc for loc in current_locs if loc.side == side and b.bar_interacts(loc, r, pad)]
            for loc in near:
                story = b.reversal_story(full5, ts, r, direction, loc, p)
                if story.complete and b.plan_allows(plan, direction, "REV", story, loc):
                    candidates.append(b.Candidate(direction, "REV", loc, story, ts, bar_close, "COMPLETE_REVERSAL"))

        # BREAKOUT polarity: long THROUGH resistance, short THROUGH support.
        for direction, side in (("L", "R"), ("S", "S")):
            relevant = [loc for loc in current_locs if loc.side == side]
            for loc in relevant:
                if not b.decisive_outside(loc, r, direction, p):
                    continue
                if not b.breakout_pressure(full5, ts, direction):
                    continue
                if b.strong_bar(r, direction, p):
                    if b.plan_allows(plan, direction, "BRK5", None, loc):
                        candidates.append(b.Candidate(direction, "BRK5", loc, None, ts, bar_close, "STRONG_5M_ACCEPTANCE"))
                else:
                    key = (direction, loc.id)
                    pending.setdefault(key, b.PendingBreakout(direction, loc.id, bar_close, loc.lo, loc.hi))

        # Weak breakouts retain the original pre-break location snapshot. The
        # level is expected to become BROKEN after the attempt; that must not erase
        # the pending attempt before a NEW 15m close can confirm it.
        for key, pen in list(pending.items()):
            loc = next((x for x in authorized if x.id == pen.location_id), None)
            if loc is None:
                pending.pop(key, None)
                continue
            if bar_close - pen.attempted_at > pd.Timedelta(minutes=30):
                pending.pop(key, None)
                continue
            confirmed = b.latest_new_15m_confirmation(h15, pen, bar_close)
            if confirmed is not None and confirmed <= bar_close:
                if b.plan_allows(plan, pen.direction, "BRK15", None, loc):
                    candidates.append(b.Candidate(pen.direction, "BRK15", loc, None,
                                                  pen.attempted_at, confirmed, "NEW_15M_ACCEPTANCE"))
                pending.pop(key, None)

        if not candidates:
            continue
        if len(set(c.direction for c in candidates)) != 1:
            continue
        rank = {"BRK5": 3, "BRK15": 2, "REV": 1}
        cand = max(candidates, key=lambda c: (rank[c.setup], c.location.quality, c.location.confluence))
        actionable = max(bar_close, cand.confirmed_time)
        if actionable.time() > b.LAST_ENTRY:
            continue
        ent = b.one_minute_entry(one, actionable, cand.direction, p)
        if ent is None:
            continue
        entry_time, entry, raw_open = ent
        if entry_time.time() > b.LAST_ENTRY:
            continue

        targets = b.build_target_locations(env["piv5"], full5, h15, entry_time, p,
                                           env["pdm"], env["pwm"], dte)
        picked, path_reason = b.classify_path_and_destination(
            targets, entry, cand.direction, cand.setup, p, cand.setup == "BRK5"
        )
        if picked is None:
            continue

        exit_time, exit_px, why, mfe, mae = b.exit_1m_realistic(
            one, entry_time, cand.direction, entry, picked.executable_price, p
        )
        pts = exit_px - entry if cand.direction == "L" else entry - exit_px
        gross = pts * b.POINT_VALUE * b.CONTRACTS
        net = gross - b.ROUND_TRIP_FEE
        stop = b.executable_stop(entry - p.stop if cand.direction == "L" else entry + p.stop,
                                 cand.direction)
        assert all(b.tick_valid(x) for x in (entry, stop, picked.executable_price, exit_px))
        return {
            "session": str(dte), "signal_time": str(cand.signal_time),
            "confirmed_time": str(cand.confirmed_time), "entry_time": str(entry_time),
            "side": "LONG" if cand.direction == "L" else "SHORT", "setup": cand.setup,
            "premarket_primary": plan.primary, "premarket_score": plan.score,
            "premarket_structure": plan.pm_structure, "premarket_location": plan.location_state,
            "entry_location": cand.location.source, "location_quality": cand.location.quality,
            "location_confluence": cand.location.confluence, "entry_raw_open": raw_open,
            "entry": entry, "stop": stop, "target_raw": picked.raw_price,
            "target": picked.executable_price, "target_points": abs(picked.executable_price - entry),
            "target_source": picked.location.source, "target_quality": picked.quality,
            "path_reason": path_reason, "exit_time": str(exit_time), "exit_price": exit_px,
            "exit_reason": why, "gross_pnl": gross, "fees": b.ROUND_TRIP_FEE,
            "net_pnl": net, "r": pts / p.stop, "mfe_points": mfe, "mae_points": mae,
            "contract_id": b.SOURCE_CONTRACT_ID,
        }
    return None


# Install runtime corrections into base module so all existing helper functions
# that resolve these names dynamically use the corrected semantics.
b.zone_state_at = zone_state_at
b.run_day = run_day

# Re-export the public engine namespace.
for _name in dir(b):
    if not _name.startswith("_") and _name not in globals():
        globals()[_name] = getattr(b, _name)
