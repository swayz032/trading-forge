#!/usr/bin/env python3
"""DIAGNOSTIC CHECKPOINT — what would the new brain do with the kernel's current grants?

ALGO-029 §2: "run the 14-case exam at each derivation-layer milestone (clearly labeled
DIAGNOSTIC until the grade passes) so misfit with the trader surfaces on day one, not on the
26th. A checkpoint result may never steer a rule by itself — the teachings steer; the checkpoint
only tells us early whether the build is drifting from him."

**THIS IS THAT CHECKPOINT AND IT STEERS NOTHING.** It does not select a threshold, does not
tune a parameter, and its output may not be cited as evidence that any rule is right. It answers
one question: of the entries the CURRENT kernel grants, how many would the NEW derivation +
story + state machine refuse, and at WHICH step?

TWO CENSUSES, because there are two families. Route A goes through the rejection story; routes
B/C/D go through the breakout derivation, which did not exist when this checkpoint was first
written. Running only the Route A census after building three more routes would have reported a
number that looked unchanged BECAUSE THE NEW WORK WAS NOT MEASURED - which is worse than no
number at all. The breakout census also records whether the derivation AGREES WITH THE KERNEL
about which route a candidate is, a disagreement the Route A census structurally cannot show.

WHY THAT QUESTION. The measured defect is that the bot trades in 14 of 14 sessions and never
genuinely declines. The new machine's whole purpose is to refuse. So the first thing worth
knowing is whether it refuses AT ALL on real data — and if it refuses everything, that is a
drift signal just as loud as refusing nothing.

NO SECOND LOOP. It hooks `xray_session(on_rejection_candidate=...)`, so it sees exactly the
candidates the kernel's own ranker left standing. Re-walking the loop is what made the X-ray
diverge, and that lesson cost a retraction.

Run: PYTHONPATH=. python -m research.run_derivation_checkpoint
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
from research.current_mnq_strategy_v2_4_candidate_xray import ROUTE_A_REJECTION, xray_session
from research.current_mnq_strategy_v2_4_entry_authority import (
    ROUTE_B_BREAKOUT,
    ROUTE_C_PREBREAK_DISPLACEMENT,
    ROUTE_D_PREBREAK_RETEST,
    blocking_step,
    decide,
)

DIAGNOSTIC_ONLY = (
    "DIAGNOSTIC CHECKPOINT. Steers no rule, selects no threshold, tunes no parameter. Its "
    "output may not be cited as evidence that any rule is correct. ALGO-029 section 2."
)

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
SCORECARD = Path("research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json")
OUT = Path("research/current_mnq_strategy_v2_4_derivation_checkpoint_2026_08_23.json")

LOOKBACK = 6


def _verdict(inputs, p) -> dict:
    """Run the new machine on the same bars the kernel's gate saw."""
    full5, ts, row = inputs["full5"], inputs["ts"], inputs["row"]
    loc, direction, pad = inputs["loc"], inputs["direction"], inputs["pad"]

    prior = full5[full5.index < ts].tail(LOOKBACK)
    bars = pd.concat([prior, pd.DataFrame([row], index=[ts])])

    # The candidate only reached this hook because the kernel's location and force gates
    # already passed, so both are supplied as TRUE rather than recomputed here.
    a = decide(bars, direction, float(loc.lo), float(loc.hi),
               location_authorized=True, force_confirmed=True,
               body_frac=float(p.body_frac), close_loc=float(p.close_loc),
               reject_wick=float(p.reject_wick), pad=float(pad), lookback=LOOKBACK)
    return {
        "state": a.state,
        "blocking_step": blocking_step(a),
        "granted": a.granted,
        "interaction": a.story.interaction if a.story else None,
        "all_interactions": list(getattr(a.story, "all_kinds", ()) or ()) if a.story else [],
        "refusal": a.reason,
        "explain": a.explain(),
    }


BREAKOUT_ROUTES = (ROUTE_B_BREAKOUT, ROUTE_C_PREBREAK_DISPLACEMENT, ROUTE_D_PREBREAK_RETEST)


def _breakout_verdict(inputs, p) -> dict:
    """Run all three breakout routes on the same bars the kernel's gate saw.

    All three, not just the kernel's pick, so the census can say whether the two implementations
    AGREE about which route this is. Asking only about the kernel's choice would hide every
    disagreement, and a disagreement is the most informative thing here.
    """
    full5, ts, row = inputs["full5"], inputs["ts"], inputs["row"]
    loc, direction, pad = inputs["loc"], inputs["direction"], inputs["pad"]

    prior = full5[full5.index < ts].tail(LOOKBACK)
    bars = pd.concat([prior, pd.DataFrame([row], index=[ts])])

    per_route = {}
    for r in BREAKOUT_ROUTES:
        a = decide(bars, direction, float(loc.lo), float(loc.hi),
                   location_authorized=True, force_confirmed=True,
                   body_frac=float(p.body_frac), close_loc=float(p.close_loc),
                   reject_wick=float(p.reject_wick), pad=float(pad), lookback=LOOKBACK,
                   route=r, range_ratio=float(p.range_ratio))
        per_route[r] = {"state": a.state, "granted": a.granted, "form": a.form,
                        "refusal": a.reason, "blocking_step": blocking_step(a)}

    kernel_route = inputs["kernel_route"]
    derived = sorted(r for r in BREAKOUT_ROUTES if per_route[r]["granted"])
    return {
        "kernel_route": kernel_route,
        "derived_routes_granting": derived,
        "agrees_with_kernel": kernel_route in derived,
        "granted_any": bool(derived),
        "kernel_route_state": per_route[kernel_route]["state"],
        "kernel_route_refusal": per_route[kernel_route]["refusal"],
        "per_route": per_route,
    }


def main() -> None:
    t0 = time.perf_counter()
    sc = json.load(io.open(SCORECARD, encoding="utf-8"))
    sessions = sorted({c["session"] for c in sc["cases"]})

    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    p = v24.Params()

    rows: list[dict] = []
    brk_rows: list[dict] = []
    for s in sessions:
        captured: dict[int, dict] = {}
        captured_brk: dict[int, dict] = {}

        def hook(record, **inputs):
            captured[id(record)] = inputs

        def brk_hook(record, **inputs):
            captured_brk[id(record)] = inputs

        xr = xray_session(env, date.fromisoformat(s), p, on_rejection_candidate=hook,
                          on_breakout_candidate=brk_hook)
        grants = [r for r in xr["records"]
                  if r.get("outcome") == "SURVIVED_TO_RANKING"
                  and r.get("route") == ROUTE_A_REJECTION]
        for g in grants:
            inputs = captured.get(id(g))
            if inputs is None:
                raise RuntimeError(f"GRANT_WITHOUT_CAPTURED_INPUTS at {s} {g.get('clock')}")
            rows.append({"session": s, "clock": g["clock"], "direction": g["direction"],
                         **_verdict(inputs, p)})

        brk_grants = [r for r in xr["records"]
                      if r.get("outcome") == "SURVIVED_TO_RANKING"
                      and r.get("route") in BREAKOUT_ROUTES]
        for g in brk_grants:
            inputs = captured_brk.get(id(g))
            if inputs is None:
                raise RuntimeError(f"BREAKOUT_GRANT_WITHOUT_INPUTS at {s} {g.get('clock')}")
            brk_rows.append({"session": s, "clock": g["clock"], "direction": g["direction"],
                             **_breakout_verdict(inputs, p)})

        print(f"  {s}  kernel A={len(grants):3} B/C/D={len(brk_grants):3}   new machine "
              f"A={sum(1 for r in rows if r['session'] == s and r['granted'])} "
              f"B/C/D={sum(1 for r in brk_rows if r['session'] == s and r['granted_any'])}")

    total = len(rows)
    kept = sum(1 for r in rows if r["granted"])
    states = Counter(r["state"] for r in rows)
    refusals = Counter(r["refusal"] for r in rows if not r["granted"])
    interactions = Counter(r["interaction"] for r in rows if r["interaction"])
    # EVERY matching form, not just the reported label. The first checkpoint named
    # touch_and_reject zero times purely because an elif chain shadowed it.
    all_int = Counter(k for r in rows for k in r.get("all_interactions", []))

    b_total = len(brk_rows)
    b_kept = sum(1 for r in brk_rows if r["granted_any"])
    b_agree = sum(1 for r in brk_rows if r["agrees_with_kernel"])
    b_states = Counter(r["kernel_route_state"] for r in brk_rows)
    b_refusals = Counter(r["kernel_route_refusal"] for r in brk_rows
                         if not r["agrees_with_kernel"] and r["kernel_route_refusal"])
    b_kernel_routes = Counter(r["kernel_route"] for r in brk_rows)
    b_derived = Counter(x for r in brk_rows for x in r["derived_routes_granting"])

    out = {
        "artifact": "DERIVATION_CHECKPOINT",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-029 section 2",
        "produced": "2026-08-23",
        "question": ("of the Route A entries the CURRENT kernel grants, how many would the NEW "
                     "derivation + story + state machine refuse, and at which step?"),
        "kernel_route_a_grants": total,
        "new_machine_grants": kept,
        "new_machine_refuses": total - kept,
        "refusal_rate": round(100.0 * (total - kept) / max(total, 1), 1),
        "state_census": dict(states.most_common()),
        "refusal_census": dict(refusals.most_common()),
        "interaction_census_primary_label": dict(interactions.most_common()),
        "interaction_census_ALL_MATCHES": dict(all_int.most_common()),
        "shadowed_by_label_order": sorted(set(all_int) - set(interactions)),
        "breakout_family": {
            "question": ("of the B/C/D entries the kernel grants, how many does the new "
                         "breakout derivation grant, and does it agree about WHICH route?"),
            "kernel_grants": b_total,
            "new_machine_grants_any_route": b_kept,
            "agrees_with_kernel_on_route": b_agree,
            "kernel_route_census": dict(b_kernel_routes.most_common()),
            "derived_route_census": dict(b_derived.most_common()),
            "state_on_the_kernels_own_route": dict(b_states.most_common()),
            "refusal_on_the_kernels_own_route": dict(b_refusals.most_common()),
            "reading": (
                "the kernel granted no B/C/D candidate in these sessions, so this census is "
                "EMPTY - it is not evidence the breakout derivation is right or wrong, only "
                "that these fourteen sessions did not exercise it"
                if b_total == 0 else
                f"the derivation grants {b_kept} of the kernel's {b_total} and agrees on the "
                f"route in {b_agree}. A disagreement is not automatically the derivation's "
                f"error - the kernel's route choice is an elif chain, and which of the two is "
                f"right is a semantics question, not a checkpoint question."),
            "rows": brk_rows,
        },
        "drift_reading": (
            "REFUSES NOTHING - the new machine is as permissive as the literal it replaces, "
            "which is the defect, not a fix."
            if kept == total else
            "REFUSES EVERYTHING - equally uninformative, and a sign the derivation is too "
            "strict or the fixtures are wrong."
            if kept == 0 else
            f"discriminates: keeps {kept} of {total}. Whether it keeps the RIGHT ones is a "
            f"fidelity question the exam answers AFTER the grade passes - not here."),
        "may_not_be_used_to": (
            "select a threshold, tune a parameter, or argue any rule is correct. The teachings "
            "steer; this only says whether the build is drifting."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
        "rows": rows,
    }
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    print(f"\nwrote {OUT}")
    print(f"  kernel Route A grants : {total}")
    print(f"  new machine grants    : {kept}   refuses {total - kept} "
          f"({out['refusal_rate']}%)")
    print(f"  states                : {out['state_census']}")
    print(f"  refusals              : {out['refusal_census']}")
    print(f"  primary label         : {out['interaction_census_primary_label']}")
    print(f"  ALL matches           : {out['interaction_census_ALL_MATCHES']}")
    print(f"  shadowed by label     : {out['shadowed_by_label_order']}")
    b = out["breakout_family"]
    print()
    print(f"  breakout family       : kernel granted {b['kernel_grants']}, new machine "
          f"{b['new_machine_grants_any_route']}, route agreement {b['agrees_with_kernel_on_route']}")
    print(f"  kernel routes         : {b['kernel_route_census']}")
    print(f"  derived routes        : {b['derived_route_census']}")
    print(f"  states on that route  : {b['state_on_the_kernels_own_route']}")
    print(f"\n  {out['drift_reading']}")
    print(f"  {b['reading']}")


if __name__ == "__main__":
    main()
