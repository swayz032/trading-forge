"""Constrained candidate selection for the critic optimizer.

Uses NVIDIA cuOpt for LP/MIP when available, greedy fallback otherwise.
"""
from __future__ import annotations
from typing import Any

import numpy as np

try:
    from cuopt.linear_programming import Solve, DataModel, SolverSettings
    CUOPT_AVAILABLE = True
except ImportError:
    CUOPT_AVAILABLE = False


DEFAULT_CONSTRAINTS = {
    "max_candidates": 3,
    "breach_ceiling": 0.3,
    "fragility_ceiling": 0.7,
    "max_drawdown_ceiling": 2500,
    "min_param_diversity": 0.2,
    "min_expected_uplift": 0.001,  # Low — backtester judges real uplift during replay
}


class CandidateSelector:
    """Select top K candidates subject to constraints using cuOpt or greedy fallback."""

    def select(
        self,
        candidates: list[dict],
        constraints: dict | None = None,
        max_k: int = 3,
    ) -> list[dict]:
        if not candidates:
            return []

        c = {**DEFAULT_CONSTRAINTS, **(constraints or {})}
        c["max_candidates"] = max_k

        if CUOPT_AVAILABLE:
            return self._cuopt_select(candidates, c)
        return self._greedy_select(candidates, c)

    def _passes_constraints(self, candidate: dict, constraints: dict) -> bool:
        """Check if a single candidate passes all hard constraints."""
        breach = float(candidate.get("breach_probability", 0) or 0)
        if breach > constraints["breach_ceiling"]:
            return False

        fragility = float(candidate.get("fragility_score", 0) or 0)
        if fragility > constraints["fragility_ceiling"]:
            return False

        max_dd = abs(float(candidate.get("max_drawdown", 0) or 0))
        if max_dd > constraints["max_drawdown_ceiling"]:
            return False

        uplift = float(candidate.get("expected_uplift", 0) or 0)
        if uplift < constraints["min_expected_uplift"]:
            return False

        return True

    def _greedy_select(self, candidates: list[dict], constraints: dict) -> list[dict]:
        """Fallback: filter by constraints, sort by composite score, take top K."""
        filtered = [c for c in candidates if self._passes_constraints(c, constraints)]
        sorted_candidates = sorted(
            filtered,
            key=lambda c: float(c.get("composite_score", 0) or 0),
            reverse=True,
        )
        return sorted_candidates[: constraints["max_candidates"]]

    def _cuopt_select(self, candidates: list[dict], constraints: dict) -> list[dict]:
        """cuOpt LP: maximize composite score subject to constraints.

        Uses cuOpt's DataModel + Solve for LP formulation.
        LP is valid for 3+ candidates (budget constraint + per-candidate bounds).
        Greedy fallback only for 1-2 candidates where LP is meaningless.
        """
        try:
            n = len(candidates)
            if n < 3:
                # LP adds no value for 1-2 candidates; greedy is sufficient
                return self._greedy_select(candidates, constraints)

            scores = np.array([float(c.get("composite_score", 0) or 0) for c in candidates])

            # Build LP: maximize c^T x subject to Ax <= b, 0 <= x <= 1
            # Decision: x_i = weight allocated to candidate i
            model = DataModel()

            # Objective coefficients (maximize composite scores)
            model.set_objective(scores.tolist())

            # Constraint: sum(x_i) <= max_candidates (budget)
            budget_row = [1.0] * n
            model.add_constraint(budget_row, "<=", float(constraints["max_candidates"]))

            # Per-candidate upper bounds (0 if violates hard constraints)
            upper_bounds = []
            for c in candidates:
                breach = float(c.get("breach_probability", 0) or 0)
                fragility = float(c.get("fragility_score", 0) or 0)
                if breach > constraints["breach_ceiling"] or fragility > constraints["fragility_ceiling"]:
                    upper_bounds.append(0.0)
                else:
                    upper_bounds.append(1.0)
            model.set_variable_bounds(upper=upper_bounds)

            settings = SolverSettings()
            solution = Solve(model, settings)

            # Select candidates where allocation > 0.5
            x = solution.get_primal()
            selected = [candidates[i] for i in range(n) if x[i] > 0.5]
            return selected if selected else self._greedy_select(candidates, constraints)

        except Exception:
            return self._greedy_select(candidates, constraints)
