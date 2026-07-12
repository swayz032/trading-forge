"""H1 certificate compile-integrity lint tests -- the birth gate (pre-reg §7
Law 1, applied to the compile-integrity layer) + the anti-duplication parity
assertions (operator directive 2026-07-12: REUSE-or-PARITY-FIXTURE, never a
silent 3rd copy of an existing correctness check).

Imports ONLY the pure-stdlib extraction package + src.engine.spec_family_bindings
(confirmed zero-vectorbt, zero-heavy-import at module scope -- see
compile_lints.py's module docstring), so pytest collection does not hang per
CLAUDE.md §2's JIT caveat.
"""

import json
import os

import pytest

from src.engine.extraction import compile_lints as cl
from src.engine.extraction.compile_lints import (
    COMPILE_LINTS,
    CompiledSpine,
    SpineCondition,
)
from src.engine.spec_family_bindings import or_branches_enabled

_FIXTURES = os.path.join(os.path.dirname(cl.__file__), "fixtures", "compile_lint_birth_fixtures.json")


def _load_fixtures():
    return json.load(open(_FIXTURES, encoding="utf-8"))


def _resolve_span(transcript: str, cd: dict):
    if "char_span" in cd:
        return tuple(cd["char_span"])
    if "span_relative_to" in cd:
        idx = transcript.index(cd["span_relative_to"])
        return (idx, idx + cd["span_len"])
    idx = transcript.index(cd["quote_anchor"])
    return (idx, idx + len(cd["quote_anchor"]))


def _condition(transcript: str, cd: dict) -> SpineCondition:
    return SpineCondition(
        condition_id=cd["condition_id"],
        quote_anchor=cd["quote_anchor"],
        char_span=_resolve_span(transcript, cd),
        direction=cd.get("direction"),
        and_group=cd.get("and_group"),
        role=cd.get("role"),
        is_disabled_sentinel=bool(cd.get("is_disabled_sentinel", False)),
        comparator=cd.get("comparator"),
    )


def _spine(case: dict) -> CompiledSpine:
    transcript = case["transcript"]
    return CompiledSpine(
        conditions=[_condition(transcript, cd) for cd in case["conditions"]],
        or_branches=case.get("or_branches", []),
        same_bar_fill=bool(case.get("same_bar_fill", False)),
        signal_lag=case.get("signal_lag"),
        # §A 3-state fixtures: fixture cases explicitly declare whether a
        # real compile-stage overlay is present, rather than this being
        # inferred from field values -- see the birth-gate NOT_EVALUATED
        # cases below, which reuse a POSITIVE case's exact conditions with
        # topology_present flipped to False to prove no vacuous PASS/FAIL.
        topology_present=bool(case.get("topology_present", False)),
        same_bar_params_present=bool(case.get("same_bar_params_present", False)),
    )


def _run(monkeypatch, lint_name: str, case: dict):
    env = case.get("env", {})
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    spine = _spine(case)
    result = COMPILE_LINTS[lint_name](spine, case["transcript"])
    return result


# --------------------------------------------------------------------------- #
# Birth gate: FIRES-ON-POSITIVES (status=FAIL) ∧ SILENT-ON-NEGATIVES
# (status=PASS), zero exceptions. §A extends this to a THIRD proof per
# structural lint: NOT_EVALUATED (reason=no_compiled_topology) when the
# compiled-topology input is absent -- so a positive/negative pair proving
# the check WORKS can never be mistaken for proof it runs unconditionally.
# --------------------------------------------------------------------------- #

_FX = _load_fixtures()
_POS = [(entry["lint"], p) for entry in _FX["lints"] for p in entry["positives"]]
_NEG = [(entry["lint"], n) for entry in _FX["lints"] for n in entry["negatives"]]
_STRUCTURAL_LINTS = {"direction_conflation_lint", "unsat_sat_check", "or_alternatives_honored"}
_NOT_EVAL = [(entry["lint"], ne) for entry in _FX["lints"] for ne in entry.get("not_evaluated", [])]
_CAUSALITY_ENTRY = next(e for e in _FX["lints"] if e["lint"] == "causality_lint")
_CAUSALITY_SAME_BAR_NE = _CAUSALITY_ENTRY["same_bar_leg_not_evaluated"]


@pytest.mark.parametrize("lint_name,pos", _POS, ids=[f"{l}:{p['id']}" for l, p in _POS])
def test_birth_positive_fires(monkeypatch, lint_name, pos):
    result = _run(monkeypatch, lint_name, pos)
    assert result.status == cl.STATUS_FAIL, f"{lint_name} positive {pos['id']} did NOT fire (dormant lint)"
    exp = pos["expect"]
    if "offending_condition_id" in exp:
        expected_cd = next(c for c in pos["conditions"] if c["condition_id"] == exp["offending_condition_id"])
        assert result.offending_anchor == expected_cd["quote_anchor"], (
            f"{pos['id']} offending_anchor {result.offending_anchor!r} != "
            f"expected {expected_cd['quote_anchor']!r}"
        )


@pytest.mark.parametrize("lint_name,neg", _NEG, ids=[f"{l}:{n['id']}" for l, n in _NEG])
def test_birth_negative_silent(monkeypatch, lint_name, neg):
    result = _run(monkeypatch, lint_name, neg)
    assert result.status == cl.STATUS_PASS, (
        f"{lint_name} negative {neg['id']} FIRED (false positive -- would reject a clean "
        f"certificate): offending_anchor={result.offending_anchor!r}"
    )


@pytest.mark.parametrize("lint_name,ne", _NOT_EVAL, ids=[f"{l}:{n['id']}" for l, n in _NOT_EVAL])
def test_birth_not_evaluated_when_topology_absent(monkeypatch, lint_name, ne):
    """§A THIRD birth-gate proof (structural lints only): with the exact same
    (structurally-violating) conditions as the lint's own positive fixture but
    `topology_present=False`, the lint must return NOT_EVALUATED -- NEITHER a
    silent PASS (the F-1 bug) NOR a FAIL (that would be fabricating a verdict
    from data that was never supplied)."""
    assert lint_name in _STRUCTURAL_LINTS
    result = _run(monkeypatch, lint_name, ne)
    assert result.status == cl.STATUS_NOT_EVALUATED, (
        f"{lint_name} not_evaluated case {ne['id']} returned {result.status} "
        f"(expected NOT_EVALUATED -- topology_present was False)"
    )
    assert result.reason == ne["expect"]["reason"] == cl.REASON_NO_COMPILED_TOPOLOGY


@pytest.mark.parametrize("case", _CAUSALITY_SAME_BAR_NE, ids=lambda c: c["id"])
def test_birth_causality_same_bar_leg_not_evaluated_when_params_absent(case):
    """causality_lint's THIRD proof: the same-bar-opt-out leg reports
    NOT_EVALUATED when `same_bar_params_present` is False -- even if
    `same_bar_fill=True` happens to be set in the input (proves the gate is
    on `same_bar_params_present`, not on `same_bar_fill`'s truthiness). The
    overall FIELD status must still be able to report PASS (regex leg clean)
    -- it must NOT collapse to NOT_EVALUATED just because this one leg didn't
    run (addendum §B)."""
    spine = _spine(case)
    result = cl.causality_lint(spine, case["transcript"])
    assert result.status == case["expect_overall_status"]
    assert result.same_bar_leg_status == case["expect_same_bar_leg_status"]
    assert result.same_bar_leg_reason == case["expect_same_bar_leg_reason"]


def test_birth_gate_all_pass(monkeypatch):
    """Whole-suite gate, zero exceptions (mirrors test_tier1_detectors.py's
    test_birth_gate_all_pass)."""
    failures = []
    for lint_name, pos in _POS:
        if _run(monkeypatch, lint_name, pos).status != cl.STATUS_FAIL:
            failures.append(("positive-did-not-fire", lint_name, pos["id"]))
    for lint_name, neg in _NEG:
        if _run(monkeypatch, lint_name, neg).status != cl.STATUS_PASS:
            failures.append(("negative-fired", lint_name, neg["id"]))
    for lint_name, ne in _NOT_EVAL:
        if _run(monkeypatch, lint_name, ne).status != cl.STATUS_NOT_EVALUATED:
            failures.append(("not-evaluated-case-did-not-report-not-evaluated", lint_name, ne["id"]))
    assert not failures, failures


def test_every_lint_has_at_least_one_positive_and_negative():
    """Engagement/dormancy guard: a lint with an empty positives or negatives
    list would trivially pass its own birth gate without proving anything.
    Extended (§A): every STRUCTURAL lint must also have >=1 not_evaluated
    fixture, or the NOT_EVALUATED path itself could silently regress to a
    vacuous PASS/FAIL with nothing to catch it."""
    for entry in _FX["lints"]:
        assert entry["positives"], f"{entry['lint']} has no positive fixture (dormant)"
        assert entry["negatives"], f"{entry['lint']} has no negative fixture (dormant)"
        if entry["lint"] in _STRUCTURAL_LINTS:
            assert entry.get("not_evaluated"), f"{entry['lint']} has no not_evaluated fixture (dormant §A path)"
    assert {e["lint"] for e in _FX["lints"]} == set(COMPILE_LINTS.keys())
    assert _CAUSALITY_SAME_BAR_NE, "causality_lint has no same_bar_leg_not_evaluated fixture (dormant §A path)"


# --------------------------------------------------------------------------- #
# Contract invariants
# --------------------------------------------------------------------------- #


def test_lint_result_deterministic_repeat_call():
    """Replay-determinism contract (backtest-core priority #2): same spine +
    same transcript -> same result, every time."""
    case = next(p for _, p in _POS if p["id"] == "DC_POS_and_group0")
    spine = _spine(case)
    r1 = cl.direction_conflation_lint(spine, case["transcript"])
    r2 = cl.direction_conflation_lint(spine, case["transcript"])
    assert (r1.status, r1.offending_anchor, r1.offending_char_span) == (
        r2.status,
        r2.offending_anchor,
        r2.offending_char_span,
    )


def test_no_lint_imports_vectorbt_or_backtester():
    import sys

    assert "vectorbt" not in sys.modules
    assert "src.engine.backtester" not in sys.modules


def test_empty_spine_no_conditions_to_check():
    """§A: an empty, topology-less spine is the honest pilot-conveyor default
    (`CompiledSpine()` with no args). The 3 structural lints must report
    NOT_EVALUATED (topology absent), NOT a vacuous PASS -- that distinction
    is the entire point of the F-1 repair. f2_coverage_gate and
    causality_lint's regex leg stay live and trivially PASS (there is
    nothing to check, and that IS a genuine answer since their inputs are
    always present); causality's same-bar leg is NOT_EVALUATED too (params
    absent)."""
    empty = CompiledSpine(conditions=[])
    for name, fn in COMPILE_LINTS.items():
        r = fn(empty, "")
        if name in _STRUCTURAL_LINTS:
            assert r.status == cl.STATUS_NOT_EVALUATED, f"{name} should be NOT_EVALUATED on a topology-less empty spine"
            assert r.reason == cl.REASON_NO_COMPILED_TOPOLOGY
        else:
            assert r.status == cl.STATUS_PASS, f"{name} should PASS on an empty spine (nothing to check)"
    causality_result = cl.causality_lint(empty, "")
    assert causality_result.same_bar_leg_status == cl.STATUS_NOT_EVALUATED


# --------------------------------------------------------------------------- #
# PARITY assertions (operator directive 2026-07-12) -- proves agreement with
# the cited authority beyond the birth-gate pass/fail, so a silent drift in
# either this module or the authority trips a test, not just a doc.
# --------------------------------------------------------------------------- #


def test_or_alternatives_honored_reuse_tracks_the_real_flag(monkeypatch):
    """REUSE proof: or_alternatives_honored's verdict must FLIP exactly when
    the real `or_branches_enabled()` flag (spec_family_bindings.py:146) flips
    -- calling the SAME function this lint imports, not a re-derivation."""
    case = next(p for _, p in _POS if p["id"] == "OR_POS_collapsed_flag_off")
    spine = _spine(case)

    monkeypatch.delenv("TF_OR_BRANCHES_ENABLED", raising=False)
    assert or_branches_enabled() is False
    assert cl.or_alternatives_honored(spine, case["transcript"]).status == cl.STATUS_FAIL

    monkeypatch.setenv("TF_OR_BRANCHES_ENABLED", "true")
    assert or_branches_enabled() is True
    assert cl.or_alternatives_honored(spine, case["transcript"]).status == cl.STATUS_PASS


def test_direction_conflation_parity_and_group0_type_specimen():
    """PARITY-FIXTURE proof: reconstructs the exact `and_group0` incident
    named in docs/designs/mode-ab-G4-validity-block-2026-07-11.md:76-77 --
    `331fe15a`'s "5-SMA-cross-above-50 + long" AND "5-SMA-cross-below-50 +
    short" conflated into one AND group -- and asserts the doc's own verdict
    ("compile-time absurdity a fidelity certificate should catch") holds."""
    transcript = "5-SMA-cross-above-50 confirms long; 5-SMA-cross-below-50 confirms short"
    spine = CompiledSpine(
        conditions=[
            SpineCondition(
                condition_id="c1",
                quote_anchor="5-SMA-cross-above-50",
                char_span=(0, len("5-SMA-cross-above-50")),
                direction="long",
                and_group=0,
            ),
            SpineCondition(
                condition_id="c2",
                quote_anchor="5-SMA-cross-below-50",
                char_span=(
                    transcript.index("5-SMA-cross-below-50"),
                    transcript.index("5-SMA-cross-below-50") + len("5-SMA-cross-below-50"),
                ),
                direction="short",
                and_group=0,
            ),
        ],
        topology_present=True,
    )
    result = cl.direction_conflation_lint(spine, transcript)
    assert result.status == cl.STATUS_FAIL, "the named and_group0 defect must be caught, not silently passed"


def test_unsat_sat_check_parity_5sma_type_specimen():
    """PARITY-FIXTURE proof: mode-ab-G4-validity-block-2026-07-11.md:386's
    corrected type-specimen -- "5-SMA cannot be simultaneously above and
    below 50-SMA" -- is the literal comparator-contradiction case."""
    transcript = "requires 5-SMA>50-SMA and also 5-SMA<50-SMA simultaneously"
    spine = CompiledSpine(
        conditions=[
            SpineCondition(
                condition_id="c1",
                quote_anchor="5-SMA>50-SMA",
                char_span=(
                    transcript.index("5-SMA>50-SMA"),
                    transcript.index("5-SMA>50-SMA") + len("5-SMA>50-SMA"),
                ),
                and_group=0,
                comparator="5-SMA>50-SMA",
            ),
            SpineCondition(
                condition_id="c2",
                quote_anchor="5-SMA<50-SMA",
                char_span=(
                    transcript.index("5-SMA<50-SMA"),
                    transcript.index("5-SMA<50-SMA") + len("5-SMA<50-SMA"),
                ),
                and_group=0,
                comparator="5-SMA<50-SMA",
            ),
        ],
        topology_present=True,
    )
    assert cl.unsat_sat_check(spine, transcript).status == cl.STATUS_FAIL


@pytest.mark.parametrize(
    "case", _FX["f2_adversarial_word_set_parity"]["cases"], ids=lambda c: c["id"]
)
def test_f2_coverage_gate_parity_adversarial_word_set(case):
    """PARITY-FIXTURE proof: the exact adversarial word set from the
    independent accuracy-validator's F-2 review
    (F4-eligibility-bypass-trace-2026-07-07.md:296-298, "8/10 adversarial
    FALSE POSITIVE" on the OLD substring logic). This lint must reject every
    mid-word case and accept the genuine-plural case, matching the doc's own
    classification of which collisions are real."""
    transcript = case["transcript"]
    cond = {
        "condition_id": "A",
        "quote_anchor": case["quote_anchor"],
    }
    if "span_relative_to" in case:
        cond["span_relative_to"] = case["span_relative_to"]
        cond["span_len"] = case["span_len"]
    spine = CompiledSpine(conditions=[_condition(transcript, cond)])
    result = cl.f2_coverage_gate(spine, transcript)
    expected_status = cl.STATUS_PASS if case["expect_word_boundary_clean"] else cl.STATUS_FAIL
    assert result.status == expected_status, (
        f"{case['id']}: expected word_boundary_clean={case['expect_word_boundary_clean']} "
        f"got status={result.status}"
    )


def test_causality_lint_parity_kb_regex_verbatim_port():
    """PARITY-FIXTURE proof: `cl._IMPOSSIBLE_REF` must be a byte-for-byte
    port of anti-pattern-catalog.md:92's `impossibleRefs` regex alternation
    (tomorrow|future_|next_close|next_high|bar_\\+\\d+|centered_window|
    lookahead). Re-derives the pattern string from the KB doc's own literal
    text (not from compile_lints.py) so a manual edit to either side that
    drifts the alternation trips this test."""
    kb_doc_impossible_refs = (
        r"tomorrow|future_|next_close|next_high|bar_\+\d+|centered_window|lookahead"
    )
    assert cl._IMPOSSIBLE_REF.pattern == kb_doc_impossible_refs


def test_causality_lint_never_flags_bare_engine_shifted_refs():
    """Pinned engine contract (backtester.py:70-100, anti-pattern-catalog.md:74):
    bare close/high/low references are SAFE. A causality_lint that flags them
    would double-shift and re-introduce the W23F live-fix regression."""
    for text in ("close > orh_15m", "high > prev_swing_high", "low < demand_zone"):
        spine = CompiledSpine(
            conditions=[
                SpineCondition(condition_id="A", quote_anchor=text, char_span=(0, len(text)), comparator=text)
            ]
        )
        assert cl.causality_lint(spine, text).status == cl.STATUS_PASS, text
