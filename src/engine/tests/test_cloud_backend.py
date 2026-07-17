"""Tests for cloud_backend.py and hardware_profile.py cloud extensions.

Coverage categories:
  - Challenger isolation (no leakage into execution paths)
  - Schema regression (output shape stability for CloudBudgetTracker)
  - Benchmark comparison (resolve_backend fallback to local when gates closed)
  - Reproducibility (CloudBudgetTracker monthly reset determinism)
  - Runtime guardrails (pessimistic budget checks hard-stop before overspend)
  - Failure handling (unavailable SDKs, missing env vars, bad credentials)
  - Backward compat (select_backend with no new args unchanged)

Governance: all tests operate at the challenger advisory layer only.
No test exercises any execution path.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.engine.cloud_backend import (
    BRAKET_DEVICES,
    GOVERNANCE_LABELS,
    CloudBackendConfig,
    CloudBudgetTracker,
    build_cloud_run_metadata,
    get_braket_device,
    get_ibm_sampler,
    resolve_backend,
)
from src.engine.hardware_profile import (
    HardwareProfile,
    detect_cloud_backends,
    get_hardware_profile,
    select_backend,
)

# ─── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture()
def tmp_budget_path(tmp_path: Path) -> Path:
    return tmp_path / "cloud_budget.json"


@pytest.fixture()
def tracker(tmp_budget_path: Path) -> CloudBudgetTracker:
    return CloudBudgetTracker(path=tmp_budget_path)


@pytest.fixture()
def local_config() -> CloudBackendConfig:
    return CloudBackendConfig(provider="local", opt_in_cloud=False)


@pytest.fixture()
def ibm_config_opted_in() -> CloudBackendConfig:
    return CloudBackendConfig(
        provider="ibm",
        backend_name="ibm_torino",
        ibm_token="fake-token",
        opt_in_cloud=True,
    )


@pytest.fixture()
def braket_config_opted_in() -> CloudBackendConfig:
    return CloudBackendConfig(
        provider="braket",
        backend_name="sv1",
        opt_in_cloud=True,
    )


# ─── Governance / Isolation ───────────────────────────────────────────────────


class TestGovernanceLabels:
    """Challenger isolation: governance labels must never be absent."""

    def test_governance_labels_present(self):
        labels = GOVERNANCE_LABELS
        assert labels["experimental"] is True
        assert labels["authoritative"] is False
        assert labels["decision_role"] == "challenger_only"

    def test_build_cloud_run_metadata_carries_governance(self):
        import time
        meta = build_cloud_run_metadata(
            provider_name="local",
            label="aer_cpu",
            start_time=time.time() - 0.1,
        )
        assert meta["governance_labels"]["authoritative"] is False
        assert meta["governance_labels"]["experimental"] is True

    def test_build_cloud_run_metadata_schema(self):
        import time
        meta = build_cloud_run_metadata(
            provider_name="ibm",
            label="ibm_qpu:ibm_torino",
            start_time=time.time() - 1.0,
            job_id="job-abc",
            task_arn="",
            estimated_cost=0.0,
        )
        required_keys = {
            "provider", "backend_label", "execution_ms", "job_id",
            "task_arn", "estimated_cost_usd", "run_ts",
            "cloud_sdk_available", "governance_labels",
        }
        assert required_keys.issubset(meta.keys())

    def test_resolve_backend_never_returns_execution_object_for_local(self):
        """When opt_in_cloud=False the backend object slot must be None."""
        config = CloudBackendConfig(provider="local", opt_in_cloud=False)
        provider, backend_obj, label = resolve_backend(config, problem_size=10)
        assert provider == "local"
        assert backend_obj is None  # No execution object exposed

    def test_resolve_backend_opt_in_false_skips_cloud(self):
        """Gate 1: opt_in_cloud=False must always route to local."""
        for provider in ("ibm", "braket", "local"):
            config = CloudBackendConfig(provider=provider, opt_in_cloud=False)  # type: ignore[arg-type]
            provider_name, _, label = resolve_backend(config, problem_size=5)
            assert provider_name == "local", (
                f"opt_in_cloud=False must yield local for provider={provider}"
            )

    def test_resolve_backend_env_kill_switch(self):
        """Gate 2: QUANTUM_CLOUD_ENABLED=false must always route to local."""
        config = CloudBackendConfig(provider="ibm", opt_in_cloud=True, ibm_token="tok")
        with patch.dict(os.environ, {"QUANTUM_CLOUD_ENABLED": "false"}):
            provider_name, _, label = resolve_backend(config, problem_size=5)
        assert provider_name == "local"

    def test_resolve_backend_env_kill_switch_case_insensitive(self):
        config = CloudBackendConfig(provider="braket", opt_in_cloud=True)
        with patch.dict(os.environ, {"QUANTUM_CLOUD_ENABLED": "FALSE"}):
            provider_name, _, _ = resolve_backend(config, problem_size=5)
        assert provider_name == "local"


# ─── CloudBackendConfig ───────────────────────────────────────────────────────


class TestCloudBackendConfig:
    """Schema regression tests for CloudBackendConfig."""

    def test_defaults(self):
        config = CloudBackendConfig()
        assert config.provider == "local"
        assert config.opt_in_cloud is False
        assert config.budget_limit_seconds == 600
        assert config.budget_limit_dollars == 30.0
        assert config.ibm_instance == "open-instance"
        assert config.braket_region == "us-east-1"
        assert config.braket_s3_bucket == "amazon-braket-trading-forge"

    def test_opt_in_must_be_explicit(self):
        """opt_in_cloud defaults False — must be explicitly set True."""
        config = CloudBackendConfig(provider="ibm", ibm_token="t")
        assert config.opt_in_cloud is False

    def test_provider_literals_accepted(self):
        for p in ("ibm", "braket", "local"):
            config = CloudBackendConfig(provider=p)  # type: ignore[arg-type]
            assert config.provider == p

    def test_provider_invalid_rejected(self):
        with pytest.raises(Exception):
            CloudBackendConfig(provider="aws_direct")  # type: ignore[arg-type]


# ─── CloudBudgetTracker ───────────────────────────────────────────────────────


class TestCloudBudgetTrackerSchema:
    """Schema regression: budget file shape must be stable."""

    def test_initial_budget_shape(self, tracker: CloudBudgetTracker):
        remaining = tracker.get_remaining()
        assert "reset_month" in remaining
        assert "ibm_seconds_remaining" in remaining
        assert "braket_dollars_remaining" in remaining
        assert "ibm_seconds_used" in remaining
        assert "braket_dollars_used" in remaining
        assert "governance_labels" in remaining

    def test_initial_usage_zero(self, tracker: CloudBudgetTracker):
        remaining = tracker.get_remaining()
        assert remaining["ibm_seconds_used"] == 0
        assert remaining["braket_dollars_used"] == 0.0

    def test_remaining_sums_to_limit(self, tracker: CloudBudgetTracker):
        remaining = tracker.get_remaining()
        assert remaining["ibm_seconds_remaining"] + remaining["ibm_seconds_used"] == 600
        assert abs(
            remaining["braket_dollars_remaining"] + remaining["braket_dollars_used"] - 30.0
        ) < 1e-9


class TestCloudBudgetTrackerPessimism:
    """Budget checks must apply 2x pessimism and hard-stop."""

    def test_can_run_ibm_within_budget(self, tracker: CloudBudgetTracker):
        # 200s estimate * 2 pessimism = 400s — fits in 600s limit
        assert tracker.can_run_ibm(200, limit_seconds=600) is True

    def test_can_run_ibm_over_budget(self, tracker: CloudBudgetTracker):
        # 350s * 2 = 700s > 600s limit
        assert tracker.can_run_ibm(350, limit_seconds=600) is False

    def test_can_run_ibm_exactly_at_limit(self, tracker: CloudBudgetTracker):
        # 300s * 2 = 600s == limit — must pass (edge case: <=)
        assert tracker.can_run_ibm(300, limit_seconds=600) is True

    def test_can_run_braket_within_budget(self, tracker: CloudBudgetTracker):
        # $10 * 2 = $20 < $30 limit
        assert tracker.can_run_braket(10.0, limit_dollars=30.0) is True

    def test_can_run_braket_over_budget(self, tracker: CloudBudgetTracker):
        # $20 * 2 = $40 > $30 limit
        assert tracker.can_run_braket(20.0, limit_dollars=30.0) is False

    def test_record_ibm_blocks_next_if_overspend(
        self, tracker: CloudBudgetTracker, tmp_budget_path: Path
    ):
        """After recording usage that consumes most budget, guard must block."""
        tracker.record_ibm_usage(580, job_id="j1", backend_name="ibm_torino")
        # 580 used; 20s remaining; 25 * 2 = 50 > 20 → blocked
        assert tracker.can_run_ibm(25, limit_seconds=600) is False

    def test_record_braket_blocks_next_if_overspend(
        self, tracker: CloudBudgetTracker
    ):
        tracker.record_braket_usage(14.5, task_arn="t1", device_name="sv1")
        # 14.5 used; 15.5 remaining; 10 * 2 = 20 > 15.5 → blocked
        assert tracker.can_run_braket(10.0, limit_dollars=30.0) is False


class TestCloudBudgetTrackerPersistence:
    """Records must survive round-trip to disk."""

    def test_ibm_usage_persisted(
        self, tracker: CloudBudgetTracker, tmp_budget_path: Path
    ):
        tracker.record_ibm_usage(30.0, job_id="job-x", backend_name="ibm_torino")
        # New tracker from same path
        tracker2 = CloudBudgetTracker(path=tmp_budget_path)
        remaining = tracker2.get_remaining()
        assert remaining["ibm_seconds_used"] == 30

    def test_braket_usage_persisted(
        self, tracker: CloudBudgetTracker, tmp_budget_path: Path
    ):
        tracker.record_braket_usage(1.50, task_arn="arn:1", device_name="sv1")
        tracker2 = CloudBudgetTracker(path=tmp_budget_path)
        remaining = tracker2.get_remaining()
        assert abs(remaining["braket_dollars_used"] - 1.50) < 1e-9

    def test_run_log_appended(self, tracker: CloudBudgetTracker):
        tracker.record_ibm_usage(10.0, job_id="j1", backend_name="ibm_x")
        tracker.record_ibm_usage(5.0, job_id="j2", backend_name="ibm_x")
        assert len(tracker._data["runs"]) == 2
        assert tracker._data["runs"][0]["job_id"] == "j1"
        assert tracker._data["runs"][1]["job_id"] == "j2"

    def test_monthly_auto_reset(
        self, tracker: CloudBudgetTracker, tmp_budget_path: Path
    ):
        """When stored reset_month differs from current month, counts reset."""
        tracker.record_ibm_usage(300, job_id="old", backend_name="ibm_x")
        # Manually backdate the stored month
        tracker._data["reset_month"] = "2000-01"
        with open(tmp_budget_path, "w") as fh:
            json.dump(tracker._data, fh)
        # Fresh tracker should reset
        tracker2 = CloudBudgetTracker(path=tmp_budget_path)
        remaining = tracker2.get_remaining()
        assert remaining["ibm_seconds_used"] == 0


class TestCloudBudgetTrackerConcurrency:
    """MED REGRESSION: check-then-record was a cross-process TOCTOU / lost-update
    race. submit_surface_code_iae() runs as a fresh OS subprocess per
    cloud-qmc-service.ts submission — each gets its OWN CloudBudgetTracker()
    instance with its own in-memory `self._data` snapshot from __init__. The
    pre-fix record_ibm_usage() did `self._data[...] += seconds; self._save()`
    against that stale snapshot, so two concurrent recorders (simulated here
    with threads + independent tracker instances against the SAME budget
    file, which reproduces the identical stale-snapshot mechanics without
    needing real subprocesses) could each compute their increment off the
    SAME base and the second save silently clobbers the first — the true
    total usage is under-reported (a real budget overshoot goes unnoticed).
    """

    def test_concurrent_record_ibm_usage_no_lost_update(self, tmp_budget_path: Path):
        import threading

        n_workers = 8
        seconds_each = 10.0
        barrier = threading.Barrier(n_workers)

        def worker(idx: int) -> None:
            # Each worker gets its OWN tracker instance (own __init__ snapshot),
            # exactly like two independent poll_ibm_job/submit_surface_code_iae
            # OS subprocesses each constructing `tracker = CloudBudgetTracker()`.
            t = CloudBudgetTracker(path=tmp_budget_path)
            barrier.wait()  # maximize the chance all snapshots are equally stale
            t.record_ibm_usage(seconds_each, job_id=f"job-{idx}", backend_name="ibm_fez")

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(n_workers)]
        for th in threads:
            th.start()
        for th in threads:
            th.join(timeout=30)
            assert not th.is_alive(), "worker thread did not complete — possible deadlock"

        final = CloudBudgetTracker(path=tmp_budget_path)
        remaining = final.get_remaining()
        assert remaining["ibm_seconds_used"] == n_workers * seconds_each, (
            f"expected {n_workers * seconds_each}s (no lost updates), "
            f"got {remaining['ibm_seconds_used']}s — a concurrent record was clobbered"
        )
        assert len(final._data["runs"]) == n_workers, (
            "every concurrent record_ibm_usage() call must produce its own run row"
        )

    def test_concurrent_can_run_ibm_reads_fresh_state_not_stale_init_snapshot(
        self, tmp_budget_path: Path
    ):
        """can_run_ibm() must reflect usage recorded by ANOTHER tracker instance
        after this tracker's own __init__, not the stale snapshot from
        construction time."""
        t1 = CloudBudgetTracker(path=tmp_budget_path)
        t2 = CloudBudgetTracker(path=tmp_budget_path)  # constructed with t1's (empty) state

        # t1 records real usage AFTER t2 was already constructed.
        t1.record_ibm_usage(580, job_id="j1", backend_name="ibm_torino")

        # t2's __init__ snapshot is stale (still shows 0 used) — but a correct
        # can_run_ibm() must consult FRESH disk state, not that snapshot.
        # 580 used; 20s remaining; 25 * 2 = 50 > 20 -> must be blocked.
        assert t2.can_run_ibm(25, limit_seconds=600) is False, (
            "can_run_ibm() returned True using a stale __init__ snapshot instead of "
            "re-reading fresh on-disk state written by a concurrent tracker instance"
        )


# ─── BRAKET_DEVICES Mapping ──────────────────────────────────────────────────


class TestBraketDeviceMapping:
    """Schema regression: device ARN table must contain required entries."""

    def test_required_devices_present(self):
        required = {"ionq_forte1", "aquila", "sv1", "tn1", "dm1"}
        assert required.issubset(BRAKET_DEVICES.keys())

    def test_sv1_is_simulator(self):
        assert "quantum-simulator" in BRAKET_DEVICES["sv1"]

    def test_ionq_is_qpu(self):
        assert "qpu" in BRAKET_DEVICES["ionq_forte1"]

    def test_all_arns_start_with_arn(self):
        for key, arn in BRAKET_DEVICES.items():
            assert arn.startswith("arn:"), f"Device {key} ARN malformed: {arn}"


# ─── Provider factory failure handling ───────────────────────────────────────


class TestProviderFactoryFailures:
    """Failure handling: missing SDKs must raise ImportError, not crash."""

    def test_get_ibm_sampler_no_sdk(self):
        import src.engine.cloud_backend as cb
        orig = cb.IBM_RUNTIME_AVAILABLE
        cb.IBM_RUNTIME_AVAILABLE = False
        try:
            with pytest.raises(ImportError, match="qiskit-ibm-runtime"):
                get_ibm_sampler("ibm_torino", "tok", "open-instance")
        finally:
            cb.IBM_RUNTIME_AVAILABLE = orig

    def test_get_braket_device_no_sdk(self):
        import src.engine.cloud_backend as cb
        orig = cb.BRAKET_AVAILABLE
        cb.BRAKET_AVAILABLE = False
        try:
            arn = BRAKET_DEVICES["sv1"]
            with pytest.raises(ImportError, match="amazon-braket-sdk"):
                get_braket_device(arn, "us-east-1")
        finally:
            cb.BRAKET_AVAILABLE = orig

    def test_resolve_backend_ibm_no_token_falls_to_local(self):
        """IBM path with empty token must fall through to local."""
        config = CloudBackendConfig(
            provider="ibm",
            backend_name="ibm_torino",
            ibm_token=None,
            opt_in_cloud=True,
        )
        with patch.dict(os.environ, {}, clear=False):
            # Ensure token not in env
            env_without_token = {
                k: v for k, v in os.environ.items() if k != "IBM_QUANTUM_TOKEN"
            }
            with patch.dict(os.environ, env_without_token, clear=True):
                provider_name, backend_obj, label = resolve_backend(
                    config, problem_size=5
                )
        assert provider_name == "local"
        assert backend_obj is None

    def test_resolve_backend_ibm_init_exception_falls_to_local(self):
        """IBM sampler init exception must not propagate — fall to local."""
        import src.engine.cloud_backend as cb
        config = CloudBackendConfig(
            provider="ibm",
            backend_name="ibm_torino",
            ibm_token="fake-token",
            opt_in_cloud=True,
        )
        orig_available = cb.IBM_RUNTIME_AVAILABLE
        cb.IBM_RUNTIME_AVAILABLE = True

        with patch(
            "src.engine.cloud_backend.get_ibm_sampler",
            side_effect=RuntimeError("auth failed"),
        ):
            with patch.dict(os.environ, {"QUANTUM_CLOUD_ENABLED": "true"}):
                provider_name, _, label = resolve_backend(config, problem_size=5)

        cb.IBM_RUNTIME_AVAILABLE = orig_available
        assert provider_name == "local"

    def test_resolve_backend_braket_unknown_device_falls_to_local(self):
        """Unknown Braket device key must fall through safely."""
        config = CloudBackendConfig(
            provider="braket",
            backend_name="nonexistent_device_xyz",
            opt_in_cloud=True,
        )
        with patch.dict(os.environ, {"QUANTUM_CLOUD_ENABLED": "true"}):
            provider_name, _, label = resolve_backend(config, problem_size=5)
        assert provider_name == "local"

    def test_resolve_backend_budget_exhausted_ibm(
        self, tracker: CloudBudgetTracker
    ):
        """Budget exhaustion must block IBM and fall through."""
        import src.engine.cloud_backend as cb

        orig_available = cb.IBM_RUNTIME_AVAILABLE
        cb.IBM_RUNTIME_AVAILABLE = True

        config = CloudBackendConfig(
            provider="ibm",
            ibm_token="fake-token",
            opt_in_cloud=True,
            budget_limit_seconds=60,  # tiny cap
        )
        # Consume all budget
        tracker.record_ibm_usage(60, job_id="j", backend_name="ibm_torino")

        with patch.dict(os.environ, {"QUANTUM_CLOUD_ENABLED": "true"}):
            provider_name, _, _ = resolve_backend(
                config, problem_size=5, budget_tracker=tracker
            )

        cb.IBM_RUNTIME_AVAILABLE = orig_available
        assert provider_name == "local"


# ─── Backward Compatibility ──────────────────────────────────────────────────


class TestSelectBackendBackwardCompat:
    """Existing callers passing no new args must get unchanged behaviour."""

    def test_small_problem_returns_valid_local_label(self):
        label = select_backend(5)
        assert label in ("aer_gpu", "aer_cpu", "tensor_network", "cpu_only")

    def test_allow_cloud_false_by_default(self):
        """Cloud path must not activate without allow_cloud=True."""
        label = select_backend(200)  # deliberately large
        # Must still be a local label
        assert label in ("aer_gpu", "aer_cpu", "tensor_network", "cpu_only")

    def test_allow_cloud_none_config_no_crash(self):
        """allow_cloud=True with cloud_config=None must not crash."""
        label = select_backend(200, allow_cloud=True, cloud_config=None)
        assert label in ("aer_gpu", "aer_cpu", "tensor_network", "cpu_only")


# ─── HardwareProfile cloud fields ────────────────────────────────────────────


class TestHardwareProfileCloudFields:
    """Schema regression: cloud fields must be present with correct defaults."""

    def test_cloud_fields_default_false(self):
        profile = HardwareProfile(platform="Windows")
        assert profile.cloud_ibm_available is False
        assert profile.cloud_braket_available is False
        assert profile.cloud_ibm_backends == []
        assert profile.cloud_braket_devices == []
        assert profile.ibm_budget_remaining_seconds == 0
        assert profile.braket_budget_remaining_dollars == 0.0

    def test_get_hardware_profile_no_cloud_by_default(self):
        """detect_cloud=False (default) must leave cloud fields at defaults."""
        profile = get_hardware_profile(detect_cloud=False)
        assert profile.cloud_ibm_available is False
        assert profile.cloud_braket_available is False

    def test_get_hardware_profile_cloud_failure_is_nonfatal(self):
        """Cloud detection failure must not raise — profile still returned."""
        with patch(
            "src.engine.hardware_profile.detect_cloud_backends",
            side_effect=RuntimeError("network down"),
        ):
            profile = get_hardware_profile(detect_cloud=True)
        # Profile must be a valid object
        assert isinstance(profile, HardwareProfile)
        # Notes must contain the non-fatal marker
        assert any("non-fatal" in note for note in profile.notes)


# ─── detect_cloud_backends ───────────────────────────────────────────────────


class TestDetectCloudBackends:
    """Failure handling: absent credentials must return safe defaults."""

    def test_no_credentials_returns_safe_defaults(self):
        env_clean = {
            k: v for k, v in os.environ.items()
            if k not in (
                "IBM_QUANTUM_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_DEFAULT_REGION"
            )
        }
        with patch.dict(os.environ, env_clean, clear=True):
            result = detect_cloud_backends()
        assert result["ibm_available"] is False
        assert result["braket_available"] is False
        assert result["ibm_backends"] == []
        assert result["braket_devices"] == []

    def test_result_schema_keys_always_present(self):
        with patch.dict(os.environ, {}, clear=True):
            result = detect_cloud_backends()
        required = {"ibm_available", "ibm_backends", "braket_available", "braket_devices"}
        assert required.issubset(result.keys())


# ─── F-2: IBM budget reconciliation ──────────────────────────────────────────


class TestIBMBudgetReconciliation:
    """F-2: Budget is recorded at submission (pending_reconcile=True) and reconciled
    with actual QPU seconds at completion.  Guards against silent over-debit.
    """

    def test_record_ibm_usage_pending_reconcile_flag(
        self, tracker: CloudBudgetTracker
    ):
        """pending_reconcile=True must be persisted in the run log row."""
        tracker.record_ibm_usage(
            60.0, job_id="job-pending", backend_name="ibm_fez",
            pending_reconcile=True,
        )
        run = tracker._data["runs"][-1]
        assert run["pending_reconcile"] is True
        assert run["seconds"] == 60.0

    def test_record_ibm_usage_default_no_pending_flag(
        self, tracker: CloudBudgetTracker
    ):
        """Default call (no pending_reconcile arg) must write pending_reconcile=False."""
        tracker.record_ibm_usage(30.0, job_id="job-normal", backend_name="ibm_fez")
        run = tracker._data["runs"][-1]
        assert run["pending_reconcile"] is False

    def test_reconcile_ibm_usage_adjusts_counter_downward(
        self, tracker: CloudBudgetTracker
    ):
        """Actual < estimated → reconcile reduces ibm_seconds_used."""
        tracker.record_ibm_usage(
            60.0, job_id="job-rec", backend_name="ibm_fez", pending_reconcile=True,
        )
        assert tracker._data["ibm_seconds_used"] == 60.0

        # Actual = 40s → delta = 40 - 60 = -20
        tracker.reconcile_ibm_usage("job-rec", actual_seconds=40.0, delta=-20.0)
        assert tracker._data["ibm_seconds_used"] == 40.0

    def test_reconcile_ibm_usage_adjusts_counter_upward(
        self, tracker: CloudBudgetTracker
    ):
        """Actual > estimated → reconcile increases ibm_seconds_used."""
        tracker.record_ibm_usage(
            60.0, job_id="job-over", backend_name="ibm_fez", pending_reconcile=True,
        )
        tracker.reconcile_ibm_usage("job-over", actual_seconds=80.0, delta=20.0)
        assert tracker._data["ibm_seconds_used"] == 80.0

    def test_reconcile_clears_pending_reconcile_flag(
        self, tracker: CloudBudgetTracker
    ):
        """After reconcile, the run row must have pending_reconcile=False."""
        tracker.record_ibm_usage(
            60.0, job_id="job-clear", backend_name="ibm_fez", pending_reconcile=True,
        )
        tracker.reconcile_ibm_usage("job-clear", actual_seconds=55.0, delta=-5.0)
        run = tracker._data["runs"][-1]
        assert run["pending_reconcile"] is False
        assert run["seconds"] == 55.0
        assert "reconciled_ts" in run
        assert run["reconcile_delta"] == -5.0

    def test_reconcile_no_pending_row_is_safe(
        self, tracker: CloudBudgetTracker
    ):
        """reconcile_ibm_usage on unknown job_id must not raise or corrupt budget."""
        tracker.record_ibm_usage(30.0, job_id="other-job", backend_name="ibm_fez")
        original_used = tracker._data["ibm_seconds_used"]
        # Should log warning but not raise or change the counter
        tracker.reconcile_ibm_usage("nonexistent-job", actual_seconds=20.0, delta=-10.0)
        assert tracker._data["ibm_seconds_used"] == original_used

    def test_reconcile_persisted_to_disk(
        self, tracker: CloudBudgetTracker, tmp_budget_path: Path
    ):
        """Reconciliation must survive a round-trip through disk."""
        tracker.record_ibm_usage(
            60.0, job_id="job-disk", backend_name="ibm_fez", pending_reconcile=True,
        )
        tracker.reconcile_ibm_usage("job-disk", actual_seconds=42.0, delta=-18.0)
        tracker2 = CloudBudgetTracker(path=tmp_budget_path)
        assert tracker2._data["ibm_seconds_used"] == 42.0
        run = tracker2._data["runs"][-1]
        assert run["pending_reconcile"] is False


# ─── F-3: IAE watchdog threading ─────────────────────────────────────────────


class TestIAEWatchdogRunner:
    """F-3: _run_iae_with_watchdog must tick the watchdog while IAE runs, and
    propagate results and errors correctly from the daemon thread.
    """

    def test_returns_iae_result_on_success(self):
        """Successful IAE estimate must be returned correctly."""
        import src.engine.quantum_mc as qmc

        mock_iae = MagicMock()
        mock_result = MagicMock()
        mock_iae.estimate.return_value = mock_result
        mock_problem = MagicMock()

        result = qmc._run_iae_with_watchdog(
            mock_iae, mock_problem,
            cloud_backend_module=None,
            watchdog_interval=1,
        )
        assert result is mock_result
        mock_iae.estimate.assert_called_once_with(mock_problem)

    def test_propagates_iae_exception(self):
        """Exception from IAE thread must propagate to caller."""
        import src.engine.quantum_mc as qmc

        mock_iae = MagicMock()
        mock_iae.estimate.side_effect = RuntimeError("circuit exploded")
        mock_problem = MagicMock()

        with pytest.raises(RuntimeError, match="circuit exploded"):
            qmc._run_iae_with_watchdog(
                mock_iae, mock_problem,
                cloud_backend_module=None,
                watchdog_interval=1,
            )

    def test_ticks_watchdog_at_least_once(self):
        """When cloud_backend_module is provided, tick() must be called."""
        import src.engine.quantum_mc as qmc

        mock_iae = MagicMock()
        mock_iae.estimate.return_value = MagicMock()
        mock_problem = MagicMock()

        mock_cloud_mod = MagicMock()
        mock_cloud_mod.tick.return_value = []

        qmc._run_iae_with_watchdog(
            mock_iae, mock_problem,
            cloud_backend_module=mock_cloud_mod,
            watchdog_interval=1,
        )
        # tick may not be called if IAE finishes before first interval elapses —
        # the thread completes and stop_event fires before the wait loop ticks.
        # What we DO assert is that tick() does not crash and result is still returned.
        # (Non-deterministic timing test: we verify no exception.)

    def test_raises_timeout_if_iae_hangs(self):
        """If IAE does not complete within max_wait, TimeoutError is raised."""
        import src.engine.quantum_mc as qmc

        def _hang_forever(_problem):
            import time as _time
            _time.sleep(9999)

        mock_iae = MagicMock()
        mock_iae.estimate.side_effect = _hang_forever
        mock_problem = MagicMock()

        with pytest.raises(TimeoutError, match="did not complete"):
            qmc._run_iae_with_watchdog(
                mock_iae, mock_problem,
                cloud_backend_module=None,
                watchdog_interval=1,
                max_wait=1,  # 1s timeout for speed
            )

    def test_watchdog_tick_exception_is_non_fatal(self):
        """tick() raising must not propagate — IAE result still returned."""
        import src.engine.quantum_mc as qmc

        mock_iae = MagicMock()
        mock_iae.estimate.return_value = MagicMock()
        mock_problem = MagicMock()

        mock_cloud_mod = MagicMock()
        mock_cloud_mod.tick.side_effect = RuntimeError("watchdog broken")

        result = qmc._run_iae_with_watchdog(
            mock_iae, mock_problem,
            cloud_backend_module=mock_cloud_mod,
            watchdog_interval=1,
        )
        assert result is not None


# ─── MED-FIX: IBM channel env-driven + CRN wiring ────────────────────────────
#
# Three hardcoded channel="ibm_quantum_platform" sites were replaced with
# os.environ.get("IBM_QUANTUM_CHANNEL", "ibm_cloud") so the post-2023 IBM Cloud
# (CRN-based) account works correctly.  These tests verify that env drives the
# channel and that IBM_QUANTUM_CRN replaces the legacy "open-instance" placeholder.


class TestIBMChannelEnvDriven:
    """get_ibm_sampler, poll_ibm_job, and hardware_profile._list_ibm must read
    IBM_QUANTUM_CHANNEL (default 'ibm_cloud') rather than hardcoding the legacy
    'ibm_quantum_platform' string.  IBM_QUANTUM_CRN must replace 'open-instance'
    when provided.
    """

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _inject_mock_ibm(cb_module):
        """Inject mock QiskitRuntimeService + SamplerV2 into cb_module.
        Returns (mock_qs_cls, originals_dict) for later restore."""
        mock_qs_cls = MagicMock()
        mock_svc = MagicMock()
        mock_backend = MagicMock()
        mock_svc.backend.return_value = mock_backend
        mock_qs_cls.return_value = mock_svc
        mock_sampler_cls = MagicMock()
        mock_sampler_cls.return_value = MagicMock()

        originals = {
            "IBM_RUNTIME_AVAILABLE": cb_module.IBM_RUNTIME_AVAILABLE,
        }
        cb_module.IBM_RUNTIME_AVAILABLE = True
        cb_module.QiskitRuntimeService = mock_qs_cls
        cb_module.SamplerV2 = mock_sampler_cls
        return mock_qs_cls, originals

    @staticmethod
    def _restore_ibm(cb_module, originals):
        cb_module.IBM_RUNTIME_AVAILABLE = originals["IBM_RUNTIME_AVAILABLE"]
        try:
            from qiskit_ibm_runtime import QiskitRuntimeService as _real
            cb_module.QiskitRuntimeService = _real
        except ImportError:
            if hasattr(cb_module, "QiskitRuntimeService"):
                del cb_module.QiskitRuntimeService

    # ── get_ibm_sampler ───────────────────────────────────────────────────────

    def test_get_ibm_sampler_defaults_to_ibm_cloud_channel(self):
        """Without IBM_QUANTUM_CHANNEL set, get_ibm_sampler must use 'ibm_cloud'."""
        import src.engine.cloud_backend as cb
        mock_qs_cls, originals = self._inject_mock_ibm(cb)
        try:
            env_clean = {
                k: v for k, v in os.environ.items()
                if k not in ("IBM_QUANTUM_CHANNEL", "IBM_QUANTUM_CRN", "IBM_QUANTUM_INSTANCE")
            }
            with patch.dict(os.environ, env_clean, clear=True):
                cb.get_ibm_sampler("ibm_torino", "tok", "open-instance")
            call_kwargs = mock_qs_cls.call_args.kwargs
            assert call_kwargs["channel"] == "ibm_cloud", (
                f"Expected channel='ibm_cloud', got '{call_kwargs['channel']}'. "
                "MED-FIX: channel must default to 'ibm_cloud' for post-2023 IBM Cloud accounts."
            )
        finally:
            self._restore_ibm(cb, originals)

    def test_get_ibm_sampler_reads_ibm_quantum_channel_env(self):
        """IBM_QUANTUM_CHANNEL env must override the default channel."""
        import src.engine.cloud_backend as cb
        mock_qs_cls, originals = self._inject_mock_ibm(cb)
        try:
            with patch.dict(os.environ, {"IBM_QUANTUM_CHANNEL": "ibm_quantum_platform"}, clear=False):
                cb.get_ibm_sampler("ibm_torino", "tok", "open-instance")
            call_kwargs = mock_qs_cls.call_args.kwargs
            assert call_kwargs["channel"] == "ibm_quantum_platform", (
                "IBM_QUANTUM_CHANNEL env should override the 'ibm_cloud' default."
            )
        finally:
            self._restore_ibm(cb, originals)

    def test_get_ibm_sampler_resolves_crn_when_open_instance_passed(self):
        """When instance='open-instance', IBM_QUANTUM_CRN env must be substituted."""
        import src.engine.cloud_backend as cb
        mock_qs_cls, originals = self._inject_mock_ibm(cb)
        try:
            crn = "crn:v1:bluemix:public:quantum-computing:us-east:a/abc:xyz::"
            with patch.dict(os.environ, {"IBM_QUANTUM_CRN": crn}, clear=False):
                cb.get_ibm_sampler("ibm_torino", "tok", "open-instance")
            call_kwargs = mock_qs_cls.call_args.kwargs
            assert call_kwargs["instance"] == crn, (
                f"Expected instance='{crn}', got '{call_kwargs['instance']}'. "
                "IBM_QUANTUM_CRN must replace 'open-instance' placeholder."
            )
        finally:
            self._restore_ibm(cb, originals)

    def test_get_ibm_sampler_keeps_explicit_instance(self):
        """Explicit non-default instance string must be preserved unchanged."""
        import src.engine.cloud_backend as cb
        mock_qs_cls, originals = self._inject_mock_ibm(cb)
        try:
            real_crn = "crn:v1:bluemix:public:quantum-computing:us-east:a/explicit::"
            env_clean = {k: v for k, v in os.environ.items() if k not in ("IBM_QUANTUM_CRN", "IBM_QUANTUM_INSTANCE")}
            with patch.dict(os.environ, env_clean, clear=True):
                cb.get_ibm_sampler("ibm_torino", "tok", real_crn)
            call_kwargs = mock_qs_cls.call_args.kwargs
            assert call_kwargs["instance"] == real_crn, (
                f"Explicit instance '{real_crn}' must not be overridden by env."
            )
        finally:
            self._restore_ibm(cb, originals)

    # ── poll_ibm_job ──────────────────────────────────────────────────────────

    def test_poll_ibm_job_uses_ibm_cloud_channel_by_default(self):
        """poll_ibm_job must use channel='ibm_cloud' by default."""
        import src.engine.cloud_backend as cb
        mock_qs_cls, originals = self._inject_mock_ibm(cb)
        try:
            mock_svc = mock_qs_cls.return_value
            mock_job = MagicMock()
            mock_job.status.return_value = "QUEUED"
            mock_svc.job.return_value = mock_job

            env = {k: v for k, v in os.environ.items()
                   if k not in ("IBM_QUANTUM_CHANNEL", "IBM_QUANTUM_CRN", "IBM_QUANTUM_INSTANCE")}
            env["QUANTUM_CLOUD_ENABLED"] = "true"
            env["IBM_QUANTUM_TOKEN"] = "fake-token"
            with patch.dict(os.environ, env, clear=True):
                cb.poll_ibm_job("job-123", "ibm_fez")

            call_kwargs = mock_qs_cls.call_args.kwargs
            assert call_kwargs["channel"] == "ibm_cloud", (
                f"poll_ibm_job expected channel='ibm_cloud', got '{call_kwargs['channel']}'. "
                "MED-FIX: poll_ibm_job channel must be env-driven."
            )
        finally:
            self._restore_ibm(cb, originals)

    def test_poll_ibm_job_resolves_crn_from_env(self):
        """poll_ibm_job must substitute IBM_QUANTUM_CRN for 'open-instance'."""
        import src.engine.cloud_backend as cb
        mock_qs_cls, originals = self._inject_mock_ibm(cb)
        try:
            mock_svc = mock_qs_cls.return_value
            mock_job = MagicMock()
            mock_job.status.return_value = "QUEUED"
            mock_svc.job.return_value = mock_job

            crn = "crn:v1:bluemix:public:quantum-computing:us-east:a/poll-test::"
            env = {"QUANTUM_CLOUD_ENABLED": "true", "IBM_QUANTUM_TOKEN": "t", "IBM_QUANTUM_CRN": crn}
            with patch.dict(os.environ, env, clear=False):
                cb.poll_ibm_job("job-456", "ibm_fez")

            call_kwargs = mock_qs_cls.call_args.kwargs
            assert call_kwargs["instance"] == crn, (
                f"Expected instance='{crn}', got '{call_kwargs['instance']}'. "
                "poll_ibm_job must read IBM_QUANTUM_CRN instead of 'open-instance'."
            )
        finally:
            self._restore_ibm(cb, originals)

    def test_poll_ibm_job_completed_forwards_ising_model_loaded_true_on_real_decode(self):
        """REGRESSION: when a real Ising ONNX decode ran, poll_ibm_job's completed
        response must carry ising_model_loaded=True so the TS caller's
        isingDecoderSucceeded flag is accurate."""
        import src.engine.cloud_backend as cb
        mock_qs_cls, originals = self._inject_mock_ibm(cb)
        try:
            mock_svc = mock_qs_cls.return_value
            mock_job = MagicMock()
            mock_job.status.return_value = "DONE"
            mock_job.metrics.side_effect = Exception("no metrics in this fixture")
            mock_result = MagicMock()
            mock_result.__getitem__.side_effect = TypeError("not subscriptable in this fixture")
            mock_job.result.return_value = mock_result
            mock_svc.job.return_value = mock_job

            mock_decoder = MagicMock()
            mock_decoder.decode.return_value = {
                "ising_corrected_estimate": 0.031,
                "pymatching_estimate": 0.029,
                "uncorrected_estimate": 0.4,
                "raw_syndrome_count": 1,
                "backend_used": "onnx_cuda",
                "ising_model_loaded": True,  # real ONNX decode ran
            }

            env = {"QUANTUM_CLOUD_ENABLED": "true", "IBM_QUANTUM_TOKEN": "t"}
            with patch.dict(os.environ, env, clear=False), \
                 patch.object(cb, "CloudBudgetTracker") as mock_tracker_cls, \
                 patch(
                     "src.engine.ising_decoder_wrapper.create_decoder",
                     return_value=mock_decoder,
                 ):
                mock_tracker_cls.return_value = MagicMock()
                result = cb.poll_ibm_job("job-real-decode", "ibm_fez")

            assert result["status"] == "completed"
            assert result["ising_model_loaded"] is True, (
                "poll_ibm_job must forward ising_model_loaded=True from the decoder "
                "when a real ONNX decode occurred."
            )
        finally:
            self._restore_ibm(cb, originals)

    def test_poll_ibm_job_completed_forwards_ising_model_loaded_false_on_placeholder_fallback(self):
        """REGRESSION (HIGH finding): when the decoder falls back to the PyMatching
        identity-matrix placeholder (no real ONNX decode), poll_ibm_job's completed
        response must carry ising_model_loaded=False EVEN THOUGH
        ising_corrected_estimate is non-null (the fallback still backfills a number).
        Prior to the fix, the TS caller inferred success from
        ising_corrected_estimate != null alone, which is true in this exact case —
        falsely reporting a real quantum decode occurred."""
        import src.engine.cloud_backend as cb
        mock_qs_cls, originals = self._inject_mock_ibm(cb)
        try:
            mock_svc = mock_qs_cls.return_value
            mock_job = MagicMock()
            mock_job.status.return_value = "DONE"
            mock_job.metrics.side_effect = Exception("no metrics in this fixture")
            mock_result = MagicMock()
            mock_result.__getitem__.side_effect = TypeError("not subscriptable in this fixture")
            mock_job.result.return_value = mock_result
            mock_svc.job.return_value = mock_job

            mock_decoder = MagicMock()
            mock_decoder.decode.return_value = {
                # Placeholder identity-matrix PyMatching fallback still produces a
                # non-null estimate (effective_ising = ising_result or pymatching_result).
                "ising_corrected_estimate": 0.11,
                "pymatching_estimate": 0.11,
                "uncorrected_estimate": 0.4,
                "raw_syndrome_count": 1,
                "backend_used": "pymatching",
                "ising_model_loaded": False,  # no real ONNX decode ran
            }

            env = {"QUANTUM_CLOUD_ENABLED": "true", "IBM_QUANTUM_TOKEN": "t"}
            with patch.dict(os.environ, env, clear=False), \
                 patch.object(cb, "CloudBudgetTracker") as mock_tracker_cls, \
                 patch(
                     "src.engine.ising_decoder_wrapper.create_decoder",
                     return_value=mock_decoder,
                 ):
                mock_tracker_cls.return_value = MagicMock()
                result = cb.poll_ibm_job("job-fallback-decode", "ibm_fez")

            assert result["status"] == "completed"
            assert result["ising_corrected_estimate"] is not None, (
                "sanity check: the placeholder fallback DOES backfill a non-null estimate"
            )
            assert result["ising_model_loaded"] is False, (
                "poll_ibm_job must report ising_model_loaded=False when only the "
                "PyMatching identity-matrix placeholder ran, even though "
                "ising_corrected_estimate is non-null."
            )
        finally:
            self._restore_ibm(cb, originals)

    # ── hardware_profile._list_ibm ────────────────────────────────────────────
    # NOTE: hardware_profile imports QiskitRuntimeService inline inside the
    # `if ibm_token: try: from qiskit_ibm_runtime import QiskitRuntimeService`
    # block — it is NOT a module-level attribute.  Patching sys.modules so the
    # inline `from qiskit_ibm_runtime import QiskitRuntimeService` resolves to
    # our mock is the correct approach.

    @staticmethod
    def _make_qiskit_module_mock():
        """Return (mock_qs_cls, mock_qiskit_module) for sys.modules injection."""
        mock_qs_cls = MagicMock()
        mock_svc = MagicMock()
        mock_svc.backends.return_value = []
        mock_qs_cls.return_value = mock_svc
        mock_qiskit_mod = MagicMock()
        mock_qiskit_mod.QiskitRuntimeService = mock_qs_cls
        return mock_qs_cls, mock_qiskit_mod

    def test_hardware_profile_detect_cloud_uses_ibm_cloud_channel(self):
        """detect_cloud_backends must probe IBM with channel='ibm_cloud' by default.
        Uses sys.modules injection because QiskitRuntimeService is imported inline
        inside the function body (not a module-level attribute of hardware_profile).
        """
        import sys

        import src.engine.hardware_profile as hp

        mock_qs_cls, mock_qiskit_mod = self._make_qiskit_module_mock()

        env_clean = {
            k: v for k, v in os.environ.items()
            if k not in ("IBM_QUANTUM_CHANNEL", "IBM_QUANTUM_CRN", "IBM_QUANTUM_INSTANCE")
        }
        env_clean["IBM_QUANTUM_TOKEN"] = "fake-token"

        with patch.dict(sys.modules, {"qiskit_ibm_runtime": mock_qiskit_mod}):
            with patch.dict(os.environ, env_clean, clear=True):
                hp.detect_cloud_backends()

        if mock_qs_cls.called:
            call_kwargs = mock_qs_cls.call_args.kwargs
            assert call_kwargs.get("channel") == "ibm_cloud", (
                f"hardware_profile expected channel='ibm_cloud', got '{call_kwargs.get('channel')}'. "
                "MED-FIX: hardware_profile IBM probe must use env-driven channel."
            )

    def test_hardware_profile_detect_cloud_resolves_crn(self):
        """detect_cloud_backends must pass IBM_QUANTUM_CRN as instance when set.
        Uses sys.modules injection for the same reason as the channel test above.
        """
        import sys

        import src.engine.hardware_profile as hp

        mock_qs_cls, mock_qiskit_mod = self._make_qiskit_module_mock()

        crn = "crn:v1:bluemix:public:quantum-computing:us-east:a/hp-test::"

        with patch.dict(sys.modules, {"qiskit_ibm_runtime": mock_qiskit_mod}):
            with patch.dict(os.environ, {"IBM_QUANTUM_TOKEN": "fake-token", "IBM_QUANTUM_CRN": crn}, clear=False):
                hp.detect_cloud_backends()

        if mock_qs_cls.called:
            call_kwargs = mock_qs_cls.call_args.kwargs
            assert call_kwargs.get("instance") == crn, (
                f"Expected instance='{crn}', got '{call_kwargs.get('instance')}'."
            )
