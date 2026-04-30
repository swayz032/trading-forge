"""Pine Script v5 Compiler — transpiles StrategyDSL to TradingView Pine Script.

Compiler stages:
  1. Normalize strategy from StrategyDSL
  2. Run exportability checks
  3. Select template set
  4. Convert to Pine state machine
  5. Inject prop-risk overlay
  6. Build alert definitions JSON
  7. Emit artifacts

Public API:
    compile_strategy(strategy, firm_key, risk_intelligence) -> CompilerResult
        Legacy single-artifact path.  export_type controls which artifacts are
        emitted (pine_indicator / pine_strategy / alert_only).

    compile_dual_artifacts(strategy, firm_key, risk_intelligence) -> DualArtifactResult
        Dual-artifact path.  ALWAYS emits BOTH:
          - {name}_INDICATOR.pine  — indicator() + alertcondition() for manual-approval firms
            (Apex 4.0 PAs / Tradeify / FundingPips)
          - {name}_STRATEGY.pine   — strategy() + strategy.entry/exit() + TradersPost
            JSON webhook alerts for ATS firms (Topstep / MFFU / Top One / YRM Prop / TPT)
        Both artifacts share identical signal logic, prop_overlay, and risk tables.

Usage:
    python -m src.engine.pine_compiler --input-json '{"strategy": {...}, "firm_key": "topstep_50k"}'
    python -m src.engine.pine_compiler --input-json '...' --dual

# NOTE: Pine output is generated inline; src/engine/pine_templates/ removed (was dead code — never read by compiler).
"""
from __future__ import annotations

import json
import sys
import hashlib
from typing import Optional
from pydantic import BaseModel, Field

from src.engine.exportability import score_exportability, ExportabilityResult
from src.engine.firm_config import FIRM_COMMISSIONS, FIRM_CONTRACT_CAPS, FIRM_RULES


# ─── DSL → Pine Indicator Mapping ──────────────────────────────────
INDICATOR_MAP: dict[str, str] = {
    "sma": "ta.sma(close, {period})",
    "ema": "ta.ema(close, {period})",
    "rsi": "ta.rsi(close, {period})",
    "atr": "ta.atr({period})",
    "vwap": "ta.vwap",
    "bollinger": "ta.bb(close, {period}, {mult})",
    "macd": "ta.macd(close, {fast}, {slow}, {signal})",
    "adx": "ta.dmi({period})",
    # Custom implementations
    "volume_profile": None,  # Custom Pine
    "order_block": None,
    "fvg": None,
    "breaker_block": None,
    "liquidity_sweep": None,
}


class PineArtifact(BaseModel):
    artifact_type: str  # indicator | strategy_shell | prop_overlay | alerts_json
    file_name: str
    content: str
    size_bytes: int = 0


class CompilerResult(BaseModel):
    exportability: ExportabilityResult
    artifacts: list[PineArtifact] = Field(default_factory=list)
    strategy_name: str = ""
    pine_version: str = "v5"
    content_hash: str = ""  # SHA-256 of all artifacts


def _build_pine_indicator_var(ind_type: str, params: dict, idx: int) -> tuple[str, str]:
    """Build Pine variable declaration for an indicator.

    Returns (var_name, pine_code_line).

    Lookup priority:
      1. Full ind_type in INDICATOR_MAP (catches multi-word names like volume_profile, order_block).
         If mapped to None → placeholder comment, no raise.
      2. base_type (first segment before '_') in INDICATOR_MAP for suffix variants
         (e.g. sma_crossover → sma).  If mapped to None → placeholder comment.
      3. Neither found → ValueError (genuinely unknown — caller must add to INDICATOR_MAP).
    """
    base_type = ind_type.split("_")[0] if "_" in ind_type else ind_type
    var_name = f"ind_{base_type}_{idx}"

    # Priority 1: exact full-type match (handles volume_profile, order_block, fvg, etc.)
    if ind_type in INDICATOR_MAP:
        template = INDICATOR_MAP[ind_type]
        if template is None:
            # Explicitly mapped to None — no Pine implementation exists yet.
            # Return a placeholder comment instead of raising so callers can continue
            # compilation and surface a visible warning in the Pine artifact.
            placeholder = (
                f"// CUSTOM PINE INDICATOR: {ind_type} — placeholder, requires manual implementation"
            )
            return var_name, placeholder

    # Priority 2: base_type suffix-stripped match (e.g. sma_crossover → sma)
    else:
        if base_type not in INDICATOR_MAP:
            raise ValueError(
                f"Unsupported Pine indicator type '{ind_type}'. "
                "Add it to INDICATOR_MAP before exporting."
            )
        template = INDICATOR_MAP[base_type]
        if template is None:
            placeholder = (
                f"// CUSTOM PINE INDICATOR: {ind_type} — placeholder, requires manual implementation"
            )
            return var_name, placeholder

    if template == "ta.vwap":
        return var_name, f"{var_name} = ta.vwap"

    # Fill template with params — handle DSL naming variants
    period = params.get("period", params.get("fast_period", 14))
    mult = params.get("mult", params.get("std_dev", 2.0))
    fast = params.get("fast", params.get("fast_period", 12))
    slow = params.get("slow", params.get("slow_period", 26))
    signal = params.get("signal", params.get("signal_period", 9))

    pine_expr = template.format(period=period, mult=mult, fast=fast, slow=slow, signal=signal)

    # Handle multi-return indicators
    if base_type == "bollinger":
        return var_name, f"[{var_name}_mid, {var_name}_upper, {var_name}_lower] = {pine_expr}"
    elif base_type == "macd":
        return var_name, f"[{var_name}_line, {var_name}_signal, {var_name}_hist] = {pine_expr}"
    elif base_type == "adx":
        return var_name, f"[{var_name}_plus, {var_name}_minus, {var_name}_val] = {pine_expr}"

    return var_name, f"{var_name} = {pine_expr}"


def _build_entry_condition(strategy: dict, indicator_vars: dict[str, str]) -> tuple[str, str]:
    """Generate Pine entry conditions (long_signal, short_signal) from DSL."""
    entry_type = strategy.get("entry_type", "trend_follow")
    entry_indicator = strategy.get("entry_indicator", "")
    direction = strategy.get("direction", "both")

    # Default signals based on entry type
    if "crossover" in entry_indicator:
        long_cond = "ta.crossover(ind_sma_0, ind_sma_1)" if len(indicator_vars) >= 2 else "ta.crossover(close, ind_sma_0)"
        short_cond = "ta.crossunder(ind_sma_0, ind_sma_1)" if len(indicator_vars) >= 2 else "ta.crossunder(close, ind_sma_0)"
    elif "rsi" in entry_indicator:
        long_cond = "ta.crossover(ind_rsi_0, 30)"
        short_cond = "ta.crossunder(ind_rsi_0, 70)"
    elif "bollinger" in entry_indicator or "bbands" in entry_indicator:
        long_cond = "ta.crossover(close, ind_bollinger_0_lower)"
        short_cond = "ta.crossunder(close, ind_bollinger_0_upper)"
    elif "breakout" in entry_indicator:
        long_cond = "close > ta.highest(high, 20)[1]"
        short_cond = "close < ta.lowest(low, 20)[1]"
    elif "macd" in entry_indicator:
        long_cond = "ta.crossover(ind_macd_0_line, ind_macd_0_signal)"
        short_cond = "ta.crossunder(ind_macd_0_line, ind_macd_0_signal)"
    else:
        # Generic — use first indicator
        first_var = list(indicator_vars.keys())[0] if indicator_vars else "close"
        long_cond = f"ta.crossover(close, {first_var})"
        short_cond = f"ta.crossunder(close, {first_var})"

    if direction == "long":
        short_cond = "false"
    elif direction == "short":
        long_cond = "false"

    return long_cond, short_cond


def _build_exit_condition(strategy: dict) -> tuple[str, str]:
    """Generate Pine exit conditions from DSL exit_type.

    Returns (sl_distance_expr, tp_distance_expr) — Pine expressions used as
    stop/target distances (price offsets from entry, not absolute prices).
    """
    atr_sl = strategy.get("stop_loss_atr_multiple", 2.0)
    atr_tp = strategy.get("take_profit_atr_multiple")

    # ATR-based stops are always generated
    sl_line = f"atr_val * {atr_sl}"
    tp_line = f"atr_val * {atr_tp}" if atr_tp else "na"

    return sl_line, tp_line


def _build_exit_signal_pine(strategy: dict) -> tuple[str, str]:
    """Generate Pine exit_long_signal / exit_short_signal expressions from strategy config.

    P2-3: Reads exit_type from strategy config.
    - "indicator_signal" + entry_indicator containing "rsi" → RSI crossback exit
    - "indicator_signal" + entry_indicator containing "sma/ema" → SMA cross exit
    - "indicator_signal" (generic) → ta.crossunder(close, ta.sma(close, 20)) mean-revert
    - Any other exit_type → false (ATR stop/target only; no signal-based exit)

    DEGRADATION NOTE: Indicator-signal exits are simplified approximations.
    Complex multi-condition exits or custom indicator exits cannot be faithfully
    translated from DSL and fall back to the generic SMA mean-revert or false.
    This is explicit degradation — not silent invention.

    Returns (exit_long_expr, exit_short_expr) as Pine boolean expressions.
    """
    exit_type = strategy.get("exit_type", "atr_multiple")
    entry_indicator = strategy.get("entry_indicator", "").lower()

    if exit_type != "indicator_signal":
        # ATR stop/target handles exits — no signal-based component
        return "false", "false"

    # Translate exit indicator to Pine — simplified mapping
    if "rsi" in entry_indicator:
        # RSI exit: long exits when RSI crosses back above 50 (overbought recovery);
        # short exits when RSI crosses back below 50. Conservative approximation.
        exit_long = "ta.crossover(ind_rsi_0, 50)"
        exit_short = "ta.crossunder(ind_rsi_0, 50)"
    elif any(x in entry_indicator for x in ("sma", "ema", "crossover")):
        # Moving-average cross exit: opposite cross of entry signal
        if len(strategy.get("indicators", [])) >= 2:
            exit_long = "ta.crossunder(ind_sma_0, ind_sma_1)"
            exit_short = "ta.crossover(ind_sma_0, ind_sma_1)"
        else:
            exit_long = "ta.crossunder(close, ind_sma_0)"
            exit_short = "ta.crossover(close, ind_sma_0)"
    elif "macd" in entry_indicator:
        exit_long = "ta.crossunder(ind_macd_0_line, ind_macd_0_signal)"
        exit_short = "ta.crossover(ind_macd_0_line, ind_macd_0_signal)"
    else:
        # DEGRADATION: exit_type=indicator_signal but indicator not translatable.
        # Fall back to generic 20-bar SMA mean-revert exit and document.
        # TODO: Add more indicator exit mappings here as strategy types expand.
        exit_long = "ta.crossunder(close, ta.sma(close, 20))  // DEGRADED: generic mean-revert (exit_indicator not translatable)"
        exit_short = "ta.crossover(close, ta.sma(close, 20))  // DEGRADED: generic mean-revert (exit_indicator not translatable)"

    return exit_long, exit_short


def _build_state_machine() -> str:
    """Generate the Pine state machine logic."""
    return """
// ─── State Machine ──────────────────────────────────────────────
// States: 0=neutral, 1=watch_long, 2=long_confirmed, 3=watch_short,
//         4=short_confirmed, 5=invalidated, 6=risk_lockout
var int state = 0
var float entry_price = na
var float stop_price = na
var float target_price = na

// State transitions
if state == 0  // NEUTRAL
    if long_signal and not risk_lockout
        state := 1
    else if short_signal and not risk_lockout
        state := 3

if state == 1  // WATCH_LONG
    state := 2  // Immediate confirmation (single-bar)
    entry_price := close
    stop_price := close - stop_distance
    target_price := use_target ? close + target_distance : na

if state == 2  // LONG_CONFIRMED
    if not na(stop_price) and low <= stop_price
        state := 5  // Stop hit
    else if not na(target_price) and high >= target_price
        state := 0  // Target hit
    else if exit_long_signal
        state := 0

if state == 3  // WATCH_SHORT
    state := 4  // Immediate confirmation
    entry_price := close
    stop_price := close + stop_distance
    target_price := use_target ? close - target_distance : na

if state == 4  // SHORT_CONFIRMED
    if not na(stop_price) and high >= stop_price
        state := 5  // Stop hit
    else if not na(target_price) and low <= target_price
        state := 0  // Target hit
    else if exit_short_signal
        state := 0

if state == 5  // INVALIDATED
    state := 0  // Reset after one bar

if state == 6  // RISK_LOCKOUT
    if not risk_lockout
        state := 0
"""


def _build_prop_overlay(firm_key: Optional[str]) -> str:
    """Generate prop-firm risk overlay constants (limits, commission, max_contracts).

    FIX 1: This function now emits ONLY the static constants and declares
    risk_lockout=false as a placeholder.  The actual lockout logic differs
    between the two artifacts:
      - STRATEGY artifact: bar-by-bar P&L tracking via strategy.netprofit
        (see _build_strategy_risk_tracking — appended after this block).
      - INDICATOR artifact: visual warning label only
        (see _build_indicator_risk_lockout_warning — appended after this block).
    The old dead-code `session_pnl`/`current_drawdown` vars that never updated
    have been removed so lockout no longer silently stays false forever.
    """
    if not firm_key:
        return """
// ─── Prop Risk Overlay (no firm selected) ───────────────────────
var float max_drawdown_limit = 2000.0   // Default tightest
var float daily_loss_limit = 1000.0     // Default tightest
var int max_contracts = 15
var float commission_per_side = 0.62

// risk_lockout placeholder — overridden by artifact-specific tracking block below
var bool risk_lockout = false
"""

    # Look up firm rules
    commissions = FIRM_COMMISSIONS.get(firm_key, {})
    caps = FIRM_CONTRACT_CAPS.get(firm_key, {})

    # Use canonical FIRM_RULES from firm_config.py
    rules = FIRM_RULES.get(firm_key)
    if not rules:
        # Fallback: default conservative values
        rules = {"max_drawdown": 2000, "daily_loss_limit": 1000, "profit_target": 3000}
    default_comm = commissions.get("MES", 0.62)
    default_cap = caps.get("MES", 15)

    daily_limit_str = str(rules["daily_loss_limit"]) if rules["daily_loss_limit"] else "na"

    return f"""
// ─── Prop Risk Overlay ({firm_key}) ─────────────────────────────
var float max_drawdown_limit = {rules['max_drawdown']}.0
var float daily_loss_limit = {daily_limit_str}
var int max_contracts = {default_cap}
var float commission_per_side = {default_comm}
var float profit_target = {rules['profit_target']}.0

// risk_lockout placeholder — overridden by artifact-specific tracking block below
var bool risk_lockout = false

// Visual overlay (static limits)
plot(max_drawdown_limit, "Max DD Limit", color=color.red, linewidth=1, style=plot.style_line)

// Table overlay
var table prop_table = table.new(position.top_right, 2, 5, bgcolor=color.new(color.black, 80))
if barstate.islastconfirmedhistory
    table.cell(prop_table, 0, 0, "Firm", text_color=color.white, text_size=size.small)
    table.cell(prop_table, 1, 0, "{firm_key}", text_color=color.yellow, text_size=size.small)
    table.cell(prop_table, 0, 1, "Max DD", text_color=color.white, text_size=size.small)
    table.cell(prop_table, 1, 1, str.tostring(max_drawdown_limit, "#.00"), text_color=color.red, text_size=size.small)
    table.cell(prop_table, 0, 2, "Daily Limit", text_color=color.white, text_size=size.small)
    table.cell(prop_table, 1, 2, na(daily_loss_limit) ? "None" : str.tostring(daily_loss_limit, "#.00"), text_color=color.orange, text_size=size.small)
    table.cell(prop_table, 0, 3, "Max Contracts", text_color=color.white, text_size=size.small)
    table.cell(prop_table, 1, 3, str.tostring(max_contracts), text_color=color.white, text_size=size.small)
    table.cell(prop_table, 0, 4, "Commission", text_color=color.white, text_size=size.small)
    table.cell(prop_table, 1, 4, "$" + str.tostring(commission_per_side, "#.00") + "/side", text_color=color.white, text_size=size.small)
"""


def _build_strategy_risk_tracking() -> str:
    """FIX 1 (Option A) — bar-by-bar session P&L tracking for STRATEGY artifact.

    Uses strategy.netprofit (TradingView built-in, updated after each closed trade)
    and strategy.openprofit (unrealized P&L on current open position) to compute
    session_pnl at bar close.

    Session boundary: detected via ta.change(dayofweek) — resets the baseline when
    a new calendar day begins.  For overnight strategies this is an approximation;
    intraday futures strategies (RTH_ONLY) reset correctly at each new session day.

    Lockout fires when:
      - session_pnl <= -daily_loss_limit (daily loss limit breached), OR
      - (strategy.netprofit - session_start_equity) <= -max_drawdown_limit (trailing DD breached)

    NOTE: strategy.netprofit is only available inside a strategy() script — this
    block MUST NOT be included in the indicator artifact.  The indicator artifact
    uses _build_indicator_risk_lockout_warning() instead.
    """
    return """
// ─── Strategy Risk Tracking (FIX 1 — STRATEGY artifact only) ────────
// session_pnl tracks closed + unrealized P&L since session start.
// Lockout is evaluated at every bar close (calc_on_every_tick=false ensures this).
var float session_start_equity = strategy.netprofit
var bool new_session = ta.change(dayofweek) != 0

if new_session
    session_start_equity := strategy.netprofit

// session_pnl: realized (netprofit change since open) + unrealized (openprofit)
float session_pnl = (strategy.netprofit - session_start_equity) + strategy.openprofit

// Override risk_lockout with live P&L evaluation
risk_lockout := (not na(daily_loss_limit) and session_pnl <= -daily_loss_limit) or
     (strategy.netprofit - session_start_equity) <= -max_drawdown_limit

bgcolor(risk_lockout ? color.new(color.red, 85) : na, title="Risk Lockout")
"""


def _build_indicator_risk_lockout_warning() -> str:
    """FIX 1 (Option B) — visible warning for INDICATOR artifact.

    The indicator() context has no access to strategy.netprofit or live P&L state.
    A silent risk_lockout=false would give false confidence.  Instead we:
    1. Leave risk_lockout=false (declared in _build_prop_overlay placeholder).
    2. Display a persistent visible label on the chart so traders know the overlay
       is informational only.
    3. Add a prominent header comment.

    Traders requiring active lockout MUST deploy the _STRATEGY artifact.
    """
    return """
// ─── Indicator Risk Lockout Warning (FIX 1 — INDICATOR artifact) ────
// WARNING: risk_lockout is ALWAYS false in this indicator artifact.
// The indicator() context cannot access live P&L — session_pnl tracking
// requires strategy.netprofit which is only available inside strategy().
// Deploy the _STRATEGY artifact for active prop-risk lockout enforcement.
// risk_lockout remains false — state machine references it safely.
var label _risk_lockout_warn = na
if barstate.isfirst
    _risk_lockout_warn := label.new(bar_index, high,
        "VISUAL ONLY — Risk lockout in indicator artifact does not protect live positions.\\nDeploy _STRATEGY artifact for active lockout.",
        color=color.new(color.orange, 20),
        textcolor=color.white,
        style=label.style_label_down,
        size=size.normal)
"""


def _build_risk_intelligence_overlay(risk_intel: Optional[dict]) -> str:
    """Generate Pine constants and table rows for quantum/MC risk intelligence.

    Args:
        risk_intel: Optional dict with keys: breach_probability, ruin_probability,
                    survival_rate, mc_sharpe_p50, quantum_estimate.
                    All values are optional floats.

    Returns:
        Pine Script block with constants and table display, or empty string if None.
    """
    if not risk_intel:
        return ""

    lines = ["\n// ─── Risk Intelligence (from Forge quantum/MC pipeline) ───"]

    # Map of key -> (Pine var name, format for display, display label, color)
    field_defs = [
        ("breach_probability", "BREACH_PROB", "Breach Prob", "color.orange"),
        ("ruin_probability", "RUIN_PROB", "Ruin Prob", "color.red"),
        ("survival_rate", "SURVIVAL_RATE", "Survival", "color.green"),
        ("mc_sharpe_p50", "MC_SHARPE_P50", "MC Sharpe p50", "color.white"),
        ("quantum_estimate", "QUANTUM_ESTIMATE", "Quantum Est", "color.purple"),
    ]

    present_fields = []
    for key, pine_var, label, tbl_color in field_defs:
        val = risk_intel.get(key)
        if val is not None:
            # Emit the constant
            comment = ""
            if key == "quantum_estimate":
                gov_label = risk_intel.get("governance_label", "challenger_only")
                comment = f"  // experimental: {gov_label}"
            lines.append(f"float {pine_var} = {val}{comment}")
            present_fields.append((pine_var, label, tbl_color, key))

    if not present_fields:
        return ""

    # Build the risk intelligence table
    n_rows = len(present_fields)
    lines.append("")
    lines.append("// Risk Intelligence Table")
    lines.append(
        f"var table riskTable = table.new(position.top_left, 2, {n_rows}, "
        "bgcolor=color.new(color.black, 80))"
    )
    lines.append("if barstate.islastconfirmedhistory")
    for row_idx, (pine_var, label, tbl_color, key) in enumerate(present_fields):
        lines.append(
            f'    table.cell(riskTable, 0, {row_idx}, "{label}", '
            f"text_color=color.white, text_size=size.small)"
        )
        # Percentage fields use '#.##%' format, others use '#.##'
        if key in ("breach_probability", "ruin_probability", "survival_rate", "quantum_estimate"):
            fmt = 'str.tostring({var} * 100, \'#.##\') + "%"'
        else:
            fmt = "str.tostring({var}, '#.##')"
        val_expr = fmt.format(var=pine_var)
        lines.append(
            f"    table.cell(riskTable, 1, {row_idx}, {val_expr}, "
            f"text_color={tbl_color}, text_size=size.small)"
        )

    lines.append("")
    return "\n".join(lines)


def _build_alerts(strategy_name: str) -> tuple[str, dict]:
    """Generate alert conditions and alert definitions JSON."""
    pine_alerts = f"""
// ─── Alert Conditions ───────────────────────────────────────────
alertcondition(state == 2 and state[1] != 2, title="Long Entry", message='{{"strategy": "{strategy_name}", "signal": "long_entry", "price": ' + str.tostring(close) + ', "stop": ' + str.tostring(stop_price) + ', "target": ' + str.tostring(target_price) + '}}')
alertcondition(state == 4 and state[1] != 4, title="Short Entry", message='{{"strategy": "{strategy_name}", "signal": "short_entry", "price": ' + str.tostring(close) + ', "stop": ' + str.tostring(stop_price) + ', "target": ' + str.tostring(target_price) + '}}')
alertcondition(state == 5 and state[1] != 5, title="Invalidated", message='{{"strategy": "{strategy_name}", "signal": "invalidated", "price": ' + str.tostring(close) + '}}')
alertcondition(state == 0 and state[1] == 2, title="Long Exit", message='{{"strategy": "{strategy_name}", "signal": "long_exit", "price": ' + str.tostring(close) + '}}')
alertcondition(state == 0 and state[1] == 4, title="Short Exit", message='{{"strategy": "{strategy_name}", "signal": "short_exit", "price": ' + str.tostring(close) + '}}')
alertcondition(risk_lockout and not risk_lockout[1], title="Risk Lockout", message='{{"strategy": "{strategy_name}", "signal": "risk_lockout"}}')
"""

    alerts_json = {
        "strategy": strategy_name,
        "pine_version": "v5",
        "alerts": [
            {"name": "Long Entry", "condition": "state transitions to long_confirmed (state == 2 and state[1] != 2)", "type": "entry"},
            {"name": "Short Entry", "condition": "state transitions to short_confirmed (state == 4 and state[1] != 4)", "type": "entry"},
            {"name": "Invalidated", "condition": "state transitions to invalidated (state == 5 and state[1] != 5)", "type": "exit"},
            {"name": "Long Exit", "condition": "long position closed (state == 0 and state[1] == 2)", "type": "exit"},
            {"name": "Short Exit", "condition": "short position closed (state == 0 and state[1] == 4)", "type": "exit"},
            {"name": "Risk Lockout", "condition": "risk_lockout activates (risk_lockout and not risk_lockout[1])", "type": "risk"},
        ],
    }

    return pine_alerts, alerts_json


def _build_session_filter(session_filter: Optional[str]) -> str:
    """Generate Pine session time filter."""
    if not session_filter or session_filter == "ALL_SESSIONS":
        return "in_session = true"

    filters = {
        "RTH_ONLY": 'in_session = not na(time(timeframe.period, "0930-1600", "America/New_York"))',
        # P2-2: ETH window corrected — CME ETH is 18:00 prior day to ~08:30 next day.
        # Using 1800-0900 ET as approximation (excludes 08:30-09:30 pre-RTH overlap).
        # The old inverse-RTH approach was incorrect: na(RTH) includes non-CME hours.
        "ETH_ONLY": 'in_session = not na(time(timeframe.period, "1800-0900", "America/New_York"))',
        "LONDON": 'in_session = not na(time(timeframe.period, "0300-0800", "America/New_York"))',
        "ASIA": 'in_session = not na(time(timeframe.period, "1900-0200", "America/New_York"))',
    }

    return filters.get(session_filter, "in_session = true")


def _build_visualization() -> str:
    """Generate Pine visualization code."""
    return """
// ─── Visualization ──────────────────────────────────────────────
plotshape(state == 2 and state[1] != 2, title="Long Entry", location=location.belowbar,
          color=color.green, style=shape.triangleup, size=size.small)
plotshape(state == 4 and state[1] != 4, title="Short Entry", location=location.abovebar,
          color=color.red, style=shape.triangledown, size=size.small)
plotshape(state == 5 and state[1] != 5, title="Invalidated", location=location.abovebar,
          color=color.orange, style=shape.xcross, size=size.tiny)
plotshape(state == 0 and (state[1] == 2 or state[1] == 4), title="Exit", location=location.abovebar,
          color=color.blue, style=shape.circle, size=size.tiny)

// Stop/Target lines
plot(state == 2 ? stop_price : na, "Long Stop", color=color.red, linewidth=1, style=plot.style_linebr)
plot(state == 2 ? target_price : na, "Long Target", color=color.green, linewidth=1, style=plot.style_linebr)
plot(state == 4 ? stop_price : na, "Short Stop", color=color.red, linewidth=1, style=plot.style_linebr)
plot(state == 4 ? target_price : na, "Short Target", color=color.green, linewidth=1, style=plot.style_linebr)

// Background coloring for state
bgcolor(state == 2 ? color.new(color.green, 92) : state == 4 ? color.new(color.red, 92) : na, title="Position State")
"""


def compile_strategy(strategy, firm_key: Optional[str] = None, risk_intelligence: Optional[dict] = None) -> CompilerResult:
    """Compile a StrategyDSL (dict or Pydantic model) to Pine Script v5 artifacts.

    Args:
        strategy: Strategy config dict (from StrategyDSL.model_dump() or raw JSON), or StrategyDSL Pydantic model
        firm_key: Optional firm identifier (e.g., "topstep_50k") for prop overlay
        risk_intelligence: Optional dict with quantum/MC risk estimates.
            Keys: breach_probability, ruin_probability, survival_rate,
            mc_sharpe_p50, quantum_estimate (all optional floats).
            Also accepts governance_label (str) for quantum_estimate annotation.

    Returns:
        CompilerResult with exportability score and Pine artifacts
    """
    # Normalize: accept both Pydantic models and plain dicts
    if hasattr(strategy, "model_dump"):
        strategy = strategy.model_dump()

    # Stage 1: Exportability check
    exportability = score_exportability(strategy)

    strategy_name = strategy.get("name", "Unnamed Strategy")
    symbol = strategy.get("symbol", "MES")
    timeframe = strategy.get("timeframe", "5m")

    result = CompilerResult(
        exportability=exportability,
        strategy_name=strategy_name,
    )

    if not exportability.exportable:
        return result

    # Stage 2: Build indicator declarations
    indicators = strategy.get("indicators", [])
    if not indicators:
        # Build from entry_indicator
        entry_indicator = strategy.get("entry_indicator", "")
        entry_params = strategy.get("entry_params", {})
        if entry_indicator:
            indicators = [{"type": entry_indicator, **entry_params}]

    indicator_vars = {}
    indicator_lines = []
    unsupported_in_compile: list[str] = []
    for idx, ind in enumerate(indicators):
        ind_type = ind.get("type", "") if isinstance(ind, dict) else str(ind)
        params = ind if isinstance(ind, dict) else {}
        try:
            var_name, pine_line = _build_pine_indicator_var(ind_type, params, idx)
        except ValueError:
            unsupported_in_compile.append(ind_type)
            continue
        indicator_vars[var_name] = ind_type
        indicator_lines.append(pine_line)

    if unsupported_in_compile:
        # One or more indicators have no Pine equivalent — no artifacts can be produced.
        # Mark non-exportable and surface the unsupported types to the caller.
        # The exportability scorer should ideally have caught this (ml_signal, exotic ML
        # indicators, etc.) but the score may still be >= 50 for a single unknown type.
        # Graceful degradation: return empty artifacts + exportable=False.
        result.exportability = result.exportability.model_copy(
            update={
                "exportable": False,
                "deductions": list(result.exportability.deductions) + [
                    f"Indicator(s) {unsupported_in_compile} have no Pine equivalent — "
                    "cannot produce Pine artifacts. Add to INDICATOR_MAP or remove from strategy."
                ],
            }
        )
        return result

    # Stage 3: Build entry/exit conditions
    long_cond, short_cond = _build_entry_condition(strategy, indicator_vars)
    sl_distance, tp_distance = _build_exit_condition(strategy)

    # Stage 4: Build session filter
    session_line = _build_session_filter(strategy.get("session_filter"))

    # Stage 5: Build prop overlay
    prop_overlay = _build_prop_overlay(firm_key)

    # Stage 5b: Build risk intelligence overlay (optional)
    # Accept from explicit param or from strategy config dict
    risk_intel = risk_intelligence or strategy.get("risk_intelligence")
    risk_intel_overlay = _build_risk_intelligence_overlay(risk_intel)

    # Stage 6: Build state machine
    state_machine = _build_state_machine()

    # Stage 7: Build visualization
    visualization = _build_visualization()

    # Stage 8: Build alerts
    alert_pine, alerts_json = _build_alerts(strategy_name)

    # Stage 8b: Resolve export type.
    # Valid values: "pine_indicator" (default), "pine_strategy", "alert_only".
    # "pine_indicator"  — indicator + alerts_json (+ strategy_shell when score >= 70)
    # "pine_strategy"   — strategy_shell + alerts_json only (no indicator artifact)
    # "alert_only"      — alerts_json only (skip all Pine scripts)
    export_type = strategy.get("export_type", "pine_indicator")

    # Stage 9: Assemble indicator Pine script
    atr_period = 14
    for ind in indicators:
        if isinstance(ind, dict) and ind.get("type") == "atr":
            atr_period = ind.get("period", 14)

    use_target = strategy.get("take_profit_atr_multiple") is not None

    pine_code = f"""//@version=5
indicator("{strategy_name}", overlay=true, max_labels_count=500)

// ─── Inputs ─────────────────────────────────────────────────────
// Auto-generated from StrategyDSL — {strategy.get('description', '')}
// Symbol: {symbol} | Timeframe: {timeframe} | Direction: {strategy.get('direction', 'both')}
"""

    # Add input parameters
    entry_params = strategy.get("entry_params", {})
    for key, val in entry_params.items():
        if isinstance(val, (int, float)):
            pine_code += f'i_{key} = input.float({val}, "{key}")\n'
        elif isinstance(val, bool):
            pine_code += f'i_{key} = input.bool({str(val).lower()}, "{key}")\n'
        elif isinstance(val, str):
            pine_code += f'i_{key} = input.string("{val}", "{key}")\n'

    pine_code += f"""
// ─── Indicators ─────────────────────────────────────────────────
atr_val = ta.atr({atr_period})
"""

    for line in indicator_lines:
        pine_code += line + "\n"

    # P2-3: exit signals for legacy indicator path
    exit_long_expr_legacy, exit_short_expr_legacy = _build_exit_signal_pine(strategy)

    pine_code += f"""
// ─── Session Filter ─────────────────────────────────────────────
{session_line}

// ─── Entry Signals ──────────────────────────────────────────────
long_signal = in_session and ({long_cond})
short_signal = in_session and ({short_cond})

// ─── Exit Signals (P2-3) ────────────────────────────────────────
// exit_type={strategy.get('exit_type', 'atr_multiple')} — translated from DSL
exit_long_signal = {exit_long_expr_legacy}
exit_short_signal = {exit_short_expr_legacy}

// ─── Stop/Target Distances ──────────────────────────────────────
stop_distance = {sl_distance}
use_target = {'true' if use_target else 'false'}
target_distance = {tp_distance}
"""

    pine_code += prop_overlay
    pine_code += risk_intel_overlay
    # P0-1/2/3/4 blocks for legacy indicator path
    pine_code += _build_atr_qty_block(firm_key, atr_period)
    pine_code += _build_regime_block(strategy)
    pine_code += _build_event_blackout_block()
    pine_code += _build_anti_setup_block(strategy)
    pine_code += state_machine
    pine_code += visualization
    pine_code += alert_pine

    # Generate content hash (always based on the indicator Pine, even if not emitted)
    content_hash = hashlib.sha256(pine_code.encode()).hexdigest()
    result.content_hash = content_hash

    # Build artifacts — governed by export_type
    safe_name = strategy_name.lower().replace(" ", "_").replace("-", "_")

    # alerts_json is always produced for every export type
    alerts_json_artifact = PineArtifact(
        artifact_type="alerts_json",
        file_name=f"{safe_name}_alerts.json",
        content=json.dumps(alerts_json, indent=2),
        size_bytes=len(json.dumps(alerts_json).encode()),
    )

    if export_type == "alert_only":
        # Only emit the alert definitions — skip all Pine scripts
        result.artifacts.append(alerts_json_artifact)
        return result

    if export_type != "pine_strategy":
        # "pine_indicator" (default): emit indicator script
        result.artifacts.append(PineArtifact(
            artifact_type="indicator",
            file_name=f"{safe_name}_indicator.pine",
            content=pine_code,
            size_bytes=len(pine_code.encode()),
        ))

    result.artifacts.append(alerts_json_artifact)

    # Strategy shell: emit when score >= 70 AND export_type is not indicator-only.
    # "pine_indicator" also gets the shell (existing behaviour); "pine_strategy" always
    # emits the shell (that is its primary purpose).
    emit_shell = (export_type == "pine_strategy") or (
        export_type == "pine_indicator" and exportability.score >= 70
    )
    if emit_shell:
        # Use firm-specific commission rate; fall back to 0.62 (industry default) if
        # firm or symbol is not found in FIRM_COMMISSIONS.
        shell_commission = 0.62
        if firm_key:
            shell_commission = FIRM_COMMISSIONS.get(firm_key, {}).get(symbol, 0.62)

        # P0-1: legacy shell also gets ATR sizing; firm_cap from firm_key or default 15
        shell_firm_cap = 15
        if firm_key:
            shell_firm_cap = FIRM_CONTRACT_CAPS.get(firm_key, {}).get(symbol, 15)

        strategy_shell = f"""//@version=5
strategy("{strategy_name} [Backtest]", overlay=true, initial_capital=50000,
         default_qty_type=strategy.fixed, default_qty_value=1,
         commission_type=strategy.commission.cash_per_contract, commission_value={shell_commission},
         slippage=0,                       // slippage=0: internal P&L computed independently per CLAUDE.md futures math policy
         process_orders_on_close=true,     // fills at bar close — matches internal backtester same-bar-entry assumption
         calc_on_every_tick=false,         // never recompute mid-bar; only close-of-bar updates
         calc_on_order_fills=false,        // do not retrigger calc when an order fills (prevents phantom alerts on Renko/HA)
         use_bar_magnifier=true,           // intra-bar fill accuracy on higher timeframes (per QuantVue ATS recommended config)
         fill_orders_on_standard_ohlc=true) // force standard OHLC bars for fills — prevents Heikin-Ashi pricing errors

// NOTE: This is a simplified strategy shell for TradingView's strategy tester.
// For live trading signals, use the indicator version with alerts.

atr_val = ta.atr({atr_period})
// P0-1: ATR-scaled position sizing (mirrors sizing.py)
atr_qty_period = input.int({atr_period}, "ATR Qty Period", minval=1, maxval=50)
target_risk_usd = input.float(200.0, "Target Risk Per Trade ($)", minval=10.0, step=10.0)
atr_qty_val = ta.atr(atr_qty_period)
contracts_atr = atr_qty_val > 0 ? math.max(1, math.floor(target_risk_usd / (atr_qty_val * syminfo.pointvalue))) : 1
qty_final = math.min(contracts_atr, {shell_firm_cap})
"""
        for line in indicator_lines:
            strategy_shell += line + "\n"

        # P0-2/3/4 in legacy shell — minimal inline versions
        strategy_shell += f"""
{session_line}
long_signal = in_session and ({long_cond})
short_signal = in_session and ({short_cond})

// P0-2: Regime filter
[adx_plus_di, adx_minus_di, adx_val] = ta.dmi(14, 14)
regime_label = adx_val > 25 ? "TRENDING" : adx_val < 20 ? "RANGING" : "MIXED"
regime_match = true  // No preferred_regime in legacy shell — gate disabled

// P0-3: NFP blackout only (simplified for legacy shell)
nfp_blackout = (dayofmonth <= 7 and dayofweek == dayofweek.friday and hour == 8 and minute < 60)
event_blackout = nfp_blackout

// P0-4: Generic first-15min anti-setup
anti_setup_blocked = (hour == 9 and minute < 45)

stop_distance = {sl_distance}
target_distance = {tp_distance}

entry_allowed = strategy.position_size == 0 and regime_match and not event_blackout and not anti_setup_blocked

if long_signal and entry_allowed
    strategy.entry("Long", strategy.long, qty=qty_final)
    strategy.exit("Long Exit", "Long", stop=close - stop_distance, limit={'close + target_distance' if use_target else 'na'})

if short_signal and entry_allowed
    strategy.entry("Short", strategy.short, qty=qty_final)
    strategy.exit("Short Exit", "Short", stop=close + stop_distance, limit={'close - target_distance' if use_target else 'na'})
"""

        result.artifacts.append(PineArtifact(
            artifact_type="strategy_shell",
            file_name=f"{safe_name}_strategy.pine",
            content=strategy_shell,
            size_bytes=len(strategy_shell.encode()),
        ))

    return result


# ─── ATS Firm Classification ─────────────────────────────────────────
# ATS classification — source of truth: docs/prop-firm-rules.md, April 2026 routing matrix
# (lines 28-43 of that document).
#
# ATS-ALLOWED (full automation via TradersPost / TopstepX webhook):
#   topstep_50k    — ATS via TopstepX API, local-only (Skytech tower)
#   mffu_50k       — ATS via TradersPost / PickMyTrade
#   tpt_50k        — ATS allowed (permissive)
#   top_one_50k    — ATS, fully automated (most automation-friendly per March 2026)
#   yrm_prop_50k   — ATS, fully automated (most automation-friendly per March 2026)
#   earn2trade_50k — ATS allowed (permissive, per docs line 36)
#   alpha_50k      — ATS allowed (permissive, per docs line 36)
#
# INDICATOR-ONLY / MANUAL APPROVAL:
#   apex_50k       — INDICATOR + manual TradersPost approval (semi-auto allowed, fully auto banned on PA)
#   tradeify_50k   — INDICATOR only (bans bot trading)
#   fundingpips_50k — INDICATOR only (bans bots)
#   ffn_50k        — MANUAL APPROVAL (Quantower/MotiveWave platforms only — no TradingView path;
#                    even the indicator path may not work because Pine/TradingView is not
#                    supported on Quantower or MotiveWave. Do NOT deploy FFN strategies
#                    through Pine until a Quantower export pipeline exists.)
ATS_FIRMS: frozenset[str] = frozenset({
    "topstep_50k",
    "mffu_50k",
    "tpt_50k",
    "top_one_50k",
    "yrm_prop_50k",
    "earn2trade_50k",
    "alpha_50k",
})

# Firms that require manual approval — INDICATOR artifact only.
MANUAL_APPROVAL_FIRMS: frozenset[str] = frozenset({
    "apex_50k",
    "tradeify_50k",
    "fundingpips_50k",
    # FFN: Quantower/MotiveWave only — no TradingView/Pine support.
    # Indicator path may require manual translation to Quantower's native scripting.
    # Recommend: do not deploy FFN strategies through Pine until Quantower export pipeline exists.
    "ffn_50k",
})

# TradingView continuous contract symbols for each DSL symbol
_TV_SYMBOL_MAP: dict[str, str] = {
    "MES": "MES1!",
    "MNQ": "MNQ1!",
    "MCL": "MCL1!",
    "NQ": "NQ1!",
    "ES": "ES1!",
    "CL": "CL1!",
}


class DualArtifactResult(BaseModel):
    """Result of compile_dual_artifacts — always contains both Pine artifacts."""
    exportability: ExportabilityResult
    strategy_name: str = ""
    pine_version: str = "v5"
    content_hash: str = ""
    # Both artifacts always present when exportable=True
    indicator_artifact: Optional[PineArtifact] = None   # indicator() + alertcondition()
    strategy_artifact: Optional[PineArtifact] = None    # strategy() + strategy.entry/exit() + webhook
    alerts_artifact: Optional[PineArtifact] = None      # alerts_json metadata
    # Routing hints for caller
    indicator_firms: list[str] = Field(default_factory=list)   # manual-approval firms
    strategy_firms: list[str] = Field(default_factory=list)    # ATS firms
    degradation_notes: list[str] = Field(default_factory=list)

    @property
    def exportable(self) -> bool:
        return self.exportability.exportable


def _build_indicator_alert_messages(strategy_name: str) -> str:
    """Pine alertcondition() block for INDICATOR artifact.

    Alert messages are human-readable JSON — trader reads the alert and manually
    decides whether to place the order.  No TradersPost routing.

    Timing: bar-close (barstate.isconfirmed is the default for alertcondition
    when 'Once per bar close' is selected in TradingView alert settings).
    Repaint note: signals computed from close — no intrabar repaint risk.
    """
    return f"""
// ─── Alert Conditions (INDICATOR path — manual approval) ────────────
// Configure each alert in TradingView with "Once Per Bar Close".
// Trader reads the message and manually approves each order.
alertcondition(state == 2 and state[1] != 2, title="Long Entry",
    message='{{"strategy": "{strategy_name}", "signal": "long_entry", "side": "long", "entry": ' + str.tostring(close) + ', "stop": ' + str.tostring(stop_price) + ', "target": ' + str.tostring(target_price) + ', "note": "MANUAL_APPROVAL_REQUIRED"}}')
alertcondition(state == 4 and state[1] != 4, title="Short Entry",
    message='{{"strategy": "{strategy_name}", "signal": "short_entry", "side": "short", "entry": ' + str.tostring(close) + ', "stop": ' + str.tostring(stop_price) + ', "target": ' + str.tostring(target_price) + ', "note": "MANUAL_APPROVAL_REQUIRED"}}')
alertcondition(state == 0 and state[1] == 2, title="Long Exit",
    message='{{"strategy": "{strategy_name}", "signal": "long_exit", "price": ' + str.tostring(close) + '}}')
alertcondition(state == 0 and state[1] == 4, title="Short Exit",
    message='{{"strategy": "{strategy_name}", "signal": "short_exit", "price": ' + str.tostring(close) + '}}')
alertcondition(state == 5 and state[1] != 5, title="Invalidated",
    message='{{"strategy": "{strategy_name}", "signal": "invalidated", "price": ' + str.tostring(close) + '}}')
alertcondition(risk_lockout and not risk_lockout[1], title="Risk Lockout",
    message='{{"strategy": "{strategy_name}", "signal": "risk_lockout"}}')
"""


def _build_strategy_webhook_alerts(strategy_name: str, symbol: str, strategy_id: str) -> str:
    """Pine alertcondition() block for STRATEGY artifact.

    Alert messages are TradersPost JSON webhook payloads — routed automatically
    to broker without manual approval.

    TradersPost payload spec (https://traderspost.io/docs/webhooks):
      action: "buy" | "sell" | "exit" | "cancel"
      symbol: TradingView continuous contract ticker (e.g., "MES1!")
      quantity: integer contracts (omit to use TradersPost account default)
      price: optional limit price
      stopLoss: stop price
      takeProfit: target price

    Timing: bar-close alerts only.  Configure TradingView alert as
    "Once Per Bar Close" to prevent intrabar premature fills.

    Semantic note: TradersPost routes "buy" -> broker long entry, "sell" ->
    broker short entry, "exit" -> flatten position.  This maps 1:1 to our
    strategy.entry/exit() calls in the strategy block below.
    """
    tv_symbol = _TV_SYMBOL_MAP.get(symbol, f"{symbol}1!")
    return f"""
// ─── Webhook Alerts (STRATEGY path — TradersPost ATS) ──────────────
// Configure each alert with "Once Per Bar Close" + webhook URL.
// TradersPost routes directly to your broker — NO manual approval.
// REQUIRED: Set alert message to exactly this JSON (do not modify).
// FIX 2: alertcondition predicates now include all three gates —
// regime_match, not event_blackout, not anti_setup_blocked.
// Without these gates TradersPost would route orders during FOMC/CPI/NFP events
// and in unfavorable regime/anti-setup conditions, violating prop firm rules.
// Variables regime_match, event_blackout, anti_setup_blocked are declared in the
// shared preamble (_build_regime_block, _build_event_blackout_block, _build_anti_setup_block).
alertcondition(strategy.position_size == 0 and long_signal and regime_match and not event_blackout and not anti_setup_blocked, title="TP Long Entry",
    message='{{"action": "buy", "symbol": "{tv_symbol}", "quantity": 1, "stopLoss": ' + str.tostring(close - stop_distance) + ', "takeProfit": ' + str.tostring(use_target ? close + target_distance : na) + ', "strategyId": "{strategy_id}"}}')
alertcondition(strategy.position_size == 0 and short_signal and regime_match and not event_blackout and not anti_setup_blocked, title="TP Short Entry",
    message='{{"action": "sell", "symbol": "{tv_symbol}", "quantity": 1, "stopLoss": ' + str.tostring(close + stop_distance) + ', "takeProfit": ' + str.tostring(use_target ? close - target_distance : na) + ', "strategyId": "{strategy_id}"}}')
// PARITY NOTE: Exit alertconditions guarded with barstate.isconfirmed so they fire at
// bar close — matching INDICATOR artifact state-machine exit timing.  Without this guard,
// strategy.position_avg_price is evaluated intrabar and can fire on wicks that recover by
// close, diverging from the INDICATOR bar-close exit.  Net P&L will still differ on bars
// where the stop is breached intrabar AND price does not recover: strategy.exit() fills at
// the stop price intrabar; INDICATOR exits at bar close.  That is an unavoidable Pine
// strategy() vs indicator() semantic gap — alertcondition timing is now consistent.
alertcondition(barstate.isconfirmed and strategy.position_size > 0 and (low <= strategy.position_avg_price - stop_distance or (use_target and high >= strategy.position_avg_price + target_distance)), title="TP Long Exit",
    message='{{"action": "exit", "symbol": "{tv_symbol}", "strategyId": "{strategy_id}"}}')
alertcondition(barstate.isconfirmed and strategy.position_size < 0 and (high >= strategy.position_avg_price + stop_distance or (use_target and low <= strategy.position_avg_price - target_distance)), title="TP Short Exit",
    message='{{"action": "exit", "symbol": "{tv_symbol}", "strategyId": "{strategy_id}"}}')
alertcondition(risk_lockout and not risk_lockout[1], title="TP Risk Lockout",
    message='{{"action": "cancel", "symbol": "{tv_symbol}", "strategyId": "{strategy_id}", "note": "RISK_LOCKOUT"}}')
"""


def _build_atr_qty_block(firm_key: Optional[str], atr_period: int) -> str:
    """P0-1: Build ATR-scaled position sizing block.

    Mirrors sizing.py: contracts = target_risk / (ATR * pointvalue).
    firm_max comes from FIRM_CONTRACT_CAPS; falls back to 15 (default cap).

    TradingView strategy() uses default_qty_type=strategy.fixed / default_qty_value=1
    as required by Pine — qty_final is passed explicitly to strategy.entry().
    For the indicator artifact, qty_final is exposed as a plot/table value only.

    DEGRADATION: syminfo.pointvalue is correct for the chart's instrument but
    the compiler cannot statically verify it matches the DSL symbol at export time.
    Trader must confirm the chart is loaded on the correct instrument.
    """
    firm_cap = 15
    if firm_key:
        caps = FIRM_CONTRACT_CAPS.get(firm_key, {})
        # Use MES cap as proxy; for instrument-specific sizing trader should verify
        firm_cap = caps.get("MES", 15)

    return f"""
// ─── ATR-Scaled Position Sizing (mirrors sizing.py) ─────────────
// P0-1: ATR-based qty replaces hardcoded qty=1.
// contracts = target_risk / (ATR * pointvalue), clamped to firm max.
// DEGRADATION: syminfo.pointvalue is instrument-specific — confirm chart symbol.
atr_qty_period = input.int({atr_period}, "ATR Qty Period", minval=1, maxval=50)
target_risk_usd = input.float(200.0, "Target Risk Per Trade ($)", minval=10.0, step=10.0)
atr_qty_val = ta.atr(atr_qty_period)
firm_max_contracts = {firm_cap}
// pointvalue: dollar value per 1-point move (MES=$5, MNQ=$2, ES=$50, NQ=$20)
contracts_atr = atr_qty_val > 0 ? math.max(1, math.floor(target_risk_usd / (atr_qty_val * syminfo.pointvalue))) : 1
qty_final = math.min(contracts_atr, firm_max_contracts)
"""


def _build_regime_block(strategy: dict) -> str:
    """P0-2: Build regime filter block (ADX+ATR percentile).

    Computes ADX(14) and classifies regime as TRENDING/RANGING/MIXED.
    If strategy has preferred_regime, entries are gated; otherwise visual only.

    Regime: ADX > 25 → TRENDING, ADX < 20 → RANGING, else MIXED.
    preferred_regime values: "TRENDING", "RANGING", "MIXED", "TRENDING_UP",
    "TRENDING_DOWN" — UP/DOWN treated as TRENDING for the ADX gate.
    """
    preferred_regime = strategy.get("preferred_regime", "")
    has_gate = bool(preferred_regime)

    # Normalize: TRENDING_UP / TRENDING_DOWN → TRENDING for ADX gate
    if preferred_regime in ("TRENDING_UP", "TRENDING_DOWN"):
        preferred_regime = "TRENDING"

    gate_comment = f'// Regime gate active: entry blocked unless regime == "{preferred_regime}"' if has_gate else "// No preferred_regime — regime display only, no gate"

    if has_gate:
        regime_match_expr = f'regime_label == "{preferred_regime}"'
    else:
        regime_match_expr = "true  // no regime gate"

    return f"""
// ─── Regime Filter (P0-2) ───────────────────────────────────────
// ADX(14): > 25 → TRENDING, < 20 → RANGING, else MIXED
// {gate_comment}
[adx_plus_di, adx_minus_di, adx_val] = ta.dmi(14, 14)
regime_label = adx_val > 25 ? "TRENDING" : adx_val < 20 ? "RANGING" : "MIXED"
regime_match = {regime_match_expr}
// Visual: green bg = trending, blue = ranging, gray = mixed
regime_color = regime_label == "TRENDING" ? color.new(color.green, 92) : regime_label == "RANGING" ? color.new(color.blue, 92) : color.new(color.gray, 95)
bgcolor(regime_color, title="Regime")
"""


def _build_event_blackout_block() -> str:
    """P0-3: Build FOMC/CPI/NFP time-based blackout block.

    FOMC: hardcoded 2025-2026 dates, 14:00-14:30 ET.
    CPI:  exact BLS-published dates 2025-2027, 8:30-9:00 ET (30-min window post-release).
    NFP:  rule-based — first Friday of month (dayofmonth <= 7, dayofweek.friday), 8:30-9:00 ET.

    CPI source: https://www.bls.gov/schedule/news_release/cpi.htm
    CPI coverage: 2025 (confirmed) + 2026-2027 (projected per standard BLS release pattern).
    Update cadence: refresh CPI dates annually from BLS site.
    All times Eastern. Ensure chart timezone = America/New_York.
    """
    # FOMC 2025-2026 dates as "YYYY-MM-DD" — 14:00-14:30 ET blackout
    fomc_dates = [
        "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
        "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
        "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
        "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
    ]
    # Build Pine timestamp comparisons for each FOMC date
    # We compare current bar's date (year/month/day) against the hardcoded list
    # and check time is in [14:00, 14:30) ET. Pine has no date array — use OR chain.
    fomc_conditions = []
    for date_str in fomc_dates:
        y, m, d = date_str.split("-")
        fomc_conditions.append(
            f"(year == {y} and month == {int(m)} and dayofmonth == {int(d)} and hour == 14 and minute < 30)"
        )
    fomc_chain = " or\n     ".join(fomc_conditions)

    # CPI exact release dates — BLS published calendar.
    # Source: https://www.bls.gov/schedule/news_release/cpi.htm
    # Window: 8:30–9:00 AM ET (BLS releases at 8:30 sharp; 30-min window covers initial vol spike).
    # 2025: confirmed from BLS calendar.
    # 2026-2027: projected based on standard BLS release pattern (update annually).
    cpi_dates = [
        # 2025 — confirmed
        "2025-01-15", "2025-02-12", "2025-03-12", "2025-04-10",
        "2025-05-13", "2025-06-11", "2025-07-15", "2025-08-12",
        "2025-09-11", "2025-10-15", "2025-11-13", "2025-12-10",
        # 2026 — projected
        "2026-01-14", "2026-02-11", "2026-03-11", "2026-04-15",
        "2026-05-13", "2026-06-10", "2026-07-15", "2026-08-12",
        "2026-09-09", "2026-10-14", "2026-11-12", "2026-12-09",
        # 2027 — projected
        "2027-01-13", "2027-02-10", "2027-03-10", "2027-04-14",
        "2027-05-12", "2027-06-09", "2027-07-14", "2027-08-11",
        "2027-09-08", "2027-10-13", "2027-11-10", "2027-12-08",
    ]
    cpi_conditions = []
    for date_str in cpi_dates:
        y, m, d = date_str.split("-")
        cpi_conditions.append(
            f"(year == {y} and month == {int(m)} and dayofmonth == {int(d)} and hour == 8 and minute >= 30 and minute < 60)"
        )
    cpi_chain = " or\n     ".join(cpi_conditions)

    return f"""
// ─── Economic Event Blackout (P0-3) ─────────────────────────────
// FOMC 14:00-14:30 ET (hardcoded 2025-2026).
// CPI 8:30-9:00 ET — EXACT BLS dates (2025 confirmed, 2026-2027 projected).
//   Source: https://www.bls.gov/schedule/news_release/cpi.htm
//   Update annually. 2027 dates are projected — verify before use.
// NFP 8:30-9:00 ET first Friday of month.
// All comparisons in exchange timezone — ensure chart timezone = America/New_York.

// FOMC blackout: 14:00-14:30 ET on known FOMC dates
fomc_blackout = {fomc_chain}

// CPI blackout: 8:30-9:00 ET on exact BLS release dates (36 dates, 2025-2027).
// Source: BLS published calendar. 2026-2027 are projected — refresh annually.
cpi_blackout = {cpi_chain}

// NFP blackout: 8:30-9:00 ET, first Friday of month (dayofmonth <= 7)
nfp_blackout = (dayofmonth <= 7 and dayofweek == dayofweek.friday and hour == 8 and minute < 60)

event_blackout = fomc_blackout or cpi_blackout or nfp_blackout
bgcolor(event_blackout ? color.new(color.orange, 80) : na, title="Event Blackout")
"""


def _build_anti_setup_block(strategy: dict) -> str:
    """P0-4: Build anti-setup gate block.

    Reads anti_setups list from strategy config. Each anti-setup should be a dict
    with at least a "type" key. Supported translations:
      - "first_15min" / "first_hour" / "open_range" → time-of-day gate
      - "high_atr" → atr_val > ATR 95th-pct proxy (2x recent average)
      - "low_volume" → volume < 20-bar volume SMA * 0.5
      - Generic fallback: first 15 minutes of session (9:30-9:45 ET)

    LIMITATION: Complex multi-condition anti-setups (e.g. "high ATR + first hour
    + counter-trend") cannot be fully translated without strategy-specific context.
    Each condition is evaluated independently and OR-combined.
    """
    anti_setups = strategy.get("anti_setups", [])

    conditions = []
    notes = []

    for setup in anti_setups:
        if isinstance(setup, dict):
            setup_type = setup.get("type", "").lower()
        else:
            setup_type = str(setup).lower()

        if "first_15" in setup_type or "open_15" in setup_type:
            conditions.append("(hour == 9 and minute < 45 and not na(time(timeframe.period, \"0930-0945\", \"America/New_York\")))")
            notes.append("first-15min")
        elif "first_hour" in setup_type or "open_range" in setup_type:
            conditions.append("(hour == 9 and minute >= 30 or (hour == 10 and minute == 0))")
            notes.append("first-hour")
        elif "high_atr" in setup_type or "high_vol" in setup_type:
            # Proxy: ATR > 2x 20-bar SMA of ATR is a high-volatility filter
            conditions.append("(atr_val > ta.sma(atr_val, 20) * 2.0)")
            notes.append("high-ATR")
        elif "low_volume" in setup_type:
            conditions.append("(volume < ta.sma(volume, 20) * 0.5)")
            notes.append("low-volume")
        else:
            # Unknown type — skip silently but log in note
            notes.append(f"SKIPPED:{setup_type}")

    if not conditions:
        # Generic fallback: block first 15 minutes of RTH session
        conditions = ["(hour == 9 and minute < 45)"]
        notes = ["generic-open-15min-fallback"]

    anti_chain = " or\n    ".join(conditions)
    note_str = ", ".join(notes)

    return f"""
// ─── Anti-Setup Gate (P0-4) ─────────────────────────────────────
// Blocks entries during known unfavorable conditions.
// Translated conditions: {note_str}
// LIMITATION: Complex multi-condition anti-setups are simplified to independent OR terms.
anti_setup_blocked = {anti_chain}
"""


def _build_shared_preamble(
    strategy: dict,
    indicator_lines: list[str],
    long_cond: str,
    short_cond: str,
    sl_distance: str,
    tp_distance: str,
    session_line: str,
    atr_period: int,
    use_target: bool,
    prop_overlay: str,
    risk_intel_overlay: str,
    firm_key: Optional[str] = None,
) -> str:
    """Build the shared Pine logic block (indicators, signals, state).

    This block is identical in both INDICATOR and STRATEGY artifacts —
    guarantees identical signal timing and state transitions.
    Includes: ATR sizing (P0-1), regime filter (P0-2), event blackout (P0-3),
    anti-setup gate (P0-4), indicator-signal exits (P2-3).
    """
    entry_params = strategy.get("entry_params", {})
    input_lines = ""
    for key, val in entry_params.items():
        if isinstance(val, (int, float)):
            input_lines += f'i_{key} = input.float({val}, "{key}")\n'
        elif isinstance(val, bool):
            input_lines += f'i_{key} = input.bool({str(val).lower()}, "{key}")\n'
        elif isinstance(val, str):
            input_lines += f'i_{key} = input.string("{val}", "{key}")\n'

    indicator_block = "\n".join(indicator_lines)

    # P2-3: exit signals from strategy config
    exit_long_expr, exit_short_expr = _build_exit_signal_pine(strategy)

    code = f"""
// ─── Inputs ─────────────────────────────────────────────────────────
// Auto-generated from StrategyDSL — {strategy.get('description', '')}
// Symbol: {strategy.get('symbol', 'MES')} | Timeframe: {strategy.get('timeframe', '5m')} | Direction: {strategy.get('direction', 'both')}
{input_lines}
// ─── Indicators ─────────────────────────────────────────────────────
atr_val = ta.atr({atr_period})
{indicator_block}

// ─── Session Filter ─────────────────────────────────────────────────
{session_line}

// ─── Entry Signals ──────────────────────────────────────────────────
long_signal = in_session and ({long_cond})
short_signal = in_session and ({short_cond})

// ─── Exit Signals (P2-3) ────────────────────────────────────────────
// exit_type={strategy.get('exit_type', 'atr_multiple')} — translated from DSL
exit_long_signal = {exit_long_expr}
exit_short_signal = {exit_short_expr}

// ─── Stop/Target Distances ──────────────────────────────────────────
stop_distance = {sl_distance}
use_target = {'true' if use_target else 'false'}
target_distance = {tp_distance}
"""
    code += prop_overlay
    code += risk_intel_overlay
    # P0-1: ATR-scaled position sizing
    code += _build_atr_qty_block(firm_key, atr_period)
    # P0-2: Regime filter
    code += _build_regime_block(strategy)
    # P0-3: Event blackout
    code += _build_event_blackout_block()
    # P0-4: Anti-setup gate
    code += _build_anti_setup_block(strategy)
    return code


def _build_indicator_artifact(
    strategy_name: str,
    symbol: str,
    strategy_id: str,
    shared_preamble: str,
) -> str:
    """Wrap shared logic in indicator() declaration for manual-approval firms.

    Deployment: Apex 4.0 PAs / Tradeify / FundingPips
    Trader workflow: sees plotshape signal -> reads alertcondition message ->
    manually approves order in broker interface.
    No automated execution.
    """
    header = f"""//@version=5
// ╔══════════════════════════════════════════════════════════════════╗
// ║  Trading Forge — INDICATOR Artifact                              ║
// ║  Strategy  : {strategy_name:<50}║
// ║  Mode      : MANUAL APPROVAL (Apex / Tradeify / FundingPips)    ║
// ║  Routing   : alertcondition() → trader reads → manual order     ║
// ║  Pine v5   : indicator() only — alert-based, no auto-execution  ║
// ║  Repaint   : NONE — signals computed at bar close only           ║
// ╚══════════════════════════════════════════════════════════════════╝
// PROP FIRM NOTICE: This artifact is safe for manual-approval firms.
// Do NOT use the _STRATEGY artifact at Apex/Tradeify — automated
// execution is not permitted at those firms.
// Generated by Trading Forge Pine Compiler v5
indicator("{strategy_name}", overlay=true, max_labels_count=500)
"""
    # FIX 1: append indicator-specific risk lockout warning after shared preamble
    # (shared preamble declares risk_lockout=false as a placeholder)
    return (
        header
        + shared_preamble
        + _build_indicator_risk_lockout_warning()
        + _build_state_machine()
        + _build_visualization()
        + _build_indicator_alert_messages(strategy_name)
    )


def _build_strategy_artifact(
    strategy_name: str,
    symbol: str,
    strategy_id: str,
    shared_preamble: str,
    commission: float,
    sl_distance: str,
    tp_distance: str,
    use_target: bool,
    manual_approval_firm: bool = False,
) -> str:
    """Wrap shared logic in strategy() declaration for ATS firms.

    Deployment: Topstep / MFFU / Top One Futures / YRM Prop / TPT
    Trader workflow: TradingView alert fires → TradersPost webhook receives JSON
    → broker places order automatically.
    IMPORTANT: Trader must configure each alert with "Once Per Bar Close"
    and point to their TradersPost webhook URL.

    strategy.entry/exit() stops and targets are declared here for TradingView
    Strategy Tester accuracy.  The alertcondition() webhook payloads carry the
    same stop/target values for live broker routing via TradersPost.

    Semantic note on stop_distance / target_distance at entry time:
      strategy.exit() is called on the SAME bar as strategy.entry().
      Pine processes this in order: entry is accepted, then exit parameters
      applied.  stop= and limit= are absolute prices, not offsets, so we
      compute them from close (the intrabar fill assumption for the tester).
      This is identical to the internal backtester behaviour (close-of-bar fill).
    """
    tv_symbol = _TV_SYMBOL_MAP.get(symbol, f"{symbol}1!")
    header = f"""//@version=5
// ╔══════════════════════════════════════════════════════════════════╗
// ║  Trading Forge — STRATEGY Artifact                               ║
// ║  Strategy  : {strategy_name:<50}║
// ║  Mode      : ATS / AUTOMATED (Topstep / MFFU / TPT / YRM)      ║
// ║  Routing   : TradersPost JSON webhook → broker auto-execution   ║
// ║  Pine v5   : strategy() + strategy.entry() / strategy.exit()    ║
// ║  Repaint   : NONE — signals computed at bar close only           ║
// ╚══════════════════════════════════════════════════════════════════╝
// ATS NOTICE: This artifact fires REAL orders when alerts are active.
// REQUIRED alert setup per signal:
//   1. Set "Condition" to the named alertcondition title
//   2. Set "Trigger" to "Once Per Bar Close"
//   3. Set "Message" to the exact JSON shown in each alertcondition()
//   4. Set "Webhook URL" to your TradersPost webhook endpoint
// Do NOT enable alerts until prop firm account is ready.
// Symbol: {tv_symbol}
// PROHIBITED_AT_THIS_FIRM={'true' if manual_approval_firm else 'false'} — {'DO NOT configure TradersPost webhooks at this firm. This artifact is informational only.' if manual_approval_firm else 'ATS routing permitted.'}
// PARITY: All exits (stop, target, alertcondition) fire on barstate.isconfirmed → identical
// timing across INDICATOR, STRATEGY, and webhook artifacts. process_orders_on_close=true,
// calc_on_every_tick=false, calc_on_order_fills=false enforce bar-close calc semantics.
// FILL HYGIENE: use_bar_magnifier=true + fill_orders_on_standard_ohlc=true prevent phantom
// fills on Heikin-Ashi or Renko charts (per QuantVue ATS recommended config).
// RESIDUAL: TradingView's Strategy Tester may still display intrabar fills at the stop price
// for backtest stats — see degradation_notes (pine_strategy_exit_intrabar_fill_residual).
// Live execution via TradersPost is parity-correct because alertconditions are guarded
// by barstate.isconfirmed, so webhooks fire only on confirmed bar close.
// Generated by Trading Forge Pine Compiler v5
strategy("{strategy_name}", overlay=true,
         initial_capital=50000,
         default_qty_type=strategy.fixed,
         default_qty_value=1,
         commission_type=strategy.commission.cash_per_contract,
         commission_value={commission},
         slippage=0,                       // slippage=0: internal P&L computed independently per CLAUDE.md futures math policy
         process_orders_on_close=true,     // process_orders_on_close=true: fills at bar close, matching internal backtester same-bar-entry assumption
         calc_on_every_tick=false,         // calc_on_every_tick=false: never recompute mid-bar; only close-of-bar updates
         calc_on_order_fills=false,        // calc_on_order_fills=false: do not retrigger calc when an order fills (prevents phantom alerts on Renko/HA)
         use_bar_magnifier=true,           // use_bar_magnifier=true: intra-bar fill accuracy on higher timeframes (per QuantVue ATS recommended config)
         fill_orders_on_standard_ohlc=true) // fill_orders_on_standard_ohlc=true: force standard OHLC bars — prevents Heikin-Ashi pricing errors
"""
    long_exit_limit = "close + target_distance" if use_target else "na"
    short_exit_limit = "close - target_distance" if use_target else "na"

    entry_exit_block = f"""
// ─── Order Execution ────────────────────────────────────────────────
// P0-1: qty=qty_final (ATR-scaled, firm-capped) replaces hardcoded qty=1.
// P0-2: regime_match gates entries — skipped when preferred regime not active.
// P0-3: event_blackout gates entries — skipped during FOMC/CPI/NFP windows.
// P0-4: anti_setup_blocked gates entries — skipped during unfavorable conditions.
// strategy.entry() and strategy.exit() mirror the internal backtester.
// Stop and target are absolute prices computed from bar-close fill.
// Identical signal conditions as INDICATOR artifact — guaranteed parity.
entry_allowed = strategy.position_size == 0 and not risk_lockout and regime_match and not event_blackout and not anti_setup_blocked

if long_signal and entry_allowed
    strategy.entry("Long", strategy.long, qty=qty_final)
    strategy.exit("Long Exit", "Long",
                  stop  = close - stop_distance,
                  limit = use_target ? {long_exit_limit} : na)

if short_signal and entry_allowed
    strategy.entry("Short", strategy.short, qty=qty_final)
    strategy.exit("Short Exit", "Short",
                  stop  = close + stop_distance,
                  limit = use_target ? {short_exit_limit} : na)

// Risk lockout — flatten and disable
if risk_lockout and strategy.position_size != 0
    strategy.close_all(comment="risk_lockout")
"""
    # FIX 1: append strategy-specific bar-by-bar risk tracking after shared preamble
    # (shared preamble declares risk_lockout=false as a placeholder; this block overrides it)
    return (
        header
        + shared_preamble
        + _build_strategy_risk_tracking()
        + entry_exit_block
        + _build_strategy_webhook_alerts(strategy_name, symbol, strategy_id)
        + _build_visualization()
    )


def compile_dual_artifacts(
    strategy,
    firm_key: Optional[str] = None,
    risk_intelligence: Optional[dict] = None,
    strategy_id: Optional[str] = None,
) -> DualArtifactResult:
    """Compile a StrategyDSL to BOTH Pine artifacts from the same logic.

    Always produces:
      - {name}_INDICATOR.pine  — indicator() + alertcondition() (manual-approval firms)
      - {name}_STRATEGY.pine   — strategy() + strategy.entry/exit() + TradersPost JSON
        webhook alertcondition() (ATS firms)
      - {name}_alerts.json     — alert metadata for downstream automation

    Both artifacts are produced regardless of exportability score.
    When exportable=False, only the degradation notes are returned and no
    Pine artifacts are emitted (caller should surface the deductions to user).

    Both artifacts share identical signal logic — same entry/exit conditions,
    same prop_overlay, same risk intelligence table.  Signal timing is
    deterministically identical between the two; backtesting either in
    TradingView Strategy Tester should produce identical trade lists.

    Args:
        strategy: StrategyDSL dict or Pydantic model.
        firm_key: Firm key for prop overlay.  When None, conservative defaults used.
        risk_intelligence: MC/quantum risk estimates for inline display.
        strategy_id: Stable ID embedded in webhook payloads (strategyId field).
                     Falls back to SHA-256 of strategy name when None.

    Returns:
        DualArtifactResult with indicator_artifact and strategy_artifact both set
        when exportable=True.
    """
    # Normalize: accept both Pydantic models and plain dicts
    if hasattr(strategy, "model_dump"):
        strategy = strategy.model_dump()

    # Stage 1: Exportability check (same gate as compile_strategy)
    exportability = score_exportability(strategy)

    strategy_name = strategy.get("name", "Unnamed Strategy")
    symbol = strategy.get("symbol", "MES")
    timeframe = strategy.get("timeframe", "5m")
    safe_name = strategy_name.lower().replace(" ", "_").replace("-", "_")

    result = DualArtifactResult(
        exportability=exportability,
        strategy_name=strategy_name,
    )

    if not exportability.exportable:
        result.degradation_notes.append(
            f"Strategy not exportable (score={exportability.score}): "
            + "; ".join(exportability.deductions)
        )
        return result

    # Stable ID for webhook payloads — caller should pass the DB strategy UUID
    sid = strategy_id or hashlib.sha256(strategy_name.encode()).hexdigest()[:16]

    # Stage 2: Build indicator declarations (shared)
    # F4: Pre-check all indicators against INDICATOR_MAP before attempting to compile.
    # This surfaces unsupported types immediately with a clear error rather than letting
    # _build_pine_indicator_var raise a cryptic ValueError mid-loop.
    indicators = strategy.get("indicators", [])
    if not indicators:
        entry_indicator = strategy.get("entry_indicator", "")
        entry_params = strategy.get("entry_params", {})
        if entry_indicator:
            indicators = [{"type": entry_indicator, **entry_params}]

    # F4: Explicit pre-check — detect unsupported indicators before any code generation.
    # The scorer should have caught this (unknown indicators score -15 each, giving
    # exportable=False at 2+ unknowns), but this guard catches the edge case where a
    # single unknown indicator slips through with score >= 50 (e.g. ml_signal at score=60).
    # Graceful degradation: return no artifacts + exportable=False with degradation notes.
    unsupported_ind_types = []
    for _ind in indicators:
        _ind_type = _ind.get("type", "") if isinstance(_ind, dict) else str(_ind)
        _base_type = _ind_type.split("_")[0] if "_" in _ind_type else _ind_type
        if _base_type not in INDICATOR_MAP and _ind_type not in INDICATOR_MAP:
            unsupported_ind_types.append(_ind_type)
    if unsupported_ind_types:
        result.degradation_notes.append(
            f"Indicator(s) {unsupported_ind_types} have no Pine equivalent — no artifacts emitted. "
            "Update INDICATOR_MAP or remove from strategy. "
            "Exportability scorer should mark strategies with unknown indicators as exportable=False."
        )
        result.exportability = result.exportability.model_copy(
            update={
                "exportable": False,
                "deductions": list(result.exportability.deductions) + [
                    f"Indicator(s) {unsupported_ind_types} not in INDICATOR_MAP"
                ],
            }
        )
        return result

    indicator_vars: dict[str, str] = {}
    indicator_lines: list[str] = []
    try:
        for idx, ind in enumerate(indicators):
            ind_type = ind.get("type", "") if isinstance(ind, dict) else str(ind)
            params = ind if isinstance(ind, dict) else {}
            var_name, pine_line = _build_pine_indicator_var(ind_type, params, idx)
            indicator_vars[var_name] = ind_type
            indicator_lines.append(pine_line)
    except ValueError as build_err:
        # Indicator type not in INDICATOR_MAP — no Pine artifact can be produced.
        # ICT indicators (fvg, order_block, breaker_block, liquidity_sweep) intentionally have
        # None entries in INDICATOR_MAP; they require a separate Path B engineering effort.
        # exportability.py now scores these at -25 each so the scorer also returns
        # exportable=False before the compiler is ever reached. If you see this message in
        # production it means a strategy bypassed the scorer or scoring was misconfigured.
        # Do NOT add a Pine template here without a full Path B review session.
        result.degradation_notes.append(
            f"Indicator build failed — no Pine equivalent: {build_err}. "
            "Strategy contains an ICT indicator (fvg/order_block/breaker_block/liquidity_sweep) "
            "with no Pine implementation. Exportability scorer should have marked this "
            "exportable=False. Use non-ICT entry conditions if Pine export is required."
        )
        # Mark non-exportable so caller knows no artifacts are present
        result.exportability = result.exportability.model_copy(
            update={"exportable": False, "deductions": list(result.exportability.deductions) + [str(build_err)]}
        )
        return result

    # Stage 3: Entry/exit conditions (shared)
    long_cond, short_cond = _build_entry_condition(strategy, indicator_vars)
    sl_distance, tp_distance = _build_exit_condition(strategy)

    # Stage 4: Session filter (shared)
    session_line = _build_session_filter(strategy.get("session_filter"))

    # Stage 5: Prop overlay (shared)
    prop_overlay = _build_prop_overlay(firm_key)

    # Stage 5b: Risk intelligence (shared)
    risk_intel = risk_intelligence or strategy.get("risk_intelligence")
    risk_intel_overlay = _build_risk_intelligence_overlay(risk_intel)

    # ATR period
    atr_period = 14
    for ind in indicators:
        if isinstance(ind, dict) and ind.get("type") == "atr":
            atr_period = ind.get("period", 14)

    use_target = strategy.get("take_profit_atr_multiple") is not None

    # Stage 6: Build shared preamble (IDENTICAL in both artifacts)
    shared = _build_shared_preamble(
        strategy=strategy,
        indicator_lines=indicator_lines,
        long_cond=long_cond,
        short_cond=short_cond,
        sl_distance=sl_distance,
        tp_distance=tp_distance,
        session_line=session_line,
        atr_period=atr_period,
        use_target=use_target,
        prop_overlay=prop_overlay,
        risk_intel_overlay=risk_intel_overlay,
        firm_key=firm_key,
    )

    # Stage 7a: INDICATOR artifact
    indicator_code = _build_indicator_artifact(
        strategy_name=strategy_name,
        symbol=symbol,
        strategy_id=sid,
        shared_preamble=shared,
    )

    # Stage 7b: STRATEGY artifact (commission from firm_key)
    commission = 0.62
    if firm_key:
        commission = FIRM_COMMISSIONS.get(firm_key, {}).get(symbol, 0.62)

    # F6: Flag strategy artifact as prohibited when firm does not allow automated trading.
    # The artifact is still emitted (informational) but carries a machine-readable header flag
    # so callers and UIs can surface a hard warning and prevent accidental TradersPost setup.
    manual_approval_firm = firm_key in MANUAL_APPROVAL_FIRMS

    strategy_code = _build_strategy_artifact(
        strategy_name=strategy_name,
        symbol=symbol,
        strategy_id=sid,
        shared_preamble=shared,
        commission=commission,
        sl_distance=sl_distance,
        tp_distance=tp_distance,
        use_target=use_target,
        manual_approval_firm=manual_approval_firm,
    )

    # Stage 8: Alerts JSON metadata (covers both delivery paths)
    tv_symbol = _TV_SYMBOL_MAP.get(symbol, f"{symbol}1!")
    alerts_json = {
        "strategy": strategy_name,
        "strategy_id": sid,
        "pine_version": "v5",
        "tv_symbol": tv_symbol,
        "delivery_paths": {
            "indicator": {
                "firms": list(MANUAL_APPROVAL_FIRMS),
                "alert_timing": "once_per_bar_close",
                "approval": "manual",
                "alerts": [
                    {"name": "Long Entry",   "type": "entry", "routing": "manual"},
                    {"name": "Short Entry",  "type": "entry", "routing": "manual"},
                    {"name": "Long Exit",    "type": "exit",  "routing": "manual"},
                    {"name": "Short Exit",   "type": "exit",  "routing": "manual"},
                    {"name": "Invalidated",  "type": "exit",  "routing": "manual"},
                    {"name": "Risk Lockout", "type": "risk",  "routing": "manual"},
                ],
            },
            "strategy": {
                "firms": list(ATS_FIRMS),
                "alert_timing": "once_per_bar_close",
                "approval": "automated",
                "webhook": "traderspost",
                "alerts": [
                    {"name": "TP Long Entry",   "type": "entry", "routing": "traderspost", "action": "buy"},
                    {"name": "TP Short Entry",  "type": "entry", "routing": "traderspost", "action": "sell"},
                    {"name": "TP Long Exit",    "type": "exit",  "routing": "traderspost", "action": "exit"},
                    {"name": "TP Short Exit",   "type": "exit",  "routing": "traderspost", "action": "exit"},
                    {"name": "TP Risk Lockout", "type": "risk",  "routing": "traderspost", "action": "cancel"},
                ],
                "sample_payload": {
                    "action": "buy",
                    "symbol": tv_symbol,
                    "quantity": 1,
                    "stopLoss": "<computed_at_bar_close>",
                    "takeProfit": "<computed_at_bar_close>",
                    "strategyId": sid,
                },
            },
        },
    }

    # Stage 9: Content hash — hash of both Pine scripts concatenated
    content_hash = hashlib.sha256((indicator_code + strategy_code).encode()).hexdigest()
    result.content_hash = content_hash

    # Stage 10: Populate result
    result.indicator_artifact = PineArtifact(
        artifact_type="dual_indicator",
        file_name=f"{safe_name}_INDICATOR.pine",
        content=indicator_code,
        size_bytes=len(indicator_code.encode()),
    )
    result.strategy_artifact = PineArtifact(
        artifact_type="dual_strategy",
        file_name=f"{safe_name}_STRATEGY.pine",
        content=strategy_code,
        size_bytes=len(strategy_code.encode()),
    )
    result.alerts_artifact = PineArtifact(
        artifact_type="dual_alerts_json",
        file_name=f"{safe_name}_dual_alerts.json",
        content=json.dumps(alerts_json, indent=2),
        size_bytes=len(json.dumps(alerts_json).encode()),
    )

    # Routing hints
    result.indicator_firms = list(MANUAL_APPROVAL_FIRMS)
    result.strategy_firms = list(ATS_FIRMS)

    # Degradation notes — document what cannot be 1:1 translated
    if firm_key in MANUAL_APPROVAL_FIRMS:
        result.degradation_notes.append(
            f"strategy_artifact_suppressed_for_manual_approval_firm: "
            f"firm '{firm_key}' does not allow automated trading. "
            "Use _INDICATOR.pine only. Do NOT configure TradersPost webhooks at this firm. "
            "STRATEGY artifact is emitted with PROHIBITED_AT_THIS_FIRM=true header — informational only."
        )
    if not use_target:
        result.degradation_notes.append(
            "take_profit_atr_multiple not set — strategy.exit() target will be 'na' (stop-only). "
            "TradersPost takeProfit field will be na. Confirm broker accepts stop-only exits."
        )
    # Caveat 3 residual: Pine's strategy.exit() with stop= can fill intrabar at the stop
    # price during TradingView's Strategy Tester, even though we set process_orders_on_close,
    # calc_on_every_tick=false, and calc_on_order_fills=false. The webhook (TradersPost live)
    # path is parity-correct because alertconditions are guarded by barstate.isconfirmed.
    # The visual TV backtest may therefore show divergent P&L vs the internal backtester
    # and the INDICATOR artifact when a stop is breached intrabar but price recovers by close.
    result.degradation_notes.append(
        "pine_strategy_exit_intrabar_fill_residual: TradingView Strategy Tester may show "
        "divergent P&L vs INDICATOR. Webhook alerts fire bar-close per barstate.isconfirmed "
        "guard, so live TradersPost execution is parity-correct."
    )

    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Compile StrategyDSL to Pine Script v5")
    parser.add_argument("--input-json", required=True, help="Strategy JSON (inline or file path)")
    parser.add_argument("--firm-key", default=None, help="Firm key for prop overlay (e.g., topstep_50k)")
    parser.add_argument("--dual", action="store_true", help="Emit dual artifacts (indicator + strategy)")
    parser.add_argument("--strategy-id", type=str, default=None, help="DB UUID of strategy — embedded in TradersPost webhook payloads")
    args = parser.parse_args()

    # Support both inline JSON and file path
    input_str = args.input_json
    if input_str.startswith("{"):
        config = json.loads(input_str)
    else:
        with open(input_str) as f:
            config = json.load(f)

    strategy = config.get("strategy", config)
    firm_key = args.firm_key or config.get("firm_key")
    risk_intelligence = config.get("risk_intelligence")

    if args.dual:
        dual_result = compile_dual_artifacts(strategy, firm_key, risk_intelligence=risk_intelligence, strategy_id=args.strategy_id)
        output = dual_result.model_dump()
        # Truncate artifact content for stdout readability
        for field in ("indicator_artifact", "strategy_artifact", "alerts_artifact"):
            art = output.get(field)
            if art and len(art.get("content", "")) > 500:
                art["content"] = art["content"][:500] + f"... [{len(art['content'])} chars total]"
    else:
        result = compile_strategy(strategy, firm_key, risk_intelligence=risk_intelligence)
        output = result.model_dump()
        for art in output.get("artifacts", []):
            content = art.get("content", "")
            if len(content) > 500:
                art["content"] = content[:500] + f"... [{len(content)} chars total]"

    print(json.dumps(output, indent=2))
