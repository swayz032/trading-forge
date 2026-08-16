"""E/F/G — the final-evidence consumer and re-gating harness (AR-1252 §5).

THE DESIGN DECISION THAT MATTERS
    The gates are NOT reimplemented here. AR-1236 §10 and AR-1252 both say the same thing —
    reuse what exists, wire the smallest seam. `opus_phase1_route.run_route` already performs,
    in exactly the ordered sequence §5 D-H demands:

        literal verification -> complete-set collision -> primary relevance
        -> mechanically authorized antecedent composition -> source fidelity

    So this module's whole job is to build the COMPLETE final 12-condition answer set and hand
    it to that one function. Requirements D, E, F, G and H are therefore satisfied by
    construction rather than by a second copy of the pipeline that could drift from the first.

WHY SUBSTITUTION HAPPENS BEFORE THE ROUTE RUNS, NOT INSIDE IT
    §5 D/E require the complete final set to exist BEFORE collision adjudication. Collision is a
    set-level property: adjudicating the batch set and then swapping members would test a set
    that never existed. Substituting first and running the complete set once is the only order
    that measures the thing being shipped.

WHY THE BATCH ANSWER CANNOT COME BACK (§5 B/C)
    For a queued ref, the batch candidate is simply ABSENT from the final set. There is no
    fallback branch to audit and no comparison to forbid, because the losing value is never
    carried into the function. A non-literal isolated return therefore REDs at the literal fence
    exactly like any other bad evidence — it does not "fall back", because there is nothing to
    fall back to.

WHAT THIS MODULE MAY NOT DO (§5 K)
    It cannot certify. `run_route`'s best possible grade is GREEN_PENDING_CERTIFICATION, and
    `finalize` refuses to emit any stronger word. A literal quote found by an expensive model is
    still just a located quote (AR-1234 §4).
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Sequence

from .opus_phase1_route import ROUTE_VERSION, run_route

__all__ = ["FinalizationRefused", "collect_isolated_results", "finalize"]

G2D_ARTIFACT_VERSION = "g2d-final-route-v1"


class FinalizationRefused(RuntimeError):
    """Raised when the final set cannot be assembled honestly. Never downgraded to a warning:
    an incomplete final set that still produces a grade is the shape this whole packet exists
    to prevent."""


def _sha(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


APPROVED_INVOCATION_PATHS = frozenset({"fresh Claude Code subscription subagent"})
APPROVED_MODEL_IDENTITY = "opus"


def _require(cond: bool, ref: str, what: str) -> None:
    if not cond:
        raise FinalizationRefused(f"PROVENANCE REFUSED for {ref!r}: {what}")


ACTUAL_MODEL_IDENTITY_CONTRACT_VERSION = "g2d-actual-model-identity-v1"

# AR-1261 §5 (D1-C1) — AN EXPLICIT, VERSIONED, EXACT ACCEPTED-IDENTITY SET.
#
# 🛑 THIS REPLACES A SUBSTRING CHECK, AND THE SUBSTRING CHECK WAS MINE. AR-1260 shipped
#     `"opus" in value.lower()`, disclosed as an assumption. GPT refused the assumption and was
#     right: a substring is not an identity. `not-opus`, `opus-impostor`, `myopus` and
#     `this-is-not-opus-model` all PASSED it. A matcher that accepts a string whose plain English
#     meaning is "not opus" is not a weak check, it is an inverted one.
#
# MEMBERSHIP RULE, and it is deliberately SHORT: an identity is a member only if this desk holds
# documented evidence that the string names the Opus model authorized for this frozen experiment.
# Both members below are ARTIFACT-SOURCED from the Claude Code runtime's own model declaration —
# NOT measured from a completion receipt, because zero of the eight calls have been spent.
#
#   claude-opus-5       the runtime's stated model id for Opus 5
#   claude-opus-5[1m]   the same model, 1M-context variant; the exact id this seat reports
#
# ⚠️ THE BARE WORD `opus` IS DELIBERATELY *NOT* A MEMBER. It is the authorized *requested*
#    identity (`APPROVED_MODEL_IDENTITY`, still strict equality at dispatch), and the guess that
#    a runtime might echo it back as an ACTUAL identity is a HYPOTHESIS. AR-1261 §5 forbids
#    widening this set on anything less than evidence, and the cost of being too narrow is
#    exactly the behaviour the ruling asks for: STOP and report, with all eight calls still
#    unspent. The cost of being too wide is a spent call attributed to the wrong model.
#
# 🛑 IF A REAL RUN EVER EXPOSES AN IDENTITY THAT IS NOT IN THIS SET: STOP AND REPORT IT.
#    Do not add it here to regain green, do not retry the one-shot call. Only a ruling adds a
#    member — an alias invented after seeing the answer is the answer choosing its own gate.
APPROVED_ACTUAL_MODEL_IDENTITIES = frozenset({
    "claude-opus-5",
    "claude-opus-5[1m]",
})


def _actual_model_identity_is_approved(value: str) -> bool:
    """EXACT membership in the frozen set above. No contains, no prefix, no fuzz, no regex.

    Case is significant: a model id is an identifier, not prose, and lower-casing would silently
    admit a second spelling this desk has never seen.
    """
    return value in APPROVED_ACTUAL_MODEL_IDENTITIES


def collect_isolated_results(queue_path: str, receipt_dir: str) -> dict[str, str]:
    """Read every stored raw isolated return and JOIN IT TO ITS COMPLETE QUARTET (AR-1260 §A).

    🛑 THE DEFECT THIS CLOSES, AND IT WAS MINE. The previous version located `<ref>.raw.json`,
    recomputed `sha256(raw_output)` and accepted the file if it matched its own recorded hash.
    That proves only that the file is INTERNALLY SELF-CONSISTENT. It proves nothing about where
    the text came from, so a planted orphan raw file with a correctly recomputed hash would have
    been accepted — an end-to-end provenance bypass around a durable ledger that was otherwise
    sound. **The ledger can be perfect and still be bypassed downstream by a consumer that
    accepts an orphan.**

    ★ `A FILE THAT AGREES WITH ITSELF IS NOT PROVENANCE. THE JOIN KEY IS THE ATTEMPT RECEIPT.`

    So a raw return is admissible only as one half of a matched pair, with BOTH halves joined to
    the exact frozen queue BYTES — not to the filename, which is attacker-chosen and was the only
    thing the old code trusted.

    🛑 AR-1260 §A WIDENS THAT PAIR TO THE COMPLETE QUARTET, AND THE GAP WAS REAL
        The pair above is `.attempt` + `.raw`. But the durable handoff writes FOUR files, and the
        two this consumer never opened are the two that carry the call itself:

            .attempt     the budget was claimed        (this consumer read it)
            .dispatch    a call was actually issued    (NOT READ — so a raw return for a call
                                                        that was never issued was admissible)
            .raw         the text that came back       (this consumer read it)
            .completion  the call actually finished    (NOT READ — so the half-written crash
                                                        state read as a finished call)

        All four must name the same condition, the same frozen `task_input_sha256`, the same
        queue-artifact bytes, and `attempt_number == 1`. Anything less is a set of files that
        happen to sit in one directory.

    ★ `FOUR FILES ARE A CHAIN ONLY IF SOMETHING WALKS ALL FOUR LINKS. TWO OF THEM WERE DECOR.`
    """
    from .isolated_attempt_receipt import ATTEMPT_CLAIMED, DurableAttemptLedger, _safe_name
    from .isolated_bridge import NATIVE_TASK_DISPATCHED, NOT_EXPOSED, RAW_RETURN_CAPTURED

    # Loading through the ledger re-verifies law version, substitution-rule hash and pinned
    # 64-hex source identities, and gives us the authoritative queue-artifact SHA.
    ledger = DurableAttemptLedger.load(queue_path, receipt_dir)
    queue_sha = ledger.queue_sha256

    out: dict[str, str] = {}
    for entry in ledger.queue["queue"]:
        ref = entry["condition_ref"]
        paths = {
            part: os.path.join(receipt_dir, f"{_safe_name(ref)}.{part}.json")
            for part in ("attempt", "dispatch", "raw", "completion")
        }
        have = {part: os.path.exists(p) for part, p in paths.items()}

        if not any(have.values()):
            continue                      # simply not attempted yet

        # --- §A: the quartet is walked in ORDER, and every hole is named ------------------- #
        if not have["attempt"]:
            raise FinalizationRefused(
                f"PROVENANCE REFUSED for {ref!r}: {sorted(k for k, v in have.items() if v)} "
                "exist with NO durable attempt receipt beside them. An orphan raw file is text "
                "of unknown origin — the attempt receipt is the only thing that ties a return "
                "to the one authorized call."
            )
        if have["completion"] and not have["dispatch"]:
            raise FinalizationRefused(
                f"PROVENANCE REFUSED for {ref!r}: a completion receipt exists with NO dispatch "
                "receipt. A call cannot finish that was never issued; this completion attests to "
                "a call for which no budgeted dispatch was ever recorded."
            )
        if have["raw"] and not have["dispatch"]:
            raise FinalizationRefused(
                f"PROVENANCE REFUSED for {ref!r}: a raw return exists with NO dispatch receipt. "
                "The attempt receipt proves a budget was claimed; only the dispatch receipt "
                "proves the one authorized call was actually issued."
            )
        if have["raw"] and not have["completion"]:
            raise FinalizationRefused(
                f"PROVENANCE REFUSED for {ref!r}: STRANDED/INCOMPLETE — a raw return exists with "
                "NO completion receipt. The final transition is a two-file commit and only half "
                "of it is on disk, so this call's outcome is unknown. It is not "
                f"{RAW_RETURN_CAPTURED}, and it is not retried (AR-1260 §B)."
            )
        if have["completion"] and not have["raw"]:
            raise FinalizationRefused(
                f"PROVENANCE REFUSED for {ref!r}: a completion receipt exists with NO raw return. "
                "A finished call with no answer stored is not evidence of an answer."
            )
        if not have["raw"]:
            continue        # crash-shaped: claimed and/or dispatched, no answer. Spent, unusable.

        with open(paths["attempt"], encoding="utf-8") as fh:
            att = json.load(fh)
        with open(paths["dispatch"], encoding="utf-8") as fh:
            dsp = json.load(fh)
        with open(paths["raw"], encoding="utf-8") as fh:
            rec = json.load(fh)
        with open(paths["completion"], encoding="utf-8") as fh:
            cmp_ = json.load(fh)

        _require(att.get("status") == ATTEMPT_CLAIMED, ref,
                 f"attempt status is {att.get('status')!r}, not {ATTEMPT_CLAIMED!r}")
        _require(att.get("attempt_number") == 1, ref,
                 f"attempt_number is {att.get('attempt_number')!r}, not 1")
        _require(att.get("condition_ref") == ref, ref,
                 f"the attempt receipt names {att.get('condition_ref')!r}")
        _require(att.get("task_input_sha256") == entry["task_input_sha256"], ref,
                 "the attempt's task_input_sha256 is not this queue entry's frozen value")
        _require(att.get("queue_artifact_sha256") == queue_sha, ref,
                 "the attempt was claimed against a DIFFERENT queue artifact")
        _require(att.get("requested_model_identity") == APPROVED_MODEL_IDENTITY, ref,
                 f"the attempt requested model {att.get('requested_model_identity')!r}")
        _require(att.get("invocation_path") in APPROVED_INVOCATION_PATHS, ref,
                 f"the attempt used invocation path {att.get('invocation_path')!r}, which is not "
                 f"an approved Claude Code subscription subagent path")

        # --- .dispatch — the call was issued, once, for the authorized model --------------- #
        _require(dsp.get("state") == NATIVE_TASK_DISPATCHED, ref,
                 f"the dispatch receipt is in state {dsp.get('state')!r}, not "
                 f"{NATIVE_TASK_DISPATCHED!r}")
        _require(dsp.get("condition_ref") == ref, ref,
                 f"the dispatch receipt names {dsp.get('condition_ref')!r}")
        _require(dsp.get("task_input_sha256") == entry["task_input_sha256"], ref,
                 "the dispatch's task_input_sha256 is not this queue entry's frozen value")
        _require(dsp.get("queue_artifact_sha256") == queue_sha, ref,
                 "the dispatch was issued against a DIFFERENT queue artifact")
        _require(dsp.get("requested_model_identity") == APPROVED_MODEL_IDENTITY, ref,
                 f"the dispatch requested model {dsp.get('requested_model_identity')!r}")
        _require(dsp.get("invocation_path") in APPROVED_INVOCATION_PATHS, ref,
                 f"the dispatch used invocation path {dsp.get('invocation_path')!r}, which is not "
                 f"an approved Claude Code subscription subagent path")
        _require(att.get("requested_model_identity") == dsp.get("requested_model_identity"), ref,
                 "the attempt and the dispatch disagree about which model was requested")

        _require(rec.get("condition_ref") == ref, ref,
                 f"the raw record names {rec.get('condition_ref')!r}")
        _require(rec.get("queue_artifact_sha256") == queue_sha, ref,
                 "the raw record was written against a DIFFERENT queue artifact")
        _require(rec.get("parsed") is False, ref,
                 "the raw record is not marked parsed=false; it is not the pre-parse evidence")
        raw = rec.get("raw_output")
        _require(_sha(raw) == rec.get("raw_output_sha256"), ref,
                 "the stored raw return does not match its own recorded sha256 — it has been "
                 "altered since it was written")

        # --- .completion — the call finished, and it is THIS call -------------------------- #
        _require(cmp_.get("state") == RAW_RETURN_CAPTURED, ref,
                 f"the completion receipt is in state {cmp_.get('state')!r}, not "
                 f"{RAW_RETURN_CAPTURED!r}")
        _require(cmp_.get("condition_ref") == ref, ref,
                 f"the completion receipt names {cmp_.get('condition_ref')!r}")
        _require(cmp_.get("task_input_sha256") == entry["task_input_sha256"], ref,
                 "the completion's task_input_sha256 is not this queue entry's frozen value")
        _require(cmp_.get("queue_artifact_sha256") == queue_sha, ref,
                 "the completion was written against a DIFFERENT queue artifact")
        _require(cmp_.get("raw_output_sha256") == rec.get("raw_output_sha256"), ref,
                 "the completion receipt attests to a DIFFERENT raw return than the one stored")
        # §C — the completion may not assert a model on its own authority. It must agree with the
        # dispatch beside it, and a hard-coded 'opus' that contradicts its dispatch dies here.
        _require(cmp_.get("requested_model_identity") == dsp.get("requested_model_identity"), ref,
                 f"the completion claims requested model {cmp_.get('requested_model_identity')!r} "
                 f"but the dispatch recorded {dsp.get('requested_model_identity')!r}")
        actual = cmp_.get("actual_model_identity")
        _require(actual == NOT_EXPOSED or _actual_model_identity_is_approved(actual), ref,
                 f"the completion exposes actual model identity {actual!r}, which is not an "
                 f"EXACT member of the approved set "
                 f"{sorted(APPROVED_ACTUAL_MODEL_IDENTITIES)} "
                 f"({ACTUAL_MODEL_IDENTITY_CONTRACT_VERSION}). Only {NOT_EXPOSED} is an "
                 "acceptable non-answer. An unseen identity is a STOP, not a reason to widen "
                 "the set (AR-1261 §5)")
        d_task, c_task = dsp.get("native_task_id"), cmp_.get("native_task_id")
        if d_task not in (None, "", NOT_EXPOSED) and c_task not in (None, "", NOT_EXPOSED):
            _require(d_task == c_task, ref,
                     f"native task id mismatch: the dispatch recorded {d_task!r} and the "
                     f"completion names {c_task!r} — two exposed identities that disagree "
                     "describe two different calls")

        out[ref] = raw
    return out


def finalize(
    transcript: str,
    conditions: Sequence[dict],
    batch_answers: Sequence[dict],
    queue: dict,
    isolated_results: dict[str, str],
    composition_specs: Sequence[dict] | None = None,
    relevance_floor: float = 0.10,
) -> dict[str, Any]:
    """Assemble the complete final evidence set and re-gate it in the established order.

    `isolated_results`: {condition_ref: raw isolated return} for the frozen queued refs.
    """
    refs_all = [c["condition_ref"] for c in conditions]
    queued = [e["condition_ref"] for e in queue["queue"]]
    excluded = [e["condition_ref"] for e in queue.get("excluded", [])]

    if queue.get("input_route_version") != ROUTE_VERSION:
        raise FinalizationRefused(
            f"the queue was frozen against route {queue.get('input_route_version')!r} but this "
            f"module would re-gate with {ROUTE_VERSION!r}. The final set would not be comparable "
            "to the run that selected it."
        )

    # §5 A — every queued ref must have its one isolated result, or the set is incomplete.
    missing = [r for r in queued if r not in isolated_results]
    if missing:
        raise FinalizationRefused(
            f"INCOMPLETE FINAL SET: no isolated result for {missing}. A queued condition whose "
            "one permitted attempt produced nothing stays UNRESOLVED, and finalizing the "
            "remainder would publish a grade over a set that was never completed. If those "
            "attempts are spent, the honest output is a refusal, not a partial route."
        )

    # control — an isolated answer for something the route never queued
    unfrozen = [r for r in isolated_results if r not in queued]
    if unfrozen:
        accepted_overrides = [r for r in unfrozen if r in excluded]
        raise FinalizationRefused(
            f"UNFROZEN ISOLATED RESULT for {sorted(unfrozen)}. Only the conditions the "
            "deterministic route selected may be substituted"
            + (f"; {sorted(accepted_overrides)} were ACCEPTED and must never be re-queried "
               "(AR-1250 §3)." if accepted_overrides else ".")
        )

    unknown = [r for r in queued if r not in refs_all]
    if unknown:
        raise FinalizationRefused(
            f"queued refs {unknown} are absent from the condition set being finalized; the "
            "queue and the conditions describe different runs."
        )

    # §5 D — build the COMPLETE final set BEFORE any set-level adjudication. For a queued ref
    # the batch candidate is simply not carried forward: there is no value left to fall back to.
    answers_by_ref = {a["condition_ref"]: a["raw_output"] for a in batch_answers}
    final_answers = []
    provenance: dict[str, str] = {}
    for ref in refs_all:
        if ref in isolated_results:
            final_answers.append({"condition_ref": ref, "raw_output": isolated_results[ref]})
            provenance[ref] = "isolated"
        else:
            if ref not in answers_by_ref:
                raise FinalizationRefused(
                    f"condition {ref!r} has neither a batch answer nor an isolated result."
                )
            final_answers.append({"condition_ref": ref, "raw_output": answers_by_ref[ref]})
            provenance[ref] = "batch"

    # §5 E-H — one complete-set pass through the EXISTING gates, in their existing order.
    record = run_route(
        transcript, conditions, final_answers,
        relevance_floor=relevance_floor,
        composition_specs=composition_specs,
    )

    if record["grade"] not in ("RED", "GREEN_PENDING_CERTIFICATION"):
        raise FinalizationRefused(f"unexpected route grade {record['grade']!r}")

    record["artifact"] = G2D_ARTIFACT_VERSION
    record["authority"] = "AR-1252 §5 (E/F/G final-evidence consumer)"
    record["evidence_provenance"] = provenance
    record["provenance_counts"] = {
        "isolated": sum(1 for v in provenance.values() if v == "isolated"),
        "batch": sum(1 for v in provenance.values() if v == "batch"),
    }
    record["queue_artifact"] = {
        "law_version": queue.get("law_version"),
        "input_route_version": queue.get("input_route_version"),
        "substitution_rule_sha256": queue.get("substitution_rule_sha256"),
        "queued_count": len(queued),
        "excluded_count": len(excluded),
    }
    record["isolated_result_sha256"] = {r: _sha(v) for r, v in sorted(isolated_results.items())}
    record["certification"] = (
        "NOT CERTIFIED. This module cannot issue one. A grade of "
        "GREEN_PENDING_CERTIFICATION means every mechanical and relevance gate passed with no "
        "detected inflation on the FINAL set — it does not mean the conditions are correct, and "
        "AR-1234 §4 names 'the model found a literal quote -> condition certified' as the wrong "
        "architecture. Certification is the external authority's."
    )
    record["substitution_policy"] = (
        "For a queued condition the isolated return is the ONLY candidate in the final set; the "
        "batch answer is absent rather than deprioritised, so there is no comparison step and no "
        "path that restores it when the isolated answer grades worse. A non-literal isolated "
        "return REDs at the literal fence and the condition stays unresolved."
    )
    record["historical_artifact_policy"] = (
        "NEW versioned artifact. The historical opus-v2 RED route/certificate files are history "
        "and are never rewritten into green (AR-1236 §10.12 / AR-1252 §5 J)."
    )
    return record
