"""RED-PROOF for session_role_resolver_yield.py (R-503 lane I7, §5.H).

★★★★★ WHY THIS FILE EXISTS: the instrument ships 26 PASSING assertions.
`A GREEN CHECK WITH NO PATH TO RED IS NOT EVIDENCE` — a stop condition owes a
DISCRIMINATES fixture. This harness plants a defect per assertion class and
proves the assertion GOES RED, then proves the UNMUTATED control stays GREEN.
`A MUTATION SUITE WITHOUT THE UNMUTATED CONTROL CANNOT TELL "CATCHES BREAKAGE"
FROM "ALWAYS RED".`

Each mutation is chosen to be the SHARPEST one for the law it guards:

  M1  swaps ONE baseline identity for a fake, keeping the COUNT identical.
      This is R-425's defect exactly -- "a count is satisfied by losing one row
      and gaining another". The count assertions MUST stay green and only the
      IDENTITY assertion may go red. A mutation that reddens everything proves
      nothing about which check did the work.
  M2  moves a NON-family row's reason between arms -> the non-C2 movement
      hard stop must fire.
  M3  reports the binder as dirty -> the provenance intersection must fire.
  M4  makes the ON arm identical to the OFF arm -> the POSITIVE WITNESS must
      fire, proving the two empty-census assertions cannot pass vacuously.

The instrument writes its artifact to OUT_PATH; this harness REDIRECTS that to a
throwaway path so a mutated run can never overwrite the real artifact.
"""

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = HERE / "session_role_resolver_yield.py"


def load_instrument():
    """Fresh module object per run -- ASSERTIONS is module-level state and a
    reused import would accumulate results across mutations."""
    spec = importlib.util.spec_from_file_location("_sry_under_test", TARGET)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.OUT_PATH = Path(tempfile.gettempdir()) / "_redproof_discard.json"
    return mod


def run(mutate=None):
    mod = load_instrument()
    mod.ASSERTIONS.clear()
    if mutate:
        mutate(mod)
    rc = mod.main()
    return rc, {a["assertion"]: a["PASS"] for a in mod.ASSERTIONS}


# ── MUTATIONS ────────────────────────────────────────────────────────────────
def m1_swap_one_baseline_identity(mod):
    orig = mod.baseline_c2_population

    def patched():
        base, conds, keys = orig()
        keys = sorted(set(keys[:-1]) | {"ZZZ-FAKE.spec.json::WAIT_SESSION:not-a-real-row#0"})
        return base, conds, keys
    mod.baseline_c2_population = patched


def m2_move_a_non_family_row(mod):
    orig = mod.bind_all

    def patched(conditions, flag_value):
        out = orig(conditions, flag_value)
        if flag_value == "true":
            for k, v in out.items():
                if v.get("type") != mod.FAMILY_TYPE and "ERROR" not in v:
                    v["reason"] = "PLANTED_NON_FAMILY_MOVEMENT"
                    break
        return out
    mod.bind_all = patched


def m3_report_binder_dirty(mod):
    orig = mod.dirty_paths
    mod.dirty_paths = lambda: sorted(set(orig()) | {"src/engine/spec_family_bindings.py"})


def m4_make_arms_identical(mod):
    orig = mod.bind_all
    mod.bind_all = lambda conditions, flag_value: orig(conditions, "false")


def m5_pretend_capability_was_ported(mod):
    """Point the 'deployed' binder at the CAMPAIGN binder, so every capability
    symbol reads as PRESENT in deployed -- i.e. simulate the port having
    happened. The scope tripwire MUST fire, because that is precisely when the
    artifact's campaign-lane scope sentence becomes stale."""
    mod.DEPLOYED_BINDER = mod.REPO_ROOT / "src/engine/spec_family_bindings.py"


def m6_plant_a_deployed_only_symbol(mod):
    """Give the deployed binder a symbol the campaign lane does not have. The
    subset-or-equal assertion must fire -- a deployed-only symbol means a port
    would have to RECONCILE rather than merely ADD.

    ⚠️ THIS MUTATION SILENTLY STOPPED BITING ONCE. It patched `top_level_symbols`
    while the scope code was refactored to call `top_level_nodes`, so it became
    a no-op and the case reported exit=0 / reddened=0. It is fixed to patch the
    function the code ACTUALLY calls. `A MUTATION THAT NO LONGER BITES IS A
    PROOF THAT EVAPORATED WITHOUT ANYONE EDITING IT` -- and the only reason it
    was caught is that this harness FAILS LOUD when its target stays green.
    """
    orig = mod.top_level_nodes

    def patched(path):
        n = dict(orig(path))
        if str(path) == str(mod.DEPLOYED_BINDER):
            n["ZZZ_PLANTED_DEPLOYED_ONLY_SYMBOL"] = next(iter(n.values()))
        return n
    mod.top_level_nodes = patched
    mod.top_level_symbols = lambda p: set(patched(p))


def m7_make_symbol_sets_equal(mod):
    """Make the deployed symbol set EQUAL the campaign set. `dep <= camp` is
    satisfied by equality; `dep < camp` is NOT. This is the case the retired
    `STRICT_SUBSET` predicate silently absorbed."""
    orig = mod.top_level_nodes

    def patched(path):
        n = orig(path)
        if str(path) == str(mod.DEPLOYED_BINDER):
            return dict(orig(mod.REPO_ROOT / "src/engine/spec_family_bindings.py"))
        return n
    mod.top_level_nodes = patched
    mod.top_level_symbols = lambda p: set(patched(p))


CASES = [
    ("M1_baseline_identity_swapped_COUNT_PRESERVED", m1_swap_one_baseline_identity,
     "A_OFF_unbound_IDENTITIES_equal_baseline_identities__NOT_JUST_THE_COUNT",
     ["A_OFF_reproduces_pinned_baseline__n_unbound",
      "A_OFF_reproduces_pinned_baseline__n_bindable",
      "A_OFF_reproduces_pinned_baseline__bound_and_concrete"]),
    ("M2_non_family_row_moved", m2_move_a_non_family_row,
     "A_no_unexpected_movement_outside_the_WAIT_SESSION_family", []),
    ("M3_binder_reported_dirty", m3_report_binder_dirty,
     "PROVENANCE_source_closure_dirty_intersection_is_ZERO", []),
    ("M4_arms_made_identical", m4_make_arms_identical,
     "POSITIVE_WITNESS_the_arms_actually_moved_rows_INSIDE_the_family", []),
    # ⚠️ R-507 §6.3 -- M5's COLLATERAL-GREEN CLAIM IS WITHDRAWN. It previously
    #   asserted the strict-subset check STAYED GREEN under this mutation. It
    #   did -- but only because the old predicate passed on EQUALITY, and this
    #   mutation makes the two sets equal by pointing both at one file. The
    #   green was the DEFECT WEARING THE PROOF'S UNIFORM, not independence.
    #   Collateral contract is now EMPTY; whatever it reddens is REPORTED.
    ("M5_capability_pretended_PORTED", m5_pretend_capability_was_ported,
     "SCOPE_TRIPWIRE_capability_still_ABSENT_from_the_deployed_lane",
     []),
    ("M6_deployed_only_symbol_planted", m6_plant_a_deployed_only_symbol,
     "SCOPE_deployed_symbols_are_a_SUBSET_OR_EQUAL_of_campaign",
     []),
    # ★★★★★ R-507 §6.2 -- THE MUTATION THE OLD PREDICATE COULD NOT SEE.
    #   Equality satisfies subset-OR-equal and must NOT satisfy strict subset.
    #   The retired `STRICT_SUBSET` key passed here, which is precisely why
    #   M5's collateral-green was vacuous.
    ("M7_sets_made_EQUAL", m7_make_symbol_sets_equal,
     "SCOPE_deployed_symbols_are_a_STRICT_SUBSET_of_campaign",
     ["SCOPE_deployed_symbols_are_a_SUBSET_OR_EQUAL_of_campaign"]),
]


def main():
    results = []

    # ── THE CONTROL. Without it, "the mutation went red" is unreadable. ──────
    rc, control = run()
    control_ok = rc == 0 and all(control.values())
    results.append({"case": "CONTROL_unmutated", "exit_code": rc,
                    "all_assertions_pass": all(control.values()),
                    "VERDICT": "GREEN" if control_ok else "UNEXPECTED-RED",
                    "OK": control_ok})
    print("[%s] CONTROL_unmutated -- exit=%d, %d/%d assertions pass"
          % ("OK " if control_ok else "BAD", rc,
             sum(control.values()), len(control)))

    for name, mutate, must_redden, must_stay_green in CASES:
        rc, got = run(mutate)
        reddened = got.get(must_redden) is False
        collateral = [k for k in must_stay_green if got.get(k) is not True]
        exited_nonzero = rc != 0
        ok = reddened and exited_nonzero and not collateral
        all_red = sorted(k for k, v in got.items() if v is False)
        results.append({
            "case": name,
            "assertion_that_must_go_RED": must_redden,
            "it_went_RED": reddened,
            "exit_code": rc,
            "exit_code_is_nonzero": exited_nonzero,
            "assertions_that_must_STAY_GREEN": must_stay_green,
            "collateral_failures": collateral,
            # ★ R-507 §6.3/§6.10 -- report EVERY assertion this mutation
            #   reddened, whether or not a contract was declared for it. A
            #   mutation's blast radius is evidence and must not be hidden by
            #   an empty collateral contract.
            "ALL_assertions_this_mutation_reddened": all_red,
            "n_reddened": len(all_red),
            "VERDICT": "DISCRIMINATES" if ok else "DOES-NOT-DISCRIMINATE",
            "OK": ok,
        })
        print("[%s] %-42s -> %-62s RED=%s exit=%d reddened=%d collateral=%s"
              % ("OK " if ok else "BAD", name, must_redden, reddened, rc,
                 len(all_red), collateral))

    all_ok = all(r["OK"] for r in results)
    import subprocess

    def git(*a):
        try:
            return subprocess.check_output(["git", *a], cwd=str(HERE.parents[2]),
                                           stderr=subprocess.DEVNULL).decode().strip()
        except Exception as exc:
            return "<unavailable: %s>" % exc

    n_control = len(control)
    out = {
        # ── R-507 §6.9 -- the header claim, corrected and NARROWED ───────────
        "WHAT_THIS_PROVES": (
            "The %d assertions in session_role_resolver_yield.py were run unmutated and all "
            "passed, and each assertion CLASS listed in ASSERTION_CLASSES_WITH_A_DEMONSTRATED_"
            "RED_PATH below has at least one mutation that reddens it. A guard that has never "
            "gone red is not an instrument." % n_control
        ),
        "⚠️_WHAT_THIS_DOES_NOT_PROVE": (
            "This is NOT universal coverage. Assertions outside the listed classes have NO "
            "demonstrated red path here and must not be read as red-proofed. An earlier "
            "version of this receipt claimed 'every assertion class' over a 26-assertion run "
            "and that claim was BOTH stale in its count AND wider than its evidence."
        ),
        "ASSERTION_CLASSES_WITH_A_DEMONSTRATED_RED_PATH": {
            "baseline_identity_join": "M1",
            "non_family_movement_hard_stop": "M2",
            "provenance_source_closure": "M3",
            "positive_witness_for_empty_censuses": "M4",
            "deployed_scope_capability_tripwire": "M5",
            "deployed_scope_subset_or_equal": "M6",
            "deployed_scope_STRICT_subset": "M7",
        },
        "ASSERTION_CLASSES_WITHOUT_ONE": [
            "corpus/population size vs pinned baseline", "determinism", "invalidation counts",
            "count-equals-identity-list-length", "gate/held-flag controls",
            "shared-symbol body comparison", "deployed HEAD resolution",
        ],
        "M1_IS_THE_SHARP_ONE": (
            "M1 swaps one baseline identity while PRESERVING THE COUNT. The three count "
            "assertions stay GREEN and only the identity assertion goes RED -- which is "
            "R-425's defect ('a count is satisfied by losing one row and gaining another') "
            "reproduced and caught."
        ),
        "⚠️_M5_COLLATERAL_CLAIM_WITHDRAWN": (
            "R-507 §2. A previous receipt claimed M5 reddened the scope tripwire while the "
            "strict-subset assertion STAYED GREEN, and read that as proof the two checks were "
            "independent. That green was VACUOUS: M5 points both symbol sets at ONE file, and "
            "the then-current predicate tested subset-OR-EQUAL, which equality satisfies. "
            "`A COLLATERAL-GREEN THAT PASSES BECAUSE THE PREDICATE IS TOO WEAK TO NOTICE IS "
            "NOT EVIDENCE OF INDEPENDENCE -- IT IS THE DEFECT WEARING THE PROOF'S UNIFORM.` "
            "M5's collateral contract is now EMPTY and its full blast radius is reported in "
            "ALL_assertions_this_mutation_reddened. Independence of the subset-or-equal and "
            "STRICT-subset checks is re-derived from M6 and M7, which redden DIFFERENT ones."
        ),
        # ── R-507 §6.11 -- this receipt's own provenance ─────────────────────
        "PROVENANCE": {
            "head": git("rev-parse", "HEAD"),
            "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
            "harness_blob": git("hash-object", "--",
                                "docs/replay-results/h1-battery/"
                                "session_role_resolver_yield_REDPROOF.py"),
            "generator_blob": git("hash-object", "--",
                                  "docs/replay-results/h1-battery/"
                                  "session_role_resolver_yield.py"),
            "artifact_blob": git("hash-object", "--",
                                 "docs/replay-results/h1-battery/"
                                 "session-role-resolver-yield-2026-07-31.json"),
            "reproduce": ("python docs/replay-results/h1-battery/"
                          "session_role_resolver_yield_REDPROOF.py"),
            "NOTE": "Mutated runs write their artifact to a throwaway temp path, so no "
                    "mutation can overwrite the real artifact.",
        },
        "ALL_CASES_DISCRIMINATE": all_ok,
        "cases": results,
    }
    path = HERE / "session-role-resolver-yield-REDPROOF-2026-07-31.json"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    print("\nALL CASES DISCRIMINATE: %s" % all_ok)
    print("receipt -> %s" % path)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
