"""
test_style_c_fixture_spec_derivation.py — R-323 §3.

WHY THIS EXISTS. `tests/fixtures/style_c_parity_fixtures.json` is the ORACLE that
`style-c-exit-evaluator-parity.test.ts` and `tests/test_style_c_parity_2026_06_29.py`
both check their engines against. An oracle is only as good as its expected
values' derivation, and that provenance is unknowable from the repo: the fixture
and the TS evaluator both first appear 2026-06-29, but `style_c_handler.py`
predates them by six weeks, so the values COULD have been recorded from the
Python engine. If they were, any bug present in that engine on 2026-06-29 is
EMBALMED in the oracle and both engines are now guarded into reproducing it.

PROVENANCE IS ARCHAEOLOGY; DERIVABILITY IS MEASUREMENT. Rather than settle where
the numbers came from, this file re-derives every expected value from the
DOCUMENTED RULE and never imports either engine. If the fixture agrees with the
spec, it does not matter whether it was authored or captured — a captured bug
would show up here as a disagreement.

★ NOTHING IN THIS FILE MAY IMPORT `style_c_handler` OR READ THE TS EVALUATOR.
A derivation that consults the engine is a reimplementation, and a test that
reimplements the logic under test proves the reimplementation, not the system.
There is an explicit guard test below asserting this file stays engine-free.

RULE SOURCES, each cited so a reader can audit independence:
  * TP1 @ 1R, TP2 @ 2R, runner trails developing_session_poc
        -> CLAUDE.md §"Framework overlay": "Style C 33/33/33 default — TP1 33%@1R
           / TP2 33%@2R / runner 34% trails developing_session_poc"
  * 1R measured in points from entry by `stop_pts`
        -> the fixture's own `_comment`: "entry=4500 stop_pts=10 -> long tp1=4510
           tp2=4520; short tp1=4490 tp2=4480"
  * 15:55 ET hard time-stop, taking priority
        -> CLAUDE.md: "15:55 ET hard time-stop" and Wave 25.5's hard-invariant
           list, "15:55 ET hard flatten ... verified in BOTH engines"
  * intrabar fill uses the bar's extreme, falling back to current_price when the
    bar is absent -> the fixture NAMES this rule:
           "bar_high_null_falls_back_to_current_price_long"
  * ★ DECLARED NOT FROM THE SPEC: the `stop_pts == 0 -> HOLD` degenerate guard.
    No document states it. It is inferred from the scenario NAME
    ("stop_pts_zero_holds"), so for that ONE fixture the derivation is weaker
    than for the other 13 and is reported separately rather than folded in.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
FIXTURE_PATH = REPO / "tests" / "fixtures" / "style_c_parity_fixtures.json"

FIXTURES = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["fixtures"]

TIME_STOP_ET = "15:55"
SPEC_DERIVED = "spec"
NAME_DERIVED = "inferred-from-scenario-name"


def _derive(state: dict) -> tuple[str, float | None, str]:
    """Expected (decision, new_stop, basis) from the DOCUMENTED rule alone."""
    direction = state.get("direction")
    entry = state.get("entry_price")
    stop_pts = state.get("stop_pts")
    now_et = state.get("current_time_et") or ""
    price = state.get("current_price")

    # 15:55 ET hard flatten, and it is a HARD invariant, so it precedes targets.
    if now_et >= TIME_STOP_ET:
        return "TIME_STOP_FLATTEN", None, SPEC_DERIVED

    # Degenerate: with a zero stop there is no R, so no 1R/2R target exists.
    if not stop_pts:
        return "HOLD", None, NAME_DERIVED

    long = direction == "long"
    tp1 = entry + stop_pts if long else entry - stop_pts        # 1R
    tp2 = entry + 2 * stop_pts if long else entry - 2 * stop_pts  # 2R

    # The bar's extreme decides an intrabar touch; absent a bar, the last price.
    high = state.get("bar_high")
    low = state.get("bar_low")
    probe_up = high if high is not None else price
    probe_dn = low if low is not None else price

    tp1_filled = bool(state.get("tp1_filled"))
    tp2_filled = bool(state.get("tp2_filled"))

    # Runner leg: both targets done -> trail the developing session POC.
    if tp1_filled and tp2_filled:
        poc = state.get("developing_session_poc")
        if poc is not None:
            return "TIGHTEN_TRAIL_TO_X", float(poc), SPEC_DERIVED
        return "HOLD", None, SPEC_DERIVED

    def touched(target: float) -> bool:
        return probe_up >= target if long else probe_dn <= target

    # TP1 precedes TP2 while TP1 is unfilled, even if the bar reaches both.
    if not tp1_filled:
        return ("FILL_TP1_50PCT", None, SPEC_DERIVED) if touched(tp1) else ("HOLD", None, SPEC_DERIVED)

    return ("FILL_TP2", None, SPEC_DERIVED) if touched(tp2) else ("HOLD", None, SPEC_DERIVED)


@pytest.mark.parametrize("fx", FIXTURES, ids=[f["name"] for f in FIXTURES])
def test_fixture_expected_values_follow_the_documented_rule(fx: dict) -> None:
    decision, new_stop, _basis = _derive(fx["state"])
    assert decision == fx["expected_decision"], (
        f"{fx['name']}: the oracle's expected decision does not follow the "
        f"documented Style C rule — spec says {decision!r}, fixture says "
        f"{fx['expected_decision']!r}. Either the fixture embalms an engine "
        f"behaviour that contradicts the spec, or the spec changed and the "
        f"fixture did not."
    )
    if fx["expected_new_stop"] is None:
        assert new_stop is None, f"{fx['name']}: spec derives a stop, fixture has none"
    else:
        assert new_stop == pytest.approx(fx["expected_new_stop"]), (
            f"{fx['name']}: spec derives new_stop={new_stop}, "
            f"fixture says {fx['expected_new_stop']}"
        )


def test_derivation_basis_is_published_not_assumed() -> None:
    """How many fixtures rest on the SPEC vs on a weaker inference — stated, not implied."""
    bases = [_derive(f["state"])[2] for f in FIXTURES]
    spec = sum(b == SPEC_DERIVED for b in bases)
    inferred = sum(b == NAME_DERIVED for b in bases)
    assert spec + inferred == len(FIXTURES)
    # 13 of 14 derive from documented rules; the zero-stop guard is inferred from
    # the scenario's own name because no document states it. Recorded as an
    # assertion so the split cannot drift into folklore.
    assert spec == 13, f"spec-derived count moved: {spec}"
    assert inferred == 1, f"inference-derived count moved: {inferred}"


def test_this_derivation_never_consults_either_engine() -> None:
    """The independence claim, asserted rather than promised.

    If this file ever imports the engine it purports to check independently, the
    whole exercise collapses into a reimplementation and the oracle question is
    reopened without anyone noticing.
    """
    import inspect

    # Scope the check to `_derive` ITSELF. A whole-file scan is wrong twice over:
    # the module docstring legitimately NAMES the engines while explaining why it
    # avoids them, and this very assertion holds the forbidden strings in a
    # literal — the first version failed on its own tuple. The claim being made
    # is about the DERIVATION, so check the derivation.
    derivation_src = inspect.getsource(_derive)
    for forbidden in ("style_c_handler", "evaluate_exit", "evaluateStyleCExit",
                      "style-c-exit-evaluator"):
        assert forbidden not in derivation_src, (
            f"{forbidden!r} appears in _derive() — this file must derive from "
            f"the documented rule, never from the engine"
        )
    # And no engine import may exist anywhere in the module.
    for line in Path(__file__).read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith(("import ", "from ")):
            assert "style_c" not in stripped and "exits" not in stripped, (
                f"engine import found: {stripped!r}"
            )
