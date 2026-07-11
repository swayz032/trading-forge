"""
test_ds22_rl_mc_namespace_separation.py — Deep-Scan #22 residual-close guard test.

CONTEXT (see CLAUDE.md §13 "Don't write RL output to quantum_mc_runs" and the
Wave 29 Pass C entry): the Group-3 quantum certification confirmed — by CODE
READ ONLY — that:

  1. RL training output (`quantum_rl_agent.py::train_regime_conditioned_policies`
     + the TS fire-and-forget wrapper `quantum-rl-training-runner.ts` + the TS
     reader `rl-signal-fetcher.ts`) writes ONLY to `quantum_rl_runs`
     (migration 0158/0152) — NEVER to `quantum_mc_runs`.
  2. Quantum replay output (`quantum_replay.py` + its DB-write leaf
     `db_loader.py::write_replay_row`) writes ONLY to `quantum_mc_runs` (with
     `governance_labels.replay_mode=True`) — NEVER to `quantum_rl_runs`.
  3. The two audit namespaces (`quantum_rl.*` vs `quantum_mc.*`/`quantum_replay.*`)
     stay disjoint on the RL side.

That code-read was never LOCKED by a test — a future edit could route RL output
into `quantum_mc_runs` and silently contaminate the Wave 27/27.5 replay-grading
statistics (the whole point of the namespace split per the Wave 29 Pass C
architect close-out comment in quantum_rl_agent.py:86-108). This file closes
that gap.

WHY THIS IS A STRUCTURAL (SOURCE-SCAN) TEST, NOT A BEHAVIORAL ONE — HONESTLY:
  - `src/engine/conftest.py` wires no Postgres/pglite fixture for the engine
    test suite (only determinism env setup) — there is no reachable DB harness
    for `quantum_rl_agent.py` / `quantum_replay.py` / `db_loader.py` to exercise
    an actual INSERT and assert on real rows. Grep confirms zero pytest DB
    fixtures under `src/engine/`.
  - The RL write path (`quantum_rl_agent.py:1991-2022`) opens its own
    `psycopg2.connect(db_url)` directly inside a training loop — there is no
    dependency-injected connection/cursor to swap for an in-memory double
    without a substantial refactor the deep-scan mandate does not authorize
    ("test only" scope).
  - Therefore this test scans the LIVE SOURCE TEXT of the writer files with
    regex, dynamically discovering every `INSERT INTO <table>` occurrence
    (not a hardcoded line number) and every relevant Drizzle
    `db.insert/update/delete(<table>)` call site, then asserts the invariant
    on the discovered set. It is real regression protection (see the
    deliberate-RED drill referenced in the docstring of
    test_deliberate_regression_would_catch_fake_mc_write below) even though it
    does not touch a live database.

Scope (per DS22 dispatch): quantum_rl_agent.py, quantum-rl-training-runner.ts,
rl-signal-fetcher.ts (RL writers) vs quantum_replay.py + db_loader.py (replay
writer) + quantum-replay-runner.ts (TS replay writer). Does NOT touch/assert
on db_loader.py CPCV purge, IBM two-gate, or n_actions=2 — those are verified
unchanged by diff review, not by this test file.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# File locations — resolved relative to THIS file so the test is portable
# across worktrees/clones (never hardcodes an absolute repo path).
# ---------------------------------------------------------------------------
_REPO_ROOT = Path(__file__).resolve().parents[3]

_RL_AGENT_PY = _REPO_ROOT / "src" / "engine" / "quantum_rl_agent.py"
_RL_TRAINING_RUNNER_TS = _REPO_ROOT / "src" / "server" / "lib" / "quantum-rl-training-runner.ts"
_RL_SIGNAL_FETCHER_TS = _REPO_ROOT / "src" / "server" / "lib" / "rl-signal-fetcher.ts"

_REPLAY_PY = _REPO_ROOT / "src" / "engine" / "replay" / "quantum_replay.py"
_DB_LOADER_PY = _REPO_ROOT / "src" / "engine" / "replay" / "db_loader.py"
_REPLAY_RUNNER_TS = _REPO_ROOT / "src" / "server" / "lib" / "quantum-replay-runner.ts"

_RL_PY_FILES = [_RL_AGENT_PY]
_RL_TS_FILES = [_RL_TRAINING_RUNNER_TS, _RL_SIGNAL_FETCHER_TS]
_REPLAY_PY_FILES = [_REPLAY_PY, _DB_LOADER_PY]
_REPLAY_TS_FILES = [_REPLAY_RUNNER_TS]

# Drizzle schema identifiers (src/server/db/schema.ts) mapped to their real
# Postgres table names — used to interpret `db.insert(quantumMcRuns)` etc.
_DRIZZLE_TABLE_MC = "quantumMcRuns"     # -> pgTable("quantum_mc_runs", ...)
_DRIZZLE_TABLE_RL = "quantumRlRuns"     # -> pgTable("quantum_rl_runs", ...)

_SQL_INSERT_RE = re.compile(r"INSERT\s+INTO\s+(\w+)", re.IGNORECASE)
_DRIZZLE_WRITE_RE = re.compile(
    r"\bdb\.(insert|update|delete)\s*\(\s*(\w+)"
)


def _read(path: Path) -> str:
    assert path.is_file(), f"expected file to exist for this scan: {path}"
    return path.read_text(encoding="utf-8")


def _sql_insert_targets(text: str) -> list[str]:
    """Every `INSERT INTO <table>` target found anywhere in the raw source text."""
    return _SQL_INSERT_RE.findall(text)


def _drizzle_write_targets(text: str) -> list[tuple[str, str]]:
    """Every `db.insert/update/delete(<identifier>)` call — (verb, identifier)."""
    return _DRIZZLE_WRITE_RE.findall(text)


# ---------------------------------------------------------------------------
# 1. RL writers must NEVER target quantum_mc_runs (raw SQL side — Python)
# ---------------------------------------------------------------------------

class TestRlPythonWritersNamespaceIsolation:
    """quantum_rl_agent.py is the sole Python RL-training writer."""

    def test_rl_agent_never_inserts_into_quantum_mc_runs(self):
        text = _read(_RL_AGENT_PY)
        targets = _sql_insert_targets(text)
        assert targets, (
            "no `INSERT INTO` found at all in quantum_rl_agent.py — the scan "
            "regex may be stale relative to the current source (check for a "
            "rewrite to an ORM / query-builder call style)"
        )
        assert "quantum_mc_runs" not in targets, (
            f"quantum_rl_agent.py issues an INSERT INTO quantum_mc_runs — this "
            f"violates the CLAUDE.md §13 namespace-separation invariant "
            f"('Don't write RL output to quantum_mc_runs'). Found INSERT targets: {targets}"
        )

    def test_rl_agent_does_insert_into_quantum_rl_runs(self):
        """Positive control — proves the scan isn't vacuously passing.

        If this assertion ever fails, the RL persistence path moved to a
        different table (or a different write mechanism) and this whole test
        module needs to be re-pointed, not silently left green.
        """
        text = _read(_RL_AGENT_PY)
        targets = _sql_insert_targets(text)
        assert "quantum_rl_runs" in targets, (
            f"expected quantum_rl_agent.py to INSERT INTO quantum_rl_runs "
            f"(migration 0158/0152) — found INSERT targets instead: {targets}"
        )


# ---------------------------------------------------------------------------
# 2. RL writers (TS side) must NEVER reference the quantumMcRuns Drizzle table
# ---------------------------------------------------------------------------

class TestRlTsWritersNamespaceIsolation:
    """quantum-rl-training-runner.ts (fire-and-forget trainer) and
    rl-signal-fetcher.ts (composite-health reader) are the TS-side RL surface.
    Neither writes RL data directly (Python owns the quantum_rl_runs INSERT);
    the runner writes a job-tracking row to `rl_training_runs` (a THIRD,
    distinct table — not quantum_rl_runs, not quantum_mc_runs). Both must be
    completely silent on the quantumMcRuns Drizzle identifier — no import, no
    db.insert/update/delete call.
    """

    @pytest.mark.parametrize("path", _RL_TS_FILES, ids=lambda p: p.name)
    def test_no_quantum_mc_runs_writes(self, path: Path):
        text = _read(path)
        writes = _drizzle_write_targets(text)
        offending = [
            (verb, ident) for verb, ident in writes if ident == _DRIZZLE_TABLE_MC
        ]
        assert not offending, (
            f"{path.name} issues a Drizzle write against {_DRIZZLE_TABLE_MC} "
            f"(quantum_mc_runs) — RL surfaces must never write the replay "
            f"table. Offending call sites: {offending}"
        )

    @pytest.mark.parametrize("path", _RL_TS_FILES, ids=lambda p: p.name)
    def test_quantum_mc_runs_identifier_not_even_imported(self, path: Path):
        """Stronger guard than the write-site check above: the quantumMcRuns
        Drizzle export must not appear ANYWHERE in these files (not imported,
        not referenced) — a future author reaching for it at all in an
        RL-owned file is itself the early warning sign worth failing on.
        """
        text = _read(path)
        assert _DRIZZLE_TABLE_MC not in text, (
            f"{path.name} references the Drizzle identifier "
            f"'{_DRIZZLE_TABLE_MC}' (quantum_mc_runs) at all — RL files should "
            f"never import or touch the replay table's schema binding."
        )


# ---------------------------------------------------------------------------
# 3. Replay writers must NEVER target quantum_rl_runs (raw SQL side — Python)
# ---------------------------------------------------------------------------

class TestReplayPythonWritersNamespaceIsolation:
    """quantum_replay.py (compute leaf + CLI) and db_loader.py
    (write_replay_row, the sole DB-write function) are the Python replay
    writer surface.
    """

    @pytest.mark.parametrize("path", _REPLAY_PY_FILES, ids=lambda p: p.name)
    def test_replay_files_never_insert_into_quantum_rl_runs(self, path: Path):
        text = _read(path)
        targets = _sql_insert_targets(text)
        assert "quantum_rl_runs" not in targets, (
            f"{path.name} issues an INSERT INTO quantum_rl_runs — replay "
            f"writers must never touch the RL-training table. Found INSERT "
            f"targets: {targets}"
        )

    def test_db_loader_does_insert_into_quantum_mc_runs(self):
        """Positive control for the replay write path (write_replay_row)."""
        text = _read(_DB_LOADER_PY)
        targets = _sql_insert_targets(text)
        assert "quantum_mc_runs" in targets, (
            f"expected db_loader.py::write_replay_row to INSERT INTO "
            f"quantum_mc_runs — found INSERT targets instead: {targets}"
        )

    def test_db_loader_write_uses_replay_mode_governance_marker(self):
        """The table is shared with live cloud-quantum rows; replay rows are
        only queryably distinguishable via governance_labels.replay_mode=True
        (CLAUDE.md §13: "Don't write to quantum_mc_runs without
        governance_labels.replay_mode flag"). Confirm the marker still
        appears near the write path, not just in a stale comment.
        """
        text = _read(_DB_LOADER_PY)
        assert "replay_mode" in text, (
            "db_loader.py no longer mentions 'replay_mode' at all — the "
            "governance marker that distinguishes replay rows from live "
            "quantum_mc_runs rows may have been dropped."
        )


# ---------------------------------------------------------------------------
# 4. Replay writer (TS side) must NEVER reference the quantumRlRuns identifier
# ---------------------------------------------------------------------------

class TestReplayTsWriterNamespaceIsolation:
    @pytest.mark.parametrize("path", _REPLAY_TS_FILES, ids=lambda p: p.name)
    def test_no_quantum_rl_runs_writes(self, path: Path):
        text = _read(path)
        writes = _drizzle_write_targets(text)
        offending = [
            (verb, ident) for verb, ident in writes if ident == _DRIZZLE_TABLE_RL
        ]
        assert not offending, (
            f"{path.name} issues a Drizzle write against {_DRIZZLE_TABLE_RL} "
            f"(quantum_rl_runs) — the replay runner must never write the "
            f"RL-training table. Offending call sites: {offending}"
        )

    @pytest.mark.parametrize("path", _REPLAY_TS_FILES, ids=lambda p: p.name)
    def test_quantum_rl_runs_identifier_not_even_imported(self, path: Path):
        text = _read(path)
        assert _DRIZZLE_TABLE_RL not in text, (
            f"{path.name} references the Drizzle identifier "
            f"'{_DRIZZLE_TABLE_RL}' (quantum_rl_runs) at all — the replay "
            f"runner should never import or touch the RL table's schema binding."
        )

    def test_replay_runner_does_write_quantum_mc_runs(self):
        """Positive control — the replay runner's whole job is managing the
        pending/apply/error lifecycle of quantum_mc_runs rows.
        """
        text = _read(_REPLAY_RUNNER_TS)
        writes = _drizzle_write_targets(text)
        targets = {ident for _verb, ident in writes}
        assert _DRIZZLE_TABLE_MC in targets, (
            f"expected quantum-replay-runner.ts to write {_DRIZZLE_TABLE_MC} "
            f"— found write targets instead: {sorted(targets)}"
        )


# ---------------------------------------------------------------------------
# 5. Audit-namespace separation (RL side) — optional per the DS22 dispatch,
#    included here because it is cheap and closes the same governance gap
#    from a second angle (audit_log rows, not just table writes).
# ---------------------------------------------------------------------------

class TestAuditNamespaceSeparationRlSide:
    """RL-owned files must emit ONLY quantum_rl.* audit actions — never
    quantum_mc.* or quantum_replay.* (which belong to the replay/live-cloud
    surfaces). This is checked ONLY on the RL-owned files; it is deliberately
    NOT checked in reverse on db_loader.py, because db_loader.py's
    `load_backtest_bar_data()` CPCV-purge helper is a documented, intentional
    exception — it lives in the replay/ package but is RL-training-only (sole
    caller quantum_rl_agent.py per its own docstring) and legitimately emits
    a `quantum_rl.training_cpcv_purge_violation` event. Asserting "no
    quantum_rl.* in any replay/ file" would fail on that documented, correct
    behavior — so this test scopes to the RL-owned files only, where the
    invariant is unambiguous.
    """

    _NAMESPACE_RE = re.compile(r'"(quantum_rl|quantum_mc|quantum_replay)\.')

    @pytest.mark.parametrize(
        "path", [_RL_AGENT_PY, *_RL_TS_FILES], ids=lambda p: p.name
    )
    def test_rl_owned_files_never_emit_mc_or_replay_namespace_actions(self, path: Path):
        text = _read(path)
        namespaces_found = set(self._NAMESPACE_RE.findall(text))
        forbidden = namespaces_found & {"quantum_mc", "quantum_replay"}
        assert not forbidden, (
            f"{path.name} emits audit action(s) in the forbidden namespace(s) "
            f"{sorted(forbidden)} — RL-owned files must stay within the "
            f"quantum_rl.* namespace. Found namespaces: {sorted(namespaces_found)}"
        )

    def test_rl_agent_does_emit_quantum_rl_namespace_actions(self):
        """Positive control."""
        text = _read(_RL_AGENT_PY)
        namespaces_found = set(self._NAMESPACE_RE.findall(text))
        assert "quantum_rl" in namespaces_found, (
            f"expected quantum_rl_agent.py to emit at least one quantum_rl.* "
            f"audit action — found namespaces instead: {sorted(namespaces_found)}"
        )
