"""F36 — proof that an async launch acknowledgement can never finalize a row, only a matching
terminal-completion event (modeled here as a synthetic SubagentStop) can, with identity binding,
no duplicate overwrite, and the row-N+1 sequential interlock (AR-1311B / AR-1312B / AR-1313A).

Synthetic queues and synthetic events only. Zero Agent/Task/model calls anywhere in this file.
"""
from __future__ import annotations

import json
import os

import pytest

from src.engine.extraction import isolated_fallback_law as law
from src.engine.extraction.g2d_subagentstop_capture import (
    SubagentStopNotTerminal,
    assert_sequential_interlock,
    capture_subagent_stop_event,
    capture_subagent_stop_final,
    extract_subagent_stop_fields,
    record_async_launch_ack,
)
from src.engine.extraction.isolated_attempt_receipt import (
    AttemptRefused,
    DurableAttemptLedger,
    _safe_name,
)
from src.engine.extraction.isolated_bridge import (
    NATIVE_TASK_DISPATCHED,
    RAW_RETURN_CAPTURED,
    capture_native_return,
    record_native_dispatch,
    state_of,
)

REF1 = "entry_sequence[1].action"
REF2 = "confluences[0].description"
PINNED = {"transcript_sha256": "a" * 64, "extraction_sha256": "b" * 64}
ASYNC_ACK_PAYLOAD = {
    "isAsync": True,
    "status": "async_launched",
    "agentId": "aXXXXXXXXXXXXXXXX",
    "output_file": "/tmp/some/agent.output",
}


@pytest.fixture
def rig(tmp_path):
    record = {
        "route_version": "opus-phase1-route-v2",
        "outcomes": [
            {"condition_ref": REF1, "disposition": "REFUSED_RELEVANCE", "gate": "g", "reason": "r"},
            {"condition_ref": REF2, "disposition": "RED_SOURCE_FIDELITY", "gate": "g", "reason": "r"},
        ],
    }
    texts = {REF1: "Wait for a close outside of the range.", REF2: "The stop includes the wick."}
    q = law.freeze_isolated_queue(record, PINNED, texts).as_dict()
    qp = tmp_path / "queue.json"
    qp.write_text(json.dumps(q, indent=2), encoding="utf-8")
    return str(qp), str(tmp_path / "receipts")


def _led(rig):
    return DurableAttemptLedger.load(rig[0], rig[1])


def _sha_for(led, ref):
    return next(e["task_input_sha256"] for e in led.queue["queue"] if e["condition_ref"] == ref)


def _dispatch(rig, ref, native_task_id="task_1"):
    led = _led(rig)
    led.claim_attempt(ref, _sha_for(led, ref))
    led2 = _led(rig)
    record_native_dispatch(led2, ref, native_task_id=native_task_id)


# --------------------------------------------------------------------------- #
# 1. ASYNC LAUNCH ACK NEGATIVE — launched != complete
# --------------------------------------------------------------------------- #


def test_async_launch_ack_does_not_finalize_the_row(rig):
    _dispatch(rig, REF1)
    record_async_launch_ack(_led(rig), REF1, agent_id="agent-A", raw_ack_payload=ASYNC_ACK_PAYLOAD)
    # Still NATIVE_TASK_DISPATCHED, NOT RAW_RETURN_CAPTURED — this is the entire point of F36.
    assert state_of(_led(rig), REF1) == NATIVE_TASK_DISPATCHED


def test_launch_ack_refused_without_a_prior_dispatch(rig):
    with pytest.raises(AttemptRefused, match="a launch ack is only valid"):
        record_async_launch_ack(_led(rig), REF1, agent_id="agent-A")


def test_launch_ack_refused_with_no_agent_id(rig):
    _dispatch(rig, REF1)
    with pytest.raises(AttemptRefused, match="no agent_id"):
        record_async_launch_ack(_led(rig), REF1, agent_id="")


def test_second_launch_ack_for_the_same_row_refused(rig):
    _dispatch(rig, REF1)
    record_async_launch_ack(_led(rig), REF1, agent_id="agent-A")
    with pytest.raises(AttemptRefused, match="already has a recorded launch ack"):
        record_async_launch_ack(_led(rig), REF1, agent_id="agent-A")


# --------------------------------------------------------------------------- #
# 2. TRUE FINAL POSITIVE — a matching SubagentStop captures the real answer
# --------------------------------------------------------------------------- #


def test_matching_subagent_stop_captures_the_final_answer(rig):
    _dispatch(rig, REF1)
    record_async_launch_ack(_led(rig), REF1, agent_id="agent-A")
    capture_subagent_stop_final(_led(rig), REF1, agent_id="agent-A", raw_output="the real final quote")
    assert state_of(_led(rig), REF1) == RAW_RETURN_CAPTURED
    with open(_led(rig).raw_path(REF1), encoding="utf-8") as fh:
        stored = json.load(fh)
    assert stored["raw_output"] == "the real final quote"


# --------------------------------------------------------------------------- #
# 3. WRONG / UNKNOWN IDENTITY — fail closed
# --------------------------------------------------------------------------- #


def test_subagent_stop_with_no_launch_ack_on_file_is_refused(rig):
    _dispatch(rig, REF1)
    with pytest.raises(AttemptRefused, match="no launch ack was ever recorded"):
        capture_subagent_stop_final(_led(rig), REF1, agent_id="agent-A", raw_output="x")
    assert state_of(_led(rig), REF1) == NATIVE_TASK_DISPATCHED


def test_subagent_stop_with_mismatched_agent_id_is_refused(rig):
    _dispatch(rig, REF1)
    record_async_launch_ack(_led(rig), REF1, agent_id="agent-A")
    with pytest.raises(AttemptRefused, match="mismatched identity is never trusted"):
        capture_subagent_stop_final(_led(rig), REF1, agent_id="agent-WRONG", raw_output="x")
    # fail closed: row is still not finalized
    assert state_of(_led(rig), REF1) == NATIVE_TASK_DISPATCHED


# --------------------------------------------------------------------------- #
# 4. DUPLICATE FINALIZATION — cannot overwrite the first durable capture
# --------------------------------------------------------------------------- #


def test_duplicate_subagent_stop_cannot_overwrite_first_capture(rig):
    _dispatch(rig, REF1)
    record_async_launch_ack(_led(rig), REF1, agent_id="agent-A")
    capture_subagent_stop_final(_led(rig), REF1, agent_id="agent-A", raw_output="first real answer")
    with pytest.raises(AttemptRefused, match="already has a captured raw return"):
        capture_subagent_stop_final(_led(rig), REF1, agent_id="agent-A", raw_output="a second, different answer")
    with open(_led(rig).raw_path(REF1), encoding="utf-8") as fh:
        stored = json.load(fh)
    assert stored["raw_output"] == "first real answer"   # untouched by the refused second call


# --------------------------------------------------------------------------- #
# 5. SEQUENTIAL INTERLOCK — row N+1 blocked while row N lacks a final capture
# --------------------------------------------------------------------------- #


def test_row_two_denied_while_row_one_is_only_launched(rig):
    _dispatch(rig, REF1)
    record_async_launch_ack(_led(rig), REF1, agent_id="agent-A")
    # REF1 is NATIVE_TASK_DISPATCHED, not RAW_RETURN_CAPTURED — REF2 must stay denied.
    with pytest.raises(AttemptRefused, match="sequential interlock"):
        assert_sequential_interlock(_led(rig), REF2)


def test_row_two_allowed_once_row_one_has_a_valid_final_capture(rig):
    _dispatch(rig, REF1)
    record_async_launch_ack(_led(rig), REF1, agent_id="agent-A")
    capture_subagent_stop_final(_led(rig), REF1, agent_id="agent-A", raw_output="real answer")
    assert state_of(_led(rig), REF1) == RAW_RETURN_CAPTURED
    assert_sequential_interlock(_led(rig), REF2)  # must not raise


# --------------------------------------------------------------------------- #
# 6. MUTATION / RED CONTROL — the OLD premature-capture behavior, reproduced and refused
# --------------------------------------------------------------------------- #


def test_mutation_control_old_bug_would_have_finalized_on_the_ack_new_path_does_not(rig):
    """RED half: reproduce F36 exactly. The bug was calling `capture_native_return` directly
    on the launch-ack JSON right after dispatch (skipping the launch-ack boundary entirely) —
    which `capture_native_return` accepts, because it has no opinion about WHAT text it is
    given, only about receipt-state ordering. This is the defect AR-1311B found, reproduced
    here on a synthetic ledger to prove it is real and not a documentation error."""
    _dispatch(rig, REF1)
    old_buggy_raw = json.dumps(ASYNC_ACK_PAYLOAD)
    capture_native_return(_led(rig), REF1, old_buggy_raw)  # the OLD bug: this "succeeds"
    assert state_of(_led(rig), REF1) == RAW_RETURN_CAPTURED
    with open(_led(rig).raw_path(REF1), encoding="utf-8") as fh:
        stored = json.load(fh)
    assert json.loads(stored["raw_output"])["status"] == "async_launched"  # the ack, not an answer
    # GREEN half, same fixture shape, REF2 instead of REF1: the repaired lifecycle refuses to
    # let the same ack payload finalize anything — it only ever reaches record_async_launch_ack,
    # which by construction cannot create `.raw`/`.completion`.
    _dispatch(rig, REF2, native_task_id="task_2")
    record_async_launch_ack(_led(rig), REF2, agent_id="agent-B", raw_ack_payload=ASYNC_ACK_PAYLOAD)
    assert state_of(_led(rig), REF2) == NATIVE_TASK_DISPATCHED   # NOT captured — the fix holds


# --------------------------------------------------------------------------- #
# 7. REAL SCHEMA-SHAPED SubagentStop PAYLOADS — fields verbatim from
#    https://code.claude.com/docs/en/hooks#subagentstop (fetched live 2026-08-18)
# --------------------------------------------------------------------------- #


def _real_subagent_stop_payload(agent_id="subagent_01ABC123", stop_reason="end_turn",
                                 last_assistant_message="I've completed the review."):
    return {
        "session_id": "abc123",
        "transcript_path": "/home/user/.claude/projects/x/transcript.jsonl",
        "cwd": "/home/user/my-project",
        "permission_mode": "default",
        "hook_event_name": "SubagentStop",
        "agent_id": agent_id,
        "agent_type": "security-reviewer",
        "last_assistant_message": last_assistant_message,
        "stop_reason": stop_reason,
    }


def test_extract_subagent_stop_fields_on_a_real_shaped_terminal_payload():
    agent_id, message, reason = extract_subagent_stop_fields(_real_subagent_stop_payload())
    assert agent_id == "subagent_01ABC123"
    assert message == "I've completed the review."
    assert reason == "end_turn"


@pytest.mark.parametrize("reason", ["end_turn", "max_tokens", "stop_sequence"])
def test_extract_subagent_stop_fields_accepts_every_documented_terminal_reason(reason):
    _, _, got = extract_subagent_stop_fields(_real_subagent_stop_payload(stop_reason=reason))
    assert got == reason


def test_extract_subagent_stop_fields_refuses_tool_use_as_nonterminal():
    payload = _real_subagent_stop_payload(stop_reason="tool_use")
    with pytest.raises(SubagentStopNotTerminal, match="awaiting a tool result"):
        extract_subagent_stop_fields(payload)


def test_extract_subagent_stop_fields_refuses_wrong_event_name():
    payload = _real_subagent_stop_payload()
    payload["hook_event_name"] = "Stop"
    with pytest.raises(ValueError, match="expected hook_event_name 'SubagentStop'"):
        extract_subagent_stop_fields(payload)


def test_extract_subagent_stop_fields_refuses_missing_agent_id():
    payload = _real_subagent_stop_payload()
    payload["agent_id"] = None
    with pytest.raises(ValueError, match="carries no agent_id"):
        extract_subagent_stop_fields(payload)


def test_extract_subagent_stop_fields_refuses_unknown_stop_reason():
    payload = _real_subagent_stop_payload(stop_reason="some_future_reason_not_yet_documented")
    with pytest.raises(ValueError, match="unrecognized stop_reason"):
        extract_subagent_stop_fields(payload)


def test_extract_subagent_stop_fields_refuses_terminal_event_with_no_final_message():
    payload = _real_subagent_stop_payload(last_assistant_message="")
    with pytest.raises(ValueError, match="carries no last_assistant_message"):
        extract_subagent_stop_fields(payload)


# --------------------------------------------------------------------------- #
# 8. THE REAL LIVE-SHAPED ENTRY POINT — capture_subagent_stop_event()
# --------------------------------------------------------------------------- #


def test_capture_subagent_stop_event_end_to_end_with_a_real_shaped_payload(rig):
    _dispatch(rig, REF1)
    record_async_launch_ack(_led(rig), REF1, agent_id="subagent_01ABC123")
    payload = _real_subagent_stop_payload(
        agent_id="subagent_01ABC123", last_assistant_message="the grounded quote, verbatim")
    capture_subagent_stop_event(_led(rig), REF1, payload)
    assert state_of(_led(rig), REF1) == RAW_RETURN_CAPTURED
    with open(_led(rig).raw_path(REF1), encoding="utf-8") as fh:
        stored = json.load(fh)
    assert stored["raw_output"] == "the grounded quote, verbatim"


def test_capture_subagent_stop_event_tool_use_does_not_finalize_and_row_stays_dispatched(rig):
    _dispatch(rig, REF1)
    record_async_launch_ack(_led(rig), REF1, agent_id="subagent_01ABC123")
    payload = _real_subagent_stop_payload(agent_id="subagent_01ABC123", stop_reason="tool_use")
    with pytest.raises(SubagentStopNotTerminal):
        capture_subagent_stop_event(_led(rig), REF1, payload)
    # non-terminal: row is exactly where it was, and no audit/raw/completion receipt exists
    led = _led(rig)
    assert state_of(led, REF1) == NATIVE_TASK_DISPATCHED
    assert not os.path.exists(led.raw_path(REF1))
    assert not os.path.exists(os.path.join(led.receipt_dir, f"{_safe_name(REF1)}.completion.json"))
    assert not os.path.exists(
        os.path.join(led.receipt_dir, f"{_safe_name(REF1)}.subagent_stop_event.json"))


def test_capture_subagent_stop_event_mismatched_agent_id_fails_closed(rig):
    _dispatch(rig, REF1)
    record_async_launch_ack(_led(rig), REF1, agent_id="subagent_01ABC123")
    payload = _real_subagent_stop_payload(agent_id="subagent_DIFFERENT_AGENT")
    with pytest.raises(AttemptRefused, match="mismatched identity is never trusted"):
        capture_subagent_stop_event(_led(rig), REF1, payload)
    assert state_of(_led(rig), REF1) == NATIVE_TASK_DISPATCHED


def test_capture_subagent_stop_event_duplicate_terminal_event_refused(rig):
    _dispatch(rig, REF1)
    record_async_launch_ack(_led(rig), REF1, agent_id="subagent_01ABC123")
    payload = _real_subagent_stop_payload(agent_id="subagent_01ABC123")
    capture_subagent_stop_event(_led(rig), REF1, payload)
    with pytest.raises(AttemptRefused, match="already has a recorded terminal SubagentStop event"):
        capture_subagent_stop_event(_led(rig), REF1, payload)
