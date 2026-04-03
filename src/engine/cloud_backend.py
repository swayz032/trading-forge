"""Cloud quantum backend abstraction — IBM Quantum + AWS Braket.

Provides a two-gate safety layer (opt_in_cloud + QUANTUM_CLOUD_ENABLED env)
before any cloud QPU call. Falls back to local simulation if either gate
is closed or budget is exhausted.

Governance: advisory layer only — no execution authority.

Usage:
    from src.engine.cloud_backend import CloudBackendConfig, resolve_backend
    config = CloudBackendConfig(provider="ibm", opt_in_cloud=True, ...)
    provider_name, backend_obj, label = resolve_backend(config, problem_size=20)
"""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ─── Optional cloud SDK imports ─────────────────────────────────────────────

try:
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
    IBM_RUNTIME_AVAILABLE = True
except ImportError:
    IBM_RUNTIME_AVAILABLE = False

try:
    from braket.aws import AwsDevice, AwsSession
    BRAKET_AVAILABLE = True
except ImportError:
    BRAKET_AVAILABLE = False

# ─── Governance Labels ───────────────────────────────────────────────────────

GOVERNANCE_LABELS = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "description": "Cloud QPU runs are experimental — advisory evidence only, never execution authority",
}

# ─── Device ARN Mapping ──────────────────────────────────────────────────────

BRAKET_DEVICES: dict[str, str] = {
    "ionq_forte1": "arn:aws:braket:us-east-1::device/qpu/ionq/Forte-1",
    "aquila": "arn:aws:braket:us-east-1::device/qpu/quera/Aquila",
    "sv1": "arn:aws:braket:::device/quantum-simulator/amazon/sv1",
    "tn1": "arn:aws:braket:::device/quantum-simulator/amazon/tn1",
    "dm1": "arn:aws:braket:::device/quantum-simulator/amazon/dm1",
}

# SV1 is the cheapest Braket simulator — used as cloud fallback before local
BRAKET_SV1_COST_PER_TASK: float = 0.075   # AWS Braket SV1: $0.075/task (approx)

# ─── Config ──────────────────────────────────────────────────────────────────


class CloudBackendConfig(BaseModel):
    """Configuration for cloud quantum backend selection."""
    provider: Literal["ibm", "braket", "local"] = "local"
    backend_name: Optional[str] = None      # e.g. "ibm_torino", "sv1", "ionq_forte1"
    ibm_token: Optional[str] = None          # Override; else read IBM_QUANTUM_TOKEN env
    ibm_instance: str = "open-instance"
    braket_region: str = "us-east-1"
    braket_s3_bucket: str = "amazon-braket-trading-forge"
    budget_limit_seconds: int = 600          # IBM: 10 min/month hard cap
    budget_limit_dollars: float = 30.0       # Braket: $30/month hard cap
    opt_in_cloud: bool = False               # Must be explicitly True to use cloud


# ─── Budget Tracker ──────────────────────────────────────────────────────────

_BUDGET_PATH = Path.home() / ".trading-forge" / "cloud_budget.json"
_PESSIMISM_FACTOR = 2.0   # Budget checks always assume 2x the estimated cost


class CloudBudgetTracker:
    """Persistent budget tracker for IBM and Braket spend.

    Reads and writes ~/.trading-forge/cloud_budget.json.
    Monthly auto-reset: when the stored reset_month differs from today's
    year-month, all counters reset to zero.

    The pessimism factor (2x) is applied at the guard check, not at record
    time.  Actual usage is always recorded truthfully.
    """

    def __init__(self, path: Path = _BUDGET_PATH) -> None:
        self._path = path
        self._data: dict[str, Any] = self._load()

    # ── Internal I/O ────────────────────────────────────────────────────────

    def _load(self) -> dict[str, Any]:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if self._path.exists():
            try:
                with open(self._path, "r") as fh:
                    data = json.load(fh)
                # Auto-reset if the stored month doesn't match this month
                this_month = datetime.now(timezone.utc).strftime("%Y-%m")
                if data.get("reset_month") != this_month:
                    data = self._empty_budget(this_month)
                return data
            except (json.JSONDecodeError, OSError):
                pass
        return self._empty_budget(datetime.now(timezone.utc).strftime("%Y-%m"))

    @staticmethod
    def _empty_budget(month: str) -> dict[str, Any]:
        return {
            "reset_month": month,
            "ibm_seconds_used": 0,
            "braket_dollars_used": 0.0,
            "runs": [],
        }

    def _save(self) -> None:
        try:
            with open(self._path, "w") as fh:
                json.dump(self._data, fh, indent=2)
        except OSError as exc:
            logger.warning("cloud_budget: could not save budget file: %s", exc)

    # ── Guard checks (pessimistic) ───────────────────────────────────────────

    def can_run_ibm(self, estimated_seconds: float, limit_seconds: int) -> bool:
        """Return True only if pessimistic estimate fits within the monthly cap."""
        pessimistic = estimated_seconds * _PESSIMISM_FACTOR
        used = self._data.get("ibm_seconds_used", 0)
        return (used + pessimistic) <= limit_seconds

    def can_run_braket(self, estimated_cost: float, limit_dollars: float) -> bool:
        """Return True only if pessimistic estimate fits within the monthly cap."""
        pessimistic = estimated_cost * _PESSIMISM_FACTOR
        used = self._data.get("braket_dollars_used", 0.0)
        return (used + pessimistic) <= limit_dollars

    # ── Usage recording (truthful) ───────────────────────────────────────────

    def record_ibm_usage(
        self, seconds: float, job_id: str, backend_name: str
    ) -> None:
        """Record actual IBM runtime seconds consumed."""
        self._data["ibm_seconds_used"] = (
            self._data.get("ibm_seconds_used", 0) + seconds
        )
        self._data.setdefault("runs", []).append(
            {
                "provider": "ibm",
                "ts": datetime.now(timezone.utc).isoformat(),
                "job_id": job_id,
                "backend_name": backend_name,
                "seconds": seconds,
            }
        )
        self._save()

    def record_braket_usage(
        self, cost: float, task_arn: str, device_name: str
    ) -> None:
        """Record actual Braket dollar cost consumed."""
        self._data["braket_dollars_used"] = (
            self._data.get("braket_dollars_used", 0.0) + cost
        )
        self._data.setdefault("runs", []).append(
            {
                "provider": "braket",
                "ts": datetime.now(timezone.utc).isoformat(),
                "task_arn": task_arn,
                "device_name": device_name,
                "cost_usd": cost,
            }
        )
        self._save()

    def get_remaining(self) -> dict[str, Any]:
        """Return remaining budget for both providers and reset metadata."""
        # Re-load to pick up any resets that may have happened since init
        self._data = self._load()
        return {
            "reset_month": self._data.get("reset_month"),
            "ibm_seconds_remaining": max(
                0,
                600 - self._data.get("ibm_seconds_used", 0),
            ),
            "braket_dollars_remaining": max(
                0.0,
                30.0 - self._data.get("braket_dollars_used", 0.0),
            ),
            "ibm_seconds_used": self._data.get("ibm_seconds_used", 0),
            "braket_dollars_used": self._data.get("braket_dollars_used", 0.0),
            "governance_labels": GOVERNANCE_LABELS,
        }


# ─── Provider factories ───────────────────────────────────────────────────────


def get_ibm_sampler(
    backend_name: str, token: str, instance: str
) -> "SamplerV2":
    """Return a QiskitRuntimeService SamplerV2 connected to the named backend.

    Raises:
        ImportError: if qiskit-ibm-runtime is not installed.
        RuntimeError: if authentication or backend lookup fails.
    """
    if not IBM_RUNTIME_AVAILABLE:
        raise ImportError(
            "qiskit-ibm-runtime is not installed. "
            "Run: pip install 'qiskit-ibm-runtime>=0.46.0'"
        )
    service = QiskitRuntimeService(
        channel="ibm_quantum_platform",
        token=token,
        instance=instance,
    )
    backend = service.backend(backend_name)
    sampler = SamplerV2(backend=backend)
    return sampler


def get_braket_device(device_arn: str, region: str) -> "AwsDevice":
    """Return an AwsDevice for the given ARN and region.

    Raises:
        ImportError: if amazon-braket-sdk is not installed.
        RuntimeError: if AWS credentials are absent or the device is unavailable.
    """
    if not BRAKET_AVAILABLE:
        raise ImportError(
            "amazon-braket-sdk is not installed. "
            "Run: pip install 'amazon-braket-sdk>=1.90.0'"
        )
    try:
        import boto3
        boto_session = boto3.Session(region_name=region)
        aws_session = AwsSession(boto_session=boto_session)
    except Exception as exc:
        raise RuntimeError(
            f"Failed to create AWS session for Braket: {exc}"
        ) from exc
    return AwsDevice(device_arn, aws_session=aws_session)


# ─── Backend resolver ─────────────────────────────────────────────────────────


def resolve_backend(
    config: CloudBackendConfig,
    problem_size: int,
    budget_tracker: Optional[CloudBudgetTracker] = None,
) -> tuple[str, Any, str]:
    """Resolve the best backend for a given problem size.

    Returns (provider_name, backend_object, label_string).

    Fallback chain:
      1. opt_in_cloud=False or QUANTUM_CLOUD_ENABLED=false  → local immediately
      2. provider="ibm" and IBM budget allows               → IBM SamplerV2
      3. provider="braket" and Braket budget allows         → Braket QPU/device
      4. Cloud fails or budget exhausted                    → Braket SV1 simulator
      5. All cloud fails                                    → local (Aer/CPU)

    AUTHORITY NOTE: This function selects a backend for experimental evidence
    generation only.  It has no execution authority.  The returned object must
    only be used inside challenger modules that carry GOVERNANCE_LABELS.
    """
    from src.engine.hardware_profile import select_backend as local_select_backend

    tracker = budget_tracker or CloudBudgetTracker()

    # ── Gate 1: explicit opt-in ──────────────────────────────────────────────
    if not config.opt_in_cloud:
        label = local_select_backend(problem_size)
        logger.debug("resolve_backend: opt_in_cloud=False → local (%s)", label)
        return ("local", None, label)

    # ── Gate 2: environment kill-switch ─────────────────────────────────────
    env_flag = os.environ.get("QUANTUM_CLOUD_ENABLED", "").lower()
    if env_flag == "false":
        label = local_select_backend(problem_size)
        logger.debug(
            "resolve_backend: QUANTUM_CLOUD_ENABLED=false → local (%s)", label
        )
        return ("local", None, label)

    # ── IBM path ─────────────────────────────────────────────────────────────
    if config.provider == "ibm":
        if not IBM_RUNTIME_AVAILABLE:
            logger.warning(
                "resolve_backend: IBM selected but qiskit-ibm-runtime not installed → fallback"
            )
        else:
            token = config.ibm_token or os.environ.get("IBM_QUANTUM_TOKEN", "")
            if not token:
                logger.warning(
                    "resolve_backend: IBM selected but IBM_QUANTUM_TOKEN not set → fallback"
                )
            else:
                # Rough estimate: 60s per job as a conservative default
                estimated_seconds = 60.0
                if tracker.can_run_ibm(estimated_seconds, config.budget_limit_seconds):
                    try:
                        backend_name = config.backend_name or "ibm_torino"
                        sampler = get_ibm_sampler(
                            backend_name, token, config.ibm_instance
                        )
                        label = f"ibm_qpu:{backend_name}"
                        logger.info(
                            "resolve_backend: resolved IBM QPU backend=%s", backend_name
                        )
                        return ("ibm", sampler, label)
                    except Exception as exc:
                        logger.warning(
                            "resolve_backend: IBM backend init failed: %s → fallback", exc
                        )
                else:
                    logger.warning(
                        "resolve_backend: IBM budget exhausted (used=%ds, limit=%ds) → fallback",
                        tracker._data.get("ibm_seconds_used", 0),
                        config.budget_limit_seconds,
                    )

    # ── Braket QPU/named device path ─────────────────────────────────────────
    if config.provider == "braket":
        if not BRAKET_AVAILABLE:
            logger.warning(
                "resolve_backend: Braket selected but amazon-braket-sdk not installed → fallback"
            )
        else:
            device_key = config.backend_name or "sv1"
            device_arn = BRAKET_DEVICES.get(device_key)
            if device_arn is None:
                logger.warning(
                    "resolve_backend: unknown Braket device '%s' → fallback", device_key
                )
            else:
                estimated_cost = BRAKET_SV1_COST_PER_TASK  # conservative default
                if tracker.can_run_braket(estimated_cost, config.budget_limit_dollars):
                    try:
                        device = get_braket_device(device_arn, config.braket_region)
                        label = f"braket_{device_key}"
                        logger.info(
                            "resolve_backend: resolved Braket device=%s arn=%s",
                            device_key,
                            device_arn,
                        )
                        return ("braket", device, label)
                    except Exception as exc:
                        logger.warning(
                            "resolve_backend: Braket device init failed: %s → SV1 fallback",
                            exc,
                        )
                else:
                    logger.warning(
                        "resolve_backend: Braket budget exhausted (used=$%.2f, limit=$%.2f) → SV1 fallback",
                        tracker._data.get("braket_dollars_used", 0.0),
                        config.budget_limit_dollars,
                    )

    # ── Braket SV1 cloud simulator fallback ──────────────────────────────────
    if BRAKET_AVAILABLE:
        sv1_arn = BRAKET_DEVICES["sv1"]
        if tracker.can_run_braket(BRAKET_SV1_COST_PER_TASK, config.budget_limit_dollars):
            try:
                device = get_braket_device(sv1_arn, config.braket_region)
                logger.info(
                    "resolve_backend: using Braket SV1 cloud simulator as fallback"
                )
                return ("braket", device, "braket_sv1")
            except Exception as exc:
                logger.warning(
                    "resolve_backend: Braket SV1 fallback failed: %s → local", exc
                )

    # ── Local fallback (always available) ────────────────────────────────────
    label = local_select_backend(problem_size)
    logger.info(
        "resolve_backend: all cloud paths exhausted → local (%s)", label
    )
    return ("local", None, label)


# ─── Runtime metadata helper ─────────────────────────────────────────────────


def build_cloud_run_metadata(
    provider_name: str,
    label: str,
    start_time: float,
    job_id: str = "",
    task_arn: str = "",
    estimated_cost: float = 0.0,
) -> dict[str, Any]:
    """Package runtime provenance metadata for challenger evidence output.

    Call this after a cloud run completes.  Attach to the challenger result so
    downstream critics can determine cloud vs local execution context.
    """
    return {
        "provider": provider_name,
        "backend_label": label,
        "execution_ms": int((time.time() - start_time) * 1000),
        "job_id": job_id,
        "task_arn": task_arn,
        "estimated_cost_usd": estimated_cost,
        "run_ts": datetime.now(timezone.utc).isoformat(),
        "cloud_sdk_available": {
            "ibm_runtime": IBM_RUNTIME_AVAILABLE,
            "braket": BRAKET_AVAILABLE,
        },
        "governance_labels": GOVERNANCE_LABELS,
    }
