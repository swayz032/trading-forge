"""Itemized roll-spread cost model — quarterly futures roll slippage.

MED #5 (Wave 27.5 Pass D.1): Quarterly rolls incur 2-4 tick spread cost
above the generic 1.5-tick slippage model.  Annual underestimate is
~6-8 ticks for MES.

Published CME micro-contract roll spread data (2025-2026 institutional standard):
    MES: 3 ticks   ($3.75 per contract per roll side)
    MNQ: 4 ticks   ($2.00 per contract per roll side)
    MCL: 2 ticks  ($2.00 per contract per roll side)

Note: These are PER-SIDE values (buy leg OR sell leg of the calendar spread).
A round-trip through a roll costs roll_ticks × 2 per contract.

Determinism: randomization (±0.5 tick) uses a seed derived from the roll date
ISO string so the same date+symbol always produces the same noise.  This
preserves replay determinism.

Env vars:
    BACKTEST_ROLL_SPREAD_ITEMIZED  (default "true")  — opt-OUT to bundle in generic slip
    ROLL_SPREAD_MES_TICKS          (default 3.0)     — MES override
    ROLL_SPREAD_MNQ_TICKS          (default 4.0)     — MNQ override
    ROLL_SPREAD_MCL_TICKS          (default 2.0)     — MCL override
    ROLL_SPREAD_ES_TICKS           (default 3.0)     — ES alias (micro-mapped)
    ROLL_SPREAD_NQ_TICKS           (default 4.0)     — NQ alias (micro-mapped)
    ROLL_SPREAD_CL_TICKS           (default 2.0)     — CL alias (micro-mapped)
"""

from __future__ import annotations

import hashlib
import os
from datetime import date
from decimal import Decimal
from functools import lru_cache

# ─── Env flag ────────────────────────────────────────────────────────────────
# deep-scan #8 wave 2 FIX 2: replaced module-level frozen reads with lru_cache
# getter functions so tests can call cache_clear() + set env → get the new value.
# Module-level frozen reads were a test-isolation hazard: monkeypatch(os.environ)
# after import had no effect on _ROLL_SPREAD_ITEMIZED / _DEFAULT_ROLL_TICKS.
#
# Usage in tests:
#   import src.engine.roll_spread_cost as rsc
#   rsc._get_roll_spread_itemized.cache_clear()
#   rsc._get_default_roll_ticks.cache_clear()
#   os.environ["BACKTEST_ROLL_SPREAD_ITEMIZED"] = "false"
#   # now the getter returns False for the lifetime of this test
#   rsc._get_roll_spread_itemized.cache_clear()  # restore after test


@lru_cache(maxsize=1)
def _get_roll_spread_itemized() -> bool:
    """Read BACKTEST_ROLL_SPREAD_ITEMIZED at call time (cached; clear for tests)."""
    return os.environ.get(
        "BACKTEST_ROLL_SPREAD_ITEMIZED", "true"
    ).lower() in ("true", "1", "yes")


@lru_cache(maxsize=1)
def _get_default_roll_ticks() -> dict:
    """Read ROLL_SPREAD_*_TICKS env vars at call time (cached; clear for tests).

    Values are HALF-SPREAD (per-side cost of the roll in ticks).
    Read from env so operators can override via deployment config.
    """
    return {
        "MES": float(os.environ.get("ROLL_SPREAD_MES_TICKS", "3.0")),
        "MNQ": float(os.environ.get("ROLL_SPREAD_MNQ_TICKS", "4.0")),
        "MCL": float(os.environ.get("ROLL_SPREAD_MCL_TICKS", "2.0")),
        # Micro-alias full-size symbols (CONTRACT_SPECS maps these to micro specs)
        "ES": float(os.environ.get("ROLL_SPREAD_ES_TICKS", "3.0")),
        "NQ": float(os.environ.get("ROLL_SPREAD_NQ_TICKS", "4.0")),
        "CL": float(os.environ.get("ROLL_SPREAD_CL_TICKS", "2.0")),
    }

# Fallback tick size and tick value per symbol for USD conversion.
# Mirrors CONTRACT_SPECS without creating a circular import.
_TICK_SIZE: dict[str, float] = {
    "MES": 0.25, "ES": 0.25,
    "MNQ": 0.25, "NQ": 0.25,
    "MCL": 0.01, "CL": 0.01,
}

_TICK_VALUE: dict[str, float] = {
    "MES": 1.25, "ES": 1.25,
    "MNQ": 0.50, "NQ": 0.50,
    "MCL": 1.00, "CL": 1.00,
}

# Noise amplitude: ±0.5 tick jitter to model real-world spread variability.
_NOISE_AMPLITUDE_TICKS: float = 0.5


def _deterministic_noise(symbol: str, roll_date: date) -> float:
    """Return deterministic noise in [-0.5, +0.5] ticks.

    Seed is derived from SHA-256 of '{symbol}:{roll_date.isoformat()}'
    so the same (symbol, date) pair always produces the same value
    regardless of execution order.  Replay determinism is preserved.
    """
    seed_str = f"{symbol}:{roll_date.isoformat()}"
    digest = hashlib.sha256(seed_str.encode()).digest()
    # Use first 4 bytes as a uint32, map to [-0.5, +0.5]
    uint_val = int.from_bytes(digest[:4], "big")
    # uint_val in [0, 2^32 - 1]; normalise to [-1, 1] then scale
    normalised = (uint_val / 0xFFFF_FFFF) * 2.0 - 1.0  # [-1, +1]
    return normalised * _NOISE_AMPLITUDE_TICKS


def _get_roll_ticks(symbol: str) -> float:
    """Return base roll spread in ticks for the given symbol.

    Falls back to MES if symbol not in the table.
    """
    ticks = _get_default_roll_ticks()
    return ticks.get(symbol.upper(), ticks["MES"])


def _ticks_to_usd(symbol: str, ticks: float) -> Decimal:
    """Convert ticks to USD using per-symbol tick value."""
    sym = symbol.upper()
    tv = _TICK_VALUE.get(sym, 1.25)  # default to MES tick value
    return Decimal(str(round(ticks * tv, 4)))


def compute_roll_spread_cost(
    symbol: str,
    roll_date: date,
    contracts: int,
) -> Decimal:
    """Compute itemised roll-spread cost for one side of the roll.

    This cost is deducted from trade P&L BEFORE generic slippage is applied on
    roll days.  The generic 1.5-tick slippage still applies on top.

    When BACKTEST_ROLL_SPREAD_ITEMIZED=false the function returns Decimal("0"),
    preserving backward-compat by bundling roll cost into the generic model.

    Args:
        symbol:     Futures symbol (MES / MNQ / MCL or aliases).
        roll_date:  Calendar date of the roll (CME-published schedule).
        contracts:  Number of contracts in the position being rolled.

    Returns:
        Total cost in USD as a Decimal (always ≥ 0).
        Returns Decimal("0") when itemisation is disabled.
    """
    if not _get_roll_spread_itemized():
        return Decimal("0")

    if contracts <= 0:
        return Decimal("0")

    base_ticks = _get_roll_ticks(symbol)
    noise_ticks = _deterministic_noise(symbol, roll_date)
    total_ticks = max(0.0, base_ticks + noise_ticks)

    cost_per_contract = _ticks_to_usd(symbol, total_ticks)
    return cost_per_contract * contracts


def build_roll_spread_audit(
    symbol: str,
    roll_date: date,
    contracts: int,
    total_cost_usd: Decimal,
) -> dict:
    """Build audit payload for backtest.roll_spread_itemized audit row.

    Args:
        symbol:         Futures symbol.
        roll_date:      Calendar date of the roll.
        contracts:      Number of contracts charged.
        total_cost_usd: USD cost returned by compute_roll_spread_cost().

    Returns:
        Dict ready for JSON serialization in result["execution_audit"]["roll_spreads"].
    """
    base_ticks = _get_roll_ticks(symbol)
    noise_ticks = _deterministic_noise(symbol, roll_date)
    actual_ticks = max(0.0, base_ticks + noise_ticks)

    return {
        "symbol": symbol,
        "roll_date": roll_date.isoformat(),
        "ticks_base": round(base_ticks, 3),
        "ticks_noise": round(noise_ticks, 3),
        "ticks_charged": round(actual_ticks, 3),
        "contracts": contracts,
        "total_cost_usd": float(total_cost_usd),
        "itemized": _get_roll_spread_itemized(),
    }
