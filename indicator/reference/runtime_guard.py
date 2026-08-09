"""Operational guardrails for indicator runtime modes.

This layer prevents a mathematically correct signal from being presented as live-decision
support when the feed/context is delayed, stale, gapped, unknown, or otherwise outside
the declared operating envelope.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from math import isfinite
from typing import Tuple


class RuntimeMode(str, Enum):
    REPLAY = "REPLAY"
    STUDY = "STUDY"
    LIVE_DECISION_SUPPORT = "LIVE_DECISION_SUPPORT"


class FeedState(str, Enum):
    REALTIME = "REALTIME"
    DELAYED = "DELAYED"
    STALE = "STALE"
    GAP_DETECTED = "GAP_DETECTED"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class RuntimeContext:
    mode: RuntimeMode
    feed_state: FeedState
    symbol_root: str
    chart_timeframe_minutes: int
    seconds_since_last_update: float
    platform: str

    def __post_init__(self) -> None:
        if not self.symbol_root:
            raise ValueError("symbol_root required")
        if not self.platform:
            raise ValueError("platform required")
        if self.chart_timeframe_minutes <= 0:
            raise ValueError("chart_timeframe_minutes must be > 0")
        if not isfinite(self.seconds_since_last_update) or self.seconds_since_last_update < 0:
            raise ValueError("seconds_since_last_update must be finite and >= 0")


@dataclass(frozen=True)
class RuntimeDecision:
    signal_allowed: bool
    display_allowed: bool
    codes: Tuple[str, ...]


def evaluate_runtime(
    ctx: RuntimeContext,
    *,
    expected_symbol_roots: Tuple[str, ...] = ("NQ", "MNQ"),
    required_execution_timeframe_minutes: int = 5,
    stale_after_seconds: float = 10.0,
) -> RuntimeDecision:
    codes = []

    if ctx.symbol_root not in expected_symbol_roots:
        codes.append("WRONG_SYMBOL")
    if ctx.chart_timeframe_minutes != required_execution_timeframe_minutes:
        codes.append("WRONG_EXECUTION_TIMEFRAME")
    if ctx.seconds_since_last_update > stale_after_seconds:
        codes.append("STALE_BY_CLOCK")

    if ctx.feed_state == FeedState.STALE:
        codes.append("FEED_STALE")
    elif ctx.feed_state == FeedState.GAP_DETECTED:
        codes.append("FEED_GAP")
    elif ctx.feed_state == FeedState.UNKNOWN:
        codes.append("FEED_STATE_UNKNOWN")
    elif ctx.feed_state == FeedState.DELAYED:
        codes.append("FEED_DELAYED")

    hard_data_error = any(
        c in codes
        for c in (
            "WRONG_SYMBOL",
            "WRONG_EXECUTION_TIMEFRAME",
            "STALE_BY_CLOCK",
            "FEED_STALE",
            "FEED_GAP",
            "FEED_STATE_UNKNOWN",
        )
    )

    # Replay/study may display delayed historical information, but a live-decision-support
    # mode must never present delayed data as actionable live timing.
    delayed_live_block = (
        ctx.mode == RuntimeMode.LIVE_DECISION_SUPPORT and ctx.feed_state == FeedState.DELAYED
    )

    signal_allowed = not hard_data_error and not delayed_live_block
    display_allowed = not hard_data_error
    return RuntimeDecision(signal_allowed, display_allowed, tuple(codes))
