#!/usr/bin/env python3
"""L3 - WHERE DO HIS TWO UNREACHABLE TPs COME FROM? DIAGNOSTIC ONLY - repairs nothing.

ALGO-078 lane 3. 03-30's 23355.25 and 03-31's 23540.75 are in NO considered destination and no
15m key zone (gaps 4.34 and 10.83 pts), so no selection repair can reach them. Before anything
is built to cover them, the question is whether they exist in held structure at all.

SEARCHED, under HIS vocabulary - key level zones, support and resistance, rejection wicks:
  * prior SESSION and prior DAY high / low / close
  * higher-timeframe 30m / 1h / daily REJECTION BANDS, wick-extreme-to-close, which is his own
    ratified zone rule applied at a higher timeframe rather than a new invention
  * session extremes to that point

EVERY CANDIDATE IS PUBLISHED WITH ITS DISTANCE, and the tolerance is FIXED BEFORE THE SEARCH at
one tick for an exact-level match and 2.0 points for a band containment. A tolerance widened
after seeing the answer is a goalpost with a citation; if nothing lands inside these, the honest
verdict is TP_PROVENANCE_UNKNOWN_FROM_HELD and the coverage repair has no source to build from.

03-24's TP is carried as the POSITIVE CONTROL: it is already known to sit inside a 15m key zone,
so a search that cannot find IT is broken and its silence about the other two means nothing.

NO PnL, outcome or agreement rate is read.
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

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Locates his TPs in held structure. Repairs nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_l3_tp_provenance_2026_08_24.json")

#: 03-24 is the POSITIVE CONTROL - its TP is known to sit inside a 15m key zone.
SUBJECTS = ("2026-03-30", "2026-03-31")
CONTROL = "2026-03-24"
SESSIONS = SUBJECTS + (CONTROL,)
ARM_NAME, ARM_START = "taught_0800", _time(8, 0)

#: FIXED BEFORE THE SEARCH.
EXACT_TOL_TICKS = 1
BAND_TOL_POINTS = 2.0


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


def _resample(full5, minutes):
    return full5.resample(f"{minutes}min", origin="start_day", offset="9h30min",
                          label="left", closed="left").agg(
        open=("open", "first"), high=("high", "max"),
        low=("low", "min"), close=("close", "last")).dropna()


def main() -> int:
    t0 = time.perf_counter()
    labels = _labels()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        full5 = env["full5"]
        tick = float(eng.core.TICK)
        exact_tol = EXACT_TOL_TICKS * tick

        for session in SESSIONS:
            dte = date.fromisoformat(session)
            label = labels[session]
            tp, action = _his_tp(label)
            tp_px = float(tp["lo"])
            his_clock = pd.Timestamp(label["first_entry_time"])
            tz = full5.index.tz
            day_lo = pd.Timestamp(f"{session} 00:00", tz=tz)

            cands = []

            # ---- prior day / prior session H, L, C -----------------------------------
            prior = full5[full5.index < day_lo]
            if len(prior):
                pdays = prior.groupby(prior.index.date)
                keys = sorted(pdays.groups)
                for back, key in enumerate(reversed(keys[-2:]), start=1):
                    d = pdays.get_group(key)
                    for name, val in (("high", float(d.high.max())),
                                      ("low", float(d.low.min())),
                                      ("close", float(d.close.iloc[-1]))):
                        cands.append({"kind": f"prior_day_{back}_{name}",
                                      "level": val, "distance": round(abs(val - tp_px), 4)})

            # ---- session extremes to his entry ---------------------------------------
            sess = full5[(full5.index >= day_lo) & (full5.index < his_clock)]
            if len(sess):
                for name, val in (("session_high_to_entry", float(sess.high.max())),
                                  ("session_low_to_entry", float(sess.low.min()))):
                    cands.append({"kind": name, "level": val,
                                  "distance": round(abs(val - tp_px), 4)})

            # ---- HTF rejection bands, wick-extreme-to-close (HIS rule, higher tf) ----
            bands = []
            for tf in (30, 60):
                htf = _resample(full5[full5.index < his_clock], tf)
                for t, r in htf.tail(24).iterrows():
                    o, h, l, c = float(r.open), float(r.high), float(r.low), float(r.close)
                    for which, lo_, hi_ in (("upper", min(c, h), max(c, h)),
                                            ("lower", min(l, c), max(l, c))):
                        inside = (lo_ - BAND_TOL_POINTS) <= tp_px <= (hi_ + BAND_TOL_POINTS)
                        if inside:
                            bands.append({
                                "kind": f"{tf}m_rejection_band_{which}_wick_to_close",
                                "bucket": str(t), "band": [round(lo_, 2), round(hi_, 2)],
                                "width_points": round(hi_ - lo_, 2),
                                "contains_his_tp": bool(lo_ <= tp_px <= hi_)})

            cands.sort(key=lambda x: x["distance"])
            exact = [c for c in cands if c["distance"] <= exact_tol]

            if exact:
                verdict = "TP_IS_A_HELD_STRUCTURAL_LEVEL"
                found = exact[0]["kind"]
            elif bands:
                verdict = "TP_INSIDE_AN_HTF_REJECTION_BAND"
                found = bands[0]["kind"]
            else:
                verdict = "TP_PROVENANCE_UNKNOWN_FROM_HELD"
                found = None

            rows.append({
                "session": session,
                "is_control": session == CONTROL,
                "his_action": action,
                "his_tp": tp_px,
                "his_entry_clock": str(his_clock),
                "exact_tolerance_points": exact_tol,
                "band_tolerance_points": BAND_TOL_POINTS,
                "tolerances_fixed_before_the_search": True,
                "exact_level_matches": exact,
                "nearest_structural_levels": cands[:8],
                "htf_rejection_bands_containing_it": bands[:8],
                "VERDICT": verdict,
                "matched_by": found,
            })

    ctrl = next(r for r in rows if r["is_control"])
    out = {
        "artifact": "L3_TP_PROVENANCE",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-078 lane 3",
        "produced": "2026-08-24",
        "arm": ARM_NAME,
        "subjects": list(SUBJECTS),
        "control_session": CONTROL,
        "control_verdict": ctrl["VERDICT"],
        "control_is_meaningful": ctrl["VERDICT"] != "TP_PROVENANCE_UNKNOWN_FROM_HELD",
        "searched_surfaces": [
            "prior day 1 and 2 high / low / close",
            "session high and low up to his entry",
            "30m and 1h rejection bands, wick extreme to close (his own zone rule, higher tf)"],
        "rows": rows,
        "verdicts": {r["session"]: r["VERDICT"] for r in rows},
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== L3 TP PROVENANCE ===")
    for r in rows:
        tag = " [CONTROL]" if r["is_control"] else ""
        print(f"\n{r['session']}{tag}  TP={r['his_tp']}  -> {r['VERDICT']}")
        if r["exact_level_matches"]:
            for c in r["exact_level_matches"]:
                print(f"   EXACT: {c['kind']} = {c['level']}  (d={c['distance']})")
        print("   nearest structural levels:")
        for c in r["nearest_structural_levels"][:4]:
            print(f"      {c['kind']:<28} {c['level']:>10}  d={c['distance']}")
        if r["htf_rejection_bands_containing_it"]:
            print("   HTF rejection bands containing it:")
            for bd in r["htf_rejection_bands_containing_it"][:3]:
                print(f"      {bd['kind']:<40} {bd['band']} w={bd['width_points']} "
                      f"contains={bd['contains_his_tp']}")
    print(f"\nverdicts: {out['verdicts']}")
    print(f"control meaningful: {out['control_is_meaningful']}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
