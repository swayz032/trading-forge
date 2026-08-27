"""The 09:30 exam arm must move ROLE 1 — all of it, only it, and never permanently.

ALGO-049 §2 made the 09:30 baseline a RUN CONFIGURATION rather than a committed constant. The
failure modes worth testing are the ones this campaign has actually suffered:

    * the window HALF moves (a module-level copy keeps the old value) and the arm is a silent
      no-op that reports zero deltas as if the new window had been tested
    * the window moves ROLE 2 as well, silently changing WHICH S/R ZONES EXIST
    * the window LEAKS out of the arm and re-labels every later measurement
"""
from __future__ import annotations

import io
from datetime import time

import pytest

from research import current_mnq_strategy_v2_3_engine as prod
from research import current_mnq_strategy_v2_4_exam_window as W
from research import current_mnq_strategy_v2_4_kernel as ker
from research import current_mnq_strategy_v2_4_replay_lab_v3 as v3

core = prod.core


def test_the_committed_window_is_the_taught_one():
    """ALGO-049: 08:00-12:00 is the standing deployment window, and it stays committed."""
    assert (core.TRADE_START, core.LAST_ENTRY) == W.DEPLOYMENT_WINDOW


def test_the_arm_moves_every_alias_not_just_the_canonical_one():
    """The half-move is the defect. `replay_lab_v3` binds its copy at IMPORT time."""
    assert v3.TRADE_START == core.TRADE_START, "precondition: the alias starts in agreement"
    with W.trading_window(W.BASELINE_ARM_START) as active:
        assert core.TRADE_START == time(9, 30)
        assert v3.TRADE_START == time(9, 30), (
            "the module-level copy kept the old value - the arm would have run on the old "
            "window and reported deltas for a window it never tested")
        assert any("replay_lab_v3" in s for s in active["alias_sites"])
    assert core.TRADE_START == W.DEPLOYMENT_WINDOW[0]
    assert v3.TRADE_START == W.DEPLOYMENT_WINDOW[0]


def test_the_alias_sweep_does_not_touch_a_DIFFERENT_pipelines_constant():
    """`v2_1_fidelity.TRADE_START` is 09:30 and belongs to another generation of the engine.

    The NAME+VALUE join is what keeps it out: same name, different value, so it is not an
    alias of the bound being moved. A name-only sweep would rebind it.
    """
    from research import current_mnq_strategy_v2_1_fidelity as v1f
    before = v1f.TRADE_START
    assert before != core.TRADE_START, "precondition: it is a different window"
    with W.trading_window(W.BASELINE_ARM_START):
        assert v1f.TRADE_START == before, "a different pipeline's window was rebound"
    assert v1f.TRADE_START == before


def test_ROLE_2_the_session_open_anchor_never_moves():
    """The catastrophic case: moving the zone map with the trading window."""
    src = io.open(W.KERNEL_SRC, encoding="utf-8").read()
    assert 'f"{dte} 09:30"' in src
    with W.trading_window(W.BASELINE_ARM_START):
        after = io.open(W.KERNEL_SRC, encoding="utf-8").read()
        assert 'f"{dte} 09:30"' in after, "the session-open anchor moved with the window"
    assert ker.core.TZ  # the kernel is still importable and unmodified


def test_the_coupling_guard_FIRES_when_role2_is_wired_to_role1(tmp_path, monkeypatch):
    """RED-PROOF of the guard, on a synthetic source file — the kernel is never touched.

    Without this the guard above proves only that it never fires.
    """
    bad = tmp_path / "kernel_like.py"
    bad.write_text('open_ts = pd.Timestamp(f"{dte} {core.TRADE_START}", tz=core.TZ)\n',
                   encoding="utf-8")
    monkeypatch.setattr(W, "KERNEL_SRC", str(bad))
    with pytest.raises(AssertionError, match="ROLE 2"):
        W.assert_role2_is_not_coupled_to_role1()

    gone = tmp_path / "anchorless.py"
    gone.write_text("open_ts = something_else\n", encoding="utf-8")
    monkeypatch.setattr(W, "KERNEL_SRC", str(gone))
    with pytest.raises(AssertionError, match="anchor"):
        W.assert_role2_is_not_coupled_to_role1()


def test_the_window_is_restored_even_when_the_arm_raises():
    with pytest.raises(ValueError):
        with W.trading_window(W.BASELINE_ARM_START):
            assert core.TRADE_START == time(9, 30)
            raise ValueError("the arm blew up")
    assert core.TRADE_START == W.DEPLOYMENT_WINDOW[0], "the window leaked out of a failed arm"
    assert v3.TRADE_START == W.DEPLOYMENT_WINDOW[0]


def test_nesting_is_REFUSED_rather_than_stacked():
    with W.trading_window(W.BASELINE_ARM_START):
        with pytest.raises(RuntimeError, match="already active"):
            with W.trading_window(time(10, 0)):
                pass
    assert core.TRADE_START == W.DEPLOYMENT_WINDOW[0]


def test_the_arm_actually_CHANGES_what_the_kernel_will_consider():
    """POSITIVE CONTROL: the window must bite, not merely be set.

    An 08:15 bucket is inside the deployment window and outside the 09:30 arm. If the arm did
    not change which buckets are eligible, every delta it reports would be zero for the wrong
    reason — which is precisely how the ROLE-4 no-op nearly shipped.
    """
    early = time(8, 15)
    assert core.TRADE_START <= early <= core.LAST_ENTRY, "eligible in the deployment window"
    with W.trading_window(W.BASELINE_ARM_START):
        assert not (core.TRADE_START <= early), "the arm did not actually narrow the window"


def test_run_window_builds_the_env_INSIDE_the_window():
    """`prepare()` filters bars by TRADE_START, so a late build measures the wrong data."""
    seen = {}

    def build_env():
        seen["at_build"] = core.TRADE_START
        return {"env": True}

    def arm(env):
        seen["at_arm"] = core.TRADE_START
        return "ran"

    out = W.run_window(W.BASELINE_ARM_START, build_env, arm)
    assert seen["at_build"] == time(9, 30), "the env was built OUTSIDE the arm's window"
    assert seen["at_arm"] == time(9, 30)
    assert out["result"] == "ran"
    assert out["window_start"] == "09:30:00"
    assert "UNCHANGED" in out["role2_anchor"]
    assert core.TRADE_START == W.DEPLOYMENT_WINDOW[0]
