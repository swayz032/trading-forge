"""Strategy DSL Schema — strict Pydantic model every strategy must conform to."""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, model_validator


class Timeframe(str, Enum):
    M1 = "1m"
    M5 = "5m"
    M15 = "15m"
    M30 = "30m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"


class Direction(str, Enum):
    LONG = "long"
    SHORT = "short"
    BOTH = "both"


class EntryType(str, Enum):
    BREAKOUT = "breakout"
    MEAN_REVERSION = "mean_reversion"
    TREND_FOLLOW = "trend_follow"
    VOLATILITY_EXPANSION = "volatility_expansion"
    SESSION_PATTERN = "session_pattern"
    EVENT_DRIVEN = "event_driven"


class ExitType(str, Enum):
    FIXED_TARGET = "fixed_target"
    TRAILING_STOP = "trailing_stop"
    TIME_EXIT = "time_exit"
    INDICATOR_SIGNAL = "indicator_signal"
    ATR_MULTIPLE = "atr_multiple"


class ProfitScalingTier(BaseModel):
    """Profit-based position scaling config (W5a). account_pnl_total injected at run time."""

    increment: int = Field(..., ge=1, description="Extra contracts per threshold crossed")
    threshold: float = Field(..., gt=0, description="PnL threshold per tier step in dollars")

    model_config = {"extra": "forbid"}


class StrategyDSL(BaseModel):
    """Strategy Definition Language — the strict schema every strategy must conform to."""

    schema_version: str = Field(default="v1", description="DSL schema version")
    name: str = Field(..., min_length=3, max_length=100)
    description: str = Field(
        ...,
        min_length=10,
        max_length=500,
        description="One-sentence strategy description",
    )

    # Core identity
    symbol: str = Field(
        ..., description="Futures symbol (MES, MNQ, MCL)"
    )
    timeframe: Timeframe
    direction: Direction

    # Entry
    entry_type: EntryType
    entry_indicator: str = Field(
        ...,
        description="Primary indicator for entry (e.g., 'sma_crossover', 'bollinger_breakout', 'rsi_reversal')",
    )
    entry_params: dict = Field(
        ..., description="Max 5 parameters for entry logic"
    )
    entry_condition: str = Field(
        ..., description="Plain English entry rule, one sentence"
    )

    # Exit
    exit_type: ExitType
    exit_params: dict = Field(
        ..., description="Exit parameters (target, stop, trail)"
    )

    # Risk
    stop_loss_atr_multiple: float = Field(
        ..., ge=0.5, le=5.0, description="Stop loss as ATR multiple"
    )
    take_profit_atr_multiple: Optional[float] = Field(
        None, ge=1.0, le=10.0
    )
    max_contracts: Optional[int] = Field(None, ge=1, le=20)

    # Regime filter
    preferred_regime: Optional[str] = Field(
        None,
        description=(
            "TRENDING_UP | TRENDING_DOWN | RANGE_BOUND | HIGH_VOL | LOW_VOL | "
            "OPENING_RANGE | NEWS_DRIVEN | OVERNIGHT_DRIFT"
        ),
    )

    # Session filter
    session_filter: Optional[str] = Field(
        None,
        description="RTH_ONLY | ETH_ONLY | ALL_SESSIONS | LONDON | ASIA",
    )

    # Sizing / profit scaling (W5a)
    profit_scaling_tier: Optional[ProfitScalingTier] = Field(
        None,
        description="Profit-based position scaling config. account_pnl_total injected at run time.",
    )
    daily_target_dollars: Optional[float] = Field(
        None,
        ge=0,
        description="Archetype-level daily P&L target (informational, consumed by paper telemetry only).",
    )

    # Validation / testing metadata
    frankenstein_test_mode: Optional[str] = Field(
        None,
        description=(
            "Frankenstein randomization test mode: full_shuffle | calendar_preserving | label_only. "
            "Use full_shuffle for market-neutral archetypes; calendar_preserving for session/event-driven ones."
        ),
    )

    # News handling
    bypass_news_blackout: Optional[bool] = Field(
        None,
        description=(
            "When True, strategy explicitly opts into trading during news windows. "
            "Required for event-driven strategies like news_fade_mcl. "
            "Must be explicitly set — no default opt-in."
        ),
    )

    # Chart / construction metadata
    chart_construction: Optional[dict[str, Any]] = Field(
        None,
        description="Optional chart construction hints (e.g. session_start_hour, range_minutes).",
    )

    # Metadata
    source: str = Field(
        default="manual",
        description="manual | ollama | openclaw | n8n",
    )
    tags: list[str] = Field(default_factory=list)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def validate_entry_params_count(self) -> "StrategyDSL":
        if len(self.entry_params) > 5:
            raise ValueError(
                f"entry_params must have <= 5 keys, got {len(self.entry_params)}"
            )
        return self
