"""Structural break detection for strategy drift and regime shifts.

Uses ruptures for PELT/Binseg change-point detection with numpy fallback.
"""
from __future__ import annotations

import numpy as np

try:
    import ruptures
    RUPTURES_AVAILABLE = True
except ImportError:
    RUPTURES_AVAILABLE = False


def detect_changepoints(
    signal: np.ndarray,
    method: str = "pelt",
    penalty: float | None = None,
    n_bkps: int | None = None,
    min_size: int = 20,
) -> dict:
    """Detect structural breaks in a time series.

    Args:
        signal: 1D array (daily P&L, win rate, Sharpe, etc.)
        method: "pelt" | "binseg" | "dynp" | "kernel"
        penalty: PELT penalty (auto-calibrated via BIC if None)
        n_bkps: Number of breakpoints (for binseg/dynp; ignored by pelt)
        min_size: Minimum segment length

    Returns:
        {breakpoints, segments, method, n_changes}
    """
    signal = np.asarray(signal, dtype=np.float64)
    n = len(signal)

    if n < min_size * 2:
        return {"breakpoints": [], "segments": [], "method": method, "n_changes": 0}

    if penalty is None:
        # Auto-calibrate: use median absolute deviation for robustness
        # Lower penalty = more sensitive to changes (better for trading)
        mad = float(np.median(np.abs(signal - np.median(signal))))
        penalty = max(np.log(n) * mad * 2.0, 1.0)

    if not RUPTURES_AVAILABLE:
        return _fallback_changepoint(signal, min_size)

    try:
        if method == "pelt":
            algo = ruptures.Pelt(model="l2", min_size=min_size).fit(signal)
            bkps = algo.predict(pen=penalty)
        elif method == "binseg":
            algo = ruptures.Binseg(model="l2", min_size=min_size).fit(signal)
            bkps = algo.predict(n_bkps=n_bkps or 3)
        elif method == "dynp":
            algo = ruptures.Dynp(model="l2", min_size=min_size).fit(signal)
            bkps = algo.predict(n_bkps=n_bkps or 3)
        elif method == "kernel":
            algo = ruptures.KernelCPD(kernel="rbf", min_size=min_size).fit(signal)
            bkps = algo.predict(pen=penalty)
        else:
            return _fallback_changepoint(signal, min_size)
    except Exception:
        return _fallback_changepoint(signal, min_size)

    # Build segments
    segments = []
    prev = 0
    for bp in bkps:
        bp = min(bp, n)
        if bp <= prev:
            continue
        seg = signal[prev:bp]
        segments.append({
            "start": int(prev),
            "end": int(bp),
            "mean": float(np.mean(seg)),
            "std": float(np.std(seg)),
            "n": len(seg),
        })
        prev = bp

    return {
        "breakpoints": [int(b) for b in bkps if b < n],
        "segments": segments,
        "method": method,
        "n_changes": len([b for b in bkps if b < n]),
    }


def _fallback_changepoint(signal: np.ndarray, min_size: int) -> dict:
    """Simple CUSUM-like fallback when ruptures is not available."""
    n = len(signal)
    if n < min_size * 2:
        return {"breakpoints": [], "segments": [], "method": "fallback_cusum", "n_changes": 0}

    cumsum = np.cumsum(signal - np.mean(signal))
    # Find point of max absolute deviation from linear trend
    max_idx = int(np.argmax(np.abs(cumsum)))

    if max_idx < min_size or max_idx > n - min_size:
        return {
            "breakpoints": [],
            "segments": [{"start": 0, "end": n, "mean": float(np.mean(signal)), "std": float(np.std(signal)), "n": n}],
            "method": "fallback_cusum",
            "n_changes": 0,
        }

    seg1 = signal[:max_idx]
    seg2 = signal[max_idx:]
    # Only report if means differ by > 1 std
    if abs(np.mean(seg1) - np.mean(seg2)) > np.std(signal):
        return {
            "breakpoints": [max_idx],
            "segments": [
                {"start": 0, "end": max_idx, "mean": float(np.mean(seg1)), "std": float(np.std(seg1)), "n": len(seg1)},
                {"start": max_idx, "end": n, "mean": float(np.mean(seg2)), "std": float(np.std(seg2)), "n": len(seg2)},
            ],
            "method": "fallback_cusum",
            "n_changes": 1,
        }

    return {
        "breakpoints": [],
        "segments": [{"start": 0, "end": n, "mean": float(np.mean(signal)), "std": float(np.std(signal)), "n": n}],
        "method": "fallback_cusum",
        "n_changes": 0,
    }


def detect_strategy_edge_death(
    daily_pnls: np.ndarray,
    rolling_sharpe: np.ndarray | None = None,
    window: int = 5,
) -> dict:
    """Composite change-point detection for edge degradation.

    Runs PELT on daily P&L and rolling Sharpe. If 2+ signals show
    breakpoint in same window → edge death confirmed.
    """
    pnl_breaks = detect_changepoints(daily_pnls, method="pelt")

    if rolling_sharpe is not None and len(rolling_sharpe) > 40:
        sharpe_breaks = detect_changepoints(rolling_sharpe, method="pelt")
    else:
        sharpe_breaks = {"breakpoints": [], "n_changes": 0}

    # Find coincident breakpoints (within `window` days)
    coincident = _find_coincident_breaks(
        pnl_breaks["breakpoints"],
        sharpe_breaks["breakpoints"],
        window=window,
    )

    return {
        "pnl_breaks": pnl_breaks,
        "sharpe_breaks": sharpe_breaks,
        "coincident_breaks": coincident,
        "edge_death_detected": len(coincident) > 0,
        "death_day": coincident[0] if coincident else None,
    }


def _find_coincident_breaks(
    breaks_a: list[int],
    breaks_b: list[int],
    window: int = 5,
) -> list[int]:
    """Find breakpoints that occur within `window` of each other."""
    coincident = []
    for a in breaks_a:
        for b in breaks_b:
            if abs(a - b) <= window:
                coincident.append(min(a, b))
                break
    return sorted(set(coincident))


# ─── CLI Entry Point ─────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import sys

    config_raw = sys.stdin.read() if not sys.argv[1:] else sys.argv[1]
    try:
        config = json.loads(config_raw)
    except Exception:
        config = json.load(sys.stdin)

    mode = config.get("mode", "detect")

    if mode == "edge_death":
        daily_pnls = np.array(config["daily_pnls"], dtype=float)
        rolling_sharpe = np.array(config.get("rolling_sharpe", []), dtype=float) if config.get("rolling_sharpe") else None
        result = detect_strategy_edge_death(daily_pnls, rolling_sharpe)
    else:
        signal = np.array(config["signal"], dtype=float)
        result = detect_changepoints(signal, method=config.get("method", "pelt"))

    print(json.dumps(result, default=str))
