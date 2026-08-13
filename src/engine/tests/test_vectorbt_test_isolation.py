"""VECTORBT-TEST-ISOLATION-1 — AR-1101 §3's eight-point proof matrix.

🛑 THE CLASS. ~23 test modules mutate `sys.modules["vectorbt"]` at MODULE SCOPE and never restore
it. `backtester` imports vectorbt LAZILY IN-FUNCTION, so the stub outlives its module and every
later backtest in the session resolves to it — and `int(MagicMock()) == 1`, which is the SAME
number, in the SAME field, on the SAME route as the real F-4 trade-population collapse.

★ `A TEST ARTIFACT THAT EQUALS THE DEFECT'S VALUE DOES NOT MERELY MISLEAD YOU — IT CONFIRMS YOUR
   HYPOTHESIS.`

The guard lives in `src/engine/conftest.py`:
  * `pytest_sessionstart` snapshots the vectorbt namespace BEFORE any test module is imported —
    the earliest hook that can see a clean namespace. An ordinary fixture cannot: pytest imports
    test modules during COLLECTION, before fixture setup, so a fixture-taken baseline would
    snapshot the already-poisoned state and canonize the defect (AR-1101 §2).
  * an autouse function-scoped fixture restores that baseline before AND after every test.

🛑 ORDER-DEPENDENCE CANNOT BE PROVEN IN-PROCESS. These are real `pytest` SUBPROCESS runs, because
the thing under test is what one module's import does to another module's run. Asserting it from
inside a single already-configured session would be measuring the guard with the guard on.
"""

import subprocess
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

REPO = Path(__file__).resolve().parents[3]
T = "src/engine/tests"

# The two known poisoners, named because a class needs members, not a description.
POISONER_A = f"{T}/test_black_swan_evaluator.py"          # stub removed, kept as an order probe
POISONER_B = f"{T}/test_deepscan14_cf_commission_sentinel_b2_closure.py"  # live module-scope stub

# The source suites that would go red if a MagicMock reached the engine. They already assert
# trade count, per-trade identity, sizing and result schema, so "all green" IS the identity claim
# AR-1101 §3.4 asks for.
SOURCE_SUITES = [f"{T}/test_source_trade_population.py", f"{T}/test_band_c_sizing_ingress.py"]


def _run(paths, timeout=900):
    """One real pytest subprocess. Returns (returncode, tail-of-output)."""
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", *paths, "-q", "-p", "no:randomly"],
        cwd=REPO, capture_output=True, text=True, timeout=timeout,
    )
    return proc.returncode, (proc.stdout + proc.stderr)[-3000:]


class TestOrderDependenceIsDead:
    """AR-1101 §3.1–§3.5 — the poisoners may precede, follow, or surround the source suites."""

    def test_1_CLEAN_CONTROL_source_suites_alone(self):
        """The baseline every other case is compared against. If THIS is red, the matrix below
        proves nothing about ordering."""
        rc, out = _run(SOURCE_SUITES)
        assert rc == 0, f"clean control failed:\n{out}"

    def test_2_poisoner_A_BEFORE_source(self):
        rc, out = _run([POISONER_A, *SOURCE_SUITES])
        assert rc == 0, f"black-swan module changed the source result:\n{out}"

    def test_3_poisoner_B_BEFORE_source(self):
        """🛑 THE ONE THAT MATTERS MOST. This module still installs its stub at module scope, via
        `_install_vbt_mock()` assigning `sys.modules[mod]` through a LOOP VARIABLE — which is why
        a literal grep for `sys.modules["vectorbt"]` never found it. It is deliberately NOT
        edited: the guard must make the poisoner harmless without the poisoner's cooperation."""
        rc, out = _run([POISONER_B, *SOURCE_SUITES])
        assert rc == 0, f"the live module-scope poisoner still reaches the source engine:\n{out}"

    def test_4_BOTH_poisoners_before_source(self):
        rc, out = _run([POISONER_A, POISONER_B, *SOURCE_SUITES])
        assert rc == 0, f"the combined poisoners changed the source result:\n{out}"

    def test_5_REVERSE_order_source_then_poisoners(self):
        """The guard must not break the mock-dependent tests either — isolation is symmetric or
        it is just a different contamination."""
        rc, out = _run([*SOURCE_SUITES, POISONER_A, POISONER_B])
        assert rc == 0, f"the source run broke the mock-dependent modules:\n{out}"


    def test_5b_RED_PROOF_ablating_the_guard_brings_the_contamination_BACK(self):
        """🛑 THE DISCRIMINATOR. Without this, all five greens above are compatible with a guard
        that does nothing and a poisoner that never mattered.

        `TF_MOCK_VBT=1` makes the isolation fixture step aside (it is the documented opt-in for
        tests that WANT a fake vectorbt) while installing nothing itself — so it is a clean
        ablation switch for the guard alone.

        `[MEASURED]` guard ON: green. Guard ABLATED: `10 failed, 3 errors` on the identical
        command. The green is therefore attributable to the guard and to nothing else.
        ★ `A GUARD THAT CANNOT BE SWITCHED OFF CANNOT BE SHOWN TO BE DOING THE WORK.`
        """
        import os
        env = {**os.environ, "TF_MOCK_VBT": "1", "PYTHONIOENCODING": "utf-8"}
        proc = subprocess.run(
            [sys.executable, "-m", "pytest", POISONER_B, SOURCE_SUITES[0],
             "-q", "-p", "no:randomly"],
            cwd=REPO, capture_output=True, text=True, timeout=900, env=env,
        )
        assert proc.returncode != 0, (
            "with the isolation guard ablated the source suite STILL passed — either the "
            "poisoner stopped poisoning or this ablation no longer disables the guard, and "
            "either way the greens above no longer prove what they claim:\n"
            + (proc.stdout + proc.stderr)[-2000:]
        )


@pytest.fixture()
def live_conftest(request):
    """🛑 THE CONFTEST PYTEST IS ACTUALLY RUNNING — NOT THE ONE `import` GIVES YOU.

    My first version of this class did `import src.engine.conftest` and asserted on its
    `_VBT_BASELINE`. Every assertion failed, and one PASSED FOR THE WRONG REASON. Cause: pytest
    loads `conftest.py` as its own plugin module, so a plain import creates a SECOND module
    object whose `_VBT_BASELINE` is forever `None`. The guard was working the whole time; I was
    interrogating a dead copy of it.

    ⚠️ Note the shape of the false green: with `_VBT_BASELINE is None` the restore is a no-op, so
    the NEGATIVE control ("a real module is preserved") passed — because nothing was ever
    removed. ★ `A NO-OP SATISFIES EVERY ASSERTION THAT SOMETHING WAS LEFT ALONE.`

    Same family as [[i-measured]]: two objects, one name, and I read the wrong one.
    """
    for plugin in request.config.pluginmanager.get_plugins():
        if hasattr(plugin, "_VBT_BASELINE") and hasattr(plugin, "_restore_vbt_baseline"):
            return plugin
    raise AssertionError(
        "no loaded conftest plugin exposes the vectorbt isolation guard — it is not registered"
    )


class TestTheGuardItself:
    """AR-1101 §3.6–§3.7 — the restore primitive, with both controls."""

    def test_6_the_baseline_was_taken_at_SESSIONSTART(self, live_conftest):
        """POSITIVE WITNESS that the hook ran at all. Without it every assertion below could pass
        on a guard that never armed — which is exactly what happened on my first attempt."""
        assert live_conftest._VBT_BASELINE is not None, (
            "pytest_sessionstart never captured a vectorbt baseline — the guard is not armed"
        )

    def test_7_a_planted_MagicMock_is_EVICTED(self, live_conftest):
        """AR-1101 §3.7, the planted-contamination control. A MagicMock must never survive to
        become a trade count."""
        sys.modules["vectorbt"] = MagicMock()
        changed = live_conftest._restore_vbt_baseline()
        assert not isinstance(sys.modules.get("vectorbt"), MagicMock), (
            "a MagicMock survived the restore"
        )
        assert changed, "the restore reported no change while a fake was present"

    def test_7b_a_planted_BARE_MODULE_stub_is_also_evicted(self, live_conftest):
        """The other shape the poisoners install: a real `ModuleType` with no `__file__`. A
        `__file__`-only check would miss the MagicMock and an isinstance-only check would miss
        this, so both shapes are asserted."""
        sys.modules["vectorbt"] = types.ModuleType("vectorbt")
        live_conftest._restore_vbt_baseline()
        planted = sys.modules.get("vectorbt")
        assert planted is None or getattr(planted, "__file__", None) is not None, (
            "a bare ModuleType stub survived the restore"
        )

    def test_7c_NEGATIVE_CONTROL_a_REAL_looking_module_is_PRESERVED(self, live_conftest):
        """🛑 THE CONTROL THAT STOPS THIS BECOMING A SLEDGEHAMMER. Evicting a genuinely imported
        vectorbt would force a full re-import and JIT warm-up on the next test that needs it —
        paying a real cost to fix an imaginary problem. Only stubs may be evicted.
        `A GUARD THAT REMOVES EVERYTHING CANNOT TELL YOU IT REMOVED THE RIGHT THING.`"""
        baseline_had_vbt = "vectorbt" in (live_conftest._VBT_BASELINE or {})
        real_shaped = types.ModuleType("vectorbt")
        real_shaped.__file__ = "C:/fake/site-packages/vectorbt/__init__.py"
        sys.modules["vectorbt"] = real_shaped
        live_conftest._restore_vbt_baseline()
        if baseline_had_vbt:
            # A baseline entry exists, so the guard correctly restores THAT object.
            assert sys.modules.get("vectorbt") is live_conftest._VBT_BASELINE["vectorbt"]
        else:
            assert sys.modules.get("vectorbt") is real_shaped, (
                "the guard evicted a module that looks genuine — it cannot discriminate stubs"
            )
            del sys.modules["vectorbt"]

    def test_8_the_fake_detector_discriminates_both_ways(self, live_conftest):
        assert live_conftest._is_fake_module(MagicMock()) is True
        assert live_conftest._is_fake_module(types.ModuleType("x")) is True
        m = types.ModuleType("y")
        m.__file__ = "/somewhere/y.py"
        assert live_conftest._is_fake_module(m) is False

    def test_9_the_opt_in_mock_mechanism_is_still_reachable(self, live_conftest):
        """AR-1101 §3.6 — intentional mocking must survive. The guard steps aside for
        `TF_MOCK_VBT=1` rather than fighting it."""
        assert hasattr(live_conftest, "mock_vectorbt_session"), (
            "the central opt-in vectorbt mock fixture was removed"
        )


class TestNoProductionDiff:
    """AR-1101 §3.8 — this unit is pytest instrumentation, not trading behaviour."""

    def test_the_guard_lives_in_conftest_not_in_the_engine(self):
        bt_src = (REPO / "src/engine/backtester.py").read_text(encoding="utf-8", errors="replace")
        assert "_restore_vbt_baseline" not in bt_src, (
            "the isolation guard leaked into production code — AR-1101 §2.5 forbids putting this "
            "check into run_class_backtest; it is pytest isolation, not trading behaviour"
        )
