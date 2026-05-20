"""Strategy configuration schema — Pydantic v2 models.

Contract specs MUST match src/server/routes/risk.ts lines 6-15 exactly.
"""

from __future__ import annotations  # noqa: I001

import os
from dataclasses import dataclass
from typing import Literal, Optional

from pydantic import BaseModel, field_validator, model_validator


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


# ─── Track 3 pyramid constants (Wave 21 E.1) ──────────────────────────────────
# Centralised here so sizing.py + backtester.py import from one source.
# MES_PYRAMID_CAP: max contracts before risk-derived ceiling overrides.
# PYRAMID_GRADUATION_PNL: cumulative profit trigger for tier step-up.

@dataclass(frozen=True)
class _Track3Config:
    MES_PYRAMID_CAP: int = 30
    PYRAMID_GRADUATION_PNL: float = 3_000.0  # +3 contracts per +$3K cumulative profit
    # Hard time-stop: flatten all positions at 15:55 ET (5 minutes before RTH close).
    # Per CLAUDE.md §4: "Time-stop: hard flatten 15:55 ET".
    # Configurable via env var TIME_STOP_FLATTEN_ET (default "15:55").
    TIME_STOP_FLATTEN_ET: str = os.environ.get("TIME_STOP_FLATTEN_ET", "15:55")

TRACK3_CONFIG = _Track3Config()

VALID_INDICATOR_TYPES = {
    "sma", "ema", "rsi", "macd", "vwap", "bbands", "atr", "adx", "adr",
    # Phase 9: opening_range_breakout shipped atomically with compute_opening_range_breakout()
    # in indicators/core.py and the dispatcher branch in compute_indicators().
    # Emits orh_{range_minutes}m, orl_{range_minutes}m, or_range_{range_minutes}m columns.
    "opening_range_breakout",
}


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
    # Opening Range Breakout-specific (Phase 9)
    range_minutes: Optional[int] = None        # OR window length in minutes (default 15)
    session_start_et: Optional[str] = None     # Session open in ET, "HH:MM" (default "09:30")

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
# Wave 21 E.1: Extended to support "risk_derived_pyramid" in addition to
# the existing "dynamic_atr" and "fixed" types.
# All 8 new fields default to None — absent for legacy strategies; Pydantic
# validators enforce valid ranges only when the fields are explicitly set.
# Backward compat: "fixed" and "dynamic_atr" strategies are unaffected.

class PositionSizeConfig(BaseModel):
    type: Literal["dynamic_atr", "fixed", "risk_derived_pyramid"]
    target_risk_dollars: float = 500.0
    fixed_contracts: int = 1

    # Wave 21 E.1 — risk_derived_pyramid fields (all optional for backward compat)
    # base_contracts: starting pyramid tier (floor). Pyramid ramps from here.
    base_contracts: Optional[int] = None
    # tier_increment: contracts added per tier_threshold_dollars of cumulative profit.
    tier_increment: Optional[int] = None
    # tier_threshold_dollars: profit step triggering next pyramid tier.
    tier_threshold_dollars: Optional[float] = None
    # max_risk_pct_per_trade: fraction of risk-base to risk per trade (e.g. 0.02 = 2%).
    max_risk_pct_per_trade: Optional[float] = None
    # personal_dll_pct: fraction of firm DLL that triggers personal halt (default 0.67).
    personal_dll_pct: Optional[float] = None
    # liquidity_comfort_cap: per-symbol contract ceiling from book-depth analysis.
    liquidity_comfort_cap: Optional[int] = None
    # topstep_account_cap_override: override firm cap for Topstep trailing-DD math.
    topstep_account_cap_override: Optional[int] = None
    # firm_contract_cap: explicit per-firm tier cap from firm_config.py.
    firm_contract_cap: Optional[int] = None

    @field_validator("base_contracts")
    @classmethod
    def validate_base_contracts(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v <= 0:
            raise ValueError(f"base_contracts must be > 0, got {v}")
        return v

    @field_validator("max_risk_pct_per_trade")
    @classmethod
    def validate_max_risk_pct(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not (0 < v <= 0.05):
            raise ValueError(
                f"max_risk_pct_per_trade must be in (0, 0.05], got {v}. "
                "Values > 5% indicate a misconfiguration (risk math expects fraction, not percent)."
            )
        return v

    @field_validator("personal_dll_pct")
    @classmethod
    def validate_personal_dll_pct(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not (0 < v <= 1.0):
            raise ValueError(
                f"personal_dll_pct must be in (0, 1.0], got {v}. "
                "Must be a fraction of firm DLL, e.g. 0.67 = 67%."
            )
        return v

    @model_validator(mode="after")
    def validate_fixed_contracts_not_default(self) -> "PositionSizeConfig":
        """H7 FIX: Fail-fast if fixed_contracts=1 (the default) is used without
        an explicit override. A silent fixed_contracts=1 in production backtests
        means every strategy silently trades 1 contract regardless of account size,
        producing metrics that don't reflect actual risk exposure.

        To suppress this check in tests: set env var TF_ALLOW_FIXED_1=true.
        To suppress for a specific strategy: explicitly set fixed_contracts > 1.
        """
        if (
            self.type == "fixed"
            and self.fixed_contracts == 1
            and os.environ.get("TF_ALLOW_FIXED_1", "false").lower() != "true"
        ):
            raise ValueError(
                "position_size.fixed_contracts=1 detected with type='fixed'. "
                "This is the default and is almost certainly a misconfiguration for "
                "production backtests. Explicit sizing is required. "
                "Set fixed_contracts to the intended value (e.g. 6 for MES base), "
                "switch to type='risk_derived_pyramid', or set TF_ALLOW_FIXED_1=true "
                "to allow this in unit tests only."
            )
        return self


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
    # W23H.1 — Multi-Timeframe fields.
    # bias_timeframe: HTF used for trend-bias gating (e.g. '4h', '1d').
    #   When non-null, run_backtest() loads this TF, computes HTF indicators with
    #   suffix '_{bias_timeframe}', and joins them into exec_df before signal gen.
    #   The compiled entry_long/entry_short grammar references these suffixed cols
    #   (e.g. 'ema_50_4h > ema_200_4h') — signals.py evaluate_expression() handles
    #   arbitrary column names, so no parser changes needed.
    # bias_condition: raw bias condition string (e.g. 'ema_50_4h > ema_200_4h').
    #   Stored for audit/debug. Not re-evaluated at backtest time — it is already
    #   compiled into entry_long/entry_short by dsl-compiler.ts.
    bias_timeframe: Optional[str] = None
    bias_condition: Optional[str] = None

    # W23H.3 — Allowed entry windows.
    # When non-empty, entry signals are masked to bars that fall in at least one window.
    # When None or [] (default), no time restriction is applied — backward compatible.
    # Format: ["HH:MM-HH:MM TZ", ...] e.g. ["09:45-12:00 ET", "13:30-15:30 ET"].
    # Validated at parse time by parse_entry_windows() — ValueError on malformed spec.
    # Parity: mirrors paper-signal-service.ts window check and Pine time() emission.
    allowed_entry_windows: Optional[list[str]] = None

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
