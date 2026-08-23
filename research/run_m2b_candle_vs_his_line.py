#!/usr/bin/env python3
"""M2b — WHAT DID THE CANDLE AT HIS LINE ACTUALLY DO? ALGO-064/065. DIAGNOSTIC ONLY.

M2 showed that on 03-24 and 04-06 the machine's pivot AT his level confirms hours or a day
after he marked it, so no threshold could reach it. But ALGO-065 corrected the reading: those
late pivots are not what he SAW at 09:32 either. "His level is the in-progress rejection"
therefore stays a HYPOTHESIS until the candle he was actually looking at is measured.

So this measures, on HIS OWN marked timeframe, at TWO clocks:

    * the bar containing his marked_time  (and the completed bar before it)
    * the bar containing his entry clock  (and the completed bar before it)

and for each, RELATIVE TO HIS LINE:

    penetration    how far past the line the bar traded (low below a support line, high above
                   a resistance line). 0 means it never reached the line at all.
    close_away     how far the close finished on the correct side. Negative means it closed
                   THROUGH his line - the opposite of a rejection.
    touched        did the bar's range include the line at all

WHY DISTANCES AND NOT VERDICTS. A boolean "was it a rejection" would just be my classifier
again, and this lane has already paid twice for that. Distances are informative under either
answer: if price never reached his line, the in-progress-rejection hypothesis is refuted for
that session; if it reached and closed away hard, it is supported; and the magnitude is what a
later teaching-derived clause would have to be consistent with.

IT ALSO BEARS ON THE STORY LANE. ALGO-009 says "a touch alone is never rejection authority".
If the candle at his line merely touched and did not push away, the machine's
MERE_APPROACH_WITHOUT_TOUCH / TOUCH_WITHOUT_DIRECTIONAL_CONTROL refusals on 03-31 and 04-06 may
be CORRECT, and his entry rode some other taught form. This module does not decide that; it
supplies the numbers that let it be decided.

Run: PYTHONPATH=. python -m research.run_m2b_candle_vs_his_line
"""
from __future__ import annotations

import io
import json
import time
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_exam_window as W
from research import run_refusal_diagnosis_lost_four as D

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC. Measures candle geometry against his marked line. Repairs nothing, selects no "
    "rule, tunes no parameter, and emits no rejection verdict. ALGO-065 M2b."
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
OUT = Path("research/current_mnq_strategy_v2_4_m2b_candle_vs_line_2026_08_23.json")

CONTROL_SESSION = "2026-04-14"
ALL_SESSIONS = ["2026-03-24", "2026-03-30", "2026-03-31", "2026-04-06", CONTROL_SESSION]

#: How many completed bars before each clock to report, so the approach is visible and not just
#: the single bar. Three is enough to see a drive in without becoming a re-walk of the story.
CONTEXT_BARS = 3


def _vs_line(bar, line: float, role: str) -> dict:
    """Distances from his LINE. Sign conventions are stated, not left to the reader.

    For SUPPORT: penetration = how far BELOW the line the low went; close_away = how far ABOVE
    the line the close finished. For RESISTANCE both are mirrored. Negative close_away means it
    closed on the WRONG side - through his level rather than away from it.
    """
    o, h, l, c = float(bar.open), float(bar.high), float(bar.low), float(bar.close)
    if role == "SUPPORT":
        penetration = max(0.0, line - l)
        close_away = c - line
        approach_from = "above"
    else:
        penetration = max(0.0, h - line)
        close_away = line - c
        approach_from = "below"
    return {
        "ohlc": [round(o, 2), round(h, 2), round(l, 2), round(c, 2)],
        "range": round(h - l, 2),
        "touched_the_line": bool(l <= line <= h),
        "penetration_points": round(penetration, 2),
        "close_away_points": round(close_away, 2),
        "closed_on_the_wrong_side": bool(close_away < 0),
        "approach_expected_from": approach_from,
        "body_frac": round(abs(c - o) / (h - l), 3) if h > l else None,
        "close_loc": round((c - l) / (h - l), 3) if h > l else None,
    }


def _window(bars: pd.DataFrame, clock: pd.Timestamp, line: float, role: str) -> dict:
    at = bars[bars.index <= clock]
    if at.empty:
        return {"note": "no bar at or before this clock"}
    rows = []
    for i in range(max(0, len(at) - CONTEXT_BARS - 1), len(at)):
        b = at.iloc[i]
        rows.append({"start": str(at.index[i]),
                     "is_the_bar_containing_the_clock": i == len(at) - 1,
                     **_vs_line(b, line, role)})
    return {"bars": rows}


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
        h15, full5 = env["h15"], env["full5"]

        for session in ALL_SESSIONS:
            tr, lab = traders.get(session, {}), labels.get(session, {})
            direction = {"ENTER_LONG": "L", "ENTER_SHORT": "S"}.get(tr.get("final_action"))
            zone = D._his_zone(lab, direction) if direction else None
            if not zone:
                rows.append({"session": session, "note": "no marked zone for his direction"})
                continue

            role = str(zone["role"])
            # HIS LINE. The label records a one-tick band; its midpoint IS the line, and the
            # line-vs-band question (ALGO-065) is exactly why this module measures DISTANCE
            # rather than overlap - a distance stays meaningful whichever the answer is.
            line = (float(zone["lo"]) + float(zone["hi"])) / 2
            tf = str(zone.get("marked_main_timeframe") or "5m")
            bars = h15 if tf.startswith("15") else full5

            marked = pd.Timestamp(zone["marked_time"])
            entry = pd.Timestamp(tr["first_entry_time"]) if tr.get("first_entry_time") else None

            rows.append({
                "session": session,
                "is_control": session == CONTROL_SESSION,
                "trader_final_action": tr.get("final_action"),
                "his_line": line,
                "his_role": role,
                "his_marked_timeframe": tf,
                "marked_time": str(marked),
                "entry_time": str(entry) if entry is not None else None,
                "AT_HIS_MARKED_TIME": _window(bars, marked, line, role),
                "AT_HIS_ENTRY_CLOCK": (_window(bars, entry, line, role)
                                       if entry is not None else None),
            })

    out = {
        "artifact": "M2B_CANDLE_VS_HIS_LINE",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-065 M2b",
        "produced": "2026-08-23",
        "question": ("on his own timeframe, did price trade INTO his line and close AWAY from "
                     "it - at the moment he marked it, and at the moment he entered?"),
        "sign_conventions": {
            "penetration_points": "how far past the line the bar traded (below a SUPPORT line, "
                                  "above a RESISTANCE line). 0 = never reached it.",
            "close_away_points": "how far the close finished on the correct side. NEGATIVE = "
                                 "closed THROUGH his line, the opposite of a rejection.",
        },
        "why_no_verdict": (
            "a boolean 'was it a rejection' would be a classifier, and this lane has paid twice "
            "for classifiers. Distances are informative under either answer."),
        "bears_on": (
            "ALGO-009: 'a touch alone is never rejection authority'. If the candle at his line "
            "merely touched without pushing away, the machine's MERE_APPROACH_WITHOUT_TOUCH and "
            "TOUCH_WITHOUT_DIRECTIONAL_CONTROL refusals may be CORRECT and his entry rode "
            "another taught form. This module supplies the numbers; it does not decide."),
        "rows": rows,
        "runtime_seconds": round(time.perf_counter() - t0, 2),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for r in rows:
        if "his_line" not in r:
            continue
        tag = "CONTROL" if r["is_control"] else "subject"
        print(f"\n[{tag}] {r['session']}  {r['his_role']} line {r['his_line']}  "
              f"tf {r['his_marked_timeframe']}  ({r['trader_final_action']})")
        for label_, block in (("MARKED @ " + r["marked_time"], r["AT_HIS_MARKED_TIME"]),
                              ("ENTRY  @ " + str(r["entry_time"]), r["AT_HIS_ENTRY_CLOCK"])):
            if not block or "bars" not in block:
                print(f"    {label_}: {block}")
                continue
            print(f"    {label_}")
            for b in block["bars"]:
                mark = "<<" if b["is_the_bar_containing_the_clock"] else "  "
                print(f"      {b['start'][11:16]} {str(b['ohlc']):<38} "
                      f"touch={str(b['touched_the_line']):<5} "
                      f"pen={b['penetration_points']:>7} "
                      f"close_away={b['close_away_points']:>8} {mark}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    # ALGO-057 4.1: ONE WRITER PER ARTIFACT, and the lock covers the whole RUN.
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
