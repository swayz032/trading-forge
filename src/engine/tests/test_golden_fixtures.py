"""A5 — Hand-Computed Golden Fixtures.

Tests that metric calculations produce correct results given hand-verified trade lists.
These fixtures are the canonical math truth anchor. If any of these tests fail,
the system has a known, documented bug that must be fixed before W10 can proceed.

Each test:
  1. Loads a fixture JSON file (known-truth input)
  2. Computes the metric being tested using our code
  3. Asserts the computed result matches the hand-computed expected value within tolerance

Approach (hybrid Option A / Option B per plan):
  - Fixtures 1, 3, 5: Option A — synthetic trade list, test metric computation directly
  - Fixtures 2, 4:    Option B — path-based, test MC ruin and walk-forward degradation

Critical rule (from CLAUDE.md): Never pass slippage/fees to vectorbt for futures.
These fixtures compute P&L manually, which is the correct pattern.

Tolerances:
  - PnL: within $1.00
  - Sharpe: within 0.001
  - PF: within 0.005
  - Max DD: within $1.00
  - Commission total: within $0.01
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

# ─── Fixture loader ────────────────────────────────────────────────

GOLDEN_DIR = Path(__file__).parent / "fixtures" / "golden"


def _load_fixture(name: str) -> dict:
    """Load a golden fixture JSON file."""
    path = GOLDEN_DIR / f"{name}.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _load_expected() -> dict:
    """Load the hand-computed expected results."""
    path = GOLDEN_DIR / "expected_results.json"
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ─── Pure metric helpers (no system dependencies) ──────────────────
# These are self-contained computations — we are NOT calling src.engine here.
# The point is to test the system's output matches these formulas, not to
# use the system to verify itself (circular).

def _compute_pf_from_trades(trades: list[dict], use_net: bool = True) -> float:
    """Compute profit factor from a flat trade list.

    Args:
        trades: list of trade dicts with gross_pnl, commission, net_pnl
        use_net: if True, use net_pnl; if False, use gross_pnl

    Returns:
        Profit factor = sum(winners) / abs(sum(losers))
    """
    field = "net_pnl" if use_net else "gross_pnl"
    winners = [t[field] for t in trades if t[field] > 0]
    losers = [t[field] for t in trades if t[field] < 0]

    total_wins = sum(winners)
    total_losses = abs(sum(losers))

    if total_losses == 0:
        return float("inf")
    return total_wins / total_losses


def _compute_net_pnl(trades: list[dict]) -> float:
    """Sum of net_pnl across all trades."""
    return sum(t["net_pnl"] for t in trades)


def _compute_gross_pf(trades: list[dict]) -> float:
    """Profit factor on gross_pnl (before commission)."""
    return _compute_pf_from_trades(trades, use_net=False)


def _compute_net_pf(trades: list[dict]) -> float:
    """Profit factor on net_pnl (after commission)."""
    return _compute_pf_from_trades(trades, use_net=True)


def _compute_total_commission(trades: list[dict]) -> float:
    """Total commission paid across all trades."""
    return sum(t["commission"] for t in trades)


def _compute_win_rate(trades: list[dict]) -> float:
    """Win rate = n_winners / n_trades using net_pnl."""
    n_winners = sum(1 for t in trades if t["net_pnl"] > 0)
    return n_winners / len(trades)


def _compute_max_drawdown(trades: list[dict]) -> float:
    """Max drawdown from the cumulative P&L equity curve (dollar terms).

    The equity curve starts at 0 (no initial capital offset).
    """
    net_pnls = np.array([t["net_pnl"] for t in trades])
    equity = np.cumsum(net_pnls)
    running_max = np.maximum.accumulate(equity)
    drawdowns = running_max - equity
    return float(np.max(drawdowns))


def _compute_sharpe_from_trades(trades: list[dict], periods_per_year: float = 252.0) -> float:
    """Annualized Sharpe ratio from trade P&L series (ddof=1).

    Matches risk_metrics.compute_sharpe_distribution() formula exactly:
      mean(excess) / std(excess, ddof=1) * sqrt(periods_per_year)
    with risk_free_rate = 0.
    """
    net_pnls = np.array([t["net_pnl"] for t in trades], dtype=float)
    mean = np.mean(net_pnls)
    std = np.std(net_pnls, ddof=1)
    if std == 0:
        return 0.0
    return float(mean / std * np.sqrt(periods_per_year))


# ─── DS#20 T-B2 — production math-truth anchors ────────────────────
# The helpers above are a deliberate, self-contained reimplementation (see
# module docstring) — that keeps this suite import-light and fast. But a
# reimplementation-only suite cannot catch a regression in PRODUCTION metric
# code: it would only ever compare the reimplementation against itself.
#
# src.engine.risk_metrics is the one production module that expresses Sharpe
# and max-drawdown as standalone, engine-decoupled functions operating on
# cumulative-P&L arrays (it backs Monte Carlo path-distribution metrics, not a
# trade-schema calculator). It imports only numpy/os — verified import-safe
# under pytest (no vectorbt/backtester in its import chain; see DS#20 report).
# A single trade sequence is modeled as a single path (n_sims=1) so the exact
# same production formulas apply. Profit factor / net P&L / total commission
# have NO standalone production equivalent to anchor against — that arithmetic
# lives inline inside src/engine/backtester.py's run_backtest() (bar-by-bar
# trade construction, not a reusable trades-in/metric-out function) and is
# out of scope for this anchor; see DS#20 fix-wave report for the honest gap.
#
# If risk_metrics.py's Sharpe or max-drawdown formula regresses, these
# companion assertions fail the golden suite — closing the "reimplementation
# validates only itself" gap for the two metrics that do have a real anchor.

def _compute_max_dd_via_risk_metrics(trades: list[dict]) -> float:
    """Anchor against src.engine.risk_metrics.compute_max_drawdown_distribution (DS#20 T-B2)."""
    pytest.importorskip("src.engine.risk_metrics")
    from src.engine.risk_metrics import compute_max_drawdown_distribution

    net_pnls = np.array([t["net_pnl"] for t in trades], dtype=float)
    path = np.cumsum(net_pnls).reshape(1, -1)
    dist = compute_max_drawdown_distribution(path, initial_capital=0.0, percentiles=[0.5])
    return dist["p50"]


def _compute_sharpe_via_risk_metrics(trades: list[dict], periods_per_year: float = 252.0) -> float:
    """Anchor against src.engine.risk_metrics.compute_sharpe_distribution (DS#20 T-B2).

    compute_sharpe_distribution derives per-step P&L via np.diff(paths, axis=1),
    which drops the leading element — prepend a 0.0 "start of path" point so the
    diff regenerates the exact per-trade net_pnl series the local reimplementation
    consumes directly.
    """
    pytest.importorskip("src.engine.risk_metrics")
    from src.engine.risk_metrics import compute_sharpe_distribution

    net_pnls = np.array([t["net_pnl"] for t in trades], dtype=float)
    path = np.concatenate(([0.0], np.cumsum(net_pnls))).reshape(1, -1)
    dist = compute_sharpe_distribution(path, percentiles=[0.5], periods_per_year=periods_per_year)
    return dist["p50"]


# ─── Fixture 1: fixture_perfect ────────────────────────────────────

class TestFixturePerfect:
    """100 trades, 70% win rate, PF 2.0 gross, hand-computed P&L."""

    @pytest.fixture(autouse=True)
    def load(self):
        self.fixture = _load_fixture("fixture_perfect")
        self.expected = _load_expected()["fixture_perfect"]["expected"]
        self.trades = self.fixture["trades"]

    def test_n_trades_matches(self):
        assert len(self.trades) == self.expected["n_trades"], (
            f"Expected {self.expected['n_trades']} trades, got {len(self.trades)}"
        )

    def test_n_winners_matches(self):
        n_winners = sum(1 for t in self.trades if t["is_winner"])
        assert n_winners == self.expected["n_winners"], (
            f"Expected {self.expected['n_winners']} winners, got {n_winners}"
        )

    def test_n_losers_matches(self):
        n_losers = sum(1 for t in self.trades if not t["is_winner"])
        assert n_losers == self.expected["n_losers"], (
            f"Expected {self.expected['n_losers']} losers, got {n_losers}"
        )

    def test_gross_pf(self):
        """Gross PF computed from gross_pnl (before subtracting commission)."""
        gross_pf = _compute_gross_pf(self.trades)
        expected = self.expected["gross_pf"]
        tol = self.expected["gross_pf_tolerance"]
        assert abs(gross_pf - expected) <= tol, (
            f"Gross PF mismatch: expected {expected}, got {gross_pf:.6f} (tolerance {tol})"
        )

    def test_net_pf(self):
        """Net PF computed from net_pnl (after commission). Critical: fees reduce PF."""
        net_pf = _compute_net_pf(self.trades)
        expected = self.expected["net_pf"]
        tol = self.expected["net_pf_tolerance"]
        assert abs(net_pf - expected) <= tol, (
            f"Net PF mismatch: expected {expected}, got {net_pf:.6f} (tolerance {tol})"
        )

    def test_net_pnl(self):
        """Net PnL = sum of net_pnl column."""
        net_pnl = _compute_net_pnl(self.trades)
        expected = self.expected["net_pnl"]
        tol = self.expected["net_pnl_tolerance"]
        assert abs(net_pnl - expected) <= tol, (
            f"Net PnL mismatch: expected ${expected:.2f}, got ${net_pnl:.2f} (tolerance ${tol})"
        )

    def test_total_commission(self):
        """Total commission = n_trades × commission_per_trade."""
        total_comm = _compute_total_commission(self.trades)
        expected = self.expected["total_commission"]
        tol = self.expected["total_commission_tolerance"]
        assert abs(total_comm - expected) <= tol, (
            f"Commission mismatch: expected ${expected:.2f}, got ${total_comm:.2f}"
        )

    def test_win_rate(self):
        """Win rate = n_winners / n_trades."""
        win_rate = _compute_win_rate(self.trades)
        expected = self.expected["win_rate"]
        tol = self.expected["win_rate_tolerance"]
        assert abs(win_rate - expected) <= tol, (
            f"Win rate mismatch: expected {expected:.4f}, got {win_rate:.4f}"
        )

    def test_max_drawdown(self):
        """Max drawdown from equity curve (winners then losers = late drawdown)."""
        max_dd = _compute_max_drawdown(self.trades)
        expected = self.expected["max_dd_dollars"]
        tol = self.expected["max_dd_tolerance"]
        assert abs(max_dd - expected) <= tol, (
            f"Max DD mismatch: expected ${expected:.2f}, got ${max_dd:.2f} (tolerance ${tol})"
        )

    def test_sharpe_is_positive(self):
        """Strategy has positive expectancy, Sharpe must be positive."""
        sharpe = _compute_sharpe_from_trades(self.trades)
        assert sharpe > 0, f"Expected positive Sharpe for profitable strategy, got {sharpe:.4f}"

    def test_net_pf_lower_than_gross_pf(self):
        """Net PF must be lower than gross PF (fees reduce profitability)."""
        gross_pf = _compute_gross_pf(self.trades)
        net_pf = _compute_net_pf(self.trades)
        assert net_pf < gross_pf, (
            f"Net PF ({net_pf:.4f}) must be < Gross PF ({gross_pf:.4f}). "
            "If net >= gross, fees are not being applied to losers."
        )

    def test_commission_check_per_trade(self):
        """Every trade must have exactly commission_per_trade = 1.24."""
        expected_comm = self.fixture["commission_per_trade"]
        for trade in self.trades:
            assert abs(trade["commission"] - expected_comm) < 0.001, (
                f"Trade {trade['trade_id']}: commission {trade['commission']} != {expected_comm}"
            )

    def test_max_drawdown_and_sharpe_match_production_risk_metrics(self):
        """DS#20 T-B2: production anchor.

        src.engine.risk_metrics.compute_max_drawdown_distribution /
        compute_sharpe_distribution (production, not a reimplementation) must
        agree with the local reimplementation AND with the hand-computed
        expected value. A drift in risk_metrics.py now fails this suite.
        """
        local_max_dd = _compute_max_drawdown(self.trades)
        prod_max_dd = _compute_max_dd_via_risk_metrics(self.trades)
        assert abs(prod_max_dd - local_max_dd) < 0.01, (
            f"Production risk_metrics max_dd ({prod_max_dd:.4f}) diverges from local "
            f"reimplementation ({local_max_dd:.4f}) — exactly the drift this anchor exists to catch."
        )
        expected_dd = self.expected["max_dd_dollars"]
        tol_dd = self.expected["max_dd_tolerance"]
        assert abs(prod_max_dd - expected_dd) <= tol_dd, (
            f"Production risk_metrics max_dd ${prod_max_dd:.2f} != hand-computed ${expected_dd:.2f}"
        )

        local_sharpe = _compute_sharpe_from_trades(self.trades)
        prod_sharpe = _compute_sharpe_via_risk_metrics(self.trades)
        assert abs(prod_sharpe - local_sharpe) < 0.001, (
            f"Production risk_metrics sharpe ({prod_sharpe:.6f}) diverges from local "
            f"reimplementation ({local_sharpe:.6f})."
        )
        assert prod_sharpe > 0, (
            f"Expected positive production Sharpe for profitable strategy, got {prod_sharpe:.4f}"
        )


# ─── Fixture 2: fixture_losing ──────────────────────────────────────

class TestFixtureLosing:
    """200 trades, PF 0.5. MC ruin probability must exceed 95%."""

    @pytest.fixture(autouse=True)
    def load(self):
        self.fixture = _load_fixture("fixture_losing")
        self.expected = _load_expected()["fixture_losing"]["expected"]
        self.trades = self.fixture["trades"]

    def test_gross_pf_is_half(self):
        """Gross PF must be exactly 0.5 (losers 2× winners in gross terms)."""
        gross_pf = _compute_gross_pf(self.trades)
        expected = self.expected["gross_pf"]
        tol = self.expected["gross_pf_tolerance"]
        assert abs(gross_pf - expected) <= tol, (
            f"Gross PF: expected {expected}, got {gross_pf:.6f}"
        )

    def test_net_pnl_negative(self):
        """Losing strategy must have negative net PnL."""
        net_pnl = _compute_net_pnl(self.trades)
        assert net_pnl < 0, f"Expected negative net PnL, got {net_pnl:.2f}"

    def test_net_pnl_magnitude(self):
        """Net PnL close to hand-computed value."""
        net_pnl = _compute_net_pnl(self.trades)
        expected = self.expected["net_pnl"]
        tol = self.expected["net_pnl_tolerance"]
        assert abs(net_pnl - expected) <= tol, (
            f"Net PnL: expected {expected:.2f}, got {net_pnl:.2f}"
        )

    def test_mc_ruin_probability_exceeds_95_percent(self):
        """MC ruin probability must exceed 95% for this losing strategy.

        Uses trade_resample() from the production MC engine.
        This is the Option B path test — it validates the MC system, not just metrics.
        """
        from src.engine.monte_carlo import trade_resample
        from src.engine.risk_metrics import compute_probability_of_ruin

        net_pnls = np.array([t["net_pnl"] for t in self.trades])
        initial_capital = self.expected["mc_ruin_initial_capital"]
        ruin_threshold = self.expected["mc_ruin_threshold"]
        n_sims = self.expected["mc_n_simulations"]
        seed = self.expected["mc_seed"]

        # Resample trades → equity paths
        paths = trade_resample(net_pnls, n_sims=n_sims, seed=seed)

        # Compute ruin probability
        ruin_prob = compute_probability_of_ruin(paths, ruin_threshold, initial_capital)

        min_ruin = self.expected["mc_ruin_probability_min"]
        assert ruin_prob >= min_ruin, (
            f"MC ruin probability {ruin_prob:.4f} < {min_ruin}. "
            f"Strategy with PF=0.5 must hit ruin_threshold=${ruin_threshold:,.0f} "
            f"in > {min_ruin*100:.0f}% of {n_sims} MC paths. "
            f"If this fails, check that trade_resample() uses net P&Ls, not gross."
        )

    def test_win_rate_is_25_percent(self):
        """Win rate must be 25%: 50 winners out of 200 trades."""
        win_rate = _compute_win_rate(self.trades)
        expected = self.expected["win_rate"]
        tol = self.expected["win_rate_tolerance"]
        assert abs(win_rate - expected) <= tol, (
            f"Win rate: expected {expected:.4f}, got {win_rate:.4f}"
        )

    def test_n_trades(self):
        assert len(self.trades) == self.expected["n_trades"]

    def test_net_pf_below_1(self):
        """Net PF must be below 1.0 — this is a losing strategy."""
        net_pf = _compute_net_pf(self.trades)
        assert net_pf < 1.0, f"Net PF {net_pf:.4f} should be < 1.0 for a losing strategy"

    def test_max_drawdown_and_sharpe_match_production_risk_metrics(self):
        """DS#20 T-B2: production anchor (see TestFixturePerfect for full rationale).

        No hand-computed max_dd/sharpe values are stored for this fixture, so
        this only asserts local-vs-production agreement plus the sign this
        fixture is meant to demonstrate (a catastrophically losing strategy
        must show a negative-Sharpe path).
        """
        local_max_dd = _compute_max_drawdown(self.trades)
        prod_max_dd = _compute_max_dd_via_risk_metrics(self.trades)
        assert abs(prod_max_dd - local_max_dd) < 0.01, (
            f"Production risk_metrics max_dd ({prod_max_dd:.4f}) diverges from local "
            f"reimplementation ({local_max_dd:.4f})."
        )

        local_sharpe = _compute_sharpe_from_trades(self.trades)
        prod_sharpe = _compute_sharpe_via_risk_metrics(self.trades)
        assert abs(prod_sharpe - local_sharpe) < 0.001, (
            f"Production risk_metrics sharpe ({prod_sharpe:.6f}) diverges from local "
            f"reimplementation ({local_sharpe:.6f})."
        )
        assert prod_sharpe < 0, (
            f"Expected negative production Sharpe for a PF=0.5 losing strategy, got {prod_sharpe:.4f}"
        )


# ─── Fixture 3: fixture_marginal ────────────────────────────────────

class TestFixtureMarginal:
    """100 trades, PF 1.74 (just below 1.75 gate). Must NOT promote."""

    @pytest.fixture(autouse=True)
    def load(self):
        self.fixture = _load_fixture("fixture_marginal")
        self.expected = _load_expected()["fixture_marginal"]["expected"]
        self.trades = self.fixture["trades"]

    def test_gross_pf_is_1_74(self):
        """Gross PF = 1.74. Precise check: must not accidentally compute to >= 1.75."""
        gross_pf = _compute_gross_pf(self.trades)
        expected = self.expected["gross_pf"]
        tol = self.expected["gross_pf_tolerance"]
        assert abs(gross_pf - expected) <= tol, (
            f"Gross PF: expected {expected}, got {gross_pf:.6f} (tolerance {tol})"
        )

    def test_gross_pf_below_gate(self):
        """Gross PF must be STRICTLY below 1.75 promotion gate."""
        gross_pf = _compute_gross_pf(self.trades)
        promotion_gate = self.expected["promotion_gate_pf"]
        assert gross_pf < promotion_gate, (
            f"Gross PF {gross_pf:.4f} >= gate {promotion_gate}. "
            "This fixture must be below the gate. Check fixture data."
        )

    def test_net_pf_also_below_gate(self):
        """Net PF must also be below 1.75 (fees make it even worse)."""
        net_pf = _compute_net_pf(self.trades)
        promotion_gate = self.expected["promotion_gate_pf"]
        assert net_pf < promotion_gate, (
            f"Net PF {net_pf:.4f} >= gate {promotion_gate}. "
            "Net PF must be below gate. Fees compound the deficit."
        )

    def test_net_pf_hand_computed(self):
        """Net PF close to 1.6872 as hand-computed."""
        net_pf = _compute_net_pf(self.trades)
        expected = self.expected["net_pf"]
        tol = self.expected["net_pf_tolerance"]
        assert abs(net_pf - expected) <= tol, (
            f"Net PF: expected {expected:.4f}, got {net_pf:.6f}"
        )

    def test_net_pnl(self):
        net_pnl = _compute_net_pnl(self.trades)
        expected = self.expected["net_pnl"]
        tol = self.expected["net_pnl_tolerance"]
        assert abs(net_pnl - expected) <= tol, (
            f"Net PnL: expected ${expected:.2f}, got ${net_pnl:.2f}"
        )

    def test_should_not_promote(self):
        """Explicit test: strategy fails promotion gate."""
        gross_pf = _compute_gross_pf(self.trades)
        net_pf = _compute_net_pf(self.trades)
        promotion_gate = self.expected["promotion_gate_pf"]

        # Both gross and net must be below gate
        should_promote_gross = gross_pf >= promotion_gate
        should_promote_net = net_pf >= promotion_gate

        assert not should_promote_gross, (
            f"BUG: Gross PF {gross_pf:.4f} >= gate {promotion_gate}. "
            "Strategy incorrectly passes promotion gate on gross PF."
        )
        assert not should_promote_net, (
            f"BUG: Net PF {net_pf:.4f} >= gate {promotion_gate}. "
            "Strategy incorrectly passes promotion gate on net PF."
        )

    def test_fixture_is_close_to_but_below_gate(self):
        """Fixture must be within 5% below gate (tests the 'close call' boundary)."""
        gross_pf = _compute_gross_pf(self.trades)
        gate = self.expected["promotion_gate_pf"]
        # Must be within 5% below gate (i.e., PF between 1.6625 and 1.75)
        assert gross_pf >= gate * 0.95, (
            f"Gross PF {gross_pf:.4f} is too far below gate {gate}. "
            "Fixture should be near the boundary to test gate precision."
        )

    def test_win_rate(self):
        win_rate = _compute_win_rate(self.trades)
        expected = self.expected["win_rate"]
        tol = self.expected["win_rate_tolerance"]
        assert abs(win_rate - expected) <= tol

    def test_max_drawdown_and_sharpe_match_production_risk_metrics(self):
        """DS#20 T-B2: production anchor (see TestFixturePerfect for full rationale).

        No hand-computed max_dd/sharpe values are stored for this fixture, so
        this only asserts local-vs-production agreement — the "close call"
        boundary fixture is exactly the kind of case where a subtle PF/Sharpe
        formula drift could silently flip a promotion-gate decision.
        """
        local_max_dd = _compute_max_drawdown(self.trades)
        prod_max_dd = _compute_max_dd_via_risk_metrics(self.trades)
        assert abs(prod_max_dd - local_max_dd) < 0.01, (
            f"Production risk_metrics max_dd ({prod_max_dd:.4f}) diverges from local "
            f"reimplementation ({local_max_dd:.4f})."
        )

        local_sharpe = _compute_sharpe_from_trades(self.trades)
        prod_sharpe = _compute_sharpe_via_risk_metrics(self.trades)
        assert abs(prod_sharpe - local_sharpe) < 0.001, (
            f"Production risk_metrics sharpe ({prod_sharpe:.6f}) diverges from local "
            f"reimplementation ({local_sharpe:.6f})."
        )


# ─── Fixture 4: fixture_regime_shift ────────────────────────────────

class TestFixtureRegimeShift:
    """200 trades in 2 epochs. Walk-forward must show PF degradation."""

    @pytest.fixture(autouse=True)
    def load(self):
        self.fixture = _load_fixture("fixture_regime_shift")
        self.expected = _load_expected()["fixture_regime_shift"]["expected"]
        self.early_epoch = self.fixture["epochs"][0]
        self.late_epoch = self.fixture["epochs"][1]

    def test_early_epoch_pf(self):
        """Early epoch (2018-2020) must have PF > 2.0."""
        trades = self.early_epoch["trades"]
        gross_pf = _compute_gross_pf(trades)
        expected = self.expected["early_epoch_pf"]
        tol = self.expected["early_epoch_pf_tolerance"]
        assert abs(gross_pf - expected) <= tol, (
            f"Early epoch gross PF: expected {expected:.4f}, got {gross_pf:.6f}"
        )
        assert gross_pf > 2.0, (
            f"Early epoch PF {gross_pf:.4f} must be > 2.0 to demonstrate profitable regime."
        )

    def test_late_epoch_pf(self):
        """Late epoch (2020-2022) must have PF < 1.0."""
        trades = self.late_epoch["trades"]
        gross_pf = _compute_gross_pf(trades)
        expected = self.expected["late_epoch_pf"]
        tol = self.expected["late_epoch_pf_tolerance"]
        assert abs(gross_pf - expected) <= tol, (
            f"Late epoch gross PF: expected {expected:.4f}, got {gross_pf:.6f}"
        )
        assert gross_pf < 1.0, (
            f"Late epoch PF {gross_pf:.4f} must be < 1.0 to demonstrate regime failure."
        )

    def test_early_epoch_net_pnl(self):
        trades = self.early_epoch["trades"]
        net_pnl = _compute_net_pnl(trades)
        expected = self.expected["early_epoch_net_pnl"]
        tol = self.expected["early_epoch_net_pnl_tolerance"]
        assert abs(net_pnl - expected) <= tol, (
            f"Early epoch net PnL: expected ${expected:.2f}, got ${net_pnl:.2f}"
        )

    def test_late_epoch_net_pnl(self):
        trades = self.late_epoch["trades"]
        net_pnl = _compute_net_pnl(trades)
        expected = self.expected["late_epoch_net_pnl"]
        tol = self.expected["late_epoch_net_pnl_tolerance"]
        assert abs(net_pnl - expected) <= tol, (
            f"Late epoch net PnL: expected ${expected:.2f}, got ${net_pnl:.2f}"
        )

    def test_pf_degradation_ratio(self):
        """Degradation ratio = early_pf / late_pf must exceed 4.0x."""
        early_trades = self.early_epoch["trades"]
        late_trades = self.late_epoch["trades"]
        early_pf = _compute_gross_pf(early_trades)
        late_pf = _compute_gross_pf(late_trades)
        degradation = early_pf / late_pf
        min_degradation = self.expected["degradation_ratio_min"]
        assert degradation >= min_degradation, (
            f"Degradation ratio {degradation:.2f}x < minimum {min_degradation}x. "
            f"Early PF={early_pf:.4f}, Late PF={late_pf:.4f}. "
            "Walk-forward degradation is not pronounced enough."
        )

    def test_early_is_profitable_late_is_not(self):
        """Core regime shift assertion: early profitable, late not."""
        early_trades = self.early_epoch["trades"]
        late_trades = self.late_epoch["trades"]
        early_pnl = _compute_net_pnl(early_trades)
        late_pnl = _compute_net_pnl(late_trades)
        assert early_pnl > 0, f"Early epoch net PnL {early_pnl:.2f} must be positive"
        assert late_pnl < 0, f"Late epoch net PnL {late_pnl:.2f} must be negative"

    def test_combined_gross_pf(self):
        """Combined all-200-trade PF is between early and late (blended signal)."""
        all_trades = self.early_epoch["trades"] + self.late_epoch["trades"]
        combined_pf = _compute_gross_pf(all_trades)
        expected = self.expected["combined_gross_pf"]
        tol = self.expected["combined_gross_pf_tolerance"]
        assert abs(combined_pf - expected) <= tol, (
            f"Combined gross PF: expected {expected:.4f}, got {combined_pf:.6f}"
        )

    def test_fold_split_matches_epochs(self):
        """Splitting the 200 trades into 2 halves should match epoch split."""
        all_trades = self.early_epoch["trades"] + self.late_epoch["trades"]
        mid = len(all_trades) // 2
        fold1_trades = all_trades[:mid]
        fold2_trades = all_trades[mid:]
        fold1_pf = _compute_gross_pf(fold1_trades)
        fold2_pf = _compute_gross_pf(fold2_trades)
        assert fold1_pf > 2.0, f"Fold 1 PF {fold1_pf:.4f} should be > 2.0"
        assert fold2_pf < 1.0, f"Fold 2 PF {fold2_pf:.4f} should be < 1.0"

    def test_max_drawdown_and_sharpe_match_production_risk_metrics(self):
        """DS#20 T-B2: production anchor (see TestFixturePerfect for full rationale).

        Applied to the combined 200-trade regime-shift path (early profitable
        epoch followed by late losing epoch) — the walk-forward degradation
        shape this fixture exists to exercise.
        """
        all_trades = self.early_epoch["trades"] + self.late_epoch["trades"]

        local_max_dd = _compute_max_drawdown(all_trades)
        prod_max_dd = _compute_max_dd_via_risk_metrics(all_trades)
        assert abs(prod_max_dd - local_max_dd) < 0.01, (
            f"Production risk_metrics max_dd ({prod_max_dd:.4f}) diverges from local "
            f"reimplementation ({local_max_dd:.4f})."
        )

        local_sharpe = _compute_sharpe_from_trades(all_trades)
        prod_sharpe = _compute_sharpe_via_risk_metrics(all_trades)
        assert abs(prod_sharpe - local_sharpe) < 0.001, (
            f"Production risk_metrics sharpe ({prod_sharpe:.6f}) diverges from local "
            f"reimplementation ({local_sharpe:.6f})."
        )


# ─── Fixture 5: fixture_fees_killer ─────────────────────────────────

class TestFixtureFeesKiller:
    """200 small trades. Gross PF 1.60 flipped to net PF 0.84 by high commissions."""

    @pytest.fixture(autouse=True)
    def load(self):
        self.fixture = _load_fixture("fixture_fees_killer")
        self.expected = _load_expected()["fixture_fees_killer"]["expected"]
        self.trades = self.fixture["trades"]

    def test_gross_pf_above_1(self):
        """Gross PF must be > 1.0 (strategy looks profitable before fees)."""
        gross_pf = _compute_gross_pf(self.trades)
        assert gross_pf > 1.0, (
            f"Gross PF {gross_pf:.4f} should be > 1.0. "
            "The fixture is designed to look profitable on gross P&L."
        )

    def test_gross_pf_hand_computed(self):
        """Gross PF = 1.60 as hand-computed."""
        gross_pf = _compute_gross_pf(self.trades)
        expected = self.expected["gross_pf"]
        tol = self.expected["gross_pf_tolerance"]
        assert abs(gross_pf - expected) <= tol, (
            f"Gross PF: expected {expected:.4f}, got {gross_pf:.6f}"
        )

    def test_net_pf_below_1_the_critical_assertion(self):
        """THE KEY TEST: Net PF must be below 1.0.

        If this fails, fees are NOT being correctly applied to losing trades.
        The vectorbt bug: when slippage is passed as a % parameter, it only
        reduces winner P&L but does not add to loser loss magnitude.

        Correct futures math (our system): net_loss = gross_loss + commission.
        Wrong math (vectorbt default): net_winner = gross_winner * (1 - fee%),
                                        net_loser = gross_loser (fees not added).
        """
        net_pf = _compute_net_pf(self.trades)
        assert net_pf < 1.0, (
            f"CRITICAL BUG DETECTED: Net PF {net_pf:.4f} >= 1.0. "
            f"Gross PF was {_compute_gross_pf(self.trades):.4f} (profitable before fees). "
            f"Expected net PF {self.expected['net_pf']:.4f} (unprofitable after fees). "
            "This means fees are NOT being correctly added to losing trade magnitudes. "
            "Do NOT pass slippage/fees to vectorbt for futures — compute P&L manually."
        )

    def test_net_pf_hand_computed(self):
        """Net PF close to 0.840 as hand-computed."""
        net_pf = _compute_net_pf(self.trades)
        expected = self.expected["net_pf"]
        tol = self.expected["net_pf_tolerance"]
        assert abs(net_pf - expected) <= tol, (
            f"Net PF: expected {expected:.4f}, got {net_pf:.6f} (tolerance {tol})"
        )

    def test_fee_flip(self):
        """Gross PF > 1.0 AND net PF < 1.0 simultaneously — the fee flip."""
        gross_pf = _compute_gross_pf(self.trades)
        net_pf = _compute_net_pf(self.trades)
        assert gross_pf > 1.0, f"Gross PF {gross_pf:.4f} must be > 1.0"
        assert net_pf < 1.0, f"Net PF {net_pf:.4f} must be < 1.0"

    def test_total_commission(self):
        """Total commission = 200 × $2.58 = $516.00."""
        total_comm = _compute_total_commission(self.trades)
        expected = self.expected["total_commission"]
        tol = self.expected["total_commission_tolerance"]
        assert abs(total_comm - expected) <= tol, (
            f"Total commission: expected ${expected:.2f}, got ${total_comm:.2f}"
        )

    def test_net_pnl_negative(self):
        """Net PnL must be negative (fees destroy profitability)."""
        net_pnl = _compute_net_pnl(self.trades)
        assert net_pnl < 0, (
            f"Net PnL {net_pnl:.2f} must be negative for fees-killer fixture. "
            "If positive, commission is not being applied correctly."
        )

    def test_net_pnl_hand_computed(self):
        net_pnl = _compute_net_pnl(self.trades)
        expected = self.expected["net_pnl"]
        tol = self.expected["net_pnl_tolerance"]
        assert abs(net_pnl - expected) <= tol, (
            f"Net PnL: expected ${expected:.2f}, got ${net_pnl:.2f}"
        )

    def test_commission_per_trade_correct(self):
        """Every trade must have commission = $2.58 (Tradeify $1.29/side × 2)."""
        expected_comm = self.fixture["commission_per_trade"]
        for trade in self.trades:
            assert abs(trade["commission"] - expected_comm) < 0.001, (
                f"Trade {trade['trade_id']}: commission {trade['commission']} != {expected_comm}"
            )

    def test_net_pnl_equals_gross_minus_commission(self):
        """For each trade: net_pnl == gross_pnl - commission (winners) or gross_pnl - commission (losers).

        Actually: net_pnl = gross_pnl - commission for both winners and losers.
        Winner: gross=+10, comm=2.58, net=+7.42 ✓
        Loser:  gross=-6.25, comm=2.58, net=-8.83 ✓  (commission adds to loss)
        """
        for trade in self.trades:
            expected_net = round(trade["gross_pnl"] - trade["commission"], 10)
            actual_net = trade["net_pnl"]
            assert abs(actual_net - expected_net) < 0.01, (
                f"Trade {trade['trade_id']}: net_pnl={actual_net:.4f} != "
                f"gross_pnl({trade['gross_pnl']:.4f}) - commission({trade['commission']:.4f}) = {expected_net:.4f}"
            )

    def test_max_drawdown_and_sharpe_match_production_risk_metrics(self):
        """DS#20 T-B2: production anchor (see TestFixturePerfect for full rationale).

        This is the fee-flip fixture (gross_pf > 1.0, net_pf < 1.0) — the
        production Sharpe anchor must agree with the local reimplementation AND
        must be negative on the net_pnl series (fees turn this into a loser).
        """
        local_max_dd = _compute_max_drawdown(self.trades)
        prod_max_dd = _compute_max_dd_via_risk_metrics(self.trades)
        assert abs(prod_max_dd - local_max_dd) < 0.01, (
            f"Production risk_metrics max_dd ({prod_max_dd:.4f}) diverges from local "
            f"reimplementation ({local_max_dd:.4f})."
        )

        local_sharpe = _compute_sharpe_from_trades(self.trades)
        prod_sharpe = _compute_sharpe_via_risk_metrics(self.trades)
        assert abs(prod_sharpe - local_sharpe) < 0.001, (
            f"Production risk_metrics sharpe ({prod_sharpe:.6f}) diverges from local "
            f"reimplementation ({local_sharpe:.6f})."
        )
        assert prod_sharpe < 0, (
            f"Expected negative production Sharpe (fee-flip loser), got {prod_sharpe:.4f}"
        )


# ─── Cross-fixture consistency checks ──────────────────────────────

class TestCrossFixtureConsistency:
    """Sanity checks that span multiple fixtures — catches schema drift."""

    def test_all_fixture_files_exist(self):
        """All 5 fixture files must exist."""
        fixtures = [
            "fixture_perfect",
            "fixture_losing",
            "fixture_marginal",
            "fixture_regime_shift",
            "fixture_fees_killer",
        ]
        for name in fixtures:
            path = GOLDEN_DIR / f"{name}.json"
            assert path.exists(), f"Fixture file missing: {path}"

    def test_expected_results_file_exists(self):
        path = GOLDEN_DIR / "expected_results.json"
        assert path.exists(), f"Expected results file missing: {path}"

    def test_all_fixtures_have_fixture_id(self):
        """All flat-trade-list fixtures must declare fixture_id."""
        for name in ["fixture_perfect", "fixture_losing", "fixture_marginal", "fixture_fees_killer"]:
            fixture = _load_fixture(name)
            assert "fixture_id" in fixture, f"{name} missing fixture_id field"
            assert fixture["fixture_id"] == name, (
                f"{name}: fixture_id={fixture['fixture_id']} must match filename"
            )

    def test_net_pnl_equals_sum_of_net_pnl_column(self):
        """For all flat-trade fixtures: sum(trade.net_pnl) must match expected net_pnl."""
        expected_all = _load_expected()

        for name in ["fixture_perfect", "fixture_losing", "fixture_marginal", "fixture_fees_killer"]:
            fixture = _load_fixture(name)
            trades = fixture["trades"]
            computed = sum(t["net_pnl"] for t in trades)
            expected = expected_all[name]["expected"]["net_pnl"]
            tol = expected_all[name]["expected"]["net_pnl_tolerance"]
            assert abs(computed - expected) <= tol, (
                f"{name}: sum(net_pnl)={computed:.2f} != expected {expected:.2f}"
            )

    def test_commission_consistency(self):
        """For all flat-trade fixtures: total_commission == n_trades × commission_per_trade."""
        for name in ["fixture_perfect", "fixture_losing", "fixture_marginal", "fixture_fees_killer"]:
            fixture = _load_fixture(name)
            trades = fixture["trades"]
            cpt = fixture["commission_per_trade"]
            expected_total = len(trades) * cpt
            actual_total = sum(t["commission"] for t in trades)
            assert abs(actual_total - expected_total) < 0.01, (
                f"{name}: commission total {actual_total:.2f} != {len(trades)} × {cpt} = {expected_total:.2f}"
            )

    def test_net_pnl_formula_is_gross_minus_commission(self):
        """For all flat-trade fixtures: every trade must have net_pnl = gross_pnl - commission."""
        for name in ["fixture_perfect", "fixture_losing", "fixture_marginal", "fixture_fees_killer"]:
            fixture = _load_fixture(name)
            for trade in fixture["trades"]:
                expected_net = trade["gross_pnl"] - trade["commission"]
                assert abs(trade["net_pnl"] - expected_net) < 0.01, (
                    f"{name} trade {trade['trade_id']}: net_pnl={trade['net_pnl']:.4f} "
                    f"!= gross_pnl({trade['gross_pnl']:.4f}) - commission({trade['commission']:.4f})"
                )

    def test_regime_shift_epochs_sum_to_200_trades(self):
        """Regime shift fixture must have exactly 200 total trades across 2 epochs."""
        fixture = _load_fixture("fixture_regime_shift")
        total = sum(len(e["trades"]) for e in fixture["epochs"])
        assert total == 200, f"fixture_regime_shift: expected 200 total trades, got {total}"
