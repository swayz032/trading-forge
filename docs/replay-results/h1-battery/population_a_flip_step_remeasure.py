"""Re-measure script for docs/designs/packet-population-a-flip-step-2026-07-20.md.

Measures the effect of flipping `approximation` False for the two earned Population-A
kinds (named_sr_level, order_block_edge) while leaving swing at True, against the frozen
levelzone-object-reference-census.json (the same 16-row census the resolver's own tests
(test_classify_population_a_kind_reproduces_census_membership_exactly) already verify this
classifier reproduces exactly).

HONEST SCOPE, stated up front (do not let the per-kind delta below imply more than this):
this flip only changes what `bind_condition()` returns for a WAIT_STRUCTURE/VERIFY_STRUCTURE
condition when BOTH TF_LEVELZONE_ROUTING_ENABLED and TF_LEVELZONE_RESOLVER_ENABLED are
"true" (both default OFF, per the "ship gates STRICT, default OFF" pattern shared by every
other flag in spec_family_bindings.py). Production output TODAY, with default env, is
BYTE-IDENTICAL before and after this delivery — this is a re-measure of what the flip WOULD
move if/when that sub-wire is later promoted to default-on, not a claim about today's live
corpus rate. See wire1-dod-HONEST-FLOOR.json for a worked example of what happens when a
"routing lands" claim gets conflated with a "fidelity moved today" claim (WIRE-1's inert
htf_bars premise) — this script exists specifically to not repeat that error.

APPEND-ONLY: writes docs/replay-results/h1-battery/population-a-flip-step-remeasure.json.
Never touches wire1-dod-HONEST-FLOOR.json or wire1-dod-remeasure.json — those are a
different (WIRE-1 HTF structure) fidelity claim, different scope, different denominator.

Run: python docs/replay-results/h1-battery/population_a_flip_step_remeasure.py
"""

from __future__ import annotations

import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

import src.engine.spec_family_bindings as sfb  # noqa: E402
from src.engine.spec_family_bindings import (  # noqa: E402
    POPULATION_A_DEAPPROXIMATED_KINDS,
    bind_condition,
    classify_population_a_kind,
)

# ============================================================ R-229: GATES THAT -O CANNOT STRIP
# ★ THE DEFECT THIS CLOSES, AND IT WAS LANGUAGE SEMANTICS, NOT A HYPOTHESIS. Every gate in
# main() was a bare `assert`. `python -O` removes assert statements outright, so
# `python -O population_a_flip_step_remeasure.py` wrote this artifact with ALL NINE GATES
# SILENTLY ABSENT -- the frozen census row count, both population splits, all three per-kind
# flip splits, the total, and the resolver-off null baseline. The file published
# unconditionally afterwards either way, so the -O run was not merely unguarded: it was
# INDISTINGUISHABLE from the guarded one by its output.
#
# ★ THE TRAP WAS ALREADY ON OUR BOOKS WHEN THESE SHIPPED. dual_denominator_remeasure.py had
# already found it and already converted its own publish path. The habit did not transfer,
# which is the whole argument for a mechanical repo-wide check rather than a remembered rule.
#
# CONVERSION DISCIPLINE (R-229, and it is the binding condition of this change): every
# PREDICATE below is AST-identical to the assert it replaces. Only the enforcement wrapper
# moved. No threshold was "improved" while the file was open -- an enforcement-mechanism change
# that also edits a predicate is no longer an enforcement-mechanism change, and could not be
# proven by the preservation proof that accompanies it.
GATE_BOUNDARIES: dict[str, str] = {
    "FROZEN_CENSUS_SHAPE": (
        "Checks the row COUNT of the frozen level/zone census only. It cannot tell whether the "
        "rows are the same rows -- a census edited to swap one row for another passes here."
    ),
    "POPULATION_SPLIT": (
        "Checks the Population-A / non-Population-A partition sizes against the frozen census. "
        "It reads classify_population_a_kind's verdict, so it moves if the CLASSIFIER changes, "
        "not only if the corpus does. It cannot distinguish those two causes."
    ),
    "PER_KIND_FLIP_SPLIT": (
        "Checks per-kind de-approximation counts in the BOTH-FLAGS-ON hypothetical only. It "
        "says nothing about production, where both flags default OFF and no row flips at all."
    ),
    "UNEXPECTED_KIND": (
        "Checks that every classified kind has a bucket. A kind the classifier never emits is "
        "invisible to it -- this catches a NEW kind appearing, never a kind going missing."
    ),
    "NULL_BASELINE": (
        "Checks that zero rows flip with the resolver flag OFF. It is a control on the "
        "measurement above it; it cannot detect a flip that happens for a reason unrelated to "
        "the resolver dispatch branch."
    ),
}


def refuse_unless(ok: bool, gate: str, message: str) -> None:
    """A guard REFUSES: never `assert` (-O strips it), never exit 1 (that reads as a crash).

    A refusal is a VERDICT and gets its own exit code -- 2. The boundary prints WITH the
    refusal, so whoever reads a red also learns what the gate would NOT have caught.
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
    """★ NAME THE FLAG, NOT THE SYMPTOM. Converting these gates makes THEM -O-proof and leaves
    the impression the file is. It is not: any assert elsewhere in the import closure is still
    stripped. So -O is refused outright at the top of main(), because the run cannot know which
    check it lost. This mirrors dual_denominator_remeasure.py's OPTIMIZED_MODE gate."""
    refuse_unless(not sys.flags.optimize, "OPTIMIZED_MODE", (
        "This generator was invoked under `python -O`, which strips every `assert` statement in "
        "this process. The gates in main() are refusals and survive, but nothing can vouch for "
        "asserts in the modules this file imports. A measurement whose enforcement layer is "
        "partly disabled by an interpreter flag is not a measurement. Re-run without -O."
    ))


@contextmanager
def preflip_dispatch():
    """CAPTURED "BEFORE" MEASUREMENT (R-158 §3: no hand-written constant wearing a
    measurement's name).

    The pre-flip commit (71b911ef~1) returned, at this exact dispatch site, the literal
    line:

        approximation=meta.base_approximation,

    The as-built (post-flip) code returns:

        False if pop_a_kind in POPULATION_A_DEAPPROXIMATED_KINDS else meta.base_approximation

    With POPULATION_A_DEAPPROXIMATED_KINDS emptied, the as-built expression reduces to
    `meta.base_approximation` — byte-identical to the pre-flip line (verify with
    `git show 71b911ef -- src/engine/spec_family_bindings.py`). So emptying the set and
    calling the LIVE bind_condition() is a genuine measurement of pre-flip behaviour, run
    by real production code in-process — not a re-derivation and not a literal.

    The set is a module global read at call time (spec_family_bindings.bind_condition),
    restored in a finally, same discipline as the env-flag forcing in main()."""
    prior = sfb.POPULATION_A_DEAPPROXIMATED_KINDS
    sfb.POPULATION_A_DEAPPROXIMATED_KINDS = frozenset()
    try:
        yield
    finally:
        sfb.POPULATION_A_DEAPPROXIMATED_KINDS = prior

CENSUS_PATH = REPO_ROOT / "docs" / "replay-results" / "h1-battery" / "levelzone-object-reference-census.json"
NARRATION_DENOMINATOR_PATH = (
    REPO_ROOT / "docs" / "replay-results" / "h1-battery" / "narration-reclassification-FINAL.json"
)
OUT_PATH = REPO_ROOT / "docs" / "replay-results" / "h1-battery" / "population-a-flip-step-remeasure.json"


def main() -> None:
    refuse_if_optimized()
    census = json.loads(CENSUS_PATH.read_text(encoding="utf-8"))
    rows = census["rows"]
    n_total_levelzone_rows = census["n"]
    refuse_unless(n_total_levelzone_rows == 16, "FROZEN_CENSUS_SHAPE",
                  f"census row count drifted: expected 16, got {n_total_levelzone_rows}")

    narration = json.loads(NARRATION_DENOMINATOR_PATH.read_text(encoding="utf-8"))
    dual_denominators = narration["dual_denominators"]

    # Force the both-flags-ON scenario for this measurement only (restored after) — the
    # dispatch branch this delivery touches is unreachable with either flag off, so that
    # is the ONLY scenario in which "before" vs "after" differ at all.
    prior_routing = os.environ.get("TF_LEVELZONE_ROUTING_ENABLED")
    prior_resolver = os.environ.get("TF_LEVELZONE_RESOLVER_ENABLED")
    os.environ["TF_LEVELZONE_ROUTING_ENABLED"] = "true"
    os.environ["TF_LEVELZONE_RESOLVER_ENABLED"] = "true"

    per_kind: dict[str, dict] = {
        "named_sr_level": {"n": 0, "n_null": 0, "flipped_to_false": 0, "condition_ids": []},
        "order_block_edge": {"n": 0, "n_null": 0, "flipped_to_false": 0, "condition_ids": []},
        "swing": {"n": 0, "n_null": 0, "flipped_to_false": 0, "condition_ids": []},
    }
    non_population_a_rows = 0
    pop_a_rows = 0
    # MEASURED (not assumed) tallies backing the rate_BEFORE figures below.
    approx_true_before_all_levelzone = 0
    approx_true_before_pop_a = 0
    null_before_non_pop_a = 0

    try:
        for r in rows:
            kind = classify_population_a_kind(r["object"])
            is_pop_a = (not r["bare_anaphora"]) and kind is not None

            cond_all = {"id": r["condition_id"], "type": "WAIT_STRUCTURE", "object": r["object"], "role": r["role"]}
            with preflip_dispatch():
                approx_before_row = bind_condition(cond_all).approximation
            if approx_before_row is True:
                approx_true_before_all_levelzone += 1

            if not is_pop_a:
                non_population_a_rows += 1
                if approx_before_row is None:
                    null_before_non_pop_a += 1
                continue
            pop_a_rows += 1
            if approx_before_row is True:
                approx_true_before_pop_a += 1
            refuse_unless(kind in per_kind, "UNEXPECTED_KIND",
                          f"unexpected kind {kind!r} for {r['condition_id']}")

            cond = {"id": r["condition_id"], "type": "WAIT_STRUCTURE", "object": r["object"], "role": r["role"]}

            # BEFORE: measured, by running the live dispatch with the de-approximation set
            # emptied — see preflip_dispatch() for why that is byte-equivalent to the
            # pre-flip commit's `approximation=meta.base_approximation`.
            with preflip_dispatch():
                b_preflip = bind_condition(cond)
            approximation_before = b_preflip.approximation

            # AFTER: the AS-BUILT (post-flip) dispatch, unpatched.
            b_asbuilt = bind_condition(cond)
            approximation_after = b_asbuilt.approximation

            per_kind[kind]["n"] += 1
            per_kind[kind]["condition_ids"].append(r["condition_id"])
            # n_null: rows where the binding produced no approximation verdict at all
            # (measured, not assumed zero) — a null here would mean the row cannot testify
            # about the flip in either direction.
            if approximation_before is None or approximation_after is None:
                per_kind[kind]["n_null"] += 1
            elif approximation_before is True and approximation_after is False:
                per_kind[kind]["flipped_to_false"] += 1
    finally:
        if prior_routing is None:
            os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
        else:
            os.environ["TF_LEVELZONE_ROUTING_ENABLED"] = prior_routing
        if prior_resolver is None:
            os.environ.pop("TF_LEVELZONE_RESOLVER_ENABLED", None)
        else:
            os.environ["TF_LEVELZONE_RESOLVER_ENABLED"] = prior_resolver

    refuse_unless(pop_a_rows == 7, "POPULATION_SPLIT",
                  f"expected 7 Population-A rows per the frozen census, got {pop_a_rows}")
    refuse_unless(non_population_a_rows == 9, "POPULATION_SPLIT",
                  f"expected 9 non-Population-A level/zone rows, got {non_population_a_rows}")

    total_flipped = sum(per_kind[k]["flipped_to_false"] for k in per_kind)
    refuse_unless(total_flipped == 6, "PER_KIND_FLIP_SPLIT",
                  f"expected exactly 6 rows to de-approximate, got {total_flipped}")
    # ★ THE THREE PER-KIND GATES CARRIED NO MESSAGE AT ALL as asserts -- so under -O they were
    # absent, and WITHOUT -O they failed with a bare AssertionError naming no expectation. A
    # gate that cannot say what it wanted is barely a gate even when it fires. The predicates
    # are unchanged; each now states its own boundary.
    refuse_unless(per_kind["named_sr_level"]["flipped_to_false"] == 4, "PER_KIND_FLIP_SPLIT",
                  "named_sr_level must de-approximate exactly 4 rows, got "
                  f"{per_kind['named_sr_level']['flipped_to_false']}")
    refuse_unless(per_kind["order_block_edge"]["flipped_to_false"] == 2, "PER_KIND_FLIP_SPLIT",
                  "order_block_edge must de-approximate exactly 2 rows, got "
                  f"{per_kind['order_block_edge']['flipped_to_false']}")
    refuse_unless(per_kind["swing"]["flipped_to_false"] == 0, "PER_KIND_FLIP_SPLIT",
                  "swing must de-approximate ZERO rows -- see swing_floor_unchanged for the "
                  f"ground. Got {per_kind['swing']['flipped_to_false']}")

    # NULL BASELINE (R-100 §2 / R-129 §1 discipline, same structural-null pattern as
    # test_r3_binding_engagement_and_evaluation_observability_are_reported_separately_real_corpus's
    # "NULL (resolver flag off): 0/7"): with TF_LEVELZONE_RESOLVER_ENABLED off, the Population-A
    # resolver dispatch branch is UNREACHABLE — every level/zone binding falls back to
    # LEVELZONE_NATIVE_PRIMITIVE or the base structure primitive, both of which assign
    # approximation=meta.base_approximation. Previously asserted here as a structural
    # certainty with hardcoded 0/1.0/1.0; now MEASURED by re-running the same rows with the
    # resolver flag off, so the null is an observation rather than a restatement of the
    # claim it is meant to control (R-158 §3).
    null_flipped_resolver_off = 0
    null_true_pop_a = 0
    null_true_all_levelzone = 0
    prior_resolver_null = os.environ.get("TF_LEVELZONE_RESOLVER_ENABLED")
    os.environ["TF_LEVELZONE_ROUTING_ENABLED"] = "true"
    os.environ["TF_LEVELZONE_RESOLVER_ENABLED"] = "false"
    try:
        for r in rows:
            kind = classify_population_a_kind(r["object"])
            is_pop_a = (not r["bare_anaphora"]) and kind is not None
            cond_null = {"id": r["condition_id"], "type": "WAIT_STRUCTURE", "object": r["object"], "role": r["role"]}
            with preflip_dispatch():
                null_before = bind_condition(cond_null).approximation
            null_after = bind_condition(cond_null).approximation
            if null_after is True:
                null_true_all_levelzone += 1
                if is_pop_a:
                    null_true_pop_a += 1
            if null_before is True and null_after is False:
                null_flipped_resolver_off += 1
    finally:
        os.environ.pop("TF_LEVELZONE_ROUTING_ENABLED", None)
        if prior_resolver_null is None:
            os.environ.pop("TF_LEVELZONE_RESOLVER_ENABLED", None)
        else:
            os.environ["TF_LEVELZONE_RESOLVER_ENABLED"] = prior_resolver_null
        if prior_routing is not None:
            os.environ["TF_LEVELZONE_ROUTING_ENABLED"] = prior_routing

    refuse_unless(null_flipped_resolver_off == 0, "NULL_BASELINE", (
        f"null baseline must show zero flips with the resolver flag off, got {null_flipped_resolver_off}"
    ))
    null_rate_among_pop_a = null_true_pop_a / pop_a_rows
    null_rate_among_all_levelzone = null_true_all_levelzone / n_total_levelzone_rows

    rate_before_among_pop_a = approx_true_before_pop_a / pop_a_rows
    rate_after_among_pop_a = (pop_a_rows - total_flipped) / pop_a_rows
    rate_before_among_all_levelzone = approx_true_before_all_levelzone / n_total_levelzone_rows
    rate_after_among_all_levelzone = (n_total_levelzone_rows - total_flipped) / n_total_levelzone_rows

    out = {
        "artifact": "population-a-flip-step-remeasure",
        "packet": "docs/designs/packet-population-a-flip-step-2026-07-20.md",
        "authority": "R-143 §3 (main sequence, item 1)",
        "APPEND_ONLY": True,
        "does_not_touch": [
            "docs/replay-results/h1-battery/wire1-dod-HONEST-FLOOR.json",
            "docs/replay-results/h1-battery/wire1-dod-remeasure.json",
        ],
        "production_impact_today": {
            "value": "ZERO",
            "reason": (
                "TF_LEVELZONE_ROUTING_ENABLED and TF_LEVELZONE_RESOLVER_ENABLED both default "
                "'false' (unset). The dispatch branch this delivery's approximation flip lives "
                "in (src/engine/spec_family_bindings.py, Population-A resolver block) is "
                "unreachable unless BOTH are explicitly set 'true'. Every number below describes "
                "the both-flags-ON hypothetical, not today's live behavior."
            ),
            "verified_by_test": (
                "src/engine/tests/test_levelzone_population_a_resolver.py::"
                "test_flag_off_binding_plan_invariant_across_flag_absent_and_false_permutations "
                "(same-process flag-off invariance; NOT a captured cross-commit baseline — see "
                "that test's own scope note)"
            ),
        },
        "scope_line": (
            "Census source: docs/replay-results/h1-battery/levelzone-object-reference-census.json "
            "(n=16 level/zone rows, frozen R-097 §3(i) artifact). Both env flags forced ON for "
            "this measurement only. 'before' is MEASURED, not asserted: the live bind_condition() "
            "is run with POPULATION_A_DEAPPROXIMATED_KINDS emptied, which reduces the as-built "
            "dispatch expression to the pre-flip commit's literal "
            "`approximation=meta.base_approximation` (see preflip_dispatch() in this script and "
            "`git show 71b911ef -- src/engine/spec_family_bindings.py`). 'after' is the AS-BUILT "
            "bind_condition() output post-flip. Every n_null below is a counted observation, not "
            "a literal."
        ),
        "dual_denominators": {
            "with_narration_ALL_conditions": dual_denominators["with_narration_ALL_conditions"],
            "without_narration_PRIMARY": dual_denominators["without_narration_PRIMARY"],
            "note": (
                "Carried per R-093 §3 standing convention (every artifact rides both corpus-wide "
                "condition denominators). These 124/111 figures are the corpus-wide narration "
                "denominators and are NOT specific to the 16-row level/zone census below — they "
                "are reproduced here unmodified from narration-reclassification-FINAL.json, primary "
                "reading is without-narration (111)."
            ),
            "source": "docs/replay-results/h1-battery/narration-reclassification-FINAL.json",
        },
        "ceiling": {
            "n_level_zone_rows_total": n_total_levelzone_rows,
            "n_population_a_rows": pop_a_rows,
            "n_population_a_rows_null": sum(v["n_null"] for v in per_kind.values()),
            "n_non_population_a_rows": non_population_a_rows,
            "n_non_population_a_rows_null": null_before_non_pop_a,
            "note": (
                "9 of 16 level/zone rows are UNRESOLVABLE-AS-BUILT (bare anaphora or no kind "
                "matched) and out of this delivery's reach entirely; of the remaining 7 "
                "Population-A rows, 1 is swing (routed, not de-approximated) and 6 are "
                "named_sr_level/order_block_edge (de-approximated). At most 6 of 16 rows can ever "
                "move under this delivery."
            ),
        },
        "per_kind_attribution": {
            kind: {
                "n": v["n"],
                "n_null": v["n_null"],
                "flipped_to_false": v["flipped_to_false"],
                "still_true": v["n"] - v["flipped_to_false"],
                "condition_ids": v["condition_ids"],
            }
            for kind, v in per_kind.items()
        },
        "corpus_rate_among_population_a_rows_hypothetical_both_flags_on": {
            "n": pop_a_rows,
            "n_null": sum(v["n_null"] for v in per_kind.values()),
            "rate_BEFORE": rate_before_among_pop_a,
            "rate_AFTER": round(rate_after_among_pop_a, 4),
            "delta": round(rate_after_among_pop_a - rate_before_among_pop_a, 4),
            "delta_attributed_named_sr_level": round(-(per_kind["named_sr_level"]["flipped_to_false"] / pop_a_rows), 4),
            "delta_attributed_order_block_edge": round(
                -(per_kind["order_block_edge"]["flipped_to_false"] / pop_a_rows), 4
            ),
            "delta_attributed_swing": 0.0,
            "null_baseline_resolver_flag_off": {
                "n": pop_a_rows,
                "flipped": null_flipped_resolver_off,
                "rate": null_rate_among_pop_a,
                "basis": "MEASURED -- same 16 rows re-bound with TF_LEVELZONE_RESOLVER_ENABLED=false; the resolver dispatch branch is unreachable there, so zero rows flip. Counted, not asserted.",
            },
        },
        "corpus_rate_among_all_level_zone_rows_hypothetical_both_flags_on": {
            "n": n_total_levelzone_rows,
            "n_null": sum(v["n_null"] for v in per_kind.values()) + null_before_non_pop_a,
            "rate_BEFORE": rate_before_among_all_levelzone,
            "rate_AFTER": round(rate_after_among_all_levelzone, 4),
            "delta": round(rate_after_among_all_levelzone - rate_before_among_all_levelzone, 4),
            "delta_attributed_named_sr_level": round(
                -(per_kind["named_sr_level"]["flipped_to_false"] / n_total_levelzone_rows), 4
            ),
            "delta_attributed_order_block_edge": round(
                -(per_kind["order_block_edge"]["flipped_to_false"] / n_total_levelzone_rows), 4
            ),
            "delta_attributed_swing": 0.0,
            "null_baseline_resolver_flag_off": {
                "n": n_total_levelzone_rows,
                "flipped": null_flipped_resolver_off,
                "rate": null_rate_among_all_levelzone,
                "basis": "MEASURED -- same 16 rows re-bound with TF_LEVELZONE_RESOLVER_ENABLED=false; the resolver dispatch branch is unreachable there, so zero rows flip. Counted, not asserted.",
            },
        },
        "swing_floor_unchanged": {
            "n": per_kind["swing"]["n"],
            "n_null": per_kind["swing"]["n_null"],
            "still_approximation_true": per_kind["swing"]["n"] - per_kind["swing"]["flipped_to_false"],
            # ★★ R-220 s3: THE THIRD SURVIVING COPY OF A WITHDRAWN GROUND, and the oldest.
            # This read "n=1, below the n>=2 de-approximation floor (R-102 §2)". That reason was
            # withdrawn twice over: the floor ground was retired when the count it rested on was
            # found numerically false, and the GRADE-SCOPE ground that replaced it was retired in
            # turn because a ground that depends on our own permission is not a ground -- it
            # would evaporate the day the grade widened, leaving the disposition with none.
            # ★ THE POINT IS THAT NO COUNT IS THE REPAIR. Whether this population is n=1 or n=50,
            # swing stays approximate for a reason that has nothing to do with how many there
            # are: a swing is the ANCHOR of a fibonacci retracement, and the TAUGHT OBJECT is the
            # 50/61.8% line, which the level/zone primitive does not emit. There is nothing to
            # bind TO. That is a property of what the primitive EMITS -- immune to the row count
            # and to the grade alike. n is still reported below because it is a fact worth
            # having; it is simply no longer load-bearing for anything.
            "reason": (
                "Not flipped, by the ANCHOR-VS-TAUGHT-OBJECT REFUSAL (AR-199 §1): a swing is the "
                "anchor of a fibonacci retracement and the taught object is the 50/61.8% line, "
                "which the level/zone primitive does not emit -- so there is nothing for the row "
                "to bind to. NOT because it falls below the n>=2 de-approximation floor (that "
                "ground was withdrawn: it rested on a count that was numerically false), and NOT "
                "because of the flip's grade scope (withdrawn in turn: a permission is not a "
                "ground). The refusal is about what is emitted, so no row count and no widening "
                "of the grade can move it. Never argued for here."
            ),
        },
        "deapproximated_kinds_set": sorted(POPULATION_A_DEAPPROXIMATED_KINDS),
    }

    OUT_PATH.write_text(json.dumps(out, indent=1, sort_keys=False) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {OUT_PATH}")
    print(json.dumps(out["per_kind_attribution"], indent=1))
    print(json.dumps(out["corpus_rate_among_all_level_zone_rows_hypothetical_both_flags_on"], indent=1))


if __name__ == "__main__":
    main()
