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

import hashlib
import json
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional, TypedDict

from filelock import FileLock
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
        this_month = datetime.now(timezone.utc).strftime("%Y-%m")
        if self._path.exists():
            try:
                # Treat zero-byte file as missing
                if self._path.stat().st_size == 0:
                    raise ValueError("budget file is empty")
                with open(self._path, "r") as fh:
                    data = json.load(fh)
                # Auto-reset if the stored month doesn't match this month
                if data.get("reset_month") != this_month:
                    data = self._empty_budget(this_month)
                return data
            except (json.JSONDecodeError, OSError, ValueError) as exc:
                # Write an audit marker so a human can investigate and recover
                ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                audit_path = self._path.parent / f"cloud_budget_corrupted_{ts}.json"
                try:
                    # Read raw bytes for the audit record (best-effort)
                    raw = self._path.read_text(errors="replace") if self._path.exists() else ""
                    audit_path.write_text(
                        json.dumps(
                            {
                                "ts": ts,
                                "reason": str(exc),
                                "raw_content": raw[:4096],  # cap to avoid huge files
                            },
                            indent=2,
                        )
                    )
                except OSError:
                    pass  # audit write failing must not block startup
                logger.warning(
                    "cloud_budget: budget file corrupt/empty (%s) — treating as fresh budget."
                    " Audit marker written to %s",
                    exc,
                    audit_path,
                )
        return self._empty_budget(this_month)

    @staticmethod
    def _empty_budget(month: str) -> dict[str, Any]:
        return {
            "reset_month": month,
            "ibm_seconds_used": 0,
            "braket_dollars_used": 0.0,
            "runs": [],
        }

    def _save(self) -> None:
        """Atomically persist budget data.

        Pattern:
          1. Acquire a file-level lock (filelock — cross-platform).
          2. Write to a sibling .tmp file in the same directory.
          3. os.replace() — atomic on both POSIX and Windows (same FS).
          4. On any failure, log a warning but do NOT corrupt the existing file.
        """
        lock_path = self._path.with_suffix(".lock")
        tmp_path = self._path.with_suffix(".tmp")
        try:
            with FileLock(str(lock_path), timeout=5):
                try:
                    with open(tmp_path, "w") as fh:
                        json.dump(self._data, fh, indent=2)
                    os.replace(tmp_path, self._path)
                except OSError as exc:
                    logger.warning("cloud_budget: atomic write failed: %s", exc)
                    # Best-effort cleanup of orphaned tmp
                    try:
                        tmp_path.unlink(missing_ok=True)
                    except OSError:
                        pass
        except Exception as exc:
            logger.warning("cloud_budget: could not acquire lock or save: %s", exc)

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


# ─── Result Cache (P2-1) ─────────────────────────────────────────────────────

_CACHE_DIR = Path.home() / ".trading-forge" / "quantum_cache"
_CACHE_TTL_DAYS: int = 30   # Stale cache entries older than this are ignored


def _params_hash(params: Any) -> str:
    """Return a 16-char hex SHA-256 of the JSON-serialised params dict.

    Uses sort_keys=True so key order doesn't affect the hash.
    Works for any JSON-serialisable value (dict, list, scalar).
    """
    serialised = json.dumps(params, sort_keys=True, default=str).encode()
    return hashlib.sha256(serialised).hexdigest()[:16]


class QuantumResultCache:
    """Lightweight file-based cache keyed by (algorithm, strategy_id, params_hash).

    Layout: ~/.trading-forge/quantum_cache/<algorithm>_<params_hash>.json

    Each cache file stores ONE entry plus its provenance metadata.  A hit is
    returned only when the entry is younger than _CACHE_TTL_DAYS.

    This is a PERF + COST optimisation for the challenger layer; it does NOT
    affect correctness.  Cache reads/writes are best-effort — any failure
    returns a miss so the real quantum run proceeds normally.

    Governance: advisory layer only.  Cached results carry the same governance
    labels as fresh results and MUST NOT be promoted to authoritative.
    """

    def __init__(self, cache_dir: Path = _CACHE_DIR) -> None:
        self._dir = cache_dir
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            logger.warning("quantum_cache: could not create cache dir: %s", exc)

    def _path_for(self, algorithm: str, params_hash: str) -> Path:
        safe_algo = algorithm.replace("/", "_").replace("\\", "_")
        return self._dir / f"{safe_algo}_{params_hash}.json"

    def get(
        self,
        algorithm: str,
        params: Any,
        strategy_id: str = "",
    ) -> Optional[dict[str, Any]]:
        """Return cached result dict (with ``cache_hit: true``) or None on miss.

        Args:
            algorithm:   One of "sqa", "qubo", "qmc", "tensor", "rl", etc.
            params:      Any JSON-serialisable object representing the run params.
            strategy_id: Optional strategy identifier stored for provenance only.
        """
        ph = _params_hash(params)
        cache_path = self._path_for(algorithm, ph)
        try:
            if not cache_path.exists():
                return None
            raw = cache_path.read_text(encoding="utf-8")
            entry = json.loads(raw)
            # TTL check
            cached_ts = entry.get("_cache_ts", "")
            if cached_ts:
                from datetime import timedelta
                cached_dt = datetime.fromisoformat(cached_ts)
                age = datetime.now(timezone.utc) - cached_dt.replace(tzinfo=timezone.utc)
                if age.days >= _CACHE_TTL_DAYS:
                    logger.debug(
                        "quantum_cache: stale hit for %s/%s (%d days old) — ignoring",
                        algorithm,
                        ph,
                        age.days,
                    )
                    return None
            result = entry.get("result")
            if result is None:
                return None
            result["cache_hit"] = True
            result["cache_algorithm"] = algorithm
            result["cache_params_hash"] = ph
            result["cache_strategy_id"] = strategy_id
            logger.info(
                "quantum_cache: HIT algorithm=%s params_hash=%s strategy_id=%s",
                algorithm,
                ph,
                strategy_id,
            )
            return result
        except Exception as exc:
            logger.debug("quantum_cache: get failed (%s) — treating as miss", exc)
            return None

    def put(
        self,
        algorithm: str,
        params: Any,
        result: dict[str, Any],
        strategy_id: str = "",
    ) -> None:
        """Persist result to cache.  Failures are logged and swallowed."""
        ph = _params_hash(params)
        cache_path = self._path_for(algorithm, ph)
        lock_path = cache_path.with_suffix(".lock")
        tmp_path = cache_path.with_suffix(".tmp")
        entry = {
            "_cache_ts": datetime.now(timezone.utc).isoformat(),
            "_algorithm": algorithm,
            "_params_hash": ph,
            "_strategy_id": strategy_id,
            "result": result,
        }
        try:
            with FileLock(str(lock_path), timeout=3):
                try:
                    with open(tmp_path, "w", encoding="utf-8") as fh:
                        json.dump(entry, fh, indent=2, default=str)
                    os.replace(tmp_path, cache_path)
                    logger.debug(
                        "quantum_cache: wrote algorithm=%s params_hash=%s", algorithm, ph
                    )
                except OSError as exc:
                    logger.warning("quantum_cache: write failed: %s", exc)
                    try:
                        tmp_path.unlink(missing_ok=True)
                    except OSError:
                        pass
        except Exception as exc:
            logger.warning("quantum_cache: could not acquire lock or write: %s", exc)


# Singleton — callers can import and reuse without re-instantiating.
quantum_result_cache = QuantumResultCache()


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


# ─── Mid-job kill watchdog ────────────────────────────────────────────────────
#
# Watchdog design:
#   - No background thread — callers invoke tick() from their own progress loops.
#   - WATCHDOG_TICK_INTERVAL_SEC is the recommended tick cadence (30 s).
#   - Callers (quantum_mc.py, quantum_annealing_optimizer.py, etc.) should call
#     cloud_backend.tick() every ~30 s during long-running cloud jobs.
#   - On each tick, check_running_jobs() inspects _active_jobs, computes
#     pessimistic accumulated spend, and calls SDK cancel() if over budget.
#   - IBM: RuntimeJob.cancel() — real API (qiskit-ibm-runtime).
#   - Braket: AwsQuantumTask.cancel() — real API (amazon-braket-sdk).
#   - If SDK cancel() raises, the failure is logged and the job is marked
#     "cancellation_requested" so the next preflight still sees the estimated cost.
#   - An audit marker file is written on every kill attempt for post-mortem.
#
# SDK cancel support:
#   - IBM Qiskit RuntimeJob.cancel() — available; raises RuntimeJobFailureError on
#     failure (e.g. already completed).
#   - Braket AwsQuantumTask.cancel() — available; raises if already terminal.
#   Both are real APIs; this implementation uses them directly.

WATCHDOG_TICK_INTERVAL_SEC: int = 30  # Recommended tick cadence for callers

_ACTIVE_JOBS_PATH = Path.home() / ".trading-forge" / "active_quantum_jobs.json"


class JobMetadata(TypedDict):
    """Metadata for a registered in-flight cloud quantum job."""
    job_id: str
    backend: str          # "ibm" | "braket"
    start_time: float     # time.time() at submission
    estimated_cost: float # Estimated cost in provider-native units (seconds for IBM, dollars for Braket)
    sdk_handle_ref: str   # "ibm:<job_id>" or "braket:<task_arn>" — handle stored out-of-band
    circuit_qubits: int
    status: str           # "running" | "cancellation_requested" | "orphaned"


class CloudJobRegistry:
    """In-flight job registry with atomic persistence.

    Stores job metadata in ~/.trading-forge/active_quantum_jobs.json so that
    restarts can reconcile any jobs that ran too long.

    SDK handles (RuntimeJob / AwsQuantumTask) are NOT serialised — they are
    stored in a separate in-memory dict keyed by job_id.  On restart any
    persisted jobs without an SDK handle are marked "orphaned"; their estimated
    cost is included in the next preflight's accumulated-spend check.

    Governance: advisory layer only.  The registry has NO execution authority.
    """

    def __init__(self, path: Path = _ACTIVE_JOBS_PATH) -> None:
        self._path = path
        self._sdk_handles: dict[str, Any] = {}   # job_id → sdk_handle (in-memory only)
        self._jobs: dict[str, JobMetadata] = {}
        self._load()

    # ── Persistence ─────────────────────────────────────────────────────────

    def _load(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if self._path.exists():
            try:
                if self._path.stat().st_size == 0:
                    return
                with open(self._path, "r", encoding="utf-8") as fh:
                    raw: dict[str, Any] = json.load(fh)
                for job_id, meta in raw.items():
                    # Jobs with no SDK handle after restart are orphaned
                    meta["status"] = "orphaned"
                    self._jobs[job_id] = meta  # type: ignore[assignment]
                if self._jobs:
                    logger.info(
                        "cloud_watchdog: recovered %d orphaned jobs from %s",
                        len(self._jobs),
                        self._path,
                    )
            except (json.JSONDecodeError, OSError, KeyError, TypeError) as exc:
                logger.warning("cloud_watchdog: could not load job registry: %s", exc)

    def _save(self) -> None:
        """Atomically persist job registry (filelock + tmp + os.replace)."""
        lock_path = self._path.with_suffix(".lock")
        tmp_path = self._path.with_suffix(".tmp")
        # Serialise without sdk_handle_ref (already a string tag, not the object)
        try:
            with FileLock(str(lock_path), timeout=5):
                try:
                    with open(tmp_path, "w", encoding="utf-8") as fh:
                        json.dump(self._jobs, fh, indent=2, default=str)
                    os.replace(tmp_path, self._path)
                except OSError as exc:
                    logger.warning("cloud_watchdog: atomic write failed: %s", exc)
                    try:
                        tmp_path.unlink(missing_ok=True)
                    except OSError:
                        pass
        except Exception as exc:
            logger.warning("cloud_watchdog: could not acquire lock or save registry: %s", exc)

    # ── Job lifecycle ────────────────────────────────────────────────────────

    def register_job(
        self,
        job_id: str,
        backend: Literal["ibm", "braket"],
        sdk_handle: Any,
        estimated_cost: float,
        circuit_qubits: int = 0,
    ) -> None:
        """Record a job at submission time and persist immediately."""
        meta: JobMetadata = {
            "job_id": job_id,
            "backend": backend,
            "start_time": time.time(),
            "estimated_cost": estimated_cost,
            "sdk_handle_ref": f"{backend}:{job_id}",
            "circuit_qubits": circuit_qubits,
            "status": "running",
        }
        self._jobs[job_id] = meta
        self._sdk_handles[job_id] = sdk_handle
        self._save()
        logger.info(
            "cloud_watchdog: registered job_id=%s backend=%s estimated_cost=%s",
            job_id, backend, estimated_cost,
        )

    def unregister_job(self, job_id: str, actual_cost: float = 0.0) -> None:
        """Remove a job after completion and return actual cost for budget recording.

        Callers should then call tracker.record_ibm_usage() or
        tracker.record_braket_usage() with actual_cost.
        """
        if job_id in self._jobs:
            del self._jobs[job_id]
        self._sdk_handles.pop(job_id, None)
        self._save()
        logger.info(
            "cloud_watchdog: unregistered job_id=%s actual_cost=%s",
            job_id, actual_cost,
        )

    # ── Watchdog tick ────────────────────────────────────────────────────────

    def check_running_jobs(
        self,
        budget_tracker: "CloudBudgetTracker",
        ibm_limit_seconds: int = 600,
        braket_limit_dollars: float = 30.0,
        now: Optional[float] = None,
    ) -> list[str]:
        """Inspect all registered jobs; cancel any that would push spend over cap.

        Returns list of job_ids for which cancellation was attempted.

        This is deliberately NOT called on a background thread — callers invoke
        tick() (which calls this method) from their own progress loops.

        SDK cancellation:
          - IBM: sdk_handle.cancel()  (qiskit-ibm-runtime RuntimeJob)
          - Braket: sdk_handle.cancel()  (amazon-braket-sdk AwsQuantumTask)
          Both APIs exist and are used here.  If cancellation fails, the job is
          marked "cancellation_requested" so preflight sees the estimated cost.
        """
        if not self._jobs:
            return []

        _now = now if now is not None else time.time()
        cancelled: list[str] = []

        # Snapshot keys to avoid mutation-during-iteration
        for job_id, meta in list(self._jobs.items()):
            backend = meta["backend"]
            elapsed = _now - meta["start_time"]
            estimated_cost = meta["estimated_cost"]

            # Compute pessimistic accumulated spend: recorded usage + this job's estimate
            if backend == "ibm":
                used = budget_tracker._data.get("ibm_seconds_used", 0)
                projected = used + estimated_cost * _PESSIMISM_FACTOR
                over_budget = projected > ibm_limit_seconds
            else:  # braket
                used = budget_tracker._data.get("braket_dollars_used", 0.0)
                projected = used + estimated_cost * _PESSIMISM_FACTOR
                over_budget = projected > braket_limit_dollars

            if not over_budget:
                continue

            # Over budget — attempt SDK cancellation
            logger.warning(
                "cloud_watchdog: job_id=%s backend=%s projected_spend=%s exceeds cap — "
                "attempting cancellation (elapsed=%.1fs)",
                job_id, backend, projected, elapsed,
            )

            sdk_handle = self._sdk_handles.get(job_id)
            cancel_success = False
            cancel_error: str = ""

            if sdk_handle is not None:
                try:
                    sdk_handle.cancel()
                    cancel_success = True
                    logger.info(
                        "cloud_watchdog: successfully called cancel() on job_id=%s", job_id
                    )
                except Exception as exc:
                    cancel_error = str(exc)
                    logger.warning(
                        "cloud_watchdog: cancel() failed for job_id=%s: %s "
                        "(SDK may have already terminated the job or cancel is unsupported)",
                        job_id, exc,
                    )
            else:
                cancel_error = "sdk_handle_not_available_after_restart"
                logger.warning(
                    "cloud_watchdog: no SDK handle for job_id=%s (orphaned job) — "
                    "cannot cancel; marking cancellation_requested",
                    job_id,
                )

            # Update status regardless of cancel success
            meta["status"] = "cancellation_requested"
            self._jobs[job_id] = meta

            # Write audit marker for post-mortem
            ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            audit_dir = self._path.parent
            audit_file = audit_dir / f"cloud_budget_kill_{job_id}_{ts}.json"
            try:
                audit_data = {
                    "ts": ts,
                    "job_id": job_id,
                    "backend": backend,
                    "elapsed_seconds": elapsed,
                    "estimated_cost": estimated_cost,
                    "projected_spend": projected,
                    "used_before_kill": used,
                    "cancel_success": cancel_success,
                    "cancel_error": cancel_error,
                    "governance_labels": GOVERNANCE_LABELS,
                }
                with open(audit_file, "w", encoding="utf-8") as fh:
                    json.dump(audit_data, fh, indent=2, default=str)
            except OSError as exc:
                logger.warning("cloud_watchdog: could not write audit marker: %s", exc)

            cancelled.append(job_id)

        if cancelled:
            self._save()

        return cancelled

    def get_active_estimated_spend(self, backend: Literal["ibm", "braket"]) -> float:
        """Sum estimated costs for all currently registered jobs of this backend.

        Used by preflight guards to account for in-flight spend before accepting
        a new job.
        """
        return sum(
            m["estimated_cost"]
            for m in self._jobs.values()
            if m["backend"] == backend and m["status"] in ("running", "cancellation_requested")
        )


# Module-level job registry singleton
cloud_job_registry = CloudJobRegistry()


def tick(
    budget_tracker: Optional["CloudBudgetTracker"] = None,
    ibm_limit_seconds: int = 600,
    braket_limit_dollars: float = 30.0,
) -> list[str]:
    """Public watchdog tick — call from caller progress loops every ~30s.

    Checks all registered in-flight jobs against the budget caps and cancels
    any that would push accumulated spend over the limit.

    Args:
        budget_tracker: Optional tracker; defaults to a fresh CloudBudgetTracker().
        ibm_limit_seconds: IBM monthly cap in seconds (default 600).
        braket_limit_dollars: Braket monthly cap in dollars (default 30.0).

    Returns:
        List of job_ids for which cancellation was attempted.

    Integration note (TODO for callers):
        - quantum_mc.py: call tick() every WATCHDOG_TICK_INTERVAL_SEC inside long IAE loops.
        - quantum_annealing_optimizer.py: call tick() between SQA sweep batches.
        - qubo_trade_timing.py: call tick() between QUBO solve iterations.
        - quantum_rl_agent.py: call tick() every N episodes when cloud device is active.
    """
    tracker = budget_tracker or CloudBudgetTracker()
    return cloud_job_registry.check_running_jobs(
        tracker,
        ibm_limit_seconds=ibm_limit_seconds,
        braket_limit_dollars=braket_limit_dollars,
    )


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
