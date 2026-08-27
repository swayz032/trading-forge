"""ALGO-176 acceptance: P1 and P2, the two properties that ENTAIL per-decision causality.

WHY NOT A PER-DECISION PREDICATE. Predicate C tested `max(constituent pivot .confirm) <= ts` and
FAILED its own positive control, re-finding 2 of 4 known defects. It tested a TIMESTAMP for a
QUALIFICATION defect: `exceptional_single_swing_zones` takes `established=` and a threshold both
computed at the anchor, so the same pivot yields a zone at 09:30 and none at 08:25. A per-decision
predicate also only ever covers decisions that HAPPENED - which is how C could be blind to an
entire zone family and still return a clean number.

P1 and P2 together entail the property for EVERY decision, including ones never run.

  P1  THE BUILDER IS CAUSAL GIVEN ITS ANCHOR.
      build_entry_locations_v24(env, dte, T, p)
        ==  build_entry_locations_v24(env truncated to bars completed by T, dte, T, p),  BY KEY.
      NOT tautological: the two calls take DIFFERENT INPUTS, so agreement is informative rather
      than guaranteed. NOT a reimplementation: it calls the production builder twice.

  P2  THE KERNEL ALWAYS PASSES THE DECISION'S OWN ts.
      AST: the anchor argument on the decision path is the bucket loop variable, and no literal
      timestamp reaches it.

TRUNCATION IS BY COMPLETION, NOT BY INDEX. A 15m bar stamped 09:15 has not completed at 09:20, so
"bars available at T" means `index + duration <= T`. Truncating by index alone would leave a
forming bar in the input and make P1 pass for the wrong reason.
"""
from __future__ import annotations

import ast
import inspect
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_3_engine as prod
from research import current_mnq_strategy_v2_4_kernel as kernel
from research.current_mnq_strategy_v2_4_levels import build_entry_locations_v24

core = prod.core
DATA = Path("research/_mnq_v24_replay_lab_v3/data")
#: Three sessions with three different in-window anchors. Not a sample of convenience: these are
#: the sessions ALGO-173 flagged, i.e. the ones where a difference is most likely to show.
CASES = [("2026-03-30", "08:05"), ("2026-04-02", "08:05"), ("2026-04-06", "08:25")]


@pytest.fixture(scope="module")
def env():
    return old.prepare(old.load_csv(DATA / Path(old.DATA_FILES["5m"]).name),
                       old.load_csv(DATA / Path(old.DATA_FILES["1m"]).name))


def _truncate(env: dict, T: pd.Timestamp) -> dict:
    """Only what has COMPLETED by T. See the module docstring on completion vs index."""
    e = dict(env)
    h15, full5, piv15 = env["h15"], env["full5"], env["piv15"]
    e["h15"] = h15[h15.index + pd.Timedelta(minutes=15) <= T]
    e["full5"] = full5[full5.index + pd.Timedelta(minutes=5) <= T]
    e["piv15"] = piv15[piv15.confirm <= T]
    return e


def _keys(locs):
    return sorted(str(x.id) for x in locs if x.entry_authorized)


@pytest.mark.parametrize("day,clock", CASES)
def test_P1_builder_is_causal_given_its_anchor(env, day, clock):
    T = pd.Timestamp(f"{day} {clock}", tz=core.TZ)
    dte = date.fromisoformat(day)
    p = prod.Params()
    full, _ = build_entry_locations_v24(env, dte, T, p)
    trunc, _ = build_entry_locations_v24(_truncate(env, T), dte, T, p)
    a, b = _keys(full), _keys(trunc)
    # POSITIVE CONTROL: an empty pair would make equality vacuous.
    assert a, f"the full-input build returned NO authorized locations at {T} - P1 is vacuous"
    assert a == b, (
        f"P1 VIOLATED at {T}: the builder's output depends on bars that had not completed.\n"
        f"  only with future bars: {sorted(set(a) - set(b))}\n"
        f"  only when truncated  : {sorted(set(b) - set(a))}")


def test_P2_kernel_passes_the_decision_loop_variable(env=None):
    """The anchor on the decision path is the loop variable, never a literal."""
    tree = ast.parse(inspect.getsource(kernel.iter_actionable_candidates).lstrip())
    calls = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Call):
            fn = getattr(n.func, "id", None) or getattr(n.func, "attr", None)
            if fn == "build_entry_locations_v24":
                calls.append(n)
    assert calls, "build_entry_locations_v24 is not called - P2 is vacuous"
    for c in calls:
        args = [ast.unparse(a) for a in c.args]
        assert "ts" in args, f"anchor is not the loop variable `ts`: {args}"
        for a in c.args:
            for sub in ast.walk(a):
                if isinstance(sub, ast.Constant) and isinstance(sub.value, str) and ":" in sub.value:
                    pytest.fail(f"a clock literal {sub.value!r} reaches the anchor: {args}")


def test_P2_the_loop_variable_is_the_bucket_start():
    """`ts` must be the bucket loop variable, not some other local that happens to be named ts."""
    src = inspect.getsource(kernel.iter_actionable_candidates)
    assert "for ts in bucket_starts:" in src, (
        "`ts` is not bound by the bucket loop - P2's meaning depends on that binding")
