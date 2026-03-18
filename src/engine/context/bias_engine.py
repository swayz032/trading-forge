"""Bias Engine — Assembles HTF + Session context into scored daily bias.

The core scoring layer: 7 weighted components → net bias (-100 to +100).
Positive = bullish. Negative = bearish. Near zero = no conviction.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from src.engine.context.htf_context import HTFContext
from src.engine.context.session_context import SessionContext


BIAS_WEIGHTS = {
    "htf_trend": 0.25,
    "pd_location": 0.20,
    "overnight_structure": 0.15,
    "liquidity_context": 0.15,
    "vwap_state": 0.10,
    "event_risk": 0.10,
    "session_regime": 0.05,
}


@dataclass
class DailyBiasState:
    htf_context: HTFContext
    session_context: SessionContext
    # Individual bias scores (-100 to +100, positive = bullish)
    htf_trend_score: int = 0
    pd_location_score: int = 0
    overnight_score: int = 0
    liquidity_context_score: int = 0
    vwap_state_score: int = 0
    event_risk_score: int = 0
    session_regime_score: int = 0
    # Composite
    net_bias: int = 0
    bias_confidence: float = 0.0
    playbook: str = "NO_TRADE"
    no_trade_reasons: List[str] = field(default_factory=list)


def _score_htf_trend(htf: HTFContext) -> int:
    """Score HTF trend alignment. Full alignment = ±80, partial = ±40."""
    score = 0
    trend_map = {"bullish": 1, "bearish": -1, "neutral": 0}

    daily = trend_map[htf.daily_trend]
    weekly = trend_map[htf.weekly_trend]
    four_h = trend_map[htf.four_h_trend]

    # Full alignment (daily + weekly + 4H all agree)
    if daily == weekly == four_h and daily != 0:
        score = daily * 80
    # Partial alignment (daily + one other agree)
    elif daily == weekly and daily != 0:
        score = daily * 60
    elif daily == four_h and daily != 0:
        score = daily * 50
    # Only daily has direction
    elif daily != 0:
        score = daily * 30

    # ADX boost: strong trend gets bonus
    if htf.adx > 25:
        score = int(score * 1.2)

    return max(-100, min(100, score))


def _score_pd_location(htf: HTFContext, direction_hint: int) -> int:
    """Score premium/discount location. Longs in discount = good (+60). Longs in premium = bad (-40)."""
    if htf.pd_location == "discount":
        return 60  # Good for longs
    elif htf.pd_location == "premium":
        return -60  # Good for shorts
    return 0  # Equilibrium — neutral


def _score_overnight(session: SessionContext) -> int:
    """Score overnight structure direction."""
    bias_map = {"bullish": 50, "bearish": -50, "neutral": 0}
    score = bias_map[session.overnight_bias]

    # London sweep of PDH/PDL adds context
    if session.london_swept_pdl:
        score += 20  # Swept sell-side → bullish reversal potential
    if session.london_swept_pdh:
        score -= 20  # Swept buy-side → bearish reversal potential

    return max(-100, min(100, score))


def _score_liquidity_context(session: SessionContext, htf: HTFContext) -> int:
    """Score based on which side of liquidity has been swept."""
    score = 0
    if session.london_swept_pdl and not session.london_swept_pdh:
        score = 40  # Sell-side swept, buy-side intact → bullish
    elif session.london_swept_pdh and not session.london_swept_pdl:
        score = -40  # Buy-side swept, sell-side intact → bearish
    elif session.london_swept_pdh and session.london_swept_pdl:
        score = 0  # Both sides swept → unclear
    return score


def _score_vwap_state(current_price: float, vwap: float) -> int:
    """Score price relative to VWAP. Above = bullish, below = bearish."""
    if vwap <= 0:
        return 0
    pct_from_vwap = (current_price - vwap) / vwap * 100
    # Scale: ±0.5% from VWAP = ±50 score
    return max(-100, min(100, int(pct_from_vwap * 100)))


def _score_event_risk(event_active: bool, event_minutes: int = 0) -> int:
    """Score event risk. Active events reduce bias confidence toward zero."""
    if event_active:
        # Within ±30 min of event: heavy dampening
        if abs(event_minutes) <= 30:
            return 0  # Effectively kills directional bias
        elif abs(event_minutes) <= 60:
            return 0  # Still cautious
    return 50  # No event → slight positive (normal conditions)


def _score_session_regime(htf: HTFContext) -> int:
    """Score session regime from ATR percentile. High vol = cautious, low vol = cautious."""
    pct = htf.atr_percentile
    if pct > 80:
        return -20  # High volatility — cautious
    elif pct < 20:
        return -10  # Low volatility — range compression, less opportunity
    elif 40 <= pct <= 60:
        return 30  # Normal volatility — ideal
    return 10  # Moderate


def compute_bias(
    htf: HTFContext,
    session: SessionContext,
    current_price: float = 0.0,
    vwap: float = 0.0,
    event_active: bool = False,
    event_minutes: int = 999,
) -> DailyBiasState:
    """Compute the full daily bias state from all 7 components.

    Returns DailyBiasState with net_bias (-100..+100) and bias_confidence (0..1).
    """
    scores = {
        "htf_trend": _score_htf_trend(htf),
        "pd_location": _score_pd_location(htf, 0),
        "overnight_structure": _score_overnight(session),
        "liquidity_context": _score_liquidity_context(session, htf),
        "vwap_state": _score_vwap_state(current_price, vwap),
        "event_risk": _score_event_risk(event_active, event_minutes),
        "session_regime": _score_session_regime(htf),
    }

    # Weighted sum
    net_bias = sum(scores[k] * BIAS_WEIGHTS[k] for k in BIAS_WEIGHTS)
    net_bias = max(-100, min(100, int(net_bias)))

    # Confidence: how aligned are the components?
    # If all point the same direction → high confidence
    # If mixed → low confidence
    signs = [1 if v > 0 else (-1 if v < 0 else 0) for v in scores.values()]
    non_zero = [s for s in signs if s != 0]
    if non_zero:
        agreement = abs(sum(non_zero)) / len(non_zero)
    else:
        agreement = 0.0
    bias_confidence = round(agreement, 2)

    # NO_TRADE reasons
    no_trade_reasons = []
    if abs(net_bias) < 15:
        no_trade_reasons.append("No directional conviction (|bias| < 15)")
    if bias_confidence < 0.3:
        no_trade_reasons.append("Conflicting signals (confidence < 0.3)")
    if event_active and abs(event_minutes) <= 30:
        no_trade_reasons.append("Event risk active within ±30 min")
    if htf.atr_percentile > 90:
        no_trade_reasons.append("Extreme volatility (ATR > 90th percentile)")
    if htf.atr_percentile < 10:
        no_trade_reasons.append("Range compression (ATR < 10th percentile)")

    state = DailyBiasState(
        htf_context=htf,
        session_context=session,
        htf_trend_score=scores["htf_trend"],
        pd_location_score=scores["pd_location"],
        overnight_score=scores["overnight_structure"],
        liquidity_context_score=scores["liquidity_context"],
        vwap_state_score=scores["vwap_state"],
        event_risk_score=scores["event_risk"],
        session_regime_score=scores["session_regime"],
        net_bias=net_bias,
        bias_confidence=bias_confidence,
        no_trade_reasons=no_trade_reasons,
    )

    return state
