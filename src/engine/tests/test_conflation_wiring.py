"""H1 conflation-check wiring -- WITNESS PAIR through the REAL terminal grade
(ratify-packet h1-conflation-wiring-ratify-2026-07-15.md, §5 verification).

Both polarities flow through `terminal_read_grade` with the STRUCTURAL AXIS now
driven by the calibrated semantic conflation verdict (the 3 mechanical
structural lints are re-stationed to H2 / full_grade and no longer gate here):

  R5L890-FUSED  -> conflation REJECT -> terminal_read_grade == REJECTED, clean=False
  known-good    -> conflation PASS + f2/causality-regex PASS -> CLEAN, clean=True
  absent verdict-> conflation None (fail-closed)              -> INDETERMINATE, clean=False

The verdicts are read from the ACTUAL calibrated conflation-grade artifacts
(conflation_grades/*.json, verdict.verdict) so this test proves the terminal
grade consumes the real grader output, not a hand-typed literal.
"""

import json
from pathlib import Path

from src.engine.extraction import compile_lints as cl
from src.engine.extraction.cert_assembler import terminal_read_grade

# docs/replay-results/h1-scripts/claude-rung-v32/conflation_grades relative to
# the repo root (this file lives at <root>/src/engine/tests/).
_REPO_ROOT = Path(__file__).resolve().parents[3]
_GRADES_DIR = (
    _REPO_ROOT
    / "docs"
    / "replay-results"
    / "h1-scripts"
    / "claude-rung-v32"
    / "conflation_grades"
)

# The R5L890-FUSED calibration REJECT fixture and a known-PASS grade.
_REJECT_GRADE = _GRADES_DIR / "CAL_R5L890_FUSED.json"
_PASS_GRADE = _GRADES_DIR / "-igpOZs8LsM__s0.json"


def _load_verdict(path: Path) -> str:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["verdict"]["verdict"]


def _clean_live_lints() -> dict:
    """A lint_results map whose LIVE terminal axes are clean: f2 PASS and
    causality's regex leg PASS. The 3 structural lints are set PASS too but are
    IGNORED by the re-based terminal gate (re-stationed to H2)."""
    P = cl.STATUS_PASS
    return {
        "direction_conflation_lint": cl.LintResult(P),
        "unsat_sat_check": cl.LintResult(P),
        "or_alternatives_honored": cl.LintResult(P),
        "f2_coverage_gate": cl.LintResult(P),
        "causality_lint": cl.LintResult(P, regex_leg_status=P, same_bar_leg_status=P),
    }


# --------------------------------------------------------------------------- #
# WITNESS PAIR
# --------------------------------------------------------------------------- #


def test_witness_reject_r5l890_fused_is_rejected():
    verdict = _load_verdict(_REJECT_GRADE)
    assert verdict == "REJECT", "fixture drift: R5L890-FUSED must grade REJECT"
    res = terminal_read_grade(_clean_live_lints(), conflation_verdict=verdict)
    assert res["grade"] == "REJECTED"
    assert res["clean"] is False
    assert res["disposition"]["conflation_check"] == "REJECT"


def test_witness_pass_known_good_is_clean():
    verdict = _load_verdict(_PASS_GRADE)
    assert verdict == "PASS", "fixture drift: known-good grade must be PASS"
    res = terminal_read_grade(_clean_live_lints(), conflation_verdict=verdict)
    assert res["grade"] == "CLEAN"
    assert res["clean"] is True
    assert res["disposition"]["conflation_check"] == "PASS"


def test_witness_fail_closed_absent_verdict_is_indeterminate():
    # No conflation verdict supplied (check absent/errored) -> fail-closed.
    res = terminal_read_grade(_clean_live_lints(), conflation_verdict=None)
    assert res["grade"] == "INDETERMINATE"
    assert res["clean"] is False
    assert res["disposition"]["conflation_check"] == "NOT_EVALUATED"


# --------------------------------------------------------------------------- #
# Live-axis interaction with the structural (conflation) axis
# --------------------------------------------------------------------------- #


def test_conflation_pass_but_live_lint_fail_is_rejected():
    lints = _clean_live_lints()
    lints["f2_coverage_gate"] = cl.LintResult(cl.STATUS_FAIL)
    res = terminal_read_grade(lints, conflation_verdict="PASS")
    assert res["grade"] == "REJECTED"
    assert res["clean"] is False


def test_conflation_reject_dominates_live_not_evaluated():
    # conflation REJECT (FAIL) must dominate a NOT_EVALUATED live axis -> REJECTED.
    lints = _clean_live_lints()
    lints["causality_lint"] = cl.LintResult(
        cl.STATUS_PASS,
        regex_leg_status=cl.STATUS_NOT_EVALUATED,
        same_bar_leg_status=cl.STATUS_PASS,
    )
    res = terminal_read_grade(lints, conflation_verdict="REJECT")
    assert res["grade"] == "REJECTED"


def test_structural_lints_are_re_stationed_not_gating():
    # Even with all 3 structural lints FAILING, the terminal gate ignores them:
    # conflation PASS + clean live axes -> CLEAN. Proves the re-station.
    lints = _clean_live_lints()
    lints["direction_conflation_lint"] = cl.LintResult(cl.STATUS_FAIL)
    lints["unsat_sat_check"] = cl.LintResult(cl.STATUS_FAIL)
    lints["or_alternatives_honored"] = cl.LintResult(cl.STATUS_FAIL)
    res = terminal_read_grade(lints, conflation_verdict="PASS")
    assert res["grade"] == "CLEAN"
    assert res["clean"] is True
    for name in ("direction_conflation_lint", "unsat_sat_check", "or_alternatives_honored"):
        assert res["disposition"][name] == "RE_STATIONED_TO_H2"
