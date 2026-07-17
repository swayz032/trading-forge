"""Tests for data_loader._bars_cli_main() — backs Node GET /api/bars/:symbol.

Uses load_ohlcv's --local-path escape hatch to test the real CLI function against a
real local Parquet fixture (no S3, no mocking of load_ohlcv itself).
"""

import json
import sys
from datetime import datetime

import duckdb
import polars as pl
import pytest

from src.engine.data_loader import _bars_cli_main


@pytest.fixture
def bars_fixture(tmp_path):
    df = pl.DataFrame({
        "ts_event": [
            datetime(2026, 6, 1, 9, 30),
            datetime(2026, 6, 2, 9, 30),
            datetime(2026, 6, 3, 9, 30),
        ],
        "open":   [100.0, 101.0, 102.0],
        "high":   [105.0, 106.0, 107.0],
        "low":    [99.0, 100.0, 101.0],
        "close":  [104.0, 105.0, 106.0],
        "volume": [1000, 1100, 1200],
    })
    # _bars_cli_main always calls load_ohlcv with adjusted=True (production default,
    # no --adjusted flag exposed) — _verify_ratio_adjusted_source requires the source
    # path to contain "ratio_adj" or "consolidated" in that mode, so the fixture lives
    # under a ratio_adj/ subdirectory (matches every real S3 path shape).
    ratio_adj_dir = tmp_path / "ratio_adj"
    ratio_adj_dir.mkdir()
    path = ratio_adj_dir / "bars_fixture.parquet"
    df.write_parquet(str(path))
    return str(path)


def _run_cli(argv, capsys):
    old_argv = sys.argv
    sys.argv = ["fetch_bars"] + argv
    try:
        exit_code = _bars_cli_main()
    finally:
        sys.argv = old_argv
    captured = capsys.readouterr()
    return exit_code, captured.out


class TestBarsCliHappyPath:
    def test_emits_bars_ascending_with_expected_fields(self, bars_fixture, capsys):
        exit_code, out = _run_cli(
            ["--symbol", "MES", "--timeframe", "1d", "--start", "2026-06-01",
             "--end", "2026-06-03", "--local-path", bars_fixture],
            capsys,
        )
        assert exit_code == 0
        payload = json.loads(out)
        assert "bars" in payload
        bars = payload["bars"]
        assert len(bars) == 3
        # ascending by ts_event
        assert bars[0]["ts_event"] < bars[1]["ts_event"] < bars[2]["ts_event"]
        for b in bars:
            assert set(["ts_event", "open", "high", "low", "close", "volume"]) <= set(b.keys())
        assert bars[0]["open"] == 100.0
        assert bars[0]["high"] == 105.0
        assert bars[0]["low"] == 99.0
        assert bars[0]["close"] == 104.0
        assert bars[0]["volume"] == 1000.0

    def test_ts_event_is_utc_iso_with_z_or_offset(self, bars_fixture, capsys):
        exit_code, out = _run_cli(
            ["--symbol", "MES", "--timeframe", "1d", "--start", "2026-06-01",
             "--end", "2026-06-03", "--local-path", bars_fixture],
            capsys,
        )
        assert exit_code == 0
        payload = json.loads(out)
        ts = payload["bars"][0]["ts_event"]
        assert ts.endswith("Z") or "+" in ts

    def test_start_end_window_narrows_result(self, bars_fixture, capsys):
        exit_code, out = _run_cli(
            ["--symbol", "MES", "--timeframe", "1d", "--start", "2026-06-02",
             "--end", "2026-06-02", "--local-path", bars_fixture],
            capsys,
        )
        assert exit_code == 0
        payload = json.loads(out)
        assert len(payload["bars"]) == 1
        assert payload["bars"][0]["open"] == 101.0


class TestBarsCliHonestEmpty:
    def test_no_data_in_window_returns_empty_bars_not_error(self, bars_fixture, capsys):
        # Window entirely outside the fixture's date range — load_ohlcv raises
        # ValueError("No data found for...") which the CLI must treat as a
        # legitimate empty result (exit 0), not surface as a failure.
        exit_code, out = _run_cli(
            ["--symbol", "MES", "--timeframe", "1d", "--start", "2020-01-01",
             "--end", "2020-01-02", "--local-path", bars_fixture],
            capsys,
        )
        assert exit_code == 0
        payload = json.loads(out)
        assert payload == {"bars": []}

    def test_unrecognized_valueerror_message_still_propagates(self, bars_fixture, capsys, monkeypatch):
        # RED-proof for the string-match guard: a ValueError from load_ohlcv that is
        # NOT the "no data" message must NOT be silently swallowed into {"bars": []}.
        import src.engine.data_loader as data_loader_module

        def _raise_other_value_error(*args, **kwargs):
            raise ValueError("some unrelated validation failure")

        monkeypatch.setattr(data_loader_module, "load_ohlcv", _raise_other_value_error)

        old_argv = sys.argv
        sys.argv = [
            "fetch_bars", "--symbol", "MES", "--timeframe", "1d",
            "--start", "2026-06-01", "--end", "2026-06-03", "--local-path", bars_fixture,
        ]
        try:
            with pytest.raises(ValueError, match="some unrelated validation failure"):
                data_loader_module._bars_cli_main()
        finally:
            sys.argv = old_argv


class TestBarsCliRuntimeErrorNotFound:
    """A symbol with no S3 file at either the primary or legacy path (never onboarded
    to the data lake — e.g. DXY, ZN/10Y) fails at file-RESOLUTION time and load_ohlcv
    wraps that into a RuntimeError, NOT the "No data found for" ValueError covered by
    TestBarsCliHonestEmpty above. This class RED-proofs that distinct path.
    """

    def _run_with_load_ohlcv_raising(self, exc, bars_fixture, capsys, monkeypatch):
        import src.engine.data_loader as data_loader_module

        def _raise(*args, **kwargs):
            raise exc

        monkeypatch.setattr(data_loader_module, "load_ohlcv", _raise)
        return _run_cli(
            ["--symbol", "DXY", "--timeframe", "1d", "--start", "2026-06-01",
             "--end", "2026-06-03", "--local-path", bars_fixture],
            capsys,
        )

    def test_no_files_found_runtimeerror_is_honest_empty(self, bars_fixture, capsys, monkeypatch):
        exit_code, out = self._run_with_load_ohlcv_raising(
            RuntimeError("Failed to load DXY daily from S3 (legacy path): IO Error: No files found that match the pattern"),
            bars_fixture, capsys, monkeypatch,
        )
        assert exit_code == 0
        assert json.loads(out) == {"bars": []}

    def test_does_not_exist_runtimeerror_is_honest_empty(self, bars_fixture, capsys, monkeypatch):
        exit_code, out = self._run_with_load_ohlcv_raising(
            RuntimeError("Failed to load DXY daily from S3 (legacy path): IO Error: [bucket]/futures/DXY/... does not exist"),
            bars_fixture, capsys, monkeypatch,
        )
        assert exit_code == 0
        assert json.loads(out) == {"bars": []}

    def test_unrelated_runtimeerror_message_still_propagates(self, bars_fixture, capsys, monkeypatch):
        # RED-proof for the marker guard: a RuntimeError that is NOT a "file/glob not
        # found" shape (e.g. permissions, corrupted Parquet) must NOT be swallowed.
        import src.engine.data_loader as data_loader_module

        def _raise(*args, **kwargs):
            raise RuntimeError("Failed to load DXY daily from S3 (legacy path): IO Error: Access Denied")

        monkeypatch.setattr(data_loader_module, "load_ohlcv", _raise)
        old_argv = sys.argv
        sys.argv = [
            "fetch_bars", "--symbol", "DXY", "--timeframe", "1d",
            "--start", "2026-06-01", "--end", "2026-06-03", "--local-path", bars_fixture,
        ]
        try:
            with pytest.raises(RuntimeError, match="Access Denied"):
                data_loader_module._bars_cli_main()
        finally:
            sys.argv = old_argv

    def test_dataloadconfigerror_missing_creds_still_propagates_not_swallowed(
        self, bars_fixture, capsys, monkeypatch,
    ):
        # DataLoadConfigError IS a RuntimeError subclass (missing AWS creds) — its
        # message never contains the not-found markers, so it must propagate as a
        # real infra failure, never masquerade as "DXY just has no data."
        import src.engine.data_loader as data_loader_module

        def _raise(*args, **kwargs):
            raise data_loader_module.DataLoadConfigError(
                "S3 read for 's3://bucket/futures/DXY/consolidated/daily.parquet' "
                "aborted before DuckDB: missing AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY."
            )

        monkeypatch.setattr(data_loader_module, "load_ohlcv", _raise)
        old_argv = sys.argv
        sys.argv = [
            "fetch_bars", "--symbol", "DXY", "--timeframe", "1d",
            "--start", "2026-06-01", "--end", "2026-06-03", "--local-path", bars_fixture,
        ]
        try:
            with pytest.raises(data_loader_module.DataLoadConfigError, match="missing AWS_ACCESS_KEY_ID"):
                data_loader_module._bars_cli_main()
        finally:
            sys.argv = old_argv


class TestBarsCliGenuineFailure:
    def test_missing_local_file_propagates_as_real_error_not_empty(self, tmp_path, capsys):
        # A genuinely broken read (bad path) must NOT be swallowed as honest-empty —
        # only the specific "No data found for" ValueError gets that treatment.
        ratio_adj_dir = tmp_path / "ratio_adj"
        ratio_adj_dir.mkdir()
        missing = str(ratio_adj_dir / "does_not_exist.parquet")
        old_argv = sys.argv
        sys.argv = [
            "fetch_bars", "--symbol", "MES", "--timeframe", "1d",
            "--start", "2026-06-01", "--end", "2026-06-03", "--local-path", missing,
        ]
        try:
            # A missing local file (test-only --local-path escape hatch, never used
            # in production) raises DuckDB's native IOException UNWRAPPED — it never
            # reaches the RuntimeError-wrapping fallback (that only fires for the
            # real S3 primary+legacy path resolution, not local_path reads).
            with pytest.raises(duckdb.IOException, match="No files found"):
                _bars_cli_main()
        finally:
            sys.argv = old_argv
