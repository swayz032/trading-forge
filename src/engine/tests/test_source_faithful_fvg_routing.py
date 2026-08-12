"""AR-1082 §3/§5.3 — SOURCE_FAITHFUL reaches the exact FVG primitive with the flag OFF.

Authority: AR-1082 (gpt-rulings `3645650f`) §3 and §5 item 3.

THE DEFECT, MEASURED AT AR-1081
--------------------------------
`TF_FVG_IDENTITY_ENABLED` DEFAULTS OFF. At that default a SOURCE_FAITHFUL artifact's
FVG-family condition bound to the generic `structure_engine.compute_structure_state`, so
`_eval_fvg()` never ran, `FVGResult.zones` were never produced, and the exact source-event
lane was STRUCTURALLY UNAVAILABLE at the production default.

    `EXACT SOURCE OWNERSHIP OUTRANKS AN EXPERIMENT-OFF SWITCH; EXPERIMENT COMPATIBILITY
     REMAINS INTACT FOR NON-SOURCE-FAITHFUL LANES.`   — AR-1082 §3

WHY THIS IS A FOUR-CELL MATRIX AND NOT A SINGLE TEST
-----------------------------------------------------
The change has TWO axes — flag state and artifact ownership — and a one-cell test cannot
tell "source-faithful now routes natively" from "everything now routes natively". The
ruling names all four cells, so all four are here, plus the guard that keeps the widening
from leaking onto objects that are not FVGs at all.
"""

from __future__ import annotations

import pytest

from src.engine.spec_family_bindings import compile_binding_plan

GENERIC = "structure_engine.compute_structure_state"
NATIVE = "fvg_native.compute_fvg_signal"

FVG_ID = "WAIT_STRUCTURE:the-fair-value-gap#0"
NON_FVG_ID = "WAIT_STRUCTURE:a-break-of-structure#0"

SOURCE_FAITHFUL = {"mode": "SOURCE_FAITHFUL", "target": {"type": "FIXED_R", "r_multiple": 2.0}}


def _spec(*, source_risk: dict | None, object_text: str, cond_id: str = FVG_ID) -> dict:
    spec: dict = {
        "direction": "both",
        "entry_trigger_id": cond_id,
        "entry_conditions": [
            {"id": cond_id, "type": "WAIT_STRUCTURE", "role": "spine", "object": object_text},
        ],
    }
    if source_risk is not None:
        spec["source_risk"] = source_risk
    return spec


def _primitive(spec: dict) -> str | None:
    plan = compile_binding_plan(spec)
    return next(b.primitive for b in plan.bindings if b.condition_id == spec["entry_trigger_id"])


@pytest.fixture
def flag_off(monkeypatch):
    monkeypatch.delenv("TF_FVG_IDENTITY_ENABLED", raising=False)


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv("TF_FVG_IDENTITY_ENABLED", "true")


# ── the four cells AR-1082 §5.3 names, in its own order ──────────────────────


def test_1_flag_OFF_plus_LEGACY_fvg_condition_keeps_the_generic_route(flag_off):
    """The regression cell. Every artifact in the existing library is this one, and the
    ruling forbids flipping the default: "Do not globally flip the environment default"."""
    assert _primitive(_spec(source_risk=None, object_text="a bullish fair value gap")) == GENERIC


def test_2_flag_ON_plus_LEGACY_fvg_condition_keeps_the_native_route(flag_on):
    """The experiment itself is untouched — "Do not remove the experiment flag from legacy
    behavior"."""
    assert _primitive(_spec(source_risk=None, object_text="a bullish fair value gap")) == NATIVE


def test_3_flag_OFF_plus_SOURCE_FAITHFUL_fvg_condition_gets_the_NATIVE_route(flag_off):
    """🛑 THE CELL THE WHOLE CHANGE EXISTS FOR — and the one that was RED before it."""
    assert _primitive(_spec(source_risk=SOURCE_FAITHFUL, object_text="a bullish fair value gap")) == NATIVE


def test_4_SOURCE_FAITHFUL_plus_a_NON_FVG_object_does_NOT_get_the_fvg_route(flag_off):
    """"Do not silently reinterpret an object as FVG merely because SOURCE_FAITHFUL is
    active; the same deterministic `resolve_fvg_object(obj)` authority remains required."

    Without this, the change would read as "source-faithful means native FVG" rather than
    "source-faithful stops the flag from hiding a genuine FVG condition"."""
    assert _primitive(
        _spec(source_risk=SOURCE_FAITHFUL, object_text="a break of structure", cond_id=NON_FVG_ID)
    ) == GENERIC


# ── the widening guards ──────────────────────────────────────────────────────


def test_TF_OVERLAY_VARIANT_is_NOT_source_owned_and_keeps_the_flag_route(flag_off):
    """🛑 THE NEAR MISS THIS GUARD EXISTS FOR. A truthy `source_risk` check would have
    passed every test above AND silently moved the TF_OVERLAY_VARIANT lane onto the native
    route — a lane AR-1082 §3 explicitly leaves governed by the experiment flag. The gate is
    exact equality on the MODE, not the presence of the block."""
    assert _primitive(
        _spec(source_risk={"mode": "TF_OVERLAY_VARIANT"}, object_text="a bullish fair value gap")
    ) == GENERIC


def test_a_TYPOD_mode_takes_the_legacy_route_here_and_is_refused_downstream(flag_off):
    """`run_class_backtest` owns mode validation and REFUSES an undeclared mode before any
    bar. This function must not be a second validator that can drift from it — it simply
    does not match, so a typo cannot buy the native route."""
    assert _primitive(
        _spec(source_risk={"mode": "SOURCE-FAITHFUL"}, object_text="a bullish fair value gap")
    ) == GENERIC


def test_a_malformed_source_risk_block_does_not_crash_the_compile(flag_off):
    """A malformed artifact must not take down binding-plan compilation — it takes the
    legacy route and is refused later, by the authority that owns the refusal."""
    for bad in ("SOURCE_FAITHFUL", ["SOURCE_FAITHFUL"], 42, {}):
        assert _primitive(_spec(source_risk=bad, object_text="a bullish fair value gap")) == GENERIC


def test_the_flag_reader_is_still_consulted_at_all(flag_off, monkeypatch):
    """POSITIVE CONTROL FOR CELL 1. If the bypass had been written as an unconditional
    `or True`, cells 1 and 2 would still disagree only by luck. This asserts the legacy
    route genuinely flips with the flag on the SAME spec object."""
    spec = _spec(source_risk=None, object_text="a bullish fair value gap")
    assert _primitive(spec) == GENERIC
    monkeypatch.setenv("TF_FVG_IDENTITY_ENABLED", "true")
    assert _primitive(spec) == NATIVE


def test_nothing_reads_or_mutates_the_environment_for_source_faithful(flag_off, monkeypatch):
    """AR-1082 §3 implementation constraint / §6 stop condition: "Do not introduce a
    process-global environment override such as temporarily setting
    TF_FVG_IDENTITY_ENABLED=true around compilation."

    Proven by consequence rather than by inspection: compiling a SOURCE_FAITHFUL artifact
    must leave the variable exactly as it found it — ABSENT — so no adjacent compilation can
    inherit it. `AMBIENT STATE IS NOT AN AUTHORITY, IT IS A RACE WITH A DEFAULT.`"""
    import os

    assert "TF_FVG_IDENTITY_ENABLED" not in os.environ
    _primitive(_spec(source_risk=SOURCE_FAITHFUL, object_text="a bullish fair value gap"))
    assert "TF_FVG_IDENTITY_ENABLED" not in os.environ, (
        "compilation leaked a process-global flag override"
    )
    assert _primitive(_spec(source_risk=None, object_text="a bullish fair value gap")) == GENERIC, (
        "an adjacent LEGACY compile inherited the source-faithful routing"
    )
