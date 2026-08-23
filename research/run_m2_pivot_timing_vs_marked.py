#!/usr/bin/env python3
"""M2 — IS HIS LEVEL THE IN-PROGRESS REJECTION? ALGO-064. DIAGNOSTIC ONLY.

M1 said the map RULE excludes his levels: at the nearest same-side pivot, `min_wick` refuses
one and the single-swing displacement threshold refuses the other. That is a MAGNITUDE answer,
and it invites a threshold repair.

M2 asks a different question, and if it answers yes then no threshold repair is right:
**WHEN does the machine's nearest pivot CONFIRM, relative to the moment he marked the level?**

A pivot is only a pivot once enough bars have printed to confirm it. If the rejection he marks
is still IN PROGRESS at his marked_time, then the machine cannot have a confirmed pivot there
YET — not because the wick is too small, but because the event has not finished happening. That
is a SEMANTIC gap: he acts on a rejection he is watching form; the machine acts on rejections
that have completed. Loosening `min_wick` would not close it, and would let in a pile of
unrelated levels while still missing his.

    M1 and M2 MUST NOT BE CONFLATED. M1 is "the bar was not big enough". M2 is "the bar had not
    finished". They point at different repairs, and a table that reports only the first would
    send the work to the wrong layer.

Measured for ALL FIVE sessions - the four lost and the AGREE control - because the control is
what says whether the difference is timing or magnitude. Reports, per session:

  * his marked_time, and the nearest same-side causal pivot's `t` and `confirm`
  * confirm - marked_time  (NEGATIVE = already confirmed when he marked; POSITIVE = the machine
    could not have known it yet)
  * the candle geometry at his marked_time ON HIS OWN TIMEFRAME (5m or 15m as the label says):
    wick fractions, body fraction, range - the shape he was looking at
  * the same geometry for the bar that CONTAINS his marked_time versus the COMPLETED bar before

Run: PYTHONPATH=. python -m research.run_m2_pivot_timing_vs_marked
"""
from __future__ import annotations

import io
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_exam_window as W
from research import run_refusal_diagnosis_lost_four as D

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC. Measures pivot confirmation timing against his marked_time. Repairs nothing, "
    "selects no rule, tunes no parameter. ALGO-064 M2."
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
OUT = Path("research/current_mnq_strategy_v2_4_m2_pivot_timing_2026_08_23.json")

CONTROL_SESSION = "2026-04-14"
ALL_SESSIONS = ["2026-03-24", "2026-03-30", "2026-03-31", "2026-04-06", CONTROL_SESSION]


def _geom(bar) -> dict:
    """The candle's shape, as fractions of its own range. No thresholds applied here."""
    o, h, l, c = (float(bar.open), float(bar.high), float(bar.low), float(bar.close))
    rng = h - l
    if rng <= 0:
        return {"range": rng, "body_frac": None, "upper_wick_frac": None,
                "lower_wick_frac": None, "close_loc": None, "bullish": c > o}
    return {
        "range": round(rng, 2),
        "body_frac": round(abs(c - o) / rng, 3),
        "upper_wick_frac": round((h - max(o, c)) / rng, 3),
        "lower_wick_frac": round((min(o, c) - l) / rng, 3),
        "close_loc": round((c - l) / rng, 3),
        "bullish": bool(c > o),
        "ohlc": [round(o, 2), round(h, 2), round(l, 2), round(c, 2)],
    }


def main() -> int:
    t0 = time.perf_counter()
    labels = D._raw_labels()
    traders = D._trader_entries()

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(W.BASELINE_ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = v24.Params()
        piv = env["piv15"]
        h15, full5 = env["h15"], env["full5"]

        for session in ALL_SESSIONS:
            tr, lab = traders.get(session, {}), labels.get(session, {})
            direction = {"ENTER_LONG": "L", "ENTER_SHORT": "S"}.get(tr.get("final_action"))
            zone = D._his_zone(lab, direction) if direction else None
            if not zone:
                rows.append({"session": session, "note": "no marked zone for his direction"})
                continue

            side = "S" if zone["role"] == "SUPPORT" else "R"
            marked = pd.Timestamp(zone["marked_time"])
            mid = (float(zone["lo"]) + float(zone["hi"])) / 2
            tf = str(zone.get("marked_main_timeframe") or "5m")
            bars = h15 if tf.startswith("15") else full5

            # The nearest SAME-SIDE pivot by price, among those causally available at 09:30.
            asof = pd.Timestamp(f"{session} 09:30", tz=marked.tz)
            causal = piv[(piv.confirm <= asof) & (piv.side == side)]
            near = None
            if not causal.empty:
                near = causal.iloc[(causal.price - mid).abs().argsort()[:1]].iloc[0]

            # And the nearest same-side pivot WITHOUT the causal filter, so a pivot that exists
            # but confirms LATER is visible rather than invisible.
            any_side = piv[piv.side == side]
            near_any = None
            if not any_side.empty:
                cand = any_side[(any_side.price - mid).abs() <= 5.0]
                if not cand.empty:
                    near_any = cand.iloc[(cand.confirm - marked).abs().argsort()[:1]].iloc[0]

            containing = bars[bars.index <= marked]
            bar_at = containing.iloc[-1] if len(containing) else None
            bar_before = containing.iloc[-2] if len(containing) > 1 else None

            def delta(ts):
                if ts is None:
                    return None
                return round((pd.Timestamp(ts) - marked).total_seconds() / 60.0, 1)

            rows.append({
                "session": session,
                "is_control": session == CONTROL_SESSION,
                "his_level": {"lo": zone["lo"], "hi": zone["hi"], "role": zone["role"],
                              "marked_time": zone["marked_time"],
                              "marked_main_timeframe": tf,
                              "source_method": zone.get("source_method")},
                "nearest_causal_pivot": None if near is None else {
                    "price": float(near.price),
                    "distance_points": round(abs(float(near.price) - mid), 2),
                    "t": str(near.t), "confirm": str(near.confirm),
                    "confirm_minus_marked_minutes": delta(near.confirm),
                    "wick": round(float(near.wick), 3), "disp": round(float(near.disp), 3),
                },
                "nearest_pivot_at_his_price_any_time": None if near_any is None else {
                    "price": float(near_any.price),
                    "distance_points": round(abs(float(near_any.price) - mid), 2),
                    "t": str(near_any.t), "confirm": str(near_any.confirm),
                    "confirm_minus_marked_minutes": delta(near_any.confirm),
                    "confirmed_before_he_marked": bool(
                        pd.Timestamp(near_any.confirm) <= marked),
                    "wick": round(float(near_any.wick), 3),
                    "disp": round(float(near_any.disp), 3),
                },
                "bar_containing_his_mark": None if bar_at is None else {
                    "timeframe": tf, "start": str(containing.index[-1]),
                    **_geom(bar_at)},
                "completed_bar_before_his_mark": None if bar_before is None else {
                    "timeframe": tf, "start": str(containing.index[-2]),
                    **_geom(bar_before)},
            })

    def verdict(r) -> str:
        na = r.get("nearest_pivot_at_his_price_any_time")
        if not na:
            return "NO_PIVOT_AT_HIS_PRICE_AT_ANY_TIME"
        if na["confirmed_before_he_marked"]:
            return "PIVOT_ALREADY_CONFIRMED_WHEN_HE_MARKED (a MAGNITUDE question, M1)"
        return "PIVOT_CONFIRMS_AFTER_HE_MARKED (a TIMING question - the event had not finished)"

    for r in rows:
        if "his_level" in r:
            r["M2_verdict"] = verdict(r)

    out = {
        "artifact": "M2_PIVOT_TIMING_VS_MARKED",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-064 M2",
        "produced": "2026-08-23",
        "question": ("does the machine's nearest pivot CONFIRM before or after he marked the "
                     "level - i.e. is his level the in-progress rejection?"),
        "why_it_matters": (
            "M1 says the bar was not big enough (a magnitude question, answerable by a "
            "threshold). M2 asks whether the bar had not FINISHED (a semantic question, which "
            "no threshold fixes). They point at different repairs and must not be conflated."),
        "rows": rows,
        "repairs": "NONE. This measures; the repair is ruled elsewhere.",
        "runtime_seconds": round(time.perf_counter() - t0, 2),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for r in rows:
        if "his_level" not in r:
            continue
        tag = "CONTROL" if r["is_control"] else "subject"
        hl = r["his_level"]
        print(f"\n[{tag}] {r['session']}  {hl['role']} {hl['lo']}-{hl['hi']}  "
              f"marked {hl['marked_time']} on {hl['marked_main_timeframe']}")
        na = r["nearest_pivot_at_his_price_any_time"]
        if na:
            print(f"    pivot at his price : {na['price']} ({na['distance_points']} pts), "
                  f"confirm {na['confirm']}  = {na['confirm_minus_marked_minutes']:+.1f} min "
                  f"vs his mark")
            print(f"    wick {na['wick']}  disp {na['disp']}")
        else:
            print("    NO pivot within 5 points of his level at ANY time")
        b = r["bar_containing_his_mark"]
        if b:
            print(f"    bar he was watching ({b['timeframe']} @ {b['start']}): "
                  f"body {b['body_frac']} upper {b['upper_wick_frac']} "
                  f"lower {b['lower_wick_frac']} range {b['range']}")
        print(f"    -> {r['M2_verdict']}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    # ALGO-057 4.1: ONE WRITER PER ARTIFACT, and the lock covers the whole RUN.
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
