"""
Unit tests for _data_sync_tracking.py

Uses unittest.mock to avoid any real DB connection.  All tests verify:
  - start_sync_job returns a UUID string on success
  - complete_sync_job and fail_sync_job call UPDATE with correct params
  - DB failure / missing DATABASE_URL → None returned, no exception raised
  - Error message truncation at 4000 chars
  - metadata JSONB merge branch is exercised
  - Cost rate constants have expected values
"""

import json
import os
import sys
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, call

import pytest

# Add the scripts directory to path so we can import the module under test.
sys.path.insert(0, os.path.dirname(__file__))

import _data_sync_tracking as tracking
from _data_sync_tracking import (
    COST_PER_BAR_OHLCV,
    COST_PER_MSG_IMBALANCE,
    COST_DEFINITION_FREE,
    COST_STATISTICS_FREE,
    start_sync_job,
    complete_sync_job,
    fail_sync_job,
)

# ── Constants ──────────────────────────────────────────────────────────────────

def test_cost_constants_ohlcv():
    """OHLCV rate: $0.001 / million bars."""
    assert COST_PER_BAR_OHLCV == pytest.approx(0.001 / 1_000_000, rel=1e-9)


def test_cost_constants_imbalance():
    """Imbalance rate: $0.01 per message."""
    assert COST_PER_MSG_IMBALANCE == pytest.approx(0.01, rel=1e-9)


def test_cost_constants_free_schemas():
    """Definition and Statistics are FREE."""
    assert COST_DEFINITION_FREE == 0.0
    assert COST_STATISTICS_FREE == 0.0


# ── Helper: build a mock psycopg2 connection ──────────────────────────────────

def _make_mock_conn():
    """Return a mock psycopg2 connection whose cursor captures SQL calls."""
    mock_cursor = MagicMock()
    mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
    mock_cursor.__exit__ = MagicMock(return_value=False)

    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.autocommit = False
    return mock_conn, mock_cursor


# ── start_sync_job ────────────────────────────────────────────────────────────

class TestStartSyncJob:
    def test_returns_uuid_string_on_success(self):
        mock_conn, mock_cursor = _make_mock_conn()
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                result = start_sync_job(
                    symbol="ES",
                    source="databento",
                    start_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
                    end_date=datetime(2025, 1, 31, tzinfo=timezone.utc),
                )
        assert result is not None
        # Must be a valid UUID string
        uuid.UUID(result)

    def test_inserts_pending_row(self):
        mock_conn, mock_cursor = _make_mock_conn()
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                start_sync_job(
                    symbol="NQ",
                    source="databento",
                    start_date=datetime(2025, 6, 1, tzinfo=timezone.utc),
                    end_date=datetime(2025, 6, 30, tzinfo=timezone.utc),
                    metadata={"schema": "ohlcv-1m"},
                )
        sql_called = mock_cursor.execute.call_args[0][0]
        assert "INSERT INTO data_sync_jobs" in sql_called
        assert "'pending'" in sql_called or "pending" in sql_called

    def test_metadata_serialized_as_json(self):
        mock_conn, mock_cursor = _make_mock_conn()
        meta = {"schema": "imbalance", "dataset": "GLBX.MDP3"}
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                start_sync_job(
                    symbol="ES",
                    source="databento",
                    start_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
                    end_date=datetime(2025, 1, 2, tzinfo=timezone.utc),
                    metadata=meta,
                )
        args = mock_cursor.execute.call_args[0][1]
        # 6th positional param is the metadata JSON string
        meta_param = args[5]
        assert meta_param is not None
        parsed = json.loads(meta_param)
        assert parsed["schema"] == "imbalance"

    def test_no_database_url_returns_none(self):
        env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
        with patch.dict(os.environ, env, clear=True):
            result = start_sync_job(
                symbol="ES",
                source="databento",
                start_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
                end_date=datetime(2025, 1, 2, tzinfo=timezone.utc),
            )
        assert result is None

    def test_db_connect_failure_returns_none(self):
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.side_effect = Exception("connection refused")
                result = start_sync_job(
                    symbol="ES",
                    source="databento",
                    start_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
                    end_date=datetime(2025, 1, 2, tzinfo=timezone.utc),
                )
        assert result is None

    def test_execute_failure_returns_none(self):
        mock_conn, mock_cursor = _make_mock_conn()
        mock_cursor.execute.side_effect = Exception("syntax error")
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                result = start_sync_job(
                    symbol="ES",
                    source="databento",
                    start_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
                    end_date=datetime(2025, 1, 2, tzinfo=timezone.utc),
                )
        assert result is None


# ── complete_sync_job ─────────────────────────────────────────────────────────

class TestCompleteSyncJob:
    def test_updates_to_completed(self):
        mock_conn, mock_cursor = _make_mock_conn()
        job_id = str(uuid.uuid4())
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                complete_sync_job(
                    job_id=job_id,
                    rows_downloaded=50000,
                    cost_usd=0.05,
                )
        sql_called = mock_cursor.execute.call_args[0][0]
        assert "UPDATE data_sync_jobs" in sql_called
        assert "completed" in sql_called

    def test_passes_cost_and_rows(self):
        mock_conn, mock_cursor = _make_mock_conn()
        job_id = str(uuid.uuid4())
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                complete_sync_job(
                    job_id=job_id,
                    rows_downloaded=1234,
                    cost_usd=0.01,
                    rolls_detected=3,
                )
        args = mock_cursor.execute.call_args[0][1]
        # (cost_usd, rows_downloaded, rolls_detected, job_id) — no metadata branch
        assert args[0] == 0.01
        assert args[1] == 1234
        assert args[2] == 3
        assert args[3] == job_id

    def test_metadata_branch_merges_jsonb(self):
        mock_conn, mock_cursor = _make_mock_conn()
        job_id = str(uuid.uuid4())
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                complete_sync_job(
                    job_id=job_id,
                    rows_downloaded=100,
                    cost_usd=0.0,
                    metadata={"timeframe": "5min"},
                )
        sql_called = mock_cursor.execute.call_args[0][0]
        # Metadata branch uses JSONB merge operator ||
        assert "||" in sql_called

    def test_none_job_id_is_noop(self):
        """complete_sync_job(None, ...) must not raise and must not connect."""
        with patch("_data_sync_tracking._get_connection") as mock_gc:
            complete_sync_job(job_id=None, rows_downloaded=0, cost_usd=0.0)
        mock_gc.assert_not_called()

    def test_db_failure_is_silent(self):
        mock_conn, mock_cursor = _make_mock_conn()
        mock_cursor.execute.side_effect = Exception("deadlock")
        job_id = str(uuid.uuid4())
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                # Must not raise
                complete_sync_job(job_id=job_id, rows_downloaded=0, cost_usd=0.0)


# ── fail_sync_job ─────────────────────────────────────────────────────────────

class TestFailSyncJob:
    def test_updates_to_failed(self):
        mock_conn, mock_cursor = _make_mock_conn()
        job_id = str(uuid.uuid4())
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                fail_sync_job(job_id=job_id, error_message="Databento fetch failed: timeout")
        sql_called = mock_cursor.execute.call_args[0][0]
        assert "UPDATE data_sync_jobs" in sql_called
        assert "failed" in sql_called

    def test_stores_error_message(self):
        mock_conn, mock_cursor = _make_mock_conn()
        job_id = str(uuid.uuid4())
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                fail_sync_job(job_id=job_id, error_message="some error detail")
        args = mock_cursor.execute.call_args[0][1]
        # Without metadata: (truncated_msg, job_id)
        assert "some error detail" in args[0]
        assert args[1] == job_id

    def test_truncates_long_error_messages(self):
        mock_conn, mock_cursor = _make_mock_conn()
        job_id = str(uuid.uuid4())
        long_msg = "x" * 10_000
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                fail_sync_job(job_id=job_id, error_message=long_msg)
        args = mock_cursor.execute.call_args[0][1]
        assert len(args[0]) == 4000

    def test_metadata_branch(self):
        mock_conn, mock_cursor = _make_mock_conn()
        job_id = str(uuid.uuid4())
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                fail_sync_job(
                    job_id=job_id,
                    error_message="oops",
                    metadata={"schema": "definition"},
                )
        sql_called = mock_cursor.execute.call_args[0][0]
        assert "||" in sql_called

    def test_none_job_id_is_noop(self):
        with patch("_data_sync_tracking._get_connection") as mock_gc:
            fail_sync_job(job_id=None, error_message="irrelevant")
        mock_gc.assert_not_called()

    def test_db_failure_is_silent(self):
        mock_conn, mock_cursor = _make_mock_conn()
        mock_cursor.execute.side_effect = Exception("constraint violation")
        job_id = str(uuid.uuid4())
        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.return_value = mock_conn
                # Must not raise
                fail_sync_job(job_id=job_id, error_message="some error")


# ── Integration: start → complete lifecycle ───────────────────────────────────

class TestLifecycle:
    def test_start_then_complete_calls_both_updates(self):
        """Full happy-path: start returns UUID, complete hits DB."""
        mock_conn_start, mock_cursor_start = _make_mock_conn()
        mock_conn_complete, mock_cursor_complete = _make_mock_conn()

        side_effects = iter([mock_conn_start, mock_conn_complete])

        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.side_effect = lambda url: next(side_effects)

                job_id = start_sync_job(
                    symbol="MCL",
                    source="databento",
                    start_date=datetime(2025, 4, 1, tzinfo=timezone.utc),
                    end_date=datetime(2025, 4, 30, tzinfo=timezone.utc),
                    metadata={"schema": "imbalance"},
                )
                assert job_id is not None

                complete_sync_job(
                    job_id=job_id,
                    rows_downloaded=1,
                    cost_usd=0.01,
                )

        # INSERT was called for start
        insert_sql = mock_cursor_start.execute.call_args[0][0]
        assert "INSERT INTO data_sync_jobs" in insert_sql

        # UPDATE was called for complete
        update_sql = mock_cursor_complete.execute.call_args[0][0]
        assert "UPDATE data_sync_jobs" in update_sql
        assert "completed" in update_sql

    def test_start_then_fail_lifecycle(self):
        """start → fail lifecycle records the error."""
        mock_conn_start, mock_cursor_start = _make_mock_conn()
        mock_conn_fail, mock_cursor_fail = _make_mock_conn()

        side_effects = iter([mock_conn_start, mock_conn_fail])

        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}):
            with patch("_data_sync_tracking.psycopg2") as mock_psycopg2:
                mock_psycopg2.connect.side_effect = lambda url: next(side_effects)

                job_id = start_sync_job(
                    symbol="ES",
                    source="databento",
                    start_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
                    end_date=datetime(2025, 1, 2, tzinfo=timezone.utc),
                )
                fail_sync_job(job_id=job_id, error_message="API key invalid")

        update_sql = mock_cursor_fail.execute.call_args[0][0]
        assert "failed" in update_sql
        args = mock_cursor_fail.execute.call_args[0][1]
        assert "API key invalid" in args[0]
