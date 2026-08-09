"""B1 STEP 6B — the opening-range CARRIER: how a lowered definition reaches the engine.

AUTHORITY: `R-745 §4` (the scope amendment that makes this legal), `R-745 §5` (the
identity contract, adopted in full on merit from the external read).

THE PROBLEM THIS SOLVES
-----------------------
`STEP 6A` built the source lowering and the candidate expansion and wired them to
NOTHING — `AR-841 §1` measured zero production callers, control-probed. The
executable layer receives only the compiled spec, whose conditions carry `object`
text but not the taught spans the lowering reads. So there was no path from a
frozen extraction to the adapter at all, and `R-744 §6(2)`'s *"the real adapter
called exactly three times"* was unreachable (`R-745 §2`, the desk's own finding
against itself).

THE TWO PROPERTIES THAT MAKE THIS CARRIER SAFE
----------------------------------------------
**1. HASH-NEUTRAL.** The carrier attaches at the ARTIFACT TOP LEVEL, never inside
`compiled_spec["spec"]`. `spec_producer._spec_hash` hashes the entire spec body,
and `spec_hash` values are pinned in frozen artifacts, so a field added inside it
would invalidate receipts. Attaching outside makes neutrality a property of the
SHAPE rather than a measurement someone has to keep re-taking.

**2. IDENTITY-SAFE — AND THE FIRST DOES NOT IMPLY THE SECOND.**

    `HASH-NEUTRAL IS NOT IDENTITY-SAFE.` (`R-745 §5`)

A sidecar that changes while `spec_hash` does not COLLIDES in any consumer keyed
on `spec_hash` alone. Worse, a perfectly well-formed carrier attached to the WRONG
strategy is *plausible* — and

    `A CORRECTLY SHAPED SIDECAR ATTACHED TO THE WRONG STRATEGY IS PLAUSIBLE, AND
     PLAUSIBLE IS THIS CAMPAIGN'S FAILURE MODE.`

So the carrier binds itself to its artifact by `source_spec_hash`, records the
extraction identity it was lowered from, enumerates its candidate membership
EXACTLY, and carries a canonical hash over all of it. `join_carrier()` REFUSES on
any disagreement, BEFORE the adapter runs.

NO FALLBACKS. NOT ONE.
----------------------
`R-745 §5`, adopted verbatim: a failed join never falls back to reparsing prose, a
default duration, the condition slug, `compute_structure_state`, or
`refused_state()` dressed as success. Every one of those turns a detectable
mismatch into a confident wrong answer.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate

CARRIER_SCHEMA: str = "opening_range_carrier/v1"
"""Schema version. An UNRECOGNISED version is a REFUSAL, never a best-effort read:
a consumer that guesses at an unknown shape is how a field silently changes meaning."""

SUPPORTED_SCHEMAS: frozenset[str] = frozenset({CARRIER_SCHEMA})


class CarrierJoinRefused(ValueError):
    """A carrier could not be joined to the artifact presenting it.

    Its own exception type so a test can require THIS refusal rather than any
    `ValueError` that happens to escape — an assertion satisfied by any exception
    cannot tell a working join from a typo.
    """


@dataclass(frozen=True)
class OpeningRangeCarrier:
    """ONE lowered opening-range condition, bound to the artifact it belongs to.

    Every field is either a `str`, an `int`, a tuple of those, or a frozen
    candidate object. Nothing here depends on dict ordering or on a repr.
    """

    schema: str
    source_spec_hash: str
    """THE JOIN KEY. The `spec_hash` of the artifact this carrier was produced
    alongside. A carrier presented with any other artifact is refused."""

    source_extraction_sha256: str | None
    """SHA-256 of the frozen extraction FILE, when the caller knows it.

    `None` is an HONEST GAP, not a hole in the contract: `produce_spec_artifact`
    receives a strategy RECORD, not the file bytes, so it cannot compute this
    itself. Callers that read the file supply it; callers that do not leave it
    `None`, and `source_record_digest` below still binds the carrier to the exact
    record it was lowered from. `AN ABSENT VALUE THAT SAYS IT IS ABSENT IS SAFE;
    AN INVENTED ONE IS NOT.`"""

    source_record_digest: str
    """SHA-256 over the canonical strategy record the lowering actually read.
    ALWAYS computable, so extraction identity is never merely absent."""

    source_spec_id: str
    source_condition_id: str

    disposition: str
    """`READY` / `SOURCE_INCOMPLETE` / `SOURCE_AMBIGUOUS` — the lowering's own
    structured disposition, copied, never re-derived."""

    failure_kind: str | None
    missing_fields: tuple[str, ...]
    conflict_fields: tuple[str, ...]
    """The refusal's structured reason, or `None`/empty on `READY`. Consumers read
    THESE, never `internal_reason` — `a downstream mapper that parses prose is a
    second parser waiting to disagree` (`R-742 §3`)."""

    candidates: tuple[OpeningRangeExecutionCandidate, ...]
    """EXACT membership, in taught order. Empty on any refusal disposition."""

    carrier_hash: str
    """SHA-256 over this carrier's canonical payload, EXCLUDING ITSELF. Recomputed
    on join; a mismatch is a refusal."""

    def __post_init__(self) -> None:
        if self.schema not in SUPPORTED_SCHEMAS:
            raise ValueError(
                f"carrier schema {self.schema!r} is not supported "
                f"({sorted(SUPPORTED_SCHEMAS)}); an unrecognised version is refused rather "
                "than read on a best-effort basis"
            )
        if self.disposition == "READY" and not self.candidates:
            raise ValueError(
                "a READY carrier must enumerate at least one execution candidate; an empty "
                "READY carrier would join successfully and then compute nothing"
            )
        if self.disposition != "READY" and self.candidates:
            raise ValueError(
                f"disposition {self.disposition!r} carries {len(self.candidates)} candidates; "
                "a refusal carries no definition and therefore no candidates"
            )

    def candidate_ids(self) -> tuple[str, ...]:
        return tuple(c.candidate_id for c in self.candidates)

    def cache_identities(self) -> tuple[str, ...]:
        return tuple(c.cache_identity for c in self.candidates)

    def execution_identity(self) -> tuple[str, ...]:
        """THE CACHE KEY ANY OPENING-RANGE EXECUTION CACHE MUST USE.

        `R-745 §5`: no opening-range execution cache may key on `spec_hash` alone.
        Two artifacts sharing a `spec_hash` can carry different carriers, so a
        `spec_hash`-keyed cache collides and serves one strategy's ranges to
        another. This is the complete ordered candidate identity plus the carrier
        hash — it changes when anything that changes the OUTPUT changes.
        """
        return (self.carrier_hash, *self.cache_identities())


def _canonical_payload(
    *,
    schema: str,
    source_spec_hash: str,
    source_extraction_sha256: str | None,
    source_record_digest: str,
    source_spec_id: str,
    source_condition_id: str,
    disposition: str,
    failure_kind: str | None,
    missing_fields: tuple[str, ...],
    conflict_fields: tuple[str, ...],
    candidates: tuple[OpeningRangeExecutionCandidate, ...],
) -> dict:
    """The order-stable description `carrier_hash` is derived from.

    Built by EXPLICIT FIELD ENUMERATION in a fixed order — never by iterating
    `__dict__`, a set or a dict, whose orders are not part of any contract. The
    same discipline `OpeningRangeExecutionCandidate.canonical_payload` uses, and
    for the same reason: an identity that depends on iteration order is not an
    identity.
    """
    return {
        "schema": schema,
        "source_spec_hash": source_spec_hash,
        "source_extraction_sha256": source_extraction_sha256,
        "source_record_digest": source_record_digest,
        "source_spec_id": source_spec_id,
        "source_condition_id": source_condition_id,
        "disposition": disposition,
        "failure_kind": failure_kind,
        "missing_fields": list(missing_fields),
        "conflict_fields": list(conflict_fields),
        # FULL canonical payloads, not just ids. R-745 §5 requires both: ids alone
        # would let a taught quote change while the identity held.
        "candidates": [c.canonical_payload() for c in candidates],
        "candidate_ids": [c.candidate_id for c in candidates],
        "cache_identities": [c.cache_identity for c in candidates],
    }


def canonical_digest(payload: dict) -> str:
    """SHA-256 over a canonical JSON serialisation.

    `sort_keys=True` so the digest cannot depend on insertion order, and
    `ensure_ascii=False` + explicit UTF-8 so a non-ASCII source quote hashes the
    same on every platform. Identical serialisation discipline to
    `OpeningRangeExecutionCandidate.cache_identity`, so the two digests are
    comparable artifacts rather than two conventions that happen to coexist.
    """
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def build_carrier(
    *,
    source_spec_hash: str,
    source_extraction_sha256: str | None,
    strategy_record: dict,
    source_spec_id: str,
    source_condition_id: str,
    disposition: str,
    failure_kind: str | None,
    missing_fields: tuple[str, ...],
    conflict_fields: tuple[str, ...],
    candidates: tuple[OpeningRangeExecutionCandidate, ...],
) -> OpeningRangeCarrier:
    """Assemble a carrier and seal it with its canonical hash."""
    record_digest = canonical_digest({"strategy_record": strategy_record})
    payload = _canonical_payload(
        schema=CARRIER_SCHEMA,
        source_spec_hash=source_spec_hash,
        source_extraction_sha256=source_extraction_sha256,
        source_record_digest=record_digest,
        source_spec_id=source_spec_id,
        source_condition_id=source_condition_id,
        disposition=disposition,
        failure_kind=failure_kind,
        missing_fields=missing_fields,
        conflict_fields=conflict_fields,
        candidates=candidates,
    )
    return OpeningRangeCarrier(
        schema=CARRIER_SCHEMA,
        source_spec_hash=source_spec_hash,
        source_extraction_sha256=source_extraction_sha256,
        source_record_digest=record_digest,
        source_spec_id=source_spec_id,
        source_condition_id=source_condition_id,
        disposition=disposition,
        failure_kind=failure_kind,
        missing_fields=missing_fields,
        conflict_fields=conflict_fields,
        candidates=candidates,
        carrier_hash=canonical_digest(payload),
    )


def recompute_carrier_hash(carrier: OpeningRangeCarrier) -> str:
    """Re-derive the carrier hash from the carrier's own contents."""
    return canonical_digest(
        _canonical_payload(
            schema=carrier.schema,
            source_spec_hash=carrier.source_spec_hash,
            source_extraction_sha256=carrier.source_extraction_sha256,
            source_record_digest=carrier.source_record_digest,
            source_spec_id=carrier.source_spec_id,
            source_condition_id=carrier.source_condition_id,
            disposition=carrier.disposition,
            failure_kind=carrier.failure_kind,
            missing_fields=carrier.missing_fields,
            conflict_fields=carrier.conflict_fields,
            candidates=carrier.candidates,
        )
    )


def join_carrier(
    carrier: object,
    *,
    artifact_spec_hash: str,
    condition_id: str,
) -> OpeningRangeCarrier:
    """Bind a carrier to the artifact presenting it, or REFUSE — before execution.

    `R-745 §5`'s refusal list, each check its own branch with its own message so a
    failure says WHICH invariant broke rather than "the carrier is bad":

      * not a carrier at all / malformed membership
      * unsupported schema version
      * `source_spec_hash` mismatch  — THE SWAP CASE
      * unknown condition id
      * carrier-hash disagreement (contents mutated after sealing)

    THE SWAP CASE IS THE ONE THAT MATTERS. A *valid* carrier moved to a *different*
    artifact is well-formed, hashes correctly against itself, and is completely
    wrong. Only `source_spec_hash` catches it, and it must be checked BEFORE the
    adapter runs — after is too late, because by then the numbers exist and look
    like measurements.
    """
    if not isinstance(carrier, OpeningRangeCarrier):
        raise CarrierJoinRefused(
            f"opening-range carrier for condition {condition_id!r} is "
            f"{type(carrier).__name__}, not an OpeningRangeCarrier. A dict or a decoded "
            "JSON blob is refused: the typed carrier is the contract, and reading an "
            "untyped one would be a second parser."
        )
    if carrier.schema not in SUPPORTED_SCHEMAS:
        raise CarrierJoinRefused(
            f"carrier schema {carrier.schema!r} is not supported "
            f"({sorted(SUPPORTED_SCHEMAS)}); refused rather than read on a best-effort basis"
        )
    if carrier.source_spec_hash != artifact_spec_hash:
        raise CarrierJoinRefused(
            "opening-range carrier does not belong to this artifact — REFUSED BEFORE THE "
            "ADAPTER RAN.\n"
            f"  carrier was built for spec_hash : {carrier.source_spec_hash}\n"
            f"  artifact presenting it          : {artifact_spec_hash}\n"
            "A correctly shaped carrier attached to the wrong strategy is plausible, and "
            "computing its ranges would produce numbers that look measured."
        )
    if carrier.source_condition_id != condition_id:
        raise CarrierJoinRefused(
            f"carrier names condition {carrier.source_condition_id!r} but was presented for "
            f"{condition_id!r}; a carrier is bound to ONE condition and following it to "
            "another would silently compile a different sentence"
        )
    recomputed = recompute_carrier_hash(carrier)
    if recomputed != carrier.carrier_hash:
        raise CarrierJoinRefused(
            "carrier hash does not re-derive from its own contents — it was mutated after "
            "sealing.\n"
            f"  sealed     : {carrier.carrier_hash}\n"
            f"  recomputed : {recomputed}"
        )
    return carrier
