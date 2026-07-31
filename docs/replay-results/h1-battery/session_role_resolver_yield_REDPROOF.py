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
        results.append({
            "case": name,
            "assertion_that_must_go_RED": must_redden,
            "it_went_RED": reddened,
            "exit_code": rc,
            "exit_code_is_nonzero": exited_nonzero,
            "assertions_that_must_STAY_GREEN": must_stay_green,
            "collateral_failures": collateral,
            "VERDICT": "DISCRIMINATES" if ok else "DOES-NOT-DISCRIMINATE",
            "OK": ok,
        })
        print("[%s] %-42s -> %-70s RED=%s exit=%d collateral=%s"
              % ("OK " if ok else "BAD", name, must_redden, reddened, rc, collateral))

    all_ok = all(r["OK"] for r in results)
    out = {
        "WHAT_THIS_PROVES": (
            "Every assertion class in session_role_resolver_yield.py has a demonstrated "
            "path to RED, and the unmutated control stays GREEN. A guard that has never "
            "gone red is not an instrument."
        ),
        "M1_IS_THE_SHARP_ONE": (
            "M1 swaps one baseline identity while PRESERVING THE COUNT. The three count "
            "assertions stay GREEN and only the identity assertion goes RED -- which is "
            "R-425's defect ('a count is satisfied by losing one row and gaining another') "
            "reproduced and caught. If the count checks had also reddened, this suite would "
            "not have shown that the IDENTITY check is what does the work."
        ),
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
