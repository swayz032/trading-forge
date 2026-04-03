"""Quantum Monte Carlo engine — IAE amplitude estimation via Qiskit.

Uses Iterative Amplitude Estimation to estimate risk probabilities.
All runs are experimental challenger-only — never authoritative.

Algorithm: IAE (Iterative Amplitude Estimation)
Backend: aer_statevector (27-28 qubits GPU, 30-31 CPU)
Governance: experimental: true, authoritative: false, decision_role: challenger_only

Usage:
    python -m src.engine.quantum_mc --input-json '{"model": {...}, "event": {...}}'
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
import time
from typing import Optional

import numpy as np
from pydantic import BaseModel, Field

from src.engine.quantum_models import UncertaintyModel
from src.engine.hardware_profile import select_backend, get_hardware_profile

# Optional Qiskit imports
try:
    from qiskit import QuantumCircuit
    from qiskit.circuit.library import LinearAmplitudeFunction
    QISKIT_AVAILABLE = True
except ImportError:
    QISKIT_AVAILABLE = False

try:
    from qiskit_algorithms import IterativeAmplitudeEstimation, EstimationProblem
    QISKIT_ALGORITHMS_AVAILABLE = True
except ImportError:
    QISKIT_ALGORITHMS_AVAILABLE = False

try:
    from qiskit_aer.primitives import Sampler as AerSampler
    AER_SAMPLER_AVAILABLE = True
except ImportError:
    try:
        from qiskit.primitives import Sampler as AerSampler  # type: ignore[no-redef]
        AER_SAMPLER_AVAILABLE = True
    except ImportError:
        AER_SAMPLER_AVAILABLE = False

try:
    from qiskit_aer import AerSimulator
    AER_AVAILABLE = True
except ImportError:
    AER_AVAILABLE = False

try:
    from src.engine.cloud_backend import CloudBackendConfig, CloudBudgetTracker, resolve_backend, build_cloud_run_metadata
    CLOUD_BACKEND_AVAILABLE = True
except ImportError:
    CLOUD_BACKEND_AVAILABLE = False


# ─── Governance Labels ──────────────────────────────────────────
GOVERNANCE_LABELS = {
    "experimental": True,
    "authoritative": False,
    "decision_role": "challenger_only",
    "description": "Quantum estimates are experimental — always compare with classical MC",
}


class QuantumRunConfig(BaseModel):
    """Configuration for a quantum MC run."""
    model: dict  # Serialized UncertaintyModel
    event_type: str  # breach | ruin | target_hit | tail_loss
    threshold: float
    epsilon: float = 0.01  # Target accuracy
    alpha: float = 0.05    # Confidence level
    backend: Optional[str] = None  # Auto-detect if None
    seed: int = 42
    cloud_config: Optional[dict] = None  # CloudBackendConfig as dict


class QuantumRunResult(BaseModel):
    """Result of a quantum MC estimation."""
    estimated_value: float
    confidence_interval: dict  # {lower, upper, confidence_level}
    num_oracle_calls: int = 0
    num_qubits: int = 0
    backend_used: str = ""
    execution_time_ms: int = 0
    governance_labels: dict = Field(default_factory=lambda: GOVERNANCE_LABELS.copy())
    reproducibility_hash: str = ""
    raw_result: dict = Field(default_factory=dict)
    # Cloud execution metadata — populated only when a cloud backend is used
    cloud_provider: Optional[str] = None
    cloud_backend_name: Optional[str] = None
    cloud_job_id: Optional[str] = None
    cloud_qpu_time_seconds: float = 0.0
    cloud_cost_dollars: float = 0.0


class HybridCompareResult(BaseModel):
    """Comparison of classical and quantum estimates."""
    classical_value: float
    quantum_value: float
    absolute_delta: float
    relative_delta: float
    within_tolerance: bool
    tolerance_threshold: float = 0.05
    governance_labels: dict = Field(default_factory=lambda: GOVERNANCE_LABELS.copy())


def _build_probability_oracle(probabilities: list[float], threshold_idx: int) -> QuantumCircuit:
    """Build a quantum oracle that encodes the probability distribution.

    The oracle marks states where the cumulative sum exceeds the threshold.
    """
    n_bins = len(probabilities)
    # Number of qubits to represent bins
    n_qubits = max(1, math.ceil(math.log2(max(n_bins, 2))))

    # Pad probabilities to power of 2
    padded = list(probabilities) + [0.0] * (2**n_qubits - n_bins)

    # Normalize
    total = sum(padded)
    if total > 0:
        padded = [p / total for p in padded]

    # Build amplitude-encoded state
    qc = QuantumCircuit(n_qubits)

    # Use initialize to load the distribution
    amplitudes = [np.sqrt(max(0, p)) for p in padded]
    norm = np.sqrt(sum(a**2 for a in amplitudes))
    if norm > 0:
        amplitudes = [a / norm for a in amplitudes]

    qc.initialize(amplitudes, range(n_qubits))

    return qc


def _compute_classical_probability(probabilities: list[float], threshold_idx: int, event_type: str) -> float:
    """Compute classical probability for comparison.

    For breach/ruin: P(X >= threshold) = sum of probabilities from threshold_idx onward
    For target_hit: P(X >= threshold) similarly
    For tail_loss: P(X <= -threshold)
    """
    if event_type in ("breach", "ruin", "target_hit"):
        return sum(probabilities[threshold_idx:])
    elif event_type == "tail_loss":
        return sum(probabilities[:threshold_idx + 1])
    return sum(probabilities[threshold_idx:])


def run_quantum_breach_estimation(
    model: UncertaintyModel,
    threshold: float,
    backend: Optional[str] = None,
    epsilon: float = 0.01,
    alpha: float = 0.05,
    seed: int = 42,
    cloud_config: Optional[dict] = None,
) -> QuantumRunResult:
    """Estimate P(breach >= threshold) using quantum amplitude estimation."""
    return _run_estimation(model, threshold, "breach", backend, epsilon, alpha, seed, cloud_config)


def run_quantum_ruin_estimation(
    model: UncertaintyModel,
    threshold: float,
    backend: Optional[str] = None,
    epsilon: float = 0.01,
    alpha: float = 0.05,
    seed: int = 42,
    cloud_config: Optional[dict] = None,
) -> QuantumRunResult:
    """Estimate P(ruin >= threshold)."""
    return _run_estimation(model, threshold, "ruin", backend, epsilon, alpha, seed, cloud_config)


def run_quantum_target_hit_estimation(
    model: UncertaintyModel,
    threshold: float,
    backend: Optional[str] = None,
    epsilon: float = 0.01,
    alpha: float = 0.05,
    seed: int = 42,
    cloud_config: Optional[dict] = None,
) -> QuantumRunResult:
    """Estimate P(profit >= target)."""
    return _run_estimation(model, threshold, "target_hit", backend, epsilon, alpha, seed, cloud_config)


def run_quantum_tail_loss_estimation(
    model: UncertaintyModel,
    threshold: float,
    backend: Optional[str] = None,
    epsilon: float = 0.01,
    alpha: float = 0.05,
    seed: int = 42,
    cloud_config: Optional[dict] = None,
) -> QuantumRunResult:
    """Estimate P(single-day loss >= threshold)."""
    return _run_estimation(model, threshold, "tail_loss", backend, epsilon, alpha, seed, cloud_config)


def _run_estimation(
    model: UncertaintyModel,
    threshold: float,
    event_type: str,
    backend: Optional[str],
    epsilon: float,
    alpha: float,
    seed: int,
    cloud_config: Optional[dict] = None,
) -> QuantumRunResult:
    """Core estimation logic."""
    start_ms = int(time.time() * 1000)

    bins = model.bins or []
    probs = model.probabilities or []

    if not bins or not probs:
        raise ValueError("Model must have bins and probabilities for quantum estimation")

    # Find threshold index
    threshold_idx = 0
    for i, edge in enumerate(bins[:-1]):
        if edge >= threshold:
            threshold_idx = i
            break
    else:
        threshold_idx = len(probs) - 1

    if event_type == "tail_loss":
        # For tail loss, we look at the left tail
        for i, edge in enumerate(bins[:-1]):
            if edge >= -threshold:
                threshold_idx = i
                break

    # Classical fallback value
    classical_prob = _compute_classical_probability(probs, threshold_idx, event_type)

    # Tracks IAE failure reason when quantum path is attempted but fails
    _iae_failure_reason: str = "IAE circuit execution failed"

    # Build reproducibility hash
    config_str = json.dumps({
        "model_type": model.model_type,
        "n_samples": model.n_samples,
        "threshold": threshold,
        "event_type": event_type,
        "epsilon": epsilon,
        "alpha": alpha,
        "seed": seed,
    }, sort_keys=True)
    repro_hash = hashlib.sha256(config_str.encode()).hexdigest()

    # Try quantum estimation
    if QISKIT_AVAILABLE and QISKIT_ALGORITHMS_AVAILABLE and AER_AVAILABLE:
        try:
            n_qubits = max(1, math.ceil(math.log2(max(len(probs), 2))))

            # Select backend label (informational — Sampler owns execution)
            if backend is None:
                backend = select_backend(n_qubits + 2)  # +2 for ancilla qubits

            # Build state-preparation oracle (encodes the probability distribution)
            state_prep = _build_probability_oracle(probs, threshold_idx)

            # Build Grover oracle: marks objective states (threshold_idx .. n_states-1)
            # We add one ancilla qubit (index n_qubits) that is flipped for "good" states.
            n_total = n_qubits + 1  # data qubits + 1 objective ancilla
            grover_op = QuantumCircuit(n_total)
            # Copy state-prep into the Grover circuit on the data qubits
            grover_op.compose(state_prep, qubits=list(range(n_qubits)), inplace=True)
            # Mark good states: flip ancilla for all computational basis states
            # whose integer index >= threshold_idx (i.e., the breach/ruin region).
            # We use an X gate conditioned on all data-qubit control patterns.
            n_states = 2 ** n_qubits
            for idx in range(threshold_idx, n_states):
                bits = format(idx, f"0{n_qubits}b")
                # Pre-flip qubits that are 0 in this pattern so we can use all-1 MCX
                zero_qubits = [q for q, b in enumerate(reversed(bits)) if b == "0"]
                if zero_qubits:
                    grover_op.x(zero_qubits)
                grover_op.mcx(list(range(n_qubits)), n_qubits)  # flip ancilla
                if zero_qubits:
                    grover_op.x(zero_qubits)

            # Wrap state_prep into an n_total circuit so its qubit count matches
            # grover_op (which is built on n_total = n_qubits + 1 wires).
            # EstimationProblem requires state_preparation and grover_operator to
            # operate on the same number of qubits.
            full_state_prep = QuantumCircuit(n_total)
            full_state_prep.compose(state_prep, qubits=list(range(n_qubits)), inplace=True)
            # Ancilla qubit at index n_qubits starts in |0⟩ — no initialization needed.

            # EstimationProblem wires the state-prep and objective together for IAE.
            # objective_qubits=[n_qubits] points to the ancilla that grover_op flips
            # for good states — NOT the last data qubit (n_qubits - 1).
            problem = EstimationProblem(
                state_preparation=full_state_prep,
                grover_operator=grover_op,
                objective_qubits=[n_qubits],  # ancilla qubit flipped by MCX
            )

            # Cloud QPU path (IBM or Braket) — optional, only when cloud_config provided
            cloud_sampler = None
            cloud_metadata: dict = {}
            if CLOUD_BACKEND_AVAILABLE and cloud_config:
                cloud_cfg = CloudBackendConfig(**cloud_config)
                if cloud_cfg.opt_in_cloud:
                    provider_name, backend_obj, label = resolve_backend(cloud_cfg, n_qubits + 2)
                    if provider_name == "ibm" and backend_obj is not None:
                        # IBM SamplerV2 is a drop-in for AerSampler (same Sampler primitive interface)
                        cloud_sampler = backend_obj
                        cloud_metadata = {"provider": "ibm", "backend_name": label}
                    elif provider_name == "braket" and backend_obj is not None:
                        # Braket SV1: IAE-Braket bridge not yet implemented — fall back to local
                        import logging as _logging
                        _logging.getLogger(__name__).info(
                            "Braket backend selected but IAE-Braket bridge not yet implemented, "
                            "falling back to local sampler"
                        )

            # IAE requires a Sampler primitive — prefer cloud, then AerSampler, then StatevectorSampler
            if cloud_sampler is not None:
                sampler = cloud_sampler
            elif AER_SAMPLER_AVAILABLE:
                sampler = AerSampler()
            else:
                from qiskit.primitives import StatevectorSampler  # type: ignore[import]
                sampler = StatevectorSampler()

            iae = IterativeAmplitudeEstimation(
                epsilon_target=epsilon,
                alpha=alpha,
                sampler=sampler,
            )

            iae_result = iae.estimate(problem)
            quantum_estimate = float(iae_result.estimation)
            num_oracle_calls = int(getattr(iae_result, "num_oracle_queries", 0))
            classical_fallback = False

            execution_time_ms = int(time.time() * 1000) - start_ms

            # Collect cloud job metadata when a cloud sampler was used
            cloud_qpu_time: float = 0.0
            cloud_job_id: Optional[str] = None
            cloud_metadata_warnings: list[str] = []
            if cloud_metadata:
                # IBM Runtime: attempt to read session usage if a session is attached
                if hasattr(sampler, "_session") and sampler._session is not None:
                    try:
                        usage = sampler._session.usage()
                        cloud_qpu_time = float(usage.get("quantum_seconds", 0))
                    except Exception as exc:
                        cloud_metadata_warnings.append(f"session_usage_unavailable:{exc}")
                # IBM Runtime: attempt to read job ID from the last job if available
                if hasattr(sampler, "_run_options") and hasattr(iae_result, "circuit_results"):
                    try:
                        cloud_job_id = str(getattr(iae_result, "job_id", None))
                    except Exception as exc:
                        cloud_metadata_warnings.append(f"job_id_unavailable:{exc}")

            return QuantumRunResult(
                estimated_value=quantum_estimate,
                confidence_interval={
                    "lower": max(0, quantum_estimate - epsilon),
                    "upper": min(1, quantum_estimate + epsilon),
                    "confidence_level": 1 - alpha,
                },
                num_oracle_calls=num_oracle_calls,
                num_qubits=n_qubits,
                backend_used=cloud_metadata.get("backend_name", backend) if cloud_metadata else backend,
                execution_time_ms=execution_time_ms,
                reproducibility_hash=repro_hash,
                raw_result={
                    "method": "iae",
                    "classical_fallback": classical_fallback,
                    "n_bins": len(probs),
                    "threshold_idx": threshold_idx,
                    "objective_qubits": [n_qubits],
                    "epsilon_target": epsilon,
                    "alpha": alpha,
                    "num_oracle_calls": num_oracle_calls,
                    "cloud_provider": cloud_metadata.get("provider") if cloud_metadata else None,
                    "cloud_metadata_warnings": cloud_metadata_warnings,
                },
                cloud_provider=cloud_metadata.get("provider") if cloud_metadata else None,
                cloud_backend_name=cloud_metadata.get("backend_name") if cloud_metadata else None,
                cloud_job_id=cloud_job_id,
                cloud_qpu_time_seconds=cloud_qpu_time,
            )
        except Exception as exc:
            # IAE failed (circuit too deep, version mismatch, hardware unavailable).
            # Fall through to classical fallback and surface the reason.
            _iae_failure_reason = str(exc)  # noqa: F841 — read in fallback block below

    # Classical fallback — Qiskit unavailable or IAE circuit execution failed

    execution_time_ms = int(time.time() * 1000) - start_ms

    if not QISKIT_AVAILABLE or not QISKIT_ALGORITHMS_AVAILABLE or not AER_AVAILABLE:
        fallback_reason = "Qiskit not available"
    else:
        fallback_reason = _iae_failure_reason

    return QuantumRunResult(
        estimated_value=classical_prob,
        confidence_interval={
            "lower": max(0, classical_prob - epsilon),
            "upper": min(1, classical_prob + epsilon),
            "confidence_level": 1 - alpha,
        },
        num_qubits=0,
        backend_used="classical_fallback",
        execution_time_ms=execution_time_ms,
        reproducibility_hash=repro_hash,
        raw_result={
            "method": "classical_fallback",
            "classical_fallback": True,
            "reason": fallback_reason,
        },
    )


def run_hybrid_compare(
    classical_value: float,
    quantum_result: QuantumRunResult,
    tolerance: float = 0.05,
) -> HybridCompareResult:
    """Compare classical MC estimate with quantum estimate."""
    delta = abs(quantum_result.estimated_value - classical_value)
    rel_delta = delta / max(abs(classical_value), 1e-10)

    return HybridCompareResult(
        classical_value=classical_value,
        quantum_value=quantum_result.estimated_value,
        absolute_delta=delta,
        relative_delta=rel_delta,
        within_tolerance=delta <= tolerance,
        tolerance_threshold=tolerance,
    )


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-json", required=True)
    args = parser.parse_args()

    config = json.loads(args.input_json)

    # Build model from config
    model = UncertaintyModel(**config["model"])
    event_type = config.get("event_type", "breach")
    threshold = config.get("threshold", 2000.0)

    result = _run_estimation(
        model=model,
        threshold=threshold,
        event_type=event_type,
        backend=config.get("backend"),
        epsilon=config.get("epsilon", 0.01),
        alpha=config.get("alpha", 0.05),
        seed=config.get("seed", 42),
        cloud_config=config.get("cloud_config"),
    )

    print(result.model_dump_json(indent=2))
