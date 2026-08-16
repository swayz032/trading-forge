"""E/F/G — the final-evidence consumer (AR-1252 §5).

Every control §5 lists, plus the ordering property that no single-condition test can catch:
the complete final set must exist BEFORE collision adjudication, because collision is a
set-level fact and adjudicating the batch set then swapping members would test a set that
never existed.

Synthetic source. No model, no receipts on disk except where a test builds them.
"""

from __future__ import annotations

import json

import pytest

from src.engine.extraction import isolated_fallback_law as law
from src.engine.extraction import opus_phase1_route as rt
from src.engine.extraction.g2d_finalizer import (
    FinalizationRefused,
    collect_isolated_results,
    finalize,
)

TRANSCRIPT = (
    "welcome back everyone. at nine thirty we mark the high and the low of the first five "
    "minute candle to build our range for the day. after that we wait for a one minute candle "
    "to close outside of the five minute range before we do anything at all. "
    "the stop goes at the bottom of the fair value candle and you include the wick. "
    "our target is a fixed two times risk on every single trade. "
    "i do want to reiterate that this model is not perfect and you will lose on this model."
)

# Refs use the REAL top-level role shape. `span_collision.role_of` takes the leading identifier,
# and only CROSS-ROLE span reuse is HELD — measured, not assumed. Fixture refs that all shared one
# role would make the collision control silently unable to fire.
R_RANGE = "entry_sequence[0].action"     # role: entry_sequence
R_BREAK = "entry_sequence[1].action"     # role: entry_sequence
R_STOP = "stop.rationale"                # role: stop
R_TARGET = "targets[0].rationale"        # role: targets

C_RANGE = {"condition_ref": R_RANGE,
           "condition_text": "Mark the high and the low of the first five minute candle to build the range."}
C_BREAK = {"condition_ref": R_BREAK,
           "condition_text": "Wait for a one minute candle to close outside of the five minute range."}
C_STOP = {"condition_ref": R_STOP,
          "condition_text": "The stop goes at the bottom of the fair value candle including the wick."}
C_TARGET = {"condition_ref": R_TARGET,
            "condition_text": "The target is a fixed two times risk on every trade."}
CONDITIONS = [C_RANGE, C_BREAK, C_STOP, C_TARGET]

Q_RANGE = "we mark the high and the low of the first five minute candle to build our range"
Q_BREAK = "we wait for a one minute candle to close outside of the five minute range"
Q_STOP = "the stop goes at the bottom of the fair value candle and you include the wick"
Q_TARGET = "our target is a fixed two times risk on every single trade"
Q_DISCLAIMER = "this model is not perfect and you will lose on this model"

PINNED = {"transcript_sha256": "a" * 64, "extraction_sha256": "b" * 64}


def _batch(**over):
    """Baseline batch answers. c.range is given the off-topic disclaimer so relevance refuses it
    and it becomes the escalated condition."""
    d = {R_RANGE: Q_DISCLAIMER, R_BREAK: Q_BREAK, R_STOP: Q_STOP, R_TARGET: Q_TARGET}
    d.update(over)
    return [{"condition_ref": k, "raw_output": v} for k, v in d.items()]


def _route(answers=None):
    return rt.run_route(TRANSCRIPT, CONDITIONS, answers or _batch())


def _queue(answers=None):
    record = _route(answers)
    texts = {c["condition_ref"]: c["condition_text"] for c in CONDITIONS}
    return law.freeze_isolated_queue(record, PINNED, texts).as_dict()


def test_the_baseline_has_exactly_one_escalated_condition():
    """Fixture control. If this drifts, every test below is measuring something else."""
    q = _queue()
    assert [e["condition_ref"] for e in q["queue"]] == [R_RANGE]
    assert len(q["excluded"]) == 3


# --------------------------------------------------------------------------- #
# 1. THE HAPPY PATH — a better isolated answer repairs the condition
# --------------------------------------------------------------------------- #


def test_a_literal_on_topic_isolated_return_replaces_the_batch_candidate():
    q = _queue()
    out = finalize(TRANSCRIPT, CONDITIONS, _batch(), q, {R_RANGE: Q_RANGE})

    assert out["evidence_provenance"][R_RANGE] == "isolated"
    assert out["provenance_counts"] == {"isolated": 1, "batch": 3}
    row = {o["condition_ref"]: o for o in out["outcomes"]}[R_RANGE]
    assert row["disposition"] == rt.ACCEPTED, row["reason"]
    assert row["quote"] == Q_RANGE
    assert out["grade"] == "GREEN_PENDING_CERTIFICATION"


def test_even_a_full_green_is_explicitly_not_a_certification():
    """§5 K."""
    out = finalize(TRANSCRIPT, CONDITIONS, _batch(), _queue(), {R_RANGE: Q_RANGE})
    assert out["grade"] == "GREEN_PENDING_CERTIFICATION"
    assert "NOT CERTIFIED" in out["certification"]
    assert "wrong architecture" in out["certification"]
    assert out["artifact"] == "g2d-final-route-v1"
    assert "never rewritten into green" in out["historical_artifact_policy"]


# --------------------------------------------------------------------------- #
# 2. §5 B/C — A WORSE ISOLATED ANSWER DOES NOT RESTORE THE BATCH CANDIDATE
# --------------------------------------------------------------------------- #


def test_a_nonliteral_isolated_return_leaves_the_condition_RED_and_does_not_restore_the_batch():
    q = _queue()
    invented = "we mark the opening range using a proprietary confirmation filter"
    assert invented not in TRANSCRIPT
    out = finalize(TRANSCRIPT, CONDITIONS, _batch(), q, {R_RANGE: invented})

    row = {o["condition_ref"]: o for o in out["outcomes"]}[R_RANGE]
    assert row["disposition"] == rt.REFUSED_NOT_LITERAL
    assert row["quote"] is None
    assert out["grade"] == "RED"
    # the batch answer is ABSENT, not deprioritised
    assert Q_DISCLAIMER not in json.dumps(row)
    assert out["evidence_provenance"][R_RANGE] == "isolated"


def test_a_worse_but_literal_isolated_return_is_still_the_only_candidate():
    """A literal quote about the wrong topic REDs at relevance. The batch answer — also wrong —
    is not consulted, because there is no comparison step to consult it with.

    The quote must be a span NO other condition holds, or the cross-role collision gate fires
    first and this stops being a test about relevance."""
    q = _queue()
    off_topic = "i do want to reiterate that this model is not perfect"
    assert off_topic in TRANSCRIPT
    out = finalize(TRANSCRIPT, CONDITIONS, _batch(), q, {R_RANGE: off_topic})
    row = {o["condition_ref"]: o for o in out["outcomes"]}[R_RANGE]
    assert row["disposition"] == rt.REFUSED_RELEVANCE, row["reason"]
    assert row["quote"] == off_topic
    assert out["grade"] == "RED"


def test_the_finalizer_exposes_no_comparison_or_ranking_api():
    import inspect

    from src.engine.extraction import g2d_finalizer as m

    src = inspect.getsource(m).lower()
    for banned in ("best_of", "compare_answers", "pick_better", "score_candidates", "rank("):
        assert banned not in src, banned
    assert "substitution_policy" in src


# --------------------------------------------------------------------------- #
# 3. §5 A AND THE MEMBERSHIP CONTROLS
# --------------------------------------------------------------------------- #


def test_a_missing_isolated_result_refuses_finalization():
    with pytest.raises(FinalizationRefused, match="INCOMPLETE FINAL SET"):
        finalize(TRANSCRIPT, CONDITIONS, _batch(), _queue(), {})


def test_an_unfrozen_isolated_ref_refuses_finalization():
    with pytest.raises(FinalizationRefused, match="UNFROZEN ISOLATED RESULT"):
        finalize(TRANSCRIPT, CONDITIONS, _batch(), _queue(),
                 {R_RANGE: Q_RANGE, R_TARGET: Q_TARGET})


def test_an_isolated_override_for_an_ACCEPTED_condition_is_named_as_such():
    """The most dangerous form of the previous test: churning a condition that already passed."""
    with pytest.raises(FinalizationRefused, match="must never be re-queried"):
        finalize(TRANSCRIPT, CONDITIONS, _batch(), _queue(),
                 {R_RANGE: Q_RANGE, R_STOP: Q_STOP})


def test_a_queue_from_a_different_route_version_refuses():
    q = _queue()
    q["input_route_version"] = "opus-phase1-route-v0-ancient"
    with pytest.raises(FinalizationRefused, match="not be comparable"):
        finalize(TRANSCRIPT, CONDITIONS, _batch(), q, {R_RANGE: Q_RANGE})


# --------------------------------------------------------------------------- #
# 4. §5 D/E — THE COMPLETE SET EXISTS BEFORE COLLISION ADJUDICATION
# --------------------------------------------------------------------------- #


def test_collision_is_adjudicated_over_the_SUBSTITUTED_set_not_the_batch_set():
    """🛑 THE ORDERING PROOF, and no single-condition test can catch it.

    The isolated return for the escalated `entry_sequence` condition is made identical to the
    `stop` condition's quote — a CROSS-ROLE reuse, which is the only kind span_collision HOLDs
    (measured, not assumed). That collision exists ONLY in the final set: the batch set gave the
    escalated condition the unique disclaimer span. If collision ran before substitution it
    would see nothing, and both rows would sail through."""
    q = _queue()
    out = finalize(TRANSCRIPT, CONDITIONS, _batch(), q, {R_RANGE: Q_STOP})

    rows = {o["condition_ref"]: o for o in out["outcomes"]}
    assert rows[R_RANGE]["disposition"].startswith("HELD_"), rows[R_RANGE]
    assert rows[R_STOP]["disposition"].startswith("HELD_"), rows[R_STOP]
    assert R_STOP in rows[R_RANGE]["collision_partners"]
    assert out["grade"] == "RED"
    assert out["collisions"], "the final-set collision produced no group"


def test_the_same_collision_is_absent_from_the_pre_substitution_route():
    """The discriminating half of the test above: the batch set genuinely has no such collision,
    so the HOLD above is caused by substitution and not by a pre-existing condition."""
    baseline = _route()
    rows = {o["condition_ref"]: o for o in baseline["outcomes"]}
    assert not rows[R_STOP]["disposition"].startswith("HELD_"), rows[R_STOP]
    assert not rows[R_RANGE]["disposition"].startswith("HELD_"), rows[R_RANGE]
    assert not baseline["collisions"]


# --------------------------------------------------------------------------- #
# 5. §5 F/G/H — RELEVANCE CANNOT BE RESCUED, FIDELITY STILL BITES
# --------------------------------------------------------------------------- #


def test_primary_relevance_cannot_be_rescued_by_an_antecedent_composition():
    """AR-1247 §7 is controlling: composition runs AFTER relevance and only on approvals, so an
    off-topic primary quote cannot be saved by attaching earlier context to it."""
    q = _queue()
    spec = {
        "condition_ref": R_RANGE,
        "qualifier": "five minute",
        "qualifier_synonyms": ("five minute",),
        "entity_terms": ("range",),
        "definitional_markers": ("mark", "build"),
        "antecedent_span": [TRANSCRIPT.index("we mark the high"),
                            TRANSCRIPT.index("we mark the high") + 70],
        "authority": "test fixture",
    }
    out = finalize(TRANSCRIPT, CONDITIONS, _batch(), q, {R_RANGE: Q_DISCLAIMER},
                   composition_specs=[spec])
    row = {o["condition_ref"]: o for o in out["outcomes"]}[R_RANGE]
    assert row["disposition"] == rt.REFUSED_RELEVANCE
    assert row["composition"]["attempted"] is False
    assert "NOT_REACHED" in row["composition"]["reason"]
    assert row["relevance"]["evaluated_on"] == "primary_span_only"


def test_a_fidelity_defect_survives_a_literal_and_relevant_quote():
    """§5 H control. The condition claims a number its own literal, on-topic evidence never
    states, so fidelity must still red it."""
    inflated = {"condition_ref": R_RANGE,
                "condition_text": "Mark the high and the low of the first fifteen minute candle "
                                  "to build the range."}
    conditions = [inflated, C_BREAK, C_STOP, C_TARGET]
    record = rt.run_route(TRANSCRIPT, conditions, _batch())
    texts = {c["condition_ref"]: c["condition_text"] for c in conditions}
    q = law.freeze_isolated_queue(record, PINNED, texts).as_dict()

    out = finalize(TRANSCRIPT, conditions, _batch(), q, {R_RANGE: Q_RANGE})
    row = {o["condition_ref"]: o for o in out["outcomes"]}[R_RANGE]
    assert row["disposition"] == rt.RED_FIDELITY, row["reason"]
    assert any(f["kind"] == "UNSUPPORTED_QUANTITY" for f in row["fidelity_findings"])
    assert out["grade"] == "RED"


# --------------------------------------------------------------------------- #
# 6. §5 I — THE RAW STORE IS EVIDENCE, AND DETERMINISM
# --------------------------------------------------------------------------- #


# --------------------------------------------------------------------------- #
# D1.1 (AR-1254 F-1) — A RAW FILE IS ADMISSIBLE ONLY AS HALF OF A JOINED PAIR
# --------------------------------------------------------------------------- #


def _receipts(tmp_path, claim=True, raw=Q_RANGE):
    """Build a real queue artifact + real receipt directory via the real ledger."""
    from src.engine.extraction.isolated_attempt_receipt import DurableAttemptLedger

    q = _queue()
    qp = tmp_path / "queue.json"
    qp.write_text(json.dumps(q, indent=2), encoding="utf-8")
    rd = tmp_path / "receipts"
    led = DurableAttemptLedger.load(str(qp), str(rd))
    if claim:
        led.claim_attempt(R_RANGE, q["queue"][0]["task_input_sha256"])
        if raw is not None:
            led.persist_raw_return(R_RANGE, raw)
    return q, str(qp), str(rd), led


def _tamper(rd, suffix, **fields):
    import pathlib

    from src.engine.extraction.isolated_attempt_receipt import _safe_name

    p = pathlib.Path(rd) / f"{_safe_name(R_RANGE)}.{suffix}.json"
    rec = json.loads(p.read_text(encoding="utf-8"))
    rec.update(fields)
    p.write_text(json.dumps(rec, indent=2), encoding="utf-8")
    return p


def test_POSITIVE_CONTROL_a_correctly_paired_attempt_and_raw_is_accepted(tmp_path):
    """Without this the refusals below prove only that nothing is ever accepted."""
    _q, qp, rd, _ = _receipts(tmp_path)
    assert collect_isolated_results(qp, rd) == {R_RANGE: Q_RANGE}


def test_an_ORPHAN_raw_file_with_no_attempt_receipt_is_refused(tmp_path):
    """🛑 THE BYPASS AR-1254 F-1 FOUND. The old collector accepted this: the filename looked
    right and the hash recomputed correctly, and nothing required the attempt receipt."""
    from src.engine.extraction.isolated_attempt_receipt import _safe_name

    _q, qp, rd, _ = _receipts(tmp_path)
    (__import__("pathlib").Path(rd) / f"{_safe_name(R_RANGE)}.attempt.json").unlink()

    with pytest.raises(FinalizationRefused, match="NO durable attempt receipt"):
        collect_isolated_results(qp, rd)


def test_a_planted_orphan_raw_for_a_never_attempted_ref_is_refused(tmp_path):
    """The attacker-shaped version: no attempt was ever made, and a self-consistent raw file is
    dropped in with the correct name and a correctly recomputed hash."""
    import hashlib
    import pathlib

    from src.engine.extraction.isolated_attempt_receipt import _safe_name

    q, qp, rd, _ = _receipts(tmp_path, claim=False)
    pathlib.Path(rd).mkdir(parents=True, exist_ok=True)
    planted = "we mark the high and the low of the first five minute candle to build our range"
    rec = {
        "condition_ref": R_RANGE,
        "raw_output": planted,
        "raw_output_sha256": hashlib.sha256(planted.encode("utf-8")).hexdigest(),
        "parsed": False,
    }
    (pathlib.Path(rd) / f"{_safe_name(R_RANGE)}.raw.json").write_text(
        json.dumps(rec), encoding="utf-8")

    with pytest.raises(FinalizationRefused, match="NO durable attempt receipt"):
        collect_isolated_results(qp, rd)


def test_a_crash_shaped_attempt_yields_no_result_and_finalization_refuses(tmp_path):
    """Attempt present, raw missing. Collection returns nothing for it — and finalization then
    refuses the whole set rather than grading eleven of twelve."""
    _q, qp, rd, _ = _receipts(tmp_path, raw=None)
    assert collect_isolated_results(qp, rd) == {}
    with pytest.raises(FinalizationRefused, match="INCOMPLETE FINAL SET"):
        finalize(TRANSCRIPT, CONDITIONS, _batch(), _queue(), {})


@pytest.mark.parametrize(
    "label,suffix,fields,match",
    [
        ("attempt names another condition", "attempt",
         {"condition_ref": "entry_sequence[9].action"}, "attempt receipt names"),
        ("attempt task hash wrong", "attempt",
         {"task_input_sha256": "f" * 64}, "not this queue entry's frozen value"),
        ("attempt claimed against another queue", "attempt",
         {"queue_artifact_sha256": "e" * 64}, "DIFFERENT queue artifact"),
        ("attempt requested the wrong model", "attempt",
         {"requested_model_identity": "haiku"}, "requested model"),
        ("attempt used an unapproved path", "attempt",
         {"invocation_path": "anthropic API key"}, "not an approved"),
        ("attempt status is not the pre-call claim", "attempt",
         {"status": "COMPLETED"}, "attempt status is"),
        ("attempt number is not 1", "attempt",
         {"attempt_number": 2}, "attempt_number is"),
        ("raw names another condition", "raw",
         {"condition_ref": "entry_sequence[9].action"}, "raw record names"),
        ("raw written against another queue", "raw",
         {"queue_artifact_sha256": "e" * 64}, "DIFFERENT queue artifact"),
        ("raw is not pre-parse evidence", "raw",
         {"parsed": True}, "not marked parsed=false"),
        ("raw edited after the fact", "raw",
         {"raw_output": "a quietly improved quote"}, "does not match its own recorded sha256"),
    ],
)
def test_every_provenance_field_is_joined_not_assumed(tmp_path, label, suffix, fields, match):
    _q, qp, rd, _ = _receipts(tmp_path)
    assert collect_isolated_results(qp, rd) == {R_RANGE: Q_RANGE}, "control must pass first"
    _tamper(rd, suffix, **fields)
    with pytest.raises(FinalizationRefused, match=match):
        collect_isolated_results(qp, rd)


def test_the_filename_is_never_the_identity_join(tmp_path):
    """The filename is attacker-chosen. Both records must name the ref themselves."""
    _q, qp, rd, _ = _receipts(tmp_path)
    _tamper(rd, "raw", condition_ref="entry_sequence[9].action")
    with pytest.raises(FinalizationRefused, match="raw record names"):
        collect_isolated_results(qp, rd)


def test_the_final_machine_result_is_byte_stable_for_identical_inputs():
    """§5's determinism control. Nothing in the record may carry a timestamp or a run id."""
    q = _queue()
    a = finalize(TRANSCRIPT, CONDITIONS, _batch(), q, {R_RANGE: Q_RANGE})
    b = finalize(TRANSCRIPT, CONDITIONS, _batch(), q, {R_RANGE: Q_RANGE})
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def test_the_record_pins_the_queue_and_the_isolated_returns_it_consumed():
    out = finalize(TRANSCRIPT, CONDITIONS, _batch(), _queue(), {R_RANGE: Q_RANGE})
    assert out["queue_artifact"]["queued_count"] == 1
    assert out["queue_artifact"]["excluded_count"] == 3
    assert set(out["isolated_result_sha256"]) == {R_RANGE}
    assert out["queue_artifact"]["substitution_rule_sha256"]
