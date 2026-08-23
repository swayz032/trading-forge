"""Measure — not reconstruct — what `_beyond()` saw at each 03-30 bucket.

A previous attempt at this reconstruction TYPED the 09:05-09:15 closes from memory; they were
never in any output I had. Numbers that arrive by typing are not measurements, and a
reconstruction built on them can agree with the artifact by luck. This reads the bars.

It also reads the zone's ROLE at each bucket, because `_beyond()` flips with the role:
role 'S' tests close < lo, role 'R' tests close > hi. A zone that flipped would make the same
bar "beyond" or "not beyond" for opposite reasons.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_exam_window as W
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24
from research.current_mnq_strategy_v2_4_zone_lifecycle import zone_state_at_v24

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
SESSION = "2026-03-30"
LINE = 23436.625
LOOKBACK = 6

observed = old.download_pinned(DATA, include_tick=False)
old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

with W.trading_window(W.BASELINE_ARM_START):
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()
    full5 = env["full5"]
    tz = full5.index.tz
    open_ts = pd.Timestamp(f"{SESSION} 09:30", tz=tz)
    locations, _ = build_entry_locations_v24(env, pd.Timestamp(SESSION).date(), open_ts, p)
    covering = [x for x in locations if float(x.lo) <= LINE <= float(x.hi)]

    print(f"locations covering his line: {len(covering)}")
    for loc in covering:
        print(f"  {loc.id}  band {float(loc.lo):.2f}-{float(loc.hi):.2f}  "
              f"declared side {loc.side}  authorized {loc.entry_authorized}")

    for bucket_s in ("09:35", "09:40"):
        bucket = pd.Timestamp(f"{SESSION} {bucket_s}", tz=tz)
        prior = full5[full5.index < bucket].tail(LOOKBACK)
        print(f"\n=== bucket {bucket_s} : the {len(prior)} COMPLETED bars the predicate saw ===")
        for loc in covering:
            st = zone_state_at_v24(loc.zone, full5, bucket, p) if loc.zone is not None else None
            role = st.side if st is not None else loc.side
            state = str(st.state).split(".")[-1] if st is not None else "n/a"
            lo, hi = float(loc.lo), float(loc.hi)
            print(f"  zone {loc.id}  role_now={role}  state={state}  active={st.active if st else '?'}")
            any_beyond = False
            for ts, row in prior.iterrows():
                c = float(row.close)
                beyond = (c < lo) if role == "S" else (c > hi)
                any_beyond = any_beyond or beyond
                print(f"     {str(ts)[11:16]} close {c:>10.2f}   beyond({role})={beyond}")
            print(f"     -> any completed close beyond: {any_beyond}   "
                  f"({'a break print EXISTS' if any_beyond else 'NO_COMPLETED_PRINT_BEYOND_THE_ZONE is correct'})")
