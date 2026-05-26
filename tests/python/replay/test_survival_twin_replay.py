"""Tests for src/engine/replay/survival_twin_replay.py

Wave 27 Pass 4 — B14 Survival Twin replay harness.

Test categories (all required per Pass 4 charter):
  1. Determinism / reproducibility
  2. Classical vs survival-twin cross-method disagreement computed
  3. Unknown firm skipped gracefully
  4. Empty / short pnls skipped gracefully
  5. Governance label correctness
  6. Dry-run: no DB write
  7. Apply: write_replay_row called once per (backtest, firm)
  8. IAE / Qiskit NOT imported (B14 is classical-only)
  9. Seed determinism across runs
  10. Per-firm independence
  11. Grade emission (A-F)
  12. AER simulator not used

All DB calls are mocked.  Synthetic daily_pnls used throughout.
No imports from src/server (Python-only sub-track).

Authority boundaries verified in tests:
  - governance_labels.authoritative = False
  - governance_labels.decision_role = "challenger_only"
  - governance_labels.survival_twin = True
  - governance_labels.replay_mode = True
"""
from __future__ import annotations

import hashlib
import json
import sys
import types
from typing import Optional
from unittest.mock import MagicMock, call, patch

import numpy as np
import pytest

# ── direct sub-module imports mirror production pattern ───────────────────────
from src.engine.replay.survival_twin_replay import (
    ACCOUNT_TYPE,
    METHOD,
    NUM_MC_SIMS,
    SCHEMA_VERSION,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_PARTIAL_DATA,
    STATUS_SKIPPED_NO_PNLS,
    STATUS_SKIPPED_UNKNOWN_FIRM,
    SUPPORTED_FIRMS,
    SurvivalReplayResult,
    _compute_disagreement,
    _get_survival_scorer_git_sha,
    _result_to_db_row,
    _run_single_survival_replay,
    compute_reproducibility_hash,
    replay_survival_on_all_backtests,
    replay_survival_on_backtest,
)

# ── Fixtures ──────────────────────────────────────────────────────────────────

_RNG = np.random.default_rng(42)
SYNTHETIC_DAILY_PNLS: list[float] = list(
    _RNG.normal(loc=50.0, scale=180.0, size=60).tolist()
)

FAKE_BACKTEST_ID = "22222222-2222-2222-2222-222222222222"
FAKE_STRATEGY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"
FAKE_GIT_SHA = "abcdef0123456789abcdef0123456789abcdef01"


class _FakeBacktestForReplay:
    def __init__(
        self,
        backtest_id: str = FAKE_BACKTEST_ID,
        strategy_id: str = FAKE_STRATEGY_ID,
        daily_pnls: Optional[list[float]] = None,
        folds=None,
        oos_trades=None,
        schema_version: str = "list_float",
    ):
        self.backtest_id = backtest_id
        self.strategy_id = strategy_id
        self.daily_pnls = daily_pnls if daily_pnls is not None else SYNTHETIC_DAILY_PNLS[:]
        self.folds = folds or []
        self.oos_trades = oos_trades or []
        self.schema_version = schema_version


# ─── 1. test_replay_determinism ───────────────────────────────────────────────

class TestReplayDeterminism:
    """same backtest_id → identical reproducibility_hash + identical 7 metrics."""

    def test_same_inputs_produce_same_hash(self):
        """Reproducibility hash is deterministic for identical inputs."""
        h1 = compute_reproducibility_hash(
            FAKE_STRATEGY_ID, FAKE_BACKTEST_ID, "Topstep", "50K", FAKE_GIT_SHA,
        )
        h2 = compute_reproducibility_hash(
            FAKE_STRATEGY_ID, FAKE_BACKTEST_ID, "Topstep", "50K", FAKE_GIT_SHA,
        )
        assert h1 == h2
        assert len(h1) == 64  # SHA-256 hex

    def test_hash_changes_when_firm_changes(self):
        h_topstep = compute_reproducibility_hash(
            FAKE_STRATEGY_ID, FAKE_BACKTEST_ID, "Topstep", "50K", FAKE_GIT_SHA,
        )
        h_mffu = compute_reproducibility_hash(
            FAKE_STRATEGY_ID, FAKE_BACKTEST_ID, "MFFU", "50K", FAKE_GIT_SHA,
        )
        assert h_topstep != h_mffu

    def test_hash_changes_when_scorer_sha_changes(self):
        h1 = compute_reproducibility_hash(
            FAKE_STRATEGY_ID, FAKE_BACKTEST_ID, "Topstep", "50K", "sha_v1",
        )
        h2 = compute_reproducibility_hash(
            FAKE_STRATEGY_ID, FAKE_BACKTEST_ID, "Topstep", "50K", "sha_v2",
        )
        assert h1 != h2


# ─── 2. test_classical_vs_survival_twin_disagreement_computed ─────────────────

class TestCrossMethodDisagreementComputed:
    """When Pass A ruin_CI and survival_twin are both available, disagreement is computed."""

    def test_disagreement_is_abs_difference(self):
        breach_prob = 0.30
        pass_a_ci_high = 0.45
        d = _compute_disagreement(breach_prob, pass_a_ci_high)
        assert d is not None
        assert abs(d - abs(breach_prob - pass_a_ci_high)) < 1e-9

    def test_disagreement_none_when_pass_a_unavailable(self):
        d = _compute_disagreement(0.30, None)
        assert d is None

    def test_disagreement_zero_when_both_equal(self):
        d = _compute_disagreement(0.25, 0.25)
        assert d is not None
        assert d == pytest.approx(0.0, abs=1e-9)

    def test_full_result_has_disagreement_when_pass_a_available(self):
        """End-to-end: when Pass A returns ci_high, result.cross_method_disagreement is set."""
        fake_pass_a_ci_high = 0.38

        with (
            patch(
                "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
                return_value=fake_pass_a_ci_high,
            ),
            patch(
                "src.engine.replay.survival_twin_replay._get_survival_scorer_git_sha",
                return_value=FAKE_GIT_SHA,
            ),
        ):
            result = _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="Topstep",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )

        assert result.pass_a_ruin_ci_high == fake_pass_a_ci_high
        assert result.cross_method_disagreement is not None

    def test_full_result_has_no_disagreement_when_pass_a_missing(self):
        with (
            patch(
                "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
                return_value=None,
            ),
            patch(
                "src.engine.replay.survival_twin_replay._get_survival_scorer_git_sha",
                return_value=FAKE_GIT_SHA,
            ),
        ):
            result = _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="Topstep",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )

        assert result.cross_method_disagreement is None


# ─── 3. test_unknown_firm_skipped_gracefully ─────────────────────────────────

class TestUnknownFirmSkippedGracefully:
    """firm='UnknownFirm' → status='skipped_unknown_firm', no exception raised."""

    def test_unknown_firm_returns_skipped_status(self):
        result = _run_single_survival_replay(
            backtest_id=FAKE_BACKTEST_ID,
            strategy_id=FAKE_STRATEGY_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            firm="UnknownFirm",
            account_type="50K",
            scorer_git_sha=FAKE_GIT_SHA,
        )
        assert result.status == STATUS_SKIPPED_UNKNOWN_FIRM
        assert result.failure_reason is not None
        assert "UnknownFirm" in result.failure_reason

    def test_unknown_firm_no_exception(self):
        """Must NOT raise — returns graceful skipped result."""
        try:
            _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="GhostFirm",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )
        except Exception as exc:
            pytest.fail(f"Should not raise on unknown firm, got: {exc}")

    def test_unknown_account_type_returns_skipped(self):
        result = _run_single_survival_replay(
            backtest_id=FAKE_BACKTEST_ID,
            strategy_id=FAKE_STRATEGY_ID,
            daily_pnls=SYNTHETIC_DAILY_PNLS,
            firm="Topstep",
            account_type="99K",  # Not in firm_profiles
            scorer_git_sha=FAKE_GIT_SHA,
        )
        assert result.status == STATUS_SKIPPED_UNKNOWN_FIRM


# ─── 4. test_empty_pnls_skipped ──────────────────────────────────────────────

class TestEmptyPnlsSkipped:
    """backtest with daily_pnls=[] → status='skipped_no_pnls'."""

    def test_empty_list_skipped(self):
        result = _run_single_survival_replay(
            backtest_id=FAKE_BACKTEST_ID,
            strategy_id=FAKE_STRATEGY_ID,
            daily_pnls=[],
            firm="Topstep",
            account_type="50K",
            scorer_git_sha=FAKE_GIT_SHA,
        )
        assert result.status == STATUS_SKIPPED_NO_PNLS

    def test_single_element_skipped(self):
        """1 day is too short — survival_scorer needs at least 2."""
        result = _run_single_survival_replay(
            backtest_id=FAKE_BACKTEST_ID,
            strategy_id=FAKE_STRATEGY_ID,
            daily_pnls=[100.0],
            firm="Topstep",
            account_type="50K",
            scorer_git_sha=FAKE_GIT_SHA,
        )
        assert result.status == STATUS_SKIPPED_NO_PNLS

    def test_two_elements_not_skipped(self):
        """2 days is the minimum — should proceed (may complete or fail, not skip_no_pnls)."""
        with patch(
            "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
            return_value=None,
        ):
            result = _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=[100.0, -50.0],
                firm="Topstep",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )
        assert result.status != STATUS_SKIPPED_NO_PNLS


# ─── 5. test_governance_labels_correct ───────────────────────────────────────

class TestGovernanceLabelsCorrect:
    """replay_mode=True, survival_twin=True, decision_role='challenger_only'."""

    def test_governance_labels_on_completed_result(self):
        with (
            patch(
                "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
                return_value=None,
            ),
            patch(
                "src.engine.replay.survival_twin_replay._get_survival_scorer_git_sha",
                return_value=FAKE_GIT_SHA,
            ),
        ):
            result = _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="Topstep",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )

        gov = result.governance_labels
        assert gov["experimental"] is True
        assert gov["authoritative"] is False
        assert gov["decision_role"] == "challenger_only"
        assert gov["replay_mode"] is True
        assert gov["survival_twin"] is True

    def test_governance_labels_on_skipped_result(self):
        result = _run_single_survival_replay(
            backtest_id=FAKE_BACKTEST_ID,
            strategy_id=FAKE_STRATEGY_ID,
            daily_pnls=[],
            firm="Topstep",
            account_type="50K",
            scorer_git_sha=FAKE_GIT_SHA,
        )
        gov = result.governance_labels
        assert gov["authoritative"] is False
        assert gov["decision_role"] == "challenger_only"
        assert gov["survival_twin"] is True

    def test_firm_label_is_lowercase(self):
        result = _run_single_survival_replay(
            backtest_id=FAKE_BACKTEST_ID,
            strategy_id=FAKE_STRATEGY_ID,
            daily_pnls=[],
            firm="Topstep",
            account_type="50K",
            scorer_git_sha=FAKE_GIT_SHA,
        )
        assert result.governance_labels["firm"] == "topstep"

    def test_mffu_firm_label_is_lowercase(self):
        result = _run_single_survival_replay(
            backtest_id=FAKE_BACKTEST_ID,
            strategy_id=FAKE_STRATEGY_ID,
            daily_pnls=[],
            firm="MFFU",
            account_type="50K",
            scorer_git_sha=FAKE_GIT_SHA,
        )
        assert result.governance_labels["firm"] == "mffu"


# ─── 6. test_dry_run_no_writes ────────────────────────────────────────────────

class TestDryRunNoWrites:
    """Mock db_loader.write_replay_row is never called when apply=False."""

    def test_dry_run_does_not_call_write(self):
        fake_backtest = _FakeBacktestForReplay()

        with (
            patch(
                "src.engine.replay.survival_twin_replay.load_backtest_with_folds",
                return_value=fake_backtest,
            ),
            patch(
                "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
                return_value=None,
            ),
            patch(
                "src.engine.replay.survival_twin_replay._get_survival_scorer_git_sha",
                return_value=FAKE_GIT_SHA,
            ),
            patch(
                "src.engine.replay.survival_twin_replay.write_replay_row",
            ) as mock_write,
        ):
            results = replay_survival_on_backtest(
                backtest_id=FAKE_BACKTEST_ID,
                apply=False,
            )

        mock_write.assert_not_called()
        assert len(results) == 2  # one per firm


# ─── 7. test_apply_writes_replay_row ─────────────────────────────────────────

class TestApplyWritesReplayRow:
    """apply=True → write_replay_row called once per (backtest, firm) tuple."""

    def test_apply_calls_write_once_per_firm(self):
        fake_backtest = _FakeBacktestForReplay()

        with (
            patch(
                "src.engine.replay.survival_twin_replay.load_backtest_with_folds",
                return_value=fake_backtest,
            ),
            patch(
                "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
                return_value=None,
            ),
            patch(
                "src.engine.replay.survival_twin_replay._get_survival_scorer_git_sha",
                return_value=FAKE_GIT_SHA,
            ),
            patch(
                "src.engine.replay.survival_twin_replay.write_replay_row",
                return_value="new-row-uuid",
            ) as mock_write,
        ):
            results = replay_survival_on_backtest(
                backtest_id=FAKE_BACKTEST_ID,
                apply=True,
            )

        # 2 firms × 1 backtest = 2 write calls
        assert mock_write.call_count == len(SUPPORTED_FIRMS)
        # Each call must have apply=True — called as write_replay_row(row, apply=True)
        # so apply is always a keyword argument; check kwargs only
        for c in mock_write.call_args_list:
            _, kwargs = c
            assert kwargs.get("apply") is True


# ─── 8. test_iae_no_call ─────────────────────────────────────────────────────

class TestIaeNoCall:
    """Assert quantum_mc.py is NOT imported in this module.

    B14 is classical-side; quantum IAE is Pass 1's responsibility.
    """

    def test_quantum_mc_not_in_module_imports(self):
        import src.engine.replay.survival_twin_replay as module
        module_source_path = module.__file__
        with open(module_source_path, "r", encoding="utf-8") as f:
            source = f.read()
        # Must not import quantum_mc directly
        assert "import quantum_mc" not in source
        assert "from src.engine.quantum_mc" not in source
        assert "from src.engine import quantum_mc" not in source

    def test_qiskit_not_imported(self):
        import src.engine.replay.survival_twin_replay as module
        with open(module.__file__, "r", encoding="utf-8") as f:
            source = f.read()
        assert "import qiskit" not in source
        assert "from qiskit" not in source


# ─── 9. test_seed_determinism ────────────────────────────────────────────────

class TestSeedDeterminism:
    """Same backtest → bit-identical numpy output across 2 runs.

    survival_scorer's mc_drawdown_breach uses numpy seeding.  Two calls with
    identical inputs must return the same mc_dd_breach_probability.
    """

    def test_two_runs_produce_same_score(self):
        with (
            patch(
                "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
                return_value=None,
            ),
            patch(
                "src.engine.replay.survival_twin_replay._get_survival_scorer_git_sha",
                return_value=FAKE_GIT_SHA,
            ),
        ):
            r1 = _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="Topstep",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )
            r2 = _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="Topstep",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )

        assert r1.survival_score == r2.survival_score
        assert r1.grade == r2.grade
        assert r1.reproducibility_hash == r2.reproducibility_hash


# ─── 10. test_per_firm_independence ──────────────────────────────────────────

class TestPerFirmIndependence:
    """Topstep result is independent of MFFU result for same backtest."""

    def test_topstep_and_mffu_have_different_hashes(self):
        h_topstep = compute_reproducibility_hash(
            FAKE_STRATEGY_ID, FAKE_BACKTEST_ID, "Topstep", "50K", FAKE_GIT_SHA,
        )
        h_mffu = compute_reproducibility_hash(
            FAKE_STRATEGY_ID, FAKE_BACKTEST_ID, "MFFU", "50K", FAKE_GIT_SHA,
        )
        assert h_topstep != h_mffu

    def test_firm_labels_differ_between_results(self):
        with (
            patch(
                "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
                return_value=None,
            ),
            patch(
                "src.engine.replay.survival_twin_replay._get_survival_scorer_git_sha",
                return_value=FAKE_GIT_SHA,
            ),
        ):
            r_topstep = _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="Topstep",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )
            r_mffu = _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="MFFU",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )

        assert r_topstep.firm == "Topstep"
        assert r_mffu.firm == "MFFU"
        assert r_topstep.governance_labels["firm"] == "topstep"
        assert r_mffu.governance_labels["firm"] == "mffu"


# ─── 11. test_grade_emission ─────────────────────────────────────────────────

class TestGradeEmission:
    """Result includes 'grade' letter A-F on completed runs."""

    def test_completed_result_has_grade(self):
        with (
            patch(
                "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
                return_value=None,
            ),
            patch(
                "src.engine.replay.survival_twin_replay._get_survival_scorer_git_sha",
                return_value=FAKE_GIT_SHA,
            ),
        ):
            result = _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="Topstep",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )

        assert result.status == STATUS_COMPLETED
        assert result.grade in ("A", "B", "C", "D", "F")

    def test_db_row_contains_grade_in_raw_result(self):
        """grade must be packed into raw_result JSONB for the TS analysis layer."""
        with (
            patch(
                "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
                return_value=None,
            ),
            patch(
                "src.engine.replay.survival_twin_replay._get_survival_scorer_git_sha",
                return_value=FAKE_GIT_SHA,
            ),
        ):
            result = _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="Topstep",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )

        db_row = _result_to_db_row(result)
        assert db_row["raw_result"]["grade"] == result.grade

    def test_db_row_schema_version_stamped(self):
        with (
            patch(
                "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
                return_value=None,
            ),
        ):
            result = _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="Topstep",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )

        assert result.schema_version == SCHEMA_VERSION
        db_row = _result_to_db_row(result)
        assert db_row["raw_result"]["schema_version"] == SCHEMA_VERSION


# ─── 12. test_aer_simulator_not_used ─────────────────────────────────────────

class TestAerSimulatorNotUsed:
    """B14 is classical-only; no AerSimulator, no Qiskit at all."""

    def test_aer_simulator_not_in_module_source(self):
        import src.engine.replay.survival_twin_replay as module
        with open(module.__file__, "r", encoding="utf-8") as f:
            source = f.read()
        assert "AerSimulator" not in source
        assert "StatevectorSimulator" not in source
        # Check for actual import statements, not prose mentions in docstrings
        assert "import pennylane" not in source.lower()
        assert "from pennylane" not in source.lower()

    def test_module_has_no_quantum_imports_at_runtime(self):
        """After importing survival_twin_replay, no quantum packages loaded."""
        # qiskit is not guaranteed to be installed; this test simply asserts
        # that survival_twin_replay doesn't ATTEMPT to import it.
        import src.engine.replay.survival_twin_replay as module
        with open(module.__file__, "r", encoding="utf-8") as f:
            source = f.read()
        # Check for actual import statements, not prose mentions in docstrings
        assert "import qiskit" not in source
        assert "from qiskit" not in source
        assert "import pennylane" not in source.lower()
        assert "from pennylane" not in source.lower()


# ─── DB row contract ──────────────────────────────────────────────────────────

class TestDbRowContract:
    """_result_to_db_row() produces all required fields for write_replay_row()."""

    def _make_completed_result(self) -> SurvivalReplayResult:
        with patch(
            "src.engine.replay.survival_twin_replay._load_pass_a_ruin_ci_high",
            return_value=0.35,
        ):
            return _run_single_survival_replay(
                backtest_id=FAKE_BACKTEST_ID,
                strategy_id=FAKE_STRATEGY_ID,
                daily_pnls=SYNTHETIC_DAILY_PNLS,
                firm="Topstep",
                account_type="50K",
                scorer_git_sha=FAKE_GIT_SHA,
            )

    def test_all_required_fields_present(self):
        from src.engine.replay.db_loader import REPLAY_ROW_SCHEMA
        result = self._make_completed_result()
        db_row = _result_to_db_row(result)
        for field in REPLAY_ROW_SCHEMA["required_fields"]:
            assert field in db_row, f"Missing required field: {field}"

    def test_governance_labels_match_contract(self):
        from src.engine.replay.db_loader import REPLAY_ROW_SCHEMA
        result = self._make_completed_result()
        db_row = _result_to_db_row(result)
        gov = db_row["governance_labels"]
        for key, expected in REPLAY_ROW_SCHEMA["governance_labels_contract"].items():
            assert gov[key] == expected, (
                f"governance_labels.{key}={gov[key]!r} != {expected!r}"
            )

    def test_method_is_survival_twin_classical(self):
        result = self._make_completed_result()
        db_row = _result_to_db_row(result)
        assert db_row["method"] == METHOD

    def test_num_qubits_is_zero(self):
        """B14 is classical — no qubits used."""
        result = self._make_completed_result()
        db_row = _result_to_db_row(result)
        assert db_row["num_qubits"] == 0

    def test_gpu_accelerated_is_false(self):
        result = self._make_completed_result()
        db_row = _result_to_db_row(result)
        assert db_row["gpu_accelerated"] is False
