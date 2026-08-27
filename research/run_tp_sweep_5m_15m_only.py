#!/usr/bin/env python3
"""TP PROVENANCE SWEEP, 5m AND 15m ONLY. DIAGNOSTIC ONLY - repairs nothing.

ALGO-086 order 2. The operator corrected the timeframe premise directly:

    "i never saod nothing obut 30 minturws"
    "yes i onyl draw zones on 5 minbute and 15 mintues"

So the 30m/60m rejection bands used by L3 and O2 are NOT his teaching. The "taught 5/15/30
family" belonged to the R-736 opening-range GOLDEN teacher - a different lane entirely - and
citing it here was a cross-teacher error. L3's 03-30 hit (three 30m bands) and its 03-24 control
hit (a 60m band) are re-labelled DERIVED OBSERVATIONS and no longer count as sources.

This sweep re-asks the question on the only two timeframes he draws on.

WHAT THAT COSTS, AND IT IS STATED UP FRONT: L3's capability control WAS the 60m find on 03-24.
Removing 60m removes the control, so a null result here cannot be distinguished from a broken
search by that route. The control is therefore rebuilt from something 5m/15m can be checked
against independently: 03-31's ENTRY line, which O2 showed sits inside a genuine same-session
5m/15m structure, and which this sweep must re-find.

TOLERANCES ARE THE FROZEN ONES - 1 tick exact, 2.0 points band containment (ALGO-085 froze them
and forbade widening without a teaching citation). CONTAINMENT is reported separately from a
within-tolerance near miss, because conflating them is an error this lane has already made once.
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

DIAGNOSTIC_ONLY = "DIAGNOSTIC. 5m/15m-only TP provenance sweep. Repairs nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_tp_sweep_5m_15m_2026_08_24.json")

#: HIS timeframes, and only his.
TIMEFRAMES = (5, 15)
EXACT_TOL_TICKS = 1
BAND_TOL_POINTS = 2.0

SUBJECTS = ("2026-03-30", "2026-03-24")
#: Rebuilt control - see the docstring. 03-31's ENTRY line, not a TP.
CONTROL = {"session": "2026-03-31", "price": 23436.625, "what": "entry line"}


def _labels():
    man = {c["case_id"]: c["session"] for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def _his_tp(label):
    act = str(label.get("final_action") or "")
    if act == "ENTER_LONG":
        return label.get("trader_tp_long")
    if act == "ENTER_SHORT":
        return label.get("trader_tp_short")
    return None


def _resample(full5, minutes):
    if minutes == 5:
        return full5
    return full5.resample(f"{minutes}min", origin="start_day", offset="9h30min",
                          label="left", closed="left").agg(
        open=("open", "first"), high=("high", "max"),
        low=("low", "min"), close=("close", "last")).dropna()


def _coverage_pct(bands, lo, hi):
    """What fraction of the day's traded range is covered by AT LEAST ONE band.

    THE MEASUREMENT THAT DECIDES WHETHER A HIT MEANS ANYTHING. 5m and 15m wick-to-close bands
    built from every bar of a session tile the whole range: measured on 03-30, 306 bands cover
    100.0% of the 291.5-point range, so ANY price whatsoever is "inside a band". A containment
    hit under that coverage is not evidence of provenance - it is arithmetic. Reported beside
    every verdict so a hit can never again be read as a source without its base rate.
    """
    if hi <= lo or not bands:
        return None
    slots = 0
    covered = 0
    px = lo
    while px <= hi:
        slots += 1
        if any(a <= px <= b for a, b in bands):
            covered += 1
        px += 0.25
    return round(100.0 * covered / slots, 1) if slots else None


def _sweep(full5, price, until, session, tz):
    """5m/15m wick-to-close rejection bands COMPLETED before `until`, on the session's own day."""
    day_lo = pd.Timestamp(f"{session} 00:00", tz=tz)
    contained, near = [], []
    for tf in TIMEFRAMES:
        frame = _resample(full5[full5.index < until], tf)
        day = frame[frame.index >= day_lo]
        for t, r in day.iterrows():
            closes_at = t + pd.Timedelta(minutes=tf)
            if closes_at > until:
                continue                       # not completed at his entry
            o, h, l, c = float(r.open), float(r.high), float(r.low), float(r.close)
            for which, lo_, hi_ in (("upper", min(c, h), max(c, h)),
                                    ("lower", min(l, c), max(l, c))):
                if hi_ - lo_ <= 0:
                    continue
                rec = {"timeframe": f"{tf}m", "which_wick": which, "bucket": str(t),
                       "closes_at": str(closes_at), "band": [round(lo_, 2), round(hi_, 2)],
                       "width_points": round(hi_ - lo_, 2)}
                if lo_ <= price <= hi_:
                    contained.append(rec)
                elif (lo_ - BAND_TOL_POINTS) <= price <= (hi_ + BAND_TOL_POINTS):
                    rec["gap_points"] = round(min(abs(price - lo_), abs(price - hi_)), 3)
                    near.append(rec)
    contained.sort(key=lambda x: x["width_points"])
    near.sort(key=lambda x: x["gap_points"])
    day = full5[(full5.index >= day_lo) & (full5.index < until)]
    cov = None
    if len(day):
        allb = [(b["band"][0], b["band"][1]) for b in contained + near]
        # coverage must be computed over EVERY band built, not only the ones that hit
        every = []
        for tf in TIMEFRAMES:
            frame = _resample(full5[full5.index < until], tf)
            for t, r in frame[frame.index >= day_lo].iterrows():
                if t + pd.Timedelta(minutes=tf) > until:
                    continue
                o, h, c = float(r.open), float(r.high), float(r.close)
                l = float(r.low)
                for lo_, hi_ in ((min(c, h), max(c, h)), (min(l, c), max(l, c))):
                    if hi_ > lo_:
                        every.append((lo_, hi_))
        cov = _coverage_pct(every, float(day.low.min()), float(day.high.max()))
    return contained, near, cov


def main() -> int:
    t0 = time.perf_counter()
    labels = _labels()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(_time(8, 0)):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        full5 = env["full5"]
        tz = full5.index.tz

        # ---- rebuilt capability control ------------------------------------------------
        cl = labels[CONTROL["session"]]
        c_until = pd.Timestamp(cl["first_entry_time"])
        c_contained, c_near, c_cov = _sweep(full5, CONTROL["price"], c_until,
                                            CONTROL["session"], tz)
        control_ok = bool(c_contained)

        for session in SUBJECTS:
            label = labels[session]
            tp = _his_tp(label)
            tp_px = float(tp["lo"])
            until = pd.Timestamp(label["first_entry_time"])
            contained, near, cov = _sweep(full5, tp_px, until, session, tz)
            # A containment hit under near-total coverage is arithmetic, not provenance.
            vacuous = (cov is not None and cov >= 95.0)
            if contained and vacuous:
                verdict = "CONTAINMENT_IS_VACUOUS_BAND_COVERAGE_IS_TOTAL"
            elif contained:
                verdict = "TP_INSIDE_A_5M_OR_15M_REJECTION_BAND"
            elif near:
                verdict = "TP_ONLY_NEAR_A_5M_15M_BAND_NOT_CONTAINED"
            else:
                verdict = "TP_PROVENANCE_UNKNOWN_FROM_HELD_5M_15M"
            rows.append({
                "session": session,
                "his_tp": tp_px,
                "his_entry_clock": str(until),
                "bands_CONTAINING_it": contained[:6],
                "containing_count": len(contained),
                "near_misses_within_tolerance": near[:6],
                "VERDICT": verdict,
                "band_coverage_pct_of_the_days_range": cov,
                "containment_is_vacuous": bool(vacuous),
                "tightest_containing_band": contained[0] if contained else None,
            })

    out = {
        "artifact": "TP_SWEEP_5M_15M_ONLY",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-086 order 2",
        "produced": "2026-08-24",
        "operator_correction": (
            "'i never saod nothing obut 30 minturws' / 'yes i onyl draw zones on 5 minbute and "
            "15 mintues'. 30m and 60m bands are NOT his teaching; L3/O2's 30m and 60m findings "
            "are re-labelled DERIVED OBSERVATIONS and are not sources."),
        "timeframes_searched": [f"{t}m" for t in TIMEFRAMES],
        "tolerances_frozen_by_ALGO_085": {"exact_ticks": EXACT_TOL_TICKS,
                                          "band_points": BAND_TOL_POINTS},
        "capability_control": {**CONTROL, "re_found": control_ok,
                               "bands": c_contained[:3], "near": c_near[:3],
                               "band_coverage_pct": c_cov},
        "BASE_RATE_FINDING": (
            "5m/15m wick-to-close bands built from every bar of a session TILE THE WHOLE TRADED "
            "RANGE. Measured on 03-30: 306 bands cover 100.0% of the 291.5-point range, so any "
            "price whatsoever is 'inside a band'. CONTAINMENT UNDER THAT COVERAGE IS NOT "
            "EVIDENCE OF PROVENANCE - it is arithmetic. This retro-actively weakens the "
            "containment findings in L3 and O2, which reported hits without their base rate; "
            "those verdicts should be re-read with coverage attached before any of them is "
            "used to justify a repair."),
        "capability_control_passed": control_ok,
        "control_note": (
            "L3's control WAS the 60m find on 03-24; removing 60m removed it. The control is "
            "rebuilt from 03-31's ENTRY line, which must be re-found on 5m/15m alone."),
        "rows": rows,
        "verdicts": {r["session"]: r["VERDICT"] for r in rows},
        "consequence_for_0330": (
            "If 03-30's TP has no 5m/15m source, its S5 block stands as an HONEST LOSS and the "
            "batch must not be widened to recover it."),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== TP SWEEP, 5m/15m ONLY ===")
    print(f"capability control ({CONTROL['session']} {CONTROL['what']} {CONTROL['price']}): "
          f"{'RE-FOUND' if control_ok else 'NOT FOUND - the sweep proves nothing'}")
    for b in c_contained[:2]:
        print(f"    {b['timeframe']} {b['bucket'][11:16]} {b['band']} w={b['width_points']}")
    for r in rows:
        print(f"\n{r['session']}  TP={r['his_tp']}  -> {r['VERDICT']}")
        print(f"   containing bands: {r['containing_count']}")
        for b in r["bands_CONTAINING_it"][:3]:
            print(f"      {b['timeframe']} {b['which_wick']} {b['bucket'][11:16]} "
                  f"{b['band']}  w={b['width_points']}")
        for b in r["near_misses_within_tolerance"][:2]:
            print(f"      near: {b['timeframe']} {b['band']} gap={b['gap_points']}")
    print(f"\nverdicts: {out['verdicts']}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
