"""null_calibration_guard.py — Marker enforcement for null calibration runs.

All null-calibration backtest results MUST carry governance_labels["null_calibration"]=True
before any persistence to the database. This guard mirrors the replay_mode marker pattern
from the quantum replay harness (src/engine/replay/quantum_replay.py).

CONTRACT:
  Any function that persists a null calibration result MUST call
  validate_null_calibration_labels() before the DB write. Failure to do so
  raises ValueError (fail-closed).

WHY:
  Null calibration runs are synthetic, edge-free backtests run specifically to
  measure the gate battery's false-pass rate. They MUST NEVER mix with real
  strategy rows in the backtests or quantum_mc_runs tables. A contaminated
  real-strategy row would corrupt the lifecycle promotion gates.

PARALLEL:
  - quantum_mc_runs.governance_labels->>'replay_mode' = 'true' (Wave 27 Pass 1)
  - quantum_mc_runs.governance_labels->>'training_mode' = 'true' (Wave 29 Pass C)
  - null_calibration: True — this module (Layer 4 null-strategy gate calibration)
"""

from __future__ import annotations

from typing import Any  # noqa: I001

# ─── Required marker keys ─────────────────────────────────────────────────────

NULL_CALIBRATION_LABEL_KEY = "null_calibration"
NULL_CALIBRATION_SEED_KEY = "null_seed"


def build_null_calibration_labels(
    null_seed: int,
    strategy_index: int,
    extra: dict | None = None,
) -> dict:
    """Build a governance_labels dict with the null_calibration marker.

    Always includes:
        null_calibration: True  — required marker, prevents mixing with real rows
        null_seed: <int>         — records the generator seed for provenance

    Args:
        null_seed: The generator seed used to produce this spec.
        strategy_index: The index of this null within the batch.
        extra: Optional additional key-value pairs to merge in.

    Returns:
        dict suitable for governance_labels JSON column.
    """
    labels: dict = {
        NULL_CALIBRATION_LABEL_KEY: True,
        NULL_CALIBRATION_SEED_KEY: null_seed,
        "strategy_index": strategy_index,
    }
    if extra:
        labels.update(extra)
    return labels


def validate_null_calibration_labels(labels: Any) -> None:
    """Assert that labels carry the null_calibration marker.

    Call this before ANY DB persistence of a null calibration result.
    Fail-closed: raises ValueError if the marker is absent.

    Args:
        labels: The governance_labels dict to check.

    Raises:
        ValueError: If labels is not a dict, or does not contain
            null_calibration=True. Also raises if null_seed is absent.
    """
    if not isinstance(labels, dict):
        raise ValueError(
            f"null_calibration_guard: governance_labels must be a dict, "
            f"got {type(labels).__name__}. "
            f"Add null_calibration_guard.build_null_calibration_labels() to this call."
        )

    if not labels.get(NULL_CALIBRATION_LABEL_KEY):
        raise ValueError(
            f"null_calibration_guard: governance_labels missing required "
            f"'{NULL_CALIBRATION_LABEL_KEY}': True marker. "
            f"Null calibration rows MUST carry this marker to prevent mixing "
            f"with real strategy rows (replay_mode precedent). "
            f"Got labels: {labels!r}"
        )

    if NULL_CALIBRATION_SEED_KEY not in labels:
        raise ValueError(
            f"null_calibration_guard: governance_labels missing required "
            f"'{NULL_CALIBRATION_SEED_KEY}' key. "
            f"Record the generator seed for calibration provenance. "
            f"Got labels: {labels!r}"
        )


def is_null_calibration_row(labels: Any) -> bool:
    """Return True if the labels identify a null calibration row.

    Safe to call on any labels dict. Returns False on any error.
    """
    try:
        return bool(labels.get(NULL_CALIBRATION_LABEL_KEY)) if isinstance(labels, dict) else False
    except Exception:
        return False
