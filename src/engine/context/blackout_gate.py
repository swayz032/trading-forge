"""Backtest blackout gate — parity with paper-signal-service.ts blackout windows.

Paper-side consumes pre_market_sessions.blackout_windows at runtime. Backtester
must enforce the same windows so expectancy is consistent across IS and live.

Design:
- Pure function: no I/O, no DB reads, deterministic.
- Blackout windows are passed in at backtest time via config or loaded from a
  parquet data file that matches the engine's existing input pattern.
- Interval: [start, end) — half-open, matching paper-side semantics.
- Wave 24 Pass 1 (2026-05-23): Item 14 — blackout parity shipping.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class BlackoutWindow:
    """A single blackout window [start, end) in Eastern Time (naive or aware).

    Fields match the shape emitted by pre_market_sessions.blackout_windows
    on the paper side.

    Attributes:
        name: Human-readable label (e.g. "FOMC", "CPI", "NFP").
        start: Start of blackout in ET (inclusive).
        end: End of blackout in ET (exclusive).
    """

    name: str
    start: pd.Timestamp
    end: pd.Timestamp


def parse_blackout_windows(raw: list[dict[str, Any]]) -> list[BlackoutWindow]:
    """Parse a list of raw dicts into BlackoutWindow objects.

    Each dict must have keys: name (str), start (ISO str or Timestamp), end (same).

    Args:
        raw: List of raw blackout window dicts from config or parquet.

    Returns:
        List of typed BlackoutWindow objects.
    """
    windows: list[BlackoutWindow] = []
    for entry in raw:
        try:
            windows.append(
                BlackoutWindow(
                    name=str(entry.get("name", "unknown")),
                    start=pd.Timestamp(entry["start"]),
                    end=pd.Timestamp(entry["end"]),
                )
            )
        except (KeyError, ValueError, TypeError):
            # Skip malformed entries rather than raising — graceful degradation.
            continue
    return windows


def should_block_for_blackout(
    ts: pd.Timestamp,
    blackouts: list[BlackoutWindow],
) -> bool:
    """Return True when ts falls inside any blackout window [start, end).

    Matches paper-side semantics: half-open interval, comparison is
    timezone-naive against timezone-naive or normalized to same tz.

    Args:
        ts: Bar timestamp in Eastern Time (naive or tz-aware).
        blackouts: Pre-parsed blackout windows.

    Returns:
        True if the bar should be blocked (no entry allowed).
    """
    if not blackouts:
        return False

    # Normalize to naive for comparison — paper side stores naive ET.
    if ts.tzinfo is not None:
        ts_naive = ts.tz_localize(None) if hasattr(ts, "tz_localize") else ts.replace(tzinfo=None)
    else:
        ts_naive = ts

    for bw in blackouts:
        start = bw.start
        end = bw.end
        # Normalize window bounds to naive as well
        if start.tzinfo is not None:
            start = start.replace(tzinfo=None)
        if end.tzinfo is not None:
            end = end.replace(tzinfo=None)
        if start <= ts_naive < end:
            return True
    return False


def apply_blackout_mask_to_entries(
    entry_long: np.ndarray,
    entry_short: np.ndarray,
    timestamps: list[Any],
    blackouts: list[BlackoutWindow],
) -> tuple[np.ndarray, np.ndarray, int]:
    """Zero out entry signals for any bar inside a blackout window.

    Args:
        entry_long:  Boolean numpy array of long entry signals.
        entry_short: Boolean numpy array of short entry signals.
        timestamps:  List of bar timestamps (strings or pd.Timestamp).
        blackouts:   Pre-parsed blackout windows.

    Returns:
        (entry_long_masked, entry_short_masked, n_skips)
        where n_skips is the count of bars suppressed.
    """
    if not blackouts:
        return entry_long, entry_short, 0

    long_out = entry_long.copy()
    short_out = entry_short.copy()
    n_skips = 0

    for i, ts_raw in enumerate(timestamps):
        if ts_raw is None:
            continue
        try:
            ts = pd.Timestamp(ts_raw)
        except Exception:
            continue

        if should_block_for_blackout(ts, blackouts):
            if long_out[i] or short_out[i]:
                n_skips += 1
            long_out[i] = False
            short_out[i] = False

    return long_out, short_out, n_skips


def load_blackouts_from_env_or_config(
    symbol: str,
    config_blackouts: list[dict[str, Any]] | None = None,
) -> list[BlackoutWindow]:
    """Load blackout windows from config (preferred) or env-specified parquet file.

    Priority:
      1. config_blackouts list (passed in from BacktestRequest or strategy DSL)
      2. Parquet file at BLACKOUT_PARQUET_DIR/<symbol>.parquet
      3. Empty list (no blackout enforcement)

    Args:
        symbol: Instrument symbol (e.g. "MES", "MNQ", "MCL").
        config_blackouts: Optional list of raw dicts from request config.

    Returns:
        List of BlackoutWindow objects (possibly empty).
    """
    if config_blackouts is not None:
        return parse_blackout_windows(config_blackouts)

    parquet_dir = os.environ.get("BLACKOUT_PARQUET_DIR", "")
    if parquet_dir:
        parquet_path = os.path.join(parquet_dir, f"blackouts_{symbol}.parquet")
        if os.path.exists(parquet_path):
            try:
                import polars as pl
                df = pl.read_parquet(parquet_path)
                raw = df.to_dicts()
                return parse_blackout_windows(raw)
            except Exception:
                pass

    return []
