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
    )


def _run(monkeypatch, lint_name: str, case: dict):
    env = case.get("env", {})
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    spine = _spine(case)
    result = COMPILE_LINTS[lint_name](spine, case["transcript"])
    return result


# --------------------------------------------------------------------------- #
# Birth gate: FIRES-ON-POSITIVES (passed=False) ∧ SILENT-ON-NEGATIVES
# (passed=True), zero exceptions.
# --------------------------------------------------------------------------- #

_FX = _load_fixtures()
_POS = [(entry["lint"], p) for entry in _FX["lints"] for p in entry["positives"]]
_NEG = [(entry["lint"], n) for entry in _FX["lints"] for n in entry["negatives"]]


@pytest.mark.parametrize("lint_name,pos", _POS, ids=[f"{l}:{p['id']}" for l, p in _POS])
def test_birth_positive_fires(monkeypatch, lint_name, pos):
    result = _run(monkeypatch, lint_name, pos)
    assert result.passed is False, f"{lint_name} positive {pos['id']} did NOT fire (dormant lint)"
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
    assert result.passed is True, (
        f"{lint_name} negative {neg['id']} FIRED (false positive -- would reject a clean "
        f"certificate): offending_anchor={result.offending_anchor!r}"
    )


def test_birth_gate_all_pass(monkeypatch):
    """Whole-suite gate, zero exceptions (mirrors test_tier1_detectors.py's
    test_birth_gate_all_pass)."""
    failures = []
    for lint_name, pos in _POS:
        if _run(monkeypatch, lint_name, pos).passed is not False:
            failures.append(("positive-did-not-fire", lint_name, pos["id"]))
    for lint_name, neg in _NEG:
        if _run(monkeypatch, lint_name, neg).passed is not True:
            failures.append(("negative-fired", lint_name, neg["id"]))
    assert not failures, failures


def test_every_lint_has_at_least_one_positive_and_negative():
    """Engagement/dormancy guard: a lint with an empty positives or negatives
    list would trivially pass its own birth gate without proving anything."""
    for entry in _FX["lints"]:
        assert entry["positives"], f"{entry['lint']} has no positive fixture (dormant)"
        assert entry["negatives"], f"{entry['lint']} has no negative fixture (dormant)"
    assert {e["lint"] for e in _FX["lints"]} == set(COMPILE_LINTS.keys())


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
    assert (r1.passed, r1.offending_anchor, r1.offending_char_span) == (
        r2.passed,
        r2.offending_anchor,
        r2.offending_char_span,
    )


def test_no_lint_imports_vectorbt_or_backtester():
    import sys

    assert "vectorbt" not in sys.modules
    assert "src.engine.backtester" not in sys.modules


def test_empty_spine_passes_every_lint_vacuously():
    empty = CompiledSpine(conditions=[])
    for name, fn in COMPILE_LINTS.items():
        r = fn(empty, "")
        assert r.passed is True, f"{name} should pass vacuously on an empty spine"


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
    assert cl.or_alternatives_honored(spine, case["transcript"]).passed is False

    monkeypatch.setenv("TF_OR_BRANCHES_ENABLED", "true")
    assert or_branches_enabled() is True
    assert cl.or_alternatives_honored(spine, case["transcript"]).passed is True


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
        ]
    )
    result = cl.direction_conflation_lint(spine, transcript)
    assert result.passed is False, "the named and_group0 defect must be caught, not silently passed"


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
        ]
    )
    assert cl.unsat_sat_check(spine, transcript).passed is False


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
    assert result.passed is case["expect_word_boundary_clean"], (
        f"{case['id']}: expected word_boundary_clean={case['expect_word_boundary_clean']} "
        f"got passed={result.passed}"
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
        assert cl.causality_lint(spine, text).passed is True, text
