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

import numpy as np
import pytest

from src.engine.extraction.spec_producer import (
    SPEC_ARTIFACT_OPENING_RANGE_LOWERING_KEY,
    RecordCompileResult,
    produce_spec_artifact,
    produce_spec_artifact_from_record,
)
from src.engine.family_meta_enforcement import FLAG_ENV, PRIMITIVE_RESOLVERS
from src.engine.opening_range_adapter import OpeningRangeBar, compute_opening_range_state
from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate
from src.engine.opening_range_lowering import (
    COMMITTED_PROVENANCE_DIR,
    lower_opening_range_definition,
)
from src.engine.spec_condition_compiler import ENFORCED_DISPATCH, SpecConditionStrategy
from src.engine.spec_family_bindings import (
    FAMILY_META,
    ConditionBinding,
    compile_binding_plan,
)

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


# ── THE EXECUTION-SIDE FIXTURE (R-779 §7 COMMIT 1) ────────────────────────────
# An ordinary weekday, deliberately not a holiday and not a DST changeover: a
# fixture that straddles a DST boundary would make a REAL zone bug look like a
# test bug, and vice versa.
SESSION_DATE = date(2026, 3, 3)
# One-minute bars, so the taught 5/15/30 windows are expressible on the grid and
# the instance's `timeframe` (a REAL production constructor parameter) says so.
BAR_INTERVAL_MINUTES = 1
BAR_TIMEFRAME = "1m"
# Long enough that ALL THREE windows have closed by the last bar. A frame ending
# at 09:59 would leave the 30m window FORMING, and a refusal that is really a
# short fixture is the most convincing wrong answer available here.
SESSION_MINUTES = 45


def _taught_session_bars(definition, minutes: int = SESSION_MINUTES) -> list[OpeningRangeBar]:
    """One 1-minute bar per minute from the TAUGHT session start, on the grid, no gaps.

    The start instant comes OFF THE DEFINITION (`session_start_local` /
    `source_timezone`), never from a literal in this file. A fixture that hardcodes
    09:30 stops measuring the source the moment the source says something else, and
    it would still look green while doing it.

    Highs/lows widen with the minute, so a LONGER window necessarily produces a
    WIDER range — which is what makes "three windows, three different states"
    observable rather than asserted.
    """
    zone = ZoneInfo(definition.source_timezone)
    hour_text, _, minute_text = definition.session_start_local.partition(":")
    start = datetime(
        SESSION_DATE.year,
        SESSION_DATE.month,
        SESSION_DATE.day,
        int(hour_text),
        int(minute_text),
        tzinfo=zone,
    )
    return [
        OpeningRangeBar(timestamp=start + timedelta(minutes=i), high=100.0 + i, low=100.0 - i)
        for i in range(minutes)
    ]


def _dispatch_ctx(bars: list[OpeningRangeBar]) -> dict:
    """The slice of production's real `ctx` an opening-range handler can read.

    Keys mirror `spec_condition_compiler.compute()`'s own ctx construction (`n`,
    `ts_list`, `open_`/`high`/`low`/`close`), built here from the SAME bars the
    adapter will see. `ts_list` entries are tz-aware, exactly as `_bars_to_ts_list`
    normalises them in production.

    🛑 IT INVENTS NO KEY PRODUCTION DOES NOT HAVE. The bar interval is NOT smuggled
    in here — it is carried by the instance's `timeframe`, which is a real
    constructor parameter. `A FIXTURE THAT HANDS THE HANDLER A KEY PRODUCTION NEVER
    BUILDS IS TESTING A CONTEXT THAT WILL NEVER EXIST.`
    """
    high = np.array([b.high for b in bars], dtype=np.float64)
    low = np.array([b.low for b in bars], dtype=np.float64)
    mid = (high + low) / 2.0
    return {
        "n": len(bars),
        "ts_list": [b.timestamp for b in bars],
        "open_": mid.copy(),
        "high": high,
        "low": low,
        "close": mid.copy(),
    }


def _candidate_carrier_parameter() -> str | None:
    """The constructor parameter that carries ONE typed execution candidate, or None.

    🛑 DISCOVERED BY TYPE, NEVER BY A NAME THIS TEST CHOSE. `R-779 §7-1` requires the
    carrier to be "an explicit typed input", so the ANNOTATION is the contract and any
    parameter name the wiring picks satisfies this guard. Pinning a name here would
    reproduce exactly the defect `R-776 §3` deleted:

      `A TEST PINNED TO A NAME GUARDS THE NAME, NOT THE BOUNDARY.`

    Reads string annotations and real objects alike, because whether this module has
    `from __future__ import annotations` is not a fact this guard should depend on.
    """
    for name, param in inspect.signature(SpecConditionStrategy.__init__).parameters.items():
        annotation = param.annotation
        text = (
            annotation
            if isinstance(annotation, str)
            else getattr(annotation, "__name__", "") or str(annotation)
        )
        if OpeningRangeExecutionCandidate.__name__ in text:
            return name
    return None


def _require_activated() -> str:
    """The four production facts every execution arm below needs, or a RED that NAMES
    the first missing one.

    🛑 THIS EXISTS TO PREVENT A FALSE GREEN, AND THE FALSE GREEN IS SPECIFIC. Each arm
    below asserts a REFUSAL or a MIS-ROUTE. Today production raises
    `FamilyMetaEnforcementError` for a completely different reason — the primitive is
    not routed at all — so an arm written as a bare `pytest.raises` would go GREEN
    immediately, on an exception that has nothing to do with what it claims to guard.

      `AN ARM THAT PASSES BEFORE THE FEATURE EXISTS IS NOT A GUARD, IT IS A
       COINCIDENCE WITH AN ASSERTION ATTACHED.`

    So every arm calls this first and is RED until the activation lands.

    🛑 STAGE ORDER IS THE PATH'S OWN EXECUTION ORDER, NOT A RANKING I CHOSE. An
    execution instance is CONSTRUCTED before anything is dispatched, so the carrier is
    the first fact the path needs; declaration, resolver and routing are read inside
    `_dispatch_enforced`, which cannot run until construction has succeeded.
    """
    # ── FIRST: the carrier. Construction precedes dispatch.
    carrier = _candidate_carrier_parameter()
    assert carrier is not None, (
        "RED — production offers NO typed carrier for bringing ONE taught execution "
        "candidate into an execution instance.\n"
        f"  SpecConditionStrategy.__init__ parameters : "
        f"{sorted(inspect.signature(SpecConditionStrategy.__init__).parameters)}\n"
        f"  none is annotated with {OpeningRangeExecutionCandidate.__name__}\n"
        "  ⇒ the compiler now produces three taught candidates and the runtime has "
        "nowhere to put one. Until this exists, 'which window is this instance "
        "computing' has no answer that is not a guess.\n"
        "  ⚠️ NOT THE ONLY GAP — declaration, resolver and routing are ALSO absent "
        "behind it; they are simply not reachable until an instance can be built."
    )
    # ── THEN the three dispatch-time facts, in the order `_dispatch_enforced` needs them.
    meta = FAMILY_META[FAMILY]
    assert meta.primitive is not None and not meta.unsupported, (
        "RED (expected until the S6 EXECUTION ACTIVATION, R-779 §7 COMMIT 2) — production "
        f"declares NO primitive for {FAMILY}.\n"
        f"  primitive : {meta.primitive} · unsupported : {meta.unsupported}\n"
        f"  unbound_reason : {meta.unbound_reason}"
    )
    assert meta.primitive in PRIMITIVE_RESOLVERS, (
        f"RED — {FAMILY} declares {meta.primitive!r} but PRIMITIVE_RESOLVERS has no entry: "
        "a declared name with no route is an unroutable pointer"
    )
    # R-779 §3: the engine does not ask for RESOLVABLE, it asks for ROUTED.
    # `verify_dispatch_coverage`'s direction-1 loop has no waiver, so a declared
    # primitive absent from ENFORCED_DISPATCH is a pin (a) violation by construction.
    assert meta.primitive in ENFORCED_DISPATCH, (
        f"RED — {FAMILY} declares {meta.primitive!r} and resolves it, but the executable "
        "layer routes no such key. `RESOLVABLE IS NOT ROUTED`"
    )
    return carrier


def _execution_instance(artifact: dict, plan, candidate: OpeningRangeExecutionCandidate):
    """ONE production execution instance carrying ONE candidate — R-779 §7's shape.

    `R-736`/`R-743`, settled and not re-opened here: the teacher gave three versions,
    so the factory makes three bots. There is no default, no primary, and no
    `candidates[0]` — each instance is told exactly which taught window it is.
    """
    carrier = _require_activated()
    return SpecConditionStrategy(
        artifact,
        binding_plan=plan,
        timeframe=BAR_TIMEFRAME,
        **{carrier: candidate},
    )


def _opening_range_binding(plan):
    return next((b for b in plan.bindings if b.type == FAMILY), None)


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
    """PERMANENT RED until the S6 EXECUTION ACTIVATION declares, routes AND executes.

    🛑 MOVED ONTO THE FULL-RECORD CANDIDATE-AWARE PATH (R-778 §6, ordered again at
    R-779 §7 COMMIT 1). The previous version built its setup through
    `_produce(GOLDEN_STUB)` — the OLD per-strategy boundary — and then dispatched ONE
    strategy that carried no candidate at all. That shape CANNOT express the claim
    this lane exists to make: the taught 5/15/30 now live on `RecordCompileResult`,
    not in that artifact, so a test entering there is asking production to rediscover
    what the compiler already computed, and the four forbidden escapes (stuffing
    candidates into the `SpecArtifact`, `ConditionBinding.parameters`, re-reading the
    source, or choosing a candidate downstream) are exactly the shortcuts it would
    invite.

    `THE TEST THAT PROVES THE BREAKTHROUGH MUST ENTER THROUGH THE DOOR THE
     BREAKTHROUGH BUILT.` (R-778 §6)

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
    # ── STAGE 1 — the CANDIDATES, from the full-record boundary. Green since STEP 3.
    # This is setup, not the claim: if it ever reddens, RED 1 reddens with it and the
    # failure is transport, not execution.
    result = produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB)
    plan = compile_binding_plan(result.artifact["spec"])
    candidates = _find_candidates((result, plan))
    durations = tuple(c.variant.duration_minutes for c in candidates)
    assert durations == TAUGHT_DURATIONS, (
        "RED — STAGE 1: the full-record boundary did not transport the three taught "
        f"candidates.\n  expected : {TAUGHT_DURATIONS}\n  found    : {durations or '(none)'}\n"
        "  ⇒ this is RED 1's territory, not this test's; fix transport first."
    )

    # ── STAGE 2 — declaration · resolver · ROUTING · carrier. Names the first gap.
    _require_activated()

    calls: list[int] = []
    real = compute_opening_range_state

    def spy(definition, variant, bars, **kw):
        calls.append(variant.duration_minutes)
        return real(definition, variant, bars, **kw)

    monkeypatch.setattr(
        "src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True
    )

    binding = _opening_range_binding(plan)
    assert binding is not None, f"RED — STAGE 3: no {FAMILY} binding in the compiled plan"

    lowering = result.opening_range_lowering
    ctx_bars = _taught_session_bars(lowering.definition)

    # ── STAGE 4 — ONE PRODUCTION INSTANCE PER TAUGHT CANDIDATE.
    # PRODUCTION performs every dispatch. The test hands each instance its own
    # candidate, a binding and a context, and touches nothing else; if production does
    # not reach the adapter, `calls` stays empty.
    for candidate in candidates:
        strategy = _execution_instance(result.artifact, plan, candidate)
        strategy._dispatch_enforced(binding, _dispatch_ctx(ctx_bars))

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


# ══════════════════════════════════════════════════════════════════════════════
# RED-CAPABLE ARMS (R-779 §7 COMMIT 1-2). All three are RED today, at the SAME
# boundary RED 2 names, because `_require_activated()` runs first in each. They
# exist now so the activation cannot land without them, and so none of them can
# be written after the fact to fit whatever the activation happens to do.
#
#   `A CONTROL WRITTEN AFTER THE CODE IT CHECKS IS A DESCRIPTION OF THAT CODE.`
# ══════════════════════════════════════════════════════════════════════════════


# ── ARM 1 — NO CANDIDATE MUST REFUSE, LOUDLY, AND NEVER PICK ONE ──────────────
def test_an_execution_instance_with_no_candidate_refuses_and_never_reaches_the_adapter(
    monkeypatch,
):
    """An opening-range binding arriving with NO candidate is a HARD REFUSAL.

    🛑 THIS IS THE ARM THAT FORBIDS THE CONVENIENT REPAIR. The tempting
    implementation — "if no candidate was supplied, use the first / the 15m / the
    longest" — is precisely what `R-736`/`R-743` settled against and what
    `R-779 §7`'s forbidden list names again. A silent default here would produce a
    bot that trades a window the teacher's lesson did not assign to it, and every
    downstream number would look perfectly reasonable.

    ⚖️ AND IT IS NOT OPTION `A`. Option `A` — rejected at `R-779 §4` — was a handler
    that refuses ALWAYS, standing in for execution that does not exist. This refuses
    ONLY when the contract is violated; the same handler executes fully when a
    candidate is present (RED 2 above is the arm that proves that).
    """
    _require_activated()

    calls: list[int] = []
    real = compute_opening_range_state

    def spy(definition, variant, bars, **kw):
        calls.append(variant.duration_minutes)
        return real(definition, variant, bars, **kw)

    monkeypatch.setattr(
        "src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True
    )

    result = produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB)
    plan = compile_binding_plan(result.artifact["spec"])
    binding = _opening_range_binding(plan)
    assert binding is not None, f"no {FAMILY} binding in the compiled plan"

    # Built through the SAME production constructor, with the carrier simply not
    # supplied — the state a real caller reaches by forgetting, not a mutated object.
    bare = SpecConditionStrategy(result.artifact, binding_plan=plan, timeframe=BAR_TIMEFRAME)
    ctx = _dispatch_ctx(_taught_session_bars(result.opening_range_lowering.definition))

    with pytest.raises(Exception) as excinfo:
        bare._dispatch_enforced(binding, ctx)

    message = str(excinfo.value).lower()
    assert "candidate" in message, (
        "the refusal does not mention the candidate, so it is not evidence that the "
        "MISSING CANDIDATE caused it — an unnamed refusal is indistinguishable from an "
        f"unrelated crash.\n  raised : {excinfo.value!r}"
    )
    # POSITIVE WITNESS FOR A NEGATIVE ASSERTION: `calls == []` alone is satisfied by a
    # handler that does nothing at all. The raise above proves the path RAN and then
    # refused; this proves it refused BEFORE the adapter rather than after it.
    assert calls == [], (
        "the adapter was reached despite no candidate being supplied — production picked "
        f"a window nobody assigned it: {calls}"
    )


# ── ARM 2 — AN INSTANCE USES ITS OWN CANDIDATE, AND A SWAP IS OBSERVABLE ──────
def test_control_an_execution_instance_computes_ITS_OWN_candidate_not_another(monkeypatch):
    """DISCRIMINATION CONTROL for RED 2. Without it, `(5, 15, 30)` is weaker than it looks.

    RED 2 dispatches three instances and reads `(5, 15, 30)`. That tuple is also
    consistent with an implementation that ignores the carrier entirely and iterates
    the candidate collection inside the handler — which is `R-779 §7`'s forbidden
    "search the collection" shape wearing the right answer.

    So this arm hands ONE instance the 15m candidate and requires the observed call to
    be 15m. If the instance is reading anything other than the candidate it was given —
    the first, the longest, a default — this reddens and RED 2's tuple is exposed as
    an accident of ordering.

      `A GUARD THAT READS THE RIGHT ANSWER FROM THE WRONG FIELD IS GREEN FOR AS LONG
       AS THE TWO AGREE.`
    """
    _require_activated()

    calls: list[int] = []
    real = compute_opening_range_state

    def spy(definition, variant, bars, **kw):
        calls.append(variant.duration_minutes)
        return real(definition, variant, bars, **kw)

    monkeypatch.setattr(
        "src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True
    )

    result = produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB)
    plan = compile_binding_plan(result.artifact["spec"])
    candidates = _find_candidates((result, plan))
    assert len(candidates) == len(TAUGHT_DURATIONS), (
        f"expected {len(TAUGHT_DURATIONS)} taught candidates, found {len(candidates)}"
    )
    binding = _opening_range_binding(plan)
    ctx = _dispatch_ctx(_taught_session_bars(result.opening_range_lowering.definition))

    middle = candidates[1]
    assert middle.variant.duration_minutes != candidates[0].variant.duration_minutes, (
        "the fixture cannot discriminate: the second candidate has the same duration as "
        "the first, so reading either would look identical"
    )

    _execution_instance(result.artifact, plan, middle)._dispatch_enforced(binding, ctx)

    assert tuple(calls) == (middle.variant.duration_minutes,), (
        "the instance did not compute the candidate it was constructed with.\n"
        f"  constructed with : {middle.variant.duration_minutes}m "
        f"({middle.variant.variant_label!r})\n"
        f"  adapter observed : {tuple(calls) or '(never called)'}\n"
        "  ⇒ production is reading a window from somewhere other than its own carrier."
    )
    # AND THE IDENTITY SURVIVED THE CARRIER (R-779 §7): if `candidate_id` /
    # `cache_identity` vanish on entry to the strategy, that is a FINDING, not a detail.
    assert middle.candidate_id and middle.cache_identity, (
        "the candidate handed to production carries no identity, so nothing downstream "
        "can tell these three apart"
    )


# ── ARM 3 — A DURATION SMUGGLED THROUGH `parameters` MUST REFUSE FIRST ────────
def test_a_duration_smuggled_into_binding_parameters_refuses_before_the_adapter(monkeypatch):
    """The taught windows have a TYPED carrier, so `ConditionBinding.parameters` must
    never become a second one.

    `R-703 §1` / `R-779 §7`: the parameter channel does not carry opening-range
    semantics, and `HANDLER_PARAMETER_CLASSIFICATION` must classify the handler
    `REFUSES_ALL_PARAMETERS`. `R-779 §5-B` names the mechanism precisely, and it is
    NOT "it fails closed quietly": omitting the classification turns
    `test_parameter_acceptance_guard.py`'s set-equality assertion RED. This arm guards
    the RUNTIME half of the same contract — that a smuggled key refuses BEFORE any
    computation rather than being accepted and discarded.

    Measured through `_acknowledge_parameters`, which is `compute()`'s FIRST statement
    and therefore precedes every evaluator, cache write and condition-state
    publication (`A REFUSAL THAT FIRES AFTER A MUTATION IS A PARTIAL RUN WEARING AN
    EXCEPTION.`).
    """
    _require_activated()

    calls: list[int] = []
    real = compute_opening_range_state

    def spy(definition, variant, bars, **kw):
        calls.append(variant.duration_minutes)
        return real(definition, variant, bars, **kw)

    monkeypatch.setattr(
        "src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True
    )
    # The refusal lives on the ENFORCED path; production default is OFF (R-697 §5.10
    # stands — this enables it for THIS TEST ONLY, exactly as the parameter-acceptance
    # suite does).
    monkeypatch.setenv(FLAG_ENV, "true")

    result = produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB)
    plan = compile_binding_plan(result.artifact["spec"])
    candidates = _find_candidates((result, plan))
    binding = _opening_range_binding(plan)
    assert binding is not None, f"no {FAMILY} binding in the compiled plan"

    smuggled = dataclasses.replace(binding, parameters=(("duration_minutes", 15),))
    plan.bindings = [smuggled if b is binding else b for b in plan.bindings]
    assert any(b.parameters for b in plan.bindings), (
        "the smuggled parameter did not survive into the plan, so this arm would pass "
        "without ever exercising the refusal"
    )
    assert isinstance(smuggled, ConditionBinding)

    strategy = _execution_instance(result.artifact, plan, candidates[0])

    with pytest.raises(ValueError) as excinfo:
        strategy._acknowledge_parameters(SESSION_MINUTES, enforced=True)

    assert "duration_minutes" in str(excinfo.value), (
        "the refusal did not NAME the unsupported key, so it tells a reader to go and "
        f"look rather than what to change (R-704 §4A).\n  raised : {excinfo.value!r}"
    )
    assert calls == [], "a smuggled duration reached the adapter before being refused"


# ═════════════════════════════════════════════════════════════════════════════
# STEP 1 (R-780 §6) — THE FLAG-OFF SILENT-PASS DECIDER
#
# R-780 §4 makes this red the DECIDER for member 11: does an ACTIVATED
# opening-range condition, with `TF_FAMILY_META_ENFORCED` at its DEFAULT OFF,
# fall through the legacy `b.type` ladder to `else: np.ones` = CONSTANT TRUE?
#
# 🛑 THE SHIELD THAT HIDES THE QUESTION IS THE DECLARATION ITSELF.
# [MEASURED] `spec_family_bindings.py:2633  if meta.unsupported:` returns
# `bindable=False, executed=False`, and the golden binding reads exactly that
# today. So `spec_condition_compiler.py:1830 if not b.executed: continue` skips
# the condition before the ladder is ever consulted. The family is safe today
# because it never executes -- `SAFETY BY STARVATION IS NOT SAFETY BY DESIGN`
# (R-780 §4) -- and the activation is the INSERT.
#
# ⇒ To ask the question WITHOUT a production edit, arm 1 applies MEMBER 4 ALONE
#   (the declaration) as a monkeypatch and lets PRODUCTION's own binder and
#   PRODUCTION's own router answer. Nothing else is faked: the plan is compiled
#   by `compile_binding_plan`, the array is produced by `compute()`, and the
#   positive witness below asserts the shields dropped through the REAL binder
#   rather than trusting that the patch did what I intended.
#
# ⭐ AND THIS IS WHY ARM 1 CAN DECIDE TODAY WHERE `RED 2` CANNOT: the flag-OFF
#   ladder routes on `b.type` and never reaches `_h_opening_range`, so it needs
#   NO candidate carrier. Every candidate-aware arm above dies at
#   `_require_activated()`; this one runs all the way to the array.
# ═════════════════════════════════════════════════════════════════════════════

# The primitive string member 4 will declare. Named here so the fixture is
# explicit, but the flag-OFF ladder routes on `b.type` and never reads it --
# which is itself part of the finding.
DECLARED_PRIMITIVE = "opening_range_adapter.compute_opening_range_state"


def _polars_session_bars(bars: list[OpeningRangeBar]):
    """The SAME taught session bars, in the frame `compute()` consumes.

    Derived from `_taught_session_bars` rather than re-invented, so the window
    the adapter would lock on and the bars the ladder sees are one population.
    `OpeningRangeBar` carries only timestamp/high/low ([MEASURED]
    opening_range_adapter.py:106-108), so open/close are placed INSIDE that
    range and never outside it.
    """
    import polars as pl

    return pl.DataFrame(
        {
            "ts_event": [b.timestamp for b in bars],
            "open": [(b.high + b.low) / 2 for b in bars],
            "high": [b.high for b in bars],
            "low": [b.low for b in bars],
            "close": [(b.high + b.low) / 2 for b in bars],
            "volume": [1000 for _ in bars],
        }
    )


def _declaration_only_activation(monkeypatch) -> None:
    """MEMBER 4 AND NOTHING ELSE: retire `unsupported`, declare the primitive.

    🛑 This is TEST-ONLY and edits no production file. It is deliberately the
    SMALLEST possible piece of the activation -- no carrier, no handler, no
    resolver, no ENFORCED_DISPATCH entry -- because the claim under test is
    precisely that the DECLARATION alone is enough to expose the hole.
    """
    meta = FAMILY_META[FAMILY]
    monkeypatch.setitem(
        FAMILY_META,
        FAMILY,
        dataclasses.replace(
            meta, unsupported=False, primitive=DECLARED_PRIMITIVE, unbound_reason=None
        ),
    )


# ── CONTROL — today the condition never reaches the ladder at all ────────────
def test_control_flag_off_todays_unactivated_binding_never_reaches_the_ladder(monkeypatch):
    """Discriminates the THIRD possibility, which is neither 'reachable' nor
    'gated elsewhere': the key could simply never be written, making the output
    ABSENT rather than constant-True. It must be ABSENT here, and PRESENT in
    arm 1 -- otherwise arm 1's red is a pre-existing condition rather than the
    activation's own blast radius."""
    monkeypatch.delenv(FLAG_ENV, raising=False)

    _, artifact, plan = _produce(GOLDEN_STUB)
    binding = _opening_range_binding(plan)
    assert binding is not None and not binding.executed and not binding.bindable, (
        "today's shield moved: the golden opening-range binding is no longer "
        f"executed=False/bindable=False (executed={binding.executed}, "
        f"bindable={binding.bindable}) -- re-derive R-780 §4 before trusting arm 1"
    )

    strategy = SpecConditionStrategy(artifact, binding_plan=plan, timeframe=BAR_TIMEFRAME)
    strategy.compute(_polars_session_bars(_taught_session_bars(_lower_golden().definition)))

    assert binding.condition_id not in strategy.last_per_condition_bool, (
        "the unactivated condition produced a per-bar array; then the ladder is "
        "already reachable and arm 1 is not measuring the activation"
    )


# ── ARM 1 — THE DECIDER. RED means member 11 is REAL. ────────────────────────
def test_flag_off_an_activated_opening_range_condition_silently_passes_constant_true(
    monkeypatch,
):
    """RED = the hole is REAL and REACHABLE ⇒ build member 11 (R-780 §4).

    A constant-True array is the engine asserting, on EVERY bar, that a taught
    entry condition is satisfied -- with no adapter call, no window, and no
    range. That is architecture invariant 2 inverted: source-owned entry logic
    silently rewritten into `always`.
    """
    monkeypatch.delenv(FLAG_ENV, raising=False)
    _declaration_only_activation(monkeypatch)

    _, artifact, plan = _produce(GOLDEN_STUB)
    binding = _opening_range_binding(plan)
    assert binding is not None, f"no {FAMILY} binding in the compiled plan"

    # POSITIVE WITNESS 1 — the shields actually dropped, through the REAL binder.
    # Without this, a passing assertion below could mean 'the ladder was never
    # reached', which is the opposite conclusion.
    assert binding.executed and binding.bindable, (
        "RED-PROOF BROKEN, NOT A FINDING — the declaration alone did not clear "
        f"the two ladder shields (executed={binding.executed}, "
        f"bindable={binding.bindable}). spec_condition_compiler.py:1830/:1837 "
        "still skip this condition, so nothing below measures the ladder."
    )

    calls: list[int] = []
    real = compute_opening_range_state

    def spy(definition, variant, bars, **kw):
        calls.append(variant.duration_minutes)
        return real(definition, variant, bars, **kw)

    monkeypatch.setattr(
        "src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True
    )

    session_bars = _taught_session_bars(_lower_golden().definition)
    strategy = SpecConditionStrategy(artifact, binding_plan=plan, timeframe=BAR_TIMEFRAME)
    strategy.compute(_polars_session_bars(session_bars))

    # POSITIVE WITNESS 2 — the path RAN and produced an array for THIS condition.
    # A negative assertion needs a witness that the path executed.
    assert binding.condition_id in strategy.last_per_condition_bool, (
        "no per-bar array was produced for the activated condition, so 'not "
        "constant True' below would be satisfied by absence rather than behaviour"
    )
    array = np.asarray(strategy.last_per_condition_bool[binding.condition_id])
    assert array.shape == (len(session_bars),), (
        f"array length {array.shape} does not match the {len(session_bars)} bars fed in"
    )

    # ── THE CLAIM ────────────────────────────────────────────────────────────
    assert not array.all(), (
        "RED — FLAG-OFF SILENT PASS CONFIRMED. With TF_FAMILY_META_ENFORCED at its "
        "DEFAULT OFF, an ACTIVATED opening-range condition produces a CONSTANT-TRUE "
        "per-bar array.\n"
        f"  bars                 : {len(session_bars)}   all True: {bool(array.all())}\n"
        f"  adapter calls        : {tuple(calls)}   <- production never computed a range\n"
        "  the legacy b.type ladder (spec_condition_compiler.py:1847-1927) has NO\n"
        "  OPENING_RANGE_DEFINITION branch, so the condition lands on :1928\n"
        "  `else: per_condition_bool[...] = np.ones(n, dtype=bool)`.\n"
        "  ⇒ MEMBER 11 IS REAL AND REACHABLE: the flag-OFF ladder needs its own\n"
        "    route to the SAME _h_opening_range."
    )
    assert calls, (
        "the array is not constant-True, but production never reached the adapter "
        "either — something else is producing it and the conclusion above does not follow"
    )


# ── ARM 2 — the ordered candidate-aware shape (R-780 §6 STEP 1 verbatim) ─────
def test_flag_off_the_candidate_aware_instance_gates_on_the_real_window(monkeypatch):
    """The assertions STEP 1 names that CANNOT be made without the carrier:
    pre-lock False, post-lock True, and a gate computed from the taught window.

    🛑 RED at `_require_activated()` until the activation lands -- by design.
    Arm 1 is what decides member 11 today; this one pins what the flag-OFF path
    must DO once a candidate can reach it, so the activation cannot land with
    the ladder branch returning something other than the adapter's own answer.
    """
    monkeypatch.delenv(FLAG_ENV, raising=False)

    result = produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB)
    plan = compile_binding_plan(result.artifact["spec"])
    candidates = _find_candidates((result, plan))
    assert candidates, "RED 1's territory: no taught candidates to carry"

    _require_activated()

    binding = _opening_range_binding(plan)
    session_bars = _taught_session_bars(result.opening_range_lowering.definition)
    frame = _polars_session_bars(session_bars)

    for candidate in candidates:
        strategy = _execution_instance(result.artifact, plan, candidate)
        strategy.compute(frame)
        array = np.asarray(strategy.last_per_condition_bool[binding.condition_id])
        lock_index = candidate.variant.duration_minutes
        assert not array[:lock_index].any(), (
            f"{lock_index}m instance: the window has not locked yet, so the state is "
            "NOT available and the gate must be False on every pre-lock bar"
        )
        assert array[lock_index:].all(), (
            f"{lock_index}m instance: after the lock the state is available and complete"
        )
        assert not array.all(), (
            f"{lock_index}m instance: a constant-True array is the all-True fallback, "
            "not a gate computed from the taught window"
        )
