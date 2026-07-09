"""Fill probability model — realistic order execution simulation.

Per CLAUDE.md: Don't assume limit orders always fill — model fill
probability, especially for mean reversion entries at extremes.

Wave 27.5 Pass C.1 — HIGH #6: Probabilistic volume-based partial fill model.
Large-size orders (order_qty > BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD × bar_volume)
experience degraded fill probability. Orders larger than bar_volume are forced-partial.

Control via env vars:
  BACKTEST_PARTIAL_FILL_ENABLED         (default: "true")  — opt-OUT to disable
  BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD (default: "0.1")  — fraction of bar volume
                                          above which fill probability degrades

P&L contract: fill model outputs adjusted sizes (integer contracts); P&L is always
computed by backtester.py using the futures formula:
  net_pnl = (exit - entry) × contracts × point_value - slippage - commission
Never passed to vectorbt slippage/fees (CLAUDE.md hard rule for futures).
"""

from __future__ import annotations

import os
import sys
from functools import lru_cache

import numpy as np
import polars as pl

from src.engine.config import CONTRACT_SPECS
from src.engine.monte_carlo import create_authoritative_rng

# ─── Default Fill Probabilities ──────────────────────────────────

DEFAULT_FILL_CONFIG = {
    "order_type": "market",
    "limit_at_current": 0.95,
    "limit_1_tick": 0.80,
    "limit_at_sr": 0.60,
    "limit_at_extreme": 0.50,
    "partial_fill_threshold": 0.70,
}

# ─── Volume-Based Partial Fill (HIGH #6) ─────────────────────────
# M-5 fix (2026-06-29): replaced module-level frozen reads with lru_cache getter
# functions so tests can call cache_clear() + set env → get the new value.
# Module-level frozen reads were a test-isolation hazard: patch.dict(os.environ, ...)
# did not affect _PARTIAL_FILL_ENABLED / _PARTIAL_FILL_VOLUME_THRESHOLD after import.
#
# Usage in tests:
#   import fill_model
#   fill_model._get_partial_fill_enabled.cache_clear()
#   fill_model._get_partial_fill_volume_threshold.cache_clear()
#   os.environ["BACKTEST_PARTIAL_FILL_ENABLED"] = "false"
#   # now the getter returns False for the lifetime of this test


@lru_cache(maxsize=1)
def _get_partial_fill_enabled() -> bool:
    """Read BACKTEST_PARTIAL_FILL_ENABLED at call time (cached; clear for tests)."""
    return os.environ.get("BACKTEST_PARTIAL_FILL_ENABLED", "true").lower() in ("true", "1", "yes")


@lru_cache(maxsize=1)
def _get_partial_fill_volume_threshold() -> float:
    """Read BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD at call time (cached; clear for tests)."""
    return float(os.environ.get("BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD", "0.1"))


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
        extreme_mask = (rsi_values >= 70) | (rsi_values <= 30)
        fill_probs[extreme_mask] = config.get("limit_at_extreme", 0.50)

        # Moderate RSI (near S/R levels) = medium fill probability
        sr_mask = ((rsi_values > 60) & (rsi_values < 70)) | \
                  ((rsi_values > 30) & (rsi_values < 40))
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
    # Fix 3: use authoritative PCG64DXSM RNG for replay-deterministic fill simulation.
    # np.random.default_rng() uses SFC64 which differs from the PCG64DXSM used by monte_carlo.py,
    # causing RNG family mismatch and non-reproducible cross-module replay.
    rng = create_authoritative_rng(seed)[0]

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
            if not np.isnan(adjusted_sizes[idx]):
                adjusted_sizes[idx] = max(1, int(adjusted_sizes[idx] * 0.5))

    return filtered_entries, adjusted_sizes


# ─── V2 Spread-Aware Fill Model ─────────────────────────────────


def estimate_spread_ticks(
    atr_values: np.ndarray,
    contract_tick_size: float,
    base_spread_ticks: float = 1.0,
) -> np.ndarray:
    """Estimate spread in ticks based on ATR regime.

    Normal vol: 1 tick. ATR > 75th percentile: 2 ticks. ATR > 90th: 3 ticks.
    """
    spreads = np.full(len(atr_values), base_spread_ticks)

    # Compute ATR percentiles (ignoring NaN)
    valid_atr = atr_values[~np.isnan(atr_values)]
    if len(valid_atr) < 10:
        return spreads

    p75 = np.percentile(valid_atr, 75)
    p90 = np.percentile(valid_atr, 90)

    spreads[atr_values > p75] = base_spread_ticks * 2.0
    spreads[atr_values > p90] = base_spread_ticks * 3.0

    return spreads


def compute_fill_probabilities_v2(
    df: pl.DataFrame,
    config: dict,
    entries: np.ndarray,
    order_type: str = "market",
    symbol: str = "MES",
    spread_multiplier: float = 1.0,
) -> np.ndarray:
    """V2 fill model with order-type-specific behavior and spread awareness.

    - Market: 1.0 (guaranteed fill)
    - Limit: RSI logic + spread adjustment
    - Stop-market: 1.0 fill (but slippage.py applies 2x slippage)
    - Stop-limit: RSI base * 0.85 (price may gap through)

    Keep existing compute_fill_probabilities() unchanged for backward compat.
    """
    n = len(df)

    if order_type == "market":
        return np.ones(n, dtype=np.float64)

    if order_type in ("stop", "stop_market"):
        # P1-E fix: stop-market orders are prohibited per CLAUDE.md.
        # Raise here so no live or backtest path silently uses stop-market semantics.
        # This guard covers callers that bypass FillProbabilityConfig validation
        # and call compute_fill_probabilities_v2() directly with order_type="stop".
        raise ValueError(
            f"order_type='{order_type}' is prohibited (CLAUDE.md: stop-market orders "
            "cause catastrophic slippage in live futures). Use 'stop_limit' instead."
        )

    # Base probabilities (same as v1 for limit orders)
    fill_probs = np.full(n, config.get("limit_at_current", 0.95), dtype=np.float64)

    # RSI-based adjustment (same as v1)
    rsi_col = None
    for col in df.columns:
        if col.startswith("rsi_"):
            rsi_col = col
            break

    if rsi_col is not None:
        rsi_values = df[rsi_col].to_numpy().astype(np.float64)
        extreme_mask = (rsi_values >= 70) | (rsi_values <= 30)
        fill_probs[extreme_mask] = config.get("limit_at_extreme", 0.50)

        sr_mask = ((rsi_values > 60) & (rsi_values < 70)) | \
                  ((rsi_values > 30) & (rsi_values < 40))
        fill_probs[sr_mask] = config.get("limit_at_sr", 0.60)

    # Spread-aware adjustment for limit orders
    atr_col = None
    for col in df.columns:
        if col.startswith("atr_"):
            atr_col = col
            break

    if atr_col is not None:
        atr_values = df[atr_col].to_numpy().astype(np.float64)
        spec = CONTRACT_SPECS.get(symbol)
        tick_size = spec.tick_size if spec else config.get("tick_size", 0.25)
        spreads = estimate_spread_ticks(atr_values, tick_size) * spread_multiplier

        # When spread > 1 tick, limit orders at the bid/ask are less likely to fill
        # 1 tick spread = normal, 2+ ticks = reduce fill prob by 5% per extra tick
        spread_penalty = np.clip((spreads - 1.0) * 0.05, 0, 0.20)
        fill_probs = fill_probs * (1.0 - spread_penalty)

    if order_type == "stop_limit":
        # Stop-limit: further reduce by 15% (price may gap through the limit)
        fill_probs = fill_probs * 0.85

    return fill_probs


# ─── Volume-Based Partial Fill Model (Wave 27.5 Pass C.1 — HIGH #6) ─────────


def compute_volume_based_fill_ratios(
    df: pl.DataFrame,
    order_quantities: np.ndarray,
    volume_threshold: float | None = None,
) -> np.ndarray:
    """Compute per-bar fill ratio based on order size relative to bar volume.

    HIGH #6 — Partial Fills NOT Modeled: Large-size strategies (≥50 MES) backtest
    optimistic by 1-3 ticks on overnight entries because 100% fill is assumed.
    This function models fill ratio degradation when order quantity is large
    relative to available bar volume.

    Rules:
      - order_qty / bar_volume < threshold → 1.0 (full fill)
      - order_qty / bar_volume in [threshold, 1.0] → linear degradation from 1.0 to 0.5
      - order_qty / bar_volume > 1.0 → 0.5 (forced partial; can never fill more than
        the available volume gracefully; 0.5 is the minimum fill ratio)

    The minimum fill ratio is 0.5 (never zero) — a partial fill is always attempted
    for market orders; complete non-fills are modeled by the RSI-based fill probability
    gate in apply_fill_model(), not here. These two models compose:
      1. RSI/type-based fill probability (apply this entry? yes/no)
      2. Volume-based fill ratio (if yes, how many contracts?)

    Args:
        df: DataFrame with 'volume' column (or returns 1.0 array if absent)
        order_quantities: Per-bar order quantity (contract count) array
        volume_threshold: Fraction of bar volume above which degradation begins
            (default: BACKTEST_PARTIAL_FILL_VOLUME_THRESHOLD env var, default 0.1)

    Returns:
        Float array of fill ratios in [0.5, 1.0] per bar.
        Values are 1.0 for bars with no entry or sufficient volume.
    """
    # M-5: resolve default via getter (re-reads env; cache_clear() in tests → isolation)
    if volume_threshold is None:
        volume_threshold = _get_partial_fill_volume_threshold()

    # B-12 fix (deepscan17, 2026-07-05): validate volume_threshold before it
    # reaches the zone-2 linear-interpolation denominator. An out-of-range
    # value (env misconfiguration: negative, >=1.0, or non-finite) either
    # divides by a near-zero/negative denominator or shifts zone 2's input
    # domain so ratio_in_zone leaves [0,1] — producing fill_ratios outside the
    # documented [0.5, 1.0] contract. A negative threshold is the worse case:
    # clamping it to the boundary 0.0 would make EVERY order (even a tiny,
    # well-volumed one) fall into zone 2, degrading fills that should never
    # be touched. Falling back to the documented default (0.1) on any
    # invalid input preserves the intended "small orders never degrade"
    # semantics instead of silently reinterpreting a bad config as "always
    # degrade" or "never degrade above 99%".
    if not np.isfinite(volume_threshold) or volume_threshold < 0.0 or volume_threshold >= 1.0:
        volume_threshold = 0.1

    n = len(df)
    fill_ratios = np.ones(n, dtype=np.float64)

    if not _get_partial_fill_enabled():
        return fill_ratios

    # Get volume array — if absent (e.g. test fixture), return all 1.0
    if "volume" not in df.columns:
        return fill_ratios

    volume = df["volume"].to_numpy().astype(np.float64)
    # Guard: zero or NaN volume → treat as unlimited (return 1.0)
    safe_volume = np.where((volume > 0) & np.isfinite(volume), volume, np.inf)

    order_q = np.asarray(order_quantities, dtype=np.float64)
    # B-12 fix: NaN/negative order quantities must not corrupt the ratio —
    # treat as "no order" (ratio 0, zone 1, no degradation) rather than
    # propagating NaN or a spurious sign into the zone masks below.
    order_q = np.where(np.isfinite(order_q) & (order_q > 0), order_q, 0.0)
    # Ratio of order size to bar volume
    qty_vol_ratio = order_q / safe_volume

    # Three zones:
    # Zone 1: ratio < threshold → no degradation
    # Zone 2: threshold ≤ ratio ≤ 1.0 → linear from 1.0 → 0.5
    # Zone 3: ratio > 1.0 → forced 0.5 (bar volume insufficient)
    zone2_mask = (qty_vol_ratio >= volume_threshold) & (qty_vol_ratio <= 1.0)
    zone3_mask = qty_vol_ratio > 1.0

    if np.any(zone2_mask):
        # Linear interpolation: at threshold → 1.0, at 1.0 → 0.5
        ratio_in_zone = (qty_vol_ratio[zone2_mask] - volume_threshold) / (1.0 - volume_threshold + 1e-10)
        fill_ratios[zone2_mask] = 1.0 - 0.5 * ratio_in_zone

    fill_ratios[zone3_mask] = 0.5

    # B-12 fix: defensive final clamp to the documented [0.5, 1.0] contract.
    # With volume_threshold now validated above this is a no-op on the normal
    # path — it exists so a future change to the zone math (or an edge case
    # this audit didn't enumerate) fails safe into the documented range
    # instead of silently violating the contract every caller depends on.
    fill_ratios = np.clip(fill_ratios, 0.5, 1.0)

    return fill_ratios


def apply_volume_partial_fills(
    entries: np.ndarray,
    sizes: np.ndarray,
    df: pl.DataFrame,
    volume_threshold: float | None = None,
) -> tuple[np.ndarray, np.ndarray, dict]:
    """Apply volume-based fill ratio to sizes at entry bars.

    HIGH #6 — activates the volume-based partial fill model on size arrays.
    Only modifies sizes at actual entry bars (entries == True).
    Does NOT modify the entries array (complete non-fills are handled by
    the RSI-based apply_fill_model gate, not this function).

    Args:
        entries: Boolean array of entry signals (post-roll, next-bar convention)
        sizes: Float array of position sizes (contracts per bar)
        df: DataFrame with 'volume' column
        volume_threshold: Volume threshold for degradation onset

    Returns:
        (adjusted_sizes, fill_ratios, audit_payload)
        adjusted_sizes: Modified sizes with partial fills applied at entry bars
        fill_ratios: Per-bar fill ratio array (for audit/logging)
        audit_payload: Dict with partial fill statistics

    P&L contract: caller (backtester.py) uses adjusted_sizes in the futures P&L
    formula — never pass to vectorbt slippage/fees.
    """
    # M-5: resolve default via getter
    if volume_threshold is None:
        volume_threshold = _get_partial_fill_volume_threshold()

    if not _get_partial_fill_enabled():
        return sizes.copy(), np.ones(len(sizes), dtype=np.float64), {
            "enabled": False,
            "total_orders": 0,
            "partial_fills": 0,
            "avg_fill_ratio": 1.0,
            # B-18 fix (deepscan17, 2026-07-05): see main computation below —
            # this field was a permanent 0.0 placeholder claiming a computed
            # value that never existed. None = "not computed" (honest), not a
            # fabricated zero.
            "avg_slippage_delta_per_partial": None,
        }

    adjusted_sizes = sizes.copy()
    fill_ratios = compute_volume_based_fill_ratios(df, sizes, volume_threshold=volume_threshold)

    entry_mask = entries.astype(bool)
    entry_indices = np.where(entry_mask)[0]
    total_orders = len(entry_indices)
    partial_fills = 0
    fill_ratio_sum = 0.0

    for idx in entry_indices:
        ratio = fill_ratios[idx]
        if ratio < 1.0 and not np.isnan(adjusted_sizes[idx]):
            # B-13 fix (deepscan17, 2026-07-05): PREVIOUS BUG — partial_fills was
            # only incremented when the INTEGER size actually changed
            # (`new_size < original_size`). For a 1-contract order,
            # int(1 * 0.7) floors to 0, then max(1.0, 0) clamps back up to 1 —
            # new_size == original_size, so the counter never fired even
            # though a genuine volume-based degradation occurred (ratio<1.0).
            # A 1-contract order simply has no smaller integer representation
            # ("0.7 contracts" isn't tradeable) — that does not mean no
            # partial fill happened. Count every ratio<1.0 order as a partial
            # fill for audit purposes; only gate the SIZE reduction itself on
            # whether the integer math actually produces a smaller size.
            original_size = adjusted_sizes[idx]
            new_size = max(1.0, int(original_size * ratio))  # floor, minimum 1 contract
            partial_fills += 1
            if new_size < original_size:
                adjusted_sizes[idx] = float(new_size)
        fill_ratio_sum += fill_ratios[idx]

    avg_fill_ratio = fill_ratio_sum / total_orders if total_orders > 0 else 1.0

    audit_payload = {
        "enabled": True,
        "total_orders": total_orders,
        "partial_fills": partial_fills,
        "avg_fill_ratio": round(avg_fill_ratio, 4),
        # B-18 fix (deepscan17, 2026-07-05): PREVIOUS BUG — this field was a
        # hardcoded 0.0 dressed up as a computed metric ("Placeholder —
        # slippage delta computed in backtester", which never happened
        # anywhere in backtester.py either). This function only has SIZE
        # information (no price/spread data), so it cannot honestly compute
        # a price-based slippage delta — fabricating one would misrepresent
        # fill-model fidelity (CLAUDE.md: never fake profitability). None
        # signals "not computed at this layer" rather than a false zero that
        # reads as "measured and found to be zero."
        "avg_slippage_delta_per_partial": None,
        "volume_threshold": volume_threshold,
    }

    if partial_fills > 0:
        print(
            f"[fill_model] volume-partial: {partial_fills}/{total_orders} orders partially filled "
            f"(avg_ratio={avg_fill_ratio:.3f}, threshold={volume_threshold})",
            file=sys.stderr,
        )

    return adjusted_sizes, fill_ratios, audit_payload
