"""Measure the exceptional-single-swing threshold at each session's near-level pivot.

The frozen key-level spec (current_mnq_strategy_v2_4_key_level_semantics.json, release
MNQ-V2.4-SR-LOCATION-EQUATION-5) gives TWO paths into the map:

  established_zone_path          minimum_independent_rejections = 2
  exceptional_single_swing_path  wick >= min_wick AND
                                 displacement_atr >= max(1.0, Q75(same-side pivot
                                 displacement_atr confirmed in [candidate_confirm-40d,
                                 candidate_confirm)))

So a single swing CAN become a location. Naming which parameter excludes his level therefore
means MEASURING the Q75 threshold at his candidate, not inferring it from the fact that no zone
appeared.
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
SESSIONS = ["2026-03-24", "2026-03-30", "2026-04-14"]
FLOOR_ATR = 1.0
PERCENTILE = 0.75
MIN_REFS = 4

observed = old.download_pinned(DATA, include_tick=False)
old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

labels = D._raw_labels()
traders = D._trader_entries()

with W.trading_window(W.BASELINE_ARM_START):
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()
    piv = env["piv15"]
    print(f"min_wick={p.min_wick}   single-swing floor={FLOOR_ATR}  "
          f"percentile={PERCENTILE}  min_refs={MIN_REFS}\n")

    for session in SESSIONS:
        tr, lab = traders.get(session, {}), labels.get(session, {})
        direction = {"ENTER_LONG": "L", "ENTER_SHORT": "S"}.get(tr.get("final_action"))
        zone = D._his_zone(lab, direction)
        side = "S" if zone["role"] == "SUPPORT" else "R"
        asof = pd.Timestamp(f"{session} 09:30", tz=pd.Timestamp(zone["marked_time"]).tz)
        mid = (float(zone["lo"]) + float(zone["hi"])) / 2

        causal = piv[(piv.confirm <= asof) & (piv.side == side)]
        if causal.empty:
            print(f"{session}: no causal same-side pivots"); continue
        cand = causal.iloc[(causal.price - mid).abs().argsort()[:1]].iloc[0]

        refs = causal[(causal.confirm < cand.confirm)
                      & (causal.confirm >= cand.confirm - pd.Timedelta(days=40))]
        disp = pd.to_numeric(refs.get("disp"), errors="coerce")
        disp = disp[np.isfinite(disp)]
        if len(disp) < MIN_REFS:
            thresh = FLOOR_ATR
            basis = f"fewer than {MIN_REFS} refs -> floor"
        else:
            q = float(np.quantile(disp.to_numpy(float), PERCENTILE))
            thresh = max(FLOOR_ATR, q)
            basis = f"Q{int(PERCENTILE*100)} of {len(disp)} same-side refs = {q:.3f}"

        wick_ok = float(cand.wick) >= float(p.min_wick)
        disp_ok = float(cand.disp) >= thresh
        tag = "CONTROL" if session == "2026-04-14" else "subject"
        print(f"[{tag}] {session}  his {zone['role']} {zone['lo']}-{zone['hi']}")
        print(f"    nearest same-side pivot : {cand.price}  ({abs(cand.price-mid):.2f} pts away)")
        print(f"    wick {cand.wick:.3f} >= min_wick {p.min_wick} ? {wick_ok}")
        print(f"    disp {cand.disp:.3f} >= {thresh:.3f} ?  {disp_ok}    ({basis})")
        verdict = ("ENTERS as a single swing" if (wick_ok and disp_ok)
                   else "EXCLUDED: " + ("min_wick" if not wick_ok else
                                        "single-swing displacement threshold"))
        print(f"    -> {verdict}\n")
