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
import tempfile
from pathlib import Path
from typing import Any
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
