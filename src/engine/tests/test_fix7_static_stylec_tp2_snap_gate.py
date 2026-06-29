"""F-2 (2026-06-29) — TDD: static_styleC must NOT pass liquidity_snapshot to
compute_single_tp; flat structural-only TP must be used so paper parity holds.

Bug: _apply_manage_trades() extracted _static_liq_snapshot from adaptive_ctx and
passed it to _apply_static_styleC_management() → compute_single_tp(). A non-empty
live liquidity snapshot would snap TP2 to an intraday level (e.g. 1.7R instead of
2.0R+), diverging from:
  - The _USE_PARTIALS path (BACKTEST_STATIC_C_PARTIALS_ENABLED=True) which hard-codes
    tp2_price = entry + TP2_AT_R_C (2.0R flat).
  - The TS style-c-exit-evaluator.ts which also uses TP2_AT_R_C = 2.0.

Fix (Option B): gate snap OFF — always pass liquidity_snapshot=None to
_apply_static_styleC_management, ensuring structural-only TP (>= 2R DOL or skip).

Design: mock vectorbt, inject a liquidity level at exactly 1.7R, then verify
compute_single_tp gets liquidity_snapshot=None and does NOT snap to the 1.7R level.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch


# ── vectorbt mock (JIT blocks test env) ─────────────────────────────────────────
def _install_vbt_mock():
    _vbt_mock = MagicMock()
    for mod in ("vectorbt", "vectorbt.portfolio", "vectorbt.portfolio.base"):
        if mod not in sys.modules:
            sys.modules[mod] = _vbt_mock

_install_vbt_mock()

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402


class _Spec:
    tick_size = 0.25
    point_value = 5.0
    symbol = "MES"


def _make_minimal_df(n: int = 6, entry_p: float = 5000.0, atr_val: float = 4.0):
    """Return a minimal DataFrame and aligned numpy arrays for the static manager."""
    ts_base = pd.Timestamp("2026-01-10 09:35:00", tz="UTC")
    ts = [ts_base + pd.Timedelta(minutes=i * 5) for i in range(n)]
    close = [entry_p] * n
    high  = [entry_p + 2.0] * n
    low   = [entry_p - 2.0] * n
    open_ = [entry_p] * n
    atr   = [atr_val] * n
    df = pd.DataFrame({"timestamp": ts, "close": close, "high": high, "low": low, "open": open_})
    return (
        df,
        np.array(high, dtype=float),
        np.array(low, dtype=float),
        np.array(close, dtype=float),
        np.array(atr, dtype=float),
        np.array(open_, dtype=float),
    )


def _make_trade(entry_idx: int = 0, entry_p: float = 5000.0, exit_idx: int = 5,
                exit_p: float = 4994.0, size: float = 1.0, direction: str = "long"):
    """Return a minimal trades DataFrame matching vectorbt portfolio output columns.

    _apply_static_styleC_management calls trades_records.iterrows() and reads
    the canonical vectorbt column names (Avg Entry Price, Avg Exit Price, etc.).
    Must be a DataFrame, not a dict.
    """
    direction_str = "Long Entry" if "long" in direction.lower() else "Short Entry"
    return pd.DataFrame({
        "Avg Entry Price": [entry_p],
        "Avg Exit Price": [exit_p],
        "Size": [size],
        "Direction": [direction_str],
        "Entry Idx": [entry_idx],
        "Exit Idx": [exit_idx],
    })


# ── F-2 regression: compute_single_tp receives liquidity_snapshot=None ──────────

def test_static_stylec_passes_none_liquidity_snapshot_to_compute_single_tp():
    """_apply_static_styleC_management must pass liquidity_snapshot=None.

    Verifies that even if an adaptive_ctx carries a real liquidity level at 1.7R,
    the static path ignores it (Option B parity gate).
    """
    from src.engine.backtester import _apply_trade_management

    df, high_np, low_np, close_np, atr_np, open_np = _make_minimal_df()
    trade = _make_trade()

    # Liquidity level at 1.7R (inside the 1.4R–2.6R snap band)
    entry_p = 5000.0
    risk_pts = 6.0  # min(6, 4.0 * 1.5) for MES
    snap_level = entry_p + 1.7 * risk_pts  # 5010.2 (would be snapped to if passed)

    class _FakeLiqLevel:
        level_type = "BSL"
        price = snap_level

    class _FakeAdaptiveCtx:
        liquidity_snapshot = [_FakeLiqLevel()]
        regime_at_entry = "normal"
        pre_lunch_threshold_r = 0.3

    captured_calls: list[dict] = []

    original_apply_static = None
    try:
        import src.engine.backtester as _bt
        original_apply_static = _bt._apply_static_styleC_management
    except AttributeError:
        pass

    def _recording_static(*args, **kwargs):
        captured_calls.append({"liquidity_snapshot": kwargs.get("liquidity_snapshot", "NOT_PASSED")})
        if original_apply_static:
            return original_apply_static(*args, **kwargs)
        return []

    with patch("src.engine.backtester._apply_static_styleC_management", side_effect=_recording_static):
        _apply_trade_management(
            trades_records=trade,  # DataFrame, not list — _apply_static_styleC_management calls .iterrows()
            high_np=high_np,
            low_np=low_np,
            close_np=close_np,
            atr_np=atr_np,
            spec=_Spec(),
            htf_cache=None,
            df=df,
            open_np=open_np,
            exit_engine="static_styleC",
            adaptive_ctx=_FakeAdaptiveCtx(),
        )

    assert len(captured_calls) == 1, "Expected _apply_static_styleC_management to be called once"
    captured_snap = captured_calls[0]["liquidity_snapshot"]
    # F-2 invariant: static_styleC always receives None — never a live liquidity snapshot
    assert captured_snap is None, (
        f"F-2 REGRESSION: static_styleC received liquidity_snapshot={captured_snap!r} "
        f"instead of None. The snap gate is broken — TP2 may snap to {snap_level:.2f} "
        f"(1.7R) instead of staying at flat 2.0R+."
    )


def test_static_stylec_tp2_does_not_snap_to_intraday_level():
    """With liquidity_snapshot=None, compute_single_tp uses structural TP (>=2R or skip).

    Verifies that the non-partials path produces a TP >= 2R (or inf/skip), not the
    1.7R level that would have been selected if liquidity_snapshot were passed.
    """
    from src.engine.context.structural_targets import compute_single_tp

    entry_p = 5000.0
    risk_pts = 6.0
    snap_level = entry_p + 1.7 * risk_pts  # 5010.2 — the "would-snap" level
    min_2r = entry_p + 2.0 * risk_pts      # 5012.0 — minimum structural TP

    # With liquidity_snapshot=None: no snap, result is structural (>=2R) or None
    result_no_snap = compute_single_tp(
        direction="long",
        entry_price=entry_p,
        stop_price=entry_p - risk_pts,
        liquidity_snapshot=None,
    )

    # The snap level (1.7R = 5010.2) should NOT be selected
    if result_no_snap is not None:
        assert result_no_snap >= min_2r, (
            f"compute_single_tp with no snap returned {result_no_snap:.2f} < min 2R ({min_2r:.2f})"
        )
        assert abs(result_no_snap - snap_level) > 0.1, (
            f"compute_single_tp returned {result_no_snap:.2f} which is suspiciously "
            f"close to the 1.7R snap level {snap_level:.2f} — snap gate may be broken"
        )
    # None is also valid (no structural level >= 2R found) — not a failure
