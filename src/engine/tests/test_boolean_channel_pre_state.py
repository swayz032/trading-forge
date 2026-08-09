"""B1 STEP 6B, step (2) — THE PRE-CHANGE POSITIVE CONTROL, LANDED ALONE AND GREEN.

AUTHORITY: R-743 §6-2, verbatim — *"FIRST, land the positive control proving the
existing boolean channel still executes a genuine neighbouring structure
condition — it must be GREEN BEFORE the change so its pre-state is on the
record."*

WHY IT LANDS BEFORE THE CHANNEL EXISTS
--------------------------------------
`R-743 §5` authorises a second execution kind (`STATE_PRODUCER`) beside the
existing `GATE`. The risk that carries is not that the new lane fails loudly —
it is that the OLD lane quietly stops computing while every opening-range test
goes green, and nobody can then say whether the boolean channel was already
broken or was broken by the change.

    `A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS THAT THE PATH RAN.`
    (`[absence-claim]`)

So this file is committed on its own, green, at a commit that contains NO part of
the state channel. Its pre-state is then a fact on the record rather than a
recollection, and `git log` can prove which side of the change it was measured
on.

WHAT IT DELIBERATELY DOES NOT DO
--------------------------------
It pins no magic count. `90 of 200` is what this fixture produces today, and
embalming it would convert a live control into a `[hardcoded-test]` that fails on
any unrelated seed or cadence change while proving nothing about execution. The
load-bearing properties are: the neighbour routes to the STRUCTURE primitive, it
returns a real per-bar boolean array, that array is NOT CONSTANT, and two runs
agree.

`NOT CONSTANT` is the discriminating one. A dead route returning `np.ones` (the
silent pass-through this campaign has deleted before) and a route that never
fires both produce a constant array, and both would satisfy a test that only
checked dtype and length.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import polars as pl

from src.engine.spec_condition_compiler import SpecConditionStrategy
from src.engine.spec_family_bindings import compile_binding_plan

N_BARS = 200
STRUCTURE_PRIMITIVE = "structure_engine.compute_structure_state"

# A GENUINE neighbouring structure sentence — the same text the STEP 3
# discrimination instrument uses as its `NEIGHBOUR_TEXT` control, i.e. one this
# campaign has already established is a real structure condition and NOT an
# opening range. Using the instrument's own neighbour keeps the two joinable.
NEIGHBOUR_TEXT = (
    "After the first break of structure, price performs a healthy pullback and then forms "
    "another break of structure, further confirming the trend"
)


def _df(seed: int = 11, n: int = N_BARS) -> pl.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 0.5, n))
    return pl.DataFrame(
        {
            "open": close + rng.normal(0, 0.3, n),
            "high": close + rng.uniform(0.1, 1.5, n),
            "low": close - rng.uniform(0.1, 1.5, n),
            "close": close,
            "ts_event": [
                datetime(2026, 1, 5, 9, 30, tzinfo=UTC) + timedelta(minutes=15 * i)
                for i in range(n)
            ],
            "volume": [100] * n,
        }
    )


def _spec() -> dict:
    return {
        "direction": "long",
        "entry_conditions": [
            {"id": "t1", "type": "ENABLE_ENTRY", "object": "entry", "role": "trigger"},
            {"id": "s1", "type": "WAIT_STRUCTURE", "object": NEIGHBOUR_TEXT, "role": "spine"},
        ],
        "invalidations": [],
        "entry_trigger_id": "t1",
    }


def _run(df: pl.DataFrame) -> SpecConditionStrategy:
    spec = _spec()
    strategy = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "boolean-channel-pre-state"},
        symbol="MES",
        timeframe="15m",
        binding_plan=compile_binding_plan(spec),
    )
    strategy.compute(df)
    return strategy


def test_the_neighbour_routes_to_the_structure_primitive_not_the_opening_range_one():
    """Route identity FIRST. Without it the rest of this file could be measuring
    the wrong condition and reporting it as the boolean channel's health."""
    plan = compile_binding_plan(_spec())
    by_id = {b.condition_id: b for b in plan.bindings}
    assert by_id["s1"].bindable is True
    assert by_id["s1"].primitive == STRUCTURE_PRIMITIVE, (
        f"the neighbour routed to {by_id['s1'].primitive!r}; this control only says "
        "something about the boolean channel if it is the structure route being exercised"
    )


def test_the_boolean_channel_executes_the_neighbour_today():
    """THE PRE-STATE. Measured on a commit that contains no part of the typed
    state channel."""
    produced = _run(_df()).last_per_condition_bool["s1"]
    assert isinstance(produced, np.ndarray)
    assert produced.dtype == np.bool_
    assert produced.shape == (N_BARS,)


def test_the_neighbours_output_is_not_constant():
    """THE DISCRIMINATOR.

    A silent `np.ones` pass-through and a route that never fires are both
    constant, and both satisfy a dtype-and-length check. Requiring BOTH values to
    appear is what makes this a witness that the structure engine actually ran
    and actually decided.
    """
    produced = _run(_df()).last_per_condition_bool["s1"]
    true_count = int(np.sum(produced))
    assert 0 < true_count < N_BARS, (
        f"the neighbour produced a CONSTANT array ({true_count}/{N_BARS} True). "
        "A constant is what a dead route and a pass-through both return, so this "
        "control can no longer distinguish an executing channel from a broken one."
    )


def test_the_neighbour_is_deterministic_across_runs():
    """Two runs over the same frame must agree, or the pre-state is not a state.

    Pinned as AGREEMENT rather than as a count: embalming today's number would
    fail on any unrelated seed or cadence change while proving nothing about
    execution (`[hardcoded-test]`).
    """
    first = _run(_df()).last_per_condition_bool["s1"]
    second = _run(_df()).last_per_condition_bool["s1"]
    assert np.array_equal(first, second)


def test_this_file_predates_the_state_channel():
    """THE CLAIM THIS FILE EXISTS TO MAKE AUDITABLE.

    R-743 §6-2 requires the pre-state to be on the record BEFORE the channel
    lands. This asserts the channel is genuinely absent at the commit that
    carries this file — so a future reader can tell that the numbers above were
    taken on the old lane, not recorded after the fact.

    It is EXPECTED TO BE UPDATED by the 6B commit, and that update is part of
    that commit's diff rather than a silent cleanup.
    """
    import importlib.util

    assert importlib.util.find_spec("src.engine.opening_range_state_channel") is None, (
        "the typed state channel now exists; this pre-state control has served its "
        "purpose and must be retired IN the commit that introduced the channel, "
        "not left asserting a world that no longer exists"
    )
