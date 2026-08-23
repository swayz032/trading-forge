"""Why did the kernel grant a SHORT on 2026-04-09 while the trader went LONG?

ALGO-011 §4 makes this the highest-severity currently scoreable defect and forbids patching
it directly: the state machine must EXPLAIN why the short route was legally granted and kill
it only if the frozen semantics say the route was invalid. This is the explanation step.

DIAGNOSTIC ONLY. Reads; changes nothing.
"""
import io
import json
from datetime import date
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session

SESSION = "2026-04-09"
DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
SC = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")

sc = json.load(io.open(SC, encoding="utf-8"))
case = next(c for c in sc["cases"] if c["session"] == SESSION)
w_start = pd.Timestamp(case["replay_window"]["start"])
w_end = pd.Timestamp(case["replay_window"]["end"])
t_clock = pd.Timestamp(case["trader_decision_clock"])

print(f"CASE {SESSION}  window {w_start.time()}–{w_end.time()}")
print(f"  trader : {case['trader_state']} at {t_clock.time()}")
print(f"  bot    : {case['bot_state_in_window']} at "
      f"{pd.Timestamp(case['bot_decision_clock']).time()}")
print(f"  route  : setup={case['entry_family_receipt']}  story={case['story_receipt']}")
print(f"  location: {case['interaction_geometry']}")
fr = case.get("force_receipt") or {}
print(f"  force  : confirmed={fr.get('confirmed')} eff={fr.get('path_efficiency')} "
      f"prog={fr.get('directional_progress')} obs={fr.get('completed_1m_observations')} "
      f"reason={fr.get('reason')}")
print()

observed = old.download_pinned(DATA, include_tick=False)
old.verify_manifest(observed, json.loads(LOCK.read_text()))
raw5 = old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name)
raw1 = old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name)
env = old.prepare(raw5, raw1)
xr = xray_session(env, date.fromisoformat(SESSION), v24.Params())

surv = [r for r in xr["records"] if r["outcome"] == "SURVIVED_TO_RANKING"]
in_win = [r for r in surv if w_start <= pd.Timestamp(r["clock"]) <= w_end]

print(f"IN-WINDOW SURVIVING PERMISSIONS: {len(in_win)}")
print(f"  {'clock':10} {'dir':4} {'route':28} {'location':22}")
for r in sorted(in_win, key=lambda x: x["clock"]):
    print(f"  {pd.Timestamp(r['clock']).strftime('%H:%M:%S')} {r['direction']:4} "
          f"{r['route']:28} {str(r.get('location_source'))[:22]:22}")

print()
longs = [r for r in in_win if r["direction"] == "L"]
shorts = [r for r in in_win if r["direction"] == "S"]
print(f"  in-window LONG permissions  : {len(longs)}")
print(f"  in-window SHORT permissions : {len(shorts)}")

if longs:
    first_l = min(longs, key=lambda x: x["clock"])
    first_s = min(shorts, key=lambda x: x["clock"]) if shorts else None
    print()
    print("  THE ORDERING QUESTION:")
    print(f"    first SHORT permission : {pd.Timestamp(first_s['clock']).strftime('%H:%M:%S')}"
          if first_s else "    no short permission")
    print(f"    first LONG  permission : {pd.Timestamp(first_l['clock']).strftime('%H:%M:%S')}")
    print(f"    trader LONG decision   : {t_clock.strftime('%H:%M:%S')}")
    if first_s and first_s["clock"] < first_l["clock"]:
        print("    => the kernel had BOTH directions permitted in-window and took the SHORT")
        print("       because it fired FIRST, not because the long was unavailable.")

# Why did the long candidates that existed not win? Show what killed the non-survivors.
killed = {}
for r in xr["records"]:
    if r["outcome"] == "REJECTED" and w_start <= pd.Timestamp(r["clock"]) <= w_end:
        k = (r["direction"], r.get("killed_at"))
        killed[k] = killed.get(k, 0) + 1
print()
print("  IN-WINDOW REJECTIONS by direction and earliest gate:")
for (d, g), n in sorted(killed.items(), key=lambda x: -x[1])[:10]:
    print(f"    {d}  {str(g):38} {n}")
