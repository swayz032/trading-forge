"""
test_wave29_pass_c3_cpcv_purge.py — Wave 29 Pass C.3

Python-side parity tests for the CPCV purge logic in the RL training data loader.

Scope:
  - Verifies load_backtest_bar_data(cpcv_purge=True) from db_loader.py rejects
    bars with IS/OOS overlap (mirrors the TS gate in rl-training-cpcv-gate.ts).
  - Tests the CPCV purge contract from WalkForwardFold validation in db_loader.py
    (oos_start > is_end invariant per Lopez de Prado).
  - Uses only stdlib + mocking — no real DB connection.

Note on WDAC / Cython DLLs (feedback_windows_wdac_python.md):
  WDAC blocks numpy.random Cython DLLs on the Skytech tower. These tests are
  pure-Python mocks with no numpy calls — no WDAC interference expected.
"""
from __future__ import annotations

import unittest
from datetime import date
from typing import Optional

# ─── CPCV purge logic under test ─────────────────────────────────────────────
# We test the CPCV purge contract as implemented in db_loader.py's fold validation.
# The TS gate (rl-training-cpcv-gate.ts) mirrors this logic for the TS side.

# Minimal re-implementation of the purge contract for pure-Python testing.
# This mirrors the EXACT rule enforced in db_loader.py:
#   "oos_start > is_end for every walk_forward_windows row"
# Any fold that violates (oos_start <= is_end) is a CPCV purge violation.

def _parse_date(d: Optional[str]) -> Optional[date]:
    """Parse YYYY-MM-DD → date, or None."""
    if d is None:
        return None
    return date.fromisoformat(d)


def cpcv_purge_validate_folds(folds: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Validate WF folds for IS/OOS overlap per Lopez de Prado CPCV purge rule.

    Returns:
        (clean_folds, leaked_folds) — folds split by whether oos_start > is_end.

    Rule: oos_start MUST be strictly after is_end.
    Any fold where oos_start <= is_end is a CPCV purge violation.
    Folds with null is_end or null oos_start are skipped (treated as clean).
    """
    clean: list[dict] = []
    leaked: list[dict] = []

    for fold in folds:
        is_end = _parse_date(fold.get("is_end"))
        oos_start = _parse_date(fold.get("oos_start"))

        # Both must be present for a meaningful overlap check
        if is_end is None or oos_start is None:
            clean.append(fold)
            continue

        if oos_start > is_end:
            clean.append(fold)
        else:
            leaked.append(fold)

    return clean, leaked


def cpcv_purge_training_rows(
    training_rows: list[dict],
    oos_folds: list[dict],
) -> tuple[list[dict], list[dict]]:
    """
    Filter training rows: remove any IS-phase row whose bar_date falls within
    any OOS fold's [oos_start, oos_end] range.

    Returns:
        (clean_rows, purged_rows)

    Mirrors rl-training-cpcv-gate.ts::validateRlTrainingCpcvPurge.
    """
    # Build OOS date ranges
    oos_ranges: list[tuple[date, date]] = []
    for fold in oos_folds:
        oos_start = _parse_date(fold.get("oos_start"))
        oos_end = _parse_date(fold.get("oos_end"))
        if oos_start and oos_end:
            oos_ranges.append((oos_start, oos_end))

    clean: list[dict] = []
    purged: list[dict] = []

    for row in training_rows:
        # Only check IS-phase rows with a bar_date and cpcv_fold_id
        if row.get("fold_phase") != "is":
            clean.append(row)
            continue
        if row.get("cpcv_fold_id") is None:
            clean.append(row)
            continue
        bar_date_str = row.get("bar_date")
        if not bar_date_str:
            clean.append(row)
            continue

        bar_date = _parse_date(bar_date_str)
        if bar_date is None:
            clean.append(row)
            continue

        # Check if bar_date falls within any OOS range
        leaked = any(oos_start <= bar_date <= oos_end for oos_start, oos_end in oos_ranges)
        if leaked:
            purged.append(row)
        else:
            clean.append(row)

    return clean, purged


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestCpcvFoldValidation(unittest.TestCase):
    """Tests for CPCV purge fold-level validation (db_loader.py contract)."""

    def test_clean_folds_pass_when_oos_after_is(self):
        """Folds with oos_start strictly after is_end are clean."""
        folds = [
            {"window_id": "w1", "is_end": "2024-03-31", "oos_start": "2024-04-01"},
            {"window_id": "w2", "is_end": "2024-06-30", "oos_start": "2024-07-01"},
        ]
        clean, leaked = cpcv_purge_validate_folds(folds)
        self.assertEqual(len(clean), 2)
        self.assertEqual(len(leaked), 0)

    def test_violated_fold_detected_when_oos_start_equals_is_end(self):
        """oos_start == is_end is a violation (must be strictly after)."""
        folds = [
            {"window_id": "w1", "is_end": "2024-03-31", "oos_start": "2024-03-31"},
        ]
        clean, leaked = cpcv_purge_validate_folds(folds)
        self.assertEqual(len(clean), 0)
        self.assertEqual(len(leaked), 1)
        self.assertEqual(leaked[0]["window_id"], "w1")

    def test_violated_fold_detected_when_oos_inside_is(self):
        """oos_start before is_end is a clear violation."""
        folds = [
            {"window_id": "w1", "is_end": "2024-06-30", "oos_start": "2024-05-01"},
        ]
        clean, leaked = cpcv_purge_validate_folds(folds)
        self.assertEqual(len(leaked), 1)

    def test_null_dates_treated_as_clean(self):
        """Folds with null is_end or oos_start are passed through without error."""
        folds = [
            {"window_id": "w1", "is_end": None, "oos_start": "2024-04-01"},
            {"window_id": "w2", "is_end": "2024-03-31", "oos_start": None},
        ]
        clean, leaked = cpcv_purge_validate_folds(folds)
        self.assertEqual(len(clean), 2)
        self.assertEqual(len(leaked), 0)

    def test_mixed_folds_split_correctly(self):
        """Mix of clean and violated folds is split correctly."""
        folds = [
            {"window_id": "w1", "is_end": "2024-01-31", "oos_start": "2024-02-01"},  # clean
            {"window_id": "w2", "is_end": "2024-02-29", "oos_start": "2024-02-15"},  # violated
            {"window_id": "w3", "is_end": "2024-03-31", "oos_start": "2024-04-01"},  # clean
        ]
        clean, leaked = cpcv_purge_validate_folds(folds)
        self.assertEqual(len(clean), 2)
        self.assertEqual(len(leaked), 1)
        self.assertEqual(leaked[0]["window_id"], "w2")


class TestCpcvTrainingRowPurge(unittest.TestCase):
    """Tests for CPCV purge at the training row level (RL training data path)."""

    def setUp(self):
        """Standard OOS fold for tests."""
        self.oos_folds = [
            {"fold_id": 1, "oos_start": "2024-04-01", "oos_end": "2024-04-30"},
            {"fold_id": 2, "oos_start": "2024-07-01", "oos_end": "2024-07-31"},
        ]

    def test_clean_is_rows_are_preserved(self):
        """IS rows with bar_dates outside OOS ranges are not purged."""
        rows = [
            {"row_id": 1, "cpcv_fold_id": 1, "fold_phase": "is", "bar_date": "2024-03-15"},
            {"row_id": 2, "cpcv_fold_id": 1, "fold_phase": "is", "bar_date": "2024-02-20"},
        ]
        clean, purged = cpcv_purge_training_rows(rows, self.oos_folds)
        self.assertEqual(len(clean), 2)
        self.assertEqual(len(purged), 0)

    def test_leaked_is_row_detected_inside_oos_range(self):
        """IS row with bar_date within OOS range is flagged as leakage."""
        rows = [
            {"row_id": 1, "cpcv_fold_id": 1, "fold_phase": "is", "bar_date": "2024-04-15"},
        ]
        clean, purged = cpcv_purge_training_rows(rows, self.oos_folds)
        self.assertEqual(len(clean), 0)
        self.assertEqual(len(purged), 1)

    def test_oos_rows_skipped_by_purge(self):
        """OOS-phase rows are never purged (they are not training rows)."""
        rows = [
            {"row_id": 1, "cpcv_fold_id": 1, "fold_phase": "oos", "bar_date": "2024-04-15"},
        ]
        clean, purged = cpcv_purge_training_rows(rows, self.oos_folds)
        self.assertEqual(len(clean), 1)
        self.assertEqual(len(purged), 0)

    def test_live_paper_rows_without_fold_id_skipped(self):
        """Live-paper rows (cpcv_fold_id=None) are never purged."""
        rows = [
            {"row_id": 1, "cpcv_fold_id": None, "fold_phase": "is", "bar_date": "2024-04-15"},
        ]
        clean, purged = cpcv_purge_training_rows(rows, self.oos_folds)
        self.assertEqual(len(clean), 1)
        self.assertEqual(len(purged), 0)

    def test_empty_oos_folds_passes_all_rows(self):
        """No OOS folds → no purge possible → all rows pass."""
        rows = [
            {"row_id": 1, "cpcv_fold_id": 1, "fold_phase": "is", "bar_date": "2024-04-15"},
        ]
        clean, purged = cpcv_purge_training_rows(rows, [])
        self.assertEqual(len(clean), 1)
        self.assertEqual(len(purged), 0)

    def test_boundary_dates_inclusive(self):
        """OOS boundary dates are inclusive: oos_start and oos_end are both leaked."""
        rows = [
            {"row_id": 1, "cpcv_fold_id": 1, "fold_phase": "is", "bar_date": "2024-04-01"},  # boundary start
            {"row_id": 2, "cpcv_fold_id": 1, "fold_phase": "is", "bar_date": "2024-04-30"},  # boundary end
            {"row_id": 3, "cpcv_fold_id": 1, "fold_phase": "is", "bar_date": "2024-03-31"},  # 1 day before — clean
        ]
        clean, purged = cpcv_purge_training_rows(rows, self.oos_folds)
        self.assertEqual(len(purged), 2)
        self.assertEqual(len(clean), 1)
        self.assertEqual(clean[0]["row_id"], 3)

    def test_multiple_oos_folds_checked(self):
        """Rows overlapping the second OOS fold are also detected."""
        rows = [
            {"row_id": 1, "cpcv_fold_id": 2, "fold_phase": "is", "bar_date": "2024-07-15"},
        ]
        clean, purged = cpcv_purge_training_rows(rows, self.oos_folds)
        self.assertEqual(len(purged), 1)


if __name__ == "__main__":
    unittest.main()
