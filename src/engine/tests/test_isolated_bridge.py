"""D1.2 / D1.3 — the durable native handoff and its completion receipt (AR-1254 §4, §5).

The state machine exists because the Claude Code subagent dispatch is performed by the agent,
not by a Python function, so a callback cannot literally BE the live invocation. Every test here
therefore checks a property that survives a process boundary: the state is read back from the
filesystem, never from an object held in memory.

Synthetic queues only. Nothing here dispatches anything.
"""

from __future__ import annotations

import json

import pytest

from src.engine.extraction import isolated_fallback_law as law
from src.engine.extraction.isolated_attempt_receipt import AttemptRefused, DurableAttemptLedger
from src.engine.extraction.isolated_bridge import (
    CLAIMED,
    COMPLETION_FIELDS,
    NATIVE_TASK_DISPATCHED,
    NOT_EXPOSED,
    RAW_RETURN_CAPTURED,
    READY,
    bridge_report,
    capture_native_return,
    record_native_dispatch,
    state_of,
)

REF = "entry_sequence[1].action"
OTHER = "confluences[0].description"
PINNED = {"transcript_sha256": "a" * 64, "extraction_sha256": "b" * 64}


@pytest.fixture
def rig(tmp_path):
    record = {
        "route_version": "opus-phase1-route-v2",
        "outcomes": [
            {"condition_ref": REF, "disposition": "REFUSED_RELEVANCE", "gate": "g", "reason": "r"},
            {"condition_ref": OTHER, "disposition": "RED_SOURCE_FIDELITY", "gate": "g",
             "reason": "r"},
        ],
    }
    texts = {REF: "Wait for a close outside of the range.", OTHER: "The stop includes the wick."}
    q = law.freeze_isolated_queue(record, PINNED, texts).as_dict()
    qp = tmp_path / "queue.json"
    qp.write_text(json.dumps(q, indent=2), encoding="utf-8")
    return str(qp), str(tmp_path / "receipts")


def _led(rig):
    """A FRESH ledger every call — every state read below therefore crosses a simulated
    process boundary rather than reading an in-memory field."""
    return DurableAttemptLedger.load(rig[0], rig[1])


def _sha_for(led, ref):
    return next(e["task_input_sha256"] for e in led.queue["queue"] if e["condition_ref"] == ref)


def _claim(rig, ref=REF):
    led = _led(rig)
    led.claim_attempt(ref, _sha_for(led, ref))
    return led


# --------------------------------------------------------------------------- #
# 1. THE ORDER — each transition requires its predecessor
# --------------------------------------------------------------------------- #


def test_the_full_ordered_handoff(rig):
    assert state_of(_led(rig), REF) == READY
    _claim(rig)
    assert state_of(_led(rig), REF) == CLAIMED
    record_native_dispatch(_led(rig), REF, native_task_id="task_123")
    assert state_of(_led(rig), REF) == NATIVE_TASK_DISPATCHED
    capture_native_return(_led(rig), REF, "a literal quote")
    assert state_of(_led(rig), REF) == RAW_RETURN_CAPTURED


def test_a_dispatch_without_a_claim_is_refused(rig):
    """An unbudgeted call cannot even be RECORDED, let alone made."""
    with pytest.raises(AttemptRefused, match="no durable attempt has been claimed"):
        record_native_dispatch(_led(rig), REF)


def test_a_capture_without_a_dispatch_is_refused(rig):
    """Text arriving for a call that was never issued is not an answer."""
    _claim(rig)
    with pytest.raises(AttemptRefused, match="no native dispatch was recorded"):
        capture_native_return(_led(rig), REF, "a quote from nowhere")


def test_a_second_dispatch_is_refused_across_a_restart(rig):
    _claim(rig)
    record_native_dispatch(_led(rig), REF)
    with pytest.raises(AttemptRefused, match="already at state"):
        record_native_dispatch(_led(rig), REF)


def test_a_second_capture_is_refused_across_a_restart(rig):
    _claim(rig)
    record_native_dispatch(_led(rig), REF)
    capture_native_return(_led(rig), REF, "first and only")
    with pytest.raises(AttemptRefused, match="already has a captured raw return"):
        capture_native_return(_led(rig), REF, "a nicer second answer")


def test_an_out_of_queue_ref_has_no_state_at_all(rig):
    with pytest.raises(AttemptRefused, match="not in the committed queue"):
        state_of(_led(rig), "entry_sequence[99].action")


def test_an_api_paid_path_is_refused(rig):
    """AR-1250 §5: no API key, SDK or separate spend is authorized."""
    _claim(rig)
    with pytest.raises(AttemptRefused, match="not the approved Claude Code subscription"):
        record_native_dispatch(_led(rig), REF, invocation_path="anthropic API (billed)")


# --------------------------------------------------------------------------- #
# 2. §5 — THE COMPLETION RECEIPT, AND HONEST ABSENCE
# --------------------------------------------------------------------------- #


def test_unavailable_telemetry_is_recorded_as_not_exposed_never_invented(rig):
    _claim(rig)
    record_native_dispatch(_led(rig), REF)
    rec = capture_native_return(_led(rig), REF, "a quote")   # no completion metadata supplied

    for field in COMPLETION_FIELDS:
        assert rec[field] == NOT_EXPOSED, field
    assert "never an invented number" in rec["telemetry_policy"]


def test_supplied_telemetry_is_preserved_and_the_rest_marked_absent(rig):
    _claim(rig)
    record_native_dispatch(_led(rig), REF)
    rec = capture_native_return(
        _led(rig), REF, "a quote",
        completion={"actual_model_identity": "claude-opus-5", "native_task_id": "t_9",
                    "invocation_started_at": "2026-08-16T05:00:00Z"},
    )
    assert rec["actual_model_identity"] == "claude-opus-5"
    assert rec["native_task_id"] == "t_9"
    assert rec["invocation_started_at"] == "2026-08-16T05:00:00Z"
    # the ones the runtime did not give us are named as absent, not omitted
    assert rec["input_tokens"] == NOT_EXPOSED
    assert rec["output_tokens"] == NOT_EXPOSED
    assert rec["invocation_ended_at"] == NOT_EXPOSED


def test_an_unrecognised_completion_field_is_refused(rig):
    """A fixed contract is what lets a reader tell 'absent' from 'never asked for'."""
    _claim(rig)
    record_native_dispatch(_led(rig), REF)
    with pytest.raises(AttemptRefused, match="unrecognised fields"):
        capture_native_return(_led(rig), REF, "a quote",
                              completion={"cost_in_dollars": 0.02})


def test_the_completion_receipt_is_joined_to_the_queue_and_the_raw(rig):
    led = _claim(rig)
    record_native_dispatch(_led(rig), REF)
    rec = capture_native_return(_led(rig), REF, "a quote")
    assert rec["queue_artifact_sha256"] == led.queue_sha256
    assert rec["task_input_sha256"] == _sha_for(led, REF)
    raw = json.loads(open(_led(rig).raw_path(REF), encoding="utf-8").read())
    assert rec["raw_output_sha256"] == raw["raw_output_sha256"]


def test_timestamps_and_tokens_stay_out_of_the_semantic_record(rig):
    """§5's determinism fence. The completion receipt is evidence; the route record is the
    semantic result, and identical semantic reruns must stay byte-identical."""
    _claim(rig)
    record_native_dispatch(_led(rig), REF)
    capture_native_return(_led(rig), REF, "a quote",
                          completion={"invocation_started_at": "2026-08-16T05:00:00Z",
                                      "input_tokens": 1234})
    raw = json.loads(open(_led(rig).raw_path(REF), encoding="utf-8").read())
    for banned in ("invocation_started_at", "input_tokens", "output_tokens"):
        assert banned not in raw, f"{banned} leaked into the raw/semantic artifact"


# --------------------------------------------------------------------------- #
# 3. THE HANDOFF IS ANSWERABLE FROM THE DIRECTORY ALONE
# --------------------------------------------------------------------------- #


def test_a_crash_mid_handoff_is_visible_and_stays_spent(rig):
    """Claimed and dispatched, no return. The call may have been delivered, so it is stranded —
    reported, never auto-retried."""
    _claim(rig)
    record_native_dispatch(_led(rig), REF)

    rep = bridge_report(_led(rig))
    assert rep["stranded_mid_handoff"] == [REF]
    assert rep["unstarted"] == [OTHER]
    assert rep["complete"] == []
    with pytest.raises(AttemptRefused):
        _led(rig).claim_attempt(REF, _sha_for(_led(rig), REF))


def test_the_report_partitions_every_queued_ref_exactly_once(rig):
    _claim(rig)
    record_native_dispatch(_led(rig), REF)
    capture_native_return(_led(rig), REF, "done")

    rep = bridge_report(_led(rig))
    assert rep["complete"] == [REF]
    assert rep["unstarted"] == [OTHER]
    assert rep["stranded_mid_handoff"] == []
    partitioned = sorted(rep["complete"] + rep["unstarted"] + rep["stranded_mid_handoff"])
    assert partitioned == sorted(rep["states"])


def test_each_ref_keeps_its_own_handoff(rig):
    _claim(rig)
    record_native_dispatch(_led(rig), REF)
    # OTHER is untouched and must still be startable
    _claim(rig, OTHER)
    assert state_of(_led(rig), OTHER) == CLAIMED
    assert state_of(_led(rig), REF) == NATIVE_TASK_DISPATCHED


def test_the_module_cannot_dispatch_anything_itself(rig):
    """It records that a dispatch happened. It is evidence, not execution — and the absence of
    any invocation machinery is what keeps that claim true.

    The import check is the behavioural half; the receipt note is asserted at RUNTIME rather than
    by grepping the source, because a source-text assertion passes on a comment and proves
    nothing about what the module does."""
    import inspect

    from src.engine.extraction import isolated_bridge as m

    src = inspect.getsource(m)
    for banned in ("subprocess", "requests", "httpx", "urllib", "anthropic", "openai"):
        assert banned not in src, f"the bridge imports an invocation mechanism: {banned}"

    _claim(rig)
    receipt = record_native_dispatch(_led(rig), REF)
    assert "evidence, not execution" in receipt["note"]
    assert receipt["state"] == NATIVE_TASK_DISPATCHED
