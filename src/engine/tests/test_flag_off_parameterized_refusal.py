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

import ast
import dataclasses
from pathlib import Path

import numpy as np
import pytest

from src.engine import spec_condition_compiler as scc
from src.engine.family_meta_enforcement import FLAG_ENV
from src.engine.spec_condition_compiler import BIAS_EMA_FAST, BIAS_EMA_SLOW, SpecConditionStrategy
from src.engine.spec_family_bindings import ConditionBinding
from src.engine.tests.test_bias_refusal_surface import (
    TAUGHT,
    _df,
    _ema_cross,
    _plan,
    _spec,
)

# A distinct object, NOT `None`: `_last_bias_periods` is written only at
# spec_condition_compiler.py:1028 and initialised nowhere, so the M5 witness must be able
# to tell "attribute absent" from "attribute present and falsy". `None` would conflate them.
_NEVER_SET = object()


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
    """LANE 30 / `M5` (`R-702 §6(1)`, widened by `R-707 §6(1)`) — RE-POINTED AT A DIRECT
    EXECUTION WITNESS, BECAUSE THE OLD ONE COULD NOT FAIL.

    WHAT THIS TEST USED TO DO, AND WHY IT PROVED NOTHING
        It asserted on `last_per_condition_bool`. `[MEASURED BY GRADED INSTRUMENT, mutation
        `M5`]` moving the refusal INSIDE the dispatch loop -- so a real condition evaluates
        before the refusal -- left it GREEN, because `compute()` publishes that field only
        at its END: it reads empty however much already ran.
        `A FIXTURE THAT READS A FIELD PUBLISHED AFTER THE THING IT IS TIMING CANNOT TIME IT.`

    WHY `_last_bias_periods` IS A REAL SENTINEL AND NOT JUST A DIFFERENT FIELD
        `[MEASURED HERE, executable lines]` it is written at EXACTLY ONE place --
        `spec_condition_compiler.py:1028`, inside `_eval_wait_bias` -- and initialised
        NOWHERE in the class or its tests. So `absent` cannot be confused with `set to
        something falsy`, which is precisely the confusion the old assertion died of.
        And the flag-OFF ladder DOES reach that evaluator (`:1704`, `:1759`), so the
        witness is reachable on the path this test exercises -- checked, not assumed.

    THE PROPERTY: a plan whose FIRST condition is unparameterized and whose SECOND carries
    parameters must refuse with NOTHING evaluated.
    `A REFUSAL THAT FIRES AFTER A MUTATION IS A PARTIAL RUN WEARING AN EXCEPTION.`
    """
    spec = _spec(("first", "second"))
    plan = _plan(spec, {"second": TAUGHT})
    strat = SpecConditionStrategy(
        {"spec": spec, "spec_hash": "lane27"}, symbol="MES", timeframe="15m", binding_plan=plan
    )
    assert not hasattr(strat, "_last_bias_periods"), (
        "PREMISE BROKEN: the witness is already set on a fresh instance, so `never set` "
        "would no longer distinguish `did not evaluate` from `evaluated`."
    )

    with pytest.raises(ValueError, match="parameterized_binding_requires_enforced_dispatch"):
        strat.compute(_df())

    witness = getattr(strat, "_last_bias_periods", _NEVER_SET)
    print(f"\n[M5 ORDERING] after the refusal, _last_bias_periods = {witness!r}")
    assert witness is _NEVER_SET, (
        f"the refusal fired AFTER a real evaluator ran: `_last_bias_periods` = {witness!r}, "
        f"so `_eval_wait_bias` had already executed and cached. The refusal must precede "
        f"every evaluator and cache write."
    )


def test_m5_positive_control_the_ordering_witness_moves_when_evaluation_occurs(flag_off):
    """THE CONTROL THAT MAKES `M5`'s SENTINEL MEAN SOMETHING (`R-707 §6(1)` requires it).

    Same file, same flag state, same two-condition plan -- parameters removed so nothing
    refuses. `_last_bias_periods` must now be SET, and set to the engine defaults.

    Without this, `_last_bias_periods` being absent above would also be satisfied by a
    field that is never written on this path at all -- i.e. by a witness that is dead.
    `A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS THAT THE PATH RAN.`
    """
    strat = _run(_df(), {}, ids=("first", "second"))
    witness = getattr(strat, "_last_bias_periods", _NEVER_SET)
    print(f"\n[M5 CONTROL] evaluation occurred; _last_bias_periods = {witness!r}")
    assert witness == (BIAS_EMA_FAST, BIAS_EMA_SLOW), (
        f"the ordering witness never moved even on a path that fully evaluates "
        f"({witness!r}). It is dead, and the M5 assertion above is vacuous."
    )


# ══ F-F — THE COMMENT CLAIMED AN ORDER IT DID NOT HAVE. PIN THE ORDER, NOT THE COMMENT ══

def test_ff_refusal_precedes_the_confirmation_evaluator_on_the_flag_off_path(
    flag_off, monkeypatch
):
    """LANE 30 / `F-F` (`R-702 §6(4)`, widened by `R-707 §6(4)`).

    THE CONVICTED CLAIM: this module's refusal carried a comment saying it fires *"before
    any evaluator or cache is touched"*, while `[MEASURED, R-702 §3(2)]`
    `candle_confirmation_check(...)` ran SEVENTY-FIVE LINES EARLIER. The sentence was
    false and this desk had ratified it.

    Lane 29 hoisted the whole acknowledgement above that call, so the claim is now TRUE --
    but `A CLAIM THAT HAPPENS TO BE TRUE IS NOT A GUARD`. This pins it: if anyone lowers
    the refusal back below the confirmation evaluator, this goes RED and the comment can
    no longer drift back into being a lie.
    """
    calls = {"confirmation": 0}
    real = scc.candle_confirmation_check

    def counting(*args, **kwargs):
        calls["confirmation"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(scc, "candle_confirmation_check", counting)

    with pytest.raises(ValueError, match="parameterized_binding_requires_enforced_dispatch"):
        _run(_df(), {"armA": TAUGHT})

    print(f"\n[F-F] confirmation-evaluator invocations before the refusal: {calls['confirmation']}")
    assert calls["confirmation"] == 0, (
        f"`candle_confirmation_check` ran {calls['confirmation']} time(s) BEFORE the "
        f"refusal. The refusal does not precede every evaluator, and any comment saying "
        f"it does is false."
    )


def test_ff_positive_control_the_confirmation_counter_does_record(flag_off, monkeypatch):
    """THE HALF THAT STOPS `F-F` PASSING ON A DEAD PATCH.

    Identical instrument, parameters removed so nothing refuses: the counter must now
    record. A `monkeypatch` that silently failed to attach would report zero above and pass
    while proving nothing at all -- which is the exact species of vacuous green that F-F,
    F-E and M5 were all convicted for.
    """
    calls = {"confirmation": 0}
    real = scc.candle_confirmation_check

    def counting(*args, **kwargs):
        calls["confirmation"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(scc, "candle_confirmation_check", counting)
    _run(_df(), {})

    print(f"\n[F-F CONTROL] confirmation-evaluator invocations on a clean run: {calls['confirmation']}")
    assert calls["confirmation"] > 0, (
        "the confirmation counter never recorded even on a path that runs it -- the "
        "instrument is dead and the zero asserted above is meaningless."
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


# ══ F-E — THE CENSUS GUARD THAT COULD PASS ON ZERO FILES ═══════════════════════════════
#
# `[MEASURED BY GRADED INSTRUMENT, R-702 §4]` the previous guard walked the RELATIVE path
# `"src"`. Run from any other cwd it walked **0 files instead of 626 and went GREEN,
# BYTE-IDENTICALLY to a real pass** — and its keyword-only predicate caught 1 of 6 producer
# shapes. Two independent ways to be vacuous in one guard.
# ★★★★★ `I CHECKED WHAT MAKES A GUARD GO RED AND NEVER ASKED WHAT MAKES IT GO GREEN.`
#
# The repair is anchored, widened, and — the part that matters — SELF-AUDITING: it asserts
# it LOOKED before it reports what it found.

# Repo root derived from THIS FILE's location, never the process cwd:
#   <repo>/src/engine/tests/<this file>  ->  parents[3] == <repo>
_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCAN_ROOT = _REPO_ROOT / "src"

# DERIVED FROM THE DATACLASS AT RUNTIME, NOT HARDCODED: a positional construction only
# reaches `parameters` once it supplies this many arguments. A literal 10 here would rot
# silently the first time a field is added ahead of it.
_PARAMETERS_FIELD_INDEX = [f.name for f in dataclasses.fields(ConditionBinding)].index("parameters")


def _census(root: Path) -> tuple[list[str], dict]:
    """Return (offenders, stats). `stats` is what makes non-vacuity checkable."""
    offenders: list[str] = []
    files = 0
    binding_constructors = 0
    modules: set[str] = set()

    for path in sorted(root.rglob("*.py")):
        if "__pycache__" in path.parts or "tests" in path.parts:
            continue
        files += 1
        rel = path.relative_to(root).as_posix()
        modules.add(path.name)
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            continue

        # FORM 3 and FORM 6: aliases must be resolved per-module before matching.
        binding_names = {"ConditionBinding"}
        replace_names = {"replace"}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    if alias.name == "ConditionBinding":
                        binding_names.add(alias.asname or alias.name)
                    elif alias.name == "replace":
                        replace_names.add(alias.asname or alias.name)

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            # FORM 4 (module-qualified) arrives as an Attribute, the rest as a Name.
            called = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            is_binding = called in binding_names
            is_replace = called in replace_names
            if not (is_binding or is_replace):
                continue
            if is_binding:
                binding_constructors += 1
            by_keyword = any(k.arg == "parameters" for k in node.keywords)
            # FORM 2: positional only means anything for the CONSTRUCTOR -- `replace`'s
            # first positional is the object being copied, not a field.
            by_position = is_binding and len(node.args) > _PARAMETERS_FIELD_INDEX
            if by_keyword or by_position:
                how = "keyword" if by_keyword else "positional"
                offenders.append(f"{rel}:{node.lineno} ({called}, {how})")

    return offenders, {"files": files, "binding_constructors": binding_constructors, "modules": modules}


def _assert_the_census_actually_looked(stats: dict) -> None:
    """`A GUARD MUST ASSERT IT LOOKED, NOT ONLY THAT IT FOUND NOTHING.`

    Separated from the guard body on purpose: the empty-surface control below calls THIS
    and requires it to raise, which is how we prove the vacuity check itself can fail.
    """
    assert stats["files"] > 0, "census scanned 0 Python files — it looked at nothing"
    assert "spec_family_bindings.py" in stats["modules"], (
        "census never reached spec_family_bindings.py, the module that actually builds "
        "bindings — the scan root is wrong"
    )
    assert stats["binding_constructors"] > 0, (
        "census detected 0 ConditionBinding constructions in a repo that provably has "
        "them — the matcher is dead, not the codebase clean"
    )


def _fail_if_offenders(offenders: list[str]) -> None:
    """The guard's verdict, extracted so the per-form tests below can call THE SAME code.

    `R-707 §6(3)` requires that a planted production constructor *fail the guard*. If the
    form tests only asserted `len(offenders) == 1`, guard-failure would be an INFERENCE
    from the guard's source rather than a measurement. Sharing this function makes it a
    measurement.
    """
    assert offenders == [], (
        f"a production site now builds a parameterized binding: {offenders}. The flag-OFF "
        f"refusal will fire for it, and the activation question is no longer theoretical."
    )


def test_census_no_production_site_builds_a_parameterized_binding():
    """THE CENSUS, REPOSITORY-ANCHORED AND NON-VACUOUS (`R-702 §6(3)`, `R-707 §6(3)`).

    The repair's blast radius is bounded by a fact about the code: nothing outside tests
    ever populates `ConditionBinding.parameters`, so the OFF-path refusal cannot fire for
    any strategy this repo builds today. That fact is load-bearing, so it gets a guard.

    `A PINNED POPULATION IS NOT A CHECK ON THAT POPULATION` (R-697 §4) — so this is the
    check, not the pin. And the three assertions it runs FIRST are what stop it being a
    check that passes because it looked nowhere.
    """
    offenders, stats = _census(_SCAN_ROOT)
    _assert_the_census_actually_looked(stats)
    print(
        f"\n[CENSUS] root={_SCAN_ROOT} files={stats['files']} "
        f"ConditionBinding constructions={stats['binding_constructors']} offenders={offenders}"
    )
    _fail_if_offenders(offenders)


# The six producer shapes, each as a planted module run through the WHOLE census pipeline
# (walk + parse + alias resolution + match) rather than through the matcher alone.
_FORMS = {
    "1-keyword": "from x import ConditionBinding\nb = ConditionBinding(condition_id='c', parameters=(('fast_period', 7),))\n",
    "2-positional": "from x import ConditionBinding\nb = ConditionBinding("
                    + ", ".join(["None"] * _PARAMETERS_FIELD_INDEX)
                    + ", (('fast_period', 7),))\n",
    "3-aliased": "from x import ConditionBinding as CB\nb = CB(parameters=(('fast_period', 7),))\n",
    "4-module-qualified": "import x as sfb\nb = sfb.ConditionBinding(parameters=(('fast_period', 7),))\n",
    "5-dataclasses-replace": "import dataclasses\nb = dataclasses.replace(old, parameters=(('fast_period', 7),))\n",
    "6-aliased-replace": "from dataclasses import replace as rp\nb = rp(old, parameters=(('fast_period', 7),))\n",
}


@pytest.mark.parametrize("form", sorted(_FORMS))
def test_fe_census_detects_each_of_the_six_producer_shapes(tmp_path, form):
    """EACH FORM GETS ITS OWN CONTROLLED POSITIVE FIXTURE (`R-707 §6(3)`).

    The old predicate was keyword-only — `1 of 6`. A census that can only see one shape of
    producer is not a census, and the four it could not see are exactly the shapes a future
    author is free to use. Each planted module must be FLAGGED; a form that stops being
    detected turns its own row red rather than quietly shrinking the guard.
    """
    (tmp_path / "planted.py").write_text(_FORMS[form], encoding="utf-8")
    offenders, stats = _census(tmp_path)
    print(f"\n[FORM {form}] offenders={offenders}")
    assert stats["files"] == 1
    assert len(offenders) == 1, (
        f"producer shape {form!r} was NOT detected by the census. A production site using "
        f"this form would populate parameters invisibly: {offenders}"
    )
    # ...and detection must actually FAIL THE GUARD, measured through the guard's own
    # verdict rather than inferred from reading it (R-707 §6(3)).
    with pytest.raises(AssertionError, match="builds a parameterized binding"):
        _fail_if_offenders(offenders)


def test_fe_census_is_identical_from_a_different_cwd(tmp_path, monkeypatch):
    """THE CONTROL THAT CONVICTS THE ORIGINAL GUARD.

    `[MEASURED BY GRADED INSTRUMENT]` the previous `os.walk("src")` walked 0 files from any
    other cwd and went GREEN byte-identically. This runs the census from an unrelated
    directory and requires the SAME answer — the anchor is the test file's location, so
    the process cwd must be irrelevant.
    """
    before_offenders, before_stats = _census(_SCAN_ROOT)
    monkeypatch.chdir(tmp_path)
    after_offenders, after_stats = _census(_SCAN_ROOT)
    print(f"\n[CWD CONTROL] cwd={tmp_path} files before={before_stats['files']} after={after_stats['files']}")
    assert after_stats["files"] == before_stats["files"] > 0
    assert after_offenders == before_offenders
    _assert_the_census_actually_looked(after_stats)


# ══ THE CANONICAL REGRESSION POPULATION — COMMITTED, BECAUSE THE LAST TWO WERE NOT ══════
#
# `R-702 §4` left `80` (grader) vs `81` (doer) UNRECONCILED and `R-707 §6(5)` ordered it
# closed BY MEMBER. `[MEASURED, AR-787 §5]` NEITHER derivation was ever committed — the
# rules survive only as prose in two ARs, so neither set can be reproduced by anyone, and a
# third instrument cannot attribute a difference between two others.
# ★★★★★ `A POPULATION WHOSE INSTRUMENT WAS NEVER COMMITTED CANNOT BE RECONCILED — ONLY
# RE-DERIVED, WHICH ANSWERS A DIFFERENT QUESTION.`
# This is the part that CAN be discharged: one derivation, in the repository, deterministic,
# with a control proving it discriminates. The next population disagreement is resolvable
# because its instrument is here.

_CLOSURE_TARGETS = ("spec_condition_compiler", "spec_family_bindings")


def _regression_population(src_root: Path, targets: tuple[str, ...]) -> list[str]:
    """Test files that transitively import any target module. Normalised, sorted, relative
    to `src_root`. AST-derived: a comment mentioning a module is not an import."""
    forward: dict[str, set[str]] = {}
    paths: dict[str, Path] = {}
    for path in sorted(src_root.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        mod = ".".join(path.relative_to(src_root).with_suffix("").parts)
        paths[mod] = path
        deps: set[str] = set()
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            forward[mod] = deps
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                deps.update(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                deps.add(node.module)
                deps.update(f"{node.module}.{a.name}" for a in node.names)
        forward[mod] = deps
    tails = {m: m.rsplit(".", 1)[-1] for m in paths}

    def reaches(mod: str, seen: set[str]) -> bool:
        if mod in seen:
            return False
        seen.add(mod)
        for dep in forward.get(mod, ()):
            parts = dep.split(".")
            if any(p in targets for p in parts):
                return True
            for other, tail in tails.items():
                if tail == parts[-1] and other != mod and reaches(other, seen):
                    return True
        return False

    return sorted(
        paths[m].relative_to(src_root).as_posix()
        for m in paths
        if "tests" in paths[m].parts and reaches(m, set())
    )


def test_the_canonical_regression_population_is_derivable_and_non_vacuous():
    """ONE DERIVATION, COMMITTED, DETERMINISTIC (`R-707 §6(5)`).

    🛑 It is NOT a reconstruction of the `80` or the `81` and must never be quoted as one —
    those instruments do not exist. It is the canonical population FROM NOW ON.
    """
    population = _regression_population(_SCAN_ROOT, _CLOSURE_TARGETS)
    print(f"\n[POPULATION] canonical regression population = {len(population)} test files")
    assert len(population) > 0, "the derivation returned an empty population — it looked at nothing"
    assert "engine/tests/test_flag_off_parameterized_refusal.py" in population, (
        "this file imports the compiler and must appear in its own regression population; "
        "if it does not, the derivation is not reaching test files"
    )
    assert population == _regression_population(_SCAN_ROOT, _CLOSURE_TARGETS), (
        "the derivation is not deterministic across two runs on an unchanged tree"
    )


def test_the_population_derivation_discriminates(tmp_path):
    """THE BREAK-CONTROL. A derivation that cannot EXCLUDE anything cannot reconcile
    anything — it would return 'everything' and always agree with itself.

    Two test modules, identical except that one imports the target. Exactly one may appear.
    """
    src = tmp_path / "src" / "engine"
    (src / "tests").mkdir(parents=True)
    (src / "spec_condition_compiler.py").write_text("X = 1\n", encoding="utf-8")
    (src / "tests" / "test_importer.py").write_text(
        "from src.engine.spec_condition_compiler import X\n", encoding="utf-8"
    )
    (src / "tests" / "test_bystander.py").write_text("import json\n", encoding="utf-8")

    population = _regression_population(tmp_path / "src", _CLOSURE_TARGETS)
    print(f"\n[BREAK CONTROL] population over the planted tree = {population}")
    assert population == ["engine/tests/test_importer.py"], (
        f"the derivation cannot discriminate: it returned {population}. A population that "
        f"includes the bystander (or excludes the importer) proves nothing about membership."
    )


def test_fe_census_goes_red_on_an_empty_surface(tmp_path):
    """THE VACUITY CHECK MUST ITSELF BE ABLE TO FAIL.

    Force the scan root at an empty directory. The census legitimately finds no offenders —
    and that is precisely the false green the old guard shipped. The non-vacuity assertion
    must convert it into a RED. Without this, `_assert_the_census_actually_looked` is just
    three more lines that have never been tested.
    """
    offenders, stats = _census(tmp_path)
    assert offenders == [] and stats["files"] == 0
    with pytest.raises(AssertionError, match="scanned 0 Python files"):
        _assert_the_census_actually_looked(stats)
