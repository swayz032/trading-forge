"""H1 Wave-6 Pass-2 (2026-07-13) — `run_two_phase_extraction` orchestrator tests.

Covers the §2 handoff wiring in `extractor_bridge.py`
(`build_phase_b_scope`, `run_two_phase_extraction`) via `monkeypatch` on
`invoke_strategy_enumerator` / `invoke_real_extractor` — NO real subprocess
/ Ollama call in this file (that proof is the live birth-fixture run,
`scripts/h1_wave6_pass2_birth_fixtures.py`, exercised separately). Mirrors
`test_extractor_bridge.py`'s own mocked-subprocess discipline.
"""
from __future__ import annotations

import pytest

from src.engine.extraction import extractor_bridge as eb


def test_build_phase_b_scope_extracts_expected_fields():
    phase_a_strategy = {
        "strategy_id": 1,
        "name": "x",
        "entry_summary": "enter here",
        "exit_summary": "exit here",
        "variants": [{"variant_label": "v1"}],
    }
    scope = eb.build_phase_b_scope(phase_a_strategy)
    assert scope == {
        "entry_summary": "enter here",
        "exit_summary": "exit here",
        "variants": [{"variant_label": "v1"}],
    }


def test_build_phase_b_scope_defaults_variants_to_empty_list():
    scope = eb.build_phase_b_scope({"entry_summary": "e", "exit_summary": "x"})
    assert scope["variants"] == []


def test_run_two_phase_extraction_empty_phase_a_short_circuits_no_phase_b_calls():
    def _fake_enumerate(transcript_text, video_id, timeout_s=240.0):
        return {"strategies": [], "enumeration_note": "nothing taught"}

    def _boom(*args, **kwargs):
        raise AssertionError("invoke_real_extractor must NOT be called when Phase A enumerates nothing")

    import unittest.mock as mock

    with mock.patch.object(eb, "invoke_strategy_enumerator", _fake_enumerate), \
         mock.patch.object(eb, "invoke_real_extractor", _boom):
        result = eb.run_two_phase_extraction("some transcript", "video-empty")

    assert result["strategies"] == []
    assert result["rejected_strategies"] == []
    assert result["instrument_classification"] is None
    assert result["phase_a_enumeration"]["strategies"] == []
    assert result["per_strategy_extractions"] == []


def test_run_two_phase_extraction_fans_out_one_scoped_call_per_phase_a_strategy():
    phase_a_output = {
        "strategies": [
            {"strategy_id": 0, "name": "A", "entry_summary": "eA", "exit_summary": "xA", "variants": []},
            {"strategy_id": 1, "name": "B", "entry_summary": "eB", "exit_summary": "xB", "variants": [{"variant_label": "vB"}]},
        ],
        "enumeration_note": None,
    }

    calls = []

    def _fake_enumerate(transcript_text, video_id, timeout_s=240.0):
        return phase_a_output

    def _fake_extract(transcript_text, video_id, timeout_s=240.0, scope=None):
        calls.append({"video_id": video_id, "scope": scope})
        idx = len(calls) - 1
        return {
            "strategies": [{"name": f"phaseB-{idx}"}],
            "rejected_strategies": [],
            "instrument_classification": "futures_primary",
        }

    import unittest.mock as mock

    with mock.patch.object(eb, "invoke_strategy_enumerator", _fake_enumerate), \
         mock.patch.object(eb, "invoke_real_extractor", _fake_extract):
        result = eb.run_two_phase_extraction("some transcript", "video-two-strats")

    # Exactly ONE Phase B call per Phase-A-enumerated strategy (packet §2).
    assert len(calls) == 2
    assert calls[0]["scope"] == {"entry_summary": "eA", "exit_summary": "xA", "variants": []}
    assert calls[1]["scope"] == {"entry_summary": "eB", "exit_summary": "xB", "variants": [{"variant_label": "vB"}]}
    # video_id is scoped per Phase-A strategy_id, distinguishable in vault/logs.
    assert "phaseA-s0" in calls[0]["video_id"]
    assert "phaseA-s1" in calls[1]["video_id"]

    # Downstream assembly: concatenated into the SAME top-level strategies[]
    # shape (packet §2) — the two-phase split is invisible past this call.
    assert result["strategies"] == [{"name": "phaseB-0"}, {"name": "phaseB-1"}]
    assert result["instrument_classification"] == "futures_primary"
    assert len(result["per_strategy_extractions"]) == 2
    assert result["per_strategy_extractions"][0]["phase_a_strategy_id"] == 0
    assert result["per_strategy_extractions"][1]["phase_a_strategy_id"] == 1
    assert result["phase_a_enumeration"] == phase_a_output


def test_run_two_phase_extraction_propagates_enumerator_error_never_fabricates():
    def _fake_enumerate(transcript_text, video_id, timeout_s=240.0):
        raise eb.EnumeratorError("boom")

    import unittest.mock as mock

    with mock.patch.object(eb, "invoke_strategy_enumerator", _fake_enumerate):
        with pytest.raises(eb.EnumeratorError):
            eb.run_two_phase_extraction("t", "v")


def test_run_two_phase_extraction_propagates_extractor_error_never_fabricates():
    def _fake_enumerate(transcript_text, video_id, timeout_s=240.0):
        return {"strategies": [{"strategy_id": 0, "entry_summary": "e", "exit_summary": "x", "variants": []}]}

    def _fake_extract(transcript_text, video_id, timeout_s=240.0, scope=None):
        raise eb.RealExtractorError("boom")

    import unittest.mock as mock

    with mock.patch.object(eb, "invoke_strategy_enumerator", _fake_enumerate), \
         mock.patch.object(eb, "invoke_real_extractor", _fake_extract):
        with pytest.raises(eb.RealExtractorError):
            eb.run_two_phase_extraction("t", "v")


def test_run_two_phase_extraction_rejected_strategies_concatenated_across_calls():
    phase_a_output = {
        "strategies": [
            {"strategy_id": 0, "entry_summary": "e0", "exit_summary": "x0", "variants": []},
            {"strategy_id": 1, "entry_summary": "e1", "exit_summary": "x1", "variants": []},
        ],
    }

    def _fake_enumerate(transcript_text, video_id, timeout_s=240.0):
        return phase_a_output

    def _fake_extract(transcript_text, video_id, timeout_s=240.0, scope=None):
        return {
            "strategies": [],
            "rejected_strategies": [{"reason": "fixed_point_stop_not_supported"}],
            "instrument_classification": None,
        }

    import unittest.mock as mock

    with mock.patch.object(eb, "invoke_strategy_enumerator", _fake_enumerate), \
         mock.patch.object(eb, "invoke_real_extractor", _fake_extract):
        result = eb.run_two_phase_extraction("t", "v")

    assert len(result["rejected_strategies"]) == 2
