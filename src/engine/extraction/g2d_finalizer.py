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


def collect_isolated_results(queue_path: str, receipt_dir: str) -> dict[str, str]:
    """Read every stored raw isolated return and JOIN IT TO ITS DURABLE ATTEMPT (AR-1254 F-1).

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
    """
    from .isolated_attempt_receipt import ATTEMPT_CLAIMED, DurableAttemptLedger, _safe_name

    # Loading through the ledger re-verifies law version, substitution-rule hash and pinned
    # 64-hex source identities, and gives us the authoritative queue-artifact SHA.
    ledger = DurableAttemptLedger.load(queue_path, receipt_dir)
    queue_sha = ledger.queue_sha256

    out: dict[str, str] = {}
    for entry in ledger.queue["queue"]:
        ref = entry["condition_ref"]
        a_path = os.path.join(receipt_dir, f"{_safe_name(ref)}.attempt.json")
        r_path = os.path.join(receipt_dir, f"{_safe_name(ref)}.raw.json")
        a_exists, r_exists = os.path.exists(a_path), os.path.exists(r_path)

        if not a_exists and not r_exists:
            continue                      # simply not attempted yet
        if r_exists and not a_exists:
            raise FinalizationRefused(
                f"PROVENANCE REFUSED for {ref!r}: a raw return exists with NO durable attempt "
                "receipt beside it. An orphan raw file is text of unknown origin — the attempt "
                "receipt is the only thing that ties a return to the one authorized call."
            )
        if a_exists and not r_exists:
            continue                      # crash-shaped: claimed, no answer. Spent, not usable.

        with open(a_path, encoding="utf-8") as fh:
            att = json.load(fh)
        with open(r_path, encoding="utf-8") as fh:
            rec = json.load(fh)

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
