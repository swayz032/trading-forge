"""
_data_sync_tracking.py — Shared helper for writing data_sync_jobs rows.

Pending-row contract:
  1. INSERT row with status="pending" BEFORE the API call (start_sync_job)
  2. UPDATE to status="completed" + metrics on success (complete_sync_job)
  3. UPDATE to status="failed" + error_message on exception (fail_sync_job)

All functions are wrapped so that tracking failures NEVER abort the caller.
The DB connection is opened and closed per call — scripts are short-lived
subprocesses, not long-running services.

Cost rate constants (Databento per-message pricing):
  OHLCV bars (refresh):  ~$0.001 per million bars
  Definition:            FREE ($0)
  Statistics:            FREE ($0)
  Imbalance:             ~$0.01 per message

Usage:
    from _data_sync_tracking import (
        start_sync_job, complete_sync_job, fail_sync_job,
        COST_PER_BAR_OHLCV, COST_PER_MSG_IMBALANCE,
    )
"""

import os
import uuid
import json
import logging
from datetime import datetime, timezone
from typing import Any

import psycopg2

logger = logging.getLogger(__name__)

# ── Cost rate constants ────────────────────────────────────────────────────────
COST_PER_BAR_OHLCV: float = 0.001 / 1_000_000   # $0.001 / million bars
COST_PER_MSG_IMBALANCE: float = 0.01             # $0.01 per imbalance message
COST_DEFINITION_FREE: float = 0.0               # Definition schema: FREE
COST_STATISTICS_FREE: float = 0.0               # Statistics schema: FREE


def _get_connection():
    """
    Open a psycopg2 connection using DATABASE_URL from environment.
    Returns None (with a warning) if the env var is missing or connection fails.
    Callers must check for None.
    """
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        logger.warning("data_sync_tracking: DATABASE_URL not set — tracking disabled")
        return None
    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = False
        return conn
    except Exception as exc:
        logger.warning("data_sync_tracking: DB connect failed: %s", exc)
        return None


def start_sync_job(
    symbol: str,
    source: str,
    start_date: datetime,
    end_date: datetime,
    metadata: dict[str, Any] | None = None,
) -> str | None:
    """
    INSERT a pending row into data_sync_jobs.

    Returns the job UUID string, or None if tracking is unavailable.
    Tracking failure is non-fatal — the caller should proceed regardless.

    Args:
        symbol:     Instrument symbol (e.g. "ES", "NQ").
        source:     Data source identifier (e.g. "databento").
        start_date: Start of the data window being fetched.
        end_date:   End of the data window being fetched.
        metadata:   Optional JSONB payload (schema, dataset, timeframes, etc.).

    Returns:
        UUID string for the new job row, or None.
    """
    try:
        conn = _get_connection()
        if conn is None:
            return None

        job_id = str(uuid.uuid4())
        meta_json = json.dumps(metadata) if metadata is not None else None

        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO data_sync_jobs
                        (id, symbol, source, start_date, end_date, status, metadata, created_at)
                    VALUES
                        (%s, %s, %s, %s, %s, 'pending', %s::jsonb, now())
                    """,
                    (job_id, symbol, source, start_date, end_date, meta_json),
                )
        conn.close()
        return job_id

    except Exception as exc:
        logger.warning("data_sync_tracking.start_sync_job failed: %s", exc)
        return None


def complete_sync_job(
    job_id: str,
    rows_downloaded: int,
    cost_usd: float,
    rolls_detected: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """
    UPDATE the job row to status="completed" with cost + row count.

    Non-fatal: if job_id is None or the update fails, logs a warning and returns.

    Args:
        job_id:          UUID returned by start_sync_job.
        rows_downloaded: Number of rows/records fetched.
        cost_usd:        Estimated or exact cost in USD.
        rolls_detected:  Number of contract rolls detected (optional).
        metadata:        Additional metadata to merge into the JSONB field (optional).
    """
    if job_id is None:
        return
    try:
        conn = _get_connection()
        if conn is None:
            return

        meta_json = json.dumps(metadata) if metadata is not None else None

        with conn:
            with conn.cursor() as cur:
                if meta_json is not None:
                    cur.execute(
                        """
                        UPDATE data_sync_jobs
                        SET status         = 'completed',
                            cost_usd       = %s,
                            rows_downloaded = %s,
                            rolls_detected  = %s,
                            completed_at   = now(),
                            metadata       = coalesce(metadata, '{}'::jsonb) || %s::jsonb
                        WHERE id = %s
                        """,
                        (cost_usd, rows_downloaded, rolls_detected, meta_json, job_id),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE data_sync_jobs
                        SET status          = 'completed',
                            cost_usd        = %s,
                            rows_downloaded = %s,
                            rolls_detected  = %s,
                            completed_at    = now()
                        WHERE id = %s
                        """,
                        (cost_usd, rows_downloaded, rolls_detected, job_id),
                    )
        conn.close()

    except Exception as exc:
        logger.warning("data_sync_tracking.complete_sync_job failed: %s", exc)


def fail_sync_job(
    job_id: str,
    error_message: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    """
    UPDATE the job row to status="failed" with the error message.

    Non-fatal: if job_id is None or the update fails, logs a warning and returns.

    Args:
        job_id:        UUID returned by start_sync_job.
        error_message: Full error description for debugging.
        metadata:      Additional metadata to merge into the JSONB field (optional).
    """
    if job_id is None:
        return
    try:
        conn = _get_connection()
        if conn is None:
            return

        # Truncate very long messages to avoid hitting DB column limits
        truncated = error_message[:4000] if len(error_message) > 4000 else error_message
        meta_json = json.dumps(metadata) if metadata is not None else None

        with conn:
            with conn.cursor() as cur:
                if meta_json is not None:
                    cur.execute(
                        """
                        UPDATE data_sync_jobs
                        SET status        = 'failed',
                            error_message = %s,
                            completed_at  = now(),
                            metadata      = coalesce(metadata, '{}'::jsonb) || %s::jsonb
                        WHERE id = %s
                        """,
                        (truncated, meta_json, job_id),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE data_sync_jobs
                        SET status        = 'failed',
                            error_message = %s,
                            completed_at  = now()
                        WHERE id = %s
                        """,
                        (truncated, job_id),
                    )
        conn.close()

    except Exception as exc:
        logger.warning("data_sync_tracking.fail_sync_job failed: %s", exc)
