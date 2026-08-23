#!/usr/bin/env python3
"""J1-J6 — ONE ARTIFACT, ALL FIVE SESSIONS, under the advisor-specified join. DIAGNOSTIC ONLY.

Three of my joins were wrong before this one, so the join is no longer mine to choose. ALGO-066
specifies it and this module implements it literally:

  J1  SELECT THE ZONE BY GEOMETRY at his entry clock, over BOTH marked zones: inside the entry
      bar's [low, high] on his marked timeframe first; else nearest, with the distance reported.
      BOTH plausible (both inside, or both within the frozen 17.25-pt stop) = AMBIGUOUS, and
      the ambiguity is PUBLISHED rather than resolved by a preference.
  J2  Record the selected zone's ROLE as data, never as an assumption.
  J3  Derive the INTERACTION mechanically from role x direction:
          LONG @ SUPPORT / SHORT @ RESISTANCE -> REJECT
          LONG @ RESISTANCE / SHORT @ SUPPORT -> BREAK
          anything else -> UNCLASSIFIED_INTERACTION, published.
  J4  THE STORY LANE ASKS THE MATCHING FAMILY. Route A for REJECT rows; B/C/D + the BRK15
      variant for BREAK rows. A REFUSAL OF THE WRONG FAMILY IS NOT A REFUSAL - which is the
      defect that produced my 03-31 and 04-06 story readings.
  J5  The location lane uses the selected zone's LINE for now, and carries DISTANCE-TO-BAND on
      every row, so when the operator answers line-vs-band his answer applies by arithmetic
      instead of by a re-run.
  J6  CONTROLS IN BOTH DIRECTIONS: 04-14 under RESISTANCE (a break-long) is the positive
      control for coverage; 03-24 is the negative. IF 04-14'S REAL LEVEL IS NOT COVERED, THIS
      LANE HAS NO POSITIVE CONTROL AND SAYS SO - it does not promote another row into the job.

WHAT THIS SUPERSEDES. My earlier location/story/M2/M2b conclusions for 03-30, 03-31 and 04-14
were measured against a zone chosen by `{LONG: SUPPORT, SHORT: RESISTANCE}` - an unstated
assumption that every entry is a rejection, which deletes half the taught strategy. 03-24 and
04-06 happened to select the correct zone and their M2 TIMING result is unaffected.

Run: PYTHONPATH=. python -m research.run_j16_unified_session_resolution
"""
from __future__ import annotations

import io
import json
import time
from datetime import date
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_exam_window as W
from research import run_refusal_diagnosis_lost_four as D
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC. Resolves each session under the ALGO-066 J1-J6 join. Repairs nothing, selects "
    "no rule, tunes no parameter."
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
OUT = Path("research/current_mnq_strategy_v2_4_j16_unified_resolution_2026_08_23.json")

FROZEN_STOP = 17.25
POSITIVE_CONTROL = "2026-04-14"
NEGATIVE_CONTROL = "2026-03-24"
ALL_SESSIONS = ["2026-03-24", "2026-03-30", "2026-03-31", "2026-04-06", POSITIVE_CONTROL]

REJECT, BREAK = "REJECT", "BREAK"
UNCLASSIFIED = "UNCLASSIFIED_INTERACTION"
AMBIGUOUS = "AMBIGUOUS_ZONE_SELECTION"

ROUTE_A = "A_NORMAL_REJECTION"
BREAK_FAMILY = ("B_NORMAL_BREAKOUT", "C_PREBREAK_DISPLACEMENT", "D_PREBREAK_RETEST_BREAKOUT")


def _line(z) -> float:
    return (float(z["lo"]) + float(z["hi"])) / 2


def select_zone(zones: list, bar) -> dict:
    """J1. Geometry at his entry clock, over BOTH zones. Ambiguity is published, not resolved."""
    lo, hi = float(bar.low), float(bar.high)
    scored = []
    for z in zones:
        ln = _line(z)
        inside = lo <= ln <= hi
        dist = 0.0 if inside else min(abs(lo - ln), abs(hi - ln))
        scored.append({"zone": z, "line": ln, "role": str(z["role"]),
                       "inside_entry_bar": inside, "distance_points": round(dist, 2)})
    inside = [s for s in scored if s["inside_entry_bar"]]
    close = [s for s in scored if s["distance_points"] <= FROZEN_STOP]

    if len(inside) == 1:
        pick, basis, ambiguous = inside[0], "inside the entry bar", False
    elif len(inside) > 1:
        pick, basis, ambiguous = None, "BOTH zones inside the entry bar", True
    elif len(close) > 1:
        pick, basis, ambiguous = None, f"BOTH zones within the frozen {FROZEN_STOP}", True
    else:
        pick = min(scored, key=lambda s: s["distance_points"])
        basis, ambiguous = "nearest (neither inside the entry bar)", False
    return {"candidates": scored, "selected": pick, "selection_basis": basis,
            "ambiguous": ambiguous}


def interaction_of(role: str, direction: str) -> str:
    """J3. Mechanical, from role x direction. No preference, and a residual that publishes."""
    if direction == "L" and role == "SUPPORT":
        return REJECT
    if direction == "S" and role == "RESISTANCE":
        return REJECT
    if direction == "L" and role == "RESISTANCE":
        return BREAK
    if direction == "S" and role == "SUPPORT":
        return BREAK
    return UNCLASSIFIED


def _vs_line(bar, line: float, role: str) -> dict:
    o, h, l, c = float(bar.open), float(bar.high), float(bar.low), float(bar.close)
    if role == "SUPPORT":
        pen, away = max(0.0, line - l), c - line
    else:
        pen, away = max(0.0, h - line), line - c
    return {"ohlc": [round(o, 2), round(h, 2), round(l, 2), round(c, 2)],
            "touched_the_line": bool(l <= line <= h),
            "penetration_points": round(pen, 2),
            "close_away_points": round(away, 2),
            "closed_on_the_wrong_side": bool(away < 0),
            "body_frac": round(abs(c - o) / (h - l), 3) if h > l else None}


def _coverage(env, dte, anchor, line: float, p) -> dict:
    """J5. Coverage of his LINE, with distance-to-band so a band answer applies by arithmetic."""
    locations, _ = build_entry_locations_v24(env, dte, anchor, p)
    covering = [x for x in locations if float(x.lo) <= line <= float(x.hi)]
    nearest, gap = None, None
    for x in locations:
        g = 0.0 if float(x.lo) <= line <= float(x.hi) else min(
            abs(float(x.lo) - line), abs(line - float(x.hi)))
        if gap is None or g < gap:
            nearest, gap = x, g
    return {
        "anchor": anchor.isoformat(),
        "locations_built": len(locations),
        "covering_his_line": len(covering),
        "covering_and_authorized": sum(1 for x in covering if x.entry_authorized),
        "nearest_band": None if nearest is None else {
            "lo": round(float(nearest.lo), 2), "hi": round(float(nearest.hi), 2),
            "source": str(nearest.source), "entry_authorized": bool(nearest.entry_authorized)},
        "gap_points_line_to_nearest_band": None if gap is None else round(gap, 2),
        "band_width_that_would_reach": None if gap is None else round(gap, 2),
    }


def main() -> int:
    t0 = time.perf_counter()
    labels, traders = D._raw_labels(), D._trader_entries()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(W.BASELINE_ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = v24.Params()
        h15, full5, piv = env["h15"], env["full5"], env["piv15"]

        for session in ALL_SESSIONS:
            tr, lab = traders.get(session, {}), labels.get(session, {})
            direction = {"ENTER_LONG": "L", "ENTER_SHORT": "S"}.get(tr.get("final_action"))
            zones = lab.get("trader_zones") or []
            entry = pd.Timestamp(tr["first_entry_time"]) if tr.get("first_entry_time") else None
            if not (direction and zones and entry is not None):
                rows.append({"session": session, "note": "missing direction/zones/entry"})
                continue

            tf = str((zones[0] or {}).get("marked_main_timeframe") or "5m")
            bars = h15 if tf.startswith("15") else full5
            at_entry = bars[bars.index <= entry]
            entry_bar = at_entry.iloc[-1]

            sel = select_zone(zones, entry_bar)
            picked = sel["selected"]
            if picked is None:
                rows.append({"session": session, "J1_selection": sel,
                             "interaction": AMBIGUOUS,
                             "note": "ambiguity published; no zone picked (J1)"})
                continue

            line, role = picked["line"], picked["role"]
            inter = interaction_of(role, direction)
            marked = pd.Timestamp(picked["zone"]["marked_time"])
            dte = pd.Timestamp(session).date()

            # ---- J4: ask the MATCHING family at his clock on the selected zone --------------
            recs = xray_session(env, date.fromisoformat(session), p)["records"]
            b0 = entry.floor("5min")
            want = {b0 - pd.Timedelta(minutes=5), b0}
            at_clock = [r for r in recs
                        if r.get("bucket") is not None and pd.Timestamp(r["bucket"]) in want
                        and r.get("direction") == direction
                        and r.get("location_lo") is not None
                        and float(r["location_lo"]) <= line <= float(r["location_hi"])]

            def family_of(r):
                rt = str(r.get("route") or "")
                if rt == ROUTE_A:
                    return REJECT
                if rt in BREAK_FAMILY or rt == "B_C_D_BREAKOUT_FAMILY" or r.get("variant"):
                    return BREAK
                return None

            matching = [r for r in at_clock if family_of(r) == inter]
            wrong_family = [r for r in at_clock if family_of(r) not in (inter, None)]

            def census(rs):
                out = {}
                for r in rs:
                    k = r.get("killed_at") or "SURVIVED_TO_RANKING"
                    out[k] = out.get(k, 0) + 1
                return out

            story = ("NO_CANDIDATE_OF_THE_MATCHING_FAMILY" if not matching
                     else ("GRANTED" if any(r.get("outcome") == "SURVIVED_TO_RANKING"
                                            for r in matching)
                           else "REFUSED"))

            # ---- M2: pivots --------------------------------------------------------------
            side = "S" if role == "SUPPORT" else "R"
            asof = pd.Timestamp(f"{session} 09:30", tz=marked.tz)
            causal = piv[(piv.confirm <= asof) & (piv.side == side)]
            near_causal = (causal.iloc[(causal.price - line).abs().argsort()[:1]].iloc[0]
                           if not causal.empty else None)
            any_side = piv[(piv.side == side) & ((piv.price - line).abs() <= 5.0)]
            at_price = (any_side.iloc[(any_side.confirm - marked).abs().argsort()[:1]].iloc[0]
                        if not any_side.empty else None)

            rows.append({
                "session": session,
                "role_in_lane": ("POSITIVE_CONTROL" if session == POSITIVE_CONTROL else
                                 "NEGATIVE_CONTROL" if session == NEGATIVE_CONTROL else
                                 "subject"),
                "trader_final_action": tr.get("final_action"),
                "his_direction": direction,
                "J1_selection": sel,
                "J2_selected_role": role,
                "J2_selected_line": line,
                "J3_interaction": inter,
                "his_marked_timeframe": tf,
                "marked_time": str(marked),
                "entry_time": str(entry),

                "J5_coverage_at_0930": _coverage(env, dte, asof, line, p),
                "J5_coverage_at_marked_time": _coverage(env, dte, marked, line, p),

                "M2_nearest_causal_pivot": None if near_causal is None else {
                    "price": float(near_causal.price),
                    "distance_points": round(abs(float(near_causal.price) - line), 2),
                    "confirm": str(near_causal.confirm),
                    "wick": round(float(near_causal.wick), 3),
                    "disp": round(float(near_causal.disp), 3)},
                "M2_pivot_at_his_price": None if at_price is None else {
                    "price": float(at_price.price),
                    "distance_points": round(abs(float(at_price.price) - line), 2),
                    "confirm": str(at_price.confirm),
                    "confirm_minus_marked_minutes": round(
                        (pd.Timestamp(at_price.confirm) - marked).total_seconds() / 60, 1),
                    "confirmed_before_he_marked": bool(
                        pd.Timestamp(at_price.confirm) <= marked),
                    "wick": round(float(at_price.wick), 3),
                    "disp": round(float(at_price.disp), 3)},

                "M2b_at_marked_time": _vs_line(
                    bars[bars.index <= marked].iloc[-1], line, role),
                "M2b_at_entry_clock": _vs_line(entry_bar, line, role),

                "J4_story_verdict": story,
                "J4_matching_family_candidates": len(matching),
                "J4_wrong_family_candidates_NOT_a_refusal": len(wrong_family),
                "J4_gate_census_matching_family": census(matching),
                "J4_subreasons": dict(sorted(D._subreasons(matching).items(),
                                             key=lambda kv: -kv[1])[:8]),
                "J4_routes_asked": sorted({rt for r in matching
                                           for rt in (r.get("routes_asked") or ())}),
            })

    pos = next((r for r in rows if r.get("role_in_lane") == "POSITIVE_CONTROL"), None)
    covered = bool(pos and pos.get("J5_coverage_at_0930", {}).get("covering_and_authorized"))

    out = {
        "artifact": "J16_UNIFIED_SESSION_RESOLUTION",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-066 J1-J6",
        "produced": "2026-08-23",
        "supersedes": ("my location/story/M2/M2b conclusions for 2026-03-30, 2026-03-31 and "
                       "2026-04-14, which selected the zone by an unstated assumption that "
                       "every entry is a rejection"),
        "J6_positive_control": {
            "session": POSITIVE_CONTROL,
            "its_level_is_covered_and_authorized_at_0930": covered,
            "verdict": ("the coverage lane HAS a positive control" if covered else
                        "THE COVERAGE LANE HAS NO POSITIVE CONTROL - the positive control's own "
                        "level is not covered. No other row is promoted into the job (J6)."),
        },
        "rows": rows,
        "runtime_seconds": round(time.perf_counter() - t0, 2),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    for r in rows:
        if "J3_interaction" not in r:
            print(f"\n{r['session']}: {r.get('note')}")
            continue
        print(f"\n[{r['role_in_lane']}] {r['session']}  {r['trader_final_action']}")
        print(f"    selected {r['J2_selected_role']} {r['J2_selected_line']} "
              f"({r['J1_selection']['selection_basis']})  -> {r['J3_interaction']}")
        c = r["J5_coverage_at_0930"]
        print(f"    coverage @09:30 : {c['covering_and_authorized']} authorized covering, "
              f"gap {c['gap_points_line_to_nearest_band']} pts")
        pv = r["M2_pivot_at_his_price"]
        if pv:
            print(f"    pivot at price  : {pv['distance_points']} pts, confirm "
                  f"{pv['confirm_minus_marked_minutes']:+.1f} min, wick {pv['wick']} "
                  f"disp {pv['disp']}")
        print(f"    story ({r['J3_interaction']} family): {r['J4_story_verdict']}  "
              f"matching={r['J4_matching_family_candidates']} "
              f"wrong_family={r['J4_wrong_family_candidates_NOT_a_refusal']}")
        if r["J4_subreasons"]:
            print(f"      sub-reasons: {list(r['J4_subreasons'].items())[:3]}")
    print(f"\n{out['J6_positive_control']['verdict']}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
