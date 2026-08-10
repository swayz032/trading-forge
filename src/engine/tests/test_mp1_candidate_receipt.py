"""MP-1 STEP — the EXECUTION CANDIDATE RECEIPT contract, written RED.

AUTHORITY: R-793 §5 lane `C` (`MP1-CANDIDATE-RECEIPT-RED`), which adopts the
external read's `§15` eleven obligations verbatim and its `§13` design ruling.
TEST-ONLY BY ORDER: this file writes the contract; it does NOT build the module.

WHY A RECEIPT EXISTS AT ALL
---------------------------
`R-785` put the typed `OpeningRangeExecutionCandidate` OUTSIDE the only object
that crosses the persistence boundary, deliberately — a firebreak, not an
oversight. `AR-932 §2` then measured the consequence: on the crossing payload the
candidate is ABSENT, and every field that DOES cross (`spec_hash`,
`graph_canonical_hash`, `ledger_d`) is computed over the SPEC and is therefore
IDENTICAL for all three taught candidates. They identify the spec; they can never
say WHICH VARIANT.

    `THE COMPILER DID NOT CHOOSE, SO PERSISTENCE DOES NOT GET TO CHOOSE EITHER —
     A CARDINALITY COLLAPSE IS A DEFAULT WEARING A SCHEMA'S CLOTHES.`  (R-793 §3)

So the receipt is a SERIALISATION BOUNDARY around `canonical_payload()`, which
already exists and is already order-stable. It is NOT a second compiler, NOT a
new identity system, and NOT the typed candidate smuggled into `SpecArtifact`.

WHY `candidate_id` ALONE IS NOT ENOUGH (the read's §12, adopted)
----------------------------------------------------------------
Rebuilding the candidate from `compiled_spec` + `candidate_id` would mean
re-reading the source records at backtest time — RE-EXTRACTION AT EXECUTION —
which is refused. The receipt therefore carries the payload itself.

THE ANCHOR MUST LIVE OUTSIDE THE THING IT ANCHORS
-------------------------------------------------
Obligation (10) is `G2`'s lesson one layer up. At the seal layer, an artifact
that recomputed its own digest still died against a hash pinned in the runner's
contract. Here: a payload edited and re-stamped with a fresh `candidate_id` must
STILL be refused, because `cache_identity` is recomputed from the payload and
compared — and because the PERSISTED identity, which the receipt does not own,
is the outer anchor.

    `AN IDENTITY THAT CAN REPAIR ITSELF IS NOT AN IDENTITY.`  (R-793 §7)

🛑 WHAT IS RED AND WHY THAT IS THE POINT
----------------------------------------
`src/engine/opening_range_candidate_receipt.py` DOES NOT EXIST. Every obligation
below fails through `_api()` with a named message rather than a bare collection
error, so the eleven appear as eleven distinct reds and go green one at a time as
the module lands. `THE TEST NAMES THE GAP BEFORE THE CODE FILLS IT.`

⚠️ SCOPE NOTE FOR THE DESK, STATED RATHER THAN ASSUMED: R-793 §3 adopts "`§11`'s
seven rehydration checks", but the external read is not committed to this tree —
`ExecutionCandidateReceipt` appears on disk ONLY in `ADVISOR-RULINGS.md` and
`HANDOVER-ADVISOR-2026-08-04.md`. The eleven obligations below are taken from
R-793 §5's own inline enumeration, which is self-contained. The API NAMES are
this contract's proposal; if the read pins different ones, the names move and the
obligations do not.
"""

from __future__ import annotations

import dataclasses
import json
import pathlib

import pytest

from src.engine.extraction.spec_producer import produce_spec_artifact_from_record
from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate
from src.engine.opening_range_lowering import COMMITTED_PROVENANCE_DIR

# The golden slice, named here as TEST DATA (R-774 §6 forbids hardcoding the stub
# in the compiler, not in a fixture that must name the artifact it measures).
GOLDEN_STUB = "st5e-YJRfKc__s0"

# The three taught windows, in taught order. READ FROM THE SOURCE below, never
# trusted from this literal — the literal exists only so a drift is legible.
TAUGHT_DURATIONS = (5, 15, 30)

# The surface the module must expose. Named in one place so a rename is one edit.
REQUIRED_NAMES = (
    "RECEIPT_SCHEMA",
    "ExecutionCandidateReceipt",
    "build_execution_candidate_receipts",
    "rehydrate_candidate",
    "resolve_execution_candidate",
)


def _record(stub: str) -> dict:
    path = pathlib.Path(COMMITTED_PROVENANCE_DIR) / f"{stub}.json"
    assert path.exists(), (
        f"frozen provenance record missing: {path}\n"
        "  this is a HARNESS failure, not a contract failure — the golden slice moved."
    )
    return json.loads(path.read_text(encoding="utf-8"))


def _golden_compile():
    """The REAL production full-record boundary. Not a stub, not a hand-built envelope."""
    return produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB)


def _api():
    """Import the receipt boundary, or fail RED naming exactly what is absent.

    Deliberately NOT a module-level import: a module-level `ImportError` collapses
    all eleven obligations into one collection error, and `AR-932`'s own lesson is
    that a combined run cannot attribute its exit to any single arm.
    """
    try:
        import src.engine.opening_range_candidate_receipt as mod
    except ModuleNotFoundError as exc:
        pytest.fail(
            "RED — the receipt boundary does not exist yet.\n"
            "  expected : src/engine/opening_range_candidate_receipt.py\n"
            f"  import   : {exc}\n"
            "  R-793 §5 lane C authorises this contract BEFORE the module. This is the\n"
            "  designed red, not a broken test."
        )
    missing = [n for n in REQUIRED_NAMES if not hasattr(mod, n)]
    if missing:
        pytest.fail(
            "RED — the receipt module exists but does not expose the contracted surface.\n"
            f"  missing : {missing}\n"
            f"  present : {sorted(n for n in dir(mod) if not n.startswith('_'))}"
        )
    return mod


# ── PRE-CONDITION — the golden record still teaches exactly three windows ──────
#
# 🛑 R-793 §6 STOP `[1]`: if this fails, the golden record contradicts `S6` and
# that OUTRANKS this lane. It is asserted FIRST so that a source drift can never
# be mistaken for a receipt defect.
def test_the_golden_record_still_yields_exactly_the_three_taught_candidates():
    result = _golden_compile()
    candidates = result.opening_range_candidates

    durations = tuple(c.variant.duration_minutes for c in candidates)
    assert durations == TAUGHT_DURATIONS, (
        "STOP CONDITION R-793 §6[1] — the golden record no longer yields 5/15/30.\n"
        f"  measured : {durations}\n"
        "  This contradicts S6 and outranks lane C. Do not 'fix' the receipt contract."
    )
    # POSITIVE WITNESS that the fixture can discriminate at all: three candidates
    # that shared an identity would satisfy a count check while being one candidate
    # three times.
    assert len({c.candidate_id for c in candidates}) == 3
    assert len({c.cache_identity for c in candidates}) == 3


# ── OBLIGATION (1) — EXACTLY THREE RECEIPTS ───────────────────────────────────
def test_obligation_01_the_boundary_produces_exactly_three_receipts():
    mod = _api()
    result = _golden_compile()
    receipts = mod.build_execution_candidate_receipts(result)
    assert len(receipts) == 3, (
        "a taught set of three must produce three receipts; anything else is the\n"
        "cardinality collapse R-793 §3 forbids.\n"
        f"  produced : {len(receipts)}"
    )


# ── OBLIGATION (2) — THREE DISTINCT `candidate_id`s ───────────────────────────
def test_obligation_02_the_three_receipts_carry_distinct_candidate_ids():
    mod = _api()
    receipts = mod.build_execution_candidate_receipts(_golden_compile())
    ids = [r.candidate_id for r in receipts]
    assert len(set(ids)) == 3, f"candidate_id collides across receipts: {ids}"


# ── OBLIGATION (3) — THREE DISTINCT `cache_identity`s ─────────────────────────
def test_obligation_03_the_three_receipts_carry_distinct_cache_identities():
    mod = _api()
    receipts = mod.build_execution_candidate_receipts(_golden_compile())
    identities = [r.cache_identity for r in receipts]
    assert len(set(identities)) == 3, f"cache_identity collides across receipts: {identities}"


# ── OBLIGATION (4) — ONE PARENT `SpecArtifact` FOR ALL THREE ──────────────────
#
# Two arms. Sameness alone is satisfied by a hardcoded constant, so the second arm
# proves the parent reference is actually DERIVED from the artifact.
# `A CONTROL MUST DISCRIMINATE.`
def test_obligation_04_all_three_receipts_name_the_same_parent_and_it_is_derived():
    mod = _api()
    result = _golden_compile()
    receipts = mod.build_execution_candidate_receipts(result)

    parents = {r.parent_spec_hash for r in receipts}
    assert parents == {result.artifact["spec_hash"]}, (
        "the three receipts must all name the ONE parent SpecArtifact they came from.\n"
        f"  receipts say : {parents}\n"
        f"  artifact says: {result.artifact['spec_hash']}"
    )

    # DISCRIMINATION ARM — a different parent must produce a different reference,
    # otherwise the field is a constant that would 'pass' for any artifact.
    other = dataclasses.replace(
        result, artifact={**result.artifact, "spec_hash": "NOT-THE-GOLDEN-SPEC-HASH"}
    )
    other_parents = {r.parent_spec_hash for r in mod.build_execution_candidate_receipts(other)}
    assert other_parents == {"NOT-THE-GOLDEN-SPEC-HASH"}, (
        "parent_spec_hash did not follow the artifact — it is a constant, not a reference.\n"
        f"  got : {other_parents}"
    )


# ── OBLIGATION (5) — THE RECEIPT SURVIVES A JSON ROUND-TRIP ───────────────────
def test_obligation_05_the_receipt_survives_a_json_round_trip_unchanged():
    mod = _api()
    receipt = mod.build_execution_candidate_receipts(_golden_compile())[0]

    wire = json.dumps(receipt.to_payload(), sort_keys=True, ensure_ascii=False)
    restored = mod.ExecutionCandidateReceipt.from_payload(json.loads(wire))

    assert restored.candidate_id == receipt.candidate_id
    assert restored.cache_identity == receipt.cache_identity
    assert restored.parent_spec_hash == receipt.parent_spec_hash
    # The payload itself must survive byte-identically once re-serialised, or the
    # boundary is lossy in a way `cache_identity` would later blame on tampering.
    assert json.dumps(restored.to_payload(), sort_keys=True, ensure_ascii=False) == wire


# ── OBLIGATION (6) — PYTHON REHYDRATION RETURNS THE SAME EXACT IDENTITY ───────
def test_obligation_06_rehydration_returns_the_same_exact_candidate_identity():
    mod = _api()
    result = _golden_compile()
    receipts = mod.build_execution_candidate_receipts(result)

    for original, receipt in zip(result.opening_range_candidates, receipts):
        # Through the WIRE, not from the in-process object — rehydrating the object
        # you already hold proves nothing about the boundary.
        restored = mod.ExecutionCandidateReceipt.from_payload(
            json.loads(json.dumps(receipt.to_payload(), ensure_ascii=False))
        )
        candidate = mod.rehydrate_candidate(restored)

        assert isinstance(candidate, OpeningRangeExecutionCandidate), (
            f"rehydration returned {type(candidate).__name__}, not the typed candidate"
        )
        assert candidate.candidate_id == original.candidate_id
        assert candidate.cache_identity == original.cache_identity


# ── OBLIGATION (7) — A DELETED RECEIPT MAKES EXECUTION REFUSE ─────────────────
#
# ★ FIRST OBSERVABLE for R-793 §5.
# Carries its own POSITIVE WITNESS: a resolver that raises unconditionally would
# satisfy the refusal arm while being useless, so the control runs first.
def test_obligation_07_a_missing_receipt_makes_execution_refuse():
    mod = _api()
    result = _golden_compile()
    receipt = mod.build_execution_candidate_receipts(result)[0]
    original = result.opening_range_candidates[0]

    # CONTROL FIRST — with the receipt present, execution RESOLVES.
    resolved = mod.resolve_execution_candidate(
        receipt.to_payload(),
        persisted_candidate_id=original.candidate_id,
        persisted_cache_identity=original.cache_identity,
    )
    assert resolved.candidate_id == original.candidate_id, (
        "the resolver cannot resolve a VALID receipt — the refusal arm below would "
        "then prove nothing."
    )

    # THE ARM — the receipt is gone.
    with pytest.raises(Exception) as excinfo:
        mod.resolve_execution_candidate(
            None,
            persisted_candidate_id=original.candidate_id,
            persisted_cache_identity=original.cache_identity,
        )
    assert "receipt" in str(excinfo.value).lower(), (
        "the refusal must NAME the missing receipt; an anonymous raise teaches the next "
        f"reader nothing.\n  raised: {excinfo.value}"
    )


# ── OBLIGATION (8) — A RECEIPT SWAPPED ONTO ANOTHER CANDIDATE'S ROW GOES RED ──
#
# The 5m receipt presented against the 15m persisted identity. This is the arm the
# OUTER anchor exists for: the receipt is internally perfect and still wrong.
def test_obligation_08_a_receipt_swapped_onto_another_persisted_identity_goes_red():
    mod = _api()
    result = _golden_compile()
    receipts = mod.build_execution_candidate_receipts(result)
    five, fifteen = result.opening_range_candidates[0], result.opening_range_candidates[1]

    assert five.candidate_id != fifteen.candidate_id, "fixture cannot discriminate"

    with pytest.raises(Exception) as excinfo:
        mod.resolve_execution_candidate(
            receipts[0].to_payload(),                       # the 5m receipt
            persisted_candidate_id=fifteen.candidate_id,    # onto the 15m row
            persisted_cache_identity=fifteen.cache_identity,
        )
    assert excinfo.value is not None


# ── OBLIGATION (9) — DURATION CHANGED WITHOUT UPDATING `cache_identity` ───────
def test_obligation_09_editing_the_duration_without_restamping_identity_goes_red():
    mod = _api()
    result = _golden_compile()
    receipt = mod.build_execution_candidate_receipts(result)[0]
    original = result.opening_range_candidates[0]

    payload = json.loads(json.dumps(receipt.to_payload(), ensure_ascii=False))
    before = payload["payload"]["variant"]["duration_minutes"]
    payload["payload"]["variant"]["duration_minutes"] = before + 1
    # POSITIVE WITNESS that the mutation took and is reachable by the guard.
    assert payload["payload"]["variant"]["duration_minutes"] != before

    with pytest.raises(Exception):
        mod.resolve_execution_candidate(
            payload,
            persisted_candidate_id=original.candidate_id,
            persisted_cache_identity=original.cache_identity,
        )


# ── OBLIGATION (10) — SELF-REPAIR IS STILL REFUSED (`G2` ONE LAYER UP) ────────
#
# The payload is edited AND `candidate_id` is honestly recomputed for the edit, so
# every id-vs-payload check inside the receipt agrees with itself. It must STILL go
# red — via `cache_identity`, and via the persisted identity the receipt does not own.
def test_obligation_10_editing_the_payload_and_restamping_only_candidate_id_still_goes_red():
    mod = _api()
    result = _golden_compile()
    receipt = mod.build_execution_candidate_receipts(result)[0]
    original = result.opening_range_candidates[0]

    payload = json.loads(json.dumps(receipt.to_payload(), ensure_ascii=False))
    variant = payload["payload"]["variant"]
    variant["duration_minutes"] = variant["duration_minutes"] + 1

    # Recompute ONLY `candidate_id`, exactly as the real type derives it, so the
    # forgery is internally consistent on that field.
    payload["candidate_id"] = (
        f"{payload['payload']['source_spec_id']}::{payload['payload']['source_condition_id']}"
        f"::{variant['variant_label']}@{variant['duration_minutes']}m"
    )
    assert payload["candidate_id"] != receipt.candidate_id, (
        "the re-stamp did not change candidate_id — this arm is not exercising "
        "self-repair at all."
    )

    with pytest.raises(Exception) as excinfo:
        mod.resolve_execution_candidate(
            payload,
            persisted_candidate_id=original.candidate_id,
            persisted_cache_identity=original.cache_identity,
        )
    assert excinfo.value is not None, (
        "a receipt that recomputes its own identity authorised itself — that is G2 at "
        "the candidate layer, and R-793 §6[2] makes it a STOP."
    )


# ── OBLIGATION (11) — NO RECEIPT NEVER SILENTLY SELECTS `[0]` ─────────────────
#
# The failure this forbids is not a crash, it is a DEFAULT: picking the first
# taught candidate because it is first. Asserted against the 5m candidate BY VALUE,
# because `[0]` is precisely what a naive implementation returns.
def test_obligation_11_with_no_receipt_nothing_ever_falls_back_to_the_first_candidate():
    mod = _api()
    result = _golden_compile()
    first = result.opening_range_candidates[0]

    try:
        got = mod.resolve_execution_candidate(
            None,
            persisted_candidate_id=first.candidate_id,
            persisted_cache_identity=first.cache_identity,
        )
    except Exception:
        return  # refusing is the correct behaviour

    pytest.fail(
        "no receipt was supplied and the resolver returned a candidate instead of "
        "refusing — this is the default R-736 eliminated, reintroduced at the "
        f"persistence layer.\n  returned : {getattr(got, 'candidate_id', got)!r}\n"
        f"  first    : {first.candidate_id!r}"
    )
