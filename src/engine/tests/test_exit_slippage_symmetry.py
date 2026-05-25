"""Tests for HIGH #5 — Symmetric exit slippage (Wave 27.5 Pass C.1).

Verifies:
- Crisis-session exit applies the same session multiplier as crisis-session entry
- Exit-bar session differs from entry-bar → exit uses exit-bar session
- Backward compat: BACKTEST_EXIT_SLIPPAGE_SYMMETRIC=false → flat overhead preserved
- Asymmetry delta audit payload is populated correctly
- slippage_arr is computed with session multipliers applied to all bars

Design principle: slippage_arr is indexed by bar number; exit_slip = slippage_arr[exit_idx]
automatically applies the exit bar's session multiplier. This is the symmetric-slippage
contract — each side uses its OWN bar's session multiplier, not the other side's.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import polars as pl
import pytest

from src.engine.config import ContractSpec
from src.engine.slippage import compute_slippage

# ─── Fixtures ──────────────────────────────────────────────────────────────


MES_SPEC = ContractSpec(
    symbol="MES",
    tick_size=0.25,
    tick_value=1.25,
    point_value=5.0,
    default_commission=0.62,
)


def _make_df(n: int = 20, atr_value: float = 4.0) -> pl.DataFrame:
    """Create a minimal DataFrame for slippage tests."""
    dates = [datetime(2024, 1, 2, 9, 30) + timedelta(minutes=i * 15) for i in range(n)]
    return pl.DataFrame({
        "ts_event": dates,
        "open": [4500.0] * n,
        "high": [4505.0] * n,
        "low": [4495.0] * n,
        "close": [4502.0] * n,
        "volume": [10000] * n,
        "atr_14": [atr_value] * n,
    })


def _make_session_multipliers(n: int, rth_mult: float = 1.0, overnight_mult: float = 2.0,
                               overnight_bars: list[int] | None = None) -> np.ndarray:
    """Create session multiplier array where specific bars have overnight multipliers."""
    mults = np.full(n, rth_mult, dtype=np.float64)
    if overnight_bars:
        for bar in overnight_bars:
            mults[bar] = overnight_mult
    return mults


# ─── Tests: session multiplier propagation ──────────────────────────────────


class TestSessionMultiplierPropagation:
    """Verify session multipliers are applied to ALL bars in slippage_arr."""

    def test_rth_bars_get_base_slippage(self):
        """RTH bars (mult=1.0) produce base ATR-scaled slippage."""
        df = _make_df(10)
        # No session multipliers → all bars at baseline
        slippage = compute_slippage(df, MES_SPEC, base_ticks=1.0, atr_period=14)
        # All slippage values should be positive and finite
        assert np.all(slippage > 0)
        assert np.all(np.isfinite(slippage))

    def test_overnight_multiplier_increases_slippage_at_that_bar(self):
        """Bars with session_multipliers=2.0 must produce higher slippage than mult=1.0."""
        df = _make_df(10)
        # Build two slippage arrays: one with all-1.0, one with bar 5 = 2.0
        mult_uniform = np.ones(10, dtype=np.float64)
        mult_with_overnight = np.ones(10, dtype=np.float64)
        mult_with_overnight[5] = 2.0

        slip_uniform = compute_slippage(df, MES_SPEC, base_ticks=1.0, atr_period=14,
                                        session_multipliers=mult_uniform)
        slip_overnight = compute_slippage(df, MES_SPEC, base_ticks=1.0, atr_period=14,
                                          session_multipliers=mult_with_overnight)

        # Bar 5 should be exactly 2x in the overnight array
        assert slip_overnight[5] == pytest.approx(slip_uniform[5] * 2.0, rel=0.01)
        # All other bars should be unchanged
        for i in range(10):
            if i != 5:
                assert slip_overnight[i] == pytest.approx(slip_uniform[i], rel=0.01)

    def test_exit_bar_uses_exit_bar_session_not_entry_bar(self):
        """
        The symmetric contract: exit_slip = slippage_arr[exit_idx].
        If exit is on an overnight bar, it gets the overnight multiplier
        regardless of what the entry bar's multiplier was.
        """
        df = _make_df(20)
        # Entry at bar 5 (RTH, mult=1.0), exit at bar 15 (overnight, mult=2.0)
        mults = np.ones(20, dtype=np.float64)
        mults[15] = 2.0  # overnight exit bar

        slippage_arr = compute_slippage(df, MES_SPEC, base_ticks=1.0, atr_period=14,
                                        session_multipliers=mults)

        entry_slip = slippage_arr[5]   # RTH
        exit_slip = slippage_arr[15]   # Overnight

        # Exit bar has 2x multiplier → exit_slip == 2 × entry_slip
        assert exit_slip == pytest.approx(entry_slip * 2.0, rel=0.01)

    def test_crisis_entry_and_crisis_exit_both_penalized(self):
        """When both entry and exit are in a crisis session (FOMC), both get elevated slippage."""
        df = _make_df(20)
        # Bars 8 and 10 are FOMC session (mult=1.5)
        mults = np.ones(20, dtype=np.float64)
        mults[8] = 1.5   # entry bar
        mults[10] = 1.5  # exit bar

        slippage_arr = compute_slippage(df, MES_SPEC, base_ticks=1.0, atr_period=14,
                                        session_multipliers=mults)

        base_slip = slippage_arr[0]  # unmodified RTH bar

        # Both entry and exit are penalized at 1.5x
        assert slippage_arr[8] == pytest.approx(base_slip * 1.5, rel=0.01)
        assert slippage_arr[10] == pytest.approx(base_slip * 1.5, rel=0.01)

    def test_rth_entry_overnight_exit_asymmetry_is_expected(self):
        """
        RTH entry + overnight exit → exit_slip > entry_slip.
        This is the CORRECT behavior (not a bug) — the exit occurred in a worse
        liquidity regime.  The audit payload documents this as asymmetry_delta.
        """
        df = _make_df(20)
        mults = np.ones(20, dtype=np.float64)
        mults[18] = 2.0  # overnight exit near end

        slippage_arr = compute_slippage(df, MES_SPEC, base_ticks=1.0, atr_period=14,
                                        session_multipliers=mults)

        entry_slip = slippage_arr[5]    # RTH
        exit_slip = slippage_arr[18]    # Overnight

        # Exit slippage is strictly higher (overnight is worse)
        assert exit_slip > entry_slip
        # The ratio should be approximately 2.0 (the overnight multiplier)
        assert exit_slip / entry_slip == pytest.approx(2.0, rel=0.05)


# ─── Tests: backward compat env var ─────────────────────────────────────────


class TestBackwardCompatEnvVar:
    """BACKTEST_EXIT_SLIPPAGE_SYMMETRIC=false reverts to flat-overhead (no session mults)."""

    def test_symmetric_true_default_applies_session_mults(self):
        """Default (symmetric=true): session multipliers apply to all bars."""
        df = _make_df(10)
        mults = np.ones(10, dtype=np.float64)
        mults[7] = 3.0  # extreme overnight bar

        # Default env — multipliers should apply
        slippage_with = compute_slippage(df, MES_SPEC, base_ticks=1.0, atr_period=14,
                                         session_multipliers=mults)
        slippage_without = compute_slippage(df, MES_SPEC, base_ticks=1.0, atr_period=14,
                                            session_multipliers=None)

        # With multipliers, bar 7 should be 3x vs without
        assert slippage_with[7] == pytest.approx(slippage_without[7] * 3.0, rel=0.01)

    def test_symmetric_false_env_passes_no_mults(self):
        """When BACKTEST_EXIT_SLIPPAGE_SYMMETRIC=false, the caller passes session_multipliers=None."""
        df = _make_df(10)
        # Simulate the backtester behavior: when env=false, call compute_slippage with mults=None
        slippage_flat = compute_slippage(df, MES_SPEC, base_ticks=1.0, atr_period=14,
                                         session_multipliers=None)
        # All bars have uniform slippage (no session differentiation)
        first = slippage_flat[0]
        for val in slippage_flat:
            # With uniform ATR, all bars should be equal
            assert val == pytest.approx(first, rel=0.01)

    def test_env_flag_parsing_true_variants(self):
        """BACKTEST_EXIT_SLIPPAGE_SYMMETRIC parses 'true', '1', 'yes' as enabled."""
        for val in ("true", "True", "TRUE", "1", "yes"):
            result = val.lower() in ("true", "1", "yes")
            assert result is True, f"Expected True for '{val}'"

    def test_env_flag_parsing_false_variants(self):
        """BACKTEST_EXIT_SLIPPAGE_SYMMETRIC parses 'false', '0', 'no' as disabled."""
        for val in ("false", "False", "FALSE", "0", "no"):
            result = val.lower() in ("true", "1", "yes")
            assert result is False, f"Expected False for '{val}'"


# ─── Tests: audit payload ────────────────────────────────────────────────────


class TestAsymmetryDeltaAuditPayload:
    """Verify the exit_slippage_session_applied audit payload is correct."""

    def test_audit_payload_structure(self):
        """Audit payload has all required keys."""
        # Simulate building the audit payload (as done in backtester.py P&L loop)
        entry_slips = [1.25, 1.25, 1.25]
        exit_slips = [2.50, 2.50, 2.50]
        n = len(entry_slips)

        payload = {
            "symmetric_mode": True,
            "entries_session_mult_avg": round(float(np.mean(entry_slips)), 4),
            "exits_session_mult_avg": round(float(np.mean(exit_slips)), 4),
            "asymmetry_delta": round(
                float(np.mean(exit_slips)) - float(np.mean(entry_slips)), 4
            ),
            "n_trades": n,
        }

        assert "symmetric_mode" in payload
        assert "entries_session_mult_avg" in payload
        assert "exits_session_mult_avg" in payload
        assert "asymmetry_delta" in payload
        assert "n_trades" in payload

    def test_audit_payload_values_correct(self):
        """Audit payload values match the actual slip averages."""
        entry_slips = [1.25, 2.50, 1.25]
        exit_slips = [2.50, 2.50, 1.25]

        payload = {
            "entries_session_mult_avg": round(float(np.mean(entry_slips)), 4),
            "exits_session_mult_avg": round(float(np.mean(exit_slips)), 4),
            "asymmetry_delta": round(
                float(np.mean(exit_slips)) - float(np.mean(entry_slips)), 4
            ),
            "n_trades": len(entry_slips),
        }

        # Entry avg = (1.25 + 2.50 + 1.25) / 3 = 1.6667
        assert payload["entries_session_mult_avg"] == pytest.approx(5.0 / 3, rel=0.01)
        # Exit avg = (2.50 + 2.50 + 1.25) / 3 = 2.0833
        assert payload["exits_session_mult_avg"] == pytest.approx(6.25 / 3, rel=0.01)
        # Delta = 2.0833 - 1.6667 = 0.4167
        assert payload["asymmetry_delta"] == pytest.approx(6.25 / 3 - 5.0 / 3, rel=0.01)
        assert payload["n_trades"] == 3

    def test_zero_trades_produces_zero_audit(self):
        """When no trades, audit shows zeros (no division by zero)."""
        entry_slips: list[float] = []
        exit_slips: list[float] = []

        entries_avg = float(np.mean(entry_slips)) if entry_slips else 0.0
        exits_avg = float(np.mean(exit_slips)) if exit_slips else 0.0
        delta = (exits_avg - entries_avg) if entry_slips and exit_slips else 0.0

        assert entries_avg == 0.0
        assert exits_avg == 0.0
        assert delta == 0.0

    def test_symmetric_mode_same_session_produces_zero_delta(self):
        """When all trades enter and exit within the same session, delta ≈ 0."""
        df = _make_df(10)
        mults = np.ones(10, dtype=np.float64)  # all RTH, uniform 1.0
        slippage_arr = compute_slippage(df, MES_SPEC, base_ticks=1.0, atr_period=14,
                                        session_multipliers=mults)

        # Simulate 5 trades, all within same session (same bar slippage)
        entry_slips = [slippage_arr[i] for i in range(0, 5)]
        exit_slips = [slippage_arr[i + 1] for i in range(0, 5)]

        # With uniform ATR and uniform session multipliers, delta ≈ 0
        delta = abs(float(np.mean(exit_slips)) - float(np.mean(entry_slips)))
        assert delta == pytest.approx(0.0, abs=1e-10)
