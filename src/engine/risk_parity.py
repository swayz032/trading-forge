"""Risk parity allocation across simultaneously-running strategies.

W13 B7 — Risk Parity Module.

When N strategies run simultaneously, their combined position risk must be
distributed so no single strategy can blow the portfolio.  Risk parity
achieves this by allocating contracts INVERSELY proportional to each
strategy's volatility:

    weight_i = (1 / vol_i) / sum(1 / vol_j for j in 1..N)
    contracts_i = floor(total_contracts * weight_i)

This guarantees:
  - High-volatility strategies receive fewer contracts.
  - Low-volatility strategies receive more contracts.
  - Each strategy contributes approximately equal dollar risk to the portfolio.

Contracts are always integers (floor), and each strategy is capped at its
individual firm_max.  Remainders from floor() are distributed to the
lowest-volatility strategies first (they are most risk-efficient).

The module is pure Python, zero paid dependencies.
"""

from __future__ import annotations

import logging
import math
from typing import Sequence

logger = logging.getLogger(__name__)


def allocate_risk_parity(
    volatilities: Sequence[float],
    total_contracts: int,
    firm_maxes: Sequence[int] | None = None,
) -> list[int]:
    """Allocate contracts across N strategies using inverse-volatility risk parity.

    Args:
        volatilities: Per-strategy volatility measures (e.g., annualised ATR-based vol,
            standard deviation of daily returns, or any positive scalar).
            Must have at least one entry.  All values must be > 0.
        total_contracts: Total number of contracts available to allocate across
            all strategies.  Must be >= 0.
        firm_maxes: Optional per-strategy hard caps from firm contract limits.
            Must be the same length as volatilities when provided.
            Contracts for strategy i are clamped to firm_maxes[i] AFTER parity
            weights are applied.  Remainder from capping is redistributed.

    Returns:
        list[int]: Contract count per strategy (same order as volatilities).
        Sum is <= total_contracts (may be < due to integer floor and firm caps).

    Raises:
        ValueError: If any volatility is <= 0 or inputs are inconsistent.

    Examples:
        # Equal vols -> equal allocation
        allocate_risk_parity([1.0, 1.0, 1.0], 30) -> [10, 10, 10]

        # Vol [1, 2, 4]: weights [4/7, 2/7, 1/7]
        allocate_risk_parity([1.0, 2.0, 4.0], 7) -> [4, 2, 1]

        # With firm cap: strategy 0 capped at 3 even if weight says 5
        allocate_risk_parity([1.0, 2.0], 10, firm_maxes=[3, 10]) -> [3, 5]
    """
    n = len(volatilities)
    if n == 0:
        raise ValueError("volatilities must have at least one entry")
    if total_contracts < 0:
        raise ValueError(f"total_contracts must be >= 0, got {total_contracts}")
    for i, v in enumerate(volatilities):
        if v <= 0.0:
            raise ValueError(f"volatilities[{i}] must be > 0, got {v}")

    if firm_maxes is not None and len(firm_maxes) != n:
        raise ValueError(
            f"firm_maxes length {len(firm_maxes)} does not match "
            f"volatilities length {n}"
        )

    if total_contracts == 0:
        return [0] * n

    # Inverse-volatility weights
    inv_vols = [1.0 / v for v in volatilities]
    inv_vol_sum = sum(inv_vols)
    weights = [iv / inv_vol_sum for iv in inv_vols]

    # Initial allocation — floor to ensure we never exceed total
    allocated = [math.floor(w * total_contracts) for w in weights]

    # Apply firm caps
    if firm_maxes is not None:
        for i in range(n):
            if allocated[i] > firm_maxes[i]:
                allocated[i] = firm_maxes[i]

    # Distribute remainder from floor() and capping.
    # Remainder contracts go to strategies with highest inverse-vol weight first
    # (lowest volatility = most risk-efficient) and that have room below their cap.
    remainder = total_contracts - sum(allocated)
    if remainder > 0:
        # Sort indices by descending weight (highest inv-vol = lowest vol first)
        order = sorted(range(n), key=lambda i: weights[i], reverse=True)
        for idx in order:
            if remainder <= 0:
                break
            cap = firm_maxes[idx] if firm_maxes is not None else total_contracts
            if allocated[idx] < cap:
                allocated[idx] += 1
                remainder -= 1

    logger.debug(
        "risk_parity.allocated vols=%s weights=%s total=%d result=%s",
        list(volatilities),
        [f"{w:.4f}" for w in weights],
        total_contracts,
        allocated,
    )

    return allocated


def compute_portfolio_risk_parity(
    strategies: list[dict],
    total_contracts: int,
) -> list[dict]:
    """High-level wrapper: compute risk-parity allocation for a strategy portfolio.

    Args:
        strategies: List of strategy dicts, each must contain:
            {
                "name": str,              # strategy identifier
                "volatility": float,      # e.g., 30-day realised vol of daily returns
                "firm_max": int,          # firm contract cap for this strategy
            }
        total_contracts: Total contracts available to the portfolio.

    Returns:
        List of strategy dicts with "allocated_contracts" key added.
        Preserves original strategy dict contents, adds "allocated_contracts": int.

    Raises:
        ValueError: If any strategy is missing required fields or volatility <= 0.

    Example:
        strategies = [
            {"name": "scalper_mes", "volatility": 1.0, "firm_max": 5},
            {"name": "trend_mnq",   "volatility": 2.0, "firm_max": 10},
            {"name": "heavy_mcl",   "volatility": 4.0, "firm_max": 8},
        ]
        result = compute_portfolio_risk_parity(strategies, 21)
        # Returns same list with "allocated_contracts" key populated.
    """
    for i, s in enumerate(strategies):
        if "volatility" not in s:
            raise ValueError(f"strategies[{i}] missing 'volatility' key")
        if "firm_max" not in s:
            raise ValueError(f"strategies[{i}] missing 'firm_max' key")

    vols = [float(s["volatility"]) for s in strategies]
    maxes = [int(s["firm_max"]) for s in strategies]

    allocations = allocate_risk_parity(vols, total_contracts, maxes)

    results = []
    for s, alloc in zip(strategies, allocations):
        entry = dict(s)
        entry["allocated_contracts"] = alloc
        results.append(entry)

    return results
