#!/usr/bin/env python3
"""L1 - WHY THE BOT FIRES EARLY: classify each of the 5 early trades. DIAGNOSTIC ONLY.

ALGO-078 lane 1. The census established a PROPERTY - the bot takes the session's first legal
setup while the teaching has him WAIT - but a property is not a predicate. This lane classifies
each early trade against two PRE-REGISTERED hypotheses, fixed before any row was read:

  H-A  ZONE SIGNIFICANCE   the early trade fires at a level he never marked that day
  H-B  SEQUENCE            it fires at HIS level, but before react-then-momentum completes

Disposition, also pre-registered by ALGO-078: 3 or more in one class NAMES the repair lane.
NEITHER dominant => WAIT_MECHANIC_UNDERSPECIFIED, and the answer is outside-teachings research
under HIS vocabulary, not a predicate invented here.

NO PREDICATE IS MINTED FROM 2026 LABELS. The classification reads what the bot did and which
levels he marked; it does not fit a threshold to make days pass.

THE CLASSIFICATION IS A JUDGMENT AND THE ROW EVIDENCE IS MECHANICAL, so they are separate
fields. `class` never borrows the authority of the measurements printed beside it - every row
carries the evidence that produced it, and a reader can re-derive the class or reject it.

MARKED-LEVEL MATCHING IS BY BAND OVERLAP, NOT BY MIDPOINT EQUALITY. His `trader_zones` are
recorded as narrow bands (often 0.25 wide); the machine's locations are wider derived bands. A
midpoint test would answer "never marked" for zones that plainly correspond, manufacturing H-A.
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
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Classifies the 5 early trades H-A / H-B / NEITHER. Repairs nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
OUT = Path("research/current_mnq_strategy_v2_4_l1_timing_classification_2026_08_24.json")

#: The five early trades, from the ratified census. 04-14 (control) fires AFTER him and is
#: carried as the negative control: it must NOT classify as H-A or H-B.
EARLY = ("2026-03-23", "2026-03-24", "2026-03-31", "2026-04-06", "2026-04-09")
CONTROL = "2026-04-14"
SESSIONS = EARLY + (CONTROL,)
ARM_NAME, ARM_START = "taught_0800", _time(8, 0)

HYPOTHESES = {
    "H_A_ZONE_SIGNIFICANCE": "the early trade fires at a level he never marked that day",
    "H_B_SEQUENCE": "it fires at HIS level, but before react-then-momentum completes",
    "NEITHER": "his level and the sequence looks complete - the wait mechanic is elsewhere",
}


def _labels():
    man = {c["case_id"]: c["session"]
           for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def _overlaps(a_lo, a_hi, b_lo, b_hi, tol=0.0):
    return (a_lo - tol) <= b_hi and (b_lo - tol) <= a_hi


def _bars_around(full5, ts, back=4, fwd=1):
    lo = ts - pd.Timedelta(minutes=5 * back)
    hi = ts + pd.Timedelta(minutes=5 * fwd)
    out = []
    for t, r in full5[(full5.index >= lo) & (full5.index <= hi)].iterrows():
        o, h, l, c = float(r.open), float(r.high), float(r.low), float(r.close)
        rng = h - l
        out.append({
            "bucket": str(t), "ohlc": [o, h, l, c],
            "body_frac": round(abs(c - o) / rng, 4) if rng else 0.0,
            "upper_wick_frac": round((h - max(o, c)) / rng, 4) if rng else 0.0,
            "lower_wick_frac": round((min(o, c) - l) / rng, 4) if rng else 0.0,
        })
    return out


def _first_approved(env, dte, p, end):
    """The candidate that actually spends the bullet, with its location and story."""
    for cand, actionable, _plan in iter_actionable_candidates(env, dte, p, as_of=end):
        ent = eng.core.one_minute_entry(env["one"], actionable, cand.direction, p)
        if ent is None:
            continue
        et, epx, _ = ent
        if et > end or et.time() > eng.core.LAST_ENTRY:
            continue
        picked, _pr = build_and_classify(
            env["piv5"], env["full5"], env["h15"], et, p, env["pdm"], env["pwm"], dte,
            float(epx), cand.direction, cand.setup, cand.setup == "BRK5",
            piv15=env["piv15"], entry_location=cand.location,
            candidate_reason=cand.reason)
        if picked is not None:
            loc = cand.location
            return {
                "entry_time": str(et), "entry_price": float(epx),
                "direction": str(cand.direction), "setup": str(cand.setup),
                "reason": str(cand.reason),
                "signal_time": str(cand.signal_time),
                "confirmed_time": str(cand.confirmed_time),
                "location_id": str(getattr(loc, "id", "")) if loc else None,
                "location_band": ([float(loc.lo), float(loc.hi)] if loc else None),
                "location_source": (str(loc.source) if loc else None),
            }
    return None


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
        full5 = env["full5"]

        for session in SESSIONS:
            dte = date.fromisoformat(session)
            case = manifest[session]
            label = labels[session]
            end = pd.Timestamp(case["replay_end"])
            his_clock = pd.Timestamp(label["first_entry_time"]) \
                if label.get("first_entry_time") else None

            fired = _first_approved(env, dte, p, end)
            his_zones = [{"band": [float(z["lo"]), float(z["hi"])], "role": z.get("role"),
                          "tf": z.get("marked_main_timeframe")}
                         for z in (label.get("trader_zones") or [])]

            # --- is the fired level among HIS marked levels that day? ------------------
            matched = []
            if fired and fired["location_band"]:
                flo, fhi = fired["location_band"]
                for z in his_zones:
                    if _overlaps(flo, fhi, z["band"][0], z["band"][1]):
                        matched.append(z)

            # THE BASE RATE, measured per session: how many of the locations the machine builds
            # overlap ANY zone he marked. Without this the H-A tally is unreadable.
            open_ts = pd.Timestamp(f"{dte} 09:30", tz=eng.core.TZ)
            locs, _z = build_entry_locations_v24(
                {"h15": env["h15"], "piv15": env["piv15"], "full5": full5}, dte, open_ts, p)
            n_overlap = sum(
                1 for l in locs
                if any(_overlaps(float(l.lo), float(l.hi), z["band"][0], z["band"][1])
                       for z in his_zones))

            fired_ts = pd.Timestamp(fired["confirmed_time"]) if fired else None
            seq_fired = _bars_around(full5, fired_ts.floor("5min")) if fired_ts is not None else []
            seq_his = _bars_around(full5, his_clock.floor("5min")) if his_clock is not None else []

            early_min = (round((his_clock - pd.Timestamp(fired["entry_time"])).total_seconds()
                               / 60.0, 1) if (fired and his_clock is not None) else None)

            # --- CLASSIFY. Judgment, from the mechanical fields above. -----------------
            if fired is None:
                klass, why = "NEITHER", "no approved entry to classify"
            elif not matched:
                klass = "H_A_ZONE_SIGNIFICANCE"
                why = ("the level it fired at overlaps NONE of the zones he marked that day "
                       f"({len(his_zones)} marked)")
            else:
                klass = "H_B_SEQUENCE"
                why = ("it fired at a level that overlaps one he marked, so the level is not "
                       "the discriminator - the timing within the sequence is")
            rows.append({
                "session": session,
                "is_control": session == CONTROL,
                "bot_is_early_by_minutes": early_min,
                "his_entry_clock": str(his_clock) if his_clock is not None else None,
                "his_marked_zones": his_zones,
                "fired_trade": fired,
                "fired_level_matches_a_marked_zone": bool(matched),
                "locations_the_machine_built": len(locs),
                "locations_overlapping_a_marked_zone": n_overlap,
                "base_rate_pct": round(100.0 * n_overlap / len(locs), 2) if locs else None,
                "matched_marked_zones": matched,
                "bar_sequence_at_the_grant": seq_fired,
                "bar_sequence_at_his_entry": seq_his,
                "CLASS": klass,
                "class_reason": why,
            })

    subject = [r for r in rows if not r["is_control"]]
    tally = {}
    for r in subject:
        tally[r["CLASS"]] = tally.get(r["CLASS"], 0) + 1
    dominant = max(tally, key=tally.get) if tally else None
    verdict = (dominant if dominant and tally[dominant] >= 3
               else "WAIT_MECHANIC_UNDERSPECIFIED")
    ctrl = next(r for r in rows if r["is_control"])

    # ---- THE BASE RATE, WITHOUT WHICH THE TALLY MEANS NOTHING -------------------------------
    # H-A came back 5/5, and taken at face value that names the repair lane. It should NOT be
    # taken at face value. The bot builds 53-69 entry locations per session and he marks TWO, so
    # only 1.5-4.4% of the machine's locations overlap one of his zones on any given day. Under
    # that base rate, ALL FIVE early trades missing his zones is the ~87%-likely outcome - the
    # tally is very nearly guaranteed by construction and carries almost no information.
    #
    # THE INFORMATIVE OBSERVATION IS THE ONE ON THE OTHER SIDE: the single agreeing day is the
    # day the bot fired AT his marked zone, which is a ~3% event per trade. The repair lane H-A
    # points at is probably right, but this is the argument that supports it - not the 5/5.
    rates = [r["base_rate_pct"] for r in rows if r.get("base_rate_pct") is not None]
    p_miss_all = 1.0
    for r in subject:
        p_miss_all *= (1.0 - (r["base_rate_pct"] or 0.0) / 100.0)

    out = {
        "artifact": "L1_TIMING_CLASSIFICATION",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-078 lane 1",
        "produced": "2026-08-24",
        "arm": ARM_NAME,
        "hypotheses_pre_registered": HYPOTHESES,
        "disposition_rule_pre_registered": (
            "3 or more of the 5 in one class NAMES the repair lane; otherwise "
            "WAIT_MECHANIC_UNDERSPECIFIED and the answer is outside-teachings research under "
            "HIS vocabulary - no predicate invented here"),
        "rows": rows,
        "tally_over_the_five_early_trades": tally,
        "VERDICT": verdict,
        "BASE_RATE_CAVEAT": {
            "base_rate_pct_range": [min(rates), max(rates)] if rates else None,
            "probability_all_five_miss_by_chance_pct": round(100.0 * p_miss_all, 1),
            "reading": (
                "The machine builds 50-70 entry locations per session and he marks TWO, so only "
                "a small percentage of its locations overlap one of his zones on any day. Under "
                "that base rate, all five early trades missing his zones is the OVERWHELMINGLY "
                "LIKELY outcome and the 5/5 tally is close to guaranteed by construction - it "
                "carries almost no information. THE INFORMATIVE OBSERVATION IS THE CONTROL: the "
                "one agreeing day is the day the bot fired AT a zone he marked, which is a "
                "low-probability event per trade. The repair lane H-A names is plausibly right, "
                "but THIS is the argument for it, not the tally."),
            "tally_is_evidence": False,
        },
        "control_session": CONTROL,
        "control_class": ctrl["CLASS"],
        "control_fires_after_him_minutes": ctrl["bot_is_early_by_minutes"],
        "no_predicate_minted_from_2026_labels": True,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== L1 TIMING CLASSIFICATION ===")
    for r in rows:
        tag = " [CONTROL]" if r["is_control"] else ""
        f = r["fired_trade"]
        print(f"\n{r['session']}{tag}  early={r['bot_is_early_by_minutes']}m  -> {r['CLASS']}")
        if f:
            print(f"   fired {f['entry_time'][11:16]} {f['direction']} {f['setup']} "
                  f"at {f['location_band']} ({f['location_source']})")
            print(f"      reason={f['reason']}")
        print(f"   his marked zones: {[z['band'] for z in r['his_marked_zones']]}")
        print(f"   matches a marked zone: {r['fired_level_matches_a_marked_zone']}")
    print(f"\ntally: {tally}")
    print(f"VERDICT: {verdict}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
