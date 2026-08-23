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


def _classify(records: list[dict], near: list[dict]) -> tuple[str, str]:
    """One class, and the sentence that justifies it. Residual category is REAL."""
    if not records:
        return "OTHER", "the X-ray produced no records at all for this session"
    if not near:
        return "OTHER", (
            f"no decision clock within {NEAR_MINUTES} minutes of the trader's labelled entry; "
            "the machine was not deciding when he decided")

    gates = [r.get("killed_at") for r in near if r.get("killed_at")]
    survived = [r for r in near if r.get("outcome") == "SURVIVED_TO_RANKING"]
    if survived:
        return "BUDGET", (
            "the machine DID grant a candidate near his entry, so the in-window absence is the "
            "one-trade budget rather than a refusal")

    def has(tok):
        return any(tok in (g or "") for g in gates)

    if has("NO_AUTHORIZED_LOCATION"):
        return "LOCATION", "no authorized location on the side he traded at that clock"
    if has("FORCE_NOT_CONFIRMED") and not has("REJECTION_STORY_INCOMPLETE") \
            and not has("NO_LEGAL_ROUTE"):
        return "FORCE", "the force gate refused at every clock near his entry"

    # Which named breakout refusal dominates - this is where a gate is NAMED with its parameter.
    refusals: dict[str, int] = {}
    for r in near:
        for route, why in (r.get("route_refusals") or {}).items():
            head = str(why).split(":")[0]
            refusals[f"{route}|{head}"] = refusals.get(f"{route}|{head}", 0) + 1
        if r.get("authority_refusal"):
            head = str(r["authority_refusal"]).split(":")[0]
            refusals[f"A_NORMAL_REJECTION|{head}"] = \
                refusals.get(f"A_NORMAL_REJECTION|{head}", 0) + 1

    acceptance = [k for k in refusals if "NOT_ACCEPTED" in k or "ACCEPTED_BREAK" in k]
    if acceptance:
        return "GATE_OVER_STRICT", (
            f"the acceptance gate refused: {sorted(acceptance)} - the named parameter is "
            f"`acceptance_bars` (in force: "
            f"{brk.break_retest.__defaults__[-1] if brk.break_retest.__defaults__ else '?'})")
    if has("REJECTION_STORY_INCOMPLETE") or has("NO_LEGAL_ROUTE"):
        top = sorted(refusals.items(), key=lambda kv: -kv[1])[:4]
        return "STORY_NOT_RECOGNIZED", (
            f"no route recognised an interaction at the level; dominant refusals {top}")
    return "OTHER", f"gates seen: {sorted(set(gates))}"


def _session_report(env, session: str, trader: dict, p, label: str) -> dict:
    recs = xray_session(env, date.fromisoformat(session), p)["records"]
    entry = trader.get("first_entry_time")
    near: list[dict] = []
    if entry:
        t = pd.Timestamp(entry)
        lo, hi = t - pd.Timedelta(minutes=NEAR_MINUTES), t + pd.Timedelta(minutes=NEAR_MINUTES)
        for r in recs:
            clock = r.get("clock")
            if not clock:
                continue
            ts = pd.Timestamp(clock)
            if lo <= ts <= hi:
                near.append(r)

    cls, why = _classify(recs, near)
    gate_census: dict[str, int] = {}
    for r in near:
        k = r.get("killed_at") or "SURVIVED_TO_RANKING"
        gate_census[k] = gate_census.get(k, 0) + 1

    return {
        "session": session,
        "arm": label,
        "trader_final_action": trader.get("final_action"),
        "trader_first_entry_time": entry,
        "classification": cls,
        "why": why,
        "records_in_session": len(recs),
        "records_near_his_entry": len(near),
        "gate_census_near_entry": gate_census,
        "routes_asked_near_entry": sorted({
            route for r in near for route in (r.get("routes_asked") or ())}),
        "sample_near_entry": [
            {k: r.get(k) for k in ("clock", "route", "direction", "location_id", "outcome",
                                   "killed_at", "form", "authority_state", "authority_refusal",
                                   "route_refusals", "routes_asked")}
            for r in near[:6]],
    }


def main() -> int:
    t0 = time.perf_counter()
    sessions = lost_sessions()
    traders = _trader_entries()

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
            rows.append(_session_report(env, s, traders.get(s, {}), p, "as_landed"))

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
                    _session_report(env2, s, traders.get(s, {}), v24.Params(),
                                    "attribution_acceptance_bars_2"))
    finally:
        brk.break_retest.__defaults__ = original

    by_session = {r["session"]: r for r in rows}
    by_session_2 = {r["session"]: r for r in attribution}
    verdicts = []
    for s in sessions:
        a, b = by_session[s], by_session_2[s]
        implicated = (a["classification"] != b["classification"]
                      or a["gate_census_near_entry"] != b["gate_census_near_entry"])
        verdicts.append({
            "session": s,
            "classification_as_landed": a["classification"],
            "classification_at_acceptance_2": b["classification"],
            "acceptance_landing_implicated": implicated,
            "why": a["why"],
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

    print(f"lost sessions (derived): {sessions}\n")
    for v in verdicts:
        print(f"  {v['session']}  {v['classification_as_landed']:<22} "
              f"acceptance-2: {v['classification_at_acceptance_2']:<22} "
              f"implicated={v['acceptance_landing_implicated']}")
        print(f"      {v['why']}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    # ALGO-057 4.1: ONE WRITER PER ARTIFACT, and the lock covers the whole RUN.
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
