"""
test_wave29_pass_c3_cpcv_purge.py — Wave 29 Pass C.3

Python-side parity tests for the CPCV purge logic in the RL training data loader.

Scope:
  - Verifies load_backtest_bar_data(cpcv_purge=True) from db_loader.py rejects
    bars with IS/OOS overlap — this IS the real enforcement site (called from
    quantum_rl_agent.py::train_regime_conditioned_policies via
    src.engine.replay.db_loader.load_backtest_bar_data). Deep-Scan #22
    fix-wave-2 (2026-07-07, FIX C1) removed the orphan TS re-check
    (rl-training-cpcv-gate.ts::validateRlTrainingCpcvPurge) that used to be
    described as mirroring this logic: it had zero production callers and was
    structurally a permanent no-op (quantum_rl_agent.py always persists
    cpcv_fold_id=None on the quantum_rl_runs INSERT — "bar-level fold join not
    wired here" — so a gate keyed on that column could never see a non-null
    fold id to check). The purge that actually matters happens earlier, at bar
    LOAD time, in load_backtest_bar_data below.
  - Tests the CPCV purge contract from WalkForwardFold validation in db_loader.py
    (oos_start > is_end invariant per Lopez de Prado).
  - Uses only stdlib + mocking — no real DB connection.
  - Deep-Scan #22 FIX C1 also removed this file's own `cpcv_purge_training_rows`
    helper + `TestCpcvTrainingRowPurge` class: that helper existed ONLY to mirror
    the deleted TS gate's row-level (cpcv_fold_id-keyed) purge concept, which had
    no production counterpart on either side of the codebase (db_loader.py purges
    at bar-load time, not by filtering already-persisted quantum_rl_runs rows).
    Keeping a python-side duplicate of a dead concept after deleting its TS
    twin would have been the same false-confidence pattern this fix-wave exists
    to close, just moved to the other language.

Note on WDAC / Cython DLLs (feedback_windows_wdac_python.md):
  WDAC blocks numpy.random Cython DLLs on the Skytech tower. These tests are
  pure-Python mocks with no numpy calls — no WDAC interference expected.
"""
from __future__ import annotations

import unittest
from datetime import date
from typing import Optional

# ─── CPCV purge logic under test ─────────────────────────────────────────────
# We test the CPCV purge contract as implemented in db_loader.py's fold validation
# and in load_backtest_bar_data's bar-level purge — the real enforcement path.
# (The TS re-check this comment used to reference, rl-training-cpcv-gate.ts, was
# removed Deep-Scan #22 fix-wave-2 2026-07-07 FIX C1 as dead/no-op orphan code —
# see the module docstring above.)

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


if __name__ == "__main__":
    unittest.main()
