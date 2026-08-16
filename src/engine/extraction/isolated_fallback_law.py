"""FROZEN ISOLATED-FALLBACK SELECTION LAW — AR-1247 §9.

WHY THIS EXISTS BEFORE ANY EXPENSIVE CALL
    AR-1247 §9: *"Before the first isolated Opus invocation, commit the deterministic fallback
    law."* The order is the whole point. A selection rule written AFTER the answers are visible
    cannot be distinguished from a rule chosen because it produced the nicer answer — and
    AR-1234 §4 already named "Opus found a quote -> condition certified" as the wrong
    architecture. Freezing the queue first is what makes the later run auditable.

WHAT IT PINS (each item is AR-1247 §9's, in order)
    input route version              -> `input_route_version`, copied from the route record
    which dispositions earn fallback -> `eligible_dispositions`, taken from the ROUTE's own
                                        published `ESCALATES_TO_ISOLATED` contract
    one attempt maximum              -> `MAX_ATTEMPTS_PER_CONDITION`, enforced by `record_attempt`
    condition_ref -> frozen hashes   -> `task_input_sha256` per entry
    no ACCEPTED condition escalates  -> refused in `freeze_isolated_queue`
    no retry-after-failure loop      -> `record_attempt` raises on the second attempt, and an
                                        attempt is recorded BEFORE the answer is seen
    no best-of cherry-pick           -> `substitute_isolated_answer` takes the raw return and
                                        stores it; there is no API that compares batch vs
                                        isolated and keeps the better one
    substitution rule declared first -> `SUBSTITUTION_RULE`, a module constant, hashed into the
                                        frozen artifact so a later edit is detectable
    raw output preserved before parse-> `raw_output` is stored verbatim on the attempt record
                                        before any verification runs

THE SELECTION DERIVES FROM DISPOSITION, NEVER FROM A HAND-PICKED LIST (§9)
    `freeze_isolated_queue` reads the route record's outcomes. There is no parameter through
    which a caller can name the conditions it wants re-queried. An unregistered blocking
    disposition RAISES rather than being silently dropped — a condition that blocks acceptance
    but is missing from the eligible set would otherwise vanish from the fallback queue and
    look like it had been handled.

Generic by construction: no strategy, instrument, timeframe, video id or teacher string.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from .opus_phase1_route import ACCEPTED, ESCALATES_TO_ISOLATED

__all__ = [
    "FALLBACK_LAW_VERSION",
    "MAX_ATTEMPTS_PER_CONDITION",
    "SUBSTITUTION_RULE",
    "FrozenQueue",
    "freeze_isolated_queue",
    "record_attempt",
    "substitute_isolated_answer",
]

FALLBACK_LAW_VERSION = "isolated-fallback-law-v1"
MAX_ATTEMPTS_PER_CONDITION = 1

# DECLARED BEFORE ANY OUTPUT EXISTS. Hashed into every frozen artifact, so editing it after a
# run is detectable by comparing `substitution_rule_sha256` against this module.
SUBSTITUTION_RULE = (
    "The isolated return REPLACES the batch candidate for its condition if and only if it "
    "passes literal verification against the pinned transcript. It is then re-run through the "
    "complete final-set collision, primary relevance, mechanically authorized antecedent "
    "composition and fidelity, in that order. A worse isolated answer does not restore the "
    "batch candidate: the condition remains unresolved and RED. There is no comparison step "
    "between the batch and isolated answers, and therefore no way to keep whichever grades "
    "greener."
)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class FrozenQueue:
    """The committed pre-call artifact. `attempts` is the only mutable part, and it only ever
    grows — an attempt is never removed, so a retry cannot hide behind a cleared ledger."""

    law_version: str
    authority: str
    input_route_version: str
    eligible_dispositions: list[str]
    max_attempts_per_condition: int
    substitution_rule: str
    substitution_rule_sha256: str
    pinned_inputs: dict[str, str]
    queue: list[dict]
    excluded: list[dict]
    attempts: dict[str, dict] = field(default_factory=dict)

    def refs(self) -> list[str]:
        return [e["condition_ref"] for e in self.queue]

    def as_dict(self) -> dict[str, Any]:
        d = dict(self.__dict__)
        return d


def freeze_isolated_queue(
    route_record: dict,
    pinned_inputs: dict[str, str],
    condition_texts: dict[str, str],
) -> FrozenQueue:
    """Derive the isolated-fallback queue from the route's own dispositions and freeze it.

    `pinned_inputs`: identity of everything the isolated task will be given — e.g.
    {"transcript_sha256": ..., "extraction_sha256": ..., "video_id": ...}. Hashed into every
    entry so a later run against different inputs is detectable rather than assumed equivalent.
    """
    if not route_record.get("route_version"):
        raise ValueError(
            "the route record carries no `route_version`. A fallback queue frozen against an "
            "unidentified route cannot be shown to match the run it was derived from."
        )
    if not pinned_inputs:
        raise ValueError(
            "no pinned inputs supplied. The isolated task must be pinned to the same transcript "
            "and extraction as the batch run, or the two answers are not comparable evidence."
        )

    eligible = set(ESCALATES_TO_ISOLATED)
    queue: list[dict] = []
    excluded: list[dict] = []

    for o in route_record.get("outcomes", []):
        ref = o["condition_ref"]
        disp = o["disposition"]

        if disp == ACCEPTED:
            # §9: no accepted condition may receive isolated treatment. Re-querying a condition
            # that already cleared every gate is how a stable answer gets churned until it
            # matches a preference.
            excluded.append({
                "condition_ref": ref, "disposition": disp,
                "why": "ACCEPTED conditions never escalate (AR-1247 §9)",
            })
            continue

        if disp not in eligible:
            # DETECTED, NOT DROPPED. A blocking disposition missing from the route's published
            # escalation contract would silently disappear from the fallback queue and read as
            # though it had been handled.
            raise ValueError(
                f"condition {ref!r} carries blocking disposition {disp!r}, which is NOT in the "
                f"route's published ESCALATES_TO_ISOLATED contract {sorted(eligible)}. A "
                "blocking disposition absent from the escalation set would vanish from the "
                "fallback queue and look handled. Register it in the route or fix the "
                "disposition — do not let this pass."
            )

        text = condition_texts.get(ref)
        if not text:
            raise ValueError(
                f"condition {ref!r} is queued for isolated fallback but has no condition text; "
                "the isolated task contract would be empty."
            )

        payload = json.dumps({
            "law_version": FALLBACK_LAW_VERSION,
            "route_version": route_record["route_version"],
            "condition_ref": ref,
            "condition_text": text,
            "pinned_inputs": dict(sorted(pinned_inputs.items())),
        }, sort_keys=True, separators=(",", ":"))

        queue.append({
            "condition_ref": ref,
            "disposition": disp,
            "gate": o.get("gate"),
            "reason": o.get("reason"),
            "condition_text": text,
            "task_input_sha256": _sha(payload),
        })

    return FrozenQueue(
        law_version=FALLBACK_LAW_VERSION,
        authority="AR-1247 §9 (freeze the selection law before the first isolated call)",
        input_route_version=route_record["route_version"],
        eligible_dispositions=sorted(eligible),
        max_attempts_per_condition=MAX_ATTEMPTS_PER_CONDITION,
        substitution_rule=SUBSTITUTION_RULE,
        substitution_rule_sha256=_sha(SUBSTITUTION_RULE),
        pinned_inputs=dict(sorted(pinned_inputs.items())),
        queue=queue,
        excluded=excluded,
    )


def record_attempt(frozen: FrozenQueue, condition_ref: str) -> dict:
    """Claim the single permitted attempt for `condition_ref`, BEFORE the answer is known.

    Recording before the call is deliberate: a ledger written afterwards can be skipped when
    the answer disappoints, which is precisely the retry loop §9 forbids.
    """
    if condition_ref not in frozen.refs():
        raise ValueError(
            f"{condition_ref!r} is not in the frozen queue. Only conditions the deterministic "
            "route selected may be escalated; adding one by hand is the manual list §9 forbids."
        )
    prior = frozen.attempts.get(condition_ref)
    if prior is not None:
        raise ValueError(
            f"{condition_ref!r} has already used its {MAX_ATTEMPTS_PER_CONDITION} permitted "
            "isolated attempt. A second call is a retry-until-green loop, and a worse first "
            "answer is an allowed outcome that leaves the condition RED."
        )
    entry = next(e for e in frozen.queue if e["condition_ref"] == condition_ref)
    frozen.attempts[condition_ref] = {
        "condition_ref": condition_ref,
        "task_input_sha256": entry["task_input_sha256"],
        "raw_output": None,
        "completed": False,
    }
    return frozen.attempts[condition_ref]


def substitute_isolated_answer(frozen: FrozenQueue, condition_ref: str, raw_output: str) -> dict:
    """Store the isolated return VERBATIM against its claimed attempt.

    Raw first, parsing later (§9). Nothing here inspects, shortens or scores the answer — the
    module offers no way to compare it against the batch candidate, which is what makes
    "pick whichever grades greener" unavailable rather than merely discouraged.
    """
    attempt = frozen.attempts.get(condition_ref)
    if attempt is None:
        raise ValueError(
            f"no attempt was recorded for {condition_ref!r} before its answer arrived. The "
            "attempt ledger is written before the call so a disappointing answer cannot be "
            "quietly discarded and retried."
        )
    if attempt["completed"]:
        raise ValueError(
            f"{condition_ref!r} already has a stored isolated answer; overwriting it would erase "
            "the raw return that the whole fallback exists to preserve."
        )
    attempt["raw_output"] = raw_output
    attempt["raw_output_sha256"] = _sha(raw_output if raw_output is not None else "")
    attempt["completed"] = True
    return attempt
