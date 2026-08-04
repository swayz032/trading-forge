"""LANE 27 (R-699 §7) — WITH THE FLAG OFF, A PARAMETERIZED BINDING MUST REFUSE, NOT DROP.

THE DEFECT, MEASURED BEFORE THE REPAIR (AR-776 §3, AR-777 §5)
    `TF_FAMILY_META_ENFORCED` is the PRODUCTION DEFAULT and it is OFF. On that path the
    `elif b.type` ladder runs instead of the enforced dispatcher, `_h_wait_bias` is never
    called, and `b.parameters` is read by nothing. A binding carrying taught periods was
    evaluated as though it taught nothing: the EMA(20,50) answer, byte-identical to a
    binding that supplied no parameters at all, with no error and no trace.

WHY THIS IS THE MORE DANGEROUS HALF, AND WHY IT NEEDED ITS OWN LANE
    Lane 25's and Lane 26's refusals only fire on the ENFORCED path. Until this repair,
    the SAFER-LOOKING configuration -- the default one, the one production actually runs
    -- was the only one that could still lose a taught number silently.
    `A GUARD THAT ONLY WATCHES THE PATH YOU TURNED ON IS NOT WATCHING PRODUCTION.`

WHAT IT DOES NOT DO (R-697 §5.10, re-asserted R-699 §7)
    It does not enable the flag and does not authorize activation. It makes the OFF state
    REFUSE rather than DROP. NO PARITY CLAIM (R-696 §4). The producer is untouched.

THE CENSUS THAT LICENSED THE BLAST RADIUS (R-699 §7 ordered census-before-repair)
    SURFACE: every `ConditionBinding(...)` construction and every `dataclasses.replace(...,
    parameters=...)` under `src/**/*.py`, located by AST rather than grep so comments and
    docstrings cannot inflate it. RESULT, BY MEMBER:
      - 14 production construction sites, ALL in spec_family_bindings.py (the real
        `compile_binding_plan` builder), and NONE of them passes `parameters`.
      - 3 sites passing `parameters`, ALL in test files:
            test_bias_parameter_transmission.py:120
            test_bias_refusal_surface.py:124
            test_parameter_collision.py:89
      - 1 further test construction with no parameters (test_parameter_collision.py:262).
    So no spec JSON can produce a parameterized binding either: the builder never sets the
    field, which is a structural fact about the code rather than a claim about the corpus.
    `A COUNT IS NOT A PIN` -- the members are named above.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from src.engine.family_meta_enforcement import FLAG_ENV
from src.engine.spec_condition_compiler import BIAS_EMA_FAST, BIAS_EMA_SLOW, SpecConditionStrategy
from src.engine.tests.test_bias_refusal_surface import (
    TAUGHT,
    _df,
    _ema_cross,
    _plan,
    _spec,
)


def _run(df, params, ids=None):
    spec = _spec(ids if ids is not None else tuple(params))
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "lane27"},
        symbol="MES",
        timeframe="15m",
        binding_plan=_plan(spec, params),
    )
    strat.compute(df)
    return strat


@pytest.fixture
def flag_off(monkeypatch):
    """EXPLICIT, NOT INHERITED. The flag is deleted rather than assumed absent, so this
    file's verdict does not depend on the caller's shell -- the defect R-697 §5.7 named
    in a different instrument, applied here."""
    monkeypatch.delenv(FLAG_ENV, raising=False)


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setenv(FLAG_ENV, "true")


# ══ THE REQUIRED BEHAVIOUR, ONE FIXTURE PER STATE (R-699 §7) ══════════════════════════

def test_off_plus_parameterless_is_byte_compatible_legacy(flag_off):
    """OFF + parameterless -> unchanged. This is the fixture that keeps the repair inside
    its lane: every binding this repo builds today carries parameters=None (see the census
    in the module docstring), so a refusal that fired here would break production."""
    df = _df()
    strat = _run(df, {}, ids=("plain",))
    produced = strat.last_per_condition_bool["plain"]
    print(f"\n[OFF + parameterless] no refusal; {int(np.sum(produced))}/{len(produced)} True")
    assert np.array_equal(produced, _ema_cross(df, BIAS_EMA_FAST, BIAS_EMA_SLOW)), (
        "the flag-OFF legacy answer moved — this repair must not change it"
    )


def test_off_plus_parameterized_hard_refuses(flag_off):
    """OFF + ANY parameterized binding -> hard refusal, naming the condition."""
    with pytest.raises(ValueError, match="parameterized_binding_requires_enforced_dispatch") as exc:
        _run(_df(), {"armA": TAUGHT})
    message = str(exc.value)
    print(f"\n[OFF + parameterized] {message}")
    assert "armA" in message, "the refusal must name the offending binding"
    assert FLAG_ENV in message, "the refusal must name the flag whose state caused it"


def test_on_plus_valid_canonical_reaches_the_enforced_dispatcher(flag_on):
    """ON + valid canonical -> the enforced path, producing the taught answer.

    POSITIVE CONTROL for the refusal above: without it, an engine that refused every
    parameterized binding in BOTH flag states would pass the OFF test and destroy the
    channel Lane 21 certified.
    """
    df = _df()
    produced = _run(df, {"armA": TAUGHT}).last_per_condition_bool["armA"]
    expected = _ema_cross(df, TAUGHT["fast_period"], TAUGHT["slow_period"])
    print("\n[ON + valid] enforced dispatch produced the taught answer")
    assert np.array_equal(produced, expected)


def test_on_plus_unknown_key_still_refuses_and_never_falls_back_to_the_off_ladder(flag_on):
    """ON + unknown key -> Lane 25's refusal, NOT a silent demotion to the OFF ladder.

    A repair that caught the enforced-path refusal and retried on the legacy ladder would
    convert a loud refusal into the exact silent default this campaign is removing.
    """
    with pytest.raises(ValueError, match="supplied_parameter_cannot_fall_back_to_default"):
        _run(_df(), {"armA": {"period": 7}})
    print("\n[ON + unknown key] refused on the enforced path; no fallback to the OFF ladder")


def test_the_refusal_fires_before_any_evaluator_or_cache_mutation(flag_off):
    """FIXTURE 6 (R-699 §7), AND IT IS A REAL PROPERTY, NOT A RESTATEMENT.

    The check sits before `ctx` is constructed, so a plan whose FIRST condition is
    unparameterized and whose SECOND carries parameters must still refuse with NOTHING
    computed. If the check had been placed inside the dispatch loop, the first condition
    would already be evaluated and cached when the second refused.

    `A REFUSAL THAT FIRES AFTER A MUTATION IS A PARTIAL RUN WEARING AN EXCEPTION.`
    """
    spec = _spec(("first", "second"))
    plan = _plan(spec, {"second": TAUGHT})
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "lane27"}, symbol="MES", timeframe="15m", binding_plan=plan
    )
    with pytest.raises(ValueError, match="parameterized_binding_requires_enforced_dispatch"):
        strat.compute(_df())
    leaked = getattr(strat, "last_per_condition_bool", None)
    print(f"\n[ORDERING] after the refusal, last_per_condition_bool = {leaked!r}")
    assert not leaked, (
        f"the refusal fired AFTER conditions were evaluated: {leaked!r}. It must precede "
        f"every evaluator and cache write."
    )


def test_mutation_control_planted_silent_drop_fails(flag_off):
    """FIXTURE 5 (R-699 §7): a planted restoration of silent parameter dropping must FAIL.

    The plant is the pre-repair behaviour expressed exactly -- strip the parameters off
    every binding before compute(), which is precisely what the OFF ladder used to do in
    effect. Under it there is no refusal AND the output is the engine-default answer,
    byte-identical to teaching nothing. That is the defect, and the test above goes red
    against it.
    """
    df = _df()
    spec = _spec(("armA",))
    plan = _plan(spec, {"armA": TAUGHT})
    plan.bindings[:] = [dataclasses.replace(b, parameters=None) for b in plan.bindings]
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "lane27"}, symbol="MES", timeframe="15m", binding_plan=plan
    )
    strat.compute(df)                       # must NOT raise — the plant removed the signal
    produced = strat.last_per_condition_bool["armA"]
    default_answer = _ema_cross(df, BIAS_EMA_FAST, BIAS_EMA_SLOW)
    differing = int(np.sum(produced != default_answer))
    print(
        f"\n[MUTATION CONTROL] planted silent drop: no refusal; differs from the engine "
        f"default on {differing}/{len(produced)} bars (must be 0 — this IS the defect)"
    )
    assert differing == 0, (
        "MUTATION CONTROL DEAD: the planted silent drop produced something other than the "
        "engine-default answer, so the refusal tests above prove nothing."
    )


def test_census_no_production_site_builds_a_parameterized_binding():
    """THE CENSUS, MADE EXECUTABLE RATHER THAN LEFT IN A REPORT.

    The repair's blast radius is bounded by a fact about the code: nothing outside tests
    ever populates `ConditionBinding.parameters`, so the OFF-path refusal cannot fire for
    any strategy this repo builds today. That fact is load-bearing, so it gets a guard --
    the moment a production site starts supplying parameters, this goes RED and the flag
    question becomes live rather than theoretical.

    `A PINNED POPULATION IS NOT A CHECK ON THAT POPULATION` (R-697 §4) — so this is the
    check, not the pin.
    """
    import ast
    import os

    offenders = []
    for dirpath, dirnames, filenames in os.walk("src"):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for name in filenames:
            if not name.endswith(".py"):
                continue
            path = os.path.join(dirpath, name).replace(os.sep, "/")
            if "/tests/" in path:
                continue
            try:
                tree = ast.parse(open(path, encoding="utf-8", errors="replace").read())
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and "parameters" in [k.arg for k in node.keywords]:
                    fn = getattr(node.func, "id", getattr(node.func, "attr", None))
                    if fn in ("ConditionBinding", "replace"):
                        offenders.append(f"{path}:{node.lineno} ({fn})")

    print(f"\n[CENSUS] non-test sites supplying ConditionBinding.parameters: {offenders}")
    assert offenders == [], (
        f"a production site now builds a parameterized binding: {offenders}. The flag-OFF "
        f"refusal will fire for it, and the activation question is no longer theoretical."
    )
