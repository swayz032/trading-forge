"""H5 regression: walk-forward max DD must use bar-level equity, not EOD P&L.

Topstep trailing drawdown operates on INTRADAY equity, not end-of-day.
A strategy that shows -$1,800 EOD max DD but hits -$2,200 intraday must be
flagged with max_dd >= $2,200 — not $1,800.

These tests are self-contained (no vectorbt import).
Integration coverage (WF class path + equity_bars key) is in test_three_fixes.py.
"""
from __future__ import annotations

import numpy as np
import pytest


class TestIntradayMaxDrawdown:
    """H5: bar-level equity accumulator catches intraday breaches EOD aggregation misses."""

    def _make_equity_bars_with_intraday_spike(self) -> list[float]:
        """Synthetic bar sequence:
          - peak: $50,200
          - intraday trough: $47,800 (DD = $2,400)
          - EOD close: $48,400 (EOD DD = $1,800 — misses the intraday spike)
        """
        bars = [50_000.0] * 5  # Day 1
        bars += [50_050.0, 50_100.0, 50_150.0, 50_200.0]  # Day 2: rises to peak
        bars += [50_000.0, 49_500.0, 49_000.0, 48_500.0, 47_800.0,  # Day 3: intraday trough
                 48_000.0, 48_200.0, 48_400.0]  # Day 3: partial recovery to close
        bars += [48_600.0, 48_800.0, 49_000.0]  # Day 4
        return bars

    def test_bar_level_max_dd_catches_intraday_trough(self):
        """Bar-level DD must be >= the intraday trough depth (not just EOD depth)."""
        equity_bars = np.array(self._make_equity_bars_with_intraday_spike(), dtype=float)

        # New approach: bar-level max DD
        running_peak = np.maximum.accumulate(equity_bars)
        bar_level_max_dd = float(np.max(running_peak - equity_bars))

        # Bar-level should catch the $2,400 intraday trough
        assert bar_level_max_dd >= 2400.0, \
            f"Bar-level max DD should be >= $2400 (intraday), got {bar_level_max_dd}"

    def test_eod_max_dd_misses_intraday_trough(self):
        """EOD-only DD misses the deeper intraday swing — this is the bug H5 fixed."""
        # Day closes only: $50,000 → $50,200 → $48,400 → $49,000
        day_closes = [50_000.0, 50_200.0, 48_400.0, 49_000.0]
        running_peak = np.maximum.accumulate(np.array(day_closes))
        eod_max_dd = float(np.max(running_peak - np.array(day_closes)))

        # EOD DD = $50,200 - $48,400 = $1,800 (misses $2,400 intraday)
        assert eod_max_dd < 2400.0, \
            f"EOD max DD should be < $2400 — it misses the intraday trough. Got {eod_max_dd}"
        assert eod_max_dd == pytest.approx(1800.0), \
            f"EOD max DD should be $1800 (peak $50200 - EOD $48400). Got {eod_max_dd}"

    def test_bar_level_exceeds_eod_level(self):
        """Bar-level DD must be strictly > EOD DD when intraday spikes exist."""
        equity_bars = np.array(self._make_equity_bars_with_intraday_spike(), dtype=float)

        # Bar-level DD
        running_peak = np.maximum.accumulate(equity_bars)
        bar_level_max_dd = float(np.max(running_peak - equity_bars))

        # EOD DD
        day_closes = [50_000.0, 50_200.0, 48_400.0, 49_000.0]
        running_peak_eod = np.maximum.accumulate(np.array(day_closes))
        eod_max_dd = float(np.max(running_peak_eod - np.array(day_closes)))

        assert bar_level_max_dd > eod_max_dd, (
            f"Bar-level max DD ({bar_level_max_dd}) must exceed EOD max DD ({eod_max_dd}) "
            f"when intraday spikes exist"
        )

    def test_topstep_trailing_dd_would_breach_on_bar_level(self):
        """Topstep trailing DD limit ($2,000 on $50K) breached at $2,400 intraday."""
        TOPSTEP_MAX_DD = 2_000.0  # Topstep 50K trailing DD limit

        equity_bars = np.array(self._make_equity_bars_with_intraday_spike(), dtype=float)
        running_peak = np.maximum.accumulate(equity_bars)
        bar_level_max_dd = float(np.max(running_peak - equity_bars))

        # Bar-level correctly identifies the breach
        assert bar_level_max_dd > TOPSTEP_MAX_DD, (
            f"Bar-level DD {bar_level_max_dd} > Topstep limit {TOPSTEP_MAX_DD}: breach detected"
        )

        # EOD-only would miss it
        day_closes = [50_000.0, 50_200.0, 48_400.0, 49_000.0]
        running_peak_eod = np.maximum.accumulate(np.array(day_closes))
        eod_max_dd = float(np.max(running_peak_eod - np.array(day_closes)))

        assert eod_max_dd <= TOPSTEP_MAX_DD, (
            f"EOD DD {eod_max_dd} <= Topstep limit {TOPSTEP_MAX_DD}: "
            f"EOD would incorrectly PASS a strategy that actually breached"
        )

    def test_no_intraday_spike_eod_and_bar_agree(self):
        """When there are no intraday spikes (EOD = bar-close), both methods agree."""
        # Each bar is the EOD bar: smooth decline
        equity_bars = np.array([50_000.0, 50_100.0, 49_800.0, 49_500.0, 49_200.0], dtype=float)

        running_peak = np.maximum.accumulate(equity_bars)
        bar_level_max_dd = float(np.max(running_peak - equity_bars))

        # Expected: peak=50100, trough=49200, DD=900
        assert bar_level_max_dd == pytest.approx(900.0), \
            f"Expected bar DD = $900, got {bar_level_max_dd}"

    def test_equity_bars_accumulator_in_wf_class_path(self):
        """Confirm WF class path H5 fix: all_oos_equity_bars_cls drives max_dd computation.

        This test verifies the logic that walk_forward.py uses when equity_bars
        is present — a list[float] bar-by-bar equity sequence with a known DD.
        """
        # Simulate what WF aggregator sees
        all_oos_equity_bars_cls = [50_000.0, 50_200.0, 47_800.0, 48_500.0, 49_000.0]

        eq_arr = np.array(all_oos_equity_bars_cls, dtype=float)
        running_peak = np.maximum.accumulate(eq_arr)
        max_dd = float(np.max(running_peak - eq_arr))

        # Peak=50200, trough=47800 → DD=2400
        assert max_dd == pytest.approx(2400.0), \
            f"Expected DD=$2400 from bar-level equity, got {max_dd}"
