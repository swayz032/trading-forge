"""
Regression tests for _fast_signal_sequencer().

These tests verify that the pure-Python signal sequencer produces identical
trade records to what vectorbt.Portfolio.from_signals() would produce under
its default settings. vectorbt is NOT imported here — the tests work against
hand-computed known-answer cases.

Perf fix 2026-06-28: replaces vectorbt (Numba/JIT, 10-30 min cold-start) in
run_class_backtest(). DSL path (run_backtest) still uses vectorbt with a lazy
import inside the function.
"""
import time

import numpy as np
import pandas as pd
import pytest

from src.engine.backtester import _fast_signal_sequencer


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_empty(n: int = 10):
    """Helper: n-bar all-False signal arrays + flat close."""
    return (
        np.zeros(n, dtype=bool),  # entries
        np.zeros(n, dtype=bool),  # exits
        np.zeros(n, dtype=bool),  # s_entries
        np.zeros(n, dtype=bool),  # s_exits
        np.arange(100.0, 100.0 + n),  # close
        np.ones(n),  # sizes
    )


# ── Unit tests ─────────────────────────────────────────────────────────────────

class TestFastSignalSequencerOutput:
    """Verify output schema and no-crash for edge inputs."""

    def test_empty_signals_returns_empty_dataframe(self):
        df = _fast_signal_sequencer(*make_empty(10))
        assert isinstance(df, pd.DataFrame)
        assert len(df) == 0

    def test_empty_dataframe_has_required_columns(self):
        df = _fast_signal_sequencer(*make_empty(10))
        required = {"Entry Idx", "Exit Idx", "Avg Entry Price",
                    "Avg Exit Price", "Size", "Direction"}
        assert required.issubset(set(df.columns))

    def test_output_column_dtypes(self):
        n = 10
        entries = np.zeros(n, dtype=bool); entries[2] = True
        exits = np.zeros(n, dtype=bool); exits[5] = True
        close = np.arange(100.0, 100.0 + n)
        df = _fast_signal_sequencer(entries, exits,
                                    np.zeros(n, dtype=bool),
                                    np.zeros(n, dtype=bool),
                                    close, np.ones(n))
        assert len(df) == 1
        row = df.iloc[0]
        assert isinstance(int(row["Entry Idx"]), int)
        assert isinstance(int(row["Exit Idx"]), int)
        assert isinstance(float(row["Avg Entry Price"]), float)
        assert isinstance(float(row["Avg Exit Price"]), float)
        assert isinstance(float(row["Size"]), float)
        assert isinstance(str(row["Direction"]), str)

    def test_single_bar_data_no_crash(self):
        """Single bar: no trade possible (no room to exit)."""
        df = _fast_signal_sequencer(
            np.array([True]), np.array([False]),
            np.array([False]), np.array([False]),
            np.array([100.0]), np.array([1.0]),
        )
        # Entry fires but position closed at last bar (same bar as entry)
        assert len(df) == 1
        assert df.iloc[0]["Entry Idx"] == 0
        assert df.iloc[0]["Exit Idx"] == 0

    def test_zero_bars_no_crash(self):
        df = _fast_signal_sequencer(
            np.array([], dtype=bool), np.array([], dtype=bool),
            np.array([], dtype=bool), np.array([], dtype=bool),
            np.array([]), np.array([]),
        )
        assert len(df) == 0


class TestFastSignalSequencerLong:
    """Known-answer tests for long-only signals."""

    def test_single_long_trade(self):
        n = 10
        entries = np.zeros(n, dtype=bool); entries[2] = True
        exits = np.zeros(n, dtype=bool); exits[5] = True
        close = np.arange(100.0, 100.0 + n)

        df = _fast_signal_sequencer(entries, exits,
                                    np.zeros(n, dtype=bool),
                                    np.zeros(n, dtype=bool),
                                    close, np.ones(n))
        assert len(df) == 1
        r = df.iloc[0]
        assert int(r["Entry Idx"]) == 2
        assert int(r["Exit Idx"]) == 5
        assert abs(float(r["Avg Entry Price"]) - 102.0) < 1e-9
        assert abs(float(r["Avg Exit Price"]) - 105.0) < 1e-9
        assert float(r["Size"]) == 1.0
        assert str(r["Direction"]) == "Long"

    def test_multiple_sequential_long_trades(self):
        n = 20
        entries = np.zeros(n, dtype=bool)
        exits = np.zeros(n, dtype=bool)
        close = np.arange(100.0, 100.0 + n)

        entries[0] = True; exits[3] = True
        entries[5] = True; exits[8] = True
        entries[12] = True; exits[15] = True

        df = _fast_signal_sequencer(entries, exits,
                                    np.zeros(n, dtype=bool),
                                    np.zeros(n, dtype=bool),
                                    close, np.ones(n))
        assert len(df) == 3
        for i, (e_idx, ex_idx, e_p, ex_p) in enumerate([
            (0, 3, 100.0, 103.0),
            (5, 8, 105.0, 108.0),
            (12, 15, 112.0, 115.0),
        ]):
            r = df.iloc[i]
            assert int(r["Entry Idx"]) == e_idx
            assert int(r["Exit Idx"]) == ex_idx
            assert abs(float(r["Avg Entry Price"]) - e_p) < 1e-9
            assert abs(float(r["Avg Exit Price"]) - ex_p) < 1e-9
            assert str(r["Direction"]) == "Long"

    def test_open_position_closed_at_end_of_data(self):
        """Position opened but never explicitly exited → closed at last bar."""
        n = 10
        entries = np.zeros(n, dtype=bool); entries[8] = True
        close = np.arange(100.0, 100.0 + n)

        df = _fast_signal_sequencer(entries, np.zeros(n, dtype=bool),
                                    np.zeros(n, dtype=bool),
                                    np.zeros(n, dtype=bool),
                                    close, np.ones(n))
        assert len(df) == 1
        r = df.iloc[0]
        assert int(r["Entry Idx"]) == 8
        assert int(r["Exit Idx"]) == 9  # last bar
        assert abs(float(r["Avg Entry Price"]) - 108.0) < 1e-9
        assert abs(float(r["Avg Exit Price"]) - 109.0) < 1e-9

    def test_size_taken_from_entry_bar(self):
        """Size is read from sizes[entry_idx], not from arbitrary bars."""
        n = 10
        entries = np.zeros(n, dtype=bool); entries[3] = True
        exits = np.zeros(n, dtype=bool); exits[7] = True
        close = np.arange(100.0, 100.0 + n)
        sizes = np.ones(n) * 5.0
        sizes[7] = 99.0  # should be ignored (no entry on bar 7)

        df = _fast_signal_sequencer(entries, exits,
                                    np.zeros(n, dtype=bool),
                                    np.zeros(n, dtype=bool),
                                    close, sizes)
        assert len(df) == 1
        assert float(df.iloc[0]["Size"]) == 5.0


class TestFastSignalSequencerShort:
    """Known-answer tests for short-only signals."""

    def test_single_short_trade(self):
        n = 10
        s_entries = np.zeros(n, dtype=bool); s_entries[3] = True
        s_exits = np.zeros(n, dtype=bool); s_exits[6] = True
        close = np.arange(100.0, 100.0 + n)

        df = _fast_signal_sequencer(np.zeros(n, dtype=bool),
                                    np.zeros(n, dtype=bool),
                                    s_entries, s_exits, close, np.ones(n))
        assert len(df) == 1
        r = df.iloc[0]
        assert int(r["Entry Idx"]) == 3
        assert int(r["Exit Idx"]) == 6
        assert abs(float(r["Avg Entry Price"]) - 103.0) < 1e-9
        assert abs(float(r["Avg Exit Price"]) - 106.0) < 1e-9
        assert str(r["Direction"]) == "Short"


class TestFastSignalSequencerPriority:
    """Verify same-bar priority rules match vectorbt defaults."""

    def test_exit_processed_before_entry_on_same_bar(self):
        """
        Bar 0: long entry → position opens.
        Bar 3: both exit_long AND entry_long are True.
        Expected: exit the long at bar 3, then re-open long at bar 3.
        This matches vectorbt's 'exits before entries' rule.
        """
        n = 10
        entries = np.zeros(n, dtype=bool); entries[0] = True; entries[3] = True
        exits = np.zeros(n, dtype=bool); exits[3] = True  # same bar as entry[3]
        close = np.arange(100.0, 100.0 + n)

        df = _fast_signal_sequencer(entries, exits,
                                    np.zeros(n, dtype=bool),
                                    np.zeros(n, dtype=bool),
                                    close, np.ones(n))
        # Trade 1: bar 0 → bar 3
        assert len(df) == 2
        assert int(df.iloc[0]["Entry Idx"]) == 0
        assert int(df.iloc[0]["Exit Idx"]) == 3
        # Trade 2: re-entered at bar 3, closed at end of data (bar 9)
        assert int(df.iloc[1]["Entry Idx"]) == 3
        assert int(df.iloc[1]["Exit Idx"]) == 9

    def test_long_takes_priority_over_short_on_same_flat_bar(self):
        """When both long entry AND short entry fire on the same bar with flat
        position, long takes priority (matches vectorbt default)."""
        n = 10
        entries = np.zeros(n, dtype=bool); entries[0] = True
        s_entries = np.zeros(n, dtype=bool); s_entries[0] = True  # same bar
        exits = np.zeros(n, dtype=bool); exits[4] = True
        s_exits = np.zeros(n, dtype=bool)
        close = np.arange(100.0, 100.0 + n)

        df = _fast_signal_sequencer(entries, exits, s_entries, s_exits,
                                    close, np.ones(n))
        assert len(df) == 1
        assert str(df.iloc[0]["Direction"]) == "Long"

    def test_no_simultaneous_long_and_short(self):
        """One position at a time. Short entry while long is open is ignored."""
        n = 15
        entries = np.zeros(n, dtype=bool); entries[0] = True
        exits = np.zeros(n, dtype=bool); exits[10] = True
        s_entries = np.zeros(n, dtype=bool); s_entries[5] = True  # open long → ignored
        s_exits = np.zeros(n, dtype=bool)
        close = np.arange(100.0, 100.0 + n)

        df = _fast_signal_sequencer(entries, exits, s_entries, s_exits,
                                    close, np.ones(n))
        assert len(df) == 1
        assert str(df.iloc[0]["Direction"]) == "Long"


class TestFastSignalSequencerMixed:
    """Long + short sequential trades in same run."""

    def test_long_then_short_sequential(self):
        n = 10
        entries = np.zeros(n, dtype=bool); entries[0] = True
        exits = np.zeros(n, dtype=bool); exits[2] = True
        s_entries = np.zeros(n, dtype=bool); s_entries[3] = True
        s_exits = np.zeros(n, dtype=bool); s_exits[6] = True
        close = np.arange(100.0, 100.0 + n)

        df = _fast_signal_sequencer(entries, exits, s_entries, s_exits,
                                    close, np.ones(n))
        assert len(df) == 2
        assert str(df.iloc[0]["Direction"]) == "Long"
        assert int(df.iloc[0]["Entry Idx"]) == 0
        assert int(df.iloc[0]["Exit Idx"]) == 2
        assert str(df.iloc[1]["Direction"]) == "Short"
        assert int(df.iloc[1]["Entry Idx"]) == 3
        assert int(df.iloc[1]["Exit Idx"]) == 6


class TestFastSignalSequencerPriceAccuracy:
    """Verify fill price = close[signal_bar] (no offset errors)."""

    def test_entry_price_equals_close_at_entry_bar(self):
        close = np.array([4000.0, 4010.0, 4020.0, 4015.0, 4005.0])
        entries = np.zeros(5, dtype=bool); entries[1] = True
        exits = np.zeros(5, dtype=bool); exits[4] = True

        df = _fast_signal_sequencer(entries, exits,
                                    np.zeros(5, dtype=bool),
                                    np.zeros(5, dtype=bool),
                                    close, np.ones(5))
        assert abs(float(df.iloc[0]["Avg Entry Price"]) - 4010.0) < 1e-9

    def test_exit_price_equals_close_at_exit_bar(self):
        close = np.array([4000.0, 4010.0, 4020.0, 4015.0, 4005.0])
        entries = np.zeros(5, dtype=bool); entries[1] = True
        exits = np.zeros(5, dtype=bool); exits[3] = True

        df = _fast_signal_sequencer(entries, exits,
                                    np.zeros(5, dtype=bool),
                                    np.zeros(5, dtype=bool),
                                    close, np.ones(5))
        assert abs(float(df.iloc[0]["Avg Exit Price"]) - 4015.0) < 1e-9


class TestFastSignalSequencerPerformance:
    """Performance gate: 73k bars (largest 11yr WF window) completes < 500ms."""

    def test_73k_bars_under_500ms(self):
        """
        This is the performance gate that motivated the fix.
        vectorbt took 10-30 min on cold-start (JIT compilation).
        The sequencer should complete in well under 500ms for 73k bars.
        """
        N = 73_000
        rng = np.random.default_rng(42)
        entries = np.zeros(N, dtype=bool)
        exits = np.zeros(N, dtype=bool)
        for i in range(100):
            start = i * 730 + 10
            end = start + 200
            if start < N:
                entries[start] = True
            if end < N:
                exits[end] = True
        close = 4000.0 + rng.standard_normal(N).cumsum() * 2.0
        sizes = np.ones(N)

        t0 = time.perf_counter()
        df = _fast_signal_sequencer(entries, exits,
                                    np.zeros(N, dtype=bool),
                                    np.zeros(N, dtype=bool),
                                    close, sizes)
        elapsed = time.perf_counter() - t0

        assert len(df) == 100
        assert elapsed < 0.5, (
            f"_fast_signal_sequencer took {elapsed:.3f}s for 73k bars "
            f"(should be well under 0.5s — vectorbt JIT removed)"
        )

    def test_8_windows_total_under_100ms(self):
        """8 OOS windows of 8,125 bars each (typical 11yr WF) total under 100ms."""
        N_OOS = 8_125
        rng = np.random.default_rng(99)
        total = 0.0
        for w in range(8):
            entries = np.zeros(N_OOS, dtype=bool)
            exits = np.zeros(N_OOS, dtype=bool)
            i = 0
            r = np.random.default_rng(w)
            while i < N_OOS - 250:
                gap = int(r.integers(150, 250))
                i += gap
                if i >= N_OOS:
                    break
                entries[i] = True
                hold = int(r.integers(20, 60))
                ex = i + hold
                if ex < N_OOS:
                    exits[ex] = True
                i = ex + 1

            close = 4500.0 + rng.standard_normal(N_OOS).cumsum() * 2.0
            sizes = np.ones(N_OOS)

            t0 = time.perf_counter()
            _fast_signal_sequencer(entries, exits,
                                   np.zeros(N_OOS, dtype=bool),
                                   np.zeros(N_OOS, dtype=bool),
                                   close, sizes)
            total += time.perf_counter() - t0

        assert total < 0.1, (
            f"8-window sequencer total {total*1000:.1f}ms exceeds 100ms gate"
        )


class TestFastSignalSequencerDeterminism:
    """Same inputs produce identical outputs on repeated calls (replay safety)."""

    def test_replay_determinism(self):
        N = 5_000
        rng = np.random.default_rng(7)
        entries = np.zeros(N, dtype=bool)
        exits = np.zeros(N, dtype=bool)
        entries[100] = True; exits[300] = True
        entries[500] = True; exits[800] = True
        entries[1200] = True; exits[1500] = True
        close = 4000.0 + rng.standard_normal(N).cumsum() * 2.0
        sizes = np.ones(N) * 3.0

        df1 = _fast_signal_sequencer(entries.copy(), exits.copy(),
                                     np.zeros(N, dtype=bool),
                                     np.zeros(N, dtype=bool),
                                     close.copy(), sizes.copy())
        df2 = _fast_signal_sequencer(entries.copy(), exits.copy(),
                                     np.zeros(N, dtype=bool),
                                     np.zeros(N, dtype=bool),
                                     close.copy(), sizes.copy())

        pd.testing.assert_frame_equal(df1, df2)
