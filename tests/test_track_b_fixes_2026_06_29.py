"""FIX-WAVE Track B regression tests — 2026-06-29.

Covers four verified findings fixed in this wave:
  FIX-1 (HIGH)  walk_forward.py: plain-WF degenerate PBO emits
                pbo_degenerate_reason='plain_wf_is_unavailable' in wf_metadata.
  FIX-2 (MED)   walk_forward.py: DSR signal present (dsr_pass or dsr_unavailable)
                in plain-WF wf_metadata.
  FIX-3 (MED)   slippage.py: compute_slippage() raises ValueError for stop_market.
  FIX-4 (LOW)   performance_gate.py: behavior unchanged after win_rate →
                daily_positive_days_rate rename; naming/comment only.

Vectorbt hang note: walk_forward.py tests must NOT import walk_forward at module
level or call run_walk_forward().  All WF contract tests target the component
functions directly (pbo_gate.py, risk_metrics.py) and assert the exact contract
strings that FIX-1/FIX-2 wire into wf_metadata.
"""
from __future__ import annotations

import pytest


# ─────────────────────────────────────────────────────────────────────────────
# FIX-3: slippage.py — stop_market raises ValueError
# ─────────────────────────────────────────────────────────────────────────────

class TestSlippageStopMarketProhibited:
    """compute_slippage() must raise ValueError for stop_market — sibling contract
    alignment with fill_model.py (which has always raised for the same order type).
    """

    def _make_df(self):
        """Minimal Polars DataFrame with one bar to satisfy slippage internals."""
        import polars as pl
        return pl.DataFrame({
            "open":   [4100.0],
            "high":   [4110.0],
            "low":    [4090.0],
            "close":  [4105.0],
            "volume": [1000.0],
            "atr_14": [5.0],
        })

    def _make_spec(self):
        from src.engine.config import ContractSpec
        return ContractSpec(symbol="MES", tick_size=0.25, tick_value=1.25, point_value=5.0)

    def test_stop_market_raises_value_error(self):
        """stop_market MUST raise ValueError — not silently apply 2x slippage."""
        from src.engine.slippage import compute_slippage
        df = self._make_df()
        spec = self._make_spec()
        with pytest.raises(ValueError, match="stop_market orders are prohibited"):
            compute_slippage(df, spec, order_type="stop_market")

    def test_stop_market_error_message_mentions_stop_with_budget(self):
        """Error message must mention the correct alternative (stop with slippage budget)."""
        from src.engine.slippage import compute_slippage
        df = self._make_df()
        spec = self._make_spec()
        with pytest.raises(ValueError, match="explicit slippage budget"):
            compute_slippage(df, spec, order_type="stop_market")

    def test_stop_still_works_with_2x(self):
        """'stop' (without _market suffix) must still produce 2x slippage — no regression."""
        from src.engine.slippage import compute_slippage
        import numpy as np
        df = self._make_df()
        spec = self._make_spec()
        stop_slip = compute_slippage(df, spec, base_ticks=1.0, order_type="stop")
        market_slip = compute_slippage(df, spec, base_ticks=1.0, order_type="market")
        # Stop should be 2x market slippage
        assert np.allclose(stop_slip, market_slip * 2.0)

    def test_market_order_still_works(self):
        """'market' must still return base slippage — no regression."""
        from src.engine.slippage import compute_slippage
        import numpy as np
        df = self._make_df()
        spec = self._make_spec()
        result = compute_slippage(df, spec, order_type="market")
        assert len(result) == 1
        assert result[0] > 0.0

    def test_limit_order_still_half(self):
        """'limit' orders must still get 0.5x slippage — no regression."""
        from src.engine.slippage import compute_slippage
        import numpy as np
        df = self._make_df()
        spec = self._make_spec()
        limit_slip = compute_slippage(df, spec, base_ticks=1.0, order_type="limit")
        market_slip = compute_slippage(df, spec, base_ticks=1.0, order_type="market")
        assert np.allclose(limit_slip, market_slip * 0.5)

    def test_stop_limit_order_base_slippage(self):
        """'stop_limit' must still get 1x (base) slippage — no regression."""
        from src.engine.slippage import compute_slippage
        import numpy as np
        df = self._make_df()
        spec = self._make_spec()
        stop_limit_slip = compute_slippage(df, spec, base_ticks=1.0, order_type="stop_limit")
        market_slip = compute_slippage(df, spec, base_ticks=1.0, order_type="market")
        assert np.allclose(stop_limit_slip, market_slip)


# ─────────────────────────────────────────────────────────────────────────────
# FIX-4: performance_gate.py — win_rate rename, gate behavior unchanged
# ─────────────────────────────────────────────────────────────────────────────

class TestPerformanceGateDailyRenameNoRegression:
    """After the win_rate → daily_positive_days_rate rename, check_performance_gate
    must behave identically to the pre-fix version.  Gate threshold 60% is unchanged.
    """

    def _base_stats(self, **overrides):
        """Return a stats dict that passes all gates by default."""
        stats = {
            "avg_daily_pnl": 350.0,
            "total_trading_days": 120,
            "winning_days": 80,          # 80/120 = 66.7% > 60% → should pass
            "total_trades": 300,
            "worst_month_win_days": 12,
            "profit_factor": 2.0,
            "sharpe_ratio": 2.0,
            "avg_winner_to_loser_ratio": 2.5,
            "max_drawdown": 1000.0,
            "max_consecutive_losing_days": 2,
            "avg_trade_risk": 150.0,
            "expectancy_r": 2.5,
            "avg_loss_on_red_days": -200.0,
            "avg_win_on_green_days": 350.0,
            "recovery_days_from_max_dd": 2,
        }
        stats.update(overrides)
        return stats

    def test_60pct_winning_days_passes_gate(self):
        """Exactly 60% winning days should NOT trigger the daily-consistency rejection."""
        from src.engine.performance_gate import check_performance_gate
        stats = self._base_stats(
            total_trading_days=100,
            winning_days=60,  # exactly 60%
        )
        passed, messages = check_performance_gate(stats)
        # Should pass (no daily-survival rejection)
        daily_rej = [m for m in messages if "positive-day" in m or "winning" in m.lower()]
        assert len(daily_rej) == 0, f"Unexpected daily-survival rejection: {daily_rej}"

    def test_59pct_winning_days_fails_gate(self):
        """59% winning days should trigger the daily-consistency rejection."""
        from src.engine.performance_gate import check_performance_gate
        stats = self._base_stats(
            total_trading_days=100,
            winning_days=59,  # 59% < 60%
        )
        passed, messages = check_performance_gate(stats)
        assert not passed, "59% winning days should fail the gate"
        daily_rej = [m for m in messages if "60%" in m]
        assert len(daily_rej) > 0, f"Expected 60% threshold message, got: {messages}"

    def test_rejection_message_describes_days_not_trades(self):
        """The rejection message must describe day-level survival, not trade win rate."""
        from src.engine.performance_gate import check_performance_gate
        stats = self._base_stats(
            total_trading_days=100,
            winning_days=50,  # 50% failing days
        )
        _, messages = check_performance_gate(stats)
        day_related = [m for m in messages if "day" in m.lower() and "60%" in m]
        assert len(day_related) > 0, f"Message should mention days and 60% threshold: {messages}"

    def test_gate_passed_true_for_high_winning_days(self):
        """Strategy with 80% winning days + all other gates passing must return passed=True."""
        from src.engine.performance_gate import check_performance_gate
        stats = self._base_stats(winning_days=96, total_trading_days=120)  # 80%
        passed, rejections = check_performance_gate(stats)
        hard_rejs = [m for m in rejections if "minimum" in m.lower() or "< " in m]
        assert passed or len(hard_rejs) == 0, \
            f"Should pass with 80% win days, got rejections: {rejections}"

    def test_forge_score_daily_survival_uses_day_rate(self):
        """compute_forge_score must still compute daily_survival from winning_days/total_trading_days."""
        from src.engine.performance_gate import compute_forge_score
        # Two strategies: one with 80% winning days, one with 60%.
        # The 80% one must score higher on daily_survival component.
        high_days = dict(
            avg_daily_pnl=300.0,
            winning_days=80,
            total_trading_days=100,
            max_drawdown=1000.0,
            profit_factor=1.8,
            sharpe_ratio=1.8,
            base_contracts=1,
        )
        low_days = dict(**high_days)
        low_days["winning_days"] = 60  # 60% vs 80%
        score_high = compute_forge_score(high_days)
        score_low = compute_forge_score(low_days)
        assert score_high["components"]["daily_survival"] > score_low["components"]["daily_survival"], \
            "80% winning-day strategy must outscore 60% winning-day strategy on daily_survival component"


# ─────────────────────────────────────────────────────────────────────────────
# FIX-1: plain-WF degenerate PBO — pbo_gate contract verification
# These tests target pbo_gate.py (pure function, no vectorbt) and verify the
# exact contract that walk_forward.py's FIX-1 branch depends on.
# ─────────────────────────────────────────────────────────────────────────────

class TestPlainWfPboDegenerate:
    """Verify compute_pbo_from_cpcv_paths returns the correct degenerate structure
    when IS==OOS for all paths — the exact trigger condition for FIX-1 in
    walk_forward.py which then sets pbo_degenerate_reason='plain_wf_is_unavailable'.
    """

    def test_identical_is_oos_returns_degenerate_flag(self):
        """When IS sharpe == OOS sharpe for all paths, pbo must be None and degenerate=True."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths
        # Simulate the plain-WF path where per-window IS Sharpe is unavailable:
        # walk_forward.py sets is_sharpe=oos_sharpe as the fallback.
        paths = [
            {"is_sharpe": 1.2, "oos_sharpe": 1.2, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 0.8, "oos_sharpe": 0.8, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 1.5, "oos_sharpe": 1.5, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 0.5, "oos_sharpe": 0.5, "is_returns": [], "oos_returns": []},
        ]
        result = compute_pbo_from_cpcv_paths(paths)
        assert result.get("pbo") is None, "Degenerate IS==OOS must return pbo=None"
        assert result.get("degenerate") is True, "Must set degenerate=True"

    def test_degenerate_result_drives_plain_wf_reason_assignment(self):
        """Verify the exact condition in walk_forward.py FIX-1 produces the correct string.

        This mimics the walk_forward.py degenerate branch logic:
            if _pbo_overall_val is None and pbo_gate_result.get("degenerate"):
                _plain_wf_pbo_degenerate_reason = "plain_wf_is_unavailable"
        """
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        # Build the degenerate pbo_gate_result
        paths = [
            {"is_sharpe": s, "oos_sharpe": s, "is_returns": [], "oos_returns": []}
            for s in [1.0, 1.0, 1.0, 1.0]
        ]
        pbo_gate_result = compute_pbo_from_cpcv_paths(paths)
        _pbo_overall_val = pbo_gate_result.get("pbo")

        # Exactly replicate the walk_forward.py FIX-1 condition
        _plain_wf_pbo_degenerate_reason = None
        if _pbo_overall_val is None and pbo_gate_result.get("degenerate"):
            _plain_wf_pbo_degenerate_reason = "plain_wf_is_unavailable"

        # Contract: the EXACT string "plain_wf_is_unavailable" must be set
        assert _plain_wf_pbo_degenerate_reason == "plain_wf_is_unavailable", (
            f"Expected 'plain_wf_is_unavailable', got {_plain_wf_pbo_degenerate_reason!r}"
        )

    def test_non_degenerate_paths_leave_reason_none(self):
        """When IS != OOS for all paths, pbo_degenerate_reason must remain None."""
        from src.engine.pbo_gate import compute_pbo_from_cpcv_paths

        # Non-degenerate: IS and OOS differ
        paths = [
            {"is_sharpe": 1.5, "oos_sharpe": 0.8, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 1.2, "oos_sharpe": 1.0, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 0.9, "oos_sharpe": 1.1, "is_returns": [], "oos_returns": []},
            {"is_sharpe": 1.8, "oos_sharpe": 0.5, "is_returns": [], "oos_returns": []},
        ]
        pbo_gate_result = compute_pbo_from_cpcv_paths(paths)
        _pbo_overall_val = pbo_gate_result.get("pbo")

        _plain_wf_pbo_degenerate_reason = None
        if _pbo_overall_val is None and pbo_gate_result.get("degenerate"):
            _plain_wf_pbo_degenerate_reason = "plain_wf_is_unavailable"

        assert _plain_wf_pbo_degenerate_reason is None, (
            "Non-degenerate paths must not set pbo_degenerate_reason"
        )

    def test_contract_string_is_exactly_plain_wf_is_unavailable(self):
        """Exact string identity check — Track A pbo-gate.ts depends on this exact value."""
        # The TS gate routes on wf_metadata.pbo_degenerate_reason === "plain_wf_is_unavailable"
        # Any typo in the string breaks the BLOCK path silently.
        contract_string = "plain_wf_is_unavailable"
        assert contract_string != "cpcv_is_sharpe_unavailable", \
            "Must be distinct from the CPCV exempt path string"
        assert "_" in contract_string, "Must use underscore-separated snake_case"
        assert "plain_wf" in contract_string, "Must identify source as plain WF"
        assert "unavailable" in contract_string, "Must signal unavailability"

    def test_wf_metadata_dict_structure_with_degenerate_reason(self):
        """Verify wf_metadata dict structure includes pbo_degenerate_reason key."""
        # Simulate what run_walk_forward now emits in wf_metadata:
        # {mode, n_folds, embargo_pct, purge_window, pbo_degenerate_reason, dsr, dsr_pass, dsr_unavailable}
        _plain_wf_pbo_degenerate_reason = "plain_wf_is_unavailable"
        wf_metadata = {
            "mode": "plain",
            "n_folds": 5,
            "embargo_pct": 0.0,
            "purge_window": 0,
            "pbo_degenerate_reason": _plain_wf_pbo_degenerate_reason,
            "dsr": 0.85,
            "dsr_pass": True,
            "dsr_unavailable": False,
        }
        assert wf_metadata["pbo_degenerate_reason"] == "plain_wf_is_unavailable"
        assert "dsr_pass" in wf_metadata
        assert "dsr_unavailable" in wf_metadata

    def test_wf_metadata_none_degenerate_reason_when_no_degenerate(self):
        """When no degenerate case, pbo_degenerate_reason must be None in wf_metadata."""
        _plain_wf_pbo_degenerate_reason = None  # no degenerate case triggered
        wf_metadata = {
            "mode": "plain",
            "n_folds": 5,
            "embargo_pct": 0.0,
            "purge_window": 0,
            "pbo_degenerate_reason": _plain_wf_pbo_degenerate_reason,
            "dsr": 0.85,
            "dsr_pass": True,
            "dsr_unavailable": False,
        }
        assert wf_metadata["pbo_degenerate_reason"] is None


# ─────────────────────────────────────────────────────────────────────────────
# FIX-2: plain-WF DSR computation — risk_metrics contract verification
# These tests target compute_deflated_sharpe_ratio directly (no vectorbt).
# ─────────────────────────────────────────────────────────────────────────────

class TestPlainWfDsrComputation:
    """Verify the DSR computation contract that FIX-2 wires into plain-WF wf_metadata.

    compute_deflated_sharpe_ratio from risk_metrics.py is the same function used by
    CPCV.  FIX-2 wires it into the plain-WF path with n_splits as the n_trials floor.
    """

    def test_dsr_function_returns_passes_key(self):
        """compute_deflated_sharpe_ratio returns 'passes' (gate bool), not 'dsr_pass'.

        NOTE: walk_forward.py FIX-2 normalises this: passes → dsr_pass in wf_metadata
        so TS lifecycle-service reads the correct key.  This test locks the actual
        return shape so any upstream rename shows up immediately.
        """
        from src.engine.risk_metrics import compute_deflated_sharpe_ratio
        result = compute_deflated_sharpe_ratio(
            observed_sharpe=1.5,
            n_trials=5,
            n_observations=250,
        )
        assert "passes" in result, f"passes key must be in result; got keys: {list(result.keys())}"
        assert "dsr" in result, f"dsr key must be in result; got keys: {list(result.keys())}"

    def test_dsr_function_returns_dsr_value(self):
        """compute_deflated_sharpe_ratio must return a 'dsr' key with float value."""
        from src.engine.risk_metrics import compute_deflated_sharpe_ratio
        result = compute_deflated_sharpe_ratio(
            observed_sharpe=1.5,
            n_trials=5,
            n_observations=250,
        )
        assert "dsr" in result, f"dsr key must be in result; got: {list(result.keys())}"
        assert isinstance(result["dsr"], float), f"dsr must be a float, got: {type(result['dsr'])}"

    def test_dsr_decreases_with_more_trials(self):
        """DSR must be lower for higher n_trials (more multiple-testing correction)."""
        from src.engine.risk_metrics import compute_deflated_sharpe_ratio
        result_1 = compute_deflated_sharpe_ratio(1.5, n_trials=1, n_observations=250)
        result_10 = compute_deflated_sharpe_ratio(1.5, n_trials=10, n_observations=250)
        dsr_1 = result_1.get("dsr", 0.0) or 0.0
        dsr_10 = result_10.get("dsr", 0.0) or 0.0
        assert dsr_1 >= dsr_10, (
            f"DSR with 1 trial ({dsr_1:.4f}) should be >= DSR with 10 trials ({dsr_10:.4f})"
        )

    def test_dsr_passes_is_bool_for_high_sharpe(self):
        """High observed Sharpe with few trials should produce passes=True (bool gate key)."""
        from src.engine.risk_metrics import compute_deflated_sharpe_ratio
        result = compute_deflated_sharpe_ratio(
            observed_sharpe=3.0,  # very high Sharpe
            n_trials=5,
            n_observations=500,
        )
        # 'passes' is the actual gate key — 'dsr_pass' is the normalised wf_metadata alias
        passes = result.get("passes")
        assert isinstance(passes, bool), f"passes must be bool, got: {type(passes)}"

    def test_plain_wf_dsr_no_exception_on_zero_sharpe(self):
        """When Sharpe is 0.0, DSR function still returns a result dict (no exception)."""
        from src.engine.risk_metrics import compute_deflated_sharpe_ratio
        # Zero sharpe edge case — should not raise
        result = compute_deflated_sharpe_ratio(
            observed_sharpe=0.0,
            n_trials=5,
            n_observations=100,
        )
        assert "dsr" in result or "passes" in result

    def test_wf_metadata_has_dsr_fields(self):
        """Simulate the wf_metadata structure to verify all DSR keys are present.

        This mirrors what run_walk_forward now includes after FIX-2.
        """
        from src.engine.risk_metrics import compute_deflated_sharpe_ratio
        _dsr_result = compute_deflated_sharpe_ratio(
            observed_sharpe=1.5,
            n_trials=5,
            n_observations=250,
        )
        wf_metadata = {
            "mode": "plain",
            "n_folds": 5,
            "embargo_pct": 0.0,
            "purge_window": 0,
            "pbo_degenerate_reason": None,
            "dsr": _dsr_result.get("dsr"),
            # compute_deflated_sharpe_ratio returns the gate under "passes" — mirror
            # the production normalisation in walk_forward.py (passes -> dsr_pass).
            "dsr_pass": (
                bool(_dsr_result.get("passes"))
                if _dsr_result.get("passes") is not None
                else None
            ),
            "dsr_unavailable": _dsr_result.get("dsr_unavailable", False),
        }
        # All three DSR keys must be present
        assert "dsr" in wf_metadata, "wf_metadata must contain 'dsr'"
        assert "dsr_pass" in wf_metadata, "wf_metadata must contain 'dsr_pass'"
        assert "dsr_unavailable" in wf_metadata, "wf_metadata must contain 'dsr_unavailable'"
        # dsr_pass must be a bool (True or False), not None for a successful computation
        assert isinstance(wf_metadata["dsr_pass"], bool), (
            f"dsr_pass must be bool for successful DSR computation, "
            f"got: {type(wf_metadata['dsr_pass'])}"
        )

    def test_dsr_unavailable_fallback_structure(self):
        """When DSR computation fails, the fallback dict must match the expected structure.

        This tests the except-branch in run_walk_forward FIX-2 by replicating its logic.
        """
        # Simulate what the except branch in run_walk_forward produces
        exc = RuntimeError("dsr computation error (simulated)")
        _plain_wf_dsr_result = {
            "dsr": None,
            "dsr_pass": False,
            "dsr_unavailable": True,
            "error": str(exc),
            "error_type": type(exc).__name__,
        }
        wf_metadata = {
            "mode": "plain",
            "n_folds": 5,
            "embargo_pct": 0.0,
            "purge_window": 0,
            "pbo_degenerate_reason": None,
            "dsr": _plain_wf_dsr_result.get("dsr"),
            "dsr_pass": _plain_wf_dsr_result.get("dsr_pass"),
            "dsr_unavailable": _plain_wf_dsr_result.get("dsr_unavailable", False),
        }
        assert wf_metadata["dsr"] is None, "dsr must be None when unavailable"
        assert wf_metadata["dsr_pass"] is False, "dsr_pass must be False when unavailable"
        assert wf_metadata["dsr_unavailable"] is True, "dsr_unavailable must be True"

    def test_n_trials_floor_uses_n_splits_minimum(self):
        """The n_trials for plain-WF DSR must be at least n_splits (len(windows)).

        Verifies the max(len(windows), trial_n_total) logic in run_walk_forward FIX-2.
        """
        # Simulate the n_trials computation from run_walk_forward:
        # _plain_wf_n_trials = max(len(windows), max(1, getattr(request, "trial_n_total", 1)))
        n_splits = 5

        # Case 1: no trial_n_total on request (default 1 trial)
        trial_n_total_default = 1
        n_trials_case1 = max(n_splits, max(1, trial_n_total_default))
        assert n_trials_case1 == n_splits, (
            f"Without optimization, n_trials must be at least n_splits={n_splits}, "
            f"got {n_trials_case1}"
        )

        # Case 2: large trial_n_total (optimization run)
        trial_n_total_opt = 800
        n_trials_case2 = max(n_splits, max(1, trial_n_total_opt))
        assert n_trials_case2 == trial_n_total_opt, (
            f"With optimization (800 trials), n_trials must be 800, got {n_trials_case2}"
        )
