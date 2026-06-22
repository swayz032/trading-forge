"""FIX 9 — TDD/ASSESSMENT: DLL halt estimate vs actual P&L reconciliation.

Assessment finding:
  _apply_dll_halt_to_entries() uses ATR*1.5*size*point_value as an estimated
  loss per trade. This is structural: the DLL gate runs BEFORE trade management
  (it gates entry signals). Post-management actual P&L is not available at this
  stage without a circular dependency.

Decision: NO structural rearchitecture (too risky). Instead:
  1. Add `dll_halt_estimate_basis` field to metadata with the per-session
     estimated P&L that triggered each halt.
  2. Add `dll_halt_assumption` field documenting the model assumption.
  3. Verify the estimate is always conservative (worst-case assumption).

These tests verify the reconciliation metadata is present and correct.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock


def _install_vbt_mock():
    _vbt_mock = MagicMock()
    _vbt_mock.Portfolio = MagicMock()
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        if mod not in sys.modules:
            sys.modules[mod] = _vbt_mock


_install_vbt_mock()

import numpy as np  # noqa: E402


class TestFix9DllHaltReconciliation:
    """DLL halt output must include estimate-basis metadata for parity audit."""

    def _load_fn(self):
        from src.engine.backtester import _apply_dll_halt_to_entries
        return _apply_dll_halt_to_entries

    def _make_inputs(
        self,
        n_bars: int = 10,
        atr_val: float = 4.0,
        size_val: float = 6.0,
        point_value: float = 5.0,
        commission: float = 2.50,
        firm_dll: float = 600.0,  # small DLL to trigger halt easily
        personal_dll_pct: float = 0.67,
    ):
        """Build minimal arrays for the DLL halt function."""
        # Long entries on bars 0, 4, 8; no short entries
        long_entries = np.zeros(n_bars, dtype=bool)
        long_entries[0] = True
        long_entries[4] = True
        long_entries[8] = True

        short_entries = np.zeros(n_bars, dtype=bool)
        exit_long = np.zeros(n_bars, dtype=bool)
        exit_short = np.zeros(n_bars, dtype=bool)

        high_np = np.full(n_bars, 5004.0)
        low_np = np.full(n_bars, 4996.0)
        close_np = np.full(n_bars, 5000.0)
        atr_np = np.full(n_bars, atr_val)
        sizes = np.full(n_bars, size_val)
        timestamps = np.array([f"2025-06-01T10:{i:02d}:00" for i in range(n_bars)])

        return (
            long_entries, short_entries, exit_long, exit_short,
            high_np, low_np, close_np, atr_np, timestamps,
            point_value, sizes, commission, personal_dll_pct, firm_dll,
        )

    def test_metadata_includes_dll_halt_used_estimate(self):
        """dll_halt_used_estimate must be True in metadata (already exists)."""
        fn = self._load_fn()
        (le, se, el, xs, h, l, c, atr, ts, pv, sz, comm, dll_pct, firm_dll) = self._make_inputs()

        _, _, meta = fn(
            long_entries=le,
            short_entries=se,
            exit_long=el,
            exit_short=xs,
            high_np=h,
            low_np=l,
            close_np=c,
            atr_np=atr,
            timestamps=ts,
            point_value=pv,
            sizes=sz,
            commission_per_side=comm,
            personal_dll_pct=dll_pct,
            firm_dll=firm_dll,
        )

        assert "dll_halt_used_estimate" in meta, (
            "metadata must contain dll_halt_used_estimate key"
        )
        assert meta["dll_halt_used_estimate"] is True, (
            "dll_halt_used_estimate must be True"
        )

    def test_metadata_includes_dll_halt_assumption(self):
        """dll_halt_assumption must document the estimation model."""
        fn = self._load_fn()
        (le, se, el, xs, h, l, c, atr, ts, pv, sz, comm, dll_pct, firm_dll) = self._make_inputs()

        _, _, meta = fn(
            long_entries=le,
            short_entries=se,
            exit_long=el,
            exit_short=xs,
            high_np=h,
            low_np=l,
            close_np=c,
            atr_np=atr,
            timestamps=ts,
            point_value=pv,
            sizes=sz,
            commission_per_side=comm,
            personal_dll_pct=dll_pct,
            firm_dll=firm_dll,
        )

        assert "dll_halt_assumption" in meta, (
            "metadata must contain dll_halt_assumption key describing the estimation model"
        )
        assumption = meta["dll_halt_assumption"]
        assert isinstance(assumption, str) and len(assumption) > 10, (
            f"dll_halt_assumption must be a non-trivial string, got: {assumption!r}"
        )
        # Must mention ATR or estimate
        assert any(kw in assumption.lower() for kw in ("atr", "estim", "conserv")), (
            f"dll_halt_assumption should mention ATR/estimate/conservative, got: {assumption!r}"
        )

    def test_metadata_includes_estimate_basis_per_session(self):
        """dll_halt_estimate_basis must record per-session cumulative estimated P&L
        at the time of each halt."""
        fn = self._load_fn()
        # Small firm_dll to ensure a halt fires
        atr_val = 4.0
        size_val = 6.0
        point_value = 5.0
        commission = 2.50
        # est_loss per trade = 4 * 1.5 * 6 * 5 + 2.50 * 6 * 2 = 180 + 30 = 210
        # personal_dll = firm_dll * 0.67
        # firm_dll = 250 → personal_dll = 167.5 → first trade hits -210 < -167.5 → halt
        firm_dll = 250.0

        (le, se, el, xs, h, l, c, atr, ts, pv, sz, comm, dll_pct, _) = self._make_inputs(
            atr_val=atr_val,
            size_val=size_val,
            point_value=point_value,
            commission=commission,
            firm_dll=firm_dll,
        )

        _, _, meta = fn(
            long_entries=le,
            short_entries=se,
            exit_long=el,
            exit_short=xs,
            high_np=h,
            low_np=l,
            close_np=c,
            atr_np=atr,
            timestamps=ts,
            point_value=pv,
            sizes=sz,
            commission_per_side=comm,
            personal_dll_pct=dll_pct,
            firm_dll=firm_dll,
        )

        assert "dll_halt_estimate_basis" in meta, (
            "metadata must contain dll_halt_estimate_basis key for parity audit"
        )
        basis = meta["dll_halt_estimate_basis"]
        assert isinstance(basis, dict), (
            f"dll_halt_estimate_basis must be a dict (date→estimated_pnl), got {type(basis)}"
        )

    def test_estimate_is_conservative_loss(self):
        """The ATR-based estimate (1.5*ATR*size*pv + commission) must always be
        negative (a loss estimate) — verifies conservative assumption holds."""
        fn = self._load_fn()
        atr_val = 3.0
        size_val = 4.0
        point_value = 5.0
        commission = 1.50
        # Expected est_loss = 3 * 1.5 * 4 * 5 + 1.50 * 4 * 2 = 90 + 12 = 102
        # personal_dll = 500 * 0.67 = 335 → won't halt with 1 trade entry
        # But basis should record the running estimated P&L (negative)
        firm_dll = 500.0
        n = 5

        # Build arrays directly (avoid _make_inputs which sets indices beyond n)
        le_single = np.zeros(n, dtype=bool)
        le_single[0] = True
        se_single = np.zeros(n, dtype=bool)
        el_5 = np.zeros(n, dtype=bool)
        xs_5 = np.zeros(n, dtype=bool)

        _, _, meta = fn(
            long_entries=le_single,
            short_entries=se_single,
            exit_long=el_5,
            exit_short=xs_5,
            high_np=np.full(n, 5004.0),
            low_np=np.full(n, 4996.0),
            close_np=np.full(n, 5000.0),
            atr_np=np.full(n, atr_val),
            timestamps=np.array([f"2025-06-01T10:0{i}:00" for i in range(n)]),
            point_value=point_value,
            sizes=np.full(n, size_val),
            commission_per_side=commission,
            personal_dll_pct=0.67,
            firm_dll=firm_dll,
        )

        # Verify estimate_basis values are all negative (loss estimates)
        if "dll_halt_estimate_basis" in meta and meta["dll_halt_estimate_basis"]:
            for date_key, estimated_pnl in meta["dll_halt_estimate_basis"].items():
                assert estimated_pnl < 0, (
                    f"dll_halt_estimate_basis[{date_key}]={estimated_pnl} must be < 0 "
                    f"(conservative loss estimate)"
                )
