"""The dual-window exam's rules must be pre-registered, pure, and outcome-blind.

The failure modes are the ones this lane has actually suffered:

  * the rule is written after the result (a re-read of the criteria after an unwanted answer is
    a goalpost with a citation)
  * a REGRESSION is laundered by an unrelated improvement, because the rule counts instead of
    comparing membership
  * the exam quietly proposes moving the WINDOW instead of convicting the BRAIN
  * a censored case convicts or acquits
"""
from __future__ import annotations

import ast
import io

import pytest

from research import run_exam_dual_window as E

MODULE = "research/run_exam_dual_window.py"

#: Importing any of these would put a realized outcome within reach of the verdict.
FORBIDDEN_IMPORTS = (
    "current_mnq_strategy_v2_4_edge",
    "current_mnq_strategy_v2_4_oos",
    "current_mnq_strategy_v2_2_risk_metrics",
)


def _arm(name, agreeing, decided):
    return {"arm": name, "window_start": str(E.ARMS[name]),
            "agreement": f"{len(agreeing)}/{len(decided)}",
            "agreeing_sessions": sorted(agreeing), "decided_sessions": sorted(decided)}


def _imports() -> set[str]:
    tree = ast.parse(io.open(MODULE, encoding="utf-8").read())
    out: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            out.add(n.module or "")
            out.update(f"{n.module or ''}.{a.name}" for a in n.names)
        elif isinstance(n, ast.Import):
            out.update(a.name for a in n.names)
    return out


@pytest.mark.parametrize("banned", FORBIDDEN_IMPORTS)
def test_the_exam_imports_no_outcome_reader(banned):
    assert not any(banned in m for m in _imports()), f"{banned} puts a score within reach"


def test_the_rules_are_stated_before_any_measurement_exists():
    """The rule lives in a constant and in the docstring, both written before any arm ran."""
    for key in ("A1_no_lost_agreement", "A2_window_is_never_the_fix",
                "A3_unconditional_deployment_window", "A4_censoring", "A5_never_by_score"):
        assert key in E.PRE_REGISTERED
        assert len(E.PRE_REGISTERED[key]) > 40, "a rule needs a real statement, not a label"
    doc = ast.get_docstring(ast.parse(io.open(MODULE, encoding="utf-8").read()))
    assert "PRE-REGISTERED" in doc and "BEFORE ANY ARM RAN" in doc.upper()


# --- A1: membership, not count ------------------------------------------------------------

def test_A1_PASSES_when_no_agreement_is_lost():
    base = _arm("baseline_0930", {"d1", "d2"}, {"d1", "d2", "d3"})
    taught = _arm("taught_0800", {"d1", "d2", "d3"}, {"d1", "d2", "d3"})
    v = E.evaluate(base, taught)
    assert v["verdict"] == "PASS"
    assert v["lost_agreements"] == []
    assert v["gained_agreements"] == ["d3"]


def test_A1_FAILS_when_an_agreement_is_lost():
    base = _arm("baseline_0930", {"d1", "d2"}, {"d1", "d2"})
    taught = _arm("taught_0800", {"d1"}, {"d1", "d2"})
    v = E.evaluate(base, taught)
    assert v["verdict"] == "FAIL"
    assert v["lost_agreements"] == ["d2"]


def test_A1_a_GAIN_MAY_NOT_OFFSET_A_LOSS():
    """The whole reason A1 is a membership test. The COUNT here is identical — 2 and 2.

    A count-shaped rule would call this unchanged and pass a real regression on d2.
    """
    base = _arm("baseline_0930", {"d1", "d2"}, {"d1", "d2", "d3"})
    taught = _arm("taught_0800", {"d1", "d3"}, {"d1", "d2", "d3"})
    assert base["agreement"] == taught["agreement"], "precondition: the counts are equal"
    v = E.evaluate(base, taught)
    assert v["verdict"] == "FAIL", "a swap passed as if nothing had changed"
    assert v["lost_agreements"] == ["d2"]
    assert v["gained_agreements"] == ["d3"]


def test_A1_a_higher_SCORE_does_not_rescue_a_lost_agreement():
    """Better-looking headline, still a FAIL. The rules decide, not the number."""
    base = _arm("baseline_0930", {"d1", "d2"}, {"d1", "d2", "d3", "d4"})
    taught = _arm("taught_0800", {"d1", "d3", "d4"}, {"d1", "d2", "d3", "d4"})
    v = E.evaluate(base, taught)
    assert v["verdict"] == "FAIL"
    assert v["lost_agreements"] == ["d2"]


# --- A2 / A3: what a failure means ---------------------------------------------------------

def test_A2_a_failure_names_the_BRAIN_and_never_proposes_moving_the_window():
    v = E.evaluate(_arm("baseline_0930", {"d1"}, {"d1"}),
                   _arm("taught_0800", set(), {"d1"}))
    meaning = v["what_a_failure_means"].upper()
    assert "BRAIN" in meaning
    for forbidden in ("REVERT THE WINDOW", "NARROW THE WINDOW", "MOVE THE WINDOW TO"):
        assert forbidden not in meaning


@pytest.mark.parametrize("taught_agreeing", [{"d1"}, set()])
def test_A2_no_verdict_it_EMITS_ever_recommends_a_window_change(taught_agreeing):
    """Checked on the OUTPUT, on BOTH the passing and the failing branch.

    An earlier version scanned the module's SOURCE for those phrases and convicted A2's own
    rule text — the sentence that exists to make the promise. A substring test that reads prose
    convicts the promise; the thing that actually matters is what the artifact a reader ACTS on
    contains, so that is what is inspected.
    """
    v = E.evaluate(_arm("baseline_0930", {"d1"}, {"d1"}),
                   _arm("taught_0800", taught_agreeing, {"d1"}))
    emitted = " ".join(str(x) for x in v.values()).upper()
    for forbidden in ("RECOMMEND REVERTING", "RECOMMEND MOVING", "SHOULD REVERT TO 09:30",
                      "MOVE THE WINDOW TO", "NARROW THE WINDOW"):
        assert forbidden not in emitted, (
            f"the verdict recommends a window change ({forbidden}); A2 says the window is "
            f"never the fix and never the casualty")


def test_A3_a_failing_taught_arm_BLOCKS_freeze_with_no_fallback():
    v = E.evaluate(_arm("baseline_0930", {"d1"}, {"d1"}),
                   _arm("taught_0800", set(), {"d1"}))
    assert "BLOCKED" in v["freeze"]
    assert "fallback" in v["freeze"].lower()


def test_A3_a_PASS_is_a_precondition_not_a_grant_of_freeze():
    v = E.evaluate(_arm("baseline_0930", {"d1"}, {"d1"}),
                   _arm("taught_0800", {"d1"}, {"d1"}))
    assert v["verdict"] == "PASS"
    assert "advisor" in v["freeze"].lower(), (
        "a passing exam must not read as authorisation to freeze - that is a ruling")


# --- A4: censored cases neither convict nor acquit -----------------------------------------

def test_A4_censored_cases_are_excluded_from_both_sides():
    sc = {"cases": [
        {"session": "d1", "mismatch_class": "AGREE"},
        {"session": "d2", "mismatch_class": "CENSORED_BOT_BUDGET_CONSUMED"},
        {"session": "d3", "mismatch_class": "MISSED_TRADER_ENTRY"},
    ]}
    assert E._agreeing_sessions(sc) == {"d1"}
    assert E._decided_sessions(sc) == {"d1", "d3"}, "a censored case entered the denominator"


def test_A4_UNCENSORED_in_a_class_name_is_not_censored():
    """`BOT_ONLY_ENTRY_UNCENSORED_DECLINE` contains the word meaning the opposite.

    A substring test drops a real, decided failure out of the denominator and flatters the
    verdict. This is a prefix test for exactly that reason.
    """
    sc = {"cases": [{"session": "d1", "mismatch_class": "BOT_ONLY_ENTRY_UNCENSORED_DECLINE"}]}
    assert E._decided_sessions(sc) == {"d1"}
    assert E._agreeing_sessions(sc) == set()


# --- the arms themselves --------------------------------------------------------------------

def test_the_two_arms_are_the_ruled_ones_and_the_deployment_arm_is_0800():
    from datetime import time
    assert E.ARMS == {"baseline_0930": time(9, 30), "taught_0800": time(8, 0)}
    assert E.DEPLOYMENT_ARM == "taught_0800", "ALGO-049: 08:00-12:00 is unconditional"


def test_an_arm_never_overwrites_the_committed_scorecard():
    """An arm is a measurement under a run config, not the campaign's canonical baseline."""
    from research import run_frozen_14_case_baseline as B
    canonical = str(B.OUT)
    for name in E.ARMS:
        assert E.ARM_OUT.format(arm=name) != canonical, (
            "an exam arm would claim the canonical scorecard filename, making the campaign's "
            "headline depend on whichever arm ran last")


def test_all_six_teaching_hashes_are_pinned_and_well_formed():
    assert len(E.TEACHING_EVIDENCE) == 6, "ALGO-050 x1 + ALGO-051 x3 + ALGO-052 x2"
    assert len(set(E.TEACHING_EVIDENCE.values())) == 6, "a hash is duplicated"
    for name, h in E.TEACHING_EVIDENCE.items():
        assert len(h) == 64 and all(c in "0123456789abcdef" for c in h), name


def test_the_teaching_evidence_is_RATIONALE_ONLY():
    """No exam-set change, no label, no code from a screenshot (ALGO-050/051/052)."""
    src = io.open(MODULE, encoding="utf-8").read()
    assert "rationale" in src.lower()
    assert "TEACHING_EVIDENCE" in src
    tree = ast.parse(src)
    for n in ast.walk(tree):
        if isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Constant):
            assert "TEACHING" not in str(n.slice.value).upper(), (
                "a teaching artifact is being READ as data - it is rationale, not input")
