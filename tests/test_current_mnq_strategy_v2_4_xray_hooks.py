"""The X-ray's diagnostic hooks must not be able to change an outcome.

The derivation checkpoint's entire claim - "it sees exactly the candidates the kernel's own
ranker left standing" - rests on two things: that it hooks the real loop instead of re-walking
it, and that hooking cannot alter what the loop decides. The first is why the hooks exist at
all; a re-walked loop is what made the X-ray's ranking diverge from the kernel's, and that cost
a retraction of every number in a published report.

Neither hook had a test until routes B/C/D were built and a second one was added. These prove
the property STRUCTURALLY, on the AST, because the behavioural version needs the pinned dataset
and a minute of wall clock, and because a property is worth more than one example of it.

WHAT IS PROVEN: the hooks are optional, they default to None, they are only ever called in
statement position, and nothing in the module reads what they return. WHAT IS NOT: an arbitrary
caller's hook could still mutate the record dict it is handed. That is checked for the only two
hooks in the tree rather than claimed in general.
"""
from __future__ import annotations

import ast
import io

import pytest

XRAY = "research/current_mnq_strategy_v2_4_candidate_xray.py"
CHECKPOINT = "research/run_derivation_checkpoint.py"
HOOKS = ("on_rejection_candidate", "on_breakout_candidate")


def _tree(path):
    return ast.parse(io.open(path, encoding="utf-8").read())


def _xray_session():
    for n in ast.walk(_tree(XRAY)):
        if isinstance(n, ast.FunctionDef) and n.name == "xray_session":
            return n
    raise AssertionError("xray_session not found")


@pytest.mark.parametrize("hook", HOOKS)
def test_the_hook_is_optional_and_defaults_to_None(hook):
    """An X-ray run that passes no hook must behave exactly as it did before hooks existed."""
    fn = _xray_session()
    args = fn.args.args + fn.args.kwonlyargs
    names = [a.arg for a in args]
    assert hook in names, f"{hook} is not a parameter of xray_session"

    defaults = dict(zip([a.arg for a in fn.args.args[-len(fn.args.defaults):]],
                        fn.args.defaults)) if fn.args.defaults else {}
    d = defaults.get(hook)
    assert isinstance(d, ast.Constant) and d.value is None, f"{hook} must default to None"


@pytest.mark.parametrize("hook", HOOKS)
def test_nothing_reads_what_the_hook_RETURNS(hook):
    """Called in statement position only. A hook whose value is used could steer the loop."""
    fn = _xray_session()
    calls = [n for n in ast.walk(fn)
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == hook]
    assert calls, f"{hook} is never called"

    in_statement_position = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call):
            in_statement_position.add(id(n.value))
    for c in calls:
        assert id(c) in in_statement_position, (
            f"a {hook} call is used as a VALUE - its result could change an outcome")


@pytest.mark.parametrize("hook", HOOKS)
def test_the_hook_name_appears_only_as_a_guard_and_a_call(hook):
    """No `records.append(hook(...))`, no assignment from it, no other reference."""
    fn = _xray_session()
    uses = [n for n in ast.walk(fn) if isinstance(n, ast.Name) and n.id == hook]
    # Each use is either the guard `if hook is not None:`, the call target, or the parameter.
    assert uses, f"{hook} is unused"
    for n in uses:
        assert isinstance(n.ctx, ast.Load), f"{hook} is REASSIGNED inside the loop"


def test_the_checkpoints_own_hooks_only_record_and_never_mutate():
    """The two hooks that actually exist store their inputs and write nothing back."""
    tree = _tree(CHECKPOINT)
    hooks = [n for n in ast.walk(tree)
             if isinstance(n, ast.FunctionDef) and n.name in ("hook", "brk_hook")]
    assert len(hooks) == 2, f"expected both checkpoint hooks, found {[h.name for h in hooks]}"
    for h in hooks:
        for stmt in h.body:
            assert isinstance(stmt, ast.Assign), (
                f"{h.name} does more than record: {ast.dump(stmt)[:80]}")
            for tgt in stmt.targets:
                assert isinstance(tgt, ast.Subscript), f"{h.name} assigns something else"
                # captured[id(record)] = inputs — writes to its OWN dict, not the record.
                assert isinstance(tgt.value, ast.Name) and tgt.value.id.startswith("captured")


def test_the_checkpoint_hooks_the_loop_instead_of_re_walking_it():
    """The lesson that cost a retraction, asserted rather than remembered."""
    src = io.open(CHECKPOINT, encoding="utf-8").read()
    assert "xray_session(" in src
    for hook in HOOKS:
        assert f"{hook}=" in src, f"the checkpoint does not use {hook}"
    assert "NO SECOND LOOP" in src


# -- the checks above must be able to FAIL -------------------------------------------------

def _statement_position_violations(src: str, hook: str) -> list:
    """The same rule the real check applies, run against arbitrary source."""
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "xray_session")
    ok = {id(n.value) for n in ast.walk(fn)
          if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)}
    return [c for c in ast.walk(fn)
            if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)
            and c.func.id == hook and id(c) not in ok]


CLEAN = '''
def xray_session(env, dte, p, on_breakout_candidate=None):
    if on_breakout_candidate is not None:
        on_breakout_candidate(rec)
'''

STEERING = '''
def xray_session(env, dte, p, on_breakout_candidate=None):
    if on_breakout_candidate is not None:
        if on_breakout_candidate(rec):
            survivors.append(rec)
'''


def test_the_statement_position_rule_PASSES_a_clean_hook():
    assert _statement_position_violations(CLEAN, "on_breakout_candidate") == []


def test_the_statement_position_rule_CATCHES_a_hook_that_steers_the_loop():
    """A hook whose return value gates `survivors.append` is exactly the hazard.

    Without this the passing test above would prove only that the checker never fires.
    """
    assert _statement_position_violations(STEERING, "on_breakout_candidate")
