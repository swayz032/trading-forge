"""Unified strategy interface — all strategies implement BaseStrategy.

The backtester only knows this interface. Two implementations:
- ExpressionStrategy: wraps existing StrategyConfig + expression engine
- ICT strategy subclasses: hand-coded multi-step indicator chains
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

import polars as pl

from src.engine.config import StrategyConfig
from src.engine.indicators.core import compute_indicators
from src.engine.signals import evaluate_expression


class BaseStrategy(ABC):
    """All strategies implement this. Backtester only knows this interface."""

    name: str
    symbol: str
    timeframe: str
    preferred_regime: Optional[str] = None

    @abstractmethod
    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        """Add indicator columns + entry_long/entry_short/exit_long/exit_short bool columns.

        Returns:
            DataFrame with all original columns plus signal columns.
        """
        ...

    @abstractmethod
    def get_params(self) -> dict:
        """Return tunable params for optimizer. Max 5 for expression strategies."""
        ...

    @abstractmethod
    def get_default_config(self) -> dict:
        """Return default param values for serialization/DB storage."""
        ...


class ExpressionStrategy(BaseStrategy):
    """Adapter: wraps existing StrategyConfig + expression engine into BaseStrategy.

    The 5-indicator cap is enforced here via StrategyConfig validation.
    ICT strategy subclasses bypass this entirely.
    """

    def __init__(self, config: StrategyConfig):
        self.config = config
        self.name = config.name
        self.symbol = config.symbol
        self.timeframe = config.timeframe
        self.preferred_regime = None

    def compute(self, df: pl.DataFrame) -> pl.DataFrame:
        """Compute indicators via dispatcher, then evaluate expressions for signals."""
        result = compute_indicators(df, self.config.indicators)

        entry_long = evaluate_expression(result, self.config.entry_long)
        entry_short = evaluate_expression(result, self.config.entry_short)
        exit_signal = evaluate_expression(result, self.config.exit)

        result = result.with_columns([
            entry_long.alias("entry_long"),
            entry_short.alias("entry_short"),
            exit_signal.alias("exit_long"),
            exit_signal.alias("exit_short"),
        ])
        return result

    def get_params(self) -> dict:
        """Extract tunable params from indicator configs."""
        params = {}
        for i, ind in enumerate(self.config.indicators):
            if ind.type in ("sma", "ema", "rsi", "atr"):
                params[f"ind_{i}_period"] = ind.period
        return params

    def get_default_config(self) -> dict:
        return self.config.model_dump()
