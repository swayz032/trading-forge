"""MP-1 — the EXECUTION CANDIDATE RECEIPT: a serialisation boundary, and nothing more.

AUTHORITY: R-794 §5 (storage decision + the eleven rehydration invariants, carried
verbatim into the ledger), R-793 §3 (`ExecutionCandidateReceipt` adopted), R-785
(the firebreak this module does NOT breach), R-738 (the typed candidate's own
guards, which this module PRESERVES rather than reimplements).

WHAT PROBLEM THIS SOLVES
------------------------
A certified opening-range strategy has THREE taught candidates (5m/15m/30m). They
share one `spec_hash`, one `graph_canonical_hash`, one `ledger_d` — because all
three are computed over the SPEC. Those fields identify the spec and can never say
WHICH VARIANT. So a strategy row that crossed the persistence boundary could not
tell an executor which of the three taught bots it is.

    `THE COMPILER DID NOT CHOOSE, SO PERSISTENCE DOES NOT GET TO CHOOSE EITHER —
     A CARDINALITY COLLAPSE IS A DEFAULT WEARING A SCHEMA'S CLOTHES.`  (R-794 §3)

WHAT THIS MODULE IS NOT
-----------------------
It is NOT a second compiler and NOT a second identity system. The builder derives
everything from the EXISTING `canonical_payload()` — R-794 §5 forbids a second
canonical-payload implementation, because two implementations of one canonical form
are a disagreement with a commit date. It does NOT put the typed candidate inside
`SpecArtifact` (`R-785`'s firebreak, unchanged), and it performs NO persistence.

THE OUTER ANCHOR — WHY VALIDATION DOES NOT END AT THE RECEIPT
-------------------------------------------------------------
A receipt carries its own identity, so a forger who edits the payload and restamps
`candidate_id` produces something internally consistent. That is exactly the `G2`
attack from the seal layer, one layer up. The defence is the same: the ROW carries
the identity it EXPECTS, OUTSIDE the receipt, and `resolve_execution_candidate()`
compares against it.

    `AN ARTIFACT THAT CARRIES ITS OWN CHECKSUM VALIDATES ONLY THE TYPIST, NOT THE
     AUTHOR — THE ANCHOR MUST LIVE OUTSIDE THE THING IT ANCHORS.`

NOTHING IS EVER REPAIRED WITH A DEFAULT (invariant 11)
------------------------------------------------------
Every reader below refuses on a missing OR unknown field. A deserialiser that
tolerates an unexpected shape is a deserialiser that will one day invent one, and
an invented opening-range duration is the precise failure `R-736` eliminated.
"""

from __future__ import annotations

import dataclasses
from typing import Any, Mapping

from src.engine.opening_range_candidate import (
    CANDIDATE_SCHEMA,
    OpeningRangeExecutionCandidate,
)
from src.engine.opening_range_definition import (
    CANONICAL_TYPE,
    OpeningRangeDefinition,
    OpeningRangeProvenance,
    OpeningRangeVariant,
)

RECEIPT_SCHEMA: str = "OPENING_RANGE_EXECUTION_CANDIDATE_RECEIPT/1"
"""Versioned so a future change to the receipt SHAPE is a visible namespace change
rather than a silent reinterpretation of an old payload."""

_RECEIPT_KEYS = frozenset(
    {"schema", "parent_spec_hash", "candidate_id", "cache_identity", "payload"}
)
_PAYLOAD_KEYS = frozenset(
    {"schema", "canonical_type", "source_spec_id", "source_condition_id", "definition", "variant"}
)
_DEFINITION_KEYS = frozenset(
    {
        "session_start_local",
        "source_timezone",
        "market_scope",
        "trading_day_rule",
        "provenance",
        "taught_variants",
    }
)
_PROVENANCE_KEYS = frozenset({"source_quote", "condition_id"})
_VARIANT_KEYS = frozenset({"variant_label", "duration_minutes", "source_quote"})


class ExecutionCandidateReceiptError(ValueError):
    """A receipt was absent, malformed, or disagreed with the identity it claims.

    A named type so a caller can distinguish "this row cannot be executed" from an
    incidental `ValueError` raised somewhere deeper. `AN ANONYMOUS RAISE TEACHES THE
    NEXT READER NOTHING.`
    """


def _exact_keys(obj: Any, expected: frozenset[str], where: str) -> Mapping[str, Any]:
    """Invariant (11). Refuse on BOTH directions — missing and unknown.

    Refusing unknown keys is not pedantry: a field this module does not understand
    is a field some other writer believed was load-bearing, and silently ignoring it
    is how a receipt starts meaning two different things.
    """
    if not isinstance(obj, Mapping):
        raise ExecutionCandidateReceiptError(
            f"receipt {where} is {type(obj).__name__}, expected an object"
        )
    got = set(obj.keys())
    missing, unknown = sorted(expected - got), sorted(got - expected)
    if missing or unknown:
        raise ExecutionCandidateReceiptError(
            f"receipt {where} has the wrong field set; nothing is defaulted or ignored.\n"
            f"  missing : {missing}\n"
            f"  unknown : {unknown}"
        )
    return obj


@dataclasses.dataclass(frozen=True)
class ExecutionCandidateReceipt:
    """The shipping label for ONE executable child of a certified parent spec."""

    parent_spec_hash: str
    candidate_id: str
    cache_identity: str
    payload: dict

    def to_payload(self) -> dict:
        return {
            "schema": RECEIPT_SCHEMA,
            "parent_spec_hash": self.parent_spec_hash,
            "candidate_id": self.candidate_id,
            "cache_identity": self.cache_identity,
            "payload": self.payload,
        }

    @classmethod
    def from_payload(cls, raw: Any) -> "ExecutionCandidateReceipt":
        # Invariant (10) is enforced in `resolve_execution_candidate`, but a None
        # arriving here directly must not crash with an anonymous TypeError.
        if raw is None:
            raise ExecutionCandidateReceiptError(
                "no execution candidate receipt was supplied"
            )
        d = _exact_keys(raw, _RECEIPT_KEYS, "envelope")

        # Invariant (1) — receipt schema recognised.
        if d["schema"] != RECEIPT_SCHEMA:
            raise ExecutionCandidateReceiptError(
                f"unrecognised receipt schema {d['schema']!r}; expected {RECEIPT_SCHEMA!r}"
            )
        # Invariant (7) — parent present and non-empty.
        if not isinstance(d["parent_spec_hash"], str) or not d["parent_spec_hash"]:
            raise ExecutionCandidateReceiptError(
                "receipt carries no parent_spec_hash; an executable child with no parent "
                "cannot be joined back to the spec that certified it"
            )
        return cls(
            parent_spec_hash=d["parent_spec_hash"],
            candidate_id=d["candidate_id"],
            cache_identity=d["cache_identity"],
            payload=dict(d["payload"]),
        )


def build_execution_candidate_receipts(
    result: Any,
) -> tuple[ExecutionCandidateReceipt, ...]:
    """One receipt per taught candidate, in taught order, choosing none of them.

    🛑 Derives from the EXISTING `canonical_payload()` (R-794 §5). This module does
    not know how to canonicalise a candidate and must never learn.
    """
    parent_spec_hash = result.artifact["spec_hash"]
    return tuple(
        ExecutionCandidateReceipt(
            parent_spec_hash=parent_spec_hash,
            candidate_id=candidate.candidate_id,
            cache_identity=candidate.cache_identity,
            payload=candidate.canonical_payload(),
        )
        for candidate in result.opening_range_candidates
    )


def _candidate_from_canonical_payload(payload: Any) -> OpeningRangeExecutionCandidate:
    """Rebuild the typed candidate, refusing anything the canonical form did not say."""
    p = _exact_keys(payload, _PAYLOAD_KEYS, "payload")

    # Invariant (2) — canonical candidate schema recognised.
    if p["schema"] != CANDIDATE_SCHEMA:
        raise ExecutionCandidateReceiptError(
            f"unrecognised candidate schema {p['schema']!r}; expected {CANDIDATE_SCHEMA!r}"
        )
    if p["canonical_type"] != CANONICAL_TYPE:
        raise ExecutionCandidateReceiptError(
            f"receipt carries canonical_type {p['canonical_type']!r}, not {CANONICAL_TYPE!r}"
        )

    # Invariant (3) — the source definition is complete, field by field.
    d = _exact_keys(p["definition"], _DEFINITION_KEYS, "payload.definition")
    prov = _exact_keys(p["definition"]["provenance"], _PROVENANCE_KEYS, "payload.definition.provenance")

    taught = d["taught_variants"]
    if not isinstance(taught, (list, tuple)) or not taught:
        raise ExecutionCandidateReceiptError(
            "receipt carries no taught variants; a definition that taught nothing cannot "
            "yield an execution candidate"
        )
    variants = tuple(
        OpeningRangeVariant(
            variant_label=v["variant_label"],
            duration_minutes=v["duration_minutes"],
            source_quote=v["source_quote"],
        )
        for v in (
            _exact_keys(raw, _VARIANT_KEYS, "payload.definition.taught_variants[]")
            for raw in taught
        )
    )
    definition = OpeningRangeDefinition(
        session_start_local=d["session_start_local"],
        source_timezone=d["source_timezone"],
        variants=variants,
        market_scope=d["market_scope"],
        trading_day_rule=d["trading_day_rule"],
        provenance=OpeningRangeProvenance(
            source_quote=prov["source_quote"],
            condition_id=prov["condition_id"],
        ),
    )

    v = _exact_keys(p["variant"], _VARIANT_KEYS, "payload.variant")
    selected = OpeningRangeVariant(
        variant_label=v["variant_label"],
        duration_minutes=v["duration_minutes"],
        source_quote=v["source_quote"],
    )

    # Invariant (4) — the selected variant must be one the source TAUGHT. 🛑 Enforced by
    # `OpeningRangeExecutionCandidate.__post_init__` (R-738), NOT duplicated here.
    # `TWO IMPLEMENTATIONS OF ONE GUARD ARE A DISAGREEMENT WITH A COMMIT DATE.`
    try:
        return OpeningRangeExecutionCandidate(
            source_spec_id=p["source_spec_id"],
            source_condition_id=p["source_condition_id"],
            definition=definition,
            variant=selected,
        )
    except ValueError as exc:
        raise ExecutionCandidateReceiptError(
            f"the receipt's selected variant is not one this definition taught: {exc}"
        ) from exc


def rehydrate_candidate(
    receipt: ExecutionCandidateReceipt,
) -> OpeningRangeExecutionCandidate:
    """Reconstruct the typed candidate and prove the receipt describes what it carries.

    Invariants (5) and (6): both identities are RECOMPUTED from the payload and
    compared to what the receipt claims. This is what makes a self-repaired receipt
    — payload edited, `candidate_id` honestly restamped — still die: repairing one
    identity leaves the other stale.
    """
    candidate = _candidate_from_canonical_payload(receipt.payload)

    if candidate.candidate_id != receipt.candidate_id:
        raise ExecutionCandidateReceiptError(
            "receipt candidate_id does not match one recomputed from its own payload.\n"
            f"  receipt claims : {receipt.candidate_id!r}\n"
            f"  payload yields : {candidate.candidate_id!r}"
        )
    if candidate.cache_identity != receipt.cache_identity:
        raise ExecutionCandidateReceiptError(
            "receipt cache_identity does not match a hash recomputed from its own "
            "payload; the payload was edited after the receipt was stamped.\n"
            f"  receipt claims : {receipt.cache_identity}\n"
            f"  payload yields : {candidate.cache_identity}"
        )
    return candidate


def resolve_execution_candidate(
    receipt_payload: Any,
    *,
    persisted_candidate_id: str,
    persisted_cache_identity: str,
) -> OpeningRangeExecutionCandidate:
    """The execution entry point: which taught bot is THIS row, proven twice.

    🛑 Invariant (10): a row with no receipt REFUSES. It never falls back to the
    first taught candidate, because `[0]` is a choice the teacher declined to make
    and `R-736` eliminated exactly that default.

    Invariants (8) and (9): the OUTER anchors. `persisted_*` come from the strategy
    row, OUTSIDE the receipt, so a receipt that validates perfectly against itself
    is still refused when it is the wrong receipt for this row.
    """
    if receipt_payload is None:
        raise ExecutionCandidateReceiptError(
            "no execution candidate receipt accompanies this strategy row; refusing "
            "rather than defaulting to a taught variant nobody selected"
        )

    candidate = rehydrate_candidate(ExecutionCandidateReceipt.from_payload(receipt_payload))

    if candidate.candidate_id != persisted_candidate_id:
        raise ExecutionCandidateReceiptError(
            "the receipt is for a different candidate than this row persisted.\n"
            f"  receipt : {candidate.candidate_id!r}\n"
            f"  row     : {persisted_candidate_id!r}"
        )
    if candidate.cache_identity != persisted_cache_identity:
        raise ExecutionCandidateReceiptError(
            "the receipt's cache_identity disagrees with the identity this row "
            "persisted; the receipt and the row describe different versions of the "
            "same candidate"
        )
    return candidate
