"""AR-1315A section 5 Lane A/D -- controls for the F36 lifecycle doorway
(scripts/g2d_postcall_lifecycle.py): async launch ack recording + SubagentStop terminal capture
with by-agent_id row resolution.

WHY THESE RUN THE REAL SCRIPT AS A CHILD PROCESS
    Same reasoning as test_g2d_postcall_capture.py: the property under test includes that a
    SEPARATE process cannot slip a second capture past the create-only receipts, and calling the
    functions in-process would prove something weaker.

SYNTHETIC QUEUES ONLY. Nothing here reads or writes the real frozen queue or receipt
directory, and no real one-shot attempt is spent or captured. Zero Agent/Task/model calls.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest

from src.engine.extraction import isolated_fallback_law as law
from src.engine.extraction.isolated_attempt_receipt import DurableAttemptLedger, _safe_name
from src.engine.extraction.isolated_bridge import (
    NATIVE_TASK_DISPATCHED,
    RAW_RETURN_CAPTURED,
    record_native_dispatch,
    state_of,
)

REF = "entry_sequence[1].action"
OTHER = "confluences[0].description"
PINNED = {"transcript_sha256": "a" * 64, "extraction_sha256": "b" * 64}

# src/engine/tests/<this file> -> tests -> engine -> src -> REPO ROOT.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DOORWAY = os.path.join(ROOT, "scripts", "g2d_postcall_lifecycle.py")

ASYNC_ACK_PAYLOAD = {
    "isAsync": True,
    "status": "async_launched",
    "agentId": "agent-A",
    "output_file": "/tmp/some/agent.output",
}


def _real_subagent_stop_payload(agent_id="agent-A", stop_reason="end_turn",
                                 last_assistant_message="the real final answer"):
    return {
        "session_id": "abc123",
        "transcript_path": "/home/user/.claude/projects/x/transcript.jsonl",
        "cwd": "/home/user/my-project",
        "permission_mode": "default",
        "hook_event_name": "SubagentStop",
        "agent_id": agent_id,
        "agent_type": "general-purpose",
        "last_assistant_message": last_assistant_message,
        "stop_reason": stop_reason,
    }


@pytest.fixture
def rig(tmp_path):
    record = {
        "route_version": "opus-phase1-route-v2",
        "outcomes": [
            {"condition_ref": REF, "disposition": "REFUSED_RELEVANCE", "gate": "g", "reason": "r"},
            {"condition_ref": OTHER, "disposition": "RED_SOURCE_FIDELITY", "gate": "g", "reason": "r"},
        ],
    }
    texts = {REF: "Wait for a close outside of the range.", OTHER: "The stop includes the wick."}
    q = law.freeze_isolated_queue(record, PINNED, texts).as_dict()
    qp = tmp_path / "queue.json"
    qp.write_text(json.dumps(q, indent=2), encoding="utf-8")
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    return str(qp), str(receipts)


def _sha_for(rig, ref=REF):
    led = DurableAttemptLedger.load(rig[0], rig[1])
    return next(e["task_input_sha256"] for e in led.queue["queue"] if e["condition_ref"] == ref)


def _claim_and_dispatch(rig, ref=REF, native_task_id="task_1"):
    led = DurableAttemptLedger.load(rig[0], rig[1])
    led.claim_attempt(ref, _sha_for(rig, ref))
    record_native_dispatch(led, ref, native_task_id=native_task_id)


def _write_json(tmp_path, name, obj):
    p = tmp_path / f"{name}-{os.urandom(4).hex()}.json"
    p.write_text(json.dumps(obj), encoding="utf-8")
    return str(p)


def _run_launch_ack(rig, tmp_path, ref=REF, payload=None):
    if payload is None:
        payload = ASYNC_ACK_PAYLOAD
    payload_path = _write_json(tmp_path, "ack", payload)
    argv = [
        sys.executable, DOORWAY, "launch-ack",
        "--queue", rig[0], "--receipt-dir", rig[1],
        "--condition-ref", ref, "--ack-payload-json", payload_path,
    ]
    proc = subprocess.run(argv, capture_output=True, text=True, cwd=ROOT)
    try:
        out = json.loads(proc.stdout.strip() or "{}")
    except json.JSONDecodeError:
        out = {"_unparsed": proc.stdout, "_stderr": proc.stderr}
    return proc.returncode, out


def _run_subagent_stop(rig, tmp_path, payload):
    payload_path = _write_json(tmp_path, "stop", payload)
    argv = [
        sys.executable, DOORWAY, "subagent-stop",
        "--queue", rig[0], "--receipt-dir", rig[1],
        "--hook-payload-json", payload_path,
    ]
    proc = subprocess.run(argv, capture_output=True, text=True, cwd=ROOT)
    try:
        out = json.loads(proc.stdout.strip() or "{}")
    except json.JSONDecodeError:
        out = {"_unparsed": proc.stdout, "_stderr": proc.stderr}
    return proc.returncode, out


def _receipts(rig, ref=REF):
    base = _safe_name(ref)
    return sorted(p for p in os.listdir(rig[1]) if p.startswith(base + "."))


# --------------------------------------------------------------------------- #
# launch-ack: POSITIVE — an ack is launch telemetry only, never a final answer
# --------------------------------------------------------------------------- #

def test_launch_ack_records_telemetry_and_never_calls_capture_native_return(rig, tmp_path):
    _claim_and_dispatch(rig)
    code, out = _run_launch_ack(rig, tmp_path)
    assert code == 0, out
    assert out["ok"] is True
    assert out["action"] == "launch_ack"
    assert out["agent_id"] == "agent-A"
    assert out["state"] == "ASYNC_LAUNCH_ACK_RECORDED"
    led = DurableAttemptLedger.load(rig[0], rig[1])
    # THE ENTIRE POINT OF F36: still dispatched, never captured.
    assert state_of(led, REF) == NATIVE_TASK_DISPATCHED
    assert _receipts(rig) == [
        f"{_safe_name(REF)}.attempt.json",
        f"{_safe_name(REF)}.dispatch.json",
        f"{_safe_name(REF)}.launch_ack.json",
    ]  # no .raw.json, no .completion.json


# --------------------------------------------------------------------------- #
# launch-ack: NEGATIVE / fail-closed
# --------------------------------------------------------------------------- #

def test_launch_ack_refused_when_not_dispatched(rig, tmp_path):
    code, out = _run_launch_ack(rig, tmp_path)
    assert code != 0
    assert out["ok"] is False
    assert out["stage"] == "capture"
    assert _receipts(rig) == []


def test_launch_ack_unknown_shape_fails_closed_not_guessed(rig, tmp_path):
    """An unrecognized PostToolUse response must be refused, never silently treated as either
    an ack or a final answer (AR-1315A #5: 'unknown live shapes fail closed')."""
    _claim_and_dispatch(rig)
    code, out = _run_launch_ack(rig, tmp_path, payload={"something": "unexpected"})
    assert code != 0
    assert out["ok"] is False
    assert out["stage"] == "shape"
    led = DurableAttemptLedger.load(rig[0], rig[1])
    assert state_of(led, REF) == NATIVE_TASK_DISPATCHED  # untouched
    assert _receipts(rig) == [f"{_safe_name(REF)}.attempt.json", f"{_safe_name(REF)}.dispatch.json"]


def test_launch_ack_missing_agent_id_fails_closed(rig, tmp_path):
    _claim_and_dispatch(rig)
    bad = dict(ASYNC_ACK_PAYLOAD)
    bad["agentId"] = ""
    code, out = _run_launch_ack(rig, tmp_path, payload=bad)
    assert code != 0
    assert out["stage"] == "shape"


def test_second_launch_ack_for_the_same_row_refused(rig, tmp_path):
    _claim_and_dispatch(rig)
    assert _run_launch_ack(rig, tmp_path)[0] == 0
    code, out = _run_launch_ack(rig, tmp_path)
    assert code != 0
    assert out["ok"] is False


# --------------------------------------------------------------------------- #
# subagent-stop: POSITIVE — end-to-end via by-agent_id resolution
# --------------------------------------------------------------------------- #

def test_subagent_stop_resolves_the_row_by_agent_id_and_captures_the_final_answer(rig, tmp_path):
    _claim_and_dispatch(rig)
    assert _run_launch_ack(rig, tmp_path)[0] == 0  # agent-A launched for REF

    code, out = _run_subagent_stop(
        rig, tmp_path, _real_subagent_stop_payload(agent_id="agent-A", last_assistant_message="grounded quote"))
    assert code == 0, out
    assert out["ok"] is True
    assert out["action"] == "subagent_stop_final"
    assert out["condition_ref"] == REF
    assert out["state"] == RAW_RETURN_CAPTURED
    led = DurableAttemptLedger.load(rig[0], rig[1])
    assert state_of(led, REF) == RAW_RETURN_CAPTURED
    with open(led.raw_path(REF), encoding="utf-8") as fh:
        stored = json.load(fh)
    assert stored["raw_output"] == "grounded quote"


def test_subagent_stop_nonterminal_tool_use_does_not_finalize(rig, tmp_path):
    _claim_and_dispatch(rig)
    assert _run_launch_ack(rig, tmp_path)[0] == 0
    code, out = _run_subagent_stop(
        rig, tmp_path, _real_subagent_stop_payload(agent_id="agent-A", stop_reason="tool_use"))
    assert code == 0, out
    assert out["ok"] is True
    assert out["action"] == "subagent_stop_nonterminal"
    led = DurableAttemptLedger.load(rig[0], rig[1])
    assert state_of(led, REF) == NATIVE_TASK_DISPATCHED  # still not finalized


# --------------------------------------------------------------------------- #
# subagent-stop: NEGATIVE / fail-closed row resolution
# --------------------------------------------------------------------------- #

def test_subagent_stop_unknown_agent_id_refused_zero_matches(rig, tmp_path):
    _claim_and_dispatch(rig)
    assert _run_launch_ack(rig, tmp_path)[0] == 0  # agent-A launched
    code, out = _run_subagent_stop(
        rig, tmp_path, _real_subagent_stop_payload(agent_id="agent-NEVER-LAUNCHED"))
    assert code != 0
    assert out["ok"] is False
    assert out["stage"] == "resolve"
    led = DurableAttemptLedger.load(rig[0], rig[1])
    assert state_of(led, REF) == NATIVE_TASK_DISPATCHED


def test_subagent_stop_ambiguous_agent_id_refused_multiple_matches(rig, tmp_path):
    """MUTATION/CONTROL: proves the resolver actually discriminates. If two rows were (by defect
    of the caller wiring the same agent_id twice) both recorded under the same agent_id, resolving
    to either one silently would be a guess -- this must refuse both, not pick one."""
    _claim_and_dispatch(rig, ref=REF, native_task_id="task_1")
    _claim_and_dispatch(rig, ref=OTHER, native_task_id="task_2")
    same_ack = dict(ASYNC_ACK_PAYLOAD)
    assert _run_launch_ack(rig, tmp_path, ref=REF, payload=same_ack)[0] == 0
    assert _run_launch_ack(rig, tmp_path, ref=OTHER, payload=same_ack)[0] == 0  # SAME agentId

    code, out = _run_subagent_stop(rig, tmp_path, _real_subagent_stop_payload(agent_id="agent-A"))
    assert code != 0
    assert out["ok"] is False
    assert out["stage"] == "resolve"
    led = DurableAttemptLedger.load(rig[0], rig[1])
    assert state_of(led, REF) == NATIVE_TASK_DISPATCHED
    assert state_of(led, OTHER) == NATIVE_TASK_DISPATCHED  # neither row was guessed into capture


def test_subagent_stop_with_no_launch_ack_at_all_refused(rig, tmp_path):
    _claim_and_dispatch(rig)  # dispatched, but never acked
    code, out = _run_subagent_stop(rig, tmp_path, _real_subagent_stop_payload(agent_id="agent-A"))
    assert code != 0
    assert out["stage"] == "resolve"


def test_subagent_stop_missing_agent_id_in_payload_refused(rig, tmp_path):
    _claim_and_dispatch(rig)
    assert _run_launch_ack(rig, tmp_path)[0] == 0
    payload = _real_subagent_stop_payload()
    payload["agent_id"] = None
    code, out = _run_subagent_stop(rig, tmp_path, payload)
    assert code != 0
    assert out["stage"] == "shape"


def test_subagent_stop_duplicate_terminal_event_refused_without_overwrite(rig, tmp_path):
    _claim_and_dispatch(rig)
    assert _run_launch_ack(rig, tmp_path)[0] == 0
    payload = _real_subagent_stop_payload(agent_id="agent-A", last_assistant_message="first")
    assert _run_subagent_stop(rig, tmp_path, payload)[0] == 0
    code, out = _run_subagent_stop(rig, tmp_path, payload)
    assert code != 0
    assert out["ok"] is False
    led = DurableAttemptLedger.load(rig[0], rig[1])
    with open(led.raw_path(REF), encoding="utf-8") as fh:
        stored = json.load(fh)
    assert stored["raw_output"] == "first"  # untouched by the refused duplicate


# --------------------------------------------------------------------------- #
# CONTROL DISCRIMINATION — a different row's lifecycle is unaffected
# --------------------------------------------------------------------------- #

def test_a_different_dispatched_row_is_unaffected(rig, tmp_path):
    _claim_and_dispatch(rig, ref=REF, native_task_id="task_1")
    _claim_and_dispatch(rig, ref=OTHER, native_task_id="task_2")
    ack_a = dict(ASYNC_ACK_PAYLOAD)
    ack_b = dict(ASYNC_ACK_PAYLOAD)
    ack_b["agentId"] = "agent-B"
    assert _run_launch_ack(rig, tmp_path, ref=REF, payload=ack_a)[0] == 0
    assert _run_launch_ack(rig, tmp_path, ref=OTHER, payload=ack_b)[0] == 0

    code, out = _run_subagent_stop(rig, tmp_path, _real_subagent_stop_payload(agent_id="agent-B"))
    assert code == 0, out
    assert out["condition_ref"] == OTHER
    led = DurableAttemptLedger.load(rig[0], rig[1])
    assert state_of(led, OTHER) == RAW_RETURN_CAPTURED
    assert state_of(led, REF) == NATIVE_TASK_DISPATCHED  # REF's own ack is untouched
