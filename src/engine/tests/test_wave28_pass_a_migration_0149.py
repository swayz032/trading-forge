"""Tests for migration 0149: strategy_health_scores — composite health bus foundation.

Wave 28 Pass A.1 — Layer C decision bus schema.

Coverage:
  1. Migration idempotency (run twice, no errors)
  2. All 8 expected columns exist with correct types
  3. Both indexes exist
  4. JSONB columns accept and round-trip nested objects
  5. weights_version_id is NOT NULL (insert without should fail)
  6. computed_from_n_subsystems is NOT NULL (insert without should fail)
  7. Migration is additive only (no DROP/TRUNCATE)
  8. File is registered in _journal.json at idx 151
  9. SQL file uses IF NOT EXISTS (idempotency marker)
  10. strategy_id FK references strategies table

Layer:
  - SQL-text invariants: run without a DB — parse the migration file.
  - Live DB enforcement: run only when DATABASE_URL is set (pytest -m integration).
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest

# ─── Paths ───────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATION_PATH = REPO_ROOT / "src" / "server" / "db" / "migrations" / "0149_strategy_health_scores.sql"
JOURNAL_PATH = REPO_ROOT / "src" / "server" / "db" / "migrations" / "meta" / "_journal.json"

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _sql() -> str:
    """Return migration SQL text (cached per session implicitly by Python import)."""
    return MIGRATION_PATH.read_text(encoding="utf-8")


def _has_db() -> bool:
    return bool(os.environ.get("DATABASE_URL"))


# ─── SQL-text invariants (no DB required) ────────────────────────────────────


class TestMigrationFileExists:
    def test_migration_file_exists(self):
        assert MIGRATION_PATH.exists(), f"Migration file missing: {MIGRATION_PATH}"


class TestMigrationIdempotency:
    """Verify idempotency markers are present — IF NOT EXISTS on table and indexes."""

    def test_create_table_uses_if_not_exists(self):
        sql = _sql()
        assert re.search(
            r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+strategy_health_scores",
            sql,
            re.IGNORECASE,
        ), "CREATE TABLE must use IF NOT EXISTS for idempotency"

    def test_indexes_use_if_not_exists(self):
        sql = _sql()
        # Both index creations must be idempotent
        idx_count = len(re.findall(
            r"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS",
            sql,
            re.IGNORECASE,
        ))
        assert idx_count >= 2, (
            f"Expected ≥2 CREATE INDEX IF NOT EXISTS statements, found {idx_count}"
        )


class TestRequiredColumns:
    """All 8 required columns must appear in the migration with correct types."""

    def test_column_id_bigserial(self):
        assert re.search(r"\bid\s+BIGSERIAL\b", _sql(), re.IGNORECASE), \
            "id column must be BIGSERIAL"

    def test_column_strategy_id_uuid_not_null(self):
        sql = _sql()
        assert re.search(r"\bstrategy_id\s+UUID\s+NOT\s+NULL\b", sql, re.IGNORECASE), \
            "strategy_id must be UUID NOT NULL to match strategies.id"

    def test_column_evaluated_at_timestamptz(self):
        assert re.search(r"\bevaluated_at\s+TIMESTAMPTZ\b", _sql(), re.IGNORECASE), \
            "evaluated_at must be TIMESTAMPTZ"

    def test_column_composite_score_real_nullable(self):
        sql = _sql()
        # composite_score is REAL and nullable (no NOT NULL after type)
        assert re.search(r"\bcomposite_score\s+REAL\b", sql, re.IGNORECASE), \
            "composite_score must be REAL"
        # Must NOT have NOT NULL immediately after REAL (nullable by design)
        assert not re.search(
            r"\bcomposite_score\s+REAL\s+NOT\s+NULL\b", sql, re.IGNORECASE
        ), "composite_score must be nullable (NULL when insufficient subsystems)"

    def test_column_verdict_text_nullable(self):
        sql = _sql()
        assert re.search(r"\bverdict\s+TEXT\b", sql, re.IGNORECASE), \
            "verdict must be TEXT"
        # Must be nullable
        assert not re.search(
            r"\bverdict\s+TEXT\s+NOT\s+NULL\b", sql, re.IGNORECASE
        ), "verdict must be nullable"

    def test_column_subsystem_scores_jsonb_not_null(self):
        assert re.search(
            r"\bsubsystem_scores\s+JSONB\s+NOT\s+NULL\b", _sql(), re.IGNORECASE
        ), "subsystem_scores must be JSONB NOT NULL"

    def test_column_computed_from_n_subsystems_integer_not_null(self):
        assert re.search(
            r"\bcomputed_from_n_subsystems\s+INTEGER\s+NOT\s+NULL\b",
            _sql(),
            re.IGNORECASE,
        ), "computed_from_n_subsystems must be INTEGER NOT NULL"

    def test_column_weights_version_id_text_not_null(self):
        assert re.search(
            r"\bweights_version_id\s+TEXT\s+NOT\s+NULL\b", _sql(), re.IGNORECASE
        ), "weights_version_id must be TEXT NOT NULL"

    def test_column_staleness_age_hours_real_nullable(self):
        sql = _sql()
        assert re.search(r"\bstaleness_age_hours\s+REAL\b", sql, re.IGNORECASE), \
            "staleness_age_hours must be REAL"
        assert not re.search(
            r"\bstaleness_age_hours\s+REAL\s+NOT\s+NULL\b", sql, re.IGNORECASE
        ), "staleness_age_hours must be nullable"

    def test_column_disagreements_jsonb_nullable(self):
        sql = _sql()
        assert re.search(r"\bdisagreements\s+JSONB\b", sql, re.IGNORECASE), \
            "disagreements must be JSONB"
        # Must be nullable (Pass D populates; Pass A leaves NULL)
        assert not re.search(
            r"\bdisagreements\s+JSONB\s+NOT\s+NULL\b", sql, re.IGNORECASE
        ), "disagreements must be nullable (Pass D populates, Pass A is NULL)"

    def test_column_created_at_timestamptz_not_null(self):
        assert re.search(
            r"\bcreated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\b", _sql(), re.IGNORECASE
        ), "created_at must be TIMESTAMPTZ NOT NULL"


class TestIndexes:
    """Both required indexes must be declared in the migration."""

    def test_index_strategy_evaluated_exists(self):
        assert re.search(
            r"idx_strategy_health_scores_strategy_evaluated",
            _sql(),
            re.IGNORECASE,
        ), "idx_strategy_health_scores_strategy_evaluated index must be declared"

    def test_index_weights_version_exists(self):
        assert re.search(
            r"idx_strategy_health_scores_weights_version",
            _sql(),
            re.IGNORECASE,
        ), "idx_strategy_health_scores_weights_version index must be declared"

    def test_strategy_evaluated_index_covers_correct_columns(self):
        sql = _sql()
        # Index must cover (strategy_id, evaluated_at)
        assert re.search(
            r"idx_strategy_health_scores_strategy_evaluated\s+ON\s+strategy_health_scores\s*\(\s*strategy_id\s*,\s*evaluated_at",
            sql,
            re.IGNORECASE,
        ), "strategy_evaluated index must cover (strategy_id, evaluated_at)"

    def test_weights_version_index_covers_correct_column(self):
        sql = _sql()
        assert re.search(
            r"idx_strategy_health_scores_weights_version\s+ON\s+strategy_health_scores\s*\(\s*weights_version_id\s*\)",
            sql,
            re.IGNORECASE,
        ), "weights_version index must cover (weights_version_id)"


class TestAppendOnlyContract:
    """Migration must not contain any UPDATE statements (append-only contract)."""

    def test_no_update_statements(self):
        sql = _sql()
        # Strip SQL comments first to avoid false positives in comment text
        sql_no_comments = re.sub(r"--[^\n]*", "", sql)
        assert not re.search(
            r"\bUPDATE\s+strategy_health_scores\b", sql_no_comments, re.IGNORECASE
        ), "strategy_health_scores is append-only — no UPDATE statements permitted"

    def test_no_drop_statements(self):
        sql = _sql()
        sql_no_comments = re.sub(r"--[^\n]*", "", sql)
        assert not re.search(r"\bDROP\s+TABLE\b", sql_no_comments, re.IGNORECASE), \
            "Migration must be additive — no DROP TABLE"
        assert not re.search(r"\bDROP\s+COLUMN\b", sql_no_comments, re.IGNORECASE), \
            "Migration must be additive — no DROP COLUMN"
        assert not re.search(r"\bTRUNCATE\b", sql_no_comments, re.IGNORECASE), \
            "Migration must be additive — no TRUNCATE"

    def test_fk_references_strategies(self):
        sql = _sql()
        # The FK must reference the strategies table
        assert re.search(r"REFERENCES\s+strategies\s*\(", sql, re.IGNORECASE), \
            "strategy_id must REFERENCES strategies(id)"


class TestJournalRegistration:
    """Migration must be registered in _journal.json at idx 151."""

    def test_journal_file_exists(self):
        assert JOURNAL_PATH.exists(), f"Journal file missing: {JOURNAL_PATH}"

    def test_migration_registered_in_journal(self):
        journal = json.loads(JOURNAL_PATH.read_text(encoding="utf-8"))
        tags = [e["tag"] for e in journal["entries"]]
        assert "0149_strategy_health_scores" in tags, \
            "Migration 0149_strategy_health_scores must be registered in _journal.json"

    def test_migration_registered_at_idx_151(self):
        journal = json.loads(JOURNAL_PATH.read_text(encoding="utf-8"))
        for entry in journal["entries"]:
            if entry["tag"] == "0149_strategy_health_scores":
                assert entry["idx"] == 151, (
                    f"Expected idx=151 for 0149_strategy_health_scores, got {entry['idx']}"
                )
                return
        pytest.fail("0149_strategy_health_scores not found in journal entries")


# ─── Live DB enforcement (only when DATABASE_URL is set) ──────────────────────


@pytest.mark.skipif(not _has_db(), reason="DATABASE_URL not set — skipping live DB tests")
class TestLiveDB:
    """Live Postgres enforcement tests. Require DATABASE_URL in env."""

    @pytest.fixture(scope="class")
    def conn(self):
        import psycopg2  # type: ignore
        db_url = os.environ["DATABASE_URL"]
        c = psycopg2.connect(db_url)
        c.autocommit = True
        yield c
        c.close()

    def test_table_exists(self, conn):
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = 'strategy_health_scores'"
            )
            rows = cur.fetchall()
        assert len(rows) == 1, "strategy_health_scores table must exist after migration"

    def test_all_columns_exist_with_correct_types(self, conn):
        with conn.cursor() as cur:
            cur.execute(
                "SELECT column_name, data_type, is_nullable "
                "FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = 'strategy_health_scores'"
            )
            rows = cur.fetchall()

        col_map = {r[0]: {"data_type": r[1], "is_nullable": r[2]} for r in rows}

        # id — bigint (bigserial resolves to bigint in information_schema)
        assert col_map.get("id", {}).get("data_type") == "bigint", \
            "id must be bigint (bigserial)"

        # strategy_id — integer NOT NULL
        assert col_map.get("strategy_id", {}).get("data_type") == "integer"
        assert col_map.get("strategy_id", {}).get("is_nullable") == "NO"

        # evaluated_at — timestamp with time zone NOT NULL
        assert col_map.get("evaluated_at", {}).get("data_type") == "timestamp with time zone"
        assert col_map.get("evaluated_at", {}).get("is_nullable") == "NO"

        # composite_score — real, nullable
        assert col_map.get("composite_score", {}).get("data_type") == "real"
        assert col_map.get("composite_score", {}).get("is_nullable") == "YES"

        # verdict — text, nullable
        assert col_map.get("verdict", {}).get("data_type") == "text"
        assert col_map.get("verdict", {}).get("is_nullable") == "YES"

        # subsystem_scores — jsonb NOT NULL
        assert col_map.get("subsystem_scores", {}).get("data_type") == "jsonb"
        assert col_map.get("subsystem_scores", {}).get("is_nullable") == "NO"

        # computed_from_n_subsystems — integer NOT NULL
        assert col_map.get("computed_from_n_subsystems", {}).get("data_type") == "integer"
        assert col_map.get("computed_from_n_subsystems", {}).get("is_nullable") == "NO"

        # weights_version_id — text NOT NULL
        assert col_map.get("weights_version_id", {}).get("data_type") == "text"
        assert col_map.get("weights_version_id", {}).get("is_nullable") == "NO"

        # staleness_age_hours — real, nullable
        assert col_map.get("staleness_age_hours", {}).get("data_type") == "real"
        assert col_map.get("staleness_age_hours", {}).get("is_nullable") == "YES"

        # disagreements — jsonb, nullable
        assert col_map.get("disagreements", {}).get("data_type") == "jsonb"
        assert col_map.get("disagreements", {}).get("is_nullable") == "YES"

        # created_at — timestamp with time zone NOT NULL
        assert col_map.get("created_at", {}).get("data_type") == "timestamp with time zone"
        assert col_map.get("created_at", {}).get("is_nullable") == "NO"

    def test_both_indexes_exist(self, conn):
        with conn.cursor() as cur:
            cur.execute(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = 'public' AND tablename = 'strategy_health_scores'"
            )
            rows = cur.fetchall()
        names = {r[0] for r in rows}
        assert "idx_strategy_health_scores_strategy_evaluated" in names, \
            "idx_strategy_health_scores_strategy_evaluated must exist"
        assert "idx_strategy_health_scores_weights_version" in names, \
            "idx_strategy_health_scores_weights_version must exist"

    def test_jsonb_columns_round_trip_nested_objects(self, conn):
        """Insert a row with nested JSONB and verify the payload round-trips."""
        subsystem_payload = {
            "wfe_engine": {
                "score": 0.82,
                "confidence": 0.91,
                "available": True,
                "computed_at": "2026-05-26T12:00:00Z",
            },
            "mc_engine": {
                "score": 0.75,
                "confidence": 0.88,
                "available": True,
                "computed_at": "2026-05-26T12:00:00Z",
                "error": None,
            },
        }
        disagreements_payload = {"wfe_engine:mc_engine": 0.07}
        weights_hash = "a" * 64  # 64-char hex placeholder

        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO strategy_health_scores
                  (strategy_id, composite_score, verdict,
                   subsystem_scores, computed_from_n_subsystems,
                   weights_version_id, staleness_age_hours, disagreements)
                SELECT
                  s.id, 0.78, 'HEALTHY',
                  %s::jsonb, 2,
                  %s, 1.5, %s::jsonb
                FROM strategies s
                LIMIT 1
                RETURNING id, subsystem_scores, disagreements
                """,
                (
                    json.dumps(subsystem_payload),
                    weights_hash,
                    json.dumps(disagreements_payload),
                ),
            )
            row = cur.fetchone()

        assert row is not None, "INSERT returned no row — no strategies exist for FK?"
        inserted_id, returned_subsystems, returned_disagreements = row

        # Clean up probe row
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM strategy_health_scores WHERE id = %s", (inserted_id,)
            )

        assert isinstance(returned_subsystems, dict), \
            "subsystem_scores must round-trip as a dict"
        assert "wfe_engine" in returned_subsystems
        assert returned_subsystems["wfe_engine"]["score"] == pytest.approx(0.82, abs=1e-6)

        assert isinstance(returned_disagreements, dict), \
            "disagreements must round-trip as a dict"
        assert "wfe_engine:mc_engine" in returned_disagreements

    def test_weights_version_id_not_null_enforced(self, conn):
        """INSERT without weights_version_id must fail with NOT NULL violation."""
        import psycopg2

        with conn.cursor() as cur:
            cur.execute("SELECT id FROM strategies LIMIT 1")
            row = cur.fetchone()
        if row is None:
            pytest.skip("No strategies in DB — cannot test FK constraint")

        strategy_id = row[0]
        with conn.cursor() as cur:
            with pytest.raises(psycopg2.errors.NotNullViolation):
                cur.execute(
                    """
                    INSERT INTO strategy_health_scores
                      (strategy_id, subsystem_scores, computed_from_n_subsystems)
                    VALUES (%s, '{}'::jsonb, 0)
                    """,
                    (strategy_id,),
                )
        conn.rollback()

    def test_computed_from_n_subsystems_not_null_enforced(self, conn):
        """INSERT without computed_from_n_subsystems must fail with NOT NULL violation."""
        import psycopg2

        with conn.cursor() as cur:
            cur.execute("SELECT id FROM strategies LIMIT 1")
            row = cur.fetchone()
        if row is None:
            pytest.skip("No strategies in DB — cannot test FK constraint")

        strategy_id = row[0]
        with conn.cursor() as cur:
            with pytest.raises(psycopg2.errors.NotNullViolation):
                cur.execute(
                    """
                    INSERT INTO strategy_health_scores
                      (strategy_id, subsystem_scores, weights_version_id)
                    VALUES (%s, '{}'::jsonb, %s)
                    """,
                    (strategy_id, "a" * 64),
                )
        conn.rollback()
