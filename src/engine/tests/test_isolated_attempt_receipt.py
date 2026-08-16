"""D0.1 — durable one-shot attempt receipts (AR-1249 §5).

The control that matters is the RESTART one. An in-process ledger already refused a second
attempt; AR-1249 F-3 showed that guarantee dies with the process, and the committed real queue
proved it by carrying `"attempts": {}`. So every test below that says "fresh process" builds a
BRAND NEW ledger object over the same directory — that is the failure mode the ban must survive.

`AttemptRefused` is asserted by type, not by message, wherever the refusal itself is the claim.
"""

from __future__ import annotations

import json
import os

import pytest

from src.engine.extraction import isolated_fallback_law as law
from src.engine.extraction.isolated_attempt_receipt import (
    ATTEMPT_CLAIMED,
    AttemptRefused,
    DurableAttemptLedger,
)

REF = "entry_sequence[1].action"
OTHER = "confluences[0].description"

PINNED = {
    "transcript_sha256": "a" * 64,
    "extraction_sha256": "b" * 64,
    "video_id": "SYNTHETIC",
}


def _queue_payload():
    """A real FrozenQueue, serialized exactly as the committed artifact is."""
    record = {
        "route_version": "opus-phase1-route-v2",
        "outcomes": [
            {"condition_ref": REF, "disposition": "HELD_DUPLICATE_ROLE_AMBIGUITY",
             "gate": "span_collision", "reason": "r"},
            {"condition_ref": OTHER, "disposition": "RED_SOURCE_FIDELITY",
             "gate": "source_fidelity_guard", "reason": "r"},
            {"condition_ref": "clean[0]", "disposition": "ACCEPTED_PENDING_CERTIFICATION",
             "gate": "all_gates", "reason": "r"},
        ],
    }
    texts = {REF: "Wait for a close outside of the range.",
             OTHER: "The stop includes the wick.",
             "clean[0]": "The target is two times risk."}
    return law.freeze_isolated_queue(record, PINNED, texts).as_dict()


@pytest.fixture
def rig(tmp_path):
    qp = tmp_path / "isolated_fallback_queue_t1.json"
    qp.write_text(json.dumps(_queue_payload(), indent=2), encoding="utf-8")
    receipts = tmp_path / "receipts"
    return str(qp), str(receipts)


def _ledger(rig):
    """A FRESH ledger object every call — i.e. a simulated process restart."""
    return DurableAttemptLedger.load(rig[0], rig[1])


def _sha_for(led, ref):
    return next(e["task_input_sha256"] for e in led.queue["queue"] if e["condition_ref"] == ref)


# --------------------------------------------------------------------------- #
# THE CONTROLS AR-1249 §5 LISTS BY NAME
# --------------------------------------------------------------------------- #


def test_a_fresh_condition_claims_its_first_attempt(rig):
    """POSITIVE CONTROL. Without this the refusals below prove only that nothing ever works."""
    led = _ledger(rig)
    r = led.claim_attempt(REF, _sha_for(led, REF))
    assert r["status"] == ATTEMPT_CLAIMED
    assert r["attempt_number"] == 1
    assert r["requested_model_identity"] == "opus"
    assert "subagent" in r["invocation_path"]
    assert os.path.exists(led.attempt_path(REF))
    assert led.claimed_refs() == [REF]


def test_a_second_claim_in_the_same_process_is_refused(rig):
    led = _ledger(rig)
    led.claim_attempt(REF, _sha_for(led, REF))
    with pytest.raises(AttemptRefused):
        led.claim_attempt(REF, _sha_for(led, REF))


def test_a_second_claim_after_a_RESTART_is_refused(rig):
    """🛑 F-3's exact scenario. The in-memory ledger reset here; the filesystem does not."""
    first = _ledger(rig)
    first.claim_attempt(REF, _sha_for(first, REF))

    reborn = _ledger(rig)                      # brand-new object, fresh in-memory state
    assert reborn.claimed_refs() == [REF], "the restarted process must SEE the spent attempt"
    with pytest.raises(AttemptRefused):
        reborn.claim_attempt(REF, _sha_for(reborn, REF))


def test_the_in_memory_law_alone_would_NOT_have_survived_the_restart(rig):
    """The discriminating control for the test above: it shows the durable layer is doing the
    work, not the pre-existing law. Two freshly-frozen queues each allow a first attempt, which
    is precisely the hole AR-1249 F-3 found."""
    a = law.freeze_isolated_queue(
        {"route_version": "opus-phase1-route-v2",
         "outcomes": [{"condition_ref": REF, "disposition": "REFUSED_RELEVANCE",
                       "gate": "g", "reason": "r"}]},
        PINNED, {REF: "t"})
    law.record_attempt(a, REF)
    b = law.freeze_isolated_queue(
        {"route_version": "opus-phase1-route-v2",
         "outcomes": [{"condition_ref": REF, "disposition": "REFUSED_RELEVANCE",
                       "gate": "g", "reason": "r"}]},
        PINNED, {REF: "t"})
    law.record_attempt(b, REF)  # succeeds again — the restart hole, reproduced
    assert b.attempts[REF]["completed"] is False


def test_a_crash_shaped_receipt_with_no_output_is_still_refused(rig):
    """An attempt claimed whose outcome is unknown is the most tempting retry and the least
    defensible one. It stays spent, and it is REPORTED rather than silently re-run."""
    led = _ledger(rig)
    led.claim_attempt(REF, _sha_for(led, REF))
    # the process "crashed": receipt exists, no raw return was ever stored
    reborn = _ledger(rig)
    assert reborn.crash_shaped_refs() == [REF]
    with pytest.raises(AttemptRefused):
        reborn.claim_attempt(REF, _sha_for(reborn, REF))


def test_a_ref_outside_the_committed_queue_is_refused(rig):
    led = _ledger(rig)
    with pytest.raises(AttemptRefused, match="not in the committed queue"):
        led.claim_attempt("entry_sequence[99].action", "0" * 64)


def test_an_accepted_condition_is_not_in_the_queue_and_cannot_be_attempted(rig):
    led = _ledger(rig)
    with pytest.raises(AttemptRefused, match="not in the committed queue"):
        led.claim_attempt("clean[0]", "0" * 64)


def test_a_mismatched_task_input_hash_is_refused(rig):
    led = _ledger(rig)
    with pytest.raises(AttemptRefused, match="task input hash mismatch"):
        led.claim_attempt(REF, "f" * 64)


def test_a_pre_existing_raw_output_cannot_be_overwritten(rig):
    led = _ledger(rig)
    led.claim_attempt(REF, _sha_for(led, REF))
    led.persist_raw_return(REF, "the first and only return")
    reborn = _ledger(rig)
    with pytest.raises(AttemptRefused, match="already stored"):
        reborn.persist_raw_return(REF, "a nicer second return")


def test_a_raw_return_without_a_claimed_attempt_is_refused(rig):
    led = _ledger(rig)
    with pytest.raises(AttemptRefused, match="never claimed its budget"):
        led.persist_raw_return(REF, "an answer that skipped the ledger")


def test_the_raw_return_is_stored_verbatim_and_marked_unparsed(rig):
    led = _ledger(rig)
    led.claim_attempt(REF, _sha_for(led, REF))
    messy = '  {"quote": "we wait"}  \n\ntrailing model chatter'
    rec = led.persist_raw_return(REF, messy)
    assert rec["raw_output"] == messy
    assert rec["parsed"] is False
    on_disk = json.loads(open(led.raw_path(REF), encoding="utf-8").read())
    assert on_disk["raw_output"] == messy


# --------------------------------------------------------------------------- #
# QUEUE IDENTITY — §5.2 / §5.3
# --------------------------------------------------------------------------- #


def test_two_different_refs_do_not_share_one_receipt(rig):
    led = _ledger(rig)
    led.claim_attempt(REF, _sha_for(led, REF))
    led.claim_attempt(OTHER, _sha_for(led, OTHER))   # must NOT be refused
    assert sorted(led.claimed_refs()) == sorted([REF, OTHER])
    assert led.attempt_path(REF) != led.attempt_path(OTHER)


def test_a_queue_without_concrete_source_identities_is_refused(tmp_path):
    """§5.3 — an arbitrary non-empty dict is not identity."""
    payload = _queue_payload()
    payload["pinned_inputs"]["transcript_sha256"] = "not-a-real-sha"
    qp = tmp_path / "q.json"
    qp.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(AttemptRefused, match="no concrete transcript_sha256"):
        DurableAttemptLedger.load(str(qp), str(tmp_path / "r"))


def test_a_queue_frozen_under_a_different_law_version_is_refused(tmp_path):
    payload = _queue_payload()
    payload["law_version"] = "isolated-fallback-law-v0-ancient"
    qp = tmp_path / "q.json"
    qp.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(AttemptRefused, match="law_version"):
        DurableAttemptLedger.load(str(qp), str(tmp_path / "r"))


def test_an_edited_substitution_rule_invalidates_the_queue(tmp_path):
    """The rule is declared before outputs exist so it cannot be rewritten once answers are
    visible. If its hash no longer matches the module, refuse rather than run under a rule the
    queue never agreed to."""
    payload = _queue_payload()
    payload["substitution_rule_sha256"] = "c" * 64
    qp = tmp_path / "q.json"
    qp.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(AttemptRefused, match="substitution rule has CHANGED"):
        DurableAttemptLedger.load(str(qp), str(tmp_path / "r"))


def test_the_receipt_pins_the_queue_artifact_it_was_claimed_against(rig):
    led = _ledger(rig)
    r = led.claim_attempt(REF, _sha_for(led, REF))
    assert r["queue_artifact_sha256"] == led.queue_sha256
    assert r["law_version"] == law.FALLBACK_LAW_VERSION
    assert r["pinned_inputs"]["transcript_sha256"] == PINNED["transcript_sha256"]
    assert r["disposition_that_earned_escalation"] == "HELD_DUPLICATE_ROLE_AMBIGUITY"


def test_unclaimed_refs_shrink_as_attempts_are_spent(rig):
    led = _ledger(rig)
    assert sorted(led.unclaimed_refs()) == sorted([REF, OTHER])
    led.claim_attempt(REF, _sha_for(led, REF))
    assert _ledger(rig).unclaimed_refs() == [OTHER]


def test_the_module_never_opens_an_existing_receipt_for_writing():
    """The strongest form of 'never overwrite' is that no such code path exists (§5.9)."""
    import inspect

    from src.engine.extraction import isolated_attempt_receipt as m

    src = inspect.getsource(m)
    assert "O_EXCL" in src, "the create-only primitive must be the atomic one"
    for banned in ('"w"', "'w'", '"a"', "'a'", "os.remove", "os.unlink", "shutil.rmtree"):
        assert banned not in src, f"module contains a mutating file operation: {banned}"
