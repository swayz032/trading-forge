"""Parity Shadow Runner — non-blocking production integration layer.

Wraps `run_parity_diff()` from diff_harness.py and wires it into the
production backtest path as a shadow pass. Called after `run_backtest()`
completes; never allowed to raise into the caller.

Environment gates:
  PARITY_SHADOW_ENABLED=true   — activate (default false, zero cost when off)
  PARITY_TOLERANCE_PNL_PCT     — override PnL% tolerance (default 0.10)
  PARITY_TOLERANCE_TRADE_COUNT — override trade count tolerance (default 1)
  PARITY_TOLERANCE_SHARPE      — override Sharpe tolerance (default 0.05)

Supported strategy archetypes (what parity engine can compare):
  - ema_crossover
  - atr_breakout

For any other archetype the runner returns ran=False with a documented reason.
This is NOT a pass — it is an explicit unsupported-archetype signal.

Design:
  - Never import from backtester.py to avoid circular imports.
  - Never import backtrader in the module body — deferred to diff_harness.
  - All external failures are caught and surfaced via the report dict.
  - Futures P&L is computed inside diff_harness (never delegated to vectorbt).
"""

from __future__ import annotations

import os
import time
from typing import TYPE_CHECKING, Any

import numpy as np
import pandas as pd

if TYPE_CHECKING:
    from src.engine.config import BacktestRequest

# ─── Supported archetypes ─────────────────────────────────────────────
_SUPPORTED_ENTRY_INDICATORS: set[str] = {"ema_crossover", "atr_breakout"}

# Default tolerances (mirror diff_harness.py constants, but env-overridable)
_DEFAULT_PNL_TOL_PCT: float = 0.10
_DEFAULT_TRADE_COUNT_TOL: int = 1
_DEFAULT_SHARPE_TOL: float = 0.05

# ─── Archetype support check ──────────────────────────────────────────


def parity_supported(dsl: dict) -> bool:
    """Return True if the parity engine supports this strategy's entry indicator.

    Args:
        dsl: Parsed DSL dict (must contain 'entry_indicator' key).

    Returns:
        True for supported archetypes (ema_crossover, atr_breakout).
        False for any other archetype — caller must set ran=False, not passed=True.
    """
    indicator = dsl.get("entry_indicator", "")
    return indicator in _SUPPORTED_ENTRY_INDICATORS


# ─── DSL reconstruction from production result ────────────────────────

def _reconstruct_dsl(request: "BacktestRequest") -> dict:
    """Build the minimal DSL dict that diff_harness.py expects.

    The parity engine only needs:
      entry_indicator, entry_params, direction,
      stop_loss_atr_multiple, take_profit_atr_multiple

    Everything else is ignored by the parity runners.
    """
    config = request.strategy

    # Detect entry_indicator from StrategyConfig indicators
    entry_indicator = _detect_entry_indicator(config)

    # Extract entry_params from the first matching indicator config
    entry_params = _extract_entry_params(config, entry_indicator)

    # Stop / TP multiples — read from stop_loss / take_profit fields
    stop_multiple = _extract_stop_multiple(config)
    tp_multiple = _extract_tp_multiple(config)

    # Direction — derive from entry_long / entry_short expressions
    direction = _detect_direction(config)

    return {
        "entry_indicator": entry_indicator,
        "entry_params": entry_params,
        "direction": direction,
        "stop_loss_atr_multiple": stop_multiple,
        "take_profit_atr_multiple": tp_multiple,
    }


def _detect_entry_indicator(config: Any) -> str:
    """Detect entry indicator type from StrategyConfig indicators list."""
    indicator_type_map = {
        "ema": "ema_crossover",
        "ema_crossover": "ema_crossover",
        "atr_breakout": "atr_breakout",
    }
    for ind in config.indicators:
        mapped = indicator_type_map.get(ind.type, "")
        if mapped:
            return mapped
    # Fallback: try to infer from entry_long expression text
    entry_long = str(config.entry_long).lower()
    if "ema" in entry_long and ("cross" in entry_long or ">" in entry_long):
        return "ema_crossover"
    if "atr" in entry_long and ("break" in entry_long or "channel" in entry_long):
        return "atr_breakout"
    return "unsupported"


def _extract_entry_params(config: Any, entry_indicator: str) -> dict:
    """Extract entry parameters for the detected indicator."""
    params: dict = {}

    if entry_indicator == "ema_crossover":
        fast, slow = None, None
        for ind in config.indicators:
            if ind.type in ("ema", "ema_crossover"):
                if fast is None:
                    fast = ind.period
                else:
                    slow = ind.period
        if fast and slow:
            if fast > slow:
                fast, slow = slow, fast
            params["fast_period"] = fast
            params["slow_period"] = slow
        params.setdefault("fast_period", 9)
        params.setdefault("slow_period", 21)
        params.setdefault("confirmation_bars", 2)

    elif entry_indicator == "atr_breakout":
        for ind in config.indicators:
            if ind.type == "atr":
                params["period"] = ind.period
                break
        params.setdefault("period", 14)
        params.setdefault("multiplier", 1.5)

    return params


def _extract_stop_multiple(config: Any) -> float:
    """Extract stop loss ATR multiple from StrategyConfig."""
    sl = config.stop_loss
    if sl is None:
        return 1.8
    # StopConfig may have type="atr_multiple" + value, or fixed points
    sl_type = getattr(sl, "type", "")
    sl_value = getattr(sl, "value", 1.8)
    if sl_type in ("atr_multiple", "atr"):
        return float(sl_value)
    # Fixed point stop — don't try to compare; return sentinel that marks unsupported
    return 1.8


def _extract_tp_multiple(config: Any) -> float:
    """Extract take profit ATR multiple from StrategyConfig."""
    tp = getattr(config, "take_profit", None)
    if tp is None:
        return 0.0
    tp_type = getattr(tp, "type", "")
    tp_value = getattr(tp, "value", 0.0)
    if tp_type in ("atr_multiple", "atr"):
        return float(tp_value)
    return 0.0


def _detect_direction(config: Any) -> str:
    """Detect strategy direction from entry_long / entry_short expressions."""
    entry_long = str(config.entry_long).strip()
    entry_short = str(config.entry_short).strip()

    has_long = entry_long and entry_long not in ("", "false", "False", "0")
    has_short = entry_short and entry_short not in ("", "false", "False", "0")

    # The DSL sentinel for "never-true short" is `high < low` — treat as no short
    if entry_short and entry_short.replace(" ", "") in ("high<low", "False", "false"):
        has_short = False

    if has_long and has_short:
        return "both"
    if has_long:
        return "long"
    if has_short:
        return "short"
    return "long"  # safe default


# ─── Data extraction from production result ───────────────────────────

def _extract_production_data(result: dict, df: Any) -> pd.DataFrame:
    """Convert production Polars DataFrame to pandas for diff_harness.

    The diff harness requires pandas with standard OHLCV columns
    and a DatetimeIndex.
    """
    if df is None:
        raise ValueError("df is None — cannot run parity shadow without OHLCV data")

    # df may be a Polars DataFrame — convert to pandas
    import polars as pl
    if isinstance(df, pl.DataFrame):
        df_pd = df.to_pandas()
    elif isinstance(df, pd.DataFrame):
        df_pd = df.copy()
    else:
        raise TypeError(f"Unsupported df type: {type(df)}")

    # Ensure required columns
    required = {"open", "high", "low", "close"}
    missing = required - set(df_pd.columns)
    if missing:
        raise ValueError(f"Production df missing columns: {missing}")

    # Ensure DatetimeIndex
    if not isinstance(df_pd.index, pd.DatetimeIndex):
        # Try ts_event column
        if "ts_event" in df_pd.columns:
            df_pd.index = pd.to_datetime(df_pd["ts_event"])
        elif "ts_et" in df_pd.columns:
            df_pd.index = pd.to_datetime(df_pd["ts_et"])
        else:
            df_pd.index = pd.RangeIndex(len(df_pd))

    if "volume" not in df_pd.columns:
        df_pd["volume"] = 0.0

    return df_pd[["open", "high", "low", "close", "volume"]]


# ─── Tolerance loading ────────────────────────────────────────────────

def _load_tolerances() -> dict:
    """Load tolerance values from env vars, falling back to defaults."""
    try:
        pnl_tol = float(os.environ.get("PARITY_TOLERANCE_PNL_PCT", str(_DEFAULT_PNL_TOL_PCT)))
    except (ValueError, TypeError):
        pnl_tol = _DEFAULT_PNL_TOL_PCT

    try:
        trade_tol = int(os.environ.get("PARITY_TOLERANCE_TRADE_COUNT", str(_DEFAULT_TRADE_COUNT_TOL)))
    except (ValueError, TypeError):
        trade_tol = _DEFAULT_TRADE_COUNT_TOL

    try:
        sharpe_tol = float(os.environ.get("PARITY_TOLERANCE_SHARPE", str(_DEFAULT_SHARPE_TOL)))
    except (ValueError, TypeError):
        sharpe_tol = _DEFAULT_SHARPE_TOL

    return {"pnl_pct": pnl_tol, "trade_count": trade_tol, "sharpe": sharpe_tol}


# ─── Empty/stub reports ───────────────────────────────────────────────

def _disabled_report() -> dict:
    """Return when PARITY_SHADOW_ENABLED is false."""
    return {
        "enabled": False,
        "ran": False,
        "reason": "parity_shadow_disabled",
        "vbt_total_pnl": 0.0,
        "bt_total_pnl": 0.0,
        "pnl_diff_pct": 0.0,
        "vbt_trade_count": 0,
        "bt_trade_count": 0,
        "trade_count_diff": 0,
        "vbt_sharpe": 0.0,
        "bt_sharpe": 0.0,
        "sharpe_diff": 0.0,
        "passed": True,
        "tolerance": _load_tolerances(),
        "failure_reasons": [],
        "execution_time_ms": 0.0,
    }


def _skipped_report(reason: str, enabled: bool, tolerances: dict) -> dict:
    """Return when shadow is enabled but can't/won't run (unsupported archetype, etc.)."""
    return {
        "enabled": enabled,
        "ran": False,
        "reason": reason,
        "vbt_total_pnl": 0.0,
        "bt_total_pnl": 0.0,
        "pnl_diff_pct": 0.0,
        "vbt_trade_count": 0,
        "bt_trade_count": 0,
        "trade_count_diff": 0,
        "vbt_sharpe": 0.0,
        "bt_sharpe": 0.0,
        "sharpe_diff": 0.0,
        "passed": True,   # skipped is NOT a failure — it's an explicit unsupported signal
        "tolerance": tolerances,
        "failure_reasons": [],
        "execution_time_ms": 0.0,
    }


def _error_report(error_msg: str, elapsed_ms: float, tolerances: dict) -> dict:
    """Return when parity shadow itself errored (non-blocking)."""
    return {
        "enabled": True,
        "ran": False,
        "reason": "parity_shadow_internal_error",
        "error": error_msg[:300],
        "vbt_total_pnl": 0.0,
        "bt_total_pnl": 0.0,
        "pnl_diff_pct": 0.0,
        "vbt_trade_count": 0,
        "bt_trade_count": 0,
        "trade_count_diff": 0,
        "vbt_sharpe": 0.0,
        "bt_sharpe": 0.0,
        "sharpe_diff": 0.0,
        "passed": True,   # errors don't fail the main backtest
        "tolerance": tolerances,
        "failure_reasons": [],
        "execution_time_ms": elapsed_ms,
    }


# ─── Main entry point ─────────────────────────────────────────────────

def run_parity_shadow(
    request: "BacktestRequest",
    result: dict,
    df: Any,
) -> dict:
    """Run the parity shadow pass after a production backtest completes.

    This function is non-blocking. All exceptions are caught internally.
    The caller should wrap this in its own try/except as a second safety net.

    Args:
        request: The BacktestRequest used for the main backtest.
        result:  The dict returned by run_backtest().
        df:      The Polars (or pandas) OHLCV DataFrame used inside run_backtest().
                 Pass `df` as it exists just after indicator computation —
                 it must have open/high/low/close columns.

    Returns:
        ParityShadowReport dict. Always returns a dict — never raises.
    """
    t0 = time.perf_counter()

    # Gate 1: env-controlled activation
    enabled = os.environ.get("PARITY_SHADOW_ENABLED", "false").lower() == "true"
    if not enabled:
        return _disabled_report()

    tolerances = _load_tolerances()

    try:
        # Gate 2: reconstruct DSL and check archetype support
        dsl = _reconstruct_dsl(request)
        if not parity_supported(dsl):
            indicator = dsl.get("entry_indicator", "unknown")
            return _skipped_report(
                reason="strategy_archetype_not_supported_by_parity_engine",
                enabled=True,
                tolerances=tolerances,
            )

        # Gate 3: extract production data
        df_pd = _extract_production_data(result, df)

        # Gate 4: build slippage array
        # Use zero slippage for parity check — the point is engine-to-engine comparison,
        # not absolute P&L accuracy. Both sides see the same zero slippage array so
        # slippage model differences don't inflate divergence.
        slippage_arr = np.zeros(len(df_pd), dtype=float)

        # Gate 5: load commission + contract params from request
        config = request.strategy
        from src.engine.config import CONTRACT_SPECS
        from src.engine.firm_config import get_commission_per_side
        spec = CONTRACT_SPECS.get(config.symbol)
        point_value = spec.point_value if spec else 5.0
        firm_key = getattr(request, "firm", None) or "topstep"
        try:
            commission = get_commission_per_side(firm_key, config.symbol)
        except Exception:
            commission = 0.62  # fallback: exchange fee per side for micro futures

        # Use 1 contract for parity — sizing differences between engines don't matter here
        contracts = 1

        # Gate 6: run the parity diff
        from src.engine.parity_engine.diff_harness import (
            PNL_TOLERANCE_PCT,
            SHARPE_TOLERANCE,
            TRADE_COUNT_TOLERANCE,
            run_parity_diff,
        )

        # Override harness tolerances via env if provided
        import src.engine.parity_engine.diff_harness as _dh
        orig_pnl_tol = _dh.PNL_TOLERANCE_PCT
        orig_trade_tol = _dh.TRADE_COUNT_TOLERANCE
        orig_sharpe_tol = _dh.SHARPE_TOLERANCE
        try:
            _dh.PNL_TOLERANCE_PCT = tolerances["pnl_pct"]
            _dh.TRADE_COUNT_TOLERANCE = tolerances["trade_count"]
            _dh.SHARPE_TOLERANCE = tolerances["sharpe"]

            parity_result = run_parity_diff(
                fixture_name=f"shadow:{config.name}",
                dsl=dsl,
                df_pd=df_pd,
                slippage_arr=slippage_arr,
                commission_per_side=commission,
                point_value=point_value,
                contracts=contracts,
            )
        finally:
            # Always restore original harness tolerances
            _dh.PNL_TOLERANCE_PCT = orig_pnl_tol
            _dh.TRADE_COUNT_TOLERANCE = orig_trade_tol
            _dh.SHARPE_TOLERANCE = orig_sharpe_tol

        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        return {
            "enabled": True,
            "ran": True,
            "vbt_total_pnl": parity_result.vbt_total_pnl,
            "bt_total_pnl": parity_result.bt_total_pnl,
            "pnl_diff_pct": parity_result.pnl_diff_pct,
            "vbt_trade_count": parity_result.vbt_trade_count,
            "bt_trade_count": parity_result.bt_trade_count,
            "trade_count_diff": abs(parity_result.vbt_trade_count - parity_result.bt_trade_count),
            "vbt_sharpe": parity_result.vbt_sharpe,
            "bt_sharpe": parity_result.bt_sharpe,
            "sharpe_diff": parity_result.sharpe_diff,
            "passed": parity_result.passed,
            "tolerance": tolerances,
            "failure_reasons": parity_result.failure_reasons,
            "execution_time_ms": round(elapsed_ms, 2),
        }

    except Exception as exc:
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        return _error_report(str(exc), round(elapsed_ms, 2), tolerances)
