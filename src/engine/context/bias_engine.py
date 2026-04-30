"""Bias Engine — Assembles HTF + Session context into scored daily bias.

The core scoring layer: 7 weighted components → net bias (-100 to +100).
Positive = bullish. Negative = bearish. Near zero = no conviction.

Synthetic Order Flow (Wave F2):
    Adds 4 order-flow signals derived from OHLCV — synthetic CVD, absorption,
    exhaustion, sweep+delta confirmation. These are APPROXIMATIONS of real
    footprint signals (which require tick-level aggressor data from ATAS,
    Bookmap, Sierra Chart, Databento, or Polygon). Drop-in replacement: once a
    real feed is wired, swap the four helper functions and the output dict
    shape stays identical. Downstream consumers (playbook router, eligibility
    gate) require no changes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
import polars as pl

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
    "deepar_regime": 0.0,  # Starts at zero — no impact until auto-graduated
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
    deepar_regime_score: int = 0
    # Composite
    net_bias: int = 0
    bias_confidence: float = 0.0
    playbook: str = "NO_TRADE"
    no_trade_reasons: List[str] = field(default_factory=list)
    # Synthetic order flow (Wave F2) — additive, all default to neutral so
    # callers that don't supply OHLCV bars see no behavior change.
    cvd_zscore: float = 0.0           # Z-score of last-bar synthetic CVD vs rolling window
    absorption_active: bool = False   # High volume + small range = institutional absorption
    exhaustion_active: bool = False   # Large bar closing in opposite extreme = exhaustion
    sweep_delta_confirmed: bool = False  # Sweep + CVD shift > 1σ in reversal direction
    order_flow_score: int = 0         # 0–100 composite (kept positive; direction implied)


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
    """Score premium/discount location relative to direction_hint.

    direction_hint: +1 = bullish, -1 = bearish, 0 = neutral.
    When bullish, discount is great (+60) and premium is bad (-60).
    When bearish, premium is great (+60) and discount is bad (-60).
    When neutral, discount is mildly bullish (+40), premium mildly bearish (-40).
    """
    if direction_hint > 0:
        # Bullish hint: want to buy in discount, avoid premium
        if htf.pd_location == "discount":
            return 60   # Great — buying low
        elif htf.pd_location == "premium":
            return -60  # Bad — buying high
    elif direction_hint < 0:
        # Bearish hint: want to sell in premium, avoid discount
        if htf.pd_location == "premium":
            return 60   # Great — selling high
        elif htf.pd_location == "discount":
            return -60  # Bad — selling low
    else:
        # No direction hint — use raw location score
        if htf.pd_location == "discount":
            return 40   # Mildly bullish
        elif htf.pd_location == "premium":
            return -40  # Mildly bearish
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


def _score_deepar_regime(deepar_forecast: dict | None) -> int:
    """Score DeepAR regime forecast for directional bias.

    Maps probabilistic regime predictions to a bias score:
    - High P(high_vol) → caution signal, push toward 0 (reduce conviction)
    - High P(trending) → directional signal, use quantile direction
    - Returns -100 to +100, but only contributes when weight > 0.0
    """
    if not deepar_forecast:
        return 0

    p_high_vol = float(deepar_forecast.get("p_high_vol", 0) or 0)
    p_trending = float(deepar_forecast.get("p_trending", 0) or 0)
    p_mean_revert = float(deepar_forecast.get("p_mean_revert", 0) or 0)
    quantile_p50 = float(deepar_forecast.get("quantile_p50", 0) or 0)

    score = 0

    # High volatility → caution → push bias toward zero
    if p_high_vol > 0.7:
        # Strong caution: dampen any directional conviction
        score -= 40
    elif p_high_vol > 0.5:
        score -= 20

    # Trending regime → directional signal based on quantile direction
    if p_trending > 0.6:
        # P50 quantile direction: positive = bullish forecast, negative = bearish
        if quantile_p50 > 0:
            score += int(min(60, p_trending * 80))
        elif quantile_p50 < 0:
            score -= int(min(60, p_trending * 80))

    # Mean reversion regime → slight contrarian signal
    if p_mean_revert > 0.6:
        # Mean reversion suggests current move will reverse — reduce conviction
        score = int(score * 0.5)

    return max(-100, min(100, score))


# ---------------------------------------------------------------------------
# Synthetic Order Flow (Wave F2)
#
# These functions approximate footprint-style microstructure signals from
# OHLCV bars. They are NOT a substitute for real tick-by-tick aggressor data —
# they are the OHLCV-only proxy that lets us run the full pipeline before any
# footprint subscription is in place.
#
# Real upgrade path: replace the four functions below with real-feed versions
# that consume bid/ask aggressor delta. Output shapes unchanged.
# ---------------------------------------------------------------------------

_OF_REQUIRED_COLS = ("high", "low", "close", "volume")


def _bars_ready(bars: Optional[pl.DataFrame], min_bars: int = 1) -> bool:
    """Return True iff bars has the OHLCV columns and at least `min_bars` rows."""
    if bars is None or len(bars) < min_bars:
        return False
    cols = set(bars.columns)
    return all(c in cols for c in _OF_REQUIRED_COLS)


def compute_synthetic_cvd(bars: pl.DataFrame) -> pl.Series:
    """Synthetic Cumulative Volume Delta from OHLCV.

    Approximation: bull volume = volume × (close - low) / (high - low).
    Bear volume = volume × (high - close) / (high - low). Delta = bull - bear,
    cumulative across bars.

    Real CVD requires tick-by-tick aggressor side (which contracts hit the
    ask vs lifted the bid). This OHLCV version assumes that close-relative-
    to-range is a usable proxy for aggressor pressure. False positives where
    a wide-range bar closed in the middle (synthetic ≈ 0) but real aggressor
    flow was strongly directional.

    Returns a Polars Series of cumulative delta, one value per bar.
    """
    # Compute via numpy for vectorized doji handling, then wrap as Polars Series.
    high = bars["high"].cast(pl.Float64).to_numpy()
    low = bars["low"].cast(pl.Float64).to_numpy()
    close = bars["close"].cast(pl.Float64).to_numpy()
    volume = bars["volume"].cast(pl.Float64).to_numpy()
    range_ = high - low
    # Doji bars (range == 0) get delta = 0; everything else uses bull%-bear%.
    safe_range = np.where(range_ > 0, range_, 1.0)
    bull_pct = (close - low) / safe_range
    bear_pct = (high - close) / safe_range
    delta = volume * (bull_pct - bear_pct)
    delta = np.where(range_ > 0, delta, 0.0)
    cvd = np.cumsum(delta)
    return pl.Series("cvd", cvd, dtype=pl.Float64)


def detect_absorption(bars: pl.DataFrame, window: int = 20) -> pl.Series:
    """Flag absorption bars: volume > 2× rolling avg AND range < 0.5× rolling avg range.

    Institutional absorption: large orders quietly fill at a level without
    moving price. Synthetic proxy is "high volume + small range". Real
    detection would also require seeing the bid/ask sit + heavy aggression
    against it.

    Returns a Polars Series of bool, one per bar. First `window` bars are
    False (insufficient history).
    """
    volume = bars["volume"].cast(pl.Float64)
    range_ = (bars["high"].cast(pl.Float64) - bars["low"].cast(pl.Float64))
    vol_ma = volume.rolling_mean(window_size=window, min_samples=window)
    range_ma = range_.rolling_mean(window_size=window, min_samples=window)
    flag = (volume > vol_ma * 2.0) & (range_ < range_ma * 0.5)
    # Replace nulls (early bars before window fills) with False
    return flag.fill_null(False)


def detect_exhaustion(bars: pl.DataFrame, window: int = 20) -> pl.Series:
    """Flag exhaustion bars: large bar closing in opposite extreme.

    Bull exhaustion: range > 1.5× rolling avg AND close in lower 30% of bar
    range (high made, sellers reclaimed). Bear exhaustion: range > 1.5× avg
    AND close in upper 30% (low made, buyers reclaimed). Either condition
    sets the flag. Direction is implied by neighboring CVD or upstream
    market structure — this signal is direction-agnostic.

    Returns a Polars Series of bool, one per bar.
    """
    high = bars["high"].cast(pl.Float64).to_numpy()
    low = bars["low"].cast(pl.Float64).to_numpy()
    close = bars["close"].cast(pl.Float64).to_numpy()
    range_ = high - low
    safe_range = np.where(range_ > 0, range_, 1.0)
    pos_in_range = (close - low) / safe_range  # 0 = closed at low, 1 = at high

    # Rolling mean of range with min_samples = window (matches absorption logic)
    range_series = pl.Series(range_)
    range_ma = range_series.rolling_mean(window_size=window, min_samples=window).to_numpy()

    # Where range_ma is null/NaN (early bars), big_bar = False → flag = False
    with np.errstate(invalid="ignore"):
        big_bar = np.where(np.isnan(range_ma), False, range_ > range_ma * 1.5)

    bull_exhaust = big_bar & (pos_in_range < 0.30)
    bear_exhaust = big_bar & (pos_in_range > 0.70)
    flag = bull_exhaust | bear_exhaust
    return pl.Series("exhaustion", flag, dtype=pl.Boolean)


def confirm_sweep_with_delta(
    sweep_signal: bool,
    cvd_series: pl.Series,
    window: int = 20,
) -> bool:
    """Confirm a sweep signal with a CVD shift in the reversal direction.

    A liquidity sweep is high-conviction when synthetic CVD shifts > 1 standard
    deviation at the sweep bar — i.e., aggressors stepped in to absorb the
    sweep extension and reversed it. Without delta confirmation, a sweep could
    just be range expansion that follows through.

    Args:
        sweep_signal: Whether a liquidity sweep was detected on the latest bar
            (typically `session.london_swept_pdh` or `london_swept_pdl`).
        cvd_series: Cumulative Volume Delta series ending at the sweep bar.
        window: Rolling window for std-dev baseline.

    Returns:
        True iff sweep_signal is True AND last-bar CVD change exceeds 1σ of
        the recent change distribution.
    """
    if not sweep_signal:
        return False
    if cvd_series is None or len(cvd_series) < window + 2:
        return False
    cvd_arr = cvd_series.to_numpy()
    # Bar-over-bar CVD change
    deltas = np.diff(cvd_arr[-(window + 1):])  # length = window
    last_change = deltas[-1]
    baseline = deltas[:-1]
    if len(baseline) < 2:
        return False
    sd = float(np.std(baseline, ddof=1))
    if sd == 0.0:
        return False
    return bool(abs(last_change) > sd)  # >1σ in either direction


def _compute_order_flow_features(
    bars: Optional[pl.DataFrame],
    session: SessionContext,
    window: int = 20,
) -> dict:
    """Compute all 4 order flow signals and the composite score.

    Returns dict with keys: cvd_zscore, absorption_active, exhaustion_active,
    sweep_delta_confirmed, order_flow_score. All zero/False if bars insufficient.
    """
    out = {
        "cvd_zscore": 0.0,
        "absorption_active": False,
        "exhaustion_active": False,
        "sweep_delta_confirmed": False,
        "order_flow_score": 0,
    }

    if not _bars_ready(bars, min_bars=window + 2):
        return out

    # 1. Synthetic CVD + z-score of latest bar's CVD change
    cvd_series = compute_synthetic_cvd(bars)
    cvd_arr = cvd_series.to_numpy()
    deltas = np.diff(cvd_arr[-(window + 1):])
    if len(deltas) >= 2:
        sd = float(np.std(deltas[:-1], ddof=1))
        mean = float(np.mean(deltas[:-1]))
        if sd > 0:
            out["cvd_zscore"] = round(float((deltas[-1] - mean) / sd), 3)

    # 2. Absorption (last bar)
    abs_series = detect_absorption(bars, window=window)
    out["absorption_active"] = bool(abs_series[-1])

    # 3. Exhaustion (last bar)
    exh_series = detect_exhaustion(bars, window=window)
    out["exhaustion_active"] = bool(exh_series[-1])

    # 4. Sweep + delta confirmation
    sweep_present = bool(session.london_swept_pdh or session.london_swept_pdl)
    out["sweep_delta_confirmed"] = confirm_sweep_with_delta(
        sweep_present, cvd_series, window=window
    )

    # 5. Composite order flow score (0–100)
    # Components contribute in this weighting:
    #   - |cvd_zscore| capped at 3.0 → up to 30 points
    #   - absorption_active → 25 points
    #   - exhaustion_active → 20 points
    #   - sweep_delta_confirmed → 25 points
    score = 0
    score += int(min(30, abs(out["cvd_zscore"]) * 10))
    if out["absorption_active"]:
        score += 25
    if out["exhaustion_active"]:
        score += 20
    if out["sweep_delta_confirmed"]:
        score += 25
    out["order_flow_score"] = max(0, min(100, score))

    return out


def compute_bias(
    htf: HTFContext,
    session: SessionContext,
    current_price: float = 0.0,
    vwap: float = 0.0,
    event_active: bool = False,
    event_minutes: int = 999,
    deepar_forecast: dict | None = None,
    bars: Optional[pl.DataFrame] = None,
) -> DailyBiasState:
    """Compute the full daily bias state from all 7 components.

    Returns DailyBiasState with net_bias (-100..+100) and bias_confidence (0..1).
    """
    # Derive direction hint from HTF trend for pd_location scoring
    trend_map = {"bullish": 1, "bearish": -1, "neutral": 0}
    direction_hint = trend_map.get(htf.daily_trend, 0)

    scores = {
        "htf_trend": _score_htf_trend(htf),
        "pd_location": _score_pd_location(htf, direction_hint),
        "overnight_structure": _score_overnight(session),
        "liquidity_context": _score_liquidity_context(session, htf),
        "vwap_state": _score_vwap_state(current_price, vwap),
        "event_risk": _score_event_risk(event_active, event_minutes),
        "session_regime": _score_session_regime(htf),
        "deepar_regime": _score_deepar_regime(deepar_forecast),
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

    # Determine playbook from net_bias + confidence
    if no_trade_reasons:
        playbook = "NO_TRADE"
    elif net_bias >= 40 and bias_confidence >= 0.5:
        playbook = "FULL_LONG"
    elif net_bias >= 15 and bias_confidence >= 0.3:
        playbook = "LEAN_LONG"
    elif net_bias <= -40 and bias_confidence >= 0.5:
        playbook = "FULL_SHORT"
    elif net_bias <= -15 and bias_confidence >= 0.3:
        playbook = "LEAN_SHORT"
    else:
        playbook = "NO_TRADE"

    # Synthetic order flow features (Wave F2). Additive — defaults to neutral
    # when bars=None so existing callers see no behavior change.
    of_features = _compute_order_flow_features(bars, session)

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
        deepar_regime_score=scores["deepar_regime"],
        net_bias=net_bias,
        bias_confidence=bias_confidence,
        playbook=playbook,
        no_trade_reasons=no_trade_reasons,
        cvd_zscore=of_features["cvd_zscore"],
        absorption_active=of_features["absorption_active"],
        exhaustion_active=of_features["exhaustion_active"],
        sweep_delta_confirmed=of_features["sweep_delta_confirmed"],
        order_flow_score=of_features["order_flow_score"],
    )

    return state
