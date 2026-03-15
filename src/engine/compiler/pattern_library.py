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
            "period": (10, 30),
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
