"""LANE O1 -- BATCHED LOCATOR CANDIDATE (AR-1234 §6).

WHAT THIS IS
    AR-1234 retired the current-config gemma locator from load-bearing evidence location and
    promoted Opus to PREFERRED SUCCESSOR LOCATOR CANDIDATE. It also forbade productionising the
    benchmark topology: twelve isolated subagents per video (~53k subagent tokens each, measured
    in `opus_delegation_receipt.json`) does not scale to a corpus.

    This module is the mechanics of the NEW topology AR-1234 §6 ordered:

        ONE fresh reader per video -> full transcript once -> ALL spine conditions at once
                                  -> structured map  condition_ref -> literal quote | null

    🛑 IT IS A NEW TOPOLOGY, SO IT EARNS PARITY -- IT DOES NOT INHERIT IT. Nothing here may
    assume the isolated-benchmark result transfers. `compare_to_reference` exists precisely to
    measure the transfer mechanically instead of assuming it.

WHAT THIS MODULE IS NOT
    🛑 IT DOES NOT SCORE. AR-1234 §3 reserves topical relevance, source fidelity and the verdict
    to the external scorer, and AR-1234 §4 is explicit that a located quote is NOT a certified
    condition ("Opus found a quote -> condition certified" is named as the wrong architecture).
    Every function here reports EXISTENCE and AGREEMENT. None reports correctness.

    🛑 IT IS SOURCE-AGNOSTIC. No video id, no transcript pin, no condition text and no answer
    span appears in this file. Those live in the driver script, and `test_batch_locator.py`
    red-proofs the absence with a positive control (AR-1234 §6 acceptance control 10).

THE VERIFIER IS REUSED, NEVER REIMPLEMENTED
    `verify_answer` calls `anchor_locator._verify_and_locate` -- the same whitespace-normalised
    literal fence `f2_coverage_gate` runs in production. A second substring check written here
    would be a second source of truth that drifts (`anchor_locator`'s own anti-duplication note).

THE CONFOUND THIS MODULE DECLARES RATHER THAN HIDES
    A batch reader sees all N conditions in one context; an isolated reader sees one. The batch
    reader can therefore avoid re-using a passage for reasons the isolated arm never had.
    ⇒ **A LOWER COLLISION COUNT IN THE BATCH ARM IS NOT EVIDENCE OF BETTER GROUNDING.** It is
    partly an artefact of the topology under test. `TOPOLOGY_CONFOUND` is emitted into every
    artifact so the scorer reads it beside the number, not after it.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Sequence
from typing import Any

from . import anchor_locator as al

# --------------------------------------------------------------------------- #
# Constants that travel with the numbers
# --------------------------------------------------------------------------- #

BATCH_BRIEF_VERSION = "batch-locator-brief-v1"

TOPOLOGY_CONFOUND = (
    "A BATCH READER SEES EVERY CONDITION AT ONCE; THE ISOLATED BENCHMARK READER SAW ONE. The "
    "batch arm can therefore avoid re-using a passage for a reason the isolated arm never had. "
    "A LOWER COLLISION COUNT IN THE BATCH ARM IS NOT EVIDENCE OF BETTER GROUNDING -- it is "
    "partly an artefact of the topology being tested. Compare grounding on the quotes, not on "
    "the collision count."
)

OUTCOME_LITERAL = "LITERAL"
OUTCOME_NOT_LITERAL = "NOT_LITERAL_SUBSTRING"
OUTCOME_ABSTAINED = "ABSTAINED"

AGREE_SAME_SPAN = "SAME_SPAN"
AGREE_OVERLAP = "OVERLAPPING_SPAN"
AGREE_DIFFERENT = "DIFFERENT_SPAN"
AGREE_ONLY_BATCH = "LOCATED_ONLY_BY_BATCH"
AGREE_ONLY_REFERENCE = "LOCATED_ONLY_BY_REFERENCE"
AGREE_NEITHER = "LOCATED_BY_NEITHER"


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# 1. The brief -- production rules reused verbatim, batching envelope declared
# --------------------------------------------------------------------------- #


def production_rules_block(system_prompt: str) -> str:
    """The invariant middle of the production locator brief: the numbered RULES, verbatim.

    Everything before it is framing ("you are given ONE condition") and everything after it is
    the single-answer output contract. Those two are exactly what a batch topology must change,
    and the rules -- verbatim copy, shortest span, decline rather than invent -- are exactly what
    it must NOT. Splitting here makes the delta auditable instead of asking a reader to diff two
    prose blobs.
    """
    start = system_prompt.find("Rules:")
    if start < 0:
        raise ValueError("production system prompt has no 'Rules:' block -- refusing to guess")
    end = system_prompt.find("Return JSON", start)
    if end < 0:
        raise ValueError("production system prompt has no output clause after its rules")
    return system_prompt[start:end].rstrip()


def build_batch_brief(system_prompt: str) -> dict[str, str]:
    """Return the batch system brief plus the two pieces it is built from, separately hashed.

    NOTHING is added that steers an answer. No worked example, no synonym, no hint about which
    passages exist, no instruction about re-use. The additions are the two mechanical facts a
    batch reader needs and an isolated reader did not: there are many conditions, and the answer
    is a map. Any further instruction would be a per-side advantage of exactly the kind AR-1232
    §3 forbade, and it would be MY thumb on the scale for a candidate from my own model family.
    """
    rules = production_rules_block(system_prompt)
    framing = (
        "You are an anchor locator for trading-education transcripts. You are given a LIST of "
        "extracted strategy conditions from ONE video and the FULL transcript they were "
        "extracted from. For EACH condition in the list, find the literal span of transcript "
        "text that GROUNDS that condition -- the trader's own words that the condition is "
        "describing."
    )
    output_contract = (
        "Return a single JSON object of exactly this shape:\n"
        '{"answers": [{"condition_ref": "<the ref exactly as given>", '
        '"quote": "<verbatim transcript span>"}, ...]}\n'
        "Include EXACTLY ONE entry for EVERY condition listed, using the `condition_ref` strings "
        "exactly as given. Use `\"quote\": null` for a condition you decline. Return the JSON "
        "object and nothing else."
    )
    brief = f"{framing}\n\n{rules}\n\n{output_contract}"
    return {
        "brief_version": BATCH_BRIEF_VERSION,
        "batch_brief": brief,
        "batch_brief_sha256": sha256(brief),
        "reused_verbatim_from_production": rules,
        "reused_verbatim_sha256": sha256(rules),
        "authored_for_batch_framing": framing,
        "authored_for_batch_output_contract": output_contract,
        "production_system_prompt_sha256": sha256(system_prompt),
        "delta_declaration": (
            "The numbered RULES are the production locator's own, reused byte-for-byte. The "
            "framing sentence and the output contract are AUTHORED HERE because a one-condition "
            "brief cannot express an N-condition task. This brief is therefore NOT the frozen "
            "benchmark brief and the batch arm's results are NOT admissible against the "
            "benchmark packet hash -- they are a new arm that must earn parity (AR-1234 §6)."
        ),
    }


def build_batch_task(system_prompt: str, transcript: str, conditions: Sequence[dict]) -> str:
    """The complete delegation text a fresh reader receives: brief, conditions, transcript.

    Condition order is the extraction's own order. It is NOT sorted, grouped, ranked or
    otherwise arranged by anything downstream of the defect under investigation
    (`[ranked-by-the-extractor]`).
    """
    if not conditions:
        raise ValueError("refusing to build a batch task with zero conditions")
    lines = [
        f"{i + 1}. condition_ref: {c['condition_ref']}\n   condition: {c['condition_text']}"
        for i, c in enumerate(conditions)
    ]
    return (
        f"{build_batch_brief(system_prompt)['batch_brief']}\n\n"
        f"CONDITIONS ({len(conditions)}):\n" + "\n".join(lines) + "\n\n"
        f"TRANSCRIPT:\n{transcript}\n\n"
        "Return the JSON object described above."
    )


# --------------------------------------------------------------------------- #
# 2. Leakage screen (AR-1234 §6 acceptance control 2)
# --------------------------------------------------------------------------- #


def screen_task_for_leakage(task_text: str, forbidden: Iterable[tuple[str, str]]) -> list[dict]:
    """Return every hit of a forbidden string inside the delegation text.

    `forbidden` is (label, needle) -- prior gemma answers, prior located quotes, an answer key,
    a char offset from the committed artifact. A hit means the reader would be shown an answer
    it is supposed to produce, and the run is void.

    🛑 EMPTY IS ONLY MEANINGFUL WITH A POSITIVE CONTROL. A screen that finds nothing because its
    needle list is empty is indistinguishable from a clean task. `screen_is_live` below is the
    witness, and the caller must assert it (`[absence-claim]`).
    """
    hits = []
    normalised = " ".join(task_text.split())
    for label, needle in forbidden:
        if not needle:
            continue
        probe = " ".join(str(needle).split())
        if len(probe) < 12:
            # too short to be evidence of leakage rather than of ordinary English
            continue
        if probe in normalised:
            hits.append({"label": label, "needle_sha256": sha256(probe), "needle_len": len(probe)})
    return hits


def screen_is_live(task_text: str, forbidden: Sequence[tuple[str, str]]) -> dict:
    """POSITIVE WITNESS that the screen can fire: plant one forbidden needle into a copy of the
    task and require a hit. Without this, `leakage: none` proves nothing about the screen."""
    usable = [n for _, n in forbidden if n and len(" ".join(str(n).split())) >= 12]
    if not usable:
        return {"live": False, "reason": "no usable needle -- screen has nothing to detect with"}
    planted = task_text + "\n\nPLANTED_CONTROL: " + usable[0]
    fired = screen_task_for_leakage(planted, forbidden)
    return {
        "live": bool(fired),
        "needles_available": len(usable),
        "control": "one forbidden needle appended to a COPY of the task; the screen must fire",
        "fired_on_control": len(fired),
    }


# --------------------------------------------------------------------------- #
# 3. Ingest -- raw is sacred
# --------------------------------------------------------------------------- #


def parse_batch_return(payload: Any, expected_refs: Sequence[str]) -> list[dict]:
    """Validate the SHAPE of a reader's return and pass every quote through UNTOUCHED.

    No trimming, no unescaping, no 'obvious' repair, no filling a missing ref with null. A reader
    that omits a condition FAILED to answer it, and silently substituting null would convert its
    failure into a legitimate decline (AR-1232 §6: the parent worker may not clean up a
    contestant answer).
    """
    if isinstance(payload, str):
        payload = json.loads(payload)
    answers = payload.get("answers") if isinstance(payload, dict) else None
    if not isinstance(answers, list):
        raise ValueError("batch return has no `answers` list")

    seen: dict[str, Any] = {}
    for item in answers:
        if not isinstance(item, dict) or "condition_ref" not in item:
            raise ValueError(f"malformed answer entry: {item!r}")
        ref = item["condition_ref"]
        if ref in seen:
            raise ValueError(f"duplicate condition_ref in batch return: {ref}")
        if "quote" not in item:
            raise ValueError(f"answer for {ref} has no `quote` key (null is required to decline)")
        seen[ref] = item["quote"]

    missing = sorted(set(expected_refs) - set(seen))
    extra = sorted(set(seen) - set(expected_refs))
    if missing or extra:
        raise ValueError(f"condition set mismatch. missing={missing} extra={extra}")

    return [{"condition_ref": ref, "raw_output": seen[ref]} for ref in expected_refs]


# --------------------------------------------------------------------------- #
# 4. Mechanical verification -- the production fence, by import
# --------------------------------------------------------------------------- #


def verify_answer(transcript: str, raw: str | None) -> dict:
    if raw is None:
        return {"outcome": OUTCOME_ABSTAINED, "char_span": None, "quote": None, "quote_sha256": None}
    span = al._verify_and_locate(transcript, raw)
    if span is None:
        return {"outcome": OUTCOME_NOT_LITERAL, "char_span": None, "quote": None,
                "quote_sha256": None}
    quote = transcript[span[0]:span[1]]
    return {"outcome": OUTCOME_LITERAL, "char_span": [span[0], span[1]], "quote": quote,
            "quote_sha256": sha256(quote)}


def verify_trial(transcript: str, answers: Sequence[dict]) -> list[dict]:
    return [
        {
            "condition_ref": a["condition_ref"],
            "raw_output": a["raw_output"],           # untouched
            "mechanical_verifier": verify_answer(transcript, a["raw_output"]),
        }
        for a in answers
    ]


# --------------------------------------------------------------------------- #
# 5. Stability across trials (AR-1234 §6 acceptance control 7)
# --------------------------------------------------------------------------- #


def stability(trials: Sequence[Sequence[dict]]) -> dict:
    """Per-condition repeatability over N verified trials.

    🛑 ONE TRIAL CANNOT BE 'IDENTICAL ACROSS TRIALS'. With a single sample the comparison is
    vacuously true and renders as a perfect stability score -- a green with no path to red. This
    is the false green AR-1233 caught in its own harness before publication; it reports UNTESTED
    instead, and the caller may not upgrade that.
    """
    by_ref: dict[str, list[dict]] = {}
    for rows in trials:
        for r in rows:
            by_ref.setdefault(r["condition_ref"], []).append(r)

    per_condition = {}
    for ref, rows in by_ref.items():
        raws = {json.dumps(r["raw_output"], sort_keys=True) for r in rows}
        spans = {json.dumps(r["mechanical_verifier"]["char_span"]) for r in rows}
        per_condition[ref] = {
            "trials": len(rows),
            "distinct_raw_outputs": len(raws),
            "distinct_spans": len(spans),
            "identical_across_trials": None if len(rows) < 2 else (len(raws) == 1 and len(spans) == 1),
            "repeatability_measurable": len(rows) >= 2,
        }

    measurable = [v for v in per_condition.values() if v["repeatability_measurable"]]
    summary = (
        {"status": "UNTESTED -- fewer than 2 trials; no stability claim is admissible",
         "conditions_measured": 0}
        if not measurable else
        {"status": "MEASURED",
         "conditions_measured": len(measurable),
         "identical_across_trials": sum(1 for v in measurable if v["identical_across_trials"])}
    )
    return {"summary": summary, "per_condition": per_condition}


# --------------------------------------------------------------------------- #
# 6. Parity against the accepted isolated arm (AR-1234 §6 acceptance control 6)
# --------------------------------------------------------------------------- #


def _overlap_fraction(a: Sequence[int], b: Sequence[int]) -> float:
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    inter = max(0, hi - lo)
    shorter = min(a[1] - a[0], b[1] - b[0])
    return 0.0 if shorter <= 0 else inter / shorter


def compare_to_reference(batch_rows: Sequence[dict], reference_rows: Sequence[dict]) -> dict:
    """Mechanical span agreement between the batch arm and the accepted isolated arm.

    🛑 THIS IS NOT THE SEMANTIC 'NO WORSE' JUDGMENT AR-1234 §6.6 ASKS FOR, AND IT MUST NOT BE
    READ AS ONE. Span identity is mechanical; whether a DIFFERENT span grounds the condition
    better, worse or equally is a relevance judgment the external scorer owns (AR-1234 §3, and
    `worker-execution` §5: the doer produces the input, never the score). Every row where the
    arms disagree is emitted with BOTH quotes so that judgment can be made on the words.
    """
    ref_by_ref: dict[str, list[dict]] = {}
    for r in reference_rows:
        ref_by_ref.setdefault(r["condition_ref"], []).append(r)

    rows = []
    for b in batch_rows:
        ref_rows = ref_by_ref.get(b["condition_ref"], [])
        b_span = b["mechanical_verifier"]["char_span"]
        ref_spans = [r["mechanical_verifier"]["char_span"] for r in ref_rows]
        located_ref = [s for s in ref_spans if s]

        if b_span and located_ref:
            if any(s == b_span for s in located_ref):
                verdict = AGREE_SAME_SPAN
            elif any(_overlap_fraction(b_span, s) > 0 for s in located_ref):
                verdict = AGREE_OVERLAP
            else:
                verdict = AGREE_DIFFERENT
        elif b_span and not located_ref:
            verdict = AGREE_ONLY_BATCH
        elif located_ref and not b_span:
            verdict = AGREE_ONLY_REFERENCE
        else:
            verdict = AGREE_NEITHER

        rows.append({
            "condition_ref": b["condition_ref"],
            "agreement": verdict,
            "batch_span": b_span,
            "batch_quote": b["mechanical_verifier"]["quote"],
            "reference_spans": ref_spans,
            "reference_quotes": [r["mechanical_verifier"]["quote"] for r in ref_rows],
            "max_overlap_fraction": (
                max((_overlap_fraction(b_span, s) for s in located_ref), default=0.0)
                if b_span else 0.0
            ),
        })

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["agreement"]] = counts.get(r["agreement"], 0) + 1
    return {
        "scope": "MECHANICAL SPAN AGREEMENT ONLY -- no semantic judgment is present or implied",
        "semantic_owner": "external scorer (AR-1234 §3); the worker may not score its own arm",
        "counts": counts,
        "rows": rows,
    }
