"""Pre-session signal collection — gathers all inputs for skip classifier."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from src.engine.skip_engine.calendar_filter import calendar_check


def _get_event_proximity(check_date: date) -> dict[str, Any] | None:
    """
    Check if a high-impact economic event (FOMC, CPI, NFP) is near check_date.
    Uses the economic_calendar module if available, falls back to None.
    """
    try:
        from src.engine.economic_calendar import STATIC_EVENTS

        nearest_event = None
        nearest_days = 999

        for event_type, events in STATIC_EVENTS.items():
            for event in events:
                event_date = datetime.strptime(event["date"], "%Y-%m-%d").date()
                days_away = abs((event_date - check_date).days)
                if days_away < nearest_days:
                    nearest_days = days_away
                    nearest_event = event_type

        if nearest_days <= 2 and nearest_event:
            return {
                "event": nearest_event,
                "days_until": nearest_days,
                "impact": "high",
            }
    except ImportError:
        pass

    return None


def _calculate_consecutive_losses(daily_pnls: list[float]) -> int:
    """Count consecutive losing days from the end of the P&L list."""
    if not daily_pnls:
        return 0

    count = 0
    for pnl in reversed(daily_pnls):
        if pnl < 0:
            count += 1
        else:
            break
    return count


def _calculate_monthly_dd_usage(
    monthly_pnl: float | None,
    monthly_dd_limit: float | None,
) -> float | None:
    """
    Calculate what percentage of the monthly drawdown budget has been used.
    Returns a fraction (0.0-1.0+).
    """
    if monthly_pnl is None or monthly_dd_limit is None or monthly_dd_limit == 0:
        return None

    # If monthly P&L is negative, usage = |loss| / dd_limit
    if monthly_pnl < 0:
        return abs(monthly_pnl) / monthly_dd_limit
    return 0.0


def collect_premarket_signals(
    strategy_id: str,
    check_date: date | None = None,
    daily_pnls: list[float] | None = None,
    portfolio_correlations: dict | None = None,
    monthly_dd_limit: float | None = None,
    monthly_pnl: float | None = None,
    overnight_gap_atr: float | None = None,
    premarket_volume_pct: float | None = None,
    vix: float | None = None,
    bad_days: list[str] | None = None,
) -> dict[str, Any]:
    """
    Collect and package all pre-market signals for the skip classifier.
    Some signals come from external sources (VIX, volume), others from DB (P&L history).

    Args:
        strategy_id: Strategy identifier.
        check_date: Date to evaluate (defaults to today).
        daily_pnls: Recent daily P&L history for loss streak calculation.
        portfolio_correlations: Dict of strategy correlations.
        monthly_dd_limit: Monthly drawdown budget in dollars.
        monthly_pnl: Current month P&L in dollars.
        overnight_gap_atr: Overnight gap size in ATR multiples.
        premarket_volume_pct: Pre-market volume as fraction of normal (0.0-1.0+).
        vix: Current VIX level.
        bad_days: List of day names that are historically bad for this strategy.

    Returns:
        A signals dict ready for classify_session().
    """
    if check_date is None:
        check_date = date.today()

    # Calendar info
    cal = calendar_check(check_date)

    # Event proximity
    event_prox = _get_event_proximity(check_date)

    # Consecutive losses
    consecutive_losses = _calculate_consecutive_losses(daily_pnls or [])

    # Monthly DD usage
    dd_usage = _calculate_monthly_dd_usage(monthly_pnl, monthly_dd_limit)

    # Max portfolio correlation for this strategy
    max_corr: float | None = None
    if portfolio_correlations:
        # Expect {strategy_pair: correlation_value}
        corr_values = [
            v for k, v in portfolio_correlations.items()
            if strategy_id in str(k)
        ]
        if corr_values:
            max_corr = max(corr_values)

    signals: dict[str, Any] = {
        "day_of_week": cal["day_of_week"],
        "calendar": {
            "holiday_proximity": cal["holiday_proximity"],
            "triple_witching": cal["is_triple_witching"],
            "roll_week": cal["is_roll_week"],
        },
    }

    if event_prox:
        signals["event_proximity"] = event_prox

    if vix is not None:
        signals["vix"] = vix

    if overnight_gap_atr is not None:
        signals["overnight_gap_atr"] = overnight_gap_atr

    if premarket_volume_pct is not None:
        signals["premarket_volume_pct"] = premarket_volume_pct

    if consecutive_losses > 0:
        signals["consecutive_losses"] = consecutive_losses

    if dd_usage is not None:
        signals["monthly_dd_usage_pct"] = dd_usage

    if max_corr is not None:
        signals["portfolio_correlation"] = max_corr

    if bad_days:
        signals["bad_days"] = bad_days

    return signals
