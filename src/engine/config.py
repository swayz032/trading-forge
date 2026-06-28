"""Strategy configuration schema — Pydantic v2 models.

Contract specs MUST match src/server/routes/risk.ts lines 6-15 exactly.

─── Phase 5 Mini Contract Scaffold ────────────────────────────────────────────

Phase 5 deployment criteria: operator funded account balance >= $200K.
This is a FUTURE deployment, not currently active.

How to enable: set TF_PHASE_5_ENABLED=true in tower .env AFTER:
  1. Operator deposits and funded balance reaches $200K
  2. Operator runs the Phase 5 validation cycle (manual sign-off required)
  3. System Map sync passes with mini contract entries registered

Why feature-gated: prevent accidental 10x size inflation from generic symbol
routing. The micro aliases (ES→$5/pt, NQ→$2/pt, CL→$100/pt) vs true minis
(ES=$50/pt, NQ=$20/pt, CL=$1000/pt) differ by exactly 10x. Routing a mini
symbol to the micro spec silently inflates risk math by a full order of magnitude.

Reference: CLAUDE.md §5 "Mini contracts (ES/NQ/CL) are FUTURE — graduate when
single account funded balance >= $200K" and feedback_day_trader_only_no_swing.md
(Pass 1 Track 1 safety guard). See also src/shared/firm-config.ts for TS mirror.

ENABLED DEFAULT: False (institutional default is opt-IN explicitly).
FIRST-CALL WARNING: When PHASE_5_ENABLED=True, a stderr WARN fires once per
process lifetime so operators cannot miss Phase 5 activation on boot.
"""

from __future__ import annotations  # noqa: I001

import os
import sys
from dataclasses import dataclass
from typing import Literal, Optional

from datetime import datetime

from pydantic import BaseModel, field_validator, model_validator


# ─── Phase 5 Feature Gate ───────────────────────────────────────────────────────
#
# PHASE_5_ENABLED controls whether mini contract specs (ES/NQ/CL at 10x point
# values) are accessible via resolve_contract_spec().
#
# Default: False — micro-only safety, matches all current production strategies.
# Enable: set env var TF_PHASE_5_ENABLED=true (case-insensitive) on tower .env.
#
# DO NOT set this to True until the operator has a funded balance >= $200K and
# has completed the Phase 5 validation cycle.

PHASE_5_ENABLED: bool = os.environ.get("TF_PHASE_5_ENABLED", "false").lower() == "true"

# Track whether the Phase 5 activation WARN has already been printed this process.
# One-shot: we warn once on first call, not on every resolve.
_phase5_warn_emitted: bool = False


# ─── Contract Specs (mirrors risk.ts) ──────────────────────────────

class ContractSpec(BaseModel):
    tick_size: float
    tick_value: float
    point_value: float
    day_margin: float = 500       # Intraday margin per contract
    overnight_margin: float = 0   # Overnight/maintenance margin per contract
    default_commission: float = 0.62  # Per-side commission (MES/micro default)
    contract_class: Literal["micro", "mini"] = "micro"  # Phase 5 scaffold field


# ─── Micro contract specs (current production) ─────────────────────────────────
#
# These are the ONLY specs used today. All graduated strategies trade these.
# Do NOT remove or modify these entries — downstream regression tests pin them.

_MICRO_SPECS: dict[str, ContractSpec] = {
    "MES": ContractSpec(
        tick_size=0.25, tick_value=1.25,  point_value=5.00,
        day_margin=50,  overnight_margin=2659, contract_class="micro",
    ),
    "MNQ": ContractSpec(
        tick_size=0.25, tick_value=0.50,  point_value=2.00,
        day_margin=50,  overnight_margin=4044, contract_class="micro",
    ),
    "MCL": ContractSpec(
        tick_size=0.01, tick_value=1.00,  point_value=100.00,
        day_margin=50,  overnight_margin=1120, contract_class="micro",
    ),
}

# ─── Phase 5 mini contract specs (FUTURE — NOT active in production) ───────────
#
# True CME e-mini specs with INSTITUTIONAL-CORRECT 10x point values vs micros.
# Verified against CME Group fee schedule and contract specifications 2026-05-25.
#
# ES: 250 × price (50 pts/contract × $50/pt = $12,500/point — correction: $50/pt)
# NQ: 20 × price  ($20/pt vs MNQ $2/pt)
# CL: 1,000 barrels × $1/bbl = $1,000/pt vs MCL $100/pt
#
# These entries are SEPARATE from the micro aliases below — they carry distinct
# contract_class="mini" and 10x point_value. The micro aliases (ES/NQ/CL in
# CONTRACT_SPECS) remain intact for S3 data-path backward compat.

_MINI_SPECS: dict[str, ContractSpec] = {
    "ES": ContractSpec(
        tick_size=0.25,  tick_value=12.50, point_value=50.00,
        day_margin=500,  overnight_margin=26590, contract_class="mini",
        default_commission=3.70,  # Topstep rate (conservative for unknown firm)
    ),
    "NQ": ContractSpec(
        tick_size=0.25,  tick_value=5.00,  point_value=20.00,
        day_margin=500,  overnight_margin=40440, contract_class="mini",
        default_commission=3.70,
    ),
    "CL": ContractSpec(
        tick_size=0.01,  tick_value=10.00, point_value=1000.00,
        day_margin=5000, overnight_margin=11200, contract_class="mini",
        default_commission=3.70,
    ),
}


# ─── Merged CONTRACT_SPECS table ────────────────────────────────────────────────
#
# Maintains the existing public API: CONTRACT_SPECS["MES"] / ["ES"] etc.
# The ES/NQ/CL entries here remain the MICRO aliases (for S3 data-path compat).
# Phase 5 true-mini specs live in _MINI_SPECS and are accessed only via
# resolve_contract_spec() with an explicit contract_class argument or PHASE_5_ENABLED.

CONTRACT_SPECS: dict[str, ContractSpec] = {
    # Micro contracts only — user trades MES/MNQ/MCL exclusively
    "MES": _MICRO_SPECS["MES"],
    "MNQ": _MICRO_SPECS["MNQ"],
    "MCL": _MICRO_SPECS["MCL"],
    # S3 data path labels — intentionally map to MICRO specs (ES→MES, NQ→MNQ, CL→MCL).
    # WARNING: point_value here is MICRO (NQ=$2, ES=$5, CL=$100), NOT full-size ($20/$50/$1000).
    # Any caller passing these symbols receives micro P&L. This is the documented design
    # for this system. Use get_contract_spec() to surface a runtime warning when accessed.
    "ES":  _MICRO_SPECS["MES"],
    "NQ":  _MICRO_SPECS["MNQ"],
    "CL":  _MICRO_SPECS["MCL"],
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


def resolve_contract_spec(
    symbol: str,
    contract_class: Optional[str] = None,
) -> ContractSpec:
    """Resolve the ContractSpec for a symbol with Phase 5 safety gating.

    This is the Phase 5-aware replacement for direct CONTRACT_SPECS lookups.
    All new callers that may encounter ES/NQ/CL symbols should use this helper
    rather than CONTRACT_SPECS[symbol] directly.

    Resolution rules:
    1. If contract_class explicitly provided:
       - "micro" → returns the micro spec (from _MICRO_SPECS / CONTRACT_SPECS)
       - "mini"  → returns the true mini spec (from _MINI_SPECS)
       - other   → raises ValueError with valid options
    2. If contract_class is None AND PHASE_5_ENABLED is False:
       - Always returns the MICRO spec (safety default — prevent accidental 10x
         risk inflation from generic symbol routing during Phase 1-4 deployment)
    3. If contract_class is None AND PHASE_5_ENABLED is True:
       - Raises ValueError demanding explicit class
       - This forces every call site to explicitly declare intent when Phase 5
         is live — prevents silent micro/mini confusion in production

    Audit: if PHASE_5_ENABLED is True, a one-shot WARN fires to stderr on first
    call so operators cannot miss Phase 5 activation on boot.

    Args:
        symbol: Contract symbol. Case-sensitive; use uppercase (MES, ES, NQ, etc.)
        contract_class: "micro", "mini", or None (auto-resolve per rules above).

    Returns:
        ContractSpec matching the resolved class.

    Raises:
        KeyError: symbol not in any known spec table.
        ValueError: invalid contract_class value, or ambiguous (Phase 5 + no class).
    """
    global _phase5_warn_emitted

    # ── Phase 5 activation banner (one-shot per process) ───────────────────────
    if PHASE_5_ENABLED and not _phase5_warn_emitted:
        print(
            "WARN [config.py::resolve_contract_spec] PHASE_5_ENABLED=True — "
            "mini contract specs (ES/NQ/CL at 10x point values) are active. "
            "Verify operator has funded balance >= $200K and completed Phase 5 "
            "validation cycle before any live order routing.",
            file=sys.stderr,
        )
        _phase5_warn_emitted = True

    sym_upper = symbol.upper() if symbol else symbol

    # ── Explicit contract_class provided ───────────────────────────────────────
    if contract_class is not None:
        if contract_class == "micro":
            # Map mini ticker names back to the micro spec entry
            micro_sym = sym_upper
            if micro_sym in _MICRO_ALIAS_SYMBOLS:
                # ES→MES, NQ→MNQ, CL→MCL for point-value lookup
                _alias_map = {"ES": "MES", "NQ": "MNQ", "CL": "MCL"}
                micro_sym = _alias_map[micro_sym]
            if micro_sym not in _MICRO_SPECS:
                raise KeyError(
                    f"Unknown micro symbol: '{symbol}'. "
                    f"Valid micro symbols: {sorted(_MICRO_SPECS.keys())}"
                )
            return _MICRO_SPECS[micro_sym]

        elif contract_class == "mini":
            # Direct mini lookup — only valid for ES/NQ/CL
            _mini_sym = sym_upper
            # Also accept MES/MNQ/MCL as a mistaken mini request and correct course
            _micro_to_mini = {"MES": "ES", "MNQ": "NQ", "MCL": "CL"}
            if _mini_sym in _micro_to_mini:
                raise ValueError(
                    f"Symbol '{symbol}' is a micro contract. "
                    f"For the mini equivalent use '{_micro_to_mini[_mini_sym]}' + contract_class='mini'."
                )
            if _mini_sym not in _MINI_SPECS:
                raise KeyError(
                    f"Unknown mini symbol: '{symbol}'. "
                    f"Valid Phase 5 mini symbols: {sorted(_MINI_SPECS.keys())}"
                )
            return _MINI_SPECS[_mini_sym]

        else:
            raise ValueError(
                f"Invalid contract_class='{contract_class}'. "
                f"Must be 'micro' or 'mini'."
            )

    # ── No explicit class — apply Phase 5 gating ───────────────────────────────
    if PHASE_5_ENABLED:
        raise ValueError(
            f"resolve_contract_spec('{symbol}') called without explicit contract_class "
            f"while PHASE_5_ENABLED=True. "
            f"When Phase 5 is active every call site must explicitly declare "
            f"contract_class='micro' or contract_class='mini' to prevent accidental "
            f"10x size inflation. Set TF_PHASE_5_ENABLED=false to restore "
            f"micro-safety-default behaviour."
        )

    # PHASE_5_ENABLED=False + no class → safety default: always return micro spec
    # This is the default for all Phase 1-4 deployment. ES/NQ/CL route to micro.
    if sym_upper in _MICRO_ALIAS_SYMBOLS:
        _alias_map = {"ES": "MES", "NQ": "MNQ", "CL": "MCL"}
        return _MICRO_SPECS[_alias_map[sym_upper]]
    if sym_upper in _MICRO_SPECS:
        return _MICRO_SPECS[sym_upper]
    raise KeyError(
        f"Unknown symbol: '{symbol}'. "
        f"Valid symbols: {sorted(set(_MICRO_SPECS) | set(_MICRO_ALIAS_SYMBOLS))}"
    )

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
    # F-7 fix (2026-05-20): donchian channel
    "donchian",
    # Wave 25 Pass 5: VWAP bands (session-resetting 1σ/2σ) and anchored VWAP.
    # vwap_with_bands emits vwap, vwap_band_1s_upper/lower, vwap_band_2s_upper/lower.
    # anchored_vwap emits anchored_vwap_<anchor_iso>; requires anchor_ts on IndicatorConfig.
    "vwap_with_bands",
    "anchored_vwap",
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
    # Anchored VWAP-specific (Wave 25 Pass 5)
    # anchor_ts: the bar timestamp from which cumulative VWAP accumulates.
    # Bars before anchor_ts receive null in the output column.
    anchor_ts: Optional[datetime] = None

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


# ─── Adaptive Exit Context (Wave 25 Gap B) ───────────────────────
#
# TS → Python liquidity transport contract.
#
# At backtest run launch (when TS calls backtester.py for a strategy with
# exit_style="adaptive"), the TS launch helper:
#   1. Queries liquidity_levels for the strategy's symbol (intraday-only, ranked)
#   2. Snapshots a list of LiquidityLevelSnapshot rows
#   3. Bakes them into BacktestRequest.adaptive_exit_context.liquidity_snapshot
#
# Python backtester.py reads this list at run start.
# NO DB calls inside Python at signal time — pure snapshot replay.
#
# Backward compat: missing field → None → adaptive path bails to static_styleC.
# This is documented as the Gap B contract between TS and Python.


@dataclass
class LiquidityLevelSnapshot:
    """A single liquidity level from the liquidity_levels table.

    Mirrors the TS RankedLevel shape from liquidity-map-service.ts.
    level_type must be one of INTRADAY_ALLOWED_LEVEL_TYPES in adaptive_exits.py.
    """
    level_type: str          # 'pdh'|'pdl'|'asian_high'|'asian_low'|'london_high'|'london_low'
                             # |'naked_poc'|'untouched_fvg'|'untouched_ob'|'eqh'|'eql'|'hod'|'lod'
    price: float
    htf_significance: int    # 1-5 (5 = highest significance)
    sweep_probability: Optional[float] = None   # [0,1] or None if not yet computed


@dataclass
class AdaptiveExitContext:
    """Config snapshot for the adaptive exit path in Python backtester.

    Populated by the TS launch helper at run start and passed into
    _apply_adaptive_management() via BacktestRequest.adaptive_exit_context.

    Fields:
        liquidity_snapshot: Intraday liquidity levels for the strategy's symbol,
            pre-filtered + ranked by the TS launch helper.
        regime_at_entry: Institutional regime string (fallback for tests when
            bias_engine is not in scope). The backtester overwrites this with
            the per-bar classify_institutional_regime() result in production.
        pre_lunch_threshold_r: Minimum profit R for pre-lunch partial to fire
            (default 0.3 per W25.16).
        delta_div_threshold: Cumulative-delta divergence threshold for 25% early
            partial close (default 0.6 per W25.14).
    """
    liquidity_snapshot: list  # list[LiquidityLevelSnapshot] — list for JSON serializability
    regime_at_entry: Optional[str] = None
    pre_lunch_threshold_r: float = 0.3
    delta_div_threshold: float = 0.6


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
    # Wave 24 Pass 2 — vol-scale + liquidity-haircut parity with paper engine.
    # vix_now: spot VIX at backtest run time (scalar, not time-series).
    #   None → vol-scale = 1.0 (fail-open). Emits parity_warn.no_vix_in_backtest.
    # top3_depth_ratio: currentTop3Depth / baseline20dMedianTop3Depth pre-computed
    #   by the caller. None → liquidity-haircut = 1.0 (fail-open). Historical
    #   book-depth series are not available in Parquet; caller provides a scalar ratio
    #   or omits it. Parity gap is documented in result["parity_metadata"] when absent.
    vix_now: Optional[float] = None
    top3_depth_ratio: Optional[float] = None  # currentTop3Depth / baseline20dMedian
    # W25.17 A/B flag — which exit engine to use for this run.
    # "static_styleC"  → existing Style C 33/33/34 TP1/TP2/runner path (default, backward-compat).
    # "adaptive"       → adaptive exit engine (Wave 25 Gap B — Python mirror of adaptive-exit-engine.ts).
    # Downstream: run_class_backtest() reads this; framework-overlay.ts respects it via compile config.
    exit_engine: Literal["static_styleC", "adaptive"] = "static_styleC"
    # Wave 25 Gap B — TS → Python liquidity transport contract.
    # Populated by the TS launch helper when exit_engine="adaptive".
    # None → adaptive path bails gracefully to static_styleC (backward compat).
    # See AdaptiveExitContext dataclass above for full contract documentation.
    adaptive_exit_context: Optional[object] = None  # type: Optional[AdaptiveExitContext]
    # F-4 Wave 4 Track 4C Research Governance: cumulative mutation trial count for this
    # strategy across all evolution cycles. Used by walk_forward.py CPCV DSR to compute
    # the correct effective n_trials = max(cpcv_paths, trial_n_total), preventing 2–5×
    # Sharpe inflation that occurs when the denominator assumes only 1 trial.
    # The TS critic-optimizer-service passes this from evidence.trial_n_total.
    # Default 1 = safe fail-open (same as pre-F4 behaviour — no inflation regression).
    trial_n_total: int = 1


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
    method: Literal[
        "trade_resample",
        "return_bootstrap",
        "block_bootstrap",
        "arch_stationary",
        "both",
        # Wave 27.5 Pass D.4 — opt-IN methods (default off; env var required)
        "regime_block_bootstrap",    # MED #7: regime-aware resample (MC_REGIME_AWARE_BOOTSTRAP_ENABLED=true)
        "multi_asset_correlation",   # MED #8: multi-asset Cholesky bootstrap (MC_MULTI_ASSET_CORRELATION_ENABLED=true)
    ] = "both"
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
    # F-10 FIX: actual round-trip commission used in the backtest (both sides, $).
    # Pass bt.config.commission_per_side * 2 from the TS bridge.
    # When None, simulate_firm_survival falls back to $1.24 default and emits a warning.
    backtest_commission_rt: Optional[float] = None
    # F-12 FIX: observed avg trades per day from the backtest.
    # Pass bt.totalTrades / bt.totalTradingDays from the TS bridge.
    # Consumed by simulate_firm_survival as daily_trades_per_day for commission delta math.
    avg_trades_per_day: float = 1.5
    # Wave 27.5 Pass A.1 — CRITICAL #1: Firm-rule parameter drift check.
    # Pass backtests.firm_rules_version from the DB row.  MC asserts this matches
    # the current compute_firm_rules_version() before running any simulation.
    # None means the backtest predates the drift-check feature; MC runs with a warning.
    backtest_firm_rules_version: Optional[str] = None

    # Wave 27.5 Pass C.1 — HIGH #8: Optional outlier truncation.
    # Trims extreme individual trade P&Ls to ±multiplier × |worst_month| before
    # bootstrap resampling.  Prevents a single catastrophic trade from dominating
    # block-bootstrap resampling and artificially amplifying tail risk in paths.
    # Default: None (no trimming — backward compat).
    # Institutional default: 2.0.  Set MC_TRIM_OUTLIER_MULTIPLIER env var to activate.
    # WARNING: trimming reduces tail-risk reflection of true catastrophic events.
    # Use with care — opt-IN only.
    trim_outlier_multiplier: Optional[float] = None

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
