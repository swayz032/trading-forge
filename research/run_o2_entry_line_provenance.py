#!/usr/bin/env python3
"""O2 - DO HIS ENTRY LINES EXIST IN HELD STRUCTURE BEFORE HE TRADES THEM? DIAGNOSTIC ONLY.

ALGO-080 order 2. L4 found that on 03-24 and 04-06 NO completed bar had penetrated his entry
line at the moment he entered - his line had not yet been tested-and-rejected on a finished
candle. Two readings survive that: either those lines are wrong, or he marks levels
PROSPECTIVELY, from structure that already existed before the session's price action reached it.

This lane tests the second reading with the L3 machinery pointed at the ENTRY LINES instead of
the take-profits. A hit means prospective marking is DEMONSTRATED FROM HELD DATA - and the J5
band law gains a second lawful source, a PRE-EXISTING HTF band, beside the same-session
penetration candle. Only an empty result sends the question to the operator.

SURFACES, all evaluated strictly BEFORE his entry so nothing that had not printed can be cited:
  * prior day 1 and 2 high / low / close
  * session high and low up to his entry
  * 30m and 1h rejection bands, wick extreme to close - his own ratified zone rule at a higher
    timeframe. 30m sits inside the taught 5/15/30 family; 60m is marked PROVISIONAL-UNCITED per
    ALGO-080 and is never allowed to carry a verdict on its own.

TOLERANCES FIXED BEFORE THE SEARCH: 1 tick for an exact level, 2.0 points for band containment.
Identical to L3, deliberately - a tolerance that changes when the question changes is a goalpost.

CAPABILITY CONTROL: 03-24's TP 24641.5, already located by L3 inside a 60m band. If the machinery
cannot re-find that, its silence about any entry line means nothing.
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

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Tests whether his entry lines pre-exist in held structure."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_o2_entry_line_provenance_2026_08_24.json")

SESSIONS = ("2026-03-24", "2026-03-30", "2026-03-31", "2026-04-06", "2026-04-14")
#: The two with NO completed penetration at his entry - the reason this lane exists.
FOCUS = ("2026-03-24", "2026-04-06")
CAPABILITY_CONTROL = {"session": "2026-03-24", "price": 24641.5,
                      "known": "L3 located it inside a 60m rejection band [24612, 24689]"}

EXACT_TOL_TICKS = 1
BAND_TOL_POINTS = 2.0
PROVISIONAL_TFS = (60,)          # ALGO-080: 60m is PROVISIONAL-UNCITED
TAUGHT_TFS = (30,)               # inside the taught 5/15/30 family


def _labels():
    man = {c["case_id"]: c["session"]
           for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def _resample(full5, minutes):
    return full5.resample(f"{minutes}min", origin="start_day", offset="9h30min",
                          label="left", closed="left").agg(
        open=("open", "first"), high=("high", "max"),
        low=("low", "min"), close=("close", "last")).dropna()


def _pick_line(label, entry_px, full5, his_clock):
    zones = label.get("trader_zones") or []
    if not zones:
        return None
    def mid(z):
        return (float(z["lo"]) + float(z["hi"])) / 2.0
    bucket = his_clock.floor("5min")
    win = full5[(full5.index >= bucket - pd.Timedelta(minutes=5)) & (full5.index <= bucket)]
    pen = []
    for z in zones:
        m = mid(z)
        for _t, r in win.iterrows():
            h, l, c = float(r.high), float(r.low), float(r.close)
            if (h > m and c < m) or (l < m and c > m):
                pen.append(z)
                break
    pool = pen or zones
    return mid(min(pool, key=lambda z: 0.0 if float(z["lo"]) <= entry_px <= float(z["hi"])
                   else min(abs(entry_px - float(z["lo"])), abs(entry_px - float(z["hi"])))))


def _search(full5, price, his_clock, session, tz):
    """Every held-structure candidate for `price`, all strictly before his entry."""
    day_lo = pd.Timestamp(f"{session} 00:00", tz=tz)
    cands, bands = [], []

    prior = full5[full5.index < day_lo]
    if len(prior):
        g = prior.groupby(prior.index.date)
        for back, key in enumerate(reversed(sorted(g.groups)[-2:]), start=1):
            d = g.get_group(key)
            for name, val in (("high", float(d.high.max())), ("low", float(d.low.min())),
                              ("close", float(d.close.iloc[-1]))):
                cands.append({"kind": f"prior_day_{back}_{name}", "level": val,
                              "distance": round(abs(val - price), 4)})

    sess = full5[(full5.index >= day_lo) & (full5.index < his_clock)]
    if len(sess):
        for name, val in (("session_high_to_entry", float(sess.high.max())),
                          ("session_low_to_entry", float(sess.low.min()))):
            cands.append({"kind": name, "level": val, "distance": round(abs(val - price), 4)})

    for tf in TAUGHT_TFS + PROVISIONAL_TFS:
        htf = _resample(full5[full5.index < his_clock], tf)
        for t, r in htf.tail(24).iterrows():
            closes_at = t + pd.Timedelta(minutes=tf)
            if closes_at > his_clock:
                continue                      # not completed at his entry
            o, h, l, c = float(r.open), float(r.high), float(r.low), float(r.close)
            for which, lo_, hi_ in (("upper", min(c, h), max(c, h)),
                                    ("lower", min(l, c), max(l, c))):
                if (lo_ - BAND_TOL_POINTS) <= price <= (hi_ + BAND_TOL_POINTS):
                    bands.append({
                        "kind": f"{tf}m_rejection_band_{which}_wick_to_close",
                        "timeframe_minutes": tf,
                        "provenance": ("TAUGHT_FAMILY_5_15_30" if tf in TAUGHT_TFS
                                       else "PROVISIONAL_UNCITED"),
                        "bucket": str(t), "closes_at": str(closes_at),
                        "band": [round(lo_, 2), round(hi_, 2)],
                        "width_points": round(hi_ - lo_, 2),
                        "contains_it": bool(lo_ <= price <= hi_)})

    cands.sort(key=lambda x: x["distance"])
    return cands, bands


def main() -> int:
    t0 = time.perf_counter()
    labels = _labels()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(ARM_START := _time(8, 0)):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        full5, one = env["full5"], env["one"]
        tz = full5.index.tz
        exact_tol = EXACT_TOL_TICKS * float(eng.core.TICK)

        # ---- capability control first: re-find a price L3 already located ----------------
        cc = CAPABILITY_CONTROL
        cl = labels[cc["session"]]
        cc_clock = pd.Timestamp(cl["first_entry_time"])
        _c, cc_bands = _search(full5, cc["price"], cc_clock, cc["session"], tz)
        control_ok = bool(cc_bands)

        for session in SESSIONS:
            label = labels[session]
            his_clock = pd.Timestamp(label["first_entry_time"])
            b = one[one.index <= his_clock]
            entry_px = float(b.iloc[-1].open)
            line = _pick_line(label, entry_px, full5, his_clock)

            cands, bands = _search(full5, line, his_clock, session, tz)
            exact = [c for c in cands if c["distance"] <= exact_tol]
            taught_bands = [x for x in bands if x["provenance"] == "TAUGHT_FAMILY_5_15_30"]

            # CONTAINMENT AND "WITHIN TOLERANCE" ARE DIFFERENT CLAIMS AND THE FIRST DRAFT OF
            # THIS LANE CONFLATED THEM. A band that ends 1.375 points short of his line does not
            # contain it; calling that "INSIDE" is the same evidence-labelling error the desk
            # caught in L2 one order earlier. Only genuine containment can demonstrate
            # prospective marking; a tolerance hit is reported as exactly that.
            contained = [x for x in taught_bands if x["contains_it"]]
            contained_any = [x for x in bands if x["contains_it"]]
            near_taught = [x for x in taught_bands if not x["contains_it"]]
            if exact:
                verdict, why = "ENTRY_LINE_IS_A_HELD_STRUCTURAL_LEVEL", exact[0]["kind"]
            elif contained:
                verdict, why = "ENTRY_LINE_INSIDE_A_TAUGHT_HTF_BAND", contained[0]["kind"]
            elif contained_any:
                verdict, why = "ENTRY_LINE_INSIDE_A_PROVISIONAL_HTF_BAND_ONLY",                     contained_any[0]["kind"]
            elif near_taught:
                verdict, why = "ENTRY_LINE_ONLY_WITHIN_TOLERANCE_NOT_CONTAINED",                     near_taught[0]["kind"]
            else:
                verdict, why = "ENTRY_LINE_PROVENANCE_UNKNOWN_FROM_HELD", None

            gaps = sorted(round(min(abs(line - x["band"][0]), abs(line - x["band"][1])), 3)
                          for x in taught_bands if not x["contains_it"])

            rows.append({
                "session": session,
                "is_focus": session in FOCUS,
                "his_entry_clock": str(his_clock),
                "his_entry_line": line,
                "exact_level_matches": exact,
                "nearest_structural_levels": cands[:6],
                "htf_bands_containing_it": bands[:8],
                "taught_family_bands": taught_bands[:4],
                "bands_that_CONTAIN_the_line": [x for x in bands if x["contains_it"]][:4],
                "nearest_tolerance_gaps_points": gaps[:4],
                "VERDICT": verdict,
                "matched_by": why,
            })

    focus = [r for r in rows if r["is_focus"]]
    demonstrated = [r for r in focus
                    if r["VERDICT"] in ("ENTRY_LINE_IS_A_HELD_STRUCTURAL_LEVEL",
                                        "ENTRY_LINE_INSIDE_A_TAUGHT_HTF_BAND")]
    all_gaps = [g for r in rows for g in r["nearest_tolerance_gaps_points"]]
    out = {
        "artifact": "O2_ENTRY_LINE_PROVENANCE",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-080 order 2",
        "produced": "2026-08-24",
        "capability_control": {**CAPABILITY_CONTROL, "re_found": control_ok,
                               "bands": cc_bands[:3]},
        "capability_control_passed": control_ok,
        "tolerances_fixed_before_the_search": True,
        "exact_tolerance_points": exact_tol,
        "band_tolerance_points": BAND_TOL_POINTS,
        "sixty_minute_is_provisional": (
            "60m bands are marked PROVISIONAL_UNCITED per ALGO-080 and never carry a verdict "
            "alone; 30m sits inside the taught 5/15/30 family."),
        "rows": rows,
        "verdicts": {r["session"]: r["VERDICT"] for r in rows},
        "focus_sessions": list(FOCUS),
        "PROSPECTIVE_MARKING_DEMONSTRATED_ON": [r["session"] for r in demonstrated],
        "containment_vs_tolerance": (
            "Only genuine CONTAINMENT demonstrates prospective marking. A band ending short of "
            "his line is reported as ENTRY_LINE_ONLY_WITHIN_TOLERANCE_NOT_CONTAINED."),
        "recurring_gap_note": (
            "A 0.375 gap recurs on 03-31 and 04-14. His lines are midpoints of 0.25-wide zones "
            "(all ending .625) while band edges fall on .25/.75, so that offset looks like a "
            "QUANTISATION ARTEFACT of the zone encoding rather than structure. It is flagged "
            "rather than counted as a near-miss worth widening a tolerance for."),
        "all_tolerance_gaps_points": sorted(set(all_gaps)),
        "verdict_summary": (
            "prospective marking DEMONSTRATED from held data on "
            f"{len(demonstrated)} of {len(focus)} focus sessions"
            if demonstrated else
            "NOT demonstrated on either focus session - the question goes to the operator"),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== O2 ENTRY-LINE PROVENANCE ===")
    print(f"capability control ({cc['session']} TP {cc['price']}): "
          f"{'RE-FOUND' if control_ok else 'NOT FOUND - the search proves nothing'}")
    for r in rows:
        tag = " [FOCUS]" if r["is_focus"] else ""
        print(f"\n{r['session']}{tag}  line={r['his_entry_line']}  -> {r['VERDICT']}")
        for c in r["nearest_structural_levels"][:3]:
            print(f"      {c['kind']:<28} {c['level']:>10}  d={c['distance']}")
        for bd in r["htf_bands_containing_it"][:3]:
            print(f"      {bd['kind']:<40} {bd['band']} [{bd['provenance']}]")
    print(f"\n{out['verdict_summary']}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
