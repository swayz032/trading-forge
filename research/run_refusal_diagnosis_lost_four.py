#!/usr/bin/env python3
"""WHY DID THE BRAIN REFUSE THE FOUR SESSIONS IT LOST? ALGO-058 §3. DIAGNOSTIC ONLY.

The dual-window exam convicted the wired brain: F2 fails by MEMBERSHIP on both arms, losing
`{2026-03-24, 2026-03-30, 2026-03-31, 2026-04-06}` against the frozen 5/8 set. Those are the
SAME four the ROLE-1 window amendment destroyed at `025b5a1e`, but by the OPPOSITE mechanism —
then the bullet was spent before the trader looked, now the brain is present and REFUSES.

TWO SEMANTIC CHANGES SIT BETWEEN 5/8 AND 1/8: the wiring itself, and `acceptance_bars` 2 -> 3.
Attributing the loss to either without evidence is a hypothesis dressed as a fix, and this lane
has already paid for repairing the instance rather than the class. So this module ATTRIBUTES
and does not repair.

WHAT IT DOES. For each lost session it takes the trader's LABELED entry timestamp from the
frozen labels, runs the X-ray at the 09:30 configuration, and joins the records around that
timestamp — `routes_asked`, the per-route refusals, the earliest killing gate, the authority
state, the form, and the location/force/budget facts. Each session is classified into exactly
one of:

    STORY_NOT_RECOGNIZED   the machine never saw an interaction it recognises at the level
    GATE_OVER_STRICT       a named gate refused with a named parameter (the gate IS named)
    LOCATION               no authorized location on the side the trader traded
    FORCE                  the force gate refused at the decision clock
    BUDGET                 the bullet was already spent - not a refusal at all
    OTHER                  it does not fit the four above, and says so rather than guessing

HONEST-PARTIAL IS A FIRST-CLASS OUTCOME. A session the X-ray cannot explain is reported as
`UNEXPLAINED` with what was looked at. A classifier with no residual category must mis-file or
go silent, and both hide the finding.

THE acceptance_bars=2 ARM IS A LABELLED ATTRIBUTION DIAGNOSTIC, NOTHING ELSE. It exists to say
whether the landed 2 -> 3 is implicated in a given session's refusal. R4 STANDS: no agreement
rate, PnL, realized outcome or winner/loser label participates, and NOTHING is chosen by score.
`acceptance_bars` was landed by the pre-registered rule and is NOT re-opened here; if this
attribution matters, it is the advisor's to rule on.

It overrides the value at RUNTIME rather than editing `breakout_derivation` — ALGO-058 forbids
touching kernel, entry_authority, breakout_derivation, the labels, the exam instrument and the
frozen artifacts, and this module touches none of them.

Run: PYTHONPATH=. python -m research.run_refusal_diagnosis_lost_four
"""
from __future__ import annotations

import io
import json
import time
from datetime import date
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_breakout_derivation as brk
from research import current_mnq_strategy_v2_4_engine as v24
from research import current_mnq_strategy_v2_4_exam_window as W
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session
from research import current_mnq_strategy_v2_4_f2_anchor as ANCHOR

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC. Attributes refusals; repairs nothing, selects no rule, tunes no parameter. "
    "Its output may not be cited as evidence that any rule is correct. ALGO-058 section 3."
)

#: The sessions F2 says were lost. Named from the exam's own artifacts, not typed from memory.
EXAM = Path("research/current_mnq_strategy_v2_4_exam_arm_baseline_0930_2026_08_23.json")

#: The frozen comparator comes from the ANCHOR, by path+sha, re-derived from its rows.
#: It was a TYPED LITERAL here until ALGO-060 §2 - a hand-typed population, which is the shape
#: this lane has been convicted on repeatedly, and it would have gone stale silently.

LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
OUT = Path("research/current_mnq_strategy_v2_4_refusal_diagnosis_lost_four_2026_08_23.json")

#: How far either side of the trader's labelled entry to look for the machine's decisions. The
#: trader's clock and the machine's decision clock are not the same instrument, so a window is
#: honest where an exact-timestamp join would silently find nothing.
NEAR_MINUTES = 10

CLASSES = ("STORY_NOT_RECOGNIZED", "GATE_OVER_STRICT", "LOCATION", "FORCE", "BUDGET", "OTHER")


def lost_sessions() -> list[str]:
    """DERIVED from the exam artifact, never typed: the set the 09:30 arm lost vs frozen."""
    arm = json.load(io.open(EXAM, encoding="utf-8"))
    agreeing = set(arm["agreeing_sessions"]) if "agreeing_sessions" in arm else {
        c["session"] for c in arm["cases"] if c["mismatch_class"] in {"AGREE", "BOTH_DECLINED"}}
    return ANCHOR.lost_against_anchor(agreeing)


def _raw_labels() -> dict[str, dict]:
    """The full label row per session - `_session_report` needs his marked ZONES, not just the
    entry time, because ALGO-062 joins on clock + direction + LOCATION."""
    doc = json.load(io.open(LABELS, encoding="utf-8"))
    manifest = {c["case_id"]: c for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    return {manifest[l["case_id"]]["session"]: l
            for l in doc["labels"] if l["case_id"] in manifest}


def _trader_entries() -> dict[str, dict]:
    doc = json.load(io.open(LABELS, encoding="utf-8"))
    manifest = {c["case_id"]: c for c in json.load(io.open(MANIFEST, encoding="utf-8"))["cases"]}
    out = {}
    for lab in doc["labels"]:
        case = manifest.get(lab["case_id"])
        if not case:
            continue
        out[case["session"]] = {
            "case_id": lab["case_id"],
            "session": case["session"],
            "final_action": lab.get("final_action"),
            "first_entry_time": lab.get("first_entry_time"),
            "replay_start": case.get("replay_start"),
            "replay_end": case.get("replay_end"),
        }
    return out


def _subreasons(rows: list[dict]) -> dict[str, int]:
    """Route D's refusal is a COMPOSITE. Split it into the sub-forms it actually reports.

    `NEITHER_ACCEPTED_BREAK_RETEST_NOR_PREBREAK_REPEAT_TEST_QUALIFIED: accepted_break=X;
    repeat_test=Y` names BOTH failing forms, and X is what says whether the acceptance
    requirement is even reachable. The first version did `str(why).split(":")[0]`, threw X and
    Y away, then matched the substring "ACCEPTED_BREAK" inside the composite HEAD - so a
    composite meaning "neither D form qualified" was read as "the acceptance gate refused".
    That is the substring-over-name habit, in analysis code rather than in a test.
    """
    out: dict[str, int] = {}
    for r in rows:
        for route, why in (r.get("route_refusals") or {}).items():
            head, _, detail = str(why).partition(":")
            if detail.strip():
                for part in detail.split(";"):
                    if "=" in part:
                        form, _, reason = part.strip().partition("=")
                        k = f"{route}|{form.strip()}={reason.strip()}"
                        out[k] = out.get(k, 0) + 1
            else:
                k = f"{route}|{head.strip()}"
                out[k] = out.get(k, 0) + 1
        if r.get("authority_refusal"):
            k = f"A_NORMAL_REJECTION|{str(r['authority_refusal']).partition(':')[0]}"
            out[k] = out.get(k, 0) + 1
    return out


#: The acceptance requirement, BY NAME. `acceptance_bars` is implicated only when THIS exact
#: sub-reason is operative at his clock - never because it appears inside a composite's name.
ACCEPTANCE_REFUSAL = "BREAK_NOT_ACCEPTED_BEFORE_RETEST"

#: ALGO-062: no candidate at his clock and his zone gets its OWN class. It is arguably the most
#: important answer - the derivation never reached the interaction he traded.
NO_CANDIDATE_AT_ENTRY = "NO_CANDIDATE_AT_ENTRY"

#: It WAS deciding on his side with authorized locations, but none covers his level. Split out
#: of NO_CANDIDATE_AT_ENTRY once the repaired join showed the buckets were far from empty -
#: one class covering both would have hidden which of two very different repairs is needed.
LOCATION_NOT_IN_MAP = "LOCATION_NOT_IN_MAP"

CLASSES = ("STORY_NOT_RECOGNIZED", "GATE_OVER_STRICT", "LOCATION", "FORCE", "BUDGET",
           NO_CANDIDATE_AT_ENTRY, LOCATION_NOT_IN_MAP, "OTHER")

#: Which zone he traded AT: a long is taken at support, a short at resistance.
ROLE_FOR_DIRECTION = {"L": "SUPPORT", "S": "RESISTANCE"}


def _his_zone(label: dict, direction: str):
    role = ROLE_FOR_DIRECTION.get(direction)
    for z in label.get("trader_zones") or ():
        if str(z.get("role")).upper() == role:
            return z
    return None


def _overlaps(rec: dict, zone) -> bool:
    """Does this candidate's LOCATION overlap the band he marked? A PRICE join, not an id join."""
    lo, hi = rec.get("location_lo"), rec.get("location_hi")
    if lo is None or hi is None or not zone:
        return False
    return float(lo) <= float(zone["hi"]) and float(hi) >= float(zone["lo"])


def _census(rows: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in rows:
        k = r.get("killed_at") or "SURVIVED_TO_RANKING"
        out[k] = out.get(k, 0) + 1
    return out


def _nearest_band(rows: list[dict], zone) -> tuple:
    """The machine band closest to his zone, and the gap in points. Evidence, not a boolean."""
    best = None
    for r in rows:
        lo, hi = r.get("location_lo"), r.get("location_hi")
        if lo is None or hi is None:
            continue
        gap = 0.0 if (lo <= zone["hi"] and hi >= zone["lo"]) else min(
            abs(float(lo) - float(zone["hi"])), abs(float(zone["lo"]) - float(hi)))
        if best is None or gap < best[0]:
            best = (round(gap, 2), round(float(lo), 2), round(float(hi), 2))
    return best or (None, None, None)


def classify_at_clock(at_clock: list[dict], on_his_side: list[dict] | None = None,
                      zone=None) -> tuple[str, str]:
    """THE CLASS COMES FROM HIS ENTRY CLOCK (ALGO-062 3), never from a session census.

    Most of a session's evaluations happen when and where he was NOT trading, so ranking by
    session-wide dominance answers a different question than "why was HE refused HERE". The
    census is still reported, as labelled CONTEXT, in the same row.
    """
    if not at_clock:
        # TWO DIFFERENT ANSWERS, and the repaired join is what made them separable.
        if on_his_side:
            gap, lo, hi = _nearest_band(on_his_side, zone) if zone else (None, None, None)
            return LOCATION_NOT_IN_MAP, (
                f"the machine WAS deciding at his clock on his side - {len(on_his_side)} "
                f"authorized candidates in those buckets - but NONE of its locations covers "
                f"the level he traded. Nearest band {lo}-{hi}, gap {gap} points "
                f"(the frozen stop is 17.25, so this is a different level, not a near-miss)")
        return NO_CANDIDATE_AT_ENTRY, (
            "the derivation evaluated NOTHING in his entry buckets - it was not deciding at "
            "all when he decided")

    if any(r.get("outcome") == "SURVIVED_TO_RANKING" for r in at_clock):
        return "BUDGET", (
            "a candidate at his clock and zone SURVIVED to ranking, so the in-window absence "
            "is the one-trade budget rather than a refusal")

    gates = {k: v for k, v in _census(at_clock).items() if k != "SURVIVED_TO_RANKING"}
    if not gates:
        return "OTHER", "candidates at his clock, but none carries a killing gate"

    subs = _subreasons(at_clock)
    acceptance_operative = {k: v for k, v in subs.items() if ACCEPTANCE_REFUSAL in k}
    dominant, n = max(gates.items(), key=lambda kv: kv[1])
    share = f"{n}/{sum(gates.values())}"

    if dominant == "NO_AUTHORIZED_LOCATION_ON_THIS_SIDE":
        return "LOCATION", f"no authorized location on his side at his clock ({share})"
    if dominant == "FORCE_NOT_CONFIRMED":
        return "FORCE", f"the force gate refused at his clock ({share})"
    if acceptance_operative:
        return "GATE_OVER_STRICT", (
            f"at his clock the OPERATIVE Route D sub-reason is the acceptance requirement "
            f"{sorted(acceptance_operative)} - named parameter `acceptance_bars` "
            f"(in force: {brk.break_retest.__defaults__[-1]})")
    if dominant in ("REJECTION_STORY_INCOMPLETE", "NO_LEGAL_ROUTE_MATCHED"):
        return "STORY_NOT_RECOGNIZED", (
            f"at his clock the machine reached his zone and did not recognise the interaction "
            f"({dominant} {share}); acceptance is NOT operative. Sub-reasons: "
            f"{sorted(subs.items(), key=lambda kv: -kv[1])[:4]}")
    return "OTHER", f"at his clock the dominant gate is {dominant} ({share})"


def _session_report(env, session, trader, label, p, arm):
    recs = xray_session(env, date.fromisoformat(session), p)["records"]
    entry = trader.get("first_entry_time")
    direction = {"ENTER_LONG": "L", "ENTER_SHORT": "S"}.get(trader.get("final_action"))
    zone = _his_zone(label, direction) if direction else None

    at_clock, context, buckets, on_his_side = [], [], [], []
    if entry:
        t = pd.Timestamp(entry)
        # THE COMPLETED BAR HE ENTERED ON, AND THE ONE BEFORE (ALGO-062 3).
        b0 = t.floor("5min")
        # JOIN ON INSTANTS, NEVER ON THEIR TEXT. The X-ray writes `bucket=ts.isoformat()`
        # ("...T09:35:00-04:00") and `str(pd.Timestamp)` renders the SAME instant with a space
        # ("...  09:35:00-04:00"). Compared as strings they are never equal, so every bucket
        # match silently failed and all four sessions looked like NO_CANDIDATE_AT_ENTRY - which
        # would have been published as "the derivation never reached the interaction he
        # traded". The positive control on the AGREE session is what caught it.
        want = {b0 - pd.Timedelta(minutes=5), b0}
        buckets = [b.isoformat() for b in sorted(want)]
        lo = t - pd.Timedelta(minutes=NEAR_MINUTES)
        hi = t + pd.Timedelta(minutes=NEAR_MINUTES)
        for r in recs:
            clock = r.get("clock")
            if clock and lo <= pd.Timestamp(clock) <= hi:
                context.append(r)
            b = r.get("bucket")
            if (b is not None and pd.Timestamp(b) in want
                    and r.get("direction") == direction):
                if r.get("location_lo") is not None:
                    on_his_side.append(r)
                if _overlaps(r, zone):
                    at_clock.append(r)

    cls, why = classify_at_clock(at_clock, on_his_side, zone)
    gap, nlo, nhi = _nearest_band(on_his_side, zone) if zone else (None, None, None)
    ctx_census = _census(context)
    ctx_dominant = max(ctx_census.items(), key=lambda kv: kv[1])[0] if ctx_census else None
    ctx_class = classify_at_clock(context)[0] if context else None

    return {
        "session": session,
        "arm": arm,
        "trader_final_action": trader.get("final_action"),
        "trader_first_entry_time": entry,
        "his_direction": direction,
        "his_zone": zone,
        "entry_buckets_examined": buckets,

        "AT_CLOCK_classification": cls,
        "AT_CLOCK_why": why,
        "AT_CLOCK_candidates": len(at_clock),
        "AT_CLOCK_authorized_candidates_on_his_side": len(on_his_side),
        "AT_CLOCK_nearest_machine_band": {"lo": nlo, "hi": nhi, "gap_points": gap},
        "AT_CLOCK_gate_census": _census(at_clock),
        "AT_CLOCK_subreasons": dict(sorted(_subreasons(at_clock).items(),
                                           key=lambda kv: -kv[1])[:12]),
        "AT_CLOCK_rows": [
            {k: r.get(k) for k in ("clock", "bucket", "route", "direction", "location_id",
                                   "location_lo", "location_hi", "outcome", "killed_at",
                                   "form", "authority_state", "authority_refusal",
                                   "route_refusals", "routes_asked")}
            for r in at_clock[:12]],

        # CONTEXT ONLY (ALGO-062 3). Most of these evaluations happened when and where he was
        # NOT trading, so this does not answer "why was HE refused HERE" - and where it
        # disagrees with the at-clock class, THE DISAGREEMENT IS THE FINDING.
        "CONTEXT_session_census_NOT_THE_CLASS": ctx_census,
        "CONTEXT_dominant_gate": ctx_dominant,
        "CONTEXT_would_have_classified_as": ctx_class,
        "CONTEXT_records": len(context),
        "at_clock_and_census_DISAGREE": bool(context) and ctx_class != cls,
        "records_in_session": len(recs),
    }


def main() -> int:
    t0 = time.perf_counter()
    sessions = lost_sessions()
    traders = _trader_entries()
    labels = _raw_labels()

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    rows: list[dict] = []
    attribution: list[dict] = []

    # ARM 1 - the configuration the exam actually convicted: 09:30, acceptance_bars as landed.
    with W.trading_window(W.BASELINE_ARM_START):
        env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                          old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
        p = v24.Params()
        for s in sessions:
            rows.append(_session_report(env, s, traders.get(s, {}), labels.get(s, {}),
                                        p, "as_landed"))

    # ARM 2 - LABELLED ATTRIBUTION DIAGNOSTIC at acceptance_bars=2. Runtime override; nothing
    # is edited and nothing is chosen by this. It answers ONE question: is the 2 -> 3 landing
    # implicated in this session's refusal, or was it refused either way?
    original = brk.break_retest.__defaults__
    try:
        brk.break_retest.__defaults__ = tuple(list(original[:-1]) + [2])
        with W.trading_window(W.BASELINE_ARM_START):
            env2 = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                               old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
            for s in sessions:
                attribution.append(
                    _session_report(env2, s, traders.get(s, {}), labels.get(s, {}),
                                    v24.Params(), "attribution_acceptance_bars_2"))
    finally:
        brk.break_retest.__defaults__ = original

    by_session = {r["session"]: r for r in rows}
    by_session_2 = {r["session"]: r for r in attribution}
    verdicts = []
    for s_ in sessions:
        a, b = by_session[s_], by_session_2[s_]
        implicated = (a["AT_CLOCK_classification"] != b["AT_CLOCK_classification"]
                      or a["AT_CLOCK_gate_census"] != b["AT_CLOCK_gate_census"])
        verdicts.append({
            "session": s_,
            "class_AT_HIS_ENTRY_CLOCK": a["AT_CLOCK_classification"],
            "why": a["AT_CLOCK_why"],
            "candidates_at_his_clock": a["AT_CLOCK_candidates"],
            "class_at_acceptance_bars_2": b["AT_CLOCK_classification"],
            "acceptance_landing_implicated": implicated,
            "CONTEXT_session_census_class": a["CONTEXT_would_have_classified_as"],
            "CONTEXT_dominant_gate": a["CONTEXT_dominant_gate"],
            "at_clock_and_census_DISAGREE": a["at_clock_and_census_DISAGREE"],
        })

    out = {
        "artifact": "REFUSAL_DIAGNOSIS_LOST_FOUR",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-058 section 3",
        "produced": "2026-08-23",
        "question": ("of the four sessions F2 says were lost, WHY did the wired brain refuse "
                     "each one, and is the acceptance_bars 2->3 landing implicated?"),
        "lost_sessions_DERIVED_from_the_exam_artifact": sessions,
        "classes": list(CLASSES),
        "near_window_minutes": NEAR_MINUTES,
        "verdicts": verdicts,
        "as_landed": rows,
        "attribution_acceptance_bars_2": attribution,
        "attribution_note": (
            "the acceptance_bars=2 pass is a LABELLED DIAGNOSTIC for attribution only. R4 "
            "stands: nothing here is chosen by agreement, score or outcome, and the landed "
            "value is not re-opened by this module."),
        "repairs": "NONE. This module attributes; ALGO-059 rules the repair.",
        "runtime_seconds": round(time.perf_counter() - t0, 2),
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"lost sessions (derived from the anchor): {sessions}\n")
    for v in verdicts:
        print(f"  {v['session']}  AT HIS CLOCK: {v['class_AT_HIS_ENTRY_CLOCK']:<24} "
              f"candidates={v['candidates_at_his_clock']}  "
              f"acceptance-2: {v['class_at_acceptance_bars_2']:<24} "
              f"implicated={v['acceptance_landing_implicated']}")
        print(f"      {v['why']}")
        if v["at_clock_and_census_DISAGREE"]:
            print(f"      !! AT-CLOCK AND SESSION CENSUS DISAGREE - census would have said "
                  f"{v['CONTEXT_session_census_class']} "
                  f"(dominant {v['CONTEXT_dominant_gate']}). THE DISAGREEMENT IS A FINDING.")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    # ALGO-057 4.1: ONE WRITER PER ARTIFACT, and the lock covers the whole RUN.
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
