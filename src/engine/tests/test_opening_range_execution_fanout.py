"""SURFACE 12B's OWN PROOF — one taught candidate becomes one execution instance.

`R-785 §11` names three obligations for this boundary and each is an arm below:

  1. golden record: `len(candidates) == 3` ⇒ `len(instances) == 3`, pairwise 5/15/30,
     no candidate shared between instances, none doubled;
  2. a MUTATION CONTROL — swap a different candidate into an instance and the
     OBSERVABLE adapter state must MOVE. Without this, arm 1's `(5, 15, 30)` is also
     consistent with a fan-out that ignores its carrier and happens to be ordered
     correctly;
  3. `SOURCE_INCOMPLETE` ⇒ zero instances, zero adapter calls, no fallback.

🛑 THE FIXTURES ARE IMPORTED FROM THE S6 SUITE, NOT RE-WRITTEN. The taught session
bars, the dispatch context and the record loader all already exist there. A second
copy would be free to drift, and a fixture that drifts turns a real regression into
"the other suite must be wrong". `THE SECOND COPY OF A CALCULATION IS A DISAGREEMENT
WAITING FOR A REASON.`
"""

from __future__ import annotations

import numpy as np

from src.engine.extraction.spec_producer import produce_spec_artifact_from_record
from src.engine.opening_range_adapter import compute_opening_range_state
from src.engine.opening_range_execution_fanout import build_execution_instances
from src.engine.spec_condition_compiler import from_compiled_spec
from src.engine.tests.test_s6_candidate_transport_and_adapter_execution import (
    BAR_TIMEFRAME,
    GOLDEN_STUB,
    NEIGHBOUR_STUB,
    TAUGHT_DURATIONS,
    _dispatch_ctx,
    _opening_range_binding,
    _record,
    _taught_session_bars,
)


def _golden():
    return produce_spec_artifact_from_record(_record(GOLDEN_STUB), video=GOLDEN_STUB)


def _spy(monkeypatch, calls: list[int]) -> None:
    """Attach the adapter spy at the RESOLUTION SEAM, exactly as the S6 suite does.

    Patching the module attribute (never a name bound at import time) is what makes
    a production call observable at all — `AR-907 §6`'s import-binding defect.
    """
    real = compute_opening_range_state

    def spy(definition, variant, bars, **kw):
        calls.append(variant.duration_minutes)
        return real(definition, variant, bars, **kw)

    monkeypatch.setattr(
        "src.engine.opening_range_adapter.compute_opening_range_state", spy, raising=True
    )


# ── ARM 1 — THREE TAUGHT ALTERNATIVES BECOME THREE DISTINCT BOTS ─────────────
def test_the_golden_record_fans_out_to_one_instance_per_taught_candidate(monkeypatch):
    """`R-736`/`R-743` made executable: three versions taught, three bots built."""
    result = _golden()
    candidates = result.opening_range_candidates
    assert tuple(c.variant.duration_minutes for c in candidates) == TAUGHT_DURATIONS, (
        "the record no longer carries the three taught candidates; this is transport's "
        f"territory, not the fan-out's.\n  found: {[c.variant.duration_minutes for c in candidates]}"
    )

    instances = build_execution_instances(result, timeframe=BAR_TIMEFRAME)

    assert len(instances) == len(candidates) == 3, (
        f"{len(candidates)} taught candidates produced {len(instances)} execution instances; "
        "one taught alternative must become exactly one bot"
    )
    carried = [i.opening_range_candidate for i in instances]
    assert all(c is not None for c in carried), (
        "an instance came back with no candidate — the carrier was dropped in transport"
    )
    assert tuple(c.variant.duration_minutes for c in carried) == TAUGHT_DURATIONS, (
        "the instances do not carry the three taught windows in taught order.\n"
        f"  carried: {[c.variant.duration_minutes for c in carried]}"
    )
    # IDENTITY SURVIVED THE FAN-OUT (R-785 stop condition 12). Without this, three
    # instances could be three copies of one bot and every downstream number would
    # still look reasonable.
    ids = [c.candidate_id for c in carried]
    assert len(set(ids)) == 3, f"instances share candidate identity: {ids}"
    assert all(c.cache_identity for c in carried), "a candidate lost its cache identity"
    # No object is shared between two instances.
    assert len({id(c) for c in carried}) == 3, "two instances hold the SAME candidate object"


# ── ARM 2 — AND EACH BOT ACTUALLY COMPUTES ITS OWN WINDOW ────────────────────
def test_each_fanned_out_instance_executes_its_own_taught_window(monkeypatch):
    """The fan-out is only real if the instances DISPATCH differently.

    Arm 1 proves the carriers differ; this proves production READS them. The spy list
    can only be filled by `_dispatch_enforced` reaching the adapter.
    """
    result = _golden()
    instances = build_execution_instances(result, timeframe=BAR_TIMEFRAME)

    calls: list[int] = []
    _spy(monkeypatch, calls)

    ctx = _dispatch_ctx(_taught_session_bars(result.opening_range_lowering.definition))
    for instance in instances:
        binding = _opening_range_binding(instance.binding_plan)
        assert binding is not None, "the instance's own plan carries no opening-range binding"
        instance._dispatch_enforced(binding, ctx)

    assert tuple(calls) == TAUGHT_DURATIONS, (
        "the fanned-out instances did not execute one taught window each.\n"
        f"  expected : {TAUGHT_DURATIONS}\n  observed : {tuple(calls) or '(never reached)'}"
    )


# ── ARM 3 — THE MUTATION CONTROL (R-785 §11) ─────────────────────────────────
def test_control_swapping_the_candidate_moves_the_observable_adapter_state(monkeypatch):
    """DISCRIMINATION. Without this arm, `(5, 15, 30)` is ALSO consistent with a
    fan-out that ignores its carrier entirely and is merely ordered correctly.

    Same artifact, same plan, same bars, same position — ONLY the candidate differs.
    If the observed duration does not move with it, the carrier is decorative.

      `A GUARD THAT READS THE RIGHT ANSWER FROM THE WRONG FIELD IS GREEN FOR AS LONG
       AS THE TWO AGREE.`
    """
    result = _golden()
    candidates = result.opening_range_candidates
    first, middle = candidates[0], candidates[1]
    assert first.variant.duration_minutes != middle.variant.duration_minutes, (
        "the fixture cannot discriminate: two taught windows have the same duration"
    )

    ctx = _dispatch_ctx(_taught_session_bars(result.opening_range_lowering.definition))
    observed: list[tuple[int, tuple[int, ...]]] = []

    for candidate in (first, middle):
        calls: list[int] = []
        _spy(monkeypatch, calls)
        instance = from_compiled_spec(
            result.artifact,
            timeframe=BAR_TIMEFRAME,
            opening_range_candidate=candidate,
        )
        binding = _opening_range_binding(instance.binding_plan)
        instance._dispatch_enforced(binding, ctx)
        observed.append((candidate.variant.duration_minutes, tuple(calls)))

    assert observed == [
        (first.variant.duration_minutes, (first.variant.duration_minutes,)),
        (middle.variant.duration_minutes, (middle.variant.duration_minutes,)),
    ], (
        "swapping the candidate did not move the observable adapter state, so production is "
        f"reading its window from somewhere other than its carrier.\n  observed: {observed}"
    )


# ── ARM 4 — A REFUSING RECORD YIELDS NOTHING, AND NEVER A FALLBACK ───────────
def test_a_source_incomplete_record_fans_out_to_zero_instances_and_zero_adapter_calls(
    monkeypatch,
):
    """The refusal survives the fan-out. A `SOURCE_INCOMPLETE` record has no
    definition to expand, so ANY instance here would carry an invented duration.

    POSITIVE WITNESS FOR A NEGATIVE ASSERTION: `calls == []` alone is satisfied by a
    function that does nothing, so the golden arms above (which DO reach the adapter
    through this same seam) are what prove this zero is a refusal and not silence.
    """
    calls: list[int] = []
    _spy(monkeypatch, calls)

    result = produce_spec_artifact_from_record(_record(NEIGHBOUR_STUB), video=NEIGHBOUR_STUB)
    lowering = result.opening_range_lowering
    assert lowering is not None and lowering.definition is None, (
        "the neighbour record no longer refuses; this arm is measuring the wrong thing"
    )

    instances = build_execution_instances(result, timeframe=BAR_TIMEFRAME)

    assert instances == (), (
        f"a SOURCE_INCOMPLETE record produced {len(instances)} execution instance(s); the "
        "refusal was repaired into a bot"
    )
    assert calls == [], f"a refusing record reached the opening-range adapter: {calls}"


# ── ARM 5 — THE FAN-OUT NEVER PICKS, EVEN WHEN ASKED THE SAME QUESTION TWICE ──
def test_the_fan_out_is_deterministic_and_selects_no_winner():
    """No ranking, no primary, no `candidates[0]`: two calls give the same three
    windows in the same taught order, and NO call returns a single instance for a
    record that taught three."""
    result = _golden()
    a = build_execution_instances(result, timeframe=BAR_TIMEFRAME)
    b = build_execution_instances(result, timeframe=BAR_TIMEFRAME)

    durations_a = [i.opening_range_candidate.variant.duration_minutes for i in a]
    durations_b = [i.opening_range_candidate.variant.duration_minutes for i in b]
    assert durations_a == durations_b == list(TAUGHT_DURATIONS)
    assert len(a) != 1, (
        "the fan-out collapsed three taught alternatives into ONE instance — that is a "
        "selection, and no layer here is permitted to make one"
    )


# ── ARM 6 — TIMEFRAME IS BAR RESOLUTION, NEVER A WINDOW CHOOSER ──────────────
def test_the_bar_timeframe_does_not_choose_which_taught_window_runs():
    """`R-785 §5-b` / stop condition 5. A `1m` chart may legitimately run a `30m`
    opening range, so the fan-out must produce the SAME three windows regardless of
    bar resolution. If a timeframe ever filtered the set, this reddens."""
    result = _golden()
    at_1m = build_execution_instances(result, timeframe="1m")
    at_5m = build_execution_instances(result, timeframe="5m")

    windows_1m = [i.opening_range_candidate.variant.duration_minutes for i in at_1m]
    windows_5m = [i.opening_range_candidate.variant.duration_minutes for i in at_5m]
    assert windows_1m == windows_5m == list(TAUGHT_DURATIONS), (
        "the bar timeframe changed which taught windows exist.\n"
        f"  1m -> {windows_1m}\n  5m -> {windows_5m}\n"
        "  bar resolution and taught window duration are different dimensions"
    )
    # And the resolution really did reach the instances — a positive witness that the
    # two runs differed in the way they were supposed to differ.
    assert [i.timeframe for i in at_1m] == ["1m"] * 3
    assert [i.timeframe for i in at_5m] == ["5m"] * 3


def test_the_fanned_out_instance_produces_a_real_per_bar_gate_not_a_constant():
    """End-to-end through the seam: a fanned-out bot gates on its OWN taught window.

    Guards the whole point of the activation — an all-True column is the engine
    asserting on every bar that a taught entry condition is satisfied.
    """
    result = _golden()
    instances = build_execution_instances(result, timeframe=BAR_TIMEFRAME)
    session_bars = _taught_session_bars(result.opening_range_lowering.definition)
    ctx = _dispatch_ctx(session_bars)

    for instance in instances:
        binding = _opening_range_binding(instance.binding_plan)
        array = np.asarray(instance._dispatch_enforced(binding, ctx))
        lock_index = instance.opening_range_candidate.variant.duration_minutes
        assert array.shape == (len(session_bars),)
        assert not array[:lock_index].any(), (
            f"{lock_index}m bot: gated True before its taught window locked"
        )
        assert array[lock_index:].all(), (
            f"{lock_index}m bot: did not gate True after its taught window locked"
        )
        assert not array.all(), f"{lock_index}m bot returned the constant-True fallback"
