#!/usr/bin/env python3
"""Z1 - CAN HIS OWN CONSTRUCTION SUPPLY AN ENTRY UNIVERSE? REPORT ONLY, no predicate, no landing.

ALGO-092 order 2. The entry-zone census showed four of seven machine zones are not drawable
under his ratified [wick extreme, close] rule at all. Z1 asks the converse: if the universe were
built HIS way instead - every COMPLETED 5m and 15m rejection candle turned into a band with a
role - would that universe support the trades in question?

  (i)   the CONTROL's 04-14 trade at its fire clock. PRE-REGISTERED: it MUST, else Z1 is closed
        as a replacement for the machine's construction.
  (ii)  each of the five convicted early trades - existence and that zone's test count PRINTED,
        never scored.
  (iii) his eight entries at DAY GRAIN only (label forensics stay closed under ALGO-083).

ALGO-093's operator directive frames this correctly and it is worth repeating inside the module:
the goal is equivalence of TRADES at day grain, NOT equivalence of drawings. So a negative
result here is NOT a blocker and is NOT a reason to force the universe his way. It is context.

"SUPPORTS" IS DEFINED BEFORE THE RUN, and deliberately generously: a his-rule zone supports a
trade if the fill price at the fire clock lies inside the band, or within one stop-width of it,
and the zone's role is consistent with the direction traded (RESISTANCE for a short or an upward
break, SUPPORT for a long or a downward break). A generous definition means a NEGATIVE result is
strong: if even this cannot find a supporting zone, a stricter one certainly could not.

NO PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
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
from research.run_entry_zone_census import completed_tests

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Z1 feasibility. No predicate, no landing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_z1_his_rule_universe_2026_08_24.json")

ARM_START = _time(8, 0)
CONTROL = {"session": "2026-04-14", "clock": "09:38", "direction": "L"}
CONVICTED = (("2026-03-23", "08:14", "S"), ("2026-03-24", "08:17", "S"),
             ("2026-03-31", "09:03", "L"), ("2026-04-06", "09:07", "S"),
             ("2026-04-09", "09:37", "L"))
TIMEFRAMES = (5, 15)
#: The frozen stop, used only as a generous proximity allowance - never as a threshold on
#: anything the predicate decides, because Z1 decides nothing.
PROXIMITY_POINTS = 17.25


def _labels():
    man = {c["case_id"]: c["session"] for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def _resample(full5, minutes):
    if minutes == 5:
        return full5
    return full5.resample(f"{minutes}min", origin="start_day", offset="9h30min",
                          label="left", closed="left").agg(
        open=("open", "first"), high=("high", "max"),
        low=("low", "min"), close=("close", "last")).dropna()


def his_rule_universe(full5, session, until, tz):
    """Every COMPLETED 5m/15m rejection candle as a [wick extreme, close] band with a role."""
    day_lo = pd.Timestamp(f"{session} 00:00", tz=tz)
    zones = []
    for tf in TIMEFRAMES:
        frame = _resample(full5[full5.index < until], tf)
        for t, r in frame[frame.index >= day_lo].iterrows():
            closes_at = t + pd.Timedelta(minutes=tf)
            if closes_at > until:
                continue
            h, l, c = float(r.high), float(r.low), float(r.close)
            # upper wick -> price was pushed DOWN from above: RESISTANCE
            if h > c:
                zones.append({"timeframe": f"{tf}m", "bucket": str(t), "role": "RESISTANCE",
                              "band": [round(c, 2), round(h, 2)],
                              "width": round(h - c, 2), "born": str(closes_at)})
            # lower wick -> price was pushed UP from below: SUPPORT
            if c > l:
                zones.append({"timeframe": f"{tf}m", "bucket": str(t), "role": "SUPPORT",
                              "band": [round(l, 2), round(c, 2)],
                              "width": round(c - l, 2), "born": str(closes_at)})
    return zones


def _supports(zones, price, direction):
    """Generous: price inside the band, or within one stop-width, with a consistent role."""
    want = "RESISTANCE" if direction == "S" else "SUPPORT"
    hits = []
    for z in zones:
        lo, hi = z["band"]
        inside = lo <= price <= hi
        near = (abs(price - lo) <= PROXIMITY_POINTS or abs(price - hi) <= PROXIMITY_POINTS)
        if (inside or near) and z["role"] == want:
            hits.append({**z, "inside": inside,
                         "distance": 0.0 if inside else round(
                             min(abs(price - lo), abs(price - hi)), 2)})
    hits.sort(key=lambda x: (not x["inside"], x["distance"], x["width"]))
    return hits


def main() -> int:
    t0 = time.perf_counter()
    man = {c["session"]: c for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    labels = _labels()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        full5, one = env["full5"], env["one"]
        tz = full5.index.tz

        def probe(tag, session, clock, direction):
            fire = pd.Timestamp(f"{session} {clock}", tz=tz)
            b = one[one.index <= fire]
            if not len(b):
                return {"row": tag, "session": session, "clock": clock, "ERROR": "no 1m bar"}
            price = float(b.iloc[-1].open)
            zones = his_rule_universe(full5, session, fire, tz)
            hits = _supports(zones, price, direction)
            best = hits[0] if hits else None
            tests = None
            if best:
                tests = len(completed_tests(full5, best["band"][0], best["band"][1],
                                            pd.Timestamp(best["born"]), fire))
            return {
                "row": tag, "session": session, "clock": clock, "direction": direction,
                "fill_price": price,
                "his_rule_zones_available": len(zones),
                "supporting_zone_exists": bool(hits),
                "supporting_zone_count": len(hits),
                "best_supporting_zone": best,
                "best_zone_completed_tests_since_birth": tests,
                "note": "test count PRINTED, not scored",
            }

        rows.append(probe("CONTROL", CONTROL["session"], CONTROL["clock"],
                          CONTROL["direction"]))
        for sess, clock, direction in CONVICTED:
            rows.append(probe("convicted_early", sess, clock, direction))
        for session in sorted(man):
            lab = labels[session]
            clk = lab.get("first_entry_time")
            act = str(lab.get("final_action") or "")
            if not clk or act not in ("ENTER_LONG", "ENTER_SHORT"):
                continue
            rows.append(probe("his_entry_day_grain", session, str(clk)[11:16],
                              "L" if act == "ENTER_LONG" else "S"))

    ctrl = next(r for r in rows if r["row"] == "CONTROL")
    ctrl_ok = bool(ctrl.get("supporting_zone_exists"))
    conv = [r for r in rows if r["row"] == "convicted_early"]
    his = [r for r in rows if r["row"] == "his_entry_day_grain"]

    out = {
        "artifact": "Z1_HIS_RULE_UNIVERSE_FEASIBILITY",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-092 order 2",
        "produced": "2026-08-24",
        "operator_directive": (
            "Equivalence of TRADES at day grain, not equivalence of drawings. A negative result "
            "here is context, NOT a blocker, and not a reason to force the universe his way."),
        "supports_definition": (
            "fill price inside the band, or within one stop-width (17.25 pts) of it, with a "
            "role consistent with the direction. DELIBERATELY GENEROUS so a negative result is "
            "strong."),
        "control": ctrl,
        "control_supported": ctrl_ok,
        "Z1_status": ("FEASIBLE_FOR_THE_CONTROL" if ctrl_ok
                      else "CLOSED_AS_A_REPLACEMENT_CONTROL_UNSUPPORTED"),
        "convicted": conv,
        "convicted_supported": sum(1 for r in conv if r.get("supporting_zone_exists")),
        "his_entries_day_grain": his,
        "his_entries_supported": sum(1 for r in his if r.get("supporting_zone_exists")),
        "no_predicate_proposed": True,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== Z1 HIS-RULE UNIVERSE FEASIBILITY ===")
    for r in rows:
        if "ERROR" in r:
            print(f"   {r['row']:<20} {r['session']} {r['clock']}  ERROR {r['ERROR']}")
            continue
        print(f"   {r['row']:<20} {r['session']} {r['clock']} {r['direction']}  "
              f"zones={r['his_rule_zones_available']:>4}  supported={r['supporting_zone_exists']}"
              f"  n={r['supporting_zone_count']:>3}  tests={r['best_zone_completed_tests_since_birth']}")
    print(f"\ncontrol supported: {ctrl_ok}   -> {out['Z1_status']}")
    print(f"convicted supported: {out['convicted_supported']}/{len(conv)}   "
          f"his entries supported: {out['his_entries_supported']}/{len(his)}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
