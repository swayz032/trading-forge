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
    default_commission: float = 0.62  # Per-side commission (MES/micro default)


CONTRACT_SPECS: dict[str, ContractSpec] = {
    # Micro contracts only — user trades MES/MNQ/MCL exclusively
    "MES": ContractSpec(tick_size=0.25, tick_value=1.25,  point_value=5.00,    day_margin=50,   overnight_margin=2659),
    "MNQ": ContractSpec(tick_size=0.25, tick_value=0.50,  point_value=2.00,    day_margin=50,   overnight_margin=4044),
    "MCL": ContractSpec(tick_size=0.01, tick_value=1.00,  point_value=100.00,  day_margin=50,   overnight_margin=1120),
    # S3 data path labels — intentionally map to MICRO specs (ES→MES, NQ→MNQ, CL→MCL).
    # WARNING: point_value here is MICRO (NQ=$2, ES=$5, CL=$100), NOT full-size ($20/$50/$1000).
    # Any caller passing these symbols receives micro P&L. This is the documented design
    # for this system. Use get_contract_spec() to surface a runtime warning when accessed.
    "ES":  ContractSpec(tick_size=0.25, tick_value=1.25,  point_value=5.00,    day_margin=50,   overnight_margin=2659),
    "NQ":  ContractSpec(tick_size=0.25, tick_value=0.50,  point_value=2.00,    day_margin=50,   overnight_margin=4044),
    "CL":  ContractSpec(tick_size=0.01, tick_value=1.00,  point_value=100.00,  day_margin=50,   overnight_margin=1120),
}

# Symbols that use MICRO point values despite carrying full-size ticker names.
# Accessing these via get_contract_spec() emits a UserWarning so operators know
# micro math is in effect. Full-size callers must NOT use CONTRACT_SPECS directly.
_MICRO_ALIAS_SYMBOLS = frozenset({"ES", "NQ", "CL"})


def get_contract_spec(symbol: str) -> ContractSpec:
    """Return contract spec for symbol; warns when a micro-alias full-size ticker is used."""
    if symbol in _MICRO_ALIAS_SYMBOLS:
        import warnings
        warnings.warn(
            f"Symbol '{symbol}' resolves to MICRO contract specs "
            f"(point_value={CONTRACT_SPECS[symbol].point_value}). "
            f"Full-size {symbol} is 10x larger. This system trades micro only — "
            f"if you are a full-size caller, do not use this spec.",
            UserWarning,
            stacklevel=2,
        )
    if symbol not in CONTRACT_SPECS:
        raise KeyError(f"Unknown symbol: '{symbol}'. Add to CONTRACT_SPECS in config.py.")
    return CONTRACT_SPECS[symbol]

MARGIN_EXPANSION_MULTIPLIER = 2.0  # Applied when VIX > 30 or ATR > 90th percentile

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
    # Optional execution-realism fields mirrored from TS BacktestConfig.
    # overnight_hold is consumed by simulate_all_firms() (line ~2676 in backtester.py).
    # fill_rate/spread_multiplier are consumed as positional args to run_backtest()
    # but not yet wired through from StrategyConfig — see backtester.py TODO.
    fill_rate: Optional[float] = 1.0
    spread_multiplier: Optional[float] = 1.0

    @field_validator("overnight_hold")
    @classmethod
    def reject_overnight(cls, v: bool) -> bool:
        if v:
            raise ValueError("Overnight holding is disabled — all strategies must be intraday-only")
        return v

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
    # P1-E: "stop" and "stop_market" are prohibited per CLAUDE.md —
    # stop-market orders cause catastrophic slippage in live futures.
    # Valid values: "market", "limit", "stop_limit".
    # "stop" is kept in the Literal for parse compatibility but rejected by validator.
    order_type: Literal["market", "limit", "stop", "stop_limit"] = "market"
    limit_at_current: float = 0.95
    limit_1_tick: float = 0.80
    limit_at_sr: float = 0.60
    limit_at_extreme: float = 0.50
    partial_fill_threshold: float = 0.70
    latency_ms: int = 50  # Simulated order latency

    @field_validator("order_type")
    @classmethod
    def reject_stop_market(cls, v: str) -> str:
        """Reject stop-market order types (CLAUDE.md mandate).

        Stop-market orders are prohibited because they cause catastrophic slippage
        in live futures trading, especially around news events and overnight gaps.
        Use 'stop_limit' instead: the price limit bounds worst-case slippage.
        """
        if v in ("stop", "stop_market"):
            raise ValueError(
                f"order_type='{v}' is prohibited (CLAUDE.md: stop-market orders "
                "cause catastrophic slippage in live futures). Use 'stop_limit' instead."
            )
        return v


# ─── Backtest Request ─────────────────────────────────────────────

class BacktestRequest(BaseModel):
    strategy: StrategyConfig
    start_date: str  # YYYY-MM-DD
    end_date: str    # YYYY-MM-DD
    slippage_ticks: float = 1.0
    commission_per_side: float = 0.62  # MES micro default (was 4.50 ES full-size — 7x too high)
    mode: Literal["single", "walkforward"] = "single"
    walk_forward_splits: int = 5
    embargo_bars: int = 0  # Bars to skip between IS/OOS (prevents data leakage)
    max_trades_per_day: int = 2  # Max entries per calendar day (long + short combined)
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
    run_receipt: Optional[dict] = None


# ─── Run Receipt (Reproducibility) ───────────────────────────

class RunReceipt(BaseModel):
    engine_version: str = ""
    git_commit: str = ""
    code_hash: str = ""
    config_hash: str = ""
    dataset_hash: str = ""
    random_seed: int = 42
    numpy_version: str = ""
    polars_version: str = ""
    python_version: str = ""
    timestamp_utc: str = ""
    determinism_verified: bool = False


# ─── Data Quality Report ─────────────────────────────────────────

class DataQualityReport(BaseModel):
    total_bars: int
    duplicate_timestamps: int = 0
    duplicate_ohlcv_rows: int = 0
    ohlc_violations: int = 0        # high < low, close outside range
    zero_volume_bars: int = 0
    out_of_session_bars: int = 0
    large_gap_bars: int = 0         # reuse existing 5% threshold
    coverage_pct: float = 100.0     # actual bars / expected bars
    zero_negative_prices: int = 0   # bars with zero or negative prices
    dataset_hash: str = ""
    warnings: list[str] = []
    passed: bool = True


# ─── Monte Carlo Request ─────────────────────────────────────────

class MonteCarloRequest(BaseModel):
    backtest_id: str
    num_simulations: int = 100_000
    method: Literal["trade_resample", "return_bootstrap", "block_bootstrap", "arch_stationary", "both"] = "both"
    confidence_levels: list[float] = [0.05, 0.25, 0.50, 0.75, 0.95]
    ruin_threshold: float = 0.0
    initial_capital: float = 50_000.0
    use_gpu: bool = True
    max_paths_to_store: int = 100
    is_oos_trades: bool = False
    stress_level: int = 0  # 0=none, 1=moderate, 2=severe, 3=extreme
    inject_synthetic_stress: bool = False
    firms: list[str] = []  # If non-empty, run per-firm survival simulation
    seed: int = 42
    max_stop_points: float = 6.0       # For stress injection cap
    point_value: float = 5.0           # MES default
    stress_inject_multiplier: float = 2.0  # Cap synthetic loss at multiplier × max_stop_points × point_value
    run_permutation_test: bool = False
    permutation_n: int = 1000
    n_variants: int = 1  # Number of strategy variants tested (for Bonferroni/DSR correction)

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
