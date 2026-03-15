"""Fill probability model — realistic order execution simulation.

Per CLAUDE.md: Don't assume limit orders always fill — model fill
probability, especially for mean reversion entries at extremes.
"""

from __future__ import annotations

import numpy as np
import polars as pl


# ─── Default Fill Probabilities ──────────────────────────────────

DEFAULT_FILL_CONFIG = {
    "order_type": "market",
    "limit_at_current": 0.95,
    "limit_1_tick": 0.80,
    "limit_at_sr": 0.60,
    "limit_at_extreme": 0.50,
    "partial_fill_threshold": 0.70,
}


def compute_fill_probabilities(
    df: pl.DataFrame,
    config: dict,
    entries: np.ndarray,
) -> np.ndarray:
    """Compute fill probability for each entry bar.

    For market orders: always 1.0 (guaranteed fill).
    For limit orders: use RSI as proxy for "extreme" entries.
      - RSI > 70 or < 30 at entry → limit_at_extreme (0.50)
      - Otherwise → limit_at_current (0.95)

    Args:
        df: DataFrame with indicator columns (needs rsi_* for limit orders)
        config: Fill probability configuration dict
        entries: Boolean numpy array of entry signals

    Returns:
        numpy float array of fill probabilities per bar
    """
    n = len(df)
    order_type = config.get("order_type", "market")

    if order_type == "market":
        return np.ones(n, dtype=np.float64)

    # Limit order fill probabilities
    fill_probs = np.full(n, config.get("limit_at_current", 0.95), dtype=np.float64)

    # Find RSI column
    rsi_col = None
    for col in df.columns:
        if col.startswith("rsi_"):
            rsi_col = col
            break

    if rsi_col is not None:
        rsi_values = df[rsi_col].to_numpy().astype(np.float64)
        # Extreme RSI = lower fill probability
        extreme_mask = (rsi_values > 70) | (rsi_values < 30)
        fill_probs[extreme_mask] = config.get("limit_at_extreme", 0.50)

        # Moderate RSI (near S/R levels) = medium fill probability
        sr_mask = ((rsi_values > 60) & (rsi_values <= 70)) | \
                  ((rsi_values >= 30) & (rsi_values < 40))
        fill_probs[sr_mask] = config.get("limit_at_sr", 0.60)

    return fill_probs


def apply_fill_model(
    entries: np.ndarray,
    fill_probs: np.ndarray,
    sizes: np.ndarray,
    seed: int | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Apply fill probability model to entries and sizes.

    - Roll dice per entry bar: if random > fill_prob, entry is masked out
    - Partial fills: when fill_prob < threshold, reduce size to 50%

    Args:
        entries: Boolean array of entry signals
        fill_probs: Float array of fill probabilities
        sizes: Float array of position sizes
        seed: RNG seed for reproducibility

    Returns:
        (filtered_entries, adjusted_sizes) — modified copies
    """
    rng = np.random.default_rng(seed)
    n = len(entries)

    filtered_entries = entries.copy()
    adjusted_sizes = sizes.copy()

    # Only process actual entry bars
    entry_mask = entries.astype(bool)
    entry_indices = np.where(entry_mask)[0]

    for idx in entry_indices:
        prob = fill_probs[idx]
        roll = rng.random()

        if roll > prob:
            # No fill — mask out this entry
            filtered_entries[idx] = False
        elif prob < DEFAULT_FILL_CONFIG["partial_fill_threshold"]:
            # Partial fill — reduce size to 50%
            adjusted_sizes[idx] = max(1, int(adjusted_sizes[idx] * 0.5))

    return filtered_entries, adjusted_sizes
