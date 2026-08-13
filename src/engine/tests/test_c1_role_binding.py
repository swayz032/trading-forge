"""C1 guard — AR-1125 ORDER C1: the validated role set IS the executing instance's set.

THE DEFECT `[MEASURED, AR-1118/AR-1120]`
-----------------------------------------
`run_class_backtest` resolved the persisted carrier into `_cls_source_timeframe_roles`,
a local `grep` found in exactly two places — its initialisation and its assignment —
**read by nothing**. The executing instance's `self.source_timeframe_roles` was `None`
in production. The engine therefore validated a role contract it could not act on, and
the AR-1115 fail-closed refusal could never fire.

    ★★★★★ `A VALIDATED LOCAL AND A SEPARATE CONSTRUCTOR OBJECT ARE TWO AUTHORITIES THAT
       AGREE UNTIL THE DAY THEY DO NOT — AND NOTHING WOULD HAVE NOTICED.`

NOT A §9.2 CLAIM. This proves one hop. No certified sVkm record exists, so no vertical
witness is possible and none is asserted. The role values below are SYNTHETIC and stand
for "a valid role set", never for sVkm's taught semantics (AR-1125 §7: expected values
are acceptance expectations, not permission to hardcode).
"""

from __future__ import annotations

import json
import pathlib

import pytest

from src.engine.backtester import (
    _bind_source_timeframe_roles,
    _resolve_source_timeframe_roles,
)
from src.engine.source_timeframe_roles import (
    BREAKOUT_CONFIRMATION,
    ENTRY_COMPLETION,
    EXPLICIT,
    FVG_DETECTION,
    OPENING_RANGE_WINDOW,
    SOURCE_RESOLVED_BY_CONTINUITY,
    SourceTimeframeRoles,
    TimeframeRoleBinding,
)
from src.engine.spec_condition_compiler import from_compiled_spec

REPO = pathlib.Path(__file__).resolve().parents[3]
ARTIFACT = REPO / "docs/replay-results/h1-scripts/claude-rung-v32/shakedown_specs/-igpOZs8LsM__s0.spec.json"

_SYNTHETIC_QUOTE = "SYNTHETIC ROLE-BINDING PROBE — no source video; see module docstring"


def _roles(or_window: str = "5m") -> SourceTimeframeRoles:
    return SourceTimeframeRoles(
        bindings=(
            TimeframeRoleBinding(OPENING_RANGE_WINDOW, or_window, EXPLICIT, _SYNTHETIC_QUOTE, "c0"),
            TimeframeRoleBinding(BREAKOUT_CONFIRMATION, "1m", EXPLICIT, _SYNTHETIC_QUOTE, "c1"),
            TimeframeRoleBinding(FVG_DETECTION, "1m", SOURCE_RESOLVED_BY_CONTINUITY, _SYNTHETIC_QUOTE, "c2"),
            TimeframeRoleBinding(ENTRY_COMPLETION, "1m", SOURCE_RESOLVED_BY_CONTINUITY, _SYNTHETIC_QUOTE, "c3"),
        )
    )


def _strategy(*, persist_roles: bool, supplied: SourceTimeframeRoles | None = None):
    """A REAL SpecConditionStrategy built through the production factory."""
    artifact = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    if persist_roles:
        artifact["spec"]["source_timeframe_roles"] = _roles().to_payload()
    return from_compiled_spec(
        artifact,
        symbol="MES",
        timeframe="1m",
        strategy_name="c1-probe",
        source_timeframe_roles=supplied,
    )


def test_binding_puts_the_validated_object_on_the_instance():
    """The hop C1 exists to close: after binding, the instance carries the SAME object
    the gate validated — not an equal-looking copy."""
    strategy = _strategy(persist_roles=True)
    assert strategy.source_timeframe_roles is None, "precondition: nothing supplied it"

    bound = _bind_source_timeframe_roles(strategy)

    assert strategy.source_timeframe_roles is bound
    assert bound.timeframe_for(OPENING_RANGE_WINDOW) == "5m"   # positive witness: real content


def test_factory_supplied_object_is_kept_not_reparsed():
    """AR-1119 §3.6 / C1: no second independent authority. When the factory already
    supplied the typed object, THAT object survives binding."""
    supplied = _roles()
    strategy = _strategy(persist_roles=True, supplied=supplied)

    bound = _bind_source_timeframe_roles(strategy)

    assert bound is supplied
    assert strategy.source_timeframe_roles is supplied


def test_disagreement_between_supplied_and_persisted_refuses():
    """Two answers to 'which timeframe owns the opening range' is a CONFLICT, and
    AR-1110 §5 refuses conflicts rather than picking a winner."""
    strategy = _strategy(persist_roles=True, supplied=_roles(or_window="15m"))

    with pytest.raises(ValueError) as excinfo:
        _bind_source_timeframe_roles(strategy)

    assert "DISAGREE" in str(excinfo.value)


def test_missing_persisted_carrier_still_refuses():
    """The AR-1110 refusal is preserved: binding must not soften it into a default."""
    strategy = _strategy(persist_roles=False)

    with pytest.raises(ValueError) as excinfo:
        _bind_source_timeframe_roles(strategy)

    assert "source_timeframe_roles" in str(excinfo.value)
    assert strategy.source_timeframe_roles is None, "a refusal must not leave a partial binding"


def test_binding_does_not_invent_a_frame():
    """Roles are bound; the 5m frame is a separate input (AR-1125 §4) and must NOT be
    synthesised from the 1m execution series."""
    strategy = _strategy(persist_roles=True)
    _bind_source_timeframe_roles(strategy)
    assert strategy.opening_range_source_frame is None


def test_legacy_no_role_instance_is_untouched():
    """AR-1121 §7.9: legacy construction stays exactly as it was."""
    strategy = _strategy(persist_roles=False)
    assert strategy.source_timeframe_roles is None
    assert strategy.opening_range_source_frame is None


def test_resolver_still_returns_an_equal_but_independent_parse():
    """Control for the identity assertions above: the raw resolver DOES build a fresh
    object, so `is` passing after binding is a real property of the binding and not an
    artefact of the resolver returning a singleton."""
    strategy = _strategy(persist_roles=True)
    a = _resolve_source_timeframe_roles(strategy)
    b = _resolve_source_timeframe_roles(strategy)
    assert a is not b
    assert a.to_payload() == b.to_payload()
