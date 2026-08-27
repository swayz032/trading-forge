"""ALGO-181 acceptance: P3 — the premarket plan builder is causal given its anchor.

  P3   build_premarket_plan_v24(full5, dte, T)
         ==  build_premarket_plan_v24(full5 truncated to bars completed by T, dte, T)
       on EVERY field of the plan.

WHY EVERY FIELD AND NOT JUST THE TWO CONSUMED. Today the decision path reads `primary`,
`pm_structure` and `location_state` (the last is overwritten to a constant and cannot leak). A test
scoped to today's consumers would go quietly blind the moment a fourth field is read — and the
reason this defect survived so long is that `plan` was built once and consumed somewhere nobody was
looking. Comparing all 16 fields is strictly stronger and costs nothing.

WHY THIS IS NOT P1 AGAIN, AND WHY P1 COULD NEVER HAVE FOUND THE DEFECT IT IS ACCEPTING.
P1 exercises `build_entry_locations_v24`. The larger leak lived at `kernel.py:232`, which is not
inside that call, so P1's REACH — not its correctness, not its controls — is what made it blind.
That is a sixth way a guard goes green for the wrong reason, alongside the population, the scope,
the filter, the unit and the mutator: **an instrument looking at exactly the right thing, and not
far enough.**

TRUNCATION IS BY COMPLETION, not by index: a 5m bar stamped 09:25 has not printed at 09:29.
"""
from __future__ import annotations

import json
from dataclasses import fields as dc_fields
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
from research.current_mnq_strategy_v2_4_premarket import build_premarket_plan_v24

core = prod.core
DATA = Path("research/_mnq_v24_replay_lab_v3/data")
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")
#: Every anchor is BEFORE PRE_END (09:29) — the only region where the leak could ever fire.
ANCHORS = ("08:05", "08:30", "09:00", "09:25")


@pytest.fixture(scope="module")
def full5():
    env = old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                      old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))
    return env["full5"]


def _sessions():
    return [c["session"] for c in json.loads(MANIFEST.read_text(encoding="utf-8"))["cases"]]


def _snapshot(plan) -> dict:
    """Every field of the plan, so a future consumer cannot silently escape this test."""
    try:
        names = [f.name for f in dc_fields(plan)]
    except TypeError:
        names = [n for n in vars(plan)] if hasattr(plan, "__dict__") else []
    assert names, "could not enumerate plan fields - P3 would be vacuous"
    return {n: getattr(plan, n, None) for n in names}


CASES = [(s, a) for s in _sessions() for a in ANCHORS]


@pytest.mark.parametrize("day,clock", CASES)
def test_P3_premarket_plan_is_causal_given_its_anchor(full5, day, clock):
    T = pd.Timestamp(f"{day} {clock}", tz=core.TZ)
    dte = date.fromisoformat(day)
    truncated = full5[full5.index + pd.Timedelta(minutes=5) <= T]

    a = _snapshot(build_premarket_plan_v24(full5, dte, T))
    b = _snapshot(build_premarket_plan_v24(truncated, dte, T))

    # VACUITY GUARD: a plan that bailed out to the insufficient-premarket default would compare
    # equal for a reason that has nothing to do with causality.
    assert str(a.get("invalidation")) != "insufficient_premarket", (
        f"the full-input plan at {T} is the insufficient_premarket default - P3 is vacuous here")

    diff = {k: (a[k], b[k]) for k in a if a[k] != b[k]}
    assert not diff, (
        f"P3 VIOLATED at {T}: the premarket plan depends on bars that had not completed.\n"
        f"  field: (full_input, truncated_input)\n  {diff}")


def test_P3_the_field_enumeration_actually_sees_the_consumed_fields(full5):
    """POSITIVE CONTROL on the comparison itself.

    If `_snapshot` returned an empty or partial dict, every P3 case above would pass vacuously.
    Require it to contain the fields the decision path actually reads.
    """
    plan = build_premarket_plan_v24(full5, date.fromisoformat(_sessions()[0]), None)
    snap = _snapshot(plan)
    for consumed in ("primary", "pm_structure", "location_state"):
        assert consumed in snap, f"_snapshot does not expose `{consumed}` - P3 cannot see the leak"
    assert len(snap) >= 10, f"_snapshot exposes only {len(snap)} fields: {sorted(snap)}"
