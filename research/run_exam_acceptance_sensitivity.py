#!/usr/bin/env python3
"""EXAM ITEM — `acceptance_bars` sensitivity at {1, 2, 3}. Criteria pre-registered.

ALGO-037 ruling 1 made `acceptance_bars = 2` a **governed UNFROZEN choice**: the spec requires
`break_retest_without_prior_durable_acceptance` to be refused and calls the property *durable*,
but names no bar count anywhere (proved by
`test_the_spec_really_does_not_fix_an_acceptance_bar_COUNT`). So the value is this lane's
DERIVATION of "durable", and the ruling attached a mandatory exam-time sensitivity run to it.

═══════════════════════════════════════════════════════════════════════════════
THE DECISION RULE IS PRE-REGISTERED. IT IS WRITTEN HERE BEFORE ANY RESULT EXISTS.
═══════════════════════════════════════════════════════════════════════════════

Quoting ALGO-037 ruling 1 verbatim in its operative parts:

    "mandatory exam-time sensitivity at {1,2,3}; invariant -> immaterial; load-bearing ->
     textbook consulted, and where silent the STRICTER reading wins; never picked by score"

Mechanised, and fixed before the first run:

  R1  INVARIANT — if all three values produce IDENTICAL output on the corpus, the choice is
      IMMATERIAL. Report it and change nothing. A constant that cannot be observed to matter
      must not be argued about.

  R2  LOAD-BEARING — if the outputs differ, consult the textbook. The textbook is already
      known to be SILENT on the count (that is why this is an unfrozen choice at all), and the
      silence is re-checked here rather than remembered.

  R3  SILENT => STRICTER WINS. Among the tested values the strictest is the one that GRANTS
      THE FEWEST entries, because `acceptance_bars` is a monotone requirement: more required
      consecutive closes beyond the level is strictly harder to satisfy. Monotonicity is
      ASSERTED against the measurement, not assumed — if grants do not fall as the requirement
      rises, the parameter does not mean what this rule believes it means and the run REFUSES
      rather than picking.

  R4  NEVER PICKED BY SCORE. No agreement rate, fidelity headline, PnL, realized outcome or
      winner/loser label may participate. This module does not compute any of them and a test
      enforces that it imports none of the modules that do. The winner is chosen by STRICTNESS
      alone. If two values tie on grants, the LOWER number wins — fewer unstated assumptions,
      not a better score.

WHAT THIS MEASURES. `acceptance_bars` is read in exactly one place: `break_retest`, the
accepted-break-then-retest form of Route D. So the observable is the Route D grant set on the
real corpus, taken through the X-ray's breakout hook — never a re-walked loop.

═══════════════════════════════════════════════════════════════════════════════
AMENDMENT — ALGO-054. THE POPULATION IS WHAT ROUTE D **CONSIDERED**, NOT WHAT IT GRANTED.
THE PRE-REGISTERED RULES R1-R4 BELOW ARE UNCHANGED; ONLY THE POPULATION MOVED, AND IT MOVED
BEFORE ANY RESULT EXISTED.
═══════════════════════════════════════════════════════════════════════════════

The selector required `outcome == SURVIVED_TO_RANKING`. That was sound while the kernel used
its own hand-rolled predicates, which never read `acceptance_bars`. After ALGO-047 wired the
state machine in as the kernel's entry authority, those survivors are selected BY `decide(...)`
AT `acceptance_bars = 2` — **the value under test**.

    A candidate refused at 2 was then absent from the population, so it could never be observed
    to be GRANTED at 1. Grants could not rise. R3 asserts monotonicity against the
    measurement and REFUSES if it does not hold — but on a population filtered by the current
    value it would have held BY CONSTRUCTION, and R1's "identical at all three ⇒ IMMATERIAL"
    was unreachable in one direction. The parameter would have been marking its own homework.

The join is now `ROUTE_D in record.routes_asked`, a fact the X-ray RECORDS rather than one this
module infers. The route loop stops at the first grant, so a candidate Route C granted was
never put to Route D and is correctly absent from its considered set. Variants stay
skip-and-count. Guards: `test_..._acceptance_sensitivity.py` pins that the considered set is a
SUPERSET of the survivors by MEMBERSHIP, and carries a DISCRIMINATES fixture — a candidate
REFUSED at 2 and GRANTED at 1 — so the monotonicity raise is reachable on real inputs.

STATUS. This is an EXAM instrument, not a checkpoint. It runs on the finished brain and its
verdict is a ROUTE to a decision, not the decision: a semantic constant changing is reported
before it is landed.

Run: PYTHONPATH=. python -m research.run_exam_acceptance_sensitivity
"""
from __future__ import annotations

import io
import json
import time
from collections import Counter
from datetime import date
from pathlib import Path

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_breakout_derivation import UNFROZEN_CHOICES
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session
from research.current_mnq_strategy_v2_4_entry_authority import (
    ROUTE_B_BREAKOUT,
    ROUTE_C_PREBREAK_DISPLACEMENT,
    ROUTE_D_PREBREAK_RETEST,
    decide,
)

#: The values the ruling named. Not a search space - a pre-registered set.
TESTED = (1, 2, 3)

#: The value in force today, and the one the module declares as unfrozen.
CURRENT = 2

BREAKOUT_ROUTES = (ROUTE_B_BREAKOUT, ROUTE_C_PREBREAK_DISPLACEMENT, ROUTE_D_PREBREAK_RETEST)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
OUT = Path("research/current_mnq_strategy_v2_4_exam_acceptance_sensitivity_2026_08_23.json")
SPEC = Path("research/current_mnq_strategy_v2_4_spec.json")

LOOKBACK = 6

PRE_REGISTERED = {
    "authority": "ALGO-037 ruling 1",
    "R1_invariant": "identical output at all three values => IMMATERIAL, change nothing",
    "R2_load_bearing": "outputs differ => consult the textbook; its silence is re-checked here",
    "R3_silent_stricter_wins": (
        "the strictest tested value is the one granting the FEWEST entries; monotonicity is "
        "ASSERTED against the measurement, and the run REFUSES to pick if it does not hold"),
    "R4_never_by_score": (
        "no agreement rate, fidelity headline, PnL, realized outcome or winner/loser label "
        "participates; ties break to the LOWER value, which assumes less"),
}


def _spec_is_silent_on_the_count() -> bool:
    """Re-checked, not remembered. A remembered silence is a stale silence."""
    raw = io.open(SPEC, encoding="utf-8").read()
    return "durable" in raw and "acceptance_bars" not in raw


def _grants_at(env, sessions, p, acceptance_bars: int) -> dict:
    """Route D grants on the real corpus at one value of the parameter."""
    granted, refusals, per_session = 0, Counter(), {}
    considered = 0

    for s in sessions:
        captured: dict[int, dict] = {}

        def brk_hook(record, **inputs):
            captured[id(record)] = inputs

        xr = xray_session(env, date.fromisoformat(s), p, on_breakout_candidate=brk_hook)
        n = 0
        for r in xr["records"]:
            # ROUTE D ONLY, and non-variant. `acceptance_bars` is read in exactly one place -
            # `break_retest`, the accepted-break-then-retest form of Route D - so widening the
            # population to the whole breakout family would dilute the very sensitivity this
            # exam exists to measure, and would drag in BRK15 records whose trigger is a 15m
            # parent rather than a 5m partial.
            #
            # AMENDED BY ALGO-054: CONSIDERED, NOT GRANTED. The selector used to require
            # `outcome == SURVIVED_TO_RANKING`, which after the ALGO-047 wiring meant the
            # population was chosen by `decide(...)` AT acceptance_bars=2 - the value under
            # test. A candidate refused at 2 could then never be observed to be granted at 1,
            # so grants could not rise, R3's monotonicity would hold BY CONSTRUCTION rather
            # than by measurement, and R1's "identical => immaterial" was unreachable in one
            # direction. The join is now on `routes_asked`, a fact the X-ray RECORDS: the
            # route loop stops at the first grant, so a candidate Route C granted was never
            # put to Route D and is correctly absent.
            if (ROUTE_D_PREBREAK_RETEST not in (r.get("routes_asked") or ())
                    or r.get("variant") is not None):
                continue
            inputs = captured.get(id(r))
            if inputs is None:
                raise RuntimeError(
                    f"ROUTE_D_CANDIDATE_WITHOUT_INPUTS at {s} {r.get('clock')} "
                    f"(outcome={r.get('outcome')}). Under ALGO-054 the hook must fire on the "
                    f"refusal branches too; a considered candidate with no captured inputs "
                    f"means the population and the hook have drifted apart.")
            considered += 1
            full5, ts, row = inputs["full5"], inputs["ts"], inputs["row"]
            loc, direction, pad = inputs["loc"], inputs["direction"], inputs["pad"]
            prior = full5[full5.index < ts].tail(LOOKBACK)
            bars = pd.concat([prior, pd.DataFrame([row], index=[ts])])
            a = decide(bars, direction, float(loc.lo), float(loc.hi),
                       location_authorized=True, force_confirmed=True,
                       body_frac=float(p.body_frac), close_loc=float(p.close_loc),
                       reject_wick=float(p.reject_wick), pad=float(pad), lookback=LOOKBACK,
                       route=ROUTE_D_PREBREAK_RETEST, range_ratio=float(p.range_ratio),
                       acceptance_bars=acceptance_bars)
            if a.granted:
                granted += 1
                n += 1
            else:
                refusals[(a.reason or "").split(":")[0]] += 1
        per_session[s] = n
    return {"acceptance_bars": acceptance_bars, "route_d_grants": granted,
            "candidates_considered": considered,
            "refusal_census": dict(refusals.most_common()),
            "grants_per_session": per_session}


def evaluate(rows: list[dict]) -> dict:
    """Apply the PRE-REGISTERED rule. No result may change the rule; the rule was fixed above."""
    grants = {r["acceptance_bars"]: r["route_d_grants"] for r in rows}
    fingerprints = {r["acceptance_bars"]: json.dumps(r["grants_per_session"], sort_keys=True)
                    for r in rows}

    if len(set(fingerprints.values())) == 1:
        return {"rule_applied": "R1_INVARIANT", "verdict": "IMMATERIAL",
                "chosen": CURRENT, "changed": False,
                "why": ("all three values produce identical grants on every session, so the "
                        "choice cannot be observed to matter on this corpus. Nothing changes. "
                        "This is NOT evidence the value is right - only that the corpus "
                        "cannot tell the three apart.")}

    silent = _spec_is_silent_on_the_count()
    if not silent:
        return {"rule_applied": "R2_TEXTBOOK_SPEAKS", "verdict": "READ_THE_SPEC",
                "chosen": None, "changed": False,
                "why": ("the spec now mentions an acceptance count, so this stopped being an "
                        "unfrozen choice - stop deriving one and read it off the textbook.")}

    ordered = [grants[v] for v in sorted(grants)]
    monotone = all(a >= b for a, b in zip(ordered, ordered[1:]))
    if not monotone:
        return {"rule_applied": "R3_MONOTONICITY_FAILED", "verdict": "REFUSE_TO_PICK",
                "chosen": None, "changed": False,
                "why": ("grants did not fall as the requirement rose, so `acceptance_bars` "
                        f"does not behave as a monotone strictness knob here: {grants}. "
                        "Picking a 'stricter' value would be picking a word, not a property.")}

    fewest = min(grants.values())
    # R4: ties break to the LOWER value - it assumes less. Never to the better score.
    chosen = min(v for v in grants if grants[v] == fewest)
    return {"rule_applied": "R3_SILENT_STRICTER_WINS", "verdict": "LOAD_BEARING",
            "chosen": chosen, "changed": chosen != CURRENT,
            "why": (f"the values differ ({grants}), the textbook is silent, and the strictest "
                    f"tested value grants fewest. Chosen by STRICTNESS alone - no agreement "
                    f"rate or outcome participated.")}


def main() -> None:
    t0 = time.perf_counter()
    sessions = sorted({c["session"]
                       for c in json.load(io.open(SCORECARD, encoding="utf-8"))["cases"]})
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()

    rows = [_grants_at(env, sessions, p, v) for v in TESTED]
    verdict = evaluate(rows)

    out = {
        "artifact": "EXAM_ACCEPTANCE_BARS_SENSITIVITY",
        "authority": "ALGO-037 ruling 1, carried into the exam by ALGO-041",
        "produced": "2026-08-23",
        "unfrozen_choice_under_test": UNFROZEN_CHOICES["acceptance_bars"],
        "value_in_force": CURRENT,
        "values_tested": list(TESTED),
        "pre_registered_decision_rule": PRE_REGISTERED,
        "spec_is_silent_on_the_count": _spec_is_silent_on_the_count(),
        "measurements": rows,
        "verdict": verdict,
        "outcome_blindness": (
            "no agreement rate, fidelity headline, PnL, realized outcome or winner/loser "
            "label was computed or read by this module."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    print(f"wrote {OUT}\n")
    for r in rows:
        print(f'  acceptance_bars={r["acceptance_bars"]}  route D grants='
              f'{r["route_d_grants"]:3}  of {r["candidates_considered"]} considered')
    print()
    print(f'  rule applied : {verdict["rule_applied"]}')
    print(f'  verdict      : {verdict["verdict"]}')
    print(f'  chosen       : {verdict["chosen"]}   (changes the value in force: '
          f'{verdict["changed"]})')
    print(f'\n  {verdict["why"]}')


if __name__ == "__main__":
    main()
