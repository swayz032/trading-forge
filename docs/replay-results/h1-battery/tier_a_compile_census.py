#!/usr/bin/env python3
"""TIER-A 11 — compile + census (R-205 §1 acceleration; census per R-082 §5(d)).

WHAT THIS IS: the first compile of the tier-a certified extractions — the real
strategies the mission is about — plus the census that R-082 §5(d) pre-registered
to run on them, so the pre-registered prediction gets its test.

CORPUS (named in every scope line): tier-a certified clean strategies, n=11 of 13,
drawn from the 9 clean video-units of `tier-a-clean-strategy-receipt.json`.
Extractions read from the PERSISTED SEALED-READ WD (phase_b/), the same artifacts
the certification receipt was replayed from.

COMPLETENESS (never sum a handed list): the family axis is enumerated from the
FAMILY_META universe itself (all 14 declared families, zeros included). Concept and
tf axes reuse wire1_structure_census.py's classifiers BY IMPORT — never restated —
so this census cannot drift from the tier-b census the prediction compares against.

BIND STATUS is read from the PRODUCTION binder (compile_binding_plan) with FLAGS OFF
(legacy column) — the shipped default. A condition BINDS iff bindable AND NOT
approximation AND executed; `approximation=True` degrades to an np.ones pass-through
(ungated, looser-than-taught, the R-040 pin-2iii optimistic bias), so it is NOT a bind.

READ-ONLY on every input. Writes exactly one artifact: tier-a-compile-census.json.
Touches nothing in the artifact/measurement lane.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, ROOT)

SEALED_WD = (r"C:\Users\tonio\AppData\Local\Temp\claude"
             r"\C--Users-tonio-Projects-trading-forge"
             r"\d96dba1d-d874-4c26-8026-7ec19a8674ae\scratchpad\SEALED-READ")
PHASE_B = os.path.join(SEALED_WD, "phase_b")
RECEIPT = os.path.join(HERE, "tier-a-clean-strategy-receipt.json")
OUT = os.path.join(HERE, "tier-a-compile-census.json")

from src.engine.extraction.spec_producer import dispose_inventory, produce_spec_artifact  # noqa: E402
from src.engine.spec_family_bindings import FAMILY_META, compile_binding_plan  # noqa: E402
from src.engine.spec_family_bindings import resolve_session_keyword  # noqa: E402

# Sibling census classifiers imported BY PATH (artifact script, not a package module)
# so the tf/concept axes are literally the same instrument as the tier-b census.
_spec = importlib.util.spec_from_file_location(
    "wire1_census", os.path.join(HERE, "wire1_structure_census.py"))
_w1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_w1)

DEFERRED_FAMILIES = {"WAIT_RETEST", "WAIT_CONFIRMATION", "FILTER"}

# ============================================================ R-229: GATES THAT -O CANNOT STRIP
# ★ Three gates in main() were bare `assert`s, and every one guards a PUBLISHED figure: the
# tier-A clean strategy count (twice, against the receipt's own pin) and the family-enumeration
# closure. `python -O` strips assert statements, so `python -O tier_a_compile_census.py` wrote
# tier-a-compile-census.json with all three absent -- and the file publishes unconditionally
# afterwards, so nothing in the artifact would record that they had not run.
# Predicates below are AST-identical to the asserts they replace; only the wrapper changed.
GATE_BOUNDARIES: dict[str, str] = {
    "RECEIPT_RECONCILIATION": (
        "Reconciles the selection derived here against the receipt's own pinned counts. It "
        "checks the DERIVATION against the receipt -- it cannot tell whether the receipt itself "
        "is right, which is a question for whatever certified it."
    ),
    "FAMILY_ENUMERATION_CLOSURE": (
        "Checks that the family histogram sums to the condition count, i.e. that no condition "
        "fell outside the FAMILY_META universe. It says nothing about whether each condition "
        "was classified CORRECTLY -- only that every one landed in some declared bucket."
    ),
}


def refuse_unless(ok: bool, gate: str, message: str) -> None:
    """A guard REFUSES: never `assert` (-O strips it), never exit 1 (that reads as a crash).

    A refusal is a VERDICT and gets exit code 2. The boundary prints WITH the refusal.
    """
    if ok:
        return
    boundary = GATE_BOUNDARIES.get(gate, "(no boundary declared -- this is itself a defect)")
    sys.stderr.write(
        f"\n{'=' * 78}\nGUARD REFUSED: {gate}\n{'=' * 78}\n{message}\n\n"
        f"  WHAT THIS GATE DOES NOT COVER (printed beside every verdict, red or green):\n"
        f"    {boundary}\n\n"
        "REFUSING TO PUBLISH. Exit 2 -- this is a guard verdict, not a crash.\n"
    )
    raise SystemExit(2)


def refuse_if_optimized() -> None:
    """Name the flag, not the symptom -- asserts in the import closure are stripped too."""
    refuse_unless(not sys.flags.optimize, "OPTIMIZED_MODE", (
        "This generator was invoked under `python -O`, which strips every `assert` statement in "
        "this process. The gates in main() survive as refusals, but nothing can vouch for "
        "asserts in the modules this file imports. Re-run without -O."
    ))


def sha256_file(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def select_clean_strategies(receipt):
    """Derive the tier-a clean set from the receipt — never transcribed.

    A video contributes ALL its strategies when n_clean == n_strategies, and NONE
    when n_clean == 0. A partially-clean video would make the per-strategy identity
    unresolvable from this receipt alone, so that case FAILS CLOSED rather than
    guessing which strategy was the clean one."""
    keep, dropped = [], []
    for v in receipt["per_video"]:
        vid, n, nc = v["video_id"], v["n_strategies"], v["n_clean_strategies"]
        if nc == n:
            keep.extend(f"{vid}__s{i}" for i in range(n))
        elif nc == 0:
            dropped.extend(f"{vid}__s{i}" for i in range(n))
        else:
            raise SystemExit(
                f"FAIL-CLOSED: {vid} is partially clean ({nc}/{n}); per-strategy "
                "identity is not resolvable from this receipt.")
    return keep, dropped


def binds(b):
    """A condition BINDS iff it is bindable, non-approximated, and executed."""
    return bool(b["bindable"] and not b["approximation"] and b["executed"])


def bind_status(b):
    if binds(b):
        return "BINDS"
    if not b["bindable"]:
        return "UNBOUND"
    if b["approximation"]:
        return "APPROXIMATED"
    return "NOT_EXECUTED"


def main():
    refuse_if_optimized()
    receipt = json.load(open(RECEIPT, encoding="utf-8"))
    keep, dropped = select_clean_strategies(receipt)

    # Arithmetic self-check against the receipt's own pin (two-path, not a re-read).
    refuse_unless(len(keep) == receipt["tier_a_clean_strategy_count"], "RECEIPT_RECONCILIATION",
                  f"selection {len(keep)} != receipt pin {receipt['tier_a_clean_strategy_count']}")
    # This one carried NO message as an assert -- a partition that failed to close would have
    # raised a bare AssertionError naming neither side. Predicate unchanged.
    refuse_unless(len(keep) + len(dropped) == receipt["total_strategies"], "RECEIPT_RECONCILIATION",
                  f"kept {len(keep)} + dropped {len(dropped)} != receipt total "
                  f"{receipt['total_strategies']} -- the selection partition does not close")

    specs, failures = [], []
    for stub in sorted(keep):
        path = os.path.join(PHASE_B, f"{stub}.json")
        if not os.path.exists(path):
            failures.append({"stub": stub, "reason": "extraction file absent from sealed-read WD"})
            continue
        doc = json.load(open(path, encoding="utf-8"))
        strategies = doc.get("strategies") or []
        # stub carries the within-video strategy index; the file holds exactly that one.
        if len(strategies) != 1:
            failures.append({"stub": stub,
                             "reason": f"expected 1 strategy in file, found {len(strategies)}"})
            continue
        strat = strategies[0]
        ic = doc.get("instrument_classification")
        try:
            art = produce_spec_artifact(strat, video=stub, certificate=None, transcript_chars=0)
            disp = dispose_inventory(strat, ic, art["spec"])
            plan = compile_binding_plan(art["spec"])
        except Exception as exc:  # a compile failure is a FINDING, never a lowered bar
            failures.append({"stub": stub, "reason": f"{type(exc).__name__}: {exc}"})
            continue

        by_id = {b["condition_id"]: b for b in
                 [x.to_dict() for x in plan.bindings] + [x.to_dict() for x in plan.invalidation_bindings]}

        conds = []
        for c in art["spec"]["entry_conditions"] + art["spec"]["invalidations"]:
            b = by_id.get(c["id"])
            obj = c.get("object", "")
            meta = FAMILY_META.get(c["type"])
            conds.append({
                "condition_id": c["id"],
                "type": c["type"],
                "role": c["role"],
                "object": obj,
                "load_bearing_spine": c["role"] in ("spine", "trigger"),
                "bind_status": bind_status(b) if b else "NO_BINDING_EMITTED",
                "binds_to": (b or {}).get("primitive"),
                "approximation": (b or {}).get("approximation"),
                "bindable": (b or {}).get("bindable"),
                "executed": (b or {}).get("executed"),
                "unbound_reason": (b or {}).get("reason"),
                "session_zone": (b or {}).get("session_zone"),
                "session_keyword_resolves": (resolve_session_keyword(obj) is not None
                                             if c["type"] == "WAIT_SESSION" else None),
                "deferred_family": c["type"] in DEFERRED_FAMILIES,
                "tf_class": _w1.classify_tf(obj),
                "concepts": _w1.classify_concepts(obj),
                "family_declared_primitive": meta.primitive if meta else None,
            })

        spine = [c for c in conds if c["load_bearing_spine"]]
        taught = conds  # frozen forensics §0: every taught condition load-bearing unless dispositioned
        specs.append({
            "stub": stub,
            "strategy_name": strat.get("name"),
            "extraction_sha256": sha256_file(path),
            "spec_hash": art["spec_hash"],
            "disposition": disp["disposition"],
            "asset_class": disp["asset_class"],
            "instrument_class_extracted": (ic or {}).get("instrument_class"),
            "direction": art["spec"]["direction"],
            "n_conditions_total": len(conds),
            "n_spine_or_trigger": len(spine),
            "n_spine_binds": sum(1 for c in spine if c["bind_status"] == "BINDS"),
            "n_taught_binds": sum(1 for c in taught if c["bind_status"] == "BINDS"),
            "n_deferred_family": sum(1 for c in conds if c["deferred_family"]),
            "spine_fully_binds": all(c["bind_status"] == "BINDS" for c in spine) if spine else False,
            "all_taught_binds": all(c["bind_status"] == "BINDS" for c in taught) if taught else False,
            "approximation_metrics": art["approximation_metrics"],
            "house_default_exit": "framework_overlay" in art["spec"],
            "conditions": conds,
        })

    all_conds = [c for s in specs for c in s["conditions"]]
    n = len(all_conds)
    n_specs = len(specs)

    # FAMILY MIX — enumerated over the FAMILY_META universe (zeros included).
    fam_obs = Counter(c["type"] for c in all_conds)
    family_mix = {f: fam_obs.get(f, 0) for f in sorted(FAMILY_META)}
    refuse_unless(sum(family_mix.values()) == n, "FAMILY_ENUMERATION_CLOSURE",
                  f"family enumeration does not close on n: {sum(family_mix.values())} != {n}")

    status_counts = Counter(c["bind_status"] for c in all_conds)
    spine_conds = [c for c in all_conds if c["load_bearing_spine"]]

    # Which family, if wired, unlocks the most LOAD-BEARING non-binding conditions.
    unlock = Counter(c["type"] for c in spine_conds if c["bind_status"] != "BINDS")
    unlock_specs = {}
    for c in spine_conds:
        if c["bind_status"] != "BINDS":
            unlock_specs.setdefault(c["type"], set())
    for s in specs:
        for c in s["conditions"]:
            if c["load_bearing_spine"] and c["bind_status"] != "BINDS":
                unlock_specs[c["type"]].add(s["stub"])

    eligible_strict = [s["stub"] for s in specs if s["all_taught_binds"]]
    eligible_spine = [s["stub"] for s in specs if s["spine_fully_binds"]]

    # RE-AIM: a wire's value is specs COMPLETED, not conditions touched. Both reported,
    # plus the greedy cumulative order — because no single wire completes the corpus.
    def _blockers(s, fixed, scope):
        out = set()
        for c in s["conditions"]:
            if scope == "spine" and not c["load_bearing_spine"]:
                continue
            if c["bind_status"] != "BINDS" and c["type"] not in fixed:
                out.add(c["type"])
        return out

    reaim = {}
    for scope in ("spine", "all"):
        fams = sorted({c["type"] for s in specs for c in s["conditions"]
                       if c["bind_status"] != "BINDS" and (scope == "all" or c["load_bearing_spine"])})
        single = []
        for f in fams:
            nc = sum(1 for s in specs for c in s["conditions"]
                     if c["type"] == f and c["bind_status"] != "BINDS"
                     and (scope == "all" or c["load_bearing_spine"]))
            single.append({"family": f, "n_conditions_unlocked": nc,
                           "n_specs_completed_alone": sum(1 for s in specs if not _blockers(s, {f}, scope))})
        single.sort(key=lambda r: -r["n_conditions_unlocked"])
        fixed, order = set(), []
        while len(fixed) < len(fams):
            best = max((f for f in fams if f not in fixed),
                       key=lambda f: sum(1 for s in specs if not _blockers(s, fixed | {f}, scope)))
            fixed.add(best)
            order.append({"add_family": best,
                          "cumulative_specs_fully_binding": sum(1 for s in specs if not _blockers(s, fixed, scope))})
            if order[-1]["cumulative_specs_fully_binding"] == len(specs):
                break
        reaim[scope] = {"single_wire": single, "greedy_cumulative": order}

    out = {
        "artifact": "tier-a-compile-census",
        "generator": "docs/replay-results/h1-battery/tier_a_compile_census.py",
        "scope_line": (
            f"corpus = tier-a certified clean strategies (n={n_specs} compiled of "
            f"{receipt['tier_a_clean_strategy_count']} certified clean, of "
            f"{receipt['total_strategies']} total, from {receipt['clean_videos']} clean "
            f"video-units of {receipt['n_videos']}) · extractions = persisted sealed-read WD "
            f"phase_b · compiler = src/engine/extraction/spec_producer.py · binder = "
            f"compile_binding_plan with ALL FLAGS OFF (legacy column) · no bars, no battery, "
            f"no survivor arithmetic"),
        "extraction_source": PHASE_B,
        "receipt_source": "docs/replay-results/h1-battery/tier-a-clean-strategy-receipt.json",
        "selection_rule": (
            "clean strategies derived from the receipt's per-video rollup "
            "(n_clean==n_strategies -> keep all; n_clean==0 -> drop all; partial -> fail-closed). "
            "Never transcribed."),
        "n_selected": len(keep),
        "n_compiled": n_specs,
        "n_compile_failures": len(failures),
        "compile_failures": failures,
        "dropped_not_clean": sorted(dropped),
        "n_conditions": n,
        "family_universe_size": len(FAMILY_META),
        "family_mix": family_mix,
        "family_mix_observed_only": dict(fam_obs.most_common()),
        "deferred_family_conditions": sum(1 for c in all_conds if c["deferred_family"]),
        "specs_with_any_deferred": sum(1 for s in specs if s["n_deferred_family"] > 0),
        "tf_class_counts": dict(Counter(c["tf_class"] for c in all_conds)),
        "concept_counts": dict(Counter(k for c in all_conds for k in c["concepts"]).most_common()),
        "n_conditions_zero_concepts": sum(1 for c in all_conds if not c["concepts"]),
        "bind_status_counts": dict(status_counts),
        "n_spine_or_trigger": len(spine_conds),
        "spine_bind_status_counts": dict(Counter(c["bind_status"] for c in spine_conds)),
        # ★★ R-229 §8: THIS RANKING IS SUPERSEDED, AND THE DEAD NUMBER IS ITS SORT KEY.
        # Read the marker below before citing anything in this block or in reaim_analysis.
        "SUPERSESSION_MARKER": {
            "status": "SUPERSEDED -- do not cite unlock_ranking_load_bearing or reaim_analysis",
            "what_is_dead": (
                "This artifact was generated under the PREFIX classifier. Its published "
                "unlock ranking put WAIT_STRUCTURE first with 31 load-bearing conditions "
                "across 11 specs, and 31 > 10 > 5 IS the sort order -- so the dead number is "
                "not a detail inside the output, it is the key that produced the output."
            ),
            "what_replaced_it": (
                "The classifier fix landed (see docs/replay-results/classifier-fix/). "
                "Re-measured on the SAME corpus with the SAME instrument, read-only: "
                "UNTYPED 26 conditions across 9 specs, WAIT_STRUCTURE 18 across 7, "
                "WAIT_CONFIRMATION 4 across 3, WAIT_SESSION 2 across 2, WAIT_RETEST 2 across "
                "1, FILTER 1 across 1. Spine bind status moves from "
                "{APPROXIMATED: 43, UNBOUND: 10} to {UNBOUND: 28, APPROXIMATED: 25}."
            ),
            "the_ranking_does_not_merely_shrink_IT_REORDERS": (
                "WAIT_STRUCTURE is no longer #1. UNTYPED is, and UNTYPED is not a family that "
                "can be wired -- it is the absence of a type. A re-aim that reads position [0] "
                "of this list would now be aimed at something unwireable, which is why this "
                "marker names the reorder rather than only the smaller count."
            ),
            "the_re_aim_it_justified": "SUSPENDED",
            "why_the_number_is_not_simply_corrected_here": (
                "Regenerating this artifact would silently restate every figure in it under a "
                "classifier the published run never used, which is a different measurement "
                "wearing this one's filename. The marker is the honest minimum: it says what "
                "is dead, what replaced it, and that the decision it fed is suspended."
            ),
            "reproduce": (
                "★ THIS GENERATOR NO LONGER RUNS TO COMPLETION ON CURRENT DATA, and that is a "
                "finding, not a defect in this marker. Re-run it and FAMILY_ENUMERATION_CLOSURE "
                "refuses with exit 2: the family histogram sums to 56 against 99 conditions. "
                "The 43 missing conditions are the UNTYPED ones the classifier fix introduced, "
                "and UNTYPED is not a member of the FAMILY_META universe this census enumerates "
                "over -- so they fall out of family_mix entirely."
            ),
            "WHY_THIS_MATTERS_MORE_THAN_THE_STALE_RANKING": (
                "That closure check was a bare `assert` until R-229. Under `python -O` it would "
                "have been stripped, and this generator would have PUBLISHED a family_mix "
                "silently omitting 43 of 99 conditions -- a census that had lost nearly half "
                "its population while reporting a complete-looking histogram. The gate did not "
                "become useful when it was converted; it became UNSKIPPABLE, and the first "
                "thing it did was refuse."
            ),
            "NOT_FIXED_HERE_AND_WHY": (
                "Widening the enumeration to admit UNTYPED would change what this census "
                "MEASURES, which is not an enforcement-mechanism change and does not belong in "
                "the unit that converted the gates. It is left refusing -- loudly, at exit 2 -- "
                "rather than quietly widened. A generator that refuses is safe; one that "
                "publishes a half-population histogram is not."
            ),
        },
        "unlock_ranking_load_bearing": [
            {"family": f, "n_load_bearing_conditions_unlocked": c,
             "n_specs_touched": len(unlock_specs.get(f, ())),
             "specs": sorted(unlock_specs.get(f, ())),
             "SUPERSEDED": "see SUPERSESSION_MARKER -- prefix-classifier vintage"}
            for f, c in unlock.most_common()],
        "reaim_analysis": reaim,
        "reaim_analysis_SUPERSEDED": "see SUPERSESSION_MARKER -- prefix-classifier vintage",
        "session_mistype_class": {
            "note": ("R-083 §2(ii) registered this class for explicit hunting on tier-a. "
                     "A WAIT_SESSION condition whose text resolves to NO session zone is "
                     "mis-typed: it is not a wiring gap, it is a classifier defect, so it "
                     "is fixed by RECLASSIFICATION, never by building session support."),
            "n_wait_session": sum(1 for c in all_conds if c["type"] == "WAIT_SESSION"),
            "n_resolving_to_a_zone": sum(1 for c in all_conds
                                         if c["type"] == "WAIT_SESSION" and c["session_keyword_resolves"]),
            "n_mistyped": sum(1 for c in all_conds
                              if c["type"] == "WAIT_SESSION" and not c["session_keyword_resolves"]),
        },
        "eligibility": {
            "criterion_strict": (
                "R-042 §5 with the frozen forensics §0 default: EVERY taught condition "
                "load-bearing unless dispositioned -> eligible iff all taught conditions BIND."),
            "criterion_spine": (
                "narrower reading: only spine/trigger conditions load-bearing -> eligible iff "
                "all spine/trigger conditions BIND."),
            "eligible_strict": eligible_strict,
            "n_eligible_strict": len(eligible_strict),
            "eligible_spine_only": eligible_spine,
            "n_eligible_spine_only": len(eligible_spine),
        },
        "prediction_under_test": {
            "source": "docs/designs/ADVISOR-RULINGS.md R-082 §5(d)",
            "verbatim": (
                "The prediction, on the record before the data exists: same corpus class and "
                "same extraction instrument => a similar family mix, so a similar deferred-family "
                "bottleneck. If the tier-a mix comes back materially different, that difference "
                "is itself a finding about the two corpora."),
            "tier_b_baseline_cited": {
                "note": "CITED from R-082 §1 (external constant, not recomputed here)",
                "n_conditions": 155, "n_specs": 16,
                "family_mix": {"WAIT_STRUCTURE": 78, "WAIT_SESSION": 27, "WAIT_CONFIRMATION": 23,
                               "WAIT_RETEST": 20, "WAIT_BIAS": 4, "FILTER": 3},
                "deferred_conditions": 46, "specs_with_any_deferred": 14},
        },
        "specs": specs,
    }

    json.dump(out, open(OUT, "w", encoding="utf-8"), indent=2)

    def pct(x, d):
        return f"{x/d*100:5.1f}%" if d else "  n/a"

    print(f"=== TIER-A COMPILE + CENSUS ===")
    print(out["scope_line"])
    print(f"\ncompiled {n_specs}/{len(keep)} · failures {len(failures)}")
    for f in failures:
        print(f"  FAIL {f['stub']}: {f['reason']}")
    print(f"\nconditions n={n} across {n_specs} specs")
    print("--- family mix (universe of %d, zeros shown) ---" % len(FAMILY_META))
    for k, v in sorted(family_mix.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<20} {v:>3}  {pct(v, n)}")
    print("--- taught timeframes ---")
    for k, v in sorted(out["tf_class_counts"].items(), key=lambda kv: -kv[1]):
        print(f"  {k:<20} {v:>3}  {pct(v, n)}")
    print("--- concepts (multi-label) ---")
    for k, v in out["concept_counts"].items():
        print(f"  {k:<20} {v:>3}  {pct(v, n)}")
    print(f"  {'(zero concepts)':<20} {out['n_conditions_zero_concepts']:>3}  "
          f"{pct(out['n_conditions_zero_concepts'], n)}")
    print("--- bind status, ALL taught conditions ---")
    for k, v in status_counts.most_common():
        print(f"  {k:<20} {v:>3}  {pct(v, n)}")
    print(f"--- bind status, LOAD-BEARING (spine/trigger) n={len(spine_conds)} ---")
    for k, v in Counter(c["bind_status"] for c in spine_conds).most_common():
        print(f"  {k:<20} {v:>3}  {pct(v, len(spine_conds))}")
    print("--- RE-AIM: families blocking load-bearing conditions ---")
    for r in out["unlock_ranking_load_bearing"]:
        print(f"  {r['family']:<20} {r['n_load_bearing_conditions_unlocked']:>3} conds "
              f"across {r['n_specs_touched']:>2} specs")
    print(f"\nELIGIBLE (strict, all taught bind): {len(eligible_strict)} of {n_specs} -> {eligible_strict}")
    print(f"ELIGIBLE (spine-only reading):      {len(eligible_spine)} of {n_specs} -> {eligible_spine}")
    print(f"\nartifact -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
