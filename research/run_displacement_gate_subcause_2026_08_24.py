#!/usr/bin/env python3
"""ALGO-094 order 3, REMAINING HALF - the DISPLACEMENT gate at the line, MEASURED.

ALGO-095 discharged order 3 for the FORCE site only. The break-family half was left as a
MAPPING-TABLE claim: `ORDINARY_MOMENTUM_IS_NOT_TRUE_DISPLACEMENT` was graded
TAUGHT_SHAPE_UNTAUGHT_GATE with the detail "the test calls range_ratio and body_frac". That
sentence is a READING OF THE FUNCTION SOURCE, not a measurement of which sub-test failed.

`is_true_displacement` (breakout_derivation.py:131) is a CONJUNCTION of THREE independent
requirements that all raise the SAME refusal literal:

    (a) _momentum(row, direction, body_frac, close_loc)   -> body_frac >= 0.62 AND close_loc
    (b) reference_range > 0                               -> structural, no magnitude
    (c) row.range >= reference_range * range_ratio        -> range_ratio = 1.25

So the literal UNDER-DETERMINES its cause. Attributing it to a magnitude without measuring is
the same defect class the advisor named for FORCE_NOT_CONFIRMED (one gate label, five
ForceSnapshot sub-reasons).

METHOD - instrument the REAL path, never re-implement it. `prebreak_displacement` is wrapped;
the wrapper calls the UNMODIFIED function for the verdict and separately decomposes the same
inputs. The decomposition is SELF-CHECKED on every call: the decomposition must reproduce the
real function's refusal. Any disagreement is reported as a DECOMPOSITION FAILURE and the
numbers are WITHHELD - a decomposition that cannot reproduce the instrument is not evidence.

DIAGNOSTIC. Lands nothing. No production file is modified. The wrap is a runtime patch inside
this process only, and it is restored in a `finally`.

NO PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
"""
from __future__ import annotations

import io
import json
import time
from collections import Counter
from datetime import date, time as _time
from pathlib import Path

import pandas as pd

from research.current_mnq_strategy_v2_4_single_writer import single_writer
from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as eng
from research import current_mnq_strategy_v2_4_exam_window as W
from research import current_mnq_strategy_v2_4_breakout_derivation as brk
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session

DIAGNOSTIC_ONLY = "DIAGNOSTIC. Displacement-gate sub-cause measurement. Lands nothing."

DATA = Path("research/_mnq_v24_replay_lab_v3/data")
LOCK = Path("research/current_mnq_strategy_v2_2_data_lock.json")
MAN = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
LABELS = Path("research/current_mnq_strategy_v2_4_replay_v3_labels_FROZEN.json")
TRACE = Path("research/current_mnq_strategy_v2_4_refusal_trace_five_clocks_2026_08_24.json")
OUT = Path("research/current_mnq_strategy_v2_4_displacement_gate_subcause_2026_08_24.json")

ARM_START = _time(8, 0)
CONTROL = "2026-04-14"
SUBJECTS = ("2026-03-23", "2026-03-24", "2026-03-31", "2026-04-06", "2026-04-09")

CAP: list[dict] = []
_REAL_PBD = brk.prebreak_displacement


def _decompose_flags(row, direction, body_frac, close_loc, ref, range_ratio) -> dict:
    """The DECOMPOSITION LAYER, isolated so it can be attacked on its own.

    Kept separate from the wrapper deliberately. The self-check compares this layer's verdict
    against the UNMODIFIED `is_true_displacement`; if the two shared one body there would be
    nothing to disagree. Note the residual limit, stated rather than hidden: both this layer
    and the real function read `brk._geom`, so a defect INSIDE `_geom` corrupts both sides
    identically and this check cannot see it. The check covers the decomposition logic, not
    the shared geometry helper.
    """
    g = brk._geom(row)
    dir_ok = bool(g.bullish) if direction == "L" else bool(g.bearish)
    bf_ok = bool(g.body_frac >= body_frac)
    cl_ok = bool(g.close_loc >= close_loc) if direction == "L" \
        else bool(g.close_loc <= 1.0 - close_loc)
    ref_ok = bool(ref and ref > 0)
    rng_ok = bool(ref_ok and g.range >= ref * range_ratio)
    return {
        "dir_ok": dir_ok, "body_frac_ok": bf_ok, "close_loc_ok": cl_ok,
        "reference_range_ok": ref_ok, "range_expansion_ok": rng_ok,
        "measured_body_frac": round(g.body_frac, 4),
        "measured_close_loc": round(g.close_loc, 4),
        "measured_range": round(g.range, 4),
    }


def _wrapped_prebreak_displacement(completed, trigger, lo, hi, direction,
                                   body_frac, close_loc, range_ratio):
    """Call the REAL function for the verdict; decompose the same inputs beside it."""
    res = _REAL_PBD(completed, trigger, lo, hi, direction, body_frac, close_loc, range_ratio)
    if res.refusal != brk.NOT_DISPLACEMENT:
        return res

    # Re-derive EXACTLY what the real function tested.
    rows = [completed.iloc[i] for i in range(len(completed))]
    ref = float(pd.Series([brk._geom(r).range for r in rows[:-3]]).median()) \
        if len(rows) > 3 else 0.0
    row = rows[-3]
    flags = _decompose_flags(row, direction, body_frac, close_loc, ref, range_ratio)

    # ---- THE SELF-CHECK, against the UNMODIFIED predicates on the same row -------------
    # The AGGREGATE check alone is too coarse: it cannot see a single mis-set flag while some
    # OTHER requirement is also failing (demonstrated by a planted single-flag flip). Since
    # the PER-FLAG attribution is what this artifact publishes, each flag is pinned
    # separately by NEUTRALISING one threshold at a time and re-asking the REAL predicate.
    truth_pass = bool(brk.is_true_displacement(row, direction, body_frac, close_loc,
                                               ref, range_ratio))
    predicted_pass = all(flags[k] for k in
                         ("dir_ok", "body_frac_ok", "close_loc_ok",
                          "reference_range_ok", "range_expansion_ok"))

    # `_momentum` is the real conjunction of direction / body_frac / close_loc. Neutralising
    # one threshold at a time turns it into an EXACT probe for each individual flag:
    #   (0.0, 0.0) -> direction alone   (L: close_loc >= 0.0; S: close_loc <= 1.0, vacuous)
    #   (bf,  0.0) -> direction AND body_frac
    #   (0.0, cl)  -> direction AND close_loc
    truth_momentum = bool(brk._momentum(row, direction, body_frac, close_loc))
    truth_dir_only = bool(brk._momentum(row, direction, 0.0, 0.0))
    truth_dir_bf = bool(brk._momentum(row, direction, body_frac, 0.0))
    truth_dir_cl = bool(brk._momentum(row, direction, 0.0, close_loc))
    # Neutralise range expansion by asking for zero expansion.
    truth_no_range = bool(brk.is_true_displacement(row, direction, body_frac, close_loc,
                                                   ref, 0.0))
    # Neutralise EVERY threshold: the real predicate then reduces to direction AND ref > 0
    # (range >= ref*0.0 is vacuous because `_geom.range` is max(h-l, EPS) > 0). This is the
    # only probe that can see the reference-range term, which otherwise guards its own check.
    truth_dir_and_ref = bool(brk.is_true_displacement(row, direction, 0.0, 0.0, ref, 0.0))

    checks = {
        "aggregate": predicted_pass == truth_pass,
        "momentum_group": truth_momentum == (flags["dir_ok"] and flags["body_frac_ok"]
                                             and flags["close_loc_ok"]),
        # EXACT: the direction term is recoverable on its own, always.
        "dir_flag": truth_dir_only == flags["dir_ok"],
        # EXACT whenever direction holds; when it does not, body_frac/close_loc are not
        # published for this row (`_first_failing` returns WRONG_DIRECTION first), so there
        # is no attribution to pin and the check is recorded as not-applicable (True).
        "body_frac_flag": (truth_dir_bf == flags["body_frac_ok"]) if truth_dir_only else True,
        "close_loc_flag": (truth_dir_cl == flags["close_loc_ok"]) if truth_dir_only else True,
        # EXACT whenever direction holds: all thresholds neutralised leaves only ref > 0.
        "reference_range_flag": (truth_dir_and_ref == flags["reference_range_ok"])
        if truth_dir_only else True,
        # EXACT whenever momentum and the reference range hold: then the whole predicate
        # reduces to the range-expansion term.
        "range_flag": (truth_pass == flags["range_expansion_ok"])
        if (truth_momentum and flags["reference_range_ok"]) else True,
    }

    # ---- THE INVARIANT THAT MAKES THE PUBLISHED NUMBER SAFE ----------------------------
    # Some checks are vacuous in some states (e.g. the range term cannot be pinned on a row
    # whose momentum already failed). That is only acceptable if a vacuous check never guards
    # a flag this row's PUBLISHED attribution depends on. Rather than argue it, MEASURE it:
    # the requirement named by `_first_failing` must sit behind an ACTIVE, exact check.
    active = {
        "dir_ok": True,                       # dir_flag is exact unconditionally
        "body_frac_ok": truth_dir_only,
        "close_loc_ok": truth_dir_only,
        "reference_range_ok": truth_dir_only,
        "range_expansion_ok": truth_momentum and flags["reference_range_ok"],
    }
    if not flags["dir_ok"]:
        published = "dir_ok"
    elif not flags["body_frac_ok"]:
        published = "body_frac_ok"
    elif not flags["close_loc_ok"]:
        published = "close_loc_ok"
    elif not flags["reference_range_ok"]:
        published = "reference_range_ok"
    else:
        published = "range_expansion_ok"

    rec = dict(flags)
    rec.update({
        "published_attribution_flag": published,
        "published_attribution_pinned": bool(active[published]),
        "trigger_ts": str(getattr(trigger, "name", None)),
        "direction": direction, "lo": float(lo), "hi": float(hi),
        "reference_range": round(ref, 4),
        "required_range": round(ref * range_ratio, 4),
        "truth_momentum": truth_momentum,
        "truth_direction_only": truth_dir_only,
        "truth_direction_and_body_frac": truth_dir_bf,
        "truth_direction_and_close_loc": truth_dir_cl,
        "truth_pass_without_range_expansion": truth_no_range,
        "truth_direction_and_reference_range": truth_dir_and_ref,
        "checks": checks,
        "decomposition_agrees": all(checks.values()) and bool(active[published]),
    })
    CAP.append(rec)
    return res


def _labels():
    man = {c["case_id"]: c["session"] for c in json.load(io.open(MAN, encoding="utf-8"))["cases"]}
    return {man[r["case_id"]]: r
            for r in json.load(io.open(LABELS, encoding="utf-8"))["labels"]
            if r["case_id"] in man}


def _first_failing(c: dict) -> str:
    """Which requirement failed FIRST, in the function's own evaluation order."""
    if not c["dir_ok"]:
        return "MOMENTUM_WRONG_DIRECTION (structural, no magnitude)"
    if not c["body_frac_ok"]:
        return "MOMENTUM_BODY_FRAC (UNTAUGHT magnitude body_frac=0.62)"
    if not c["close_loc_ok"]:
        return "MOMENTUM_CLOSE_LOC (UNTAUGHT magnitude close_loc=0.78)"
    if not c["reference_range_ok"]:
        return "NO_REFERENCE_RANGE (structural, no magnitude)"
    if not c["range_expansion_ok"]:
        return "RANGE_EXPANSION (UNTAUGHT magnitude range_ratio=1.25)"
    return "NONE_FAILED__DECOMPOSITION_BROKEN"


def _decompose_d(literal: str):
    """Split the Route D composite refusal into its two sub-literals, round-trip checked."""
    head = "NEITHER_ACCEPTED_BREAK_RETEST_NOR_PREBREAK_REPEAT_TEST_QUALIFIED: "
    if not literal.startswith(head):
        return None
    parts = literal[len(head):].split("; ")
    if len(parts) != 2:
        return None
    a, b = parts
    if not a.startswith("accepted_break=") or not b.startswith("repeat_test="):
        return None
    sub_a = a[len("accepted_break="):]
    sub_b = b[len("repeat_test="):]
    # ROUND-TRIP: the parse must rebuild the original byte-for-byte, or it is not a parse.
    if head + "accepted_break=" + sub_a + "; repeat_test=" + sub_b != literal:
        return None
    return sub_a, sub_b


def main() -> int:
    t0 = time.perf_counter()
    labels = _labels()
    observed = old.download_pinned(DATA, include_tick=False)
    old.verify_manifest(observed, json.loads(LOCK.read_text(encoding="utf-8")))

    p = eng.Params()
    frozen = {"body_frac": float(p.body_frac), "close_loc": float(p.close_loc),
              "range_ratio": float(p.range_ratio), "reject_wick": float(p.reject_wick),
              "min_wick": float(p.min_wick)}

    brk.prebreak_displacement = _wrapped_prebreak_displacement
    rows = []
    try:
        with W.trading_window(ARM_START):
            env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                              old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
            for session in SUBJECTS + (CONTROL,):
                lab = labels[session]
                his = pd.Timestamp(lab["first_entry_time"])
                bucket = his.floor("5min")
                direction = "L" if lab["final_action"] == "ENTER_LONG" else "S"
                CAP.clear()
                xray_session(env, date.fromisoformat(session), p)
                caps = list(CAP)
                at = [c for c in caps
                      if c["direction"] == direction
                      and c["trigger_ts"] not in (None, "None")
                      and pd.Timestamp(c["trigger_ts"]).floor("5min") == bucket]
                broken = [c for c in caps if not c["decomposition_agrees"]]
                unpinned = [c for c in caps if not c["published_attribution_pinned"]]
                counts = Counter(_first_failing(c) for c in at)
                # Route C's displacement test reads only `completed`/`trigger` and direction;
                # the location (lo/hi) enters LATER. So one market fact can be counted once
                # per candidate location. Count DISTINCT evaluations so the report cannot
                # present a location-multiplied tally as independent evidence.
                sig = lambda c: (c["trigger_ts"], c["dir_ok"], c["body_frac_ok"],
                                 c["close_loc_ok"], c["reference_range_ok"],
                                 c["range_expansion_ok"], c["measured_body_frac"],
                                 c["measured_close_loc"], c["measured_range"],
                                 c["reference_range"])
                distinct = sorted({sig(c) for c in at})
                rows.append({
                    "session": session,
                    "is_control": session == CONTROL,
                    "his_clock": str(his), "bucket": str(bucket), "direction": direction,
                    "not_displacement_refusals_session_total": len(caps),
                    "not_displacement_refusals_at_his_bucket": len(at),
                    "decomposition_failures": len(broken),
                    "unpinned_published_attributions": len(unpinned),
                    "first_failing_requirement": dict(counts),
                    "distinct_displacement_evaluations_at_his_bucket": len(distinct),
                    "distinct_first_failing": dict(Counter(
                        _first_failing(dict(zip(
                            ("trigger_ts","dir_ok","body_frac_ok","close_loc_ok",
                             "reference_range_ok","range_expansion_ok","measured_body_frac",
                             "measured_close_loc","measured_range","reference_range"), t)))
                        for t in distinct)),
                    "sample": at[:3],
                })
    finally:
        brk.prebreak_displacement = _REAL_PBD

    # ---- Route D: grade what the ALGO-095 trace reported as UNMAPPED --------------------
    trace = json.load(io.open(TRACE, encoding="utf-8"))
    import research.run_refusal_trace_five_clocks as tr
    prov_table = tr.PROVENANCE

    d_rows = []
    for r in trace["rows"]:
        for route, d in r["routes"].items():
            if not route.startswith("D_"):
                continue
            graded, unparsed = [], []
            for literal, n in d["all_refusals"].items():
                parts = _decompose_d(literal)
                if parts is None:
                    unparsed.append({"literal": literal, "count": n})
                    continue
                sub_a, sub_b = parts
                ga = prov_table.get(sub_a)
                gb = prov_table.get(sub_b)
                graded.append({
                    "count": n,
                    "accepted_break": {"literal": sub_a,
                                       "provenance": ga[1] if ga else "UNMAPPED",
                                       "site": ga[0] if ga else "(unmapped)"},
                    "repeat_test": {"literal": sub_b,
                                    "provenance": gb[1] if gb else "UNMAPPED",
                                    "site": gb[0] if gb else "(unmapped)"},
                })
            d_rows.append({
                "session": r["session"], "is_control": r["is_control"],
                "reported_provenance_in_ALGO_095": d["provenance"],
                "total_D_refusals_at_his_bucket": sum(d["all_refusals"].values()),
                "graded": graded, "unparsed": unparsed,
            })

    # ---- The untaught count, re-derived without an anchored classifier ------------------
    buckets = Counter()
    for r in trace["rows"]:
        for route, d in r["routes"].items():
            buckets[d["provenance"]] += 1
    recount = {
        "ALGO_095_headline_untaught_count": trace["untaught_count"],
        "provenance_classes_present": dict(buckets),
        "note": ("ALGO-095 counted only provenance values matching startswith('UNTAUGHT'). "
                 "TAUGHT_SHAPE_UNTAUGHT_GATE and TAUGHT_SHAPE_UNTAUGHT_GATES both contain an "
                 "untaught gate and both sort OUTSIDE that anchor; UNMAPPED rows were never "
                 "graded at all. The headline is an artifact of the anchor, not a census."),
    }

    total_failures = sum(r["decomposition_failures"] for r in rows)
    total_unpinned = sum(r["unpinned_published_attributions"] for r in rows)
    out = {
        "artifact": "DISPLACEMENT_GATE_SUBCAUSE",
        "status": DIAGNOSTIC_ONLY,
        "authority": "ALGO-094 order 3 (remaining half); ALGO-095 left this as a mapping claim",
        "produced": "2026-08-24",
        "frozen_magnitudes": frozen,
        "decomposition_self_check": {
            "total_failures": total_failures,
            "unpinned_published_attributions": total_unpinned,
            "verdict": ("SOUND" if (total_failures == 0 and total_unpinned == 0)
                        else "BROKEN - NUMBERS WITHHELD"),
            "coverage_note": (
                "Every flag a row PUBLISHES is pinned exactly by a neutralised-threshold "
                "probe against the unmodified predicate. Flags that row does NOT publish may "
                "be unpinned in that state (e.g. the range term on a row whose momentum "
                "already failed); that is measured per row as published_attribution_pinned, "
                "not argued. Residual limit stated: both layers read brk._geom, so a defect "
                "INSIDE _geom would corrupt both identically and is out of this check's "
                "reach."),
        },
        "displacement_rows": (rows if (total_failures == 0 and total_unpinned == 0)
                              else "WITHHELD"),
        "route_d_provenance_recovered": d_rows,
        "untaught_recount": recount,
        "no_pnl": ("No PnL, realized outcome, winner/loser label or clean-edge result "
                   "participated in any decision in this diagnostic."),
        "runtime_seconds": round(time.perf_counter() - t0, 2),
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print("=== DISPLACEMENT GATE SUB-CAUSE (measured, not mapped) ===")
    print("frozen: " + json.dumps(frozen))
    print("decomposition self-check failures: " + str(total_failures))
    for r in rows:
        tag = " [CONTROL]" if r["is_control"] else ""
        print("\n" + r["session"] + tag + " " + r["his_clock"][11:16] + " " + r["direction"]
              + "  NOT_DISPLACEMENT at his bucket="
              + str(r["not_displacement_refusals_at_his_bucket"])
              + " (session total " + str(r["not_displacement_refusals_session_total"])
              + ", DISTINCT evaluations "
              + str(r["distinct_displacement_evaluations_at_his_bucket"]) + ")")
        for k, v in sorted(r["first_failing_requirement"].items(), key=lambda x: -x[1]):
            print("    " + str(v).rjust(5) + "  " + k)
    print("\n=== ROUTE D provenance recovered from the composite literal ===")
    for d in d_rows:
        print("\n" + d["session"] + "  reported=" + d["reported_provenance_in_ALGO_095"]
              + "  n=" + str(d["total_D_refusals_at_his_bucket"])
              + "  unparsed=" + str(len(d["unparsed"])))
        for g in sorted(d["graded"], key=lambda x: -x["count"]):
            print("    " + str(g["count"]).rjust(4) + "  accepted_break="
                  + g["accepted_break"]["provenance"].ljust(26)
                  + " repeat_test=" + g["repeat_test"]["provenance"])
    print("\nwrote " + str(OUT))
    return 0


if __name__ == "__main__":
    with single_writer(OUT, purpose=__spec__.name if __spec__ else __file__):
        raise SystemExit(main())
