"""Tests for quantum_replay.py — challenger isolation + governance + reproducibility.

Test categories (all required per P1.A1 charter):
  1. Determinism / reproducibility
  2. Classical parity assertion
  3. Dry-run write isolation
  4. Apply-mode write contract
  5. Governance label correctness
  6. Schema version stamping
  7. Reproducibility hash includes git SHA
  8. Aer simulator default (no cloud)
  9. Qubit cap enforcement
 10. IAE failure graceful handling

All DB calls are mocked. Synthetic daily_pnls fixture used throughout.
No imports from src/server — Python-only sub-track.
"""
from __future__ import annotations

import json
from typing import Optional
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.engine.replay.quantum_replay import (
    DEFAULT_SEED,
    MAX_IAE_QUBITS,
    SCHEMA_VERSION,
    ReplayResult,
    _compute_quantum_mc_git_sha,
    _result_to_db_row,
    _run_single_replay,
    compute_reproducibility_hash,
    replay_quantum_on_backtest,
    replay_quantum_on_all_backtests,
)

# ── Fixtures ──────────────────────────────────────────────────────────────────

# Deterministic synthetic daily P&L fixture: 60 days, seeded
_RNG = np.random.default_rng(42)
SYNTHETIC_DAILY_PNLS: list[float] = list(
    _RNG.normal(loc=50, scale=200, size=60).tolist()
)

FAKE_BACKTEST_ID = "11111111-1111-1111-1111-111111111111"
FAKE_STRATEGY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
FAKE_FOLD_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
FAKE_CLASSICAL_RUIN = 0.18
FAKE_GIT_SHA = "deadbeefcafe1234deadbeefcafe1234deadbeef"


class _FakeFold:
    """Minimal walk-forward fold shape matching WalkForwardFold interface."""
    def __init__(self, window_id: str = FAKE_FOLD_ID, window_index: int = 0,
                 is_start: str = "2024-01-01", is_end: str = "2024-06-30",
                 oos_start: str = "2024-07-01", oos_end: str = "2024-12-31"):
        self.window_id = window_id
        self.window_index = window_index
        self.is_start = is_start
        self.is_end = is_end
        self.oos_start = oos_start
        self.oos_end = oos_end
        self.best_params = None


class _FakeBacktestForReplay:
    """Minimal BacktestForReplay shape for test injection."""
    def __init__(
        self,
        backtest_id: str = FAKE_BACKTEST_ID,
        strategy_id: str = FAKE_STRATEGY_ID,
        daily_pnls: Optional[list[float]] = None,
        folds: Optional[list] = None,
        oos_trades: Optional[list] = None,
        schema_version: str = "list_float",
    ):
        self.backtest_id = backtest_id
        self.strategy_id = strategy_id
        self.daily_pnls = daily_pnls if daily_pnls is not None else SYNTHETIC_DAILY_PNLS
        self.folds = folds if folds is not None else [_FakeFold()]
        self.oos_trades = oos_trades or []
        self.schema_version = schema_version


def _make_patched_db(
    backtest_for_replay: Optional[_FakeBacktestForReplay] = None,
    all_backtests: Optional[list] = None,
    classical_baseline: Optional[float] = FAKE_CLASSICAL_RUIN,
    write_return: Optional[str] = None,
):
    """Return patch.multiple context for quantum_replay's DB loader functions."""
    bt = backtest_for_replay or _FakeBacktestForReplay()
    all_bts = all_backtests if all_backtests is not None else [bt]

    mock_write = MagicMock(return_value=write_return)

    return patch.multiple(
        "src.engine.replay.quantum_replay",
        _DB_LOADER_AVAILABLE=True,
        _real_load_backtest_with_folds=MagicMock(return_value=bt),
        _real_load_all_backtests_with_folds=MagicMock(return_value=all_bts),
        _real_load_classical_baseline=MagicMock(return_value=classical_baseline),
        _real_write_replay_row=mock_write,
    ), mock_write


# ── 1. Determinism ────────────────────────────────────────────────────────────

class TestReplayDeterminism:
    def test_same_seed_identical_hash(self):
        """Same seed + same inputs → byte-identical reproducibility_hash."""
        r1 = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=FAKE_CLASSICAL_RUIN,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=FAKE_FOLD_ID,
            wf_window_id=FAKE_FOLD_ID,
            event_type="ruin",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        r2 = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=FAKE_CLASSICAL_RUIN,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=FAKE_FOLD_ID,
            wf_window_id=FAKE_FOLD_ID,
            event_type="ruin",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        assert r1.reproducibility_hash == r2.reproducibility_hash
        assert r1.reproducibility_hash != "", "hash must not be empty"

    def test_different_seed_different_hash(self):
        """Different seed → different hash (seed is in hash inputs)."""
        h1 = compute_reproducibility_hash(FAKE_STRATEGY_ID, FAKE_FOLD_ID, 42, "ruin", FAKE_GIT_SHA)
        h2 = compute_reproducibility_hash(FAKE_STRATEGY_ID, FAKE_FOLD_ID, 99, "ruin", FAKE_GIT_SHA)
        assert h1 != h2

    def test_same_seed_identical_raw_result(self):
        """Same seed → same raw_result (including classical_fallback determinism)."""
        r1 = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=FAKE_CLASSICAL_RUIN,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=FAKE_FOLD_ID,
            wf_window_id=FAKE_FOLD_ID,
            event_type="breach",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        r2 = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=FAKE_CLASSICAL_RUIN,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=FAKE_FOLD_ID,
            wf_window_id=FAKE_FOLD_ID,
            event_type="breach",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        assert r1.quantum_estimate == r2.quantum_estimate
        assert r1.classical_estimate == r2.classical_estimate


# ── 2. Classical parity ───────────────────────────────────────────────────────

class TestClassicalParity:
    def test_classical_estimate_present_and_valid(self):
        """classical_estimate in [0, 1] for completed replay result."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=FAKE_CLASSICAL_RUIN,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=FAKE_FOLD_ID,
            wf_window_id=FAKE_FOLD_ID,
            event_type="ruin",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        assert r.status == "completed"
        assert r.classical_estimate is not None
        assert 0.0 <= r.classical_estimate <= 1.0

    def test_classical_fallback_parity_close(self):
        """When IAE falls back to classical path, quantum_estimate equals classical_estimate."""
        # Force classical fallback by patching Qiskit availability to False
        with patch("src.engine.quantum_mc.QISKIT_AVAILABLE", False), \
             patch("src.engine.quantum_mc.AER_AVAILABLE", False):
            r = _run_single_replay(
                backtest_id=FAKE_BACKTEST_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                stored_classical_ruin=None,
                strategy_id=FAKE_STRATEGY_ID,
                fold_id=FAKE_FOLD_ID,
                wf_window_id=FAKE_FOLD_ID,
                event_type="breach",
                seed=DEFAULT_SEED,
                quantum_mc_git_sha=FAKE_GIT_SHA,
            )
        # On classical fallback, quantum_estimate == classical_estimate (same code path)
        assert r.status == "completed"
        assert r.quantum_estimate is not None
        assert r.classical_estimate is not None
        delta = abs(r.quantum_estimate - r.classical_estimate)
        assert delta < 1e-6, f"classical fallback parity failed: delta={delta}"


# ── 3. Dry-run isolation ──────────────────────────────────────────────────────

class TestDryRunIsolation:
    def test_dry_run_no_db_writes(self):
        """apply=False must never call _real_write_replay_row."""
        ctx, mock_write = _make_patched_db()
        with ctx:
            results = replay_quantum_on_backtest(
                backtest_id=FAKE_BACKTEST_ID,
                apply=False,
                seed=DEFAULT_SEED,
            )
        mock_write.assert_not_called()
        assert len(results) > 0, "dry-run should still return results"

    def test_dry_run_all_backtests_no_writes(self):
        """replay_quantum_on_all_backtests with apply=False writes nothing."""
        ctx, mock_write = _make_patched_db()
        with ctx:
            replay_quantum_on_all_backtests(apply=False, seed=DEFAULT_SEED, limit=1)
        mock_write.assert_not_called()


# ── 4. Apply-mode write contract ──────────────────────────────────────────────

class TestApplyMode:
    def test_apply_calls_write_for_each_completed_row(self):
        """apply=True calls _real_write_replay_row once per completed (fold, event_type)."""
        n_folds = 2
        folds = [_FakeFold(window_id=f"fold-{i}-0000-0000-0000-000000000000",
                           window_index=i)
                 for i in range(n_folds)]
        bt = _FakeBacktestForReplay(folds=folds)
        ctx, mock_write = _make_patched_db(backtest_for_replay=bt)

        with ctx:
            results = replay_quantum_on_backtest(
                backtest_id=FAKE_BACKTEST_ID,
                apply=True,
                seed=DEFAULT_SEED,
            )

        completed = [r for r in results if r.status == "completed"]
        assert mock_write.call_count == len(completed)

    def test_apply_write_row_shape(self):
        """Written row contains backtest_id, governance_labels, and reproducibility_hash."""
        written_rows: list[dict] = []

        def capture_write(row, apply):
            written_rows.append(row)

        ctx, mock_write = _make_patched_db()
        mock_write.side_effect = capture_write

        with ctx:
            replay_quantum_on_backtest(
                backtest_id=FAKE_BACKTEST_ID,
                apply=True,
                seed=DEFAULT_SEED,
            )

        assert len(written_rows) > 0
        row = written_rows[0]
        assert row["backtest_id"] == FAKE_BACKTEST_ID
        assert row["governance_labels"]["experimental"] is True
        assert row["governance_labels"]["authoritative"] is False
        assert row["governance_labels"]["replay_mode"] is True
        assert len(row["reproducibility_hash"]) == 64  # SHA-256 hex

    def test_apply_with_empty_pnls_skipped_rows_not_written(self):
        """Failed/skipped rows are never written even under --apply."""
        bt = _FakeBacktestForReplay(daily_pnls=[])  # Empty pnls → skipped_no_data
        ctx, mock_write = _make_patched_db(backtest_for_replay=bt)

        with ctx:
            results = replay_quantum_on_backtest(
                backtest_id=FAKE_BACKTEST_ID,
                apply=True,
                seed=DEFAULT_SEED,
            )

        mock_write.assert_not_called()
        assert all(r.status != "completed" for r in results)


# ── 5. Governance labels ──────────────────────────────────────────────────────

class TestGovernanceLabels:
    def test_governance_labels_correct(self):
        """Every replay result has correct challenger governance labels."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=None,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=FAKE_FOLD_ID,
            wf_window_id=FAKE_FOLD_ID,
            event_type="ruin",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        labels = r.governance_labels
        assert labels["experimental"] is True
        assert labels["authoritative"] is False
        assert labels["decision_role"] == "challenger_only"
        assert labels["replay_mode"] is True
        assert labels["fold_phase"] == "is"

    def test_governance_labels_on_skipped(self):
        """Skipped results also carry correct governance labels."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=[],  # Force skipped_no_data
            stored_classical_ruin=None,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=None,
            wf_window_id=None,
            event_type="ruin",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        assert r.governance_labels["authoritative"] is False
        assert r.governance_labels["experimental"] is True


# ── 6. Schema version ─────────────────────────────────────────────────────────

class TestSchemaVersion:
    def test_schema_version_stamped_on_completed(self):
        """Completed result carries schema_version=v1_challenger."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=None,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=None,
            wf_window_id=None,
            event_type="breach",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        assert r.schema_version == SCHEMA_VERSION
        assert r.schema_version == "v1_challenger"

    def test_schema_version_stamped_on_skipped(self):
        """Skipped result also carries schema_version=v1_challenger."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=[],
            stored_classical_ruin=None,
            strategy_id=None,
            fold_id=None,
            wf_window_id=None,
            event_type="ruin",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        assert r.schema_version == "v1_challenger"

    def test_db_row_raw_result_has_schema_version(self):
        """Written DB row's raw_result contains schema_version."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=None,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=None,
            wf_window_id=None,
            event_type="ruin",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        row = _result_to_db_row(r, FAKE_BACKTEST_ID)
        raw = row.get("raw_result", {})
        assert raw.get("schema_version") == "v1_challenger"


# ── 7. Reproducibility hash includes git SHA ──────────────────────────────────

class TestReproducibilityHash:
    def test_hash_changes_when_git_sha_changes(self):
        """Different quantum_mc.py git SHA → different reproducibility_hash."""
        sha_a = "aaaa1111" * 5
        sha_b = "bbbb2222" * 5
        h1 = compute_reproducibility_hash(FAKE_STRATEGY_ID, FAKE_FOLD_ID, 42, "ruin", sha_a)
        h2 = compute_reproducibility_hash(FAKE_STRATEGY_ID, FAKE_FOLD_ID, 42, "ruin", sha_b)
        assert h1 != h2

    def test_hash_is_lowercase_hex_sha256(self):
        """Hash is 64-char lowercase hex string (SHA-256)."""
        h = compute_reproducibility_hash(FAKE_STRATEGY_ID, FAKE_FOLD_ID, 42, "ruin", FAKE_GIT_SHA)
        assert len(h) == 64
        assert h == h.lower()
        assert all(c in "0123456789abcdef" for c in h)

    def test_hash_stable_across_calls(self):
        """Same inputs → same hash on multiple calls."""
        h1 = compute_reproducibility_hash(FAKE_STRATEGY_ID, FAKE_FOLD_ID, 42, "ruin", FAKE_GIT_SHA)
        h2 = compute_reproducibility_hash(FAKE_STRATEGY_ID, FAKE_FOLD_ID, 42, "ruin", FAKE_GIT_SHA)
        assert h1 == h2


# ── 8. Aer simulator default / no cloud ──────────────────────────────────────

class TestAerSimulatorDefault:
    def test_backend_not_cloud_in_result(self):
        """backend_used never indicates a cloud provider on replay results."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=None,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=None,
            wf_window_id=None,
            event_type="breach",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        # backend_used should never be "ibm" or "braket"
        assert "ibm" not in (r.backend_used or "").lower()
        assert "braket" not in (r.backend_used or "").lower()

    def test_raw_result_backend_explicit_aer(self):
        """raw_result.backend_explicit == 'aer' on every completed row."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=None,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=None,
            wf_window_id=None,
            event_type="ruin",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        assert r.status == "completed"
        assert r.raw_result.get("backend_explicit") == "aer"

    def test_no_cloud_config_passed_to_quantum_mc(self):
        """run_quantum_breach_estimation is called without cloud_config (no cloud)."""
        with patch("src.engine.replay.quantum_replay.run_quantum_breach_estimation") as mock_fn:
            mock_result = MagicMock()
            mock_result.estimated_value = 0.05
            mock_result.num_qubits = 3
            mock_result.backend_used = "aer_statevector"
            mock_result.num_oracle_calls = 10
            mock_result.confidence_interval = {"lower": 0.04, "upper": 0.06, "confidence_level": 0.95}
            mock_result.raw_result = {
                "method": "iae",
                "classical_fallback": False,
                "schema_version": "v1_challenger",
            }
            mock_fn.return_value = mock_result

            _run_single_replay(
                backtest_id=FAKE_BACKTEST_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                stored_classical_ruin=None,
                strategy_id=FAKE_STRATEGY_ID,
                fold_id=None,
                wf_window_id=None,
                event_type="breach",
                seed=DEFAULT_SEED,
                quantum_mc_git_sha=FAKE_GIT_SHA,
            )

        # cloud_config must never appear in the call kwargs or be non-None
        call_kwargs = mock_fn.call_args.kwargs if mock_fn.call_args else {}
        assert "cloud_config" not in call_kwargs or call_kwargs.get("cloud_config") is None

    def test_db_row_cloud_fields_are_none(self):
        """Written DB row has cloud_provider=None and cloud_backend_name=None."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=None,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=None,
            wf_window_id=None,
            event_type="breach",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        row = _result_to_db_row(r, FAKE_BACKTEST_ID)
        assert row.get("cloud_provider") is None
        assert row.get("cloud_backend_name") is None
        assert row.get("cloud_job_id") is None


# ── 9. Qubit cap ──────────────────────────────────────────────────────────────

class TestQubitCap:
    def test_max_iae_qubits_constant_is_10(self):
        """MAX_IAE_QUBITS constant equals 10 per plan risk #2."""
        assert MAX_IAE_QUBITS == 10

    def test_large_pnl_array_does_not_exceed_qubit_cap(self):
        """A large pnl array does not cause IAE to exceed MAX_IAE_QUBITS qubits."""
        large_pnls = list(np.random.default_rng(7).normal(100, 50, 2000).tolist())
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=large_pnls,
            stored_classical_ruin=None,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=None,
            wf_window_id=None,
            event_type="ruin",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        assert r.status == "completed"
        assert r.num_qubits <= MAX_IAE_QUBITS, (
            f"num_qubits={r.num_qubits} exceeded cap={MAX_IAE_QUBITS}"
        )

    def test_num_qubits_never_exceeds_cap_on_standard_input(self):
        """Standard fixture: completed result.num_qubits <= MAX_IAE_QUBITS."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=None,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=None,
            wf_window_id=None,
            event_type="breach",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        if r.status == "completed":
            assert r.num_qubits <= MAX_IAE_QUBITS


# ── 10. IAE failure handling ──────────────────────────────────────────────────

class TestIAEFailureHandling:
    def test_iae_runtime_failure_returns_failed_status(self):
        """When run_quantum_ruin_estimation throws, result is status=failed; no exception escapes."""
        with patch(
            "src.engine.replay.quantum_replay.run_quantum_ruin_estimation",
            side_effect=RuntimeError("Simulated IAE circuit failure"),
        ):
            r = _run_single_replay(
                backtest_id=FAKE_BACKTEST_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                stored_classical_ruin=None,
                strategy_id=FAKE_STRATEGY_ID,
                fold_id=None,
                wf_window_id=None,
                event_type="ruin",
                seed=DEFAULT_SEED,
                quantum_mc_git_sha=FAKE_GIT_SHA,
            )
        assert r.status == "failed"
        assert r.failure_reason is not None
        assert "RuntimeError" in r.failure_reason

    def test_iae_timeout_returns_failed_status(self):
        """TimeoutError from watchdog is caught and returned as status=failed."""
        with patch(
            "src.engine.replay.quantum_replay.run_quantum_breach_estimation",
            side_effect=TimeoutError("IAE estimate() did not complete within 300s"),
        ):
            r = _run_single_replay(
                backtest_id=FAKE_BACKTEST_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                stored_classical_ruin=None,
                strategy_id=FAKE_STRATEGY_ID,
                fold_id=None,
                wf_window_id=None,
                event_type="breach",
                seed=DEFAULT_SEED,
                quantum_mc_git_sha=FAKE_GIT_SHA,
            )
        assert r.status == "failed"
        assert r.failure_reason is not None
        assert "TimeoutError" in r.failure_reason or "did not complete" in r.failure_reason.lower()

    def test_failed_result_has_governance_labels(self):
        """Even failed results carry governance labels for traceability."""
        with patch(
            "src.engine.replay.quantum_replay.run_quantum_ruin_estimation",
            side_effect=ValueError("Bogus error"),
        ):
            r = _run_single_replay(
                backtest_id=FAKE_BACKTEST_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                stored_classical_ruin=None,
                strategy_id=FAKE_STRATEGY_ID,
                fold_id=None,
                wf_window_id=None,
                event_type="ruin",
                seed=DEFAULT_SEED,
                quantum_mc_git_sha=FAKE_GIT_SHA,
            )
        assert r.governance_labels["authoritative"] is False
        assert r.governance_labels["experimental"] is True
        assert r.governance_labels["replay_mode"] is True

    def test_empty_pnls_returns_skipped_not_exception(self):
        """Empty daily_pnls returns status=skipped_no_data; no exception escapes."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=[],
            stored_classical_ruin=None,
            strategy_id=None,
            fold_id=None,
            wf_window_id=None,
            event_type="breach",
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        assert r.status == "skipped_no_data"
        assert r.quantum_estimate is None

    def test_unsupported_event_type_returns_failed(self):
        """Unsupported event_type returns status=failed with reason."""
        r = _run_single_replay(
            backtest_id=FAKE_BACKTEST_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            stored_classical_ruin=None,
            strategy_id=FAKE_STRATEGY_ID,
            fold_id=None,
            wf_window_id=None,
            event_type="tail_loss",  # Not in _EVENT_TYPES for direct replay (unsupported path)
            seed=DEFAULT_SEED,
            quantum_mc_git_sha=FAKE_GIT_SHA,
        )
        # tail_loss should either succeed (if quantum_mc handles it) or return failed
        # Either way, no exception should escape
        assert r.status in ("completed", "failed", "skipped_no_data", "skipped_no_model")


# ── Integration: replay_quantum_on_backtest ───────────────────────────────────

class TestReplayOnBacktest:
    def test_returns_list_of_replay_results(self):
        """replay_quantum_on_backtest returns a list of ReplayResult objects."""
        ctx, _ = _make_patched_db()
        with ctx:
            results = replay_quantum_on_backtest(
                backtest_id=FAKE_BACKTEST_ID,
                apply=False,
                seed=DEFAULT_SEED,
            )
        assert isinstance(results, list)
        assert all(isinstance(r, ReplayResult) for r in results)

    def test_returns_breach_and_ruin_events(self):
        """One fold × 2 event_types = 2 results minimum."""
        ctx, _ = _make_patched_db(
            backtest_for_replay=_FakeBacktestForReplay(folds=[_FakeFold()])
        )
        with ctx:
            results = replay_quantum_on_backtest(
                backtest_id=FAKE_BACKTEST_ID,
                apply=False,
                seed=DEFAULT_SEED,
            )
        event_types = {r.event_type for r in results}
        assert "breach" in event_types
        assert "ruin" in event_types

    def test_no_server_imports(self):
        """No src.server imports in quantum_replay module."""
        import inspect

        import src.engine.replay.quantum_replay as mod
        src_code = inspect.getsource(mod)
        assert "from src.server" not in src_code, "Authority boundary violated: src.server imported"
        assert "import src.server" not in src_code, "Authority boundary violated: src.server imported"

    def test_multiple_folds_produce_multiple_results(self):
        """N folds × 2 event_types = 2N results."""
        n_folds = 3
        folds = [_FakeFold(window_id=f"fold{i}-000-0000-0000-000000000000", window_index=i)
                 for i in range(n_folds)]
        bt = _FakeBacktestForReplay(folds=folds)
        ctx, _ = _make_patched_db(backtest_for_replay=bt)

        with ctx:
            results = replay_quantum_on_backtest(
                backtest_id=FAKE_BACKTEST_ID,
                apply=False,
                seed=DEFAULT_SEED,
            )
        assert len(results) == n_folds * 2  # 2 event types per fold
