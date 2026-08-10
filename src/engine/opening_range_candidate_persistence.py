"""MP-1 — the PERSISTENCE PLANNER: what rows a certified parent spec must become.

AUTHORITY: R-796 §8 lane `J`. Satisfies the committed `A`–`L` contract in
`src/engine/tests/test_mp1_candidate_persistence.py` (R-795 §6 lane `H`).

    `ONE TAUGHT CANDIDATE = ONE DURABLE QUALIFICATION IDENTITY.`  (R-736, R-796 §8)

WHAT THIS MODULE IS
-------------------
A PLANNER and a RESOLVER, and nothing else. It answers two questions:

  * plan    — given a certified compile, which rows must exist? (three, never one)
  * resolve — given a row, which taught bot is it? (proven, never inferred)

It performs NO persistence. It opens no database, issues no SQL, and imports no
TypeScript boundary. `R-796 §9` forbids DB schema changes, and none is needed:
`[PRIOR ART — R-793 §4, measured and published by the DESK first]` the collapse at
`spec-onboarding-service.ts:537` is APPLICATION-LEVEL — `(spec_hash, symbol)` with
no unique index — so the dedupe key is a decision this layer gets to make.

WHY THE THREE ROWS COLLAPSED, AND WHAT ACTUALLY FIXES IT
--------------------------------------------------------
All three taught candidates share one `spec_hash`, one `graph_canonical_hash`, one
`ledger_d`, because all three are computed over the SPEC. Any key built only from
spec-scoped fields therefore cannot tell 5m from 15m from 30m, and candidates 2 and
3 return `skipped_duplicate` silently. The repair is not a bigger hash — it is
adding the ONE dimension the spec does not carry: the candidate's own identity.

    `THE COMPILER DID NOT CHOOSE, SO PERSISTENCE DOES NOT GET TO CHOOSE EITHER.`

WHAT IS DELIBERATELY *NOT* IN THE DEDUPE KEY, AND WHY IT MATTERS
-----------------------------------------------------------------
`cache_identity` is a CONTENT hash; `candidate_id` is an IDENTITY. Only the identity
is in the key. If a candidate's payload is ever restamped, the row must COLLIDE with
its previous version — that is a conflict a human should see — rather than quietly
becoming a fourth row. Keying on content would convert every edit into a new
qualification identity, which is the cardinality collapse running in reverse.

NOTHING IS EVER REPAIRED WITH A DEFAULT
---------------------------------------
`resolve_row_for_execution` refuses a row it cannot prove. It never falls back to
`[0]`, never infers a timeframe, and never reconstructs a variant from prose —
`[0]` is a choice the teacher declined to make, and R-736 eliminated exactly that
default. A resolver that guesses once will guess in production.
"""

from __future__ import annotations

import dataclasses
from typing import Any, Iterable, Optional

from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate
from src.engine.opening_range_candidate_receipt import (
    ExecutionCandidateReceipt,
    build_execution_candidate_receipts,
    resolve_execution_candidate,
)

PERSISTENCE_SCHEMA: str = "OPENING_RANGE_CANDIDATE_PERSISTENCE/1"
"""Versioned for the same reason the receipt is: a future change to what a row
MEANS must be a visible namespace change, never a silent reinterpretation of rows
already written."""


class CandidatePersistenceError(ValueError):
    """A row could not be proven to be the candidate it claims to be.

    Named, so a caller can distinguish "this row is not executable" from an
    incidental `ValueError` raised deeper in the stack.
    `AN ANONYMOUS RAISE TEACHES THE NEXT READER NOTHING.`
    """


@dataclasses.dataclass(frozen=True)
class CandidatePersistenceRow:
    """ONE planned strategy row: a parent, a market, and — for candidate-aware rows —
    the identity of exactly one taught child plus the receipt that proves it.

    🛑 Deliberately PERMISSIVE at construction. A row whose identity and receipt
    disagree, or whose receipt is missing, is a real state that arrives from storage
    and it must be REPRESENTABLE so that `resolve_row_for_execution` can refuse it
    out loud. Refusing in `__post_init__` would move the failure to the reader that
    loaded the row, where it cannot be attributed.

    `A GUARD THAT MAKES A BAD STATE UNREPRESENTABLE ALSO MAKES IT UNTESTABLE WHEN IT
     ARRIVES FROM A DATABASE THAT NEVER READ YOUR DATACLASS.`
    """

    parent_spec_hash: str
    symbol: str
    candidate_id: Optional[str]
    cache_identity: Optional[str]
    receipt: Optional[dict]

    @property
    def is_candidate_aware(self) -> bool:
        """True when this row claims a specific taught child.

        LEGACY rows (the ~120-strategy library) carry no candidate identity and are
        keyed exactly as they always were — R-794 §5: the candidate dimension is
        ADDITIVE and may never silently un-dedupe existing rows.
        """
        return self.candidate_id is not None


def plan_candidate_rows(
    result: Any,
    *,
    symbol: str,
) -> tuple[CandidatePersistenceRow, ...]:
    """One row per taught candidate, in taught order, choosing none of them.

    🛑 Derives entirely from `build_execution_candidate_receipts`, which itself
    derives from the existing `canonical_payload()`. This module does not know how to
    canonicalise a candidate or how to mint an identity, and must never learn:
    `TWO IMPLEMENTATIONS OF ONE CANONICAL FORM ARE A DISAGREEMENT WITH A COMMIT DATE.`

    The receipt is stored in its SERIALISED form — the shape that actually crosses
    the persistence boundary into `strategies.config` — so that what this planner
    validates is what storage will really hand back, not a live object that only
    exists in this process.
    """
    return tuple(
        CandidatePersistenceRow(
            parent_spec_hash=receipt.parent_spec_hash,
            symbol=symbol,
            candidate_id=receipt.candidate_id,
            cache_identity=receipt.cache_identity,
            receipt=receipt.to_payload(),
        )
        for receipt in build_execution_candidate_receipts(result)
    )


def dedupe_key(row: CandidatePersistenceRow) -> tuple:
    """The identity under which a row is 'already persisted'.

    Legacy (no candidate): `(schema, parent_spec_hash, symbol)` — the old meaning
    preserved exactly, so two receiptless rows for one spec+symbol still collide.

    Candidate-aware: the same, PLUS `candidate_id`. That single added dimension is
    the whole repair — without it, three taught bots are one row.
    """
    base = (PERSISTENCE_SCHEMA, row.parent_spec_hash, row.symbol)
    if not row.is_candidate_aware:
        return base
    return base + (row.candidate_id,)


def would_collide(
    existing: Iterable[CandidatePersistenceRow],
    incoming: CandidatePersistenceRow,
) -> bool:
    """Would `incoming` be treated as already-persisted against `existing`?

    This is the predicate `spec-onboarding-service.ts:537` gets wrong today: under
    `(spec_hash, symbol)` it answers True for the 15m candidate when only the 5m one
    exists, and the row is dropped as `skipped_duplicate` with no error.
    """
    key = dedupe_key(incoming)
    return any(dedupe_key(row) == key for row in existing)


def resolve_row_for_execution(
    row: CandidatePersistenceRow,
) -> OpeningRangeExecutionCandidate:
    """Which taught bot is THIS row? Proven from the receipt, or refused.

    THREE anchors, each catching a forgery the others cannot:

      (1) the receipt must EXIST                  — no receipt, no execution
      (2) the receipt's PARENT must match the row — a valid receipt for a different
          spec is still the wrong receipt for this row
      (3) the receipt's own identities must match the row's, and must recompute from
          the payload — delegated to `resolve_execution_candidate`, never rewritten

    🛑 There is no fourth branch that returns something. Every failure path raises.
    """
    if row.receipt is None:
        raise CandidatePersistenceError(
            "this row carries no execution candidate receipt, so the taught variant it "
            "represents cannot be proven; refusing rather than defaulting to a variant "
            "nobody selected.\n"
            f"  parent_spec_hash : {row.parent_spec_hash!r}\n"
            f"  symbol           : {row.symbol!r}\n"
            f"  candidate_id     : {row.candidate_id!r}"
        )

    if row.candidate_id is None or row.cache_identity is None:
        raise CandidatePersistenceError(
            "this row carries a receipt but no OUTER identity to check it against; a "
            "receipt validated only against itself proves the typist, not the author.\n"
            f"  candidate_id   : {row.candidate_id!r}\n"
            f"  cache_identity : {row.cache_identity!r}"
        )

    # (2) The parent anchor. `resolve_execution_candidate` deliberately does not know
    # about rows, so this is the one anchor that belongs to THIS layer rather than the
    # receipt layer — it is added here, not duplicated from there.
    receipt = ExecutionCandidateReceipt.from_payload(row.receipt)
    if receipt.parent_spec_hash != row.parent_spec_hash:
        raise CandidatePersistenceError(
            "the receipt was issued by a different parent spec than this row claims; a "
            "child cannot be joined back to a spec that did not certify it.\n"
            f"  row     : {row.parent_spec_hash!r}\n"
            f"  receipt : {receipt.parent_spec_hash!r}"
        )

    # (3) Rehydration + the outer identity anchors, REUSED rather than reimplemented.
    return resolve_execution_candidate(
        row.receipt,
        persisted_candidate_id=row.candidate_id,
        persisted_cache_identity=row.cache_identity,
    )
