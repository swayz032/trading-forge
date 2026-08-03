"""Committed guards for the crisis fail-closed class (R-639 §6.2, members 1+2).

CLASS PROPERTY: a crisis evaluation that did not happen, or that was compared
against the wrong limit, must never score as clean.

These tests exist because R-639 §1 (finding F-G1) convicted the previous repair
for having NO PATH TO RED: it was verified by a throwaway scratch probe and
landed no test that would notice its removal. `AN ARM IS A MEASUREMENT; A TEST
IS A GUARD.`

NOTE: these tests import backtester.py, which loads vectorbt — expect a slow
first import (~60-90s), consistent with the other backtester-importing suites in
this directory.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from src.engine.backtester import (
    _rescore_with_crisis,
    _unevaluated_crisis_sentinel,
)


def _passing_result() -> dict:
    """A result that scores well ABOVE zero when no veto fires."""
    return {
        "avg_daily_pnl": 600.0,
        "winning_days": 56,
        "total_trading_days": 75,
        "max_drawdown": 1200.0,
        "sharpe_ratio": 2.5,
        "profit_factor": 3.0,
    }


def _crisis_with_dd(dd: float) -> dict:
    return {
        "passed": True,
        "scenarios": [{"name": "gfc_2008", "passed": True, "max_drawdown": dd}],
    }


class TestMember1FirmMaxDdThreading:
    """F-1b: the gate must compare against the FIRM'S limit, not the default."""

    def test_rescore_threads_configured_firm_max_dd(self):
        """The R-639 §2 row: cfg $1500 / scenario $1800 must VETO.

        Before this fix the rescore call passed no firm_max_dd, so the veto ran
        against compute_forge_score's 2000.0 signature default while the stress
        test had already failed the scenario against the firm's real $1500
        limit. The stress test said FAIL and the gate said PASS with score 17.7.

        RED-PROOF: delete `firm_max_dd=...` from _rescore_with_crisis() and this
        test fails (no veto, score > 0).
        """
        result = _passing_result()
        components = _rescore_with_crisis(
            result, _crisis_with_dd(1800.0), {"prop_firm_max_dd": 1500.0}
        )
        assert components["crisis_veto"] is True, (
            "a $1800 crisis drawdown under a $1500 firm limit did not veto — the "
            "gate is comparing against a different number than the stress test"
        )
        assert result["forge_score"] == 0.0
        assert "1500" in components["crisis_veto_reason"], (
            f"the reason must quote the FIRM's limit, not the default: "
            f"{components['crisis_veto_reason']!r}"
        )

    def test_default_limit_still_applies_when_config_is_silent(self):
        """DISCRIMINATOR: the same scenario under the 2000.0 default must NOT veto.

        Without this control the test above cannot tell "reads the configured
        limit" from "vetoes everything". $1800 < $2000, so a config that does
        not set prop_firm_max_dd keeps the strategy alive.
        """
        result = _passing_result()
        components = _rescore_with_crisis(result, _crisis_with_dd(1800.0), {})
        assert components["crisis_veto"] is False, (
            f"unexpected veto under the default limit: "
            f"{components['crisis_veto_reason']!r}"
        )
        assert result["forge_score"] > 0

    def test_breach_of_the_default_limit_still_vetoes(self):
        """Regression: threading must not break the ordinary breach path."""
        result = _passing_result()
        components = _rescore_with_crisis(result, _crisis_with_dd(3500.0), {})
        assert components["crisis_veto"] is True
        assert result["forge_score"] == 0.0
        assert "breach" in components["crisis_veto_reason"]


class TestMember2UnevaluatedSentinel:
    """F-G3: a stress run that RAISED is unevaluated, not absent."""

    def test_sentinel_shape_matches_the_crashed_scenario_contract(self):
        sentinel = _unevaluated_crisis_sentinel(RuntimeError("boom"))
        assert sentinel["passed"] is False
        assert sentinel["failed_scenarios"] == ["stress_suite"]
        scenario = sentinel["scenarios"][0]
        # The shape stress_test.py:131-139 already emits, so it lands on the
        # `"error" in s` veto arm that is already guarded.
        assert scenario["passed"] is False
        assert scenario["max_drawdown"] == 0
        assert "boom" in scenario["error"], "the sentinel must carry the real cause"

    def test_sentinel_vetoes_and_zeroes_the_score(self):
        """The point of the member: a crashed stress suite cannot score clean.

        RED-PROOF: remove the `"error"` key from the sentinel and this fails —
        the scenario's max_drawdown of 0 is not a breach, so `error` is the only
        thing that convicts it.
        """
        result = _passing_result()
        sentinel = _unevaluated_crisis_sentinel(RuntimeError("stress run failed"))
        components = _rescore_with_crisis(result, sentinel, {})
        assert components["crisis_veto"] is True, (
            "a stress suite that raised was scored as a clean pass"
        )
        assert result["forge_score"] == 0.0
        assert "unevaluated" in components["crisis_veto_reason"]

    def test_positive_witness_the_rescore_actually_ran(self):
        """A negative assertion needs proof the path executed.

        `forge_score == 0.0` is also what an untouched result would show if the
        key were simply absent. Assert the rescore WROTE its components — that
        is the witness that the crash path reached the rescore at all, which is
        the second hop F-G3 named.
        """
        result = _passing_result()
        assert "forge_score_components" not in result
        _rescore_with_crisis(
            result, _unevaluated_crisis_sentinel(RuntimeError("x")), {}
        )
        assert "forge_score_components" in result, (
            "the rescore did not run — forge_score would have silently retained "
            "the crisis-BLIND value computed earlier in the backtest"
        )
        assert result["forge_score_components"]["crisis_veto"] is True


class TestMember2Wiring:
    """The helpers are only worth anything if the crash path calls them.

    Existence is not wiring. These assertions read the ACTUAL except handler in
    backtester.main() and fail if it reverts to `crisis_results = None` or stops
    rescoring.
    """

    @staticmethod
    def _main_except_handlers() -> list[ast.ExceptHandler]:
        src = pathlib.Path(__file__).resolve().parents[1] / "backtester.py"
        tree = ast.parse(src.read_text(encoding="utf-8"))
        main_fn = next(
            (n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main"),
            None,
        )
        assert main_fn is not None, "backtester.main() not found — test is stale"
        return [n for n in ast.walk(main_fn) if isinstance(n, ast.ExceptHandler)]

    def test_stress_crash_handler_emits_sentinel_and_rescores(self):
        handlers = self._main_except_handlers()
        assert handlers, "no except handlers found in main() — positive control failed"
        calls = {
            node.func.id
            for h in handlers
            for node in ast.walk(h)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        assert "_unevaluated_crisis_sentinel" in calls, (
            "no except handler in main() builds the unevaluated sentinel — the "
            "stress-test crash path is fail-OPEN again"
        )
        assert "_rescore_with_crisis" in calls, (
            "no except handler in main() rescores — a crashed stress test would "
            "keep the crisis-blind forge_score (F-G3 second hop)"
        )

    def test_no_except_handler_sets_crisis_results_to_none(self):
        """The exact regression: `result["crisis_results"] = None` inside a handler.

        Scoped to except handlers on purpose — the TF_STRESS_TEST_MODE=pipeline
        skip legitimately sets None outside one, and vetoing a deliberate skip
        is not what this class is about.
        """
        for h in self._main_except_handlers():
            for node in ast.walk(h):
                if not isinstance(node, ast.Assign):
                    continue
                if not (isinstance(node.value, ast.Constant) and node.value.value is None):
                    continue
                for tgt in node.targets:
                    if (
                        isinstance(tgt, ast.Subscript)
                        and isinstance(tgt.slice, ast.Constant)
                        and tgt.slice.value == "crisis_results"
                    ):
                        pytest.fail(
                            f"backtester.py:{node.lineno} sets crisis_results = None "
                            f"inside an except handler — performance_gate reads that "
                            f"as 'no crisis input' and skips the veto entirely"
                        )
