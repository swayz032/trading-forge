#!/usr/bin/env python3
"""THE ENTRY-ZONE CENSUS. DIAGNOSTIC ONLY - and deliberately PROPOSES NOTHING.

ALGO-090 order 2. Every timing predicate tried so far has died on the 04-14 control, which is
the control doing its job. So this artifact stops guessing cuts and just describes the objects:
one table, identical fields for every row, covering

  * the FIVE convicted early-trade zones (the ones the bot fired at 46min-3h early)
  * the 04-14 CONTROL zone (the one day the bot agrees)
  * the zones HIS LABELS select on the eight decided days - day-grain context only, since
    tick/minute label forensics are closed under ALGO-083

THE TABLE IS THE DELIVERABLE. No predicate is proposed, no threshold appears, and no row is
scored. If a separating property exists it should be legible in the columns; if it is not
legible, that is itself the finding and inventing a cut to cover it would be fitting.

ONE COLUMN CARRIES REAL WEIGHT: `drawable_under_his_rule`. His ratified construction is
[wick extreme, close] of a rejection candle, confirmed to 0.6 points against his own 11 Jul '25
demonstration. So for every zone we can ask whether ANY completed 5m or 15m candle would draw
THIS band under THAT rule. A zone the machine trades but his rule could never have drawn is a
different kind of object from one his rule reproduces - and that distinction is measured here
rather than assumed.

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
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates
from research.current_mnq_strategy_v2_4_frozen_replay_regrade import build_and_classify

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Describes entry zones. Proposes no predicate, scores no row."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_entry_zone_census_2026_08_24.json")

ARM_START = _time(8, 0)
CONTROL = "2026-04-14"
DECIDED = ("2026-03-23", "2026-03-24", "2026-03-30", "2026-03-31",
           "2026-04-02", "2026-04-06", "2026-04-09", "2026-04-14")

#: THE FIVE CONVICTED EARLY TRADES, named explicitly. The first run tagged every non-control
#: decided day "convicted", which swept in 04-02 - a NO_TRADE decline day that was never
#: convicted of anything - and would have put a decline row into a table about early entries.
CONVICTED_SESSIONS = ("2026-03-23", "2026-03-24", "2026-03-31", "2026-04-06", "2026-04-09")

#: His rule, confirmed against his own demonstration to 0.6 pts. A candle draws band [lo, hi]
#: when [min(wick,close), max(wick,close)] reproduces it within this tolerance.
DRAW_TOL_POINTS = 1.5
DRAW_TIMEFRAMES = (5, 15)


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


def zone_birth(loc_id):
    parts = str(loc_id or "").split(":")
    for i in range(len(parts)):
        cand = ":".join(parts[i:i + 3])
        if "T" in cand and "-" in cand:
            try:
                return pd.Timestamp(cand)
            except Exception:
                continue
    return None


def defining_rejection(full5, lo, hi, until, not_before=None):
    """The completed 5m/15m candle whose [wick extreme, close] REPRODUCES this band - HIS rule.

    Returns the LATEST such candle at or before `until`, or None. This is the candle that draws
    the zone; it is what a freshness rule must count FORWARD from, because the touch that
    creates a zone's significance cannot also be the touch that spends it.
    """
    # THE DEFINER CANNOT PREDATE THE ZONE. Without `not_before` this search ran over ALL
    # history and returned candles older than the zone itself - which produced the impossible
    # reading "7 tests since the definer, 1 test since birth" on the control. A zone is not
    # drawn by a candle that existed before it did.
    best = None
    for tf in DRAW_TIMEFRAMES:
        frame = _resample(full5[full5.index < until], tf)
        for t, r in frame.iterrows():
            if t + pd.Timedelta(minutes=tf) > until:
                continue
            if not_before is not None and t < not_before:
                continue
            h, l, c = float(r.high), float(r.low), float(r.close)
            for which, a, b in (("upper", c, h), ("lower", l, c)):
                blo, bhi = min(a, b), max(a, b)
                if (abs(blo - lo) <= DRAW_TOL_POINTS and abs(bhi - hi) <= DRAW_TOL_POINTS):
                    cand = {"timeframe": f"{tf}m", "bucket": str(t), "which_wick": which,
                            "band_drawn": [round(blo, 2), round(bhi, 2)],
                            "ohlc": [float(r.open), h, l, c],
                            "edge_errors": [round(abs(blo - lo), 2), round(abs(bhi - hi), 2)]}
                    if best is None or pd.Timestamp(t) > pd.Timestamp(best["bucket"]):
                        best = cand
    return best


def completed_tests(full5, lo, hi, since, until):
    """Bars COMPLETING in (since, until] whose range meets the band."""
    if since is None:
        return []
    out = []
    win = full5[(full5.index > since) & (full5.index < until)]
    for t, r in win.iterrows():
        if t + pd.Timedelta(minutes=5) > until:
            continue
        if float(r.low) <= hi and float(r.high) >= lo:
            out.append({"bucket": str(t), "ohlc": [float(r.open), float(r.high),
                                                   float(r.low), float(r.close)]})
    return out


def _row(full5, tag, session, fire_clock, band, loc_id, kind, source, extra=None):
    lo, hi = float(band[0]), float(band[1])
    birth = zone_birth(loc_id)
    fire = pd.Timestamp(fire_clock) if fire_clock else None
    definer = (defining_rejection(full5, lo, hi, fire, not_before=birth)
               if fire is not None else None)
    tests_from_birth = (completed_tests(full5, lo, hi, birth, fire)
                        if (birth is not None and fire is not None) else [])
    tests_from_definer = ([] if (definer is None or fire is None) else
                          completed_tests(full5, lo, hi,
                                          pd.Timestamp(definer["bucket"])
                                          + pd.Timedelta(minutes=int(definer["timeframe"][:-1])),
                                          fire))
    age_sessions = None
    if birth is not None and fire is not None:
        age_sessions = int(len({d for d in pd.bdate_range(birth.date(), fire.date())}) - 1)
    return {
        "row_type": tag,
        "session": session,
        "fire_clock": str(fire) if fire is not None else None,
        "band": [round(lo, 2), round(hi, 2)],
        "band_width_points": round(hi - lo, 2),
        "construction_kind": kind,
        "source_map": source,
        "location_id": loc_id,
        "birth": (str(birth) if birth is not None else None),
        "birth_session": (str(birth.date()) if birth is not None else None),
        "age_in_sessions_at_fire": age_sessions,
        "drawable_under_his_rule": bool(definer),
        "defining_rejection": definer,
        "defining_timeframe": (definer["timeframe"] if definer else None),
        # NULL, not 0, when the zone has no parseable birth (his labelled zones carry no
        # deterministic id). Emitting 0 made "since birth" look like a measured zero and let
        # tests_since_definer exceed it - an impossible ordering my own invariant test caught.
        "completed_tests_since_BIRTH": (len(tests_from_birth) if birth is not None else None),
        "completed_tests_since_DEFINING_REJECTION": (
            len(tests_from_definer) if definer else None),
        **(extra or {}),
    }


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
        p = eng.Params()
        full5 = env["full5"]

        # ---- the machine's first APPROVED entry per decided day: the fired zone -----------
        for session in DECIDED:
            dte = date.fromisoformat(session)
            end = pd.Timestamp(man[session]["replay_end"])
            fired = None
            for cand, actionable, _plan in iter_actionable_candidates(env, dte, p, as_of=end):
                ent = eng.core.one_minute_entry(env["one"], actionable, cand.direction, p)
                if ent is None:
                    continue
                et, epx, _ = ent
                if et > end or et.time() > eng.core.LAST_ENTRY:
                    continue
                picked, _pr = build_and_classify(
                    env["piv5"], full5, env["h15"], et, p, env["pdm"], env["pwm"], dte,
                    float(epx), cand.direction, cand.setup, cand.setup == "BRK5",
                    piv15=env["piv15"], entry_location=cand.location,
                    candidate_reason=cand.reason)
                if picked is not None:
                    fired = (cand, et)
                    break
            if fired is None or fired[0].location is None:
                continue
            cand, et = fired
            loc = cand.location
            tag = ("CONTROL_zone" if session == CONTROL
                   else "convicted_early_zone" if session in CONVICTED_SESSIONS
                   else "other_decided_day_zone")
            rows.append(_row(full5, tag, session, et,
                             [float(loc.lo), float(loc.hi)], str(getattr(loc, "id", "")),
                             "machine_entry_location", str(loc.source),
                             extra={"story": str(cand.reason),
                                    "direction": str(cand.direction),
                                    "setup": str(cand.setup)}))

        # ---- the zones HIS LABELS select, day-grain context only -------------------------
        for session in DECIDED:
            lab = labels[session]
            clk = lab.get("first_entry_time")
            for z in (lab.get("trader_zones") or []):
                rows.append(_row(full5, "his_labelled_zone", session, clk,
                                 [float(z["lo"]), float(z["hi"])], None,
                                 "trader_marked", str(z.get("source_method")),
                                 extra={"role": z.get("role"),
                                        "marked_main_timeframe": z.get("marked_main_timeframe"),
                                        "day_grain_context_only": True}))

    machine = [r for r in rows if r["row_type"] != "his_labelled_zone"]
    convicted_rows = [r for r in machine if r["row_type"] == "convicted_early_zone"]
    ctrl_rows = [r for r in machine if r["row_type"] == "CONTROL_zone"]
    his = [r for r in rows if r["row_type"] == "his_labelled_zone"]
    out = {
        "artifact": "ENTRY_ZONE_CENSUS",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-090 order 2",
        "produced": "2026-08-24",
        "no_predicate_proposed": True,
        "no_row_scored": True,
        "his_rule_used_for_drawable_column": (
            "[wick extreme, close] of a completed 5m/15m rejection candle - his ratified "
            f"construction, confirmed to 0.6 pts against his 11 Jul '25 demo. Tolerance "
            f"{DRAW_TOL_POINTS} pts."),
        "rows": rows,
        "machine_zone_rows": len(machine),
        "his_zone_rows": len(his),
        "population_check": {
            "convicted_rows_found": len(convicted_rows),
            "convicted_expected": len(CONVICTED_SESSIONS),
            "control_rows_found": len(ctrl_rows),
            "note": ("03-30 has no approved entry at all, so it contributes no machine zone; "
                     "04-02 is a NO_TRADE decline day and is tagged other_decided_day_zone, "
                     "never convicted."),
        },
        "summary_machine_zones": [
            {"session": r["session"], "type": r["row_type"], "story": r.get("story"),
             "age_sessions": r["age_in_sessions_at_fire"],
             "drawable_under_his_rule": r["drawable_under_his_rule"],
             "tests_since_birth": r["completed_tests_since_BIRTH"],
             "tests_since_definer": r["completed_tests_since_DEFINING_REJECTION"],
             "source_map": r["source_map"], "width": r["band_width_points"]}
            for r in machine],
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== ENTRY-ZONE CENSUS (no predicate proposed) ===")
    hdr = (f"{'session':<12}{'type':<24}{'age':>4}{'draw':>6}{'t/birth':>8}"
           f"{'t/def':>7}{'width':>7}  source / story")
    print(hdr)
    for r in machine:
        print(f"{r['session']:<12}{r['row_type']:<24}"
              f"{str(r['age_in_sessions_at_fire']):>4}"
              f"{str(r['drawable_under_his_rule'])[:5]:>6}"
              f"{r['completed_tests_since_BIRTH']:>8}"
              f"{str(r['completed_tests_since_DEFINING_REJECTION']):>7}"
              f"{r['band_width_points']:>7}  {r['source_map']} / {r.get('story')}")
    print(f"\nhis labelled zones: {len(his)} rows (day-grain context only)")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
