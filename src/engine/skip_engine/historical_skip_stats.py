"""Backtest the skip engine itself — would skipping have improved results?"""

from __future__ import annotations

from typing import Any

from src.engine.skip_engine.skip_classifier import classify_session


def backtest_skip_engine(
    daily_pnls: list[dict[str, Any]],  # [{date, pnl, signals}]
    skip_threshold: float = 6.0,
    reduce_threshold: float = 3.0,
    reduce_size_factor: float = 0.5,
) -> dict[str, Any]:
    """
    Replay daily P&Ls with the skip engine applied.

    Each entry in daily_pnls must have:
        - "date": str or date
        - "pnl": float (original P&L)
        - "signals": dict (signals for classify_session)

    Args:
        daily_pnls: List of daily records with P&L and signal data.
        skip_threshold: Score threshold for SKIP decision.
        reduce_threshold: Score threshold for REDUCE decision.
        reduce_size_factor: Fraction of position size when REDUCE (e.g. 0.5 = half size).

    Returns:
        {
            "original_pnl": float,
            "skip_adjusted_pnl": float,
            "improvement_pct": float,
            "days_skipped": int,
            "days_reduced": int,
            "days_traded_full": int,
            "skip_accuracy": float,  # % of skipped days that would have been losers
            "false_skips": int,      # Profitable days that were skipped
            "saved_losses": float,   # Total loss avoided by skipping
        }
    """
    # Override thresholds for this backtest run
    import src.engine.skip_engine.skip_classifier as sc

    original_skip = sc.SKIP_SCORE_THRESHOLD
    original_reduce = sc.REDUCE_SCORE_THRESHOLD
    sc.SKIP_SCORE_THRESHOLD = skip_threshold
    sc.REDUCE_SCORE_THRESHOLD = reduce_threshold

    try:
        original_total = 0.0
        adjusted_total = 0.0
        days_skipped = 0
        days_reduced = 0
        days_traded_full = 0
        skipped_losers = 0  # Skipped days that WERE losers (correct skips)
        false_skips = 0     # Skipped days that were profitable (missed gains)
        saved_losses = 0.0

        for record in daily_pnls:
            pnl = record.get("pnl", 0.0)
            signals = record.get("signals", {})

            original_total += pnl

            result = classify_session(signals)
            decision = result["decision"]

            if decision == "SKIP":
                days_skipped += 1
                # P&L is 0 for this day (we didn't trade)
                if pnl < 0:
                    skipped_losers += 1
                    saved_losses += abs(pnl)
                elif pnl > 0:
                    false_skips += 1
                # adjusted_total += 0  (skipped)

            elif decision == "REDUCE":
                days_reduced += 1
                adjusted_pnl = pnl * reduce_size_factor
                adjusted_total += adjusted_pnl

            else:  # TRADE
                days_traded_full += 1
                adjusted_total += pnl

        total_skipped = days_skipped
        skip_accuracy = (
            skipped_losers / total_skipped if total_skipped > 0 else 0.0
        )

        improvement_pct = 0.0
        if abs(original_total) > 0.01:
            improvement_pct = (
                (adjusted_total - original_total) / abs(original_total) * 100
            )
        elif adjusted_total > original_total:
            # Original was ~0, adjusted is positive = infinite improvement, cap at 100%
            improvement_pct = 100.0
        elif adjusted_total < original_total:
            improvement_pct = -100.0

        return {
            "original_pnl": round(original_total, 2),
            "skip_adjusted_pnl": round(adjusted_total, 2),
            "improvement_pct": round(improvement_pct, 2),
            "days_skipped": days_skipped,
            "days_reduced": days_reduced,
            "days_traded_full": days_traded_full,
            "skip_accuracy": round(skip_accuracy, 4),
            "false_skips": false_skips,
            "saved_losses": round(saved_losses, 2),
        }

    finally:
        # Restore original thresholds
        sc.SKIP_SCORE_THRESHOLD = original_skip
        sc.REDUCE_SCORE_THRESHOLD = original_reduce
