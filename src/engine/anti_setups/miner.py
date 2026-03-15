"""
Anti-Setup Miner — discovers conditions where strategy setups consistently fail.
Mines historical losing trades to find common environmental conditions.
"""

from __future__ import annotations

import math
import statistics
from typing import Any


def mine_anti_setups(
    trades: list[dict],
    bars: list[dict],
    min_sample_size: int = 20,
    min_failure_rate: float = 0.65,
) -> list[dict]:
    """
    Discover conditions that are anti-setups (predict failure).

    Scans losing trades for common conditions:
    1. Time-of-day clustering (e.g., trades entered 14:00-15:00 lose 70%)
    2. Volatility context (e.g., ATR > 2x mean -> 68% losers)
    3. Volume context (e.g., below-avg volume -> 72% losers)
    4. Day-of-week (e.g., Monday entries lose 65%)
    5. Regime mismatch (e.g., entries during RANGE when strategy prefers TREND)
    6. Archetype mismatch (e.g., entries on REVERSAL_DAY when strategy needs trends)
    7. Proximity to events (e.g., within 2 days of FOMC -> 70% losers)
    8. Streak context (e.g., after 2 consecutive winners -> 66% next trade loses)

    Returns list of anti-setup conditions, sorted by failure rate descending.
    """
    if not trades:
        return []

    anti_setups: list[dict] = []

    miners = [
        _mine_time_of_day,
        _mine_volatility,
        _mine_volume,
        _mine_day_of_week,
        _mine_regime,
        _mine_archetype,
        _mine_event_proximity,
        _mine_streak,
    ]

    for miner_fn in miners:
        results = miner_fn(trades, bars, min_sample_size, min_failure_rate)
        anti_setups.extend(results)

    anti_setups.sort(key=lambda x: x["failure_rate"], reverse=True)
    return anti_setups


def _is_loser(trade: dict) -> bool:
    return trade.get("pnl", 0) < 0


def _failure_rate(group: list[dict]) -> float:
    if not group:
        return 0.0
    return sum(1 for t in group if _is_loser(t)) / len(group)


def _avg_loss(group: list[dict]) -> float:
    losses = [t["pnl"] for t in group if _is_loser(t)]
    return statistics.mean(losses) if losses else 0.0


def _confidence(failure_rate: float, sample_size: int) -> float:
    """Simple confidence based on failure rate consistency and sample size."""
    if sample_size == 0:
        return 0.0
    # Wilson score lower bound approximation
    z = 1.96  # 95% confidence
    n = sample_size
    p = failure_rate
    denominator = 1 + z * z / n
    center = p + z * z / (2 * n)
    spread = z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)
    lower = (center - spread) / denominator
    return round(min(max(lower, 0.0), 1.0), 4)


def _pnl_impact(group: list[dict]) -> dict:
    total_pnl = sum(t.get("pnl", 0) for t in group)
    return {
        "pnl_improvement": round(-total_pnl, 2) if total_pnl < 0 else 0.0,
        "trades_removed": len(group),
    }


def _get_hour(trade: dict) -> int | None:
    entry_time = trade.get("entry_time", "")
    if not entry_time:
        return None
    try:
        if "T" in str(entry_time):
            time_part = str(entry_time).split("T")[1]
            return int(time_part.split(":")[0])
        parts = str(entry_time).split(":")
        if len(parts) >= 2:
            return int(parts[0][-2:])  # last 2 chars before first colon
    except (ValueError, IndexError):
        return None
    return None


def _get_day_of_week(trade: dict) -> int | None:
    """Return day of week: 0=Monday .. 6=Sunday."""
    entry_time = trade.get("entry_time", "")
    if not entry_time:
        return trade.get("day_of_week")
    try:
        from datetime import datetime

        dt_str = str(entry_time)
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(dt_str[:len(fmt) + 3], fmt)
                return dt.weekday()
            except ValueError:
                continue
    except Exception:
        pass
    return trade.get("day_of_week")


# ─── Condition Miners ────────────────────────────────────────────


def _mine_time_of_day(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check 2-hour windows for high failure rates."""
    results: list[dict] = []
    hour_buckets: dict[int, list[dict]] = {}

    for t in trades:
        h = _get_hour(t)
        if h is not None:
            bucket = (h // 2) * 2  # 2-hour windows
            hour_buckets.setdefault(bucket, []).append(t)

    for bucket_start, group in hour_buckets.items():
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "time_of_day",
                "filter": {"hour_start": bucket_start, "hour_end": bucket_start + 2},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_volatility(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if high ATR conditions produce more losers."""
    results: list[dict] = []
    atr_values = [t.get("atr") for t in trades if t.get("atr") is not None]
    if not atr_values or len(atr_values) < min_sample:
        # Try getting ATR from bars
        bar_atrs = [b.get("atr") for b in bars if b.get("atr") is not None]
        if bar_atrs:
            mean_atr = statistics.mean(bar_atrs)
        else:
            return results
    else:
        mean_atr = statistics.mean(atr_values)

    # High ATR bucket: > 1.5x mean
    thresholds = [
        ("high_atr", 1.5, None),
        ("very_high_atr", 2.0, None),
        ("low_atr", None, 0.5),
    ]

    for label, lo_mult, hi_mult in thresholds:
        group = []
        for t in trades:
            atr = t.get("atr")
            if atr is None:
                continue
            if lo_mult is not None and atr < mean_atr * lo_mult:
                continue
            if hi_mult is not None and atr > mean_atr * hi_mult:
                continue
            group.append(t)

        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            filt: dict[str, Any] = {"atr_condition": label, "atr_mean": round(mean_atr, 4)}
            if lo_mult is not None:
                filt["atr_min_multiplier"] = lo_mult
            if hi_mult is not None:
                filt["atr_max_multiplier"] = hi_mult
            results.append({
                "condition": "volatility",
                "filter": filt,
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_volume(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if low volume conditions produce more losers."""
    results: list[dict] = []
    vol_values = [t.get("volume") for t in trades if t.get("volume") is not None]
    if not vol_values:
        return results

    mean_vol = statistics.mean(vol_values)
    if mean_vol == 0:
        return results

    # Low volume: below mean
    low_vol = [t for t in trades if t.get("volume") is not None and t["volume"] < mean_vol]
    if len(low_vol) >= min_sample:
        fr = _failure_rate(low_vol)
        if fr >= min_fail:
            results.append({
                "condition": "volume",
                "filter": {"volume_condition": "below_average", "volume_mean": round(mean_vol, 2)},
                "failure_rate": round(fr, 4),
                "sample_size": len(low_vol),
                "avg_loss": round(_avg_loss(low_vol), 2),
                "confidence": _confidence(fr, len(low_vol)),
                "impact_if_filtered": _pnl_impact(low_vol),
            })

    # Very low volume: below 50% of mean
    very_low = [t for t in trades if t.get("volume") is not None and t["volume"] < mean_vol * 0.5]
    if len(very_low) >= min_sample:
        fr = _failure_rate(very_low)
        if fr >= min_fail:
            results.append({
                "condition": "volume",
                "filter": {"volume_condition": "very_low", "volume_threshold": round(mean_vol * 0.5, 2)},
                "failure_rate": round(fr, 4),
                "sample_size": len(very_low),
                "avg_loss": round(_avg_loss(very_low), 2),
                "confidence": _confidence(fr, len(very_low)),
                "impact_if_filtered": _pnl_impact(very_low),
            })

    return results


def _mine_day_of_week(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if specific days of week produce more losers."""
    results: list[dict] = []
    day_names = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday", 4: "Friday", 5: "Saturday", 6: "Sunday"}
    day_buckets: dict[int, list[dict]] = {}

    for t in trades:
        dow = _get_day_of_week(t)
        if dow is not None:
            day_buckets.setdefault(dow, []).append(t)

    for day, group in day_buckets.items():
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "day_of_week",
                "filter": {"day": day, "day_name": day_names.get(day, str(day))},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_regime(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if specific regime conditions produce more losers."""
    results: list[dict] = []
    regime_buckets: dict[str, list[dict]] = {}

    for t in trades:
        regime = t.get("regime")
        if regime is not None:
            regime_buckets.setdefault(str(regime), []).append(t)

    for regime, group in regime_buckets.items():
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "regime",
                "filter": {"regime": regime},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_archetype(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if specific day archetypes produce more losers."""
    results: list[dict] = []
    arch_buckets: dict[str, list[dict]] = {}

    for t in trades:
        archetype = t.get("archetype")
        if archetype is not None:
            arch_buckets.setdefault(str(archetype), []).append(t)

    for archetype, group in arch_buckets.items():
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "archetype",
                "filter": {"archetype": archetype},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_event_proximity(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if trades near economic events fail more often."""
    results: list[dict] = []
    # Check trades with days_to_event field
    proximity_thresholds = [
        ("near_event_1d", 0, 1),
        ("near_event_2d", 0, 2),
        ("near_event_3d", 0, 3),
    ]

    for label, min_days, max_days in proximity_thresholds:
        group = [
            t for t in trades
            if t.get("days_to_event") is not None
            and min_days <= t["days_to_event"] <= max_days
        ]
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "event_proximity",
                "filter": {"label": label, "max_days_to_event": max_days},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results


def _mine_streak(
    trades: list[dict],
    bars: list[dict],
    min_sample: int,
    min_fail: float,
) -> list[dict]:
    """Check if trades after winning/losing streaks fail more often."""
    results: list[dict] = []

    # Annotate trades with preceding streak
    streak_groups: dict[str, list[dict]] = {}
    win_streak = 0
    loss_streak = 0

    for i, t in enumerate(trades):
        if i > 0:
            label = None
            if win_streak >= 2:
                label = f"after_{win_streak}_wins"
            elif loss_streak >= 2:
                label = f"after_{loss_streak}_losses"

            if label:
                streak_groups.setdefault(label, []).append(t)

        if t.get("pnl", 0) >= 0:
            win_streak += 1
            loss_streak = 0
        else:
            loss_streak += 1
            win_streak = 0

    for label, group in streak_groups.items():
        if len(group) < min_sample:
            continue
        fr = _failure_rate(group)
        if fr >= min_fail:
            results.append({
                "condition": "streak",
                "filter": {"streak_label": label},
                "failure_rate": round(fr, 4),
                "sample_size": len(group),
                "avg_loss": round(_avg_loss(group), 2),
                "confidence": _confidence(fr, len(group)),
                "impact_if_filtered": _pnl_impact(group),
            })
    return results
