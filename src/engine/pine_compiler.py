"""Pine Script v5 Compiler — transpiles StrategyDSL to TradingView Pine Script.

Compiler stages:
  1. Normalize strategy from StrategyDSL
  2. Run exportability checks
  3. Select template set
  4. Convert to Pine state machine
  5. Inject prop-risk overlay
  6. Build alert definitions JSON
  7. Emit artifacts

Usage:
    python -m src.engine.pine_compiler --input-json '{"strategy": {...}, "firm_key": "topstep_50k"}'
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
    """
    base_type = ind_type.split("_")[0] if "_" in ind_type else ind_type
    var_name = f"ind_{base_type}_{idx}"

    template = INDICATOR_MAP.get(base_type)
    if template is None:
        # Custom indicator — generate placeholder
        raise ValueError(
            f"Unsupported Pine indicator type '{ind_type}'. "
            "Add it to INDICATOR_MAP before exporting."
        )

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
    """Generate Pine exit conditions from DSL exit_type."""
    exit_type = strategy.get("exit_type", "atr_multiple")
    exit_params = strategy.get("exit_params", {})

    atr_sl = strategy.get("stop_loss_atr_multiple", 2.0)
    atr_tp = strategy.get("take_profit_atr_multiple")

    # ATR-based stops are always generated
    sl_line = f"atr_val * {atr_sl}"
    tp_line = f"atr_val * {atr_tp}" if atr_tp else "na"

    return sl_line, tp_line


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
    """Generate prop-firm risk overlay as embedded Pine constants."""
    if not firm_key:
        return """
// ─── Prop Risk Overlay (no firm selected) ───────────────────────
var float max_drawdown_limit = 2000.0   // Default tightest
var float daily_loss_limit = 1000.0     // Default tightest
var int max_contracts = 15
var float commission_per_side = 0.62

// risk_lockout: always declared so state machine can reference it regardless of firm
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

// Risk tracking
var float session_pnl = 0.0
var float peak_equity = 0.0
var float current_drawdown = 0.0

// Lockout logic
risk_lockout = (not na(daily_loss_limit) and session_pnl <= -daily_loss_limit) or current_drawdown >= max_drawdown_limit

// Visual overlay
bgcolor(risk_lockout ? color.new(color.red, 85) : na, title="Risk Lockout")
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
        "ETH_ONLY": 'in_session = na(time(timeframe.period, "0930-1600", "America/New_York"))',
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
    """Compile a StrategyDSL (dict or Pydantic model) to Pine Script v6 artifacts.

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
    for idx, ind in enumerate(indicators):
        ind_type = ind.get("type", "") if isinstance(ind, dict) else str(ind)
        params = ind if isinstance(ind, dict) else {}
        var_name, pine_line = _build_pine_indicator_var(ind_type, params, idx)
        indicator_vars[var_name] = ind_type
        indicator_lines.append(pine_line)

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

    pine_code += f"""
// ─── Session Filter ─────────────────────────────────────────────
{session_line}

// ─── Entry Signals ──────────────────────────────────────────────
long_signal = in_session and ({long_cond})
short_signal = in_session and ({short_cond})

// ─── Exit Signals ───────────────────────────────────────────────
exit_long_signal = false  // Override with custom exit logic if needed
exit_short_signal = false

// ─── Stop/Target Distances ──────────────────────────────────────
stop_distance = {sl_distance}
use_target = {'true' if use_target else 'false'}
target_distance = {tp_distance}
"""

    pine_code += prop_overlay
    pine_code += risk_intel_overlay
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

        strategy_shell = f"""//@version=5
strategy("{strategy_name} [Backtest]", overlay=true, initial_capital=50000,
         default_qty_type=strategy.fixed, default_qty_value=1,
         commission_type=strategy.commission.cash_per_contract, commission_value={shell_commission},
         slippage=1)

// NOTE: This is a simplified strategy shell for TradingView's strategy tester.
// For live trading signals, use the indicator version with alerts.

atr_val = ta.atr({atr_period})
"""
        for line in indicator_lines:
            strategy_shell += line + "\n"

        strategy_shell += f"""
{session_line}
long_signal = in_session and ({long_cond})
short_signal = in_session and ({short_cond})

stop_distance = {sl_distance}
target_distance = {tp_distance}

if long_signal
    strategy.entry("Long", strategy.long)
    strategy.exit("Long Exit", "Long", stop=close - stop_distance, limit={'close + target_distance' if use_target else 'na'})

if short_signal
    strategy.entry("Short", strategy.short)
    strategy.exit("Short Exit", "Short", stop=close + stop_distance, limit={'close - target_distance' if use_target else 'na'})
"""

        result.artifacts.append(PineArtifact(
            artifact_type="strategy_shell",
            file_name=f"{safe_name}_strategy.pine",
            content=strategy_shell,
            size_bytes=len(strategy_shell.encode()),
        ))

    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Compile StrategyDSL to Pine Script v5")
    parser.add_argument("--input-json", required=True, help="Strategy JSON (inline or file path)")
    parser.add_argument("--firm-key", default=None, help="Firm key for prop overlay (e.g., topstep_50k)")
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

    result = compile_strategy(strategy, firm_key, risk_intelligence=risk_intelligence)

    # Output as JSON
    output = result.model_dump()
    # Truncate content for stdout readability in CLI mode
    for art in output.get("artifacts", []):
        content = art.get("content", "")
        if len(content) > 500:
            art["content"] = content[:500] + f"... [{len(content)} chars total]"

    print(json.dumps(output, indent=2))
