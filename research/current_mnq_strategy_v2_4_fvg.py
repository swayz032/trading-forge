#!/usr/bin/env python3
"""Current MNQ v2.4 adapter around the repository-native FVG detector.

This file does NOT reimplement FVG identity. The canonical detector lives at
src.engine.indicators.fvg_native. This adapter only:
  * restricts inputs to completed 15-minute bars known at `asof`,
  * maps native zone indices back to timestamps,
  * exposes only still-unmitigated zones for current-strategy target logic.
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from src.engine.indicators.fvg_native import BULLISH, BEARISH, compute_fvg_signal


@dataclass(frozen=True)
class Active15mFVG:
    direction: str
    lo: float
    hi: float
    mid: float
    formed_at: pd.Timestamp
    start_idx: int
    source: str = "FVG_15M_NATIVE_UNMITIGATED"


def active_15m_fvgs(h15: pd.DataFrame, asof: pd.Timestamp) -> list[Active15mFVG]:
    """Return native FVGs still unmitigated using only completed 15m bars <= asof."""
    if asof.tzinfo is None:
        raise RuntimeError("FVG_ASOF_MUST_BE_TZ_AWARE")
    q = h15[(h15.index + pd.Timedelta(minutes=15)) <= asof].copy()
    if len(q) < 3:
        return []
    result = compute_fvg_signal(
        q["open"].to_numpy(float),
        q["high"].to_numpy(float),
        q["low"].to_numpy(float),
        q["close"].to_numpy(float),
    )
    out: list[Active15mFVG] = []
    for z in result.zones:
        # Because q is causally truncated at asof, filled_at_idx=None means no
        # completed later 15m candle has re-entered the gap yet.
        if z.filled_at_idx is not None:
            continue
        formed = q.index[z.start_idx] + pd.Timedelta(minutes=15)
        out.append(Active15mFVG(
            direction=z.direction,
            lo=float(z.lower),
            hi=float(z.upper),
            mid=(float(z.lower) + float(z.upper)) / 2.0,
            formed_at=formed,
            start_idx=int(z.start_idx),
        ))
    return out


def native_identity_matches_transcript() -> dict:
    """Machine-readable receipt for the user-supplied FVG definition."""
    return {
        "bullish_definition": "low[i] > high[i-2]",
        "bearish_definition": "high[i] < low[i-2]",
        "middle_candle_is_displacement": True,
        "wick_to_wick_zone": True,
        "native_detector": "src.engine.indicators.fvg_native.compute_fvg_signal",
        "strategy_timeframe": "15m",
        "active_requires_unmitigated": True,
    }
