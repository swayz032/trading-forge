"""D1 — the dispatch adapter's ordering guarantee (AR-1252 §5).

The two properties §5.7 names:

    dispatch is NOT reachable if the claim fails
    raw persistence is NOT reachable without a claim

Both are asserted with a SPY on the invoker plus a positive witness that the same spy IS called
on the happy path — a "was not called" assertion is satisfied by an invoker that can never be
called, so it proves nothing on its own.

No model, no network, no subagent: `invoke` is injected.
"""

from __future__ import annotations

import json

import pytest

from src.engine.extraction import isolated_fallback_law as law
from src.engine.extraction.isolated_attempt_receipt import AttemptRefused, DurableAttemptLedger
from src.engine.extraction.isolated_dispatch import IsolatedDispatcher, preflight_real_queue

REF = "entry_sequence[1].action"
OTHER = "confluences[0].description"
PINNED = {"transcript_sha256": "a" * 64, "extraction_sha256": "b" * 64}


def _queue_payload():
    record = {
        "route_version": "opus-phase1-route-v2",
        "outcomes": [
            {"condition_ref": REF, "disposition": "REFUSED_RELEVANCE", "gate": "g", "reason": "r"},
            {"condition_ref": OTHER, "disposition": "RED_SOURCE_FIDELITY", "gate": "g",
             "reason": "r"},
            {"condition_ref": "clean[0]", "disposition": "ACCEPTED_PENDING_CERTIFICATION",
             "gate": "all_gates", "reason": "r"},
        ],
    }
    texts = {REF: "Wait for a close outside of the range.",
             OTHER: "The stop includes the wick.",
             "clean[0]": "Two times risk."}
    return law.freeze_isolated_queue(record, PINNED, texts).as_dict()


@pytest.fixture
def rig(tmp_path):
    qp = tmp_path / "queue.json"
    qp.write_text(json.dumps(_queue_payload(), indent=2), encoding="utf-8")
    return str(qp), str(tmp_path / "receipts")


class Spy:
    def __init__(self, returns="a literal quote from the source", raises=None):
        self.calls = []
        self.returns = returns
        self.raises = raises

    def __call__(self, condition_ref, condition_text, task_input_sha256):
        self.calls.append(condition_ref)
        if self.raises:
            raise self.raises
        return self.returns


def _led(rig):
    return DurableAttemptLedger.load(rig[0], rig[1])


# --------------------------------------------------------------------------- #
# 1. THE HAPPY PATH — the positive witness the negatives depend on
# --------------------------------------------------------------------------- #


def test_the_ordered_sequence_runs_and_persists_the_raw_return(rig):
    spy = Spy()
    d = IsolatedDispatcher(_led(rig), spy)
    out = d.run_one(REF)

    assert spy.calls == [REF], "the invoker must actually be reachable"
    assert (out.claimed, out.invoked, out.persisted) == (True, True, True)
    assert out.raw_output_sha256
    # a FRESH ledger sees both artifacts — the durability is real, not in-memory
    reborn = _led(rig)
    assert reborn.claimed_refs() == [REF]
    assert reborn.crash_shaped_refs() == []


def test_the_invoker_receives_only_the_frozen_contract(rig):
    """No batch answer, no prior winning quote, no expected answer can reach the subagent —
    the adapter passes exactly three frozen values."""
    seen = {}

    def invoke(**kwargs):
        seen.update(kwargs)
        return "a quote"

    IsolatedDispatcher(_led(rig), invoke).run_one(REF)
    # kwargs is exactly what the adapter passed — no batch answer, no prior quote, no hint
    assert set(seen) == {"condition_ref", "condition_text", "task_input_sha256"}
    assert seen["condition_text"] == "Wait for a close outside of the range."


# --------------------------------------------------------------------------- #
# 2. §5.7 — DISPATCH IS UNREACHABLE IF THE CLAIM FAILS
# --------------------------------------------------------------------------- #


def test_a_second_run_never_reaches_the_model(rig):
    spy = Spy()
    IsolatedDispatcher(_led(rig), spy).run_one(REF)
    assert spy.calls == [REF]

    spy2 = Spy()
    with pytest.raises(AttemptRefused):
        IsolatedDispatcher(_led(rig), spy2).run_one(REF)
    assert spy2.calls == [], "the model was invoked despite a refused claim"


def test_an_out_of_queue_ref_never_reaches_the_model(rig):
    spy = Spy()
    with pytest.raises(AttemptRefused):
        IsolatedDispatcher(_led(rig), spy).run_one("entry_sequence[99].action")
    assert spy.calls == []


def test_an_accepted_condition_never_reaches_the_model(rig):
    spy = Spy()
    with pytest.raises(AttemptRefused):
        IsolatedDispatcher(_led(rig), spy).run_one("clean[0]")
    assert spy.calls == []


# --------------------------------------------------------------------------- #
# 3. A SPENT ATTEMPT STAYS SPENT WHEN THE CALL GOES WRONG
# --------------------------------------------------------------------------- #


def test_an_invoker_that_raises_still_spends_the_attempt(rig):
    """A call that may have been delivered must not be repeatable."""
    out = IsolatedDispatcher(_led(rig), Spy(raises=RuntimeError("transport died"))).run_one(REF)
    assert (out.claimed, out.invoked, out.persisted) == (True, True, False)
    assert "SPENT" in out.error and "transport died" in out.error

    reborn = _led(rig)
    assert reborn.crash_shaped_refs() == [REF]
    with pytest.raises(AttemptRefused):
        IsolatedDispatcher(reborn, Spy()).run_one(REF)


def test_an_empty_return_is_not_evidence_and_is_not_a_retry(rig):
    out = IsolatedDispatcher(_led(rig), Spy(returns="   ")).run_one(REF)
    assert (out.claimed, out.persisted) == (True, False)
    assert "not a reason to retry" in out.error
    with pytest.raises(AttemptRefused):
        IsolatedDispatcher(_led(rig), Spy()).run_one(REF)


# --------------------------------------------------------------------------- #
# 4. §5.7 — RAW PERSISTENCE IS UNREACHABLE WITHOUT A CLAIM
# --------------------------------------------------------------------------- #


def test_raw_persistence_requires_a_claim(rig):
    led = _led(rig)
    with pytest.raises(AttemptRefused, match="never claimed its budget"):
        led.persist_raw_return(REF, "an answer that skipped the ledger")
    # positive witness: the same call succeeds once a claim exists
    led.claim_attempt(REF, next(e["task_input_sha256"] for e in led.queue["queue"]
                                if e["condition_ref"] == REF))
    assert led.persist_raw_return(REF, "now legitimate")["parsed"] is False


def test_each_queued_ref_keeps_its_own_budget(rig):
    spy = Spy()
    d = IsolatedDispatcher(_led(rig), spy)
    d.run_one(REF)
    d.run_one(OTHER)                       # must NOT be refused
    assert spy.calls == [REF, OTHER]
    assert sorted(_led(rig).claimed_refs()) == sorted([REF, OTHER])


# --------------------------------------------------------------------------- #
# 5. PREFLIGHT — READ ONLY, AGAINST THE REAL COMMITTED QUEUE
# --------------------------------------------------------------------------- #


def test_preflight_claims_nothing(rig):
    r = preflight_real_queue(*rig)
    assert r["attempts_claimed_by_this_preflight"] == 0
    assert r["claimed_refs"] == []
    assert _led(rig).claimed_refs() == [], "preflight must not spend a budget"


def test_preflight_reports_not_ready_when_an_attempt_is_already_spent(rig):
    IsolatedDispatcher(_led(rig), Spy()).run_one(REF)
    r = preflight_real_queue(*rig)
    assert r["ready_for_dispatch"] is False
    assert r["claimed_refs"] == [REF]


def test_preflight_on_the_REAL_committed_queue_is_ready(tmp_path):
    """The real artifact, the real published path — and the real receipt directory the run will
    use, which must still be empty. AR-1252 §3 forbids putting the load-bearing receipt in a
    temp directory for the real run, so this asserts the production location is clean rather
    than substituting a scratch one."""
    queue = ("docs/replay-results/svkm-extraction-certified/grade/opus-v2/"
             "isolated_fallback_queue_t1.json")
    receipts = ("docs/replay-results/svkm-extraction-certified/grade/opus-v2/"
                "isolated-receipts-t1")
    r = preflight_real_queue(queue, receipts)

    assert r["queued_count"] == 8, r["queued_refs"]
    assert r["excluded_count"] == 4
    assert r["claimed_refs"] == []
    assert r["crash_shaped_refs"] == []
    assert len(r["unclaimed_refs"]) == 8
    assert r["ready_for_dispatch"] is True
    # pinned to the campaign's own source identities, not merely to something 64-hex
    assert r["pinned_inputs"]["transcript_sha256"] == (
        "df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc")
    assert r["pinned_inputs"]["extraction_sha256"] == (
        "c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823")
    assert r["law_version"] == law.FALLBACK_LAW_VERSION
