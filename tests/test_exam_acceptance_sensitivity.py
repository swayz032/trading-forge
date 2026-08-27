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
    # `changed` must TRACK the comparison against the value in force, not remember an answer.
    # This asserted `is True` while the value in force was 2; the rule then selected 3 on the
    # real corpus and 3 was LANDED, so the same fabricated inputs now legitimately report no
    # change. Pinning True would have pinned a moment, not a property.
    assert v["changed"] == (v["chosen"] != E.CURRENT)


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


# ── ALGO-054: the population is what Route D CONSIDERED, not what it granted ────────────────
#
# After ALGO-047 wired the state machine in as the kernel's entry authority, the old selector
# (`outcome == SURVIVED_TO_RANKING`) chose the population BY `decide(...)` AT the value under
# test. A candidate refused at 2 could then never be seen granted at 1, so R3's monotonicity
# would have held BY CONSTRUCTION. These are the two guards ALGO-054 required.

def test_the_selector_joins_on_CONSIDERED_not_on_the_outcome():
    """The circular selector must not come back. READ THE EXECUTABLE LINE, not the prose.

    Stripping only `#` lines is not enough and it convicted this module's own amendment note,
    which necessarily quotes the selector it replaced — a substring test that reads prose
    convicts the sentence written to explain the fix. Docstrings are removed via the AST so
    only code is examined.
    """
    tree = ast.parse(io.open(MODULE, encoding="utf-8").read())
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                body.pop(0)
    code = ast.unparse(tree)

    assert "routes_asked" in code, "the population no longer joins on the recorded routes_asked"
    assert "SURVIVED_TO_RANKING" not in code, (
        "the selector is filtering on the OUTCOME again - that is the circularity ALGO-054 "
        "amended away: the population would be chosen by the value under test")


def test_the_considered_set_is_a_SUPERSET_of_the_survivors_BY_MEMBERSHIP():
    """Widening must never LOSE a candidate. Compared by membership, never by count.

    A count-shaped check passes when one candidate is dropped and another appears, which is
    exactly the drift a hook fired on two branches can introduce.
    """
    from research import current_mnq_strategy_v2_4_candidate_xray as X

    def key(r):
        return (r.get("bucket"), r.get("clock"), r.get("direction"), r.get("location_id"))

    records = _fake_route_d_records(X)
    survivors = {key(r) for r in records
                 if r.get("outcome") == "SURVIVED_TO_RANKING"
                 and r.get("route") == E.ROUTE_D_PREBREAK_RETEST
                 and r.get("variant") is None}
    considered = {key(r) for r in records
                  if E.ROUTE_D_PREBREAK_RETEST in (r.get("routes_asked") or ())
                  and r.get("variant") is None}

    assert survivors, "the fixture must contain at least one survivor or it proves nothing"
    assert survivors <= considered, (
        f"the widening LOST candidates: {sorted(survivors - considered)}")
    assert considered - survivors, (
        "the considered set is no bigger than the survivor set - the amendment did nothing, "
        "and the population is still selected by the value under test")


def _fake_route_d_records(X):
    """Records shaped exactly as `xray_session` emits them on the three Route D branches."""
    D, C = E.ROUTE_D_PREBREAK_RETEST, X.ROUTE_C_DISPLACEMENT
    both = [C, D]
    return [
        # granted by D
        {"bucket": "b1", "clock": "c1", "direction": "L", "location_id": "z1",
         "outcome": "SURVIVED_TO_RANKING", "route": D, "routes_asked": both, "variant": None},
        # D asked and refused - INVISIBLE to the old selector, and the whole point
        {"bucket": "b2", "clock": "c2", "direction": "L", "location_id": "z2",
         "outcome": "REJECTED", "route": "B_C_D_BREAKOUT_FAMILY",
         "routes_asked": both + [X.ROUTE_B_BREAKOUT], "variant": None},
        # D granted, then the PLAN vetoed it - still a candidate D considered
        {"bucket": "b3", "clock": "c3", "direction": "S", "location_id": "z3",
         "outcome": "REJECTED", "route": D, "routes_asked": both, "variant": None},
        # granted by C, so D was NEVER ASKED - correctly absent from D's considered set
        {"bucket": "b4", "clock": "c4", "direction": "L", "location_id": "z4",
         "outcome": "SURVIVED_TO_RANKING", "route": C, "routes_asked": [C], "variant": None},
        # a BRK15 variant - skip-and-count, never in this population
        {"bucket": "b5", "clock": "c5", "direction": "L", "location_id": "z5",
         "outcome": "SURVIVED_TO_RANKING", "route": X.ROUTE_B_BREAKOUT,
         "routes_asked": both, "variant": X.VARIANT_BRK15},
    ]


def test_a_candidate_route_C_granted_is_NOT_in_route_Ds_considered_set():
    """The loop stops at the first grant, so C's grant means D was never put the question."""
    from research import current_mnq_strategy_v2_4_candidate_xray as X
    rec = next(r for r in _fake_route_d_records(X) if r["location_id"] == "z4")
    assert E.ROUTE_D_PREBREAK_RETEST not in rec["routes_asked"]


def test_variants_are_excluded_from_the_population():
    from research import current_mnq_strategy_v2_4_candidate_xray as X
    rec = next(r for r in _fake_route_d_records(X) if r["location_id"] == "z5")
    assert rec["variant"] is not None
    assert not (E.ROUTE_D_PREBREAK_RETEST in rec["routes_asked"] and rec["variant"] is None)


def test_the_monotonicity_RAISE_can_actually_FIRE_discriminating_fixture():
    """DISCRIMINATES: a candidate REFUSED at 2 and GRANTED at 1, on real bars.

    Without this the amendment is prose. `break_retest` requires `acceptance_bars` consecutive
    completed closes beyond the level before the retest; one such close satisfies 1 and not 2,
    so the same bars must flip. If they do not, `acceptance_bars` does not mean what R3
    believes it means and R3 would be asserting monotonicity it cannot observe.
    """
    import pandas as pd
    from research import current_mnq_strategy_v2_4_entry_authority as EA
    from research.current_mnq_strategy_v2_4_engine import Params

    tz = "America/New_York"
    lo, hi = 100.0, 102.0
    p = Params()
    # approach · ONE completed close beyond · retest of the broken level · momentum trigger
    # The retest bar must close back INSIDE. An earlier draft closed it at 102.1 — still
    # beyond `hi` — so it extended the acceptance run instead of retesting it, and the
    # candidate was refused at BOTH values for NO_RETEST. It would have looked like the
    # parameter doing nothing when it was the fixture doing the wrong thing.
    rows = [(101.0, 101.5, 100.5, 101.0),
            (101.0, 101.5, 100.5, 101.0),
            (101.0, 103.5, 100.9, 103.2),   # the SINGLE acceptance close beyond `hi`
            (103.2, 103.3, 101.2, 101.5),   # retest: back inside, touching the level
            (101.5, 104.6, 101.4, 104.4)]   # forming trigger: momentum away
    bars = pd.DataFrame(
        {"open": [r[0] for r in rows], "high": [r[1] for r in rows],
         "low": [r[2] for r in rows], "close": [r[3] for r in rows]},
        index=pd.date_range("2026-04-09 10:00", periods=len(rows), freq="5min", tz=tz))

    def decide_at(n):
        return EA.decide(bars, "L", lo, hi, location_authorized=True, force_confirmed=True,
                         body_frac=float(p.body_frac), close_loc=float(p.close_loc),
                         reject_wick=float(p.reject_wick), lookback=6,
                         route=E.ROUTE_D_PREBREAK_RETEST, range_ratio=float(p.range_ratio),
                         acceptance_bars=n)

    at1, at2 = decide_at(1), decide_at(2)
    assert at1.granted, f"the laxer value must GRANT this candidate: {at1.reason}"
    assert not at2.granted, "the stricter value must REFUSE it, or the parameter does nothing"
    assert at2.reason and "ACCEPT" in at2.reason.upper(), (
        f"it must be refused for the ACCEPTANCE reason, not incidentally: {at2.reason}")
