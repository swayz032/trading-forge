"""
Skip Engine — Weight Trainer (Phase 4.5).

Reads skip_decisions with resolved actualPnl from DB via a JSON config
payload passed on the command line, re-scores each decision through the
same scorer functions used by skip_classifier.py, trains a LogisticRegression
to predict negative P&L outcomes, and maps the fitted coefficients back to
weight adjustments that are conservatively capped at ±10% per training cycle.

The ±10% cap is intentional and important:
  - Skip weights directly influence whether we sit out a session.
  - A single training run on 90 days of data has limited sample quality.
  - Small bounded steps let the system converge gradually and safely.
  - A miscalibrated model cannot catastrophically flip skip/trade decisions.

Usage (called by scheduler.ts weekly):
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

TrainingResult schema:
    {
        "status": "ok" | "insufficient_data" | "missing_dependency" | "error",
        "message": str,
        "sampleSize": int,
        "windowDays": int,
        "baselineAccuracy": float | null,
        "trainedAccuracy": float | null,
        "weights": {
            "<signal_key>": float   # adjusted weight, bounded by ±10% from BASE_WEIGHTS
        }
    }
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

# Canonical ordering of the 9 trainable signals — must match feature vector index.
# qubo_timing (signal #10) is experimental and excluded from training:
# its schedule is too sparse and irregular to train a stable coefficient.
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

# Base weights verbatim from skip_classifier.SIGNAL_WEIGHTS.
# These are the anchor values: trained weights are bounded relative to them.
BASE_WEIGHTS: dict[str, float] = {
    "event_proximity":    SIGNAL_WEIGHTS["event_proximity"],    # 3.0
    "vix_level":          SIGNAL_WEIGHTS["vix_level"],          # 2.5
    "overnight_gap":      SIGNAL_WEIGHTS["overnight_gap"],      # 2.0
    "premarket_volume":   SIGNAL_WEIGHTS["premarket_volume"],   # 1.5
    "day_of_week":        SIGNAL_WEIGHTS["day_of_week"],        # 1.0
    "loss_streak":        SIGNAL_WEIGHTS["loss_streak"],        # 2.0
    "monthly_budget":     SIGNAL_WEIGHTS["monthly_budget"],     # 2.5
    "correlation_spike":  SIGNAL_WEIGHTS["correlation_spike"],  # 1.5
    "calendar_filter":    SIGNAL_WEIGHTS["calendar_filter"],    # 2.0
}

MIN_DECISIONS = 30

# Conservative step limit: each training cycle may move any weight by at most
# ±10% of the base weight.  A positive coefficient (predicts loss) pushes up
# by at most +10%; a negative coefficient pushes down by at most -10%.
MAX_STEP_FRACTION = 0.10

# Absolute floor/ceiling so no weight ever goes negative or explodes.
WEIGHT_ABS_MIN = 0.1
WEIGHT_ABS_MAX = 6.0


# ─── Feature extraction ──────────────────────────────────────────────

def _build_feature_vector(signals: dict[str, Any]) -> list[float]:
    """
    Re-score a signals dict through the 9 scorer functions.
    Returns a 10-element list:
        [score_0, ..., score_8, total_score]
    The 10th element (total) gives the model visibility of aggregate load.
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


# ─── Step-bounded weight update ──────────────────────────────────────

def _apply_bounded_step(
    base_weight: float,
    coeff: float,
    all_coeffs: list[float],
) -> float:
    """
    Compute a new weight by taking a conservative step from the base weight.

    The step direction and magnitude:
      - Positive coeff → signal predicts loss → step UP (increase weight)
      - Negative coeff → signal does not predict loss → step DOWN
      - Step magnitude is proportional to how extreme the coefficient is
        relative to the full range, then scaled to MAX_STEP_FRACTION.

    This guarantees:
      - Any single training cycle can change a weight by at most ±10%
        of its base value.
      - Weights are clamped to [WEIGHT_ABS_MIN, WEIGHT_ABS_MAX].
      - If all coefficients are identical (degenerate model), no change is made.

    Args:
        base_weight: The canonical BASE_WEIGHT for this signal.
        coeff: The raw LogisticRegression coefficient for this feature.
        all_coeffs: All 9 raw coefficients (used to normalize the range).

    Returns:
        New weight value after the bounded step.
    """
    c_min = min(all_coeffs)
    c_max = max(all_coeffs)

    if math.isclose(c_min, c_max, rel_tol=1e-9):
        # Degenerate: all coefficients the same — no information, no change.
        return base_weight

    # Normalize this coefficient to [-1, +1] relative to the range midpoint.
    # Coefficients at c_max → +1 (upweight), at c_min → -1 (downweight).
    c_mid = (c_min + c_max) / 2.0
    c_half_range = (c_max - c_min) / 2.0
    normalized = (coeff - c_mid) / c_half_range  # in [-1, +1]

    # Max allowed step = 10% of base weight
    max_step = base_weight * MAX_STEP_FRACTION

    # Actual step = normalized direction × max step
    step = normalized * max_step

    new_weight = base_weight + step

    # Hard clamp to safety bounds
    return max(WEIGHT_ABS_MIN, min(WEIGHT_ABS_MAX, new_weight))


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

    The returned weights dict maps signal_key → adjusted_weight.
    Every weight is guaranteed to be within ±10% of the corresponding
    BASE_WEIGHT, so callers can apply them without risk of large swings.
    """
    # Filter to rows with a resolved actualPnl AND a signals dict
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

    loss_rate = sum(y) / len(y)
    print(
        f"[weight_trainer] Building feature matrix: {sample_size} rows, "
        f"{len(X[0])} features. "
        f"Loss rate: {loss_rate:.1%}",
        file=sys.stderr,
    )

    # Logistic regression requires at least two classes.  A 0% or 100% loss rate
    # provides no signal for weight calibration — return early without error.
    unique_labels = set(y)
    if len(unique_labels) < 2:
        return {
            "status": "insufficient_data",
            "message": (
                f"Training requires both wins and losses in the dataset; "
                f"got only class {list(unique_labels)[0]} across {sample_size} samples. "
                f"Loss rate: {loss_rate:.1%}"
            ),
            "sampleSize": sample_size,
            "windowDays": window_days,
            "baselineAccuracy": None,
            "trainedAccuracy": None,
            "weights": {},
        }

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

    # Extract coefficients for the 9 signal features (index 0–8); skip index 9 (total)
    raw_coeffs_9 = list(model.coef_[0][:9])

    print(
        f"[weight_trainer] Trained accuracy: {trained_accuracy:.3f} "
        f"(baseline: {baseline_accuracy:.3f}). "
        f"Raw coefficients: {[round(c, 4) for c in raw_coeffs_9]}",
        file=sys.stderr,
    )

    # Apply bounded steps from each base weight — max ±10% per cycle
    learned_weights: dict[str, float] = {}
    for i, key in enumerate(SIGNAL_KEYS):
        base = BASE_WEIGHTS[key]
        new_w = _apply_bounded_step(base, raw_coeffs_9[i], raw_coeffs_9)
        learned_weights[key] = round(new_w, 6)

    print(
        f"[weight_trainer] Learned weights (±10% cap applied): {learned_weights}",
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
    Reads --config <json_string_or_file_path> from sys.argv.
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

    # Support both inline JSON and file paths (python-runner passes a temp file path)
    import os
    if os.path.isfile(config_json):
        try:
            with open(config_json, "r", encoding="utf-8") as f:
                config = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            result = {
                "status": "error",
                "message": f"Failed to read config file: {exc}",
                "sampleSize": 0,
                "windowDays": 0,
                "baselineAccuracy": None,
                "trainedAccuracy": None,
                "weights": {},
            }
            print(json.dumps(result))
            sys.exit(1)
    else:
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
