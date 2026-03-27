"""Tests for QUBO trade timing."""
import numpy as np
import pytest
from src.engine.qubo_trade_timing import (
    discretize_session, build_timing_qubo, solve_timing,
    decode_timing_schedule, backtest_timing_schedule,
    TimingSchedule,
)


class TestQUBOTradeTiming:
    def test_discretize_rth(self):
        blocks = discretize_session("RTH")
        assert len(blocks) == 13  # 9:30-16:00 in 30-min blocks
        assert blocks[0].time_range == "09:30-10:00"

    def test_discretize_eth(self):
        blocks = discretize_session("ETH")
        assert len(blocks) == 31

    def test_build_qubo(self):
        returns = np.array([50, 30, 10, -5, -10, -15, -10, -5, 5, 15, 25, 35, 40], dtype=float)
        qubo = build_timing_qubo(returns, max_active_blocks=8)
        assert len(qubo) > 0

    def test_solve_timing_returns_bools(self):
        n = 13
        returns = np.random.default_rng(42).normal(10, 30, n)
        qubo = build_timing_qubo(returns, max_active_blocks=8)
        solution = solve_timing(qubo, n, num_reads=10, num_sweeps=100)
        assert len(solution) == n
        assert all(isinstance(s, bool) for s in solution)

    def test_decode_schedule(self):
        blocks = discretize_session("RTH")
        solution = [True, True, True, False, False, False, False, True, True, True, True, True, True]
        returns = np.random.default_rng(42).normal(10, 30, 13)
        schedule = decode_timing_schedule(solution, blocks, returns)
        assert isinstance(schedule, TimingSchedule)
        assert schedule.active_blocks + schedule.skipped_blocks == 13

    def test_backtest_schedule(self):
        blocks = discretize_session("RTH")
        solution = [True] * 8 + [False] * 5
        schedule = decode_timing_schedule(solution, blocks)
        pnls = np.random.default_rng(42).normal(20, 50, 13)
        result = backtest_timing_schedule(schedule, pnls)
        assert result.schedule_trades < result.baseline_trades
        assert result.cost_savings_pct > 0

    def test_governance_labels(self):
        blocks = discretize_session("RTH")
        solution = [True] * 13
        schedule = decode_timing_schedule(solution, blocks)
        assert schedule.governance["experimental"] is True
        assert schedule.governance["decision_role"] == "challenger_only"

    def test_risk_constraints_in_qubo(self):
        returns = np.ones(13) * 10
        qubo = build_timing_qubo(
            returns,
            risk_constraints={"max_consecutive_active": 3},
            max_active_blocks=8,
        )
        assert len(qubo) > 13  # Should have quadratic terms
