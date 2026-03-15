"""
6 sub-signals for decay detection.
Each signal independently detects a specific type of strategy degradation.
"""
import math

import numpy as np


def sharpe_decay(daily_pnls: list[float], window: int = 30) -> dict:
    """Rolling 30-day Sharpe ratio trend. Declining Sharpe = primary decay signal."""
    arr = np.array(daily_pnls, dtype=float)
    n = len(arr)

    if n < window + 5:
        return {"signal": "sharpe_decay", "score": 0.0, "detail": "Insufficient data"}

    # Compute rolling Sharpe
    sharpes: list[float] = []
    for i in range(n - window + 1):
        chunk = arr[i : i + window]
        mean_val = float(np.mean(chunk))
        std_val = float(np.std(chunk, ddof=1))
        sharpes.append((mean_val / std_val) * math.sqrt(252) if std_val > 0 else 0.0)

    sharpe_arr = np.array(sharpes)
    t = np.arange(len(sharpe_arr), dtype=float)

    # Linear regression on rolling Sharpe
    slope = _slope(t, sharpe_arr)

    # Normalize relative to the mean Sharpe level to avoid false positives on noisy-but-stable data.
    # A slope of -1% of mean per day is concerning.
    mean_sharpe = float(np.mean(sharpe_arr))
    if abs(mean_sharpe) > 0.1:
        # Relative slope: how fast is Sharpe decaying relative to its mean?
        relative_slope = slope / abs(mean_sharpe)
        raw_score = max(0.0, min(100.0, -relative_slope * 500))
    else:
        # Near-zero Sharpe: use absolute slope
        raw_score = max(0.0, min(100.0, -slope * 200))

    return {
        "signal": "sharpe_decay",
        "score": round(raw_score, 2),
        "slope": round(float(slope), 6),
        "latest_sharpe": round(float(sharpe_arr[-1]), 4),
        "peak_sharpe": round(float(np.max(sharpe_arr)), 4),
        "detail": f"Sharpe slope: {slope:.6f}/day",
    }


def mfe_decay(trades: list[dict], window: int = 20) -> dict:
    """
    Maximum Favorable Excursion shrinking over time.
    Shrinking MFE = winners getting smaller before win rate drops.
    This is the EARLIEST decay signal.
    """
    if len(trades) < window + 5:
        return {"signal": "mfe_decay", "score": 0.0, "detail": "Insufficient trades"}

    mfes = [float(t.get("mfe", 0)) for t in trades]
    mfe_arr = np.array(mfes, dtype=float)

    # Rolling mean MFE
    rolling_mfe: list[float] = []
    for i in range(len(mfe_arr) - window + 1):
        rolling_mfe.append(float(np.mean(mfe_arr[i : i + window])))

    rolling_arr = np.array(rolling_mfe)
    t = np.arange(len(rolling_arr), dtype=float)

    slope = _slope(t, rolling_arr)

    # Normalize: negative slope = shrinking MFE = decay
    peak_mfe = float(np.max(rolling_arr)) if len(rolling_arr) > 0 else 1.0
    if peak_mfe > 0:
        normalized_slope = slope / peak_mfe
    else:
        normalized_slope = 0.0

    raw_score = max(0.0, min(100.0, -normalized_slope * 5000))

    return {
        "signal": "mfe_decay",
        "score": round(raw_score, 2),
        "slope": round(float(slope), 6),
        "latest_avg_mfe": round(float(rolling_arr[-1]), 2) if len(rolling_arr) > 0 else 0.0,
        "peak_avg_mfe": round(peak_mfe, 2),
        "detail": f"MFE slope: {slope:.4f}/trade",
    }


def slippage_growth(trades: list[dict], window: int = 20) -> dict:
    """Expected vs actual fill price divergence growing. Market impact increasing."""
    if len(trades) < window + 5:
        return {"signal": "slippage_growth", "score": 0.0, "detail": "Insufficient trades"}

    slippages = [float(t.get("slippage", 0)) for t in trades]
    slip_arr = np.array(slippages, dtype=float)

    # Rolling mean slippage
    rolling_slip: list[float] = []
    for i in range(len(slip_arr) - window + 1):
        rolling_slip.append(float(np.mean(slip_arr[i : i + window])))

    rolling_arr = np.array(rolling_slip)
    t = np.arange(len(rolling_arr), dtype=float)

    slope = _slope(t, rolling_arr)

    # Positive slope = growing slippage = bad
    raw_score = max(0.0, min(100.0, slope * 2000))

    return {
        "signal": "slippage_growth",
        "score": round(raw_score, 2),
        "slope": round(float(slope), 6),
        "latest_avg_slippage": round(float(rolling_arr[-1]), 4) if len(rolling_arr) > 0 else 0.0,
        "detail": f"Slippage slope: {slope:.6f}/trade",
    }


def win_size_decay(trades: list[dict], window: int = 20) -> dict:
    """Average winning trade size shrinking (even if win rate holds)."""
    winners = [t for t in trades if float(t.get("pnl", 0)) > 0]

    if len(winners) < window + 5:
        return {"signal": "win_size_decay", "score": 0.0, "detail": "Insufficient winning trades"}

    win_pnls = np.array([float(t["pnl"]) for t in winners], dtype=float)

    # Rolling mean win size
    rolling_win: list[float] = []
    for i in range(len(win_pnls) - window + 1):
        rolling_win.append(float(np.mean(win_pnls[i : i + window])))

    rolling_arr = np.array(rolling_win)
    t = np.arange(len(rolling_arr), dtype=float)

    slope = _slope(t, rolling_arr)

    # Negative slope = shrinking winners
    peak_win = float(np.max(rolling_arr)) if len(rolling_arr) > 0 else 1.0
    if peak_win > 0:
        normalized_slope = slope / peak_win
    else:
        normalized_slope = 0.0

    raw_score = max(0.0, min(100.0, -normalized_slope * 5000))

    return {
        "signal": "win_size_decay",
        "score": round(raw_score, 2),
        "slope": round(float(slope), 6),
        "latest_avg_win": round(float(rolling_arr[-1]), 2) if len(rolling_arr) > 0 else 0.0,
        "peak_avg_win": round(peak_win, 2),
        "detail": f"Win size slope: {slope:.4f}/trade",
    }


def regime_mismatch(
    strategy_regime: str,
    current_regime: str,
    regime_history: list[dict] | None = None,
) -> dict:
    """
    Strategy's preferred regime doesn't match current market.
    Uses Phase 4.9 regime graph data.
    """
    if not strategy_regime or not current_regime:
        return {"signal": "regime_mismatch", "score": 0.0, "detail": "No regime data"}

    matched = strategy_regime.upper() == current_regime.upper()

    if matched:
        score = 0.0
        detail = f"Regime match: strategy prefers {strategy_regime}, current is {current_regime}"
    else:
        score = 60.0  # Base mismatch penalty
        detail = f"Regime MISMATCH: strategy prefers {strategy_regime}, current is {current_regime}"

        # Check how long we've been in the wrong regime
        if regime_history:
            consecutive_wrong = 0
            for entry in reversed(regime_history):
                if entry.get("regime", "").upper() != strategy_regime.upper():
                    consecutive_wrong += 1
                else:
                    break
            # More days in wrong regime = higher score
            score = min(100.0, 60.0 + consecutive_wrong * 2.0)
            detail += f" for {consecutive_wrong} periods"

    return {
        "signal": "regime_mismatch",
        "score": round(score, 2),
        "strategy_regime": strategy_regime,
        "current_regime": current_regime,
        "matched": matched,
        "detail": detail,
    }


def fill_rate_decay(trades: list[dict], window: int = 20) -> dict:
    """Limit order fill rate declining. Liquidity at entry level drying up."""
    if len(trades) < window + 5:
        return {"signal": "fill_rate_decay", "score": 0.0, "detail": "Insufficient trades"}

    # Compute per-trade fill indicator: 1 if filled, 0 if not
    # If no fill_status field, assume all filled (score = 0)
    has_fill_data = any("fill_status" in t for t in trades)
    if not has_fill_data:
        return {"signal": "fill_rate_decay", "score": 0.0, "detail": "No fill rate data available"}

    fills = np.array(
        [1.0 if t.get("fill_status", "filled") == "filled" else 0.0 for t in trades],
        dtype=float,
    )

    # Rolling fill rate
    rolling_fill: list[float] = []
    for i in range(len(fills) - window + 1):
        rolling_fill.append(float(np.mean(fills[i : i + window])))

    rolling_arr = np.array(rolling_fill)
    t = np.arange(len(rolling_arr), dtype=float)

    slope = _slope(t, rolling_arr)

    # Negative slope = declining fill rate
    raw_score = max(0.0, min(100.0, -slope * 5000))

    return {
        "signal": "fill_rate_decay",
        "score": round(raw_score, 2),
        "slope": round(float(slope), 6),
        "latest_fill_rate": round(float(rolling_arr[-1]), 4) if len(rolling_arr) > 0 else 1.0,
        "detail": f"Fill rate slope: {slope:.6f}/trade",
    }


# ─── Weights ────────────────────────────────────────────────────

SIGNAL_WEIGHTS = {
    "sharpe_decay": 0.25,
    "mfe_decay": 0.20,
    "slippage_growth": 0.10,
    "win_size_decay": 0.20,
    "regime_mismatch": 0.15,
    "fill_rate_decay": 0.10,
}


def composite_decay_score(
    daily_pnls: list[float],
    trades: list[dict],
    strategy_regime: str = "",
    current_regime: str = "",
    regime_history: list[dict] | None = None,
) -> dict:
    """
    Combine all 6 sub-signals into a composite decay score (0-100).
    Higher = more decay detected.

    Weights:
    - sharpe_decay: 0.25
    - mfe_decay: 0.20 (earliest signal, high weight)
    - slippage_growth: 0.10
    - win_size_decay: 0.20
    - regime_mismatch: 0.15
    - fill_rate_decay: 0.10
    """
    signals: dict[str, dict] = {}

    signals["sharpe_decay"] = sharpe_decay(daily_pnls)
    signals["mfe_decay"] = mfe_decay(trades)
    signals["slippage_growth"] = slippage_growth(trades)
    signals["win_size_decay"] = win_size_decay(trades)
    signals["regime_mismatch"] = regime_mismatch(
        strategy_regime, current_regime, regime_history
    )
    signals["fill_rate_decay"] = fill_rate_decay(trades)

    # Weighted composite
    composite = 0.0
    for name, weight in SIGNAL_WEIGHTS.items():
        composite += signals[name]["score"] * weight

    return {
        "composite_score": round(composite, 2),
        "signals": signals,
        "weights": SIGNAL_WEIGHTS,
    }


# ─── Helper ─────────────────────────────────────────────────────

def _slope(x: np.ndarray, y: np.ndarray) -> float:
    """Simple OLS slope."""
    n = len(x)
    if n < 2:
        return 0.0
    x_mean = float(np.mean(x))
    y_mean = float(np.mean(y))
    ss_xy = float(np.sum((x - x_mean) * (y - y_mean)))
    ss_xx = float(np.sum((x - x_mean) ** 2))
    if ss_xx == 0:
        return 0.0
    return ss_xy / ss_xx
