#!/usr/bin/env python3
"""ALGO-096 §7.2 — THE EARLY-BULLET CENSUS. One table. REPORT ONLY, no predicate, no repair.

On every convicted day the machine spends its one bullet BEFORE the operator's clock. §7.2 orders
the census of those five trades: the zone, its age and kind, the path that granted, every
magnitude cleared on the way with TAUGHT/UNTAUGHT status, and the taught structural clause each
would face in the teaching's own words.

ONE THING IS MEASURED HERE RATHER THAN INHERITED. ALGO-096 §4's last column calls these "Route D
pre-break trades". `setup` in the kernel is BRK5 / BRK15 / REV; `route` in `entry_authority` is
A/B/C/D. They are DIFFERENT TAXONOMIES and a label in one is not a fact in the other - the exact
join-key error ALGO-096 §6 minted a law about. So this census ASKS each of the four routes what it
would say about the same bars and reports which ones grant, rather than copying the label forward.

The taught clauses, verbatim, that a Route D story must satisfy (ALGO-009 §7.10-7.12):
    §7.10  a REAL initial test of the level
    §7.11  a MEANINGFUL reset away from it
    §7.12  a TRUE return attack
Each has its own refusal in `breakout_derivation.prebreak_repeat_test`, so a sequence missing one
cannot borrow another's evidence.

NO PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
"""
from __future__ import annotations

import io
import json
import sys
import time
from datetime import date, time as _time
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W
from research import current_mnq_strategy_v2_4_entry_authority as EA
from research import current_mnq_strategy_v2_4_breakout_derivation as brk
from research.current_mnq_strategy_v2_4_kernel import iter_actionable_candidates

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Early-bullet census. Lands nothing, proposes nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")

CONVICTED = ("2026-03-23", "2026-03-24", "2026-03-31", "2026-04-06", "2026-04-09")

#: Every magnitude a break-family story can clear, with its provenance stated once.
MAGNITUDES = {
    "reject_wick": ("0.35", "UNTAUGHT — v2.2 Params default; ALGO-071 §3 defines the rejection "
                            "wick as OHLC against the band, no fraction"),
    "acceptance_bars": ("3", "UNTAUGHT — the spec says DURABLE and names no count; declared in "
                             "breakout_derivation.UNFROZEN_CHOICES"),
    "body_frac": ("0.62", "UNTAUGHT — v2.2 default shipped with search range (0.56, 0.68)"),
    "close_loc": ("0.78", "UNTAUGHT — v2.2 default shipped with search range (0.72, 0.84)"),
    "range_ratio": ("1.25", "UNTAUGHT — v2.2 default; Route C only"),
}

TAUGHT_CLAUSES = {
    "7.10": "a REAL initial test of the level",
    "7.11": "a MEANINGFUL reset away from it",
    "7.12": "a TRUE return attack",
}


def _labels():
    man = {c["case_id"]: c["session"] for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def _zone_age(loc, when: pd.Timestamp) -> dict:
    """Zone birth is encoded in the id (SOURCE:SIDE:TIMESTAMP:seq). Parsed, never guessed."""
    raw = str(getattr(loc, "id", "") or "")
    parts = raw.split(":")
    born = None
    for i in range(len(parts)):
        cand = ":".join(parts[i:i + 3])
        try:
            born = pd.Timestamp(cand)
            break
        except (ValueError, TypeError):
            continue
    if born is None:
        return {"birth": None, "age_hours": None,
                "note": "birth not parseable from the id — reported, not guessed"}
    try:
        age = (when - born).total_seconds() / 3600.0
    except TypeError:
        return {"birth": str(born), "age_hours": None, "note": "tz mismatch, age not computed"}
    return {"birth": str(born), "age_hours": round(age, 1), "note": None}


def main() -> int:
    t0 = time.perf_counter()
    out_path = Path(sys.argv[1] if len(sys.argv) > 1 else "early_bullet_census.json")
    labels = _labels()
    cases = {c["session"]: c for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(_time(8, 0)):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = eng.Params()
        for session in CONVICTED:
            lab = labels[session]
            his = pd.Timestamp(lab["first_entry_time"])
            end = pd.Timestamp(cases[session]["replay_end"])
            dte = date.fromisoformat(session)

            first = None
            for cand, actionable, _plan in iter_actionable_candidates(env, dte, p, as_of=end):
                ent = eng.core.one_minute_entry(env["one"], actionable, cand.direction, p)
                if ent is None:
                    continue
                et, _epx, _ = ent
                if et > end or et.time() > eng.core.LAST_ENTRY:
                    continue
                if first is None or et < first[0]:
                    first = (et, cand, actionable)
            if first is None:
                rows.append({"session": session, "early_bullet": None,
                             "note": "no approved entry in window"})
                continue

            et, cand, actionable = first
            loc = getattr(cand, "location", None)
            bucket = et.floor("5min")

            # ASK EVERY ROUTE, rather than inheriting the `setup` label.
            bars = env["full5"][env["full5"].index <= bucket]
            per_route = {}
            if loc is not None and len(bars) >= 4:
                for route in EA.ROUTES:
                    kw = {}
                    if route == EA.ROUTE_C_PREBREAK_DISPLACEMENT:
                        kw["range_ratio"] = float(p.range_ratio)
                    try:
                        a = EA.decide(bars, cand.direction, float(loc.lo), float(loc.hi),
                                      location_authorized=True, force_confirmed=True,
                                      body_frac=float(p.body_frac), close_loc=float(p.close_loc),
                                      reject_wick=float(p.reject_wick), route=route, **kw)
                        per_route[route] = {"granted": bool(a.granted), "state": str(a.state),
                                            "refusal": (str(a.reason) if a.reason else None),
                                            "form": (str(a.form) if a.form else None)}
                    except Exception as exc:                      # noqa: BLE001
                        per_route[route] = {"error": f"{type(exc).__name__}: {exc}"}

                # Route D has TWO legal forms; name which one, and which taught clause each
                # would face. Reported per form, never merged into one verdict.
                completed, trigger = bars.iloc[:-1], bars.iloc[-1]
                accepted = brk.break_retest(completed, trigger, float(loc.lo), float(loc.hi),
                                            cand.direction, float(p.body_frac),
                                            float(p.close_loc), 3)
                repeat = brk.prebreak_repeat_test(completed, trigger, float(loc.lo),
                                                  float(loc.hi), cand.direction,
                                                  float(p.body_frac), float(p.close_loc),
                                                  float(p.reject_wick))
                d_detail = {
                    "accepted_break_retest": {"form": accepted.form, "refusal": accepted.refusal},
                    "prebreak_repeat_test": {"form": repeat.form, "refusal": repeat.refusal},
                }
            else:
                d_detail = {"note": "no location on the candidate, or too few completed bars"}

            rows.append({
                "session": session,
                "his_clock": str(his),
                "early_bullet_entry": str(et),
                "minutes_before_his_clock": round((his - et).total_seconds() / 60.0, 1),
                "direction": str(cand.direction),
                "kernel_setup": str(cand.setup),
                "candidate_reason": str(getattr(cand, "reason", "")),
                "zone": {
                    "id": (str(loc.id) if loc is not None else None),
                    "band": ([float(loc.lo), float(loc.hi)] if loc is not None else None),
                    "source": (str(getattr(loc, "source", "")) if loc is not None else None),
                    "side": (str(getattr(loc, "side", "")) if loc is not None else None),
                    **(_zone_age(loc, et) if loc is not None else {}),
                },
                "authority_by_route_MEASURED": per_route,
                "route_D_forms": d_detail,
            })

    out = {
        "artifact": "EARLY_BULLET_CENSUS",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-096 §7.2",
        "magnitudes_a_break_family_story_can_clear": MAGNITUDES,
        "taught_clauses_ALGO_009": TAUGHT_CLAUSES,
        "join_key_warning": (
            "`kernel_setup` (BRK5/BRK15/REV) and `authority route` (A/B/C/D) are DIFFERENT "
            "taxonomies. This census asks every route directly instead of copying the setup "
            "label forward, because a label in one taxonomy is not a fact in the other."),
        "rows": rows,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== EARLY-BULLET CENSUS (report only) ===")
    for r in rows:
        if not r.get("early_bullet_entry"):
            print("\n" + r["session"] + ": " + str(r.get("note")))
            continue
        z = r["zone"]
        print("\n" + r["session"] + "  bullet " + r["early_bullet_entry"][11:16]
              + "  " + r["direction"] + "  setup=" + r["kernel_setup"]
              + "   " + str(r["minutes_before_his_clock"]) + " min before his "
              + r["his_clock"][11:16])
        print("    zone " + str(z.get("id")) + "  " + str(z.get("band"))
              + "  age " + str(z.get("age_hours")) + "h  source=" + str(z.get("source")))
        for route, v in sorted(r["authority_by_route_MEASURED"].items()):
            if v.get("granted"):
                print("    GRANTS  " + route + "  form=" + str(v.get("form")))
            elif v.get("error"):
                print("    error   " + route + "  " + v["error"])
            else:
                print("    refuses " + route + "  " + str(v.get("refusal"))[:70])
        d = r["route_D_forms"]
        if "accepted_break_retest" in d:
            print("    D-forms: accepted_break=" + str(d["accepted_break_retest"]["refusal"]
                                                       or d["accepted_break_retest"]["form"]))
            print("             repeat_test  =" + str(d["prebreak_repeat_test"]["refusal"]
                                                      or d["prebreak_repeat_test"]["form"]))
    print("\nwrote " + str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
