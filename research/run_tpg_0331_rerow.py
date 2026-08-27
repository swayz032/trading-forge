#!/usr/bin/env python3
"""THE 2026-03-31 T/P/G RE-ROW UNDER R1+R1b. DIAGNOSTIC ONLY - repairs nothing.

ALGO-074 (1). R1b made his location REACHABLE: the break family now sees the origin-R level it
had stopped being, and 03-31 moved NO_CANDIDATE_OF_THE_MATCHING_FAMILY -> REFUSED (3 matching).
"Refused" is an answer with a predicate behind it, so the row can finally be written.

WHAT THIS ASKS, per the ruling: which TAUGHT form the 3 matching candidates now reach, what
refuses each at its own line, and whether the refusing quantity is TAUGHT or DERIVED. The three
legal recovery forms named in ALGO-069 are accepted-break retest, exception 2 (repeat-test
return attack), and sweep-reclaim. TAUGHT_FORM_ABSENT_FROM_DERIVATION is a legal answer.

THE CONVICTED REV PATH IS NOT AVAILABLE AND IS NOT USED. Nothing here reads
ZONE_REJECTION_STORY_THEN_INTRA5_FORCE; the reach-and-acceptable-side-close defect that
produced the anchor's old 03-31 agreement stays removed.

WHY THIS MODULE LANDS NO REPAIR. The answer below is that the taught form is reached and
refused SOLELY by `acceptance_bars`, an UNFROZEN magnitude. Moving it 3 -> 2 would recover the
case - and that is precisely why this module may not move it. `acceptance_bars` was landed at 3
by the PRE-REGISTERED rule R3 (spec silent => stricter reading wins) over a measured sensitivity,
and its own module says it "may never be selected by looking at outcomes". Selecting it now by
whether it recovers an agreement session is outcome selection wearing a citation. The repair is
the advisor's to rule; this module reports and stops.
"""
from __future__ import annotations

import json
import time
from datetime import date
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_breakout_derivation as brk
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Writes the 03-31 T/P/G row under R1+R1b. Repairs nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
OUT = Path("research/current_mnq_strategy_v2_4_tpg_0331_rerow_2026_08_23.json")

SESSION = "2026-03-31"
HIS_ENTRY_CLOCK = "09:49"
HIS_BUCKET = "09:45"          # the 5m bucket his 09:49 entry falls inside
HIS_DIRECTION = "L"
#: J2's selected line for this session, from the committed J16 artifact. The J5 WICK_ZONE band
#: 23430.71-23441.29 covers it with gap 0.0, which is why that band is the location in question.
HIS_LINE = 23436.625
BARS_FROM, BARS_TO = "09:25", "09:50"   # the ruling asks for 09:35-09:49; context either side

#: Refusal literal -> (which taught requirement it encodes, the quantity it rests on, and
#: whether that quantity is TAUGHT). "Taught" means a spec/transcript names it; a magnitude this
#: repo DERIVED is not taught however defensible the derivation.
PROVENANCE = {
    brk.NOT_ACCEPTED: {
        "encodes": "Route D: the break must be DURABLY ACCEPTED before a retest can count",
        "rests_on": "acceptance_bars = 3 consecutive completed closes beyond",
        "magnitude_is_taught": False,
        "why": ("the spec refuses `break_retest_without_prior_durable_acceptance` and calls the "
                "property DURABLE, but names NO bar count anywhere. 3 is this repo's derivation "
                "of 'durable', recorded as UNFROZEN in breakout_derivation.UNFROZEN_CHOICES."),
    },
    brk.NO_RETEST: {
        "encodes": "Route D: after acceptance, price must RETURN to the broken level",
        "rests_on": "band overlap by any bar after the acceptance run - no magnitude",
        "magnitude_is_taught": True,
        "why": ("the return-to-the-level requirement is taught; the predicate asks only for "
                "overlap with the band and carries no threshold of its own. WHICH bars are "
                "eligible, however, is a function of where the acceptance run ended - so this "
                "refusal can be DOWNSTREAM of the unfrozen acceptance_bars rather than "
                "independent of it, and the sensitivity row below is what separates the two."),
    },
    brk.NO_PRIOR_TEST: {
        "encodes": "Exception 2 (7.10): a REAL prior test that was pushed back",
        "rests_on": "a rejection-wick candle strictly BEFORE the last completed bar",
        "magnitude_is_taught": True,
        "why": ("STRUCTURAL, and it does not bind on a magnitude here: the one candle carrying a "
                "rejection wick is 09:40, the LAST completed bar, which 7.11 excludes because a "
                "test needs room for a reset after it. reject_wick never decides this row."),
    },
    brk.NOT_THE_FOLLOWING_BAR: {
        "encodes": "Route B (7.6/7.7): the trigger is the bar IMMEDIATELY following the print",
        "rests_on": "bar ordering only - no magnitude",
        "magnitude_is_taught": True,
        "why": ("the transcript says 'the FOLLOWING forming 5m'. His 09:45 trigger is three bars "
                "after the 09:30 first print, so Route B refuses on a TAUGHT structure."),
    },
    brk.THIRD_CANDLE_LOST_CONTROL: {
        "encodes": "Route C (7.9): a third candle that reverses control kills the sequence",
        "rests_on": "control direction of the third candle - qualitative",
        "magnitude_is_taught": True,
        "why": "7.9 is taught verbatim and is about direction, not size.",
    },
}


def _geom(r):
    o, h, l, c = float(r.open), float(r.high), float(r.low), float(r.close)
    rng = h - l
    return {
        "open": o, "high": h, "low": l, "close": c,
        "range": round(rng, 2),
        "body_frac": round(abs(c - o) / rng, 4) if rng else 0.0,
        "upper_wick_frac": round((h - max(o, c)) / rng, 4) if rng else 0.0,
        "lower_wick_frac": round((min(o, c) - l) / rng, 4) if rng else 0.0,
        "close_loc_from_high": round((h - c) / rng, 4) if rng else 0.0,
    }


def main() -> int:
    t0 = time.perf_counter()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()
    full5 = env["full5"]
    tz = full5.index.tz

    # ---- the 3 matching candidates R1b made reachable, read from the X-ray -------------------
    # SELECTED BY HIS LINE AND HIS BUCKET, never by position in a sorted list. The first version
    # of this module filtered on "has refusals" and then took sorted(bands)[0], which collected
    # every record in the session and picked the LOWEST band - a different zone 478 points away,
    # which silently changed every number downstream. The location is the one J1/J2 selected:
    # the band that COVERS his line, at the bucket his entry falls in.
    recs = xray_session(env, date.fromisoformat(SESSION), p)["records"]
    matching = [
        r for r in recs
        if r.get("location_lo") is not None
        and float(r["location_lo"]) <= HIS_LINE <= float(r["location_hi"])
        and r.get("direction") == HIS_DIRECTION
        and str(r.get("bucket", ""))[11:16] == HIS_BUCKET
    ]
    if not matching:
        raise SystemExit(f"no candidate covers his line {HIS_LINE} at bucket {HIS_BUCKET}")

    # ---- G: the bars, measured -------------------------------------------------------------
    lo_t = pd.Timestamp(f"{SESSION} {BARS_FROM}", tz=tz)
    hi_t = pd.Timestamp(f"{SESSION} {BARS_TO}", tz=tz)
    win = full5[(full5.index >= lo_t) & (full5.index <= hi_t)]

    bands = sorted({(r["location_lo"], r["location_hi"]) for r in matching})
    if len(bands) != 1:
        raise SystemExit(f"expected ONE covering band at his bucket, got {bands}")
    band_lo, band_hi = bands[0]

    bars = []
    for t, r in win.iterrows():
        g = _geom(r)
        g["bucket"] = str(t)
        g["close_beyond_band_for_a_LONG"] = (
            bool(g["close"] > band_hi) if band_hi is not None else None)
        g["overlaps_band"] = (
            bool(g["low"] <= band_hi and g["high"] >= band_lo)
            if band_hi is not None else None)
        bars.append(g)

    # ---- P: re-run every taught form at the trigger, with its own predicate -----------------
    trig_ts = pd.Timestamp(f"{SESSION} 09:45", tz=tz)
    prior = full5[full5.index < trig_ts].tail(6)
    trigger = full5.loc[trig_ts]

    forms = {}
    if band_lo is not None:
        forms["ROUTE_B_normal_breakout"] = brk.normal_breakout(
            prior, trigger, band_lo, band_hi, "L", float(p.body_frac), float(p.close_loc))
        forms["ROUTE_D_break_retest"] = brk.break_retest(
            prior, trigger, band_lo, band_hi, "L", float(p.body_frac), float(p.close_loc))
        forms["ROUTE_D_exception2_repeat_test"] = brk.prebreak_repeat_test(
            prior, trigger, band_lo, band_hi, "L", float(p.body_frac), float(p.close_loc),
            float(p.reject_wick))
        forms["ROUTE_C_prebreak_displacement"] = brk.prebreak_displacement(
            prior, trigger, band_lo, band_hi, "L", float(p.body_frac), float(p.close_loc),
            float(p.range_ratio))

    form_rows = []
    for name, read in forms.items():
        prov = PROVENANCE.get(read.refusal, {
            "encodes": "unmapped", "rests_on": "unmapped",
            "magnitude_is_taught": None, "why": "refusal literal not in the provenance table"})
        form_rows.append({
            "taught_form": name,
            "valid": bool(read.form is not None),
            "form_returned": read.form,
            "refusal": read.refusal,
            "predicate_encodes": prov["encodes"],
            "refusal_rests_on": prov["rests_on"],
            "that_quantity_is_TAUGHT": prov["magnitude_is_taught"],
            "provenance": prov["why"],
        })

    # ---- the acceptance_bars sensitivity, MEASURED not asserted ----------------------------
    sens = []
    for n in (1, 2, 3):
        r = brk.break_retest(prior, trigger, band_lo, band_hi, "L",
                             float(p.body_frac), float(p.close_loc), acceptance_bars=n)
        sens.append({"acceptance_bars": n, "valid": r.form is not None,
                     "form": r.form, "refusal": r.refusal})

    only_untaught = [f for f in form_rows
                     if not f["valid"] and f["that_quantity_is_TAUGHT"] is False]
    taught_also_refuses = [f for f in form_rows
                           if not f["valid"] and f["that_quantity_is_TAUGHT"] is True]

    out = {
        "artifact": "TPG_0331_RE_ROW",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-074 (1)",
        "produced": "2026-08-23",
        "session": SESSION,
        "his_entry_clock": HIS_ENTRY_CLOCK,
        "reachability_now": "R1b: break family sees the origin-R level; REFUSED, 3 matching",
        "band_used_by_the_matching_candidates": [band_lo, band_hi],
        "matching_candidate_count": len(matching),
        "G_bars": bars,
        "T_and_P_by_taught_form": form_rows,
        "acceptance_bars_sensitivity_at_his_trigger": sens,
        "verdict_under_the_LITERAL_ALGO_067_rule": (
            "MACHINE_CORRECT_PER_TEACHING" if taught_also_refuses else "PREDICATE_MISSPECIFIED"),
        "verdict_PER_FORM": (
            "PREDICATE_MISSPECIFIED" if only_untaught else "TAUGHT_FORM_ABSENT_FROM_DERIVATION"),
        "why_the_two_readings_differ": (
            "The literal ALGO-067 rule asks whether ANY taught definition also refuses. Route B "
            "and Route C do - but they are DIFFERENT FORMS, not the one his entry matches, and "
            "that same coarseness already gave the WRONG answer on 03-30 (recorded in "
            "run_tpg_conformance_three_sessions.py). Per FORM, the accepted-break retest - one "
            "of the three ALGO-069 recovery forms - IS reached and refuses ONLY on the unfrozen "
            "`acceptance_bars`."),
        "repair_is_NOT_landed_here": (
            "acceptance_bars 3 -> 2 recovers this session, which is exactly why this module will "
            "not move it. R3 (silent => stricter) was PRE-REGISTERED and selected 3 from a "
            "measured sensitivity with no outcome input; re-selecting it now because 2 recovers "
            "an agreement case would be selecting an unfrozen magnitude by agreement. Reserved "
            "to the advisor."),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"=== {SESSION} T/P/G RE-ROW (his entry {HIS_ENTRY_CLOCK}) ===")
    print(f"band: {band_lo} - {band_hi}   matching candidates: {len(matching)}")
    print("\nG - bars:")
    for b in bars:
        print(f"  {b['bucket'][11:16]} O{b['open']:>9.2f} H{b['high']:>9.2f} "
              f"L{b['low']:>9.2f} C{b['close']:>9.2f}  body={b['body_frac']:.3f} "
              f"upwick={b['upper_wick_frac']:.3f} beyond={b['close_beyond_band_for_a_LONG']}")
    print("\nT/P - taught forms at his trigger:")
    for f in form_rows:
        print(f"  {f['taught_form']:<34} valid={f['valid']}  {f['refusal']}")
        print(f"      rests on: {f['refusal_rests_on']}  TAUGHT={f['that_quantity_is_TAUGHT']}")
    print("\nacceptance_bars sensitivity at his trigger:")
    for s in sens:
        print(f"  {s['acceptance_bars']}: valid={s['valid']} {s['refusal'] or s['form']}")
    print(f"\nverdict (literal ALGO-067): {out['verdict_under_the_LITERAL_ALGO_067_rule']}")
    print(f"verdict (per form)        : {out['verdict_PER_FORM']}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
