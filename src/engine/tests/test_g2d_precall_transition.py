"""AR-1267 §5 / §9D + §9F — controls for the trusted `claim -> dispatch` transition doorway.

WHY THESE RUN THE REAL SCRIPT AS A CHILD PROCESS
    The property under test is that a SEPARATE process cannot slip a second call past the
    create-only receipts. Calling the functions in-process would prove something weaker and would
    also let a shared in-memory ledger paper over the very race the doorway is supposed to
    arbitrate. So every control below shells out exactly as the pinned guard does.

SYNTHETIC QUEUES ONLY
    AR-1267 §8: "All repair tests use synthetic receipt directories only." Nothing here reads or
    writes the real frozen queue, and no real one-shot attempt is spent.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest

from src.engine.extraction import isolated_fallback_law as law
from src.engine.extraction.isolated_attempt_receipt import (
    ATTEMPT_CLAIMED,
    DurableAttemptLedger,
    _safe_name,
)
from src.engine.extraction.isolated_bridge import NATIVE_TASK_DISPATCHED, NOT_EXPOSED

REF = "entry_sequence[1].action"
OTHER = "confluences[0].description"
PINNED = {"transcript_sha256": "a" * 64, "extraction_sha256": "b" * 64}

# src/engine/tests/<this file> -> tests -> engine -> src -> REPO ROOT. Four levels, not three:
# the first version stopped at `src/`, every child process died with "can't open file", and ten
# controls failed identically with exit 2 and empty stdout. A uniform failure across every case
# accuses the harness, not the subject.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DOORWAY = os.path.join(ROOT, "scripts", "g2d_precall_transition.py")


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


def _run(rig, ref=REF, task_sha=None):
    proc = subprocess.run(
        [sys.executable, DOORWAY,
         "--queue", rig[0], "--receipt-dir", rig[1],
         "--condition-ref", ref,
         "--task-input-sha256", task_sha if task_sha is not None else _sha_for(rig, ref)],
        capture_output=True, text=True, cwd=ROOT,
    )
    try:
        payload = json.loads(proc.stdout.strip() or "{}")
    except json.JSONDecodeError:
        payload = {"_unparsed": proc.stdout, "_stderr": proc.stderr}
    return proc.returncode, payload


def _receipts(rig, ref=REF):
    base = _safe_name(ref)
    return sorted(
        p for p in os.listdir(rig[1]) if p.startswith(base + ".")
    )


# --------------------------------------------------------------------------- #
# POSITIVE — the whole point: BOTH receipts exist before the caller is told yes
# --------------------------------------------------------------------------- #

def test_the_doorway_writes_attempt_then_dispatch_and_only_then_reports_ok(rig):
    code, out = _run(rig)
    assert code == 0, out
    assert out["ok"] is True
    assert out["attempt_status"] == ATTEMPT_CLAIMED
    assert out["dispatch_state"] == NATIVE_TASK_DISPATCHED
    # POSITIVE WITNESS that the path executed — an "ok" from a function that wrote nothing
    # would satisfy every assertion above and none of the ones that matter.
    assert _receipts(rig) == [f"{_safe_name(REF)}.attempt.json", f"{_safe_name(REF)}.dispatch.json"]


def test_the_dispatch_receipt_records_the_opus_route_and_does_not_invent_a_task_id(rig):
    code, out = _run(rig)
    assert code == 0
    assert out["requested_model_identity"] == "opus"
    assert out["invocation_path"] == "fresh Claude Code subscription subagent"
    # The runtime exposes no native task id BEFORE dispatch, so the honest value is the
    # NOT_EXPOSED sentinel. A fabricated id would make the receipt look more complete than the
    # evidence is.
    assert out["native_task_id"] == NOT_EXPOSED


# --------------------------------------------------------------------------- #
# NEGATIVE — every shape AR-1267 §9F names
# --------------------------------------------------------------------------- #

def test_a_pre_existing_attempt_is_denied_and_is_not_resumed_as_a_new_invocation(rig):
    led = DurableAttemptLedger.load(rig[0], rig[1])
    led.claim_attempt(REF, _sha_for(rig))
    code, out = _run(rig)
    assert code != 0
    assert out["ok"] is False
    assert out["stage"] == "claim"
    # and it did NOT go on to write a dispatch beside the foreign claim
    assert _receipts(rig) == [f"{_safe_name(REF)}.attempt.json"]


def test_a_second_identical_invocation_is_denied(rig):
    assert _run(rig)[0] == 0
    code, out = _run(rig)
    assert code != 0
    assert out["ok"] is False


def test_a_task_hash_the_queue_does_not_pin_is_refused_before_anything_is_written(rig):
    code, out = _run(rig, task_sha="f" * 64)
    assert code != 0
    assert out["stage"] == "claim"
    assert _receipts(rig) == []


def test_a_ref_outside_the_frozen_queue_is_refused(rig):
    code, out = _run(rig, ref="entry_sequence[9].not_a_member", task_sha="f" * 64)
    assert code != 0
    assert out["ok"] is False


def test_a_pre_existing_dispatch_is_denied(rig):
    assert _run(rig)[0] == 0
    os.remove(os.path.join(rig[1], f"{_safe_name(REF)}.attempt.json"))
    # dispatch present, attempt gone: a crash shape. It must still refuse — and specifically it
    # must not "recover" by re-claiming, which would put a fresh attempt under an old dispatch.
    code, out = _run(rig)
    assert code != 0
    assert out["ok"] is False


def test_a_failing_dispatch_leaves_the_attempt_spent_and_does_not_clean_it_up(rig, monkeypatch):
    """AR-1267 §5: claim succeeds, dispatch fails => DENY, attempt remains spent, no cleanup.

    The dispatch is made to fail by planting the dispatch receipt first, so `record_native_dispatch`
    refuses the create-only write while the claim below it still succeeds.
    """
    base = _safe_name(REF)
    # A pre-planted dispatch with NO attempt: the claim will succeed, the dispatch will not.
    with open(os.path.join(rig[1], f"{base}.dispatch.json"), "w", encoding="utf-8") as fh:
        fh.write("{}")
    code, out = _run(rig)
    assert code != 0
    assert out["stage"] == "dispatch"
    assert "SPENT" in out["error"]
    # THE ATTEMPT SURVIVES. This is the assertion that would fail if anyone ever "helpfully"
    # added rollback: a call that may have been delivered must not become repeatable.
    assert f"{base}.attempt.json" in _receipts(rig)


def test_two_concurrent_invocations_produce_at_most_one_ok(rig):
    """The create-only receipt is the race arbiter — no lock, no lease, no coordination."""
    procs = [
        subprocess.Popen(
            [sys.executable, DOORWAY,
             "--queue", rig[0], "--receipt-dir", rig[1],
             "--condition-ref", REF, "--task-input-sha256", _sha_for(rig)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=ROOT,
        )
        for _ in range(2)
    ]
    results = [(p.wait(), p.stdout.read()) for p in procs]
    oks = [r for r in results if r[0] == 0]
    assert len(oks) == 1, results
    assert _receipts(rig) == [f"{_safe_name(REF)}.attempt.json", f"{_safe_name(REF)}.dispatch.json"]


# --------------------------------------------------------------------------- #
# CONTROL DISCRIMINATION — an always-red suite proves nothing
# --------------------------------------------------------------------------- #

def test_a_different_queued_ref_is_unaffected_by_a_spent_one(rig):
    assert _run(rig, ref=REF)[0] == 0
    code, out = _run(rig, ref=OTHER)
    assert code == 0, out
    assert out["ok"] is True
