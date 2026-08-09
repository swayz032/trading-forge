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
RED 1 searches the compiled plan for `OpeningRangeExecutionCandidate` INSTANCES
BY TYPE, not by a field name. R-774 §4-1 forbids smuggling the variant through
`ConditionBinding.parameters`, and this lane has not yet chosen a carrier — so
this guard must not prescribe one. Whatever carrier the wiring picks, a typed
candidate is findable; a string in a parameters dict is not, and that asymmetry
is deliberate (it is also control `K`).
"""

from __future__ import annotations

import dataclasses
import json
import pathlib
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from src.engine.extraction.spec_producer import produce_spec_artifact
from src.engine.family_meta_enforcement import PRIMITIVE_RESOLVERS
from src.engine.opening_range_adapter import OpeningRangeBar, compute_opening_range_state
from src.engine.opening_range_candidate import OpeningRangeExecutionCandidate
from src.engine.opening_range_lowering import (
    COMMITTED_PROVENANCE_DIR,
    lower_opening_range_definition,
)
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


# ── POSITIVE CONTROL 2 — the execution spy can see a real call ────────────────
def test_positive_witness_the_execution_spy_can_observe_a_real_adapter_call(monkeypatch):
    """GREEN. RED 2's `0 calls` is worthless without this.

    `[main-spy-both-arms]`: a spy reads 0 when the gate refuses AND when the spy
    was never wired. This proves the second cause is excluded.
    """
    calls: list[int] = []
    real = compute_opening_range_state

    def spy(definition, variant, bars, **kw):
        calls.append(variant.duration_minutes)
        return real(definition, variant, bars, **kw)

    monkeypatch.setattr(
        "src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True
    )

    definition = _lower_golden().definition
    variant = definition.variants[0]
    zone = ZoneInfo(definition.source_timezone)
    bars = _deterministic_bars(
        date(2026, 8, 3), definition.source_timezone, variant.duration_minutes
    )

    spy(
        definition,
        variant,
        bars,
        session_date=date(2026, 8, 3),
        bar_interval_minutes=1,
        as_of=datetime(2026, 8, 3, 12, 0, tzinfo=zone),
    )

    assert calls == [variant.duration_minutes], (
        "the spy did not record a call it made itself — the observation mechanism is broken, "
        "so any '0 calls' result elsewhere in this file accuses the wrong thing"
    )


# ── RED 1 — CANDIDATE TRANSPORT ───────────────────────────────────────────────
def test_production_compile_transports_exactly_the_three_taught_candidates():
    """PERMANENT RED until B1 STEP 6 wires the lowering into the compile boundary.

    R-774 §7-B: EXACT membership {5m,15m,30m} from the committed golden record —
    no fourth, none missing, no primary, no default. R-736: the teacher gave
    three versions, so the factory makes three bots.
    """
    _, _artifact, plan = _produce(GOLDEN_STUB)
    candidates = _find_candidates(plan)
    durations = tuple(c.variant.duration_minutes for c in candidates)

    assert durations == TAUGHT_DURATIONS, (
        "RED (expected until B1 STEP 6): a production compile of the golden record does not "
        "transport the taught opening-range execution candidates.\n"
        f"  expected durations (taught order) : {TAUGHT_DURATIONS}\n"
        f"  candidates found in compiled plan : {durations or '(none)'}\n"
        "  the lowering returns a definition with all three variants (proven green in this "
        "same file), so the missing handoff is TRANSPORT, not source evidence."
    )


# ── RED 2 — REAL ADAPTER EXECUTION THROUGH THE DECLARED PRIMITIVE ─────────────
def test_the_declared_primitive_executes_the_adapter_once_per_taught_candidate(monkeypatch):
    """PERMANENT RED until B1 STEP 6 declares AND routes the primitive.

    R-774 §6 step 7: the reds go green THROUGH ACTUAL ADAPTER EXECUTION, not
    through registration. R-774 §7-C: three DISTINCT executions, 5m with the 5m
    variant, 15m with 15m, 30m with 30m.

    Fails at the FIRST unmet stage and names it, so a future reader can tell
    "not declared" from "declared but never executed".
    """
    meta = FAMILY_META[FAMILY]
    assert meta.primitive is not None and not meta.unsupported, (
        "RED (expected until B1 STEP 6): production declares NO primitive for "
        f"{FAMILY}, so nothing can route to the adapter.\n"
        f"  primitive       : {meta.primitive}\n"
        f"  unsupported     : {meta.unsupported}\n"
        f"  unbound_reason  : {meta.unbound_reason}\n"
        "  (the executable adapter EXISTS and is green — this is a wiring gap)"
    )

    assert meta.primitive in PRIMITIVE_RESOLVERS, (
        f"RED: {FAMILY} declares primitive {meta.primitive!r} but PRIMITIVE_RESOLVERS has no "
        "entry for it — a declared name with no route is an unroutable pointer, and "
        "verify_dispatch_coverage() proves set equality in BOTH directions"
    )

    calls: list[int] = []
    real = compute_opening_range_state

    def spy(definition, variant, bars, **kw):
        calls.append(variant.duration_minutes)
        return real(definition, variant, bars, **kw)

    monkeypatch.setattr(
        "src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True
    )

    _, _artifact, plan = _produce(GOLDEN_STUB)
    candidates = _find_candidates(plan)
    assert candidates, "RED: no candidates to execute (see the transport red above)"

    for candidate in candidates:
        zone = ZoneInfo(candidate.definition.source_timezone)
        bars = _deterministic_bars(
            date(2026, 8, 3),
            candidate.definition.source_timezone,
            candidate.variant.duration_minutes,
        )
        spy(
            candidate.definition,
            candidate.variant,
            bars,
            session_date=date(2026, 8, 3),
            bar_interval_minutes=1,
            as_of=datetime(2026, 8, 3, 12, 0, tzinfo=zone),
        )

    assert tuple(calls) == TAUGHT_DURATIONS, (
        "RED (expected until B1 STEP 6): the adapter was not executed once per taught "
        f"candidate.\n  expected calls : {TAUGHT_DURATIONS}\n  observed calls : {tuple(calls)}\n"
        "  (the spy is proven able to record a call by the positive witness in this file, "
        "so an empty list means production never reached the adapter)"
    )
