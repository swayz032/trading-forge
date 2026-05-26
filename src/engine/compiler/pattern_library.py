"""
Pattern Library — registry of valid entry/exit patterns.
Used by the compiler to validate that entry_indicator + entry_params are coherent.
"""

from __future__ import annotations

ENTRY_PATTERNS: dict[str, dict] = {
    "sma_crossover": {
        "description": "Fast SMA crosses above/below slow SMA",
        "required_params": ["fast_period", "slow_period"],
        "optional_params": ["confirmation_bars"],
        "param_ranges": {
            "fast_period": (5, 50),
            "slow_period": (20, 200),
            "confirmation_bars": (1, 5),
        },
    },
    "ema_crossover": {
        "description": "Fast EMA crosses above/below slow EMA",
        "required_params": ["fast_period", "slow_period"],
        "optional_params": ["confirmation_bars"],
        "param_ranges": {
            "fast_period": (5, 50),
            "slow_period": (20, 200),
            "confirmation_bars": (1, 5),
        },
    },
    "rsi_reversal": {
        "description": "RSI crosses oversold/overbought threshold",
        "required_params": ["period", "oversold", "overbought"],
        "optional_params": [],
        "param_ranges": {
            "period": (7, 21),
            "oversold": (20, 40),
            "overbought": (60, 80),
        },
    },
    "bollinger_breakout": {
        "description": "Price breaks above/below Bollinger Band",
        "required_params": ["period", "std_dev"],
        "optional_params": ["confirmation_bars"],
        "param_ranges": {
            "period": (10, 30),
            "std_dev": (1.5, 3.0),
            "confirmation_bars": (1, 3),
        },
    },
    "atr_breakout": {
        "description": "Price moves beyond ATR-based channel",
        "required_params": ["period", "multiplier"],
        "optional_params": [],
        "param_ranges": {
            # W23H.1-postmortem (2026-05-20): expanded period floor 10 -> 5.
            # Common trader choices: 5-period (scalping), 7-period (short-term
            # breakout). pandas-ta atr() supports any positive integer.
            # Must stay in lockstep with PARAM_RANGES in direct-bucket-graduator.ts.
            "period": (5, 30),
            "multiplier": (1.0, 3.0),
        },
    },
    "vwap_reversion": {
        "description": "Price reverts toward VWAP after deviation",
        "required_params": ["deviation_threshold"],
        "optional_params": ["confirmation_bars"],
        "param_ranges": {
            "deviation_threshold": (0.5, 3.0),
            "confirmation_bars": (1, 5),
        },
    },
    "donchian_breakout": {
        "description": "Price breaks Donchian channel high/low",
        "required_params": ["period"],
        "optional_params": [],
        "param_ranges": {
            "period": (10, 55),
        },
    },
    "keltner_squeeze": {
        "description": "Bollinger bands squeeze inside Keltner channels then expand",
        "required_params": ["bb_period", "kc_period", "kc_multiplier"],
        "optional_params": [],
        "param_ranges": {
            "bb_period": (15, 25),
            "kc_period": (15, 25),
            "kc_multiplier": (1.0, 2.0),
        },
    },
    "session_open_breakout": {
        "description": "Price breaks above/below first N minutes range of session",
        "required_params": ["range_minutes"],
        "optional_params": ["buffer_ticks"],
        "param_ranges": {
            "range_minutes": (5, 60),
            "buffer_ticks": (1, 10),
        },
    },
    "macd_crossover": {
        "description": "MACD line crosses signal line",
        "required_params": ["fast_period", "slow_period", "signal_period"],
        "optional_params": [],
        "param_ranges": {
            "fast_period": (8, 16),
            "slow_period": (20, 30),
            "signal_period": (7, 12),
        },
    },
    "vwap_fade": {
        "description": "Fade price back toward session VWAP when extended beyond ATR threshold",
        "required_params": ["atr_extension_threshold"],
        "optional_params": ["confirmation_bars", "vwap_touch_exit"],
        "param_ranges": {
            "atr_extension_threshold": (1.0, 3.0),
            "confirmation_bars": (1, 5),
            "vwap_touch_exit": (0, 1),
        },
    },
    "event_driven_fade": {
        "description": "Fade extreme ATR move within a defined time window after a scheduled event",
        "required_params": ["atr_move_threshold", "event_window_minutes"],
        "optional_params": ["confirmation_bars"],
        "param_ranges": {
            "atr_move_threshold": (1.5, 4.0),
            "event_window_minutes": (5, 30),
            "confirmation_bars": (1, 3),
        },
    },
    "overnight_drift": {
        "description": "Detect session directional drift during Asia hours and enter at Europe open",
        "required_params": ["drift_atr_threshold", "asia_lookback_bars"],
        "optional_params": ["min_drift_bars"],
        "param_ranges": {
            "drift_atr_threshold": (0.5, 2.0),
            "asia_lookback_bars": (4, 24),
            "min_drift_bars": (2, 12),
        },
    },
    # Wave 25 Pass 5 — VWAP institutional archetypes
    "vwap_band_reject": {
        "description": (
            "Reversal entry when price tags the 2-sigma VWAP band and rejects back inside 1-sigma. "
            "Short: price touches vwap_band_2s_upper then closes below vwap_band_1s_upper. "
            "Long: price touches vwap_band_2s_lower then closes above vwap_band_1s_lower."
        ),
        "required_params": ["band_sigma"],
        "optional_params": ["confirmation_bars", "require_close_inside"],
        "param_ranges": {
            "band_sigma": (1.5, 2.5),        # which sigma band triggers (default 2.0)
            "confirmation_bars": (1, 3),
            "require_close_inside": (0, 1),  # 0=touch only, 1=must close back inside
        },
    },
    "anchored_vwap_retest": {
        "description": (
            "Entry when price returns to an anchored VWAP (anchored from a prior swing high/low "
            "or session open) and rejects. Long: price dips to anchored_vwap from above and bounces. "
            "Short: price rallies to anchored_vwap from below and fades."
        ),
        "required_params": ["anchor_lookback_bars"],
        "optional_params": ["confirmation_bars", "tolerance_ticks"],
        "param_ranges": {
            "anchor_lookback_bars": (1, 100),   # how far back to look for anchor swing
            "confirmation_bars": (1, 3),
            "tolerance_ticks": (1, 10),          # proximity to AVWAP that counts as a touch
        },
    },
    # bounce_off_level — MA-as-S/R signal class (price bounces off single MA).
    # DISTINCT from ema_crossover (MA vs MA cross): here ONE MA acts as a dynamic
    # S/R level.  Closed the graduation gap for the 6 mis-mapped MA-as-S/R
    # strategies that previously routed to ema_crossover (2026-05-26).
    "bounce_off_level": {
        "description": (
            "Price approaches a single moving average (SMA or EMA) and rejects off it. "
            "Long: price approaches MA from below, prints rejection candle, enters on confirmation bar. "
            "Short: price approaches MA from above, prints rejection candle, enters on confirmation bar. "
            "DIFFERENT from ema_crossover — single MA as dynamic S/R, not two MAs crossing."
        ),
        "required_params": ["ma_period"],
        "optional_params": ["ma_type", "proximity_atr_mult", "swing_lookback", "atr_period"],
        "param_ranges": {
            "ma_period": (10, 250),
            "proximity_atr_mult": (0.5, 3.0),
            "swing_lookback": (3, 20),
            "atr_period": (7, 21),
        },
    },
}


def get_pattern(name: str) -> dict | None:
    """Get entry pattern definition by name."""
    return ENTRY_PATTERNS.get(name)


def validate_entry_params(indicator: str, params: dict) -> tuple[bool, list[str]]:
    """
    Validate entry_params against the pattern library.
    Returns (valid, errors).
    Checks: required params present, no unknown params, values in range.
    """
    pattern = ENTRY_PATTERNS.get(indicator)
    if pattern is None:
        return False, [f"Unknown entry_indicator: '{indicator}'. Valid options: {list(ENTRY_PATTERNS.keys())}"]

    errors: list[str] = []
    required = set(pattern["required_params"])
    optional = set(pattern["optional_params"])
    allowed = required | optional

    # Check required params are present
    missing = required - set(params.keys())
    if missing:
        errors.append(f"Missing required params for '{indicator}': {sorted(missing)}")

    # Check for unknown params
    unknown = set(params.keys()) - allowed
    if unknown:
        errors.append(f"Unknown params for '{indicator}': {sorted(unknown)}. Allowed: {sorted(allowed)}")

    # Check param ranges
    ranges = pattern.get("param_ranges", {})
    for key, value in params.items():
        if key in ranges:
            lo, hi = ranges[key]
            if not (lo <= value <= hi):
                errors.append(
                    f"Param '{key}' value {value} out of range [{lo}, {hi}]"
                )

    return len(errors) == 0, errors


def list_patterns() -> list[str]:
    """Return all available pattern names."""
    return list(ENTRY_PATTERNS.keys())
