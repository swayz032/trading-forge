#!/usr/bin/env python3
"""ALGO-105 — THE BREAK-FAMILY BULLET CENSUS. The five baseline approvals that spend the one
daily trade BEFORE the operator's own entry clock.

REPORT ONLY. No predicate proposed, no repair, nothing lands.

WHY THIS IS NOW THE CRITICAL PATH. T3'' converted two sessions to agreement against the frozen
anchor at the 09:30 window and could not carry them to the deployed 08:00 window, because at
08:00 the bullet is already spent when his clock arrives (`BUDGET_CONSUMED_BEFORE_WINDOW: 6`,
13 sessions hiding 23 unreachable in-window entries). On 03-24 the spender is `08:17 S BRK5`.
Every one of these five is BREAK-FAMILY, so no story-control clause can reach them.

WHAT IS MEASURED, per approval: the bar, the zone and its ADMISSION PATH, the granting ROUTE
taken verbatim from the kernel's own `candidate_reason`, and then EVERY MAGNITUDE the granting
route consults — with its frozen value, the MEASURED value on that bar, the MARGIN by which it
cleared, and its CITATION STATUS.

THE MARGIN IS THE POINT. A magnitude that refuses nothing is not load-bearing; a magnitude that
cleared by 0.01 decided the trade. Neither is visible from a pass/fail.

CITATION STATUS is stated as "no citation found in the surfaces named", never as proof of
absence, and the surfaces are named in the artifact — the loaded `key_level_semantics.json`
FIRST, per ALGO-102B.

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
from research.current_mnq_strategy_v2_4_force import force_snapshot
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session
from research.current_mnq_strategy_v2_4_entries import _geom

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Break-family bullet census. Lands nothing, proposes nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
BASELINE = Path("research/_algo096_guard_2026_08_24/revert_40_0800.json")

HIS_CLOCK = {
    "2026-03-23": "11:21", "2026-03-24": "09:32", "2026-03-31": "09:49",
    "2026-04-06": "10:04", "2026-04-09": "11:35",
}

#: Every magnitude a break-family grant can consult, with provenance stated once. Surfaces
#: searched, named: the LOADED `key_level_semantics.json` first, then `spec.json`,
#: `video_evidence.md`, `supporting_visual_examples.md`, `trader_fidelity_addendum`,
#: `engineer_onboarding.md`, `fvg_semantics.json`, and the ALGO ladder.
PROVENANCE = {
    "reject_wick": ("Params default 0.35",
                    "UNTAUGHT — ALGO-071 §3 defines a rejection as OHLC against the band, no "
                    "fraction. Retired from Route A; STILL LIVE in the break family."),
    "acceptance_bars": ("breakout_derivation.UNFROZEN_CHOICES = 3",
                        "UNTAUGHT — the spec says DURABLE and names no count; declared unfrozen "
                        "by the module itself."),
    "body_frac": ("Params default 0.62",
                  "UNTAUGHT — v2.2 default shipped with search range (0.56, 0.68). Retired from "
                  "Route A's story gate by ALGO-071 §3; STILL LIVE in every break-family trigger."),
    "close_loc": ("Params default 0.78",
                  "UNTAUGHT — v2.2 default shipped with search range (0.72, 0.84). Same status."),
    "range_ratio": ("Params default 1.25", "UNTAUGHT — v2.2 default; Route C only."),
    "min_wick": ("Params default 0.20",
                 "UNTAUGHT — gates the EXCEPTIONAL single-swing admission path "
                 "(key_level_semantics.exceptional_single_swing_path)."),
    "absolute_displacement_floor_atr": (
        "key_level_semantics = 1.0",
        "UNTAUGHT as a VALUE, though the CLAUSE is in the loaded spec; ALGO-064 §2's M1 lane."),
    "recent_displacement_percentile": (
        "key_level_semantics = 0.75",
        "UNTAUGHT as a VALUE. A percentile admits a fixed PROPORTION of the recent distribution "
        "by construction, so map size is pinned to the distribution rather than to whether the "
        "market offered levels."),
    "EXTREME_TAKE_OUT": ("no constant",
                         "TAUGHT and magnitude-free — §7.7, `trigger.high > first.high`."),
    "ACCEPTED_CLOSE_BEYOND": ("no constant",
                              "TAUGHT and magnitude-free — a completed close past the band."),
}

#: kernel `candidate_reason` -> the breakout_derivation form that granted, and the magnitudes
#: that form consults on the way.
ROUTE_MAGNITUDES = {
    "PREBREAK_REPEAT_TEST_INTRA5_FORCE": (
        "Route D · prebreak_repeat_test (§7.10-7.12)",
        ["reject_wick", "body_frac", "close_loc"]),
    "ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE": (
        "Route D · break_retest (accepted break, then retest)",
        ["acceptance_bars", "ACCEPTED_CLOSE_BEYOND", "body_frac", "close_loc"]),
    "FIRST_BREAK_PRINT_THEN_INTRA5_FORCE": (
        "Route B · normal_breakout (§7.6-7.7)",
        ["EXTREME_TAKE_OUT", "body_frac", "close_loc"]),
}

#: location source -> the admission path and the magnitudes that gate it.
ADMISSION = {
    "WICK_ZONE": ("causal_15m_repeated_rejection_support_resistance (PRIMARY evidence)", []),
    "STRONG_SWING_DISPLACEMENT": (
        "causal_exceptional_single_swing_support_resistance (the EXCEPTIONAL path)",
        ["min_wick", "absolute_displacement_floor_atr", "recent_displacement_percentile"]),
}


def _momentum_margins(row, direction: str, p) -> dict:
    """How close the trigger came to FAILING `_momentum`. A margin, not a verdict."""
    g = _geom(row)
    bf_req, cl_req = float(p.body_frac), float(p.close_loc)
    cl_meas = g.close_loc if direction == "L" else 1.0 - g.close_loc
    return {
        "body_frac": {"required": bf_req, "measured": round(g.body_frac, 4),
                      "margin": round(g.body_frac - bf_req, 4),
                      "cleared": bool(g.body_frac >= bf_req)},
        "close_loc": {"required": cl_req, "measured": round(cl_meas, 4),
                      "margin": round(cl_meas - cl_req, 4),
                      "cleared": bool(cl_meas >= cl_req)},
    }


def main() -> int:
    t0 = time.perf_counter()
    out_path = Path(sys.argv[1] if len(sys.argv) > 1
                    else "break_family_bullet_census.json")

    base = json.load(io.open(BASELINE, encoding="utf-8"))
    for k in [k for k in base if k.startswith("__") and k.endswith("__")]:
        base.pop(k)

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows = []
    with W.trading_window(_time(8, 0)):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = eng.Params()
        full5 = env["full5"]
        for session in sorted(HIS_CLOCK):
            approvals = sorted(base.get(session, []), key=lambda r: str(r["key"][1]))
            if not approvals:
                rows.append({"session": session, "note": "no approval in the baseline"})
                continue
            a = approvals[0]
            et = pd.Timestamp(a["key"][1])
            direction = str(a["key"][2])
            bucket = et.floor("5min")
            reason = str(a.get("candidate_reason") or "")
            route, mags = ROUTE_MAGNITUDES.get(reason, ("(unmapped reason)", []))
            src = str(a.get("entry_location_source") or "")
            adm, adm_mags = ADMISSION.get(src, ("(unmapped source)", []))

            # THE TRIGGER IS THE FORCE PARTIAL, NOT THE COMPLETED 5m BAR.
            # My first pass read `full5` at the bucket and reported that FOUR of the five
            # approvals "did not clear" `_momentum` - which is impossible, because they
            # were APPROVED. The instrument refuted itself. `entry_authority` reads the
            # still-FORMING candle assembled from completed 1m sub-bars
            # (`candidate_xray`: `partial = force.as_row(atr_ref)`), so a margin taken on
            # the completed 5m bar is the neighbouring object.
            upto = full5[full5.index <= bucket]
            # THE GRANT'S OWN DECISION CLOCK, from the X-ray's granting record - not the
            # first confirmation. `first_force_confirmation` returns the EARLIEST confirmed
            # snapshot, which for two of these five is a different minute from the one the
            # candidate was granted at; taking it produced margins that said an APPROVED
            # entry "did not clear" - self-contradictory, so the clock was wrong.
            recs = xray_session(env, date.fromisoformat(session), p)["records"]
            grant = next((r for r in recs
                          if r.get("outcome") == "SURVIVED_TO_RANKING"
                          and str(r.get("location_id")) == str(a.get("entry_location_id"))
                          and r.get("direction") == direction
                          and r.get("bucket") is not None
                          and pd.Timestamp(r["bucket"]) == bucket), None)
            clock = pd.Timestamp(grant["clock"]) if grant else None
            snap = (force_snapshot(env["one"], bucket, 5, direction, clock, p)
                    if clock is not None else None)
            trigger = snap.as_row() if snap is not None else None
            g = _geom(trigger) if trigger is not None else None

            rows.append({
                "session": session,
                "his_clock": HIS_CLOCK[session],
                "bullet_entry": str(et),
                "minutes_before_his_clock": round(
                    (pd.Timestamp(f"{session} {HIS_CLOCK[session]}", tz=et.tz) - et
                     ).total_seconds() / 60.0, 1),
                "direction": direction,
                "kernel_setup": str(a["key"][3]),
                "candidate_reason": reason,
                "granting_route": route,
                "zone": {
                    "id": a.get("entry_location_id"),
                    "band": a.get("entry_location_band"),
                    "side": a.get("entry_location_side"),
                    "source": src,
                    "admission_path": adm,
                    "state_at_bucket": a.get("zone_state_at_bucket"),
                },
                "trigger_bar": ({"kind": ("FORCE PARTIAL from completed 1m sub-bars — the bar "
                                          "entry_authority actually reads"),
                                 "grant_decision_clock": str(clock) if clock is not None else None,
                                 "clock_source": ("X-ray SURVIVED_TO_RANKING record"
                                                  if grant else "NOT FOUND - margins withheld"),
                                 "completed_1m": snap.completed_1m if snap else None,
                                 "open": float(trigger.open), "high": float(trigger.high),
                                 "low": float(trigger.low), "close": float(trigger.close),
                                 "body_frac": round(g.body_frac, 4),
                                 "close_loc": round(g.close_loc, 4)}
                                if trigger is not None else None),
                "magnitudes_on_the_granting_route": [
                    {"name": m, "frozen": PROVENANCE[m][0], "citation_status": PROVENANCE[m][1]}
                    for m in mags],
                "magnitudes_on_the_admission_path": [
                    {"name": m, "frozen": PROVENANCE[m][0], "citation_status": PROVENANCE[m][1]}
                    for m in adm_mags],
                "trigger_momentum_margins": (_momentum_margins(trigger, direction, p)
                                             if trigger is not None else None),
                "target": a.get("target"), "target_kind": a.get("target_kind"),
            })

    untaught = sorted({m["name"] for r in rows for key in
                       ("magnitudes_on_the_granting_route", "magnitudes_on_the_admission_path")
                       for m in r.get(key, [])
                       if m["citation_status"].startswith("UNTAUGHT")})
    out = {
        "artifact": "BREAK_FAMILY_BULLET_CENSUS",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-105 — the 08:17 S BRK5 object, opened as a census",
        "horizon": ("baseline approvals read from the field-enabled 40-capture at "
                    "as_of=replay_end; bars read directly from the 5m frame"),
        "surfaces_searched_for_citations": [
            "current_mnq_strategy_v2_4_key_level_semantics.json (THE FILE THE CODE LOADS — first)",
            "current_mnq_strategy_v2_4_spec.json", "video_evidence.md",
            "supporting_visual_examples.md", "trader_fidelity_addendum_2026_08_20.json",
            "engineer_onboarding.md", "fvg_semantics.json", "the ALGO ladder",
        ],
        "citation_status_note": ("stated as 'no citation found in the surfaces named', never as "
                                 "proof of absence (ALGO-087)"),
        "distinct_untaught_magnitudes_on_these_five_grants": untaught,
        "rows": rows,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== BREAK-FAMILY BULLET CENSUS (report only) ===\n")
    for r in rows:
        if "zone" not in r:
            print(f"{r['session']}: {r.get('note')}\n"); continue
        print(f"{r['session']}  bullet {r['bullet_entry'][11:16]} {r['direction']} "
              f"{r['kernel_setup']}   {r['minutes_before_his_clock']:.0f} min before his "
              f"{r['his_clock']}")
        print(f"    route     {r['granting_route']}")
        print(f"    zone      {r['zone']['id']}   state={r['zone']['state_at_bucket']}")
        print(f"    admission {r['zone']['admission_path']}")
        mm = r.get("trigger_momentum_margins") or {}
        for k, v in mm.items():
            flag = "" if v["cleared"] else "   *** DID NOT CLEAR ***"
            print(f"    {k:<10} required {v['required']}  measured {v['measured']}  "
                  f"margin {v['margin']:+}{flag}")
        names = [m["name"] for m in r["magnitudes_on_the_granting_route"]]
        anames = [m["name"] for m in r["magnitudes_on_the_admission_path"]]
        print(f"    magnitudes route={names}  admission={anames}\n")
    print(f"distinct UNTAUGHT magnitudes across these five grants: {untaught}")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
