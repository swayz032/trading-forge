"""B1 STEP 6 (lane `S6-1`) — THE PRE-REGISTERED REDS, PUBLISHED RED BEFORE ANY WIRING.

AUTHORITY: R-774 §6 step 1, which is explicitly non-negotiable and explicitly
FIRST: `A GUARD WRITTEN AFTER THE FIX IS A GUARD SHAPED BY THE FIX.`

WHAT THIS FILE IS FOR
---------------------
Two properties must become true in this lane, and both are RED at the commit
that introduces this file:

  RED 1  CANDIDATE TRANSPORT   a production compile of the frozen golden record
                               yields EXACTLY the three taught execution
                               candidates (5m, 15m, 30m), in taught order.
  RED 2  REAL ADAPTER EXECUTION the primitive production DECLARES for
                               OPENING_RANGE_DEFINITION actually reaches
                               `compute_opening_range_state`, once per candidate,
                               each with its own taught duration.

🛑 WHY BOTH REDS CARRY A GREEN COMPANION IN THIS SAME FILE
----------------------------------------------------------
`[main-spy-both-arms]`: a spy that reads 0 because the gate refused and a spy
that reads 0 because it was never wired are INDISTINGUISHABLE, and the second
one looks like a perfect gate. R-774 §7-C therefore requires a POSITIVE WITNESS
that the observation path runs at all. So:

  * `test_positive_witness_...` calls the adapter THROUGH the same spy and
    proves the spy records calls. Without it, RED 2's `0 calls` proves nothing.
  * `test_the_golden_record_still_lowers_ready_...` proves the SOURCE side is
    complete, so RED 1's failure is attributable to TRANSPORT and not to a
    record that stopped lowering.

`AN ASSERTION THAT SOMETHING DID NOT HAPPEN IS SATISFIED BY A PATH THAT NEVER
 RAN. PROVE THE PATH RAN, THEN PROVE THE ABSENCE.`

🛑 MECHANISM-AGNOSTIC ON PURPOSE
--------------------------------
RED 1 searches for `OpeningRangeExecutionCandidate` INSTANCES BY TYPE, not by a
field name. R-774 §4-1 forbids smuggling the variant through
`ConditionBinding.parameters`. R-777 §5 has since named the carrier — the typed
compiler-result envelope — so the search now covers the envelope AND the compiled
plan, but it still refuses to name an attribute. Whatever carrier the wiring
picks, a typed candidate is findable; a string in a parameters dict is not, and
that asymmetry is deliberate (it is also control `K`).
"""

from __future__ import annotations

import dataclasses
import importlib
import inspect
import json
import pathlib
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from src.engine.extraction.spec_producer import (
    SPEC_ARTIFACT_OPENING_RANGE_LOWERING_KEY,
    RecordCompileResult,
    produce_spec_artifact,
    produce_spec_artifact_from_record,
)
from src.engine.family_meta_enforcement import PRIMITIVE_RESOLVERS
from src.engine.opening_range_adapter import OpeningRangeBar, compute_opening_range_state
from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate
from src.engine.opening_range_lowering import (
    COMMITTED_PROVENANCE_DIR,
    lower_opening_range_definition,
)
from src.engine.spec_condition_compiler import SpecConditionStrategy
from src.engine.spec_family_bindings import FAMILY_META, compile_binding_plan

# The golden slice. Named here as TEST DATA, never in production code (R-774 §6
# forbids hardcoding the stub in the compiler, not in a fixture that must name
# the artifact it measures).
GOLDEN_STUB = "st5e-YJRfKc__s0"
NEIGHBOUR_STUB = "hcHuDfxdywI__s0"
FAMILY = "OPENING_RANGE_DEFINITION"

# The three taught windows, in taught order. Read from the source, not chosen.
TAUGHT_DURATIONS = (5, 15, 30)


def _record(stub: str) -> dict:
    path = pathlib.Path(COMMITTED_PROVENANCE_DIR) / f"{stub}.json"
    assert path.exists(), f"frozen provenance record missing: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def _produce(stub: str):
    """The REAL production chain, same public entry points as the conformance suite."""
    doc = _record(stub)
    strategies = doc.get("strategies") or []
    assert len(strategies) == 1, f"{stub}: expected one strategy, found {len(strategies)}"
    artifact = produce_spec_artifact(
        strategies[0], video=stub, certificate=None, transcript_chars=0
    )
    plan = compile_binding_plan(artifact["spec"])
    return doc, artifact, plan


def _find_candidates(root: object) -> list[OpeningRangeExecutionCandidate]:
    """Every `OpeningRangeExecutionCandidate` reachable from a compiled plan, BY TYPE.

    Walks dataclasses, sequences and mappings. Deliberately does not know which
    attribute the wiring will use — see the module docstring.
    """
    found: list[OpeningRangeExecutionCandidate] = []
    seen: set[int] = set()

    def walk(obj: object, depth: int = 0) -> None:
        if depth > 12 or id(obj) in seen:
            return
        seen.add(id(obj))
        if isinstance(obj, OpeningRangeExecutionCandidate):
            found.append(obj)
            return
        if isinstance(obj, (str, bytes, int, float, bool, type(None))):
            return
        if isinstance(obj, dict):
            for v in obj.values():
                walk(v, depth + 1)
            return
        if isinstance(obj, (list, tuple, set, frozenset)):
            for v in obj:
                walk(v, depth + 1)
            return
        if dataclasses.is_dataclass(obj):
            for f in dataclasses.fields(obj):
                walk(getattr(obj, f.name, None), depth + 1)
            return
        for v in (vars(obj).values() if hasattr(obj, "__dict__") else ()):
            walk(v, depth + 1)

    walk(root)
    return found


def _deterministic_bars(session_date: date, tz: str, minutes: int) -> list[OpeningRangeBar]:
    """One 1-minute bar per minute of the window, on the grid, no gaps.

    Highs/lows widen with the minute so a LONGER window necessarily produces a
    WIDER range — the property control `G` will later depend on that. Here it
    only has to be a well-formed input the adapter cannot reject for shape.
    """
    zone = ZoneInfo(tz)
    start = datetime(session_date.year, session_date.month, session_date.day, 9, 30, tzinfo=zone)
    return [
        OpeningRangeBar(timestamp=start + timedelta(minutes=i), high=100.0 + i, low=100.0 - i)
        for i in range(minutes)
    ]


def _lower_golden():
    return lower_opening_range_definition(
        source_spec_id=GOLDEN_STUB,
        source_condition_id="(S6-1 pre-registered red)",
        record=_record(GOLDEN_STUB),
        positive_control=(
            "the identical call is made against the neighbour record in this same file, "
            "where it refuses — so a READY here is a discrimination, not a default"
        ),
    )


# ── POSITIVE CONTROL 1 — the source side is complete, so a RED below is TRANSPORT ──
def test_the_golden_record_still_lowers_ready_with_three_taught_variants():
    """GREEN. Without this, RED 1 could be a source regression wearing a wiring costume."""
    result = _lower_golden()
    assert result.definition is not None, (
        f"the golden record no longer lowers to a definition ({result.disposition}); the reds "
        "below would then be measuring the SOURCE, not the transport this lane repairs"
    )
    durations = tuple(v.duration_minutes for v in result.definition.variants)
    assert durations == TAUGHT_DURATIONS, (
        f"taught variants moved: expected {TAUGHT_DURATIONS} in taught order, got {durations}"
    )

    # NEGATIVE CONTROL, same call, other frozen member: the lowerer discriminates.
    neighbour = lower_opening_range_definition(
        source_spec_id=NEIGHBOUR_STUB,
        source_condition_id="(S6-1 negative control)",
        record=_record(NEIGHBOUR_STUB),
        positive_control="same locators, same call, a record that lacks taught variants",
    )
    assert neighbour.definition is None, (
        "the neighbour record produced a definition; the lowerer is not discriminating and "
        "the READY above is therefore not evidence of anything"
    )


# ── POSITIVE CONTROL 2 — the patch is attached AT THE SEAM PRODUCTION TRAVERSES ──
def test_positive_witness_the_patch_is_visible_through_production_symbol_resolution(monkeypatch):
    """GREEN. RED 2's `()` is worthless without this — but the OLD version of this
    witness was worthless too, and R-775 §1 was right about why.

    The previous version called `spy(...)` by hand and asserted `calls == [5]`.
    That proves only that a function which appends to a list appends to a list.
    It says NOTHING about whether the patch is attached where production looks.

    So this witness resolves the symbol THE WAY PRODUCTION RESOLVES IT — dotted
    `module:attr` lookup, the exact form `PRIMITIVE_RESOLVERS` stores — and
    requires that resolution to yield the patched object. If the patch were
    attached to a local alias instead of the module attribute, this fails and
    RED 2's empty tuple is correctly accused of being a blind spy.

    🛑 WHAT THIS DOES NOT CLAIM: that production CALLS it. That is RED 2's job,
    and RED 2 must reach it without this test's help.
    """
    calls: list[int] = []
    real = compute_opening_range_state

    def spy(definition, variant, bars, **kw):
        calls.append(variant.duration_minutes)
        return real(definition, variant, bars, **kw)

    monkeypatch.setattr(
        "src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True
    )

    module_name, _, attr = "src.engine.opening_range_adapter:compute_opening_range_state".partition(
        ":"
    )
    resolved = getattr(importlib.import_module(module_name), attr)
    assert resolved is spy, (
        "the patch is NOT visible through module-attribute resolution — the seam a "
        "PRIMITIVE_RESOLVERS entry traverses. Any '0 calls' elsewhere in this file would "
        "therefore accuse production of something the instrument could never have seen."
    )

    # Invoked THROUGH the resolved symbol, not through the local name, so what is
    # exercised is the attachment point rather than the closure.
    definition = _lower_golden().definition
    variant = definition.variants[0]
    zone = ZoneInfo(definition.source_timezone)
    resolved(
        definition,
        variant,
        _deterministic_bars(date(2026, 8, 3), definition.source_timezone, variant.duration_minutes),
        session_date=date(2026, 8, 3),
        bar_interval_minutes=1,
        as_of=datetime(2026, 8, 3, 12, 0, tzinfo=zone),
    )
    assert calls == [variant.duration_minutes], (
        "resolution returned the spy but invoking it recorded nothing — the observation "
        "mechanism is broken"
    )


# ── STEP 2.1 FIREBREAK — THE PORTABLE CONTRACT STAYS PORTABLE ─────────────────
#
# AUTHORITY: R-777 §4, which promoted the worker-declared `STEP2-LIM-1` to a
# pre-`STEP 3` firebreak after confirming BY EXECUTION that the artifact is
# unserialisable on BOTH arms — including the refusal path.
#
# 🛑 WHY THIS LIVES IN THIS FILE RATHER THAN A NEW ONE:
# a new test file moves the frozen canonical population `104 -> 105` and reddens
# its pin. That number is a PRE-REGISTERED acceptance figure (R-775 §5) and
# R-777 authorized a firebreak, not a manifest change. Same lane, same boundary,
# no population perturbation.
#
# THE DISTINCTION BEING GUARDED (R-777 §4, verbatim):
#   PORTABLE CONTRACT = SpecArtifact  (JSON, cross-language, durable)
#   IN-PROCESS STATE  = lowering · candidates · binding plan  (typed, Python-only)
def test_the_full_record_boundary_keeps_the_spec_artifact_plain_json_on_both_arms():
    """PERMANENT. Fails at the first unmet stage and names it.

    🛑 THE FAILURE MODE THIS EXISTS TO PREVENT IS NOT A CRASH — IT IS A SILENT
    DROP. The TS onboarding service consumes a SERIALIZED `SpecArtifact` and
    `parseSpecArtifact()` rebuilds only recognised fields. So the tempting repair
    — `dataclasses.asdict()` the lowering under an extra artifact key — would let
    Python believe it sent the lowering while TypeScript discarded it without a
    word. R-777 §4 forbids it:

        `A HANDOFF WHERE THE SENDER BELIEVES IT SENT AND THE RECEIVER SILENTLY
         DROPS IS WORSE THAN ONE THAT FAILS LOUDLY.`

    This test therefore asserts BOTH directions: the artifact must serialise,
    AND the lowering must not be inside it.
    """
    for stub, arm in ((GOLDEN_STUB, "READY"), (NEIGHBOUR_STUB, "SOURCE_INCOMPLETE")):
        result = produce_spec_artifact_from_record(_record(stub), video=stub)

        # ── STAGE 1 — the boundary returns an ENVELOPE, not the artifact itself.
        assert not isinstance(result, dict), (
            f"RED — STAGE 1 [{arm} arm, {stub}]: the full-record boundary still returns the "
            "SpecArtifact dict itself, so the typed lowering can only live INSIDE the "
            "portable contract.\n"
            f"  returned type : {type(result).__name__}\n"
            "  ⇒ the typed lowering must move to a compiler-result envelope (R-777 §4-2)."
        )

        # ── STAGE 2 — the portable contract is plain JSON. BOTH ARMS (R-777 §3).
        try:
            json.dumps(result.artifact)
        except TypeError as exc:
            raise AssertionError(
                f"RED — STAGE 2 [{arm} arm, {stub}]: the SpecArtifact is not JSON-serialisable, "
                "so it cannot traverse the seam its own name promises.\n"
                f"  TypeError : {exc}\n"
                "  ⇒ the refusal arm matters MOST here: a refusal that cannot be serialised "
                "is the one piece of bad news downstream is most entitled to receive intact."
            ) from exc

        # ── STAGE 3 — the lowering is REACHABLE, on the envelope.
        assert result.opening_range_lowering is not None, (
            f"RED — STAGE 3 [{arm} arm, {stub}]: the envelope carries no lowering. Moving it "
            "out of the artifact must not mean losing it — `AN ABSENT RESULT AND A REFUSAL "
            "ARE DIFFERENT FACTS`."
        )

        # ── STAGE 4 — and it is NOT smuggled back into the portable contract.
        assert SPEC_ARTIFACT_OPENING_RANGE_LOWERING_KEY not in result.artifact, (
            f"RED — STAGE 4 [{arm} arm, {stub}]: the lowering key is back inside the "
            "SpecArtifact. Even if it serialises today (e.g. via asdict()), TypeScript's "
            "parseSpecArtifact() rebuilds only recognised fields and would DISCARD it "
            "silently. R-777 §4 forbids this shape by name."
        )

        # ── NEGATIVE CONTROL, and it must BITE ────────────────────────────────
        # `A COMPARISON THAT CANNOT FAIL IS A PRINTOUT.` json.dumps() succeeding
        # above is evidence only if json.dumps() could still have failed on this
        # very artifact. So re-embed the real typed lowering and require the
        # TypeError the firebreak exists to prevent.
        poisoned = dict(result.artifact)
        poisoned[SPEC_ARTIFACT_OPENING_RANGE_LOWERING_KEY] = result.opening_range_lowering
        try:
            json.dumps(poisoned)
        except TypeError:
            pass
        else:
            raise AssertionError(
                f"[{arm} arm, {stub}] NEGATIVE CONTROL DID NOT BITE: re-embedding the typed "
                "lowering still serialised. Either the lowering stopped being a typed object "
                "or json.dumps is not the instrument this test believes it is — in both cases "
                "STAGE 2 above proves nothing."
            )


def test_the_old_per_strategy_boundary_json_behaviour_is_unchanged():
    """REGRESSION ARM (R-777 §4-1, item 5). GREEN before and after STEP 2.1.

    This is also the POSITIVE CONTROL for the firebreak's instrument: it proves
    `json.dumps` succeeds on an artifact from the untouched boundary, so a
    failure in the firebreak convicts the NEW shape rather than the harness.
    """
    for stub in (GOLDEN_STUB, NEIGHBOUR_STUB):
        doc = _record(stub)
        artifact = produce_spec_artifact(
            (doc.get("strategies") or [{}])[0], video=stub, certificate=None, transcript_chars=0
        )
        json.dumps(artifact)
        assert SPEC_ARTIFACT_OPENING_RANGE_LOWERING_KEY not in artifact, (
            "the per-strategy boundary grew a lowering key; STEP 2.1 was supposed to leave "
            "this entry point untouched"
        )


# ── STEP 4 ITEM 1 — THE SOURCE-IDENTITY JOIN (R-778 §4) ───────────────────────
#
# 🛑 WHAT THIS IS, STATED PRECISELY, BECAUSE THE DISTINCTION MATTERS:
# this is an INVARIANT HOLE, not a live defect. `[MEASURED, R-778 §4]` production
# calls the factory with `source_spec_id=video` and
# `source_condition_id=lowering.source_condition_id`, so the LIVE PATH IS CORRECT.
# The envelope simply does not FORBID a wrong one, and `cache_identity` is computed
# FROM those ids — so the hole is closed BEFORE identity starts flowing into
# execution, not after.
#
#   `AN INVARIANT HOLE IS NOT A DEFECT SIGHTING — SAY WHICH ONE YOU FOUND, OR THE
#    NEXT READER WILL "FIX" WORKING CODE.`
def test_the_envelope_refuses_a_candidate_whose_source_ids_disagree_with_its_lowering():
    """RED until STEP 4 item 2 closes the join. Two arms, one control.

    The existing `:918` check compares the DEFINITION OBJECT and nothing else, so a
    candidate carrying the right definition, the right variant and the WRONG
    `source_spec_id` is constructible today.
    """
    result = produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB)
    lowering = result.opening_range_lowering
    candidates = result.opening_range_candidates
    assert candidates, "no candidates to mutate — STEP 3's fan-out regressed"

    def build(cands):
        # dict() so the artifact is never shared between the control and the arms
        return RecordCompileResult(
            artifact=dict(result.artifact),
            opening_range_lowering=lowering,
            opening_range_candidates=cands,
        )

    # ── CONTROL FIRST — the unmutated envelope must still CONSTRUCT.
    # `A GUARD THAT REFUSES EVERYTHING IS NOT A GUARD.` Built through the identical
    # helper the arms use, so a failure below cannot be blamed on the harness.
    build(candidates)

    # ── THE TWO ARMS. Each mutates EXACTLY ONE id and changes nothing else.
    for field, wrong in (
        ("source_spec_id", "NOT-THE-GOLDEN-SPEC"),
        ("source_condition_id", "not-the-taught-condition"),
    ):
        mutated = dataclasses.replace(candidates[0], **{field: wrong})
        assert getattr(mutated, field) == wrong, (
            f"the mutation did not take on {field}; the arm cannot accuse anything"
        )
        # POSITIVE WITNESS that the mutation is REACHABLE by the thing that matters:
        # identity is derived from these ids, so a changed id MUST change the hash.
        assert mutated.cache_identity != candidates[0].cache_identity, (
            f"mutating {field} did not change cache_identity — then this arm is not "
            "exercising the identity risk R-778 §4 names, and closing the join would "
            "be guarding a field nothing depends on"
        )
        with pytest.raises(ValueError):
            build((mutated,) + candidates[1:])


# ── RED 1 — CANDIDATE TRANSPORT FROM A **FULL-RECORD** BOUNDARY ───────────────
def test_a_full_record_compile_boundary_transports_exactly_the_three_taught_candidates():
    """PERMANENT RED until B1 STEP 6. Fails at the FIRST unmet stage and names it.

    R-775 §7-1: entering at `strategies[0] -> produce_spec_artifact()` is entering
    at a boundary that has ALREADY discarded record-level evidence
    (`instrument_classification`), which is exactly what the lowerer needs. A test
    that demanded three fully-sourced candidates from that input would be pressure
    toward the forbidden repairs — file I/O in the compiler, a stub lookup, or
    reconstruction from lossy prose.

    `THE TEST NAMES THE GAP BEFORE THE CODE FILLS IT.` So stage 1 asserts the
    boundary exists; only stage 2 asserts what it must carry.
    """
    # ── STAGE 1 — a PUBLIC production compile boundary that receives the FULL record.
    # 🛑 R-776 §3: this must EXERCISE the real boundary, not inspect a function NAME.
    # `A TEST PINNED TO A FUNCTION NAME GUARDS THE NAME, NOT THE BOUNDARY` — so the
    # assertion below is that the boundary's OUTPUT carries source-complete evidence,
    # which no rename can satisfy and no stub can fake.
    params = set(inspect.signature(produce_spec_artifact_from_record).parameters)
    assert "record" in params, (
        "RED — STAGE 1: the full-record boundary does not take a record.\n"
        f"  parameters : {sorted(params)}"
    )

    result = produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB)
    lowering = result.opening_range_lowering
    assert lowering is not None and lowering.definition is not None, (
        "RED — STAGE 1: the full-record boundary exists but does not carry an authoritative "
        "opening-range lowering for the golden record.\n"
        f"  lowering : {lowering}\n"
        "  record-level instrument_classification is what makes market_scope locatable; if "
        "this is None the boundary is still entering at the lossy per-strategy seam."
    )
    assert tuple(v.duration_minutes for v in lowering.definition.variants) == TAUGHT_DURATIONS, (
        "RED — STAGE 1: the boundary lowered a definition whose taught variants are not the "
        f"three taught windows in taught order: "
        f"{tuple(v.duration_minutes for v in lowering.definition.variants)}"
    )

    # ── STAGE 2 — candidate transport.
    # R-777 §5 named the carrier: the typed compiler-result envelope. So the search
    # covers BOTH the envelope and the compiled plan — still BY TYPE, still refusing
    # to prescribe an attribute. A carrier this guard did not anticipate is still
    # found; a variant smuggled as a string in `ConditionBinding.parameters` is not.
    plan = compile_binding_plan(result.artifact["spec"])
    candidates = _find_candidates((result, plan))
    durations = tuple(c.variant.duration_minutes for c in candidates)
    assert durations == TAUGHT_DURATIONS, (
        "RED — STAGE 2 (expected until B1 STEP 6 / STEP 3): the full-record boundary now "
        "lowers a source-complete definition with all three taught windows, but the compiled "
        "plan does not yet TRANSPORT them as execution candidates.\n"
        f"  expected : {TAUGHT_DURATIONS}\n  found    : {durations or '(none)'}\n"
        "  ⇒ STAGE 1 is repaired; this is the next handoff, and it is STEP 3's."
    )

    # ── STAGE 3 — the two identities are distinct across the fan-out.
    # R-777 §5 requires the EXISTING identity system and forbids inventing a second.
    # `A UNIQUENESS GUARD PROVES UNIQUENESS OF THE FIELD IT READS, AND OF NOTHING
    #  ELSE` (R-738 §7-2), so both are checked: `candidate_id` is the human-traceable
    # name, `cache_identity` is the content hash.
    #
    # 🛑 CORRECTED (R-778 §3) — THE PREVIOUS COMMENT HERE WAS FALSE, AND ITS FALSENESS
    # WAS THE POINT. It claimed "a fan-out that returned the same object three times
    # satisfies the duration tuple above and fails here." IT DOES NOT: `_find_candidates`
    # de-duplicates by `id(obj)`, so three references to ONE object are observed as ONE
    # candidate and STAGE 2's duration tuple fails first — measured, by mutation.
    #
    #   `A COMMENT THAT DESCRIBES WHAT A TEST WOULD CATCH IS A MECHANISM CLAIM ABOUT YOUR
    #    OWN INSTRUMENT AND CARRIES AN EVIDENCE GRADE LIKE ANY OTHER. A WRONG ONE IS
    #    OBEYED BY EVERY FUTURE READER, WHO THEN STOPS LOOKING.`
    #
    # WHAT THIS STAGE HONESTLY IS: defence-in-depth on the golden fixture, which cannot
    # express the case that would isolate it. The INDEPENDENT identity proof lives in
    # `test_opening_range_candidate.py`, whose fixture CAN — two legal variants sharing a
    # duration but differing in label. Kept, not deleted; scoped, not oversold.
    #
    # ⚠️ AND THE FINDER'S LIMIT, STATED RATHER THAN DISCOVERED: `_find_candidates` cannot
    # distinguish "three identical objects" from "one object", by construction.
    ids = [c.candidate_id for c in candidates]
    identities = [c.cache_identity for c in candidates]
    assert len(set(ids)) == len(candidates), (
        f"candidate_id is not unique across the fan-out: {ids}\n"
        "  ⇒ the three taught windows are not three distinguishable candidates."
    )
    assert len(set(identities)) == len(candidates), (
        f"cache_identity collides across the fan-out: {identities}\n"
        "  ⇒ two candidates hash identically, so a cache keyed on this would serve one "
        "window's result for another's."
    )


# ── RED 2 — PRODUCTION ITSELF MUST REACH THE ADAPTER ──────────────────────────
def test_the_production_dispatch_path_executes_the_adapter_once_per_taught_candidate(monkeypatch):
    """PERMANENT RED until B1 STEP 6 declares, routes AND executes.

    🛑 THIS TEST NEVER CALLS THE ADAPTER, AND NEVER CALLS THE SPY.
    R-775 §1 defect 2: the previous version looped over candidates calling `spy(...)`
    itself, so the `(5,15,30)` it asserted was a list the TEST appended. It would
    have passed with candidates + a FAMILY_META string + a resolver entry and NO
    EXECUTABLE DISPATCH ANYWHERE — a future false green on the one claim this whole
    lane exists to make.

    `A CONTROL THAT HANDS THE COMPARATOR ITS ANSWER IS TESTING THE COMPARATOR, NOT
     THE GUARD.` — AR-893 §3, minted by this seat and then broken by it one lane later.

    The spy list here can only be filled by `SpecConditionStrategy._dispatch_enforced`,
    which routes `ENFORCED_DISPATCH[binding.primitive]` and RAISES on an unroutable
    name rather than passing through.
    """
    meta = FAMILY_META[FAMILY]
    assert meta.primitive is not None and not meta.unsupported, (
        "RED (expected until B1 STEP 6) — STAGE 1: production declares NO primitive for "
        f"{FAMILY}, so no dispatch can exist.\n"
        f"  primitive : {meta.primitive} · unsupported : {meta.unsupported}\n"
        f"  unbound_reason : {meta.unbound_reason}\n"
        "  (the executable adapter EXISTS and is green — this is a wiring gap)"
    )
    assert meta.primitive in PRIMITIVE_RESOLVERS, (
        f"RED — STAGE 2: {FAMILY} declares {meta.primitive!r} but PRIMITIVE_RESOLVERS has no "
        "entry — a declared name with no route is an unroutable pointer"
    )

    calls: list[int] = []
    real = compute_opening_range_state

    def spy(definition, variant, bars, **kw):
        calls.append(variant.duration_minutes)
        return real(definition, variant, bars, **kw)

    monkeypatch.setattr(
        "src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True
    )

    _, artifact, plan = _produce(GOLDEN_STUB)
    binding = next(
        (b for b in plan.bindings if b.type == FAMILY),
        None,
    )
    assert binding is not None, f"RED — STAGE 3: no {FAMILY} binding in the compiled plan"

    strategy = SpecConditionStrategy(artifact, binding_plan=plan)

    # PRODUCTION performs the dispatch. The test hands it a binding and a context and
    # touches nothing else; if production does not reach the adapter, `calls` stays empty.
    strategy._dispatch_enforced(binding, {})

    assert tuple(calls) == TAUGHT_DURATIONS, (
        "RED — STAGE 4: the production dispatch path did not execute the adapter once per "
        f"taught candidate.\n  expected calls : {TAUGHT_DURATIONS}\n  observed calls : "
        f"{tuple(calls)}\n"
        "  the patch IS attached at the resolution seam (proven by the positive witness in "
        "this file), so an empty tuple means production never reached the adapter."
    )


# ── PRESERVED (R-775 §7-4) — the refusing neighbour yields NOTHING ────────────
def test_the_source_incomplete_neighbour_yields_zero_candidates_and_zero_adapter_calls(monkeypatch):
    """The refusal side of the contract, kept executable rather than asserted in prose."""
    calls: list[int] = []
    real = compute_opening_range_state

    def spy(definition, variant, bars, **kw):
        calls.append(variant.duration_minutes)
        return real(definition, variant, bars, **kw)

    monkeypatch.setattr(
        "src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True
    )

    # R-776 §4 REQUIRED BEHAVIOUR, the refusal arm — measured THROUGH the full-record
    # boundary, so it guards the boundary rather than the lowerer in isolation.
    result = produce_spec_artifact_from_record(_record(NEIGHBOUR_STUB), video=NEIGHBOUR_STUB)
    lowering = result.opening_range_lowering
    assert lowering is not None and lowering.definition is None, (
        "the full-record boundary produced a definition for the SOURCE_INCOMPLETE neighbour; "
        f"a refusal was turned into a READY.\n  lowering : {lowering}"
    )
    assert lowering.refusal is not None and lowering.refusal.missing_fields, (
        "the neighbour refused without naming a missing field — an unnamed refusal is "
        "indistinguishable from a crash"
    )

    plan = compile_binding_plan(result.artifact["spec"])
    assert _find_candidates((result, plan)) == [], (
        "a SOURCE_INCOMPLETE record produced execution candidates — the refusal is not "
        "being preserved through the compile"
    )
    assert calls == [], "a SOURCE_INCOMPLETE record reached the adapter"
