"""F4 SELF-RE-DERIVATION — ALGO-057. Both arm headlines, from the ROW DATA, independently.

WHY IT IMPORTS NOTHING FROM THE EXAM. If this re-derivation called `run_exam_dual_window`'s own
helpers it would be checking the instrument against itself: a summary field read back through
the same code that wrote it agrees with any internally consistent lie. The class names and the
agreement definition are therefore RESTATED HERE from the ruling, and the counts are rebuilt
from `cases[]` rows alone.

It also re-derives the FROZEN 5/8 SET from the calibration arena's own rows, so F2 is evaluated
by SET INCLUSION rather than by comparing two headline strings.

DIAGNOSTIC ONLY. Writes nothing, decides nothing; it produces a receipt for the advisor.
"""
from __future__ import annotations

import io
import json
import sys

#: Restated from ALGO-057 / the baseline's own contract, not imported.
AGREEMENT_CLASSES = {"AGREE", "BOTH_DECLINED"}
CENSORED_PREFIX = "CENSORED"


def load(path):
    return json.load(io.open(path, encoding="utf-8"))


def derive(scorecard):
    """Headline, agreeing set and decided set — from rows only."""
    cases = scorecard["cases"]
    agreeing = {c["session"] for c in cases if c["mismatch_class"] in AGREEMENT_CLASSES}
    decided = {c["session"] for c in cases
               if not str(c["mismatch_class"]).startswith(CENSORED_PREFIX)}
    return {"headline": f"{len(agreeing)}/{len(decided)}",
            "agreeing": sorted(agreeing), "decided": sorted(decided),
            "n_cases": len(cases)}


def main(argv):
    baseline_path, taught_path, frozen_path, exam_path = argv[1:5]

    base = derive(load(baseline_path))
    taught = derive(load(taught_path))
    frozen = derive(load(frozen_path))

    exam = load(exam_path)
    published_base = exam["arms"]["baseline_0930"]["agreement"]
    published_taught = exam["arms"]["taught_0800"]["agreement"]
    published_verdict = exam["verdict"]["verdict"]
    published_lost = exam["verdict"]["lost_agreements"]

    print("=== F4: RE-DERIVED FROM ROWS, INDEPENDENTLY OF THE EXAM MODULE ===")
    for name, d, published in (("baseline_0930", base, published_base),
                               ("taught_0800", taught, published_taught)):
        ok = "MATCH" if d["headline"] == published else "*** MISMATCH ***"
        print(f"  {name:16} re-derived {d['headline']:>5}   published {published:>5}   {ok}")
        print(f"      agreeing: {d['agreeing']}")

    print(f"\n  FROZEN comparator (pre-wiring @09:30): {frozen['headline']}")
    print(f"      agreeing set: {frozen['agreeing']}")

    fz, b, t = set(frozen["agreeing"]), set(base["agreeing"]), set(taught["agreeing"])

    print("\n=== F2 BY SET INCLUSION (not by comparing headline strings) ===")
    lost_vs_frozen_base = sorted(fz - b)
    lost_vs_frozen_taught = sorted(fz - t)
    lost_taught_vs_base = sorted(b - t)
    print(f"  09:30 arm contains the frozen set?      {fz <= b}   lost: {lost_vs_frozen_base}")
    print(f"  08:00 arm contains the frozen set?      {fz <= t}   lost: {lost_vs_frozen_taught}")
    print(f"  08:00 arm contains the 09:30 arm's set? {b <= t}    lost: {lost_taught_vs_base}")
    f2 = (fz <= b) and (fz <= t) and (b <= t)
    print(f"\n  F2 => {'PASS' if f2 else 'FAIL'}")

    print("\n=== A1 CROSS-CHECK (the exam's own rule, re-derived) ===")
    print(f"  re-derived lost (09:30 -> 08:00): {lost_taught_vs_base}")
    print(f"  published lost_agreements       : {published_lost}")
    print(f"  agree on the lost SET? {sorted(lost_taught_vs_base) == sorted(published_lost)}")
    print(f"  published verdict: {published_verdict}")

    print("\n=== COVERAGE ===")
    print("  paths used: the four scorecard artifacts' `cases[]` rows only.")
    print("  NOT verified here: that the arms were run at the windows they claim (that is the")
    print("    run-config's calibration, receipted separately), and that the row-level")
    print("    trader/bot states are themselves correct (frozen labels, custody-pinned).")
    print("  join key: `session`, present on every row of all four artifacts.")
    return 0 if f2 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
