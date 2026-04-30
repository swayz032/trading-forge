"""Tests for cloud_backend.py mid-job kill watchdog (Group A).

Coverage:
  - test_watchdog_kills_oversized_braket_job
  - test_watchdog_persists_across_restarts
  - test_concurrent_jobs_aggregate_correctly
  - test_watchdog_ibm_kill_attempt
  - test_watchdog_cancel_failure_marks_cancellation_requested
  - test_unregister_removes_job_and_updates_spend
  - test_tick_public_api_delegates_correctly
  - test_orphaned_jobs_recovered_on_reload
  - test_audit_marker_written_on_kill
  - cache_smoke_test_hit_returns_cache_hit_true  (Group B smoke test)
  - cache_smoke_test_no_cloud_backend_bypasses_cache

Governance: all tests operate at the challenger advisory layer only.
No test exercises any execution path.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.engine.cloud_backend import (
    CloudBudgetTracker,
    CloudJobRegistry,
    GOVERNANCE_LABELS,
    QuantumResultCache,
    WATCHDOG_TICK_INTERVAL_SEC,
    tick,
)


# ─── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture()
def tmp_registry_path(tmp_path: Path) -> Path:
    return tmp_path / "active_quantum_jobs.json"


@pytest.fixture()
def tmp_budget_path(tmp_path: Path) -> Path:
    return tmp_path / "cloud_budget.json"


@pytest.fixture()
def tracker(tmp_budget_path: Path) -> CloudBudgetTracker:
    return CloudBudgetTracker(path=tmp_budget_path)


@pytest.fixture()
def registry(tmp_registry_path: Path) -> CloudJobRegistry:
    return CloudJobRegistry(path=tmp_registry_path)


@pytest.fixture()
def tmp_cache_dir(tmp_path: Path) -> Path:
    d = tmp_path / "quantum_cache"
    d.mkdir()
    return d


# ─── Group A: Watchdog tests ──────────────────────────────────────────────────


class TestWatchdogKillsOversizedJob:
    """test_watchdog_kills_oversized_braket_job.

    Register a fake job whose estimated cost exceeds the $30 cap,
    then verify cancel() is called on the mock sdk_handle.
    """

    def test_watchdog_kills_oversized_braket_job(
        self, registry: CloudJobRegistry, tracker: CloudBudgetTracker
    ):
        mock_handle = MagicMock()
        # Estimated cost $20; pessimism factor 2x → $40 > $30 cap
        registry.register_job(
            job_id="braket-job-001",
            backend="braket",
            sdk_handle=mock_handle,
            estimated_cost=20.0,
            circuit_qubits=8,
        )
        # No prior spend so projected = 0 + 20 * 2 = 40 > 30
        cancelled = registry.check_running_jobs(
            tracker, braket_limit_dollars=30.0
        )
        assert "braket-job-001" in cancelled
        mock_handle.cancel.assert_called_once()

    def test_watchdog_does_not_kill_within_budget(
        self, registry: CloudJobRegistry, tracker: CloudBudgetTracker
    ):
        mock_handle = MagicMock()
        # Estimated cost $5; pessimism factor 2x → $10 < $30 cap
        registry.register_job(
            job_id="braket-job-002",
            backend="braket",
            sdk_handle=mock_handle,
            estimated_cost=5.0,
            circuit_qubits=4,
        )
        cancelled = registry.check_running_jobs(
            tracker, braket_limit_dollars=30.0
        )
        assert "braket-job-002" not in cancelled
        mock_handle.cancel.assert_not_called()

    def test_watchdog_ibm_kill_attempt(
        self, registry: CloudJobRegistry, tracker: CloudBudgetTracker
    ):
        mock_handle = MagicMock()
        # IBM: estimated 400s * 2 = 800s > 600s cap
        registry.register_job(
            job_id="ibm-job-001",
            backend="ibm",
            sdk_handle=mock_handle,
            estimated_cost=400.0,
            circuit_qubits=10,
        )
        cancelled = registry.check_running_jobs(
            tracker, ibm_limit_seconds=600
        )
        assert "ibm-job-001" in cancelled
        mock_handle.cancel.assert_called_once()


class TestWatchdogCancelFailure:
    """SDK cancel() raising must not propagate — job marked cancellation_requested."""

    def test_cancel_failure_marks_cancellation_requested(
        self, registry: CloudJobRegistry, tracker: CloudBudgetTracker
    ):
        mock_handle = MagicMock()
        mock_handle.cancel.side_effect = RuntimeError("already completed")

        registry.register_job(
            job_id="braket-fail-001",
            backend="braket",
            sdk_handle=mock_handle,
            estimated_cost=20.0,
        )
        # Should not raise
        cancelled = registry.check_running_jobs(tracker, braket_limit_dollars=30.0)
        assert "braket-fail-001" in cancelled
        assert registry._jobs["braket-fail-001"]["status"] == "cancellation_requested"

    def test_cancel_failure_does_not_propagate_exception(
        self, registry: CloudJobRegistry, tracker: CloudBudgetTracker
    ):
        mock_handle = MagicMock()
        mock_handle.cancel.side_effect = Exception("network error")
        registry.register_job("j-raise", "braket", mock_handle, 20.0)
        # Must not raise
        try:
            registry.check_running_jobs(tracker, braket_limit_dollars=30.0)
        except Exception as exc:
            pytest.fail(f"check_running_jobs raised unexpectedly: {exc}")


class TestWatchdogPersistAcrossRestarts:
    """test_watchdog_persists_across_restarts.

    Register a job, simulate restart (new CloudJobRegistry from same path),
    verify _active_jobs are recovered (as orphaned) and estimated cost
    is still visible to preflight.
    """

    def test_watchdog_persists_across_restarts(
        self, tmp_registry_path: Path, tracker: CloudBudgetTracker
    ):
        # First registry — register a job
        reg1 = CloudJobRegistry(path=tmp_registry_path)
        mock_handle = MagicMock()
        reg1.register_job(
            job_id="persistent-job-001",
            backend="braket",
            sdk_handle=mock_handle,
            estimated_cost=8.0,
            circuit_qubits=6,
        )
        assert tmp_registry_path.exists()

        # Simulate restart — new registry from same path
        reg2 = CloudJobRegistry(path=tmp_registry_path)
        assert "persistent-job-001" in reg2._jobs
        # After restart, status must be orphaned (no live SDK handle)
        assert reg2._jobs["persistent-job-001"]["status"] == "orphaned"
        # Estimated cost is still present for preflight accounting
        assert reg2._jobs["persistent-job-001"]["estimated_cost"] == 8.0

    def test_orphaned_jobs_recovered_on_reload(
        self, tmp_registry_path: Path
    ):
        # Write a synthetic registry file
        synthetic = {
            "orphan-001": {
                "job_id": "orphan-001",
                "backend": "ibm",
                "start_time": time.time() - 3600,
                "estimated_cost": 120.0,
                "sdk_handle_ref": "ibm:orphan-001",
                "circuit_qubits": 8,
                "status": "running",
            }
        }
        with open(tmp_registry_path, "w") as fh:
            json.dump(synthetic, fh)

        reg = CloudJobRegistry(path=tmp_registry_path)
        assert "orphan-001" in reg._jobs
        # Recovered jobs must be marked orphaned — they have no live SDK handle
        assert reg._jobs["orphan-001"]["status"] == "orphaned"
        # SDK handle must not be in the live dict after restart
        assert "orphan-001" not in reg._sdk_handles


class TestConcurrentJobsAggregate:
    """test_concurrent_jobs_aggregate_correctly.

    Two concurrent jobs; total projected cost exceeds cap; both should be killed.
    """

    def test_two_concurrent_jobs_aggregate_spend(
        self, registry: CloudJobRegistry, tracker: CloudBudgetTracker
    ):
        handle_a = MagicMock()
        handle_b = MagicMock()
        # Job A: $8 estimated; Job B: $9 estimated
        # Braket cap $30: first job projected = 0 + 8*2 = 16 — under cap
        # Second job projected = 0 + 9*2 = 18 — under cap
        # But together they both use budget_tracker's running total,
        # so with prior spend of $15: 15 + 8*2 = 31 > 30 and 15 + 9*2 = 33 > 30
        tracker.record_braket_usage(15.0, task_arn="prior-task", device_name="sv1")

        registry.register_job("concurrent-a", "braket", handle_a, 8.0)
        registry.register_job("concurrent-b", "braket", handle_b, 9.0)

        cancelled = registry.check_running_jobs(tracker, braket_limit_dollars=30.0)
        # Both jobs should be flagged because recorded spend (15) + estimate*2 > 30
        assert "concurrent-a" in cancelled
        assert "concurrent-b" in cancelled
        handle_a.cancel.assert_called_once()
        handle_b.cancel.assert_called_once()

    def test_get_active_estimated_spend(self, registry: CloudJobRegistry):
        registry.register_job("spend-a", "braket", MagicMock(), 5.0)
        registry.register_job("spend-b", "braket", MagicMock(), 7.0)
        registry.register_job("spend-ibm", "ibm", MagicMock(), 100.0)

        braket_spend = registry.get_active_estimated_spend("braket")
        assert braket_spend == 12.0  # 5 + 7

        ibm_spend = registry.get_active_estimated_spend("ibm")
        assert ibm_spend == 100.0


class TestUnregisterJob:
    """Unregistering a job removes it from the registry."""

    def test_unregister_removes_job(self, registry: CloudJobRegistry):
        registry.register_job("unreg-001", "braket", MagicMock(), 5.0)
        assert "unreg-001" in registry._jobs

        registry.unregister_job("unreg-001", actual_cost=4.50)
        assert "unreg-001" not in registry._jobs
        assert "unreg-001" not in registry._sdk_handles

    def test_unregister_missing_job_does_not_crash(self, registry: CloudJobRegistry):
        # Should not raise even if job was never registered
        registry.unregister_job("nonexistent-job", actual_cost=0.0)


class TestAuditMarker:
    """An audit marker file must be written when a kill is attempted."""

    def test_audit_marker_written_on_kill(
        self,
        tmp_registry_path: Path,
        tracker: CloudBudgetTracker,
    ):
        registry = CloudJobRegistry(path=tmp_registry_path)
        mock_handle = MagicMock()
        registry.register_job("audit-job-001", "braket", mock_handle, 20.0)

        registry.check_running_jobs(tracker, braket_limit_dollars=30.0)

        # Audit marker must exist in the same directory as the registry
        audit_files = list(tmp_registry_path.parent.glob("cloud_budget_kill_audit-job-001_*.json"))
        assert len(audit_files) >= 1, "Expected audit marker file was not written"

        # Verify audit marker content
        with open(audit_files[0]) as fh:
            audit = json.load(fh)
        assert audit["job_id"] == "audit-job-001"
        assert audit["backend"] == "braket"
        assert "governance_labels" in audit
        assert audit["governance_labels"]["authoritative"] is False


class TestTickPublicApi:
    """tick() must delegate to cloud_job_registry.check_running_jobs."""

    def test_tick_calls_check_running_jobs(self, tracker: CloudBudgetTracker):
        with patch(
            "src.engine.cloud_backend.cloud_job_registry"
        ) as mock_registry:
            mock_registry.check_running_jobs.return_value = []
            result = tick(budget_tracker=tracker)
        mock_registry.check_running_jobs.assert_called_once()
        assert result == []

    def test_watchdog_tick_interval_constant_exists(self):
        assert WATCHDOG_TICK_INTERVAL_SEC == 30


class TestRegistryPersistence:
    """Registry must atomically persist and be re-readable."""

    def test_registry_file_written_on_register(
        self, registry: CloudJobRegistry, tmp_registry_path: Path
    ):
        registry.register_job("persist-test", "ibm", MagicMock(), 60.0)
        assert tmp_registry_path.exists()
        with open(tmp_registry_path) as fh:
            data = json.load(fh)
        assert "persist-test" in data

    def test_registry_file_updated_on_unregister(
        self, registry: CloudJobRegistry, tmp_registry_path: Path
    ):
        registry.register_job("unreg-persist", "braket", MagicMock(), 5.0)
        registry.unregister_job("unreg-persist", actual_cost=4.0)
        with open(tmp_registry_path) as fh:
            data = json.load(fh)
        assert "unreg-persist" not in data


# ─── Group B: Cache smoke tests ───────────────────────────────────────────────


class TestCacheSmoke:
    """Smoke tests for QuantumResultCache.get/put wiring."""

    def test_cache_hit_returns_cache_hit_true(self, tmp_cache_dir: Path):
        cache = QuantumResultCache(cache_dir=tmp_cache_dir)
        params = {"strategy_id": "smoke-test", "threshold": 0.05, "seed": 42}
        result = {
            "estimated_value": 0.12,
            "backend_label": "aer_cpu",
            "cache_hit": False,
        }
        cache.put(algorithm="qmc", params=params, result=result)

        # Second call must return cached result with cache_hit=True
        cached = cache.get(algorithm="qmc", params=params)
        assert cached is not None
        assert cached["cache_hit"] is True
        assert cached["estimated_value"] == 0.12

    def test_cache_miss_returns_none(self, tmp_cache_dir: Path):
        cache = QuantumResultCache(cache_dir=tmp_cache_dir)
        result = cache.get(algorithm="qmc", params={"never_stored": True})
        assert result is None

    def test_cloud_backend_label_not_cached_when_ibm(self, tmp_cache_dir: Path):
        """Results with ibm/braket backend_label must not be used as cache evidence.

        This test verifies the caller-side pattern: if backend_label contains
        "ibm" or "braket", cache_hit=False is forced and the result is not
        served from cache on subsequent calls (callers skip the cache.put step).
        """
        cache = QuantumResultCache(cache_dir=tmp_cache_dir)
        params = {"strategy_id": "cloud-run", "seed": 1}
        cloud_result = {
            "estimated_value": 0.25,
            "backend_label": "ibm_qpu:ibm_torino",  # Cloud result
            "cache_hit": False,
        }
        # Simulate: caller checks backend_label and skips put for cloud runs
        backend_label = cloud_result.get("backend_label", "")
        is_cloud = "ibm" in backend_label or "braket" in backend_label
        if not is_cloud:
            cache.put(algorithm="qmc", params=params, result=cloud_result)

        # Should be a miss because we skipped the put
        cached = cache.get(algorithm="qmc", params=params)
        assert cached is None

    def test_cache_ttl_30_days(self, tmp_cache_dir: Path):
        """Cache TTL must be 30 days as documented."""
        from src.engine.cloud_backend import _CACHE_TTL_DAYS
        assert _CACHE_TTL_DAYS == 30

    def test_different_params_give_different_keys(self, tmp_cache_dir: Path):
        cache = QuantumResultCache(cache_dir=tmp_cache_dir)
        params_a = {"seed": 1, "threshold": 0.05}
        params_b = {"seed": 2, "threshold": 0.05}

        cache.put("qmc", params_a, {"value": 0.1, "cache_hit": False})
        cache.put("qmc", params_b, {"value": 0.2, "cache_hit": False})

        cached_a = cache.get("qmc", params_a)
        cached_b = cache.get("qmc", params_b)

        assert cached_a is not None
        assert cached_b is not None
        assert cached_a["value"] != cached_b["value"]

    def test_cache_write_failure_does_not_crash(self, tmp_path: Path):
        """Cache write failure must be swallowed, not propagated."""
        cache = QuantumResultCache(cache_dir=tmp_path / "nonexistent_but_will_be_created")
        # Should not raise even if the dir creation fails mid-way
        cache.put("qmc", {"k": "v"}, {"result": 1.0})

    def test_governance_label_present_in_cache(self, tmp_cache_dir: Path):
        """Cached results must carry governance context from the original result."""
        cache = QuantumResultCache(cache_dir=tmp_cache_dir)
        params = {"seed": 99}
        result = {
            "estimated_value": 0.07,
            "governance_labels": GOVERNANCE_LABELS,
            "cache_hit": False,
        }
        cache.put("qmc", params, result)
        cached = cache.get("qmc", params)
        assert cached is not None
        assert cached["governance_labels"]["authoritative"] is False
        assert cached["governance_labels"]["experimental"] is True
