#!/usr/bin/env python3
"""THE R-C-ONLY BATCH REPORT. HYPOTHETICAL - NOTHING LANDS, NO PRODUCTION FILE IS TOUCHED.

ALGO-087. Everything else is retracted and only ONE conviction survives: TIMING. The bot spends
its bullet 46 minutes to 3 hours early at stale structure. R-C is the whole batch:

    A bullet may be spent only at a FRESH zone - no COMPLETED bar has traded into the zone's
    band between the zone's BIRTH and the decision clock.

Cited: outside teachings under his vocabulary (ALGO-082) - untested levels are the strong ones,
each touch consumes resting orders, first touch is the highest-probability reaction. Zones from
5m/15m only (ALGO-086). NO target-layer change of any kind.

TAUGHT EXCEPTIONS ARE ENUMERATED WITH THEIR CITATION AND WITH THE REASON THEY ARE NOT ARBITRARY.
Two entry stories are SECOND-VISIT STORIES BY CONSTRUCTION, so requiring freshness of them would
delete the taught form rather than discipline it:

  ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE   ALGO-009 Route D - broken, ACCEPTED, then RETESTED.
                                            A retest IS a second visit.
  PREBREAK_REPEAT_TEST_INTRA5_FORCE         ALGO-009 exception 2 - prior test, reset, return
                                            attack. The prior test is the story's own premise.

AND ONE THAT IS DELIBERATELY *NOT* AN EXCEPTION, because the distinction matters:
  the addendum's `processed_reaction_continuation` governs the TARGET area - "after the nearby
  TP/reaction area has actually been interacted with" - it is a TP-rollover rule, not a
  statement about the ENTRY zone. Importing it here would exempt FIRST_BREAK_PRINT as well and
  leave R-C with nothing to bite on. It is named here so its exclusion is visible and checkable
  rather than silent.

WHAT THIS REPORT EXPECTS TO FIND, AND WHY THAT IS UNCOMFORTABLE. Four of the five convicted
early trades fire on the two exempt stories (03-23 and 03-24 on repeat-test, 03-31 and 04-09 on
accepted-break retest). Only 04-06 fires on FIRST_BREAK_PRINT - and THE CONTROL 04-14 FIRES ON
THAT SAME STORY. So R-C can bite on exactly one convicted trade, using the one story it shares
with the control it must preserve. If that is what the numbers say, R-C fails its own
pre-registration and the report says so; the exceptions are NOT narrowed to manufacture a pass,
because narrowing a taught exception to hit a target is fitting.

PRE-REGISTERED BY ALGO-087:
  (a) 04-14's approved entry SURVIVES
  (b) the five convicted early trades are REFUSED, with per-trade freshness evidence
  (c) NO target-layer change of any kind
  (d) every net addition passes the ALGO-070 clause walk

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

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Hypothetical R-C-only batch. Lands nothing, touches no production file."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
OUT = Path("research/current_mnq_strategy_v2_4_rc_only_batch_report_2026_08_24.json")

ARM_START = _time(8, 0)
CONTROL = "2026-04-14"

CONVICTED_EARLY = (("2026-03-23", "08:14", "S"), ("2026-03-24", "08:17", "S"),
                   ("2026-03-31", "09:03", "L"), ("2026-04-06", "09:07", "S"),
                   ("2026-04-09", "09:37", "L"))

RC_TAUGHT_EXCEPTIONS = {
    "ACCEPTED_BREAK_RETEST_THEN_INTRA5_FORCE": (
        "ALGO-009 Route D: broken, ACCEPTED, then RETESTED as the opposite role. A retest is a "
        "second visit by construction, so freshness cannot be required without deleting it."),
    "PREBREAK_REPEAT_TEST_INTRA5_FORCE": (
        "ALGO-009 exception 2: prior test -> reset -> return attack. The prior test is the "
        "story's own premise."),
}
NOT_AN_EXCEPTION = {
    "processed_reaction_continuation": (
        "trader_fidelity_addendum_2026_08_20. It governs the TARGET area after that area has "
        "been interacted with - a TP-rollover rule, NOT a statement about the ENTRY zone. "
        "Named here so its EXCLUSION is visible; importing it would exempt FIRST_BREAK_PRINT "
        "and leave R-C with nothing to bite on."),
}


def _completed_bars_in_band(full5, lo, hi, since, until):
    if full5 is None or len(full5) == 0:
        return []
    win = full5[(full5.index >= since) & (full5.index < until)]
    hits = []
    for t, r in win.iterrows():
        if t + pd.Timedelta(minutes=5) > until:
            continue
        if float(r.low) <= hi and float(r.high) >= lo:
            hits.append({"bucket": str(t), "ohlc": [float(r.open), float(r.high),
                                                    float(r.low), float(r.close)]})
    return hits


def _zone_birth(loc):
    raw = str(getattr(loc, "id", "") or "")
    parts = raw.split(":")
    for i in range(len(parts)):
        cand = ":".join(parts[i:i + 3])
        if "T" in cand and "-" in cand:
            try:
                return pd.Timestamp(cand)
            except Exception:
                continue
    return None


def _approved(env, dte, p, end, rc: bool):
    rows = []
    one, full5 = env["one"], env["full5"]
    for cand, actionable, _plan in iter_actionable_candidates(env, dte, p, as_of=end):
        ent = eng.core.one_minute_entry(one, actionable, cand.direction, p)
        if ent is None:
            continue
        et, epx, _ = ent
        if et > end or et.time() > eng.core.LAST_ENTRY:
            continue
        reason = str(cand.reason)
        rc_note = None
        if rc:
            if reason in RC_TAUGHT_EXCEPTIONS:
                rc_note = {"exempt": True, "story": reason,
                           "citation": RC_TAUGHT_EXCEPTIONS[reason]}
            elif cand.location is not None:
                birth = _zone_birth(cand.location)
                hits = ([] if birth is None else
                        _completed_bars_in_band(full5, float(cand.location.lo),
                                                float(cand.location.hi), birth, et))
                rc_note = {"exempt": False, "story": reason,
                           "zone_birth": (str(birth) if birth is not None else None),
                           "completed_bars_in_band_since_birth": len(hits),
                           "evidence": hits[:3], "fresh": (not hits)}
                if hits:
                    rows.append({
                        "key": [str(dte), str(et), str(cand.direction), str(cand.setup)],
                        "REFUSED_BY": "R_C_ZONE_NOT_FRESH", "rc": rc_note,
                        "location_id": str(getattr(cand.location, "id", "")),
                        "location_band": [float(cand.location.lo), float(cand.location.hi)],
                    })
                    continue
        picked, path_reason = build_and_classify(
            env["piv5"], full5, env["h15"], et, p, env["pdm"], env["pwm"], dte,
            float(epx), cand.direction, cand.setup, cand.setup == "BRK5",
            piv15=env["piv15"], entry_location=cand.location, candidate_reason=cand.reason)
        if picked is None:
            continue
        rows.append({
            "key": [str(dte), str(et), str(cand.direction), str(cand.setup)],
            "target": round(float(picked.executable_price), 2),
            "target_kind": str(getattr(picked, "kind", "")),
            "path_reason": str(path_reason), "candidate_reason": reason,
            "location_id": str(getattr(cand.location, "id", "")) if cand.location else None,
            "rc": rc_note,
        })
    return rows


def main() -> int:
    t0 = time.perf_counter()
    man = {c["session"]: c for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    baseline, batch = {}, {}
    with W.trading_window(ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = eng.Params()
        for s in sorted(man):
            dte = date.fromisoformat(s)
            end = pd.Timestamp(man[s]["replay_end"])
            baseline[s] = _approved(env, dte, p, end, rc=False)
            batch[s] = _approved(env, dte, p, end, rc=True)

    kb = {tuple(r["key"]) for s in baseline for r in baseline[s] if "target" in r}
    kt = {tuple(r["key"]) for s in batch for r in batch[s] if "target" in r}
    tb = {tuple(r["key"]): r for s in baseline for r in baseline[s] if "target" in r}
    tt = {tuple(r["key"]): r for s in batch for r in batch[s] if "target" in r}
    refused = [r for s in batch for r in batch[s] if r.get("REFUSED_BY")]

    # (c) NO target-layer change: every surviving approval keeps its exact target
    target_changes = [k for k in sorted(kb & kt) if tb[k]["target"] != tt[k]["target"]]

    ctrl_pre = [r for r in baseline.get(CONTROL, []) if "target" in r]
    ctrl_post = [r for r in batch.get(CONTROL, []) if "target" in r]
    ctrl_ok = len(ctrl_post) >= 1 and len(ctrl_post) == len(ctrl_pre)

    convicted = []
    for sess, clock, direction in CONVICTED_EARLY:
        hit = next((r for r in batch.get(sess, [])
                    if r["key"][1][11:16] == clock and r["key"][2] == direction), None)
        convicted.append({
            "session": sess, "clock": clock, "direction": direction,
            "story": (hit or {}).get("candidate_reason") or (hit or {}).get("rc", {}).get("story"),
            "refused_by": (hit or {}).get("REFUSED_BY"),
            "exempt_by_taught_story": bool((hit or {}).get("rc", {}).get("exempt")),
            "freshness_evidence": (hit or {}).get("rc"),
            "still_approved": bool(hit and "target" in hit),
        })
    refused_count = sum(1 for c in convicted if c["refused_by"])

    out = {
        "artifact": "RC_ONLY_BATCH_REPORT",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-087",
        "produced": "2026-08-24",
        "nothing_landed": True,
        "rc_taught_exceptions": RC_TAUGHT_EXCEPTIONS,
        "deliberately_NOT_an_exception": NOT_AN_EXCEPTION,
        "pre_registered": {
            "a_control_entry_survives": ctrl_ok,
            "b_five_convicted_refused": f"{refused_count}/5",
            "c_no_target_layer_change": (len(target_changes) == 0),
        },
        "approved_baseline": len(kb),
        "approved_with_RC": len(kt),
        "entries_REMOVED_by_RC": sorted(list(k) for k in (kb - kt)),
        "entries_ADDED_by_RC": sorted(list(k) for k in (kt - kb)),
        "target_changes": [list(k) for k in target_changes],
        "refused_by_RC_count": len(refused),
        "refused_by_RC": refused[:40],
        "convicted_early_trades": convicted,
        "baseline_rows": baseline,
        "batch_rows": batch,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== R-C-ONLY BATCH REPORT (hypothetical) ===")
    print(f"approved: baseline {len(kb)} -> with R-C {len(kt)}   "
          f"removed {len(kb - kt)}  added {len(kt - kb)}  refused {len(refused)}")
    print("\nPRE-REGISTERED:")
    print(f"  (a) control entry survives      : {ctrl_ok}  "
          f"({len(ctrl_pre)} -> {len(ctrl_post)})")
    print(f"  (b) five convicted refused      : {refused_count}/5")
    for c in convicted:
        tag = "EXEMPT" if c["exempt_by_taught_story"] else (c["refused_by"] or "still approved")
        print(f"        {c['session']} {c['clock']} {c['direction']}  {c['story']}  -> {tag}")
    print(f"  (c) no target-layer change      : {len(target_changes) == 0} "
          f"({len(target_changes)} changes)")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
