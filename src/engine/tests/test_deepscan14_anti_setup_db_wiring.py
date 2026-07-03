"""
deepscan14-cf D1 (Track B follow-up) — anti-setup miner DB-loading wiring tests.

Track 2 shipped the CLI entrypoint (`miner.py::__main__`, tested in
`test_deepscan14_anti_setup_cli.py`) but the scheduler only ever passed
`{"strategy_id": ...}` with no trades/bars, so the gate stayed permanently
`gate_status="inactive"` — honest, but never ACTIVE. This follow-up wires
`_load_closed_trades_for_strategy` / `_load_bars_with_atr_for_symbol` so the
CLI pulls real CLOSED `paper_trades` (+ best-effort OHLCV/ATR bars) from
Postgres for a given strategy_id.

No live Postgres is available in this environment (psycopg2 isn't even
installed — `DATABASE_URL` in .env is a placeholder). Per the pattern already
established in tests/python/replay/test_db_loader.py, psycopg2 is mocked
before import and DB interactions are verified against a fake cursor. The
`run_miner_cli()` wiring tests below (which patch the loader functions
directly) are what proves the "trades exist -> gate_status=active" and
"no trades -> gate_status=inactive" contracts end-to-end without spawning a
real DB — the existing subprocess tests in test_deepscan14_anti_setup_cli.py
already cover the case where DATABASE_URL is genuinely absent (falls back to
the same honest-inactive envelope via a caught DB connection error).
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock, patch

import pytest

# Patch psycopg2 before import so the module loads on systems without it
# installed (mirrors tests/python/replay/test_db_loader.py).
if "psycopg2" not in sys.modules:
    sys.modules["psycopg2"] = MagicMock()
    sys.modules["psycopg2.extras"] = MagicMock()

from src.engine.anti_setups.miner import (  # noqa: E402
    _get_miner_db_connection,
    _load_bars_with_atr_for_symbol,
    _load_closed_trades_for_strategy,
    run_miner_cli,
)


def _make_mock_conn(strategy_row, trade_rows):
    """Build a mock psycopg2 connection whose cursor answers the miner's two
    queries in order: (1) strategies symbol/timeframe lookup -> fetchone,
    (2) paper_trades join -> fetchall."""
    mock_cursor = MagicMock()
    mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
    mock_cursor.__exit__ = MagicMock(return_value=False)
    mock_cursor.fetchone.return_value = strategy_row
    mock_cursor.fetchall.return_value = trade_rows

    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    return mock_conn


class TestGetMinerDbConnection:
    def test_raises_runtime_error_when_database_url_unset(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        with pytest.raises(RuntimeError, match="DATABASE_URL"):
            _get_miner_db_connection()

    def test_connects_when_database_url_set(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@localhost/db")
        with patch("psycopg2.connect") as mock_connect:
            mock_connect.return_value = MagicMock()
            _get_miner_db_connection()
            mock_connect.assert_called_once_with("postgres://user:pass@localhost/db")


class TestLoadClosedTradesForStrategy:
    def test_maps_db_rows_to_mine_anti_setups_shape(self, monkeypatch):
        """entry_time/pnl/day_of_week/macro_regime columns map to the
        entry_time/pnl/day_of_week/regime keys mine_anti_setups() expects."""
        strategy_row = {"symbol": "MNQ", "timeframe": "5m"}
        trade_rows = [
            {"entry_time": "2026-01-05T02:15:00", "pnl": -50.0, "day_of_week": 0, "macro_regime": "TRENDING_DOWN"},
            {"entry_time": "2026-01-06T02:15:00", "pnl": -40.0, "day_of_week": 1, "macro_regime": None},
        ]
        mock_conn = _make_mock_conn(strategy_row, trade_rows)
        monkeypatch.setattr(
            "src.engine.anti_setups.miner._get_miner_db_connection",
            lambda: mock_conn,
        )

        trades, symbol, timeframe = _load_closed_trades_for_strategy("strat-1")

        assert symbol == "MNQ"
        assert timeframe == "5m"
        assert len(trades) == 2
        assert trades[0] == {
            "entry_time": "2026-01-05T02:15:00",
            "pnl": -50.0,
            "day_of_week": 0,
            "regime": "TRENDING_DOWN",
        }
        # Null macro_regime -> "regime" key omitted, not fabricated as null-string
        assert "regime" not in trades[1]
        assert trades[1]["pnl"] == -40.0

    def test_no_trades_returns_empty_list_not_error(self, monkeypatch):
        strategy_row = {"symbol": "MES", "timeframe": "5m"}
        mock_conn = _make_mock_conn(strategy_row, [])
        monkeypatch.setattr(
            "src.engine.anti_setups.miner._get_miner_db_connection",
            lambda: mock_conn,
        )

        trades, symbol, timeframe = _load_closed_trades_for_strategy("strat-no-trades")

        assert trades == []
        assert symbol == "MES"

    def test_unknown_strategy_returns_none_symbol(self, monkeypatch):
        mock_conn = _make_mock_conn(None, [])
        monkeypatch.setattr(
            "src.engine.anti_setups.miner._get_miner_db_connection",
            lambda: mock_conn,
        )

        trades, symbol, timeframe = _load_closed_trades_for_strategy("nonexistent")

        assert trades == []
        assert symbol is None
        assert timeframe is None

    def test_entry_time_datetime_object_is_isoformatted(self, monkeypatch):
        from datetime import datetime

        strategy_row = {"symbol": "MES", "timeframe": "5m"}
        trade_rows = [
            {"entry_time": datetime(2026, 1, 5, 2, 15, 0), "pnl": 25.0, "day_of_week": None, "macro_regime": None},
        ]
        mock_conn = _make_mock_conn(strategy_row, trade_rows)
        monkeypatch.setattr(
            "src.engine.anti_setups.miner._get_miner_db_connection",
            lambda: mock_conn,
        )

        trades, _, _ = _load_closed_trades_for_strategy("strat-dt")

        assert trades[0]["entry_time"] == "2026-01-05T02:15:00"
        assert "day_of_week" not in trades[0]


class TestLoadBarsWithAtrForSymbol:
    def test_empty_when_symbol_or_timeframe_missing(self):
        assert _load_bars_with_atr_for_symbol(None, "5m", [{"entry_time": "2026-01-01T00:00:00"}]) == []
        assert _load_bars_with_atr_for_symbol("MES", None, [{"entry_time": "2026-01-01T00:00:00"}]) == []

    def test_empty_when_no_trades(self):
        assert _load_bars_with_atr_for_symbol("MES", "5m", []) == []

    def test_swallows_load_ohlcv_failure_and_returns_empty(self, monkeypatch):
        """S3/data-loader failures must never crash the miner -- bars are an
        optional enrichment, not a hard dependency."""
        import src.engine.data_loader as data_loader_module

        def _boom(*args, **kwargs):
            raise RuntimeError("S3 unreachable in test env")

        monkeypatch.setattr(data_loader_module, "load_ohlcv", _boom)

        bars = _load_bars_with_atr_for_symbol(
            "MES", "5m", [{"entry_time": "2026-01-05T00:00:00"}, {"entry_time": "2026-01-06T00:00:00"}],
        )
        assert bars == []


class TestRunMinerCliWiring:
    """End-to-end wiring proof: run_miner_cli() is the exact function
    __main__ calls, so patching the loader functions here proves the full
    "strategy has trades -> gate_status=active" and
    "strategy has none -> gate_status=inactive" contracts without a live DB."""

    def test_strategy_with_trades_produces_active_gate_with_real_anti_setups(self, monkeypatch):
        # 25 losing trades all in the 2-4am bucket -> trips time_of_day miner
        # at default min_sample_size=20 / min_failure_rate=0.65 (same fixture
        # shape as test_deepscan14_anti_setup_cli.py's explicit-trades case).
        canned_trades = [
            {"entry_time": f"2026-01-{(i % 27) + 1:02d}T02:15:00", "pnl": -50.0}
            for i in range(25)
        ]
        monkeypatch.setattr(
            "src.engine.anti_setups.miner._load_closed_trades_for_strategy",
            lambda strategy_id: (canned_trades, "MNQ", "5m"),
        )
        monkeypatch.setattr(
            "src.engine.anti_setups.miner._load_bars_with_atr_for_symbol",
            lambda symbol, timeframe, trades: [],
        )

        envelope = run_miner_cli({"strategy_id": "strat-with-trades"})

        assert envelope["gate_status"] == "active"
        assert envelope["strategy_id"] == "strat-with-trades"
        assert len(envelope["anti_setups"]) >= 1
        top = envelope["anti_setups"][0]
        assert top["condition"] == "time_of_day"
        assert top["failure_rate"] == 1.0

    def test_strategy_with_no_trades_produces_honest_inactive_gate(self, monkeypatch):
        monkeypatch.setattr(
            "src.engine.anti_setups.miner._load_closed_trades_for_strategy",
            lambda strategy_id: ([], "MES", "5m"),
        )

        envelope = run_miner_cli({"strategy_id": "strat-no-trades"})

        assert envelope["gate_status"] == "inactive"
        assert envelope["anti_setups"] == []
        assert "nothing to mine yet" in envelope["reason"]
        assert envelope["strategy_id"] == "strat-no-trades"

    def test_db_error_produces_honest_inactive_gate_not_crash(self, monkeypatch):
        def _boom(strategy_id):
            raise RuntimeError("DATABASE_URL environment variable is not set")

        monkeypatch.setattr(
            "src.engine.anti_setups.miner._load_closed_trades_for_strategy",
            _boom,
        )

        envelope = run_miner_cli({"strategy_id": "strat-db-down"})

        assert envelope["gate_status"] == "inactive"
        assert envelope["anti_setups"] == []
        assert "DB load failed" in envelope["reason"]

    def test_explicit_trades_in_config_bypass_db_load_entirely(self, monkeypatch):
        """Back-compat: a caller that supplies trades/bars inline must never
        touch the DB loader (proves priority ordering is unchanged)."""
        db_loader_called = {"count": 0}

        def _should_not_be_called(strategy_id):
            db_loader_called["count"] += 1
            return ([], None, None)

        monkeypatch.setattr(
            "src.engine.anti_setups.miner._load_closed_trades_for_strategy",
            _should_not_be_called,
        )

        trades = [{"entry_time": f"2026-01-{(i % 27) + 1:02d}T02:15:00", "pnl": -50.0} for i in range(25)]
        envelope = run_miner_cli({"strategy_id": "strat-explicit", "trades": trades, "bars": []})

        assert db_loader_called["count"] == 0
        assert envelope["gate_status"] == "active"

    def test_no_strategy_id_and_no_trades_is_inactive_without_db_attempt(self, monkeypatch):
        db_loader_called = {"count": 0}

        def _should_not_be_called(strategy_id):
            db_loader_called["count"] += 1
            return ([], None, None)

        monkeypatch.setattr(
            "src.engine.anti_setups.miner._load_closed_trades_for_strategy",
            _should_not_be_called,
        )

        envelope = run_miner_cli({})

        assert db_loader_called["count"] == 0
        assert envelope["gate_status"] == "inactive"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
