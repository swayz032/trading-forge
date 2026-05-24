"""Wave 24 Pass 1 — Item 14: Blackout gate backtest parity tests.

Verifies that the blackout gate:
  - Blocks entries during FOMC/CPI/NFP windows
  - Allows entries after the window ends
  - Is idempotent (applying twice gives same result)
  - Pure function: no side effects
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.engine.context.blackout_gate import (
    BlackoutWindow,
    apply_blackout_mask_to_entries,
    parse_blackout_windows,
    should_block_for_blackout,
)

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _fomc_window() -> BlackoutWindow:
    """Typical FOMC blackout: 13:45–15:00 ET on a Wednesday."""
    return BlackoutWindow(
        name="FOMC",
        start=pd.Timestamp("2024-01-31 13:45:00"),
        end=pd.Timestamp("2024-01-31 15:00:00"),
    )


def _nfp_window() -> BlackoutWindow:
    """NFP blackout: 08:30–09:00 ET on first Friday."""
    return BlackoutWindow(
        name="NFP",
        start=pd.Timestamp("2024-02-02 08:30:00"),
        end=pd.Timestamp("2024-02-02 09:00:00"),
    )


# ─── should_block_for_blackout ────────────────────────────────────────────────

class TestShouldBlockForBlackout:
    def test_blocks_inside_window(self):
        bw = _fomc_window()
        ts = pd.Timestamp("2024-01-31 14:00:00")
        assert should_block_for_blackout(ts, [bw]) is True

    def test_allows_before_window(self):
        bw = _fomc_window()
        ts = pd.Timestamp("2024-01-31 13:30:00")
        assert should_block_for_blackout(ts, [bw]) is False

    def test_allows_after_window(self):
        bw = _fomc_window()
        ts = pd.Timestamp("2024-01-31 15:01:00")
        assert should_block_for_blackout(ts, [bw]) is False

    def test_blocks_at_start_inclusive(self):
        """Interval is [start, end) — start is blocked."""
        bw = _fomc_window()
        ts = pd.Timestamp("2024-01-31 13:45:00")  # exactly at start
        assert should_block_for_blackout(ts, [bw]) is True

    def test_allows_at_end_exclusive(self):
        """Interval is [start, end) — end is NOT blocked."""
        bw = _fomc_window()
        ts = pd.Timestamp("2024-01-31 15:00:00")  # exactly at end
        assert should_block_for_blackout(ts, [bw]) is False

    def test_empty_blackouts_never_blocks(self):
        ts = pd.Timestamp("2024-01-31 14:00:00")
        assert should_block_for_blackout(ts, []) is False

    def test_multiple_windows_blocked_by_any(self):
        windows = [_fomc_window(), _nfp_window()]
        ts_fomc = pd.Timestamp("2024-01-31 14:30:00")
        ts_nfp = pd.Timestamp("2024-02-02 08:45:00")
        ts_free = pd.Timestamp("2024-02-01 12:00:00")
        assert should_block_for_blackout(ts_fomc, windows) is True
        assert should_block_for_blackout(ts_nfp, windows) is True
        assert should_block_for_blackout(ts_free, windows) is False

    def test_different_day_not_blocked(self):
        """Window on one day must not block same time on a different day."""
        bw = _fomc_window()  # 2024-01-31
        ts = pd.Timestamp("2024-02-01 14:00:00")  # 2024-02-01
        assert should_block_for_blackout(ts, [bw]) is False


# ─── apply_blackout_mask_to_entries ──────────────────────────────────────────

class TestApplyBlackoutMask:
    def _make_signals(self, n: int = 5):
        entry_long = np.ones(n, dtype=bool)
        entry_short = np.zeros(n, dtype=bool)
        return entry_long, entry_short

    def _make_timestamps(self, base_date: str = "2024-01-31"):
        """5 bars: pre-window, inside, inside, at end (allowed), after."""
        return [
            f"{base_date}T13:30:00",  # before FOMC → allow
            f"{base_date}T13:45:00",  # at FOMC start → block
            f"{base_date}T14:00:00",  # inside FOMC → block
            f"{base_date}T15:00:00",  # at FOMC end → allow (exclusive)
            f"{base_date}T15:30:00",  # after FOMC → allow
        ]

    def test_blocks_inside_fomc_window(self):
        el, es = self._make_signals(5)
        ts = self._make_timestamps()
        windows = [_fomc_window()]
        out_l, out_s, n_skips = apply_blackout_mask_to_entries(el, es, ts, windows)
        # Bar 0: allow, Bar 1: block, Bar 2: block, Bar 3: allow, Bar 4: allow
        assert out_l[0] is np.bool_(True)
        assert out_l[1] is np.bool_(False)
        assert out_l[2] is np.bool_(False)
        assert out_l[3] is np.bool_(True)
        assert out_l[4] is np.bool_(True)
        assert n_skips == 2

    def test_no_blackouts_returns_unchanged(self):
        el, es = self._make_signals(5)
        ts = self._make_timestamps()
        out_l, out_s, n_skips = apply_blackout_mask_to_entries(el, es, ts, [])
        np.testing.assert_array_equal(out_l, el)
        assert n_skips == 0

    def test_idempotent(self):
        """Applying blackout mask twice gives same result as once."""
        el, es = self._make_signals(5)
        ts = self._make_timestamps()
        windows = [_fomc_window()]
        out1_l, out1_s, _ = apply_blackout_mask_to_entries(el, es, ts, windows)
        out2_l, out2_s, _ = apply_blackout_mask_to_entries(out1_l, out1_s, ts, windows)
        np.testing.assert_array_equal(out1_l, out2_l)
        np.testing.assert_array_equal(out1_s, out2_s)

    def test_n_skips_counts_suppressed_entries_only(self):
        """n_skips counts bars where at least one entry was True AND was blocked."""
        # Only long entries are True; skips = 2 (bars 1 and 2)
        el = np.array([True, True, True, True, True])
        es = np.zeros(5, dtype=bool)
        ts = self._make_timestamps()
        _, _, n_skips = apply_blackout_mask_to_entries(el, es, ts, [_fomc_window()])
        assert n_skips == 2

    def test_short_entries_also_blocked(self):
        """Both long and short entries are blocked inside blackout."""
        el = np.ones(5, dtype=bool)
        es = np.ones(5, dtype=bool)
        ts = self._make_timestamps()
        out_l, out_s, _ = apply_blackout_mask_to_entries(el, es, ts, [_fomc_window()])
        assert not out_l[1]
        assert not out_s[1]


# ─── parse_blackout_windows ───────────────────────────────────────────────────

class TestParseBlackoutWindows:
    def test_parses_valid_dicts(self):
        raw = [
            {"name": "FOMC", "start": "2024-01-31 13:45:00", "end": "2024-01-31 15:00:00"},
            {"name": "CPI", "start": "2024-02-13 08:30:00", "end": "2024-02-13 09:00:00"},
        ]
        windows = parse_blackout_windows(raw)
        assert len(windows) == 2
        assert windows[0].name == "FOMC"
        assert windows[1].name == "CPI"

    def test_skips_malformed_entries(self):
        raw = [
            {"name": "FOMC", "start": "2024-01-31 13:45:00", "end": "2024-01-31 15:00:00"},
            {"name": "BAD"},  # missing start/end
        ]
        windows = parse_blackout_windows(raw)
        assert len(windows) == 1
        assert windows[0].name == "FOMC"

    def test_empty_list_returns_empty(self):
        assert parse_blackout_windows([]) == []
