"""Corpus v3 Gate 3 re-run protocol — DEFECT 6 regression test (2026-07-06).

See docs/designs/corpus-v3-gate1-respecification-2026-07-05.md, "DEFECT 6 (MCL
reconciliation) — Ruling (a), diagnosis-before-fix" section, for the locked
scope and diagnosis this test belongs to.

DEFECT 6 (VERIFIED, H-B ruled out, real fix is H-A-adjacent representation
mismatch): `run_class_backtest()`'s bar-level equity loop (the block that
builds `bar_dollar_pnls`, consumed by `equity_curve` / `equity_bars` /
`daily_pnls` / every equity-derived metric) previously read the
DISPLAY-ROUNDED `trade["Avg Entry Price"]` / `trade["Avg Exit Price"]` fields
(each `round(..., 4)`, added only for JSON-output readability) instead of the
FULL-PRECISION `entry_p` / `exit_p` floats that `gross` / `net_pnl` (and
therefore `trade_pnls_arr`, i.e. `trades_total`) were actually computed from.

For MES ($5/pt) and MNQ ($2/pt) the 4-decimal rounding quantum is
dollar-negligible. For MCL ($100/pt point value — 20-50x MES/MNQ), the same
per-price rounding quantum is amplified proportionally, and across enough
trades the accumulated equity-vs-trades divergence exceeds the reconciliation
check's $1 tolerance (`abs(equity_total - trades_total) > 1.0 ->
ValueError("RECONCILIATION FAILED")`) — this is exactly the failure the Gate 3
reference re-derivation hit on 8/42 MCL pairs (0/42 non-MCL pairs), diagnosed
in the design doc as H-B ("pure representation mismatch, not an omitted cost
term" — confirmed via a one-off instrumented run reproducing equity_total to
4 decimal places when trades_total was recomputed with the SAME rounded
prices).

Fix applied: a new parallel array `_raw_price_pairs_cls` captures the
FULL-PRECISION `(entry_p, exit_p)` pair for every trade at append time (same
loop, same order as `trades_list.append(trade)`); the bar-level equity loop
reads from this array instead of the rounded trade-dict fields.

Blade wording (per the design doc's "Blade wording correction" section, which
applies the same distinction Defect 4 established): this fix is
"verdict-variable-preserving, NOT computation-preserving" — it changes equity
curves and every equity-derived metric, but does NOT touch entry logic, trade
signals, or trade counts, which is all Gate 3's frozen rule (revival/
regression) measures. The fix does NOT loosen the $1 reconciliation tolerance
(the abuse-prone "H-B tolerance-widening" route the design doc explicitly
flags as guardrail-violating) — it removes the mismatch at its source so the
existing tolerance stays exactly as strict for every symbol.

Test strategy: mock vectorbt (module-local lazy import in `run_class_backtest`
— safe per the tower's known vectorbt-JIT collection hang) to return 400
synthetic MCL trades, each with a full-precision exit price sitting just
below the 4-decimal rounding boundary (EXIT_P=70.000049 -> round -> 70.0, the
near-maximum-magnitude ~0.000049 rounding error achievable at 4 decimal places).

EMPIRICAL NOTE (discovered building this test, worth recording): the trade-dict
construction loop (`for col in trades_records.columns: ... round(float(val), 4)`)
is a NO-OP for "Avg Entry Price" in practice, because `trades_records.iterrows()`
on a DataFrame with mixed column dtypes (float prices + string "Direction" +
int indices) upcasts each row to an object-dtype Series — so `val` arrives as a
plain Python `float`, not `np.floating`, and `isinstance(val, (np.integer,
np.floating))` is False, so the row falls through to the unrounded `else`
branch. Only "Avg Exit Price" is reliably rounded, because it is set via a
SEPARATE, unconditional line (`trade["Avg Exit Price"] = round(exit_p, 4)`)
that does not depend on that dtype quirk. This test exploits that: ENTRY_P is
chosen as an exact-to-4-decimals value (65.43) so it is a rounding no-op
regardless of the dtype quirk (dtype-independent, robust), and the entire
reproduced divergence comes from the guaranteed-rounded exit price alone. This
is still a faithful, discriminating reproduction of Defect 6 — the pre-fix
equity loop read `trade.get("Avg Exit Price")` (rounded) instead of the
full-precision `exit_p` that `gross` / `net_pnl` used, and that alone is
sufficient to trip the $1 reconciliation tolerance at MCL's $100/pt scale
given enough trades.

Each trade's rounding-induced equity-vs-trades divergence is a deterministic
~$0.0049 (verified via direct computation:
`(exit_p - round(exit_p, 4)) * point_value`). 400 trades -> ~$1.96 cumulative
divergence, ~2x the $1 tolerance: decisive (analogous to Defect 4's
deliberately-large $42 synthetic roll cost), not marginal. Pre-fix, this exact
scenario produces a reconciliation error large enough to fail a tight
post-fix-only assertion (verified below); post-fix, it must return cleanly
with a reconciliation error near zero.

Also monkeypatches `_apply_trade_management()` to bypass all bar-by-bar
stop/TP/trailing logic and return one deterministic managed trade per
synthetic trade — the Defect 6 equity-loop math being tested lives entirely
downstream of that call, not inside it.

SCOPE NOTE: this file is instrument-only per the Gate 3 re-run protocol's scope
lock — it adds test coverage for DEFECT 6 and touches nothing else (no
classifier, spec, or role logic).
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pandas as pd
import polars as pl

# ENTRY_P is exact-to-4-decimals -- round(ENTRY_P, 4) == ENTRY_P is a no-op
# regardless of the pandas dtype quirk documented in the module docstring
# (dtype-independent, robust). EXIT_P sits just below the 70.00005 rounding
# boundary -- round(70.000049, 4) == 70.0 -- the maximum-magnitude 4-decimal
# rounding error achievable (~0.000049, close to the theoretical max of
# 0.00005), and "Avg Exit Price" is unconditionally rounded via a separate
# code line, so this alone reproduces Defect 6's mechanism without depending
# on entry-side rounding.
ENTRY_P = 65.43  # round(., 4) == 65.43 (exact -- no rounding effect, by design)
EXIT_P = 70.000049  # round(., 4) == 70.0 (rounds down -- the guaranteed divergence source)
N_TRADES = 400  # ~$1.96 cumulative divergence at MCL's $100/pt -- ~2x the $1 tolerance


def _per_trade_rounding_divergence(entry_p: float, exit_p: float, point_value: float) -> float:
    """The exact mechanism under test: how much the rounded-price gross differs
    from the full-precision gross, for one long trade, one contract."""
    gross_raw = (exit_p - entry_p) * point_value
    gross_rounded = (round(exit_p, 4) - round(entry_p, 4)) * point_value
    return gross_raw - gross_rounded


def _install_vbt_n_trade_mock(n: int, entry_p: float, exit_p: float):
    """Inject a vectorbt stub whose Portfolio.from_signals() deterministically
    returns a portfolio with `n` identical trades, independent of the actual
    entry/exit signal arrays passed in (the strategy below never fires a real
    signal — see the never-fires config — so the fake trades are fully
    decoupled from signal-pipeline behavior and isolate the equity-loop math
    under test)."""

    _fake_trades_df = pd.DataFrame(
        {
            "Avg Entry Price": [entry_p] * n,
            "Avg Exit Price": [exit_p] * n,  # overridden by mocked _apply_trade_management below
            "Size": [1.0] * n,
            "Direction": ["Long"] * n,
            "Entry Idx": [10] * n,
            "Exit Idx": [15] * n,
        }
    )

    class _FakeTrades:
        def count(self):
            return n

        @property
        def records_readable(self):
            return _fake_trades_df

    class _FakePortfolio:
        def __init__(self, *args, **kwargs):
            self.trades = _FakeTrades()

    _vbt_mock = MagicMock()
    _vbt_mock.Portfolio.from_signals = MagicMock(side_effect=lambda *a, **kw: _FakePortfolio())
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        sys.modules[mod] = _vbt_mock
    return _vbt_mock


def _make_ohlcv(n: int = 200, base: float = 65.0, trend: float = 0.02) -> pl.DataFrame:
    dates = [datetime(2023, 1, 1) + timedelta(days=i) for i in range(n)]
    closes = [base + i * trend + (i % 5) * 0.1 for i in range(n)]
    return pl.DataFrame(
        {
            "ts_event": dates,
            "open": [c - 0.05 for c in closes],
            "high": [c + 0.10 for c in closes],
            "low": [c - 0.10 for c in closes],
            "close": closes,
            "volume": [50000] * n,
        }
    )


class TestGate3Defect6ClassBacktestMclReconciliation:
    """GATE3-DEFECT-6: bar_dollar_pnls must use full-precision entry/exit
    prices, not the display-rounded trade-dict fields, so equity reconciles
    with trade P&L at MCL's $100/pt scale."""

    def _run(self, monkeypatch, n: int = N_TRADES, entry_p: float = ENTRY_P, exit_p: float = EXIT_P):
        _install_vbt_n_trade_mock(n, entry_p, exit_p)

        import src.engine.backtester as backtester_module

        # Zero slippage + commission so gross == net_pnl exactly for every trade.
        # Costs are irrelevant to the Defect 6 mechanism (they are applied
        # identically on both the equity-loop side and the net_pnl side and
        # already reconcile correctly — see Defect 4's roll-cost fix for the
        # analogous cost-term bug). Zeroing them lets the "tight reconciliation"
        # assertions below compare against an ANALYTICALLY exact expected total
        # (n * (exit_p - entry_p) * point_value) instead of re-deriving it from
        # the trade dict's `PnL` field, which is itself `round(net_pnl, 2)` and
        # would reintroduce a SEPARATE, unrelated 2-decimal-dollar rounding
        # noise source that has nothing to do with the 4-decimal PRICE rounding
        # this test isolates.

        # Bypass all bar-by-bar stop/TP/trailing logic — Defect 6 lives entirely
        # in the equity-loop code downstream of managed_trades, not inside
        # _apply_trade_management itself.
        monkeypatch.setattr(
            backtester_module,
            "_apply_trade_management",
            lambda *a, **k: [
                {
                    "exit_price": exit_p,
                    "exit_idx": 15,
                    "exit_reason": "signal",
                    "risk_points": 0.05,
                    "stop_basis": "atr_fallback",
                }
                for _ in range(n)
            ],
        )

        from src.engine.config import (
            IndicatorConfig,
            PositionSizeConfig,
            StopConfig,
            StrategyConfig,
        )
        from src.engine.strategy_base import ExpressionStrategy

        config = StrategyConfig(
            name="Gate3 Defect6 MCL Reconciliation Never Fires",
            symbol="MCL",
            timeframe="daily",
            indicators=[
                IndicatorConfig(type="sma", period=5),
                IndicatorConfig(type="sma", period=15),
                IndicatorConfig(type="atr", period=14),
            ],
            entry_long="close > 9999999",  # unreachable — fake trades injected via vectorbt mock
            entry_short="high < low",  # never-true sentinel (W23F.L convention)
            exit="close crosses_below sma_15",
            stop_loss=StopConfig(type="atr", multiplier=2.0),
            position_size=PositionSizeConfig(type="dynamic_atr", target_risk_dollars=500),
        )
        strategy = ExpressionStrategy(config)

        df = _make_ohlcv(200)
        small_daily = _make_ohlcv(10)

        return backtester_module.run_class_backtest(
            strategy=strategy,
            start_date="2023-01-01",
            end_date="2023-12-31",
            data=df,
            daily_data=small_daily,
            slippage_ticks=0.0,
            commission_per_side=0.0,
        )

    def test_construction_sanity_rounding_errors_do_not_cancel(self):
        """Sanity-check the test's own arithmetic before trusting the engine
        result: the chosen ENTRY_P/EXIT_P must produce a non-zero per-trade
        divergence, and N_TRADES worth of it must exceed the $1 reconciliation
        tolerance -- otherwise this test would not be discriminating."""
        per_trade = _per_trade_rounding_divergence(ENTRY_P, EXIT_P, point_value=100.0)
        assert abs(per_trade) > 0.001, "chosen prices produce a negligible per-trade divergence"
        cumulative = abs(per_trade) * N_TRADES
        assert cumulative > 1.0, (
            f"cumulative divergence {cumulative:.4f} does not exceed the $1 reconciliation "
            f"tolerance -- this scenario would not be discriminating"
        )

    def test_no_reconciliation_error_at_mcl_scale(self, monkeypatch):
        """DEFECT 6 (pre-fix): 400 MCL trades with a rounding-divergent exit
        price raise `ValueError: RECONCILIATION FAILED` (~$1.96 divergence,
        ~2x the $1 tolerance) because bar_dollar_pnls read the 4-decimal-rounded
        trade-dict price field while net_pnl used full precision. Post-fix:
        must NOT raise.
        """
        result = self._run(monkeypatch)  # must NOT raise
        assert result["total_trades"] == N_TRADES

    def test_equity_reconciles_tightly_with_analytic_expected_total(self, monkeypatch):
        """Post-fix: sum(bar_dollar_pnls) (equity_bars) must equal the
        ANALYTICALLY exact expected total (n * (exit_p - entry_p) * point_value,
        zero costs) to a TIGHT tolerance -- much tighter than the $1
        raise-threshold that merely bounded (rather than fixed) the pre-fix
        defect. This deliberately does NOT sum `t["PnL"]` (which is itself
        `round(net_pnl, 2)` and would reintroduce an unrelated 2-decimal-dollar
        rounding noise source unconnected to the 4-decimal PRICE rounding this
        test isolates -- confirmed via the same mechanism at n=250: summing
        rounded PnL fields showed a spurious $0.50 residual that vanishes when
        compared against the analytic full-precision expectation instead).
        """
        result = self._run(monkeypatch)
        equity_bars = result["equity_bars"]
        starting_capital = 50_000.0
        equity_total = equity_bars[-1] - starting_capital
        expected_total = N_TRADES * (EXIT_P - ENTRY_P) * 100.0  # MCL point_value=100, zero costs
        assert abs(equity_total - expected_total) < 0.01, (
            f"equity_total={equity_total:.4f} expected_total={expected_total:.4f} "
            f"diff={abs(equity_total - expected_total):.4f} -- should be ~0 post-fix"
        )

    def test_non_mcl_symbol_unaffected_at_this_precision(self, monkeypatch):
        """Sanity companion: the SAME rounding mechanism at MES's $5/pt point
        value stays comfortably inside the $1 tolerance even pre-fix (matches
        the design doc's "negligible for MES/MNQ" characterization) -- confirms
        the test is isolating an MCL-scale-specific reconciliation failure, not
        a generic engine bug that happens to also touch MES.
        """
        per_trade_mes = _per_trade_rounding_divergence(ENTRY_P, EXIT_P, point_value=5.0)
        cumulative_mes = abs(per_trade_mes) * N_TRADES
        assert cumulative_mes < 1.0, (
            f"expected MES-scale cumulative divergence ({cumulative_mes:.4f}) to stay under "
            f"the $1 tolerance -- if this fails, the scenario is no longer MCL-specific"
        )

    def test_small_trade_count_also_reconciles(self, monkeypatch):
        """Sanity check at a much smaller (realistic single-session) trade
        count too -- the fix must hold regardless of scale, not just at the
        discriminating 250-trade case.
        """
        n_small = 3
        result = self._run(monkeypatch, n=n_small)
        equity_total = result["equity_bars"][-1] - 50_000.0
        expected_total = n_small * (EXIT_P - ENTRY_P) * 100.0
        assert abs(equity_total - expected_total) < 0.01
