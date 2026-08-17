#!/usr/bin/env python3
"""AR-1281 §C — deterministic post-call proof.

Feeds the ACTUAL returned sVkm conflation verdict through the EXISTING production
terminal-read/certificate logic (`cert_assembler.terminal_read_grade`) with the current
unresolved anchoring state. Nothing here re-implements the policy and nothing is
hand-authored: the verdict is read from the landed artifact and the other axis statuses
are read from the landed certificate.

Discriminating evidence required by AR-1280A §4.C:
  * if PASS -> terminal_read_grade becomes CLEAN while pilot_grade REMAINS false,
    because the frozen-eight / anchoring axis is still unresolved;
  * if REJECT -> certification is correctly rejected and the packet STOPS.

CONTROL (load-bearing): re-running with conflation=None must reproduce the certificate's
RECORDED baseline (INDETERMINATE / clean=false). Without that, a harness that always
prints CLEAN would be indistinguishable from a faithful one.

    python scripts/ar1281_terminal_read_proof.py
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.engine.extraction import compile_lints as cl  # noqa: E402
from src.engine.extraction.cert_assembler import terminal_read_grade  # noqa: E402

VERDICT_PATH = ROOT / "docs/replay-results/svkm-extraction-certified/grade/conflation_verdict.json"
CERT_PATH = ROOT / "docs/replay-results/svkm-extraction-certified/grade/certificate.json"


def main() -> int:
    va = json.loads(VERDICT_PATH.read_text(encoding="utf-8"))
    actual = va["verdict"]["verdict"]

    cert = json.loads(CERT_PATH.read_text(encoding="utf-8"))["results"][0]["certificate"]
    disp = cert["terminal_read_disposition"]
    pilot_grade = cert["pilot_grade"]

    # Rebuild the live non-conflation axes EXACTLY as the landed certificate recorded them.
    lint_results = {
        "f2_coverage_gate": cl.LintResult(status=disp["f2_coverage_gate"]),
        "causality_lint": cl.LintResult(
            status=disp["causality_lint.regex_leg"],
            regex_leg_status=disp["causality_lint.regex_leg"],
            same_bar_leg_status=None,
        ),
    }

    print("INPUTS (all read from landed artifacts, none hand-authored)")
    print(f"  actual conflation verdict        : {actual}   <- from {VERDICT_PATH.name}")
    print(f"  f2_coverage_gate (recorded)      : {disp['f2_coverage_gate']}")
    print(f"  causality_lint.regex_leg         : {disp['causality_lint.regex_leg']}")
    print(f"  enumeration_consistency          : {disp['enumeration_consistency']}")
    print(f"  pilot_grade (recorded, unchanged): {pilot_grade}")
    print(f"  unanchored_condition_count       : {cert.get('unanchored_condition_count')}")

    print("\nCONTROL — conflation=None must reproduce the RECORDED baseline")
    base = terminal_read_grade(lint_results, conflation_verdict=None)
    rec_grade, rec_clean = cert["terminal_read_grade"], cert["terminal_read_clean"]
    print(f"  recomputed : grade={base['grade']} clean={base['clean']}")
    print(f"  recorded   : grade={rec_grade} clean={rec_clean}")
    faithful = base["grade"] == rec_grade and base["clean"] == rec_clean
    print(f"  => harness {'REPRODUCES the certificate (faithful)' if faithful else 'DIVERGES (UNTRUSTWORTHY)'}")
    if not faithful:
        print("  !! refusing to report a flip from a harness that cannot reproduce the baseline")
        return 1

    print("\nLIVE — the actual returned verdict fed through production logic")
    live = terminal_read_grade(lint_results, conflation_verdict=actual)
    full_grade = bool(pilot_grade) and live["clean"]
    print(f"  conflation_check   : {live['disposition']['conflation_check']}")
    print(f"  terminal_read_grade: {live['grade']}")
    print(f"  terminal_read_clean: {live['clean']}")
    print(f"  pilot_grade        : {pilot_grade}  (UNCHANGED — frozen-eight/anchoring axis unresolved)")
    print(f"  full_grade         = pilot_grade AND terminal_read.clean = {full_grade}")
    print(f"  certificate_grade  = {full_grade}  (bool alias of full_grade)")

    print("\nDISCRIMINATION — counterfactual on the same harness")
    for cf in ("PASS", "REJECT", None):
        r = terminal_read_grade(lint_results, conflation_verdict=cf)
        print(f"  conflation={str(cf):<6} -> grade={r['grade']:<13} clean={r['clean']}")

    print("\nCONCLUSION")
    if actual == "PASS":
        if live["clean"]:
            print("  CONFLATION_PASS_ONLY_FROZEN_G2_REMAINS")
            print("  The semantic conjunct is now SATISFIED and no longer blocks certification.")
            print("  certificate_grade stays False solely because pilot_grade is False.")
        else:
            print("  PASS returned but terminal read is still not clean — another axis is unresolved.")
    else:
        print("  CONFLATION_REJECT_CERTIFICATION_STOPS")
        print("  Do NOT spend frozen G2 on a strategy whose semantic terminal read fails.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
