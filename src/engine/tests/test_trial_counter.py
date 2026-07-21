"""Trial-counter invariant tests (ratify h1-wave1-instrumentation..., R-042 pin 1).

Locks the leak-closing mechanism BOTH directions: no phantom trial (an id only
exists if allocate ran), no lost trial (a crash leaves an ABORTED row that still
counts), one-file-forever append semantics, dense-monotonic ids, and the
structural total==len(runs) invariant.
"""

from __future__ import annotations

import json

import pytest

from src.engine.battery.trial_counter import OUTCOME_ABORTED, TrialCounter


def _counter(tmp_path):
    return TrialCounter(str(tmp_path / "h1-battery" / "trial-counter.json"), engine_sha_at_zero="404a3396")


def _alloc(tc, wave="shakedown-1", ref="v__s0", h="deadbeef", approx=0.99):
    return tc.allocate(wave=wave, strategy_ref=ref, spec_hash=h, engine_sha="404a3396",
                       binding_approximation_rate=approx)


def test_allocate_persists_at_dispatch_defaulting_aborted(tmp_path):
    tc = _counter(tmp_path)
    tid = _alloc(tc)
    # persisted immediately, BEFORE any finalize, with ABORTED default
    doc = json.load(open(tc.path, encoding="utf-8"))
    row = next(r for r in doc["runs"] if r["trial_id"] == tid)
    assert row["outcome"] == OUTCOME_ABORTED
    assert row["dispatched_at"] is not None and row["finalized_at"] is None
    assert row["binding_approximation_rate"] == 0.99


def test_crash_between_allocate_and_finalize_leaves_counted_aborted_row(tmp_path):
    tc = _counter(tmp_path)
    tid = _alloc(tc)
    # simulate a crash: a NEW TrialCounter loads the persisted file (no finalize ran)
    tc2 = TrialCounter(tc.path)
    assert tc2.total_trials == 1, "the crashed trial is still counted (no leak)"
    assert tc2.outcomes() == {OUTCOME_ABORTED: 1}
    assert tc2.unfinalized_ids() == [tid], "the crashed row is the resume set"


def test_finalize_overwrites_only_its_own_row(tmp_path):
    tc = _counter(tmp_path)
    a = _alloc(tc, ref="A")
    b = _alloc(tc, ref="B")
    tc.finalize(a, "PASS")
    doc = json.load(open(tc.path, encoding="utf-8"))
    rows = {r["trial_id"]: r for r in doc["runs"]}
    assert rows[a]["outcome"] == "PASS" and rows[a]["finalized_at"] is not None
    assert rows[b]["outcome"] == OUTCOME_ABORTED, "finalize must not touch another row"


def test_dense_monotonic_ids_never_reused(tmp_path):
    tc = _counter(tmp_path)
    ids = [_alloc(tc) for _ in range(5)]
    assert ids == [1, 2, 3, 4, 5]
    # reload and allocate more — ids continue densely, never reused
    tc2 = TrialCounter(tc.path)
    assert _alloc(tc2) == 6


def test_one_file_forever_appends_across_waves_never_recreates(tmp_path):
    tc = _counter(tmp_path)
    _alloc(tc, wave="shakedown-1")
    zero1 = json.load(open(tc.path, encoding="utf-8"))["zero_point"]
    # a "new wave" opens the SAME file — appends, never re-stamps zero_point
    tc2 = TrialCounter(tc.path, engine_sha_at_zero="IGNORED")
    _alloc(tc2, wave="wave-2")
    doc = json.load(open(tc.path, encoding="utf-8"))
    assert doc["zero_point"] == zero1, "zero_point never re-stamped (from-zero provenance)"
    assert {r["wave"] for r in doc["runs"]} == {"shakedown-1", "wave-2"}
    assert doc["total_trials"] == 2


def test_total_trials_is_structural_cannot_drift(tmp_path):
    tc = _counter(tmp_path)
    for _ in range(3):
        _alloc(tc)
    doc = json.load(open(tc.path, encoding="utf-8"))
    assert doc["total_trials"] == len(doc["runs"]) == 3


def test_finalize_unknown_id_is_a_loud_error_not_a_silent_leak(tmp_path):
    tc = _counter(tmp_path)
    with pytest.raises(KeyError):
        tc.finalize(999, "PASS")


def test_invalid_outcome_rejected(tmp_path):
    tc = _counter(tmp_path)
    tid = _alloc(tc)
    with pytest.raises(ValueError):
        tc.finalize(tid, "MAYBE")


def test_shakedown_survivor_eligible_hard_false_and_measured_scope_line(tmp_path):
    tc = _counter(tmp_path)
    tid = _alloc(tc, approx=0.9333)
    doc = json.load(open(tc.path, encoding="utf-8"))
    row = next(r for r in doc["runs"] if r["trial_id"] == tid)
    assert row["survivor_eligible"] is False, "shakedown trials never survivor-eligible (R-041 §3)"
    assert "binding-approx 0.9333" in row["scope_line"], "MEASURED per-spec rate, not blanket 0.99 (R-042 pin 3)"


# ── F9 FORWARD-RECORDING (gate-recalibration pre-reg §2/§4-DSR) — ADDITIVE ───
# The per-trial summary Sharpe rides the counter row so the E[max-SR] null
# inputs exist AT candidacy. Additive: existing finalize callers pass no
# summary_sharpe and are unchanged (predicate-preservation — every test above
# still holds).

def test_forward_recording_absent_by_default_is_the_pre_f9_shape(tmp_path):
    """A finalize with no summary_sharpe records NO field — a valid absent slot,
    exactly the pre-F9 rows; summary_sharpes() skips it (never a fabricated 0.0)."""
    tc = _counter(tmp_path)
    tid = _alloc(tc)
    tc.finalize(tid, "PASS")
    row = next(r for r in json.load(open(tc.path, encoding="utf-8"))["runs"] if r["trial_id"] == tid)
    assert "summary_sharpe" not in row, "absent by default — no fabricated value"
    assert tc.summary_sharpes() == [], "absent rows contribute nothing to the null-input set"


def test_forward_recording_records_and_reads_back(tmp_path):
    tc = _counter(tmp_path)
    tid = tc.allocate(wave="w", strategy_ref="A", spec_hash="h", engine_sha="404a3396",
                      binding_approximation_rate=0.99, dataset_hash="ds", config_hash="cfg")
    tc.finalize(tid, "PASS", summary_sharpe=1.23)
    row = next(r for r in json.load(open(tc.path, encoding="utf-8"))["runs"] if r["trial_id"] == tid)
    assert row["summary_sharpe"] == 1.23
    got = tc.summary_sharpes()
    assert got == [{"trial_id": tid, "spec_hash": "h", "engine_sha": "404a3396",
                    "dataset_hash": "ds", "config_hash": "cfg", "summary_sharpe": 1.23}]


def test_forward_recording_excludes_aborted_rows(tmp_path):
    """An ABORTED crash is not a draw — even if a Sharpe were passed, an aborted
    row never enters the null-input set."""
    tc = _counter(tmp_path)
    a = _alloc(tc, ref="A")
    b = _alloc(tc, ref="B")
    tc.finalize(a, "PASS", summary_sharpe=0.7)
    tc.finalize(b, OUTCOME_ABORTED)
    refs = {r["trial_id"] for r in tc.summary_sharpes()}
    assert refs == {a}, "aborted rows excluded from the null-input set"


def test_forward_recording_rejects_nonfinite_and_bool(tmp_path):
    tc = _counter(tmp_path)
    tid = _alloc(tc)
    with pytest.raises(ValueError):
        tc.finalize(tid, "PASS", summary_sharpe=float("nan"))
    with pytest.raises(ValueError):
        tc.finalize(tid, "PASS", summary_sharpe=float("inf"))
    with pytest.raises(TypeError):
        tc.finalize(tid, "PASS", summary_sharpe=True)
