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

import hashlib
import json
from typing import Optional

from pydantic import BaseModel, Field

from src.engine.exportability import ExportabilityResult, score_exportability
from src.engine.firm_config import FIRM_COMMISSIONS, FIRM_CONTRACT_CAPS, FIRM_RULES

# F-10: canonical marker HMAC strings — single source of truth for the
# Pine→backend contract. TypeScript mirror at src/shared/marker-contract.ts.
from src.engine.marker_contract import (
    build_export_canonical as _marker_build_export_canonical,
)

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


# ─── Compile-time error — raised on placeholder substitution failure ──────────
class PineCompileError(Exception):
    """Raised when a Pine compile-time invariant is violated.

    Currently used exclusively for placeholder substitution failures in the
    tf_gateway archetype path: when gatewayOptions (account_id + live_order_token)
    are provided but the compiled Pine artifact still contains the literal
    placeholder strings.  This is a fail-CLOSED guard — it is better to raise
    here than to silently emit an artifact that routes to <account-id-placeholder>.

    Legacy operator-manual path (gatewayOptions not provided): literal placeholders
    survive in the artifact intentionally — the operator substitutes them manually
    in the TradingView alert-message field at deploy time.  No error is raised.
    """


# ─── Archetype Alert-Only Pine Factory ──────────────────────────────────────
#
# Archetypes (entry_indicator='archetype:<key>') are structural ICT/SMC/Wyckoff
# patterns whose entry/exit logic lives entirely in the Python engine at
# src/engine/strategies/<class>.py.  Pine is a PASSIVE MARKER + ALERT EMITTER
# only — it does not replicate the Python engine's structural detection.
#
# Uncatalogued entries (entry_indicator='uncatalogued:<term>') use the same
# template with the speaker_term as the display name.
#
# Alert-only band: exportability score 60 (band='alert_only') — exportable=True,
# but operator must understand Pine is a visual aid, not the execution engine.

# Valid gateway_mode values for the archetype path.
# Any other value raises ValueError at compile time — no silent fall-through.
_VALID_ARCHETYPE_GATEWAY_MODES: frozenset[str] = frozenset({"tf_gateway", "direct"})


def _build_archetype_alert_pine(
    key: str,
    display_name: str,
    gateway_mode: Optional[str] = None,
    account_id: Optional[str] = None,
    live_order_token: Optional[str] = None,
) -> str:
    """Build a minimal alert-only Pine v5 script for a structural archetype.

    The emitted Pine:
      - Declares indicator() in overlay mode with the archetype display name.
      - Sets archetype_active = true on every bar (passive always-on marker).
      - Emits alertcondition() with payload determined by gateway_mode.
      - Plots a shape at the bottom of the chart so the operator can confirm
        the indicator is loaded and the archetype key is correct.

    Args:
        key:              Archetype key (e.g. 'ict_silver_bullet_ny_am') used in
                          the alert JSON payload and Pine variable names.
        display_name:     Human-readable title (e.g. 'Ict Silver Bullet Ny Am')
                          used in indicator() title and plotshape text.
        gateway_mode:     Controls alert payload destination.
                          'tf_gateway' — emit TF-gateway payload routed to
                            POST /api/live-order → routeOrder() → full safety stack.
                            action is always "archetype_signal" (locked contract per F-2).
                            Python engine (archetype_evaluator.py, Track C) resolves
                            direction server-side.
                            When account_id and live_order_token are provided,
                            they are substituted at compile time (preferred path).
                            When they are None, literal placeholders survive for
                            operator-manual substitution at TradingView deploy time.
                          None / 'direct' — emit the EXISTING generic-signal payload
                            (byte-identical to pre-Pass-4.5 output).
                          Any other value — raises ValueError immediately.
        account_id:       When provided with gateway_mode='tf_gateway', substituted
                          at compile time in place of <account-id-placeholder>.
                          When None, the literal placeholder is preserved for
                          operator-manual substitution (legacy path).
        live_order_token: When provided with gateway_mode='tf_gateway', substituted
                          at compile time in place of <live-order-token-placeholder>.
                          This is account_strategy_assignments.hmac_secret — the
                          per-account static bearer token validated by /api/live-order
                          in static-token auth mode B.
                          When None, the literal placeholder is preserved for
                          operator-manual substitution (legacy path).

    Returns:
        Complete Pine Script v5 source string, ready for TradingView import.

    Repaint risk:  None — archetype_active is always true; no series lookback.
    Bar-close timing: alert fires once per bar close when 'Once Per Bar Close'
                      is selected in TradingView alert settings.
    State persistence: None — stateless passive marker.

    Raises:
        ValueError: When gateway_mode is not None, 'direct', or 'tf_gateway'.
    """
    # Validate gateway_mode early — no silent fall-through on invalid values.
    if gateway_mode is not None and gateway_mode not in _VALID_ARCHETYPE_GATEWAY_MODES:
        raise ValueError(
            f"Invalid gateway_mode '{gateway_mode}' for archetype '{key}'. "
            f"Must be one of: {sorted(_VALID_ARCHETYPE_GATEWAY_MODES)} or None (defaults to generic-signal). "
            "Pass 4.5 Track A: use 'tf_gateway' for the canonical TF-gateway path."
        )

    if gateway_mode == "tf_gateway":
        # Pass 4.5 Track A — TF-gateway payload.
        # action is ALWAYS "archetype_signal" (locked F-2 contract).
        # Python engine resolves direction server-side (Track C archetype_evaluator.py).
        # Pine {{timenow}} and {{time}} are TradingView alert placeholders resolved
        # at alert-fire time — NOT Pine variables.
        #
        # Compile-time substitution (preferred path — hardening/phase-0):
        # When account_id and live_order_token are supplied, substitute them
        # directly into the alertcondition message so the emitted Pine contains
        # the real credentials and the operator never needs to text-replace in TV.
        #
        # Legacy operator-manual path:
        # When account_id / live_order_token are None, literal placeholders survive.
        # Operator substitutes <account-id-placeholder> and <live-order-token-placeholder>
        # at TradingView alert-message-field deploy time (Settings panel).
        _acct_val = account_id if account_id is not None else "<account-id-placeholder>"
        _token_val = live_order_token if live_order_token is not None else "<live-order-token-placeholder>"
        # Determine whether credentials were compile-time substituted for the header comment.
        _cred_note = (
            "COMPILE-TIME SUBSTITUTED — credentials embedded by Trading Forge at export time."
            if (account_id is not None and live_order_token is not None)
            else "OPERATOR-MANUAL — substitute <account-id-placeholder> and <live-order-token-placeholder>\n//   at TradingView alert-message-field deploy time (Settings panel, same UX as HMAC secret)."
        )
        return f"""//@version=5
indicator("TF Archetype [GW]: {display_name}", overlay=true)

// Alert-only Pine — TF-gateway mode (Pass 4.5 / F-2).
// Python engine at src/engine/strategies/<inferred_class>.py owns entry/exit.
// Pine is a passive wake-up signal; Python engine resolves direction server-side.
// Archetype key: {key}
// gateway_mode: tf_gateway → POST /api/live-order → routeOrder() → full safety stack.
// action="archetype_signal" is LOCKED — Track B /api/live-order dispatches to archetype_evaluator.py.
// Credentials: {_cred_note}

archetype_active = true

alertcondition(archetype_active, title="{display_name} [TF-GW]", message='{{"account_id":"{_acct_val}","strategy_id":"{{{{strategy.id}}}}","live_order_token":"{_token_val}","timestamp_ms":"{{{{timenow}}}}","bar_timestamp":"{{{{time}}}}","action":"archetype_signal","archetype":"{key}","ticker":"{{{{ticker}}}}"}}')

plotshape(archetype_active, location=location.bottom, color=color.purple, style=shape.labeldown, text="{display_name}")
"""

    # Default path: gateway_mode=None or 'direct'.
    # Byte-identical to pre-Pass-4.5 generic-signal payload — preserves backward-compat
    # for all callers that do not pass gateway_mode.
    return f"""//@version=5
indicator("TF Archetype: {display_name}", overlay=true)

// Alert-only Pine — Python engine at src/engine/strategies/<inferred_class>.py owns entry/exit.
// Pine is a passive marker + alert emitter.
// Archetype key: {key}

archetype_active = true

alertcondition(archetype_active, title="{display_name}", message='{{"strategyId":"{{{{strategy.id}}}}","archetype":"{key}","bar_timestamp":"{{{{time}}}}","action":"signal"}}')

plotshape(archetype_active, location=location.bottom, color=color.aqua, style=shape.labeldown, text="{display_name}")
"""


# ─── ARCHETYPE_PINE_RECIPE ───────────────────────────────────────────────────
#
# One entry per key in ARCHETYPE_REGISTRY (direct-bucket-graduator.ts:53-150).
# The list below must stay in sync with that registry.
# Display names are Title Case conversions of the underscore-separated keys.
#
# Keys confirmed from ARCHETYPE_REGISTRY as of 2026-06-22 (39 entries):
#   ICT time-window (14): ict_silver_bullet_ny_am, ict_silver_bullet_london,
#     ict_silver_bullet_ny_pm, ict_judas_swing, ict_ny_lunch_reversal,
#     ict_midnight_open, ict_london_raid, ict_turtle_soup, ict_ote,
#     ict_power_of_3, ict_unicorn, ict_breaker, ict_mitigation, ict_iofed
#   SMC + Scalp/Swing (7): smt_reversal, ict_quarterly_swing, ict_propulsion,
#     ict_eqhl_raid, ict_scalp, ict_swing, ict_2022
#   Structural primitives (6): break_of_structure, change_of_character,
#     market_structure_shift, cisd, fvg_retrace
#   W23G.3 short-form aliases (6): fvg, judas_swing, silver_bullet,
#     breaker_block, order_block, liquidity_sweep
#   Wyckoff (4): wyckoff_spring, wyckoff_upthrust, wyckoff_accumulation,
#     wyckoff_distribution
#   Wave 26 Pass G + W26.4 (3): bounce_off_level, ict_bias_aligned_continuation,
#     gann_box_4h_continuation

_ARCHETYPE_ENTRIES: list[tuple[str, str]] = [
    # ICT time-window archetypes
    ("ict_silver_bullet_ny_am",          "Ict Silver Bullet Ny Am"),
    ("ict_silver_bullet_london",         "Ict Silver Bullet London"),
    ("ict_silver_bullet_ny_pm",          "Ict Silver Bullet Ny Pm"),
    ("ict_judas_swing",                  "Ict Judas Swing"),
    ("ict_ny_lunch_reversal",            "Ict Ny Lunch Reversal"),
    ("ict_midnight_open",                "Ict Midnight Open"),
    ("ict_london_raid",                  "Ict London Raid"),
    ("ict_turtle_soup",                  "Ict Turtle Soup"),
    ("ict_ote",                          "Ict Ote"),
    ("ict_power_of_3",                   "Ict Power Of 3"),
    ("ict_unicorn",                      "Ict Unicorn"),
    ("ict_breaker",                      "Ict Breaker"),
    ("ict_mitigation",                   "Ict Mitigation"),
    ("ict_iofed",                        "Ict Iofed"),
    # SMC + Scalp/Swing
    ("smt_reversal",                     "Smt Reversal"),
    ("ict_quarterly_swing",              "Ict Quarterly Swing"),
    ("ict_propulsion",                   "Ict Propulsion"),
    ("ict_eqhl_raid",                    "Ict Eqhl Raid"),
    ("ict_scalp",                        "Ict Scalp"),
    ("ict_swing",                        "Ict Swing"),
    ("ict_2022",                         "Ict 2022"),
    # Structural primitives
    ("break_of_structure",               "Break Of Structure"),
    ("change_of_character",              "Change Of Character"),
    ("market_structure_shift",           "Market Structure Shift"),
    ("cisd",                             "Cisd"),
    ("fvg_retrace",                      "Fvg Retrace"),
    # W23G.3 short-form aliases
    ("fvg",                              "Fvg"),
    ("judas_swing",                      "Judas Swing"),
    ("silver_bullet",                    "Silver Bullet"),
    ("breaker_block",                    "Breaker Block"),
    ("order_block",                      "Order Block"),
    ("liquidity_sweep",                  "Liquidity Sweep"),
    # Wyckoff
    ("wyckoff_spring",                   "Wyckoff Spring"),
    ("wyckoff_upthrust",                 "Wyckoff Upthrust"),
    ("wyckoff_accumulation",             "Wyckoff Accumulation"),
    ("wyckoff_distribution",             "Wyckoff Distribution"),
    # Wave 26 Pass G + W26.4
    ("bounce_off_level",                 "Bounce Off Level"),
    ("ict_bias_aligned_continuation",    "Ict Bias Aligned Continuation"),
    ("gann_box_4h_continuation",         "Gann Box 4H Continuation"),
]

ARCHETYPE_PINE_RECIPE: dict[str, str] = {
    key: _build_archetype_alert_pine(key, display_name)
    for key, display_name in _ARCHETYPE_ENTRIES
}

# ─── ARCHETYPE_PINE_RECIPE_TF_GATEWAY ────────────────────────────────────────
#
# Pass 4.5 Track A — TF-gateway variant of each archetype recipe.
# Every entry in ARCHETYPE_PINE_RECIPE has a matching TF-gateway entry here.
#
# Key contract:
#   - action is ALWAYS "archetype_signal" (locked per F-2 close design).
#   - The Pine alert is a "wake up" signal; Python engine (Track C
#     archetype_evaluator.py) resolves direction server-side.
#   - Placeholders <account-id-placeholder> and <live-order-token-placeholder>
#     are operator-substituted at TradingView alert-message-field deploy time.
#   - Count MUST equal len(ARCHETYPE_PINE_RECIPE) — verified by CI import check.
#
# Do NOT call this map directly from callers — use _build_pine_indicator_var()
# which reads gateway_mode from strategy config and selects the correct map.
ARCHETYPE_PINE_RECIPE_TF_GATEWAY: dict[str, str] = {
    key: _build_archetype_alert_pine(key, display_name, gateway_mode="tf_gateway")
    for key, display_name in _ARCHETYPE_ENTRIES
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


def _build_pine_indicator_var(
    ind_type: str,
    params: dict,
    idx: int,
    strategy: Optional[dict] = None,
) -> tuple[str, str]:
    """Build Pine variable declaration for an indicator.

    Returns (var_name, pine_code_line).

    Lookup priority:
      0. 'archetype:<key>' prefix → gateway_mode-aware recipe lookup.
         Reads gateway_mode from strategy.config.gateway_mode (injected by
         pine-export-service.ts Track B).  When gateway_mode='tf_gateway',
         selects ARCHETYPE_PINE_RECIPE_TF_GATEWAY (Pass 4.5 / F-2).  Default
         (None/'direct') selects ARCHETYPE_PINE_RECIPE (pre-Pass-4.5 backward-compat).
         The returned pine_code_line IS the full Pine script (not a single var line).
         var_name is 'archetype_<key>' for downstream tracking.
      0b.'uncatalogued:<term>' prefix → _build_archetype_alert_pine with the term
         as display name and gateway_mode threaded through.  Same alert-only contract.
      1. Full ind_type in INDICATOR_MAP (catches multi-word names like volume_profile, order_block).
         If mapped to None → placeholder comment, no raise.
      2. base_type (first segment before '_') in INDICATOR_MAP for suffix variants
         (e.g. sma_crossover → sma).  If mapped to None → placeholder comment.
      3. Neither found → ValueError (genuinely unknown — caller must add to INDICATOR_MAP).

    Args:
        ind_type:  DSL indicator type string.
        params:    Indicator parameter dict.
        idx:       Index within the indicator list (for var_name uniqueness).
        strategy:  Full strategy config dict.  When provided, reads
                   strategy.get('config', {}).get('gateway_mode') for archetype routing.
                   When None (legacy callers), defaults to generic-signal path.
    """
    # Resolve gateway_mode from strategy config (injected by pine-export-service.ts).
    # None = default/backward-compat (generic-signal payload).
    gateway_mode: Optional[str] = None
    if strategy is not None:
        gateway_mode = strategy.get("config", {}).get("gateway_mode")

    # Resolve compile-time credentials from strategy config (injected by pine-export-service.ts).
    # These are used for the archetype tf_gateway path only.  When present, they are
    # substituted into the alertcondition message at compile time so the emitted Pine
    # contains real credentials.  When absent, literal placeholders survive for the
    # operator-manual substitution path (legacy).
    _compile_account_id: Optional[str] = None
    _compile_live_order_token: Optional[str] = None
    if strategy is not None:
        _config = strategy.get("config", {}) if isinstance(strategy.get("config"), dict) else {}
        _compile_account_id = _config.get("account_id") or None
        _compile_live_order_token = _config.get("live_order_token") or None

    # Priority 0: archetype prefix — structural engine archetype, alert-only Pine.
    if ind_type.startswith("archetype:"):
        key = ind_type[len("archetype:"):]
        display_name_from_key = " ".join(w.capitalize() for w in key.split("_"))
        if gateway_mode == "tf_gateway":
            if key not in ARCHETYPE_PINE_RECIPE_TF_GATEWAY:
                raise ValueError(
                    f"Unknown archetype key '{key}' for tf_gateway mode. "
                    "Add to ARCHETYPE_PINE_RECIPE_TF_GATEWAY / ARCHETYPE_REGISTRY before exporting."
                )
            var_name = f"archetype_{key}"
            # Compile-time substitution path: when credentials are available,
            # call _build_archetype_alert_pine() dynamically so the emitted Pine
            # contains real account_id / live_order_token values.
            # Legacy path: when credentials are absent, fall back to the pre-built
            # ARCHETYPE_PINE_RECIPE_TF_GATEWAY entry (operator-manual substitution).
            if _compile_account_id and _compile_live_order_token:
                return var_name, _build_archetype_alert_pine(
                    key,
                    display_name_from_key,
                    gateway_mode="tf_gateway",
                    account_id=_compile_account_id,
                    live_order_token=_compile_live_order_token,
                )
            return var_name, ARCHETYPE_PINE_RECIPE_TF_GATEWAY[key]
        # Default path: None / 'direct' — pre-Pass-4.5 backward-compat.
        if key not in ARCHETYPE_PINE_RECIPE:
            raise ValueError(
                f"Unknown archetype key '{key}'. "
                "Add to ARCHETYPE_PINE_RECIPE / ARCHETYPE_REGISTRY before exporting."
            )
        var_name = f"archetype_{key}"
        return var_name, ARCHETYPE_PINE_RECIPE[key]

    # Priority 0b: uncatalogued prefix — speaker-coined term with no catalog entry yet.
    if ind_type.startswith("uncatalogued:"):
        term = ind_type[len("uncatalogued:"):]
        display_name = term.replace("_", " ").title()
        synthetic_key = f"uncatalogued_{term}"
        var_name = f"uncatalogued_{term}"
        return var_name, _build_archetype_alert_pine(
            synthetic_key,
            display_name,
            gateway_mode=gateway_mode,
            account_id=_compile_account_id if gateway_mode == "tf_gateway" else None,
            live_order_token=_compile_live_order_token if gateway_mode == "tf_gateway" else None,
        )

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
    _entry_type = strategy.get("entry_type", "trend_follow")
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


def _build_time_stop_block() -> str:
    """F-1: 15:55 ET hard-flatten block for compliance with Topstep + MFFU overnight ban.

    For INDICATOR artifacts: emits an alertcondition so the trader / TradersPost
    approval path can react to end-of-session.  No strategy.close_all() is
    available in indicator() context.

    For STRATEGY artifacts: emits strategy.close_all() directly.
    Caller selects mode via is_strategy parameter.
    """
    return """
// ─── 15:55 ET Time-Stop (F-1) ───────────────────────────────────
// Hard flatten before session close — Topstep + MFFU overnight ban compliance.
// DO NOT DISABLE: holding overnight on prop-firm accounts triggers immediate ban.
// Pine time() returns na when outside the window; not na() means we ARE in window.
time_to_close = not na(time(timeframe.period, "1555-1600", "America/New_York"))
"""


def _build_strategy_time_stop_close() -> str:
    """F-1 (STRATEGY artifact): close_all block.  Called from _build_strategy_artifact."""
    return """
// 15:55 ET — flatten all positions (strategy artifact)
if time_to_close and strategy.position_size != 0
    strategy.close_all(comment="time_stop_1555_ET")
"""


def _build_indicator_time_stop_alert(strategy_name: str, strategy_id: str, symbol: str) -> str:
    """F-1 (INDICATOR artifact): alertcondition for manual-approval / TradersPost approval path."""
    tv_symbol = _TV_SYMBOL_MAP.get(symbol, f"{symbol}1!")
    return f"""
// 15:55 ET time-stop alert (indicator artifact — manual-approval / TradersPost path)
// state != 0 means a position is being tracked by the state machine.
alertcondition(time_to_close and state != 0, title="Time Stop 15:55 ET",
    message='{{"action": "exit", "symbol": "{tv_symbol}", "strategyId": "{strategy_id}", "note": "TIME_STOP_1555_ET"}}')
// PROP RISK: If you see this alert, close your position immediately.
// Holding past 15:55 ET risks overnight position violation (Topstep/MFFU ban).
"""


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
var int max_contracts = 50           // 50 micros (5 minis × 10:1) at $50K, Topstep + MFFU
var float commission_per_side = 0.62  // MFFU baseline; Topstep is lower at $0.37

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


def _build_session_filter(
    session_filter: Optional[str],
    allowed_entry_windows: Optional[list[str]] = None,
) -> str:
    """Generate Pine session time filter.

    W23H.3: when allowed_entry_windows is a non-empty list, additional Pine
    time() conditions are emitted and AND-ed into the session check.

    Boundary semantics on the Pine side: Pine's time() returns na when the bar
    is OUTSIDE the window, so ``not na(time(...))`` is True only when the bar
    is inside the window.  Multiple windows are OR-ed: a bar qualifies if it
    falls in ANY window.  The result is then AND-ed with the base session filter.

    Examples:
        _build_session_filter("RTH_ONLY", ["09:45-12:00 ET", "13:30-15:30 ET"])
        →
        in_session = not na(time(timeframe.period, "0930-1600", "America/New_York"))
        in_window = (not na(time(timeframe.period, "0945-1200", "America/New_York")))
                 or (not na(time(timeframe.period, "1330-1530", "America/New_York")))
        in_session := in_session and in_window
    """
    if not session_filter or session_filter == "ALL_SESSIONS":
        base = "in_session = true"
    else:
        filters = {
            "RTH_ONLY": 'in_session = not na(time(timeframe.period, "0930-1600", "America/New_York"))',
            # P2-2: ETH window corrected — CME ETH is 18:00 prior day to ~08:30 next day.
            # Using 1800-0900 ET as approximation (excludes 08:30-09:30 pre-RTH overlap).
            # The old inverse-RTH approach was incorrect: na(RTH) includes non-CME hours.
            "ETH_ONLY": 'in_session = not na(time(timeframe.period, "1800-0900", "America/New_York"))',
            "LONDON": 'in_session = not na(time(timeframe.period, "0300-0800", "America/New_York"))',
            "ASIA": 'in_session = not na(time(timeframe.period, "1900-0200", "America/New_York"))',
        }
        base = filters.get(session_filter, "in_session = true")

    # W23H.3: apply allowed_entry_windows if provided
    if not allowed_entry_windows:
        return base

    # Import here to avoid circular deps at module load time; this module is
    # imported by backtester.py which may run in a tight loop.
    from src.engine.entry_windows import parse_entry_window, window_to_pine_time_string

    window_conditions = []
    for spec in allowed_entry_windows:
        parsed = parse_entry_window(spec)  # raises ValueError on malformed — by design
        pine_time_str = window_to_pine_time_string(parsed)
        iana_tz = parsed.timezone
        window_conditions.append(
            f'(not na(time(timeframe.period, "{pine_time_str}", "{iana_tz}")))'
        )

    if not window_conditions:
        return base

    # Build multi-line in_window block — indented for Pine readability
    first = window_conditions[0]
    rest = "".join(
        f"\n             or {cond}" for cond in window_conditions[1:]
    )
    in_window_line = f"in_window = {first}{rest}"
    in_session_and = "in_session := in_session and in_window"

    return f"{base}\n{in_window_line}\n{in_session_and}"


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


# ─── Deep-Scan #18b P-1 — archetype single-declaration short-circuit ─────────
#
# Bug (fixed here): entry_indicator values prefixed 'archetype:' or
# 'uncatalogued:' route through _build_pine_indicator_var() to
# _build_archetype_alert_pine(), which returns a COMPLETE, self-contained
# Pine v5 script (header + //@version=5 + indicator() + alertcondition() +
# plotshape()) — not a single variable-declaration line like every other
# indicator type returns. compile_strategy() / compile_dual_artifacts() used
# to splice that whole script into the indicator_lines list and then wrap it
# INSIDE their own generic indicator()/strategy() scaffold, producing TWO
# top-level declarations in one .pine file. TradingView rejects any script
# with more than one indicator()/strategy()/library() call — 100% of
# archetype-governed strategies (39 registered archetype keys — the majority
# of the live library) failed to compile on TradingView.
#
# Fix: detect the prefix BEFORE assembling the generic scaffold and
# short-circuit to emit the archetype recipe VERBATIM as the sole, complete
# artifact. This matches score_exportability()'s alert_only band contract
# (score=60, exportable=True, faithful=True by design — archetypes execute
# server-side via the Python engine; Pine is a passive marker + alert
# emitter only, see _build_archetype_alert_pine docstring).


def _resolve_archetype_prefix(strategy: dict) -> Optional[str]:
    """Return the archetype/uncatalogued ind_type string if this strategy's
    entry indicator is a structural archetype, else None.

    Detection precedence mirrors score_exportability()'s prefix fast-path
    EXACTLY (entry_indicator first, falling back to indicators[0].type) so
    the compiler's short-circuit and the exportability scorer's alert_only
    band always agree on which strategies are archetype-governed. Divergence
    between the two would silently re-introduce the two-declaration bug for
    any strategy shape the compiler fails to recognize but the scorer does.
    """
    entry_indicator = strategy.get("entry_indicator", "") or ""
    if not entry_indicator:
        indicators = strategy.get("indicators", [])
        if indicators:
            first = indicators[0]
            entry_indicator = first.get("type", "") if isinstance(first, dict) else str(first)
    if entry_indicator.startswith("archetype:") or entry_indicator.startswith("uncatalogued:"):
        return entry_indicator
    return None


def _build_archetype_alerts_json(strategy_name: str, key: str, gateway_mode: Optional[str]) -> dict:
    """Build alerts_json metadata describing an archetype recipe's single alertcondition.

    Mirrors the ACTUAL alertcondition() emitted by _build_archetype_alert_pine
    for the given gateway_mode — kept manually in sync since the archetype
    recipe is a hand-authored Pine template, not assembled from the generic
    _build_alerts() state-machine block (which references Pine variables
    — state / stop_price / target_price / risk_lockout — that do not exist
    in an archetype's passive-marker script).
    """
    display_name = " ".join(w.capitalize() for w in key.split("_"))
    if gateway_mode == "tf_gateway":
        return {
            "strategy": strategy_name,
            "pine_version": "v5",
            "archetype": key,
            "export_mode": "alert_only",
            "gateway_mode": "tf_gateway",
            "alerts": [
                {
                    "name": f"{display_name} [TF-GW]",
                    "condition": "archetype_active (always true on every bar — passive marker; "
                                 "Python engine resolves direction server-side)",
                    "type": "signal",
                    "routing": "tf_gateway",
                    "action": "archetype_signal",
                },
            ],
        }
    return {
        "strategy": strategy_name,
        "pine_version": "v5",
        "archetype": key,
        "export_mode": "alert_only",
        "gateway_mode": gateway_mode or "direct",
        "alerts": [
            {
                "name": display_name,
                "condition": "archetype_active (always true on every bar — passive marker; "
                             "Python engine at src/engine/strategies/<class>.py owns entry/exit)",
                "type": "signal",
                "routing": "direct",
                "action": "signal",
            },
        ],
    }


def _compile_archetype_only(
    strategy: dict,
    ind_type: str,
    exportability: ExportabilityResult,
    strategy_name: str,
    export_type: str = "pine_indicator",
) -> "CompilerResult":
    """compile_strategy() counterpart of the P-1 fix — see module note above.

    Emits the archetype recipe (already a complete Pine v5 script) VERBATIM
    as the sole artifact. No strategy_shell / strategy() artifact is produced
    for any export_type: Pine's strategy() cannot faithfully reproduce the
    archetype's server-side structural detection, Style C exits, or the
    11-factor confluence gate (see exportability.py::_pine_inexpressible_notes,
    surfaced via exportability.deductions) — fabricating one here would be
    fake equivalence, which is forbidden. This is explicit degradation, not
    a silent drop.
    """
    result = CompilerResult(exportability=exportability, strategy_name=strategy_name)
    safe_name = strategy_name.lower().replace(" ", "_").replace("-", "_")

    key = ind_type.split(":", 1)[1] if ":" in ind_type else ind_type
    _config = strategy.get("config", {})
    gateway_mode = _config.get("gateway_mode") if isinstance(_config, dict) else None

    _alerts_json = _build_archetype_alerts_json(strategy_name, key, gateway_mode)
    alerts_json_artifact = PineArtifact(
        artifact_type="alerts_json",
        file_name=f"{safe_name}_alerts.json",
        content=json.dumps(_alerts_json, indent=2),
        size_bytes=len(json.dumps(_alerts_json).encode()),
    )

    if export_type == "alert_only":
        result.artifacts.append(alerts_json_artifact)
        return result

    # _build_pine_indicator_var() returns the COMPLETE, self-contained archetype
    # Pine script for this ind_type — emitted here VERBATIM as the sole artifact.
    _, pine_code = _build_pine_indicator_var(ind_type, {}, 0, strategy=strategy)
    result.content_hash = hashlib.sha256(pine_code.encode()).hexdigest()
    result.artifacts.append(PineArtifact(
        artifact_type="indicator",
        file_name=f"{safe_name}_indicator.pine",
        content=pine_code,
        size_bytes=len(pine_code.encode()),
    ))
    result.artifacts.append(alerts_json_artifact)
    return result


def compile_strategy(
    strategy,
    firm_key: Optional[str] = None,
    risk_intelligence: Optional[dict] = None,
    recipient_qty: Optional[int] = None,
    recipient_label: Optional[str] = None,
    hmac_secret: Optional[str] = None,
) -> CompilerResult:
    """Compile a StrategyDSL (dict or Pydantic model) to Pine Script v5 artifacts.

    Args:
        strategy: Strategy config dict (from StrategyDSL.model_dump() or raw JSON), or StrategyDSL Pydantic model
        firm_key: Optional firm identifier (e.g., "topstep_50k") for prop overlay
        risk_intelligence: Optional dict with quantum/MC risk estimates.
            Keys: breach_probability, ruin_probability, survival_rate,
            mc_sharpe_p50, quantum_estimate (all optional floats).
            Also accepts governance_label (str) for quantum_estimate annotation.
        recipient_qty: Per-recipient contract count (Track 6 / Pass 2). When set,
            the ATR qty block is annotated with a fixed override comment so the
            Pine artifact reflects the recipient's actual contract allocation.
            When None (default), ATR dynamic sizing is unchanged — backwards compatible.
        recipient_label: Optional human-readable label embedded as Pine comment
            (e.g. "alice_mffu_50k"). Surfaced in artifact header for operator reference.
        hmac_secret: Per-recipient HMAC secret (64-char hex) for Track 8 marker
            collection. Embedded in TradersPost webhook alert payload as "hmac" field.
            When None, no HMAC is injected.

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

    # Deep-Scan #18b P-1 fix — see _compile_archetype_only docstring above.
    # Must run BEFORE the generic indicator scaffold is assembled: archetype
    # recipes are complete Pine scripts on their own, not variable-declaration
    # lines, and wrapping them in a second indicator()/strategy() declaration
    # produces invalid Pine (two top-level declarations in one file).
    _archetype_ind_type = _resolve_archetype_prefix(strategy)
    if _archetype_ind_type is not None:
        return _compile_archetype_only(
            strategy=strategy,
            ind_type=_archetype_ind_type,
            exportability=exportability,
            strategy_name=strategy_name,
            export_type=strategy.get("export_type", "pine_indicator"),
        )

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
            var_name, pine_line = _build_pine_indicator_var(ind_type, params, idx, strategy=strategy)
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

    # Stage 4: Build session filter (W23H.3: pass allowed_entry_windows if present)
    _allowed_windows = strategy.get("allowed_entry_windows") or None
    session_line = _build_session_filter(
        strategy.get("session_filter"),
        allowed_entry_windows=_allowed_windows,
    )

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

    # T6: Inject per-recipient fields into alerts_json metadata.
    # The HMAC secret is persisted in account_strategy_assignments.hmac_secret (migration 0100b).
    # It is also embedded here so downstream consumers (TradersPost webhook, Track 8 collector)
    # can match the originating recipient without a DB lookup.
    if recipient_qty is not None:
        alerts_json["recipient_qty"] = recipient_qty
    if recipient_label:
        alerts_json["recipient_label"] = recipient_label
    if hmac_secret:
        alerts_json["hmac_secret_ref"] = "present"  # Never embed raw secret in alerts_json metadata

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

    # T6: build per-recipient header lines (empty when no recipient context)
    _recipient_header = ""
    if recipient_label:
        _recipient_header += f"// Recipient: {recipient_label}\n"
    if recipient_qty is not None:
        _recipient_header += f"// RecipientQty: {recipient_qty} contracts (profit-tier-aware override)\n"
    if hmac_secret:
        _recipient_header += "// HMACSecretRef: present (embedded in webhook payload — do not share)\n"

    pine_code = f"""//@version=5
indicator("{strategy_name}", overlay=true, max_labels_count=500)

// ─── Inputs ─────────────────────────────────────────────────────
// Auto-generated from StrategyDSL — {strategy.get('description', '')}
// Symbol: {symbol} | Timeframe: {timeframe} | Direction: {strategy.get('direction', 'both')}
{_recipient_header}"""

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
    # T6: Per-recipient qty override injection (Track 6 / Pass 2).
    # When recipient_qty is set, append a Pine variable that overrides qty_final so the
    # recipient's pre-calculated contract count is used instead of ATR dynamic sizing.
    # This is a downstream comment + variable append — it does NOT break existing ATR
    # logic; the qty_final override is declared AFTER the ATR block and shadows it.
    if recipient_qty is not None:
        _hmac_field = f', "hmac": "{hmac_secret}"' if hmac_secret else ""
        pine_code += f"""
// ─── Per-Recipient Override (Track 6 / Pass 2) ─────────────────
// Recipient qty pre-calculated by pine-export-recipient-service (profit-tier-aware).
// Overrides ATR dynamic qty_final for this specific account allocation.
// F-2: qty_final declared as var int in _build_atr_qty_block; := reassignment is valid Pine v5.
qty_final := {recipient_qty}  // recipient-specific contract count
"""
        if hmac_secret:
            pine_code += """
// HMAC secret is embedded in the alert JSON payload (see alert conditions below).
// Do not modify or share this value — it is used by Track 8 marker collection for
// webhook authentication. Regenerate via /api/pine-export/recipient if rotated.
"""
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

        # P0-2/4 in legacy shell — minimal inline versions.
        # P0-3 (event blackout) is NOT reimplemented inline here. deep-scan #22
        # Track Y4 (2026-07-09): this shell previously declared its OWN NFP-only
        # blackout ("nfp_blackout" checked alone) and never called the shared
        # _build_event_blackout_block() helper that compile_dual_artifacts() uses
        # via _build_shared_preamble() — so every strategy_shell artifact emitted
        # by compile_strategy() (the DEFAULT live path: monte-carlo-service.ts,
        # quantum-mc-service.ts, scheduler.ts, strategies.ts, pine-export.ts default
        # branch) shipped to families with NO FOMC/CPI blackout at all, silently
        # violating the CLAUDE.md §13 "Don't trade through FOMC/CPI/NFP" mandate.
        # Fix: call the SAME shared helper compile_dual_artifacts() uses, so this
        # shell carries the identical full FOMC+CPI+NFP macro blackout chain.
        strategy_shell += f"""
{session_line}
long_signal = in_session and ({long_cond})
short_signal = in_session and ({short_cond})

// P0-2: Regime filter
[adx_plus_di, adx_minus_di, adx_val] = ta.dmi(14, 14)
regime_label = adx_val > 25 ? "TRENDING" : adx_val < 20 ? "RANGING" : "MIXED"
regime_match = true  // No preferred_regime in legacy shell — gate disabled
"""
        # P0-3: full FOMC+CPI+NFP event blackout — SAME shared helper as
        # compile_dual_artifacts()'s strategy artifact (deep-scan #22 Y4 fix).
        # Declares fomc_blackout / cpi_blackout / nfp_blackout / event_blackout.
        strategy_shell += _build_event_blackout_block()
        strategy_shell += f"""
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
# Only Topstep (PRIMARY) and MFFU (secondary) are in scope per CLAUDE.md §6.
# Legacy firms (TPT, Apex, FFN, Alpha, Tradeify, Earn2Trade, Top One, YRM Prop,
# FundingPips) were removed from production scope on 2026-05-10 (DB migration
# 0097) and stripped from runtime config on 2026-05-19.
#
# ATS-ALLOWED (full automation):
#   topstep_50k    — ATS via TopstepX API, local-only (Skytech tower)
#   mffu_50k       — ATS via TradersPost / PickMyTrade
ATS_FIRMS: frozenset[str] = frozenset({
    "topstep_50k",
    "mffu_50k",
})

# No active firm requires INDICATOR-only / manual-approval routing.
MANUAL_APPROVAL_FIRMS: frozenset[str] = frozenset()

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


# ──────────────────────────────────────────────────────────────────────────────
# F-1 (Pass 6 / Track A 2026-05-20) — Marker alertcondition contract
# ──────────────────────────────────────────────────────────────────────────────
# Track 8's TradingView Marker Collector lives at POST /api/tradingview/marker.
# It expects a SEPARATE alert from the TradersPost one with these fields:
#   { strategy_id, account_id, bar_timestamp, signal, secret_check }
#
# Pine cannot compute HMAC-SHA256 natively. Instead of trying to inject a
# per-bar HMAC (impossible without a server roundtrip), the compiler embeds
# `secret_check` — a static export-time signature of a FIXED payload:
#   secret_check = HMAC_SHA256(per_account_secret, "{strategy_id}|{account_id}|marker_export")
# This proves the Pine file came from a trusted compile and ties it to a
# specific (account, strategy) pair. The backend (tradingview-webhook.ts) accepts
# the payload, looks up the same secret server-side, recomputes the signature
# and compares constant-time. Replay attacks are bounded by the existing
# 10-minute bar_timestamp window and the unique-index dedupe on
# (account_id, strategy_id, bar_timestamp, signal).
#
# CONTRACT POINTS (any change here MUST update tradingview-webhook.ts in lock-step):
#   - Field names: strategy_id, account_id, bar_timestamp, signal, secret_check
#   - signal encoding: 1 = long entry, -1 = short entry, 0 = exit
#   - bar_timestamp: ISO-8601 from Pine's {{timenow}} placeholder
#   - account_id MUST be the broker_accounts.account_id (UUID), not the
#     family-member label; it is injected at recipient export time.
# ──────────────────────────────────────────────────────────────────────────────

def _build_marker_alertcondition(
    strategy_id: str,
    account_id: Optional[str],
    secret_check: Optional[str],
) -> str:
    """Emit the Track 8 marker alertcondition() block.

    Returns "" when account_id or secret_check are absent (legacy compile path —
    the per-recipient export pipeline supplies both). The block is appended to
    the strategy artifact only; INDICATOR artifacts do not feed the marker
    collector because they require manual approval and have no machine-driven
    fill timing to reconcile against.
    """
    if not account_id or not secret_check:
        return ""
    return f"""
// ─── Marker Alert (Track 8 — POST /api/tradingview/marker) ──────────
// F-1: SEPARATE alertcondition from TradersPost — fires the marker payload
// for the reconciliation collector. secret_check is the export-time signature
// of "{strategy_id}|{account_id}|marker_export" using the per-account HMAC
// secret; backend re-computes it server-side. DO NOT modify message JSON.
alertcondition(
    (strategy.position_size == 0 and long_signal and regime_match and not event_blackout and not anti_setup_blocked) or
    (strategy.position_size == 0 and short_signal and regime_match and not event_blackout and not anti_setup_blocked) or
    (barstate.isconfirmed and strategy.position_size != 0 and (time_to_close or risk_lockout)),
    title="TF Marker",
    message='{{"strategy_id":"{strategy_id}","account_id":"{account_id}","bar_timestamp":' + str.tostring(time) + ',"signal":' + (long_signal ? "1" : short_signal ? "-1" : "0") + ',"secret_check":"{secret_check}"}}'
)
// BUG-5 fix: str.format_time() does not exist in Pine v5. Using str.tostring(time) which
// returns Unix milliseconds (integer). Backend markerPayloadSchema must accept numeric millis
// in addition to ISO-8601 strings for bar_timestamp validation.
"""


# ─── TF-Gateway Payload Contract ─────────────────────────────────────────────
#
# Pass 4 Track A — canonical field order for gateway_mode='tf_gateway'.
#
# When gateway_mode='tf_gateway', Pine alerts fire at /api/live-order (the TF
# Order Gateway) instead of directly at traderspost.io.  This routes every
# alert through routeOrder() and the full gate stack (kill-switch → compliance
# → firm-cap → circuit breaker).
#
# Field contract matches live-order.ts liveOrderPayloadSchema (static-token mode):
#   account_id       — broker_accounts.account_id UUID (supplied by operator at deploy time)
#   strategy_id      — strategies.id UUID (embedded at compile time)
#   live_order_token — account_strategy_assignments.hmac_secret static bearer (per-recipient secret)
#   timestamp_ms     — Pine {{timenow}} placeholder (milliseconds, Unix epoch)
#   bar_timestamp    — Pine {{time}} placeholder (bar-close epoch millis for dedup)
#   action           — "enter_long" | "enter_short" | "exit_long" | "exit_short"
#   ticker           — TradingView continuous contract symbol (e.g. "MES1!")
#
# These MUST stay in sync with live-order.ts liveOrderPayloadSchema.  Any field
# addition here requires a matching Zod schema extension in live-order.ts.
#
# Pine cannot compute HMAC at alert-fire time — static-token mode (per live-order.ts
# §Auth mode B) is the only viable path.  The live_order_token is embedded at
# compile time (operator pastes via TradingView Settings panel, same UX as HMAC secret).
# Dedup guard: bar_timestamp + action uniqueness via live_order_pine_dedup table
# (migration 0170) prevents duplicate alerts from the same bar close.
TF_GATEWAY_PAYLOAD_FIELDS: tuple[str, ...] = (
    "account_id",
    "strategy_id",
    "live_order_token",
    "timestamp_ms",
    "bar_timestamp",
    "action",
    "ticker",
)

# Supported gateway_mode values — any other value raises ValueError at compile time.
_VALID_GATEWAY_MODES: frozenset[str] = frozenset({"tf_gateway", "direct"})


def _build_strategy_webhook_alerts(
    strategy_name: str,
    symbol: str,
    strategy_id: str,
    hmac_input_var: Optional[str] = None,
    gateway_mode: Optional[str] = None,
) -> str:
    """Pine alertcondition() block for STRATEGY artifact.

    gateway_mode controls alert payload destination:

      gateway_mode='tf_gateway' (Pass 4 canonical):
        Emits TF-gateway JSON payload routed to POST /api/live-order.
        Every alert hits routeOrder() → kill-switch → compliance → firm-cap →
        circuit breaker — NO safety gates are bypassed.
        Payload shape: TF_GATEWAY_PAYLOAD_FIELDS (see constant above).
        account_id and live_order_token are operator-supplied at chart load
        via TradingView input.string() panels (same UX as HMAC secret).
        Requires LIVE_ORDER_GATEWAY_URL in .env (set by operator before going live).

      gateway_mode='direct' OR None (backward-compat, legacy):
        Emits TradersPost JSON webhook payload routed directly to traderspost.io.
        WARNING: bypasses kill-switch, compliance gate, firm-cap clamp, and
        TradersPost circuit breaker.  Legacy strategies use this path; new
        strategies should migrate to 'tf_gateway'.

      gateway_mode=<invalid>:
        Raises ValueError immediately — no silent fall-through.

    Alert messages are JSON webhook payloads — configured in TradingView alert
    as "Once Per Bar Close" with the exact JSON shown in each alertcondition().

    Timing: bar-close only.  Repaint risk: NONE — all signals are computed at
    bar close (barstate.isconfirmed guards entry/exit alertconditions).

    BUG-3 fix (direct path): HMAC is injected at GENERATION TIME via
    hmac_input_var (a Pine variable name, e.g. "hmac_input"), not via post-hoc
    string replacement.  Only used for direct path — tf_gateway uses
    live_order_token input instead.
    """
    if gateway_mode is not None and gateway_mode not in _VALID_GATEWAY_MODES:
        raise ValueError(
            f"Invalid gateway_mode '{gateway_mode}'. "
            f"Must be one of: {sorted(_VALID_GATEWAY_MODES)} or None (defaults to 'direct'). "
            "Set config.gateway_mode='tf_gateway' for the canonical Pass 4 path."
        )

    tv_symbol = _TV_SYMBOL_MAP.get(symbol, f"{symbol}1!")

    # Pass 4 Track A — TF-gateway path.
    # When gateway_mode='tf_gateway', emit TF-gateway JSON payload routed to
    # POST /api/live-order instead of directly to traderspost.io.
    # Operator supplies account_id and live_order_token via TradingView
    # input.string() panels at chart-load time (same UX as HMAC secret).
    # Pine {{timenow}} and {{time}} are TradingView placeholders resolved at
    # alert-fire time — NOT Pine variables. Do NOT use str.tostring() here.
    if gateway_mode == "tf_gateway":
        return f"""
// ─── Webhook Alerts (STRATEGY path — TF Gateway, Pass 4 canonical) ─
// Route: Pine alert → POST /api/live-order → routeOrder() → TradersPost
// EVERY alert passes through: kill-switch → compliance → firm-cap → circuit breaker.
// REQUIRED: Configure each alert with "Once Per Bar Close" + TF gateway webhook URL.
// REQUIRED: Paste your account_id and live_order_token into the Settings panel.
//
// TF_GATEWAY_PAYLOAD_FIELDS (canonical order): {list(TF_GATEWAY_PAYLOAD_FIELDS)}
// Field contract: live-order.ts liveOrderPayloadSchema (static-token mode).
// {{{{timenow}}}} and {{{{time}}}} are TradingView alert-message placeholders —
//   timenow = alert-fire Unix millis (timestamp_ms replay guard)
//   time    = bar-close Unix millis (bar_timestamp dedup key via live_order_pine_dedup)
// live_order_token: static bearer = account_strategy_assignments.hmac_secret
//   Operator pastes token into TradingView Settings panel (never embedded in .pine).
//   Backend validates via DB lookup + constant-time compare (live-order.ts §Auth B).
// DEGRADATION: Pine cannot compute per-bar HMAC — static-token mode is the only
//   viable Pine auth path. Replay guard: 2-min timestamp_ms window + bar-close dedup.
account_id_input = input.string("", title="Account ID (UUID from operator)", confirm=true)
live_order_token_input = input.string("", title="Live Order Token (from operator)", confirm=true)

alertcondition(barstate.isconfirmed and strategy.position_size == 0 and long_signal and regime_match and not event_blackout and not anti_setup_blocked, title="TFG Long Entry",
    message='{{"account_id":"' + account_id_input + '","strategy_id":"{strategy_id}","live_order_token":"' + live_order_token_input + '","timestamp_ms":"{{{{timenow}}}}","bar_timestamp":"{{{{time}}}}","action":"enter_long","ticker":"{tv_symbol}"}}')
alertcondition(barstate.isconfirmed and strategy.position_size == 0 and short_signal and regime_match and not event_blackout and not anti_setup_blocked, title="TFG Short Entry",
    message='{{"account_id":"' + account_id_input + '","strategy_id":"{strategy_id}","live_order_token":"' + live_order_token_input + '","timestamp_ms":"{{{{timenow}}}}","bar_timestamp":"{{{{time}}}}","action":"enter_short","ticker":"{tv_symbol}"}}')
// PARITY NOTE: Exit alertconditions guarded with barstate.isconfirmed so they fire at
// bar close — matching INDICATOR artifact state-machine exit timing.
alertcondition(barstate.isconfirmed and strategy.position_size > 0 and (low <= strategy.position_avg_price - stop_distance or (use_target and high >= strategy.position_avg_price + target_distance)), title="TFG Long Exit",
    message='{{"account_id":"' + account_id_input + '","strategy_id":"{strategy_id}","live_order_token":"' + live_order_token_input + '","timestamp_ms":"{{{{timenow}}}}","bar_timestamp":"{{{{time}}}}","action":"exit_long","ticker":"{tv_symbol}"}}')
alertcondition(barstate.isconfirmed and strategy.position_size < 0 and (high >= strategy.position_avg_price + stop_distance or (use_target and low <= strategy.position_avg_price - target_distance)), title="TFG Short Exit",
    message='{{"account_id":"' + account_id_input + '","strategy_id":"{strategy_id}","live_order_token":"' + live_order_token_input + '","timestamp_ms":"{{{{timenow}}}}","bar_timestamp":"{{{{time}}}}","action":"exit_short","ticker":"{tv_symbol}"}}')
// Risk lockout and time-stop: exit_long/exit_short based on current position direction.
alertcondition(risk_lockout and not risk_lockout[1] and strategy.position_size != 0, title="TFG Risk Lockout",
    message='{{"account_id":"' + account_id_input + '","strategy_id":"{strategy_id}","live_order_token":"' + live_order_token_input + '","timestamp_ms":"{{{{timenow}}}}","bar_timestamp":"{{{{time}}}}","action":strategy.position_size > 0 ? "exit_long" : "exit_short","ticker":"{tv_symbol}"}}')
// F-1: Time-stop alert (15:55 ET) — gateway exit.
alertcondition(time_to_close and strategy.position_size != 0, title="TFG Time Stop 15:55 ET",
    message='{{"account_id":"' + account_id_input + '","strategy_id":"{strategy_id}","live_order_token":"' + live_order_token_input + '","timestamp_ms":"{{{{timenow}}}}","bar_timestamp":"{{{{time}}}}","action":strategy.position_size > 0 ? "exit_long" : "exit_short","ticker":"{tv_symbol}"}}')
"""

    # Direct path (backward-compat): emit TradersPost JSON payload routed directly
    # to traderspost.io. WARNING: bypasses kill-switch, compliance gate, firm-cap
    # clamp, and TradersPost circuit breaker. Legacy path — migrate to tf_gateway.

    # BUG-3 fix: build the HMAC suffix inline at generation time.
    # When hmac_input_var is set (e.g. "hmac_input"), entry alerts append:
    #   ', "hmac": ' + hmac_input
    # before the closing `}}'.  Pine v5 string concat with + is valid here.
    # Exit/cancel alerts do NOT carry HMAC — they don't need per-recipient identity.
    if hmac_input_var:
        hmac_suffix_entry = f' + \',"hmac":"\' + {hmac_input_var} + \'"'
        hmac_note = (
            "// F-4/BUG-3: HMAC appended via Pine string concat — hmac_input variable\n"
            "// is declared as input.string() above (user pastes at chart load).\n"
        )
    else:
        hmac_suffix_entry = ""
        hmac_note = ""

    return f"""
// ─── Webhook Alerts (STRATEGY path — TradersPost ATS) ──────────────
// Configure each alert with "Once Per Bar Close" + webhook URL.
// TradersPost routes directly to your broker — NO manual approval.
// REQUIRED: Set alert message to exactly this JSON (do not modify).
// WARNING (Pass 4): direct path bypasses TF kill-switch + compliance gate +
// firm-cap clamp + TradersPost circuit breaker. Migrate to gateway_mode='tf_gateway'.
// FIX 2: alertcondition predicates include all three gates —
// regime_match, not event_blackout, not anti_setup_blocked.
// F-12: quantity now carries str.tostring(qty_final) — dynamic ATR-scaled / recipient-
// overridden contract count replaces the previous hardcoded quantity:1.
// alertcondition() message supports Pine string concatenation; qty_final is an int series
// declared as var int above (F-2), so str.tostring(qty_final) is always valid Pine v5.
// If TradersPost ignores the quantity field, set contract size in TradersPost account config
// as a fallback — but the preferred path is quantity in the webhook payload.
{hmac_note}alertcondition(barstate.isconfirmed and strategy.position_size == 0 and long_signal and regime_match and not event_blackout and not anti_setup_blocked, title="TP Long Entry",
    message='{{"action":"buy","symbol":"{tv_symbol}","quantity":' + str.tostring(qty_final) + ',"stopLoss":' + str.tostring(close - stop_distance) + ',"takeProfit":' + str.tostring(use_target ? close + target_distance : na) + ',"strategyId":"{strategy_id}"{hmac_suffix_entry}}}')
alertcondition(barstate.isconfirmed and strategy.position_size == 0 and short_signal and regime_match and not event_blackout and not anti_setup_blocked, title="TP Short Entry",
    message='{{"action":"sell","symbol":"{tv_symbol}","quantity":' + str.tostring(qty_final) + ',"stopLoss":' + str.tostring(close + stop_distance) + ',"takeProfit":' + str.tostring(use_target ? close - target_distance : na) + ',"strategyId":"{strategy_id}"{hmac_suffix_entry}}}')
// PARITY NOTE: Exit alertconditions guarded with barstate.isconfirmed so they fire at
// bar close — matching INDICATOR artifact state-machine exit timing.  Without this guard,
// strategy.position_avg_price is evaluated intrabar and can fire on wicks that recover by
// close, diverging from the INDICATOR bar-close exit.  Net P&L will still differ on bars
// where the stop is breached intrabar AND price does not recover: strategy.exit() fills at
// the stop price intrabar; INDICATOR exits at bar close.  That is an unavoidable Pine
// strategy() vs indicator() semantic gap — alertcondition timing is now consistent.
alertcondition(barstate.isconfirmed and strategy.position_size > 0 and (low <= strategy.position_avg_price - stop_distance or (use_target and high >= strategy.position_avg_price + target_distance)), title="TP Long Exit",
    message='{{"action":"exit","symbol":"{tv_symbol}","strategyId":"{strategy_id}"}}')
alertcondition(barstate.isconfirmed and strategy.position_size < 0 and (high >= strategy.position_avg_price + stop_distance or (use_target and low <= strategy.position_avg_price - target_distance)), title="TP Short Exit",
    message='{{"action":"exit","symbol":"{tv_symbol}","strategyId":"{strategy_id}"}}')
alertcondition(risk_lockout and not risk_lockout[1], title="TP Risk Lockout",
    message='{{"action":"cancel","symbol":"{tv_symbol}","strategyId":"{strategy_id}","note":"RISK_LOCKOUT"}}')
// F-1: Time-stop alert (15:55 ET) — also fires for TradersPost exit routing.
alertcondition(time_to_close and strategy.position_size != 0, title="TP Time Stop 15:55 ET",
    message='{{"action":"exit","symbol":"{tv_symbol}","strategyId":"{strategy_id}","note":"TIME_STOP_1555_ET"}}')
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
// F-7: Single ATR series shared by both stop sizing and qty sizing (atr_val).
//      atr_qty_period input removed — qty uses same atr_val already declared above.
//      This prevents stop ATR and sizing ATR from diverging when ATR swings mid-session.
target_risk_usd = input.float(200.0, "Target Risk Per Trade ($)", minval=10.0, step=10.0)
firm_max_contracts = {firm_cap}
// pointvalue: dollar value per 1-point move (MES=$5, MNQ=$2, ES=$50, NQ=$20)
contracts_atr = atr_val > 0 ? math.max(1, math.floor(target_risk_usd / (atr_val * syminfo.pointvalue))) : 1
// F-2: Declare qty_final as var int so recipient override via := is valid Pine v5.
// recipient_qty_override injected below (0 = no override, use ATR dynamic sizing).
var int qty_final = 0
qty_final := math.min(contracts_atr, firm_max_contracts)
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
// F-3: Corrected window — was 8:00-9:00 (full hour), now 8:30-9:00 (post-release cool-off only).
// Matches CPI window style; pre-8:30 trading on NFP Friday is not restricted.
nfp_blackout = (dayofmonth <= 7 and dayofweek == dayofweek.friday and hour == 8 and minute >= 30)

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
    # F-1: 15:55 ET time-stop variable (shared; close_all/alert injected per-artifact)
    code += _build_time_stop_block()
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
        + _build_indicator_time_stop_alert(strategy_name, strategy_id, symbol)  # F-1: 15:55 ET alert
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
    hmac_input_var: Optional[str] = None,
    gateway_mode: Optional[str] = None,
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
    # BUG-3 fix: pass hmac_input_var so HMAC is emitted at generation time in the alert message,
    # not via post-hoc string replacement which produced invalid Pine v5 syntax.
    return (
        header
        + shared_preamble
        + _build_strategy_risk_tracking()
        + entry_exit_block
        + _build_strategy_time_stop_close()          # F-1: 15:55 ET hard flatten
        + _build_strategy_webhook_alerts(strategy_name, symbol, strategy_id, hmac_input_var=hmac_input_var, gateway_mode=gateway_mode)
        + _build_visualization()
    )


def _compile_dual_archetype_only(
    strategy: dict,
    ind_type: str,
    exportability: ExportabilityResult,
    strategy_name: str,
    safe_name: str,
    strategy_id: Optional[str],
    account_id: Optional[str],
    live_order_token: Optional[str],
) -> "DualArtifactResult":
    """compile_dual_artifacts() counterpart of the Deep-Scan #18b P-1 fix.

    See the module note above _compile_archetype_only for the two-declaration
    bug this closes. Only ONE Pine artifact is produced (indicator_artifact,
    populated with the archetype recipe VERBATIM) — archetype recipes are
    indicator()-based passive markers with no faithful strategy()/ATS
    equivalent (Pine cannot reproduce the Python engine's structural
    detection, Style C exits, or the 11-factor confluence gate). strategy_artifact
    is left None — an explicit, documented degradation (degradation_notes),
    NOT a fabricated shell (fake equivalence is forbidden).

    Callers must invoke this AFTER any account_id/live_order_token credential
    injection into strategy["config"] (compile_dual_artifacts does this before
    Stage 2) so _build_pine_indicator_var() substitutes real tf_gateway
    credentials rather than leaving literal placeholders.
    """
    sid = strategy_id or hashlib.sha256(strategy_name.encode()).hexdigest()[:16]
    result = DualArtifactResult(exportability=exportability, strategy_name=strategy_name)

    key = ind_type.split(":", 1)[1] if ":" in ind_type else ind_type
    _config = strategy.get("config", {})
    gateway_mode = _config.get("gateway_mode") if isinstance(_config, dict) else None

    # _build_pine_indicator_var() returns the COMPLETE, self-contained archetype
    # Pine script for this ind_type (with compile-time credential substitution
    # applied when strategy["config"] carries account_id/live_order_token) —
    # emitted here VERBATIM as the sole Pine artifact.
    _, pine_code = _build_pine_indicator_var(ind_type, {}, 0, strategy=strategy)

    result.content_hash = hashlib.sha256(pine_code.encode()).hexdigest()
    result.indicator_artifact = PineArtifact(
        artifact_type="dual_indicator",
        file_name=f"{safe_name}_INDICATOR.pine",
        content=pine_code,
        size_bytes=len(pine_code.encode()),
    )
    alerts_json = _build_archetype_alerts_json(strategy_name, key, gateway_mode)
    alerts_json["strategy_id"] = sid
    result.alerts_artifact = PineArtifact(
        artifact_type="dual_alerts_json",
        file_name=f"{safe_name}_dual_alerts.json",
        content=json.dumps(alerts_json, indent=2),
        size_bytes=len(json.dumps(alerts_json).encode()),
    )
    result.indicator_firms = list(MANUAL_APPROVAL_FIRMS)
    result.strategy_firms = []
    result.degradation_notes.append(
        f"archetype_strategy_alert_only: entry_indicator '{ind_type}' is a structural "
        "archetype — Pine is a passive marker + alertcondition emitter only (Python "
        "engine at src/engine/strategies/<class>.py owns entry/exit). No strategy_artifact "
        "(ATS/TradersPost) is produced: Pine's strategy() cannot faithfully reproduce the "
        "archetype's server-side structural detection, Style C exits, or the 11-factor "
        "confluence gate. See exportability.deductions for the full list of dropped features."
    )

    # Post-compile assertion — fail-CLOSED placeholder substitution guard.
    # Identical contract to the generic dual-artifact path: when both
    # credentials were provided (compile-time substitution path), the emitted
    # Pine MUST NOT contain the literal placeholder strings.
    if account_id and live_order_token:
        _unsubstituted = []
        if "<account-id-placeholder>" in pine_code:
            _unsubstituted.append("account_id (<account-id-placeholder>)")
        if "<live-order-token-placeholder>" in pine_code:
            _unsubstituted.append("live_order_token (<live-order-token-placeholder>)")
        if _unsubstituted:
            raise PineCompileError(
                f"placeholder substitution failed for: {', '.join(_unsubstituted)}. "
                "gatewayOptions were provided but the compiled archetype Pine artifact "
                "still contains literal placeholder strings. This would cause silent "
                "order drops via /api/live-order."
            )

    return result


def compile_dual_artifacts(
    strategy,
    firm_key: Optional[str] = None,
    risk_intelligence: Optional[dict] = None,
    strategy_id: Optional[str] = None,
    recipient_qty: Optional[int] = None,
    recipient_label: Optional[str] = None,
    hmac_secret: Optional[str] = None,
    account_id: Optional[str] = None,
    live_order_token: Optional[str] = None,
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
    _timeframe = strategy.get("timeframe", "5m")
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

    # Compile-time credential injection — hardening/phase-0 fix.
    # When account_id and live_order_token are provided, inject them into
    # strategy["config"] so that _build_pine_indicator_var() can read them
    # and pass them to _build_archetype_alert_pine() for compile-time substitution.
    # This ensures the tf_gateway archetype path emits real credentials instead of
    # literal placeholders, eliminating the operator-manual text-replace step that
    # caused silent order drops when skipped.
    # The config sub-dict is mutated on a local copy only — the caller's strategy
    # dict is not modified (strategy is already a plain dict at this point, having
    # been normalized from Pydantic above).
    if account_id or live_order_token:
        _existing_config = strategy.get("config", {})
        if not isinstance(_existing_config, dict):
            _existing_config = {}
        _merged_config = dict(_existing_config)
        if account_id:
            _merged_config["account_id"] = account_id
        if live_order_token:
            _merged_config["live_order_token"] = live_order_token
        strategy = dict(strategy)
        strategy["config"] = _merged_config

    # Deep-Scan #18b P-1 fix — see _compile_dual_archetype_only docstring above.
    # Must run AFTER the credential injection block above (so tf_gateway
    # account_id/live_order_token are already merged into strategy["config"]
    # for _build_pine_indicator_var() to substitute) and BEFORE the generic
    # indicator scaffold is assembled (archetype recipes are complete Pine
    # scripts on their own — wrapping them in a second indicator()/strategy()
    # declaration produces invalid Pine with two top-level declarations).
    _archetype_ind_type = _resolve_archetype_prefix(strategy)
    if _archetype_ind_type is not None:
        return _compile_dual_archetype_only(
            strategy=strategy,
            ind_type=_archetype_ind_type,
            exportability=exportability,
            strategy_name=strategy_name,
            safe_name=safe_name,
            strategy_id=strategy_id,
            account_id=account_id,
            live_order_token=live_order_token,
        )

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
        # archetype: and uncatalogued: prefixes are handled by _build_pine_indicator_var
        # via ARCHETYPE_PINE_RECIPE / ARCHETYPE_PINE_RECIPE_TF_GATEWAY — NOT by INDICATOR_MAP.
        # Skip the INDICATOR_MAP check for these prefixes to avoid false unsupported reports.
        if _ind_type.startswith("archetype:") or _ind_type.startswith("uncatalogued:"):
            continue
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
            var_name, pine_line = _build_pine_indicator_var(ind_type, params, idx, strategy=strategy)
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

    # Stage 4: Session filter (shared, W23H.3: pass allowed_entry_windows if present)
    _allowed_windows_2 = strategy.get("allowed_entry_windows") or None
    session_line = _build_session_filter(
        strategy.get("session_filter"),
        allowed_entry_windows=_allowed_windows_2,
    )

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

    # T6: Per-recipient header comment lines (prepended to both artifacts).
    _recip_comments = ""
    if recipient_label:
        _recip_comments += f"// Recipient      : {recipient_label}\n"
    if recipient_qty is not None:
        _recip_comments += f"// Recipient Qty  : {recipient_qty} contracts (profit-tier-aware)\n"
    if hmac_secret:
        _recip_comments += "// HMAC           : present — embedded in strategy webhook payload\n"

    # T6: Per-recipient qty override block appended to shared preamble for both artifacts.
    # F-2: qty_final is declared as `var int qty_final = 0` in _build_atr_qty_block above,
    # so this := reassignment is valid Pine v5 (no re-declaration needed).
    _recip_qty_block = ""
    if recipient_qty is not None:
        _recip_qty_block = f"""
// ─── Per-Recipient Qty Override (Track 6) ───────────────────────────────
// Profit-tier-aware contract count pre-calculated by pine-export-recipient-service.
// F-2: qty_final already declared as var int above; := is valid Pine v5.
qty_final := {recipient_qty}
"""
        if hmac_secret:
            _recip_qty_block += """// HMAC embedded in TradersPost webhook action payload (see alertcondition below).
"""

    # Stage 7a: INDICATOR artifact
    indicator_code = _build_indicator_artifact(
        strategy_name=strategy_name,
        symbol=symbol,
        strategy_id=sid,
        shared_preamble=shared,
    )
    # T6: Inject recipient metadata into indicator artifact
    if _recip_comments:
        indicator_code = indicator_code.replace(
            f'indicator("{strategy_name}"', _recip_comments + f'indicator("{strategy_name}"', 1
        )
    if _recip_qty_block:
        indicator_code += _recip_qty_block

    # Stage 7b: STRATEGY artifact (commission from firm_key)
    commission = 0.62
    if firm_key:
        commission = FIRM_COMMISSIONS.get(firm_key, {}).get(symbol, 0.62)

    # F6: Flag strategy artifact as prohibited when firm does not allow automated trading.
    # The artifact is still emitted (informational) but carries a machine-readable header flag
    # so callers and UIs can surface a hard warning and prevent accidental TradersPost setup.
    manual_approval_firm = firm_key in MANUAL_APPROVAL_FIRMS

    # BUG-3 fix: pass hmac_input_var at GENERATION TIME so HMAC concat is emitted inline
    # in alertcondition messages via _build_strategy_webhook_alerts — eliminates the broken
    # post-hoc str.replace approach which produced invalid Pine v5 syntax.
    # When hmac_secret is present, alert messages reference `hmac_input` directly via Pine + concat.
    _hmac_input_var_name: Optional[str] = "hmac_input" if hmac_secret else None

    # Pass 4 Track A — gateway_mode resolution.
    # Read from strategy.config.gateway_mode (sub-dict on the strategy DSL object).
    # 'tf_gateway'  → emit TF-gateway payload routed through /api/live-order (canonical).
    # 'direct'/None → emit TradersPost direct payload (backward-compat, legacy path).
    # Invalid value  → ValueError raised inside _build_strategy_webhook_alerts.
    _strategy_config: dict = strategy.get("config", {}) if isinstance(strategy.get("config"), dict) else {}
    _gateway_mode: Optional[str] = _strategy_config.get("gateway_mode")

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
        hmac_input_var=_hmac_input_var_name,
        gateway_mode=_gateway_mode,
    )
    # T6: Inject recipient metadata and qty override into strategy artifact
    if _recip_comments:
        strategy_code = strategy_code.replace(
            f'strategy("{strategy_name}"', _recip_comments + f'strategy("{strategy_name}"', 1
        )
    if _recip_qty_block:
        strategy_code += _recip_qty_block

    # F-4: HMAC secret handling — use input.string() so secret is NEVER embedded in .pine file.
    # The input.string() declaration is injected ONCE into the strategy artifact header.
    # alertcondition() messages reference hmac_input via Pine string concat (BUG-3 fix —
    # now done at generation time in _build_strategy_webhook_alerts, not via str.replace).
    # HMAC is returned out-of-band in the recipient export response (hmac_secret field in
    # RecipientExportResult metadata) and in alerts_json.hmac_out_of_band — NOT embedded here.
    if hmac_secret:
        # Inject input.string() declaration at the top of strategy artifact (after header comment block).
        # hmac_input is the Pine variable name referenced in alertcondition messages.
        hmac_input_decl = (
            "\n// F-4: HMAC secret input — paste your HMAC into TradingView Settings panel.\n"
            "// DO NOT embed the secret directly in this file. Delivered out-of-band.\n"
            'hmac_input = input.string("", title="HMAC Secret (paste from operator)", confirm=true)\n'
        )
        # Insert after the strategy() declaration (before shared preamble body)
        strategy_code = strategy_code.replace(
            "// Generated by Trading Forge Pine Compiler v5\n",
            "// Generated by Trading Forge Pine Compiler v5\n" + hmac_input_decl,
            1,
        )

    # F-1 (Pass 6 / Track A 2026-05-20): emit Track 8 marker alertcondition.
    # Computed export-time signature ties the Pine file to (account, strategy).
    # The backend recomputes the same signature on receipt — proves origin.
    # Only emitted when both account_id (recipient) AND hmac_secret are present.
    # Legacy compiles without recipient metadata silently skip the marker
    # alertcondition (no-op) so the existing pine_strategy export path is
    # unchanged for non-recipient compiles.
    if account_id and hmac_secret:
        import hmac as _hmac_mod  # local import — keep top-of-file imports unchanged
        # F-10: canonical export string sourced from src/engine/marker_contract.py
        # (mirrored in src/shared/marker-contract.ts). NEVER inline the format here.
        _secret_check = _hmac_mod.new(
            hmac_secret.encode("utf-8"),
            _marker_build_export_canonical(sid, account_id).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        _marker_block = _build_marker_alertcondition(
            strategy_id=sid,
            account_id=account_id,
            secret_check=_secret_check,
        )
        if _marker_block:
            strategy_code += _marker_block

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

    # T6: Inject per-recipient fields into dual alerts_json metadata.
    if recipient_qty is not None:
        alerts_json["recipient_qty"] = recipient_qty
        # Embed qty into the sample_payload for downstream automation clarity
        alerts_json["delivery_paths"]["strategy"]["sample_payload"]["quantity"] = recipient_qty
    if recipient_label:
        alerts_json["recipient_label"] = recipient_label
    if hmac_secret:
        # F-4: HMAC is delivered OUT-OF-BAND — NOT embedded in the .pine file.
        # The .pine file uses input.string() so operator pastes HMAC at chart load.
        # The actual secret is recorded here in alerts_json for the operator's reference
        # but is NOT in the Pine artifact content.
        alerts_json["hmac_out_of_band"] = hmac_secret  # operator copies this to TradingView Settings
        alerts_json["hmac_secret_ref"] = "input_string_at_chart_load"
        alerts_json["delivery_paths"]["strategy"]["sample_payload"]["hmac"] = "<paste_from_hmac_out_of_band>"

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

    # Post-compile assertion — fail-CLOSED placeholder substitution guard.
    # When account_id AND live_order_token were provided (compile-time substitution
    # path), the emitted Pine MUST NOT contain the literal placeholder strings.
    # If either placeholder survives, the credential injection silently failed and
    # the artifact would route to /api/live-order with literal placeholder values —
    # causing a silent order drop.
    #
    # When neither credential was provided (legacy operator-manual path), literal
    # placeholders survive intentionally — operator substitutes at TV deploy time.
    # No assertion is raised in that case.
    if account_id and live_order_token:
        _check_pine = (
            (result.indicator_artifact.content if result.indicator_artifact else "")
            + (result.strategy_artifact.content if result.strategy_artifact else "")
        )
        _unsubstituted = []
        if "<account-id-placeholder>" in _check_pine:
            _unsubstituted.append("account_id (<account-id-placeholder>)")
        if "<live-order-token-placeholder>" in _check_pine:
            _unsubstituted.append("live_order_token (<live-order-token-placeholder>)")
        if _unsubstituted:
            raise PineCompileError(
                f"placeholder substitution failed for: {', '.join(_unsubstituted)}. "
                "gatewayOptions were provided but the compiled Pine artifact still contains "
                "literal placeholder strings. This would cause silent order drops via "
                "/api/live-order. Check that strategy.config.account_id and "
                "strategy.config.live_order_token were injected before indicator dispatch."
            )

    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Compile StrategyDSL to Pine Script v5")
    parser.add_argument("--input-json", required=True, help="Strategy JSON (inline or file path)")
    parser.add_argument("--firm-key", default=None, help="Firm key for prop overlay (e.g., topstep_50k)")
    parser.add_argument("--dual", action="store_true", help="Emit dual artifacts (indicator + strategy)")
    parser.add_argument("--strategy-id", type=str, default=None, help="DB UUID of strategy — embedded in TradersPost webhook payloads")
    # BUG-10 fix: --print-summary truncates artifact content for human-readable CLI inspection.
    # Without this flag, full artifact content is emitted to stdout for the TS subprocess to parse.
    parser.add_argument("--print-summary", action="store_true", help="Truncate artifact content to 500 chars for interactive CLI inspection. Never use in subprocess mode.")
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
    # T6: Per-recipient params read from config JSON (injected by pine-export-recipient-service.ts)
    recipient_qty: Optional[int] = config.get("recipient_qty")
    recipient_label: Optional[str] = config.get("recipient_label")
    hmac_secret: Optional[str] = config.get("hmac_secret")
    # BUG-1 fix: read account_id from config so marker alertcondition block is emitted
    account_id: Optional[str] = config.get("account_id")
    # hardening/phase-0: read live_order_token from config (injected by pine-export-service.ts)
    # for compile-time substitution in tf_gateway archetype Pine artifacts.
    live_order_token: Optional[str] = config.get("live_order_token")

    if args.dual:
        dual_result = compile_dual_artifacts(
            strategy, firm_key,
            risk_intelligence=risk_intelligence,
            strategy_id=args.strategy_id,
            recipient_qty=recipient_qty,
            recipient_label=recipient_label,
            hmac_secret=hmac_secret,
            account_id=account_id,
            live_order_token=live_order_token,
        )
        output = dual_result.model_dump()
        # BUG-10 fix: truncation is CLI/print-summary only — NEVER applied to the default
        # JSON output consumed by the TS subprocess.  Unconditional truncation was cutting
        # artifact content to 500 chars before the TS caller received it, causing empty/broken
        # Pine artifacts to be persisted to the DB.
        # Only truncate when --print-summary flag is supplied (interactive CLI inspection).
        if getattr(args, "print_summary", False):
            for field in ("indicator_artifact", "strategy_artifact", "alerts_artifact"):
                art = output.get(field)
                if art and len(art.get("content", "")) > 500:
                    art["content"] = art["content"][:500] + f"... [{len(art['content'])} chars total]"
    else:
        result = compile_strategy(
            strategy, firm_key,
            risk_intelligence=risk_intelligence,
            recipient_qty=recipient_qty,
            recipient_label=recipient_label,
            hmac_secret=hmac_secret,
        )
        output = result.model_dump()
        # BUG-10 fix: same guard for single-artifact path
        if getattr(args, "print_summary", False):
            for art in output.get("artifacts", []):
                content = art.get("content", "")
                if len(content) > 500:
                    art["content"] = content[:500] + f"... [{len(content)} chars total]"

    print(json.dumps(output, indent=2))
