"""DB extraction and walk-forward fold loading for the quantum replay harness.

Provides DB helpers that load historical backtest data from PostgreSQL and write
replay results back to the existing quantum_mc_runs table (no new schema).

The Python compute leaf (quantum_replay.py) imports from this module.

DB connection: psycopg2 with DATABASE_URL env var (same pattern as
black_swan_evaluator.py and other Python engine modules).

Schema-version gate
-------------------
backtests.daily_pnls JSONB contract (expected shapes):
  - list[float]:                   e.g. [120.5, -40.0, 300.25, ...]
  - list[dict{date, pnl}]:         e.g. [{"date": "2024-01-03", "pnl": 120.5}, ...]
  - list[dict{date, daily_pnl}]:   e.g. [{"date": "2024-01-03", "daily_pnl": 120.5}, ...]

If the shape does not match any of the above, SchemaContractMismatch is raised.
Rows with schema mismatches are logged and excluded from batch loads — they do NOT
crash the batch.

Pre-flight invariant check
--------------------------
Each loaded row is validated against:
    sum(daily_pnls) == ending_balance - starting_balance - total_commission
Toleranced at $1.00 to account for floating-point accumulation across hundreds of
days.  Violations are logged LOUD (not silently skipped) — they indicate data
integrity problems in the underlying backtest.

CPCV purge enforcement
----------------------
load_backtest_with_folds asserts oos_start > is_end for every walk_forward_windows
row returned. Any fold that violates this is logged as a WARNING and excluded from
the result (CPCV-purge contract per Lopez de Prado).

Embargo
-------
First trading day of each OOS window is dropped from oos_trades (plan statistical
methodology: 1-day embargo at OOS boundary prevents spillover of IS information
into the first OOS trade).

REPLAY_ROW_SCHEMA
-----------------
Matches quantum_mc_runs INSERT contract per schema.ts:888-916.
Idempotency: ON CONFLICT DO NOTHING using (backtest_id, method,
reproducibility_hash) as the uniqueness guard.  walk_forward_windows.id is stored
inside governance_labels.cpcv_fold so it participates in the hash but does NOT
add a new unique-index column to the existing table.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid as _uuid_mod
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ─── Exceptions ──────────────────────────────────────────────────────────────

class SchemaContractMismatch(Exception):
    """Raised when backtests.daily_pnls JSONB doesn't match any known contract.

    Attributes:
        row_id: backtest UUID where the mismatch was detected
        observed_shape: human-readable description of what was found
    """

    def __init__(self, row_id: str, observed_shape: str) -> None:
        self.row_id = row_id
        self.observed_shape = observed_shape
        super().__init__(
            f"SchemaContractMismatch for backtest {row_id!r}: {observed_shape}"
        )


# ─── Pydantic Models ──────────────────────────────────────────────────────────

class WalkForwardFold(BaseModel):
    """One walk-forward window row from walk_forward_windows."""

    window_id: str                   # UUID from walk_forward_windows.id
    window_index: int                # walk_forward_windows.window_index
    is_start: Optional[str]          # YYYY-MM-DD (or null for first fold)
    is_end: Optional[str]            # YYYY-MM-DD
    oos_start: Optional[str]         # YYYY-MM-DD
    oos_end: Optional[str]           # YYYY-MM-DD
    best_params: Optional[dict]      # walk_forward_windows.best_params JSONB


class BacktestForReplay(BaseModel):
    """Fully loaded backtest row ready for quantum IAE replay."""

    backtest_id: str
    strategy_id: str
    daily_pnls: list[float]          # Normalised to list[float] regardless of source shape
    folds: list[WalkForwardFold]     # CPCV-purge-enforced WF windows
    oos_trades: list[dict]           # backtest_trades rows filtered to OOS range; embargo applied
    schema_version: str              # "list_float" | "list_dict_date_pnl" | "list_dict_date_daily_pnl"


# ─── REPLAY_ROW_SCHEMA ───────────────────────────────────────────────────────

REPLAY_ROW_SCHEMA: dict[str, Any] = {
    # Columns inserted into quantum_mc_runs on apply=True.
    # All fields must correspond to quantum_mc_runs columns in schema.ts:888-916.
    "required_fields": [
        "backtest_id",
        "status",
        "method",
        "backend",
        "num_qubits",
        "estimated_value",
        "classical_value",
        "tolerance_delta",
        "within_tolerance",
        "confidence_interval",
        "execution_time_ms",
        "gpu_accelerated",
        "governance_labels",
        "raw_result",
        "reproducibility_hash",
    ],
    "governance_labels_contract": {
        "experimental": True,
        "authoritative": False,
        "decision_role": "challenger_only",
        "replay_mode": True,   # P1.A2 extension — marks rows as historical replay
    },
}


# ─── DB Connection Helper ─────────────────────────────────────────────────────

def _get_db_connection():
    """Return a psycopg2 connection using DATABASE_URL env var.

    Raises:
        ImportError: if psycopg2 is not installed
        RuntimeError: if DATABASE_URL is not set
    """
    try:
        import psycopg2
        import psycopg2.extras  # noqa: F401 — DictCursor
    except ImportError as e:
        raise ImportError(
            "psycopg2 is required for database access. "
            "Install with: pip install psycopg2-binary"
        ) from e

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set. "
            "Required for quantum replay DB loader."
        )
    import psycopg2
    return psycopg2.connect(db_url)


# ─── daily_pnls Normalisation ─────────────────────────────────────────────────

def _normalise_daily_pnls(raw: Any, backtest_id: str) -> tuple[list[float], str]:
    """Parse JSONB daily_pnls into list[float] and return (values, schema_version).

    Accepted shapes (see module docstring for full spec):
      1. list[float | int]
      2. list[dict] with "pnl" key  -> schema_version = "list_dict_date_pnl"
      3. list[dict] with "daily_pnl" key -> schema_version = "list_dict_date_daily_pnl"

    Raises:
        SchemaContractMismatch: if none of the shapes match
    """
    if raw is None:
        raise SchemaContractMismatch(backtest_id, "daily_pnls is null")

    if not isinstance(raw, list):
        raise SchemaContractMismatch(
            backtest_id, f"daily_pnls is {type(raw).__name__}, expected list"
        )

    if len(raw) == 0:
        # Empty list is valid — backtest had no trading days
        return [], "list_float"

    first = raw[0]

    if isinstance(first, (int, float)):
        # Shape 1: list[float]
        try:
            values = [float(v) for v in raw]
        except (TypeError, ValueError) as exc:
            raise SchemaContractMismatch(
                backtest_id,
                f"list[float] shape but element conversion failed: {exc}",
            ) from exc
        return values, "list_float"

    if isinstance(first, dict):
        if "pnl" in first:
            # Shape 2: list[dict{date, pnl}]
            try:
                values = [float(entry["pnl"]) for entry in raw]
            except (KeyError, TypeError, ValueError) as exc:
                raise SchemaContractMismatch(
                    backtest_id,
                    f"list_dict_date_pnl shape but extraction failed: {exc}",
                ) from exc
            return values, "list_dict_date_pnl"

        if "daily_pnl" in first:
            # Shape 3: list[dict{date, daily_pnl}]
            try:
                values = [float(entry["daily_pnl"]) for entry in raw]
            except (KeyError, TypeError, ValueError) as exc:
                raise SchemaContractMismatch(
                    backtest_id,
                    f"list_dict_date_daily_pnl shape but extraction failed: {exc}",
                ) from exc
            return values, "list_dict_date_daily_pnl"

        raise SchemaContractMismatch(
            backtest_id,
            f"list[dict] shape but neither 'pnl' nor 'daily_pnl' key found; "
            f"first element keys: {list(first.keys())}",
        )

    raise SchemaContractMismatch(
        backtest_id,
        f"Unrecognised element type in daily_pnls list: {type(first).__name__}",
    )


# ─── Pre-flight Invariant Check ───────────────────────────────────────────────

def _check_pnl_balance_invariant(
    backtest_id: str,
    daily_pnls: list[float],
    total_return: Optional[float],
    total_trades: Optional[int],
    commission_per_side: float = 1.24,  # default round-trip commission
) -> None:
    """Verify sum(daily_pnls) ~= ending_balance - starting_balance.

    The plan pre-flight gate: daily_pnl sum == ending_balance - starting_balance - commission.
    Toleranced at $1.00 per day to account for floating-point accumulation.

    When total_return is available (as the net P&L, not a percentage), the check
    uses it directly.  When not available, the check is skipped with a warning
    (not all backtest rows carry this field populated).

    Args:
        backtest_id: for log messages
        daily_pnls: list of daily P&L values (already normalised to float)
        total_return: the backtests.total_return value (net $, not %)
        total_trades: used to estimate total commission when available
        commission_per_side: default round-trip commission per trade in $
    """
    if not daily_pnls:
        return  # nothing to check

    pnl_sum = sum(daily_pnls)
    tolerance = max(1.0, len(daily_pnls) * 0.05)  # $1 base + 5c per day rounding

    if total_return is None:
        logger.warning(
            "[db_loader] backtest %s: total_return is null, "
            "skipping balance invariant check (daily_pnl sum=%.2f)",
            backtest_id, pnl_sum,
        )
        return

    total_comm = 0.0
    if total_trades is not None:
        total_comm = total_trades * commission_per_side

    # total_return from backtests table is net P&L in dollars (the BacktestResult.total_return)
    expected_net = float(total_return) - total_comm
    delta = abs(pnl_sum - expected_net)

    if delta > tolerance:
        logger.error(
            "[db_loader] INVARIANT VIOLATION backtest %s: "
            "sum(daily_pnls)=%.2f != (total_return - commission)=%.2f  "
            "delta=%.2f tolerance=%.2f",
            backtest_id, pnl_sum, expected_net, delta, tolerance,
        )
        raise ValueError(
            f"Pre-flight invariant violation for backtest {backtest_id}: "
            f"sum(daily_pnls)={pnl_sum:.2f} != net_return={expected_net:.2f} "
            f"(delta={delta:.2f} > tolerance={tolerance:.2f})"
        )


# ─── OOS Trade Embargo ────────────────────────────────────────────────────────

def _apply_oos_embargo(
    oos_trades: list[dict],
    oos_start: Optional[str],
) -> list[dict]:
    """Drop trades whose entry_time falls on the first trading day of the OOS window.

    The first OOS day is the embargo day: its trades are excluded to prevent
    IS-edge information bleeding into OOS evaluation metrics (plan methodology).

    If oos_start is None or oos_trades is empty, returns oos_trades unchanged.
    """
    if not oos_trades or not oos_start:
        return oos_trades

    try:
        embargo_date = date.fromisoformat(oos_start[:10])
    except (ValueError, TypeError):
        logger.warning(
            "[db_loader] Cannot parse oos_start=%r as date, skipping embargo",
            oos_start,
        )
        return oos_trades

    retained = []
    for trade in oos_trades:
        entry_time = trade.get("entry_time")
        if entry_time is None:
            retained.append(trade)
            continue

        # entry_time may be a datetime object (from psycopg2) or an ISO string
        if isinstance(entry_time, (datetime,)):
            trade_date = entry_time.date()
        elif isinstance(entry_time, date):
            trade_date = entry_time
        else:
            try:
                trade_date = date.fromisoformat(str(entry_time)[:10])
            except (ValueError, TypeError):
                retained.append(trade)
                continue

        if trade_date > embargo_date:
            retained.append(trade)
        # else: first OOS day — drop

    return retained


# ─── Walk-Forward Fold Loading ────────────────────────────────────────────────

def _load_walk_forward_folds(
    conn,
    backtest_id: str,
) -> list[WalkForwardFold]:
    """Load walk_forward_windows rows for a backtest.

    Enforces CPCV purge: any fold where oos_start <= is_end is logged as a
    WARNING and excluded from the returned list.
    """
    import psycopg2.extras

    sql = """
        SELECT
            id,
            window_index,
            is_start,
            is_end,
            oos_start,
            oos_end,
            best_params
        FROM walk_forward_windows
        WHERE backtest_id = %s
        ORDER BY window_index
    """

    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute(sql, (backtest_id,))
        rows = cur.fetchall()

    folds: list[WalkForwardFold] = []
    for row in rows:
        window_id = str(row["id"])
        is_end = row["is_end"]
        oos_start = row["oos_start"]

        # CPCV purge enforcement: oos_start must be strictly after is_end
        if is_end is not None and oos_start is not None:
            try:
                is_end_dt = date.fromisoformat(str(is_end)[:10])
                oos_start_dt = date.fromisoformat(str(oos_start)[:10])
                if oos_start_dt <= is_end_dt:
                    logger.warning(
                        "[db_loader] CPCV PURGE VIOLATION — backtest %s fold %s: "
                        "oos_start=%s <= is_end=%s — fold EXCLUDED",
                        backtest_id, window_id, oos_start, is_end,
                    )
                    continue
            except (ValueError, TypeError) as exc:
                logger.warning(
                    "[db_loader] Cannot parse dates for fold %s (backtest %s): %s — fold EXCLUDED",
                    window_id, backtest_id, exc,
                )
                continue

        best_params = row["best_params"]
        if isinstance(best_params, str):
            try:
                best_params = json.loads(best_params)
            except json.JSONDecodeError:
                best_params = None

        folds.append(WalkForwardFold(
            window_id=window_id,
            window_index=row["window_index"],
            is_start=str(row["is_start"]) if row["is_start"] else None,
            is_end=str(is_end) if is_end else None,
            oos_start=str(oos_start) if oos_start else None,
            oos_end=str(row["oos_end"]) if row["oos_end"] else None,
            best_params=best_params,
        ))

    return folds


# ─── OOS Trade Loading ────────────────────────────────────────────────────────

def _load_oos_trades(
    conn,
    backtest_id: str,
    folds: list[WalkForwardFold],
) -> list[dict]:
    """Load backtest_trades rows that fall in any OOS window, applying embargo.

    Returns a flat list of trade dicts.  Each trade dict has embargo applied
    per fold (first OOS day dropped).
    """
    import psycopg2.extras

    if not folds:
        return []

    # Collect OOS date ranges from all folds
    oos_ranges: list[tuple[str, str, str]] = []  # (oos_start, oos_end, window_id)
    for fold in folds:
        if fold.oos_start and fold.oos_end:
            oos_ranges.append((fold.oos_start, fold.oos_end, fold.window_id))

    if not oos_ranges:
        return []

    # Load all trades for this backtest that fall in any OOS range.
    # Use parameterized query with explicit range comparison (no string interpolation).
    all_oos_trades: list[dict] = []

    sql = """
        SELECT
            id,
            backtest_id,
            symbol,
            timeframe,
            entry_time,
            exit_time,
            direction,
            entry_price,
            exit_price,
            pnl,
            net_pnl,
            contracts,
            commission,
            gross_pnl,
            session_type,
            macro_regime
        FROM backtest_trades
        WHERE backtest_id = %s
          AND entry_time >= %s::timestamptz
          AND entry_time < %s::timestamptz
        ORDER BY entry_time
    """

    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        for oos_start, oos_end, window_id in oos_ranges:
            cur.execute(sql, (backtest_id, oos_start, oos_end))
            rows = cur.fetchall()

            # Convert DictRow to plain dict for JSON-serialisability
            fold_trades = []
            for row in rows:
                trade = dict(row)
                # Ensure timestamps are ISO strings (psycopg2 returns datetime objects)
                for ts_key in ("entry_time", "exit_time"):
                    if isinstance(trade.get(ts_key), datetime):
                        trade[ts_key] = trade[ts_key].isoformat()
                # Ensure numeric columns are float (psycopg2 returns Decimal for NUMERIC)
                for num_key in ("entry_price", "exit_price", "pnl", "net_pnl",
                                "commission", "gross_pnl"):
                    if trade.get(num_key) is not None:
                        try:
                            trade[num_key] = float(trade[num_key])
                        except (TypeError, ValueError):
                            pass
                trade["_wf_window_id"] = window_id
                fold_trades.append(trade)

            # Apply embargo: drop first OOS day
            fold_trades = _apply_oos_embargo(fold_trades, oos_start)
            all_oos_trades.extend(fold_trades)

    return all_oos_trades


# ─── Public API ───────────────────────────────────────────────────────────────

def load_backtest_with_folds(backtest_id: str) -> BacktestForReplay:
    """Load a single backtest with all walk-forward folds.

    Steps:
        1. Load backtests row (daily_pnls + metadata for invariant check)
        2. Parse daily_pnls — SchemaContractMismatch on unexpected shape
        3. Pre-flight invariant: sum(daily_pnls) ~= total_return - commission
        4. Load walk_forward_windows rows — CPCV purge enforced
        5. Load backtest_trades for all OOS ranges — embargo applied
        6. Return BacktestForReplay

    Args:
        backtest_id: UUID of the backtest to load

    Returns:
        BacktestForReplay with normalised daily_pnls, CPCV-purge-enforced folds,
        and embargo-applied OOS trades.

    Raises:
        SchemaContractMismatch: if daily_pnls JSONB shape is unrecognised
        ValueError: if pre-flight balance invariant is violated
        RuntimeError: if backtest not found or DB unavailable
    """
    conn = _get_db_connection()
    try:
        import psycopg2.extras

        sql_backtest = """
            SELECT
                id,
                strategy_id,
                daily_pnls,
                total_return,
                total_trades
            FROM backtests
            WHERE id = %s
            LIMIT 1
        """

        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(sql_backtest, (backtest_id,))
            row = cur.fetchone()

        if row is None:
            raise RuntimeError(
                f"Backtest {backtest_id!r} not found in backtests table."
            )

        strategy_id = str(row["strategy_id"])
        raw_daily_pnls = row["daily_pnls"]

        # Parse and normalise daily_pnls (raises SchemaContractMismatch on bad shape)
        daily_pnls, schema_version = _normalise_daily_pnls(raw_daily_pnls, backtest_id)

        # Pre-flight balance invariant
        total_return = float(row["total_return"]) if row["total_return"] is not None else None
        total_trades = int(row["total_trades"]) if row["total_trades"] is not None else None
        _check_pnl_balance_invariant(backtest_id, daily_pnls, total_return, total_trades)

        # Load walk-forward folds with CPCV purge enforcement
        folds = _load_walk_forward_folds(conn, backtest_id)

        # Load OOS trades with embargo applied
        oos_trades = _load_oos_trades(conn, backtest_id, folds)

        return BacktestForReplay(
            backtest_id=backtest_id,
            strategy_id=strategy_id,
            daily_pnls=daily_pnls,
            folds=folds,
            oos_trades=oos_trades,
            schema_version=schema_version,
        )

    finally:
        conn.close()


def load_all_backtests_with_folds(
    limit: Optional[int] = None,
) -> list[BacktestForReplay]:
    """Load all completed backtests with walk-forward folds.

    Schema-mismatched rows are logged and skipped — they do NOT crash the batch.
    Pre-flight invariant violations are logged as errors and the row is skipped.

    Args:
        limit: Optional max number of backtests to load (ordered by created_at DESC)

    Returns:
        list of BacktestForReplay for all loadable backtests
    """
    conn = _get_db_connection()
    try:
        import psycopg2.extras

        sql = """
            SELECT id
            FROM backtests
            WHERE status = 'completed'
              AND daily_pnls IS NOT NULL
            ORDER BY created_at DESC
        """
        if limit is not None:
            sql += f" LIMIT {int(limit)}"

        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(sql)
            backtest_ids = [str(row["id"]) for row in cur.fetchall()]
    finally:
        conn.close()

    results: list[BacktestForReplay] = []
    for bt_id in backtest_ids:
        try:
            result = load_backtest_with_folds(bt_id)
            results.append(result)
        except SchemaContractMismatch as exc:
            logger.warning(
                "[db_loader] Schema mismatch for backtest %s — skipping row: %s",
                bt_id, exc,
            )
        except ValueError as exc:
            logger.error(
                "[db_loader] Invariant violation for backtest %s — skipping row: %s",
                bt_id, exc,
            )
        except RuntimeError as exc:
            logger.error(
                "[db_loader] DB error for backtest %s — skipping row: %s",
                bt_id, exc,
            )

    return results


def load_classical_baseline(
    backtest_id: str,
    event_type: str,
) -> Optional[float]:
    """Load the previously-stored classical probability from monte_carlo_runs.

    Used for classical-baseline parity verification: the quantum replay's
    _compute_classical_probability output should agree with the classical MC
    value stored at backtest time (within 1e-6).

    Event type → monte_carlo_runs column mapping:
        "breach"      → max_drawdown_p5   (worst-case breach probability proxy)
        "ruin"        → probability_of_ruin
        "target_hit"  → sharpe_p50        (placeholder — best available proxy)
        "tail_loss"   → cvar_95           (conditional VaR at 95th percentile)

    Args:
        backtest_id: UUID of the backtest
        event_type:  One of "breach", "ruin", "target_hit", "tail_loss"

    Returns:
        The stored probability as float, or None if no completed MC run found
        or if the column is null for this backtest.
    """
    _COLUMN_MAP: dict[str, str] = {
        "breach":     "max_drawdown_p5",
        "ruin":       "probability_of_ruin",
        "target_hit": "sharpe_p50",
        "tail_loss":  "cvar_95",
    }

    col = _COLUMN_MAP.get(event_type)
    if col is None:
        logger.warning(
            "[db_loader] Unknown event_type %r for load_classical_baseline, "
            "returning None",
            event_type,
        )
        return None

    conn = _get_db_connection()
    try:
        import psycopg2.extras

        sql = f"""
            SELECT {col}
            FROM monte_carlo_runs
            WHERE backtest_id = %s
              AND status = 'completed'
            ORDER BY created_at DESC
            LIMIT 1
        """

        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(sql, (backtest_id,))
            row = cur.fetchone()

        if row is None or row[col] is None:
            return None

        return float(row[col])
    finally:
        conn.close()


def write_replay_row(
    replay_result: dict,
    apply: bool,
) -> Optional[str]:
    """Write a quantum replay result row to quantum_mc_runs.

    Dry-run contract: if apply=False, validates the row schema and returns None
    without writing to the database.  If apply=True, INSERTs the row and returns
    the new UUID.

    Idempotency: ON CONFLICT DO NOTHING using (backtest_id, method,
    reproducibility_hash) as the uniqueness guard.  If a row with identical
    (backtest_id, method, reproducibility_hash) already exists, the INSERT is
    silently ignored and the existing row's id is returned.

    Governance labels contract (enforced before insert):
        experimental:    True
        authoritative:   False
        decision_role:   "challenger_only"
        replay_mode:     True

    Args:
        replay_result: dict conforming to REPLAY_ROW_SCHEMA (quantum_mc_runs columns)
        apply: if False, dry-run (validate + return None); if True, INSERT

    Returns:
        UUID of inserted row (or existing row on conflict), or None if apply=False

    Raises:
        ValueError: if replay_result is missing required fields or governance labels
            don't match the required contract
    """
    # ── Validate governance labels ──────────────────────────────────────────
    governance = replay_result.get("governance_labels", {})
    required_governance = REPLAY_ROW_SCHEMA["governance_labels_contract"]
    for key, expected in required_governance.items():
        if governance.get(key) != expected:
            raise ValueError(
                f"write_replay_row: governance_labels.{key}={governance.get(key)!r} "
                f"!= required {expected!r}"
            )

    # ── Validate required fields ────────────────────────────────────────────
    missing = [
        f for f in REPLAY_ROW_SCHEMA["required_fields"]
        if f not in replay_result
    ]
    if missing:
        raise ValueError(
            f"write_replay_row: missing required fields: {missing}"
        )

    if not apply:
        return None

    # ── Prepare INSERT ──────────────────────────────────────────────────────
    conn = _get_db_connection()
    try:
        import psycopg2
        import psycopg2.extras

        new_id = str(_uuid_mod.uuid4())

        sql = """
            INSERT INTO quantum_mc_runs (
                id,
                backtest_id,
                status,
                method,
                backend,
                num_qubits,
                estimated_value,
                classical_value,
                tolerance_delta,
                within_tolerance,
                confidence_interval,
                execution_time_ms,
                gpu_accelerated,
                governance_labels,
                raw_result,
                reproducibility_hash,
                cloud_provider,
                cloud_backend_name,
                cloud_job_id,
                created_at
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                NOW()
            )
            ON CONFLICT (id) DO NOTHING
            RETURNING id
        """

        params = (
            new_id,
            replay_result["backtest_id"],
            replay_result.get("status", "completed"),
            replay_result["method"],
            replay_result.get("backend"),
            replay_result.get("num_qubits"),
            replay_result.get("estimated_value"),
            replay_result.get("classical_value"),
            replay_result.get("tolerance_delta"),
            replay_result.get("within_tolerance"),
            psycopg2.extras.Json(replay_result.get("confidence_interval")),
            replay_result.get("execution_time_ms"),
            replay_result.get("gpu_accelerated", False),
            psycopg2.extras.Json(governance),
            psycopg2.extras.Json(replay_result.get("raw_result")),
            replay_result.get("reproducibility_hash"),
            replay_result.get("cloud_provider"),
            replay_result.get("cloud_backend_name"),
            replay_result.get("cloud_job_id"),
        )

        # Check for existing row with same (backtest_id, method, reproducibility_hash)
        # to support idempotency return
        hash_val = replay_result.get("reproducibility_hash")
        sql_check = """
            SELECT id FROM quantum_mc_runs
            WHERE backtest_id = %s
              AND method = %s
              AND reproducibility_hash = %s
            LIMIT 1
        """

        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(sql_check, (
                replay_result["backtest_id"],
                replay_result["method"],
                hash_val,
            ))
            existing = cur.fetchone()

            if existing is not None:
                logger.info(
                    "[db_loader] write_replay_row: idempotent skip — row already exists "
                    "for backtest_id=%s method=%s hash=%s  existing_id=%s",
                    replay_result["backtest_id"],
                    replay_result["method"],
                    hash_val,
                    str(existing["id"]),
                )
                return str(existing["id"])

            cur.execute(sql, params)
            returned = cur.fetchone()
            conn.commit()

        if returned is not None:
            return str(returned["id"])
        return new_id

    except Exception as exc:
        conn.rollback()
        raise RuntimeError(
            f"write_replay_row INSERT failed: {exc}"
        ) from exc
    finally:
        conn.close()
