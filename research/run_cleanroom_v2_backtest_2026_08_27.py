#!/usr/bin/env python3
"""CLEANROOM-v2 backtest runner. COMMITTED BEFORE IT IS RUN.

The strategy it measures was frozen first, at `7c5ffc77`. This runner is measurement machinery
only: it selects nothing, tunes nothing, and has no branch that depends on a result.

WINDOW, STATED (ALGO-164 requires it): `2020-01-01` .. `2026-03-08`.
That is the only contiguous block in `data_cache/NQ/ratio_adj`. VERIFIED HERE, not relayed:
the parquet spans 2015-08 .. 2026-03 but 48 months inside that span are absent - all of
2016, 2017 and 2019, plus most of 2015 and 2018. 2015 and 2018 are excluded because a 40-day
lookback map cannot be built against a gap; they are named, not silently dropped.

NO OPTIMIZATION. An earlier draft pre-sliced the history to speed the map build up. It is not
used, because an optimization that has not been proven exact is a silent semantic change, and the
exact version costs only wall-clock in a background task. The map is built by the frozen v1 code
against the full history every session, exactly as the frozen module does it.

INSTRUMENT: NQ ratio-adjusted continuous. Price level is shared with MNQ; MNQ point value is $2,
so the operator's 15-lot is $30/point. Per-bar extremes differ slightly between the NQ and MNQ
feeds, which is a known limit of using NQ history and is reported, not hidden.

Run: PYTHONPATH=. python -m research.run_cleanroom_v2_backtest_2026_08_27
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

import research.mnq_sr_cleanroom_v2 as V2

DATA = Path("C:/Users/tonio/Projects/trading-forge/trading-forge/data_cache/NQ/ratio_adj")
TZ = "America/New_York"
START, END = "2020-01-01", "2026-03-08"
MNQ_POINT_VALUE = 2.0
LOTS = 15
OUT = Path("research/cleanroom_v2_backtest_trades_2026_08_27.json")


def load(tf: str) -> pd.DataFrame:
    d = pd.read_parquet(DATA / f"{tf}.parquet")
    d.index = pd.to_datetime(d["ts_event"], utc=True).dt.tz_convert(TZ)
    return d[["open", "high", "low", "close", "volume"]].sort_index()


def main() -> None:
    h15, f5 = load("15min"), load("5min")
    lo, hi = pd.Timestamp(START, tz=TZ), pd.Timestamp(END, tz=TZ) + pd.Timedelta(days=1)
    sessions = sorted({d.date() for d in f5.index if lo <= d < hi})
    print(f"window {START}..{END}  sessions={len(sessions)}", flush=True)

    trades, no_map, no_setup = [], 0, 0
    for n, day in enumerate(sessions, 1):
        day5 = f5[(f5.index >= pd.Timestamp(f"{day} 00:00", tz=TZ)) &
                  (f5.index < pd.Timestamp(f"{day} 23:59", tz=TZ))]
        if day5.empty:
            continue
        zones = V2.map_for_session(h15, f5, str(day), TZ)
        if not zones:
            no_map += 1
            continue
        t = V2.run_session(day5, zones, str(day))
        if t is None:
            no_setup += 1
        else:
            trades.append(t)
        if n % 100 == 0:
            print(f"  {n}/{len(sessions)}  trades={len(trades)}", flush=True)

    rows = [dict(session=t.session, kind=t.kind, side=t.side,
                 t_entry=str(t.t_entry), entry=t.entry, stop=t.stop, target=t.target,
                 t_exit=str(t.t_exit), exit=t.exit, reason=t.reason,
                 points=t.points, r=t.r_multiple, planned_r=t.planned_r) for t in trades]
    OUT.write_text(json.dumps({"window": [START, END], "sessions": len(sessions),
                               "no_map": no_map, "no_setup": no_setup,
                               "trades": rows}, indent=1), encoding="utf-8")

    if not trades:
        print("NO TRADES.")
        return
    pts = [t.points for t in trades]
    rs = [t.r_multiple for t in trades]
    wins = [t for t in trades if t.points > 0]
    by_reason = {}
    for t in trades:
        by_reason[t.reason] = by_reason.get(t.reason, 0) + 1
    tot = sum(pts)
    print("\n=== CLEANROOM-v2, one trade per session, first qualifying setup ===")
    print(f"sessions {len(sessions)}   no map {no_map}   no qualifying setup {no_setup}"
          f"   TRADES {len(trades)}  ({100*len(trades)/len(sessions):.1f}% of sessions)")
    print(f"exits: {by_reason}")
    print(f"win rate      {100*len(wins)/len(trades):.1f}%  ({len(wins)}/{len(trades)})")
    print(f"total points  {tot:,.1f}   per trade {tot/len(trades):+.2f}")
    print(f"R per trade   {sum(rs)/len(rs):+.3f}    total R {sum(rs):+.1f}")
    print(f"PLANNED R     median {pd.Series([t.planned_r for t in trades]).median():.2f}"
          f"   (frozen reference {V2.R_REFERENCE}, which set no price)")
    print(f"$ at {LOTS} MNQ  {tot*MNQ_POINT_VALUE*LOTS:+,.0f}")
    eq, peak, mdd = 0.0, 0.0, 0.0
    for p in pts:
        eq += p
        peak = max(peak, eq)
        mdd = min(mdd, eq - peak)
    print(f"max drawdown  {mdd:,.1f} pts  ({mdd*MNQ_POINT_VALUE*LOTS:+,.0f} at {LOTS} MNQ)")
    print(f"\ntrades written to {OUT}")


if __name__ == "__main__":
    sys.exit(main())
