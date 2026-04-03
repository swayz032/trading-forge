"""Quasi-Monte Carlo samplers for Trading Forge.

QMC provides better coverage than IID random sampling for:
- Parameter-space exploration (critic candidate generation)
- Stress scenario generation (uniform coverage of tail events)
- Walk-forward fold selection (representative date ranges)
"""
from __future__ import annotations

import numpy as np

try:
    from scipy.stats import qmc
    QMC_AVAILABLE = True
except ImportError:
    QMC_AVAILABLE = False


class QMCSampler:
    """Low-discrepancy sampling for parameter search and stress scenarios."""

    def sobol_sample(self, n_samples: int, n_dims: int, scramble: bool = True, seed: int = 42) -> np.ndarray:
        """Scrambled Sobol sequence for low-discrepancy sampling.

        1024 Sobol points cover the space more uniformly than 10,000 random points.
        """
        if not QMC_AVAILABLE:
            rng = np.random.default_rng(seed)
            return rng.random((n_samples, n_dims))

        sampler = qmc.Sobol(d=n_dims, scramble=scramble, seed=seed)
        m = int(np.ceil(np.log2(max(n_samples, 2))))
        raw = sampler.random_base2(m=m)
        return raw[:n_samples]

    def halton_sample(self, n_samples: int, n_dims: int, seed: int = 42) -> np.ndarray:
        """Halton sequence — good for moderate dimensions (< 20)."""
        if not QMC_AVAILABLE:
            rng = np.random.default_rng(seed)
            return rng.random((n_samples, n_dims))

        sampler = qmc.Halton(d=n_dims, scramble=True, seed=seed)
        return sampler.random(n_samples)

    def lhs_sample(self, n_samples: int, n_dims: int, seed: int = 42) -> np.ndarray:
        """Latin Hypercube — guaranteed coverage of marginal distributions."""
        if not QMC_AVAILABLE:
            rng = np.random.default_rng(seed)
            return rng.random((n_samples, n_dims))

        sampler = qmc.LatinHypercube(d=n_dims, seed=seed)
        return sampler.random(n_samples)

    def stress_scenarios(
        self,
        n_scenarios: int,
        param_bounds: dict[str, tuple[float, float]],
        method: str = "sobol",
    ) -> list[dict[str, float]]:
        """Generate stress test parameter combinations with QMC coverage.

        Maps unit hypercube samples to actual parameter ranges.

        Args:
            n_scenarios: Number of scenarios to generate
            param_bounds: {param_name: (low, high)}
            method: "sobol" | "halton" | "lhs"

        Returns:
            List of dicts, each mapping param names to sampled values
        """
        dims = len(param_bounds)
        if dims == 0:
            return []

        names = list(param_bounds.keys())
        bounds = [param_bounds[n] for n in names]

        if method == "sobol":
            raw = self.sobol_sample(n_scenarios, dims)
        elif method == "halton":
            raw = self.halton_sample(n_scenarios, dims)
        else:
            raw = self.lhs_sample(n_scenarios, dims)

        scenarios = []
        for row in raw:
            scenario = {}
            for i, name in enumerate(names):
                lo, hi = bounds[i]
                scenario[name] = lo + row[i] * (hi - lo)
            scenarios.append(scenario)
        return scenarios

    def candidate_points(
        self,
        n_points: int,
        consensus_regions: dict[str, tuple[float, float]],
        method: str = "sobol",
    ) -> list[dict[str, float]]:
        """Generate candidate parameter points within consensus regions.

        Same as stress_scenarios but named for clarity in critic context.
        """
        return self.stress_scenarios(n_points, consensus_regions, method)
