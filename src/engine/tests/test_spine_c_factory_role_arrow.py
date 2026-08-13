"""SPINE-C guards — AR-1121 §4.C: the factory carries the ROLE ARROW, transport only.

THE DEFECT THIS CLOSES `[MEASURED, AR-1118/AR-1120]`
----------------------------------------------------
`SpecConditionStrategy.__init__` has accepted `source_timeframe_roles` and
`opening_range_source_frame` since AR-1113, and `run_class_backtest` parsed the
persisted carrier into `_cls_source_timeframe_roles` — a local that `grep` found in
exactly two places, its initialisation and its assignment, **read by nothing**.
`from_compiled_spec()` had no parameter for either value, so the persisted carrier and
the executing instance were two disconnected channels and `self.source_timeframe_roles`
was always `None` in production. The AR-1115 fail-closed refusal therefore *could not
fire*, and the 5m selection could not engage.

    ★★★★★ `THE CONSUMER WAS CORRECT AND ITS INPUT WAS UNREACHABLE. PROVING THE HANDLER
       IS ON THE PRODUCTION PATH SAYS NOTHING ABOUT WHETHER ITS INPUT IS.`

WHAT THIS SUITE DOES **NOT** CLAIM
----------------------------------
It proves ONE hop: factory -> instance. It does **not** claim §9.2, which AR-1121 §2
holds as a single acceptance boundary requiring a real certified sVkm record to
traverse the whole path. No sVkm record exists yet. Nothing here is a vertical witness,
and the objects below are explicitly SYNTHETIC transport probes — they stand for "an
object", never for sVkm's taught semantics.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib

import pytest

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
from src.engine.svkm_role_execution import RoleFrame

REPO = pathlib.Path(__file__).resolve().parents[3]
ARTIFACT = REPO / "docs/replay-results/h1-scripts/claude-rung-v32/shakedown_specs/-igpOZs8LsM__s0.spec.json"

#: 🛑 SYNTHETIC. Not sVkm, not any source video. These values exist to be CARRIED,
#: and this suite asserts only that the SAME OBJECT arrives — never that the values
#: are correct for any teacher. AR-1121 §5: the four expected sVkm bindings are
#: acceptance expectations, NOT permission to hardcode them.
_SYNTHETIC_QUOTE = "SYNTHETIC TRANSPORT PROBE — no source video; see module docstring"


def _synthetic_roles() -> SourceTimeframeRoles:
    return SourceTimeframeRoles(
        bindings=(
            TimeframeRoleBinding(OPENING_RANGE_WINDOW, "5m", EXPLICIT, _SYNTHETIC_QUOTE, "c0"),
            TimeframeRoleBinding(BREAKOUT_CONFIRMATION, "1m", EXPLICIT, _SYNTHETIC_QUOTE, "c1"),
            TimeframeRoleBinding(FVG_DETECTION, "1m", SOURCE_RESOLVED_BY_CONTINUITY, _SYNTHETIC_QUOTE, "c2"),
            TimeframeRoleBinding(ENTRY_COMPLETION, "1m", SOURCE_RESOLVED_BY_CONTINUITY, _SYNTHETIC_QUOTE, "c3"),
        )
    )


def _synthetic_frame() -> RoleFrame:
    base = dt.datetime(2026, 3, 2, 9, 30, tzinfo=dt.timezone.utc)
    stamps = tuple(base + dt.timedelta(minutes=5 * i) for i in range(3))
    return RoleFrame(timeframe="5m", timestamps=stamps, highs=(10.0, 11.0, 12.0), lows=(9.0, 9.5, 10.5))


def _artifact() -> dict:
    return json.loads(ARTIFACT.read_text(encoding="utf-8"))


def test_factory_transports_the_exact_role_object():
    """IDENTITY, not equality. A factory that rebuilt an equal-looking carrier would
    be a second authority for source semantics — the B1 architecture AR-1121 §2
    REJECTED — and `==` would not notice."""
    roles = _synthetic_roles()
    frame = _synthetic_frame()

    strategy = from_compiled_spec(
        _artifact(),
        symbol="MES",
        timeframe="1m",
        strategy_name="spine-c-probe",
        source_timeframe_roles=roles,
        opening_range_source_frame=frame,
    )

    assert strategy.source_timeframe_roles is roles, (
        "the factory did not hand the SAME role object to the instance"
    )
    assert strategy.opening_range_source_frame is frame, (
        "the factory did not hand the SAME 5m frame object to the instance"
    )


def test_factory_does_not_mutate_or_infer_the_roles():
    """Transport only: the carried object's content is untouched, and the factory
    never derives roles from `timeframe`."""
    roles = _synthetic_roles()
    before = json.dumps(roles.to_payload(), sort_keys=True)

    strategy = from_compiled_spec(
        _artifact(), symbol="MES", timeframe="1m", source_timeframe_roles=roles
    )

    assert json.dumps(strategy.source_timeframe_roles.to_payload(), sort_keys=True) == before
    # POSITIVE WITNESS that the payload is real content, so equality is not vacuous.
    assert strategy.source_timeframe_roles.timeframe_for(OPENING_RANGE_WINDOW) == "5m"
    assert strategy.source_timeframe_roles.timeframe_for(BREAKOUT_CONFIRMATION) == "1m"


def test_legacy_arm_is_unchanged_and_stays_none():
    """AR-1121 §7.9: legacy/no-role paths remain unchanged. Omitting both parameters
    must leave both attributes `None` — NOT a manufactured default."""
    strategy = from_compiled_spec(_artifact(), symbol="MES", timeframe="5m")
    assert strategy.source_timeframe_roles is None
    assert strategy.opening_range_source_frame is None


def test_factory_never_synthesises_a_frame_from_timeframe():
    """Supplying roles WITHOUT a frame must not cause the factory to invent one.

    The refusal belongs at execution in `_h_opening_range`, not here — defaulting a
    frame would silently aggregate the execution series as if it were the source
    series, which is precisely the defect AR-1113 §3.1 refused a resampler to avoid.
    """
    strategy = from_compiled_spec(
        _artifact(), symbol="MES", timeframe="1m", source_timeframe_roles=_synthetic_roles()
    )
    assert strategy.opening_range_source_frame is None


@pytest.mark.parametrize("param", ["source_timeframe_roles", "opening_range_source_frame"])
def test_factory_signature_accepts_both_role_inputs(param):
    """The AR-1120 measurement that convicted the missing arrow, kept as a guard:
    removing either parameter reverts the disconnect."""
    import inspect

    assert param in inspect.signature(from_compiled_spec).parameters
