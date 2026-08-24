#!/usr/bin/env python3
"""L2 - DOES A STRUCTURAL SPENT-ZONE PREDICATE SEPARATE THE WINNER FROM HIS TP? DIAGNOSTIC ONLY.

ALGO-078 lane 2. Nearest-first is NOT repealed. The lawful selection repair corrects the
UNIVERSE: a zone whose reaction ALREADY HAPPENED is not a destination - ALGO-051's re-anchor
mechanic, where the first level's move is spent and the target moves on to the next key zone.

THE SKIP CRITERION MUST BE STRUCTURAL AND NEVER REWARD-SHAPED. So the predicate tested here
reads only price-vs-band geometry before his entry, and never distance, reward, or which answer
it produces:

    SPENT  :=  a COMPLETED bar strictly before his entry has already traded INTO the band

That is the whole predicate. "First meaningful reaction" is a claim about a reaction that has
not happened yet; once price has been in the band, the reaction that destination represents is
behind us.

WHAT WOULD FALSIFY THE REPAIR. If the machine's chosen destination is NOT spent, or if HIS
marked TP zone IS spent, then this predicate does not separate them and it is not the repair -
reported as NO_SEPARATION rather than softened. 04-14 is the control: it has no marked TP in his
direction, so it constrains only the winner side, and that limit is stated rather than papered
over.

NOTHING IS REPAIRED AND NO NUMBER MOVES. This lane reports whether a predicate WOULD separate.
"""
from __future__ import annotations

import io
import json
import time
from datetime import date, time as _time
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W
from research import current_mnq_strategy_v2_4_targets as base
from research import current_mnq_strategy_v2_4_target_policy as pol

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Tests a structural spent-zone predicate. Repairs nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_l2_spent_zone_separation_2026_08_24.json")

SESSIONS = ("2026-03-24", "2026-03-30", "2026-03-31", "2026-04-14")
CONTROL = "2026-04-14"
ARM_NAME, ARM_START = "taught_0800", _time(8, 0)

PREDICATE = ("SPENT := a COMPLETED bar strictly before his entry has already traded INTO the "
             "band (bar range overlaps [lo, hi]). Structural only - reads no distance, no "
             "reward, and no outcome.")


def _labels():
    man = {c["case_id"]: c["session"]
           for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def _his_tp(label):
    act = str(label.get("final_action") or "")
    if act == "ENTER_LONG":
        return label.get("trader_tp_long"), act
    if act == "ENTER_SHORT":
        return label.get("trader_tp_short"), act
    return None, act


def _spent(full5, lo, hi, before_ts, session_open):
    """Has a completed bar strictly before `before_ts` traded into [lo, hi] this session?"""
    win = full5[(full5.index >= session_open) & (full5.index < before_ts)]
    hits = []
    for t, r in win.iterrows():
        if float(r.low) <= hi and float(r.high) >= lo:
            hits.append({"bucket": str(t), "ohlc": [float(r.open), float(r.high),
                                                    float(r.low), float(r.close)]})
    return hits


def main() -> int:
    t0 = time.perf_counter()
    manifest = {c["session"]: c for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    labels = _labels()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = eng.Params()
        full5, one = env["full5"], env["one"]

        for session in SESSIONS:
            dte = date.fromisoformat(session)
            label = labels[session]
            tp, action = _his_tp(label)
            direction = "L" if action == "ENTER_LONG" else "S"
            his_clock = pd.Timestamp(label["first_entry_time"])
            b = one[one.index <= his_clock]
            entry_px = float(b.iloc[-1].open)
            session_open = pd.Timestamp(f"{dte} 08:00", tz=eng.core.TZ)

            dests = base.build_reaction_destinations(
                env["piv5"], full5, env["h15"], his_clock, p, {}, {},
                dte, entry_px, direction, piv15=env["piv15"])
            picked, path_reason = pol.classify_first_reaction_destination(
                dests, entry_px, direction, "BRK5", p, False)

            winner = None
            if picked is not None:
                wlo, whi = float(picked.location.lo), float(picked.location.hi)
                hits = _spent(full5, wlo, whi, his_clock, session_open)
                winner = {
                    "band": [wlo, whi],
                    "kind": str(getattr(picked, "kind", "")),
                    "source_map": str(picked.location.source),
                    "target_executable": round(float(picked.executable_price), 2),
                    "distance_points": round(float(picked.distance), 2),
                    "SPENT": bool(hits),
                    "bars_already_in_the_band": hits[:6],
                    "bars_already_in_the_band_count": len(hits),
                }

            his_tp_zone = None
            if tp:
                tp_px = float(tp["lo"])
                # His TP is recorded as an exact level; test the band the machine WOULD need to
                # hold it - the considered destination containing it, else a one-tick window so
                # the predicate is asked of a real interval and not a zero-width point.
                holder = next((d for d in dests
                               if float(d.location.lo) <= tp_px <= float(d.location.hi)), None)
                zlo, zhi = ((float(holder.location.lo), float(holder.location.hi)) if holder
                            else (tp_px - float(eng.core.TICK), tp_px + float(eng.core.TICK)))
                hits = _spent(full5, zlo, zhi, his_clock, session_open)
                his_tp_zone = {
                    "tp_price": tp_px,
                    "band_tested": [zlo, zhi],
                    "band_source": ("a considered destination containing it" if holder
                                    else "one tick either side (his TP is in no destination)"),
                    "SPENT": bool(hits),
                    "bars_already_in_the_band": hits[:6],
                    "bars_already_in_the_band_count": len(hits),
                }

            if winner is None or his_tp_zone is None:
                sep = None
                note = ("no marked TP in his direction - constrains the winner side only"
                        if his_tp_zone is None else "no destination chosen")
            else:
                sep = bool(winner["SPENT"] and not his_tp_zone["SPENT"])
                note = ("the predicate separates: the winner is spent and his TP zone is fresh"
                        if sep else
                        "NO SEPARATION - " + ("the winner is not spent"
                                              if not winner["SPENT"]
                                              else "his own TP zone is also spent"))
            rows.append({
                "session": session,
                "is_control": session == CONTROL,
                "his_action": action,
                "his_entry_clock": str(his_clock),
                "his_entry_price": entry_px,
                "machine_winner": winner,
                "his_tp_zone": his_tp_zone,
                "PREDICATE_SEPARATES": sep,
                "note": note,
                "path_reason": str(path_reason),
            })

    testable = [r for r in rows if r["PREDICATE_SEPARATES"] is not None]
    separates = [r for r in testable if r["PREDICATE_SEPARATES"]]
    verdict = ("SPENT_PREDICATE_SEPARATES_ON_ALL_TESTABLE_SESSIONS"
               if testable and len(separates) == len(testable)
               else "NO_SEPARATION" if testable else "UNTESTABLE")

    out = {
        "artifact": "L2_SPENT_ZONE_SEPARATION",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-078 lane 2",
        "produced": "2026-08-24",
        "arm": ARM_NAME,
        "predicate_under_test": PREDICATE,
        "nearest_first_is_not_repealed": (
            "This lane changes no ordering. It asks only whether a structurally SPENT zone can "
            "be removed from the UNIVERSE before nearest-first is applied."),
        "control_session": CONTROL,
        "control_limitation": (
            "04-14 has no marked TP in his direction, so it constrains the winner side only and "
            "cannot confirm or refute separation."),
        "rows": rows,
        "testable_sessions": [r["session"] for r in testable],
        "sessions_where_it_separates": [r["session"] for r in separates],
        "VERDICT": verdict,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== L2 SPENT-ZONE SEPARATION ===")
    print(f"predicate: {PREDICATE}\n")
    for r in rows:
        tag = " [CONTROL]" if r["is_control"] else ""
        w, h = r["machine_winner"], r["his_tp_zone"]
        print(f"{r['session']}{tag}  separates={r['PREDICATE_SEPARATES']}")
        if w:
            print(f"   winner  {w['band']} {w['kind']:<40} SPENT={w['SPENT']} "
                  f"({w['bars_already_in_the_band_count']} bars in band before his entry)")
        if h:
            print(f"   his TP  {h['tp_price']} band={[round(x,2) for x in h['band_tested']]} "
                  f"SPENT={h['SPENT']} ({h['bars_already_in_the_band_count']} bars)")
            print(f"           band source: {h['band_source']}")
        print(f"   {r['note']}")
    print(f"\nVERDICT: {verdict}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
