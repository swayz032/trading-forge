"""H1 enumeration-consistency lint -- FOUNDING FIXTURE + wiring proof
(ratify-packet h1-enumeration-consistency-lint-ratify-2026-07-15.md §4).

Direction of the signature (packet §4): the lint makes it strictly HARDER to
grade clean. It flows the REAL on-disk artifacts (Phase-B variants +
enumeration-exclusion log) through both `enumeration_consistency_check` and the
REAL `terminal_read_grade`, so no verdict is a hand-typed literal:

  IyF breakdown_continuation (short) vs excluded "breakdown" (short) -> FAIL
      -> terminal_read_grade not-clean (REJECTED).
  A legitimate strategy (real log, no matching variant)              -> PASS.
  Absent exclusion log for the video                                 -> NOT_EVALUATED (fail-closed).
  Blind-adjudication OVERRIDE promotes the IyF FAIL -> allowed ONLY when supplied.
"""

import json
from pathlib import Path

from src.engine.extraction import compile_lints as cl
from src.engine.extraction.cert_assembler import terminal_read_grade
from src.engine.extraction.enumeration_consistency import (
    enumeration_consistency_check,
)

_REPO_ROOT = Path(__file__).resolve().parents[3]
_STAGING = (
    _REPO_ROOT
    / "docs"
    / "replay-results"
    / "h1-scripts"
    / "claude-rung-designpool"
    / "staging_v32"
)
_EXCLUSION_LOG = (
    _REPO_ROOT
    / "docs"
    / "replay-results"
    / "h1-scripts"
    / "claude-rung"
    / "enumeration-exclusion-log.json"
)


def _load_strategy(video_stem: str, strat_index: int = 0) -> dict:
    with open(_STAGING / f"{video_stem}.json", encoding="utf-8") as fh:
        return json.load(fh)["strategies"][strat_index]


def _excluded_for(video_id: str) -> list:
    with open(_EXCLUSION_LOG, encoding="utf-8") as fh:
        return json.load(fh)["excluded_mentions"].get(video_id, [])


def _clean_live_lints() -> dict:
    P = cl.STATUS_PASS
    return {
        "direction_conflation_lint": cl.LintResult(P),
        "unsat_sat_check": cl.LintResult(P),
        "or_alternatives_honored": cl.LintResult(P),
        "f2_coverage_gate": cl.LintResult(P),
        "causality_lint": cl.LintResult(P, regex_leg_status=P, same_bar_leg_status=P),
    }


# --------------------------------------------------------------------------- #
# FOUNDING FIXTURE: IyF promoted-excluded-mention variant -> FAIL -> not-clean
# --------------------------------------------------------------------------- #


def test_founding_fixture_iyf_promoted_breakdown_is_fail():
    strategy = _load_strategy("IyFioFkRgWo__s0")
    excluded = _excluded_for("IyFioFkRgWo")
    res = enumeration_consistency_check(strategy, excluded)
    assert res.status == cl.STATUS_FAIL
    assert res.offending_variant == "breakdown_continuation"
    assert res.matched_key == "breakdown"
    assert res.matched_direction == "short"


def test_founding_fixture_iyf_fail_makes_terminal_read_not_clean():
    strategy = _load_strategy("IyFioFkRgWo__s0")
    excluded = _excluded_for("IyFioFkRgWo")
    verdict = enumeration_consistency_check(strategy, excluded).status
    assert verdict == cl.STATUS_FAIL
    # conflation PASS + all live lints clean, but the enumeration axis FAILs.
    res = terminal_read_grade(
        _clean_live_lints(),
        conflation_verdict="PASS",
        enumeration_consistency_verdict=verdict,
    )
    assert res["grade"] == "REJECTED"
    assert res["clean"] is False
    assert res["disposition"]["enumeration_consistency"] == "FAIL"


# --------------------------------------------------------------------------- #
# CLEAN witness: legitimate variants, real exclusion log, no match -> PASS
# --------------------------------------------------------------------------- #


def test_clean_witness_legit_strategy_is_pass():
    # 2DXQqwKSwJE has a real excluded mention ("swing", directionless) and a
    # variant "short_mirror_at_resistance" that does NOT contain "swing".
    strategy = _load_strategy("2DXQqwKSwJE__s0")
    excluded = _excluded_for("2DXQqwKSwJE")
    assert excluded, "fixture drift: 2DXQqwKSwJE must have a real exclusion entry"
    res = enumeration_consistency_check(strategy, excluded)
    assert res.status == cl.STATUS_PASS
    assert res.offending_variant is None


def test_clean_witness_pass_makes_terminal_read_clean():
    strategy = _load_strategy("2DXQqwKSwJE__s0")
    excluded = _excluded_for("2DXQqwKSwJE")
    verdict = enumeration_consistency_check(strategy, excluded).status
    assert verdict == cl.STATUS_PASS
    res = terminal_read_grade(
        _clean_live_lints(),
        conflation_verdict="PASS",
        enumeration_consistency_verdict=verdict,
    )
    assert res["grade"] == "CLEAN"
    assert res["clean"] is True
    assert res["disposition"]["enumeration_consistency"] == "PASS"


# --------------------------------------------------------------------------- #
# Empty-vs-absent distinction (the seal-saver semantic):
#   None (video ABSENT from log, unknown) -> NOT_EVALUATED (fail-closed)
#   []   (video PRESENT, enumeration confirmed NO mention)  -> PASS (nothing to violate)
# --------------------------------------------------------------------------- #


def test_absent_log_None_is_not_evaluated_fail_closed():
    strategy = _load_strategy("IyFioFkRgWo__s0")
    # A video genuinely ABSENT from the exclusion log -> None -> fail-closed.
    res = enumeration_consistency_check(strategy, None)
    assert res.status == cl.STATUS_NOT_EVALUATED
    assert res.reason == "no_exclusion_log_for_video"


def test_present_but_empty_log_is_PASS_nothing_to_violate():
    # A video PRESENT in the log with an EMPTY list = enumeration confirmed no
    # unpromoted mention. Even a strategy carrying variants PASSES — there is
    # nothing excluded, hence nothing a variant could re-promote. (Conflating []
    # with None would fail-close every honest no-mention video.)
    strategy = _load_strategy("IyFioFkRgWo__s0")
    res = enumeration_consistency_check(strategy, [])
    assert res.status == cl.STATUS_PASS


def test_not_evaluated_makes_terminal_read_indeterminate():
    res = terminal_read_grade(
        _clean_live_lints(),
        conflation_verdict="PASS",
        enumeration_consistency_verdict=cl.STATUS_NOT_EVALUATED,
    )
    assert res["grade"] == "INDETERMINATE"
    assert res["clean"] is False
    assert res["disposition"]["enumeration_consistency"] == "NOT_EVALUATED"


# --------------------------------------------------------------------------- #
# Blind-adjudication OVERRIDE: promotes the IyF FAIL -> allowed ONLY when given
# --------------------------------------------------------------------------- #


def test_override_promotes_iyf_fail_to_allowed_only_when_supplied():
    strategy = _load_strategy("IyFioFkRgWo__s0")
    excluded = _excluded_for("IyFioFkRgWo")
    verdict = enumeration_consistency_check(strategy, excluded).status
    assert verdict == cl.STATUS_FAIL

    # Without the override -> FAIL stands -> REJECTED.
    without = terminal_read_grade(
        _clean_live_lints(),
        conflation_verdict="PASS",
        enumeration_consistency_verdict=verdict,
    )
    assert without["grade"] == "REJECTED"

    # With a recorded blind-adjudication artifact -> FAIL flipped to allowed.
    override_artifact = {"blind_adjudication": "IyF-breakdown-promoted-from-source"}
    with_override = terminal_read_grade(
        _clean_live_lints(),
        conflation_verdict="PASS",
        enumeration_consistency_verdict=verdict,
        enumeration_override=override_artifact,
    )
    assert with_override["grade"] == "CLEAN"
    assert with_override["clean"] is True
    assert with_override["disposition"]["enumeration_consistency"] == "FAIL_OVERRIDDEN"


def test_override_does_not_flip_a_pass_or_not_evaluated():
    # The override ONLY affects an explicit FAIL. A PASS stays PASS; a
    # NOT_EVALUATED stays NOT_EVALUATED even when an override is present.
    override_artifact = {"blind_adjudication": "irrelevant"}
    res_pass = terminal_read_grade(
        _clean_live_lints(),
        conflation_verdict="PASS",
        enumeration_consistency_verdict="PASS",
        enumeration_override=override_artifact,
    )
    assert res_pass["disposition"]["enumeration_consistency"] == "PASS"

    res_ne = terminal_read_grade(
        _clean_live_lints(),
        conflation_verdict="PASS",
        enumeration_consistency_verdict="NOT_EVALUATED",
        enumeration_override=override_artifact,
    )
    assert res_ne["grade"] == "INDETERMINATE"
    assert res_ne["disposition"]["enumeration_consistency"] == "NOT_EVALUATED"


def test_axis_absent_when_verdict_not_supplied_is_backward_compatible():
    # No enumeration verdict supplied -> axis absent -> existing behavior
    # (conflation PASS + clean live lints) still CLEAN.
    res = terminal_read_grade(_clean_live_lints(), conflation_verdict="PASS")
    assert res["grade"] == "CLEAN"
    assert res["disposition"]["enumeration_consistency"] == "AXIS_ABSENT"
