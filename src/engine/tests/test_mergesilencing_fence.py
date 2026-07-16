"""Merge-silencing fence -- terminal_read_grade fail-closed unit tests.

STRUCTURAL AXIS RE-BASED (ratify-packet h1-conflation-wiring-ratify-2026-07-15.md,
superseding the lint-gated structural axis of h1-mergesilencing-fence-ratify-
packet-2026-07-13.md): the 3 mechanical structural lints
(direction_conflation/unsat_sat/or_alternatives) were proven BLIND on prose and
are RE-STATIONED to H2 / full_grade -- they no longer gate the terminal read.
The structural axis is now the calibrated semantic conflation verdict
(`conflation_verdict`), fail-closed on None. Live axes: conflation, f2, and
causality's regex leg. causality's same_bar leg stays exempt (not load-bearing).

Closes the §2 wiring-verify CRIT: pilot_grade gates only f2+causality-regex, so
a merge-silenced object sails through it. terminal_read_grade fails it via the
conflation REJECT verdict (or INDETERMINATE when no verdict was supplied).
"""
from src.engine.extraction import compile_lints as cl
from src.engine.extraction.cert_assembler import terminal_read_grade

P, F, NE = cl.STATUS_PASS, cl.STATUS_FAIL, cl.STATUS_NOT_EVALUATED


def _lints(direction=P, unsat=P, or_alt=P, f2=P, regex=P, same_bar=P):
    """Build a full lint_results map. The 3 structural lints are still present
    (they feed full_grade) but are NO LONGER read by the terminal gate.
    causality carries regex_leg_status + same_bar_leg_status."""
    return {
        "direction_conflation_lint": cl.LintResult(direction),
        "unsat_sat_check": cl.LintResult(unsat),
        "or_alternatives_honored": cl.LintResult(or_alt),
        "f2_coverage_gate": cl.LintResult(f2),
        "causality_lint": cl.LintResult(
            P, regex_leg_status=regex, same_bar_leg_status=same_bar
        ),
    }


def test_all_pass_is_clean():
    r = terminal_read_grade(_lints(), conflation_verdict="PASS")
    assert r["grade"] == "CLEAN" and r["clean"] is True


def test_conflation_reject_rejected():
    # the structural axis: a REJECT conflation verdict -> REJECTED
    r = terminal_read_grade(_lints(), conflation_verdict="REJECT")
    assert r["grade"] == "REJECTED" and r["clean"] is False


def test_conflation_absent_is_indeterminate():
    # no conflation verdict supplied (check absent/errored) -> INDETERMINATE (fail-closed)
    r = terminal_read_grade(_lints(), conflation_verdict=None)
    assert r["grade"] == "INDETERMINATE" and r["clean"] is False


def test_structural_lints_no_longer_gate():
    # all 3 structural lints FAIL, but conflation PASS + clean live axes -> CLEAN.
    # Proves the 3 lints are re-stationed, not gating the terminal read.
    r = terminal_read_grade(_lints(direction=F, unsat=F, or_alt=F), conflation_verdict="PASS")
    assert r["grade"] == "CLEAN" and r["clean"] is True
    for name in ("direction_conflation_lint", "unsat_sat_check", "or_alternatives_honored"):
        assert r["disposition"][name] == "RE_STATIONED_TO_H2"


def test_f2_fail_rejected():
    r = terminal_read_grade(_lints(f2=F), conflation_verdict="PASS")
    assert r["grade"] == "REJECTED" and r["clean"] is False


def test_causality_regex_leg_fail_rejected():
    r = terminal_read_grade(_lints(regex=F), conflation_verdict="PASS")
    assert r["grade"] == "REJECTED" and r["clean"] is False


def test_causality_same_bar_leg_is_exempt_not_load_bearing():
    # same_bar leg NOT_EVALUATED while everything else PASS -> STILL CLEAN
    # (provably-not-load-bearing exemption; execution timing != extraction fidelity)
    r = terminal_read_grade(_lints(same_bar=NE), conflation_verdict="PASS")
    assert r["grade"] == "CLEAN" and r["clean"] is True
    assert r["disposition"]["causality_lint.same_bar_leg"] == "EXEMPT_NOT_LOAD_BEARING"


def test_fail_precedes_not_evaluated():
    # conflation REJECT (FAIL) + a NOT_EVALUATED live axis -> REJECTED (FAIL dominates)
    r = terminal_read_grade(_lints(regex=NE), conflation_verdict="REJECT")
    assert r["grade"] == "REJECTED"


def test_live_not_evaluated_is_indeterminate():
    # conflation PASS but a live axis NOT_EVALUATED -> INDETERMINATE
    r = terminal_read_grade(_lints(regex=NE), conflation_verdict="PASS")
    assert r["grade"] == "INDETERMINATE" and r["clean"] is False


def test_disposition_table_covers_every_axis_no_silent_exemption():
    r = terminal_read_grade(_lints(), conflation_verdict="PASS")
    d = r["disposition"]
    for name in ("conflation_check", "direction_conflation_lint", "unsat_sat_check",
                 "or_alternatives_honored", "f2_coverage_gate",
                 "causality_lint.regex_leg", "causality_lint.same_bar_leg"):
        assert name in d, f"axis {name} missing from disposition -> silent exemption"


# --- WIRING (grader finding F fix): aggregate exposes the fenced fraction, and
# a merge-silenced cert is excluded from it while still counted by the old one.
def test_aggregate_exposes_terminal_read_clean_fraction_and_excludes_merge_silenced():
    from src.engine.extraction.pilot_conveyor import aggregate
    # a merge-silenced cert: pilot_grade True (the CRIT) but terminal_read_clean
    # False (fenced). A clean cert: both True.
    merge_silenced = {"pilot_grade": True, "terminal_read_clean": False,
                      "full_grade": False, "conditions": [], "diagnosis": {}}
    clean = {"pilot_grade": True, "terminal_read_clean": True,
             "full_grade": True, "conditions": [], "diagnosis": {}}
    agg = aggregate([merge_silenced, clean])
    # OLD fraction counts BOTH (the blind gate) -- sealed-pilot record integrity
    assert agg["pilot_grade_fraction"] == 1.0
    # FENCED fraction excludes the merge-silenced one -- the gap is closed here
    assert agg["terminal_read_clean_n"] == 1
    assert agg["terminal_read_clean_fraction"] == 0.5
