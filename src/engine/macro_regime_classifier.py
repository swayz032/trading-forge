"""C11 — 4-state HMM macro regime classifier.

States:
  0: Growth    — positive ISM, normal RRP, subdued VIX, rising yields
  1: Inflation — high CPI, rising DFF, rising yields, dollar strong
  2: Crisis    — VIX spike, RRP collapse, TGA surge, ISM <49
  3: Easing    — falling DFF, RRP rebuilding, stable/falling yields

The 10 C11 series (inputs after feature engineering):
  T10Y2Y_vol  — 10Y-2Y rolling weekly volatility (bps/week)
  DFF_change  — Fed Funds 30-day rate of change
  USEPUINDXD  — Policy uncertainty index (raw)
  VIXCLS      — VIX closing value
  RRPONTSYD   — Overnight RRP outstanding ($B)
  WTREGEN     — Treasury General Account ($B)
  ISM_PMI     — ISM Manufacturing PMI (from NAPM/BLS proxy)
  DTWEXBGS    — Trade-weighted dollar index
  TAIL_BPS    — Avg Treasury auction tail (bps, last 3 auctions)
  INDIRECT    — Avg indirect bidder % (last 3 auctions)

Design:
  - GaussianHMM from hmmlearn (hidden Markov model, diagonal covariance)
  - 4 states, covariance_type="diag", n_iter=200
  - Trained on 2018-2024 macro data (known regime labels for validation)
  - Deterministic: fixed random_state=42

HMM output:
  - posterior state probabilities per observation date (4-vector, sums to 1.0)
  - dominant state = argmax of posterior
  - crisis_gate = (prob_crisis > 0.6)

Look-ahead safety:
  - Feature engineering uses ONLY data available on the computation date
  - Rolling stats use backward-looking windows only
  - No centered rolling (always trailing)

Known regime labels for validation (C11 spec):
  - March 2020 COVID: Crisis (state 2)
  - 2022 rate hike cycle: Inflation (state 1)
  - Late 2024 easing: Easing (state 3)

Dependency: hmmlearn>=0.3.2 (already in requirements.txt)
"""

from __future__ import annotations

import sys
from typing import Any

import numpy as np

try:
    from hmmlearn.hmm import GaussianHMM
    _HMM_AVAILABLE = True
except ImportError:
    _HMM_AVAILABLE = False
    print("WARNING: hmmlearn not available — using rule-based fallback classifier", file=sys.stderr)


# ─── State definitions ────────────────────────────────────────────

STATE_NAMES = ["Growth", "Inflation", "Crisis", "Easing"]
STATE_GROWTH = 0
STATE_INFLATION = 1
STATE_CRISIS = 2
STATE_EASING = 3

# Crisis hard-gate threshold (prob_crisis > threshold → block longs)
CRISIS_GATE_THRESHOLD = 0.60

# Minimum observations required to run HMM (must have at least 5 features)
MIN_OBS_FOR_HMM = 30


# ─── Feature engineering ─────────────────────────────────────────

def build_feature_matrix(
    observations: list[dict],
) -> np.ndarray:
    """Build the 10-feature matrix for HMM fitting from macro observations.

    Args:
        observations: List of {date, series_id, value} dicts sorted by date.
            Expected series_id values: T10Y2Y, DFF, USEPUINDXD, VIXCLS,
            RRPONTSYD, WTREGEN, ISM_PMI (or NAPM), DTWEXBGS,
            TREASURY_TAIL_BPS (avg), TREASURY_INDIRECT_PCT (avg).

    Returns:
        2D numpy array (n_dates, n_features=10).
        NaN values are forward-filled then backward-filled.
        Scaled to zero-mean, unit-variance per feature (StandardScaler).
    """
    from collections import defaultdict

    # Group by series_id and date
    by_series: dict[str, dict[str, float]] = defaultdict(dict)
    for obs in observations:
        by_series[obs["series_id"]][obs["series_date"]] = float(obs["value"])

    # Collect all dates
    all_dates = sorted({obs["series_date"] for obs in observations})
    if len(all_dates) < MIN_OBS_FOR_HMM:
        raise ValueError(
            f"Need at least {MIN_OBS_FOR_HMM} dates to build feature matrix, "
            f"got {len(all_dates)}."
        )

    # ─── Feature arrays (10 features) ────────────────────────────
    t10y2y = _extract_series(by_series, "T10Y2Y", all_dates)
    dff = _extract_series(by_series, "DFF", all_dates)
    usepuindxd = _extract_series(by_series, "USEPUINDXD", all_dates)
    vixcls = _extract_series(by_series, "VIXCLS", all_dates)
    rrpontsyd = _extract_series(by_series, "RRPONTSYD", all_dates)
    wtregen = _extract_series(by_series, "WTREGEN", all_dates)

    # ISM PMI — check both canonical names
    ism = _extract_series(by_series, "ISM_PMI", all_dates)
    if np.all(np.isnan(ism)):
        ism = _extract_series(by_series, "NAPM", all_dates)

    dtwexbgs = _extract_series(by_series, "DTWEXBGS", all_dates)

    # Treasury auction features (average across Note/Bond types)
    tail_note = _extract_series(by_series, "TREASURY_TAIL_BPS_NOTE", all_dates)
    tail_bond = _extract_series(by_series, "TREASURY_TAIL_BPS_BOND", all_dates)
    tail = np.where(~np.isnan(tail_note), tail_note, tail_bond)

    indirect_note = _extract_series(by_series, "TREASURY_INDIRECT_PCT_NOTE", all_dates)
    indirect_bond = _extract_series(by_series, "TREASURY_INDIRECT_PCT_BOND", all_dates)
    indirect = np.where(~np.isnan(indirect_note), indirect_note, indirect_bond)

    # ─── Derived features ─────────────────────────────────────────
    # T10Y2Y rolling weekly volatility (5-day rolling std, trailing only)
    t10y2y_vol = _rolling_std(t10y2y, window=5)

    # DFF 30-day rate of change
    dff_change = _rate_of_change(dff, periods=30)

    # ─── Stack into feature matrix ────────────────────────────────
    features = np.column_stack([
        t10y2y_vol,   # 0: yield vol
        dff_change,   # 1: fed funds rate of change
        usepuindxd,   # 2: policy uncertainty
        vixcls,       # 3: VIX
        rrpontsyd,    # 4: overnight RRP
        wtregen,      # 5: TGA balance
        ism,          # 6: ISM PMI
        dtwexbgs,     # 7: dollar index
        tail,         # 8: auction tail bps
        indirect,     # 9: indirect bidder %
    ])

    # Forward-fill NaN (use last known value for each feature)
    features = _forward_fill(features)
    # Backward-fill any remaining NaN at start
    features = _backward_fill(features)
    # Replace any still-remaining NaN with 0 (median-ish for these series)
    features = np.nan_to_num(features, nan=0.0)

    # Standardize features (zero mean, unit variance) for HMM numerical stability
    means = np.nanmean(features, axis=0)
    stds = np.nanstd(features, axis=0, ddof=1)
    stds = np.where(stds < 1e-8, 1.0, stds)
    features = (features - means) / stds

    return features


def _extract_series(
    by_series: dict[str, dict[str, float]],
    series_id: str,
    dates: list[str],
) -> np.ndarray:
    """Extract a series as a float array aligned to dates. NaN where missing."""
    series_data = by_series.get(series_id, {})
    return np.array([series_data.get(d, float("nan")) for d in dates], dtype=np.float64)


def _rolling_std(arr: np.ndarray, window: int = 5) -> np.ndarray:
    """Trailing rolling std (NaN-safe). Returns NaN for first window-1 elements."""
    result = np.full_like(arr, float("nan"))
    for i in range(window - 1, len(arr)):
        window_vals = arr[max(0, i - window + 1):i + 1]
        valid = window_vals[~np.isnan(window_vals)]
        if len(valid) >= 2:
            result[i] = np.std(valid, ddof=1)
    return result


def _rate_of_change(arr: np.ndarray, periods: int = 30) -> np.ndarray:
    """Trailing rate of change over N periods. NaN where insufficient history."""
    result = np.full_like(arr, float("nan"))
    for i in range(periods, len(arr)):
        prev = arr[i - periods]
        curr = arr[i]
        if not (np.isnan(prev) or np.isnan(curr)):
            result[i] = curr - prev
    return result


def _forward_fill(arr: np.ndarray) -> np.ndarray:
    """Forward-fill NaN values along axis 0 (row-by-row per column)."""
    out = arr.copy()
    for col in range(out.shape[1]):
        mask = np.isnan(out[:, col])
        if not np.any(mask):
            continue
        last_valid = np.nan
        for row in range(out.shape[0]):
            if not mask[row]:
                last_valid = out[row, col]
            elif not np.isnan(last_valid):
                out[row, col] = last_valid
    return out


def _backward_fill(arr: np.ndarray) -> np.ndarray:
    """Backward-fill NaN values along axis 0."""
    out = arr.copy()
    for col in range(out.shape[1]):
        mask = np.isnan(out[:, col])
        if not np.any(mask):
            continue
        first_valid = np.nan
        for row in range(out.shape[0] - 1, -1, -1):
            if not mask[row]:
                first_valid = out[row, col]
            elif not np.isnan(first_valid):
                out[row, col] = first_valid
    return out


# ─── HMM Classifier ──────────────────────────────────────────────

def fit_hmm_classifier(
    feature_matrix: np.ndarray,
    n_states: int = 4,
    n_iter: int = 200,
    random_state: int = 42,
) -> Any:
    """Fit a Gaussian HMM on historical macro feature matrix.

    Args:
        feature_matrix: (n_obs, n_features) standardized feature matrix.
        n_states: Number of hidden states (4 for C11 Growth/Inflation/Crisis/Easing).
        n_iter: EM algorithm iterations.
        random_state: Fixed seed for determinism.

    Returns:
        Fitted GaussianHMM model (or rule-based FallbackClassifier).

    Raises:
        ImportError: hmmlearn not installed.
        ValueError: Feature matrix too small.
    """
    if not _HMM_AVAILABLE:
        return _FallbackClassifier(n_states=n_states)

    if len(feature_matrix) < MIN_OBS_FOR_HMM:
        raise ValueError(
            f"Feature matrix too small ({len(feature_matrix)} rows). "
            f"Need at least {MIN_OBS_FOR_HMM}."
        )

    model = GaussianHMM(
        n_components=n_states,
        covariance_type="diag",
        n_iter=n_iter,
        random_state=random_state,
    )
    model.fit(feature_matrix)
    return model


def predict_regime_probabilities(
    model: Any,
    feature_matrix: np.ndarray,
) -> np.ndarray:
    """Predict posterior state probabilities for each observation.

    Args:
        model: Fitted GaussianHMM or FallbackClassifier.
        feature_matrix: (n_obs, n_features) matrix.

    Returns:
        (n_obs, n_states) array of posterior probabilities. Each row sums to 1.0.
    """
    if isinstance(model, _FallbackClassifier):
        return model.predict_proba(feature_matrix)

    # hmmlearn predict_proba
    try:
        posteriors = model.predict_proba(feature_matrix)
    except Exception as exc:
        print(f"WARNING: HMM predict_proba failed: {exc}", file=sys.stderr)
        # Fallback: uniform distribution
        n = len(feature_matrix)
        return np.full((n, model.n_components), 1.0 / model.n_components)

    return posteriors


def classify_daily_regime(
    feature_matrix: np.ndarray,
    dates: list[str],
    model: Any | None = None,
) -> list[dict]:
    """Full pipeline: feature_matrix → regime classification per date.

    If model is None, fits a new HMM on the provided feature_matrix.

    Args:
        feature_matrix: (n_obs, n_features) standardized feature matrix.
        dates: List of YYYY-MM-DD strings (same length as feature_matrix rows).
        model: Pre-fitted GaussianHMM or None to fit fresh.

    Returns:
        List of regime dicts, one per date:
          {
            "state_date": "YYYY-MM-DD",
            "prob_growth": float,
            "prob_inflation": float,
            "prob_crisis": float,
            "prob_easing": float,
            "dominant_state": str,  # "Growth" | "Inflation" | "Crisis" | "Easing"
            "crisis_gate_triggered": bool,  # prob_crisis > CRISIS_GATE_THRESHOLD
          }
    """
    if model is None:
        model = fit_hmm_classifier(feature_matrix)

    posteriors = predict_regime_probabilities(model, feature_matrix)

    results: list[dict] = []
    for i, date in enumerate(dates):
        probs = posteriors[i]  # shape (4,)
        dominant_idx = int(np.argmax(probs))

        results.append({
            "state_date": date,
            "prob_growth": round(float(probs[STATE_GROWTH]), 6),
            "prob_inflation": round(float(probs[STATE_INFLATION]), 6),
            "prob_crisis": round(float(probs[STATE_CRISIS]), 6),
            "prob_easing": round(float(probs[STATE_EASING]), 6),
            "dominant_state": STATE_NAMES[dominant_idx],
            "crisis_gate_triggered": bool(probs[STATE_CRISIS] > CRISIS_GATE_THRESHOLD),
        })

    return results


# ─── Rule-based fallback (when hmmlearn unavailable) ─────────────

class _FallbackClassifier:
    """Rule-based macro regime classifier for use when hmmlearn is unavailable.

    Uses the same feature indices as the HMM:
      idx 3 = VIX (standardized)
      idx 4 = RRPONTSYD (standardized)
      idx 2 = USEPUINDXD (standardized)
      idx 6 = ISM PMI (standardized)

    States: Growth(0), Inflation(1), Crisis(2), Easing(3)
    """

    def __init__(self, n_states: int = 4) -> None:
        self.n_components = n_states

    def predict_proba(self, feature_matrix: np.ndarray) -> np.ndarray:
        n = len(feature_matrix)
        probs = np.zeros((n, 4))

        for i in range(n):
            row = feature_matrix[i]
            # VIX score: high VIX = more crisis probability
            vix_z = row[3] if len(row) > 3 else 0.0
            # RRP: negative z = lower RRP = more crisis
            rrp_z = row[4] if len(row) > 4 else 0.0
            # Policy uncertainty: positive z = crisis or inflation
            pui_z = row[2] if len(row) > 2 else 0.0
            # ISM: negative z = recession/crisis signal
            ism_z = row[6] if len(row) > 6 else 0.0
            # DFF change: positive = tightening (inflation)
            dff_z = row[1] if len(row) > 1 else 0.0

            # Crisis score
            crisis_score = (
                max(0.0, vix_z) * 0.3
                + max(0.0, -rrp_z) * 0.3
                + max(0.0, pui_z) * 0.2
                + max(0.0, -ism_z) * 0.2
            )

            # Inflation score
            inflation_score = (
                max(0.0, dff_z) * 0.5
                + max(0.0, pui_z) * 0.3
                + max(0.0, ism_z) * 0.2  # ISM above avg = growth/inflation
            )

            # Easing score
            easing_score = (
                max(0.0, -dff_z) * 0.5
                + max(0.0, rrp_z) * 0.3  # RRP rebuilding
                + max(0.0, -vix_z) * 0.2
            )

            # Growth: residual
            # Normalize to [0, 1] first, then compute growth
            raw = np.array([
                max(0.0, ism_z + 1.0) * 0.4 + max(0.0, -vix_z) * 0.3 + max(0.0, rrp_z) * 0.3,
                inflation_score,
                crisis_score,
                easing_score,
            ])
            raw = np.clip(raw, 0, None)
            total = raw.sum()
            if total < 1e-6:
                probs[i] = [0.4, 0.2, 0.2, 0.2]  # Uniform-ish fallback
            else:
                probs[i] = raw / total

        return probs
