"""
Exponential decay fitting for strategy alpha.
Fits P&L curve to exponential decay model: P(t) = P0 * exp(-lambda*t)
Half-life = ln(2) / lambda
"""
import math
import os
from datetime import datetime, timezone

import numpy as np

# F-2: configurable grace period (days) for freshly-promoted strategies.
# During this window the decay verdict is forced to "pass" / stable so the
# critic does not quarantine a strategy before it has had time to accumulate
# meaningful live P&L. Set DECAY_GRACE_DAYS=0 to disable.
DECAY_GRACE_DAYS: int = int(os.environ.get("DECAY_GRACE_DAYS", "14"))


def _within_grace_period(promoted_at: datetime | str | None) -> bool:
    """Return True if promoted_at is within DECAY_GRACE_DAYS of now."""
    if promoted_at is None or DECAY_GRACE_DAYS <= 0:
        return False
    if isinstance(promoted_at, str):
        try:
            promoted_at = datetime.fromisoformat(promoted_at.replace("Z", "+00:00"))
        except ValueError:
            return False
    now = datetime.now(tz=timezone.utc)
    if promoted_at.tzinfo is None:
        promoted_at = promoted_at.replace(tzinfo=timezone.utc)
    age_days = (now - promoted_at).total_seconds() / 86400
    return age_days < DECAY_GRACE_DAYS


def fit_decay(
    daily_pnls: list[float],
    window: int = 60,
    promoted_at: datetime | str | None = None,
) -> dict:
    """
    Fit exponential decay to rolling performance metrics.

    Uses OLS on log-transformed rolling Sharpe to estimate decay rate.
    Falls back to linear regression if scipy unavailable.

    Returns:
        {
            "decay_detected": bool,
            "decay_rate": float,  # lambda -- higher = faster decay
            "half_life_days": float | None,  # ln(2)/lambda
            "r_squared": float,  # Fit quality
            "current_vs_peak": float,  # Current metric / peak metric ratio
            "trend": "stable" | "declining" | "accelerating_decline" | "improving",
        }
    """
    # F-2: short-circuit decay verdict during grace period so freshly-promoted
    # strategies are not quarantined before enough live P&L has accumulated.
    if _within_grace_period(promoted_at):
        return {
            "decay_detected": False,
            "decay_rate": 0.0,
            "half_life_days": None,
            "r_squared": 0.0,
            "current_vs_peak": 1.0,
            "trend": "stable",
            "_grace_period_active": True,
        }

    arr = np.array(daily_pnls, dtype=float)
    n = len(arr)

    if n < window:
        return {
            "decay_detected": False,
            "decay_rate": 0.0,
            "half_life_days": None,
            "r_squared": 0.0,
            "current_vs_peak": 1.0,
            "trend": "stable",
        }

    # Compute rolling Sharpe (annualized) over the window
    rolling_sharpes: list[float] = []
    for i in range(n - window + 1):
        chunk = arr[i : i + window]
        mean_val = float(np.mean(chunk))
        std_val = float(np.std(chunk, ddof=1))
        if std_val > 0:
            rolling_sharpes.append((mean_val / std_val) * math.sqrt(252))
        else:
            rolling_sharpes.append(0.0)

    if len(rolling_sharpes) < 2:
        return {
            "decay_detected": False,
            "decay_rate": 0.0,
            "half_life_days": None,
            "r_squared": 0.0,
            "current_vs_peak": 1.0,
            "trend": "stable",
        }

    sharpe_arr = np.array(rolling_sharpes)
    peak_sharpe = float(np.max(sharpe_arr))
    current_sharpe = float(sharpe_arr[-1])
    current_vs_peak = current_sharpe / peak_sharpe if peak_sharpe > 0 else 1.0

    # Fit linear regression to log-transformed positive Sharpes
    # log(S(t)) = log(S0) - lambda * t  =>  OLS on (t, log(S))
    positive_mask = sharpe_arr > 0.01  # Avoid log(0)
    t_vals = np.arange(len(sharpe_arr))

    if np.sum(positive_mask) < 3:
        # Not enough positive data points for log-fit; use raw linear trend.
        # Track E F-4: previously used slope < -0.01 and r_sq > 0.1 here, while the
        # log-transform branch used decay_rate > 0.005 and r_sq > 0.15 — inconsistent
        # thresholds caused false-negatives on negative-Sharpe strategies.
        # Both branches now use _detect_decay() with identical criteria.
        slope, intercept, r_sq = _linear_fit(t_vals, sharpe_arr)
        decay_rate = max(0.0, -slope)
        half_life = math.log(2) / decay_rate if decay_rate > 1e-9 else None
        trend = _classify_trend(slope, r_sq)
        return {
            "decay_detected": _detect_decay(slope, r_sq),
            "decay_rate": round(float(decay_rate), 6),
            "half_life_days": round(half_life, 1) if half_life is not None else None,
            "r_squared": round(float(r_sq), 4),
            "current_vs_peak": round(float(current_vs_peak), 4),
            "trend": trend,
        }

    # OLS on log-transformed data
    t_pos = t_vals[positive_mask]
    log_sharpe = np.log(sharpe_arr[positive_mask])
    slope, intercept, r_sq = _linear_fit(t_pos, log_sharpe)

    # decay_rate = -slope (negative slope means decay)
    decay_rate = max(0.0, -slope)
    half_life = math.log(2) / decay_rate if decay_rate > 1e-9 else None

    trend = _classify_trend(slope, r_sq)

    return {
        # Track E F-4: harmonized with fallback branch via _detect_decay().
        "decay_detected": _detect_decay(slope, r_sq),
        "decay_rate": round(float(decay_rate), 6),
        "half_life_days": round(half_life, 1) if half_life is not None else None,
        "r_squared": round(float(r_sq), 4),
        "current_vs_peak": round(float(current_vs_peak), 4),
        "trend": trend,
    }


def _detect_decay(slope: float, r_sq: float) -> bool:
    """Decay detected when slope is meaningfully negative regardless of code path.

    Track E F-4: single criterion used in BOTH the log-transform path and the
    raw-linear fallback path. Previously the two paths had divergent thresholds
    (0.01/0.10 vs 0.005/0.15) which caused false-negatives on negative-Sharpe
    strategies where few positive samples were available for log-fit.

    Chosen threshold: slope < -0.005 (consistent with _classify_trend declining
    boundary) and r_sq > 0.08 (lower than old log-branch 0.15, higher than old
    fallback 0.10 — balanced to avoid noise without missing real decay).
    """
    return slope < -0.005 and r_sq > 0.08


def _linear_fit(
    x: np.ndarray, y: np.ndarray
) -> tuple[float, float, float]:
    """Simple OLS linear fit. Returns (slope, intercept, r_squared)."""
    n = len(x)
    if n < 2:
        return 0.0, 0.0, 0.0

    x_mean = float(np.mean(x))
    y_mean = float(np.mean(y))

    ss_xy = float(np.sum((x - x_mean) * (y - y_mean)))
    ss_xx = float(np.sum((x - x_mean) ** 2))

    if ss_xx == 0:
        return 0.0, y_mean, 0.0

    slope = ss_xy / ss_xx
    intercept = y_mean - slope * x_mean

    y_pred = slope * x + intercept
    ss_res = float(np.sum((y - y_pred) ** 2))
    ss_tot = float(np.sum((y - y_mean) ** 2))

    r_squared = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    return slope, intercept, max(0.0, r_squared)


def _classify_trend(slope: float, r_squared: float) -> str:
    """Classify the trend based on slope and fit quality."""
    if r_squared < 0.1:
        return "stable"
    if slope > 0.005:
        return "improving"
    if slope < -0.02:
        return "accelerating_decline"
    if slope < -0.005:
        return "declining"
    return "stable"
