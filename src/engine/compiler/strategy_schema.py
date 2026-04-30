"""Strategy DSL Schema — strict Pydantic model every strategy must conform to."""

from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

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


class ExitType(str, Enum):
    FIXED_TARGET = "fixed_target"
    TRAILING_STOP = "trailing_stop"
    TIME_EXIT = "time_exit"
    INDICATOR_SIGNAL = "indicator_signal"
    ATR_MULTIPLE = "atr_multiple"


class ChartConstruction(str, Enum):
    """Chart construction type. CANDLES is the safe default (real OHLC).
    RENKO is opt-in for grid/scaling strategies and requires brick_size_atr in entry_params.
    HEIKIN_ASHI is rejected — synthetic price means backtests don't validate real edge."""

    CANDLES = "candles"
    RENKO = "renko"


# Indicator names that signal Heikin-Ashi or other synthetic price construction —
# rejected at validation time per QuantVue ATS post-mortem (Qpilot 95% phantom alerts).
_HEIKIN_FORBIDDEN_PATTERNS = (
    "heikin",
    "heikin_ashi",
    "heikinashi",
    "ha_close",
    "ha_open",
    "ha_high",
    "ha_low",
    "haclose",
    "haopen",
)


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
    # M8 fix: constrain to the symbols the engine actually supports.
    # config.CONTRACT_SPECS only has MES/MNQ/MCL — free-form string used
    # to silently accept invalid symbols that crashed the backtester later.
    symbol: Literal["MES", "MNQ", "MCL"] = Field(
        ..., description="Futures symbol (MES, MNQ, MCL only)"
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
        description="TRENDING_UP | TRENDING_DOWN | RANGE_BOUND | HIGH_VOL | LOW_VOL",
    )

    # Session filter
    session_filter: Optional[str] = Field(
        None,
        description="RTH_ONLY | ETH_ONLY | ALL_SESSIONS | LONDON | ASIA",
    )

    # Chart construction — candles is the safe default. Renko is opt-in.
    # Heikin-Ashi is rejected (see _HEIKIN_FORBIDDEN_PATTERNS).
    chart_construction: ChartConstruction = Field(
        default=ChartConstruction.CANDLES,
        description="Chart bar construction. 'candles' (default) uses real OHLC. "
        "'renko' is opt-in for grid/scaling strategies — requires brick_size_atr in entry_params.",
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

    @model_validator(mode="after")
    def reject_heikin_ashi(self) -> "StrategyDSL":
        """Heikin-Ashi rejection: synthetic price means backtests validate a smoothed
        visualization, not real edge. Real fills happen on real candles, so HA-derived
        signals disappear in production. See QuantVue ATS post-mortem (Discord image 16)."""
        haystack = (self.entry_indicator + " " + self.name).lower()
        for pattern in _HEIKIN_FORBIDDEN_PATTERNS:
            if pattern in haystack:
                raise ValueError(
                    f"Heikin-Ashi-derived strategies are rejected. Found '{pattern}' in "
                    f"entry_indicator='{self.entry_indicator}' or name='{self.name}'. "
                    f"HA is a synthetic price — backtest edge does not transfer to live fills."
                )
        return self

    @model_validator(mode="after")
    def validate_renko_opt_in(self) -> "StrategyDSL":
        """Renko strategies require brick_size_atr in entry_params (per QuantVue Qgrid_Elite pattern).
        This forces deterministic brick close timing tied to real ATR, preventing the Qpilot
        repaint failure mode where bricks 'paint and unpaint' with new ticks."""
        if self.chart_construction == ChartConstruction.RENKO:
            if "brick_size_atr" not in self.entry_params:
                raise ValueError(
                    "Renko strategies must declare brick_size_atr in entry_params "
                    "(brick size as multiple of ATR — typically 0.5 to 2.0). "
                    "Without explicit brick sizing, signals can repaint as ticks arrive."
                )
            brick = self.entry_params["brick_size_atr"]
            if not isinstance(brick, (int, float)) or brick < 0.1 or brick > 5.0:
                raise ValueError(
                    f"brick_size_atr must be a number between 0.1 and 5.0, got {brick!r}"
                )
        return self
