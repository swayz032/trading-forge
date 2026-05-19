"""Quantum benchmarking framework — classical vs quantum comparison.

Validates quantum estimates against classical MC within tolerance bounds.
Persists benchmark records for reproducibility and governance.

Usage:
    python -m src.engine.quantum_bench --input-json '{"quantum": {...}, "classical": {...}}'
"""
from __future__ import annotations

import hashlib
import json
import sys
from typing import Optional

from pydantic import BaseModel, Field

from src.engine.quantum_mc import QuantumRunResult, GOVERNANCE_LABELS


class ToleranceConfig(BaseModel):
    """Tolerance thresholds for quantum-classical comparison."""
    absolute_tolerance: float = 0.05    # Max |quantum - classical|
    relative_tolerance: float = 0.10    # Max relative difference
    confidence_level: float = 0.95      # Required confidence


class BenchmarkResult(BaseModel):
    """Full benchmark comparison record."""
    quantum_run_id: Optional[str] = None
    classical_run_id: Optional[str] = None
    metric: str  # breach_probability | ruin_probability | target_hit | tail_loss
    quantum_value: float
    classical_value: float
    absolute_delta: float
    relative_delta: float
    passes_absolute: bool
    passes_relative: bool
    passes: bool  # Both must pass
    tolerance_config: ToleranceConfig
    reproducibility_hash: str
    governance_labels: dict = Field(default_factory=lambda: GOVERNANCE_LABELS.copy())
    notes: str = ""


def benchmark_against_classical(
    quantum_result: QuantumRunResult,
    classical_value: float,
    metric: str = "breach_probability",
    tolerance: Optional[ToleranceConfig] = None,
    quantum_run_id: Optional[str] = None,
    classical_run_id: Optional[str] = None,
) -> BenchmarkResult:
    """Compare quantum estimate against classical MC result.

    Args:
        quantum_result: Result from quantum estimation
        classical_value: Classical MC probability
        metric: What metric is being compared
        tolerance: Tolerance thresholds
    """
    if tolerance is None:
        tolerance = ToleranceConfig()

    q_val = quantum_result.estimated_value
    c_val = classical_value

    abs_delta = abs(q_val - c_val)
    rel_delta = abs_delta / max(abs(c_val), 1e-10)

    passes_abs = abs_delta <= tolerance.absolute_tolerance
    passes_rel = rel_delta <= tolerance.relative_tolerance

    # Build reproducibility hash from both results
    hash_input = json.dumps({
        "quantum_hash": quantum_result.reproducibility_hash,
        "classical_value": classical_value,
        "metric": metric,
        "tolerance": tolerance.model_dump(),
    }, sort_keys=True)
    repro_hash = hashlib.sha256(hash_input.encode()).hexdigest()

    notes_parts = []
    if not passes_abs:
        notes_parts.append(f"Absolute delta {abs_delta:.4f} exceeds threshold {tolerance.absolute_tolerance}")
    if not passes_rel:
        notes_parts.append(f"Relative delta {rel_delta:.4f} exceeds threshold {tolerance.relative_tolerance}")
    if passes_abs and passes_rel:
        notes_parts.append("Quantum estimate within tolerance of classical MC")

    return BenchmarkResult(
        quantum_run_id=quantum_run_id,
        classical_run_id=classical_run_id,
        metric=metric,
        quantum_value=q_val,
        classical_value=c_val,
        absolute_delta=abs_delta,
        relative_delta=rel_delta,
        passes_absolute=passes_abs,
        passes_relative=passes_rel,
        passes=passes_abs and passes_rel,
        tolerance_config=tolerance,
        reproducibility_hash=repro_hash,
        notes="; ".join(notes_parts),
    )


def validate_tolerance(delta: float, tolerance_config: ToleranceConfig) -> bool:
    """Quick check if a delta is within tolerance."""
    return delta <= tolerance_config.absolute_tolerance


def build_reproducibility_hash(run_config: dict) -> str:
    """Build deterministic hash from run configuration for reproducibility."""
    config_str = json.dumps(run_config, sort_keys=True, default=str)
    return hashlib.sha256(config_str.encode()).hexdigest()


def persist_benchmark(benchmark: BenchmarkResult) -> dict:
    """Serialize benchmark for DB persistence.

    Returns dict matching quantum_mc_benchmarks table schema.
    """
    return {
        "quantum_run_id": benchmark.quantum_run_id,
        "classical_run_id": benchmark.classical_run_id,
        "metric": benchmark.metric,
        "quantum_value": str(benchmark.quantum_value),
        "classical_value": str(benchmark.classical_value),
        "absolute_delta": str(benchmark.absolute_delta),
        "relative_delta": str(benchmark.relative_delta),
        "tolerance_threshold": str(benchmark.tolerance_config.absolute_tolerance),
        "passes": benchmark.passes,
        "notes": benchmark.notes,
    }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-json", required=True)
    args = parser.parse_args()

    config = json.loads(args.input_json)

    quantum_result = QuantumRunResult(**config["quantum"])
    classical_value = config["classical_value"]
    metric = config.get("metric", "breach_probability")

    tol = None
    if "tolerance" in config:
        tol = ToleranceConfig(**config["tolerance"])

    result = benchmark_against_classical(quantum_result, classical_value, metric, tol)
    print(result.model_dump_json(indent=2))
