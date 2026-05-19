"""Prop-firm survival model -- risk event definitions for quantum estimation.

Defines breach, target-hit, tail-loss, and risk-band events using firm rules.
These events are what the quantum amplitude estimation engine estimates.

Usage:
    python -m src.engine.prop_survival_model --input-json '{"firm_key": "topstep_50k", "data": [...]}'
"""
from __future__ import annotations

import json
import sys
from typing import Optional

import numpy as np
from pydantic import BaseModel, Field

from src.engine.quantum_models import UncertaintyModel, fit_truncated_normal, build_empirical_binned_distribution
from src.engine.firm_config import FIRM_RULES


class RiskEvent(BaseModel):
    """A risk event definition for quantum amplitude estimation."""
    event_type: str  # breach | target_hit | tail_loss | ruin
    description: str
    threshold: float
    firm_key: Optional[str] = None
    starting_balance: float = 50_000.0
    parameters: dict = Field(default_factory=dict)


class PropSurvivalResult(BaseModel):
    """Result of prop survival analysis."""
    firm_key: str
    events: list[RiskEvent]
    classical_estimates: dict[str, float] = Field(default_factory=dict)
    risk_band_map: Optional[dict] = None


def build_breach_event(firm_key: str, starting_balance: float = 50_000.0) -> RiskEvent:
    """P(hit max_drawdown before profit_target).

    The most critical prop firm event -- if this probability is high,
    the strategy will blow the account before getting funded.
    """
    rules = FIRM_RULES.get(firm_key, FIRM_RULES["topstep_50k"])
    return RiskEvent(
        event_type="breach",
        description=f"P(drawdown >= ${rules['max_drawdown']} before profit >= ${rules['profit_target']})",
        threshold=float(rules["max_drawdown"]),
        firm_key=firm_key,
        starting_balance=starting_balance,
        parameters={
            "max_drawdown": rules["max_drawdown"],
            "profit_target": rules["profit_target"],
            "account_size": rules["account_size"],
        },
    )


def build_target_event(firm_key: str, starting_balance: float = 50_000.0) -> RiskEvent:
    """P(hit profit_target before max_drawdown breach).

    The complement of breach -- what are the odds of passing evaluation?
    """
    rules = FIRM_RULES.get(firm_key, FIRM_RULES["topstep_50k"])
    return RiskEvent(
        event_type="target_hit",
        description=f"P(profit >= ${rules['profit_target']} before drawdown >= ${rules['max_drawdown']})",
        threshold=float(rules["profit_target"]),
        firm_key=firm_key,
        starting_balance=starting_balance,
        parameters={
            "max_drawdown": rules["max_drawdown"],
            "profit_target": rules["profit_target"],
            "account_size": rules["account_size"],
        },
    )


def build_tail_loss_event(threshold: float, distribution: Optional[UncertaintyModel] = None) -> RiskEvent:
    """P(single-day loss > threshold).

    Catastrophic single-day loss probability. Critical for firms with daily loss limits.
    """
    return RiskEvent(
        event_type="tail_loss",
        description=f"P(single-day loss > ${threshold})",
        threshold=threshold,
        parameters={"distribution": distribution.model_dump() if distribution else None},
    )


def build_risk_band_scenarios(
    firm_key: str,
    risk_range: tuple[float, float] = (100.0, 500.0),
    n_steps: int = 9,
) -> dict[float, dict]:
    """Map risk-per-trade to survival probability.

    For each risk level, compute the theoretical breach/target probabilities.
    This helps the trader find the optimal risk-per-trade level.

    Args:
        firm_key: Firm identifier
        risk_range: (min_risk, max_risk) per trade in dollars
        n_steps: Number of risk levels to evaluate

    Returns:
        Dict mapping risk_per_trade -> {breach_prob, target_prob, expected_trades_to_breach, ...}
    """
    rules = FIRM_RULES.get(firm_key, FIRM_RULES["topstep_50k"])
    max_dd = rules["max_drawdown"]
    profit_target = rules["profit_target"]

    risk_levels = np.linspace(risk_range[0], risk_range[1], n_steps)
    result = {}

    for risk in risk_levels:
        risk = float(risk)
        # Simple gambler's ruin approximation
        # p = win_rate, q = 1-p
        # For a symmetric random walk: P(ruin) = (q/p)^n where n = max_dd/risk
        # We use 0.55 as default win rate (conservative)
        win_rate = 0.55
        steps_to_breach = max_dd / risk
        steps_to_target = profit_target / risk

        if win_rate == 0.5:
            breach_prob = steps_to_target / (steps_to_breach + steps_to_target)
        else:
            r = (1 - win_rate) / win_rate
            breach_prob = (1 - r ** steps_to_target) / (1 - r ** (steps_to_breach + steps_to_target))
            breach_prob = max(0.0, min(1.0, breach_prob))

        result[risk] = {
            "breach_probability": round(breach_prob, 4),
            "target_probability": round(1 - breach_prob, 4),
            "expected_trades_to_breach": round(steps_to_breach, 1),
            "expected_trades_to_target": round(steps_to_target, 1),
            "risk_per_trade": risk,
        }

    return result


def estimate_classical_survival(
    daily_pnls: np.ndarray,
    firm_key: str,
    n_sims: int = 10_000,
    seed: int = 42,
) -> dict[str, float]:
    """Classical MC estimate of survival metrics for comparison with quantum.

    Runs simple bootstrap MC to get breach/target probabilities.
    Used as the baseline for quantum challenger comparison.
    """
    rules = FIRM_RULES.get(firm_key, FIRM_RULES["topstep_50k"])
    max_dd = rules["max_drawdown"]
    profit_target = rules["profit_target"]

    rng = np.random.default_rng(seed)
    n_days = len(daily_pnls)

    breach_count = 0
    target_count = 0

    for _ in range(n_sims):
        # Bootstrap resample daily P&Ls
        indices = rng.integers(0, n_days, size=n_days)
        sim_pnls = daily_pnls[indices]

        equity = 0.0
        peak = 0.0
        breached = False
        hit_target = False

        for pnl in sim_pnls:
            equity += pnl
            peak = max(peak, equity)
            drawdown = peak - equity

            if drawdown >= max_dd:
                breached = True
                break
            if equity >= profit_target:
                hit_target = True
                break

        if breached:
            breach_count += 1
        elif hit_target:
            target_count += 1

    return {
        "breach_probability": breach_count / n_sims,
        "target_probability": target_count / n_sims,
        "neither_probability": (n_sims - breach_count - target_count) / n_sims,
        "n_simulations": n_sims,
    }


if __name__ == "__main__":
    import argparse
    import os
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-json", required=True)
    args = parser.parse_args()

    raw = args.input_json
    if os.path.isfile(raw):
        with open(raw) as f:
            raw = f.read()
    config = json.loads(raw)
    firm_key = config.get("firm_key", "topstep_50k")

    result = PropSurvivalResult(firm_key=firm_key, events=[])

    # Build events
    result.events.append(build_breach_event(firm_key))
    result.events.append(build_target_event(firm_key))

    if config.get("daily_loss_limit_threshold"):
        result.events.append(build_tail_loss_event(config["daily_loss_limit_threshold"]))

    # Risk band analysis
    if config.get("risk_range"):
        result.risk_band_map = build_risk_band_scenarios(
            firm_key,
            risk_range=tuple(config["risk_range"]),
        )
    else:
        result.risk_band_map = build_risk_band_scenarios(firm_key)

    # Classical estimates if data provided
    if config.get("data"):
        data = np.array(config["data"], dtype=float)
        result.classical_estimates = estimate_classical_survival(data, firm_key)

    print(result.model_dump_json(indent=2))
