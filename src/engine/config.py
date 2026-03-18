"""Strategy configuration schema — Pydantic v2 models.

Contract specs MUST match src/server/routes/risk.ts lines 6-15 exactly.
"""

from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


# ─── Contract Specs (mirrors risk.ts) ──────────────────────────────

class ContractSpec(BaseModel):
    tick_size: float
    tick_value: float
    point_value: float
    day_margin: float = 500       # Intraday margin per contract
    overnight_margin: float = 0   # Overnight/maintenance margin per contract


CONTRACT_SPECS: dict[str, ContractSpec] = {
    "ES":  ContractSpec(tick_size=0.25, tick_value=12.50, point_value=50.00,   day_margin=500,  overnight_margin=12650),
    "NQ":  ContractSpec(tick_size=0.25, tick_value=5.00,  point_value=20.00,   day_margin=500,  overnight_margin=17600),
    "CL":  ContractSpec(tick_size=0.01, tick_value=10.00, point_value=1000.00, day_margin=500,  overnight_margin=6600),
    "YM":  ContractSpec(tick_size=1.00, tick_value=5.00,  point_value=5.00,    day_margin=500,  overnight_margin=9900),
    "RTY": ContractSpec(tick_size=0.10, tick_value=5.00,  point_value=50.00,   day_margin=500,  overnight_margin=7150),
    "GC":  ContractSpec(tick_size=0.10, tick_value=10.00, point_value=100.00,  day_margin=500,  overnight_margin=10400),
    "MES": ContractSpec(tick_size=0.25, tick_value=1.25,  point_value=5.00,    day_margin=50,   overnight_margin=1265),
    "MNQ": ContractSpec(tick_size=0.25, tick_value=0.50,  point_value=2.00,    day_margin=50,   overnight_margin=1760),
    "MCL": ContractSpec(tick_size=0.01, tick_value=1.00,  point_value=100.00,  day_margin=50,   overnight_margin=660),
    "MGC": ContractSpec(tick_size=0.10, tick_value=1.00,  point_value=10.00,   day_margin=50,   overnight_margin=1040),
}

VALID_SYMBOLS = set(CONTRACT_SPECS.keys())

VALID_INDICATOR_TYPES = {"sma", "ema", "rsi", "macd", "vwap", "bbands", "atr", "adx", "adr"}


# ─── Indicator Config ──────────────────────────────────────────────

class IndicatorConfig(BaseModel):
    type: str
    period: int = 14
    # MACD-specific
    fast: Optional[int] = None
    slow: Optional[int] = None
    signal: Optional[int] = None
    # Bollinger-specific
    std_dev: float = 2.0

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in VALID_INDICATOR_TYPES:
            raise ValueError(
                f"Unknown indicator type '{v}'. Valid: {sorted(VALID_INDICATOR_TYPES)}"
            )
        return v


# ─── Stop Config ───────────────────────────────────────────────────

class StopConfig(BaseModel):
    type: Literal["atr", "fixed", "trailing_atr"]
    multiplier: float = 2.0
    fixed_points: Optional[float] = None


# ─── Position Size Config ─────────────────────────────────────────

class PositionSizeConfig(BaseModel):
    type: Literal["dynamic_atr", "fixed"]
    target_risk_dollars: float = 500.0
    fixed_contracts: int = 1


# ─── Strategy Config ──────────────────────────────────────────────

class StrategyConfig(BaseModel):
    name: str
    symbol: str
    timeframe: str
    indicators: list[IndicatorConfig]
    entry_long: str
    entry_short: str
    exit: str
    stop_loss: StopConfig
    take_profit: Optional[StopConfig] = None
    position_size: PositionSizeConfig
    overnight_hold: bool = False
    preferred_regime: Optional[str] = None

    @field_validator("symbol")
    @classmethod
    def validate_symbol(cls, v: str) -> str:
        upper = v.upper()
        if upper not in VALID_SYMBOLS:
            raise ValueError(
                f"Unknown symbol '{v}'. Valid: {sorted(VALID_SYMBOLS)}"
            )
        return upper

    @field_validator("indicators")
    @classmethod
    def validate_max_indicators(cls, v: list[IndicatorConfig]) -> list[IndicatorConfig]:
        if len(v) > 5:
            raise ValueError(
                f"Max 5 indicators allowed, got {len(v)}. "
                "More parameters = more overfitting."
            )
        return v


# ─── Economic Event Policy ────────────────────────────────────────

class EconomicEventPolicy(BaseModel):
    event_type: str  # "FOMC", "CPI", "NFP", "GDP", "PCE"
    action: Literal["SIT_OUT", "REDUCE", "WIDEN", "IGNORE"] = "SIT_OUT"
    window_minutes: int = 30


class EventCalendarConfig(BaseModel):
    policies: list[EconomicEventPolicy] = []
    calendar_source: Literal["static", "alpha_vantage"] = "static"


# ─── Fill Probability Config ────────────────────────────────────

class FillProbabilityConfig(BaseModel):
    order_type: Literal["market", "limit"] = "market"
    limit_at_current: float = 0.95
    limit_1_tick: float = 0.80
    limit_at_sr: float = 0.60
    limit_at_extreme: float = 0.50
    partial_fill_threshold: float = 0.70


# ─── Backtest Request ─────────────────────────────────────────────

class BacktestRequest(BaseModel):
    strategy: StrategyConfig
    start_date: str  # YYYY-MM-DD
    end_date: str    # YYYY-MM-DD
    slippage_ticks: float = 1.0
    commission_per_side: float = 4.50
    mode: Literal["single", "walkforward"] = "single"
    walk_forward_splits: int = 5
    firm_key: Optional[str] = None
    event_calendar: Optional[EventCalendarConfig] = None
    fill_model: Optional[FillProbabilityConfig] = None


# ─── Backtest Result ──────────────────────────────────────────────

class BacktestResult(BaseModel):
    total_return: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    profit_factor: float
    total_trades: int
    avg_trade_pnl: float
    avg_daily_pnl: float = 0.0
    winning_days: int = 0
    total_trading_days: int = 0
    max_consecutive_losing_days: int = 0
    expectancy_per_trade: float = 0.0
    avg_winner_to_loser_ratio: float = 0.0
    equity_curve: list[float] = []
    trades: list[dict] = []
    daily_pnls: list[float] = []
    execution_time_ms: int = 0
    tier: str = ""
    forge_score: float = 0.0
    walk_forward_results: Optional[dict] = None
    prop_compliance: Optional[dict] = None


# ─── Monte Carlo Request ─────────────────────────────────────────

class MonteCarloRequest(BaseModel):
    backtest_id: str
    num_simulations: int = 100_000
    method: Literal["trade_resample", "return_bootstrap", "block_bootstrap", "both"] = "both"
    confidence_levels: list[float] = [0.05, 0.25, 0.50, 0.75, 0.95]
    ruin_threshold: float = 0.0
    initial_capital: float = 100_000.0
    use_gpu: bool = True
    max_paths_to_store: int = 100
    is_oos_trades: bool = False
    stress_level: int = 0  # 0=none, 1=moderate, 2=severe, 3=extreme
    inject_synthetic_stress: bool = False
    firms: list[str] = []  # If non-empty, run per-firm survival simulation

    @field_validator("num_simulations")
    @classmethod
    def validate_num_simulations(cls, v: int) -> int:
        if v < 1:
            raise ValueError("num_simulations must be >= 1")
        return v

    @field_validator("stress_level")
    @classmethod
    def validate_stress_level(cls, v: int) -> int:
        if v < 0 or v > 3:
            raise ValueError("stress_level must be 0, 1, 2, or 3")
        return v


# ─── Crisis Scenario ─────────────────────────────────────────────

class CrisisScenario(BaseModel):
    name: str
    start_date: str  # YYYY-MM-DD
    end_date: str    # YYYY-MM-DD
    spread_multiplier: float = 3.0
    fill_rate: float = 0.50
    slippage_multiplier: float = 2.0

    @field_validator("fill_rate")
    @classmethod
    def validate_fill_rate(cls, v: float) -> float:
        if v < 0.0 or v > 1.0:
            raise ValueError("fill_rate must be between 0.0 and 1.0")
        return v


# ─── Stress Test Request ─────────────────────────────────────────

class StressTestRequest(BaseModel):
    backtest_id: str
    strategy: StrategyConfig
    scenarios: list[CrisisScenario] = []
    prop_firm_max_dd: float = 2000.0
