#!/usr/bin/env python3
"""RED-PROOF for the displacement-gate sub-cause instrument. Lands nothing.

The artifact this proves is `run_displacement_gate_subcause_2026_08_24.py`, whose published
claim is a PER-FLAG attribution: which of `is_true_displacement`'s three conjuncts refused.
A guard that only checks the AGGREGATE verdict cannot pin a per-flag claim, so this proves
the per-flag pins directly.

DISCIPLINE (ALGO ledger): positive witness FIRST; every planted defect goes RED and returns
GREEN; the CLASS is named and every member attacked, not just the member demonstrated;
failure sets compared by MEMBERSHIP.

CLASS UNDER ATTACK: any single decomposition flag mis-set.
MEMBERS: dir_ok · body_frac_ok · close_loc_ok · reference_range_ok · range_expansion_ok.

STATED LIMIT, not hidden: a flag a row does NOT publish may be unpinned in that state (e.g.
the range term on a row whose momentum already failed). The instrument measures that per row
as `published_attribution_pinned`; this proof asserts the invariant that every PUBLISHED flag
goes RED when flipped. An earlier planted defect patched `brk._geom` and stayed GREEN because
`_geom` is read by BOTH layers - same-layer agreement is not evidence, and that defect class
is out of this check's reach by construction.

NO PnL, realized outcome, winner/loser label or clean-edge result is read anywhere.
"""
from __future__ import annotations

import sys

import pandas as pd

from research import current_mnq_strategy_v2_4_breakout_derivation as brk
from research import run_displacement_gate_subcause_2026_08_24 as M

BF, CL, RR = 0.62, 0.78, 1.25
FLAGS = ("dir_ok", "body_frac_ok", "close_loc_ok",
         "reference_range_ok", "range_expansion_ok")


def _frame(bars):
    return pd.DataFrame(
        bars, columns=["open", "high", "low", "close"],
        index=pd.date_range("2026-03-24 09:00", periods=len(bars), freq="5min"))


#: Three witnesses in DIFFERENT states of the world, so the class is attacked in each.
CASES = {
    "momentum-binding L (weak body)":
        ([[100, 101, 99, 100.5]] * 5 + [[100, 101, 99, 100.2]]
         + [[100, 101, 99, 100.5]] * 2, "L"),
    "range-binding L (strong body, small range)":
        ([[100, 120, 80, 110]] * 5 + [[100, 101, 100, 100.9]]
         + [[100, 101, 99, 100.5]] * 2, "L"),
    "wrong-direction S":
        ([[100, 120, 80, 90]] * 5 + [[100, 101, 99, 100.4]]
         + [[100, 101, 99, 99.5]] * 2, "S"),
}


def _capture(completed, trigger, direction):
    M.CAP.clear()
    M._wrapped_prebreak_displacement(completed, trigger, 99.0, 101.0,
                                     direction, BF, CL, RR)
    assert len(M.CAP) == 1, f"expected exactly 1 capture, got {len(M.CAP)}"
    return M.CAP[0]


def main() -> int:
    failures: list[str] = []
    original = M._decompose_flags

    print("=== RED-PROOF: displacement-gate sub-cause instrument ===")
    print("CLASS: any single decomposition flag mis-set. "
          "MEMBERS: " + " · ".join(FLAGS) + "\n")

    for name, (bars, direction) in CASES.items():
        completed = _frame(bars)
        trigger = completed.iloc[-1]

        # The witness must actually be a NOT_DISPLACEMENT refusal, or it proves nothing.
        real = brk.prebreak_displacement(completed, trigger, 99.0, 101.0,
                                         direction, BF, CL, RR)
        if real.refusal != brk.NOT_DISPLACEMENT:
            failures.append(f"{name}: NOT A WITNESS (refusal={real.refusal})")
            print(f"{name}: NOT A WITNESS ({real.refusal})\n")
            continue

        base = _capture(completed, trigger, direction)
        published = base["published_attribution_flag"]
        print(f"{name}\n  POSITIVE WITNESS: agrees={base['decomposition_agrees']} "
              f"published={published} pinned={base['published_attribution_pinned']} "
              f"first={M._first_failing(base)}")
        if not base["decomposition_agrees"]:
            failures.append(f"{name}: positive witness NOT GREEN")

        for flag in FLAGS:
            def planted(fl):
                def g(row, d, bf, cl, ref, rr):
                    x = original(row, d, bf, cl, ref, rr)
                    x[fl] = not x[fl]
                    return x
                return g

            M._decompose_flags = planted(flag)
            try:
                got = _capture(completed, trigger, direction)["decomposition_agrees"]
            finally:
                M._decompose_flags = original

            is_published = (flag == published)
            red = got is False
            mark = "RED  " if red else "green"
            tag = "  <-- PUBLISHED by this row" if is_published \
                else "  (not published by this row)"
            print(f"    flip {flag:<20} {mark}{tag}")
            if is_published and not red:
                failures.append(
                    f"{name}: flipping PUBLISHED flag {flag} did NOT go RED")

        # RESTORE must return byte-identical behaviour, or the proof is worthless.
        after = _capture(completed, trigger, direction)
        if after != base:
            failures.append(f"{name}: capture did NOT restore identically")
        print(f"    restored: {'GREEN, identical to witness' if after == base else 'DRIFTED'}\n")

    # ---- Route D composite parse: positive + negative controls ------------------------
    print("=== Route D composite-literal parse ===")
    good = ("NEITHER_ACCEPTED_BREAK_RETEST_NOR_PREBREAK_REPEAT_TEST_QUALIFIED: "
            "accepted_break=NO_COMPLETED_PRINT_BEYOND_THE_ZONE; "
            "repeat_test=REPEAT_TEST_WITHOUT_A_REAL_PRIOR_TEST")
    parsed = M._decompose_d(good)
    print(f"  positive: {parsed}")
    if parsed != ("NO_COMPLETED_PRINT_BEYOND_THE_ZONE",
                  "REPEAT_TEST_WITHOUT_A_REAL_PRIOR_TEST"):
        failures.append("Route D positive parse FAILED")

    # NEGATIVE CONTROLS - a parser that never refuses is not a parser.
    for bad in ("FORCE_NOT_CONFIRMED",
                "NEITHER_ACCEPTED_BREAK_RETEST_NOR_PREBREAK_REPEAT_TEST_QUALIFIED: garbage",
                good.replace("repeat_test=", "repeatTest="),
                good.replace("accepted_break=", "acceptedBreak=")):
        if M._decompose_d(bad) is not None:
            failures.append(f"Route D negative control PARSED: {bad!r}")
        else:
            print(f"  negative control correctly refused: {bad[:58]}...")

    print()
    if failures:
        print("RED-PROOF FAILED — membership of the failure set:")
        for f in failures:
            print("  - " + f)
        return 1
    print("RED-PROOF PASSED: every PUBLISHED attribution flip goes RED, "
          "every witness restores identically, every negative control refuses.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
