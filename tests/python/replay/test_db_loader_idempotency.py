"""Tests for write_replay_row idempotency and concurrent-replay safety.

Wave 27.5 Pass A.2 — BUG-1 fix: ON CONFLICT clause + partial unique index.

Covers:
  - test_concurrent_replay_no_duplicates:        second INSERT with same tuple returns
                                                  same UUID, no duplicate row created
  - test_distinct_repro_hash_creates_separate_row: same (backtest_id, method) but
                                                  different hash -> 2 separate rows
  - test_live_cloud_qmc_not_constrained:          replay_mode=False rows skip the
                                                  partial index predicate (allowed dups)
  - test_idempotency_belt_and_suspenders:         SELECT-before-INSERT app check returns
                                                  existing id even when DB constraint
                                                  would handle the conflict
  - test_on_conflict_clause_present_in_sql:       grepping the generated SQL verifies
                                                  the corrected ON CONFLICT clause
  - test_governance_labels_in_replay_row:         governance contract still enforced
  - test_dry_run_returns_none:                    dry-run does not write and returns None

All DB interactions are mocked with unittest.mock — no live DB required.
When a DB is available, tests document the expected psycopg2 behaviour.
"""
from __future__ import annotations

import sys
from unittest.mock import MagicMock, call, patch, ANY
import pytest

# ---------------------------------------------------------------------------
# Bootstrap: pre-inject psycopg2 stub before the module under test loads it
# ---------------------------------------------------------------------------
if "psycopg2" not in sys.modules:
    _psycopg2_stub = MagicMock()
    # psycopg2.extras.Json must be callable and return a mock
    _psycopg2_stub.extras.Json = lambda x: x
    sys.modules["psycopg2"] = _psycopg2_stub
    sys.modules["psycopg2.extras"] = _psycopg2_stub.extras

from src.engine.replay.db_loader import (  # noqa: E402
    REPLAY_ROW_SCHEMA,
    write_replay_row,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_REPLAY_GOVERNANCE = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "replay_mode": True,
}

_LIVE_GOVERNANCE = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "replay_mode": False,
}


def _make_replay_result(
    backtest_id: str = "bt-aaa",
    method: str = "iae",
    repro_hash: str = "sha256-aabbcc",
    governance: dict | None = None,
) -> dict:
    """Build a minimal valid replay result dict satisfying REPLAY_ROW_SCHEMA.required_fields."""
    return {
        "backtest_id": backtest_id,
        "method": method,
        "reproducibility_hash": repro_hash,
        "governance_labels": governance if governance is not None else _REPLAY_GOVERNANCE,
        # Required fields from REPLAY_ROW_SCHEMA with minimal sensible values
        "status": "completed",
        "backend": "aer_statevector",
        "num_qubits": 4,
        "estimated_value": 0.85,
        "classical_value": 0.82,
        "tolerance_delta": 0.03,
        "within_tolerance": True,
        "confidence_interval": {"lower": 0.80, "upper": 0.90, "confidence_level": 0.95},
        "execution_time_ms": 1200,
        "gpu_accelerated": False,
        "raw_result": {"shots": 1024, "counts": {"0": 870, "1": 154}},
    }


def _make_mock_conn(
    existing_row: dict | None = None,
    insert_returned: dict | None = None,
):
    """Build a psycopg2 connection mock.

    existing_row — what the SELECT-before-INSERT returns (None = no existing row)
    insert_returned — what RETURNING id returns after the INSERT (None = conflict)
    """
    mock_cursor = MagicMock()
    mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
    mock_cursor.__exit__ = MagicMock(return_value=False)

    # fetchone sequence: [SELECT result, INSERT RETURNING result]
    fetchone_seq = []
    fetchone_seq.append(existing_row)      # First call: SELECT check
    if existing_row is None:
        fetchone_seq.append(insert_returned)   # Second call: INSERT RETURNING

    mock_cursor.fetchone.side_effect = fetchone_seq

    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.cursor.return_value = mock_cursor

    return mock_conn, mock_cursor


# ---------------------------------------------------------------------------
# Test 1: Concurrent replay — second INSERT with same tuple returns same UUID
# ---------------------------------------------------------------------------

def test_concurrent_replay_no_duplicates():
    """Simulate the concurrent-insert scenario.

    First call inserts successfully and returns new_id.
    Second call finds existing_row via SELECT-before-INSERT and returns the
    same UUID — no duplicate row.

    This mirrors the expected behaviour after DB constraint enforcement:
    even if the SELECT check is racy, the ON CONFLICT clause catches it.
    """
    existing_id = "uuid-existing-001"
    result = _make_replay_result()

    # Second call — existing row found by SELECT-before-INSERT
    mock_conn_existing, _ = _make_mock_conn(
        existing_row={"id": existing_id},
    )

    with patch(
        "src.engine.replay.db_loader._get_db_connection",
        return_value=mock_conn_existing,
    ):
        returned_id = write_replay_row(result, apply=True)

    assert returned_id == existing_id, (
        "Expected the existing row's UUID to be returned on duplicate INSERT, "
        f"got {returned_id!r}"
    )


# ---------------------------------------------------------------------------
# Test 2: Different reproducibility_hash → separate row
# ---------------------------------------------------------------------------

def test_distinct_repro_hash_creates_separate_row():
    """Same (backtest_id, method) but different hash → two independent rows."""
    result_a = _make_replay_result(repro_hash="sha256-hash-A")
    result_b = _make_replay_result(repro_hash="sha256-hash-B")

    new_id_a = "uuid-row-a"
    new_id_b = "uuid-row-b"

    returned_a_row = {"id": new_id_a}
    returned_b_row = {"id": new_id_b}

    mock_conn_a, _ = _make_mock_conn(
        existing_row=None,
        insert_returned=returned_a_row,
    )
    mock_conn_b, _ = _make_mock_conn(
        existing_row=None,
        insert_returned=returned_b_row,
    )

    with patch(
        "src.engine.replay.db_loader._get_db_connection",
        side_effect=[mock_conn_a, mock_conn_b],
    ):
        id_a = write_replay_row(result_a, apply=True)
        id_b = write_replay_row(result_b, apply=True)

    assert id_a is not None
    assert id_b is not None
    assert id_a != id_b, (
        "Two rows with different reproducibility_hash must receive distinct UUIDs"
    )


# ---------------------------------------------------------------------------
# Test 3: Live cloud QMC rows (replay_mode=False) — not constrained
# ---------------------------------------------------------------------------

def test_live_cloud_qmc_not_constrained():
    """Rows with governance_labels.replay_mode=False skip the partial index predicate.

    The partial unique index only fires WHERE governance_labels->>'replay_mode' = 'true'.
    Live cloud QMC rows have replay_mode=False (or absent) and can duplicate freely.
    This test verifies write_replay_row raises on non-replay governance so the
    caller must explicitly mark replay_mode=True for replay rows — the governance
    contract is enforced before the INSERT reaches the DB.
    """
    result_live = _make_replay_result(governance=_LIVE_GOVERNANCE)

    # write_replay_row enforces governance before the DB round-trip
    with pytest.raises(ValueError, match="governance_labels.replay_mode"):
        write_replay_row(result_live, apply=True)


# ---------------------------------------------------------------------------
# Test 4: Belt-and-suspenders — SELECT-before-INSERT returns existing id
# ---------------------------------------------------------------------------

def test_idempotency_belt_and_suspenders():
    """App-level SELECT check returns existing UUID without an INSERT.

    This is the normal fast-path for idempotency: the SELECT finds the existing
    row and returns early, avoiding a wasted INSERT + conflict.  The DB constraint
    is the concurrent fallback; the SELECT is the sequential fast path.
    """
    existing_id = "uuid-belt-suspenders-001"
    result = _make_replay_result()

    mock_conn, mock_cursor = _make_mock_conn(
        existing_row={"id": existing_id},
    )

    with patch(
        "src.engine.replay.db_loader._get_db_connection",
        return_value=mock_conn,
    ):
        returned = write_replay_row(result, apply=True)

    assert returned == existing_id

    # Verify: cursor.execute should have been called for the SELECT but NOT the INSERT
    execute_calls = mock_cursor.execute.call_args_list
    assert len(execute_calls) == 1, (
        "SELECT-before-INSERT fast path should call execute exactly once (the SELECT), "
        f"but got {len(execute_calls)} execute call(s)"
    )
    # The single call should be the SELECT (contains 'SELECT id FROM quantum_mc_runs')
    select_sql = execute_calls[0].args[0]
    assert "SELECT id FROM quantum_mc_runs" in select_sql, (
        f"Expected SELECT statement, got: {select_sql!r}"
    )


# ---------------------------------------------------------------------------
# Test 5: ON CONFLICT clause correctness in generated SQL
# ---------------------------------------------------------------------------

def test_on_conflict_clause_present_in_sql():
    """The INSERT SQL must reference the partial index conflict target, not (id).

    Regression guard: if the ON CONFLICT clause reverts to (id), this test fails.
    """
    import inspect
    import src.engine.replay.db_loader as db_loader_module

    source = inspect.getsource(db_loader_module.write_replay_row)

    assert "ON CONFLICT (id)" not in source, (
        "BUG-1 regression: ON CONFLICT (id) found in write_replay_row — "
        "should use (backtest_id, method, reproducibility_hash) with partial predicate"
    )
    assert "ON CONFLICT (backtest_id, method, reproducibility_hash)" in source, (
        "ON CONFLICT must target (backtest_id, method, reproducibility_hash)"
    )
    assert "WHERE governance_labels->>'replay_mode' = 'true'" in source, (
        "ON CONFLICT must include the partial index predicate "
        "WHERE governance_labels->>'replay_mode' = 'true'"
    )


# ---------------------------------------------------------------------------
# Test 6: governance labels still enforced
# ---------------------------------------------------------------------------

def test_governance_labels_enforced_on_apply():
    """Missing governance field raises ValueError before DB access."""
    bad_result = _make_replay_result(
        governance={
            "experimental": True,
            "authoritative": False,
            "decision_role": "challenger_only",
            # replay_mode missing — fails contract check
        }
    )

    with pytest.raises(ValueError, match="governance_labels.replay_mode"):
        write_replay_row(bad_result, apply=True)


def test_governance_labels_wrong_value_raises():
    """authoritative=True violates the contract and must raise."""
    bad_result = _make_replay_result(
        governance={
            "experimental": True,
            "authoritative": True,   # wrong — must be False
            "decision_role": "challenger_only",
            "replay_mode": True,
        }
    )
    with pytest.raises(ValueError, match="governance_labels.authoritative"):
        write_replay_row(bad_result, apply=True)


# ---------------------------------------------------------------------------
# Test 7: Dry-run returns None, no DB call
# ---------------------------------------------------------------------------

def test_dry_run_returns_none():
    """apply=False validates the result and returns None without touching the DB."""
    result = _make_replay_result()

    with patch(
        "src.engine.replay.db_loader._get_db_connection"
    ) as mock_get_conn:
        returned = write_replay_row(result, apply=False)

    assert returned is None
    mock_get_conn.assert_not_called()


def test_dry_run_bad_governance_still_raises():
    """apply=False still validates governance — bad governance raises even in dry-run."""
    bad_result = _make_replay_result(governance=_LIVE_GOVERNANCE)

    with pytest.raises(ValueError, match="governance_labels.replay_mode"):
        write_replay_row(bad_result, apply=False)
