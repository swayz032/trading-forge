"""fixwave adaptive-exit-engine-safe-surface (2026-07-17) — CRIT finding:

scripts/wave25_exit_engine_ab_report.py::_run_backtest_for_strategy() never
passed `adaptive_ctx` into run_class_backtest() for the "adaptive" arm.
run_class_backtest()'s dispatch (backtester.py::_apply_trade_management)
only routes to the real adaptive exit engine (_apply_adaptive_management)
when BOTH exit_engine="adaptive" AND adaptive_ctx is not None — see
TestDispatchRouting.test_adaptive_without_ctx_falls_back_to_static in
test_apply_trade_management_branching.py. Because adaptive_ctx was never
threaded through, the "adaptive" arm silently fell back to
_apply_static_styleC_management — byte-identical logic to the "static" arm —
so the A/B regression harness that exists specifically to prove the two
exit engines diverge could never detect a real regression: it never
exercised the adaptive path at all.

Fix: _run_backtest_for_strategy() now constructs an AdaptiveExitContext and
passes it as adaptive_ctx=... to run_class_backtest() whenever
exit_engine == "adaptive" (None otherwise, preserving static arm behavior).

RED-proof: reverting the fix (dropping the adaptive_ctx=adaptive_ctx kwarg
from the run_class_backtest() call, or reverting the
`adaptive_ctx = AdaptiveExitContext(...) if exit_engine == "adaptive" else None`
line) makes test_adaptive_arm_passes_non_none_adaptive_ctx fail (captured
kwarg is None instead of an AdaptiveExitContext instance).

Run targeted:
    python -m pytest src/engine/tests/test_fixwave_ab_report_adaptive_ctx_wiring.py -v
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

# ─── Import backtester (with vectorbt mocked) so we can patch its
#     run_class_backtest attribute without triggering the real JIT-compiled
#     vectorbt module. Same pattern as test_apply_trade_management_branching.py
#     / test_fixwave_zero_runner_exit_reason.py. ────────────────────────────

def _ensure_backtester_importable():
    if "vectorbt" not in sys.modules:
        vbt_mock = types.ModuleType("vectorbt")
        vbt_mock.Portfolio = MagicMock()
        sys.modules["vectorbt"] = vbt_mock

    heavy_mocks = [
        "src.engine.nvtx_markers",
        "src.engine.decay.half_life",
        "src.engine.decay.sub_signals",
        "src.engine.prop_sim",
        "src.engine.cross_validation",
    ]
    for mod_name in heavy_mocks:
        if mod_name not in sys.modules:
            mock_mod = types.ModuleType(mod_name)
            for attr in ["range_push", "range_pop", "fit_decay",
                         "composite_decay_score", "simulate_all_firms",
                         "run_cross_validation"]:
                setattr(mock_mod, attr, MagicMock(return_value={}))
            sys.modules[mod_name] = mock_mod

    import src.engine.backtester  # noqa: F401 — ensures the module + attribute exist to patch
    return src.engine.backtester


class TestAdaptiveCtxWiredIntoAbHarness:
    """The AB report script's adaptive arm must construct + pass a real
    AdaptiveExitContext into run_class_backtest(), never leave it at the
    implicit None default that silently downgrades to static_styleC."""

    def _call_with_captured_kwargs(self, exit_engine: str) -> dict:
        _ensure_backtester_importable()

        fake_strategy_instance = MagicMock()
        fake_module = MagicMock()
        fake_module.SilverBulletStrategy = MagicMock(return_value=fake_strategy_instance)

        captured = {}

        def _fake_run_class_backtest(**kwargs):
            captured.update(kwargs)
            return {"total_return": 0.0, "sharpe_ratio": 0.0, "max_drawdown": 0.0,
                    "avg_rr": 0.0, "win_rate": 0.0, "total_trades": 0}

        # NOTE: patch order matters. unittest.mock.patch("src.engine.backtester.run_class_backtest", ...)
        # resolves its target via importlib.import_module internally — if
        # importlib.import_module is ALREADY patched when this patch is entered,
        # the target resolution itself gets redirected to fake_module and the
        # real run_class_backtest never gets replaced. Enter the
        # run_class_backtest patch FIRST (while importlib is still real), then
        # patch importlib.import_module for the strategy-class dynamic import.
        with patch("src.engine.backtester.run_class_backtest", side_effect=_fake_run_class_backtest):
            with patch("importlib.import_module", return_value=fake_module):
                from scripts.wave25_exit_engine_ab_report import _run_backtest_for_strategy

                result = _run_backtest_for_strategy(
                    "silver_bullet", exit_engine, "2025-01-01", "2025-01-07",
                )

        assert "error" not in result, f"Unexpected error in harness call: {result}"
        return captured

    def test_adaptive_arm_passes_non_none_adaptive_ctx(self):
        """THE FIX: exit_engine='adaptive' must pass a real (non-None)
        adaptive_ctx into run_class_backtest()."""
        from src.engine.config import AdaptiveExitContext

        captured = self._call_with_captured_kwargs("adaptive")

        assert "adaptive_ctx" in captured, (
            "run_class_backtest() was not called with an adaptive_ctx kwarg at all — "
            "the AB harness's adaptive arm cannot invoke the real adaptive exit engine."
        )
        assert captured["adaptive_ctx"] is not None, (
            "adaptive_ctx was passed as None for exit_engine='adaptive'. "
            "_apply_trade_management() falls back to _apply_static_styleC_management "
            "whenever adaptive_ctx is None, regardless of exit_engine — so this makes "
            "the 'adaptive' arm silently run identical logic to the 'static' arm. "
            "This is the exact CRIT bug this fixwave closes."
        )
        assert isinstance(captured["adaptive_ctx"], AdaptiveExitContext), (
            f"adaptive_ctx must be an AdaptiveExitContext instance, got "
            f"{type(captured['adaptive_ctx'])!r}"
        )
        assert captured.get("exit_engine") == "adaptive"

    def test_static_arm_unaffected_adaptive_ctx_stays_none(self):
        """Control: exit_engine='static_styleC' must NOT construct an
        adaptive_ctx — preserves pre-fix behavior for the static arm."""
        captured = self._call_with_captured_kwargs("static_styleC")

        assert captured.get("exit_engine") == "static_styleC"
        assert captured.get("adaptive_ctx") is None, (
            "The static arm must not receive a constructed adaptive_ctx — "
            "only the adaptive arm should build one."
        )
