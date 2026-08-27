"""L2 owes a RULE and a PARAMETER by name. This measures which filter removes his level.

`core.build_zones` (v2_2_engine.py:442) is pivot-based and filters in a fixed order:

    piv.confirm <= asof                 causal
    piv.t >= asof - look_days           age            (look_days=40)
    piv.wick  >= p.min_wick             wick quality   (Params.min_wick)
    piv.disp  >= p.min_disp_atr         displacement   (Params.min_disp_atr)
    then clusters survivors by price     tolerance      (Params.ztol_atr)
    then a group becomes a zone           touches       (Params.min_touches)

So the honest answer names the FIRST filter his level fails, or says there was never a pivot
there at all - which is a different finding from "a pivot was filtered out".
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_exam_window as W
from research import run_refusal_diagnosis_lost_four as D

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
SUBJECTS = ["2026-03-24", "2026-03-30"]
CONTROL = "2026-04-14"
NEAR = 40.0          # look this far either side of his level for a pivot

observed = old.download_pinned(DATA, include_tick=False)
old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

labels = D._raw_labels()
traders = D._trader_entries()

with W.trading_window(W.BASELINE_ARM_START):
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()
    piv = env["piv15"]
    core = old.core if hasattr(old, "core") else v24.core

    print(f"PARAMS: min_wick={p.min_wick}  min_disp_atr={p.min_disp_atr}  "
          f"ztol_atr={p.ztol_atr}  min_touches={getattr(p, 'min_touches', 'n/a')}\n")

    for session in SUBJECTS + [CONTROL]:
        tr, lab = traders.get(session, {}), labels.get(session, {})
        direction = {"ENTER_LONG": "L", "ENTER_SHORT": "S"}.get(tr.get("final_action"))
        zone = D._his_zone(lab, direction)
        side = "S" if zone["role"] == "SUPPORT" else "R"
        asof = pd.Timestamp(f"{session} 09:30", tz=pd.Timestamp(zone["marked_time"]).tz)
        lo, hi = float(zone["lo"]), float(zone["hi"])

        causal = piv[(piv.confirm <= asof) & (piv.t >= asof - pd.Timedelta(days=40))]
        near = causal[(causal.price >= lo - NEAR) & (causal.price <= hi + NEAR)]
        near_side = near[near.side == side]

        tag = "CONTROL" if session == CONTROL else "subject"
        print(f"[{tag}] {session}  his {zone['role']} {lo}-{hi}  side={side}")
        print(f"    causal pivots (40d)            : {len(causal)}")
        print(f"    ... within +/-{NEAR:g} of his level : {len(near)}   (his side: {len(near_side)})")

        if near_side.empty:
            print("    -> NO PIVOT ON HIS SIDE ANYWHERE NEAR HIS LEVEL: the rule never had a")
            print("       candidate there. This is not a filter rejecting his level; the pivot")
            print("       detector simply does not mark one.\n")
            continue

        passes_wick = near_side[near_side.wick >= p.min_wick]
        passes_disp = passes_wick[passes_wick.disp >= p.min_disp_atr]
        print(f"    ... passing min_wick={p.min_wick}      : {len(passes_wick)}")
        print(f"    ... passing min_disp_atr={p.min_disp_atr} : {len(passes_disp)}")
        if len(passes_disp):
            d = (passes_disp.price - (lo + hi) / 2).abs().min()
            print(f"    nearest SURVIVING pivot is {d:.2f} points from his level")
        rows = near_side.sort_values("price")
        for r in rows.head(6).itertuples():
            print(f"      pivot price={r.price:<10} wick={r.wick:.3f} disp={r.disp:.3f} "
                  f"t={r.t}")
        print()
