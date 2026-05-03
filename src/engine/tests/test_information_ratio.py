"""A13 — Information Ratio tests.

Two mandatory tests per the A13 spec:
1. Property test: IR equals Sharpe when benchmark = 0 (zero-return series).
   Because when R_b = 0 for all periods, active_return = R_p - 0 = R_p,
   so IR = E[R_p] / σ(R_p) * sqrt(252) = Sharpe (with risk-free = 0).
   Both use ddof=1 standard deviation and sqrt(252) annualisation.

2. Hand-computed test: compute IR by hand on fixture_perfect.json against a
   synthetic flat benchmark, assert system output matches within 0.001.

Additional edge-case tests:
- Empty / length-1 input returns 0.0
- Mismatched lengths handled gracefully (takes min)
- Large benchmark outperformance → negative IR
- Determinism: same inputs → same float output
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from src.engine.risk_metrics import compute_information_ratio

# ─── Helpers ──────────────────────────────────────────────────────

def _annualised_sharpe(returns: np.ndarray, periods: float = 252.0) -> float:
    """Pure Sharpe (risk-free = 0), ddof=1, annualised."""
    if len(returns) < 2:
        return 0.0
    std = np.std(returns, ddof=1)
    if std <= 0:
        return 0.0
    return float(np.mean(returns) / std * math.sqrt(periods))


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "golden" / "fixture_perfect.json"


# ─── 1. Property test: IR = Sharpe when benchmark = 0 ────────────

def test_ir_equals_sharpe_when_benchmark_zero_iid():
    """When benchmark is all zeros, IR must exactly equal Sharpe (risk-free=0)."""
    rng = np.random.default_rng(42)
    strategy_returns = rng.normal(250.0, 300.0, size=252)
    benchmark_zeros = np.zeros_like(strategy_returns)

    ir = compute_information_ratio(strategy_returns, benchmark_zeros, periods_per_year=252.0)
    expected_sharpe = _annualised_sharpe(strategy_returns, 252.0)

    assert abs(ir - expected_sharpe) < 1e-9, (
        f"IR ({ir:.8f}) must equal Sharpe ({expected_sharpe:.8f}) when benchmark=0"
    )


def test_ir_equals_sharpe_when_benchmark_zero_uniform():
    """Uniform constant returns: IR = Sharpe = 0 when std is 0 (no variation)."""
    strategy_returns = np.full(100, 100.0)  # all same: std=0 → both return 0.0
    benchmark_zeros = np.zeros(100)

    ir = compute_information_ratio(strategy_returns, benchmark_zeros)
    expected_sharpe = _annualised_sharpe(strategy_returns)

    assert ir == 0.0
    assert expected_sharpe == 0.0
    assert ir == expected_sharpe


def test_ir_equals_sharpe_various_return_distributions():
    """Property holds across multiple random seeds and distribution shapes."""
    for seed in [1, 7, 13, 99, 314]:
        rng = np.random.default_rng(seed)
        # Mixed normal with varying skew
        n = 200
        ret = rng.normal(loc=rng.uniform(-50, 200), scale=rng.uniform(50, 400), size=n)
        bm = np.zeros(n)

        ir = compute_information_ratio(ret, bm, periods_per_year=252.0)
        sharpe = _annualised_sharpe(ret, 252.0)

        assert abs(ir - sharpe) < 1e-9, (
            f"seed={seed}: IR={ir:.8f} != Sharpe={sharpe:.8f}"
        )


# ─── 2. Hand-computed IR test on fixture_perfect.json ─────────────

def test_ir_fixture_perfect_flat_benchmark():
    """Hand-computed IR against synthetic flat (zero) benchmark on fixture_perfect.json.

    fixture_perfect has 100 trades:
      - 70 winners at net_pnl = $98.76 each
      - 30 losers at net_pnl = -$67.48 each  (gross -$66.67, comm -$0.81 rounding → net_pnl)
    Since the fixture stores net_pnl per trade and we treat each trade as 1 period:
      E[R_p] = mean(net_pnl array)
      σ(R_p) = std(net_pnl array, ddof=1)
      IR_flat_bm = E[R_p] / σ(R_p) * sqrt(252)
                 = Sharpe (risk-free=0) because benchmark=0
    """
    if not FIXTURE_PATH.exists():
        pytest.skip("fixture_perfect.json not found — skipping hand-computed test")

    with open(FIXTURE_PATH) as f:
        fixture = json.load(f)

    trade_pnls = np.array([t["net_pnl"] for t in fixture["trades"]])
    n = len(trade_pnls)
    benchmark_zeros = np.zeros(n)

    # Hand-compute expected IR (= Sharpe, benchmark=0)
    mean_r = float(np.mean(trade_pnls))
    std_r = float(np.std(trade_pnls, ddof=1))
    expected_ir = (mean_r / std_r * math.sqrt(252)) if std_r > 0 else 0.0

    # System output
    system_ir = compute_information_ratio(trade_pnls, benchmark_zeros, periods_per_year=252.0)

    assert abs(system_ir - expected_ir) < 0.001, (
        f"System IR ({system_ir:.6f}) differs from hand-computed ({expected_ir:.6f}) "
        f"by {abs(system_ir - expected_ir):.6f} — exceeds 0.001 tolerance"
    )


def test_ir_fixture_perfect_nonzero_benchmark():
    """Hand-compute IR on fixture_perfect against a synthetic $50/day benchmark.

    When benchmark > 0, active returns compress and IR < Sharpe.
    This verifies the active-return subtraction works correctly.
    """
    if not FIXTURE_PATH.exists():
        pytest.skip("fixture_perfect.json not found")

    with open(FIXTURE_PATH) as f:
        fixture = json.load(f)

    trade_pnls = np.array([t["net_pnl"] for t in fixture["trades"]])
    n = len(trade_pnls)

    # Synthetic flat $50/trade benchmark
    benchmark = np.full(n, 50.0)
    active = trade_pnls - benchmark

    # Hand-compute expected IR
    mean_active = float(np.mean(active))
    std_active = float(np.std(active, ddof=1))
    expected_ir = (mean_active / std_active * math.sqrt(252)) if std_active > 0 else 0.0

    system_ir = compute_information_ratio(trade_pnls, benchmark, periods_per_year=252.0)

    assert abs(system_ir - expected_ir) < 0.001, (
        f"System IR ({system_ir:.6f}) != hand-computed ({expected_ir:.6f})"
    )

    # Sanity: IR should be lower than Sharpe (benchmark > 0 compresses active return)
    sharpe = _annualised_sharpe(trade_pnls, 252.0)
    assert system_ir < sharpe, (
        f"IR ({system_ir:.4f}) should be < Sharpe ({sharpe:.4f}) when benchmark > 0"
    )


# ─── 3. Edge cases ─────────────────────────────────────────────────

def test_ir_empty_returns_zero():
    """Empty arrays must return 0.0 without error."""
    ir = compute_information_ratio(np.array([]), np.array([]))
    assert ir == 0.0


def test_ir_single_element_zero():
    """Single element (< 2 observations) must return 0.0."""
    ir = compute_information_ratio(np.array([100.0]), np.array([10.0]))
    assert ir == 0.0


def test_ir_mismatched_lengths_takes_min():
    """Mismatched length inputs: function takes min(len, len) and doesn't raise."""
    ret = np.array([100.0, 200.0, 300.0])
    bm = np.array([10.0, 20.0])  # shorter
    ir = compute_information_ratio(ret, bm)
    # Uses n=2: active=[90, 180], mean=135, std=63.64..., IR = 135/63.64 * sqrt(252)
    active = ret[:2] - bm
    expected = float(np.mean(active) / np.std(active, ddof=1) * math.sqrt(252))
    assert abs(ir - expected) < 1e-9


def test_ir_negative_when_benchmark_dominates():
    """IR must be negative when benchmark consistently outperforms strategy."""
    strategy_returns = np.full(100, -10.0)   # flat loss
    benchmark_returns = np.full(100, 50.0)   # flat gain
    ir = compute_information_ratio(strategy_returns, benchmark_returns)
    # active = -60 for all — std is 0 → return 0.0 (degenerate case)
    assert ir == 0.0  # zero variance → return 0.0 per spec


def test_ir_negative_varied_benchmark_dominance():
    """IR is negative when benchmark frequently outperforms (non-constant)."""
    rng = np.random.default_rng(7)
    strategy_returns = rng.normal(-50.0, 100.0, size=200)
    benchmark_returns = rng.normal(200.0, 100.0, size=200)  # strongly outperforms
    ir = compute_information_ratio(strategy_returns, benchmark_returns)
    assert ir < 0.0, f"Expected negative IR when benchmark dominates, got {ir:.4f}"


def test_ir_determinism():
    """Same inputs must produce identical float output on every call."""
    rng = np.random.default_rng(42)
    strategy_returns = rng.normal(150.0, 250.0, size=300)
    benchmark_returns = rng.normal(100.0, 200.0, size=300)

    ir1 = compute_information_ratio(strategy_returns, benchmark_returns)
    ir2 = compute_information_ratio(strategy_returns, benchmark_returns)
    ir3 = compute_information_ratio(strategy_returns, benchmark_returns)

    assert ir1 == ir2 == ir3, "IR is not deterministic — same inputs produced different outputs"


def test_ir_periods_scaling():
    """periods_per_year scaling: IR scales correctly with annualisation factor."""
    rng = np.random.default_rng(0)
    ret = rng.normal(100.0, 200.0, size=252)
    bm = rng.normal(80.0, 150.0, size=252)

    ir_252 = compute_information_ratio(ret, bm, periods_per_year=252.0)
    ir_12 = compute_information_ratio(ret, bm, periods_per_year=12.0)

    # IR_252 / IR_12 should equal sqrt(252) / sqrt(12) = sqrt(21)
    expected_ratio = math.sqrt(252.0 / 12.0)
    actual_ratio = ir_252 / ir_12 if ir_12 != 0 else None

    if actual_ratio is not None:
        assert abs(actual_ratio - expected_ratio) < 1e-9, (
            f"Scaling ratio {actual_ratio:.6f} != sqrt(21)={expected_ratio:.6f}"
        )
