"""Merge-silencing fence -- terminal_read_grade fail-closed unit tests
(ratify-packet h1-mergesilencing-fence-ratify-packet-2026-07-13.md).

Closes the §2 wiring-verify CRIT: pilot_grade gates only f2+causality-regex, so
a merge-silenced object sails through it. terminal_read_grade GATES the 3
structural lints too, fail-closed: NOT_EVALUATED = INDETERMINATE (!= clean).
"""
from src.engine.extraction import compile_lints as cl
from src.engine.extraction.cert_assembler import terminal_read_grade

P, F, NE = cl.STATUS_PASS, cl.STATUS_FAIL, cl.STATUS_NOT_EVALUATED


def _lints(direction=P, unsat=P, or_alt=P, f2=P, regex=P, same_bar=P):
    """Build a full lint_results map. causality carries regex_leg_status +
    same_bar_leg_status; top-level status is not read by the fence for causality."""
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
    r = terminal_read_grade(_lints())
    assert r["grade"] == "CLEAN" and r["clean"] is True


def test_direction_conflation_fail_rejected():
    r = terminal_read_grade(_lints(direction=F))
    assert r["grade"] == "REJECTED" and r["clean"] is False


def test_direction_conflation_not_evaluated_indeterminate():
    # topology absent -> structural lint NOT_EVALUATED -> INDETERMINATE, NOT clean
    r = terminal_read_grade(_lints(direction=NE))
    assert r["grade"] == "INDETERMINATE" and r["clean"] is False


def test_unsat_sat_fail_rejected():
    r = terminal_read_grade(_lints(unsat=F))
    assert r["grade"] == "REJECTED" and r["clean"] is False


def test_or_alternatives_not_evaluated_indeterminate():
    r = terminal_read_grade(_lints(or_alt=NE))
    assert r["grade"] == "INDETERMINATE" and r["clean"] is False


def test_f2_fail_rejected():
    r = terminal_read_grade(_lints(f2=F))
    assert r["grade"] == "REJECTED" and r["clean"] is False


def test_causality_regex_leg_fail_rejected():
    r = terminal_read_grade(_lints(regex=F))
    assert r["grade"] == "REJECTED" and r["clean"] is False


def test_causality_same_bar_leg_is_exempt_not_load_bearing():
    # same_bar leg NOT_EVALUATED while everything else PASS -> STILL CLEAN
    # (provably-not-load-bearing exemption; execution timing != extraction fidelity)
    r = terminal_read_grade(_lints(same_bar=NE))
    assert r["grade"] == "CLEAN" and r["clean"] is True
    assert r["disposition"]["causality_lint.same_bar_leg"] == "EXEMPT_NOT_LOAD_BEARING"


def test_fail_precedes_not_evaluated():
    # one FAIL + one NOT_EVALUATED -> REJECTED (FAIL dominates)
    r = terminal_read_grade(_lints(direction=F, unsat=NE))
    assert r["grade"] == "REJECTED"


def test_all_three_structural_not_evaluated_is_indeterminate():
    # the terminal-read reality without the A-packet: all 3 structural NE
    r = terminal_read_grade(_lints(direction=NE, unsat=NE, or_alt=NE))
    assert r["grade"] == "INDETERMINATE" and r["clean"] is False


def test_disposition_table_covers_every_lint_no_silent_exemption():
    r = terminal_read_grade(_lints())
    d = r["disposition"]
    for name in ("direction_conflation_lint", "unsat_sat_check",
                 "or_alternatives_honored", "f2_coverage_gate",
                 "causality_lint.regex_leg", "causality_lint.same_bar_leg"):
        assert name in d, f"lint {name} missing from disposition -> silent exemption"


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
