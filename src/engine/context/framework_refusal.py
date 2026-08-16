"""FRAMEWORK RISK REFUSAL — the mandatory layer that no overlay bypass may skip.

Authority: GPT ruling AR-1210 §4/§5. The boundary this module exists to enforce, verbatim:

    NEW/UNREGISTERED may bypass PLAYBOOK/CONFLUENCE OVERLAY policy, but NEW/UNREGISTERED
    may NEVER bypass FRAMEWORK RISK / REFUSAL policy.

WHY A SEPARATE MODULE. Before AR-1210 the structural-stop ceiling refusal lived as
"Check 0" inside `eligibility_gate.evaluate_signal`, physically below the
unregistered-strategy passthrough. Two different policies — one MANDATORY (framework risk),
one OPTIONAL (playbook/confluence overlay) — shared one function and one exit order, so
bypassing the optional one silently bypassed the mandatory one. Naming the mandatory layer
separately is what makes the ordering explicit and testable rather than positional.

ONE CANONICAL PREDICATE, reused by every path (AR-1210 §5 LANE B: "Do not duplicate
business rules into two independently drifting implementations"). Callers ask this module;
they do not re-derive ceilings, and they must not compute a second, competing stop.

SKIP-NOT-CLAMP is preserved: this module never modifies a stop. It reports refusal and the
caller declines the setup. `structural_stops.compute_structural_stop` already keeps the
computed price intact and raises `skip_trade` (CLAUDE.md §4).
"""
from __future__ import annotations

from dataclasses import dataclass

__all__ = ["FrameworkRefusal", "evaluate_framework_risk"]


@dataclass(frozen=True)
class FrameworkRefusal:
    """Result of the mandatory framework-risk layer.

    `refused=False` means only that the checks in THIS layer found nothing. It is not a
    statement that the setup is tradeable — the optional overlay and downstream gates
    still apply.
    """
    refused: bool
    reason: str | None = None

    def __bool__(self) -> bool:  # `if refusal:` reads as "was it refused"
        return self.refused


def evaluate_framework_risk(stop_plan) -> FrameworkRefusal:
    """Mandatory refusals that apply to EVERY signal, registered or not.

    Currently one member: the structural stop exceeded its per-symbol ceiling, meaning the
    structural invalidation level is too far away for a valid stop to exist for this setup
    (deep-scan #8, 2026-07-02). `compute_structural_stop` sets `skip_trade=True` there and
    preserves the un-clamped price.

    New mandatory framework refusals belong HERE, so that adding one automatically covers
    every path rather than only the path its author happened to be editing.
    """
    if getattr(stop_plan, "skip_trade", False):
        return FrameworkRefusal(True, f"SKIP_TRADE: {stop_plan.stop_reason}")
    return FrameworkRefusal(False)
