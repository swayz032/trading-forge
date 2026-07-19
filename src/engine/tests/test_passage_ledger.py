"""Passage-ledger tests (ratify h1-wave1-instrumentation..., R-042 pin 2).

Locks: the code-derived gate enum shape (unconditional battery judges vs
conditional promotion judges vs the reserved forensics leg), the dormant-judge
alarm semantics, the unknown-gate hard error, and the measured per-spec
scope-line.
"""

from __future__ import annotations

import json

import pytest

from src.engine.battery.passage_ledger import (
    GATE_CLASSES,
    VERDICT_FAIL,
    VERDICT_PASS,
    PassageLedger,
)


def _ledger(tmp_path):
    return PassageLedger(str(tmp_path / "h1-battery" / "passage-ledger.json"))


def _rec(led, gate, *, received=True, fired=True, verdict=VERDICT_PASS, approx=0.99):
    return led.record(wave="shakedown-1", strategy_ref="v__s0", spec_hash="deadbeef",
                      engine_sha="404a3396", gate=gate, received=received, fired=fired,
                      verdict=verdict, binding_approximation_rate=approx)


# ── the code-derived enum shape ─────────────────────────────────────────────

def test_enum_encodes_producer_judge_split():
    # battery judges are UNCONDITIONAL (fire on every backtest)
    for g in ("walk_forward", "cpcv", "dsr", "pbo", "bif", "monte_carlo_ruin", "slippage_survival"):
        assert GATE_CLASSES[g].unconditional is True, g
    # promotion-transition judges are CONDITIONAL
    for g in ("b14_ci", "b15_param_robustness", "shadow_divergence", "frozen_policy_drift"):
        assert GATE_CLASSES[g].unconditional is False, g


def test_forensics_leg_is_conditional_and_reserved():
    fc = GATE_CLASSES["compile_fidelity_forensics"]
    assert fc.reserved is True and fc.unconditional is False
    assert "RESERVED" in fc.invocation


def test_eligibility_and_composite_shadow_are_non_verdict():
    # eligibility gate is a SIGNAL FILTER, composite shadow is observability-only
    assert GATE_CLASSES["eligibility_gate"].verdict is False
    assert GATE_CLASSES["composite_shadow"].verdict is False


def test_every_gate_carries_a_code_invocation_provenance():
    # R-042 pin 2: the enum is DERIVED FROM CODE — every entry names a code
    # artifact (a .py/.ts source, or an explicit RESERVED marker), so the enum
    # is traceable to the source, never a recollection of the docs.
    for g in GATE_CLASSES.values():
        assert g.invocation and (".py" in g.invocation or ".ts" in g.invocation or "RESERVED" in g.invocation), g.name


# ── dormant-judge alarm semantics ───────────────────────────────────────────

def test_unconditional_received_not_fired_is_alarm(tmp_path):
    led = _ledger(tmp_path)
    row = _rec(led, "walk_forward", received=True, fired=False, verdict="NOT_EVALUATED")
    assert row["dormant_judge_alarm"] is True
    assert led.alarms() and led.alarms()[0]["gate"] == "walk_forward"


def test_conditional_received_not_fired_is_alarm(tmp_path):
    led = _ledger(tmp_path)
    row = _rec(led, "b14_ci", received=True, fired=False, verdict="NOT_EVALUATED")
    assert row["dormant_judge_alarm"] is True, "a conditional gate handed the case that refused to fire is an alarm"


def test_reserved_gate_received_not_fired_is_NOT_alarm(tmp_path):
    led = _ledger(tmp_path)
    row = _rec(led, "compile_fidelity_forensics", received=True, fired=False, verdict="NOT_EVALUATED")
    assert row["dormant_judge_alarm"] is False, "the reserved (not-yet-built) forensics leg is never a dormant-judge alarm"


def test_conditional_gate_absence_is_not_an_alarm(tmp_path):
    # A shakedown row-set that records only battery gates + omits promotion gates
    # has NO alarm — absence of a conditional gate is expected, not a firing.
    led = _ledger(tmp_path)
    for g in led.unconditional_gate_names():
        _rec(led, g)
    assert led.alarms() == [], "conditional promotion gates being absent is not an alarm"


def test_fired_gate_is_not_an_alarm(tmp_path):
    led = _ledger(tmp_path)
    row = _rec(led, "pbo", received=True, fired=True, verdict=VERDICT_FAIL)
    assert row["dormant_judge_alarm"] is False  # firing FAIL is a real verdict, not dormancy


# ── hardening ───────────────────────────────────────────────────────────────

def test_unknown_gate_is_a_loud_error(tmp_path):
    led = _ledger(tmp_path)
    with pytest.raises(KeyError):
        _rec(led, "made_up_gate")


def test_invalid_verdict_rejected(tmp_path):
    led = _ledger(tmp_path)
    with pytest.raises(ValueError):
        _rec(led, "dsr", verdict="MAYBE")


def test_measured_scope_line_not_blanket(tmp_path):
    led = _ledger(tmp_path)
    row = _rec(led, "dsr", approx=0.9333)
    assert "binding-approx 0.9333" in row["scope_line"]
    assert "0.99" not in row["scope_line"], "measured per-spec rate, never a blanket 0.99 (R-042 pin 3)"


def test_exit_provenance_field_carries_house_default_stamp(tmp_path):
    led = _ledger(tmp_path)
    row = led.record(wave="shakedown-1", strategy_ref="v__s0", spec_hash="h", engine_sha="404a3396",
                     gate="dsr", received=True, fired=True, verdict=VERDICT_PASS,
                     binding_approximation_rate=0.9, exit_provenance="house-default (trader taught none)")
    assert row["exit_provenance"] == "house-default (trader taught none)"


def test_coverage_gaps_detects_a_silently_absent_unconditional_judge(tmp_path):
    """Grader finding #1 lock: an unconditional judge that NEVER received a row
    (pure silence) is invisible to the per-row alarm but MUST be caught by the
    coverage audit."""
    led = _ledger(tmp_path)
    all_unconditional = led.unconditional_gate_names()
    # record only 3 of the unconditional gates for this strategy
    for g in all_unconditional[:3]:
        _rec(led, g)
    gaps = led.coverage_gaps(strategy_ref="v__s0", wave="shakedown-1")
    assert set(gaps) == set(all_unconditional[3:]), "the un-recorded unconditional judges are coverage gaps"
    assert led.alarms() == [], "per-row alarms stay clean — proving coverage_gaps is the NEEDED second check"
    # once all are recorded+fired, no gaps
    for g in all_unconditional[3:]:
        _rec(led, g)
    assert led.coverage_gaps(strategy_ref="v__s0", wave="shakedown-1") == []


def test_a_received_but_unfired_unconditional_gate_is_still_a_coverage_gap(tmp_path):
    """received=True,fired=False fires the per-row alarm AND leaves a coverage
    gap (it did not FIRE) — the two checks are complementary, not redundant."""
    led = _ledger(tmp_path)
    _rec(led, "walk_forward", received=True, fired=False, verdict="NOT_EVALUATED")
    assert "walk_forward" in led.coverage_gaps("v__s0", "shakedown-1")
    assert len(led.alarms()) == 1


def test_cited_python_sources_actually_exist_on_disk(tmp_path):
    """R-042 pin 2 standing guard: every .py file the enum cites must EXIST under
    src/ — a renamed/deleted module would silently stale the derivation. (.ts
    citations + line numbers are verified out-of-band; this locks the Python
    producers against drift.)"""
    import os
    import re

    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))  # src/
    py_files: set[str] = set()
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            if f.endswith(".py"):
                py_files.add(f)
    for g in GATE_CLASSES.values():
        for basename in re.findall(r"([A-Za-z0-9_]+\.py)", g.invocation):
            assert basename in py_files, f"{g.name}: cited source {basename} not found under src/"


def test_persists_atomically_and_reloads(tmp_path):
    led = _ledger(tmp_path)
    _rec(led, "walk_forward")
    doc = json.load(open(led.path, encoding="utf-8"))
    assert len(doc["rows"]) == 1 and doc["gate_enum_provenance"].startswith("code-derived")
    led2 = PassageLedger(led.path)  # reload appends, doesn't clobber
    _rec(led2, "cpcv")
    assert len(json.load(open(led.path, encoding="utf-8"))["rows"]) == 2
