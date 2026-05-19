"""
Skip Engine — Weight Trainer (Phase 2.1).

Reads skip_decisions with resolved actualPnl from DB via a JSON config
payload passed on the command line, re-scores each decision through the
same scorer functions used by skip_classifier.py, trains a LogisticRegression
to predict negative P&L outcomes, and maps the fitted coefficients back to
multipliers in [0.5, 2.0] relative to BASE_WEIGHTS.

Usage (called by scheduler.ts):
    python -m src.engine.skip_engine.weight_trainer --config '<json>'

JSON config shape:
    {
        "decisions": [
            {
                "signals": { ... },           # same shape as classify_session() input
                "actualPnl": -250.0,          # null if not yet resolved — excluded
                "decisionDate": "2026-01-05"  # informational only
            },
            ...
        ],
        "windowDays": 90                      # informational; included in result
    }

stdout: TrainingResult JSON (always — callers must not parse stderr)
stderr: diagnostic logging only
"""

from __future__ import annotations

import json
import sys
import math
from typing import Any

# ─── sklearn guard ──────────────────────────────────────────────────
HAS_SKLEARN = False
try:
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    HAS_SKLEARN = True
except ImportError:
    pass

from src.engine.skip_engine.skip_classifier import (
    SIGNAL_WEIGHTS,
    _score_event_proximity,
    _score_vix_level,
    _score_overnight_gap,
    _score_premarket_volume,
    _score_day_of_week,
    _score_loss_streak,
    _score_monthly_budget,
    _score_correlation_spike,
    _score_calendar_filter,
)

# ─── Constants ──────────────────────────────────────────────────────

# Canonical ordering of the 9 signals — must match feature vector index
SIGNAL_KEYS: list[str] = [
    "event_proximity",
    "vix_level",
    "overnight_gap",
    "premarket_volume",
    "day_of_week",
    "loss_streak",
    "monthly_budget",
    "correlation_spike",
    "calendar_filter",
]

# Base weights copied verbatim from skip_classifier.SIGNAL_WEIGHTS.
# These are the denominator for the rescaling formula.
BASE_WEIGHTS: dict[str, float] = {
    "event_proximity": SIGNAL_WEIGHTS["event_proximity"],    # 3.0
    "vix_level":       SIGNAL_WEIGHTS["vix_level"],          # 2.5
    "overnight_gap":   SIGNAL_WEIGHTS["overnight_gap"],      # 2.0
    "premarket_volume": SIGNAL_WEIGHTS["premarket_volume"],  # 1.5
    "day_of_week":     SIGNAL_WEIGHTS["day_of_week"],        # 1.0
    "loss_streak":     SIGNAL_WEIGHTS["loss_streak"],        # 2.0
    "monthly_budget":  SIGNAL_WEIGHTS["monthly_budget"],     # 2.5
    "correlation_spike": SIGNAL_WEIGHTS["correlation_spike"], # 1.5
    "calendar_filter": SIGNAL_WEIGHTS["calendar_filter"],    # 2.0
}

MIN_DECISIONS = 30
WEIGHT_MULTIPLIER_MIN = 0.5
WEIGHT_MULTIPLIER_MAX = 2.0


# ─── Feature extraction ──────────────────────────────────────────────

def _build_feature_vector(signals: dict[str, Any]) -> list[float]:
    """
    Re-score a signals dict through the 9 scorer functions.
    Returns a 10-element list:
        [score_0, ..., score_8, total_score]
    The 10th element (total) helps the model see the aggregate load.
    """
    scores = [
        _score_event_proximity(signals),
        _score_vix_level(signals),
        _score_overnight_gap(signals),
        _score_premarket_volume(signals),
        _score_day_of_week(signals),
        _score_loss_streak(signals),
        _score_monthly_budget(signals),
        _score_correlation_spike(signals),
        _score_calendar_filter(signals),
    ]
    total = sum(scores)
    scores.append(total)
    return scores


# ─── Coefficient → multiplier mapping ───────────────────────────────

def _coeff_to_multiplier(coeff: float, all_coeffs: list[float]) -> float:
    """
    Map a raw LogisticRegression coefficient to a multiplier in [0.5, 2.0].

    Strategy:
    1. Positive coefficients mean the feature predicts loss → upweight.
    2. Negative or zero coefficients → downweight.
    3. Linear rescale across the observed coefficient range to [0.5, 2.0].

    Edge: if all coefficients are identical, return 1.0 (no change).
    """
    c_min = min(all_coeffs)
    c_max = max(all_coeffs)
    if math.isclose(c_min, c_max, rel_tol=1e-9):
        return 1.0

    # Normalize to [0, 1] then map to [MIN, MAX]
    norm = (coeff - c_min) / (c_max - c_min)
    multiplier = WEIGHT_MULTIPLIER_MIN + norm * (WEIGHT_MULTIPLIER_MAX - WEIGHT_MULTIPLIER_MIN)
    # Clamp for safety (floating-point edge cases)
    return max(WEIGHT_MULTIPLIER_MIN, min(WEIGHT_MULTIPLIER_MAX, multiplier))


# ─── Main trainer ─────────────────────────────────────────────────────

def train_weights(decisions: list[dict[str, Any]], window_days: int = 90) -> dict[str, Any]:
    """
    Core training function. Decoupled from CLI for testability.

    Args:
        decisions: list of decision dicts, each with:
            - signals: dict (required)
            - actualPnl: float | None
        window_days: informational label included in result

    Returns:
        TrainingResult dict with keys:
            status, message, sampleSize, windowDays,
            baselineAccuracy, trainedAccuracy, weights
    """
    # Filter to rows with a resolved actualPnl
    resolved = [
        d for d in decisions
        if d.get("actualPnl") is not None and d.get("signals") is not None
    ]

    sample_size = len(resolved)

    if sample_size < MIN_DECISIONS:
        return {
            "status": "insufficient_data",
            "message": (
                f"Need at least {MIN_DECISIONS} resolved decisions; "
                f"got {sample_size}."
            ),
            "sampleSize": sample_size,
            "windowDays": window_days,
            "baselineAccuracy": None,
            "trainedAccuracy": None,
            "weights": {},
        }

    if not HAS_SKLEARN:
        return {
            "status": "missing_dependency",
            "message": "scikit-learn is not installed. Install it with: pip install scikit-learn",
            "sampleSize": sample_size,
            "windowDays": window_days,
            "baselineAccuracy": None,
            "trainedAccuracy": None,
            "weights": {},
        }

    # Build feature matrix X and label vector y
    X: list[list[float]] = []
    y: list[int] = []

    for d in resolved:
        signals = d["signals"]
        actual_pnl = float(d["actualPnl"])
        features = _build_feature_vector(signals)
        X.append(features)
        # Label: 1 = loss (negative P&L), 0 = not a loss
        y.append(1 if actual_pnl < 0 else 0)

    print(  # noqa: T201
        f"[weight_trainer] Building feature matrix: {sample_size} rows, "
        f"{len(X[0])} features. "
        f"Loss rate: {sum(y)/len(y):.1%}",
        file=sys.stderr,
    )

    # Baseline accuracy: always-predict majority class
    majority_label = 1 if sum(y) >= len(y) / 2 else 0
    baseline_accuracy = sum(1 for label in y if label == majority_label) / len(y)

    # Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Train logistic regression — fixed random_state for reproducibility
    model = LogisticRegression(random_state=42, max_iter=1000, solver="lbfgs")
    model.fit(X_scaled, y)

    trained_accuracy = float(model.score(X_scaled, y))

    # Extract coefficients for the 9 signal features (index 0-8); skip index 9 (total)
    raw_coeffs_9 = list(model.coef_[0][:9])

    print(
        f"[weight_trainer] Trained accuracy: {trained_accuracy:.3f} "
        f"(baseline: {baseline_accuracy:.3f}). "
        f"Raw coefficients: {[round(c, 4) for c in raw_coeffs_9]}",
        file=sys.stderr,
    )

    # Map coefficients to multipliers
    multipliers = [_coeff_to_multiplier(c, raw_coeffs_9) for c in raw_coeffs_9]

    # Build the learned_weights dict: absolute weight values (not multipliers)
    # These are the values classify_session() will receive as learned_weights.
    # The rescaling in classify_session is:
    #   effective_score = raw_scorer_score * (learned_weight / BASE_WEIGHT)
    # So we store learned_weight = BASE_WEIGHT * multiplier.
    learned_weights: dict[str, float] = {}
    for i, key in enumerate(SIGNAL_KEYS):
        base = BASE_WEIGHTS[key]
        multiplier = multipliers[i]
        learned_weights[key] = round(base * multiplier, 6)

    print(
        f"[weight_trainer] Learned weights: {learned_weights}",
        file=sys.stderr,
    )

    return {
        "status": "ok",
        "message": f"Trained on {sample_size} decisions over {window_days} days.",
        "sampleSize": sample_size,
        "windowDays": window_days,
        "baselineAccuracy": round(baseline_accuracy, 6),
        "trainedAccuracy": round(trained_accuracy, 6),
        "weights": learned_weights,
    }


# ─── CLI entry point ────────────────────────────────────────────────

def main() -> None:
    """
    Reads --config <json_string> from sys.argv.
    Writes TrainingResult JSON to stdout.
    All diagnostic logging goes to stderr.
    """
    config_json: str | None = None

    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--config" and i + 1 < len(args):
            config_json = args[i + 1]
            break

    if config_json is None:
        result = {
            "status": "error",
            "message": "Missing required --config argument.",
            "sampleSize": 0,
            "windowDays": 0,
            "baselineAccuracy": None,
            "trainedAccuracy": None,
            "weights": {},
        }
        print(json.dumps(result))
        sys.exit(1)

    try:
        config = json.loads(config_json)
    except json.JSONDecodeError as exc:
        result = {
            "status": "error",
            "message": f"Invalid JSON in --config: {exc}",
            "sampleSize": 0,
            "windowDays": 0,
            "baselineAccuracy": None,
            "trainedAccuracy": None,
            "weights": {},
        }
        print(json.dumps(result))
        sys.exit(1)

    decisions = config.get("decisions", [])
    window_days = int(config.get("windowDays", 90))

    result = train_weights(decisions, window_days)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
