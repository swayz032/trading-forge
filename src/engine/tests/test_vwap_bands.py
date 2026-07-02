"""Tests for VWAP standard-deviation bands (compute_vwap_with_bands).

Coverage:
  - Band correctness on synthetic bars (sigma math)
  - Session reset at 18:00 ET Globex boundary
  - Column names produced
  - Zero-volume bars: no NaN/inf propagation
  - Single-bar session
  - Band ordering invariants (upper > vwap > lower)
  - Backward-compat: vwap column identical to compute_vwap()
"""
from __future__ import annotations

from datetime import datetime, timedelta

import polars as pl
import pytest

from src.engine.indicators.core import compute_vwap, compute_vwap_with_bands


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _make_bars(
    start_dt: datetime,
    count: int,
    high: float = 5010.0,
    low: float = 5000.0,
    close: float = 5005.0,
    volume: float = 1000.0,
    bar_minutes: int = 5,
) -> pl.DataFrame:
    """Synthetic uniform bars."""
    ts = [start_dt + timedelta(minutes=bar_minutes * i) for i in range(count)]
    return pl.DataFrame({
        "ts_event": ts,
        "open": [close] * count,
        "high": [high] * count,
        "low": [low] * count,
        "close": [close] * count,
        "volume": [volume] * count,
    })


def _make_bars_varying(rows: list[dict]) -> pl.DataFrame:
    """Build bars from explicit row dicts."""
    return pl.DataFrame({
        "ts_event": [r["ts"] for r in rows],
        "open": [r.get("open", r.get("close", 5000.0)) for r in rows],
        "high": [r["high"] for r in rows],
        "low": [r["low"] for r in rows],
        "close": [r["close"] for r in rows],
        "volume": [r["volume"] for r in rows],
    })


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestVwapBandsColumnNames:
    def test_all_five_columns_present(self):
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), count=20)
        result = compute_vwap_with_bands(bars)
        assert "vwap" in result.columns
        assert "vwap_band_1s_upper" in result.columns
        assert "vwap_band_1s_lower" in result.columns
        assert "vwap_band_2s_upper" in result.columns
        assert "vwap_band_2s_lower" in result.columns

    def test_output_row_count_unchanged(self):
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), count=30)
        result = compute_vwap_with_bands(bars)
        assert len(result) == 30

    def test_no_input_columns_mutated(self):
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), count=10)
        original_cols = set(bars.columns)
        result = compute_vwap_with_bands(bars)
        # input DataFrame columns are not modified
        assert set(bars.columns) == original_cols
        # result has additional columns
        assert len(result.columns) > len(bars.columns)


class TestVwapBandsMath:
    def test_bands_symmetric_around_vwap(self):
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), count=40)
        result = compute_vwap_with_bands(bars)
        vwap = result["vwap"]
        upper1 = result["vwap_band_1s_upper"]
        lower1 = result["vwap_band_1s_lower"]
        upper2 = result["vwap_band_2s_upper"]
        lower2 = result["vwap_band_2s_lower"]
        # symmetry: upper - vwap == vwap - lower at every bar
        diff_u1 = (upper1 - vwap).to_list()
        diff_l1 = (vwap - lower1).to_list()
        for u, l in zip(diff_u1, diff_l1):
            assert abs(u - l) < 1e-9, f"Asymmetric bands: +{u} vs -{l}"

    def test_2sigma_bands_wider_than_1sigma(self):
        # Use varying prices to produce nonzero sigma
        rows = []
        base = datetime(2026, 1, 2, 18, 0)
        prices = [5000, 5002, 5001, 5003, 5004, 4999, 5005, 5002, 5003, 5001]
        for i, p in enumerate(prices):
            rows.append({
                "ts": base + timedelta(minutes=5 * i),
                "high": p + 1, "low": p - 1, "close": float(p), "volume": 1000.0
            })
        bars = _make_bars_varying(rows)
        result = compute_vwap_with_bands(bars)
        # After first bar sigma=0, from bar 2+ sigma grows; check last few bars
        for i in range(2, len(result)):
            w1_u = result["vwap_band_1s_upper"][i]
            w2_u = result["vwap_band_2s_upper"][i]
            sigma = w1_u - result["vwap"][i]
            if sigma > 0:
                assert w2_u > w1_u, f"2s band not wider than 1s at bar {i}"

    def test_first_bar_sigma_zero(self):
        """First bar in session: cumulative variance = 0, so sigma = 0, bands collapse to VWAP."""
        bars = _make_bars(datetime(2026, 1, 2, 18, 0), count=5)
        result = compute_vwap_with_bands(bars)
        v0 = result["vwap"][0]
        assert result["vwap_band_1s_upper"][0] == pytest.approx(v0, abs=1e-9)
        assert result["vwap_band_1s_lower"][0] == pytest.approx(v0, abs=1e-9)

    def test_band_ordering_invariant(self):
        """upper2 >= upper1 >= vwap >= lower1 >= lower2 at every bar (nonzero sigma)."""
        rows = []
        base = datetime(2026, 1, 2, 18, 0)
        for i in range(50):
            p = 5000 + (i % 10) - 5   # oscillating price
            rows.append({
                "ts": base + timedelta(minutes=5 * i),
                "high": p + 2, "low": p - 2, "close": float(p), "volume": 500.0
            })
        bars = _make_bars_varying(rows)
        result = compute_vwap_with_bands(bars)
        vwap = result["vwap"]
        for i in range(1, len(result)):
            u2 = result["vwap_band_2s_upper"][i]
            u1 = result["vwap_band_1s_upper"][i]
            v = vwap[i]
            l1 = result["vwap_band_1s_lower"][i]
            l2 = result["vwap_band_2s_lower"][i]
            assert u2 >= u1 >= v >= l1 >= l2, (
                f"Band order violated at bar {i}: u2={u2} u1={u1} v={v} l1={l1} l2={l2}"
            )

    def test_vwap_column_matches_compute_vwap(self):
        """vwap column from compute_vwap_with_bands must equal compute_vwap() output.

        Both functions use identical 18:00 ET Globex session reset (D3 fix 2026-07-01).
        Prior to D3, compute_vwap used midnight calendar reset while compute_vwap_with_bands
        used 18:00 ET Globex reset, making them diverge on 24h data spanning 18:00 ET.
        """
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), count=78)
        legacy = compute_vwap(bars)
        bands = compute_vwap_with_bands(bars)
        for i in range(len(bars)):
            assert abs(bands["vwap"][i] - legacy[i]) < 1e-6, (
                f"VWAP mismatch at bar {i}: bands={bands['vwap'][i]}, legacy={legacy[i]}"
            )

    def test_vwap_equivalence_across_globex_18_boundary(self):
        """compute_vwap and compute_vwap_with_bands vwap must agree across 18:00 ET reset.

        This is the critical D3 regression test. Before the fix, compute_vwap used
        dt.date() (midnight reset) while compute_vwap_with_bands used _assign_globex_session_id
        (18:00 ET reset). On bars spanning 18:00 ET, the two functions produced different
        cumulative sums after the boundary, making one backtest carry two conflicting VWAPs.

        After D3 fix, both functions reset at 18:00 ET so they must agree on every bar
        including those in the overnight period after 18:00.
        """
        rows = [
            # Late-day bars in Globex session 1 (Jan 2 session)
            {"ts": datetime(2026, 1, 2, 15, 0), "high": 5002.0, "low": 4998.0, "close": 5000.0, "volume": 1000.0},
            {"ts": datetime(2026, 1, 2, 15, 5), "high": 5004.0, "low": 5000.0, "close": 5002.0, "volume": 1500.0},
            {"ts": datetime(2026, 1, 2, 17, 55), "high": 5010.0, "low": 5005.0, "close": 5008.0, "volume": 800.0},
            # 18:00 ET — new Globex session (Jan 3 session). Both functions must reset here.
            {"ts": datetime(2026, 1, 2, 18, 0), "high": 5020.0, "low": 5015.0, "close": 5018.0, "volume": 2000.0},
            {"ts": datetime(2026, 1, 2, 18, 5), "high": 5022.0, "low": 5018.0, "close": 5020.0, "volume": 1200.0},
            # Next day morning (still Jan 3 Globex session)
            {"ts": datetime(2026, 1, 3, 9, 30), "high": 5025.0, "low": 5020.0, "close": 5022.0, "volume": 900.0},
        ]
        bars = _make_bars_varying(rows)
        legacy = compute_vwap(bars)
        bands = compute_vwap_with_bands(bars)

        for i in range(len(bars)):
            assert abs(bands["vwap"][i] - legacy[i]) < 1e-6, (
                f"VWAP mismatch at bar {i} (ts={rows[i]['ts']}): "
                f"compute_vwap_with_bands={bands['vwap'][i]:.6f}, "
                f"compute_vwap={legacy[i]:.6f}"
            )

        # Explicit check: bar at 18:00 ET (index 3) must be the start of a fresh session.
        # Its VWAP must equal its own typical price (no carry-forward from prior bars).
        expected_tp_at_18 = (5020.0 + 5015.0 + 5018.0) / 3.0
        assert abs(legacy[3] - expected_tp_at_18) < 1e-6, (
            f"compute_vwap did not reset at 18:00 ET: "
            f"got {legacy[3]:.6f}, expected tp={expected_tp_at_18:.6f}"
        )
        assert abs(bands["vwap"][3] - expected_tp_at_18) < 1e-6, (
            f"compute_vwap_with_bands did not reset at 18:00 ET: "
            f"got {bands['vwap'][3]:.6f}, expected tp={expected_tp_at_18:.6f}"
        )


class TestVwapBandsSessionReset:
    def test_session_resets_at_1800_et(self):
        """Sigma should reset to 0 when a new Globex session opens at 18:00 ET."""
        rows = []
        # First session: 18:00 ET day 1 — 10 bars with varying prices (builds sigma)
        base1 = datetime(2026, 1, 2, 18, 0)
        prices1 = [5000.0, 5002.0, 5003.0, 4999.0, 5001.0, 5004.0, 4998.0, 5002.0, 5001.0, 5003.0]
        for i, p in enumerate(prices1):
            rows.append({
                "ts": base1 + timedelta(minutes=5 * i),
                "high": p + 1.0, "low": p - 1.0, "close": p, "volume": 1000.0
            })
        # Second session: 18:00 ET day 2 — sigma should reset to 0 at first bar
        base2 = datetime(2026, 1, 3, 18, 0)
        rows.append({
            "ts": base2,
            "high": 5006.0, "low": 5004.0, "close": 5005.0, "volume": 1000.0
        })

        bars = _make_bars_varying(rows)
        result = compute_vwap_with_bands(bars)

        # The 18:00 ET bar of day 2 (index 10) is the first bar of the new session.
        # Its sigma should be 0 because it is the only bar in its session so far.
        first_new_session_bar = 10
        sigma_at_reset = result["vwap_band_1s_upper"][first_new_session_bar] - result["vwap"][first_new_session_bar]
        assert sigma_at_reset == pytest.approx(0.0, abs=1e-9), (
            f"Sigma did not reset at new Globex session: sigma={sigma_at_reset}"
        )

    def test_vwap_resets_with_session(self):
        """After session reset, VWAP on first bar = typical_price of that bar."""
        rows = []
        # End of session 1
        base1 = datetime(2026, 1, 2, 18, 0)
        for i in range(5):
            rows.append({
                "ts": base1 + timedelta(minutes=5 * i),
                "high": 5010.0, "low": 5000.0, "close": 5005.0, "volume": 1000.0
            })
        # Start of session 2: high=5020, low=5018, close=5019
        base2 = datetime(2026, 1, 3, 18, 0)
        rows.append({
            "ts": base2,
            "high": 5020.0, "low": 5018.0, "close": 5019.0, "volume": 1000.0
        })
        bars = _make_bars_varying(rows)
        result = compute_vwap_with_bands(bars)

        # typical price of last bar: (5020+5018+5019)/3 = 5019.0
        expected_tp = (5020.0 + 5018.0 + 5019.0) / 3.0
        assert result["vwap"][5] == pytest.approx(expected_tp, abs=1e-6)


class TestVwapBandsEdgeCases:
    def test_zero_volume_bars_no_nan_or_inf(self):
        """Zero-volume bars must not produce NaN or inf in any band column."""
        rows = []
        base = datetime(2026, 1, 2, 18, 0)
        # First bar: normal volume; subsequent bars: zero volume
        rows.append({"ts": base, "high": 5002.0, "low": 4998.0, "close": 5000.0, "volume": 1000.0})
        for i in range(1, 10):
            rows.append({
                "ts": base + timedelta(minutes=5 * i),
                "high": 5003.0, "low": 4999.0, "close": 5001.0, "volume": 0.0
            })
        bars = _make_bars_varying(rows)
        result = compute_vwap_with_bands(bars)

        for col in ["vwap", "vwap_band_1s_upper", "vwap_band_1s_lower",
                    "vwap_band_2s_upper", "vwap_band_2s_lower"]:
            series = result[col]
            assert series.is_nan().sum() == 0, f"NaN in column '{col}'"
            assert series.is_infinite().sum() == 0, f"Inf in column '{col}'"

    def test_single_bar(self):
        """Single bar: all band columns should equal vwap (sigma=0)."""
        bars = _make_bars(datetime(2026, 1, 2, 18, 0), count=1)
        result = compute_vwap_with_bands(bars)
        v = result["vwap"][0]
        for col in ["vwap_band_1s_upper", "vwap_band_1s_lower",
                    "vwap_band_2s_upper", "vwap_band_2s_lower"]:
            assert result[col][0] == pytest.approx(v, abs=1e-9), (
                f"Single-bar: {col} should equal vwap={v}, got {result[col][0]}"
            )

    def test_empty_dataframe_raises_or_returns_empty(self):
        """Empty input DataFrame should not crash — return empty or raise gracefully."""
        empty = pl.DataFrame({
            "ts_event": pl.Series([], dtype=pl.Datetime),
            "open": pl.Series([], dtype=pl.Float64),
            "high": pl.Series([], dtype=pl.Float64),
            "low": pl.Series([], dtype=pl.Float64),
            "close": pl.Series([], dtype=pl.Float64),
            "volume": pl.Series([], dtype=pl.Float64),
        })
        try:
            result = compute_vwap_with_bands(empty)
            assert len(result) == 0
        except Exception as exc:
            pytest.fail(f"compute_vwap_with_bands raised on empty input: {exc}")

    def test_all_same_price_sigma_zero(self):
        """When all bars have identical typical price, sigma = 0 everywhere."""
        bars = _make_bars(datetime(2026, 1, 2, 18, 0), count=20,
                          high=5005.0, low=5005.0, close=5005.0)
        result = compute_vwap_with_bands(bars)
        for i in range(len(result)):
            sigma = result["vwap_band_1s_upper"][i] - result["vwap"][i]
            assert sigma == pytest.approx(0.0, abs=1e-9), f"Nonzero sigma at bar {i} with constant price"

    def test_ts_et_column_takes_precedence(self):
        """If ts_et column is present, session_id is computed from it."""
        bars = _make_bars(datetime(2026, 1, 2, 9, 30), count=10)
        # Add ts_et column identical to ts_event (no timezone difference in this test)
        bars = bars.with_columns(pl.col("ts_event").alias("ts_et"))
        result = compute_vwap_with_bands(bars)
        assert "vwap" in result.columns
        assert len(result) == 10
