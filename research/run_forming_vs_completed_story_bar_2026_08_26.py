#!/usr/bin/env python3
"""ALGO-101 §7 — FORMING vs COMPLETED story bar, at each of his seven entry clocks.

REPORT ONLY. No stage moves, no predicate is proposed, nothing lands. ALGO-033 owns the
placement of the story stage and this measurement does not touch it.

WHY IT WAS ORDERED. T3's honest-partial produced a structural observation on 03-24: the
COMPLETED bar the story reads (09:25) measured `body 6.00 / upper 15.25 / lower 25.50`, while
the FORMING bar at his clock (09:30) measured `body 48.75` and was decisively directional. If
the machine and the operator are reading different candles at his clock, that is where it shows
— so this asks the same question at all seven entries instead of generalising from one.

WHAT IT DOES NOT CLAIM. That the forming bar is the right bar. ALGO-033 placed the story on
completed bars for a CAUSALITY reason (the forming bar's final geometry does not exist at
decision time), and nothing here disturbs that. This measures WHETHER the two bars would be
read differently, and reports the geometry of both side by side.

HORIZON: the 5m frame is read directly; no candidate enumeration, so no `as_of` applies.

NO PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
"""
from __future__ import annotations

import io
import json
import sys
import time
from datetime import time as _time
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Forming vs completed story bar. Lands nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")


def _geometry(row, direction: str) -> dict:
    """Raw OHLC geometry. No fraction, no threshold — the numbers, and nothing derived."""
    o, h, low, c = (float(row.open), float(row.high), float(row.low), float(row.close))
    body = abs(c - o)
    upper = h - max(o, c)
    lower = min(o, c) - low
    midpoint = (h + low) / 2.0
    # The REJECTION-side wick is the one price had to reject THROUGH: below for a long at
    # support, above for a short at resistance.
    rejection_wick, opposing_wick = (lower, upper) if direction == "L" else (upper, lower)
    return {
        "open": o, "high": h, "low": low, "close": c,
        "body": round(body, 2),
        "upper_wick": round(upper, 2),
        "lower_wick": round(lower, 2),
        "rejection_side_wick": round(rejection_wick, 2),
        "opposing_wick": round(opposing_wick, 2),
        "rejection_wick_exceeds_opposing": bool(rejection_wick > opposing_wick),
        "midpoint": round(midpoint, 2),
        "closes_past_midpoint_in_direction": bool(c > midpoint) if direction == "L"
        else bool(c < midpoint),
        "body_smaller_than_both_wicks": bool(body < upper and body < lower),
    }


def main() -> int:
    t0 = time.perf_counter()
    out_path = Path(sys.argv[1] if len(sys.argv) > 1
                    else "forming_vs_completed_story_bar.json")

    man = {c["case_id"]: c["session"] for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    labels = [r for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
              if r["case_id"] in man and r.get("first_entry_time")]

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(_time(8, 0)):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        full5 = env["full5"]
        for lab in sorted(labels, key=lambda r: man[r["case_id"]]):
            session = man[lab["case_id"]]
            his = pd.Timestamp(lab["first_entry_time"])
            bucket = his.floor("5min")
            direction = "L" if lab["final_action"] == "ENTER_LONG" else "S"

            upto = full5[full5.index <= bucket]
            if len(upto) < 2:
                rows.append({"session": session, "note": "insufficient 5m history"})
                continue
            forming = upto.iloc[-1]        # the bar AT his clock, still forming when he acted
            completed = upto.iloc[-2]      # the bar ALGO-033 puts the story on

            g_c = _geometry(completed, direction)
            g_f = _geometry(forming, direction)
            rows.append({
                "session": session,
                "his_clock": str(his),
                "direction": direction,
                "completed_story_bar": {"timestamp": str(upto.index[-2]), **g_c},
                "forming_bar_at_his_clock": {"timestamp": str(upto.index[-1]), **g_f},
                "the_two_bars_disagree_on_rejection_side_wick": bool(
                    g_c["rejection_wick_exceeds_opposing"]
                    != g_f["rejection_wick_exceeds_opposing"]),
                "the_two_bars_disagree_on_midpoint_close": bool(
                    g_c["closes_past_midpoint_in_direction"]
                    != g_f["closes_past_midpoint_in_direction"]),
                "the_two_bars_disagree_on_body_vs_both_wicks": bool(
                    g_c["body_smaller_than_both_wicks"]
                    != g_f["body_smaller_than_both_wicks"]),
            })

    disagree = sum(1 for r in rows if r.get("the_two_bars_disagree_on_rejection_side_wick")
                   or r.get("the_two_bars_disagree_on_midpoint_close")
                   or r.get("the_two_bars_disagree_on_body_vs_both_wicks"))
    out = {
        "artifact": "FORMING_VS_COMPLETED_STORY_BAR",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-101 §7 (report-only, ordered for ALGO-102)",
        "horizon": "5m frame read directly; no candidate enumeration, so no as_of applies",
        "note": ("ALGO-033 places the story on the COMPLETED bar for a causality reason and "
                 "nothing here disturbs it. This reports whether the two bars would be READ "
                 "differently, and prints the geometry of both."),
        "entries": len(rows),
        "entries_where_the_two_bars_disagree_on_at_least_one_reading": disagree,
        "rows": rows,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== FORMING vs COMPLETED STORY BAR, his seven entry clocks ===")
    print("(ALGO-101 §7, report only — no stage moves)\n")
    for r in rows:
        if "completed_story_bar" not in r:
            print(f"{r['session']}: {r.get('note')}")
            continue
        c, f = r["completed_story_bar"], r["forming_bar_at_his_clock"]
        print(f"{r['session']}  {r['his_clock'][11:16]}  {r['direction']}")
        print(f"   COMPLETED {c['timestamp'][11:16]}  body {c['body']:>8}  "
              f"rej-wick {c['rejection_side_wick']:>8}  opp {c['opposing_wick']:>8}  "
              f"rej>opp {str(c['rejection_wick_exceeds_opposing']):<5}  "
              f"past-mid {c['closes_past_midpoint_in_direction']}")
        print(f"   FORMING   {f['timestamp'][11:16]}  body {f['body']:>8}  "
              f"rej-wick {f['rejection_side_wick']:>8}  opp {f['opposing_wick']:>8}  "
              f"rej>opp {str(f['rejection_wick_exceeds_opposing']):<5}  "
              f"past-mid {f['closes_past_midpoint_in_direction']}")
        flags = [k.replace("the_two_bars_disagree_on_", "") for k in
                 ("the_two_bars_disagree_on_rejection_side_wick",
                  "the_two_bars_disagree_on_midpoint_close",
                  "the_two_bars_disagree_on_body_vs_both_wicks") if r.get(k)]
        print(f"   DISAGREE ON: {', '.join(flags) if flags else 'nothing'}\n")
    print(f"entries where the two bars disagree on at least one reading: {disagree}/{len(rows)}")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
