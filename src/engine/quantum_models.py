"""Uncertainty model fitting -- discrete distributions from MC data.

Fits parametric and non-parametric models to Monte Carlo trade/P&L arrays.
These models are the input to quantum amplitude estimation circuits.

Usage:
    python -m src.engine.quantum_models --input-json '{"data": [...], "model": "truncated_normal"}'
"""
from __future__ import annotations

import json
import sys
import hashlib
from typing import Optional, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

try:
    from scipy import stats
    from scipy.optimize import minimize
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


class UncertaintyModel(BaseModel):
    """Serializable uncertainty model."""
    model_type: str  # truncated_normal | mixture | regime_bucket | empirical_binned
    parameters: dict  # Model-specific params
    n_samples: int  # Number of data points used to fit
    bounds: Optional[tuple[Optional[float], Optional[float]]] = None
    bins: Optional[list[float]] = None  # Bin edges for discrete representation
    probabilities: Optional[list[float]] = None  # P(X in bin_i) for each bin
    metadata: dict = Field(default_factory=dict)

    model_config = ConfigDict(arbitrary_types_allowed=True)


def fit_truncated_normal(data: np.ndarray, bounds: tuple[float, float] = (-np.inf, np.inf)) -> UncertaintyModel:
    """Fit a truncated normal distribution to data.

    Args:
        data: Array of P&L values or drawdowns
        bounds: (lower, upper) truncation bounds
    """
    mu = float(np.mean(data))
    sigma = float(np.std(data, ddof=1))
    sigma = max(sigma, 1e-8)  # Prevent zero std

    # Discretize into bins for quantum circuit loading
    n_bins = min(64, max(8, int(np.sqrt(len(data)))))
    bin_edges = np.linspace(
        max(bounds[0], mu - 4 * sigma),
        min(bounds[1], mu + 4 * sigma),
        n_bins + 1,
    )

    # Compute bin probabilities from truncated normal CDF
    if SCIPY_AVAILABLE:
        a = (bounds[0] - mu) / sigma if np.isfinite(bounds[0]) else -np.inf
        b = (bounds[1] - mu) / sigma if np.isfinite(bounds[1]) else np.inf
        rv = stats.truncnorm(a, b, loc=mu, scale=sigma)
        probs = np.diff(rv.cdf(bin_edges))
    else:
        # Fallback: histogram
        hist, _ = np.histogram(data, bins=bin_edges, density=True)
        probs = hist * np.diff(bin_edges)

    probs = probs / probs.sum()  # Normalize

    return UncertaintyModel(
        model_type="truncated_normal",
        parameters={"mu": mu, "sigma": sigma, "a": float(bounds[0]), "b": float(bounds[1])},
        n_samples=len(data),
        bounds=bounds,
        bins=bin_edges.tolist(),
        probabilities=probs.tolist(),
    )


def fit_mixture_model(data: np.ndarray, n_components: int = 2) -> UncertaintyModel:
    """Fit a Gaussian mixture model to data.

    Captures bimodal distributions (e.g., winning vs losing trade distributions).
    """
    if not SCIPY_AVAILABLE:
        # Fallback to empirical
        return build_empirical_binned_distribution(data)

    # Simple EM-like fitting using scipy
    # Split data into n_components clusters via quantiles
    quantiles = np.linspace(0, 1, n_components + 1)
    boundaries = np.quantile(data, quantiles)

    weights = []
    means = []
    stds = []

    for i in range(n_components):
        mask = (data >= boundaries[i]) & (data < boundaries[i + 1])
        if i == n_components - 1:
            mask = (data >= boundaries[i]) & (data <= boundaries[i + 1])
        subset = data[mask]
        if len(subset) == 0:
            continue
        weights.append(len(subset) / len(data))
        means.append(float(np.mean(subset)))
        stds.append(float(max(np.std(subset, ddof=1), 1e-8)))

    # Discretize
    n_bins = min(64, max(8, int(np.sqrt(len(data)))))
    bin_edges = np.linspace(data.min(), data.max(), n_bins + 1)

    # Compute mixture probabilities
    probs = np.zeros(n_bins)
    for w, m, s in zip(weights, means, stds):
        rv = stats.norm(loc=m, scale=s)
        probs += w * np.diff(rv.cdf(bin_edges))

    probs = probs / probs.sum()

    return UncertaintyModel(
        model_type="mixture",
        parameters={
            "n_components": len(weights),
            "weights": weights,
            "means": means,
            "stds": stds,
        },
        n_samples=len(data),
        bins=bin_edges.tolist(),
        probabilities=probs.tolist(),
    )


def fit_regime_bucket_model(data: np.ndarray, regime_labels: np.ndarray) -> UncertaintyModel:
    """Fit separate distributions per regime.

    Args:
        data: P&L values
        regime_labels: Array of regime labels (same length as data)
    """
    unique_regimes = np.unique(regime_labels)
    regime_models = {}

    for regime in unique_regimes:
        mask = regime_labels == regime
        subset = data[mask]
        if len(subset) < 3:
            continue
        sub_model = fit_truncated_normal(subset)
        regime_models[str(regime)] = sub_model.model_dump()

    # Overall discretization
    n_bins = min(64, max(8, int(np.sqrt(len(data)))))
    bin_edges = np.linspace(data.min(), data.max(), n_bins + 1)
    hist, _ = np.histogram(data, bins=bin_edges, density=True)
    probs = hist * np.diff(bin_edges)
    probs = probs / probs.sum()

    return UncertaintyModel(
        model_type="regime_bucket",
        parameters={"regime_models": regime_models, "regimes": [str(r) for r in unique_regimes]},
        n_samples=len(data),
        bins=bin_edges.tolist(),
        probabilities=probs.tolist(),
    )


def build_empirical_binned_distribution(data: np.ndarray, n_bins: int = 32) -> UncertaintyModel:
    """Build histogram-based discrete distribution.

    Non-parametric -- makes no distributional assumptions. Best when data
    doesn't fit standard distributions (fat tails, multimodal, etc.).
    """
    n_bins = min(n_bins, max(4, int(np.sqrt(len(data)))))
    hist, bin_edges = np.histogram(data, bins=n_bins, density=True)
    probs = hist * np.diff(bin_edges)
    probs = probs / probs.sum()

    return UncertaintyModel(
        model_type="empirical_binned",
        parameters={"n_bins": n_bins, "data_range": [float(data.min()), float(data.max())]},
        n_samples=len(data),
        bins=bin_edges.tolist(),
        probabilities=probs.tolist(),
    )


def serialize_uncertainty_model(model: UncertaintyModel) -> str:
    """Serialize model to JSON string for DB persistence."""
    return model.model_dump_json()


def deserialize_uncertainty_model(json_str: str) -> UncertaintyModel:
    """Deserialize model from JSON string."""
    return UncertaintyModel.model_validate_json(json_str)


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
    data = np.array(config["data"], dtype=float)
    model_type = config.get("model", "truncated_normal")

    if model_type == "truncated_normal":
        bounds = tuple(config.get("bounds", [-np.inf, np.inf]))
        result = fit_truncated_normal(data, bounds)
    elif model_type == "mixture":
        n_comp = config.get("n_components", 2)
        result = fit_mixture_model(data, n_comp)
    elif model_type == "empirical_binned":
        n_bins = config.get("n_bins", 32)
        result = build_empirical_binned_distribution(data, n_bins)
    elif model_type == "regime_bucket":
        labels = np.array(config["regime_labels"])
        result = fit_regime_bucket_model(data, labels)
    else:
        print(json.dumps({"error": f"Unknown model type: {model_type}"}))
        sys.exit(1)

    print(result.model_dump_json(indent=2))
