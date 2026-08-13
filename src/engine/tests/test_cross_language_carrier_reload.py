"""CROSS-LANGUAGE reload — AR-1133 §4: what TypeScript persisted, Python consumes.

The TS side is proven by `spec-carrier-db-roundtrip.test.ts` (INSERT -> reload, both
carriers deep-equal). This file starts from the SAME persisted shape and proves the
Python engine actually reads it:

    reloaded config.compiled_spec  ->  from_compiled_spec  ->  SpecConditionStrategy
      -> _bind_source_timeframe_roles()  consumes the persisted role carrier
      -> _resolve_source_fixed_r()       returns the persisted teacher R

🛑 THE POINT OF THE MUTATIONS: `2.0` must be READ, never MANUFACTURED. AR-1133 §4 is
explicit — "no default may manufacture 2.0". A test that only asserts `== 2.0` would pass
against a hardcoded default, so the R is varied and the carrier removed.

The payload is SYNTHETIC and mirrors the TS round-trip fixture byte-for-byte in shape.
It is NOT sVkm and NOT a §9.2 witness.
"""

from __future__ import annotations

import copy

import pytest

from src.engine.backtester import _bind_source_timeframe_roles, _resolve_source_fixed_r
from src.engine.source_timeframe_roles import BREAKOUT_CONFIRMATION, OPENING_RANGE_WINDOW
from src.engine.spec_condition_compiler import from_compiled_spec

Q = "SYNTHETIC ROUND-TRIP PROBE — not sVkm, no source video"

#: EXACTLY the shape spec-carrier-db-roundtrip.test.ts persists and reloads.
PERSISTED_SPEC = {
    "direction": "long",
    "entry_conditions": [
        {"id": "T1", "type": "ENABLE_ENTRY", "object": "order block entry trigger", "role": "trigger", "span": {"start": 0, "end": 10}, "evidence": "T-r-001"},
    ],
    "and_groups": [], "or_branches": [], "invalidations": [], "entry_trigger_id": "T1",
    "source_timeframe_roles": {
        "schema": "SOURCE_TIMEFRAME_ROLES/1",
        "bindings": [
            {"role": "OPENING_RANGE_WINDOW", "timeframe": "5m", "evidence_grade": "EXPLICIT", "source_quote": Q, "condition_id": "T1"},
            {"role": "BREAKOUT_CONFIRMATION", "timeframe": "1m", "evidence_grade": "EXPLICIT", "source_quote": Q, "condition_id": "S1"},
            {"role": "FVG_DETECTION", "timeframe": "1m", "evidence_grade": "SOURCE_RESOLVED_BY_CONTINUITY", "source_quote": Q, "condition_id": "C1"},
            {"role": "ENTRY_COMPLETION", "timeframe": "1m", "evidence_grade": "SOURCE_RESOLVED_BY_CONTINUITY", "source_quote": Q, "condition_id": "C2"},
        ],
    },
    "source_risk": {
        "mode": "SOURCE_FAITHFUL",
        "stop": {"anchor": "sweep_wick_below_entry", "include_wick": True, "span": {"start": 120, "end": 260}},
        "target": {"type": "FIXED_R", "r_multiple": 2, "span": {"start": 300, "end": 440}},
    },
}


def _strategy(spec: dict | None = None):
    compiled = {"video": "rtVid001", "spec_hash": "a" * 64, "spec": copy.deepcopy(spec or PERSISTED_SPEC)}
    return from_compiled_spec(compiled, symbol="MES", timeframe="1m", strategy_name="xlang-probe")


def test_python_binds_the_role_carrier_typescript_persisted():
    s = _strategy()
    assert s.source_timeframe_roles is None, "precondition: the factory was given nothing"

    bound = _bind_source_timeframe_roles(s)

    assert s.source_timeframe_roles is bound
    assert bound.timeframe_for(OPENING_RANGE_WINDOW) == "5m"
    assert bound.timeframe_for(BREAKOUT_CONFIRMATION) == "1m"


def test_fixed_r_is_READ_from_the_persisted_contract():
    assert _resolve_source_fixed_r(_strategy()) == 2.0


@pytest.mark.parametrize("r", [1.5, 3.0, 4.25])
def test_fixed_r_FOLLOWS_the_persisted_value_so_2_0_is_not_a_default(r):
    """The discriminator. A hardcoded 2.0 would pass the test above and fail here."""
    spec = copy.deepcopy(PERSISTED_SPEC)
    spec["source_risk"]["target"]["r_multiple"] = r
    assert _resolve_source_fixed_r(_strategy(spec)) == r


def test_missing_target_REFUSES_rather_than_defaulting():
    spec = copy.deepcopy(PERSISTED_SPEC)
    del spec["source_risk"]["target"]
    with pytest.raises(ValueError, match="source_risk.target"):
        _resolve_source_fixed_r(_strategy(spec))


def test_missing_role_carrier_REFUSES_rather_than_recovering():
    spec = copy.deepcopy(PERSISTED_SPEC)
    del spec["source_timeframe_roles"]
    s = _strategy(spec)
    with pytest.raises(ValueError, match="source_timeframe_roles"):
        _bind_source_timeframe_roles(s)
    assert s.source_timeframe_roles is None


def test_the_two_carriers_are_independent():
    """Losing the R target must not silently cost the role contract, or vice versa —
    they are separate source facts and each refuses on its own."""
    spec = copy.deepcopy(PERSISTED_SPEC)
    del spec["source_risk"]["target"]
    s = _strategy(spec)
    assert _bind_source_timeframe_roles(s).timeframe_for(OPENING_RANGE_WINDOW) == "5m"
    with pytest.raises(ValueError):
        _resolve_source_fixed_r(s)
