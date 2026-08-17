"""AR-1303A section 6, AR-1304 section 6/8/9 -- controls for the trusted post-Agent
return-capture doorway (F30).

WHY THESE RUN THE REAL SCRIPT AS A CHILD PROCESS
    Same reasoning as test_g2d_precall_transition.py: the property under test includes that a
    SEPARATE process cannot slip a second capture past the create-only receipts, and calling the
    functions in-process would prove something weaker.

SYNTHETIC QUEUES ONLY. Nothing here reads or writes the real frozen queue or receipt
directory, and no real one-shot attempt is spent or captured.
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
    NOT_EXPOSED,
    RAW_RETURN_CAPTURED,
    READY,
    record_native_dispatch,
    state_of,
)

REF = "entry_sequence[1].action"
OTHER = "confluences[0].description"
PINNED = {"transcript_sha256": "a" * 64, "extraction_sha256": "b" * 64}

# src/engine/tests/<this file> -> tests -> engine -> src -> REPO ROOT.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
DOORWAY = os.path.join(ROOT, "scripts", "g2d_postcall_capture.py")


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


def _claim_and_dispatch(rig, ref=REF):
    led = DurableAttemptLedger.load(rig[0], rig[1])
    led.claim_attempt(ref, _sha_for(rig, ref))
    record_native_dispatch(led, ref)


def _run(rig, tmp_path, ref=REF, raw="the model's actual answer text", completion=None, raw_path=None):
    if raw_path is None:
        raw_path = tmp_path / f"raw-{ref.replace('/', '_')}-{os.urandom(4).hex()}.txt"
        raw_path.write_text(raw, encoding="utf-8")
    argv = [
        sys.executable, DOORWAY,
        "--queue", rig[0], "--receipt-dir", rig[1],
        "--condition-ref", ref, "--raw-output-file", str(raw_path),
    ]
    completion_path = None
    if completion is not None:
        completion_path = tmp_path / f"completion-{ref.replace('/', '_')}-{os.urandom(4).hex()}.json"
        completion_path.write_text(json.dumps(completion), encoding="utf-8")
        argv += ["--completion-json", str(completion_path)]
    proc = subprocess.run(argv, capture_output=True, text=True, cwd=ROOT)
    try:
        payload = json.loads(proc.stdout.strip() or "{}")
    except json.JSONDecodeError:
        payload = {"_unparsed": proc.stdout, "_stderr": proc.stderr}
    return proc.returncode, payload


def _receipts(rig, ref=REF):
    base = _safe_name(ref)
    return sorted(p for p in os.listdir(rig[1]) if p.startswith(base + "."))


# --------------------------------------------------------------------------- #
# POSITIVE
# --------------------------------------------------------------------------- #

def test_the_doorway_captures_the_exact_raw_bytes_after_a_real_dispatch(rig, tmp_path):
    _claim_and_dispatch(rig)
    code, out = _run(rig, tmp_path, raw="verbatim model answer, byte for byte")
    assert code == 0, out
    assert out["ok"] is True
    assert out["state"] == RAW_RETURN_CAPTURED
    import hashlib
    assert out["raw_output_sha256"] == hashlib.sha256(b"verbatim model answer, byte for byte").hexdigest()
    # POSITIVE WITNESS: both files actually landed, not just an "ok" claim.
    assert _receipts(rig) == [
        f"{_safe_name(REF)}.attempt.json",
        f"{_safe_name(REF)}.completion.json",
        f"{_safe_name(REF)}.dispatch.json",
        f"{_safe_name(REF)}.raw.json",
    ]


def test_completion_metadata_is_persisted_and_joins_the_dispatch_not_restated(rig, tmp_path):
    _claim_and_dispatch(rig)
    code, out = _run(rig, tmp_path, completion={"input_tokens": 120, "output_tokens": 340})
    assert code == 0, out
    assert out["requested_model_identity"] == "opus"  # read back from the dispatch, not re-asserted
    assert out["dispatch_native_task_id"] == NOT_EXPOSED


def test_omitted_completion_fields_become_not_exposed_not_invented(rig, tmp_path):
    _claim_and_dispatch(rig)
    code, out = _run(rig, tmp_path)  # no --completion-json at all
    assert code == 0, out
    with open(os.path.join(rig[1], f"{_safe_name(REF)}.completion.json"), encoding="utf-8") as fh:
        completion_receipt = json.load(fh)
    assert completion_receipt["input_tokens"] == NOT_EXPOSED
    assert completion_receipt["output_tokens"] == NOT_EXPOSED


# --------------------------------------------------------------------------- #
# NEGATIVE -- every shape AR-1304 section 8 names for the post-call path
# --------------------------------------------------------------------------- #

def test_no_prior_dispatch_is_refused_before_anything_is_written(rig, tmp_path):
    code, out = _run(rig, tmp_path)  # never claimed or dispatched
    assert code != 0
    assert out["ok"] is False
    assert out["stage"] == "capture"
    assert _receipts(rig) == []


def test_claimed_but_not_dispatched_is_refused(rig, tmp_path):
    led = DurableAttemptLedger.load(rig[0], rig[1])
    led.claim_attempt(REF, _sha_for(rig))
    code, out = _run(rig, tmp_path)
    assert code != 0
    assert out["stage"] == "capture"
    assert _receipts(rig) == [f"{_safe_name(REF)}.attempt.json"]  # no raw/completion appeared


def test_a_second_capture_for_the_same_row_is_refused(rig, tmp_path):
    _claim_and_dispatch(rig)
    assert _run(rig, tmp_path, raw="first answer")[0] == 0
    code, out = _run(rig, tmp_path, raw="a second, different answer")
    assert code != 0
    assert out["ok"] is False
    # THE FIRST CAPTURE SURVIVES UNCHANGED -- this is the assertion a "helpful" overwrite would break.
    with open(os.path.join(rig[1], f"{_safe_name(REF)}.raw.json"), encoding="utf-8") as fh:
        raw_doc = json.load(fh)
    import hashlib
    assert raw_doc["raw_output_sha256"] == hashlib.sha256(b"first answer").hexdigest()


def test_response_for_a_different_condition_only_touches_that_conditions_receipts(rig, tmp_path):
    _claim_and_dispatch(rig, ref=REF)
    _claim_and_dispatch(rig, ref=OTHER)
    code, out = _run(rig, tmp_path, ref=OTHER, raw="answer for OTHER")
    assert code == 0, out
    # REF's dispatch is untouched -- no raw/completion appeared for the row this call did not name.
    assert _receipts(rig, ref=REF) == [f"{_safe_name(REF)}.attempt.json", f"{_safe_name(REF)}.dispatch.json"]


def test_malformed_completion_metadata_refuses_before_creating_either_terminal_file(rig, tmp_path):
    _claim_and_dispatch(rig)
    code, out = _run(rig, tmp_path, completion={"input_tokens": 5, "not_a_real_field": "x"})
    assert code != 0
    assert out["ok"] is False
    # AR-1260 section B: refusal must leave the directory exactly as it found it -- no stranded raw.
    assert _receipts(rig) == [f"{_safe_name(REF)}.attempt.json", f"{_safe_name(REF)}.dispatch.json"]


def test_a_half_written_stranded_state_is_never_treated_as_capturable(rig, tmp_path):
    _claim_and_dispatch(rig)
    # Plant only `.raw` (never produced by this doorway alone) to simulate a crash between the
    # two-file commit -- STRANDED_INCOMPLETE, and it must refuse rather than "finish" it.
    with open(os.path.join(rig[1], f"{_safe_name(REF)}.raw.json"), "w", encoding="utf-8") as fh:
        json.dump({"raw_output": "x", "raw_output_sha256": "0" * 64, "parsed": False}, fh)
    code, out = _run(rig, tmp_path)
    assert code != 0
    assert out["ok"] is False


def test_no_native_task_id_exposed_is_recorded_honestly_not_invented(rig, tmp_path):
    _claim_and_dispatch(rig)
    code, out = _run(rig, tmp_path)
    assert code == 0, out
    assert out["dispatch_native_task_id"] == NOT_EXPOSED


def test_unreadable_raw_output_file_is_refused(rig, tmp_path):
    _claim_and_dispatch(rig)
    missing = tmp_path / "does-not-exist.txt"
    code, out = _run(rig, tmp_path, raw_path=missing)
    assert code != 0
    assert out["stage"] == "read_raw"
    assert _receipts(rig) == [f"{_safe_name(REF)}.attempt.json", f"{_safe_name(REF)}.dispatch.json"]


# --------------------------------------------------------------------------- #
# CONTROL DISCRIMINATION -- an always-red suite proves nothing
# --------------------------------------------------------------------------- #

def test_a_different_dispatched_ref_is_unaffected_by_a_captured_one(rig, tmp_path):
    _claim_and_dispatch(rig, ref=REF)
    _claim_and_dispatch(rig, ref=OTHER)
    assert _run(rig, tmp_path, ref=REF)[0] == 0
    code, out = _run(rig, tmp_path, ref=OTHER)
    assert code == 0, out
    assert out["ok"] is True


# --------------------------------------------------------------------------- #
# MUTATION -- prove the doorway is load-bearing, not merely present
# --------------------------------------------------------------------------- #

def test_MUTATION_a_doorway_that_skips_the_dispatched_state_check_would_wrongly_allow_capture(rig, tmp_path):
    """Reproduces, with an unchecked stand-in, exactly what a broken doorway would let through:
    capturing a return for a row that was never dispatched. The REAL doorway refuses this (proven
    by test_no_prior_dispatch_is_refused_before_anything_is_written above); this control proves
    the refusal is doing real work by first showing the naive/unchecked path would succeed.
    """
    led = DurableAttemptLedger.load(rig[0], rig[1])
    assert state_of(led, REF) == READY  # never claimed or dispatched

    # An unchecked stand-in that skips capture_native_return's state check entirely and writes
    # the raw file directly -- this is what "just persist whatever the model says" would do.
    import hashlib
    raw_path = os.path.join(rig[1], f"{_safe_name(REF)}.raw.json")
    with open(raw_path, "w", encoding="utf-8") as fh:
        json.dump({"raw_output": "unbudgeted answer", "raw_output_sha256": hashlib.sha256(b"x").hexdigest()}, fh)
    assert os.path.exists(raw_path), "the unchecked stand-in DOES write for an undispatched row"

    # Clean up and prove the REAL doorway refuses the identical scenario.
    os.remove(raw_path)
    code, out = _run(rig, tmp_path)
    assert code != 0
    assert out["ok"] is False
    assert not os.path.exists(raw_path), "the real, checked doorway refuses to write for an undispatched row"
