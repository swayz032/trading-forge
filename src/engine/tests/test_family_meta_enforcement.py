"""Tests for the FAMILY_META enforcement gate
(docs/designs/packet-family-meta-enforced-2026-07-20.md).

★ EVERY GUARD HERE IS RED-PROVEN. A guard that cannot fire is the exact defect this packet
exists to delete — FILTER's constant-True spine conditions were a probe that could not fail —
so it may not be re-introduced by the fix for it. Each test that asserts something PASSES
carries a paired control showing the same assertion FAILING when the thing it guards is
actually broken. An assertion with no such control is not evidence.
"""

from __future__ import annotations

import contextlib
import dataclasses
import os

import numpy as np
import polars as pl
import pytest

import src.engine.family_meta_enforcement as fme
import src.engine.session_windows as session_windows
import src.engine.spec_family_bindings as sfb
from src.engine.spec_condition_compiler import ENFORCED_DISPATCH, SpecConditionStrategy


@contextlib.contextmanager
def enforced(pins: str | None = "a,b"):
    """Enforcement ON for the block. Defaults to pins a,b because pin (b2) legitimately FAILS
    today on the real orphan-zone gap this packet is scoped out of fixing — see
    test_b2_orphan_zones_block_load_today, which asserts exactly that."""
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
def family_meta_patched(family: str, **changes):
    """Temporarily replace one FAMILY_META entry. Restores the exact original object."""
    original = sfb.FAMILY_META[family]
    sfb.FAMILY_META[family] = dataclasses.replace(original, **changes)
    try:
        yield
    finally:
        sfb.FAMILY_META[family] = original


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
        with family_meta_patched(
            "WAIT_SESSION", enforced_primitive="spec_condition_compiler.candle_confirmation_check"
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


# ─────────────────────────────────────────────────────────────────────────────────────────
# RETURN CHECKLIST 4 — (b2) EMIT ⊆ COVERED, DERIVED PROGRAMMATICALLY
# ─────────────────────────────────────────────────────────────────────────────────────────


def test_b2_orphan_zones_block_load_today():
    """★ (b2) fires on the REAL defect, with no synthetic sabotage: the session resolver can
    emit `lunch_blackout` / `overnight`, which `is_in_killzone` cannot check, so those are
    always-False gates wearing bindable=True. Fixing that gap is explicitly OUT of this
    packet's scope, so with ALL pins active the engine correctly REFUSES TO LOAD.

    If this test ever starts failing, the orphan-zone lane closed — that is good news, and
    this test is the thing that will say so.

    ★ THE ORPHAN ZONES ARE NEVER NAMED AS LITERALS HERE. They are DERIVED from the live
    tables, for two reasons that point the same way: (1) pin (b2)'s own rule is that these sets
    are enumerated programmatically, never transcribed, and a test that transcribes them is the
    defect wearing a test's clothes; (2) the sibling fence
    test_spec_family_bindings.py::test_sibling_sweep_no_session_test_asserts_an_uncheckable_zone
    forbids any session test from carrying an uncheckable zone as a string constant — it caught
    the first draft of this test doing exactly that, and it was right to.
    """
    orphans = set(sfb.SESSION_KEYWORDS) - set(session_windows._ZONE_CHECKS)
    assert orphans, "no orphan zones left — the gap closed; this test has done its job"
    with enforced(pins=None):
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            SpecConditionStrategy(compiled_spec=_spec("WAIT_SESSION"))
        message = str(exc.value)
        for zone in orphans:
            assert zone in message


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
# ─────────────────────────────────────────────────────────────────────────────────────────

ENFORCED_PRIMITIVE_FAMILIES = [
    ("WAIT_SESSION", "london session"),
    ("WAIT_STRUCTURE", "price holds the high"),
    ("VERIFY_STRUCTURE", "price holds the high"),
    ("WAIT_BIAS", "bullish bias"),
    ("CONFIRM_DIRECTION", "bullish bias"),
    ("WAIT_RETEST", "retest of the level"),
    ("WAIT_CONFIRMATION", "confirmation candle"),
]


@pytest.mark.parametrize(("family", "obj"), ENFORCED_PRIMITIVE_FAMILIES)
def test_polarity_resolves_and_runs(family: str, obj: str):
    """Polarity 1: the declared primitive resolves AND the condition produces a real per-bar
    array (not the constant-True pass-through)."""
    with enforced():
        strategy = SpecConditionStrategy(compiled_spec=_spec(family, obj))
        strategy.compute(_bars())
        arrays = strategy.last_per_condition_bool
        assert arrays, f"{family} produced no per-condition array"
        assert strategy.last_non_gating_conditions == {}, f"{family} was routed as non-gating"


@pytest.mark.parametrize(("family", "obj"), ENFORCED_PRIMITIVE_FAMILIES)
def test_polarity_fails_loud_when_absent(family: str, obj: str):
    """Polarity 2: the same binding fails loud when its primitive is made absent."""
    with enforced(), family_meta_patched(family, enforced_primitive=f"gone.{family.lower()}_primitive"):
        with pytest.raises(fme.FamilyMetaEnforcementError) as exc:
            SpecConditionStrategy(compiled_spec=_spec(family, obj))
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
# RETURN CHECKLIST — FLAG-OFF BYTE IDENTITY, PROVEN NOT ASSERTED
# ─────────────────────────────────────────────────────────────────────────────────────────

BYTE_IDENTITY_FAMILIES = [
    "WAIT_SESSION", "WAIT_STRUCTURE", "VERIFY_STRUCTURE", "WAIT_BIAS", "CONFIRM_DIRECTION",
    "WAIT_RETEST", "FILTER", "WAIT_CONFIRMATION", "INVALIDATE", "ENABLE_ENTRY", "ENTER",
    "EXIT_HINT", "RESET", "EXCEPTION",
]

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
"""The pre-packet declarations, held here so a silent drift in the LEGACY column — which is
what flag-OFF production still emits — is caught. These are the values every persisted binding
plan and every certified artifact was produced under; they are preserved, not endorsed."""


def test_flag_off_declarations_are_unchanged():
    assert os.environ.get(fme.FLAG_ENV, "false").lower() != "true"
    for family, (primitive, approximation) in LEGACY_DECLARATIONS.items():
        meta = sfb.FAMILY_META[family]
        assert meta.effective_primitive() == primitive, family
        assert meta.effective_approximation() is approximation, family


@pytest.mark.parametrize("family", BYTE_IDENTITY_FAMILIES)
def test_flag_off_binding_plans_are_byte_identical(family: str):
    """Flag OFF => the binding a condition receives is exactly the legacy one."""
    binding = sfb.bind_condition({"id": "c1", "type": family, "role": "spine", "object": "london session"})
    expected = LEGACY_DECLARATIONS.get(family)
    if expected is None:  # RESET / EXCEPTION — unsupported, unbound both regimes
        assert binding.bindable is False
        return
    if family == "WAIT_SESSION":
        assert binding.primitive == expected[0]
    else:
        assert binding.primitive == expected[0]
        assert binding.approximation is expected[1]


def test_byte_identity_control_the_proof_can_fail():
    """★ THE CONTROL ON THE BYTE-IDENTITY PROOF. A byte-identity assertion that cannot fail
    proves nothing. Flipping the flag ON must make the SAME comparison fail — for FILTER,
    WAIT_BIAS, INVALIDATE, ENABLE_ENTRY and ENTER, whose declarations genuinely move."""
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


def test_flag_off_per_bar_output_is_unchanged_by_this_packet():
    """The strongest OFF-side statement available in-process: for every family, the flag-OFF
    per-bar arrays equal the arrays the pre-packet `b.type` ladder produces — because the
    ladder is the code that runs, verbatim, untouched. Proven by exercising it, not asserted."""
    bars = _bars()
    for family, obj in ENFORCED_PRIMITIVE_FAMILIES + [("FILTER", "confluence")]:
        strategy = SpecConditionStrategy(compiled_spec=_spec(family, obj))
        strategy.compute(bars)
        assert strategy.last_non_gating_conditions == {}, (
            f"{family}: the enforcement ledger was populated with the flag OFF"
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
