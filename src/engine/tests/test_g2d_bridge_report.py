"""AR-1305A F33/F34 -- controls for the read-only bridge-report doorway.

SYNTHETIC QUEUES ONLY. Nothing here touches the real frozen queue or receipt directory.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest

from src.engine.extraction import isolated_fallback_law as law
from src.engine.extraction.isolated_attempt_receipt import DurableAttemptLedger
from src.engine.extraction.isolated_bridge import capture_native_return, record_native_dispatch

REF_A = "entry_sequence[0].rationale"
REF_B = "entry_sequence[1].action"
PINNED = {"transcript_sha256": "a" * 64, "extraction_sha256": "b" * 64}

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DOORWAY = os.path.join(ROOT, "scripts", "g2d_bridge_report.py")


@pytest.fixture
def rig(tmp_path):
    record = {
        "route_version": "opus-phase1-route-v2",
        "outcomes": [
            {"condition_ref": REF_A, "disposition": "REFUSED_RELEVANCE", "gate": "g", "reason": "r"},
            {"condition_ref": REF_B, "disposition": "RED_SOURCE_FIDELITY", "gate": "g", "reason": "r"},
        ],
    }
    texts = {REF_A: "Wait for a close outside of the range.", REF_B: "The stop includes the wick."}
    q = law.freeze_isolated_queue(record, PINNED, texts).as_dict()
    qp = tmp_path / "queue.json"
    qp.write_text(json.dumps(q, indent=2), encoding="utf-8")
    receipts = tmp_path / "receipts"
    receipts.mkdir()
    return str(qp), str(receipts)


def _sha_for(rig, ref):
    led = DurableAttemptLedger.load(rig[0], rig[1])
    return next(e["task_input_sha256"] for e in led.queue["queue"] if e["condition_ref"] == ref)


def _run(rig):
    proc = subprocess.run(
        [sys.executable, DOORWAY, "--queue", rig[0], "--receipt-dir", rig[1]],
        capture_output=True, text=True, cwd=ROOT,
    )
    return proc.returncode, json.loads(proc.stdout.strip())


def test_all_ready_reports_correctly(rig):
    code, out = _run(rig)
    assert code == 0, out
    assert out["ok"] is True
    assert out["queue_order"] == [REF_A, REF_B]
    assert set(out["by_state"].get("READY", [])) == {REF_A, REF_B}
    assert out["stranded_mid_handoff"] == []
    assert out["stranded_incomplete"] == []
    assert out["complete"] == []


def test_a_claimed_only_row_is_reported_as_stranded_mid_handoff(rig):
    led = DurableAttemptLedger.load(rig[0], rig[1])
    led.claim_attempt(REF_A, _sha_for(rig, REF_A))
    code, out = _run(rig)
    assert code == 0, out
    assert out["stranded_mid_handoff"] == [REF_A]
    assert out["complete"] == []


def test_a_dispatched_row_is_also_reported_as_stranded_mid_handoff(rig):
    led = DurableAttemptLedger.load(rig[0], rig[1])
    led.claim_attempt(REF_A, _sha_for(rig, REF_A))
    record_native_dispatch(led, REF_A)
    code, out = _run(rig)
    assert code == 0, out
    assert out["stranded_mid_handoff"] == [REF_A]


def test_a_fully_captured_row_is_reported_complete_not_stranded(rig):
    led = DurableAttemptLedger.load(rig[0], rig[1])
    led.claim_attempt(REF_A, _sha_for(rig, REF_A))
    record_native_dispatch(led, REF_A)
    capture_native_return(led, REF_A, "the answer", {})
    code, out = _run(rig)
    assert code == 0, out
    assert out["complete"] == [REF_A]
    assert out["stranded_mid_handoff"] == []
    assert out["stranded_incomplete"] == []


def test_a_bad_queue_path_refuses_rather_than_reporting_empty(rig):
    code, out = _run((os.path.join(rig[0] + "-does-not-exist"), rig[1]))
    assert code != 0
    assert out["ok"] is False
