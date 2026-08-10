"""Tests for the FAMILY_META enforcement gate
(docs/designs/packet-family-meta-enforced-2026-07-20.md).

★ WHICH GUARDS HERE ARE RED-PROVEN, AND WHICH ARE NOT. This header used to read "EVERY GUARD
HERE IS RED-PROVEN." It was false, and grading found the counterexample:
test_flag_off_per_bar_output_is_unchanged_by_this_packet claimed per-bar array equality
"proven by exercising it" over a body that asserted only that a ledger was empty — the grader
sabotaged flag-OFF per-bar output (1 signal -> 0) and it still PASSED. A superlative that
cannot survive its own check is the defect this packet exists to delete, wearing a docstring.
So, stated at actual strength:

  RED-PROVEN (each carries a paired control showing the same assertion FAILING when the thing
  it guards is actually broken, and the control is named next to it):
    - fail-loud / pin (b)            -> test_fail_loud_control_unmodified_table_loads_clean
    - derived dispatch / pin (a)     -> test_second_router_control_flag_off_ignores_the_repoint
    - (b2) sets are derived not transcribed -> test_b2_sets_are_read_from_live_objects_...
    - flag-OFF declaration identity  -> test_byte_identity_control_the_proof_can_fail
    - flag-OFF per-bar output        -> test_flag_off_per_bar_control_each_leg_can_fail
    - all three pin-selector lying modes -> the three test_d1_mode*_control_* tests

  PLAIN ASSERTIONS, no control, and NOT to be quoted as proofs: the pin-selector reporting
  tests, test_invalidate_approximation_moves_to_true, test_no_fabricated_confluence_primitive_
  was_written, and test_no_aspirational_pointer_survives_enforcement. They assert a property of
  a table. That is worth having; it is not the same evidentiary class as the list above.
"""

from __future__ import annotations

import contextlib
import dataclasses
import os

import numpy as np
import polars as pl
import pytest

import src.engine.family_meta_enforcement as fme
import src.engine.opening_range_candidate as orc
import src.engine.opening_range_definition as orc_def
import src.engine.session_windows as session_windows
import src.engine.spec_family_bindings as sfb
from src.engine.spec_condition_compiler import ENFORCED_DISPATCH, SpecConditionStrategy


@contextlib.contextmanager
def enforced(pins: str | None = None):
    """Enforcement ON for the block. ★ THE DEFAULT WAS `pins="a,b"` because pin (b2)
    legitimately FAILED on the real orphan-zone gap the enforcement packet was scoped out of
    fixing. The orphan-zone closure (docs/designs/packet-orphan-zone-closure-2026-07-21.md)
    fixed it, so the default is now `None` — ALL pins, including (b2). Every test in this
    module that does not say otherwise now runs under the full gate, which is the state the
    two-commit law was working toward. See test_pin_selector_reason_has_expired."""
    prev_flag = os.environ.get(fme.FLAG_ENV)
    prev_pins = os.environ.get(fme.PINS_ENV)
    os.environ[fme.FLAG_ENV] = "true"
    if pins is None:
        os.environ.pop(fme.PINS_ENV, None)
    else:
        os.environ[fme.PINS_ENV] = pins
    fme.reset_enforcement_cache()
    try:
        yield
    finally:
        for key, val in ((fme.FLAG_ENV, prev_flag), (fme.PINS_ENV, prev_pins)):
            if val is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = val
        fme.reset_enforcement_cache()


@contextlib.contextmanager
def planted_uncovered_emission(zone: str = "zzz_planted_orphan"):
    """A SYNTHETIC uncovered emission, so pin (b2)'s positive signal no longer depends on a
    live defect being present.

    ★ WHY THIS EXISTS. The b2 tests and the three mode-controls below used the REAL
    `lunch_blackout` / `overnight` orphan-zone gap as their b2 signal. The orphan-zone closure
    (docs/designs/packet-orphan-zone-closure-2026-07-21.md) fixed that gap, so a control keyed
    to it would have quietly become unfalsifiable — "b2 reported nothing" would read the same
    whether b2 ran or not. Planting one makes those checks independent of whether the
    production tables happen to be clean, which is what they were always trying to assert."""
    sfb.SESSION_KEYWORDS[zone] = ("zzz planted orphan",)
    try:
        yield zone
    finally:
        del sfb.SESSION_KEYWORDS[zone]


@contextlib.contextmanager
def family_meta_patched(family: str, **changes):
    """Temporarily replace one FAMILY_META entry. Restores the exact original object.

    NOTE: this is the RAW patch and it may leave the tables INCOHERENT (e.g. re-pointing a
    family orphans the primitive it abandoned, which is a genuine pin (a)+(b) violation). That
    is deliberate — several tests want exactly that incoherence so the gate can convict it.
    Tests that want a VALID re-point want `family_meta_repointed` below."""
    original = sfb.FAMILY_META[family]
    sfb.FAMILY_META[family] = dataclasses.replace(original, **changes)
    try:
        yield
    finally:
        sfb.FAMILY_META[family] = original


@contextlib.contextmanager
def family_meta_repointed(family: str, new_primitive: str):
    """A COHERENT re-point: change the declaration AND retire the primitive it abandons.

    ★ WHY THIS EXISTS — IT REPLACES A FIXTURE THAT RAN ON THE SUCCESS CACHE'S LIE. Re-pointing
    WAIT_SESSION leaves `session_windows.is_in_killzone` in PRIMITIVE_RESOLVERS and in the
    dispatch map with NO FAMILY_META entry declaring it: an orphan resolver (pin b) AND a
    second router (pin a). Two real violations.

    The tests that re-point used to survive that by loading the UNPATCHED table first and
    letting the success cache wave the patched one through — their own comments said so:
    "Loading the un-patched table first satisfies the gate for THIS pin set, and the
    re-pointed strategy is then built against the already-passed gate." That is lying mode 4
    being USED AS A TEST FIXTURE: the cache's blindness to what changed after the first load
    was the only reason the patched world looked legal.

    The cache is deleted, so the fixture has to become honest instead. This one makes the
    patched world ACTUALLY VALID — the abandoned primitive is retired from the resolver
    registry and the dispatch map for the duration — so every pin runs, fully, against the
    re-pointed table and passes for a REAL reason. All three objects are restored exactly."""
    original = sfb.FAMILY_META[family]
    abandoned, _ = original.enforced_declaration()
    sfb.FAMILY_META[family] = dataclasses.replace(original, enforced_primitive=new_primitive)

    # retire the abandoned primitive iff no OTHER family still declares it
    still_declared = any(
        m.enforced_declaration()[0] == abandoned
        for f, m in sfb.FAMILY_META.items() if f != family
    )
    retired_resolver = retired_dispatch = None
    if abandoned and not still_declared:
        if abandoned in fme.PRIMITIVE_RESOLVERS:
            retired_resolver = fme.PRIMITIVE_RESOLVERS.pop(abandoned)
        if abandoned in ENFORCED_DISPATCH:
            retired_dispatch = ENFORCED_DISPATCH.pop(abandoned)
    try:
        yield
    finally:
        sfb.FAMILY_META[family] = original
        if retired_resolver is not None:
            fme.PRIMITIVE_RESOLVERS[abandoned] = retired_resolver
        if retired_dispatch is not None:
            ENFORCED_DISPATCH[abandoned] = retired_dispatch


def _bars(n: int = 300) -> pl.DataFrame:
    """Deterministic synthetic bars — no wall clock, no randomness, no file I/O. Enough bars
    to clear MIN_BARS_REQUIRED so the real evaluators actually run."""
    import datetime as dt

    t0 = dt.datetime(2025, 1, 6, 14, 30, tzinfo=dt.UTC)
    close = [100.0 + (i % 17) * 0.25 - (i % 7) * 0.1 for i in range(n)]
    return pl.DataFrame(
        {
            "ts_event": [t0 + dt.timedelta(minutes=5 * i) for i in range(n)],
            "open": [c - 0.25 for c in close],
            "high": [c + 0.75 for c in close],
            "low": [c - 0.75 for c in close],
            "close": close,
            "volume": [1000 + (i % 11) * 10 for i in range(n)],
        }
    )


def _spec(cond_type: str, obj: str = "london session", cid: str = "c1") -> dict:
    return {
        "spec": {
            "entry_conditions": [{"id": cid, "type": cond_type, "role": "spine", "object": obj}],
            "invalidations": [],
            "entry_trigger_id": cid,
            "direction": "long",
        }
    }


# ─────────────────────────────────────────────────────────────────────────────────────────
# SURFACE 10 — THE ONE SHARED CANDIDATE-AWARE CONSTRUCTION HELPER (S6 EXECUTION ACTIVATION)
#
# OPENING_RANGE_DEFINITION is the only family in this module whose evaluator needs an
# explicit typed input: it must be TOLD which taught window it is running, because
# `R-736`/`R-743` settled that the teacher's three alternatives make THREE BOTS and that
# nothing may select one on their behalf. Every other family here needs no such input.
#
# 🛑 ONE HELPER, NOT `if family == ...` REPEATED IN FIVE TESTS. The conditional lives here
# exactly once, so the polarity tests keep reading as a uniform population and a sixth test
# added tomorrow inherits the wiring instead of forgetting it.
#
# 🛑 WHAT THIS CANDIDATE IS NOT: not a default, not a "primary", not a selection. It is an
# EXPLICIT fixture input for a synthetic condition, and its `source_condition_id` matches the
# synthetic condition it belongs to. It carries ONE variant because an execution candidate
# carries exactly one; supplying several and letting production choose is the shape the whole
# activation exists to prevent.
# ─────────────────────────────────────────────────────────────────────────────────────────
_FIXTURE_OPENING_RANGE_VARIANT = orc_def.OpeningRangeVariant(
    variant_label="15m",
    duration_minutes=15,
    source_quote="(synthetic enforcement fixture — not a taught quote)",
)
_FIXTURE_OPENING_RANGE_DEFINITION = orc_def.OpeningRangeDefinition(
    session_start_local="09:30",
    source_timezone="America/New_York",
    variants=(_FIXTURE_OPENING_RANGE_VARIANT,),
    market_scope="(synthetic enforcement fixture)",
    trading_day_rule="resets each session",
    provenance=orc_def.OpeningRangeProvenance(
        source_quote="(synthetic enforcement fixture — not a taught quote)",
        condition_id="c1",
    ),
)


def _strategy_for(family: str, obj: str, cid: str = "c1") -> SpecConditionStrategy:
    """Build the production strategy for a polarity fixture, candidate-aware.

    Constructed through the REAL production constructor in every case — the opening-range
    family simply also receives the typed candidate its evaluator requires. An instance built
    WITHOUT one is not a lesser fixture, it is a contract violation, and
    `test_s6_candidate_transport_and_adapter_execution.py` owns proving that it refuses.
    """
    spec = _spec(family, obj, cid)
    if family == "OPENING_RANGE_DEFINITION":
        return SpecConditionStrategy(
            compiled_spec=spec,
            opening_range_candidate=orc.OpeningRangeExecutionCandidate(
                source_spec_id="(synthetic enforcement fixture)",
                source_condition_id=cid,
                definition=_FIXTURE_OPENING_RANGE_DEFINITION,
                variant=_FIXTURE_OPENING_RANGE_VARIANT,
            ),
        )
    return SpecConditionStrategy(compiled_spec=spec)


# ─────────────────────────────────────────────────────────────────────────────────────────
# RETURN CHECKLIST 1 — FAIL-LOUD IS RED-PROVEN
# ─────────────────────────────────────────────────────────────────────────────────────────


def test_fail_loud_red_proven_absent_primitive_fails_load_by_name():
    """★ THE RED PROOF. Point a family at a deliberately non-existent primitive; the load must
    FAIL, and the error must NAME the family and the missing pointer."""
    with enforced(), family_meta_patched(
        "WAIT_RETEST", enforced_primitive="nonexistent_module.no_such_primitive"
    ):
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            SpecConditionStrategy(compiled_spec=_spec("WAIT_RETEST"))
        message = str(exc.value)
        assert "WAIT_RETEST" in message
        assert "nonexistent_module.no_such_primitive" in message


def test_fail_loud_red_proven_resolver_pointing_at_missing_symbol_fails_load():
    """The sibling case: the MODULE exists but the SYMBOL does not. A registry that only
    checked importability would pass this — which is how a pointer at a real module with an
    imaginary function stays invisible."""
    with enforced():
        original = fme.PRIMITIVE_RESOLVERS["spec_condition_compiler.retest_touch_check"]
        fme.PRIMITIVE_RESOLVERS["spec_condition_compiler.retest_touch_check"] = (
            "src.engine.session_windows:no_such_function"
        )
        try:
            with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
                SpecConditionStrategy(compiled_spec=_spec("WAIT_RETEST"))
            assert "no_such_function" in str(exc.value)
        finally:
            fme.PRIMITIVE_RESOLVERS["spec_condition_compiler.retest_touch_check"] = original


def test_fail_loud_control_unmodified_table_loads_clean():
    """THE CONTROL for the two tests above: with nothing sabotaged, pins (a)+(b) pass and a
    strategy constructs. Without this, both red proofs would be satisfied by an enforcement
    layer that simply raises on everything."""
    with enforced():
        strategy = SpecConditionStrategy(compiled_spec=_spec("WAIT_RETEST"))
        assert strategy.binding_plan.bindings[0].bindable is True


def test_no_silent_fallback_for_an_unroutable_primitive():
    """A binding carrying a primitive the router does not know must RAISE, not fall through to
    a constant-True pass-through. The silent `else: np.ones` is the shape this packet deletes;
    this proves it is gone rather than relocated."""
    with enforced():
        strategy = SpecConditionStrategy(compiled_spec=_spec("WAIT_RETEST"))
        binding = dataclasses.replace(strategy.binding_plan.bindings[0], primitive="not.routed")
        strategy.binding_plan.bindings = [binding]
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            strategy.compute(_bars())
        assert "not.routed" in str(exc.value)


# ─────────────────────────────────────────────────────────────────────────────────────────
# RETURN CHECKLIST 3 — NO SECOND ROUTER
# ─────────────────────────────────────────────────────────────────────────────────────────


def test_repointing_family_meta_changes_what_runs():
    """★ THE PIN-(a) PROOF, and the discriminating one.

    Merely DELETING a FAMILY_META entry changes dispatch even in the OLD code (the binding
    becomes unbindable and never reaches the ladder), so deletion alone cannot tell a derived
    router from a `b.type` ladder. RE-POINTING can: leave the entry in place and change only
    its declared primitive. A derived router follows the declaration; a type-ladder ignores it
    completely.

    Here WAIT_SESSION is re-pointed at the confirmation primitive. Under enforcement the
    session evaluator must NOT run and the output must equal the confirmation evaluator's."""
    bars = _bars()
    with enforced():
        baseline = SpecConditionStrategy(compiled_spec=_spec("WAIT_SESSION")).compute(bars)
        # ★ COHERENT re-point (see family_meta_repointed). This used to be the raw
        # family_meta_patched, which orphaned `session_windows.is_in_killzone` and survived
        # only because the success cache never re-checked after the baseline load. The cache
        # is gone; the re-pointed table is now genuinely valid and every pin really runs.
        with family_meta_repointed(
            "WAIT_SESSION", "spec_condition_compiler.candle_confirmation_check"
        ):
            repointed_strategy = SpecConditionStrategy(compiled_spec=_spec("WAIT_SESSION"))
            repointed = repointed_strategy.compute(bars)
            assert (
                repointed_strategy.binding_plan.bindings[0].primitive
                == "spec_condition_compiler.candle_confirmation_check"
            )
    assert not np.array_equal(
        baseline["entry_long"].to_numpy(), repointed["entry_long"].to_numpy()
    ), "re-pointing FAMILY_META did not change dispatch — something else is routing"


def test_second_router_control_flag_off_ignores_the_repoint():
    """THE CONTROL that gives the test above its meaning: with the flag OFF, the SAME re-point
    changes NOTHING, because the `b.type` ladder — the second router — decides. This is the
    defect, demonstrated, and it is what makes the enforced assertion above non-vacuous."""
    bars = _bars()
    baseline = SpecConditionStrategy(compiled_spec=_spec("WAIT_SESSION")).compute(bars)
    with family_meta_patched(
        "WAIT_SESSION", enforced_primitive="spec_condition_compiler.candle_confirmation_check"
    ):
        repointed = SpecConditionStrategy(compiled_spec=_spec("WAIT_SESSION")).compute(bars)
    assert np.array_equal(baseline["entry_long"].to_numpy(), repointed["entry_long"].to_numpy())


def test_a_router_entry_nothing_declares_fails_load():
    """Direction 2 of pin (a): a handler no FAMILY_META entry names is a second router."""
    with enforced():
        ENFORCED_DISPATCH["orphan.router.entry"] = "_h_non_gating"
        try:
            with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
                SpecConditionStrategy(compiled_spec=_spec("WAIT_RETEST"))
            assert "orphan.router.entry" in str(exc.value)
            assert "second router" in str(exc.value)
        finally:
            del ENFORCED_DISPATCH["orphan.router.entry"]


def test_a_declaration_the_router_cannot_reach_fails_load():
    """Direction 1 of pin (a): a declared pointer with no handler is unroutable."""
    with enforced(), family_meta_patched(
        "WAIT_RETEST", enforced_primitive="session_windows.is_in_killzone"
    ):
        # resolvable (pin b passes) but WAIT_RETEST now shares WAIT_SESSION's key, so the
        # retest handler key becomes declared-by-nobody.
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            SpecConditionStrategy(compiled_spec=_spec("WAIT_RETEST"))
        assert "spec_condition_compiler.retest_touch_check" in str(exc.value)


def test_gates_flag_must_agree_with_the_router():
    """A family may not declare gates=True while being routed to a constant-True handler —
    that disagreement IS the FILTER defect, and it must be a load error, not a comment."""
    with enforced(), family_meta_patched("FILTER", gates=True):
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            SpecConditionStrategy(compiled_spec=_spec("FILTER"))
        assert "gates=True" in str(exc.value)


def test_gates_flag_must_agree_with_the_router_other_direction():
    """★ THE SIBLING THE ORIGINAL TEST LEFT OPEN. `NON_GATING_HANDLERS`' docstring claims pin
    (a) checks gates against the router "in both directions". The CODE does; the TESTS only
    covered gates=True-routed-to-non-gating. The opposite disagreement — a family declaring
    gates=False while routed to a real evaluator — had no test at all, so half of a
    both-directions claim was resting on a reading of the source.

    Found by sweeping the claim class rather than the named instance (D6)."""
    with enforced(), family_meta_patched("WAIT_SESSION", gates=False):
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            SpecConditionStrategy(compiled_spec=_spec("WAIT_SESSION"))
        message = str(exc.value)
        assert "gates=False" in message
        assert "real evaluator" in message


# ─────────────────────────────────────────────────────────────────────────────────────────
# RETURN CHECKLIST 4 — (b2) EMIT ⊆ COVERED, DERIVED PROGRAMMATICALLY
# ─────────────────────────────────────────────────────────────────────────────────────────


def test_b2_orphan_zones_no_longer_block_load():
    """★ REWRITTEN 2026-07-21 — this test's premise retired WITH ITS SUBJECT, by design.

    It used to be `test_b2_orphan_zones_block_load_today` and asserted that with ALL pins
    active the engine correctly REFUSED TO LOAD, because `lunch_blackout` / `overnight` were
    emittable but uncheckable. Its own docstring said: "If this test ever starts failing, the
    orphan-zone lane closed — that is good news, and this test is the thing that will say
    so." The lane closed (docs/designs/packet-orphan-zone-closure-2026-07-21.md, Option A),
    it said so, and this is the rewrite it asked for.

    ★ THIS IS THE PACKET'S ACCEPTANCE TEST: with the pin selector UNSET — all pins,
    including (b2), active — the engine LOADS. Proven by the enforcement guard the build
    already shipped, not by a fresh instrument written to agree with the fix. Its red-proof
    is the sibling test below; without that, this green would be indistinguishable from a
    guard that stopped running.

    Zone names are still never literals here: derived from the live tables, per pin (b2)'s
    own anti-transcription rule and the sibling sweep in test_spec_family_bindings.py.
    """
    orphans = set(sfb.SESSION_KEYWORDS) - set(session_windows._ZONE_CHECKS)
    assert orphans == set(), (
        f"an uncovered emission is back: {sorted(orphans)} — pin (b2) will refuse the load"
    )
    assert fme.verify_emit_subset_covered() == []
    with enforced(pins=None):
        # No pytest.raises: the load must SUCCEED. That is the whole deliverable.
        SpecConditionStrategy(compiled_spec=_spec("WAIT_SESSION"))


def test_b2_still_refuses_the_load_when_an_uncovered_emission_is_reintroduced():
    """★ RED-PROOF for the test above. A guard that stops firing because the thing it guarded
    was removed is not a guard. Re-introduce an uncovered emission, show the engine STILL
    refuses to load under all pins with the offending zone NAMED, then restore and show the
    load is clean again.

    Deliberately a DIFFERENT zone name from the two the packet retired, so this proves the
    CHECK is live rather than proving anything about `lunch_blackout` / `overnight`."""
    with enforced(pins=None):
        with planted_uncovered_emission() as zone:
            with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
                SpecConditionStrategy(compiled_spec=_spec("WAIT_SESSION"))
            assert zone in str(exc.value)
        # ...restore is real: the guard is quiet and the load succeeds again.
        fme.reset_enforcement_cache()
        assert fme.verify_emit_subset_covered() == []
        SpecConditionStrategy(compiled_spec=_spec("WAIT_SESSION"))


def test_pin_selector_reason_has_expired():
    """★ THE PIN-SELECTOR EXPIRY TRIPWIRE (packet RIDER, R-175 §2).

    The selector is a TRANSITION instrument, and its stated reason for existing was
    precisely that pin (b2) failed on the orphan-zone gap. That reason is gone. This test
    keys itself to the closure: while (b2) is clean, the default enforcement regime in this
    module must be ALL PINS — nobody may quietly narrow it back and call it enforcement.

    ★ THE RIDER ASKED FOR "any remaining reference to the pin selector FAILS CI." That is
    NOT what is implemented, and the difference is stated rather than papered over: the
    selector is still legitimately exercised by its own three lying-mode tests and by the
    committed delta harness, so a blanket reference-ban would fail CI on correct code. What
    IS enforced is the property the rider was protecting — the selector may no longer be
    used to make the gate narrower than the code can pass. Removing the public surface is a
    separate packet."""
    assert fme.verify_emit_subset_covered() == [], (
        "pin (b2) is failing again — the selector's original reason is back; this tripwire "
        "and the enforcement module's PIN SELECTOR docstring both need rewriting"
    )
    import inspect

    default = inspect.signature(enforced).parameters["pins"].default
    assert default is None, (
        "the default enforcement regime in this module was narrowed back to "
        f"{default!r} while pin (b2) passes cleanly. The pin selector exists to measure, "
        "not to dodge a pin. Restore `pins=None` or, if a pin genuinely fails again, say "
        "which and why here."
    )


def test_b2_sets_are_read_from_live_objects_not_transcribed():
    """★ The anti-transcription proof, both directions. A hard-coded copy of either set would
    keep passing while the code drifted — which is the defect class, not the fix.

    Direction 1: add a zone to the EMIT side; the violation must grow to name it.
    Direction 2: add coverage on the CONSUMER side; the violation must disappear."""
    new_zone = "zzz_test_zone"

    def flagged_orphans() -> set[str]:
        """The zones the check ACCUSES, parsed out of the violation rather than substring-
        matched against the whole message — the covered-set listing also names zones, and a
        substring test would read a zone's appearance in the EXONERATING half as an accusation.
        (It did, on the first draft of this test.)"""
        found: set[str] = set()
        for violation in fme.verify_emit_subset_covered():
            head = violation.detail.split("that its consumer")[0]
            found |= {z for z in (*sfb.SESSION_KEYWORDS, new_zone) if f"'{z}'" in head}
        return found

    sfb.SESSION_KEYWORDS[new_zone] = ("zzz test zone",)
    try:
        assert new_zone in flagged_orphans(), "emit side is transcribed, not derived"
        session_windows._ZONE_CHECKS[new_zone] = lambda _et_min: False
        try:
            assert new_zone not in flagged_orphans(), "covered side is transcribed, not derived"
        finally:
            del session_windows._ZONE_CHECKS[new_zone]
    finally:
        del sfb.SESSION_KEYWORDS[new_zone]


# ─────────────────────────────────────────────────────────────────────────────────────────
# RETURN CHECKLIST 6/7 — BOTH POLARITIES ON EVERY ENFORCED BINDING
#
# ★ "EVERY" IS NOW MECHANICALLY ENFORCED (D6 sweep). This header made an EVERY-claim over a
# HAND-MAINTAINED list, and the list was incomplete: INVALIDATE declares an enforced primitive
# (structural_stops.compute_structural_stop) and appeared in NEITHER polarity test. The claim
# was false by one family and nothing would have said so — the same shape as D5's curated
# 5-family list standing in for a population. Adding INVALIDATE to the list would fix the
# instance and leave the class open, so the cure is
# test_every_enforced_primitive_family_is_polarity_tested below: it DERIVES the population
# from FAMILY_META and fails if any family escapes both lists.
# ─────────────────────────────────────────────────────────────────────────────────────────

ENFORCED_PRIMITIVE_FAMILIES = [
    ("WAIT_SESSION", "london session"),
    ("WAIT_STRUCTURE", "price holds the high"),
    ("VERIFY_STRUCTURE", "price holds the high"),
    ("WAIT_BIAS", "bullish bias"),
    ("CONFIRM_DIRECTION", "bullish bias"),
    ("WAIT_RETEST", "retest of the level"),
    ("WAIT_CONFIRMATION", "confirmation candle"),
    # S6 EXECUTION ACTIVATION. Enrolled here rather than exempted: `gates=True` on a family
    # with a real evaluator puts it in the GATING population BY DERIVATION
    # (test_every_enforced_primitive_family_is_polarity_tested reads the population off
    # FAMILY_META), and excluding it would delete the detector while preserving the failure.
    # `A SET-EQUALITY GUARD ENROLS THE NEW MEMBER IN EVERY FIXTURE THAT DERIVES ITS
    #  POPULATION FROM THAT SET.`
    ("OPENING_RANGE_DEFINITION", "the opening range of the session"),
]
"""Families declaring an enforced primitive that is routed to a REAL evaluator (gates=True)."""

ENFORCED_PRIMITIVE_NON_GATING_FAMILIES = [
    ("INVALIDATE", "structure breaks the low"),
]
"""Families declaring an enforced primitive routed to a NON-gating handler (gates=False).
INVALIDATE is the whole population today: its primitive resolves, but production never calls
it (production_executed=False), so it is routed to _h_non_gating and must land in the ledger
rather than produce a gate. It needs its own polarity-1 assertion — asserting an empty ledger,
as the gating families do, would be asserting the opposite of what is true of it. That is why
it was missing, and why the completeness test below is a derivation and not a longer list."""


def test_every_enforced_primitive_family_is_polarity_tested():
    """★ THE CLASS CURE for the incomplete EVERY-claim above. The set of families declaring an
    enforced primitive is READ FROM FAMILY_META, not transcribed, and every one of them must
    appear in exactly one of the two polarity lists. A family added to the table later cannot
    slip past both without failing here."""
    declared = {
        family for family, meta in sfb.FAMILY_META.items()
        if meta.enforced_declaration()[0] is not None
    }
    gating = {f for f, _ in ENFORCED_PRIMITIVE_FAMILIES}
    non_gating = {f for f, _ in ENFORCED_PRIMITIVE_NON_GATING_FAMILIES}
    assert not (gating & non_gating), "a family cannot be in both polarity lists"
    assert declared == gating | non_gating, (
        f"families declaring an enforced primitive but covered by NO polarity test: "
        f"{sorted(declared - gating - non_gating)}; listed but not declared: "
        f"{sorted((gating | non_gating) - declared)}"
    )
    # and the split must match the table's own gates flag, not the author's memory of it
    for family in gating:
        assert sfb.FAMILY_META[family].gates is True, f"{family} is in the GATING list but gates=False"
    for family in non_gating:
        assert sfb.FAMILY_META[family].gates is False, f"{family} is in the NON-GATING list but gates=True"


@pytest.mark.parametrize(("family", "obj"), ENFORCED_PRIMITIVE_NON_GATING_FAMILIES)
def test_polarity_non_gating_resolves_and_is_recorded(family: str, obj: str):
    """Polarity 1, non-gating arm: the declared primitive resolves, the condition produces a
    per-bar array, and it is RECORDED in the non-gating ledger rather than silently passing as
    a gate. The mirror of test_polarity_resolves_and_runs for the gates=False population."""
    with enforced():
        strategy = SpecConditionStrategy(compiled_spec=_spec(family, obj))
        strategy.compute(_bars())
        assert strategy.last_per_condition_bool, f"{family} produced no per-condition array"
        ledger = strategy.last_non_gating_conditions
        assert list(ledger) == ["c1"], f"{family} was not recorded as non-gating"
        assert ledger["c1"]["declared"] == sfb.FAMILY_META[family].enforced_declaration()[0]


@pytest.mark.parametrize(("family", "obj"), ENFORCED_PRIMITIVE_NON_GATING_FAMILIES)
def test_polarity_non_gating_fails_loud_when_absent(family: str, obj: str):
    """Polarity 2, non-gating arm: being routed to a non-gating handler must NOT exempt a
    family from pin (b). A non-gating condition with an unresolvable pointer is still a lie."""
    with enforced(), family_meta_patched(family, enforced_primitive=f"gone.{family.lower()}_primitive"):
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            SpecConditionStrategy(compiled_spec=_spec(family, obj))
        assert f"gone.{family.lower()}_primitive" in str(exc.value)


@pytest.mark.parametrize(("family", "obj"), ENFORCED_PRIMITIVE_FAMILIES)
def test_polarity_resolves_and_runs(family: str, obj: str):
    """Polarity 1: the declared primitive resolves AND the condition produces a real per-bar
    array (not the constant-True pass-through)."""
    with enforced():
        strategy = _strategy_for(family, obj)
        strategy.compute(_bars())
        arrays = strategy.last_per_condition_bool
        assert arrays, f"{family} produced no per-condition array"
        assert strategy.last_non_gating_conditions == {}, f"{family} was routed as non-gating"


@pytest.mark.parametrize(("family", "obj"), ENFORCED_PRIMITIVE_FAMILIES)
def test_polarity_fails_loud_when_absent(family: str, obj: str):
    """Polarity 2: the same binding fails loud when its primitive is made absent."""
    with enforced(), family_meta_patched(family, enforced_primitive=f"gone.{family.lower()}_primitive"):
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            _strategy_for(family, obj)
        assert f"gone.{family.lower()}_primitive" in str(exc.value)


# ─────────────────────────────────────────────────────────────────────────────────────────
# PIN (c) — HONEST ENTRIES, AND THE PROHIBITION HELD
# ─────────────────────────────────────────────────────────────────────────────────────────


def test_no_fabricated_confluence_primitive_was_written():
    """★ THE PROHIBITION, ASSERTED. `entry_quality.confluence_factor_presence` must STILL not
    exist. Making the failing pointer pass by writing one would convert a pointer lie into a
    fabricated implementation — strictly worse, because it would PROBE CLEAN. FILTER's honest
    entry says it has no primitive instead."""
    import importlib.util

    assert importlib.util.find_spec("src.engine.entry_quality") is None
    assert "entry_quality.confluence_factor_presence" not in fme.PRIMITIVE_RESOLVERS
    primitive, mechanism = sfb.FAMILY_META["FILTER"].enforced_declaration()
    assert primitive is None
    assert mechanism == "static_true_pass_through"
    assert sfb.FAMILY_META["FILTER"].gates is False


def test_no_aspirational_pointer_survives_enforcement():
    """Pin (c), swept across the whole table rather than spot-checked: every enforced
    declaration is either a mechanism, or a primitive that RESOLVES. `spine_completion_trigger`
    — never a code symbol — must be gone from the enforced column."""
    for family, meta in sfb.FAMILY_META.items():
        primitive, mechanism = meta.enforced_declaration()
        if meta.unsupported:
            assert primitive is None and mechanism is None, family
            continue
        assert (primitive is None) != (mechanism is None), family
        if mechanism is not None:
            assert mechanism in fme.MECHANISMS, f"{family} declares undeclared mechanism {mechanism}"
            assert meta.gates is False, family
        else:
            fme.resolve_primitive(primitive)
        assert primitive != "spine_completion_trigger"


def test_invalidate_approximation_moves_to_true():
    """The fidelity correction the packet declares by name. INVALIDATE was the SOLE
    approximation=False among executed families and its primitive is never called in
    production. The number gets WORSE and more true."""
    meta = sfb.FAMILY_META["INVALIDATE"]
    assert meta.base_approximation is False  # legacy column, preserved not blessed
    assert meta.enforced_approximation is True
    assert meta.production_executed is False


def test_non_gating_conditions_are_recorded_not_hidden():
    """The 390 FILTER spine conditions still cannot gate — there is no primitive to make them
    gate, and inventing one is banned. What changes is that each one is now RECORDED with its
    disposition instead of vanishing into an `else` branch."""
    with enforced():
        strategy = SpecConditionStrategy(compiled_spec=_spec("FILTER", "confluence present"))
        strategy.compute(_bars())
        ledger = strategy.last_non_gating_conditions
        assert list(ledger) == ["c1"]
        assert ledger["c1"]["declared"] == "static_true_pass_through"
        assert ledger["c1"]["disposition"] == "declared_non_gating_constant_true"
        assert bool(strategy.last_per_condition_bool["c1"].all()) is True


# ─────────────────────────────────────────────────────────────────────────────────────────
# RETURN CHECKLIST — THE FLAG-OFF GUARANTEE, AT ITS ACTUAL STRENGTH
#
# NOT "byte identity". Two separable statements live below, and conflating them is what earned
# BAND 6: (1) the legacy DECLARATIONS have not drifted (a table check, tripwired against a
# hand transcription); (2) the flag-OFF PER-BAR BEHAVIOUR matches the ladder (an engine check,
# with an independent recomputation of the signals). Each has its own control.
# ─────────────────────────────────────────────────────────────────────────────────────────

LEGACY_DECLARATION_FAMILIES = [
    "WAIT_SESSION", "WAIT_STRUCTURE", "VERIFY_STRUCTURE", "WAIT_BIAS", "CONFIRM_DIRECTION",
    "WAIT_RETEST", "FILTER", "WAIT_CONFIRMATION", "INVALIDATE", "ENABLE_ENTRY", "ENTER",
    "EXIT_HINT", "RESET", "EXCEPTION",
]
"""Renamed from BYTE_IDENTITY_FAMILIES: these are the families whose LEGACY DECLARATION is
checked, which is not the same thing as byte identity and must not be named as if it were."""

LEGACY_DECLARATIONS = {
    "WAIT_SESSION": ("session_windows", False),
    "WAIT_STRUCTURE": ("structure_engine.compute_structure_state", True),
    "VERIFY_STRUCTURE": ("structure_engine.compute_structure_state", True),
    "WAIT_BIAS": ("bias_engine.classify_institutional_regime", True),
    "CONFIRM_DIRECTION": ("bias_engine.classify_institutional_regime", True),
    "WAIT_RETEST": ("spec_condition_compiler.retest_touch_check", True),
    "FILTER": ("entry_quality.confluence_factor_presence", True),
    "WAIT_CONFIRMATION": ("spec_condition_compiler.candle_confirmation_check", True),
    "INVALIDATE": ("structural_stops.compute_structural_stop", False),
    "ENABLE_ENTRY": ("spine_completion_trigger", False),
    "ENTER": ("spine_completion_trigger", False),
    "EXIT_HINT": ("provenance_only", False),
}
"""The pre-packet declarations, HAND-TRANSCRIBED, held here so a silent drift in the LEGACY
column — which is what flag-OFF production still emits — is caught. These are the values every
persisted binding plan and every certified artifact was produced under; they are preserved,
not endorsed.

★ WHAT THIS TABLE CAN AND CANNOT ESTABLISH (corrected after grading). It is a DRIFT TRIPWIRE
on FAMILY_META's legacy column. It is NOT, and cannot be, a byte-identity proof against
pre-commit code: it is a copy typed by hand into this file, so it can only ever say "the table
still equals what someone wrote down", never "the engine still emits what it emitted before
this packet". The test below was previously named ...binding_plans_are_byte_identical and
compared TWO fields against this dict; the name promised an object comparison the body never
made. Renamed and widened. The per-bar statement — the one that is actually about engine
behaviour — lives in test_flag_off_per_bar_output_matches_the_ladder."""


def test_flag_off_declarations_are_unchanged():
    assert os.environ.get(fme.FLAG_ENV, "false").lower() != "true"
    for family, (primitive, approximation) in LEGACY_DECLARATIONS.items():
        meta = sfb.FAMILY_META[family]
        assert meta.effective_primitive() == primitive, family
        assert meta.effective_approximation() is approximation, family


@pytest.mark.parametrize("family", LEGACY_DECLARATION_FAMILIES)
def test_flag_off_binding_matches_the_legacy_column(family: str):
    """Flag OFF => the BINDING OBJECT a condition receives agrees, field by field, with the
    live legacy column of FAMILY_META — and that column still equals the transcribed table.

    ★ RENAMED AND WIDENED AFTER GRADING. Was `test_flag_off_binding_plans_are_byte_identical`,
    which compared two fields against a hand-typed dict and was cited in the module docstring
    of family_meta_enforcement.py as proof the engine is "byte-identical" flag OFF. It never
    established that; nothing in-process can, because there is no pre-packet artifact to diff.
    Two separate things are checked here, and neither is called byte-identity:

      (1) AGAINST THE LIVE OBJECT, not a transcription: every FAMILY_META-derived field of the
          binding equals what the meta's own effective_* accessors return under the flag. This
          is the comparison the old name implied and the old body skipped — a divergence
          between what FAMILY_META says and what bind_condition() emits is caught here even if
          BOTH have drifted away from the transcribed table.
      (2) AGAINST THE TRANSCRIPTION, as a drift tripwire only: the same values still match
          LEGACY_DECLARATIONS. The WAIT_SESSION exemption the old body carried (`primitive`
          only, approximation unchecked) was unnecessary — it matches — and is removed rather
          than preserved.
    """
    binding = sfb.bind_condition({"id": "c1", "type": family, "role": "spine", "object": "london session"})
    meta = sfb.FAMILY_META[family]

    if meta.unsupported:  # RESET / EXCEPTION — unsupported, unbound in both regimes
        assert binding.bindable is False, family
        assert binding.primitive is None, family
        assert family not in LEGACY_DECLARATIONS, family
        return

    # (1) the binding object vs the live legacy column
    assert binding.bindable is True, family
    assert binding.primitive == meta.effective_primitive(), family
    assert binding.approximation is meta.effective_approximation(), family

    # (2) the live column vs the hand-transcribed table (drift tripwire)
    legacy_primitive, legacy_approximation = LEGACY_DECLARATIONS[family]
    assert binding.primitive == legacy_primitive, family
    assert binding.approximation is legacy_approximation, family


def test_byte_identity_control_the_proof_can_fail():
    """★ THE CONTROL ON THE LEGACY-DECLARATION CHECK. A declaration-identity assertion that
    cannot fail proves nothing. Flipping the flag ON must make the SAME comparison fail — for
    FILTER, WAIT_BIAS, CONFIRM_DIRECTION, INVALIDATE, ENABLE_ENTRY and ENTER, whose
    declarations genuinely move. (Name kept for the module docstring's cross-reference; what it
    controls is the declaration check, not a byte-identity claim — there isn't one any more.)"""
    moved = []
    with enforced():
        for family in ("FILTER", "WAIT_BIAS", "CONFIRM_DIRECTION", "INVALIDATE", "ENABLE_ENTRY", "ENTER"):
            binding = sfb.bind_condition(
                {"id": "c1", "type": family, "role": "spine", "object": "london session"}
            )
            legacy_primitive, legacy_approximation = LEGACY_DECLARATIONS[family]
            if binding.primitive != legacy_primitive or binding.approximation is not legacy_approximation:
                moved.append(family)
    assert sorted(moved) == [
        "CONFIRM_DIRECTION", "ENABLE_ENTRY", "ENTER", "FILTER", "INVALIDATE", "WAIT_BIAS",
    ]


PER_BAR_FAMILIES = ENFORCED_PRIMITIVE_FAMILIES + [("FILTER", "confluence")]

# The pairs the flag-OFF `b.type` ladder routes to ONE shared evaluator — read off the ladder
# in spec_condition_compiler.compute(): `elif b.type in ("WAIT_STRUCTURE", "VERIFY_STRUCTURE")`
# shares `wait_structure`, and `elif b.type in ("WAIT_BIAS", "CONFIRM_DIRECTION")` shares
# `wait_bias_cache[want_bearish]`. This is a structural fingerprint of the ladder, not a
# transcribed value: rewire either branch and the partition below stops holding.
LADDER_SHARED_EVALUATOR_PAIRS = [
    ("WAIT_STRUCTURE", "VERIFY_STRUCTURE"),
    ("WAIT_BIAS", "CONFIRM_DIRECTION"),
]


def _per_bar_run(family: str, obj: str, bars: pl.DataFrame):
    """One compute(), returning the actual per-bar condition array and both signal columns."""
    strategy = _strategy_for(family, obj)
    out = strategy.compute(bars)
    return (
        strategy.last_per_condition_bool["c1"],
        out["entry_long"].to_numpy(),
        out["entry_short"].to_numpy(),
        strategy.last_non_gating_conditions,
    )


def _independent_entry_signals(arrays: dict[str, np.ndarray], n: int) -> np.ndarray:
    """Recompute the entry signal from the per-bar arrays ALONE: strict AND across the spine,
    then the rising edge into the satisfied state (single-fire). Deliberately a SECOND
    implementation, written from the contract rather than called out of the engine, so a
    change downstream of the arrays cannot move the columns and the check together."""
    satisfied = np.ones(n, dtype=bool)
    for arr in arrays.values():
        satisfied &= arr
    signal = np.zeros(n, dtype=bool)
    signal[0] = satisfied[0]
    signal[1:] = satisfied[1:] & ~satisfied[:-1]
    return signal


def test_flag_off_per_bar_output_matches_the_ladder():
    """★ REWRITTEN AFTER GRADING (BAND 6). The previous version of this test carried this
    docstring's claim — per-bar array equality "proven by exercising it, not asserted" — over a
    body that asserted ONLY `last_non_gating_conditions == {}`. The grader sabotaged flag-OFF
    per-bar output (1 signal -> 0) and it still PASSED. A proof that cannot fail is the exact
    defect this packet exists to delete, so it may not live in the packet's own test file.

    Three legs, each an ACTUAL per-bar comparison, each red-proven by the paired control below:

      1. CROSS-ARM. For every family, the flag-OFF per-bar array and BOTH signal columns are
         array-equal to the enforced arm's. This is the real statement available in-process:
         the enforced router reproduces the ladder's per-bar behaviour exactly.
      2. LADDER FINGERPRINT. Families the OFF ladder routes to one shared evaluator produce
         EQUAL arrays; families routed elsewhere do not all collapse together. A ladder branch
         that got rewired — or collapsed into the `else: np.ones` — breaks this.
      3. INDEPENDENT RECOMPUTATION. entry_long / entry_short are re-derived from the per-bar
         arrays by a second implementation of the strict-AND + rising-edge contract and must
         match the columns compute() returned. This is the leg that catches a signal being
         added or dropped downstream of the arrays — the grader's sabotage.
    """
    bars = _bars()
    n = bars.height
    assert os.environ.get(fme.FLAG_ENV, "false").lower() != "true"

    off = {family: _per_bar_run(family, obj, bars) for family, obj in PER_BAR_FAMILIES}
    with enforced():
        on = {family: _per_bar_run(family, obj, bars) for family, obj in PER_BAR_FAMILIES}

    for family, _ in PER_BAR_FAMILIES:
        off_arr, off_long, off_short, off_ledger = off[family]
        on_arr, on_long, on_short, _ = on[family]

        # leg 0 (retained): the enforcement ledger stays empty with the flag OFF.
        assert off_ledger == {}, f"{family}: enforcement ledger populated with the flag OFF"

        # leg 1: ACTUAL per-bar arrays, not a proxy for them.
        assert off_arr.dtype == bool and off_arr.shape == (n,), family
        assert np.array_equal(off_arr, on_arr), f"{family}: per-bar array moved between arms"
        assert np.array_equal(off_long, on_long), f"{family}: entry_long moved between arms"
        assert np.array_equal(off_short, on_short), f"{family}: entry_short moved between arms"

        # leg 3: signals re-derived from the arrays by an independent implementation.
        expected = _independent_entry_signals({"c1": off_arr}, n)
        assert np.array_equal(off_long, expected), (
            f"{family}: entry_long does not follow from the per-bar array it is built from"
        )
        assert not off_short.any(), f"{family}: direction=long produced short signals"

    # leg 2: the ladder's routing partition.
    for left, right in LADDER_SHARED_EVALUATOR_PAIRS:
        assert np.array_equal(off[left][0], off[right][0]), (
            f"{left}/{right} share one ladder evaluator but produced different arrays"
        )
    assert not np.array_equal(off["WAIT_STRUCTURE"][0], off["WAIT_RETEST"][0]), (
        "every family produced the same array — the ladder has collapsed and legs 1/2 are vacuous"
    )


def test_flag_off_per_bar_control_each_leg_can_fail():
    """★ THE CONTROL ON THE TEST ABOVE — the thing its predecessor did not have. Each of the
    three legs is shown FAILING when the thing it guards is actually broken. Without this the
    rewrite would be a longer assertion with the same standing as the one it replaces."""
    bars = _bars()
    n = bars.height

    # leg 1 CONTROL: re-point WAIT_SESSION under enforcement. The arms must now DISAGREE
    # per-bar, so the cross-arm equality leg is capable of failing.
    #
    # ★ THIS COMMENT USED TO DOCUMENT A DEPENDENCE ON THE SUCCESS CACHE, in these words:
    # "Loading the un-patched table first satisfies the gate for THIS pin set, and the
    # re-pointed strategy is then built against the already-passed gate." The re-point really
    # did orphan `session_windows.is_in_killzone` (a genuine pin (a)+(b) violation) and the
    # only thing making the patched load legal was the cache declining to look again — lying
    # mode 4, load-bearing, inside a CONTROL. The cache is deleted and the fixture is now a
    # COHERENT re-point that retires the abandoned primitive, so the gate runs in full and
    # passes because the table is valid, not because nobody re-read it.
    off_arr = _per_bar_run("WAIT_SESSION", "london session", bars)[0]
    with enforced():
        with family_meta_repointed(
            "WAIT_SESSION", "spec_condition_compiler.candle_confirmation_check"
        ):
            on_arr = _per_bar_run("WAIT_SESSION", "london session", bars)[0]
    assert not np.array_equal(off_arr, on_arr), "leg 1 cannot fail — it is not comparing arrays"

    # leg 2 CONTROL: a shared-evaluator pair must stop matching if one side's array changes.
    ws = _per_bar_run("WAIT_STRUCTURE", "price holds the high", bars)[0]
    tampered = ws.copy()
    tampered[0] = not tampered[0]
    assert not np.array_equal(ws, tampered), "leg 2 cannot fail"

    # leg 3 CONTROL: the grader's sabotage class, reproduced. Drop/add a single satisfied bar
    # in the per-bar array and the independently recomputed signals MUST move — proving leg 3
    # would have caught "1 signal -> 0" instead of passing through it.
    session_arr = off_arr.copy()
    baseline_signals = _independent_entry_signals({"c1": session_arr}, n)
    assert baseline_signals.sum() == 1, "control assumes the single-fire session baseline"

    # (3a) Flip ONE satisfied bar. The signal array MOVES — but note the count does NOT: the
    # session window is a contiguous block, so suppressing its first bar just relocates the
    # rising edge to the next one. Recorded because it is the reason leg 3 compares ARRAYS and
    # not counts; a count-only check would have slept through this edit.
    first_fire = int(np.argmax(baseline_signals))
    nudged = session_arr.copy()
    nudged[first_fire] = False
    nudged_signals = _independent_entry_signals({"c1": nudged}, n)
    assert not np.array_equal(baseline_signals, nudged_signals), "leg 3 cannot fail"
    assert nudged_signals.sum() == baseline_signals.sum(), (
        "expected the rising edge to relocate rather than vanish — if this changed, the "
        "comment above is stale"
    )

    # (3b) THE GRADER'S SABOTAGE, EXACTLY: 1 signal -> 0. Suppress the whole satisfied block
    # and the recomputed signals must go to zero. This is the edit that slipped past the old
    # ledger-only body; leg 3 must be able to see it.
    silenced = np.zeros(n, dtype=bool)
    silenced_signals = _independent_entry_signals({"c1": silenced}, n)
    assert silenced_signals.sum() == 0 < baseline_signals.sum(), (
        "leg 3 is not sensitive to the 1-signal-to-0 sabotage class it exists to catch"
    )


# ─────────────────────────────────────────────────────────────────────────────────────────
# PIN SELECTOR — cannot silence a pin implicitly
# ─────────────────────────────────────────────────────────────────────────────────────────


def test_pin_selector_records_what_it_skipped():
    with enforced(pins="a,b"):
        status = fme.enforcement_status(ENFORCED_DISPATCH)
        assert status["pins_skipped"] == ["b2"]
        assert status["ok"] is True


def test_pin_selector_rejects_an_unknown_pin():
    """A typo must be an error, not a silently-disabled check."""
    with enforced(pins="a,typo"):
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            fme.active_pins()
        assert "typo" in str(exc.value)


def test_pin_selector_is_inert_when_enforcement_is_off():
    prev = os.environ.get(fme.PINS_ENV)
    os.environ[fme.PINS_ENV] = "a"
    try:
        fme.reset_enforcement_cache()
        fme.ensure_enforced(ENFORCED_DISPATCH)  # flag OFF => no-op regardless of pins
    finally:
        if prev is None:
            os.environ.pop(fme.PINS_ENV, None)
        else:
            os.environ[fme.PINS_ENV] = prev


# ─────────────────────────────────────────────────────────────────────────────────────────
# ★ D1 — THE THREE WAYS THE SELECTOR COULD SILENTLY SKIP EVERY PIN
#
# Graded BAND 6. The module docstring claimed "it cannot silence a pin implicitly"; it could,
# three separate ways, and none of the three pre-existing selector tests looked at any of
# them. Each test below was RUN AGAINST THE UNFIXED MODULE FIRST and FAILED there — that is
# the only thing that makes it evidence rather than decoration.
# ─────────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("raw", [",", "", "  ", " , ", ",,,", " ,, , "])
def test_d1_mode1_an_empty_pin_selection_raises_instead_of_running_nothing(raw: str):
    """LYING MODE 1. `PINS=","` filtered to the empty name set, `unknown` was then empty too so
    nothing raised, and enforcement ran ZERO checks while reporting itself ON.

    RED PROOF (pre-fix, all six spellings): active_pins() -> frozenset(),
    collect_violations() -> [], enforcement_status() -> pins_active=[] ok=True, and
    ensure_enforced() returned silently. Every spelling that names no pin must now RAISE."""
    with enforced(pins=raw):
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            fme.active_pins()
        assert "names NO pin" in str(exc.value)
        # and the gate itself must refuse, not merely the reader
        with pytest.raises(fme.FamilyMetaEnforcementError):
            fme.ensure_enforced(ENFORCED_DISPATCH)
        with pytest.raises(fme.FamilyMetaEnforcementError):
            fme.enforcement_status(ENFORCED_DISPATCH)


def test_d1_mode1_control_unsetting_the_selector_still_runs_all_pins():
    """THE CONTROL for mode 1: raising on an empty selection must not be achieved by raising on
    everything. With the variable UNSET, all three pins are active and are really evaluated —
    shown by planting an uncovered emission and watching (b2) CONVICT it. A blanket raise would
    not produce a b2 violation; it would produce a selector error.

    ★ The signal used to be the LIVE orphan-zone gap. That gap closed, so it is planted now —
    see planted_uncovered_emission for why borrowing a defect as a control is a trap."""
    with enforced(pins=None):
        assert fme.active_pins() == frozenset(fme.ALL_PINS)
        # With the production tables clean, an all-pins run is silent...
        assert fme.collect_violations(ENFORCED_DISPATCH) == []
        # ...and that silence is a MEASUREMENT, not an absence: plant one and b2 speaks.
        with planted_uncovered_emission() as zone:
            b2 = [v for v in fme.collect_violations(ENFORCED_DISPATCH) if v.pin == "b2"]
            assert b2, "all-pins run did not evaluate b2"
            assert any(zone in str(v) for v in b2)


def test_d1_mode2_a_named_pin_that_cannot_be_evaluated_raises():
    """LYING MODE 2. `collect_violations` guarded pin (a) with `and dispatch is not None`, so a
    dispatch-less call SKIPPED it while `enforcement_status()` reported it ACTIVE, left it out
    of `pins_skipped`, and returned ok=True.

    RED PROOF (pre-fix): with a second-router key planted in ENFORCED_DISPATCH,
    collect_violations(None) returned 0 violations while collect_violations(ENFORCED_DISPATCH)
    returned 1, and ensure_enforced(None) returned silently over that live violation."""
    with enforced(pins="a"):
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            fme.collect_violations(None)
        assert "cannot be evaluated" in str(exc.value).lower() or "CANNOT be evaluated" in str(exc.value)
        with pytest.raises(fme.FamilyMetaEnforcementError):
            fme.ensure_enforced(None)
        with pytest.raises(fme.FamilyMetaEnforcementError):
            fme.enforcement_status(None)


def test_d1_mode2_the_violation_it_used_to_hide_is_now_reported():
    """Mode 2, at the level of the thing it hid rather than the mechanism. A REAL pin-(a)
    violation (a router entry no FAMILY_META names) must not be silently unreported just
    because the caller passed no map — and with the map, it must still be caught."""
    with enforced(pins="a"):
        ENFORCED_DISPATCH["orphan.d1.mode2"] = "_h_non_gating"
        try:
            found = fme.collect_violations(ENFORCED_DISPATCH)
            assert any("orphan.d1.mode2" in str(v) for v in found)
            with pytest.raises(fme.FamilyMetaEnforcementError):
                fme.collect_violations(None)  # must RAISE, never return [] over this
        finally:
            del ENFORCED_DISPATCH["orphan.d1.mode2"]


def test_d1_mode2_control_pins_that_need_no_dispatch_still_run_without_one():
    """THE CONTROL for mode 2: the fence is on pin (a) specifically, not a blanket ban on
    dispatch-less calls. Pins (b)/(b2) need no map and must still evaluate — shown by b2
    convicting a PLANTED uncovered emission with dispatch=None."""
    with enforced(pins="b,b2"):
        assert fme.collect_violations(None) == []
        with planted_uncovered_emission() as zone:
            violations = fme.collect_violations(None)
            b2 = [v for v in violations if v.pin == "b2"]
            assert b2 and any(zone in str(v) for v in b2)
            assert not [v for v in violations if v.pin == "b"]


def test_d1_mode3_a_narrow_pass_does_not_vouch_for_a_broader_run():
    """★ LYING MODE 3, THE WORST OF THE THREE. `_ENFORCED_OK` was a bare bool keyed on nothing.
    A pass under `PINS=a` warmed it, and a LATER load with the selector UNSET — all three pins
    nominally active — hit the cache and returned CLEAN without running (b) or (b2).

    RED PROOF (pre-fix): exactly that sequence returned clean, even though pin (b2) genuinely
    FAILED at the time on the live orphan-zone gap. The narrow run silently vouched for the
    broad one. The cache is now keyed on the pin set it actually covered.

    ★ Since the orphan-zone closure the production tables are clean, so the b2 failure this
    test needs is PLANTED rather than borrowed from a live defect — otherwise this test would
    have retired silently along with the defect it happened to be using."""
    prev_flag = os.environ.get(fme.FLAG_ENV)
    prev_pins = os.environ.get(fme.PINS_ENV)
    os.environ[fme.FLAG_ENV] = "true"
    try:
        fme.reset_enforcement_cache()
        os.environ[fme.PINS_ENV] = "a"
        fme.ensure_enforced(ENFORCED_DISPATCH)  # narrow run passes and warms the cache
        os.environ.pop(fme.PINS_ENV, None)      # now ALL pins — b2 must actually run, and fail
        with planted_uncovered_emission():
            with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
                fme.ensure_enforced(ENFORCED_DISPATCH)
            assert "pin(b2)" in str(exc.value), "the all-pins load did not evaluate b2"
    finally:
        for key, val in ((fme.FLAG_ENV, prev_flag), (fme.PINS_ENV, prev_pins)):
            if val is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = val
        fme.reset_enforcement_cache()


def test_d1_mode3_a_repeat_call_re_evaluates_instead_of_being_served_from_a_cache():
    """★ THE MODE-3 CONTROL, INVERTED BY THE CACHE'S DELETION — and the inversion is the point.

    This test used to assert the OPPOSITE: that a repeat call over the same pin set was served
    from the cache, "proven" by sabotaging FAMILY_META after a warming pass and observing the
    repeat call NOT notice. That behaviour — a guard declining to look at a sabotaged table
    because it had looked once already — is exactly what modes 3 and 4 were made of, and the
    control was certifying it as correct.

    The success cache is now DELETED (see the block above `ensure_enforced`), so the same
    sabotage must now be CAUGHT on the very next call. Same setup, same sabotage, opposite
    and correct expectation."""
    prev_flag = os.environ.get(fme.FLAG_ENV)
    prev_pins = os.environ.get(fme.PINS_ENV)
    os.environ[fme.FLAG_ENV] = "true"
    os.environ[fme.PINS_ENV] = "a,b"
    try:
        fme.ensure_enforced(ENFORCED_DISPATCH)  # clean pass; nothing is memoised
        with family_meta_patched("WAIT_RETEST", enforced_primitive="gone.nowhere"):
            # same pin set — previously served from cache, must now RE-RUN and convict
            with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
                fme.ensure_enforced(ENFORCED_DISPATCH)
            assert "gone.nowhere" in str(exc.value)
            # narrower pin set — previously "also covered", must also convict
            os.environ[fme.PINS_ENV] = "b"
            with pytest.raises(fme.FamilyMetaEnforcementError):
                fme.ensure_enforced(ENFORCED_DISPATCH)
            # broader — convicted before and still does
            os.environ.pop(fme.PINS_ENV, None)
            with pytest.raises(fme.FamilyMetaEnforcementError):
                fme.ensure_enforced(ENFORCED_DISPATCH)
        # CONTROL ON THE CONTROL: with the sabotage lifted the gate goes quiet again, so the
        # raises above are the sabotage being seen, not a gate that raises unconditionally.
        os.environ[fme.PINS_ENV] = "a,b"
        fme.ensure_enforced(ENFORCED_DISPATCH)
    finally:
        for key, val in ((fme.FLAG_ENV, prev_flag), (fme.PINS_ENV, prev_pins)):
            if val is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = val


def test_d1_mode4_the_guard_re_evaluates_the_dispatch_argument_on_every_call():
    """★ LYING MODE 4 — THE FIX FOR MODE 3 GREW IT.

    Keying the success cache on the PIN SET closed mode 3 and left the cache blind to the
    `dispatch` ARGUMENT. After one good all-pins load, `ensure_enforced(<violating dispatch>)`
    RETURNED CLEAN while `verify_dispatch_coverage` on that same map reported 1 violation.

    RED PROOF (pre-fix, both forms, run against the unfixed module):
      - passing a BAD map as the argument      -> ensure_enforced RETURNED CLEAN (direct
        measure of the same map: 1 violation)
      - mutating the PRODUCTION ENFORCED_DISPATCH in place, then reloading -> RETURNED CLEAN
    The guard whose stated job is "a second router is a second truth" was FIRST-LOAD-ONLY.
    The cache is deleted; both forms must now raise."""
    with enforced(pins=None):
        fme.ensure_enforced(ENFORCED_DISPATCH)  # a good all-pins load happens FIRST

        # form 1: the violating map arrives as the ARGUMENT
        bad = dict(ENFORCED_DISPATCH)
        bad["orphan.d1.mode4.arg"] = "_h_non_gating"
        direct = fme.verify_dispatch_coverage(bad)
        assert len(direct) == 1 and "orphan.d1.mode4.arg" in str(direct[0]), (
            "the planted second router is not measurable directly — this test's signal is dead"
        )
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            fme.ensure_enforced(bad)
        assert "orphan.d1.mode4.arg" in str(exc.value)

        # form 2: the PRODUCTION object is mutated in place between loads
        fme.ensure_enforced(ENFORCED_DISPATCH)
        ENFORCED_DISPATCH["orphan.d1.mode4.in_place"] = "_h_non_gating"
        try:
            with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
                fme.ensure_enforced(ENFORCED_DISPATCH)
            assert "orphan.d1.mode4.in_place" in str(exc.value)
        finally:
            del ENFORCED_DISPATCH["orphan.d1.mode4.in_place"]

        # CONTROL: the clean production map still passes, so the raises above are the planted
        # routers being seen and not a gate that has been made to raise on everything.
        fme.ensure_enforced(ENFORCED_DISPATCH)


def test_d1_mode4_control_no_success_cache_survives_in_the_module():
    """The structural half of the mode-4 fix, asserted rather than trusted to review: no
    module-level success-cache state may reappear. A re-keyed cache is how mode 4 was born;
    if one comes back on a MEASURED cost it must key on the dispatch too and rename this."""
    cache_names = [
        n for n in vars(fme)
        if n.startswith("_ENFORCED_OK") or n in {"_ENFORCED_PINS", "_ENFORCED_CACHE"}
    ]
    assert cache_names == [], f"a success cache has reappeared: {cache_names}"
    # and `force=` is gone with it — there is no cache left to force past
    import inspect
    assert "force" not in inspect.signature(fme.ensure_enforced).parameters
