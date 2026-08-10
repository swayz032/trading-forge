"""MP-1 — the PERSISTENCE boundary contract, written RED. Twelve obligations A–L.

AUTHORITY: R-795 §6 lane `H`; obligations carried from `R-794 §7`'s deferred
register. TEST-ONLY BY ORDER: this file writes the contract; it does NOT build the
module, and it touches NO TypeScript, NO `/api/backtests`, NO database.

WHAT THIS PINS
--------------
`AR-932 §2` measured that the typed candidate cannot cross the persistence
boundary and that every field which DOES cross (`spec_hash`,
`graph_canonical_hash`, `ledger_d`) is computed over the SPEC — identical for all
three taught candidates. `R-794 §5` then decided the receipt rides in
`strategies.config` beside `compiled_spec`, with the identity anchors OUTSIDE it.

This file pins what PLANNING those rows must mean. It is the Python-side contract;
the eventual TypeScript repair must satisfy the same semantics.

🛑 WHAT OBLIGATIONS `F` AND `G` ACTUALLY ENCODE — CORRECTED (`R-798 §5`, lane `L-5`)
-----------------------------------------------------------------------------------
⚠️ THIS BLOCK PREVIOUSLY READ *"OBLIGATIONS `F` AND `G` ARE RED AGAINST CURRENT
PRODUCTION AND THAT IS THE POINT."* THAT WAS WRONG, and it is corrected here rather
than annotated below, because `A CORRECTION APPENDED BELOW A FALSE LINE LEAVES THE
FALSE LINE CITABLE`. Nothing about the assertions changed; only this description of
them. (`F-MP1-CONTRACT-PROSE-1`, banked `R-797 §2`.)

THE CORRECT STATEMENT, per `R-798 §5`:

    `F`/`G` encode the candidate-aware behaviour REQUIRED of production. Their
    original RED was caused by absence of the PYTHON PLANNER. The production
    TypeScript collapse was proven SEPARATELY, at the actual onboarding boundary.

Why the distinction is worth this many lines — it cost a whole round to learn
(`F-MP1-SCOPE-1`, `R-797 §2`, a DESK error the worker re-derived at the line):

    `A TEST THAT WAS RED BECAUSE THE CODE WAS ABSENT GOES GREEN THE MOMENT THE CODE
     EXISTS — AND THAT PROVES THE CODE EXISTS, NOT THAT THE DEFECT IT WAS WRITTEN
     ABOUT IS GONE. THE RED'S CAUSE IS PART OF WHAT ITS GREEN MEANS.`

Every obligation here asserts `mod.would_collide(...)` against the Python planner.
NONE of them ever reached `spec-onboarding-service.ts`, so none of them could have
witnessed — or repaired — the TypeScript collapse.

`[PRIOR ART — R-793 §4, measured and published by THIS DESK first, and I do not
let a later reader re-date it]` `spec-onboarding-service.ts` keyed idempotency on
`(spec_hash, symbol)` and deduped by TAG-ARRAY membership plus two column filters.
Both are APPLICATION-LEVEL — no unique index — so the repair needed NO MIGRATION,
and `AR-942 §2` later confirmed that at the schema layer in both trees.

THE TYPESCRIPT SIDE'S OWN WITNESS AND REPAIR, for the reader who lands here first:
  · `c51dcdb9` — the production-boundary RED, in its own commit: three taught
    candidates driven through the REAL `onboardSpecArtifact` against a real
    in-process Postgres produced ONE row and ZERO candidate identities.
  · lane `L-3`/`L-4` — the repair and its own fourteen obligations `A`–`N`
    (`R-798 §4`), living in
    `src/server/services/__tests__/spec-onboarding-candidate-identity.test.ts`.
🛑 THOSE FOURTEEN ARE A DIFFERENT LETTERING FROM THE TWELVE BELOW. Do not join the
two sets by letter — this file's `F`/`G` and that file's `F`/`G` are different
obligations that happen to share a symbol.

    `THE COMPILER DID NOT CHOOSE, SO PERSISTENCE DOES NOT GET TO CHOOSE EITHER.`

WHY THE IDENTITY MUST BE IN THE KEY AND NOT IN THE NAME
-------------------------------------------------------
`R-794 §5`: candidate-specific names use an OPAQUE suffix from `cache_identity`,
never parsed trading semantics, and THE NAME IS NEVER A JOIN KEY. So every
obligation below joins on identity, never on a derived name.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from src.engine.extraction.spec_producer import produce_spec_artifact_from_record
from src.engine.opening_range_candidate_receipt import (
    ExecutionCandidateReceiptError,
    build_execution_candidate_receipts,
    rehydrate_candidate,
)
from src.engine.opening_range_lowering import COMMITTED_PROVENANCE_DIR

GOLDEN_STUB = "st5e-YJRfKc__s0"
SYMBOL = "MES"
TAUGHT_DURATIONS = (5, 15, 30)

REQUIRED_NAMES = (
    "PERSISTENCE_SCHEMA",
    "CandidatePersistenceRow",
    "plan_candidate_rows",
    "dedupe_key",
    "would_collide",
    "resolve_row_for_execution",
)


def _record(stub: str) -> dict:
    path = pathlib.Path(COMMITTED_PROVENANCE_DIR) / f"{stub}.json"
    assert path.exists(), f"frozen provenance record missing: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def _golden_compile():
    return produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB)


def _api():
    """Import the persistence planner, or fail RED naming exactly what is absent.

    Per-obligation rather than a module-level import, so the twelve appear as twelve
    distinct reds and go green one at a time.
    `A COMBINED RUN CANNOT ATTRIBUTE ITS EXIT CODE TO ANY SINGLE ARM.`
    """
    try:
        import src.engine.opening_range_candidate_persistence as mod
    except ModuleNotFoundError as exc:
        pytest.fail(
            "RED — the persistence planner does not exist yet.\n"
            "  expected : src/engine/opening_range_candidate_persistence.py\n"
            f"  import   : {exc}\n"
            "  R-795 §6 lane H authorises this contract BEFORE the module."
        )
    missing = [n for n in REQUIRED_NAMES if not hasattr(mod, n)]
    if missing:
        pytest.fail(
            "RED — the planner exists but does not expose the contracted surface.\n"
            f"  missing : {missing}"
        )
    return mod


def _rows():
    return _api().plan_candidate_rows(_golden_compile(), symbol=SYMBOL)


# ── A — EXACTLY THREE ROWS ────────────────────────────────────────────────────
def test_obligation_A_the_golden_compile_plans_exactly_three_candidate_rows():
    rows = _rows()
    assert len(rows) == 3, (
        "a taught set of three must plan three rows; anything else is the cardinality "
        f"collapse R-794 §3 forbids.\n  planned : {len(rows)}"
    )


# ── B — ONE PARENT FOR ALL THREE ──────────────────────────────────────────────
def test_obligation_B_all_three_rows_share_one_parent_spec_hash():
    result = _golden_compile()
    parents = {r.parent_spec_hash for r in _rows()}
    assert parents == {result.artifact["spec_hash"]}, (
        f"the three rows must name the ONE parent spec they came from.\n  got : {parents}"
    )


# ── C / D — DISTINCT IDENTITIES ───────────────────────────────────────────────
def test_obligation_C_the_three_rows_carry_distinct_candidate_ids():
    ids = [r.candidate_id for r in _rows()]
    assert len(set(ids)) == 3, f"candidate_id collides across planned rows: {ids}"


def test_obligation_D_the_three_rows_carry_distinct_cache_identities():
    identities = [r.cache_identity for r in _rows()]
    assert len(set(identities)) == 3, f"cache_identity collides across rows: {identities}"


# ── E — IDEMPOTENT REPLAY ─────────────────────────────────────────────────────
def test_obligation_E_replaying_an_identical_candidate_is_idempotent():
    mod = _api()
    rows = _rows()
    again = _rows()
    for a, b in zip(rows, again):
        assert mod.dedupe_key(a) == mod.dedupe_key(b), (
            "the same candidate planned twice must produce the same dedupe key, or a "
            "re-run creates duplicate qualification rows."
        )
        assert mod.would_collide([a], b), (
            "an identical candidate must be recognised as already persisted."
        )


# ── F / G — A DIFFERENT TAUGHT VARIANT IS NOT A DUPLICATE ─────────────────────
#
# 🛑 THESE ARE THE TWO THAT ARE RED AGAINST CURRENT PRODUCTION, BY DESIGN.
# Under `(spec_hash, symbol)` all three candidates ARE duplicates of each other, so
# candidates 2 and 3 return `skipped_duplicate` silently. R-795 §7[4] makes a GREEN
# here a bigger finding than this lane — it would refute R-793 §4.
def test_obligation_F_an_existing_5m_row_does_not_make_15m_a_duplicate():
    mod = _api()
    five, fifteen = _rows()[0], _rows()[1]
    assert five.candidate_id != fifteen.candidate_id, "fixture cannot discriminate"
    assert not mod.would_collide([five], fifteen), (
        "the 15m candidate was treated as a duplicate of the 5m one. They share a "
        "spec_hash and a symbol and differ ONLY in the taught variant — which is "
        "exactly the collapse R-793 §4 measured at spec-onboarding-service.ts:537."
    )


def test_obligation_G_an_existing_15m_row_does_not_make_30m_a_duplicate():
    mod = _api()
    fifteen, thirty = _rows()[1], _rows()[2]
    assert fifteen.candidate_id != thirty.candidate_id, "fixture cannot discriminate"
    assert not mod.would_collide([fifteen], thirty), (
        "the 30m candidate was treated as a duplicate of the 15m one."
    )


# ── H / I / J — THE ROW MUST PROVE WHICH CANDIDATE IT IS ──────────────────────
def test_obligation_H_a_row_with_no_receipt_refuses():
    mod = _api()
    row = _rows()[0]
    stripped = mod.CandidatePersistenceRow(
        parent_spec_hash=row.parent_spec_hash,
        symbol=row.symbol,
        candidate_id=row.candidate_id,
        cache_identity=row.cache_identity,
        receipt=None,
    )
    with pytest.raises(Exception) as excinfo:
        mod.resolve_row_for_execution(stripped)
    assert "receipt" in str(excinfo.value).lower(), (
        f"the refusal must NAME the missing receipt.\n  raised: {excinfo.value}"
    )


def test_obligation_I_a_candidate_id_that_disagrees_with_the_receipt_refuses():
    mod = _api()
    rows = _rows()
    swapped = mod.CandidatePersistenceRow(
        parent_spec_hash=rows[0].parent_spec_hash,
        symbol=rows[0].symbol,
        candidate_id=rows[1].candidate_id,          # the 15m identity …
        cache_identity=rows[1].cache_identity,
        receipt=rows[0].receipt,                    # … carrying the 5m receipt
    )
    with pytest.raises(Exception):
        mod.resolve_row_for_execution(swapped)


def test_obligation_J_a_parent_spec_hash_that_disagrees_with_the_receipt_refuses():
    mod = _api()
    row = _rows()[0]
    forged = mod.CandidatePersistenceRow(
        parent_spec_hash="NOT-THE-PARENT-THIS-RECEIPT-CAME-FROM",
        symbol=row.symbol,
        candidate_id=row.candidate_id,
        cache_identity=row.cache_identity,
        receipt=row.receipt,
    )
    with pytest.raises(Exception):
        mod.resolve_row_for_execution(forged)


# ── K — LEGACY IS NOT BROKEN ──────────────────────────────────────────────────
#
# R-794 §5: ADDITIVE ONLY. Legacy artifacts with NO receipt keep `spec_hash + symbol`.
# The ~120-strategy library is NOT in scope and must not be migrated by this change.
def test_obligation_K_a_legacy_artifact_with_no_receipt_keeps_legacy_dedupe():
    mod = _api()
    legacy_a = mod.CandidatePersistenceRow(
        parent_spec_hash="legacy-spec-hash", symbol=SYMBOL,
        candidate_id=None, cache_identity=None, receipt=None,
    )
    legacy_b = mod.CandidatePersistenceRow(
        parent_spec_hash="legacy-spec-hash", symbol=SYMBOL,
        candidate_id=None, cache_identity=None, receipt=None,
    )
    assert mod.dedupe_key(legacy_a) == mod.dedupe_key(legacy_b)
    assert mod.would_collide([legacy_a], legacy_b), (
        "two receiptless legacy rows for one spec+symbol must still collide — the "
        "candidate dimension is ADDITIVE and may not silently un-dedupe the library."
    )


# ── L — NO DEFAULT, EVER ──────────────────────────────────────────────────────
def test_obligation_L_a_missing_candidate_never_becomes_a_default():
    mod = _api()
    row = _rows()[0]
    result = _golden_compile()
    first = result.opening_range_candidates[0]

    stripped = mod.CandidatePersistenceRow(
        parent_spec_hash=row.parent_spec_hash, symbol=row.symbol,
        candidate_id=None, cache_identity=None, receipt=None,
    )
    try:
        got = mod.resolve_row_for_execution(stripped)
    except Exception:
        return  # refusing is the correct behaviour

    pytest.fail(
        "a row with no candidate identity resolved to something instead of refusing. "
        "It must never become [0], a timeframe inference, or any other default — that "
        "is the defaulting R-736 eliminated, reintroduced at the persistence layer.\n"
        f"  returned : {getattr(got, 'candidate_id', got)!r}\n"
        f"  first    : {first.candidate_id!r}"
    )


# ── RECEIPT-CACHE-RECOMPUTE-1 (R-795 §6, adopted from the external §17) ───────
#
# ⭐ THIS ONE SHOULD ALREADY BE GREEN against 60647d74, and it exists for a reason
# worth stating: `AR-935 §1` disclosed that mutation `M2` — removing the
# cache_identity recompute — broke NO obligation, because the outer anchors covered
# for it. This gives that layer its own witness by calling `rehydrate_candidate()`
# DIRECTLY, with no outer anchors in play.
#
#   `AN UNTESTED SECOND LAYER IS A COMMENT.`
def test_receipt_cache_recompute_is_load_bearing_without_any_outer_anchor():
    result = _golden_compile()
    receipt = build_execution_candidate_receipts(result)[0]

    payload = json.loads(json.dumps(receipt.to_payload(), ensure_ascii=False))
    # A WELL-FORMED tamper: swap to another TAUGHT variant so the typed constructor
    # cannot be the thing that refuses, and leave BOTH stamped identities stale.
    other = result.opening_range_candidates[1]
    payload["payload"]["variant"] = {
        "variant_label": other.variant.variant_label,
        "duration_minutes": other.variant.duration_minutes,
        "source_quote": other.variant.source_quote,
    }
    tampered = type(receipt).from_payload(payload)
    assert tampered.cache_identity == receipt.cache_identity, (
        "the stale identity did not survive the round-trip — this arm is not "
        "exercising the recompute at all."
    )

    with pytest.raises(ExecutionCandidateReceiptError):
        rehydrate_candidate(tampered)
