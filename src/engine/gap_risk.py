"""Overnight gap risk model — gap distributions and trade tagging.

Per CLAUDE.md: Don't ignore overnight gap risk — strategies holding
across sessions need gap-adjusted MAE and drawdown.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
import polars as pl


# ─── Historical Gap Distributions (in points) ───────────────────
# Derived from multi-year session open vs prior close analysis.

GAP_DISTRIBUTIONS: dict[str, dict[str, float]] = {
    "MES": {"normal_mean": 10, "normal_std": 5, "crisis_mean": 50, "crisis_std": 25},
    "MNQ": {"normal_mean": 40, "normal_std": 20, "crisis_mean": 150, "crisis_std": 75},
    "MCL": {"normal_mean": 0.50, "normal_std": 0.25, "crisis_mean": 3.0, "crisis_std": 1.5},
}


def compute_overnight_gaps(df: pl.DataFrame) -> pl.Series:
    """Compute gap at each session open (close-to-open difference).

    Detects session boundaries by date change in timestamps.

    Args:
        df: DataFrame with ts_event and close columns

    Returns:
        Polars Series of gap values (0 for non-session-open bars)
    """
    ts = df["ts_event"]
    dates = ts.dt.date()
    close = df["close"]
    open_col = df["open"]

    # Session open = first bar of each new date
    date_list = dates.to_list()
    date_shifted = [None] + date_list[:-1]
    date_changed = np.array(
        [d != s for d, s in zip(date_list, date_shifted)],
        dtype=bool,
    )

    # Gap = open of new session - close of prior bar
    prior_close = close.shift(1)
    raw_gaps = (open_col - prior_close).fill_null(0.0).to_numpy().astype(np.float64)

    # Zero out gaps for non-session-open bars
    raw_gaps[~date_changed] = 0.0

    return pl.Series("overnight_gap", raw_gaps)


def tag_trades_overnight(
    trades: list[dict],
    timestamps: pl.Series,
) -> list[dict]:
    """Tag each trade with hold_type: INTRADAY_ONLY or HOLDS_OVERNIGHT.

    A trade holds overnight if its entry and exit span different dates (ET).

    Args:
        trades: List of trade dicts (must have entry/exit indices or timestamps)
        timestamps: Full bar timestamp series for index lookup

    Returns:
        trades list with added 'hold_type' field
    """
    ts = timestamps
    # If timezone-aware, Polars extracts ET components directly.
    # If naive, assume already ET (consistent with rest of codebase).
    tz = getattr(ts.dtype, 'time_zone', None)
    if tz is not None:
        # Timezone-aware: convert to ET for correct date boundaries
        et = ts.dt.convert_time_zone("America/New_York")
        dates = et.dt.date().to_list()
    else:
        # Naive timestamps: assume UTC, cast then convert to ET
        et = ts.cast(pl.Datetime("ns", "UTC")).dt.convert_time_zone("America/New_York")
        dates = et.dt.date().to_list()

    tagged = []
    for trade in trades:
        t = dict(trade)

        # Try to get entry/exit bar indices
        entry_idx = trade.get("Entry Index", trade.get("entry_idx", 0))
        exit_idx = trade.get("Exit Index", trade.get("exit_idx", entry_idx))

        # Clamp to valid range
        entry_idx = max(0, min(int(entry_idx), len(dates) - 1))
        exit_idx = max(0, min(int(exit_idx), len(dates) - 1))

        entry_date = dates[entry_idx]
        exit_date = dates[exit_idx]

        if entry_date != exit_date:
            t["hold_type"] = "HOLDS_OVERNIGHT"
        else:
            t["hold_type"] = "INTRADAY_ONLY"

        tagged.append(t)

    return tagged


def compute_gap_adjusted_mae(
    trades: list[dict],
    gaps: pl.Series,
    symbol: str = "MES",
    seed: int | None = None,
) -> list[dict]:
    """Add simulated gap exposure to overnight trades' MAE.

    For trades tagged HOLDS_OVERNIGHT, sample a gap from the symbol's
    normal distribution and add to the trade's MAE (maximum adverse excursion).

    Args:
        trades: Tagged trades (must have hold_type)
        gaps: Overnight gap series from compute_overnight_gaps
        symbol: Contract symbol for gap distribution lookup
        seed: RNG seed for reproducibility

    Returns:
        trades with added 'gap_adjusted_mae' field
    """
    rng = np.random.default_rng(seed)
    dist = GAP_DISTRIBUTIONS.get(symbol, GAP_DISTRIBUTIONS["MES"])

    adjusted = []
    for trade in trades:
        t = dict(trade)
        raw_mae = abs(trade.get("MAE", trade.get("mae", 0.0)))

        if trade.get("hold_type") == "HOLDS_OVERNIGHT":
            # Sample a gap from normal distribution (absolute value)
            gap = abs(rng.normal(dist["normal_mean"], dist["normal_std"]))
            t["gap_adjusted_mae"] = round(raw_mae + gap, 2)
            t["simulated_gap"] = round(gap, 2)
        else:
            t["gap_adjusted_mae"] = round(raw_mae, 2)
            t["simulated_gap"] = 0.0

        adjusted.append(t)

    return adjusted


def compute_gap_adjusted_drawdown(
    equity_curve: list[float],
    trades: list[dict],
    gaps: pl.Series,
    symbol: str = "MES",
    point_value: float = 5.0,
    seed: int | None = None,
) -> float:
    """Compute worst-case drawdown accounting for overnight gap risk.

    For each overnight trade, adds the simulated gap * point_value to the
    drawdown calculation.

    Args:
        equity_curve: Original equity curve values
        trades: Tagged trades with hold_type
        gaps: Overnight gap series
        symbol: Contract symbol
        point_value: Dollar value per point for the symbol
        seed: RNG seed

    Returns:
        Gap-adjusted maximum drawdown (positive number, in dollars)
    """
    if not equity_curve or len(equity_curve) < 2:
        return 0.0

    rng = np.random.default_rng(seed)
    dist = GAP_DISTRIBUTIONS.get(symbol, GAP_DISTRIBUTIONS["MES"])

    # Start with original equity
    equity = np.array(equity_curve, dtype=np.float64)

    # Add gap impact for overnight trades
    overnight_trades = [t for t in trades if t.get("hold_type") == "HOLDS_OVERNIGHT"]
    for trade in overnight_trades:
        exit_idx = trade.get("Exit Index", trade.get("exit_idx", None))
        if exit_idx is None:
            continue

        exit_idx = int(exit_idx)
        if exit_idx + 1 >= len(equity):
            continue

        # Simulate adverse gap
        gap_points = abs(rng.normal(dist["normal_mean"], dist["normal_std"]))
        gap_dollars = gap_points * point_value

        # Subtract gap impact from bars AFTER exit (gap manifests on next session open)
        equity[exit_idx + 1:] -= gap_dollars

    # Compute max drawdown on gap-adjusted equity
    running_max = np.maximum.accumulate(equity)
    drawdowns = running_max - equity
    max_dd = float(np.max(drawdowns))

    return round(max_dd, 2)
