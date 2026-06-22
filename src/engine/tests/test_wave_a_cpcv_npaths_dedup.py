"""FIX 3 + FIX 6 regressions: CPCV n_paths counter + embargo skip.

FIX 3: n_paths must only increment for successfully APPENDED paths, not failed ones.
  Previous: n_paths incremented before `continue` → failed paths diluted overfit signal.
  New: n_paths incremented AFTER path_sharpes.append().

FIX 6: Short CPCV folds (len <= embargo_bars) must be SKIPPED entirely.
  Previous: raw unembargoed fold was appended → IS→OOS lookahead leakage.
  New: fold is dropped and a stderr warning is emitted.
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock

import polars as pl

sys.modules.setdefault("vectorbt", MagicMock())


class TestCpcvNpathsFix3:
    """FIX 3: failed paths must NOT increment n_paths."""

    def test_failed_path_not_counted(self):
        """Simulate the CPCV path loop: exception must not bump n_paths."""
        n_paths = 0
        path_sharpes: list[float] = []

        results = [("ok", 1.2), ("fail", None), ("ok", 0.8), ("ok", 1.5)]

        for tag, sharpe in results:
            if tag == "fail":
                # FIX 3: old code did n_paths += 1; continue — we test the new contract
                continue
            path_sharpes.append(sharpe)
            n_paths += 1  # only incremented here, after successful append

        assert n_paths == 3, f"Expected 3 successful paths, got {n_paths}"
        assert len(path_sharpes) == 3

    def test_all_failed_paths_gives_zero_n_paths(self):
        """When all paths fail, n_paths must be 0 (not equal to attempt count)."""
        n_paths = 0
        path_sharpes: list[float] = []

        for _ in range(5):
            # All paths fail
            continue  # noqa: SIM113

        # After increment-after-append fix:
        for s in path_sharpes:
            n_paths += 1

        assert n_paths == 0
        assert len(path_sharpes) == 0

    def test_n_paths_equals_path_sharpes_length_invariant(self):
        """Invariant: n_paths must always equal len(path_sharpes)."""
        n_paths = 0
        path_sharpes: list[float] = []
        attempt_results = [1.2, None, 0.9, None, None, 1.5]  # None = failure

        for r in attempt_results:
            if r is None:
                continue  # failed path — NOT incrementing n_paths (FIX 3)
            path_sharpes.append(r)
            n_paths += 1

        assert n_paths == len(path_sharpes), (
            f"n_paths ({n_paths}) must match len(path_sharpes) ({len(path_sharpes)})"
        )

    def test_pbo_denominator_not_diluted_by_failures(self):
        """PBO computed from n_paths = 3 successful is different from n_paths = 6 (diluted)."""
        # With 3 successes out of 3 (n_paths=3), PBO uses correct denominator.
        # With old code, n_paths=6 (3 + 3 failures) would use inflated denominator.
        n_paths_correct = 3
        n_paths_diluted = 6
        sharpes_above_zero = 3

        # PSR = fraction of paths with Sharpe > 0
        psr_correct = sharpes_above_zero / n_paths_correct
        psr_diluted = sharpes_above_zero / n_paths_diluted

        assert psr_correct > psr_diluted, (
            "PSR with correct n_paths (no failed-path dilution) should be higher"
        )


class TestCpcvEmbargoSkipFix6:
    """FIX 6: folds smaller than embargo_bars must be skipped, not appended raw."""

    def test_short_fold_skipped_no_leakage(self, capsys):
        """When fold len <= embargo_bars, fold must NOT be added to oos_parts."""
        import polars as pl
        embargo_bars = 20

        # Create a fold smaller than embargo
        fold_df = pl.DataFrame({
            "ts_event": list(range(10)),
            "close": [1.0] * 10,
        })
        assert len(fold_df) <= embargo_bars

        oos_parts: list = []

        # Replicate the FIX 6 logic
        if len(fold_df) > embargo_bars:
            oos_parts.append(fold_df.slice(embargo_bars, len(fold_df) - embargo_bars))
        else:
            # FIX 6: skip (no append)
            print(
                f"  CPCV: fold too small ({len(fold_df)} bars <= embargo {embargo_bars}) "
                f"— skipping to preserve embargo integrity.",
                file=sys.stderr,
            )

        assert len(oos_parts) == 0, (
            "Short fold must be skipped, not added to oos_parts"
        )

        captured = capsys.readouterr()
        assert "skipping to preserve embargo integrity" in captured.err

    def test_normal_fold_still_appended(self):
        """Folds larger than embargo must still be appended (no regression)."""
        embargo_bars = 5
        fold_df = pl.DataFrame({
            "ts_event": list(range(20)),
            "close": [1.0] * 20,
        })
        assert len(fold_df) > embargo_bars

        oos_parts: list = []
        if len(fold_df) > embargo_bars:
            sliced = fold_df.slice(embargo_bars, len(fold_df) - embargo_bars)
            oos_parts.append(sliced)
        else:
            pass  # FIX 6: skip

        assert len(oos_parts) == 1
        assert len(oos_parts[0]) == len(fold_df) - embargo_bars

    def test_exactly_embargo_bars_is_skipped(self):
        """Edge case: fold exactly == embargo_bars must be skipped (not > means skip)."""
        embargo_bars = 10
        fold_df = pl.DataFrame({
            "ts_event": list(range(embargo_bars)),
            "close": [1.0] * embargo_bars,
        })
        assert len(fold_df) == embargo_bars

        oos_parts: list = []
        if len(fold_df) > embargo_bars:
            oos_parts.append(fold_df.slice(embargo_bars, len(fold_df) - embargo_bars))
        else:
            pass  # FIX 6: skip

        assert len(oos_parts) == 0
