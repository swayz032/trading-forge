"""Robust covariance estimation for multi-strategy portfolio math.

Provides LedoitWolf shrinkage, MinCovDet outlier-resistant, and GraphicalLassoCV
sparse covariance with numpy fallbacks.
"""
from __future__ import annotations

import numpy as np

try:
    from sklearn.covariance import LedoitWolf, MinCovDet, GraphicalLassoCV
    SKLEARN_COV_AVAILABLE = True
except ImportError:
    SKLEARN_COV_AVAILABLE = False


def estimate_covariance(
    returns_matrix: np.ndarray,
    method: str = "ledoit_wolf",
) -> dict:
    """Estimate covariance matrix robustly.

    Args:
        returns_matrix: (n_observations, n_strategies) daily returns
        method: "ledoit_wolf" | "mincovdet" | "graphical_lasso" | "sample"

    Returns:
        {covariance, correlation, shrinkage, method, condition_number}
    """
    if returns_matrix.ndim != 2 or returns_matrix.shape[1] < 2:
        n = max(returns_matrix.shape[1] if returns_matrix.ndim == 2 else 1, 1)
        return {
            "covariance": np.eye(n).tolist(),
            "correlation": np.eye(n).tolist(),
            "shrinkage": None,
            "method": "identity",
            "condition_number": 1.0,
        }

    shrinkage = None

    if method == "ledoit_wolf" and SKLEARN_COV_AVAILABLE:
        est = LedoitWolf().fit(returns_matrix)
        cov = est.covariance_
        shrinkage = float(est.shrinkage_)
    elif method == "mincovdet" and SKLEARN_COV_AVAILABLE:
        est = MinCovDet(random_state=42).fit(returns_matrix)
        cov = est.covariance_
    elif method == "graphical_lasso" and SKLEARN_COV_AVAILABLE:
        try:
            est = GraphicalLassoCV(cv=5).fit(returns_matrix)
            cov = est.covariance_
            shrinkage = float(est.alpha_)
        except Exception:
            cov = np.cov(returns_matrix, rowvar=False)
    else:
        cov = np.cov(returns_matrix, rowvar=False)

    # Derive correlation from covariance
    std = np.sqrt(np.diag(cov))
    std = np.maximum(std, 1e-10)
    corr = cov / np.outer(std, std)
    np.fill_diagonal(corr, 1.0)

    return {
        "covariance": cov.tolist(),
        "correlation": corr.tolist(),
        "shrinkage": shrinkage,
        "method": method if SKLEARN_COV_AVAILABLE or method == "sample" else "sample_fallback",
        "condition_number": float(np.linalg.cond(cov)),
    }


def portfolio_risk_decomposition(
    weights: np.ndarray,
    cov: np.ndarray,
) -> dict:
    """Euler risk decomposition: which strategy contributes how much to total risk.

    Args:
        weights: (n_strategies,) allocation weights
        cov: (n_strategies, n_strategies) covariance matrix

    Returns:
        {portfolio_volatility, marginal_risk, component_risk, pct_contribution}
    """
    weights = np.asarray(weights, dtype=np.float64)
    cov = np.asarray(cov, dtype=np.float64)

    portfolio_var = float(weights @ cov @ weights)
    portfolio_vol = np.sqrt(max(portfolio_var, 0))

    if portfolio_vol < 1e-10:
        n = len(weights)
        return {
            "portfolio_volatility": 0.0,
            "marginal_risk": [0.0] * n,
            "component_risk": [0.0] * n,
            "pct_contribution": [1.0 / n] * n if n > 0 else [],
        }

    marginal_risk = (cov @ weights) / portfolio_vol
    component_risk = weights * marginal_risk
    pct_contribution = component_risk / portfolio_vol

    return {
        "portfolio_volatility": float(portfolio_vol),
        "marginal_risk": marginal_risk.tolist(),
        "component_risk": component_risk.tolist(),
        "pct_contribution": pct_contribution.tolist(),
    }
