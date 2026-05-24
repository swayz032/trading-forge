"""HMM Regime Overlay — Secondary confidence amplifier for the rule-based bias engine.

W24-P2 Item 21 (2026-05-23)

Design contract:
  - Rule-based engine in bias_engine.py is PRIMARY. HMM is SECONDARY.
  - HMM NEVER overrides the rule-based regime label. It is advisory only.
  - Disagreement emits audit_log `bias_engine.hmm_disagrees_with_rule_based` (ADVISORY).
  - Agreement is logged at debug level; no audit row.
  - Controlled by env: HMM_OVERLAY_ENABLED=true (default), disabled when absent or false.
  - Refit on Sunday 17:00 ET; params persisted in `regime_hmm_models` table.

State mapping (3-state Gaussian HMM → regime labels):
  HMM state with highest mean return   → "TRENDING_UP"
  HMM state with lowest mean return    → "TRENDING_DOWN"
  Remaining state                      → "RANGE_BOUND"

Regime probability dict keys: trending_up_prob, trending_down_prob, range_bound_prob.

Refit contract:
  fit_hmm_regimes(ohlc_df) trains on log-returns of the full OHLC frame.
  predict_regime_probabilities(model, recent_returns) returns a 3-key dict.

Persistence:
  Python side: serialize to JSON (means + covars + transmat + startprob + label_map).
  TS side: regime_hmm_models table stores the JSON blob keyed by (symbol, fit_date).
"""
from __future__ import annotations

import json
import logging
import os
import warnings
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# ─── Env-var controls ───────────────────────────────────────────────────────────
HMM_OVERLAY_ENABLED: bool = os.environ.get("HMM_OVERLAY_ENABLED", "true").lower() not in ("0", "false", "no", "off")
HMM_CONFIRM_THRESHOLD: float = float(os.environ.get("HMM_CONFIRM_THRESHOLD", "0.6"))
HMM_DISAGREE_THRESHOLD: float = float(os.environ.get("HMM_DISAGREE_THRESHOLD", "0.3"))
HMM_N_STATES: int = int(os.environ.get("HMM_N_STATES", "3"))

# ─── Regime label constants ─────────────────────────────────────────────────────
REGIME_TRENDING_UP   = "TRENDING_UP"
REGIME_TRENDING_DOWN = "TRENDING_DOWN"
REGIME_RANGE_BOUND   = "RANGE_BOUND"

_HMM_REGIME_LABELS = [REGIME_TRENDING_UP, REGIME_TRENDING_DOWN, REGIME_RANGE_BOUND]
_HMM_PROB_KEYS = ["trending_up_prob", "trending_down_prob", "range_bound_prob"]


class HmmRegimeModel:
    """Thin wrapper around a fitted GaussianHMM from hmmlearn.

    Serialises to / deserialises from a plain dict so it can be stored as
    JSONB in the `regime_hmm_models` table without pickling.
    """

    def __init__(
        self,
        means: np.ndarray,         # shape (n_states, n_features)
        covars: np.ndarray,        # shape (n_states, n_features, n_features)
        transmat: np.ndarray,      # shape (n_states, n_states)
        startprob: np.ndarray,     # shape (n_states,)
        label_map: dict[int, str], # state_index → regime_label
        n_states: int = 3,
    ):
        self.means = means
        self.covars = covars
        self.transmat = transmat
        self.startprob = startprob
        self.label_map = label_map
        self.n_states = n_states

    def to_dict(self) -> dict[str, Any]:
        return {
            "means": self.means.tolist(),
            "covars": self.covars.tolist(),
            "transmat": self.transmat.tolist(),
            "startprob": self.startprob.tolist(),
            "label_map": {str(k): v for k, v in self.label_map.items()},
            "n_states": self.n_states,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "HmmRegimeModel":
        return cls(
            means=np.array(d["means"]),
            covars=np.array(d["covars"]),
            transmat=np.array(d["transmat"]),
            startprob=np.array(d["startprob"]),
            label_map={int(k): v for k, v in d["label_map"].items()},
            n_states=int(d["n_states"]),
        )


def _build_label_map(means: np.ndarray) -> dict[int, str]:
    """Map HMM state indices to regime labels based on mean return rank.

    Highest mean → TRENDING_UP
    Lowest mean  → TRENDING_DOWN
    Remaining    → RANGE_BOUND
    """
    n = means.shape[0]
    # means shape: (n_states, n_features); use first feature (log-return)
    mean_returns = means[:, 0]
    sorted_idx = np.argsort(mean_returns)  # ascending
    label_map: dict[int, str] = {}
    label_map[int(sorted_idx[0])] = REGIME_TRENDING_DOWN
    label_map[int(sorted_idx[-1])] = REGIME_TRENDING_UP
    for i in range(n):
        if i not in label_map:
            label_map[i] = REGIME_RANGE_BOUND
    return label_map


def fit_hmm_regimes(
    ohlc_df: Any,       # polars or pandas DataFrame with 'close' column
    n_states: int = HMM_N_STATES,
    random_state: int = 42,
) -> HmmRegimeModel:
    """Fit a 3-state Gaussian HMM on log-returns of the OHLC data.

    Parameters
    ----------
    ohlc_df:
        DataFrame with at least a 'close' column. Polars or pandas accepted.
    n_states:
        Number of hidden states. Default 3 (trending-up, range-bound, trending-down).
    random_state:
        Seed for reproducibility.

    Returns
    -------
    HmmRegimeModel with fitted parameters + label mapping.

    Raises
    ------
    ImportError  — if hmmlearn is not installed (should not happen; it is in requirements.txt).
    ValueError   — if fewer than 2 × n_states rows are available.
    """
    try:
        from hmmlearn.hmm import GaussianHMM
    except ImportError as exc:
        raise ImportError(
            "hmmlearn is required for HMM regime overlay. "
            "Install with: pip install 'hmmlearn>=0.3.2'"
        ) from exc

    # Extract close prices — handle both polars and pandas
    try:
        import polars as pl
        if isinstance(ohlc_df, pl.DataFrame):
            closes = ohlc_df["close"].to_numpy().astype(float)
        else:
            closes = np.asarray(ohlc_df["close"], dtype=float)
    except Exception:
        closes = np.asarray(ohlc_df["close"], dtype=float)

    if len(closes) < 2:
        raise ValueError(f"fit_hmm_regimes requires at least 2 rows, got {len(closes)}")

    min_required = n_states * 2
    if len(closes) < min_required:
        raise ValueError(
            f"fit_hmm_regimes requires >= {min_required} rows for {n_states} states, "
            f"got {len(closes)}"
        )

    # Log-returns: shape (T-1, 1) for univariate HMM
    log_returns = np.log(closes[1:] / closes[:-1]).reshape(-1, 1)

    # Remove any NaN/Inf (overnight gaps can produce NaN in extended-hours data)
    valid_mask = np.isfinite(log_returns[:, 0])
    log_returns_clean = log_returns[valid_mask]

    if len(log_returns_clean) < min_required:
        raise ValueError(
            f"fit_hmm_regimes: after dropping NaN/Inf, only {len(log_returns_clean)} "
            f"valid log-returns remain (need >= {min_required})."
        )

    model = GaussianHMM(
        n_components=n_states,
        covariance_type="full",
        n_iter=200,
        random_state=random_state,
        tol=1e-4,
    )

    with warnings.catch_warnings():
        # hmmlearn may emit ConvergenceWarning on short series — not fatal for advisory overlay
        warnings.simplefilter("ignore")
        model.fit(log_returns_clean)

    label_map = _build_label_map(model.means_)

    return HmmRegimeModel(
        means=model.means_,
        covars=model.covars_,
        transmat=model.transmat_,
        startprob=model.startprob_,
        label_map=label_map,
        n_states=n_states,
    )


def predict_regime_probabilities(
    model: HmmRegimeModel,
    recent_returns: np.ndarray,    # 1-D array of recent log-returns
) -> dict[str, float]:
    """Run the HMM forward algorithm on recent log-returns and return regime probs.

    Parameters
    ----------
    model:
        A fitted HmmRegimeModel.
    recent_returns:
        Recent log-returns (1-D, at least 1 value). Typically the last 20-60 bars.

    Returns
    -------
    Dict with keys: trending_up_prob, trending_down_prob, range_bound_prob.
    Values sum to 1.0. On error returns equal-probability dict (1/3 each).
    """
    try:
        from hmmlearn.hmm import GaussianHMM
    except ImportError:
        logger.warning("hmmlearn not available — returning uniform probs")
        return _uniform_probs()

    if not np.all(np.isfinite(recent_returns)):
        valid = recent_returns[np.isfinite(recent_returns)]
        if len(valid) == 0:
            logger.warning("predict_regime_probabilities: all returns are NaN/Inf — returning uniform")
            return _uniform_probs()
        recent_returns = valid

    obs = recent_returns.reshape(-1, 1)

    # Reconstruct hmmlearn model from stored parameters
    hmm = GaussianHMM(n_components=model.n_states, covariance_type="full")
    hmm.means_ = model.means
    hmm.covars_ = model.covars
    hmm.transmat_ = model.transmat
    hmm.startprob_ = model.startprob
    hmm.n_features = 1

    try:
        # Posterior state probabilities at the last observation
        _, posteriors = hmm.score_samples(obs)
        last_posterior = posteriors[-1]  # shape (n_states,)
    except Exception as exc:
        logger.warning("predict_regime_probabilities: score_samples failed (%s) — uniform", exc)
        return _uniform_probs()

    result: dict[str, float] = {"trending_up_prob": 0.0, "trending_down_prob": 0.0, "range_bound_prob": 0.0}
    for state_idx, prob in enumerate(last_posterior):
        label = model.label_map.get(state_idx, REGIME_RANGE_BOUND)
        key = _label_to_prob_key(label)
        result[key] += float(prob)

    return result


def _label_to_prob_key(label: str) -> str:
    mapping = {
        REGIME_TRENDING_UP:   "trending_up_prob",
        REGIME_TRENDING_DOWN: "trending_down_prob",
        REGIME_RANGE_BOUND:   "range_bound_prob",
    }
    return mapping.get(label, "range_bound_prob")


def _uniform_probs() -> dict[str, float]:
    p = round(1.0 / 3, 6)
    return {"trending_up_prob": p, "trending_down_prob": p, "range_bound_prob": p}


def rule_label_to_hmm_key(rule_label: str) -> str:
    """Convert a rule-based regime label to the matching HMM probability dict key.

    The rule-based engine uses labels like TRENDING_UP / TRENDING_DOWN / RANGE_BOUND.
    This maps to the HMM probability keys.
    Unknown labels map to 'range_bound_prob' (most neutral).
    """
    upper = rule_label.upper()
    if "TRENDING_UP" in upper or upper in ("BULL", "STRONG_UPTREND"):
        return "trending_up_prob"
    if "TRENDING_DOWN" in upper or upper in ("BEAR", "STRONG_DOWNTREND"):
        return "trending_down_prob"
    return "range_bound_prob"


def evaluate_hmm_agreement(
    rule_label: str,
    probs: dict[str, float],
    confirm_threshold: float = HMM_CONFIRM_THRESHOLD,
    disagree_threshold: float = HMM_DISAGREE_THRESHOLD,
) -> dict[str, Any]:
    """Evaluate HMM agreement against a rule-based regime label.

    Returns dict with keys:
      hmm_confirms        bool — P(rule_state) > confirm_threshold
      hmm_disagrees       bool — P(rule_state) < disagree_threshold AND another state > 0.5
      rule_label          str
      rule_state_prob     float — P assigned by HMM to the rule-based state
      dominant_hmm_label  str — HMM's highest-probability state label
      dominant_hmm_prob   float
      probs               dict — full probability dict
    """
    rule_key = rule_label_to_hmm_key(rule_label)
    rule_prob = probs.get(rule_key, 0.0)

    # Dominant HMM state
    key_to_label = {
        "trending_up_prob":   REGIME_TRENDING_UP,
        "trending_down_prob": REGIME_TRENDING_DOWN,
        "range_bound_prob":   REGIME_RANGE_BOUND,
    }
    dominant_key = max(probs, key=lambda k: probs[k])
    dominant_hmm_label = key_to_label.get(dominant_key, REGIME_RANGE_BOUND)
    dominant_hmm_prob = probs.get(dominant_key, 0.0)

    hmm_confirms = rule_prob > confirm_threshold
    hmm_disagrees = (
        rule_prob < disagree_threshold
        and dominant_hmm_prob > 0.5
        and dominant_key != rule_key
    )

    return {
        "hmm_confirms": hmm_confirms,
        "hmm_disagrees": hmm_disagrees,
        "rule_label": rule_label,
        "rule_state_prob": round(rule_prob, 4),
        "dominant_hmm_label": dominant_hmm_label,
        "dominant_hmm_prob": round(dominant_hmm_prob, 4),
        "probs": {k: round(v, 4) for k, v in probs.items()},
    }
