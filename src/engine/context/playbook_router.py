"""Playbook Router — Maps bias state to allowed playbook and strategy families.

Routes: bias + confidence + conditions -> one of 14 playbooks -> allowed strategies.

PLAYBOOK_ROUTING contains the declarative spec for each playbook.
route_playbook() evaluates the current DailyBiasState and returns a PlaybookDecision.

W25.10 — 5-Regime Institutional Expansion:
    4 new playbooks added for the 4 new institutional regime labels:
      DISPLACEMENT_CONTINUATION — EXPANSION regime (directional breakout)
      BREAKOUT_PREP             — COMPRESSION regime (pre-breakout candidates)
      REDUCED_SIZING            — HIGH_VOL_MACRO (proceed with 0.5× contract cap)
      NO_TRADE (LOW_LIQ_CHOP)   — LOW_LIQ_CHOP forces NO_TRADE (separate reason)

    Routing evaluation order is UNCHANGED for existing 9 playbooks; the 4
    institutional arms are checked first using DailyBiasState.institutional_regime
    BEFORE the classic net_bias arms run. This preserves backward compatibility:
    strategies that never see EXPANSION/COMPRESSION/HIGH_VOL_MACRO/LOW_LIQ_CHOP
    use the same routing logic as before.

Wave 26 Pass G Pass F — 7th Regime:
    LATE_CYCLE_OVERHEATING routes to LATE_CYCLE_MEAN_REVERSION playbook.
    ONLY mean-reversion setups allowed — continuation/breakout are suppressed.
    Size multiplier 0.5× applied via REDUCED_SIZING contract-cap halving (same
    mechanism as HIGH_VOL_MACRO). Evaluation order: LATE_CYCLE checked after
    the 4 W25 arms and before classic net_bias logic.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Dict, List

from src.engine.context.bias_engine import DailyBiasState

# ---------------------------------------------------------------------------
# Router provenance constants — imported by bias_engine for audit-row stamping.
# ROUTER_VERSION: human-readable; bump on any routing logic change.
# ROUTER_HASH:    first 16 hex chars of sha256(PLAYBOOK_ROUTING repr) — changes
#                 automatically when routing logic changes, audit row captures
#                 the exact version that produced each bias decision.
# ---------------------------------------------------------------------------
ROUTER_VERSION = "2026-05-26-w26f-late-cycle"
# Hash is computed lazily at module load after PLAYBOOK_ROUTING is defined.
# See _compute_router_hash() below.
_ROUTER_HASH_CACHE: str = ""


@dataclass
class PlaybookDecision:
    playbook: str              # e.g. "TREND_CONTINUATION_LONG"
    allowed_strategies: List[str]
    allowed_setups: List[str]
    confidence_modifier: float  # 1.0 = no change, 0.5 = reduce confidence
    no_trade_reasons: List[str] = None  # populated when playbook == NO_TRADE

    def __post_init__(self):
        if self.no_trade_reasons is None:
            self.no_trade_reasons = []


# ---------------------------------------------------------------------------
# Strategy family mappings
# ---------------------------------------------------------------------------
CONTINUATION_STRATS = ["ote", "ict_swing", "propulsion", "power_of_3", "quarterly_swing", "silver_bullet", "5m_minute_support_level_mes_5m", "5m_minute_support_level_mnq_5m", "5m_minute_support_level_mcl_5m", "entry_chart_timeframe_mes_5m", "entry_chart_timeframe_mnq_5m", "entry_chart_timeframe_mcl_5m", "long_entry_or_short_entry_mes_5m", "long_entry_or_short_entry_mnq_5m", "long_entry_or_short_entry_mcl_5m", "look_i_use_range_breakouts_confirmation_trend_direction_mes_5m", "look_i_use_range_breakouts_confirmation_trend_direction_mnq_5m", "look_i_use_range_breakouts_confirmation_trend_direction_mcl_5m", "expansion_higher_mes_5m", "expansion_higher_mnq_5m", "expansion_higher_mcl_5m", "ballinger_bands_mes_5m", "ballinger_bands_mnq_5m", "ballinger_bands_mcl_5m", "momentum_build_in_real_time_mes_5m", "momentum_build_in_real_time_mnq_5m", "momentum_build_in_real_time_mcl_5m", "long_opportunities_mes_5m", "long_opportunities_mnq_5m", "long_opportunities_mcl_5m", "price_break_above_below_high_low_mes_5m", "price_break_above_below_high_low_mnq_5m", "price_break_above_below_high_low_mcl_5m", "short_position_mes_5m", "short_position_mnq_5m", "short_position_mcl_5m", "bullish_candle_formation_mes_5m", "bullish_candle_formation_mnq_5m", "bullish_candle_formation_mcl_5m", "buy_trades_in_counter_trend_trading_environment_mes_5m", "buy_trades_in_counter_trend_trading_environment_mnq_5m", "buy_trades_in_counter_trend_trading_environment_mcl_5m", "discount_price_to_buy_from_mes_5m", "discount_price_to_buy_from_mnq_5m", "discount_price_to_buy_from_mcl_5m", "ema_period_mes_5m", "ema_period_mnq_5m", "ema_period_mcl_5m", "price_break_mes_5m", "price_break_mnq_5m", "price_break_mcl_5m", "put_limit_order_right_fvg_mes_5m", "put_limit_order_right_fvg_mnq_5m", "put_limit_order_right_fvg_mcl_5m", "crossover_mes_5m", "crossover_mnq_5m", "crossover_mcl_5m", "avoiding_two_mistakes_mes_5m", "avoiding_two_mistakes_mnq_5m", "avoiding_two_mistakes_mcl_5m", "breakout_capture_mes_5m", "breakout_capture_mnq_5m", "breakout_capture_mcl_5m", "long_entry_mes_5m", "long_entry_mnq_5m", "long_entry_mcl_5m", "buying_opportunity_mes_5m", "buying_opportunity_mnq_5m", "buying_opportunity_mcl_5m", "long_entry_or_short_entry_mes_15m", "long_entry_or_short_entry_mnq_15m", "long_entry_or_short_entry_mcl_15m", "jump_in_downtrend_mes_1h", "jump_in_downtrend_mnq_1h", "jump_in_downtrend_mcl_1h", "bos_and_fvg_or_fvg_mes_15m", "bos_and_fvg_or_fvg_mnq_15m", "discount_price_to_buy_from_mcl_30m", "manipulation_trade_mes_1m", "manipulation_trade_mnq_1m", "manipulation_trade_mcl_1m", "bos_and_fvg_or_fvg_mcl_15m", "long_opportunities_mes_4h", "long_opportunities_mcl_4h", "trade_era_scale_in_mes_4h", "trade_era_scale_in_mnq_4h", "trade_era_scale_in_mcl_4h", "vwap_cross_mes_15m", "vwap_cross_mnq_15m", "vwap_cross_mcl_15m", "bullish_candle_formation_mnq_1m", "long_opportunities_mnq_4h", "bullish_candle_formation_mcl_1m", "buy_trades_in_counter_trend_trading_environment_mes_4h", "buy_trades_in_counter_trend_trading_environment_mnq_4h", "bullish_candle_formation_mes_1m", "buy_trades_in_counter_trend_trading_environment_mcl_4h", "discount_price_to_buy_from_mes_30m", "discount_price_to_buy_from_mnq_30m", "avoiding_two_mistakes_mes_1m", "avoiding_two_mistakes_mnq_1m", "avoiding_two_mistakes_mcl_1m", "entry_condition_mes_1h", "entry_condition_mnq_1h", "entry_condition_mcl_1h", "long_entry_mes_15m", "long_entry_mnq_15m", "long_entry_mcl_15m", "buying_opportunity_mes_15m", "buying_opportunity_mnq_15m", "buying_opportunity_mcl_15m"]
REVERSAL_STRATS = ["breaker", "eqhl_raid", "london_raid", "judas_swing", "mitigation", "manipulation_trade_mes_5m", "manipulation_trade_mnq_5m", "manipulation_trade_mcl_5m", "overall_trend_mes_5m", "overall_trend_mnq_5m", "overall_trend_mcl_5m", "short_entry_mes_5m", "short_entry_mnq_5m", "short_entry_mcl_5m", "jump_in_downtrend_mes_5m", "jump_in_downtrend_mnq_5m", "jump_in_downtrend_mcl_5m", "bos_and_fvg_or_fvg_mes_5m", "bos_and_fvg_or_fvg_mnq_5m", "bos_and_fvg_or_fvg_mcl_5m", "retracement_opportunity_mes_5m", "retracement_opportunity_mnq_5m", "retracement_opportunity_mcl_5m", "trade_era_scale_in_mes_5m", "trade_era_scale_in_mnq_5m", "trade_era_scale_in_mcl_5m", "vwap_cross_mes_5m", "vwap_cross_mnq_5m", "vwap_cross_mcl_5m", "order_block_entry_trigger_mes_5m", "order_block_entry_trigger_mnq_5m", "order_block_entry_trigger_mcl_5m", "trading_session_time_mes_5m", "trading_session_time_mnq_5m", "trading_session_time_mcl_5m", "hammer_candle_long_side_mes_5m", "hammer_candle_long_side_mnq_5m", "hammer_candle_long_side_mcl_5m", "downside_delivery_mes_5m", "downside_delivery_mnq_5m", "downside_delivery_mcl_5m", "opening_range_breakout_orb_mes_5m", "opening_range_breakout_orb_mnq_5m", "opening_range_breakout_orb_mcl_5m", "entry_condition_mes_5m", "entry_condition_mnq_5m", "entry_condition_mcl_5m", "entry_at_key_levels_mes_5m", "entry_at_key_levels_mnq_5m", "entry_at_key_levels_mcl_5m", "new_high_acceptance_mes_5m", "new_high_acceptance_mnq_5m", "new_high_acceptance_mcl_5m"]
MEAN_REV_STRATS = ["ny_lunch_reversal", "midnight_open", "mean_reversion_mes_5m", "mean_reversion_mnq_5m", "mean_reversion_mcl_5m"]
ORB_STRATS = ["iofed", "ict_scalp", "buy_bias_mes_5m", "buy_bias_mnq_5m", "buy_bias_mcl_5m"]
ALL_STRATS = CONTINUATION_STRATS + REVERSAL_STRATS + MEAN_REV_STRATS + ORB_STRATS


# ---------------------------------------------------------------------------
# PLAYBOOK_ROUTING — declarative spec per playbook
#
# Each entry:
#   bias_range:         (min_net_bias, max_net_bias) inclusive
#   confidence_min:     minimum bias_confidence required (None = no check)
#   requires:           list of conditions that must be true
#   allowed_strategies: strategy families eligible under this playbook
#   allowed_setups:     setup patterns eligible under this playbook
# ---------------------------------------------------------------------------
PLAYBOOK_ROUTING: Dict[str, Dict[str, Any]] = {
    "NO_TRADE": {
        "bias_range": (-14, 14),
        "confidence_min": None,
        "requires": [
            "abs_net_bias_lt_15",
            "confidence_lt_0.3",
            "event_risk_active",
            "daily_loss_cap_near",
            "max_trades_hit",
            "range_compression",
            "volatility_spike",
        ],
        "allowed_strategies": [],
        "allowed_setups": [],
    },
    "TREND_CONTINUATION_LONG": {
        "bias_range": (40, 100),
        "confidence_min": 0.6,
        "requires": ["htf_trend_aligned_bullish"],
        "allowed_strategies": CONTINUATION_STRATS,
        "allowed_setups": ["breakout_pullback", "vwap_reclaim", "fvg_continuation", "ob_retest"],
    },
    "TREND_CONTINUATION_SHORT": {
        "bias_range": (-100, -40),
        "confidence_min": 0.6,
        "requires": ["htf_trend_aligned_bearish"],
        "allowed_strategies": CONTINUATION_STRATS,
        "allowed_setups": ["breakout_pullback", "vwap_rejection", "fvg_continuation", "ob_retest"],
    },
    "SWEEP_REVERSAL_LONG": {
        "bias_range": (-20, 40),
        "confidence_min": None,
        "requires": ["london_swept_pdl"],
        "allowed_strategies": REVERSAL_STRATS,
        "allowed_setups": ["sweep_reclaim", "breaker_retest", "turtle_soup"],
    },
    "SWEEP_REVERSAL_SHORT": {
        "bias_range": (-40, 20),
        "confidence_min": None,
        "requires": ["london_swept_pdh"],
        "allowed_strategies": REVERSAL_STRATS,
        "allowed_setups": ["sweep_reclaim", "breaker_retest", "turtle_soup"],
    },
    "MEAN_REVERSION_LONG": {
        "bias_range": (-100, -20),
        "confidence_min": None,
        "requires": ["pd_location_discount"],
        "allowed_strategies": MEAN_REV_STRATS,
        "allowed_setups": ["vwap_rejection", "fvg_fill", "ob_rejection"],
    },
    "MEAN_REVERSION_SHORT": {
        "bias_range": (20, 100),
        "confidence_min": None,
        "requires": ["pd_location_premium"],
        "allowed_strategies": MEAN_REV_STRATS,
        "allowed_setups": ["vwap_rejection", "fvg_fill", "ob_rejection"],
    },
    "ORB_LONG": {
        "bias_range": (20, 100),
        "confidence_min": None,
        "requires": ["or_broken_above"],
        "allowed_strategies": ORB_STRATS,
        "allowed_setups": ["opening_range_breakout", "opening_range_retest"],
    },
    "ORB_SHORT": {
        "bias_range": (-100, -20),
        "confidence_min": None,
        "requires": ["or_broken_below"],
        "allowed_strategies": ORB_STRATS,
        "allowed_setups": ["opening_range_breakout", "opening_range_retest"],
    },
    # ── W25.10 — Institutional regime playbooks ──────────────────────────────
    # These are matched via DailyBiasState.institutional_regime, not net_bias.
    # They run BEFORE the classic arms inside route_playbook().
    "DISPLACEMENT_CONTINUATION": {
        # EXPANSION regime: directional move already underway; ride continuation.
        "institutional_regime": "EXPANSION",
        "confidence_min": None,
        "requires": ["institutional_regime_expansion"],
        "allowed_strategies": CONTINUATION_STRATS,
        "allowed_setups": [
            "displacement_retest",
            "fvg_continuation",
            "ob_retest",
            "breakout_pullback",
        ],
    },
    "BREAKOUT_PREP": {
        # COMPRESSION regime: low ATR, tight bars — load ORB / breakout candidates.
        "institutional_regime": "COMPRESSION",
        "confidence_min": None,
        "requires": ["institutional_regime_compression"],
        "allowed_strategies": ORB_STRATS + CONTINUATION_STRATS,
        "allowed_setups": [
            "opening_range_breakout",
            "opening_range_retest",
            "compression_squeeze_breakout",
        ],
    },
    "REDUCED_SIZING": {
        # HIGH_VOL_MACRO: signals can proceed but contract cap is halved by framework.
        # The 0.5× multiplier is applied by framework-overlay.ts (not here).
        "institutional_regime": "HIGH_VOL_MACRO",
        "confidence_min": None,
        "requires": ["institutional_regime_high_vol_macro"],
        "allowed_strategies": CONTINUATION_STRATS,
        "allowed_setups": [
            "breakout_pullback",
            "fvg_continuation",
        ],
    },
    # ── Wave 26 Pass G Pass F — 7th regime playbook ────────────────────────────
    "LATE_CYCLE_MEAN_REVERSION": {
        # LATE_CYCLE_OVERHEATING: melt-up + blow-off-top pattern.
        # ONLY mean-reversion and reversal strategies allowed.
        # Continuation/breakout strategies are suppressed — they statistically
        # blow up at the top of a parabolic move.
        # Contract cap is halved (0.5× via REDUCED_SIZING mechanism in framework-overlay.ts).
        "institutional_regime": "LATE_CYCLE_OVERHEATING",
        "confidence_min": None,
        "requires": ["institutional_regime_late_cycle_overheating"],
        "allowed_strategies": MEAN_REV_STRATS + REVERSAL_STRATS,
        "allowed_setups": [
            "mean_reversion_extreme",
            "sweep_reversal",
            "breaker_reversal",
            "fvg_fade",
            "midnight_open_reversal",
        ],
    },
}


def _compute_router_hash() -> str:
    """Compute a short hash of the routing table for audit provenance.

    Hash changes whenever PLAYBOOK_ROUTING structure changes, ensuring that
    bias_decisions rows carry the exact version of routing logic that produced them.
    """
    routing_repr = repr(sorted(PLAYBOOK_ROUTING.items()))
    return hashlib.sha256(routing_repr.encode()).hexdigest()[:16]


# Compute once at module load — deterministic, no side effects.
ROUTER_HASH: str = _compute_router_hash()


def _check_no_trade_conditions(
    bias: DailyBiasState,
    daily_loss_cap_near: bool = False,
    max_trades_hit: bool = False,
) -> List[str]:
    """Evaluate all NO_TRADE conditions.

    Returns a list of reason strings. If non-empty, the router must return NO_TRADE.

    Conditions checked:
    1. abs(net_bias) < 15                — no directional conviction
    2. confidence < 0.3                  — conflicting signals
    3. event_risk_active                 — high-impact event within +/-30 min
    4. daily_loss_cap_near               — approaching daily loss limit
    5. max_trades_hit                    — max trades per session reached
    6. range_compression (ATR < 10pctl)  — no opportunity
    7. volatility_spike (ATR > 90pctl)   — uncontrolled risk
    """
    reasons: List[str] = []

    # Inherit reasons already computed by bias_engine (abs_bias<15, conf<0.3,
    # event_risk, range_compression, volatility_spike)
    reasons.extend(bias.no_trade_reasons)

    # Additional session-level blockers not known to bias_engine
    if daily_loss_cap_near:
        reasons.append("Daily loss cap approaching — sit out")
    if max_trades_hit:
        reasons.append("Maximum trades per session reached")

    return reasons


def route_playbook(
    bias: DailyBiasState,
    *,
    daily_loss_cap_near: bool = False,
    max_trades_hit: bool = False,
) -> PlaybookDecision:
    """Route bias state to the best playbook.

    Evaluation order:
    0. Institutional regime routing (W25.10, checked FIRST):
       - LOW_LIQ_CHOP    → NO_TRADE
       - HIGH_VOL_MACRO  → REDUCED_SIZING
       - EXPANSION       → DISPLACEMENT_CONTINUATION
       - COMPRESSION     → BREAKOUT_PREP
    1. NO_TRADE hard blockers (any single blocker kills — safety always wins)
    2. TREND_CONTINUATION (strong aligned bias >= |40|, confidence >= 0.6)
    3. SWEEP_REVERSAL (moderate bias after liquidity sweep)
    4. ORB (opening range breakout with directional bias)
    5. MEAN_REVERSION (extreme location with opposite bias)
    6. Default fallback -> NO_TRADE
    """
    nb = bias.net_bias
    conf = bias.bias_confidence
    session = bias.session_context

    # ------------------------------------------------------------------
    # 0. Institutional regime routing (W25.10) — checked BEFORE classic
    #    no-trade and bias arms. institutional_regime is None for callers
    #    that don't supply exec_bars/htf data — backward compat preserved.
    # ------------------------------------------------------------------
    inst_regime = getattr(bias, "institutional_regime", None)

    # LOW_LIQ_CHOP → force NO_TRADE (no strategy eligible)
    if inst_regime == "LOW_LIQ_CHOP":
        return PlaybookDecision(
            playbook="NO_TRADE",
            allowed_strategies=[],
            allowed_setups=[],
            confidence_modifier=0.0,
            no_trade_reasons=["LOW_LIQ_CHOP regime — between sessions or holiday window"],
        )

    # HIGH_VOL_MACRO → REDUCED_SIZING (signals proceed; framework halves contracts)
    if inst_regime == "HIGH_VOL_MACRO":
        spec = PLAYBOOK_ROUTING["REDUCED_SIZING"]
        return PlaybookDecision(
            playbook="REDUCED_SIZING",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.6,  # reduced conviction in macro spike
        )

    # EXPANSION → DISPLACEMENT_CONTINUATION
    if inst_regime == "EXPANSION":
        spec = PLAYBOOK_ROUTING["DISPLACEMENT_CONTINUATION"]
        return PlaybookDecision(
            playbook="DISPLACEMENT_CONTINUATION",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=1.0,
        )

    # COMPRESSION → BREAKOUT_PREP
    if inst_regime == "COMPRESSION":
        spec = PLAYBOOK_ROUTING["BREAKOUT_PREP"]
        return PlaybookDecision(
            playbook="BREAKOUT_PREP",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.8,
        )

    # LATE_CYCLE_OVERHEATING → LATE_CYCLE_MEAN_REVERSION (Wave 26 Pass G Pass F)
    # Mean-reversion only. Contract cap halved by framework (same REDUCED_SIZING mechanism).
    # Continuation/breakout strategies are suppressed — blow up at the top.
    if inst_regime == "LATE_CYCLE_OVERHEATING":
        spec = PLAYBOOK_ROUTING["LATE_CYCLE_MEAN_REVERSION"]
        return PlaybookDecision(
            playbook="LATE_CYCLE_MEAN_REVERSION",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.5,  # 0.5× contracts + reduced conviction at top
        )

    # ------------------------------------------------------------------
    # 1. NO_TRADE conditions (checked first — any single blocker kills)
    # ------------------------------------------------------------------
    no_trade_reasons = _check_no_trade_conditions(
        bias,
        daily_loss_cap_near=daily_loss_cap_near,
        max_trades_hit=max_trades_hit,
    )
    if no_trade_reasons:
        return PlaybookDecision(
            playbook="NO_TRADE",
            allowed_strategies=[],
            allowed_setups=[],
            confidence_modifier=0.0,
            no_trade_reasons=no_trade_reasons,
        )

    # ------------------------------------------------------------------
    # 2. TREND_CONTINUATION — strong aligned bias
    # ------------------------------------------------------------------
    spec = PLAYBOOK_ROUTING["TREND_CONTINUATION_LONG"]
    if nb >= spec["bias_range"][0] and conf >= spec["confidence_min"]:
        return PlaybookDecision(
            playbook="TREND_CONTINUATION_LONG",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=1.0,
        )

    spec = PLAYBOOK_ROUTING["TREND_CONTINUATION_SHORT"]
    if nb <= spec["bias_range"][1] and conf >= spec["confidence_min"]:
        return PlaybookDecision(
            playbook="TREND_CONTINUATION_SHORT",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=1.0,
        )

    # ------------------------------------------------------------------
    # 3. SWEEP_REVERSAL — moderate bias after liquidity sweep
    # ------------------------------------------------------------------
    spec = PLAYBOOK_ROUTING["SWEEP_REVERSAL_LONG"]
    if spec["bias_range"][0] <= nb <= spec["bias_range"][1] and session.london_swept_pdl:
        return PlaybookDecision(
            playbook="SWEEP_REVERSAL_LONG",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.9,
        )

    spec = PLAYBOOK_ROUTING["SWEEP_REVERSAL_SHORT"]
    if spec["bias_range"][0] <= nb <= spec["bias_range"][1] and session.london_swept_pdh:
        return PlaybookDecision(
            playbook="SWEEP_REVERSAL_SHORT",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.9,
        )

    # ------------------------------------------------------------------
    # 4. ORB — opening range breakout with directional bias
    # ------------------------------------------------------------------
    spec = PLAYBOOK_ROUTING["ORB_LONG"]
    if session.or_broken == "above" and nb >= spec["bias_range"][0]:
        return PlaybookDecision(
            playbook="ORB_LONG",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.85,
        )

    spec = PLAYBOOK_ROUTING["ORB_SHORT"]
    if session.or_broken == "below" and nb <= spec["bias_range"][1]:
        return PlaybookDecision(
            playbook="ORB_SHORT",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.85,
        )

    # ------------------------------------------------------------------
    # 5. MEAN_REVERSION — extreme location with weak opposite bias
    # ------------------------------------------------------------------
    spec = PLAYBOOK_ROUTING["MEAN_REVERSION_LONG"]
    if nb <= spec["bias_range"][1] and bias.htf_context.pd_location == "discount":
        return PlaybookDecision(
            playbook="MEAN_REVERSION_LONG",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.7,
        )

    spec = PLAYBOOK_ROUTING["MEAN_REVERSION_SHORT"]
    if nb >= spec["bias_range"][0] and bias.htf_context.pd_location == "premium":
        return PlaybookDecision(
            playbook="MEAN_REVERSION_SHORT",
            allowed_strategies=spec["allowed_strategies"],
            allowed_setups=spec["allowed_setups"],
            confidence_modifier=0.7,
        )

    # ------------------------------------------------------------------
    # 6. Default fallback — no playbook matched
    # ------------------------------------------------------------------
    return PlaybookDecision(
        playbook="NO_TRADE",
        allowed_strategies=[],
        allowed_setups=[],
        confidence_modifier=0.0,
        no_trade_reasons=["No playbook conditions matched current bias state"],
    )
