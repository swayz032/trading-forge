"""Per-strategy governor configuration."""

from __future__ import annotations

from typing import Any

DEFAULT_CONFIG: dict[str, Any] = {
    "daily_loss_budget": 500.0,
    "consecutive_loss_threshold": {
        "alert": 2,
        "cautious": 3,
        "defensive": 4,
        "lockout": 5,
    },
    "session_loss_pct_threshold": {
        "alert": 0.30,
        "cautious": 0.50,
        "defensive": 0.65,
        "lockout": 0.80,
    },
    "recovery_profitable_sessions": 2,
    "enabled": True,
}

# Aggressive config for volatile strategies
AGGRESSIVE_CONFIG: dict[str, Any] = {
    **DEFAULT_CONFIG,
    "daily_loss_budget": 750.0,
    "consecutive_loss_threshold": {
        "alert": 3,
        "cautious": 4,
        "defensive": 5,
        "lockout": 6,
    },
}

# Conservative config for prop firm evaluation
CONSERVATIVE_CONFIG: dict[str, Any] = {
    **DEFAULT_CONFIG,
    "daily_loss_budget": 300.0,
    "consecutive_loss_threshold": {
        "alert": 1,
        "cautious": 2,
        "defensive": 3,
        "lockout": 4,
    },
}


def get_config(profile: str = "default") -> dict:
    """Get governor config by profile name."""
    configs = {
        "default": DEFAULT_CONFIG,
        "aggressive": AGGRESSIVE_CONFIG,
        "conservative": CONSERVATIVE_CONFIG,
    }
    return configs.get(profile, DEFAULT_CONFIG)
