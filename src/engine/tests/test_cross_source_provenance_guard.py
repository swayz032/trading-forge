"""AR-1110 §6 — THE CROSS-SOURCE PROVENANCE GUARD.

Authority: AR-1110 (gpt-rulings `25a7d8d5`) §6, required discriminator 1-4.

WHAT THIS FILE EXISTS TO MAKE IMPOSSIBLE
----------------------------------------
`[MEASURED, AR-1109 / AR-1110 §2.3]` two committed fixtures taught a 15-MINUTE
opening range on 5-MINUTE bars while stamping themselves `svkm-source-vertical__s0`.
The sVkm teacher taught a FIVE-minute range with ONE-minute execution. The artifacts
were internally consistent at every layer — receipt matched row, row matched payload,
payload recomputed — and every existing anchor passed, because not one of them ever
compared the candidate against THE SPEC BEING EXECUTED.

    ★ `THREE ANCHORS THAT ONLY CHECK EACH OTHER PROVE THE PAPERWORK IS TIDY,
       NOT THAT IT DESCRIBES THIS TRADE.`

So the guard added at `backtester.resolve_candidate_authority` is anchor (4):
this run's `compiled_spec.spec_hash` must BE the parent that certified the candidate.

WHY THE MUTATION CONTROL HERE IS AN ABLATION, NOT A MONKEYPATCH
---------------------------------------------------------------
`test_the_old_three_anchors_ACCEPT_the_swap` calls `resolve_row_for_execution`
directly — the exact pre-AR-1110 code path, unmodified — and asserts it returns a
candidate for the swapped pair. That is the positive witness that the defect was
REAL and that anchor (4) is the thing now catching it. A guard whose red I cannot
attribute is a guard I cannot trust.
"""

from __future__ import annotations

import pytest

from src.engine.backtester import (
    _CANDIDATE_PARENT_KEY,
    resolve_candidate_authority,
)
from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate
from src.engine.opening_range_candidate_persistence import (
    CandidatePersistenceRow,
    resolve_row_for_execution,
)
from src.engine.opening_range_candidate_receipt import ExecutionCandidateReceipt
from src.engine.opening_range_definition import (
    OpeningRangeDefinition,
    OpeningRangeProvenance,
    OpeningRangeVariant,
)

# ── DISCRIMINATOR 1: two distinct source identities with DIFFERENT timeframe facts ──
#
# LESSON A — a 15-minute opening range. (The lesson the old fixtures actually carried.)
# LESSON B — a 5-minute opening range.  (The shape sVkm's teacher actually taught,
#            per AR-1109 §1: the first 09:30 five-minute candle.)
# They differ in the one fact that decides where money is committed, so a swap that
# survives is a swap that changes trading behaviour.

LESSON_A_SPEC_ID = "lesson-a-fifteen-minute-range__s0"
LESSON_A_SPEC_HASH = "lesson-a-spec-hash"
LESSON_B_SPEC_ID = "lesson-b-five-minute-range__s0"
LESSON_B_SPEC_HASH = "lesson-b-spec-hash"
OR_CONDITION_ID = "OPENING_RANGE_DEFINITION:the-opening-range#0"


def _candidate(spec_id: str, duration: int, label: str) -> OpeningRangeExecutionCandidate:
    variant = OpeningRangeVariant(
        variant_label=label,
        duration_minutes=duration,
        source_quote=f"SYNTHETIC — lesson taught a {duration} minute range",
    )
    definition = OpeningRangeDefinition(
        session_start_local="09:30",
        source_timezone="America/New_York",
        variants=(variant,),
        market_scope="SYNTHETIC guard fixture — no source video",
        trading_day_rule="relative for every single trading day",
        provenance=OpeningRangeProvenance(
            source_quote=f"SYNTHETIC — lesson taught a {duration} minute range",
            condition_id=OR_CONDITION_ID,
        ),
    )
    return OpeningRangeExecutionCandidate(
        source_spec_id=spec_id,
        source_condition_id=OR_CONDITION_ID,
        definition=definition,
        variant=variant,
    )


def _config(*, candidate, parent_spec_hash: str, executed_spec_hash: str) -> dict:
    """A Band-C-shaped config. `parent_spec_hash` is who CERTIFIED the candidate;
    `executed_spec_hash` is the spec this run actually carries. Honest configs agree."""
    return {
        "symbol": "MES",
        "strategy": {"name": "guard-fixture", "symbol": "MES"},
        "compiled_spec": {"spec": {}, "spec_hash": executed_spec_hash},
        "execution_candidate_id": candidate.candidate_id,
        "execution_candidate_cache_identity": candidate.cache_identity,
        "execution_candidate_receipt": ExecutionCandidateReceipt(
            parent_spec_hash=parent_spec_hash,
            candidate_id=candidate.candidate_id,
            cache_identity=candidate.cache_identity,
            payload=candidate.canonical_payload(),
        ).to_payload(),
        _CANDIDATE_PARENT_KEY: parent_spec_hash,
    }


@pytest.fixture
def lesson_a():
    return _candidate(LESSON_A_SPEC_ID, 15, "15m")


@pytest.fixture
def lesson_b():
    return _candidate(LESSON_B_SPEC_ID, 5, "5m")


# ── THE POSITIVE WITNESS — the guard must let honest work through ────────────
# Without this, a guard that refuses EVERYTHING would pass the swap test below and
# look like a success. `A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS THAT THE PATH RAN.`


def test_an_honest_config_still_resolves(lesson_a):
    refusal, candidate = resolve_candidate_authority(
        _config(
            candidate=lesson_a,
            parent_spec_hash=LESSON_A_SPEC_HASH,
            executed_spec_hash=LESSON_A_SPEC_HASH,
        )
    )
    assert refusal is None, f"the guard refused an honest config: {refusal}"
    assert candidate is not None
    assert candidate.source_spec_id == LESSON_A_SPEC_ID
    assert candidate.variant.duration_minutes == 15


def test_legacy_configs_with_no_candidate_sidecar_are_untouched():
    """The guard may not change the legacy path — REPAIR D behaviour."""
    refusal, candidate = resolve_candidate_authority(
        {"symbol": "MES", "compiled_spec": {"spec": {}, "spec_hash": "anything"}}
    )
    assert refusal is None
    assert candidate is None


# ── DISCRIMINATORS 2 + 3: attach lesson A's evidence to lesson B's spec identity ──


def test_lesson_a_candidate_under_lesson_b_spec_is_REFUSED(lesson_a):
    """The exact defect AR-1110 §2.3 upgraded to blocking: one lesson's opening
    range executing under another lesson's spec identity."""
    refusal, candidate = resolve_candidate_authority(
        _config(
            candidate=lesson_a,
            parent_spec_hash=LESSON_A_SPEC_HASH,
            executed_spec_hash=LESSON_B_SPEC_HASH,  # <-- the swap
        )
    )
    assert candidate is None, "a cross-source candidate was handed to the engine"
    assert refusal is not None
    blob = str(refusal)
    assert "cross-source provenance" in blob, blob
    # The refusal must NAME both sides, or the reader cannot tell which artifact moved.
    assert LESSON_A_SPEC_HASH in blob and LESSON_B_SPEC_HASH in blob, blob


def test_the_swap_is_refused_in_the_other_direction_too(lesson_b):
    """`AN ASSERTION THAT ONLY FORBIDS ONE OF THE TWO WRONG ANSWERS IS SATISFIED BY
    THE OTHER ONE` (R-800 §10). So B-under-A is asserted as well as A-under-B."""
    refusal, candidate = resolve_candidate_authority(
        _config(
            candidate=lesson_b,
            parent_spec_hash=LESSON_B_SPEC_HASH,
            executed_spec_hash=LESSON_A_SPEC_HASH,
        )
    )
    assert candidate is None
    assert refusal is not None and "cross-source provenance" in str(refusal)


def test_a_missing_executed_spec_hash_REFUSES_rather_than_skipping(lesson_a):
    """Fail-closed. An absent hash is what a swapped/stripped artifact looks like,
    so it may not be treated as 'nothing to check here'."""
    refusal, candidate = resolve_candidate_authority(
        _config(
            candidate=lesson_a,
            parent_spec_hash=LESSON_A_SPEC_HASH,
            executed_spec_hash="",
        )
    )
    assert candidate is None
    assert refusal is not None and "cross-source provenance" in str(refusal)


# ── DISCRIMINATOR 4: THE MUTATION CONTROL ────────────────────────────────────


def test_the_old_three_anchors_ACCEPT_the_swap(lesson_a):
    """ABLATION — the pre-AR-1110 path, called directly and unmodified.

    This is the whole justification for anchor (4). `resolve_row_for_execution` is
    the receipt/row/payload authority, and on the SWAPPED pair it returns a perfectly
    good lesson-A candidate without complaint, because the executed spec is not an
    input it has ever seen. If this test ever goes red, anchor (4) has become
    redundant and the guard above should be re-derived, not merely deleted.
    """
    swapped = _config(
        candidate=lesson_a,
        parent_spec_hash=LESSON_A_SPEC_HASH,
        executed_spec_hash=LESSON_B_SPEC_HASH,
    )
    row = CandidatePersistenceRow(
        parent_spec_hash=swapped[_CANDIDATE_PARENT_KEY],
        symbol="MES",
        candidate_id=swapped["execution_candidate_id"],
        cache_identity=swapped["execution_candidate_cache_identity"],
        receipt=swapped["execution_candidate_receipt"],
    )

    resolved = resolve_row_for_execution(row)

    assert resolved.source_spec_id == LESSON_A_SPEC_ID
    assert resolved.variant.duration_minutes == 15
    # ⇒ The old anchors are HAPPY with lesson A running under lesson B's spec.
    #    That is the defect, reproduced on demand, by the unmodified instrument.


def test_the_two_lessons_really_do_differ_in_a_money_deciding_fact(lesson_a, lesson_b):
    """A swap between two IDENTICAL lessons would be undetectable and harmless, and
    a discriminator built on one would prove nothing. Pin the difference."""
    assert lesson_a.variant.duration_minutes != lesson_b.variant.duration_minutes
    assert lesson_a.candidate_id != lesson_b.candidate_id
    assert lesson_a.cache_identity != lesson_b.cache_identity
