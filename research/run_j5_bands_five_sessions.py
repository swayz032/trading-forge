#!/usr/bin/env python3
"""THE FIVE J5 BANDS UNDER THE OPERATOR'S OWN RULE. DIAGNOSTIC ONLY - repairs nothing.

ALGO-073/074 (3). The operator answered two questions and they are never to be asked again:
key zones are BANDS, not lines; and a rejection is a rejection wick / a candle that does not
break the level. The band rule that follows, ratified as mine to apply, is:

    band = [wick extreme, close] of the REJECTION CANDLE, on `marked_main_timeframe`.

THESE ARE PUBLISHED BEFORE 03-24's COVERAGE IS RE-RUN. That ordering is the whole point: a band
computed after seeing whether it closes a 27.66-point gap is a band chosen to close the gap.
Fix the five bands first, in one artifact, then let the coverage fall where it falls.

WHICH WICK IS THE REJECTION WICK - AND THE FIRST ANSWER WAS WRONG. The obvious reading is that
the ROLE picks the wick: resistance -> upper, support -> lower. Run that way, the rule produced
five bands of which NONE covered his line, three had the role-implied wick SMALLER than the
opposite one, and 04-06 came out zero-width. That is a refutation, not a rounding error, and it
was visible only because both wicks were measured instead of just the one the role implied.

The operator's own definition resolves it: "a rejection wick / a candle that does not break the
level". "Does not break" is a statement about the CLOSE. So the rejection wick is the one that
PENETRATES the level while the close stays on the other side - derived from the candle, not from
the role at his entry. 03-31 is the clean case: at 09:35 price had already broken above, so the
level was acting as SUPPORT (41.75 pt lower wick, close back above) even though its role AT HIS
ENTRY is RESISTANCE. The role at marking and the role at entry are different facts.

TWO THINGS THIS ARTIFACT MAY NOT BE USED TO ARGUE.
  1. `band_covers_his_line` is TRUE BY CONSTRUCTION under this rule - a band running from a wick
     through the level to a close on the far side always contains the level. It is printed as a
     self-check that the derivation did what it claims, and it is NOT evidence that any location
     gap is closed. The 03-24 coverage question is answered by the coverage re-run, not here.
  2. The widths (41.75 - 143.25 pts) sit ABOVE the held teaching span of ~4-75 pts, and 03-24's
     143.25 is roughly double the widest measured example. That is reported, not smoothed.

NO PnL, outcome, or agreement rate is read here. The bands come from the marked candle's OHLC.
"""
from __future__ import annotations

import io
import json
import time
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Derives the five J5 bands from the operator's rule. Repairs nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
J16 = Path("research/current_mnq_strategy_v2_4_j16_unified_resolution_2026_08_23.json")
OUT = Path("research/current_mnq_strategy_v2_4_j5_bands_five_sessions_2026_08_23.json")

SESSIONS = ("2026-03-24", "2026-03-30", "2026-03-31", "2026-04-06", "2026-04-14")


def _selected_zone(row):
    """The zone J1/J2 actually selected, matched by its LINE - not by list position."""
    line = row.get("J2_selected_line")
    for c in (row.get("J1_selection") or {}).get("candidates") or []:
        if c.get("line") == line:
            return c.get("zone") or {}, line
    return {}, line


def main() -> int:
    t0 = time.perf_counter()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    frames = {"5m": env["full5"], "15m": env["h15"]}

    j16 = {r["session"]: r for r in json.load(io.open(J16, encoding="utf-8"))["rows"]}

    rows = []
    for session in SESSIONS:
        row = j16[session]
        zone, line = _selected_zone(row)
        role = row.get("J2_selected_role")
        tf = zone.get("marked_main_timeframe")
        marked = zone.get("marked_time")

        frame = frames.get(tf)
        if frame is None or not marked:
            rows.append({"session": session, "ERROR": f"no frame for timeframe {tf!r}"})
            continue

        # The rejection candle is the one CONTAINING the marked instant, which is when HE drew
        # it - not necessarily a bucket boundary (03-24 is marked 09:32 on a 15m chart).
        ts = pd.Timestamp(marked)
        prior = frame[frame.index <= ts]
        if prior.empty:
            rows.append({"session": session, "ERROR": f"no {tf} bar at or before {marked}"})
            continue
        bar_ts = prior.index[-1]
        # ALGO-076: COMPLETED or FORMING at marked_time. A bar at bucket T on timeframe D spans
        # [T, T+D); it is COMPLETED only once marked_time reaches T+D. This is NOT cosmetic - a
        # band derived from a bar's FULL OHLC while that bar was still forming uses highs, lows
        # and a close that did not exist at the instant he marked the level. That is the
        # H-CONFIRM case and it is labelled rather than hidden.
        tf_minutes = 15 if tf == "15m" else 5
        bar_close_ts = bar_ts + pd.Timedelta(minutes=tf_minutes)
        completed = bool(ts >= bar_close_ts)
        r = frame.loc[bar_ts]
        o, h, l, c = float(r.open), float(r.high), float(r.low), float(r.close)
        rng = h - l
        upper = h - max(o, c)
        lower = min(o, c) - l

        # WHICH WICK REJECTED THE LEVEL - DERIVED FROM THE CANDLE, NOT FROM THE ENTRY-TIME ROLE.
        #
        # The operator's definition is "a rejection wick / a candle that does not break the
        # level". "Does not break" is a statement about the CLOSE: the close stays on one side
        # while the wick goes through. So the rejection wick is the one that PENETRATES the
        # level with the close on the other side, and the resulting band straddles the level by
        # construction.
        #
        # Keying on the entry-time role instead produced five bands, NONE of which covered his
        # line, three with the role-implied wick smaller than the opposite one, and a degenerate
        # zero-width band on 04-06. 03-31 is the clean counterexample: at 09:35 price had
        # already broken ABOVE the level, so the level was acting as SUPPORT - a 41.75 pt LOWER
        # wick to 23402.75 closing back at 23444.50 - while its role AT HIS ENTRY is RESISTANCE.
        # The role at marking time and the role at entry are different facts.
        lvl = float(line)
        pen_lower = (c > lvl and l < lvl)
        pen_upper = (c < lvl and h > lvl)
        if pen_lower and not pen_upper:
            wick_extreme, wick_name, wick_size, other_size = l, "lower", lower, upper
            marked_role = "SUPPORT"
        elif pen_upper and not pen_lower:
            wick_extreme, wick_name, wick_size, other_size = h, "upper", upper, lower
            marked_role = "RESISTANCE"
        else:
            rows.append({
                "session": session,
                "ERROR": ("no unambiguous rejection wick: the close does not sit on one side of "
                          "the level with the opposite wick through it"),
                "level": lvl, "ohlc": [o, h, l, c],
                "close_above_level": bool(c > lvl),
                "high_above_level": bool(h > lvl), "low_below_level": bool(l < lvl),
                "marked_time": marked, "marked_main_timeframe": tf,
                "rejection_candle_bucket": str(bar_ts),
            })
            continue

        band_lo, band_hi = sorted((wick_extreme, c))
        rows.append({
            "session": session,
            "his_direction": row.get("his_direction"),
            "role_at_his_entry": role,
            "role_AT_MARKING_derived_from_the_candle": marked_role,
            "marking_role_differs_from_entry_role": bool(marked_role != role),
            "his_line": line,
            "marked_time": marked,
            "marked_main_timeframe": tf,
            "rejection_candle_bucket": str(bar_ts),
            "rejection_candle_state_at_marked_time": "COMPLETED" if completed else "FORMING",
            "rejection_candle_closes_at": str(bar_close_ts),
            "is_H_CONFIRM_case": (not completed),
            "rejection_candle_ohlc": [o, h, l, c],
            "rejection_wick_used": wick_name,
            "rejection_wick_points": round(wick_size, 2),
            "opposite_wick_points": round(other_size, 2),
            "candle_range_points": round(rng, 2),
            # The honesty check: if the role-implied wick is the smaller one, say so loudly
            # rather than returning a band that looks fine.
            "REJECTION_WICK_IS_THE_SMALLER_ONE": bool(wick_size < other_size),
            "band_lo": round(band_lo, 4),
            "band_hi": round(band_hi, 4),
            "band_width_points": round(band_hi - band_lo, 2),
            "band_covers_his_line": bool(band_lo <= float(line) <= band_hi),
        })

    suspect = [r["session"] for r in rows if r.get("REJECTION_WICK_IS_THE_SMALLER_ONE")]
    forming = [r["session"] for r in rows if r.get("is_H_CONFIRM_case")]
    widths = [r["band_width_points"] for r in rows if "band_width_points" in r]

    out = {
        "artifact": "J5_BANDS_FIVE_SESSIONS",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-074 (3); band rule from the operator's ALGO-071/073 answers",
        "produced": "2026-08-23",
        "rule": ("band = [wick extreme, close] of the rejection candle, measured on the zone's "
                 "own `marked_main_timeframe`. The role picks the wick: RESISTANCE -> upper, "
                 "SUPPORT -> lower."),
        "published_BEFORE_the_0324_coverage_rerun": True,
        "coverage_is_TAUTOLOGICAL_under_this_rule": (
            "`band_covers_his_line` is true BY CONSTRUCTION: a band from a penetrating wick "
            "through the level to a close on the far side always contains the level. It is a "
            "self-check on the derivation, NOT evidence that any location gap is closed."),
        "widths_sit_ABOVE_the_held_teaching_span": (
            "41.75-143.25 pts here vs ~4-75 pts held. 03-24's 143.25 is ~2x the widest measured "
            "teaching example (74.5) and is flagged rather than reconciled."),
        "rows": rows,
        "width_range_points": [min(widths), max(widths)] if widths else None,
        "sessions_where_the_rejection_wick_is_smaller": suspect,
        "H_CONFIRM_sessions_marked_candle_still_FORMING": forming,
        "why_FORMING_matters": (
            "A band taken from the full OHLC of a bar that had not closed at marked_time uses "
            "extremes and a close that did not exist when he drew the level. Every such band is "
            "labelled H-CONFIRM; none is silently treated as a completed-bar band."),
        "held_teaching_width_span_for_comparison": (
            "~4-75 points across the six screenshots (4/8/19/22/30/32) and the two zones "
            "measured off the 11 Apr '25 tape (~27 and ~74.5). ALGO-073 ruled width is not a "
            "constant, and these bands are not expected to agree on one number."),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== THE FIVE J5 BANDS (operator's rule) ===")
    for r in rows:
        if "ERROR" in r:
            print(f"  {r['session']}  ERROR: {r['ERROR']}")
            continue
        flag = "  <-- REJECTION WICK IS SMALLER" if \
            r["REJECTION_WICK_IS_THE_SMALLER_ONE"] else ""
        print(f"  {r['session']}  {r['role_at_his_entry']:<10} tf={r['marked_main_timeframe']:<3} "
              f"candle {r['rejection_candle_bucket'][11:16]}")
        print(f"      band [{r['band_lo']}, {r['band_hi']}]  width={r['band_width_points']} pts"
              f"  covers_his_line={r['band_covers_his_line']}")
        print(f"      {r['rejection_wick_used']} wick={r['rejection_wick_points']} pts vs "
              f"opposite={r['opposite_wick_points']} pts{flag}")
        print(f"      candle at marked_time: {r['rejection_candle_state_at_marked_time']} "
              f"(closes {r['rejection_candle_closes_at'][11:16]})")
    print(f"\nwidth range: {out['width_range_points']} points")
    if suspect:
        print(f"NOTE (rejection wick smaller than the opposite): {suspect}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
