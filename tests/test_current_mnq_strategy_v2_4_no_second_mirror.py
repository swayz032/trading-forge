"""Only ONE diagnostic may mirror the kernel, and it must be the one we know about.

The X-ray re-implemented the kernel's ranking rule and diverged from it in four ways, unnoticed,
because its correspondence test compared against a hand-typed list that the ranker was missing
from. Having fixed that instance, the question is the CLASS: does anything ELSE re-walk the
kernel's decision loop instead of consuming it?

[MEASURED 2026-08-22] The frozen-replay regrade -- the instrument that produces the 6/14 and 6/8
scorecard figures -- CALLS `iter_actionable_candidates` directly. It is not a mirror. That is
why the X-ray's ranking bug moved the episode census and the ablation denominators but did NOT
move the published fidelity score: the score never went through the X-ray.

`force_snapshot` is the one kernel gate the regrade calls on its own, and that is deliberate: it
is the independent recomputation behind the force receipt, which exists precisely so the receipt
can DISAGREE with the gate. A receipt that cannot disagree is not a receipt.

RED-PROOFED WITHOUT MUTATING THE SUBJECT. The predicate is a pure function of a module object,
so a synthetic mirror module proves it discriminates. The regrade itself is under independent
grade as this is written and must not be touched.
"""
from __future__ import annotations

import ast
import importlib.util
import inspect
import textwrap

from research import current_mnq_strategy_v2_4_frozen_replay_regrade as regrade
from research import current_mnq_strategy_v2_4_kernel as kernel

# Calling this is the regrade's job. Calling the gates BEHIND it would make it a mirror.
CONSUMES = "iter_actionable_candidates"

# Deliberate exceptions, each with a reason. Silence is not an option.
MAY_CALL_DIRECTLY = {
    "force_snapshot":
        "the independent recomputation behind the force receipt. It must be able to DISAGREE "
        "with the kernel's gate, which is the whole point of the receipt, so it is called "
        "separately on purpose.",
}


def _calls(fn) -> set[str]:
    out: set[str] = set()
    for n in ast.walk(ast.parse(textwrap.dedent(inspect.getsource(fn)))):
        if isinstance(n, ast.Call):
            f = n.func
            name = f.id if isinstance(f, ast.Name) else getattr(f, "attr", None)
            if name:
                out.add(name)
    return out


def kernel_gates() -> set[str]:
    calls = _calls(kernel.iter_actionable_candidates) | _calls(kernel._rank_and_yield)
    return {n for n in calls if callable(vars(kernel).get(n))}


def mirroring_violations(module) -> list[str]:
    """Kernel gates a module calls itself instead of consuming the kernel. Pure; testable."""
    own = set()
    for _, v in vars(module).items():
        if inspect.isfunction(v) and getattr(v, "__module__", None) == module.__name__:
            own |= _calls(v)
    return sorted((kernel_gates() & own) - set(MAY_CALL_DIRECTLY))


def test_the_regrade_consumes_the_kernel_rather_than_mirroring_it():
    assert CONSUMES in inspect.getsource(regrade), (
        "the regrade must consume the kernel's own generator, not re-walk its loop")
    violations = mirroring_violations(regrade)
    assert not violations, (
        f"the regrade calls kernel gates directly: {violations}. Either consume the kernel or "
        f"add each to MAY_CALL_DIRECTLY with a reason."
    )


def test_the_predicate_CATCHES_a_mirror(tmp_path):
    """RED-PROOF, on a synthetic module, so the graded file is never touched.

    Without this the test above proves only that the predicate never fires.

    THE PLANTED NAMES ARE DERIVED FROM `kernel_gates()`, NOT TYPED. The previous version planted
    `reversal_story_v24` by hand; when ALGO-047's wiring replaced that predicate with the entry
    authority the name stopped being a kernel gate, so the control stopped controlling anything
    and went red — a hand-typed population failing exactly the way this file's own docstring
    says a hand-typed population failed. Derived, it plants whatever the gates are today.
    """
    gates = sorted(kernel_gates() - set(MAY_CALL_DIRECTLY))
    assert len(gates) >= 2, f"too few kernel gates to plant a mirror with: {gates}"
    planted = gates[:2]

    # Written to a real file because the predicate reads SOURCE: an `exec`-ed function has none,
    # and a control that cannot be parsed would pass for the wrong reason.
    mod_path = tmp_path / "fake_mirror.py"
    mod_path.write_text(
        "def mirrors():\n" + "".join(f"    {g}()\n" for g in planted), encoding="utf-8")
    spec = importlib.util.spec_from_file_location("fake_mirror", mod_path)
    fake = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fake)

    caught = mirroring_violations(fake)
    assert set(planted) <= set(caught), (planted, caught)


def test_the_exception_list_does_not_swallow_a_real_mirror():
    """An excused gate must still be excused for a reason, and the list must stay small."""
    assert set(MAY_CALL_DIRECTLY) <= kernel_gates(), (
        f"excused names that are not kernel gates: "
        f"{sorted(set(MAY_CALL_DIRECTLY) - kernel_gates())}")
    assert all(len(v) > 40 for v in MAY_CALL_DIRECTLY.values()), (
        "every exception needs a real reason, not a placeholder")
    assert len(MAY_CALL_DIRECTLY) <= 3, (
        "the exception list is growing - that is a mirror forming one gate at a time")


def test_force_snapshot_is_the_excused_one_and_is_actually_called():
    """A stale exception is dead paperwork hiding a live hole."""
    own = set()
    for _, v in vars(regrade).items():
        if inspect.isfunction(v) and getattr(v, "__module__", None) == regrade.__name__:
            own |= _calls(v)
    assert "force_snapshot" in own, (
        "force_snapshot is excused but the regrade no longer calls it - remove the exception")
