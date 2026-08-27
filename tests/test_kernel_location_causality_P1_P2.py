"""ALGO-176 acceptance: P1 and P2, the two properties that ENTAIL per-decision causality.

WHY NOT A PER-DECISION PREDICATE. Predicate C tested `max(constituent pivot .confirm) <= ts` and
FAILED its own positive control, re-finding 2 of 4 known defects. It tested a TIMESTAMP for a
QUALIFICATION defect: `exceptional_single_swing_zones` takes `established=` and a threshold both
computed at the anchor, so the same pivot yields a zone at 09:30 and none at 08:25. A per-decision
predicate also only ever covers decisions that HAPPENED - which is how C could be blind to an
entire zone family and still return a clean number.

P1 and P2 together entail the property for EVERY decision, including ones never run.

🛑 P1's REACH, AND IT MUST BE READ BEFORE P1 IS CITED FOR ANYTHING.
P1 EXERCISES `build_entry_locations_v24` ONLY. IT IS NOT EVIDENCE ABOUT THE DECISION PATH.
The larger of the two premarket leaks lived at `kernel.py:232`, which is not inside that call, so
P1 returned green on every question asked of it while a defect five times the size sat outside its
call graph. P1 is correct, its controls fire and its mutations go RED - and its REACH is narrower
than the decision path. That is a sixth way a guard goes green for the wrong reason, alongside the
population, the scope, the filter, the unit and the mutator: AN INSTRUMENT LOOKING AT EXACTLY THE
RIGHT THING, AND NOT FAR ENOUGH. It is the hardest to catch, because every question you ask it
comes back correct.
⇒ P1 may be cited ONLY as evidence about the location builder. Decision-path causality needs P2
(structural, covers every decision including ones never run) and P3 (the premarket plan).

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
MANIFEST = Path("research/current_mnq_strategy_v2_4_frozen_replay_case_manifest_2026_08_20.json")

#: WIDENED (ALGO-177 §ORDER-1) FROM 3 SESSIONS TO ALL 14, at four anchors each spanning the window.
#: The original three were the ALGO-173-flagged sessions - where a difference was most likely to
#: show, which is the right place to start and the wrong place to stop. A property that holds only
#: where you looked for trouble is a property about your search, not about the builder.
#: The anchors are fixed clocks, not sampled from any result.
_ANCHORS = ("08:05", "09:00", "09:25", "11:30")


def _sessions() -> list[str]:
    import json
    return [c["session"] for c in json.loads(MANIFEST.read_text(encoding="utf-8"))["cases"]]


CASES = [(s, a) for s in _sessions() for a in _ANCHORS]


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


def test_P2_covers_the_PREMARKET_PLAN_builder_too():
    """ALGO-181. P2 originally guarded ONE call. That is how the bigger leak survived.

    `build_premarket_plan_v24` is the other once-built, per-decision-consumed object on this path,
    and it gates DIRECTION for every setup family. Guarding only the location builder is what left
    it free to sit outside the loop for as long as it did — so the structural assertion is widened
    to every anchored builder on the decision path, not just the one that was convicted.
    """
    tree = ast.parse(inspect.getsource(kernel.iter_actionable_candidates).lstrip())
    calls = [n for n in ast.walk(tree)
             if isinstance(n, ast.Call)
             and (getattr(n.func, "id", None) or getattr(n.func, "attr", None))
             == "build_premarket_plan_v24"]
    assert calls, "build_premarket_plan_v24 is not called in the kernel - this test is vacuous"
    for c in calls:
        args = [ast.unparse(a) for a in c.args]
        assert len(args) >= 3, (
            f"the premarket plan is built WITHOUT an as_of - the original defect: {args}")
        assert args[2] == "ts", (
            f"the premarket plan is not anchored on the decision clock `ts`: {args}")


def test_P2_no_builder_on_the_decision_path_is_hoisted_out_of_the_loop():
    """Both anchored builders must sit INSIDE `for ts in bucket_starts:`.

    A call anchored on `ts` but hoisted above the loop would not compile; a call left below it but
    outside the body would silently revert to once-per-session. Checked positionally on the AST.
    """
    tree = ast.parse(inspect.getsource(kernel.iter_actionable_candidates).lstrip())
    loops = [n for n in ast.walk(tree)
             if isinstance(n, ast.For) and getattr(n.target, "id", None) == "ts"]
    assert len(loops) == 1, f"expected exactly one `for ts in ...` loop, found {len(loops)}"
    # `getattr(..., None)`: not every AST node carries a lineno, and a bare `n.lineno` raises
    # AttributeError - which made this test RED for a reason that had nothing to do with hoisting.
    # A guard that is red for the wrong reason is as useless as one that is green for the wrong
    # reason, and its red-proof looked correct.
    body_lines = {ln for ln in (getattr(n, "lineno", None) for n in ast.walk(loops[0]))
                  if ln is not None}
    assert body_lines, "could not read line numbers from the loop body - this test is vacuous"
    for fn in ("build_entry_locations_v24", "build_premarket_plan_v24"):
        sites = [n.lineno for n in ast.walk(tree)
                 if isinstance(n, ast.Call)
                 and (getattr(n.func, "id", None) or getattr(n.func, "attr", None)) == fn]
        assert sites, f"{fn} is not called - this test is vacuous"
        for ln in sites:
            assert ln in body_lines, (
                f"{fn} is called at line {ln}, OUTSIDE the per-decision loop - it would be built "
                f"once per session again")


def test_the_XRAY_mirrors_the_kernel_anchor():
    """ALGO-183. The X-ray's mirror claim is now a GUARD, not a sentence in a provenance field.

    Its `map_anchor` line said it mirrored `kernel.py`. That was TRUE WHEN WRITTEN and became false
    without anyone editing the X-ray - `kernel.py` moved beneath it. A prose claim about another
    file's behaviour has no way to notice when that file changes, which is exactly how the campaign
    spent a day reading a diagnostic that explained a different engine than the one that runs.

    Asserted structurally against the KERNEL rather than against a literal, so the two cannot drift
    apart again: whatever the kernel anchors on, the X-ray must anchor on the same NAME.
    """
    from research import current_mnq_strategy_v2_4_candidate_xray as xray

    def anchors(fn):
        tree = ast.parse(inspect.getsource(fn).lstrip())
        out = {}
        for n in ast.walk(tree):
            if isinstance(n, ast.Call):
                name = getattr(n.func, "id", None) or getattr(n.func, "attr", None)
                if name in ("build_entry_locations_v24", "build_premarket_plan_v24"):
                    args = [ast.unparse(a) for a in n.args]
                    out.setdefault(name, []).append(args[2] if len(args) > 2 else None)
        return out

    k = anchors(kernel.iter_actionable_candidates)
    x = anchors(xray.xray_session)
    assert k, "no anchored builders found in the kernel - this test is vacuous"
    assert x, "no anchored builders found in the X-ray - this test is vacuous"
    for fn_name, kernel_anchors in k.items():
        assert fn_name in x, f"the X-ray does not call {fn_name} at all - it no longer mirrors"
        assert set(x[fn_name]) == set(kernel_anchors), (
            f"{fn_name}: the kernel anchors on {sorted(set(kernel_anchors))} and the X-ray on "
            f"{sorted(set(x[fn_name]))} - the diagnostic explains a different engine")
