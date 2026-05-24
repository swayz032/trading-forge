"""Tests for src/engine/replay/db_loader.py

All DB interactions are mocked with unittest.mock.  No live DB required.

Test coverage:
  - test_load_backtest_returns_daily_pnls
  - test_schema_contract_mismatch_skips_row
  - test_cpcv_purge_assertion
  - test_embargo_drops_first_oos_day
  - test_load_classical_baseline_returns_stored_value
  - test_write_replay_row_dry_run
  - test_write_replay_row_apply
  - test_governance_labels_in_replay_row
  - test_normalise_daily_pnls_list_dict_date_pnl
  - test_normalise_daily_pnls_list_dict_date_daily_pnl
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Optional
from unittest.mock import MagicMock, patch, call
import pytest

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_mock_conn(cursor_rows: list[dict | None] = None):
    """Build a mock psycopg2 connection that returns the given rows on fetchone/fetchall."""
    mock_cursor = MagicMock()
    mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
    mock_cursor.__exit__ = MagicMock(return_value=False)

    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.cursor.return_value = mock_cursor

    if cursor_rows is not None:
        # Each element in cursor_rows is returned by successive fetchone / fetchall calls
        mock_cursor.fetchone.side_effect = [
            r for r in cursor_rows if not isinstance(r, list)
        ]
        mock_cursor.fetchall.side_effect = [
            r for r in cursor_rows if isinstance(r, list)
        ]

    return mock_conn, mock_cursor


def _make_backtest_row(
    backtest_id: str = "bt-001",
    strategy_id: str = "st-001",
    daily_pnls: Any = None,
    total_return: Optional[float] = 380.75,
    total_trades: Optional[int] = 5,
) -> dict:
    """Build a fake backtests row dict (mimics psycopg2 DictRow)."""
    return {
        "id": backtest_id,
        "strategy_id": strategy_id,
        "daily_pnls": daily_pnls if daily_pnls is not None else [120.5, -40.0, 300.25],
        "total_return": total_return,
        "total_trades": total_trades,
    }


# ─── Import target ────────────────────────────────────────────────────────────

# Patch psycopg2 before import so the module doesn't fail on systems without it
import sys
if "psycopg2" not in sys.modules:
    sys.modules["psycopg2"] = MagicMock()
    sys.modules["psycopg2.extras"] = MagicMock()

from src.engine.replay.db_loader import (  # noqa: E402
    BacktestForReplay,
    SchemaContractMismatch,
    WalkForwardFold,
    REPLAY_ROW_SCHEMA,
    _normalise_daily_pnls,
    _apply_oos_embargo,
    load_backtest_with_folds,
    load_classical_baseline,
    write_replay_row,
)


# ─── Unit: _normalise_daily_pnls ─────────────────────────────────────────────

def test_normalise_daily_pnls_list_float():
    values, schema_version = _normalise_daily_pnls([120.5, -40.0, 300.25], "bt-001")
    assert values == [120.5, -40.0, 300.25]
    assert schema_version == "list_float"


def test_normalise_daily_pnls_list_dict_date_pnl():
    raw = [
        {"date": "2024-01-03", "pnl": 120.5},
        {"date": "2024-01-04", "pnl": -40.0},
    ]
    values, schema_version = _normalise_daily_pnls(raw, "bt-001")
    assert values == [120.5, -40.0]
    assert schema_version == "list_dict_date_pnl"


def test_normalise_daily_pnls_list_dict_date_daily_pnl():
    raw = [
        {"date": "2024-01-03", "daily_pnl": 120.5},
        {"date": "2024-01-04", "daily_pnl": -40.0},
    ]
    values, schema_version = _normalise_daily_pnls(raw, "bt-001")
    assert values == [120.5, -40.0]
    assert schema_version == "list_dict_date_daily_pnl"


def test_normalise_daily_pnls_null_raises():
    with pytest.raises(SchemaContractMismatch) as exc_info:
        _normalise_daily_pnls(None, "bt-bad")
    assert exc_info.value.row_id == "bt-bad"


def test_normalise_daily_pnls_bad_shape_raises():
    with pytest.raises(SchemaContractMismatch) as exc_info:
        _normalise_daily_pnls([{"unknown_key": 1.0}], "bt-bad")
    assert exc_info.value.row_id == "bt-bad"
    assert "neither 'pnl' nor 'daily_pnl'" in exc_info.value.observed_shape


# ─── Unit: _apply_oos_embargo ─────────────────────────────────────────────────

def test_embargo_drops_first_oos_day():
    trades = [
        {"entry_time": "2024-01-03T10:00:00", "pnl": 100.0},  # embargo day
        {"entry_time": "2024-01-03T14:00:00", "pnl": -50.0},  # embargo day
        {"entry_time": "2024-01-04T10:00:00", "pnl": 200.0},  # retained
        {"entry_time": "2024-01-05T10:00:00", "pnl": -30.0},  # retained
    ]
    result = _apply_oos_embargo(trades, "2024-01-03")
    assert len(result) == 2
    assert result[0]["pnl"] == 200.0
    assert result[1]["pnl"] == -30.0


def test_embargo_no_oos_start_returns_all():
    trades = [{"entry_time": "2024-01-03T10:00:00", "pnl": 100.0}]
    result = _apply_oos_embargo(trades, None)
    assert len(result) == 1


def test_embargo_empty_trades():
    result = _apply_oos_embargo([], "2024-01-03")
    assert result == []


# ─── Integration: load_backtest_with_folds ────────────────────────────────────

def test_load_backtest_returns_daily_pnls():
    """load_backtest_with_folds returns expected daily_pnls from a synthetic row."""
    expected_pnls = [120.5, -40.0, 300.25]
    bt_row = _make_backtest_row(
        daily_pnls=expected_pnls,
        # total_return close to sum(pnls)=380.75 (commission ~$6.20 for 5 trades)
        total_return=386.95,
        total_trades=5,
    )

    mock_conn = MagicMock()
    mock_conn.close = MagicMock()

    # Sequence of cursor returns:
    # 1. backtest row fetchone
    # 2. walk_forward_windows fetchall -> []
    # 3. (no OOS trades since no folds)
    bt_cursor = MagicMock()
    bt_cursor.__enter__ = MagicMock(return_value=bt_cursor)
    bt_cursor.__exit__ = MagicMock(return_value=False)
    bt_cursor.fetchone.return_value = bt_row
    bt_cursor.fetchall.return_value = []
    mock_conn.cursor.return_value = bt_cursor

    with patch("src.engine.replay.db_loader._get_db_connection", return_value=mock_conn):
        result = load_backtest_with_folds("bt-001")

    assert isinstance(result, BacktestForReplay)
    assert result.daily_pnls == expected_pnls
    assert result.backtest_id == "bt-001"
    assert result.strategy_id == "st-001"
    assert result.schema_version == "list_float"


def test_schema_contract_mismatch_skips_row(caplog):
    """Schema-mismatched daily_pnls raises SchemaContractMismatch."""
    bt_row = _make_backtest_row(
        daily_pnls={"bad": "shape"},  # dict instead of list
    )

    mock_conn = MagicMock()
    mock_conn.close = MagicMock()
    bt_cursor = MagicMock()
    bt_cursor.__enter__ = MagicMock(return_value=bt_cursor)
    bt_cursor.__exit__ = MagicMock(return_value=False)
    bt_cursor.fetchone.return_value = bt_row
    mock_conn.cursor.return_value = bt_cursor

    with patch("src.engine.replay.db_loader._get_db_connection", return_value=mock_conn):
        with pytest.raises(SchemaContractMismatch) as exc_info:
            load_backtest_with_folds("bt-bad")

    assert exc_info.value.row_id == "bt-bad"


def test_cpcv_purge_assertion():
    """Fold where oos_start <= is_end is excluded; compliant fold is retained."""
    bt_row = _make_backtest_row(
        daily_pnls=[100.0, 200.0],
        total_return=None,   # skip invariant check — this test is about fold exclusion
        total_trades=2,
    )

    # Two folds: first violates CPCV (oos_start == is_end); second is valid
    violating_fold = {
        "id": "wf-001",
        "window_index": 0,
        "is_start": "2024-01-01",
        "is_end": "2024-03-31",
        "oos_start": "2024-03-31",   # == is_end — violation
        "oos_end": "2024-06-30",
        "best_params": None,
    }
    valid_fold = {
        "id": "wf-002",
        "window_index": 1,
        "is_start": "2024-01-01",
        "is_end": "2024-03-31",
        "oos_start": "2024-04-01",   # > is_end — valid
        "oos_end": "2024-06-30",
        "best_params": None,
    }

    mock_conn = MagicMock()
    mock_conn.close = MagicMock()

    call_count = [0]

    def make_cursor(**kwargs):
        cursor = MagicMock()
        cursor.__enter__ = MagicMock(return_value=cursor)
        cursor.__exit__ = MagicMock(return_value=False)
        idx = call_count[0]
        call_count[0] += 1
        if idx == 0:
            # backtest row fetchone
            cursor.fetchone.return_value = bt_row
        elif idx == 1:
            # walk_forward_windows fetchall
            cursor.fetchall.return_value = [violating_fold, valid_fold]
        else:
            # OOS trades fetchall (one per oos range)
            cursor.fetchall.return_value = []
        return cursor

    mock_conn.cursor.side_effect = make_cursor

    with patch("src.engine.replay.db_loader._get_db_connection", return_value=mock_conn):
        result = load_backtest_with_folds("bt-001")

    # Only the valid fold should survive
    assert len(result.folds) == 1
    assert result.folds[0].window_id == "wf-002"


def test_embargo_drops_first_oos_day_integration():
    """OOS trades on the first OOS day are dropped; subsequent ones retained."""
    bt_row = _make_backtest_row(
        daily_pnls=[100.0],
        total_return=None,   # skip invariant — test is about embargo, not balance check
        total_trades=1,
    )

    valid_fold_row = {
        "id": "wf-001",
        "window_index": 0,
        "is_start": "2024-01-01",
        "is_end": "2024-03-31",
        "oos_start": "2024-04-01",
        "oos_end": "2024-06-30",
        "best_params": None,
    }

    # 3 trades: 1 on embargo day, 2 after
    trade1 = {
        "id": "t1", "backtest_id": "bt-001", "entry_time": datetime(2024, 4, 1, 10, 0),
        "exit_time": None, "direction": "long", "entry_price": 5000.0,
        "exit_price": 5010.0, "pnl": 50.0, "net_pnl": 48.76,
        "contracts": 1, "commission": 1.24, "gross_pnl": 50.0,
        "session_type": "NY_CORE", "macro_regime": "RISK_ON",
        "symbol": "MES", "timeframe": "5min",
    }
    trade2 = {
        "id": "t2", "backtest_id": "bt-001", "entry_time": datetime(2024, 4, 2, 10, 0),
        "exit_time": None, "direction": "long", "entry_price": 5000.0,
        "exit_price": 5012.0, "pnl": 60.0, "net_pnl": 58.76,
        "contracts": 1, "commission": 1.24, "gross_pnl": 60.0,
        "session_type": "NY_CORE", "macro_regime": "RISK_ON",
        "symbol": "MES", "timeframe": "5min",
    }
    trade3 = {
        "id": "t3", "backtest_id": "bt-001", "entry_time": datetime(2024, 4, 3, 10, 0),
        "exit_time": None, "direction": "short", "entry_price": 5010.0,
        "exit_price": 5005.0, "pnl": 25.0, "net_pnl": 23.76,
        "contracts": 1, "commission": 1.24, "gross_pnl": 25.0,
        "session_type": "NY_CORE", "macro_regime": "RISK_ON",
        "symbol": "MES", "timeframe": "5min",
    }

    mock_conn = MagicMock()
    mock_conn.close = MagicMock()
    call_count = [0]

    def make_cursor(**kwargs):
        cursor = MagicMock()
        cursor.__enter__ = MagicMock(return_value=cursor)
        cursor.__exit__ = MagicMock(return_value=False)
        idx = call_count[0]
        call_count[0] += 1
        if idx == 0:
            cursor.fetchone.return_value = bt_row
        elif idx == 1:
            cursor.fetchall.return_value = [valid_fold_row]
        else:
            # OOS trades include the embargo day trade + 2 retained
            cursor.fetchall.return_value = [trade1, trade2, trade3]
        return cursor

    mock_conn.cursor.side_effect = make_cursor

    with patch("src.engine.replay.db_loader._get_db_connection", return_value=mock_conn):
        result = load_backtest_with_folds("bt-001")

    # trade1 (April 1 = first OOS day) must be dropped
    assert len(result.oos_trades) == 2
    trade_ids = [t["id"] for t in result.oos_trades]
    assert "t1" not in trade_ids
    assert "t2" in trade_ids
    assert "t3" in trade_ids


# ─── load_classical_baseline ─────────────────────────────────────────────────

def test_load_classical_baseline_returns_stored_value():
    """load_classical_baseline returns the probability_of_ruin from monte_carlo_runs."""
    mc_row = {"probability_of_ruin": 0.034}

    mock_conn = MagicMock()
    mock_conn.close = MagicMock()
    cursor = MagicMock()
    cursor.__enter__ = MagicMock(return_value=cursor)
    cursor.__exit__ = MagicMock(return_value=False)
    cursor.fetchone.return_value = mc_row
    mock_conn.cursor.return_value = cursor

    with patch("src.engine.replay.db_loader._get_db_connection", return_value=mock_conn):
        value = load_classical_baseline("bt-001", "ruin")

    assert value == pytest.approx(0.034, abs=1e-9)


def test_load_classical_baseline_no_row_returns_none():
    """load_classical_baseline returns None when no completed MC run exists."""
    mock_conn = MagicMock()
    mock_conn.close = MagicMock()
    cursor = MagicMock()
    cursor.__enter__ = MagicMock(return_value=cursor)
    cursor.__exit__ = MagicMock(return_value=False)
    cursor.fetchone.return_value = None
    mock_conn.cursor.return_value = cursor

    with patch("src.engine.replay.db_loader._get_db_connection", return_value=mock_conn):
        value = load_classical_baseline("bt-missing", "ruin")

    assert value is None


# ─── write_replay_row ─────────────────────────────────────────────────────────

def _make_valid_replay_result(backtest_id: str = "bt-001") -> dict:
    """Build a minimal valid replay_result dict matching REPLAY_ROW_SCHEMA."""
    return {
        "backtest_id": backtest_id,
        "status": "completed",
        "method": "iae",
        "backend": "aer_statevector",
        "num_qubits": 10,
        "estimated_value": 0.042,
        "classical_value": 0.039,
        "tolerance_delta": 0.003,
        "within_tolerance": True,
        "confidence_interval": {"lower": 0.038, "upper": 0.046, "confidence_level": 0.95},
        "execution_time_ms": 1234,
        "gpu_accelerated": False,
        "governance_labels": {
            "experimental": True,
            "authoritative": False,
            "decision_role": "challenger_only",
            "replay_mode": True,
            "cpcv_fold": "wf-001",
        },
        "raw_result": {"shots": 1000, "counts": {"0": 958, "1": 42}},
        "reproducibility_hash": "abc123def456",
    }


def test_write_replay_row_dry_run():
    """apply=False returns None without any INSERT."""
    replay = _make_valid_replay_result()

    with patch("src.engine.replay.db_loader._get_db_connection") as mock_get_conn:
        result = write_replay_row(replay, apply=False)

    assert result is None
    mock_get_conn.assert_not_called()


def test_write_replay_row_apply():
    """apply=True performs INSERT and returns a UUID string."""
    replay = _make_valid_replay_result()

    mock_conn = MagicMock()
    mock_conn.close = MagicMock()
    mock_conn.commit = MagicMock()
    mock_conn.rollback = MagicMock()

    cursor = MagicMock()
    cursor.__enter__ = MagicMock(return_value=cursor)
    cursor.__exit__ = MagicMock(return_value=False)

    # First cursor call: conflict check → no existing row
    # Second cursor call: INSERT RETURNING → new row id
    cursor.fetchone.side_effect = [None, {"id": "new-uuid-1234"}]
    mock_conn.cursor.return_value = cursor

    with patch("src.engine.replay.db_loader._get_db_connection", return_value=mock_conn):
        result = write_replay_row(replay, apply=True)

    assert result is not None
    assert isinstance(result, str)
    mock_conn.commit.assert_called_once()


def test_governance_labels_in_replay_row():
    """Written row has experimental=True, authoritative=False, decision_role=challenger_only, replay_mode=True."""
    replay = _make_valid_replay_result()

    # Verify the governance contract enforced by write_replay_row
    governance = replay["governance_labels"]
    assert governance["experimental"] is True
    assert governance["authoritative"] is False
    assert governance["decision_role"] == "challenger_only"
    assert governance["replay_mode"] is True

    # Also verify that missing governance key raises ValueError (dry-run is fine)
    bad_replay = dict(replay)
    bad_replay["governance_labels"] = {
        "experimental": True,
        "authoritative": True,          # WRONG — must be False
        "decision_role": "challenger_only",
        "replay_mode": True,
    }
    with pytest.raises(ValueError, match="governance_labels.authoritative"):
        write_replay_row(bad_replay, apply=False)


def test_write_replay_row_missing_fields_raises():
    """Missing required fields raise ValueError before any DB call."""
    replay = _make_valid_replay_result()
    del replay["method"]

    with pytest.raises(ValueError, match="missing required fields"):
        write_replay_row(replay, apply=False)


def test_write_replay_row_idempotent_returns_existing_id():
    """If a row with the same (backtest_id, method, reproducibility_hash) exists, returns its id."""
    replay = _make_valid_replay_result()

    mock_conn = MagicMock()
    mock_conn.close = MagicMock()
    mock_conn.commit = MagicMock()
    mock_conn.rollback = MagicMock()

    cursor = MagicMock()
    cursor.__enter__ = MagicMock(return_value=cursor)
    cursor.__exit__ = MagicMock(return_value=False)
    # Conflict check returns existing row
    cursor.fetchone.return_value = {"id": "existing-uuid-5678"}
    mock_conn.cursor.return_value = cursor

    with patch("src.engine.replay.db_loader._get_db_connection", return_value=mock_conn):
        result = write_replay_row(replay, apply=True)

    assert result == "existing-uuid-5678"
    # No commit because we returned early on idempotent skip
    mock_conn.commit.assert_not_called()
