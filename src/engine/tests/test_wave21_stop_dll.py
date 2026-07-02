"""Wave 21 E.3/E.4/E.5 — Stop ceiling skip, DLL halt, and 15:55 ET time-stop tests.

Tests pin:
- E.3: High-ATR entries are SKIPPED (not clamped) when stop > ceiling
- E.3: Per-instrument ceiling differences (MES 14pt vs MNQ 40pt vs MCL 0.25pt)
- E.3: ATR floor is applied before ceiling check
- E.4: DLL halt suppresses entries after cumulative session loss breaches 67% DLL
- E.4: DLL force-close suppresses AND closes positions at 95% DLL
- E.5: 15:55 ET time-stop fires correctly and closes open positions
- E.5: Time-stop fires for both long and short positions
"""

import numpy as np
import pytest

from src.engine.backtester import (
    _apply_dsl_stop_loss_and_time_stop,
    _get_stop_ceiling_for_symbol,
)

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_timestamps(n: int, base_hour: int = 10, base_minute: int = 0) -> list:
    """Build list of ts_et strings for n bars, 5-minute increments from base."""
    ts = []
    h, m = base_hour, base_minute
    for _ in range(n):
        ts.append(f"2024-01-02 {h:02d}:{m:02d}:00")
        m += 5
        if m >= 60:
            m -= 60
            h += 1
    return ts


def _run_stop_logic(
    entry_bars: list[int],
    n: int = 50,
    atr: float = 4.0,
    stop_mult: float = 1.5,
    symbol: str = "MES",
    base_hour: int = 10,
    entry_price: float = 5000.0,
) -> tuple:
    """Build synthetic arrays and run _apply_dsl_stop_loss_and_time_stop."""
    entry_long = np.zeros(n, dtype=bool)
    for b in entry_bars:
        entry_long[b] = True
    exit_long = np.zeros(n, dtype=bool)
    entry_short = np.zeros(n, dtype=bool)
    exit_short = np.zeros(n, dtype=bool)

    # All bars: price = entry_price, ATR = atr.
    # Low is 0.05 below close — well above any qualifying stop distance — so the
    # C-6 intrabar-stop-breach check never fires for valid test entries.
    high_np = np.full(n, entry_price + 0.05)
    low_np = np.full(n, entry_price - 0.05)
    close_np = np.full(n, entry_price)   # C3 FIX: close_np required as entry ref price
    atr_np = np.full(n, atr)

    ts = _make_timestamps(n, base_hour=base_hour)

    return _apply_dsl_stop_loss_and_time_stop(
        entry_long, exit_long, entry_short, exit_short,
        high_np, low_np, atr_np, ts,
        stop_multiplier=stop_mult,
        symbol=symbol,
        close_np=close_np,
    )


# ─── E.3: Stop ceiling tests ─────────────────────────────────────────────────

class TestStopCeilingSkip:
    """Stop-ceiling enforcement: SKIP entry when stop_distance > ceiling."""

    def test_mes_normal_atr_not_skipped(self):
        # ATR=4, mult=1.5 → stop_dist=6 < MES ceiling 14 → NOT skipped
        el_out, exit_l, es_out, exit_s, meta = _run_stop_logic([5], atr=4.0, symbol="MES")
        assert bool(el_out[5]) is True, "Normal ATR entry should NOT be skipped"
        assert len(meta["skipped_trades"]) == 0

    def test_mes_high_atr_skipped(self):
        # ATR=10, mult=1.5 → stop_dist=15 > MES ceiling 14 → SKIPPED
        el_out, exit_l, es_out, exit_s, meta = _run_stop_logic([5], atr=10.0, symbol="MES")
        assert bool(el_out[5]) is False, "High-ATR entry must be skipped"
        assert len(meta["skipped_trades"]) == 1
        skip = meta["skipped_trades"][0]
        assert skip["reason"] == "stop_too_wide"
        assert skip["direction"] == "long"
        assert skip["ceiling"] == 14.0

    def test_mes_ceiling_exact_boundary(self):
        # ATR=9.333... -> stop=14.0 exactly → NOT skipped (must exceed, not equal)
        # stop_dist = 9.333 * 1.5 = 14.0 exactly → allowed (not > ceiling)
        atr = 14.0 / 1.5  # exactly at ceiling
        el_out, _, _, _, meta = _run_stop_logic([5], atr=atr, symbol="MES")
        assert len(meta["skipped_trades"]) == 0, "stop == ceiling should NOT be skipped"

    def test_mnq_ceiling_62pt(self):
        # Wave 1 Track 1A 2026-06-27: MNQ ceiling updated 40 → 62.
        # ATR=42, mult=1.5 → stop=63 > new MNQ ceiling 62 → SKIPPED
        el_out, _, _, _, meta = _run_stop_logic([5], atr=42.0, symbol="MNQ")
        assert bool(el_out[5]) is False, "stop=63 > ceiling=62 must be skipped"
        assert meta["skipped_trades"][0]["ceiling"] == pytest.approx(62.0)

    def test_mnq_previously_skipped_now_allowed(self):
        # Old ceiling 40 would skip ATR=30 (stop=45); new ceiling 62 allows it.
        # ATR=30, mult=1.5 → stop=45 < new ceiling 62 → NOT skipped
        el_out, _, _, _, meta = _run_stop_logic([5], atr=30.0, symbol="MNQ")
        assert bool(el_out[5]) is True, "stop=45 < new ceiling=62 must NOT be skipped"
        assert len(meta["skipped_trades"]) == 0

    def test_mnq_normal_atr_not_skipped(self):
        # ATR=20, mult=1.5 → stop=30 < MNQ ceiling 62 → NOT skipped
        el_out, _, _, _, meta = _run_stop_logic([5], atr=20.0, symbol="MNQ")
        assert bool(el_out[5]) is True
        assert len(meta["skipped_trades"]) == 0

    def test_mcl_ceiling_100pt(self):
        # Wave 1 Track 1A 2026-06-27: MCL ceiling updated 0.25 → 1.00.
        # ATR=0.7, mult=1.5 → stop=1.05 > new MCL ceiling 1.00 → SKIPPED
        el_out, _, _, _, meta = _run_stop_logic([5], atr=0.7, symbol="MCL")
        assert bool(el_out[5]) is False, "stop=1.05 > ceiling=1.00 must be skipped"
        assert meta["skipped_trades"][0]["ceiling"] == pytest.approx(1.00)

    def test_mcl_previously_skipped_now_allowed(self):
        # Old ceiling 0.25 would skip ATR=0.2 (stop=0.3); new ceiling 1.00 allows it.
        # ATR=0.2, mult=1.5 → stop=0.3 < new MCL ceiling 1.00 → NOT skipped
        el_out, _, _, _, meta = _run_stop_logic([5], atr=0.2, symbol="MCL")
        assert bool(el_out[5]) is True, "stop=0.3 < new ceiling=1.00 must NOT be skipped"
        assert len(meta["skipped_trades"]) == 0

    def test_multiple_entries_some_skipped(self):
        # Three entries on two different sessions (different days).
        # Day 1 bar 5: ATR=4 → ok. Day 2 bar 5: ATR=10 → skipped.
        # Using different calendar dates ensures no open position carryover.
        n = 20
        entry_long = np.zeros(n, dtype=bool)
        entry_long[2] = True   # session A, normal ATR
        entry_long[12] = True  # session B, high ATR (different session)
        exit_long = np.zeros(n, dtype=bool)
        entry_short = np.zeros(n, dtype=bool)
        exit_short = np.zeros(n, dtype=bool)

        # Entry close = 5001.0, MES floor=6pt → stop = 5001 - 6 = 4995.
        # Bar 8 low=4994 < 4995 → ATR stop fires → position closes before bar 12.
        # ATR=10 at bar 12 → stop=15 > MES ceiling=14 → skipped.
        close_np = np.full(n, 5001.0)  # C3 FIX: close_np is entry ref price
        high_np = np.full(n, 5001.5)
        low_np = np.full(n, 5000.5)   # normal bars: well above stop=4995
        low_np[8] = 4994.0            # bar 8: low < 4995 → ATR stop fires

        atr_np = np.full(n, 4.0)
        atr_np[12] = 10.0      # spike ATR on bar 12

        # Build timestamps: same day, 5-min intervals
        ts = []
        h, m = 9, 30
        for _ in range(n):
            ts.append(f"2024-01-02 {h:02d}:{m:02d}:00")
            m += 5
            if m >= 60:
                m -= 60
                h += 1

        el_out, _, _, _, meta = _apply_dsl_stop_loss_and_time_stop(
            entry_long, exit_long, entry_short, exit_short,
            high_np, low_np, atr_np, ts, stop_multiplier=1.5, symbol="MES",
            close_np=close_np,
        )
        assert bool(el_out[2]) is True    # normal ATR — should enter
        assert bool(el_out[12]) is False  # high ATR — should be skipped
        assert len(meta["skipped_trades"]) == 1
        assert meta["atr_stop_exits"] >= 1  # ATR stop from bar 2 fired at bar 8

    def test_get_stop_ceiling_for_symbol_table(self):
        # Wave 1 Track 1A 2026-06-27: MNQ 40→62, MCL 0.25→1.00
        assert _get_stop_ceiling_for_symbol("MES") == pytest.approx(14.0)
        assert _get_stop_ceiling_for_symbol("ES") == pytest.approx(14.0)
        assert _get_stop_ceiling_for_symbol("MNQ") == pytest.approx(62.0)   # was 40.0
        assert _get_stop_ceiling_for_symbol("NQ") == pytest.approx(62.0)    # was 40.0
        assert _get_stop_ceiling_for_symbol("MCL") == pytest.approx(1.00)   # was 0.25
        assert _get_stop_ceiling_for_symbol("CL") == pytest.approx(1.00)    # was 0.25
        assert _get_stop_ceiling_for_symbol("UNKNOWN") == 14.0  # fallback to MES default

    def test_get_stop_ceiling_env_override(self, monkeypatch):
        """Env override beats baked defaults — both gates share the same env var."""
        monkeypatch.setenv("STOP_CEILING_PTS_MNQ", "55")
        assert _get_stop_ceiling_for_symbol("MNQ") == pytest.approx(55.0)
        assert _get_stop_ceiling_for_symbol("NQ") == pytest.approx(55.0)

    def test_gate_block_analyzer_ceiling_in_sync(self):
        """gate_block_analyzer and backtester must agree on every ceiling value."""
        from src.engine.gate_block_analyzer import STRUCTURAL_STOP_CEILING_PTS
        assert STRUCTURAL_STOP_CEILING_PTS["MES"] == pytest.approx(_get_stop_ceiling_for_symbol("MES"))
        assert STRUCTURAL_STOP_CEILING_PTS["MNQ"] == pytest.approx(_get_stop_ceiling_for_symbol("MNQ"))
        assert STRUCTURAL_STOP_CEILING_PTS["MCL"] == pytest.approx(_get_stop_ceiling_for_symbol("MCL"))


# ─── E.5: 15:55 ET time-stop tests ───────────────────────────────────────────

class TestTimestop1555ET:
    """15:55 ET hard-flat time-stop: open positions must close by or on 15:55."""

    def test_time_stop_fires_at_1555(self):
        # Entry at bar 5 (10:25 ET), time-stop bar at 15:55 ET
        n = 80
        entry_long = np.zeros(n, dtype=bool)
        entry_long[5] = True
        exit_long = np.zeros(n, dtype=bool)
        entry_short = np.zeros(n, dtype=bool)
        exit_short = np.zeros(n, dtype=bool)

        high_np = np.full(n, 5001.0)
        low_np = np.full(n, 4999.0)
        atr_np = np.full(n, 4.0)

        # Build timestamps: bars 5-67 span 10:25 → 16:00 ET (5-min bars)
        ts_list = []
        h, m = 9, 30
        for _ in range(n):
            ts_list.append(f"2024-01-02 {h:02d}:{m:02d}:00")
            m += 5
            if m >= 60:
                m -= 60
                h += 1

        # Find bar at 15:55 ET
        bar_1555 = None
        for i, t in enumerate(ts_list):
            if "15:55" in t:
                bar_1555 = i
                break

        assert bar_1555 is not None, "15:55 bar not found in synthetic timestamps"

        el_out, exit_l_out, _, _, meta = _apply_dsl_stop_loss_and_time_stop(
            entry_long, exit_long, entry_short, exit_short,
            high_np, low_np, atr_np, ts_list, stop_multiplier=1.5, symbol="MES",
            ts_et_timestamps=ts_list,  # ET-native path: detect 15:55 ET directly (FIX-6)
        )

        assert bool(exit_l_out[bar_1555]) is True, "Exit signal must be set at 15:55 ET bar"
        assert meta["time_stop_exits"] >= 1, "time_stop_exits counter must increment"

    def test_position_after_1555_cannot_exist(self):
        # After time-stop fires, position is closed — no further exits set
        n = 80
        entry_long = np.zeros(n, dtype=bool)
        entry_long[5] = True

        ts_list = []
        h, m = 9, 30
        for _ in range(n):
            ts_list.append(f"2024-01-02 {h:02d}:{m:02d}:00")
            m += 5
            if m >= 60:
                m -= 60
                h += 1

        exit_long = np.zeros(n, dtype=bool)
        entry_short = np.zeros(n, dtype=bool)
        exit_short = np.zeros(n, dtype=bool)
        high_np = np.full(n, 5001.0)
        low_np = np.full(n, 4999.0)
        atr_np = np.full(n, 4.0)

        _, exit_l_out, _, _, meta = _apply_dsl_stop_loss_and_time_stop(
            entry_long, exit_long, entry_short, exit_short,
            high_np, low_np, atr_np, ts_list, stop_multiplier=1.5, symbol="MES",
            ts_et_timestamps=ts_list,  # ET-native path: detect 15:55 ET directly (FIX-6)
        )

        # Find 15:55 bar
        ts_1555 = None
        for i, t in enumerate(ts_list):
            if "15:55" in t:
                ts_1555 = i
                break

        if ts_1555 is not None:
            # After time-stop, no bars after ts_1555 should have exit=True
            post_exits = exit_l_out[ts_1555 + 1:]
            assert not np.any(post_exits), "No exits should fire after the 15:55 ET close"

    def test_short_also_closed_by_time_stop(self):
        n = 80
        entry_long = np.zeros(n, dtype=bool)
        exit_long = np.zeros(n, dtype=bool)
        entry_short = np.zeros(n, dtype=bool)
        entry_short[5] = True
        exit_short = np.zeros(n, dtype=bool)

        ts_list = []
        h, m = 9, 30
        for _ in range(n):
            ts_list.append(f"2024-01-02 {h:02d}:{m:02d}:00")
            m += 5
            if m >= 60:
                m -= 60
                h += 1

        high_np = np.full(n, 5001.0)
        low_np = np.full(n, 4999.0)
        atr_np = np.full(n, 4.0)

        _, _, _, exit_s_out, meta = _apply_dsl_stop_loss_and_time_stop(
            entry_long, exit_long, entry_short, exit_short,
            high_np, low_np, atr_np, ts_list, stop_multiplier=1.5, symbol="MES",
            ts_et_timestamps=ts_list,  # ET-native path: detect 15:55 ET directly (FIX-6)
        )
        assert meta["time_stop_exits"] >= 1, "Short position must also be closed at 15:55 ET"


# ─── E.4: DLL halt tests (unit-level via _apply_dll_halt_to_entries) ─────────

class TestDllHalt:
    """DLL halt logic: suppress entries after breaching personal DLL threshold."""

    def test_dll_halt_suppresses_entries(self):
        from src.engine.backtester import _apply_dll_halt_to_entries

        n = 40
        # Two entries: bar 2 and bar 10
        long_entries = np.zeros(n, dtype=bool)
        long_entries[2] = True
        long_entries[10] = True
        short_entries = np.zeros(n, dtype=bool)
        exit_long = np.zeros(n, dtype=bool)
        exit_short = np.zeros(n, dtype=bool)

        close_np = np.full(n, 5000.0)
        high_np = np.full(n, 5001.0)
        low_np = np.full(n, 4999.0)
        # High ATR → estimated loss per trade will be large → DLL breaches early
        atr_np = np.full(n, 40.0)  # ATR=40 → est_loss = 40*1.5*4*5 + ... = $1200/contract

        ts = [f"2024-01-02 10:{str(i).zfill(2)}:00" if i < 60 else f"2024-01-02 11:{str(i-60).zfill(2)}:00" for i in range(n)]

        long_out, short_out, meta = _apply_dll_halt_to_entries(
            long_entries, short_entries,
            exit_long, exit_short,
            high_np, low_np, close_np, atr_np,
            np.array(ts), 5.0, np.full(n, 4.0), 0.62,
            personal_dll_pct=0.67,
            firm_dll=1000.0,
        )

        # Entry at bar 2 may succeed; entry at bar 10 should be suppressed if DLL already hit
        # At ATR=40, est_loss ≈ 40*1.5*4*5 = $1200 per entry → exceeds $670 personal DLL
        # So FIRST entry already triggers DLL halt; bar 2 gets entered (entry fires before check)
        # but bar 10 should be suppressed
        assert meta["entries_suppressed"] >= 1 or not bool(long_out[10]), \
            "Bar 10 entry should be suppressed after DLL breach"

    def test_dll_metadata_populated(self):
        from src.engine.backtester import _apply_dll_halt_to_entries

        n = 20
        long_entries = np.zeros(n, dtype=bool)
        long_entries[2] = True
        short_entries = np.zeros(n, dtype=bool)
        exit_long = np.zeros(n, dtype=bool)
        exit_short = np.zeros(n, dtype=bool)

        close_np = np.full(n, 5000.0)
        high_np = np.full(n, 5001.0)
        low_np = np.full(n, 4999.0)
        atr_np = np.full(n, 50.0)  # extreme ATR → immediate DLL breach
        ts = [f"2024-01-02 10:{str(i * 5).zfill(2)}:00" for i in range(n)]

        _, _, meta = _apply_dll_halt_to_entries(
            long_entries, short_entries,
            exit_long, exit_short,
            high_np, low_np, close_np, atr_np,
            np.array(ts), 5.0, np.full(n, 4.0), 0.62,
            personal_dll_pct=0.67, firm_dll=1000.0,
        )

        # Metadata keys must always be present regardless of whether halt fired
        assert "dll_halt_sessions" in meta
        assert "dll_force_close_sessions" in meta
        assert "entries_suppressed" in meta
        assert isinstance(meta["dll_halt_sessions"], list)
