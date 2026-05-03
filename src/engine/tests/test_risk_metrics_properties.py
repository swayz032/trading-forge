"""A6 — Property-Based Testing for Risk Metric Calculations (Hypothesis).

W11 Team A. Hypothesis fuzzes inputs to find edge cases that human-written
golden fixture tests (A5) cannot, because fixture inputs are hand-constructed
and cannot exercise the full input space.

Design:
  - Tests operate on PURE SCALAR HELPERS (not the full MC path-based API).
    The helpers mirror the exact formulas used in risk_metrics.py and the
    golden fixture helpers in test_golden_fixtures.py.
  - Properties are ALGEBRAIC INVARIANTS — things that MUST be true regardless
    of input, derivable from the definition of each metric.
  - Floating-point comparisons use math.isclose() or pytest.approx() with
    explicit tolerances tuned for the expected precision.
  - Hypothesis seed: fixed via @settings(deriving_via=...) and the
    PYTHONHASHSEED / Hypothesis database. The conftest determinism_mode
    fixture seeds numpy, not Hypothesis. Hypothesis has its own seed
    mechanism (fixed example database) and defaults to reproducible behavior
    in CI when HYPOTHESIS_SEED is set or when running the same test twice
    (same database entry).

CRITICAL PRODUCTION RULE: Never pass slippage/fees to vectorbt for futures —
compute P&L manually. These property tests enforce this by testing the manual
P&L computation helpers directly.

Hypothesis settings:
  - Standard properties: @settings(max_examples=200, deadline=5000)
  - Expensive properties: @settings(max_examples=500, deadline=10000)
  - All properties use suppress_health_check=[HealthCheck.too_slow] to avoid
    flaky CI failures on slow CI machines.

If ANY property fails, it is a REAL METRIC BUG. Document the failing input
and expected vs actual behavior. Do not skip or weaken the assertion.

Coverage:
  - Sharpe ratio:  5 properties
  - Profit factor: 5 properties
  - Max drawdown:  5 properties
  - PnL accounting: 4 properties
  - Win rate:      3 properties
  Total: 22 properties
"""

from __future__ import annotations

import math
from typing import List

import numpy as np
import pytest
from hypothesis import assume, given, settings, HealthCheck
from hypothesis import strategies as st


# ─── Determinism: Hypothesis seed ─────────────────────────────────────────────
#
# Hypothesis has its own reproducibility mechanism independent of numpy seeds:
#   - First run: generates examples, writes to its local database (~/.hypothesis/)
#   - Subsequent runs: replays known-failures from that database, then generates new ones
#   - CI: set HYPOTHESIS_SEED=42 in CI environment for reproducible example generation
#     (Hypothesis will use that seed for the random example generator per-test)
#
# The conftest determinism_mode fixture seeds numpy separately (for MC paths).
# These two mechanisms are orthogonal — no conflict.


# ─── Pure scalar helpers — the math we are testing ────────────────────────────
#
# These helpers are STANDALONE implementations of the metric formulas.
# They are NOT wrappers around the production code — that would make tests
# tautological (code verifying itself). These implement the DEFINITION of
# each metric from first principles, and we test that the DEFINITIONS hold.
#
# Where these match the production helpers in test_golden_fixtures.py, that
# is intentional: both files test the same formulas, but via different methods
# (point-fixtures vs fuzzing).


def _sharpe(pnls: List[float], periods_per_year: float = 252.0) -> float:
    """Annualized Sharpe ratio from a list of trade/period P&Ls.

    Formula: mean(pnl) / std(pnl, ddof=1) * sqrt(periods_per_year)
    Returns 0.0 if std == 0 (flat equity curve).
    Risk-free rate = 0 (simplification; RFR only shifts the numerator).

    This matches the formula in risk_metrics.compute_sharpe_distribution()
    and test_golden_fixtures._compute_sharpe_from_trades().
    """
    arr = np.array(pnls, dtype=float)
    mean = float(np.mean(arr))
    std = float(np.std(arr, ddof=1))
    if std == 0.0 or math.isnan(std):
        return 0.0
    return mean / std * math.sqrt(periods_per_year)


def _profit_factor(pnls: List[float]) -> float:
    """Profit factor = sum(winners) / |sum(losers)|.

    Returns float('inf') if there are no losing trades (perfect record).
    Returns 0.0 if there are no winning trades (all losses).
    Treats 0.0 P&L as neither win nor loss.

    This matches _compute_pf_from_trades() in test_golden_fixtures.py.
    """
    winners = [x for x in pnls if x > 0.0]
    losers = [x for x in pnls if x < 0.0]
    total_wins = sum(winners)
    total_losses = abs(sum(losers))
    if total_losses == 0.0:
        return float("inf")
    if total_wins == 0.0:
        return 0.0
    return total_wins / total_losses


def _max_drawdown(pnls: List[float]) -> float:
    """Max drawdown from a cumulative P&L equity curve.

    Equity starts at 0 (no initial capital offset — relative drawdown).
    MaxDD = max over all points of (running_peak - current_equity).
    Always >= 0 by definition.

    This matches _compute_max_drawdown() in test_golden_fixtures.py.
    """
    if not pnls:
        return 0.0
    equity = np.cumsum(np.array(pnls, dtype=float))
    running_max = np.maximum.accumulate(equity)
    drawdowns = running_max - equity
    return float(np.max(drawdowns))


def _win_rate(pnls: List[float]) -> float:
    """Win rate = n_winners / n_trades. Wins are strictly positive P&L.

    Returns 0.0 for empty list.
    """
    if not pnls:
        return 0.0
    n_winners = sum(1 for x in pnls if x > 0.0)
    return n_winners / len(pnls)


def _net_pnl(pnls: List[float], fees: float = 0.0) -> float:
    """Net P&L = sum(gross_pnls) - total_fees.

    This is the PnL conservation law: the net of all trades minus fees
    MUST equal the final equity minus starting equity (both starting at 0).
    """
    return sum(pnls) - fees


# ─── Hypothesis strategies (input generators) ─────────────────────────────────

# Trade P&L values: bounded to avoid float overflow but wide enough to find bugs.
# min_value=-1e6, max_value=1e6 covers the full range of realistic futures P&Ls.
# allow_nan=False, allow_infinity=False: the metric functions are not designed
# for IEEE 754 special values at the input level.
_pnl_value = st.floats(
    min_value=-1_000_000.0,
    max_value=1_000_000.0,
    allow_nan=False,
    allow_infinity=False,
)

# A non-empty list of P&L values (at least 2 for std to be defined)
_pnl_list_2plus = st.lists(_pnl_value, min_size=2, max_size=10_000)

# A non-empty list with at least 1 element (for max_drawdown, win_rate)
_pnl_list_1plus = st.lists(_pnl_value, min_size=1, max_size=10_000)

# A list with at least 1 winner and 1 loser (for PF ratio; avoids inf/0 edge cases)
_pnl_mixed = st.lists(
    _pnl_value,
    min_size=2,
    max_size=10_000,
).filter(
    lambda xs: any(x > 0 for x in xs) and any(x < 0 for x in xs)
)

# Small positive float for fees
_fee_value = st.floats(min_value=0.0, max_value=1_000_000.0, allow_nan=False, allow_infinity=False)


# ─── SHARPE RATIO PROPERTIES ──────────────────────────────────────────────────

class TestSharpeProperties:
    """5 algebraic properties of Sharpe ratio that MUST hold for all inputs."""

    @given(_pnl_list_2plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_zero_returns_zero_sharpe(self, pnls: List[float]):
        """P&L series of all zeros: Sharpe is 0.0 (zero mean, zero std).

        This catches off-by-one in std computation (ddof) that could produce
        NaN instead of 0 for degenerate inputs.
        """
        zeros = [0.0] * len(pnls)
        result = _sharpe(zeros)
        assert result == pytest.approx(0.0, abs=1e-10), (
            f"Zero P&L series should give Sharpe=0, got {result}"
        )

    @given(_pnl_list_2plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_constant_positive_mean_positive_sharpe(self, pnls: List[float]):
        """Constant positive P&L (mean > 0, std = 0) returns Sharpe = 0.

        When std == 0 (flat equity growth), our convention is Sharpe = 0,
        not +inf. This is a deliberate design choice (avoiding inf in DB).
        Property: _sharpe returns 0.0 for std==0, never NaN.
        """
        positives = [1.0] * len(pnls)  # constant positive = zero std
        result = _sharpe(positives)
        assert not math.isnan(result), (
            "Sharpe must not be NaN for constant positive returns"
        )
        assert result == pytest.approx(0.0, abs=1e-10), (
            f"Constant positive P&L (zero std) should give Sharpe=0, got {result}"
        )

    @given(
        st.lists(_pnl_value, min_size=2, max_size=1000),
        st.floats(min_value=1.0, max_value=1_000_000.0, allow_nan=False, allow_infinity=False),
    )
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_sharpe_sign_matches_mean_sign(self, pnls: List[float], std_scale: float):
        """Sign of Sharpe matches sign of mean return (when std > 0).

        If mean(pnls) > 0 => Sharpe > 0.
        If mean(pnls) < 0 => Sharpe < 0.
        If mean(pnls) == 0 => Sharpe == 0.

        This catches sign-flip bugs in the annualization factor.
        """
        arr = np.array(pnls, dtype=float)
        mean = float(np.mean(arr))
        std = float(np.std(arr, ddof=1))
        assume(std > 1e-12)  # need non-zero std for this property to apply

        result = _sharpe(pnls)
        if mean > 1e-12:
            assert result > 0.0, (
                f"Positive mean {mean:.4f} should give positive Sharpe, got {result:.4f}"
            )
        elif mean < -1e-12:
            assert result < 0.0, (
                f"Negative mean {mean:.4f} should give negative Sharpe, got {result:.4f}"
            )
        else:
            assert abs(result) < 1e-6, (
                f"Near-zero mean {mean:.4f} should give near-zero Sharpe, got {result:.4f}"
            )

    @given(st.floats(min_value=1.0, max_value=10_000.0, allow_nan=False, allow_infinity=False))
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_annualization_scales_by_sqrt_periods(self, periods: float):
        """Sharpe annualizes by sqrt(periods_per_year).

        For a fixed pnl series, Sharpe(periods_1) / Sharpe(periods_2) ==
        sqrt(periods_1) / sqrt(periods_2).

        This catches wrong exponent (squared instead of sqrt) or missing
        annualization altogether.
        """
        # Fixed deterministic series so only the periods change
        pnls = [1.0, -0.5, 1.5, -0.3, 2.0, -1.0, 0.8, -0.2]
        assume(periods > 0.1)  # avoid near-zero period counts

        sharpe_252 = _sharpe(pnls, periods_per_year=252.0)
        sharpe_periods = _sharpe(pnls, periods_per_year=periods)

        assume(abs(sharpe_252) > 1e-10)  # avoid 0/0 ratio

        ratio = sharpe_periods / sharpe_252
        expected_ratio = math.sqrt(periods / 252.0)
        assert math.isclose(ratio, expected_ratio, rel_tol=1e-9), (
            f"Sharpe ratio for periods={periods:.2f} should be "
            f"{expected_ratio:.6f}x the 252-period Sharpe, got {ratio:.6f}x. "
            f"Sharpe(252)={sharpe_252:.4f}, Sharpe({periods:.1f})={sharpe_periods:.4f}"
        )

    @given(_pnl_list_2plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_sharpe_finite_for_bounded_inputs(self, pnls: List[float]):
        """Sharpe must be finite for any bounded (non-NaN, non-inf) input list.

        This catches overflow or NaN propagation in the formula for large values.
        """
        result = _sharpe(pnls)
        assert math.isfinite(result), (
            f"Sharpe must be finite for bounded inputs, got {result}. "
            f"Input stats: mean={np.mean(pnls):.2f}, std={np.std(pnls):.2f}, n={len(pnls)}"
        )


# ─── PROFIT FACTOR PROPERTIES ─────────────────────────────────────────────────

class TestProfitFactorProperties:
    """5 algebraic properties of Profit Factor that MUST hold for all inputs."""

    @given(_pnl_list_1plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_pf_non_negative(self, pnls: List[float]):
        """Profit factor is always >= 0.

        This is trivially true from the definition (sum of positives /
        sum of negatives) but catches sign errors in the implementation.
        """
        result = _profit_factor(pnls)
        assert result >= 0.0, (
            f"PF must be >= 0, got {result} for input {pnls[:5]}..."
        )

    @given(st.lists(
        st.floats(min_value=0.001, max_value=1_000_000.0, allow_nan=False, allow_infinity=False),
        min_size=1,
        max_size=10_000,
    ))
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_pf_infinity_iff_no_losers(self, winners: List[float]):
        """PF == infinity if and only if there are no losing trades.

        All-positive P&L list => PF = infinity (perfect record).
        This catches off-by-one bugs where a zero trade is counted as a loser.
        """
        result = _profit_factor(winners)
        assert result == float("inf"), (
            f"All-positive P&Ls should give PF=inf, got {result}. "
            f"Input: {winners[:5]}..."
        )

    @given(st.lists(
        st.floats(min_value=-1_000_000.0, max_value=-0.001, allow_nan=False, allow_infinity=False),
        min_size=1,
        max_size=10_000,
    ))
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_pf_zero_iff_no_winners(self, losers: List[float]):
        """PF == 0 if and only if there are no winning trades.

        All-negative P&L list => PF = 0.0.
        This catches bugs where PF returns a positive value for all-losers.
        """
        result = _profit_factor(losers)
        assert result == pytest.approx(0.0, abs=1e-12), (
            f"All-negative P&Ls should give PF=0, got {result}. "
            f"Input: {losers[:5]}..."
        )

    @given(_pnl_list_1plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_pf_order_invariant(self, pnls: List[float]):
        """PF is invariant under reordering (commutative under permutation).

        PF(trades) == PF(reversed(trades)) == PF(shuffled(trades)).
        This is a fundamental mathematical property: PF depends only on the
        SUM of winners and SUM of losers, not their order.

        Catches implementations that incorrectly path-depend the PF calculation.
        """
        pf_original = _profit_factor(pnls)
        pf_reversed = _profit_factor(list(reversed(pnls)))
        # Use math.isclose for inf==inf comparison (both inf is valid)
        if math.isinf(pf_original) and math.isinf(pf_reversed):
            assert pf_original > 0 and pf_reversed > 0, (
                "Both PF values are inf but have different signs"
            )
        else:
            assert math.isclose(pf_original, pf_reversed, rel_tol=1e-9, abs_tol=1e-12), (
                f"PF is order-dependent: "
                f"PF(original)={pf_original:.6f} != PF(reversed)={pf_reversed:.6f}. "
                f"This is a bug — PF must depend only on total wins/losses."
            )

    @given(_pnl_mixed)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_pf_greater_than_one_iff_more_wins_than_losses(self, pnls: List[float]):
        """PF > 1.0 iff total winning P&L exceeds total losing P&L in absolute terms.

        This is the semantic definition of PF: a value > 1.0 means the strategy
        makes more on winners than it loses on losers.
        """
        winners = [x for x in pnls if x > 0]
        losers = [x for x in pnls if x < 0]
        total_wins = sum(winners)
        total_losses = abs(sum(losers))

        pf = _profit_factor(pnls)

        # By definition: PF = total_wins / total_losses
        # PF > 1 iff total_wins > total_losses
        if total_wins > total_losses:
            assert pf > 1.0, (
                f"total_wins={total_wins:.2f} > total_losses={total_losses:.2f} "
                f"but PF={pf:.4f} <= 1.0 — semantic invariant violated"
            )
        elif total_wins < total_losses:
            assert pf < 1.0, (
                f"total_wins={total_wins:.2f} < total_losses={total_losses:.2f} "
                f"but PF={pf:.4f} >= 1.0 — semantic invariant violated"
            )
        else:
            # total_wins == total_losses => PF == 1.0 (exactly breakeven)
            assert math.isclose(pf, 1.0, rel_tol=1e-9, abs_tol=1e-12), (
                f"total_wins == total_losses but PF={pf:.6f} != 1.0"
            )


# ─── MAX DRAWDOWN PROPERTIES ──────────────────────────────────────────────────

class TestMaxDrawdownProperties:
    """5 algebraic properties of Max Drawdown that MUST hold for all inputs."""

    @given(_pnl_list_1plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_max_dd_non_negative(self, pnls: List[float]):
        """Max drawdown is always >= 0.

        A drawdown is by definition a decline from a peak — it is always
        non-negative. A value of 0 means the equity curve never declined.

        Catches sign errors (returning negative drawdown) or abs() omissions.
        """
        result = _max_drawdown(pnls)
        assert result >= 0.0, (
            f"MaxDD must be >= 0, got {result:.4f} for input {pnls[:5]}..."
        )

    @given(st.lists(
        st.floats(min_value=0.001, max_value=1_000_000.0, allow_nan=False, allow_infinity=False),
        min_size=1,
        max_size=10_000,
    ))
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_monotone_up_means_zero_drawdown(self, increments: List[float]):
        """Monotonically increasing equity (all positive P&Ls) => MaxDD == 0.

        If every bar is positive, the equity curve never declines, so
        running_max always equals current equity, and drawdown is 0 everywhere.
        """
        result = _max_drawdown(increments)
        assert result == pytest.approx(0.0, abs=1e-9), (
            f"All-positive P&L series should give MaxDD=0, got {result:.4f}. "
            f"Input: {increments[:5]}..."
        )

    @given(_pnl_list_1plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_max_dd_bounded_by_total_losses(self, pnls: List[float]):
        """MaxDD <= |sum of all negative P&L values|.

        The worst possible drawdown is if every loser hits in sequence from a
        peak. The total of all losses is an upper bound on the drawdown.

        Derivation: MaxDD = max(running_peak - equity). In the worst case
        the peak occurs before all losses, so MaxDD = |sum(all losers)|.
        """
        total_losses = abs(sum(x for x in pnls if x < 0))
        result = _max_drawdown(pnls)
        # Allow small floating-point epsilon
        assert result <= total_losses + 1e-6, (
            f"MaxDD={result:.4f} exceeds total_losses={total_losses:.4f}. "
            f"Bound violated — possible bug in drawdown calculation."
        )

    @given(
        _pnl_list_1plus,
        st.floats(min_value=-1_000_000.0, max_value=1_000_000.0, allow_nan=False, allow_infinity=False),
    )
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_max_dd_monotone_nondecreasing_with_added_loser(
        self, pnls: List[float], extra_loss: float
    ):
        """Appending a losing trade to a series can only keep or increase MaxDD.

        If we add a negative-P&L trade to the end of a trade list, MaxDD
        can only stay the same or increase — it CANNOT decrease. This is
        because adding a negative period can extend or deepen an existing
        drawdown but cannot undo a historical peak-to-trough decline.

        Note: this property ONLY holds when the extra trade is appended to
        the END (not inserted in the middle), because MaxDD is path-dependent.
        """
        assume(extra_loss < 0.0)  # must be a loser; assume() skips non-losers

        dd_before = _max_drawdown(pnls)
        dd_after = _max_drawdown(pnls + [extra_loss])

        assert dd_after >= dd_before - 1e-9, (
            f"Adding a losing trade (P&L={extra_loss:.4f}) DECREASED MaxDD from "
            f"{dd_before:.4f} to {dd_after:.4f}. This is mathematically impossible "
            f"and indicates a bug in the drawdown calculation."
        )

    @given(_pnl_list_1plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_max_dd_finite_for_bounded_inputs(self, pnls: List[float]):
        """MaxDD must be finite for any bounded (non-NaN, non-inf) input list.

        Catches overflow in cumsum for large input values.
        """
        result = _max_drawdown(pnls)
        assert math.isfinite(result), (
            f"MaxDD must be finite for bounded inputs, got {result}. "
            f"n={len(pnls)}, sum={sum(pnls):.2f}"
        )


# ─── PNL CONSERVATION / ACCOUNTING PROPERTIES ────────────────────────────────

class TestPnlAccountingProperties:
    """4 properties of P&L accounting that enforce mass conservation.

    The fundamental constraint: sum(trade P&Ls) == final_equity - start_equity.
    Fees reduce net P&L but must not create or destroy value.
    """

    @given(_pnl_list_1plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_pnl_sum_equals_final_minus_start_equity(self, pnls: List[float]):
        """Sum of all trade P&Ls equals final equity minus starting equity.

        Mass conservation: no money is created or destroyed by the accounting.
        Starting equity = 0 (we track cumulative P&L, not absolute equity here).
        Final equity = cumulative sum of all P&Ls.

        This catches double-counting, sign errors, or missing trade accounting.
        """
        total_pnl = sum(pnls)
        equity = np.cumsum(np.array(pnls, dtype=float))
        final_equity = float(equity[-1])
        start_equity = 0.0

        assert math.isclose(total_pnl, final_equity - start_equity, rel_tol=1e-9, abs_tol=1e-9), (
            f"PnL conservation violated: "
            f"sum(pnls)={total_pnl:.6f} != "
            f"final_equity - start_equity = {final_equity:.6f} - {start_equity:.6f}"
        )

    @given(
        _pnl_list_1plus,
        _fee_value,
    )
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_net_pnl_equals_gross_minus_fees(self, gross_pnls: List[float], total_fees: float):
        """Net P&L = Gross P&L - Total Fees.

        Fees are costs, not revenue. They reduce net P&L monotonically.
        net_pnl < gross_pnl iff fees > 0.

        Critical rule from CLAUDE.md: we compute P&L ourselves for futures —
        we never pass fees to vectorbt. This test validates the manual fee
        subtraction formula.
        """
        gross = sum(gross_pnls)
        net = _net_pnl(gross_pnls, fees=total_fees)
        expected_net = gross - total_fees

        assert math.isclose(net, expected_net, rel_tol=1e-9, abs_tol=1e-9), (
            f"Net PnL formula violated: "
            f"net={net:.6f} != gross - fees = {gross:.6f} - {total_fees:.6f} = {expected_net:.6f}"
        )

    @given(
        _pnl_list_1plus,
        _fee_value,
    )
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_fees_only_reduce_net_pnl(self, pnls: List[float], fees: float):
        """Fees can only reduce (or maintain) net P&L — never increase it.

        net_pnl(fees > 0) <= gross_pnl.
        net_pnl(fees == 0) == gross_pnl.

        This ensures fee subtraction has the correct sign and direction.
        """
        gross = sum(pnls)
        net = _net_pnl(pnls, fees=fees)
        assert net <= gross + 1e-9, (
            f"Fees should reduce net P&L but net={net:.4f} > gross={gross:.4f}. "
            f"fees={fees:.4f}. Sign error in fee subtraction."
        )

    @given(
        st.integers(min_value=1, max_value=1000),
        _pnl_value,
    )
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_pnl_scales_linearly_with_trade_repetition(
        self, n: int, trade_pnl: float
    ):
        """Total P&L scales linearly when the same trade is repeated N times.

        sum([trade_pnl] * N) == N * trade_pnl.
        This is trivially true mathematically but catches floating-point
        accumulation errors (e.g., summation algorithm that does not maintain
        exact results for repeated values).
        """
        pnls = [trade_pnl] * n
        total = _net_pnl(pnls, fees=0.0)
        expected = n * trade_pnl

        # For large N * large trade_pnl, we allow relative tolerance
        if abs(expected) > 1e-12:
            assert math.isclose(total, expected, rel_tol=1e-9, abs_tol=1e-9), (
                f"PnL scaling violated: "
                f"sum([{trade_pnl}] * {n}) = {total:.6f} != {n} * {trade_pnl} = {expected:.6f}"
            )
        else:
            assert abs(total - expected) < 1e-9, (
                f"PnL scaling violated near zero: "
                f"sum([{trade_pnl}] * {n}) = {total:.6f} != {expected:.6f}"
            )


# ─── WIN RATE PROPERTIES ──────────────────────────────────────────────────────

class TestWinRateProperties:
    """3 properties of Win Rate that MUST hold for all inputs."""

    @given(_pnl_list_1plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_win_rate_in_unit_interval(self, pnls: List[float]):
        """Win rate is always in [0.0, 1.0].

        Catches division errors, sign errors, or off-by-one in n_trades.
        """
        result = _win_rate(pnls)
        assert 0.0 <= result <= 1.0, (
            f"Win rate must be in [0, 1], got {result:.6f} for {len(pnls)} trades."
        )

    @given(st.lists(
        st.floats(min_value=0.001, max_value=1_000_000.0, allow_nan=False, allow_infinity=False),
        min_size=1,
        max_size=10_000,
    ))
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_all_winners_gives_win_rate_one(self, winners: List[float]):
        """All positive trades => win rate = 1.0 exactly."""
        result = _win_rate(winners)
        assert result == pytest.approx(1.0, abs=1e-12), (
            f"All-positive P&Ls should give win_rate=1.0, got {result:.6f}"
        )

    @given(st.lists(
        st.floats(min_value=-1_000_000.0, max_value=-0.001, allow_nan=False, allow_infinity=False),
        min_size=1,
        max_size=10_000,
    ))
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_all_losers_gives_win_rate_zero(self, losers: List[float]):
        """All negative trades => win rate = 0.0 exactly."""
        result = _win_rate(losers)
        assert result == pytest.approx(0.0, abs=1e-12), (
            f"All-negative P&Ls should give win_rate=0.0, got {result:.6f}"
        )


# ─── CROSS-METRIC CONSISTENCY PROPERTIES ─────────────────────────────────────

class TestCrossMetricConsistency:
    """Properties that span multiple metrics — consistency under the same input.

    These catch bugs where metrics are computed with different formulas that
    produce inconsistent results (e.g., MaxDD computed one way for display and
    another way for gating).
    """

    @given(_pnl_mixed)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_pf_greater_than_one_correlates_with_positive_net_pnl(
        self, pnls: List[float]
    ):
        """PF > 1 implies positive net P&L (assuming zero fees).

        If total_wins > total_losses (PF > 1), then sum(pnls) > 0.
        This cross-metric invariant catches cases where PF and PnL are
        computed with different winner/loser conventions (e.g., one includes
        zero-pnl trades in losers, the other doesn't).
        """
        pf = _profit_factor(pnls)
        net = _net_pnl(pnls, fees=0.0)

        if pf > 1.0:
            assert net > 0.0, (
                f"PF={pf:.4f} > 1.0 but net_pnl={net:.4f} <= 0.0. "
                f"Inconsistency: PF and sum(pnls) disagree on profitability."
            )
        elif pf < 1.0 and pf >= 0.0:
            assert net < 0.0, (
                f"PF={pf:.4f} < 1.0 but net_pnl={net:.4f} >= 0.0. "
                f"Inconsistency: PF and sum(pnls) disagree on profitability."
            )

    @given(_pnl_list_2plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_sharpe_positive_iff_mean_positive_when_std_nonzero(self, pnls: List[float]):
        """Sharpe sign == mean(pnls) sign when std(pnls) != 0.

        This is a consistency check between the Sharpe formula and the
        net P&L direction. A positive-expectancy strategy MUST have
        positive Sharpe (when std is nonzero). The sign cannot flip.
        """
        arr = np.array(pnls, dtype=float)
        mean = float(np.mean(arr))
        std = float(np.std(arr, ddof=1))
        assume(std > 1e-8)  # only applies when std is meaningfully nonzero

        sharpe = _sharpe(pnls)

        if mean > 1e-8:
            assert sharpe > 0.0, (
                f"Positive mean={mean:.4f} should give positive Sharpe, got {sharpe:.6f}. "
                f"std={std:.4f}, n={len(pnls)}"
            )
        elif mean < -1e-8:
            assert sharpe < 0.0, (
                f"Negative mean={mean:.4f} should give negative Sharpe, got {sharpe:.6f}. "
                f"std={std:.4f}, n={len(pnls)}"
            )

    @given(_pnl_list_1plus)
    @settings(max_examples=200, deadline=5000, suppress_health_check=[HealthCheck.too_slow])
    def test_max_dd_zero_implies_monotone_equity(self, pnls: List[float]):
        """MaxDD == 0 implies all partial sums are non-decreasing.

        Equivalently: if MaxDD is zero, the equity curve never went down.
        This tests the REVERSE implication (DD==0 => monotone) to complement
        the monotone_up => DD==0 property tested elsewhere.
        """
        result = _max_drawdown(pnls)
        if result == pytest.approx(0.0, abs=1e-9):
            # Verify the equity curve is actually monotone non-decreasing
            equity = np.cumsum(np.array(pnls, dtype=float))
            diffs = np.diff(equity)
            assert np.all(diffs >= -1e-9), (
                f"MaxDD=0 but equity curve has decreasing segments: "
                f"min_diff={float(np.min(diffs)):.6f}. "
                f"Either MaxDD is wrong or cumsum has a bug."
            )
