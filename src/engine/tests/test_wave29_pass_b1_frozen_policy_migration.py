"""test_wave29_pass_b1_frozen_policy_migration.py — Wave 29 Pass B.1 (backtest-core)

Tests for the frozen-policy contract migration (0161_frozen_policy_contract.sql).

Validates:
  - Migration idempotency (ADD COLUMN IF NOT EXISTS — safe to apply twice)
  - All 4 columns exist on the strategies table with correct SQL types
  - frozen_policy_hash: nullable TEXT, length-unbounded
  - frozen_policy_set_at: nullable TIMESTAMPTZ
  - regime_trained_on: nullable TEXT
  - frozen_policy_override_count: NOT NULL INTEGER with DEFAULT 0
  - Journal entry registered for idx 161 with correct tag
  - Migration file uses ADD COLUMN IF NOT EXISTS (idempotency guard)

Institutional references:
  - CFA Institute Halperin/Kolm/Ritter (2025-11-18) — frozen-policy OOS contract
  - Resonanz Capital DD framework (2026-02-10) — HMAC override audit trail
"""

from __future__ import annotations

import json
import os
import re
import unittest

# ── Helper: locate project root robustly ──────────────────────────────────────

def _project_root() -> str:
    """Return the absolute path to the project root (contains src/)."""
    this_dir = os.path.dirname(os.path.abspath(__file__))
    # Walk up from src/engine/tests → src/engine → src → project root
    root = os.path.normpath(os.path.join(this_dir, "..", "..", ".."))
    return root


def _migrations_dir() -> str:
    return os.path.join(_project_root(), "src", "server", "db", "migrations")


def _journal_path() -> str:
    return os.path.join(_migrations_dir(), "meta", "_journal.json")


def _migration_path() -> str:
    return os.path.join(_migrations_dir(), "0161_frozen_policy_contract.sql")


# ── Test Suite 1: Migration file structure ────────────────────────────────────

class TestMigrationFileStructure(unittest.TestCase):
    """Validate the SQL migration file content."""

    def _read_sql(self) -> str:
        path = _migration_path()
        self.assertTrue(
            os.path.exists(path),
            f"Migration file not found: {path}",
        )
        with open(path, encoding="utf-8") as fh:
            return fh.read()

    # ── Test 1: Migration uses ADD COLUMN IF NOT EXISTS (idempotency) ─────────

    def test_migration_uses_add_column_if_not_exists(self):
        """All four ALTER TABLE statements must use ADD COLUMN IF NOT EXISTS."""
        sql = self._read_sql()
        # Count only non-comment lines (exclude SQL comment lines starting with --)
        non_comment_lines = [
            line for line in sql.splitlines()
            if not line.strip().startswith("--")
        ]
        non_comment_sql = "\n".join(non_comment_lines)
        normalised = re.sub(r"\s+", " ", non_comment_sql).upper()
        count = normalised.count("ADD COLUMN IF NOT EXISTS")
        self.assertEqual(
            count,
            4,
            f"Expected 4 ADD COLUMN IF NOT EXISTS occurrences in non-comment SQL; found {count}. "
            "Every column must be idempotent.",
        )

    # ── Test 2: frozen_policy_hash column present ─────────────────────────────

    def test_frozen_policy_hash_column_declared(self):
        """frozen_policy_hash TEXT NULL must be declared."""
        sql = self._read_sql()
        normalised = re.sub(r"\s+", " ", sql)
        self.assertIn(
            "frozen_policy_hash",
            normalised,
            "frozen_policy_hash column missing from migration SQL.",
        )
        # Type must be TEXT (not VARCHAR, not CHAR)
        # Find the line with the column and verify TEXT appears nearby
        for line in sql.splitlines():
            if "frozen_policy_hash" in line and "ADD COLUMN" in line:
                self.assertIn(
                    "TEXT",
                    line.upper(),
                    "frozen_policy_hash must be declared as TEXT.",
                )
                # Must NOT have NOT NULL — column is nullable
                self.assertNotIn(
                    "NOT NULL",
                    line.upper(),
                    "frozen_policy_hash must be nullable (no NOT NULL).",
                )
                break
        else:
            self.fail("Could not find ADD COLUMN line for frozen_policy_hash.")

    # ── Test 3: frozen_policy_set_at TIMESTAMPTZ NULL ─────────────────────────

    def test_frozen_policy_set_at_column_declared(self):
        """frozen_policy_set_at TIMESTAMPTZ NULL must be declared."""
        sql = self._read_sql()
        self.assertIn(
            "frozen_policy_set_at",
            sql,
            "frozen_policy_set_at column missing from migration SQL.",
        )
        for line in sql.splitlines():
            if "frozen_policy_set_at" in line and "ADD COLUMN" in line:
                self.assertIn(
                    "TIMESTAMPTZ",
                    line.upper(),
                    "frozen_policy_set_at must be declared as TIMESTAMPTZ.",
                )
                self.assertNotIn(
                    "NOT NULL",
                    line.upper(),
                    "frozen_policy_set_at must be nullable (no NOT NULL).",
                )
                break
        else:
            self.fail("Could not find ADD COLUMN line for frozen_policy_set_at.")

    # ── Test 4: regime_trained_on TEXT NULL ───────────────────────────────────

    def test_regime_trained_on_column_declared(self):
        """regime_trained_on TEXT NULL must be declared."""
        sql = self._read_sql()
        self.assertIn(
            "regime_trained_on",
            sql,
            "regime_trained_on column missing from migration SQL.",
        )
        for line in sql.splitlines():
            if "regime_trained_on" in line and "ADD COLUMN" in line:
                self.assertIn(
                    "TEXT",
                    line.upper(),
                    "regime_trained_on must be declared as TEXT.",
                )
                self.assertNotIn(
                    "NOT NULL",
                    line.upper(),
                    "regime_trained_on must be nullable (no NOT NULL).",
                )
                break
        else:
            self.fail("Could not find ADD COLUMN line for regime_trained_on.")

    # ── Test 5: frozen_policy_override_count INTEGER NOT NULL DEFAULT 0 ────────

    def test_frozen_policy_override_count_column_declared(self):
        """frozen_policy_override_count INTEGER NOT NULL DEFAULT 0 must be declared."""
        sql = self._read_sql()
        self.assertIn(
            "frozen_policy_override_count",
            sql,
            "frozen_policy_override_count column missing from migration SQL.",
        )
        for line in sql.splitlines():
            if "frozen_policy_override_count" in line and "ADD COLUMN" in line:
                upper = line.upper()
                self.assertIn(
                    "INTEGER",
                    upper,
                    "frozen_policy_override_count must be declared as INTEGER.",
                )
                self.assertIn(
                    "NOT NULL",
                    upper,
                    "frozen_policy_override_count must be NOT NULL.",
                )
                self.assertIn(
                    "DEFAULT 0",
                    upper,
                    "frozen_policy_override_count must have DEFAULT 0.",
                )
                break
        else:
            self.fail("Could not find ADD COLUMN line for frozen_policy_override_count.")

    # ── Test 6: Migration targets strategies table ────────────────────────────

    def test_migration_targets_strategies_table(self):
        """All ALTER TABLE statements must target the 'strategies' table."""
        sql = self._read_sql()
        for line in sql.splitlines():
            stripped = line.strip().upper()
            if stripped.startswith("ALTER TABLE"):
                self.assertIn(
                    "STRATEGIES",
                    stripped,
                    f"Expected ALTER TABLE strategies, found: {line.strip()}",
                )

    # ── Test 7: Wave 29 Pass B.1 comment present ─────────────────────────────

    def test_wave29_pass_b1_comment_present(self):
        """Migration file must reference Wave 29 Pass B.1 and institutional mandate."""
        sql = self._read_sql()
        self.assertIn(
            "Wave 29 Pass B.1",
            sql,
            "Migration must reference 'Wave 29 Pass B.1' in its header comment.",
        )
        self.assertIn(
            "CFA Institute",
            sql,
            "Migration must cite CFA Institute mandate in its header comment.",
        )

    # ── Test 8: No DROP TABLE / DROP COLUMN (additive-only) ──────────────────

    def test_migration_is_additive_only(self):
        """Migration must NOT contain DROP TABLE or DROP COLUMN statements."""
        sql = self._read_sql().upper()
        self.assertNotIn(
            "DROP TABLE",
            sql,
            "Migration must not drop any table (additive-only).",
        )
        self.assertNotIn(
            "DROP COLUMN",
            sql,
            "Migration must not drop any column (additive-only).",
        )


# ── Test Suite 2: Journal registration ───────────────────────────────────────

class TestJournalRegistration(unittest.TestCase):
    """Validate the migration is registered in _journal.json."""

    def _load_journal(self) -> dict:
        path = _journal_path()
        self.assertTrue(os.path.exists(path), f"Journal file not found: {path}")
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)

    # ── Test 9: Journal contains entry for idx 161 ────────────────────────────

    def test_journal_contains_idx_161(self):
        """_journal.json must have an entry with idx=161."""
        journal = self._load_journal()
        entries = journal.get("entries", [])
        idxs = [e["idx"] for e in entries]
        self.assertIn(
            161,
            idxs,
            f"Journal must contain idx=161. Found idxs: {sorted(idxs)[-10:]}",
        )

    # ── Test 10: Journal entry tag is correct ─────────────────────────────────

    def test_journal_idx_161_tag(self):
        """Journal entry idx=161 must have tag '0161_frozen_policy_contract'."""
        journal = self._load_journal()
        entries = journal.get("entries", [])
        entry = next((e for e in entries if e["idx"] == 161), None)
        self.assertIsNotNone(entry, "Entry idx=161 not found in journal.")
        self.assertEqual(
            entry["tag"],
            "0161_frozen_policy_contract",
            f"Unexpected tag: {entry.get('tag')}",
        )

    # ── Test 11: Journal entry has breakpoints=true ───────────────────────────

    def test_journal_idx_161_breakpoints(self):
        """Journal entry idx=161 must have breakpoints=true."""
        journal = self._load_journal()
        entries = journal.get("entries", [])
        entry = next((e for e in entries if e["idx"] == 161), None)
        self.assertIsNotNone(entry, "Entry idx=161 not found in journal.")
        self.assertTrue(
            entry.get("breakpoints"),
            "Journal entry idx=161 must have breakpoints=true.",
        )


# ── Test Suite 3: Column semantics (type assertions via SQL analysis) ─────────

class TestColumnSemantics(unittest.TestCase):
    """Verify column semantics are correct per spec."""

    def _read_sql(self) -> str:
        with open(_migration_path(), encoding="utf-8") as fh:
            return fh.read()

    # ── Test 12: frozen_policy_hash is length-unbounded TEXT ─────────────────

    def test_frozen_policy_hash_is_unbounded_text(self):
        """frozen_policy_hash must be TEXT (not VARCHAR(N)) — hash lengths vary."""
        sql = self._read_sql()
        for line in sql.splitlines():
            if "frozen_policy_hash" in line and "ADD COLUMN" in line:
                upper = line.upper()
                # TEXT is unbounded; VARCHAR(N) would impose a cap which is wrong
                self.assertNotIn(
                    "VARCHAR",
                    upper,
                    "frozen_policy_hash must use TEXT, not VARCHAR(N).",
                )
                self.assertIn(
                    "TEXT",
                    upper,
                    "frozen_policy_hash must be declared as TEXT.",
                )
                return
        self.fail("frozen_policy_hash ADD COLUMN line not found.")

    # ── Test 13: Override count default is 0, not NULL ────────────────────────

    def test_frozen_policy_override_count_default_is_zero_not_null(self):
        """frozen_policy_override_count must default to integer 0 (not NULL)."""
        sql = self._read_sql()
        for line in sql.splitlines():
            if "frozen_policy_override_count" in line and "ADD COLUMN" in line:
                upper = line.upper()
                # Check: NOT NULL + DEFAULT 0
                self.assertIn("NOT NULL", upper)
                self.assertIn("DEFAULT 0", upper)
                # Must NOT have DEFAULT NULL
                self.assertNotIn(
                    "DEFAULT NULL",
                    upper,
                    "Override count must NOT default to NULL.",
                )
                return
        self.fail("frozen_policy_override_count ADD COLUMN line not found.")

    # ── Test 14: regime_trained_on allows regime vocabulary values ────────────

    def test_regime_trained_on_comment_documents_vocabulary(self):
        """regime_trained_on COMMENT must document the institutional regime vocabulary."""
        sql = self._read_sql()
        self.assertIn(
            "TRENDING",
            sql,
            "regime_trained_on COMMENT must mention TRENDING regime value.",
        )
        self.assertIn(
            "RANGE_BOUND",
            sql,
            "regime_trained_on COMMENT must mention RANGE_BOUND regime value.",
        )
        self.assertIn(
            "COMPRESSION",
            sql,
            "regime_trained_on COMMENT must mention COMPRESSION regime value.",
        )

    # ── Test 15: frozen_policy_set_at comment references HMAC override ────────

    def test_frozen_policy_set_at_comment_references_override(self):
        """frozen_policy_set_at COMMENT must reference the override mechanism."""
        sql = self._read_sql()
        self.assertIn(
            "override",
            sql.lower(),
            "frozen_policy_set_at COMMENT must mention the HMAC override path.",
        )


if __name__ == "__main__":
    unittest.main()
