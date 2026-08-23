"""The acceptance_bars exam must be outcome-blind and its rule must be PRE-registered.

ALGO-037 ruling 1: `acceptance_bars = 2` stands as a governed UNFROZEN choice with a mandatory
exam-time sensitivity run at {1,2,3} — "invariant -> immaterial; load-bearing -> textbook
consulted, and where silent the STRICTER reading wins; never picked by score."

Two things can go wrong and both are silent:

  1. **The rule gets written after the result.** A re-read of the criteria after an unwanted
     answer is a goalpost with a citation. So the rule lives in a module-level constant and in
     the docstring, and `evaluate()` is a PURE function of the measurements — it can be handed
     fabricated inputs and checked, which is what these tests do.
  2. **A score sneaks in.** The whole lane is outcome-blind: no PnL, realized result,
     winner/loser label or agreement rate may pick a rule. The module's own docstring claims a
     test enforces this. This is that test — the claim would otherwise be prose guarding prose.
"""
from __future__ import annotations

import ast
import io

import pytest

from research import run_exam_acceptance_sensitivity as E

MODULE = "research/run_exam_acceptance_sensitivity.py"

#: Modules that read realized outcomes or compute the fidelity headline. Importing ANY of them
#: here would put a score within reach of the decision.
FORBIDDEN_IMPORTS = (
    "run_frozen_14_case_baseline",
    "current_mnq_strategy_v2_4_frozen_replay_regrade",
    "current_mnq_strategy_v2_4_edge",
    "current_mnq_strategy_v2_4_oos",
    "current_mnq_strategy_v2_2_risk_metrics",
    "current_mnq_strategy_v2_4_bot_entry_rate",
)


def _imports() -> set[str]:
    tree = ast.parse(io.open(MODULE, encoding="utf-8").read())
    out: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            out.add(n.module or "")
        elif isinstance(n, ast.Import):
            out.update(a.name for a in n.names)
    return out


@pytest.mark.parametrize("banned", FORBIDDEN_IMPORTS)
def test_the_exam_imports_no_outcome_reader(banned):
    """The docstring promises this. Without the test it is prose guarding prose."""
    assert not any(banned in m for m in _imports()), (
        f"the exam imports {banned} - a score is now within reach of the decision")


#: Everything `evaluate()` is allowed to look at. Anything else would mean a quantity other
#: than STRICTNESS reached the decision.
ALLOWED_FIELDS = {"acceptance_bars", "route_d_grants", "grants_per_session"}


def test_evaluate_reads_ONLY_strictness_fields():
    """Structural, on the AST - not a substring scan of the prose.

    A grep-style guard here would convict this module's own docstring, which deliberately
    contains the words `winner/loser label` while explaining that no such label may be used.
    That mistake has been made repeatedly in this lane, so the check reads what the DECISION
    FUNCTION actually subscripts.
    """
    tree = ast.parse(io.open(MODULE, encoding="utf-8").read())
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "evaluate")
    read = {n.slice.value for n in ast.walk(fn)
            if isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Constant)
            and isinstance(n.slice.value, str)}
    assert read, "no fields read at all - the check would pass vacuously"
    extra = read - ALLOWED_FIELDS
    assert not extra, (
        f"evaluate() reads {sorted(extra)} - only strictness fields may reach the decision")


def test_no_outcome_quantity_is_COMPUTED_anywhere_in_the_module():
    """Identifiers, not prose. Docstrings and comments are excluded by construction."""
    tree = ast.parse(io.open(MODULE, encoding="utf-8").read())
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    names |= {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    banned = {"rPnL", "pnl", "realized", "agreement_rate", "mismatch_class", "winner", "loser"}
    assert not (names & banned), sorted(names & banned)


def test_the_rule_is_stated_before_any_measurement_exists():
    """It is a module constant and a docstring, not a paragraph written after the run."""
    assert set(E.PRE_REGISTERED) >= {
        "authority", "R1_invariant", "R2_load_bearing", "R3_silent_stricter_wins",
        "R4_never_by_score"}
    assert E.PRE_REGISTERED["authority"] == "ALGO-037 ruling 1"
    assert E.TESTED == (1, 2, 3), "the ruling named these three; it is not a search space"


# --- evaluate() is pure, so the rule can be checked against fabricated inputs ---------------

def _row(v, grants, per_session=None):
    return {"acceptance_bars": v, "route_d_grants": grants,
            "grants_per_session": per_session or {"s": grants}}


def test_R1_identical_output_is_IMMATERIAL_and_changes_nothing():
    v = E.evaluate([_row(1, 4), _row(2, 4), _row(3, 4)])
    assert v["rule_applied"] == "R1_INVARIANT"
    assert v["changed"] is False and v["chosen"] == E.CURRENT
    assert "NOT evidence the value is right" in v["why"], (
        "an invariant result must not be read as a vindication of the current value")


def test_R3_when_they_differ_the_STRICTEST_wins_not_the_best_scoring():
    v = E.evaluate([_row(1, 9, {"s": 9}), _row(2, 5, {"s": 5}), _row(3, 2, {"s": 2})])
    assert v["rule_applied"] == "R3_SILENT_STRICTER_WINS"
    assert v["chosen"] == 3, "fewest grants = strictest"
    assert v["changed"] is True


def test_R3_REFUSES_to_pick_when_the_parameter_is_not_monotone():
    """If grants do not fall as the requirement rises, 'stricter' is a word, not a property."""
    v = E.evaluate([_row(1, 3, {"s": 3}), _row(2, 8, {"s": 8}), _row(3, 5, {"s": 5})])
    assert v["rule_applied"] == "R3_MONOTONICITY_FAILED"
    assert v["chosen"] is None and v["changed"] is False


def test_R4_a_tie_breaks_to_the_LOWER_value_never_to_a_score():
    """Grants must still FALL with the requirement, or R3 refuses before R4 is reached.

    The first draft of this test used {1:2, 2:2, 3:4} — grants RISING with strictness — and it
    was correctly refused as non-monotone. The fixture was wrong, not the rule.
    """
    v = E.evaluate([_row(1, 4, {"s": 4}), _row(2, 2, {"s": 2}), _row(3, 2, {"s": 2})])
    assert v["rule_applied"] == "R3_SILENT_STRICTER_WINS"
    assert v["chosen"] == 2, "ties break to the value that assumes less"


def test_the_invariance_check_uses_PER_SESSION_grants_not_just_the_total():
    """Two values can grant the same COUNT on different sessions - that is not invariance."""
    v = E.evaluate([_row(1, 2, {"a": 2, "b": 0}),
                    _row(2, 2, {"a": 0, "b": 2}),
                    _row(3, 2, {"a": 1, "b": 1})])
    assert v["rule_applied"] != "R1_INVARIANT", (
        "same totals on different sessions is not the same output")


def test_the_spec_silence_is_RE_CHECKED_not_remembered():
    """A remembered silence is a stale silence - if the spec ever fixes a count, stop deriving."""
    assert E._spec_is_silent_on_the_count() is True
    src = io.open(MODULE, encoding="utf-8").read()
    assert "R2_TEXTBOOK_SPEAKS" in src, (
        "there must be a branch for the spec growing an acceptance count")
