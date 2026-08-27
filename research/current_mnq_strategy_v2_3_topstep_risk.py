#!/usr/bin/env python3
"""Topstep-oriented live risk overlay for MNQ v2.3.

Signal semantics stay fixed. The risk overlay may only REDUCE requested size or
refuse the trade. It never enlarges size beyond strategy intent.

The key invariant is interpretable rather than P&L tuned: current MLL headroom
must be large enough to survive at least `min_same_stop_survival` full-stop days
at the selected size, including fees and configured slippage stress.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

POINT_VALUE = 2.0
ROUND_TRIP_FEE_PER_CONTRACT = 1.22
DEFAULT_TICK = 0.25


@dataclass(frozen=True)
class RiskEnvelope:
    account_size_label: str
    current_balance: float
    mll_floor: float
    daily_realized_unrealized: float = 0.0
    dll_remaining: float | None = None
    platform_max_micros: int = 50

    @property
    def mll_headroom(self) -> float:
        return self.current_balance - self.mll_floor


@dataclass(frozen=True)
class SizeDecision:
    approved: bool
    desired_qty: int
    safe_qty: int
    worst_case_loss_per_contract: float
    headroom: float
    reasons: tuple[str, ...]


def worst_case_loss_per_contract(stop_points: float, slippage_points: float,
                                 point_value: float = POINT_VALUE,
                                 fee: float = ROUND_TRIP_FEE_PER_CONTRACT) -> float:
    if stop_points <= 0 or slippage_points < 0 or point_value <= 0 or fee < 0:
        raise ValueError("invalid risk inputs")
    return (stop_points + slippage_points) * point_value + fee


def survival_safe_qty(
    desired_qty: int,
    envelope: RiskEnvelope,
    stop_points: float = 17.25,
    slippage_points: float = 2.0,
    min_same_stop_survival: int = 3,
) -> SizeDecision:
    reasons: list[str] = []
    if desired_qty <= 0:
        return SizeDecision(False, desired_qty, 0, 0.0, envelope.mll_headroom, ("INVALID_DESIRED_QTY",))
    if min_same_stop_survival < 2:
        raise ValueError("min_same_stop_survival must be >=2")
    headroom = envelope.mll_headroom
    per = worst_case_loss_per_contract(stop_points, slippage_points)
    if headroom <= 0:
        return SizeDecision(False, desired_qty, 0, per, headroom, ("NO_MLL_HEADROOM",))

    by_mll = math.floor(headroom / (per * min_same_stop_survival))
    by_platform = int(envelope.platform_max_micros)
    by_dll = by_platform
    if envelope.dll_remaining is not None:
        if envelope.dll_remaining <= 0:
            by_dll = 0
        else:
            by_dll = math.floor(float(envelope.dll_remaining) / per)

    safe = max(0, min(int(desired_qty), by_mll, by_platform, by_dll))
    if safe <= 0:
        reasons.append("RISK_ENVELOPE_REFUSE")
    if safe < desired_qty:
        reasons.append("SIZE_REDUCED_TO_PRESERVE_SURVIVAL_HEADROOM")
    if desired_qty > by_platform:
        reasons.append("PLATFORM_MICRO_LIMIT")
    return SizeDecision(safe > 0, desired_qty, safe, per, headroom, tuple(reasons))


def verify_order_risk(qty: int, envelope: RiskEnvelope, stop_points: float,
                      slippage_points: float, min_same_stop_survival: int = 3) -> None:
    d = survival_safe_qty(qty, envelope, stop_points, slippage_points, min_same_stop_survival)
    if not d.approved or d.safe_qty < qty:
        raise RuntimeError(
            f"TOPSTEP_RISK_REFUSE:requested={qty}:safe={d.safe_qty}:headroom={d.headroom:.2f}:"
            + "|".join(d.reasons)
        )
